import { STORES, alleLaden, speichern } from './db.js';

const KRITERIEN = [
  ['zeitmanagement', 'Zeitmanagement'],
  ['material', 'Material'],
  ['arbeitsergebnisse', 'Arbeitsergebnisse'],
  ['sozialkompetenz', 'Sozialkompetenz'],
  ['muendlicheBeteiligung', 'Mündliche Beteiligung']
];

const MAXIMALWERTE = [1.5, 3, 4.5, 6];
const EINSTELLUNGS_ID = 'solei-kriterien';

let root;
let daten;
let warteschlange = Promise.resolve();
const auswahl = { kriterium: KRITERIEN[0][0], person: '' };

const $ = (selector, basis = root) => basis.querySelector(selector);

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function el(tag, text, klasse) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (klasse) node.className = klasse;
  return node;
}

function option(select, value, text) {
  const node = el('option', text);
  node.value = value;
  select.append(node);
}

function input(name, type, value, required = true) {
  const node = document.createElement('input');
  node.name = name;
  node.type = type;
  node.value = value ?? '';
  node.required = required;
  return node;
}

function labelMitControl(text, control) {
  const label = el('label', text);
  label.append(control);
  return label;
}

function neuesDetails(key, titel, klasse) {
  const details = document.createElement('details');
  details.dataset.key = key;
  if (klasse) details.className = klasse;
  details.append(el('summary', titel));
  return details;
}

function formatZahl(wert) {
  return Number(wert).toLocaleString('de-DE', {
    minimumFractionDigits: Number.isInteger(Number(wert)) ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function runde1(wert) {
  return Math.round(wert * 10) / 10;
}

function heuteLokal() {
  const jetzt = new Date();
  const monat = String(jetzt.getMonth() + 1).padStart(2, '0');
  const tag = String(jetzt.getDate()).padStart(2, '0');
  return `${jetzt.getFullYear()}-${monat}-${tag}`;
}

function datumUTC(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text ?? '')) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function tageNach(date, anzahl) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + anzahl);
  return result;
}

function mitte(start, ende) {
  const tage = Math.floor((ende - start) / 86_400_000) + 1;
  return tageNach(start, Math.floor(tage / 2));
}

function setzeStatus(text, fehler = false) {
  const node = $('[data-solei-status]');
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle('meldung--fehler', fehler);
}

/** Speichervorgänge nacheinander ausführen, damit schnelle Tipps sich nicht überholen. */
function einreihen(aufgabe, beiFehler) {
  warteschlange = warteschlange.then(async () => {
    try {
      await aufgabe();
    } catch (error) {
      setzeStatus(`Speichern fehlgeschlagen: ${error.message}`, true);
      if (beiFehler) {
        try { await beiFehler(); } catch { /* Anzeige bleibt wie sie ist */ }
      }
    }
  });
  return warteschlange;
}

/* ------------------------------------------------------------------ */
/* Halbjahre, Quartale, Noten                                          */
/* ------------------------------------------------------------------ */

function findeHalbjahr(kurs, datum) {
  const date = datumUTC(datum);
  if (!date) return null;

  for (let index = 0; index < 2; index++) {
    const h = kurs.halbjahre?.[index];
    const start = datumUTC(h?.start);
    const ende = datumUTC(h?.ende);
    if (start && ende && date >= start && date <= ende) {
      return { index, start, ende };
    }
  }
  return null;
}

function findeQuartal(kurs, datum) {
  const halbjahr = findeHalbjahr(kurs, datum);
  const date = datumUTC(datum);
  if (!halbjahr) return null;

  const grenze = mitte(halbjahr.start, halbjahr.ende);
  const nummer = date < grenze ? 1 : 2;

  return {
    halbjahr: halbjahr.index + 1,
    quartal: nummer,
    id: `H${halbjahr.index + 1}Q${nummer}`,
    start: nummer === 1 ? iso(halbjahr.start) : iso(grenze),
    ende: nummer === 1 ? iso(tageNach(grenze, -1)) : iso(halbjahr.ende)
  };
}

// Vorläufige lineare Notenumrechnung: 15 Punkte = 1,0; 0 Punkte = 6,0.
// Hier später die verbindliche Notentabelle einsetzen.
export function noteAusPunkten(punkte) {
  if (!Number.isFinite(punkte)) return null;
  const begrenzt = Math.max(0, Math.min(15, punkte));
  return runde1(1 + (15 - begrenzt) / 3);
}

function punkteStufen(maximum) {
  return [
    runde1(maximum),
    runde1(maximum * 2 / 3),
    runde1(maximum / 3),
    0
  ];
}

/* ------------------------------------------------------------------ */
/* Daten                                                               */
/* ------------------------------------------------------------------ */

function standardNamen() {
  return Object.fromEntries(KRITERIEN);
}

function aktuelleNamen() {
  return { ...standardNamen(), ...(daten.einstellungen?.kriterien ?? {}) };
}

async function ladeDaten() {
  const [kurse, klassen, schueler, leistungen, einstellungen] =
    await Promise.all([
      alleLaden(STORES.KURSE),
      alleLaden(STORES.KLASSEN),
      alleLaden(STORES.SCHUELER),
      alleLaden(STORES.LEISTUNGEN),
      alleLaden(STORES.EINSTELLUNGEN)
    ]);

  daten = {
    kurse,
    klassen,
    schueler,
    leistungen,
    einstellungen: einstellungen.find((x) => x.id === EINSTELLUNGS_ID) ?? null
  };
}

function aktiverKurs() {
  const id = Number($('[data-kurs]').value);
  return daten.kurse.find((kurs) => kurs.id === id) ?? null;
}

function passendeSchueler(kurs) {
  return daten.schueler
    .filter((person) => person.klasseId === kurs.klasseId)
    .sort((a, b) =>
      a.nachname.localeCompare(b.nachname, 'de')
      || a.vorname.localeCompare(b.vorname, 'de'));
}

function maximaFuer(kurs, quartal) {
  return kurs.einstellungen?.soleiMaxima?.[quartal.id]
    ?? Object.fromEntries(KRITERIEN.map(([id]) => [id, 3]));
}

function findeEintrag(typ, kursId, personId, zusatz = {}) {
  return daten.leistungen.find((eintrag) =>
    eintrag.typ === typ
    && eintrag.kursId === kursId
    && eintrag.personId === personId
    && Object.entries(zusatz).every(([key, value]) => eintrag[key] === value));
}

function uploadKriteriumFuer(kurs) {
  const gespeichert = kurs.einstellungen?.soleiUploadKriterium;
  return KRITERIEN.some(([id]) => id === gespeichert)
    ? gespeichert
    : KRITERIEN[0][0];
}

/* ------------------------------------------------------------------ */
/* Aufbau der Oberfläche                                               */
/* ------------------------------------------------------------------ */

export async function initialisiereSolei() {
  if (document.getElementById('solei')) return;

  root = el('section', undefined, 'karte');
  root.id = 'solei';
  root.append(el('h2', 'Sonstige Leistungen'));

  const status = el('p', undefined, 'meldung');
  status.dataset.soleiStatus = '';
  status.hidden = true;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(status);

  const kopf = el('div', undefined, 'solei-auswahl formular');

  const kurse = document.createElement('select');
  kurse.dataset.kurs = '';

  const datum = document.createElement('input');
  datum.type = 'date';
  datum.dataset.datum = '';
  datum.value = heuteLokal();

  const modus = document.createElement('select');
  modus.dataset.modus = '';
  option(modus, 'kriterium', 'Nach Kriterium');
  option(modus, 'person', 'Nach Person');

  kopf.append(
    labelMitControl('Kurs', kurse),
    labelMitControl('Datum', datum),
    labelMitControl('Erfassungsmodus', modus)
  );
  root.append(kopf);

  const inhalt = el('div');
  inhalt.dataset.inhalt = '';
  root.append(inhalt);

  document.querySelector('main').append(root);

  kurse.addEventListener('change', neuZeichnenMitLaden);
  datum.addEventListener('change', neuZeichnenMitLaden);
  modus.addEventListener('change', zeichneErfassung);
  root.addEventListener('click', klicke);
  root.addEventListener('submit', submit);
  root.addEventListener('keydown', tastatur);

  document.addEventListener('pwa:stammdaten-geaendert', async () => {
    await ladeDaten();
    fuelleKursauswahl();
    zeichneAlles();
  });

  await ladeDaten();
  fuelleKursauswahl();
  zeichneAlles();
}

async function neuZeichnenMitLaden() {
  await warteschlange;
  await ladeDaten();
  zeichneAlles();
}

function fuelleKursauswahl() {
  const select = $('[data-kurs]');
  const vorher = select.value;
  select.replaceChildren();
  option(select, '', 'Bitte Kurs auswählen');

  for (const kurs of daten.kurse) {
    const klasse = daten.klassen.find((x) => x.id === kurs.klasseId);
    if (!klasse || !kurs.halbjahre?.length) continue;
    option(select, kurs.id, `${klasse.name} · ${kurs.fach ?? kurs.name}`);
  }

  if ([...select.options].some((x) => x.value === vorher && vorher !== '')) {
    select.value = vorher;
  } else if (select.options.length > 1) {
    select.selectedIndex = 1;
  }
}

function zeichneAlles() {
  const inhalt = $('[data-inhalt]');
  const offen = new Set(
    [...inhalt.querySelectorAll('details[open]')].map((d) => d.dataset.key));
  inhalt.replaceChildren();

  const kurs = aktiverKurs();
  const datum = $('[data-datum]').value;

  if (!kurs) {
    inhalt.append(el('p', 'Lege zuerst einen Kurs mit Klasse und Schuljahr an.'));
    return;
  }

  const quartal = findeQuartal(kurs, datum);
  if (!quartal) {
    inhalt.append(el('p',
      'Das Datum liegt außerhalb der Halbjahresgrenzen dieses Kurses.'));
    return;
  }

  const namen = aktuelleNamen();
  const maxima = maximaFuer(kurs, quartal);

  inhalt.append(
    el('h3',
      `Halbjahr ${quartal.halbjahr}, Quartal ${quartal.quartal} · ${quartal.start} bis ${quartal.ende}`),
    baueErfassungsbereich(kurs, datum, quartal, maxima, namen),
    baueMaximaEditor(kurs, quartal, maxima, namen),
    baueNamenEditor(namen),
    ...baueNachweise(kurs, quartal, namen)
  );

  inhalt.querySelectorAll('details').forEach((d) => {
    d.open = offen.has(d.dataset.key);
  });
}

/** Nur den Erfassungsbereich neu zeichnen (z. B. bei Moduswechsel). */
function zeichneErfassung() {
  const kurs = aktiverKurs();
  if (!kurs) return;
  const datum = $('[data-datum]').value;
  const quartal = findeQuartal(kurs, datum);
  const bestehend = $('.solei-erfassung');
  if (!quartal || !bestehend) return;

  bestehend.replaceWith(baueErfassungsbereich(
    kurs, datum, quartal, maximaFuer(kurs, quartal), aktuelleNamen()));
}

/** Auswertung, Uploads und Halbjahresnoten neu zeichnen, ohne die Erfassung anzufassen. */
function zeichneNachweise() {
  const kurs = aktiverKurs();
  if (!kurs) return;
  const quartal = findeQuartal(kurs, $('[data-datum]').value);
  if (!quartal) return;

  const inhalt = $('[data-inhalt]');
  const alte = [...inhalt.querySelectorAll('.solei-nachweis')];
  const offen = new Set(alte.filter((d) => d.open).map((d) => d.dataset.key));
  alte.forEach((d) => d.remove());

  for (const details of baueNachweise(kurs, quartal, aktuelleNamen())) {
    details.open = offen.has(details.dataset.key);
    inhalt.append(details);
  }
}

function baueNachweise(kurs, quartal, namen) {
  return [
    baueAuswertung(kurs, quartal, namen),
    baueUploadPanel(kurs, quartal, namen),
    baueHalbjahresnoten(kurs, quartal)
  ];
}

/* ------------------------------------------------------------------ */
/* Einstellungen: Maxima und Kriteriennamen                            */
/* ------------------------------------------------------------------ */

function baueMaximaEditor(kurs, quartal, maxima, namen) {
  const details = neuesDetails(
    'maxima', `Maximalpunkte in Quartal ${quartal.quartal} festlegen`);

  const form = el('form', undefined, 'formular');
  form.dataset.maxima = '';
  form.dataset.kursId = kurs.id;
  form.dataset.quartal = quartal.id;

  for (const [id] of KRITERIEN) {
    const select = document.createElement('select');
    select.name = id;
    for (const wert of MAXIMALWERTE) {
      option(select, wert, `${formatZahl(wert)} Punkte`);
    }
    select.value = maxima[id] ?? 3;
    form.append(labelMitControl(namen[id], select));
  }

  form.append(el('p', 'Die fünf Werte müssen zusammen 15 Punkte ergeben.'));
  const button = el('button', 'Maximalpunkte speichern', 'btn btn--sekundaer');
  button.type = 'submit';
  form.append(button);
  details.append(form);
  return details;
}

function baueNamenEditor(namen) {
  const details = neuesDetails('namen', 'Kriteriennamen global ändern');

  const form = el('form', undefined, 'formular');
  form.dataset.namen = '';

  KRITERIEN.forEach(([id], index) => {
    const feld = input(id, 'text', namen[id]);
    feld.maxLength = 60;
    form.append(labelMitControl(`Kriterium ${index + 1}`, feld));
  });

  const button = el('button', 'Namen speichern', 'btn btn--sekundaer');
  button.type = 'submit';
  form.append(button);
  details.append(form);
  return details;
}

async function speichereMaxima(form) {
  const werte = Object.fromEntries(KRITERIEN.map(([id]) =>
    [id, Number(form.elements[id].value)]));

  if (Object.values(werte).some((wert) => !MAXIMALWERTE.includes(wert))) {
    throw new Error('Erlaubte Maximalwerte sind 1,5, 3, 4,5 oder 6.');
  }
  if (runde1(Object.values(werte).reduce((a, b) => a + b, 0)) !== 15) {
    throw new Error('Die fünf Maximalwerte müssen zusammen genau 15 ergeben.');
  }

  const id = Number(form.dataset.kursId);
  const aktuell = await alleLaden(STORES.KURSE);
  const kurs = aktuell.find((x) => x.id === id);
  if (!kurs) throw new Error('Kurs nicht gefunden.');

  kurs.einstellungen ??= {};
  kurs.einstellungen.soleiMaxima ??= {};
  kurs.einstellungen.soleiMaxima[form.dataset.quartal] = werte;
  await speichern(STORES.KURSE, kurs);
}

async function speichereNamen(form) {
  const kriterien = Object.fromEntries(KRITERIEN.map(([id]) =>
    [id, form.elements[id].value.trim()]));
  if (Object.values(kriterien).some((wert) => !wert)) {
    throw new Error('Alle fünf Kriterien benötigen einen Namen.');
  }

  await speichern(STORES.EINSTELLUNGEN, {
    ...(daten.einstellungen ?? {}),
    id: EINSTELLUNGS_ID,
    kriterien
  });
}

/* ------------------------------------------------------------------ */
/* Erfassung                                                           */
/* ------------------------------------------------------------------ */

function baueErfassungsbereich(kurs, datum, quartal, maxima, namen) {
  const bereich = el('section', undefined, 'solei-erfassung karte');
  const schueler = passendeSchueler(kurs);

  if (!schueler.length) {
    bereich.append(el('p',
      'Für die Klasse dieses Kurses sind keine Schüler:innen angelegt.'));
    return bereich;
  }

  const modus = $('[data-modus]').value;
  let vorausgewaehltePerson = '';

  if (modus === 'kriterium') {
    if (!KRITERIEN.some(([id]) => id === auswahl.kriterium)) {
      auswahl.kriterium = KRITERIEN[0][0];
    }

    const select = document.createElement('select');
    for (const [id] of KRITERIEN) option(select, id, namen[id]);
    select.value = auswahl.kriterium;
    select.addEventListener('change', () => {
      auswahl.kriterium = select.value;
      zeichneErfassung();
    });
    bereich.append(labelMitControl('Kriterium für die ganze Klasse', select));

    const liste = el('div', undefined, 'solei-liste');
    for (const person of schueler) {
      liste.append(bauePersonZeile(
        kurs, person, auswahl.kriterium, datum, maxima, namen,
        `${person.nachname}, ${person.vorname}`, true));
    }
    bereich.append(liste);
  } else {
    const select = document.createElement('select');
    for (const person of schueler) {
      option(select, person.id, `${person.nachname}, ${person.vorname}`);
    }

    const person = schueler.find((x) => String(x.id) === auswahl.person)
      ?? schueler[0];
    auswahl.person = String(person.id);
    vorausgewaehltePerson = auswahl.person;
    select.value = auswahl.person;
    select.addEventListener('change', () => {
      auswahl.person = select.value;
      zeichneErfassung();
    });
    bereich.append(labelMitControl('Person', select));

    for (const [id] of KRITERIEN) {
      bereich.append(bauePersonZeile(
        kurs, person, id, datum, maxima, namen, namen[id], false));
    }
    bereich.append(baueNotiz(kurs, person, datum));
  }

  bereich.append(baueFehlzeitForm(schueler, datum, vorausgewaehltePerson));
  return bereich;
}

function bauePersonZeile(kurs, person, kriterium, datum, maxima, namen, titel, mitNotiz) {
  const row = el('article', undefined, 'solei-person');
  row.dataset.personRow = '';
  row.dataset.personId = person.id;
  row.dataset.kriterium = kriterium;
  row.tabIndex = 0;
  row.append(el('h4', titel));

  const stufen = punkteStufen(Number(maxima[kriterium] ?? 3));
  const aktueller = findeEintrag('solei', kurs.id, person.id, { kriterium, datum });
  const beschriftung = ['Max', '⅔', '⅓', '0'];

  const controls = el('div', undefined, 'solei-stufen');
  stufen.forEach((punkte, index) => {
    const button = el('button',
      `${beschriftung[index]} · ${formatZahl(punkte)}`,
      'btn btn--sekundaer');
    button.type = 'button';
    button.dataset.aktion = 'punkte';
    button.dataset.personId = person.id;
    button.dataset.kriterium = kriterium;
    button.dataset.punkte = punkte;
    button.dataset.datum = datum;
    button.setAttribute('aria-label',
      `${person.vorname} ${person.nachname}, ${namen[kriterium]}: ${formatZahl(punkte)} Punkte`);
    button.setAttribute('aria-pressed',
      String(Boolean(aktueller) && Number(aktueller.punkte) === punkte));
    controls.append(button);
  });
  row.append(controls);

  if (aktueller?.quelle === 'unentschuldigte-fehlzeit') {
    row.append(el('p', 'Unentschuldigt gefehlt', 'leise'));
  }
  if (mitNotiz) row.append(baueNotiz(kurs, person, datum));
  return row;
}

function baueNotiz(kurs, person, datum) {
  const block = el('div', undefined, 'solei-notiz');
  block.dataset.notizBlock = '';

  const feld = document.createElement('textarea');
  feld.rows = 2;
  feld.maxLength = 500;
  feld.placeholder = `Kurze Notiz für ${datum}`;
  feld.setAttribute('aria-label',
    `Notiz für ${person.vorname} ${person.nachname} am ${datum}`);
  feld.value = findeEintrag('solei-notiz', kurs.id, person.id, { datum })?.notiz ?? '';

  const button = el('button', 'Notiz speichern', 'btn btn--sekundaer');
  button.type = 'button';
  button.dataset.aktion = 'notiz';
  button.dataset.personId = person.id;
  button.dataset.datum = datum;

  block.append(feld, button);
  return block;
}

async function speicherePunkt(daten_) {
  const kurs = aktiverKurs();
  const { personId, kriterium, datum, punkte } = daten_;
  const quartal = findeQuartal(kurs, datum);
  if (!quartal) throw new Error('Datum liegt außerhalb der Halbjahre.');

  const vorhanden = findeEintrag('solei', kurs.id, personId, { kriterium, datum });
  await speichern(STORES.LEISTUNGEN, {
    ...(vorhanden ?? {}),
    typ: 'solei',
    kursId: kurs.id,
    klasseId: kurs.klasseId,
    personId,
    kriterium,
    datum,
    quartal: quartal.id,
    punkte,
    quelle: 'tipp',
    aktualisiertAm: new Date().toISOString()
  });
  await ladeDaten();
}

async function speichereNotiz(button) {
  const kurs = aktiverKurs();
  const personId = Number(button.dataset.personId);
  const datum = button.dataset.datum;
  const text = button.closest('[data-notiz-block]')
    .querySelector('textarea').value.trim();

  const vorhanden = findeEintrag('solei-notiz', kurs.id, personId, { datum });
  if (!text && !vorhanden) return;

  await speichern(STORES.LEISTUNGEN, {
    ...(vorhanden ?? {}),
    typ: 'solei-notiz',
    kursId: kurs.id,
    klasseId: kurs.klasseId,
    personId,
    datum,
    notiz: text,
    aktualisiertAm: new Date().toISOString()
  });
  await ladeDaten();
  setzeStatus('Notiz gespeichert.');
}

/* ------------------------------------------------------------------ */
/* Unentschuldigte Fehlzeit                                            */
/* ------------------------------------------------------------------ */

function baueFehlzeitForm(schueler, datum, vorausgewaehltePerson) {
  const form = el('form', undefined, 'formular solei-fehlzeit');
  form.dataset.fehlzeit = '';
  form.dataset.datum = datum;
  form.append(el('h4', 'Unentschuldigte Fehlzeit'));

  const select = document.createElement('select');
  select.name = 'personId';
  select.required = true;
  for (const person of schueler) {
    option(select, person.id, `${person.nachname}, ${person.vorname}`);
  }
  if (vorausgewaehltePerson) select.value = vorausgewaehltePerson;
  form.append(labelMitControl('Person', select));

  const button = el('button',
    'Fehlzeit eintragen – 0 Punkte in allen Kriterien', 'btn btn--gefahr');
  button.type = 'submit';
  form.append(button);
  return form;
}

async function speichereFehlzeit(form) {
  const kurs = aktiverKurs();
  const personId = Number(form.elements.personId.value);
  const datum = form.dataset.datum;
  const quartal = findeQuartal(kurs, datum);

  if (!personId || !quartal) {
    throw new Error('Bitte eine Person und ein Datum innerhalb des Halbjahres auswählen.');
  }

  if (!confirm('Für diesen Tag werden in allen fünf Kriterien 0 Punkte eingetragen. '
    + 'Bereits vorhandene Bewertungen dieses Tages werden überschrieben. Fortfahren?')) {
    return false;
  }

  for (const [kriterium] of KRITERIEN) {
    const vorhanden = findeEintrag('solei', kurs.id, personId, { kriterium, datum });
    await speichern(STORES.LEISTUNGEN, {
      ...(vorhanden ?? {}),
      typ: 'solei',
      kursId: kurs.id,
      klasseId: kurs.klasseId,
      personId,
      kriterium,
      datum,
      quartal: quartal.id,
      punkte: 0,
      quelle: 'unentschuldigte-fehlzeit',
      aktualisiertAm: new Date().toISOString()
    });
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Ergebnis-Uploads                                                    */
/* ------------------------------------------------------------------ */

function maximaImHalbjahr(kurs, halbjahr, kriterium) {
  const maxima = kurs.einstellungen?.soleiMaxima ?? {};
  const erstes = maxima[`H${halbjahr}Q1`]?.[kriterium] ?? 3;
  const zweites = maxima[`H${halbjahr}Q2`]?.[kriterium] ?? 3;
  return (Number(erstes) + Number(zweites)) / 2;
}

function uploadZaehler(kurs, personId, halbjahr) {
  return findeEintrag('solei-upload-zaehler', kurs.id, personId,
    { halbjahr: `H${halbjahr}` });
}

function baueUploadPanel(kurs, quartal, namen) {
  const halbjahr = quartal.halbjahr;
  const details = neuesDetails('uploads', 'Ergebnis-Uploads', 'solei-nachweis');

  const einstellung = document.createElement('form');
  einstellung.className = 'formular';
  einstellung.dataset.uploadKriterium = '';

  const select = document.createElement('select');
  select.name = 'kriterium';
  for (const [id] of KRITERIEN) option(select, id, namen[id]);
  select.value = uploadKriteriumFuer(kurs);
  einstellung.append(labelMitControl('Wirkt auf Kriterium', select));

  const einstellungKnopf = el('button', 'Kriterium speichern', 'btn btn--sekundaer');
  einstellungKnopf.type = 'submit';
  einstellung.append(einstellungKnopf);
  details.append(einstellung);

  details.append(el('p',
    'Jeder hochgeladene Upload zählt als Bewertung mit der Maximalpunktzahl des Kriteriums, '
    + 'jeder vergessene als Bewertung mit 0 Punkten. Sie gehen zusätzlich zu den Tagesbewertungen '
    + 'in den Halbjahresdurchschnitt ein.'));

  const form = document.createElement('form');
  form.className = 'formular';
  form.dataset.upload = '';
  form.dataset.halbjahr = halbjahr;

  const liste = el('div', undefined, 'solei-liste');
  for (const person of passendeSchueler(kurs)) {
    const gespeichert = uploadZaehler(kurs, person.id, halbjahr);
    const zeile = el('div', undefined, 'solei-upload-zeile');
    zeile.append(el('strong', `${person.nachname}, ${person.vorname}`));

    const hochgeladen = input(`hochgeladen-${person.id}`, 'number',
      gespeichert?.hochgeladen ?? 0);
    const vergessen = input(`vergessen-${person.id}`, 'number',
      gespeichert?.vergessen ?? 0);
    for (const feld of [hochgeladen, vergessen]) {
      feld.min = '0';
      feld.step = '1';
    }

    zeile.append(
      labelMitControl('Hochgeladen', hochgeladen),
      labelMitControl('Vergessen', vergessen)
    );
    liste.append(zeile);
  }
  form.append(liste);

  const speichernKnopf = el('button',
    `Zähler für Halbjahr ${halbjahr} speichern`, 'btn');
  speichernKnopf.type = 'submit';
  form.append(speichernKnopf);
  details.append(form);
  return details;
}

async function speichereUploadKriterium(form) {
  const kurs = aktiverKurs();
  const kriterium = form.elements.kriterium.value;
  if (!KRITERIEN.some(([id]) => id === kriterium)) {
    throw new Error('Bitte ein gültiges Kriterium auswählen.');
  }

  const aktuell = await alleLaden(STORES.KURSE);
  const gespeichert = aktuell.find((x) => x.id === kurs.id);
  if (!gespeichert) throw new Error('Kurs nicht gefunden.');
  gespeichert.einstellungen ??= {};
  gespeichert.einstellungen.soleiUploadKriterium = kriterium;
  await speichern(STORES.KURSE, gespeichert);
}

async function speichereUploadZaehler(form) {
  const kurs = aktiverKurs();
  const halbjahr = Number(form.dataset.halbjahr);

  for (const person of passendeSchueler(kurs)) {
    const hochgeladen = Number(form.elements[`hochgeladen-${person.id}`].value);
    const vergessen = Number(form.elements[`vergessen-${person.id}`].value);

    if (![hochgeladen, vergessen].every((w) => Number.isSafeInteger(w) && w >= 0)) {
      throw new Error('Upload-Zähler müssen nicht negative ganze Zahlen sein.');
    }

    const vorhanden = uploadZaehler(kurs, person.id, halbjahr);
    await speichern(STORES.LEISTUNGEN, {
      ...(vorhanden ?? {}),
      typ: 'solei-upload-zaehler',
      kursId: kurs.id,
      klasseId: kurs.klasseId,
      personId: person.id,
      halbjahr: `H${halbjahr}`,
      hochgeladen,
      vergessen,
      aktualisiertAm: new Date().toISOString()
    });
  }
}

/* ------------------------------------------------------------------ */
/* Berechnung und Auswertung                                           */
/* ------------------------------------------------------------------ */

function durchschnittKriterium(kurs, personId, kriterium, halbjahr) {
  const h = kurs.halbjahre[halbjahr - 1];
  const tagewerte = daten.leistungen.filter((eintrag) =>
    eintrag.typ === 'solei'
    && eintrag.kursId === kurs.id
    && eintrag.personId === personId
    && eintrag.kriterium === kriterium
    && eintrag.datum >= h.start
    && eintrag.datum <= h.ende
  ).map((eintrag) => Number(eintrag.punkte));

  let uploadAnzahl = 0;
  let uploadSumme = 0;
  const zaehler = uploadZaehler(kurs, personId, halbjahr);
  if (zaehler && uploadKriteriumFuer(kurs) === kriterium) {
    const hochgeladen = Number(zaehler.hochgeladen) || 0;
    const vergessen = Number(zaehler.vergessen) || 0;
    uploadAnzahl = hochgeladen + vergessen;
    uploadSumme = hochgeladen * maximaImHalbjahr(kurs, halbjahr, kriterium);
  }

  const anzahl = tagewerte.length + uploadAnzahl;
  if (!anzahl) return null;

  const summe = tagewerte.reduce((a, b) => a + b, 0) + uploadSumme;
  return runde1(summe / anzahl);
}

function halbjahresErgebnis(kurs, personId, halbjahr) {
  const durchschnittswerte = KRITERIEN.map(([id]) =>
    durchschnittKriterium(kurs, personId, id, halbjahr));

  // Keine Note, solange ein Kriterium unbewertet ist.
  if (durchschnittswerte.some((wert) => wert === null)) {
    return { durchschnittswerte, summe: null, note: null };
  }

  const summe = runde1(durchschnittswerte.reduce((a, b) => a + b, 0));
  return { durchschnittswerte, summe, note: noteAusPunkten(summe) };
}

function baueTabelle(kopfzeilen) {
  const table = document.createElement('table');
  table.className = 'solei-tabelle';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  kopfzeilen.forEach((text) => tr.append(el('th', text)));
  thead.append(tr);
  table.append(thead);
  return table;
}

function baueAuswertung(kurs, quartal, namen) {
  const halbjahr = quartal.halbjahr;
  const details = neuesDetails(
    'auswertung', `Halbjahresauswertung – Halbjahr ${halbjahr}`, 'solei-nachweis');

  const table = baueTabelle([
    'Name', ...KRITERIEN.map(([id]) => namen[id]), 'Summe / 15', 'Note'
  ]);
  const tbody = document.createElement('tbody');

  for (const person of passendeSchueler(kurs)) {
    const ergebnis = halbjahresErgebnis(kurs, person.id, halbjahr);
    const tr = document.createElement('tr');
    tr.append(el('th', `${person.nachname}, ${person.vorname}`));

    for (const wert of ergebnis.durchschnittswerte) {
      tr.append(el('td', wert === null ? '—' : formatZahl(wert)));
    }
    tr.append(el('td', ergebnis.summe === null ? '—' : formatZahl(ergebnis.summe)));
    tr.append(el('td', ergebnis.note === null ? '—' : formatZahl(ergebnis.note)));
    tbody.append(tr);
  }
  table.append(tbody);

  const tabellenBox = el('div', undefined, 'solei-tabelle-box');
  tabellenBox.append(table);
  details.append(tabellenBox);
  details.append(el('p',
    'Durchschnitte werden je Kriterium aus allen Einträgen des Halbjahres gebildet. '
    + 'Summe und Note erscheinen erst, wenn alle fünf Kriterien bewertet sind.'));
  return details;
}

/* ------------------------------------------------------------------ */
/* SoLei-Halbjahresnoten                                               */
/* ------------------------------------------------------------------ */

function baueHalbjahresnoten(kurs, quartal) {
  const halbjahr = quartal.halbjahr;
  const details = neuesDetails(
    'halbjahresnoten', `SoLei-Halbjahresnoten – Halbjahr ${halbjahr}`, 'solei-nachweis');

  const table = baueTabelle([
    'Person', 'SoLei-Note', 'Portfolio- oder mündliche Note', 'Gemittelte Note'
  ]);
  const tbody = document.createElement('tbody');

  for (const person of passendeSchueler(kurs)) {
    const ergebnis = halbjahresErgebnis(kurs, person.id, halbjahr);
    const zusatz = findeEintrag('solei-halbjahresnote', kurs.id, person.id,
      { halbjahr: `H${halbjahr}` });
    const zusatznote = zusatz?.zusatznote ?? null;

    const tr = document.createElement('tr');
    tr.append(el('th', `${person.nachname}, ${person.vorname}`));
    tr.append(el('td',
      ergebnis.note === null ? 'Noch unvollständig' : formatZahl(ergebnis.note)));

    const form = document.createElement('form');
    form.className = 'solei-zusatznote';
    form.dataset.halbjahresnote = '';
    form.dataset.personId = person.id;
    form.dataset.halbjahr = halbjahr;

    const feld = input('zusatznote', 'number', zusatznote ?? '', false);
    feld.min = '1';
    feld.max = '6';
    feld.step = '0.1';
    feld.setAttribute('aria-label',
      `Zusatznote für ${person.vorname} ${person.nachname}`);

    const button = el('button', 'Speichern', 'btn btn--sekundaer');
    button.type = 'submit';
    form.append(feld, button);

    const zelleForm = document.createElement('td');
    zelleForm.append(form);
    tr.append(zelleForm);

    let gemittelt = '—';
    if (zusatznote !== null && ergebnis.note !== null) {
      gemittelt = formatZahl(runde1((Number(zusatznote) + ergebnis.note) / 2));
    } else if (zusatznote === null && ergebnis.note !== null) {
      gemittelt = formatZahl(ergebnis.note);
    }
    tr.append(el('td', gemittelt));
    tbody.append(tr);
  }
  table.append(tbody);

  const tabellenBox = el('div', undefined, 'solei-tabelle-box');
  tabellenBox.append(table);
  details.append(tabellenBox);
  details.append(el('p',
    'Die Zusatznote ist optional. Bei Eintrag wird sie mit der errechneten SoLei-Note '
    + 'arithmetisch gemittelt; ohne Zusatznote gilt die SoLei-Note. '
    + 'Zum Entfernen das Feld leeren und speichern.'));
  return details;
}

async function speichereHalbjahresnote(form) {
  const kurs = aktiverKurs();
  const personId = Number(form.dataset.personId);
  const halbjahr = Number(form.dataset.halbjahr);
  const wert = form.elements.zusatznote.value.trim().replace(',', '.');

  const vorhanden = findeEintrag('solei-halbjahresnote', kurs.id, personId,
    { halbjahr: `H${halbjahr}` });

  let zusatznote = null;
  if (wert) {
    zusatznote = Number(wert);
    if (!Number.isFinite(zusatznote) || zusatznote < 1 || zusatznote > 6) {
      throw new Error('Die Zusatznote muss zwischen 1,0 und 6,0 liegen.');
    }
  } else if (!vorhanden) {
    return;
  }

  // Leeres Feld: Wert wird auf null gesetzt (kein Löschen nötig).
  await speichern(STORES.LEISTUNGEN, {
    ...(vorhanden ?? {}),
    typ: 'solei-halbjahresnote',
    kursId: kurs.id,
    klasseId: kurs.klasseId,
    personId,
    halbjahr: `H${halbjahr}`,
    zusatznote,
    aktualisiertAm: new Date().toISOString()
  });
}

/* ------------------------------------------------------------------ */
/* Ereignisse                                                          */
/* ------------------------------------------------------------------ */

function klicke(event) {
  const button = event.target.closest('button[data-aktion]');
  if (!button) return;

  if (button.dataset.aktion === 'punkte') {
    // Sofortige Rückmeldung, Speichern läuft im Hintergrund nacheinander.
    const row = button.closest('[data-person-row]');
    row.querySelectorAll('button[data-aktion="punkte"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === button));
    });

    const eintrag = {
      personId: Number(button.dataset.personId),
      kriterium: button.dataset.kriterium,
      datum: button.dataset.datum,
      punkte: Number(button.dataset.punkte)
    };

    einreihen(async () => {
      await speicherePunkt(eintrag);
      zeichneNachweise();
      setzeStatus('Gespeichert.');
    }, async () => {
      await ladeDaten();
      zeichneErfassung();
    });
  } else if (button.dataset.aktion === 'notiz') {
    einreihen(() => speichereNotiz(button));
  }
}

const FORMULAR_HANDLER = [
  ['fehlzeit', speichereFehlzeit],
  ['upload', speichereUploadZaehler],
  ['uploadKriterium', speichereUploadKriterium],
  ['halbjahresnote', speichereHalbjahresnote],
  ['maxima', speichereMaxima],
  ['namen', speichereNamen]
];

function submit(event) {
  const form = event.target.closest('form');
  if (!form) return;

  const treffer = FORMULAR_HANDLER.find(([key]) => key in form.dataset);
  if (!treffer) return;

  event.preventDefault();
  einreihen(async () => {
    const ergebnis = await treffer[1](form);
    if (ergebnis === false) {
      setzeStatus('Abgebrochen.');
      return;
    }
    await ladeDaten();
    zeichneAlles();
    setzeStatus('Gespeichert.');
  });
}

function tastatur(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;

  const row = event.target.closest('[data-person-row]');
  if (!row) return;

  const zeilen = [...root.querySelectorAll('[data-person-row]')];
  const index = zeilen.indexOf(row);

  if (['1', '2', '3', '4'].includes(event.key)) {
    const stufe = row.querySelectorAll('button[data-aktion="punkte"]')[Number(event.key) - 1];
    if (!stufe) return;
    event.preventDefault();
    stufe.click();
    // Weiter zur nächsten Zeile für zügige Eingabe.
    zeilen[index + 1]?.focus();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    zeilen[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  }
}

export { findeQuartal };
