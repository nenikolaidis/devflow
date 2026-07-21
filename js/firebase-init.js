/* =========================================================
   FIREBASE CONFIG — this project's real config (from the
   Firebase console → Project settings → General → Your apps)
   (The compat SDK scripts are loaded in index.html before this
   module, so the global `firebase` object is already available here.)
========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyD-xJIVx-E_GyBkFMJwLdNvSIYHYT_7Rt8",
  authDomain: "devflow-board-11146.firebaseapp.com",
  projectId: "devflow-board-11146",
  storageBucket: "devflow-board-11146.firebasestorage.app",
  messagingSenderId: "725523676463",
  appId: "1:725523676463:web:2574564826cee68220f5da"
};

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();
