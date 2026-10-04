// Bei jeder Veröffentlichung einer neuen Version die Nummer erhöhen.
const VERSION = 'v4';
const CACHE_NAME = `notenverwaltung-${VERSION}`;

// Neue Dateien der App hier eintragen. Fehlt eine Datei, schlägt die Installation fehl.
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/ui.js',
  'js/db.js',
  'js/schuljahr-ui.js',
  'js/klassen-ui.js',
  'js/kurse-ui.js',
  'js/solei-ui.js',
  'js/logic/kurse.js',
  'js/logic/schueler.js',
  'js/logic/schuljahr.js',
  'js/logic/berechnung.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen
          .filter((n) => n.startsWith('notenverwaltung-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Strategie: Antwort sofort aus dem Cache, im Hintergrund aktualisieren.
// Nur Dateien der eigenen Herkunft; es gibt keine Fremdanfragen.
self.addEventListener('fetch', (event) => {
  const anfrage = event.request;
  if (anfrage.method !== 'GET') return;
  if (new URL(anfrage.url).origin !== self.location.origin) return;
  event.respondWith(antworten(event));
});

async function antworten(event) {
  const anfrage = event.request;
  const cache = await caches.open(CACHE_NAME);
  const treffer = await cache.match(anfrage, { ignoreSearch: true });

  const aktualisierung = fetch(anfrage, { cache: 'no-cache' })
    .then((antwort) => {
      if (antwort.status === 200 && antwort.type === 'basic') {
        cache.put(anfrage, antwort.clone());
      }
      return antwort;
    })
    .catch(() => null);

  if (treffer) {
    event.waitUntil(aktualisierung);
    return treffer;
  }

  const antwort = await aktualisierung;
  if (antwort) return antwort;

  if (anfrage.mode === 'navigate') {
    const startseite = await cache.match('index.html');
    if (startseite) return startseite;
  }
  return new Response('Offline – Datei nicht verfügbar.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
