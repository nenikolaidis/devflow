/* =========================================================
   config.js — every value you might need to edit lives here.
   Nothing in this file is secret: it all ends up in the browser.
   (Discord webhooks are NOT here on purpose — each project's is set in
   Manage → Integrations and stored in Firestore.)
========================================================= */

/* Firebase web app config — Firebase console → Project settings →
   General → Your apps. Not a secret; firestore.rules protects the data. */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD-xJIVx-E_GyBkFMJwLdNvSIYHYT_7Rt8",
  authDomain: "devflow-board-11146.firebaseapp.com",
  projectId: "devflow-board-11146",
  storageBucket: "devflow-board-11146.firebasestorage.app",
  messagingSenderId: "725523676463",
  appId: "1:725523676463:web:2574564826cee68220f5da"
};

/* App Check (optional, recommended) — paste your reCAPTCHA v3 *site* key
   to prove requests come from this site. Empty = off. See SECURITY.md. */
export const APP_CHECK_RECAPTCHA_SITE_KEY = "";

/* EmailJS (optional) — emails a ticket's owner when they're assigned.
   Leave the YOUR_… placeholders to keep it off. See SETUP.md step 9 for the
   template variables: to_email, ticket_id, ticket_title, actor_email, board_url. */
export const EMAILJS = {
  publicKey: "YOUR_EMAILJS_PUBLIC_KEY",
  serviceId: "YOUR_EMAILJS_SERVICE_ID",
  templateId: "YOUR_EMAILJS_TEMPLATE_ID"
};

/* Minimum password length. Keep in sync with Firebase console →
   Authentication → Settings → Password policy. */
export const MIN_PASSWORD_LENGTH = 10;
