/* =========================================================
   app.js — entry point (loaded by index.html).

   Importing features/auth.js pulls in every other module through its
   imports; each feature wires up its own buttons when it loads. auth.js
   then waits for Firebase to report who is signed in and shows the
   right screen. See ARCHITECTURE.md for the full map.
========================================================= */
import './features/auth.js';
import './features/topbar.js';   // account menu + theme toggle
