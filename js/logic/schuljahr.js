import { STORES, speichern } from '../db.js';

const API = 'https://openholidaysapi.org/SchoolHolidays';
const MAX_TAGE = 800;
const MAX_WOCHEN = 160;

function utcDatum(text) {
  const [jahr, monat, tag] = text.split('-').map(Number);
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

function isoDatum(datum) {
  return datum.toISOString().slice(0, 10);
}

function plusTage(datum, anzahl) {
  const ergebnis = new Date(datum);
  ergebnis.setUTCDate(ergebnis.getUTCDate() + anzahl);
  return ergebnis;
}

function montagDerWoche(datum) {
  const ergebnis = new Date(datum);
  const wochentag = (ergebnis.getUTCDay() + 6) % 7;
  ergebnis.setUTCDate(ergebnis.getUTCDate() - wochentag);
  return ergebnis;
}

async function ladeFerien(bundeslandCode, von, bis) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    countryIsoCode: 'DE',
    subdivisionCode: bundeslandCode,
    languageIsoCode: 'DE',
    validFrom: von,
    validTo: bis
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const antwort = await fetch(url, {
      headers: { Accept: 'text/json' },
      signal: controller.signal
    });

    if (!antwort.ok) {
      throw new Error(`OpenHolidays API antwortete mit HTTP ${antwort.status}.`);
    }

    const daten = await antwort.json();
    if (!Array.isArray(daten)) {
      throw new Error('Die Ferienantwort hatte ein unerwartetes Format.');
    }

    return daten.map((ferien) => {
      if (!ferien.startDate || !ferien.endDate) {
        throw new Error('Ein Ferienzeitraum enthält kein gültiges Datum.');
      }
      return {
        start: ferien.startDate,
        ende: ferien.endDate,
        name: ferien.name?.find((eintrag) => eintrag.language === 'DE')?.text
          ?? 'Schulferien'
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Zählt eine Kalenderwoche, wenn mehr als die Hälfte ihrer relevanten
 * Wochentage keine Ferien sind. Wochenenden werden nicht berücksichtigt.
 */
export function berechneHalbjahre(ersterSchultag, ferien) {
  const start = utcDatum(ersterSchultag);
  const ferientage = new Set();

  for (const zeitraum of ferien) {
    let tag = utcDatum(zeitraum.start);
    const ende = utcDatum(zeitraum.ende);

    while (tag <= ende) {
      ferientage.add(isoDatum(tag));
      tag = plusTage(tag, 1);
    }
  }

  let montag = montagDerWoche(start);
  let gezaehlteWochen = 0;
  let endeErstesHalbjahr = null;
  let endeZweitesHalbjahr = null;

  for (let woche = 0; woche < MAX_WOCHEN && gezaehlteWochen < 40; woche++) {
    let relevanteTage = 0;
    let ferientageInWoche = 0;

    for (let i = 0; i < 5; i++) {
      const tag = plusTage(montag, i);
      if (tag < start) continue;

      relevanteTage++;
      if (ferientage.has(isoDatum(tag))) ferientageInWoche++;
    }

    if (relevanteTage > 0 && ferientageInWoche < relevanteTage / 2) {
      gezaehlteWochen++;

      // Halbjahresende: Sonntag der 20. bzw. 40. gezählten Kalenderwoche.
      const sonntag = plusTage(montag, 6);
      if (gezaehlteWochen === 20) endeErstesHalbjahr = isoDatum(sonntag);
      if (gezaehlteWochen === 40) endeZweitesHalbjahr = isoDatum(sonntag);
    }

    montag = plusTage(montag, 7);
  }

  if (!endeErstesHalbjahr || !endeZweitesHalbjahr) {
    throw new Error('Es konnten nicht zwei Halbjahre mit je 20 Schulwochen berechnet werden.');
  }

  return [
    { start: ersterSchultag, ende: endeErstesHalbjahr },
    {
      start: isoDatum(plusTage(utcDatum(endeErstesHalbjahr), 1)),
      ende: endeZweitesHalbjahr
    }
  ];
}

export async function schuljahrAnlegen({
  bundeslandCode,
  bundeslandName,
  ersterSchultag
}) {
  if (!bundeslandCode || !bundeslandName || !ersterSchultag) {
    throw new Error('Bitte Bundesland und ersten Schultag angeben.');
  }

  const start = utcDatum(ersterSchultag);
  const bis = isoDatum(plusTage(start, MAX_TAGE));
  let ferien = [];
  let apiFehler = null;

  try {
    ferien = await ladeFerien(
      bundeslandCode,
      ersterSchultag,
      bis
    );
  } catch (fehler) {
    apiFehler = fehler;
  }

  const halbjahre = berechneHalbjahre(ersterSchultag, ferien);
  const jahr = start.getUTCFullYear();

  const schuljahr = {
    name: `${jahr}/${jahr + 1}`,
    bundeslandCode,
    bundeslandName,
    ersterSchultag,
    halbjahre,
    ferien,
    ferienQuelle: apiFehler ? 'ohne Ferien (API nicht erreichbar)' : 'OpenHolidays API',
    apiHinweis: apiFehler
      ? 'Ferien konnten nicht geladen werden. Das Schuljahr wurde ohne Ferien berechnet. Bitte Halbjahresgrenzen prüfen.'
      : null,
    erstelltAm: new Date().toISOString()
  };

  schuljahr.id = await speichern(STORES.SCHULJAHRE, schuljahr);
  return schuljahr;
}
