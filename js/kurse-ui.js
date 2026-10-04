import { STORES, alleLaden, speichern } from './db.js';
import {
  WOCHENTAGE,
  standardEinstellungen,
  ergaenzeGewichtung,
  istGueltigeGewichtung,
  normalisiereFach
} from './logic/kurse.js';

const $ = (id) => document.getElementById(id);
let aktiverKursId = null;

function element(tag, text, klasse) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (klasse) el.className = klasse;
  return el;
}

function status(text, fehler = false) {
  const el = $('kurs-meldung');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('meldung--fehler', fehler);
}

function feldLabel(text, input) {
  const label = element('label', text);
  label.append(input);
  return label;
}

function eingabe(name, type, value, min, max) {
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.value = value ?? '';
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.required = true;
  return input;
}

export async function initialisiereKurse() {
  $('kurs-neu-form').addEventListener('submit', legeKursAn);
  $('kurs-auswahl').addEventListener('change', async (event) => {
    aktiverKursId = Number(event.currentTarget.value) || null;
    await zeichneKursbereich();
  });

  $('kurs-detail').addEventListener('click', handleDetailKlick);
  $('kurs-detail').addEventListener('input', handleGewichtung);
  $('kurs-detail').addEventListener('submit', speichereEinstellungen);

  await ladeKursauswahl();
}

async function ladeKursauswahl() {
  const [kurse, klassen, schuljahre] = await Promise.all([
    alleLaden(STORES.KURSE),
    alleLaden(STORES.KLASSEN),
    alleLaden(STORES.SCHULJAHRE)
  ]);

  const auswahl = $('kurs-auswahl');
  auswahl.replaceChildren();

  const nutzbareKurse = kurse.filter((kurs) => kurs.klasseId != null);
  for (const kurs of nutzbareKurse) {
    const klasse = klassen.find((eintrag) => eintrag.id === kurs.klasseId);
    const jahr = schuljahre.find((eintrag) => eintrag.id === kurs.schuljahrId);
    const option = document.createElement('option');
    option.value = kurs.id;
    option.textContent =
      `${klasse?.name ?? 'Klasse?'} · ${kurs.fach || kurs.name} · ${jahr?.name ?? 'Schuljahr?'}`;
    auswahl.append(option);
  }

  if (!nutzbareKurse.some((kurs) => kurs.id === aktiverKursId)) {
    aktiverKursId = nutzbareKurse[0]?.id ?? null;
  }

  auswahl.value = aktiverKursId ?? '';
  $('kurs-detail').hidden = !aktiverKursId;

  // Die Schuljahr- und Klassen-Auswahlen des Formulars werden neu befüllt.
  const schuljahrAuswahl = $('kurs-neu-schuljahr');
  const klassenAuswahl = $('kurs-neu-klasse');
  schuljahrAuswahl.replaceChildren();
  klassenAuswahl.replaceChildren();

  for (const jahr of schuljahre) {
    const option = document.createElement('option');
    option.value = jahr.id;
    option.textContent = `${jahr.name} – ${jahr.bundeslandName}`;
    schuljahrAuswahl.append(option);
  }

  for (const klasse of klassen) {
    const option = document.createElement('option');
    option.value = klasse.id;
    option.textContent = klasse.name;
    klassenAuswahl.append(option);
  }

  $('kurs-neu-hinweis').hidden = schuljahre.length > 0 && klassen.length > 0;
  $('kurs-neu-form').querySelector('button[type="submit"]').disabled =
    schuljahre.length === 0 || klassen.length === 0;

  const alteKurse = kurse.filter((kurs) => kurs.klasseId == null);
  $('kurs-alt-hinweis').hidden = alteKurse.length === 0;
  if (alteKurse.length) {
    $('kurs-alt-hinweis').textContent =
      `${alteKurse.length} ältere Kurs-Platzhalter sind keiner Klasse zugeordnet. ` +
      'Lege sie als Klasse-Fach-Kurs neu an.';
  }

  await zeichneKursbereich();
}

async function legeKursAn(event) {
  event.preventDefault();

  const daten = new FormData(event.currentTarget);
  const schuljahrId = Number(daten.get('schuljahrId'));
  const klasseId = Number(daten.get('klasseId'));
  const fach = String(daten.get('fach') ?? '').trim();

  if (!schuljahrId || !klasseId || !fach) {
    return status('Bitte Schuljahr, Klasse und Fach auswählen bzw. eingeben.', true);
  }

  const [schuljahre, kurse] = await Promise.all([
    alleLaden(STORES.SCHULJAHRE),
    alleLaden(STORES.KURSE)
  ]);
  const schuljahr = schuljahre.find((jahr) => jahr.id === schuljahrId);

  if (!schuljahr) return status('Das ausgewählte Schuljahr wurde nicht gefunden.', true);

  const doppelt = kurse.some((kurs) =>
    kurs.schuljahrId === schuljahrId
    && kurs.klasseId === klasseId
    && normalisiereFach(kurs.fach ?? kurs.name) === normalisiereFach(fach)
  );

  if (doppelt) return status('Dieser Klasse-Fach-Kurs ist im Schuljahr bereits angelegt.', true);

  const kurs = {
    schuljahrId,
    klasseId,
    fach,
    halbjahre: structuredClone(schuljahr.halbjahre),
    einstellungen: standardEinstellungen(schuljahr.ersterSchultag),
    erstelltAm: new Date().toISOString()
  };

  try {
    aktiverKursId = await speichern(STORES.KURSE, kurs);
    event.currentTarget.reset();
    status(`Kurs „${fach}“ wurde angelegt.`);
    await ladeKursauswahl();
  } catch (fehler) {
    status(`Kurs konnte nicht angelegt werden: ${fehler.message}`, true);
  }
}

async function zeichneKursbereich() {
  const bereich = $('kurs-detail');
  bereich.replaceChildren();

  if (!aktiverKursId) {
    bereich.hidden = true;
    return;
  }

  const [kurse, klassen, schuljahre] = await Promise.all([
    alleLaden(STORES.KURSE),
    alleLaden(STORES.KLASSEN),
    alleLaden(STORES.SCHULJAHRE)
  ]);
  const kurs = kurse.find((eintrag) => eintrag.id === aktiverKursId);
  if (!kurs) {
    bereich.hidden = true;
    return;
  }

  bereich.hidden = false;
  const klasse = klassen.find((eintrag) => eintrag.id === kurs.klasseId);
  const jahr = schuljahre.find((eintrag) => eintrag.id === kurs.schuljahrId);

  bereich.append(element(
    'h3',
    `${klasse?.name ?? 'Klasse?'} · ${kurs.fach ?? kurs.name} · ${jahr?.name ?? ''}`
  ));

  const navigation = element('nav', undefined, 'kurs-tabs');
  navigation.setAttribute('aria-label', 'Kursbereiche');

  const inhalte = element('div');
  const bereiche = [
    ['sonstige', 'Sonstige Leistungen', 'Noch keine sonstigen Leistungen erfasst.'],
    ['schriftlich', 'Schriftliche Leistungen', 'Noch keine schriftlichen Leistungen erfasst.'],
    ['auswertung', 'Auswertung', 'Die Auswertung erscheint, sobald Leistungen erfasst sind.']
  ];

  for (const [id, titel, hinweis] of bereiche) {
    const knopf = element('button', titel, 'btn btn--sekundaer');
    knopf.type = 'button';
    knopf.dataset.kursTab = id;
    knopf.setAttribute('aria-pressed', id === 'sonstige' ? 'true' : 'false');
    navigation.append(knopf);

    const panel = element('section', undefined, 'kurs-panel karte');
    panel.dataset.kursPanel = id;
    panel.hidden = id !== 'sonstige';
    panel.append(element('h4', titel), element('p', hinweis));
    inhalte.append(panel);
  }

  bereich.append(navigation, inhalte);
  bereich.append(erstelleEinstellungen(kurs));
}

function erstelleEinstellungen(kurs) {
  const einstellungen = kurs.einstellungen ?? standardEinstellungen(
    kurs.halbjahre?.[0]?.start ?? ''
  );

  const details = document.createElement('details');
  details.className = 'karte';
  const zusammenfassung = element('summary', 'Kurseinstellungen');
  details.append(zusammenfassung);

  const form = document.createElement('form');
  form.id = 'kurs-einstellungen-form';
  form.dataset.kursId = kurs.id;
  form.className = 'formular';

  for (let i = 0; i < 2; i++) {
    const nummer = i + 1;
    const input = eingabe(
      `klausuren${nummer}`,
      'number',
      einstellungen.klausurenJeHalbjahr?.[i] ?? 2,
      0,
      30
    );
    input.step = '1';
    form.append(feldLabel(`Klausuren im ${nummer}. Halbjahr`, input));
  }

  const sonstige = eingabe(
    'gewichtSonstige', 'number', einstellungen.gewichtung?.sonstige ?? 40, 0, 100
  );
  sonstige.step = '1';
  const schriftlich = eingabe(
    'gewichtSchriftlich', 'number', einstellungen.gewichtung?.schriftlich ?? 60, 0, 100
  );
  schriftlich.step = '1';

  const gewichtungsbereich = element('fieldset', undefined, 'gewichtung');
  gewichtungsbereich.append(element('legend', 'Gewichtung der Zeugnisnote'));
  gewichtungsbereich.append(feldLabel('Sonstige Leistungen (%)', sonstige));
  gewichtungsbereich.append(feldLabel('Schriftliche Leistungen / Klausuren (%)', schriftlich));
  form.append(gewichtungsbereich);

  const halbjahre = kurs.halbjahre ?? [];
  const grenzbereich = element('fieldset', undefined, 'halbjahresgrenzen');
  grenzbereich.append(element('legend', 'Halbjahresgrenzen für diesen Kurs'));

  for (let i = 0; i < 2; i++) {
    const halbjahr = halbjahre[i] ?? { start: '', ende: '' };
    const start = eingabe(`h${i + 1}start`, 'date', halbjahr.start);
    const ende = eingabe(`h${i + 1}ende`, 'date', halbjahr.ende);
    grenzbereich.append(
      element('h4', `Halbjahr ${i + 1}`),
      feldLabel('Beginn', start),
      feldLabel('Ende', ende)
    );
  }
  form.append(grenzbereich);

  const tageBereich = element('fieldset', undefined, 'unterrichtstage');
  tageBereich.append(element('legend', 'Unterrichtstage mit Gültigkeitsdatum'));
  tageBereich.append(element(
    'p',
    'Jeder Eintrag gilt ab dem angegebenen Datum bis zum nächsten Eintrag.'
  ));

  const zeiten = element('div', undefined, 'unterrichtszeiten');
  for (const zeitraum of einstellungen.unterrichtstage ?? []) {
    zeiten.append(erstelleUnterrichtszeit(zeitraum));
  }
  tageBereich.append(zeiten);

  const neu = element('button', 'Änderung ab Datum hinzufügen', 'btn btn--sekundaer');
  neu.type = 'button';
  neu.dataset.aktion = 'unterrichtszeit-hinzufuegen';
  tageBereich.append(neu);
  form.append(tageBereich);

  const speichernKnopf = element('button', 'Einstellungen speichern', 'btn');
  speichernKnopf.type = 'submit';
  form.append(speichernKnopf);

  details.append(form);
  return details;
}

function erstelleUnterrichtszeit(zeitraum = {}) {
  const zeile = element('div', undefined, 'unterrichtszeit');
  zeile.append(feldLabel(
    'Gültig ab',
    eingabe('abDatum', 'date', zeitraum.abDatum ?? '')
  ));

  const tage = element('div', undefined, 'wochentage');
  for (const tag of WOCHENTAGE) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'wochentag';
    checkbox.value = tag.wert;
    checkbox.checked = (zeitraum.wochentage ?? []).includes(tag.wert);

    const label = element('label', tag.name);
    label.prepend(checkbox);
    tage.append(label);
  }

  zeile.append(tage);

  const entfernen = element('button', 'Eintrag entfernen', 'btn btn--gefahr');
  entfernen.type = 'button';
  entfernen.dataset.aktion = 'unterrichtszeit-entfernen';
  zeile.append(entfernen);
  return zeile;
}

function handleGewichtung(event) {
  const form = event.target.closest('#kurs-einstellungen-form');
  if (!form) return;

  if (event.target.name === 'gewichtSonstige') {
    const rest = ergaenzeGewichtung(event.target.value);
    if (rest !== null) form.elements.gewichtSchriftlich.value = rest;
  } else if (event.target.name === 'gewichtSchriftlich') {
    const rest = ergaenzeGewichtung(event.target.value);
    if (rest !== null) form.elements.gewichtSonstige.value = rest;
  }
}

function handleDetailKlick(event) {
  const tab = event.target.closest('button[data-kurs-tab]');
  if (tab) {
    const ziel = tab.dataset.kursTab;
    $('kurs-detail').querySelectorAll('[data-kurs-tab]').forEach((knopf) => {
      knopf.setAttribute('aria-pressed', String(knopf === tab));
    });
    $('kurs-detail').querySelectorAll('[data-kurs-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.kursPanel !== ziel;
    });
    return;
  }

  const aktion = event.target.closest('button[data-aktion]')?.dataset.aktion;
  if (aktion === 'unterrichtszeit-hinzufuegen') {
    const container = $('kurs-detail').querySelector('.unterrichtszeiten');
    container.append(erstelleUnterrichtszeit());
  } else if (aktion === 'unterrichtszeit-entfernen') {
    event.target.closest('.unterrichtszeit')?.remove();
  }
}

async function speichereEinstellungen(event) {
  if (event.target.id !== 'kurs-einstellungen-form') return;
  event.preventDefault();

  const form = event.target;
  const kursId = Number(form.dataset.kursId);
  const kurse = await alleLaden(STORES.KURSE);
  const kurs = kurse.find((eintrag) => eintrag.id === kursId);
  if (!kurs) return status('Kurs wurde nicht gefunden.', true);

  const sonstige = Number(form.elements.gewichtSonstige.value);
  const schriftlich = Number(form.elements.gewichtSchriftlich.value);

  if (!istGueltigeGewichtung(sonstige, schriftlich)) {
    return status('Die Gewichtungen müssen zusammen genau 100 % ergeben.', true);
  }

  const halbjahre = [1, 2].map((nummer) => ({
    start: form.elements[`h${nummer}start`].value,
    ende: form.elements[`h${nummer}ende`].value
  }));

  if (halbjahre.some((h) => !h.start || !h.ende || h.start > h.ende)
      || halbjahre[0].ende >= halbjahre[1].start) {
    return status('Bitte gültige Halbjahresgrenzen ohne Überschneidung eingeben.', true);
  }

  const unterrichtstage = [];
  for (const zeile of form.querySelectorAll('.unterrichtszeit')) {
    const abDatum = zeile.querySelector('input[name="abDatum"]').value;
    const wochentage = [...zeile.querySelectorAll('input[name="wochentag"]:checked')]
      .map((checkbox) => Number(checkbox.value));

    if (!abDatum || wochentage.length === 0) {
      return status('Für jeden Unterrichtstageintrag Datum und mindestens einen Wochentag angeben.', true);
    }
    unterrichtstage.push({ abDatum, wochentage });
  }

  unterrichtstage.sort((a, b) => a.abDatum.localeCompare(b.abDatum));
  if (new Set(unterrichtstage.map((eintrag) => eintrag.abDatum)).size
      !== unterrichtstage.length) {
    return status('Jedes Änderungsdatum darf nur einmal vorkommen.', true);
  }

  try {
    kurs.halbjahre = halbjahre;
    kurs.einstellungen = {
      klausurenJeHalbjahr: [
        Number(form.elements.klausuren1.value),
        Number(form.elements.klausuren2.value)
      ],
      gewichtung: { sonstige, schriftlich },
      unterrichtstage
    };

    if (kurs.einstellungen.klausurenJeHalbjahr.some((n) =>
      !Number.isInteger(n) || n < 0 || n > 30)) {
      return status('Die Klausuranzahl muss eine ganze Zahl zwischen 0 und 30 sein.', true);
    }

    await speichern(STORES.KURSE, kurs);
    status('Kurseinstellungen wurden gespeichert.');
    await ladeKursauswahl();
  } catch (fehler) {
    status(`Speichern fehlgeschlagen: ${fehler.message}`, true);
  }
}
