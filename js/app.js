import {
  oeffneDatenbank, einstellungLaden, einstellungSpeichern, dauerhaftenSpeicherAnfordern
} from './db.js';
import {
  richteOberflaecheEin, zeigeStartseite, zeigeMeldung, setzeOfflineStatus
} from './ui.js';
import {
    initialisiereSchuljahre
} from './schuljahr-ui.js';
import {
    initialisiereKlassenUndSchueler
} from './klassen-ui.js';
import {
    initialisiereKurse
} from './kurse-ui.js';
import {
    initialisiereSolei
} from './solei-ui.js';
import {
    initialisiereNotenverwaltung
} from './noten-ui.js';

async function start() {
  // Zuerst die Ereignisse registrieren, damit z. B. das Installations-Ereignis nicht verpasst wird.
  richteOberflaecheEin();

  try {
    await oeffneDatenbank();
    await initialisiereSchuljahre();
    await initialisiereKlassenUndSchueler();
    await initialisiereKurse();
    await initialisiereSolei();
    await initialisiereNotenverwaltung();
    const letzterStart = await einstellungLaden('letzterStart', null);
    await einstellungSpeichern('letzterStart', new Date().toISOString());
    await dauerhaftenSpeicherAnfordern();
    await zeigeStartseite({ letzterStart });
  } catch (fehler) {
    console.error(fehler);
    zeigeMeldung(`Datenbank nicht verfügbar: ${fehler.message}`, 'fehler');
  }

  await registriereServiceWorker();
}

async function registriereServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setzeOfflineStatus('Von diesem Browser nicht unterstützt');
    return;
  }
  try {
    await navigator.serviceWorker.register('service-worker.js');
    await navigator.serviceWorker.ready;
    setzeOfflineStatus('Bereit – die App läuft auch ohne Internet');
  } catch (fehler) {
    console.error(fehler);
    setzeOfflineStatus('Nicht verfügbar (HTTPS bzw. localhost nötig)');
  }
}

start();
