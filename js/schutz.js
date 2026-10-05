const METADATEN_SCHLUESSEL = 'notenverwaltung-schutz-v1';
const INAKTIVITAET_MS = 10 * 60 * 1000;
const ITERATIONEN = 600_000;

let aktiverSchluessel = null;
let sperrTimer = null;
let sperrBildschirm = null;
let aufEntsperrenWarten = null;

function zufallsBytes(anzahl) {
  return crypto.getRandomValues(new Uint8Array(anzahl));
}

function zuBase64(bytes) {
  let binaer = '';
  for (const byte of bytes) binaer += String.fromCharCode(byte);
  return btoa(binaer).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function vonBase64(text) {
  const standard = text.replaceAll('-', '+').replaceAll('_', '/');
  const binaer = atob(standard + '='.repeat((4 - standard.length % 4) % 4));
  return Uint8Array.from(binaer, (zeichen) => zeichen.charCodeAt(0));
}

function metadatenLaden() {
  const text = localStorage.getItem(METADATEN_SCHLUESSEL);
  return text ? JSON.parse(text) : null;
}

function metadatenSpeichern(metadaten) {
  localStorage.setItem(METADATEN_SCHLUESSEL, JSON.stringify(metadaten));
}

async function pinSchluessel(pin, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONEN, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function einpacken(schluessel, klartext) {
  const iv = zufallsBytes(12);
  const daten = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    schluessel,
    klartext
  );
  return { iv: zuBase64(iv), daten: zuBase64(new Uint8Array(daten)) };
}

async function auspacken(schluessel, paket) {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: vonBase64(paket.iv) },
    schluessel,
    vonBase64(paket.daten)
  );
}

async function datenSchluesselImportieren(rohdaten) {
  return crypto.subtle.importKey(
    'raw',
    rohdaten,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

function pinPruefen(pin) {
  return /^\d{8,12}$/.test(pin);
}

function bildschirmErstellen() {
  const overlay = document.createElement('section');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'schutz-titel');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'overflow:auto',
    'background:#f3f6fa',
    'display:grid',
    'place-items:center',
    'padding:1rem'
  ].join(';');

  const karte = document.createElement('div');
  karte.style.cssText =
    'max-width:34rem;width:100%;padding:1.5rem;background:white;border-radius:1rem;box-shadow:0 8px 32px #0002';

  const titel = document.createElement('h2');
  titel.id = 'schutz-titel';
  titel.textContent = 'Notenverwaltung gesperrt';

  const inhalt = document.createElement('div');
  karte.append(titel, inhalt);
  overlay.append(karte);
  document.body.append(overlay);
  sperrBildschirm = { overlay, inhalt };
}

function statusText(text, fehler = false) {
  let status = sperrBildschirm.inhalt.querySelector('[data-schutz-status]');
  if (!status) {
    status = document.createElement('p');
    status.dataset.schutzStatus = '';
    status.setAttribute('role', 'status');
    sperrBildschirm.inhalt.append(status);
  }
  status.textContent = text;
  status.style.color = fehler ? '#a00000' : '';
}

function knopf(text, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.style.cssText = 'display:block;margin-top:1rem;padding:.7rem 1rem';
  button.addEventListener('click', handler);
  return button;
}

function passwortFeld(labelText, name, autocomplete = 'new-password') {
  const label = document.createElement('label');
  label.style.cssText = 'display:block;margin-top:1rem';

  const text = document.createElement('span');
  text.textContent = labelText;

  const input = document.createElement('input');
  input.name = name;
  input.type = 'password';
  input.autocomplete = autocomplete;
  input.inputMode = 'numeric';
  input.style.cssText = 'display:block;width:100%;padding:.65rem;margin-top:.3rem';

  label.append(text, input);
  return { label, input };
}

function setzeSperrTimer() {
  clearTimeout(sperrTimer);
  if (!aktiverSchluessel) return;
  sperrTimer = setTimeout(() => sperren(), INAKTIVITAET_MS);
}

function aktivitaetRegistrieren() {
  for (const ereignis of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ereignis, setzeSperrTimer, { passive: true });
  }
}

function setupFormular() {
  const { inhalt } = sperrBildschirm;
  inhalt.replaceChildren();

  const hinweis = document.createElement('p');
  hinweis.textContent =
    'Lege eine PIN mit 8 bis 12 Ziffern fest. Der Wiederherstellungsschlüssel wird einmal angezeigt. Ohne PIN und Schlüssel sind die Daten nicht wiederherstellbar.';

  const form = document.createElement('form');
  const pin = passwortFeld('Neue PIN (8–12 Ziffern)', 'pin');
  const wiederholung = passwortFeld('PIN wiederholen', 'wiederholung');
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'PIN einrichten';
  button.style.cssText = 'margin-top:1rem;padding:.7rem 1rem';

  form.append(pin.label, wiederholung.label, button);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusText('');

    if (!pinPruefen(pin.input.value)) {
      return statusText('Die PIN muss aus 8 bis 12 Ziffern bestehen.', true);
    }
    if (pin.input.value !== wiederholung.input.value) {
      return statusText('Die beiden PIN-Eingaben stimmen nicht überein.', true);
    }

    button.disabled = true;
    try {
      const rohdaten = zufallsBytes(32);
      const salt = zufallsBytes(16);
      const recovery = zuBase64(zufallsBytes(32));
      const pinKey = await pinSchluessel(pin.input.value, salt);
      const recoveryKey = await crypto.subtle.importKey(
        'raw',
        vonBase64(recovery),
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );

      const pinWrap = await einpacken(pinKey, rohdaten);
      const recoveryWrap = await einpacken(recoveryKey, rohdaten);
      metadatenSpeichern({
        version: 1,
        salt: zuBase64(salt),
        pinWrap,
        recoveryWrap
      });

      aktiverSchluessel = await datenSchluesselImportieren(rohdaten);
      zeigeWiederherstellungsschluessel(recovery);
    } catch (error) {
      statusText(`Einrichtung fehlgeschlagen: ${error.message}`, true);
      button.disabled = false;
    }
  });

  inhalt.append(hinweis, form);
  pin.input.focus();
}

function zeigeWiederherstellungsschluessel(recovery) {
  const { inhalt } = sperrBildschirm;
  inhalt.replaceChildren();

  const warnung = document.createElement('p');
  warnung.textContent =
    'Notiere oder drucke diesen Schlüssel jetzt und bewahre ihn getrennt vom Gerät sicher auf. Er wird nicht erneut angezeigt.';

  const code = document.createElement('textarea');
  code.readOnly = true;
  code.value = recovery;
  code.setAttribute('aria-label', 'Wiederherstellungsschlüssel');
  code.style.cssText = 'display:block;width:100%;min-height:5rem;overflow-wrap:anywhere';

  const bestaetigen = knopf('Schlüssel sicher notiert – App öffnen', () => {
    sperrBildschirm.overlay.remove();
    sperrBildschirm = null;
    aufEntsperrenWarten?.();
    aufEntsperrenWarten = null;
    setzeSperrTimer();
  });

  inhalt.append(warnung, code, bestaetigen);
  code.focus();
  code.select();
}

function entsperrFormular() {
  const { inhalt } = sperrBildschirm;
  inhalt.replaceChildren();

  const hinweis = document.createElement('p');
  hinweis.textContent = 'PIN eingeben oder mit Wiederherstellungsschlüssel entsperren.';

  const form = document.createElement('form');
  const pin = passwortFeld('PIN', 'pin', 'current-password');
  const recovery = passwortFeld('Wiederherstellungsschlüssel (optional)', 'recovery', 'off');
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Entsperren';
  button.style.cssText = 'margin-top:1rem;padding:.7rem 1rem';

  form.append(pin.label, recovery.label, button);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    statusText('');

    try {
      const metadata = metadatenLaden();
      if (!metadata || metadata.version !== 1) {
        throw new Error('Schutzdaten fehlen oder sind nicht lesbar.');
      }

      let rohdaten;
      if (recovery.input.value.trim()) {
        const recoveryKey = await crypto.subtle.importKey(
          'raw',
          vonBase64(recovery.input.value.trim()),
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );
        rohdaten = await auspacken(recoveryKey, metadata.recoveryWrap);
      } else {
        if (!pinPruefen(pin.input.value)) {
          throw new Error('Bitte die PIN mit 8 bis 12 Ziffern eingeben.');
        }
        const key = await pinSchluessel(pin.input.value, vonBase64(metadata.salt));
        rohdaten = await auspacken(key, metadata.pinWrap);
      }

      aktiverSchluessel = await datenSchluesselImportieren(rohdaten);
      sperrBildschirm.overlay.remove();
      sperrBildschirm = null;
      aufEntsperrenWarten?.();
      aufEntsperrenWarten = null;
      setzeSperrTimer();
    } catch {
      statusText('Entsperren fehlgeschlagen. PIN oder Wiederherstellungsschlüssel prüfen.', true);
      button.disabled = false;
    }
  });

  inhalt.append(hinweis, form);
  pin.input.focus();
}

export function holeDatenSchluessel() {
  if (!aktiverSchluessel) {
    throw new Error('Die App ist gesperrt. Bitte zuerst entsperren.');
  }
  return aktiverSchluessel;
}

export async function schutzStarten() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto wird benötigt. Öffne die App über HTTPS oder localhost.');
  }

  bildschirmErstellen();
  aktivitaetRegistrieren();

  const metadata = metadatenLaden();
  if (!metadata) {
    setupFormular();
  } else {
    entsperrFormular();
  }

  await new Promise((resolve) => {
    aufEntsperrenWarten = resolve;
  });
}

export function sperren() {
  clearTimeout(sperrTimer);
  aktiverSchluessel = null;
  if (!sperrBildschirm) bildschirmErstellen();
  entsperrFormular();
}
