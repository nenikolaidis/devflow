/* =========================================================
   core/constants.js — fixed names and lists used across the app.
   No imports, no side effects. If you rename anything here that is
   also stored in Firestore (roles, statuses, collection names), update
   firestore.rules too.
========================================================= */

/* ---------------- ROLES ---------------- */
export const ROLES = {
  ADMIN: 'admin',
  PM: 'pm',
  DEVELOPER: 'developer'
};
export const ROLE_LABELS = {
  [ROLES.DEVELOPER]: 'Developer',
  [ROLES.PM]: 'Project manager',
  [ROLES.ADMIN]: 'Administrator'
};

/* ---------------- FIRESTORE PATHS ---------------- */
export const COLLECTIONS = {
  TICKETS: 'tickets',
  COMMENTS: 'comments',        // subcollection of a ticket
  ACTIVITY: 'activity',        // subcollection of a ticket
  ALLOWLIST: 'allowlist',      // doc id = lowercase email
  ACCESS_REQUESTS: 'accessRequests',
  PROFILES: 'profiles',        // doc id = lowercase email
  META: 'meta',
  CONFIG: 'config'
};
export const DOCS = {
  COUNTERS: 'counters',        // meta/counters  → { ticketNumber }
  SETTINGS: 'settings'         // config/settings → board settings
};

/* ---------------- WORKFLOW STAGES ---------------- */
export const STATUS = {
  BACKLOG: 'backlog',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done'
};
export const STATUSES = [
  { key: STATUS.BACKLOG, label: 'Backlog' },
  { key: STATUS.IN_PROGRESS, label: 'In progress' },
  { key: STATUS.IN_REVIEW, label: 'In review' },
  { key: STATUS.DONE, label: 'Done' }
];

// Older boards used 6 stages. Tickets still carrying one of these values
// read (and sort) as the mapped stage — no migration needed.
const STATUS_ALIASES = {
  todo: STATUS.BACKLOG,
  code_review: STATUS.IN_REVIEW,
  testing: STATUS.IN_REVIEW
};
export function normalizeStatus(status){
  return STATUS_ALIASES[status] || status;
}
export function statusLabel(status){
  const key = normalizeStatus(status);
  return (STATUSES.find(s => s.key === key) || {}).label || status || '';
}

// Stages where a ticket sitting untouched counts as "stale".
export const STALE_STATUSES = [STATUS.IN_PROGRESS, STATUS.IN_REVIEW];

/* ---------------- ACTIVITY LOG ENTRY TYPES ---------------- */
// Must match the list in firestore.rules (activity → create).
export const ACTIVITY = {
  CREATED: 'created',
  STATUS_CHANGE: 'status_change',
  ASSIGNMENT: 'assignment',
  REVIEWER: 'reviewer',
  EDIT: 'edit',
  BLOCKED: 'blocked',
  UNBLOCKED: 'unblocked',
  ARCHIVED: 'archived',
  RESTORED: 'restored'
};

/* ---------------- PRIORITIES & LABELS ---------------- */
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];

// Color of each priority's icon and chart bar (CSS variables from style.css).
export const PRIORITY_COLOR = {
  critical: 'var(--red)',
  high: 'var(--text)',
  medium: 'var(--text-2)',
  low: 'var(--muted)'
};

// Color of each column's status icon and WIP bar.
export const STATUS_COLOR = {
  backlog: 'var(--muted)',
  in_progress: 'var(--amber)',
  in_review: 'var(--blue)',
  done: 'var(--green)'
};

export const ALL_LABELS = [
  'bug', 'feature', 'security', 'maintenance', 'documentation', 'testing',
  'frontend', 'backend', 'database', 'analysis'
];

// The small colored dot shown before each label.
export const LABEL_COLOR = {
  bug: 'var(--red)',
  feature: 'var(--blue)',
  security: 'var(--purple)',
  maintenance: 'var(--muted)',
  documentation: 'var(--teal)',
  testing: 'var(--amber)',
  frontend: 'var(--pink)',
  backend: 'var(--green)',
  database: 'var(--amber)',
  analysis: 'var(--teal)'
};

/* ---------------- FIELD LIMITS (mirrored in firestore.rules) ---------------- */
export const LIMITS = {
  TITLE: 200,
  DESCRIPTION: 20000,
  LINK: 2000,
  COMMENT: 5000,
  BLOCKED_REASON: 500,
  PROFILE_NAME: 100,
  PROFILE_USERNAME: 50,
  PROFILE_BIO: 500
};

/* ---------------- TABLE VIEW ---------------- */
export const TABLE_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'owner', label: 'Owner' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'labels', label: 'Labels' },
  { key: 'dueDate', label: 'Due' }
];

/* ---------------- PEOPLE ---------------- */
// A small fixed palette so each person's initials-avatar gets a
// consistent, distinct-looking color without needing uploaded images.
export const AVATAR_COLORS = [
  '#E8A33D', '#5B8DD9', '#4FA98C', '#D9635B',
  '#B57EDC', '#4FBEDB', '#D98F4F', '#7FBF6B'
];

// Fallback list used only if the browser doesn't support
// Intl.supportedValuesOf('timeZone').
export const FALLBACK_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Athens', 'Europe/Berlin',
  'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland'
];

/* ---------------- TICKET TEMPLATES ---------------- */
// Starting points for the "New ticket" form. Picking one pre-fills the
// description scaffold plus a sensible default priority/labels; the
// person can still edit everything afterward.
export const TICKET_TEMPLATES = [
  { id: 'blank', name: 'Blank ticket', priority: null, labels: [], description: '' },
  {
    id: 'bug', name: 'Bug report', priority: 'high', labels: ['bug'],
    description: 'Steps to reproduce\n1. \n2. \n3. \n\nExpected result\n\n\nActual result\n\n\nEnvironment (browser / OS / version)\n'
  },
  {
    id: 'feature', name: 'Feature request', priority: 'medium', labels: ['feature'],
    description: 'Problem / motivation\n\n\nProposed solution\n\n\nAlternatives considered\n'
  },
  {
    id: 'security', name: 'Security issue', priority: 'critical', labels: ['security'],
    description: 'Vulnerability description\n\n\nImpact\n\n\nSteps to reproduce / proof of concept\n\n\nSuggested remediation\n'
  },
  {
    id: 'maintenance', name: 'Maintenance task', priority: 'low', labels: ['maintenance'],
    description: 'What needs maintaining\n\n\nWhy now\n\n\nRisk if skipped\n'
  },
  {
    id: 'business_analysis', name: 'Business analysis', priority: 'medium', labels: ['analysis'],
    description: 'Business objective\n\n\nStakeholders\n\n\nCurrent process (as-is)\n\n\nProposed process (to-be)\n\n\nRequirements (functional / non-functional)\n\n\nAcceptance criteria\n\n\nSuccess metrics / KPIs\n\n\nAssumptions & constraints\n\n\nRisks & dependencies\n'
  }
];

/* ---------------- BOARD SETTINGS DEFAULTS ---------------- */
// Stored in Firestore at config/settings (admins edit them in the Team
// tab). These defaults apply until an admin saves.
// wipLimits: status key -> max tickets in that column (0 = no limit).
export const DEFAULT_SETTINGS = {
  discordWebhookUrl: '',
  staleDays: 5,
  wipLimits: { backlog: 0, in_progress: 5, in_review: 3, done: 0 }
};
