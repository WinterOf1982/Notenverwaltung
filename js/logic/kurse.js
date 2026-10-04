/** Reine Kurslogik ohne DOM oder Datenbank. */

export const WOCHENTAGE = [
  { wert: 1, name: 'Montag' },
  { wert: 2, name: 'Dienstag' },
  { wert: 3, name: 'Mittwoch' },
  { wert: 4, name: 'Donnerstag' },
  { wert: 5, name: 'Freitag' },
  { wert: 6, name: 'Samstag' },
  { wert: 7, name: 'Sonntag' }
];

export function standardEinstellungen(ersterSchultag) {
  return {
    klausurenJeHalbjahr: [2, 2],
    gewichtung: { sonstige: 40, schriftlich: 60 },
    unterrichtstage: [
      { abDatum: ersterSchultag, wochentage: [] }
    ]
  };
}

/** Gibt den jeweils ergänzenden Prozentwert zurück. */
export function ergaenzeGewichtung(wert) {
  const zahl = Number(wert);
  if (!Number.isInteger(zahl) || zahl < 0 || zahl > 100) return null;
  return 100 - zahl;
}

export function istGueltigeGewichtung(sonstige, schriftlich) {
  return Number.isInteger(sonstige)
    && Number.isInteger(schriftlich)
    && sonstige >= 0
    && schriftlich >= 0
    && sonstige + schriftlich === 100;
}

export function normalisiereFach(fach) {
  return String(fach ?? '').trim().toLocaleLowerCase('de-DE');
}
