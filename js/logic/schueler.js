/**
 * Parser und Hilfsfunktionen ohne DOM- oder Datenbank-Abhängigkeit.
 * Bei zwei Spalten ohne Kopfzeile gilt zunächst: Vorname, Nachname.
 * Die Vorschau erlaubt das Tauschen, da sich die Reihenfolge aus Namen
 * allein nicht sicher erkennen lässt.
 */
function sauber(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

function kopfwort(text) {
  return sauber(text).toLocaleLowerCase('de-DE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

function istNummer(text) {
  return /^\d+$/.test(sauber(text));
}

function zeileInSpalten(zeile) {
  const spalten = zeile.includes('\t') ? zeile.split('\t')
    : zeile.includes('|') ? zeile.split('|') : [zeile];
  return spalten.map(sauber);
}

function istKopfzeile(spalten) {
  const worte = spalten.map(kopfwort);
  const hatVorname = worte.some((w) =>
    ['vorname', 'firstname', 'givenname'].includes(w));
  const hatNachname = worte.some((w) =>
    ['nachname', 'surname', 'lastname', 'familienname'].includes(w));
  const hatName = worte.includes('name');
  return (hatVorname && (hatNachname || hatName))
    || (hatVorname && spalten.length === 1);
}

function leseVollnamen(text) {
  const wert = sauber(text);
  if (!wert) return null;

  // „Müller, Max“ kennzeichnet die Reihenfolge eindeutig.
  if (wert.includes(',')) {
    const teile = wert.split(',').map(sauber).filter(Boolean);
    if (teile.length >= 2) {
      return { vorname: teile.slice(1).join(' '), nachname: teile[0] };
    }
  }

  const teile = wert.split(/\s+/).filter(Boolean);
  if (teile.length < 2) return null;

  // Ohne Komma: übliche Schreibweise „Max Müller“.
  return { vorname: teile[0], nachname: teile.slice(1).join(' ') };
}

/**
 * Rückgabe: Array { vorname, nachname }.
 * Kopfzeilen, Nummernfelder und leere Zeilen werden übersprungen.
 */
export function parseSchuelerliste(text) {
  const zeilen = String(text ?? '').split(/\r?\n/).map(zeileInSpalten)
    .filter((spalten) => spalten.some(Boolean));

  let kopf = null;
  const ergebnis = [];

  for (const spalten of zeilen) {
    if (istKopfzeile(spalten)) {
      kopf = spalten.map(kopfwort);
      continue;
    }

    if (kopf) {
      const vorIndex = kopf.findIndex((w) =>
        ['vorname', 'firstname', 'givenname'].includes(w));
      const nachIndex = kopf.findIndex((w) =>
        ['nachname', 'surname', 'lastname', 'familienname', 'name'].includes(w));

      if (vorIndex >= 0 && nachIndex >= 0) {
        const vorname = sauber(spalten[vorIndex]);
        const nachname = sauber(spalten[nachIndex]);
        if (vorname && nachname && !istNummer(vorname) && !istNummer(nachname)) {
          ergebnis.push({ vorname, nachname });
        }
        continue;
      }
    }

    const nichtNumerisch = spalten.filter((wert) => wert && !istNummer(wert));
    if (nichtNumerisch.length === 0) continue;

    if (nichtNumerisch.length === 1) {
      const name = leseVollnamen(nichtNumerisch[0]);
      if (name) ergebnis.push(name);
      continue;
    }

    // Bei Kopfzeilen-losen Spalten kann die Reihenfolge unklar sein.
    ergebnis.push({
      vorname: nichtNumerisch[0],
      nachname: nichtNumerisch[1]
    });
  }

  return ergebnis;
}

export function namensSchluessel(vorname, nachname) {
  return `${sauber(vorname).toLocaleLowerCase('de-DE')}|`
    + `${sauber(nachname).toLocaleLowerCase('de-DE')}`;
}