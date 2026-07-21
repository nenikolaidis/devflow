/* =========================================================
   FIREBASE CONFIG — replace with your own project's config
   Firebase console → Project settings → General → Your apps → SDK setup
   (The compat SDK scripts are loaded in index.html before this module,
   so the global `firebase` object is already available here.)
========================================================= */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();