import { holeDatenSchluessel } from './schutz.js';

/**
 * Datenhaltung: IndexedDB, ausschließlich lokal auf dem Gerät.
 * Nutzdaten werden vor dem Speichern mit AES-GCM verschlüsselt.
 * Die IndexedDB-Schlüssel (z. B. numerische IDs) bleiben technisch sichtbar.
 *
 * Diese Version setzt voraus, dass die Datenbank leer ist.
 */
export const DB_NAME = 'notenverwaltung';
export const DB_VERSION = 4;

export const STORES = {
  KLASSEN: 'klassen',
  SCHUELER: 'schueler',
  LEISTUNGEN: 'leistungen',
  EINSTELLUNGEN: 'einstellungen',
  SCHULJAHRE: 'schuljahre',
  KURSE: 'kurse'
};

const ALLE_STORES = Object.values(STORES);
const FORMAT_BACKUP = 'notenverwaltung-verschluesseltes-backup-v1';

let dbPromise = null;

function kodierenBase64(bytes) {
  let binaer = '';
  for (const byte of bytes) binaer += String.fromCharCode(byte);
  return btoa(binaer);
}

function dekodierenBase64(text) {
  const binaer = atob(text);
  return Uint8Array.from(binaer, (zeichen) => zeichen.charCodeAt(0));
}

function schluesselFeld(store) {
  return store === STORES.EINSTELLUNGEN ? 'schluessel' : 'id';
}

function schluesselAuslesen(store, objekt) {
  const feld = schluesselFeld(store);
  const wert = objekt?.[feld];
  if (wert === undefined || wert === null) {
    throw new Error(`Datensatz in „${store}“ hat keinen Schlüssel „${feld}“.`);
  }
  return wert;
}

async function verschluesseln(objekt) {
  const schluessel = holeDatenSchluessel();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const klartext = new TextEncoder().encode(JSON.stringify(objekt));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    schluessel,
    klartext
  );

  return {
    iv: kodierenBase64(iv),
    ciphertext: kodierenBase64(new Uint8Array(ciphertext))
  };
}

async function entschluesseln(eintrag, store) {
  if (!eintrag || eintrag._verschluesselt !== true
      || typeof eintrag.iv !== 'string'
      || typeof eintrag.ciphertext !== 'string') {
    throw new Error(
      `In „${store}“ wurde ein nicht verschlüsselter oder fehlerhafter Datensatz gefunden.`
    );
  }

  try {
    const klartext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: dekodierenBase64(eintrag.iv) },
      holeDatenSchluessel(),
      dekodierenBase64(eintrag.ciphertext)
    );
    const objekt = JSON.parse(new TextDecoder().decode(klartext));
    const feld = schluesselFeld(store);

    if (objekt?.[feld] !== eintrag[feld]) {
      throw new Error('Datensatzschlüssel stimmt nicht überein.');
    }
    return objekt;
  } catch {
    throw new Error(
      `Datensatz in „${store}“ konnte nicht entschlüsselt werden. Ist die App entsperrt?`
    );
  }
}

function verschluesselterEintrag(store, schluessel, paket) {
  return {
    [schluesselFeld(store)]: schluessel,
    _verschluesselt: true,
    iv: paket.iv,
    ciphertext: paket.ciphertext
  };
}

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
      const tx = anfrage.transaction;

      if (ereignis.oldVersion < 1) {
        db.createObjectStore(STORES.KLASSEN, {
          keyPath: 'id',
          autoIncrement: true
        });

        const schueler = db.createObjectStore(STORES.SCHUELER, {
          keyPath: 'id',
          autoIncrement: true
        });
        schueler.createIndex('klasseId', 'klasseId');

        const leistungen = db.createObjectStore(STORES.LEISTUNGEN, {
          keyPath: 'id',
          autoIncrement: true
        });
        leistungen.createIndex('schuelerId', 'schuelerId');

        db.createObjectStore(STORES.EINSTELLUNGEN, {
          keyPath: 'schluessel'
        });
      }

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

      if (ereignis.oldVersion < 3) {
        const kurse = tx.objectStore(STORES.KURSE);

        if (!kurse.indexNames.contains('klasseId')) {
          kurse.createIndex('klasseId', 'klasseId');
        }

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

      // Version 4 ändert keine Store-Schlüsselpfade.
      // Die Datensätze werden durch die Lese-/Schreibfunktionen verschlüsselt.
    };

    anfrage.onsuccess = () => {
      const db = anfrage.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    anfrage.onerror = () => {
      dbPromise = null;
      reject(anfrage.error);
    };

    anfrage.onblocked = () => {
      dbPromise = null;
      reject(new Error('Datenbank blockiert – bitte andere Tabs der App schließen.'));
    };
  });

  return dbPromise;
}

/** Führt eine IndexedDB-Transaktion aus. */
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

function rohEintragLaden(store, schluessel) {
  return ausfuehren(store, 'readonly', (tx) =>
    tx.objectStore(store).get(schluessel)
  );
}

/* ---------- Allgemeine Operationen ---------- */

/**
 * Legt einen Datensatz verschlüsselt an oder aktualisiert ihn.
 * Bei neuen Datensätzen reserviert IndexedDB zunächst eine ID.
 */
export async function speichern(store, objekt) {
  if (!ALLE_STORES.includes(store)) {
    throw new Error(`Unbekannter Datenbereich: ${store}`);
  }
  if (!objekt || typeof objekt !== 'object' || Array.isArray(objekt)) {
    throw new Error('Gespeichert werden muss ein Datensatzobjekt sein.');
  }

  const feld = schluesselFeld(store);
  let schluessel = objekt[feld];

  if (schluessel === undefined || schluessel === null) {
    if (store === STORES.EINSTELLUNGEN) {
      throw new Error('Einstellungen benötigen ein Feld „schluessel“.');
    }

    // IndexedDB erzeugt die ID atomar, sodass parallele Tabs keine ID teilen.
    schluessel = await ausfuehren(store, 'readwrite', (tx) =>
      tx.objectStore(store).add({ _reserviert: true })
    );
  }

  const datensatz = { ...objekt, [feld]: schluessel };
  const paket = await verschluesseln(datensatz);
  const roh = verschluesselterEintrag(store, schluessel, paket);

  await ausfuehren(store, 'readwrite', (tx) =>
    tx.objectStore(store).put(roh)
  );

  return schluessel;
}

export async function laden(store, schluessel) {
  const roh = await rohEintragLaden(store, schluessel);
  if (roh === undefined) return undefined;
  return entschluesseln(roh, store);
}

export async function alleLaden(store) {
  const roheEintraege = await ausfuehren(store, 'readonly', (tx) =>
    tx.objectStore(store).getAll()
  );

  // Eine Reservierung kann nach einem Browserabbruch zurückbleiben.
  // Solche unvollständigen Platzhalter werden nicht als Datensätze ausgegeben.
  return Promise.all(
    roheEintraege
      .filter((eintrag) => eintrag?._reserviert !== true)
      .map((eintrag) => entschluesseln(eintrag, store))
  );
}

export function loeschen(store, schluessel) {
  return ausfuehren(store, 'readwrite', (tx) =>
    tx.objectStore(store).delete(schluessel)
  );
}

export async function zaehlen(store) {
  const eintraege = await ausfuehren(store, 'readonly', (tx) =>
    tx.objectStore(store).getAll()
  );
  return eintraege.filter((eintrag) =>
    eintrag?._verschluesselt === true
  ).length;
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

/**
 * Exportiert verschlüsselte Datensätze.
 * Dieses Backup kann mit dieser Version nur auf einer Installation importiert
 * werden, die denselben Datenschlüssel besitzt.
 */
export async function exportiereAlles() {
  const db = await oeffneDatenbank();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALLE_STORES, 'readonly');
    const daten = {};

    for (const name of ALLE_STORES) {
      const anfrage = tx.objectStore(name).getAll();
      anfrage.onsuccess = () => {
        daten[name] = anfrage.result.filter((eintrag) =>
          eintrag?._reserviert !== true
        );
      };
    }

    tx.oncomplete = () => resolve({
      app: 'notenverwaltung',
      format: FORMAT_BACKUP,
      schemaVersion: DB_VERSION,
      exportiertAm: new Date().toISOString(),
      daten
    });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Export abgebrochen.'));
  });
}

function pruefePaket(paket) {
  if (!paket
      || paket.app !== 'notenverwaltung'
      || paket.format !== FORMAT_BACKUP
      || typeof paket.daten !== 'object'
      || paket.daten === null) {
    throw new Error(
      'Ungültiges Backup. Erwartet wird ein verschlüsseltes Backup dieser App-Version.'
    );
  }

  if (typeof paket.schemaVersion === 'number'
      && paket.schemaVersion > DB_VERSION) {
    throw new Error('Die Backup-Datei stammt aus einer neueren App-Version.');
  }

  for (const name of ALLE_STORES) {
    if (!Array.isArray(paket.daten[name])) {
      throw new Error(`Backup-Datei fehlerhaft (Bereich „${name}“).`);
    }

    for (const eintrag of paket.daten[name]) {
      const feld = schluesselFeld(name);
      if (eintrag?._verschluesselt !== true
          || eintrag[feld] === undefined
          || typeof eintrag.iv !== 'string'
          || typeof eintrag.ciphertext !== 'string') {
        throw new Error(`Backup-Datei enthält ungültige Daten („${name}“).`);
      }
    }
  }
}

/** Ersetzt alle Daten – Import nur mit passendem Datenschlüssel. */
export async function importiereAlles(paket) {
  pruefePaket(paket);

  // Vor dem Löschen alle Einträge mit dem aktiven Schlüssel prüfen.
  // Ein falscher Schlüssel darf die vorhandenen Daten nicht löschen.
  for (const name of ALLE_STORES) {
    for (const eintrag of paket.daten[name]) {
      await entschluesseln(eintrag, name);
    }
  }

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
        for (const eintrag of paket.daten[name]) store.put(eintrag);
      }
    } catch (fehler) {
      tx.abort();
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

export async function dauerhaftenSpeicherAnfordern() {
  if (!navigator.storage?.persist) return false;
  try {
    return (await navigator.storage.persisted())
      || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function speicherInfo() {
  const info = { dauerhaft: false, genutzt: null, kontingent: null };
  if (!navigator.storage) return info;

  try {
    info.dauerhaft = await navigator.storage.persisted();
  } catch {
    // Ignorieren.
  }

  try {
    const schaetzung = await navigator.storage.estimate();
    info.genutzt = schaetzung.usage ?? null;
    info.kontingent = schaetzung.quota ?? null;
  } catch {
    // Ignorieren.
  }

  return info;
}
