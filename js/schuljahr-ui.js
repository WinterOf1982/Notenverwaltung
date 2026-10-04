import { STORES, alleLaden, speichern } from './db.js';
import { schuljahrAnlegen } from './logic/schuljahr.js';

const bundeslaender = [
  ['DE-BW', 'Baden-Württemberg'], ['DE-BY', 'Bayern'],
  ['DE-BE', 'Berlin'], ['DE-BB', 'Brandenburg'],
  ['DE-HB', 'Bremen'], ['DE-HH', 'Hamburg'],
  ['DE-HE', 'Hessen'], ['DE-MV', 'Mecklenburg-Vorpommern'],
  ['DE-NI', 'Niedersachsen'], ['DE-NW', 'Nordrhein-Westfalen'],
  ['DE-RP', 'Rheinland-Pfalz'], ['DE-SL', 'Saarland'],
  ['DE-SN', 'Sachsen'], ['DE-ST', 'Sachsen-Anhalt'],
  ['DE-SH', 'Schleswig-Holstein'], ['DE-TH', 'Thüringen']
];

const $ = (id) => document.getElementById(id);

function element(tag, text, klasse) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (klasse) el.className = klasse;
  return el;
}

function datumFeld(label, wert, name) {
  const umschlag = element('label', label);
  const input = document.createElement('input');
  input.type = 'date';
  input.name = name;
  input.value = wert;
  input.required = true;
  umschlag.append(input);
  return umschlag;
}

function selectBundesland() {
  const select = document.createElement('select');
  select.name = 'bundeslandCode';
  select.required = true;

  for (const [code, name] of bundeslaender) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    if (code === 'DE-HB') option.selected = true;
    select.append(option);
  }

  return select;
}

function meldung(text, fehler = false) {
  const status = $('schuljahr-meldung');
  status.textContent = text;
  status.classList.toggle('meldung--fehler', fehler);
  status.hidden = !text;
}

export async function initialisiereSchuljahre() {
  $('schuljahr-form').addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    const formular = ereignis.currentTarget;
    const daten = new FormData(formular);
    const code = String(daten.get('bundeslandCode'));
    const name = bundeslaender.find(([c]) => c === code)?.[1];

    try {
      meldung('Ferien werden geladen und Schuljahr berechnet …');
      const jahr = await schuljahrAnlegen({
        bundeslandCode: code,
        bundeslandName: name,
        ersterSchultag: String(daten.get('ersterSchultag'))
      });
      formular.reset();

      if (jahr.apiHinweis) {
        meldung(jahr.apiHinweis, true);
      } else {
        meldung(`Schuljahr ${jahr.name} wurde angelegt.`);
      }

      await aktualisiereAnsicht();
    } catch (fehler) {
      meldung(fehler.message, true);
    }
  });

  $('kurs-form').addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    const daten = new FormData(ereignis.currentTarget);
    const schuljahrId = Number(daten.get('schuljahrId'));
    const schuljahre = await alleLaden(STORES.SCHULJAHRE);
    const jahr = schuljahre.find((eintrag) => eintrag.id === schuljahrId);
    if (!jahr) return meldung('Bitte ein Schuljahr auswählen.', true);

    const kurs = {
      schuljahrId,
      name: String(daten.get('kursname')).trim(),
      halbjahre: structuredClone(jahr.halbjahre)
    };

    if (!kurs.name) return meldung('Bitte einen Kursnamen eingeben.', true);

    try {
      kurs.id = await speichern(STORES.KURSE, kurs);
      ereignis.currentTarget.reset();
      meldung(`Kurs „${kurs.name}“ wurde angelegt.`);
      await aktualisiereAnsicht();
    } catch (fehler) {
      meldung(`Kurs konnte nicht gespeichert werden: ${fehler.message}`, true);
    }
  });

  $('kursliste').addEventListener('submit', async (ereignis) => {
    if (!ereignis.target.matches('form[data-kurs-id]')) return;
    ereignis.preventDefault();

    const formular = ereignis.target;
    const kurs = (await alleLaden(STORES.KURSE))
      .find((eintrag) => eintrag.id === Number(formular.dataset.kursId));
    if (!kurs) return;

    kurs.halbjahre = [1, 2].map((nummer) => ({
      start: formular.elements[`h${nummer}start`].value,
      ende: formular.elements[`h${nummer}ende`].value
    }));

    if (kurs.halbjahre.some((halbjahr) => !halbjahr.start || !halbjahr.ende)) {
      return meldung('Bitte alle vier Halbjahresdaten ausfüllen.', true);
    }

    try {
      await speichern(STORES.KURSE, kurs);
      meldung(`Halbjahresgrenzen für „${kurs.name}“ gespeichert.`);
      await aktualisiereAnsicht();
    } catch (fehler) {
      meldung(`Änderung konnte nicht gespeichert werden: ${fehler.message}`, true);
    }
  });

  await aktualisiereAnsicht();
}

async function aktualisiereAnsicht() {
  const schuljahre = await alleLaden(STORES.SCHULJAHRE);
  const kurse = await alleLaden(STORES.KURSE);
  const formular = $('kurs-form');
  const auswahl = formular.elements.schuljahrId;

  auswahl.replaceChildren();
  for (const jahr of schuljahre) {
    const option = document.createElement('option');
    option.value = jahr.id;
    option.textContent = `${jahr.name} – ${jahr.bundeslandName}`;
    auswahl.append(option);
  }

  $('kurs-bereich').hidden = schuljahre.length === 0;
  $('schuljahr-hinweis').hidden = schuljahre.length !== 0;

  const liste = $('schuljahr-liste');
  liste.replaceChildren();

  for (const jahr of schuljahre) {
    const karte = element('article', undefined, 'karte');
    karte.append(element('h3', `${jahr.name} – ${jahr.bundeslandName}`));
    karte.append(element(
      'p',
      `Erster Schultag: ${jahr.ersterSchultag} · Ferienquelle: ${jahr.ferienQuelle}`
    ));

    jahr.halbjahre.forEach((halbjahr, index) => {
      karte.append(element(
        'p',
        `Halbjahr ${index + 1}: ${halbjahr.start} bis ${halbjahr.ende}`
      ));
    });

    if (jahr.apiHinweis) {
      karte.append(element('p', jahr.apiHinweis, 'hinweis hinweis--warnung'));
    }
    liste.append(karte);
  }

  const kursliste = $('kursliste');
  kursliste.replaceChildren();

  for (const kurs of kurse) {
    const jahr = schuljahre.find((eintrag) => eintrag.id === kurs.schuljahrId);
    const formularKurs = document.createElement('form');
    formularKurs.dataset.kursId = kurs.id;
    formularKurs.className = 'karte kurskarte';

    formularKurs.append(element(
      'h3',
      `${kurs.name}${jahr ? ` – ${jahr.name}` : ''}`
    ));

    kurs.halbjahre.forEach((halbjahr, index) => {
      const nummer = index + 1;
      formularKurs.append(element('h4', `Halbjahr ${nummer}`));
      formularKurs.append(datumFeld(
        'Beginn',
        halbjahr.start,
        `h${nummer}start`
      ));
      formularKurs.append(datumFeld(
        'Ende',
        halbjahr.ende,
        `h${nummer}ende`
      ));
    });

    const speichernKnopf = element('button', 'Grenzen speichern', 'btn');
    speichernKnopf.type = 'submit';
    formularKurs.append(speichernKnopf);
    kursliste.append(formularKurs);
  }
}
