/* =========================================================
   data/firebase.js — starts Firebase and exports the auth and
   database handles. Values come from config.js.

   The compat SDK scripts are loaded in index.html before this module,
   so the global `firebase` object already exists here.

   Local development: run `npm run emulators` and `npm run serve`, then
   open http://localhost:5050/?emulators — the app then uses local,
   throwaway Auth + Firestore instead of the real project.
========================================================= */
import { FIREBASE_CONFIG, APP_CHECK_RECAPTCHA_SITE_KEY } from '../config.js';

const useEmulators = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('emulators');

// The emulators run as the "demo-devflow" project so they can never touch real data.
firebase.initializeApp(useEmulators ? { ...FIREBASE_CONFIG, projectId: 'demo-devflow' } : FIREBASE_CONFIG);

if(APP_CHECK_RECAPTCHA_SITE_KEY && !useEmulators){
  firebase.appCheck().activate(APP_CHECK_RECAPTCHA_SITE_KEY, true);
}

export const auth = firebase.auth();
export const db = firebase.firestore();

if(useEmulators){
  auth.useEmulator('http://127.0.0.1:9099');
  db.useEmulator('127.0.0.1', 8080);
  console.info('Devflow: using local emulators (demo-devflow). No real data is touched.');
}

/** Server-side "now" — use for every createdAt/updatedAt style field. */
export const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

/** Removes a field when passed in an update(). */
export const deleteField = () => firebase.firestore.FieldValue.delete();
