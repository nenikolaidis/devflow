/* =========================================================
   core/state.js — the one shared, in-memory copy of app data.

   data/sync.js fills the "live data" part from Firestore listeners;
   features read it to render and write the UI-only part. ES modules share
   one object instance, so import { state } and read/write it directly.
   After changing live data, emit the matching event (core/events.js) so
   screens repaint.
========================================================= */
export const state = {
  /* ---- who is signed in ---- */
  currentUser: null,       // Firebase user object
  currentRole: null,       // ROLES.* from the allowlist

  /* ---- live data (kept in sync by data/sync.js) ---- */
  tickets: [],             // [{ firestoreId, id, title, status, ... }]
  allowlist: [],           // [{ id: email, role, ... }]
  accessRequests: [],      // [{ id: email, email, requestedAt }] (admins only)
  profiles: {},            // email -> { name, username, bio, timezone, lastActive }
  settings: null,          // config/settings doc; read via data/settings.js getSettings()

  /* ---- UI-only state ---- */
  currentTab: 'board',     // 'board' | 'dashboard' | 'team'
  boardViewMode: 'kanban', // 'kanban' | 'table'
  filters: { search: '', priority: '', label: '', assignee: '', showArchived: false },
  tableSort: { key: 'createdAt', dir: 'desc' },
  selectMode: false,
  selectedIds: new Set(),  // firestoreIds picked in multi-select
  collapsedColumns: {}     // status key -> bool, persisted to localStorage
};
