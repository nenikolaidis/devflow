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

/* ---------------- TICKET TYPES ---------------- */
// What kind of work a ticket is. Each type has an icon (core/icons.js) and
// a color. Keys are stored in Firestore — keep in sync with firestore.rules.
export const TICKET_TYPES = [
  { key: 'task', label: 'Task', icon: 'checkSquare', color: 'var(--text-2)' },
  { key: 'bug', label: 'Bug', icon: 'bug', color: 'var(--red)' },
  { key: 'feature', label: 'Feature', icon: 'sparkle', color: 'var(--blue)' },
  { key: 'security', label: 'Security', icon: 'shield', color: 'var(--purple)' },
  { key: 'maintenance', label: 'Maintenance', icon: 'wrench', color: 'var(--amber)' },
  { key: 'analysis', label: 'Business analysis', icon: 'chartLine', color: 'var(--teal)' },
  { key: 'research', label: 'Research', icon: 'flask', color: 'var(--pink)' }
];
export const TYPE_KEYS = TICKET_TYPES.map(t => t.key);

export function typeInfo(key){
  return TICKET_TYPES.find(t => t.key === key) || TICKET_TYPES[0];
}

/**
 * A ticket's type. Tickets created before types existed get one from
 * their labels (a "bug" label → Bug), so nothing needs migrating.
 */
export function typeOf(t){
  if(t.type && TYPE_KEYS.includes(t.type)) return t.type;
  const labels = t.labels || [];
  return ['bug', 'security', 'feature', 'maintenance', 'analysis', 'research'].find(k => labels.includes(k)) || 'task';
}

/* ---------------- LABELS (topic areas) ---------------- */
// Admins manage the label list in Team → Board settings (stored in
// config/settings.labels). Colors are names from LABEL_PALETTE.
export const LABEL_PALETTE = {
  gray: 'var(--muted)', red: 'var(--red)', amber: 'var(--amber)', green: 'var(--green)',
  teal: 'var(--teal)', blue: 'var(--blue)', purple: 'var(--purple)', pink: 'var(--pink)'
};
export const DEFAULT_LABELS = [
  { name: 'frontend', color: 'pink' },
  { name: 'backend', color: 'green' },
  { name: 'database', color: 'amber' },
  { name: 'testing', color: 'teal' },
  { name: 'documentation', color: 'blue' },
  { name: 'design', color: 'purple' }
];

/* ---------------- REVIEWERS ---------------- */
export const MAX_REVIEWERS = 5;

/** A ticket's reviewers as a list (older tickets stored a single `reviewer`). */
export function reviewersOf(t){
  if(Array.isArray(t.reviewers)) return t.reviewers;
  return t.reviewer ? [t.reviewer] : [];
}

/* ---------------- PROFILES ---------------- */
export const AVAILABILITY = [
  { key: 'available', label: 'Available', color: 'var(--green)' },
  { key: 'busy', label: 'Busy', color: 'var(--amber)' },
  { key: 'away', label: 'Away', color: 'var(--muted)' }
];

/* ---------------- FIELD LIMITS (mirrored in firestore.rules) ---------------- */
export const LIMITS = {
  TITLE: 200,
  DESCRIPTION: 20000,
  LINK: 2000,
  COMMENT: 5000,
  BLOCKED_REASON: 500,
  PROFILE_NAME: 100,
  PROFILE_USERNAME: 50,
  PROFILE_BIO: 500,
  PROFILE_TITLE: 60,
  LABEL_NAME: 24,
  MAX_LABELS: 30,
  DOD_ITEM: 120,
  MAX_DOD_ITEMS: 10
};

/* ---------------- TABLE VIEW ---------------- */
export const TABLE_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'type', label: 'Type' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'owner', label: 'Owner' },
  { key: 'reviewers', label: 'Reviewers' },
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
// Starting points for the "New ticket" form. Picking one sets the type,
// a sensible priority and a description scaffold. Descriptions support
// simple formatting (core/markdown.js): "## " headings, "- " bullets,
// "1. " numbered lines and "- [ ] " checklist items.
export const TICKET_TEMPLATES = [
  { id: 'blank', name: 'Blank ticket', type: 'task', priority: null, description: '' },
  {
    id: 'task', name: 'Task', type: 'task', priority: 'medium',
    description: '## What needs doing\n\n\n## Done when\n- [ ] \n- [ ] \n'
  },
  {
    id: 'bug', name: 'Bug report', type: 'bug', priority: 'high',
    description: '## Steps to reproduce\n1. \n2. \n3. \n\n## Expected result\n\n\n## Actual result\n\n\n## Environment\nBrowser / OS / version: \n\n## Fix checklist\n- [ ] Reproduced\n- [ ] Fixed\n- [ ] Test added\n'
  },
  {
    id: 'feature', name: 'Feature request', type: 'feature', priority: 'medium',
    description: '## Problem / motivation\n\n\n## Proposed solution\n\n\n## Alternatives considered\n\n\n## Acceptance criteria\n- [ ] \n- [ ] \n'
  },
  {
    id: 'security', name: 'Security issue', type: 'security', priority: 'critical',
    description: '## Vulnerability\n\n\n## Impact\n\n\n## Steps to reproduce / proof of concept\n\n\n## Suggested remediation\n\n\n## Checklist\n- [ ] Fix deployed\n- [ ] Affected users / data reviewed\n- [ ] Regression test added\n'
  },
  {
    id: 'maintenance', name: 'Maintenance task', type: 'maintenance', priority: 'low',
    description: '## What needs maintaining\n\n\n## Why now\n\n\n## Risk if skipped\n\n\n## Checklist\n- [ ] \n'
  },
  {
    id: 'business_analysis', name: 'Business analysis', type: 'analysis', priority: 'medium',
    description: '## Business objective\n\n\n## Stakeholders\n\n\n## Current process (as-is)\n\n\n## Proposed process (to-be)\n\n\n## Requirements (functional / non-functional)\n\n\n## Acceptance criteria\n- [ ] \n- [ ] \n\n## Success metrics / KPIs\n\n\n## Assumptions & constraints\n\n\n## Risks & dependencies\n'
  },
  {
    id: 'research', name: 'Research / spike', type: 'research', priority: 'medium',
    description: '## Question to answer\n\n\n## Time box\n\n\n## Options to compare\n- \n- \n\n## Findings\n\n\n## Recommendation\n\n\n## Done when\n- [ ] Findings written up\n- [ ] Follow-up tickets created\n'
  }
];

/* ---------------- BOARD SETTINGS DEFAULTS ---------------- */
// Stored in Firestore at config/settings (admins edit them in the Team
// tab). These defaults apply until an admin saves.
// wipLimits: status key -> max tickets in that column (0 = no limit).
// labels: [{ name, color }]; dodItems: [{ id, text }] (empty = no Definition of Done).
export const DEFAULT_SETTINGS = {
  discordWebhookUrl: '',
  staleDays: 5,
  wipLimits: { backlog: 0, in_progress: 5, in_review: 3, done: 0 },
  labels: DEFAULT_LABELS,
  dodItems: []
};
