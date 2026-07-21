export const STATUSES = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'in_review', label: 'In review' },
  { key: 'done', label: 'Done' }
];

// Older boards used 6 stages. Any ticket still carrying one of these
// values reads (and sorts) as its mapped stage below — no migration
// script needed, tickets "heal" the next time they're touched, and the
// original value is never overwritten unless someone actively edits it.
const STATUS_ALIASES = {
  todo: 'backlog',
  code_review: 'in_review',
  testing: 'in_review'
};
export function normalizeStatus(status){
  return STATUS_ALIASES[status] || status;
}

export const PRIORITIES = ['critical', 'high', 'medium', 'low'];

export const PRIORITY_COLOR = {
  critical: 'var(--red)',
  high: 'var(--accent)',
  medium: 'var(--blue)',
  low: 'var(--teal)'
};

export const ALL_LABELS = [
  'bug', 'feature', 'security', 'maintenance', 'documentation', 'testing',
  'frontend', 'backend', 'database'
];

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
  }
];