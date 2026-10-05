import {
  STORES, DB_VERSION,
  zaehlen, exportiereAlles, importiereAlles, alleLoeschen, speicherInfo
} from './db.js';

const $ = (id) => document.getElementById(id);
let meldungTimer;

export function zeigeMeldung(text, art = 'info') {
  const element = $('meldung');
  element.textContent = text;
  element.className = `meldung meldung--${art}`;
  element.hidden = false;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => { element.hidden = true; }, 7000);
}

export function setzeOfflineStatus(text) {
  $('offline-status').textContent = text;
}

/** Registriert Ereignisse. Läuft synchron und sofort beim Start, auch ohne Datenbank. */
export function richteOberflaecheEin() {
  verbindungAnzeigen();
  window.addEventListener('online', verbindungAnzeigen);
  window.addEventListener('offline', verbindungAnzeigen);
  installationEinrichten();
  datensicherungEinrichten();
}

/** Füllt die Startseite mit Daten aus der Datenbank. */
export async function zeigeStartseite({ letzterStart }) {
  $('db-version').textContent = String(DB_VERSION);
  $('letzter-start').textContent = letzterStart ? formatiereDatum(letzterStart) : 'Erster Start';
  await zaehlerAktualisieren();
  await speicherstatusAnzeigen();
}

/* ---------- intern ---------- */

function verbindungAnzeigen() {
  const online = navigator.onLine;
  const element = $('verbindungsstatus');
  element.textContent = online ? 'Online' : 'Offline';
  element.classList.toggle('badge--offline', !online);
}

let installAufforderung = null;

function installationEinrichten() {
  const knopf = $('btn-installieren');

  window.addEventListener('beforeinstallprompt', (ereignis) => {
    ereignis.preventDefault();
    installAufforderung = ereignis;
    knopf.hidden = false;
  });
  knopf.addEventListener('click', async () => {
    if (!installAufforderung) return;
    installAufforderung.prompt();
    await installAufforderung.userChoice;
    installAufforderung = null;
    knopf.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    knopf.hidden = true;
    zeigeMeldung('App wurde installiert.', 'erfolg');
  });

  const istIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const istInstalliert = window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  $('ios-hinweis').hidden = !(istIos && !istInstalliert);
}

async function zaehlerAktualisieren() {
  $('anzahl-klassen').textContent = await zaehlen(STORES.KLASSEN);
  $('anzahl-schueler').textContent = await zaehlen(STORES.SCHUELER);
  $('anzahl-leistungen').textContent = await zaehlen(STORES.LEISTUNGEN);
}

async function speicherstatusAnzeigen() {
  const info = await speicherInfo();
  const teile = [info.dauerhaft
    ? 'Speicher: dauerhaft geschützt.'
    : 'Speicher: Der Browser darf Daten bei Platzmangel löschen – bitte regelmäßig ein Backup erstellen.'];
  if (info.genutzt !== null) teile.push(`Belegt: ${formatiereBytes(info.genutzt)}.`);
  $('speicherstatus').textContent = teile.join(' ');
}

function datensicherungEinrichten() {
  const exportKnopf = $('btn-export');
  const importKnopf = $('btn-import');
  const dateiEingabe = $('datei-import');
  const loeschKnopf = $('btn-loeschen');

  exportKnopf.addEventListener('click', async () => {
    exportKnopf.disabled = true;

    try {
      const paket = await exportiereAlles();
      const blob = new Blob(
        [JSON.stringify(paket, null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download =
        `notenverwaltung-backup-${new Date().toISOString().slice(0, 10)}.json`;

      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      zeigeMeldung(
        'Verschlüsseltes Backup erstellt. Es ist nur mit demselben Datenschlüssel wiederherstellbar. Bitte geschützt aufbewahren.',
        'erfolg'
      );
    } catch (fehler) {
      zeigeMeldung(`Export fehlgeschlagen: ${fehler.message}`, 'fehler');
    } finally {
      exportKnopf.disabled = false;
    }
  });

  importKnopf.addEventListener('click', () => dateiEingabe.click());

  dateiEingabe.addEventListener('change', async (ereignis) => {
    const datei = ereignis.target.files[0];
    dateiEingabe.value = '';
    if (!datei) return;

    const bestaetigt = confirm(
      'Der Import ersetzt ALLE aktuellen Daten auf diesem Gerät. ' +
      'Importiert werden können nur verschlüsselte Backups, die mit demselben ' +
      'Datenschlüssel erstellt wurden. Fortfahren?'
    );
    if (!bestaetigt) return;

    importKnopf.disabled = true;

    try {
      const paket = JSON.parse(await datei.text());
      await importiereAlles(paket);
      await zaehlerAktualisieren();

      zeigeMeldung(
        'Verschlüsseltes Backup wurde importiert.',
        'erfolg'
      );
    } catch (fehler) {
      zeigeMeldung(`Import fehlgeschlagen: ${fehler.message}`, 'fehler');
    } finally {
      importKnopf.disabled = false;
    }
  });

  loeschKnopf.addEventListener('click', async () => {
    if (!confirm('Wirklich ALLE Daten auf diesem Gerät unwiderruflich löschen?')) {
      return;
    }

    loeschKnopf.disabled = true;

    try {
      await alleLoeschen();
      await zaehlerAktualisieren();
      zeigeMeldung('Alle Daten wurden gelöscht.', 'erfolg');
    } catch (fehler) {
      zeigeMeldung(`Löschen fehlgeschlagen: ${fehler.message}`, 'fehler');
    } finally {
      loeschKnopf.disabled = false;
    }
  });
}

function formatiereDatum(iso) {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatiereBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
