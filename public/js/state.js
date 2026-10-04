// Central, mutable app state shared across modules.
// Import { state } and read/write its properties directly —
// ES modules share the same object instance everywhere it's imported.
export const state = {
  tickets: [],
  filters: { search: '', priority: '', label: '', assignee: '', showArchived: false },
  currentUser: null,
  currentRole: null,
  allowlistCache: [],
  requestsCache: [],
  profilesCache: {}, // email -> { name, username, bio, timezone, lastActive }
  settings: null, // config/settings doc merged over DEFAULT_SETTINGS (see settings.js)
  currentTab: 'board',
  boardViewMode: 'kanban',
  tableSort: { key: 'createdAt', dir: 'desc' },
  selectMode: false,
  selectedIds: new Set(),
  collapsedColumns: {}, // status key -> bool, persisted to localStorage
  // Firestore onSnapshot() unsubscribe functions, so we can detach
  // listeners cleanly on sign-out or when closing a modal.
  unsub: {
    tickets: null,
    allowlist: null,
    requests: null,
    ownRequest: null,
    comments: null,
    activity: null,
    profiles: null,
    settings: null
  }
};