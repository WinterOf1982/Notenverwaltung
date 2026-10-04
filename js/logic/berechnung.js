/**
 * Reine Berechnungslogik – keine Abhängigkeit von DOM oder Datenbank.
 */

/** Rundet kaufmännisch auf eine Anzahl Nachkommastellen. */
export function runde(wert, stellen = 1) {
  const faktor = 10 ** stellen;
  return Math.round((wert + Number.EPSILON) * faktor) / faktor;
}

/** Prüft, ob eine Zahl eine gültige Note (1 bis 6) ist. */
export function istGueltigeNote(note) {
  return Number.isFinite(note) && note >= 1 && note <= 6;
}

/**
 * Gewichteter Mittelwert aus [{ wert, gewicht }].
 * Einträge ohne gültigen Wert oder mit Gewicht <= 0 werden ignoriert.
 * Gibt null zurück, wenn nichts zu berechnen ist.
 */
export function gewichteterMittelwert(eintraege) {
  let summe = 0;
  let gewichte = 0;
  for (const { wert, gewicht } of eintraege) {
    if (!Number.isFinite(wert) || !Number.isFinite(gewicht) || gewicht <= 0) continue;
    summe += wert * gewicht;
    gewichte += gewicht;
  }
  return gewichte === 0 ? null : summe / gewichte;
}

/** Formatiert eine Note deutsch, z. B. 2.25 -> "2,3". Ohne Wert: "–". */
export function formatiereNote(wert, stellen = 1) {
  if (!Number.isFinite(wert)) return '–';
  return runde(wert, stellen).toFixed(stellen).replace('.', ',');
}
