/* =========================================================
   FIREBASE CONFIG — replace with your own project's config
   Firebase console → Project settings → General → Your apps → SDK setup
   (The compat SDK scripts are loaded in index.html before this module,
   so the global `firebase` object is already available here.)
========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyCTiYrR3FebkzgY3tiXYgdXc8JzBNjxWS0",
  authDomain: "devflow-board.firebaseapp.com",
  projectId: "devflow-board",
  storageBucket: "devflow-board.firebasestorage.app",
  messagingSenderId: "942324710281",
  appId: "1:942324710281:web:cceebc5f5375b2198f3f58",
  measurementId: "G-X8F5EWNXC6"
};

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();