import {
  oeffneDatenbank,
  einstellungLaden,
  einstellungSpeichern,
  dauerhaftenSpeicherAnfordern
} from './db.js';
import {
  richteOberflaecheEin,
  zeigeStartseite,
  zeigeMeldung,
  setzeOfflineStatus
} from './ui.js';
import { schutzStarten } from './schutz.js';
import { initialisiereSchuljahre } from './schuljahr-ui.js';
import { initialisiereKlassenUndSchueler } from './klassen-ui.js';
import { initialisiereKurse } from './kurse-ui.js';
import { initialisiereSolei } from './solei-ui.js';
import { initialisiereNotenverwaltung } from './noten-ui.js';

async function start() {
  // Ereignisse sofort anmelden, damit Installations- und Online-Ereignisse
  // nicht verpasst werden. Es werden dabei noch keine Datenbankdaten geladen.
  richteOberflaecheEin();

  try {
    // Erst nach erfolgreicher PIN-Eingabe darf die Datenbank geöffnet werden.
    await schutzStarten();

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
    zeigeMeldung(`App konnte nicht gestartet werden: ${fehler.message}`, 'fehler');
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
