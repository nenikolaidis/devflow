/* =========================================================
   FIREBASE CONFIG — this project's real config (from the
   Firebase console → Project settings → General → Your apps)
   (The compat SDK scripts are loaded in index.html before this
   module, so the global `firebase` object is already available here.)

   These values are NOT secrets — every Firebase web app ships them to
   the browser. What protects your data is firestore.rules, plus the
   API-key restriction and App Check described in SECURITY.md.
========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyD-xJIVx-E_GyBkFMJwLdNvSIYHYT_7Rt8",
  authDomain: "devflow-board-11146.firebaseapp.com",
  projectId: "devflow-board-11146",
  storageBucket: "devflow-board-11146.firebasestorage.app",
  messagingSenderId: "725523676463",
  appId: "1:725523676463:web:2574564826cee68220f5da"
};

/* =========================================================
   APP CHECK (optional, recommended) — proves requests come from
   this site, not from a script someone runs against your project.
   Paste your reCAPTCHA v3 *site* key below to turn it on
   (SECURITY.md → "App Check"). Leave it empty to keep it off.
========================================================= */
const APP_CHECK_RECAPTCHA_SITE_KEY = "";
/* ========================================================= */

firebase.initializeApp(firebaseConfig);

if(APP_CHECK_RECAPTCHA_SITE_KEY){
  firebase.appCheck().activate(APP_CHECK_RECAPTCHA_SITE_KEY, true);
}

export const auth = firebase.auth();
export const db = firebase.firestore();
