/**
 * Datenhaltung: IndexedDB, ausschließlich lokal auf dem Gerät.
 * Schema-Änderungen: DB_VERSION erhöhen und in onupgradeneeded ergänzen.
 */

export const DB_NAME = 'notenverwaltung';
export const DB_VERSION = 3;

export const STORES = {
  KLASSEN: 'klassen',
  SCHUELER: 'schueler',
  LEISTUNGEN: 'leistungen',
  EINSTELLUNGEN: 'einstellungen',
  SCHULJAHRE: 'schuljahre',
  KURSE: 'kurse'
};
const ALLE_STORES = Object.values(STORES);

let dbPromise = null;

export function oeffneDatenbank() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB wird von diesem Browser nicht unterstützt.'));
      return;
    }
    const anfrage = indexedDB.open(DB_NAME, DB_VERSION);

    anfrage.onupgradeneeded = (ereignis) => {
      const db = anfrage.result;
      if (ereignis.oldVersion < 1) {
        db.createObjectStore(STORES.KLASSEN, { keyPath: 'id', autoIncrement: true });

        const schueler = db.createObjectStore(STORES.SCHUELER, { keyPath: 'id', autoIncrement: true });
        schueler.createIndex('klasseId', 'klasseId');

        const leistungen = db.createObjectStore(STORES.LEISTUNGEN, { keyPath: 'id', autoIncrement: true });
        leistungen.createIndex('schuelerId', 'schuelerId');

        db.createObjectStore(STORES.EINSTELLUNGEN, { keyPath: 'schluessel' });
      }
      
      // if (ereignis.oldVersion < 2) { … spätere Änderungen hier … }
    if (ereignis.oldVersion < 2) {
        db.createObjectStore(STORES.SCHULJAHRE, {
            keyPath: 'id',
            autoIncrement: true
  });

        const kurse = db.createObjectStore(STORES.KURSE, {
            keyPath: 'id',
            autoIncrement: true
  });

        kurse.createIndex('schuljahrId', 'schuljahrId');
}
      // if (ereignis.oldVersion < 3) { ... spätere Änderungen hier ... }
    if (ereignis.oldVersion < 3) {
  const kurse = anfrage.transaction.objectStore(STORES.KURSE);

  if (!kurse.indexNames.contains('klasseId')) {
    kurse.createIndex('klasseId', 'klasseId');
  }

  // Bereits vorhandene Kurs-Platzhalter aus dem vorigen Schritt behalten.
  const cursorAnfrage = kurse.openCursor();
  cursorAnfrage.onsuccess = () => {
    const cursor = cursorAnfrage.result;
    if (!cursor) return;

    const kurs = cursor.value;
    cursor.update({
      ...kurs,
      fach: kurs.fach ?? kurs.name ?? '',
      klasseId: kurs.klasseId ?? null,
      einstellungen: kurs.einstellungen ?? {
        klausurenJeHalbjahr: [2, 2],
        gewichtung: { sonstige: 40, schriftlich: 60 },
        unterrichtstage: []
      }
    });
    cursor.continue();
  };
}
    };

    anfrage.onsuccess = () => {
      const db = anfrage.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    anfrage.onerror = () => { dbPromise = null; reject(anfrage.error); };
    anfrage.onblocked = () => {
      dbPromise = null;
      reject(new Error('Datenbank blockiert – bitte andere Tabs der App schließen.'));
    };
  });

  return dbPromise;
}

/** Führt eine Transaktion aus; arbeit(tx) gibt einen IDBRequest zurück (oder nichts). */
function ausfuehren(storeNamen, modus, arbeit) {
  return oeffneDatenbank().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNamen, modus);
    let anfrage;
    try {
      anfrage = arbeit(tx);
    } catch (fehler) {
      tx.abort();
      reject(fehler);
      return;
    }
    tx.oncomplete = () => resolve(anfrage ? anfrage.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaktion abgebrochen.'));
  }));
}

/* ---------- Allgemeine Operationen ---------- */

/** Legt an oder aktualisiert. Gibt den Schlüssel (id) zurück. */
export function speichern(store, objekt) {
  return ausfuehren(store, 'readwrite', (tx) => tx.objectStore(store).put(objekt));
}
export function laden(store, schluessel) {
  return ausfuehren(store, 'readonly', (tx) => tx.objectStore(store).get(schluessel));
}
export function alleLaden(store) {
  return ausfuehren(store, 'readonly', (tx) => tx.objectStore(store).getAll());
}
export function loeschen(store, schluessel) {
  return ausfuehren(store, 'readwrite', (tx) => tx.objectStore(store).delete(schluessel));
}
export function zaehlen(store) {
  return ausfuehren(store, 'readonly', (tx) => tx.objectStore(store).count());
}

/* ---------- Einstellungen (Schlüssel/Wert) ---------- */

export function einstellungSpeichern(schluessel, wert) {
  return speichern(STORES.EINSTELLUNGEN, { schluessel, wert });
}
export async function einstellungLaden(schluessel, standard = null) {
  const eintrag = await laden(STORES.EINSTELLUNGEN, schluessel);
  return eintrag ? eintrag.wert : standard;
}

/* ---------- Backup / Löschen ---------- */

export async function exportiereAlles() {
  const db = await oeffneDatenbank();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALLE_STORES, 'readonly');
    const daten = {};
    for (const name of ALLE_STORES) {
      const anfrage = tx.objectStore(name).getAll();
      anfrage.onsuccess = () => { daten[name] = anfrage.result; };
    }
    tx.oncomplete = () => resolve({
      app: 'notenverwaltung',
      schemaVersion: DB_VERSION,
      exportiertAm: new Date().toISOString(),
      daten
    });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Export abgebrochen.'));
  });
}

function pruefePaket(paket) {
  if (!paket || paket.app !== 'notenverwaltung' || typeof paket.daten !== 'object' || paket.daten === null) {
    throw new Error('Das ist keine gültige Backup-Datei dieser App.');
  }
  if (typeof paket.schemaVersion === 'number' && paket.schemaVersion > DB_VERSION) {
    throw new Error('Die Backup-Datei stammt aus einer neueren App-Version.');
  }
  for (const name of ALLE_STORES) {
    if (paket.daten[name] !== undefined && !Array.isArray(paket.daten[name])) {
      throw new Error(`Backup-Datei fehlerhaft (Bereich „${name}“).`);
    }
  }
}

/** Ersetzt ALLE vorhandenen Daten durch den Inhalt des Backups (alles oder nichts). */
export async function importiereAlles(paket) {
  pruefePaket(paket);
  const db = await oeffneDatenbank();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALLE_STORES, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Import abgebrochen.'));
    try {
      for (const name of ALLE_STORES) {
        const store = tx.objectStore(name);
        store.clear();
        for (const eintrag of paket.daten[name] ?? []) store.put(eintrag);
      }
    } catch (fehler) {
      tx.abort(); // bestehende Daten bleiben erhalten
      reject(fehler);
    }
  });
}

export function alleLoeschen() {
  return ausfuehren(ALLE_STORES, 'readwrite', (tx) => {
    for (const name of ALLE_STORES) tx.objectStore(name).clear();
  });
}

/* ---------- Speicher-Status ---------- */

/** Bittet den Browser, die Daten nicht automatisch zu löschen. */
export async function dauerhaftenSpeicherAnfordern() {
  if (!navigator.storage?.persist) return false;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function speicherInfo() {
  const info = { dauerhaft: false, genutzt: null, kontingent: null };
  if (!navigator.storage) return info;
  try { info.dauerhaft = await navigator.storage.persisted(); } catch { /* ignorieren */ }
  try {
    const schaetzung = await navigator.storage.estimate();
    info.genutzt = schaetzung.usage ?? null;
    info.kontingent = schaetzung.quota ?? null;
  } catch { /* ignorieren */ }
  return info;
}
