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
  workspaceRole: null,     // 'admin' | 'member' (allowlist/{me}.role)

  /* ---- workspace data (kept in sync by data/sync.js) ---- */
  allowlist: [],           // [{ id: email, role, ... }] — everyone in the workspace
  accessRequests: [],      // [{ id: email, ... }] (admins only)
  profiles: {},            // email -> { name, username, bio, title, availability, timezone, lastActive }
  roles: {},               // roleId -> { name, description, order, permissions }
  projects: [],            // projects I can see: [{ id, name, key, members, memberEmails, status, ... }]
  projectRequests: [],     // pending requests (admins: all; others: their own)
  notifications: [],       // my notifications, newest first
  workspaceMeta: null,     // meta/workspace: { version, defaultProjectId } — null until upgraded
  hasLegacyData: false,    // single-board data from before projects exists (upgrade needed)

  /* ---- current project (kept in sync by data/sync.js) ---- */
  projectId: null,
  project: null,           // the current project's document
  tickets: [],             // [{ firestoreId, id, title, status, ... }]
  settings: null,          // project config/settings; read via core/settings.js getSettings()
  sprints: [],             // [{ id, name, goal, start, end, status }]
  templates: null,         // [{ id, name, ... }] or null = project hasn't customised them yet
  ticketsLoaded: false,    // false until the first tickets snapshot (shows the loading state)

  /* ---- UI-only state ---- */
  currentTab: 'board',     // 'board' | 'mywork' | 'dashboard' | 'manage'
  manageSection: 'overview',
  boardViewMode: 'kanban', // 'kanban' | 'table'
  filters: { search: '', type: '', priority: '', label: '', assignee: '', quick: '', sprint: '', showArchived: false },
  tableSort: { key: 'createdAt', dir: 'desc' },
  selectMode: false,
  selectedIds: new Set(),  // firestoreIds picked in multi-select
  collapsedColumns: {}     // status key -> bool, persisted to localStorage
};
