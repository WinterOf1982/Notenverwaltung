import { STORES, alleLaden, speichern, loeschen } from './db.js';
import { parseSchuelerliste, namensSchluessel } from './logic/schueler.js';

const $ = (id) => document.getElementById(id);
let vorschau = [];
let fotoVorschauURLs = [];

function status(text, fehler = false) {
  const el = $('klassen-meldung');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('meldung--fehler', fehler);
}

function feld(formular, name) {
  return formular.elements.namedItem(name);
}

function neuesElement(tag, text, klasse) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (klasse) el.className = klasse;
  return el;
}

function baueFormularfeld(formular, beschriftung, name, typ = 'text') {
  const label = document.createElement('label');
  label.append(document.createTextNode(beschriftung));
  const input = document.createElement('input');
  input.name = name;
  input.type = typ;
  if (typ === 'email') input.autocomplete = 'email';
  if (typ === 'tel') input.autocomplete = 'tel';
  label.append(input);
  formular.append(label);
  return input;
}

export async function initialisiereKlassenUndSchueler() {
  $('klasse-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = feld(event.currentTarget, 'klassenname').value.trim();
    if (!name) return status('Bitte einen Klassennamen eingeben.', true);

    try {
      await speichern(STORES.KLASSEN, { name, erstelltAm: new Date().toISOString() });
      event.currentTarget.reset();
      status(`Klasse „${name}“ wurde angelegt.`);
      await aktualisiereKlassen();
    } catch (error) {
      status(`Klasse konnte nicht gespeichert werden: ${error.message}`, true);
    }
  });

  $('klassen-auswahl').addEventListener('change', zeigeKlasse);
  $('schueler-form').addEventListener('submit', speichereSchueler);
  $('paste-form').addEventListener('submit', zeigeImportvorschau);
  $('import-vorschau').addEventListener('click', tauscheOderImportiere);
  $('schuelerliste').addEventListener('click', bearbeiteOderLoesche);

  await aktualisiereKlassen();
}

async function aktualisiereKlassen() {
  const klassen = await alleLaden(STORES.KLASSEN);
  const auswahl = $('klassen-auswahl');
  const vorher = auswahl.value;
  auswahl.replaceChildren();

  for (const klasse of klassen) {
    const option = document.createElement('option');
    option.value = klasse.id;
    option.textContent = klasse.name;
    auswahl.append(option);
  }

  if (klassen.some((klasse) => String(klasse.id) === vorher)) {
    auswahl.value = vorher;
  }

  const hatKlassen = klassen.length > 0;
  $('klassen-inhalt').hidden = !hatKlassen;
  $('keine-klassen').hidden = hatKlassen;
  await zeigeKlasse();
}

async function zeigeKlasse() {
  const klasseId = Number($('klassen-auswahl').value);
  if (!klasseId) return;

  const klassen = await alleLaden(STORES.KLASSEN);
  const klasse = klassen.find((eintrag) => eintrag.id === klasseId);
  $('aktuelle-klasse').textContent = klasse ? `Schüler:innen in ${klasse.name}` : '';

  fotoVorschauURLs.forEach(URL.revokeObjectURL);
  fotoVorschauURLs = [];

  const liste = $('schuelerliste');
  liste.replaceChildren();
  const schueler = (await alleLaden(STORES.SCHUELER))
    .filter((person) => person.klasseId === klasseId)
    .sort((a, b) => a.nachname.localeCompare(b.nachname, 'de')
      || a.vorname.localeCompare(b.vorname, 'de'));

  if (!schueler.length) {
    liste.append(neuesElement('p', 'In dieser Klasse sind noch keine Schüler:innen angelegt.'));
  }

  for (const person of schueler) {
    const karte = neuesElement('article', undefined, 'karte personenkarte');
    const titel = neuesElement('h4', `${person.nachname}, ${person.vorname}`);
    karte.append(titel);

    if (person.foto instanceof Blob) {
      const bild = document.createElement('img');
      bild.className = 'personenfoto';
      bild.alt = `Foto von ${person.vorname} ${person.nachname}`;
      bild.src = URL.createObjectURL(person.foto);
      fotoVorschauURLs.push(bild.src);
      karte.append(bild);
    }

    const details = [
      ['Telefon', person.telefon],
      ['E-Mail', person.email],
      ['Ausbildungsbetrieb', person.betrieb],
      ['Ausbilder/in', person.ausbilder],
      ['Telefon Ausbilder/in', person.ausbilderTelefon],
      ['E-Mail Ausbilder/in', person.ausbilderEmail]
    ].filter(([, wert]) => wert);

    for (const [label, wert] of details) {
      karte.append(neuesElement('p', `${label}: ${wert}`));
    }

    const bearbeiten = neuesElement('button', 'Bearbeiten', 'btn btn--sekundaer');
    bearbeiten.type = 'button';
    bearbeiten.dataset.aktion = 'bearbeiten';
    bearbeiten.dataset.id = person.id;
    const entfernen = neuesElement('button', 'Löschen', 'btn btn--gefahr');
    entfernen.type = 'button';
    entfernen.dataset.aktion = 'loeschen';
    entfernen.dataset.id = person.id;
    karte.append(bearbeiten, entfernen);
    liste.append(karte);
  }
}

async function speichereSchueler(event) {
  event.preventDefault();
  const formular = event.currentTarget;
  const idText = feld(formular, 'id').value;
  const klasseId = Number($('klassen-auswahl').value);
  const vorname = feld(formular, 'vorname').value.trim();
  const nachname = feld(formular, 'nachname').value.trim();
  if (!klasseId || !vorname || !nachname) {
    return status('Bitte Vorname und Nachname eingeben und eine Klasse auswählen.', true);
  }

  const alle = await alleLaden(STORES.SCHUELER);
  const id = idText ? Number(idText) : null;
  const doppelt = alle.some((person) =>
    person.klasseId === klasseId && person.id !== id
    && namensSchluessel(person.vorname, person.nachname)
      === namensSchluessel(vorname, nachname));

  if (doppelt) return status('Diese Person ist in der Klasse bereits vorhanden.', true);

  const bisher = id ? alle.find((person) => person.id === id) : null;
  const fotoDatei = feld(formular, 'foto').files[0];
  if (fotoDatei && (!fotoDatei.type.startsWith('image/') || fotoDatei.size > 5_000_000)) {
    return status('Bitte ein Bild bis maximal 5 MB auswählen.', true);
  }

  const person = {
    ...(bisher || {}),
    ...(id ? { id } : {}),
    klasseId,
    vorname,
    nachname,
    telefon: feld(formular, 'telefon').value.trim(),
    email: feld(formular, 'email').value.trim(),
    betrieb: feld(formular, 'betrieb').value.trim(),
    ausbilder: feld(formular, 'ausbilder').value.trim(),
    ausbilderTelefon: feld(formular, 'ausbilderTelefon').value.trim(),
    ausbilderEmail: feld(formular, 'ausbilderEmail').value.trim(),
    foto: fotoDatei || bisher?.foto || null
  };

  try {
    await speichern(STORES.SCHUELER, person);
    formular.reset();
    feld(formular, 'id').value = '';
    $('schueler-speichern').textContent = 'Schüler:in hinzufügen';
    status(id ? 'Änderungen gespeichert.' : 'Schüler:in wurde hinzugefügt.');
    await zeigeKlasse();
  } catch (error) {
    status(`Speichern fehlgeschlagen: ${error.message}`, true);
  }
}

function zeigeImportvorschau(event) {
  event.preventDefault();
  const text = feld(event.currentTarget, 'excel-text').value;
  vorschau = parseSchuelerliste(text).map((person) => ({ ...person }));
  zeichneVorschau();
  status(vorschau.length
    ? `${vorschau.length} Namenszeilen erkannt. Bitte vor dem Import prüfen.`
    : 'Keine vollständigen Namen erkannt.', !vorschau.length);
}

function zeichneVorschau() {
  const bereich = $('import-vorschau');
  bereich.replaceChildren();
  if (!vorschau.length) return;

  vorschau.forEach((person, index) => {
    const zeile = neuesElement('div', undefined, 'import-zeile');
    const vorname = document.createElement('input');
    vorname.setAttribute('aria-label', `Zeile ${index + 1}: Vorname`);
    vorname.value = person.vorname;
    vorname.dataset.feld = 'vorname';
    vorname.dataset.index = index;

    const nachname = document.createElement('input');
    nachname.setAttribute('aria-label', `Zeile ${index + 1}: Nachname`);
    nachname.value = person.nachname;
    nachname.dataset.feld = 'nachname';
    nachname.dataset.index = index;

    const tauschen = neuesElement('button', 'Tauschen', 'btn btn--sekundaer');
    tauschen.type = 'button';
    tauschen.dataset.aktion = 'tauschen';
    tauschen.dataset.index = index;

    zeile.append(vorname, nachname, tauschen);
    bereich.append(zeile);
  });

  const importieren = neuesElement('button', 'Namen übernehmen', 'btn');
  importieren.type = 'button';
  importieren.dataset.aktion = 'importieren';
  bereich.append(importieren);
}

async function tauscheOderImportiere(event) {
  const knopf = event.target.closest('button[data-aktion]');
  if (!knopf) return;

  if (knopf.dataset.aktion === 'tauschen') {
    const index = Number(knopf.dataset.index);
    [vorschau[index].vorname, vorschau[index].nachname] =
      [vorschau[index].nachname, vorschau[index].vorname];
    zeichneVorschau();
    return;
  }

  if (knopf.dataset.aktion !== 'importieren') return;

  // Manuelle Korrekturen in der Vorschau übernehmen.
  $('import-vorschau').querySelectorAll('input[data-index]').forEach((input) => {
    vorschau[Number(input.dataset.index)][input.dataset.feld] = input.value.trim();
  });

  const klasseId = Number($('klassen-auswahl').value);
  if (!klasseId) return status('Bitte zuerst eine Klasse auswählen.', true);

  const vorhanden = (await alleLaden(STORES.SCHUELER))
    .filter((person) => person.klasseId === klasseId);
  const schluessel = new Set(vorhanden.map((person) =>
    namensSchluessel(person.vorname, person.nachname)));

  let hinzugefuegt = 0;
  let uebersprungen = 0;

  for (const person of vorschau) {
    const vorname = person.vorname.trim();
    const nachname = person.nachname.trim();
    if (!vorname || !nachname) {
      uebersprungen++;
      continue;
    }

    const key = namensSchluessel(vorname, nachname);
    if (schluessel.has(key)) {
      uebersprungen++;
      continue;
    }

    await speichern(STORES.SCHUELER, { klasseId, vorname, nachname });
    schluessel.add(key);
    hinzugefuegt++;
  }

  vorschau = [];
  $('import-vorschau').replaceChildren();
  feld($('paste-form'), 'excel-text').value = '';
  status(`${hinzugefuegt} übernommen, ${uebersprungen} doppelte oder unvollständige Zeilen übersprungen.`);
  await zeigeKlasse();
}

async function bearbeiteOderLoesche(event) {
  const knopf = event.target.closest('button[data-aktion]');
  if (!knopf) return;

  const id = Number(knopf.dataset.id);
  const personen = await alleLaden(STORES.SCHUELER);
  const person = personen.find((eintrag) => eintrag.id === id);
  if (!person) return;

  if (knopf.dataset.aktion === 'loeschen') {
    if (!confirm(`„${person.vorname} ${person.nachname}“ wirklich löschen?`)) return;
    await loeschen(STORES.SCHUELER, id);
    status('Schüler:in wurde gelöscht.');
    await zeigeKlasse();
    return;
  }

  if (knopf.dataset.aktion === 'bearbeiten') {
    const formular = $('schueler-form');
    for (const name of [
      'id', 'vorname', 'nachname', 'telefon', 'email',
      'betrieb', 'ausbilder', 'ausbilderTelefon', 'ausbilderEmail'
    ]) {
      feld(formular, name).value = person[name] ?? '';
    }
    $('schueler-speichern').textContent = 'Änderungen speichern';
    formular.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}