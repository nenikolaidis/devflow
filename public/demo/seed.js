/* =========================================================
   demo/seed.js — the sample workspace the public demo starts with.

   Fictional people (example.com addresses), two active projects and an
   archived one, plus sprints, comments, notifications and pending
   requests, so every screen has something to show. Dates are relative
   to today so "overdue", "stale" and the active sprint always make sense.
========================================================= */
import { put, Timestamp } from './backend.js';
import { DEFAULT_ROLES, DATA_VERSION } from '../js/core/constants.js';

const DAY = 86400000;
const ago = (days) => new Timestamp(Date.now() - days * DAY);
const isoDay = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/* ---------------- PEOPLE ---------------- */
// email → [name, job title, availability, time zone, workspace role]
export const PEOPLE = {
  'alex@example.com': ['Alex Morgan', 'Engineering manager', 'available', 'Europe/Athens', 'admin'],
  'maria@example.com': ['Maria Costa', 'Product manager', 'busy', 'Europe/London', 'member'],
  'sam@example.com': ['Sam Patel', 'Senior developer', 'available', 'Europe/Berlin', 'member'],
  'lena@example.com': ['Lena Novak', 'Frontend developer', 'available', 'Europe/Prague', 'member'],
  'jordan@example.com': ['Jordan Lee', 'QA engineer', 'away', 'America/New_York', 'member'],
  'chris@example.com': ['Chris Silva', 'Product designer', 'available', 'America/Sao_Paulo', 'member'],
  'taylor@client.example.com': ['Taylor Reed', 'Client stakeholder', 'available', 'Europe/Dublin', 'member']
};

/* ---------------- PROJECTS ---------------- */
const PROJECTS = {
  web: {
    name: 'Customer website', key: 'WEB', description: 'The new marketing site and customer portal.',
    members: { 'maria@example.com': 'pm', 'sam@example.com': 'techlead', 'lena@example.com': 'developer',
               'jordan@example.com': 'qa', 'chris@example.com': 'designer', 'taylor@client.example.com': 'viewer' },
    created: 60
  },
  mob: {
    name: 'Mobile app', key: 'MOB', description: 'iOS and Android app for customers.',
    members: { 'maria@example.com': 'pm', 'sam@example.com': 'developer', 'chris@example.com': 'designer', 'jordan@example.com': 'qa' },
    created: 25
  },
  cms: {
    name: 'Legacy CMS', key: 'CMS', description: 'Retired after the move to the new site.', status: 'archived',
    members: { 'maria@example.com': 'pm', 'sam@example.com': 'developer' },
    created: 200
  }
};

/* ---------------- TICKETS ---------------- */
// [number, status, type, priority, title, owner, reviewers, labels, sprint, due (days from today), last activity (days ago), extra]
const WEB_TICKETS = [
  [1, 'done', 'feature', 'high', 'Design system: colours, type and spacing tokens', 'chris', ['sam'], ['design', 'frontend'], 's6', null, 16],
  [2, 'done', 'security', 'high', 'Require email verification on sign-up', 'sam', ['lena'], ['backend'], 's6', null, 14],
  [3, 'done', 'task', 'medium', 'Set up preview deploys for pull requests', 'sam', ['maria'], ['testing'], 's7', null, 4],
  [4, 'in_review', 'feature', 'high', 'Customer portal: invoice history page', 'lena', ['sam', 'jordan'], ['frontend', 'backend'], 's7', -1, 1],
  [5, 'in_review', 'bug', 'critical', 'Checkout fails when the coupon field is empty', 'sam', ['jordan'], ['backend'], 's7', 1, 0.3],
  [6, 'in_progress', 'feature', 'medium', 'Pricing page with monthly / yearly toggle', 'lena', ['chris'], ['frontend', 'design'], 's7', 4, 0.5],
  [7, 'in_progress', 'bug', 'high', 'Images on the blog load twice on mobile', 'sam', ['lena'], ['frontend'], 's7', 3, 7],
  [8, 'in_progress', 'maintenance', 'low', 'Upgrade the build tooling to the latest major', 'lena', [], ['testing'], 's7', null, 2,
    { blocked: true, blockedReason: 'Waiting for the analytics plugin to support the new version.', blockedBy: 'lena@example.com', blockedAt: ago(2) }],
  [9, 'backlog', 'analysis', 'medium', 'Business analysis: self-service onboarding', 'maria', ['taylor'], ['documentation'], 's8', 12, 3],
  [10, 'backlog', 'security', 'high', 'Rate-limit the login and password reset endpoints', 'sam', [], ['backend'], 's8', null, 5],
  [11, 'backlog', 'research', 'low', 'Compare search providers for the help centre', 'jordan', [], ['documentation'], '', null, 9],
  [12, 'backlog', 'task', 'medium', 'Accessibility audit of the checkout flow', 'jordan', ['chris'], ['testing', 'frontend'], 's8', 18, 1]
];
const MOB_TICKETS = [
  [1, 'done', 'feature', 'high', 'Sign in with email and password', 'sam', ['jordan'], ['backend'], 'm1', null, 10],
  [2, 'in_progress', 'feature', 'high', 'Push notifications for order updates', 'sam', ['jordan'], ['backend'], 'm1', 6, 1],
  [3, 'in_progress', 'feature', 'medium', 'Onboarding screens', 'chris', ['maria'], ['design'], 'm1', 2, 0.5],
  [4, 'in_review', 'bug', 'high', 'App crashes when rotating on the order screen', 'sam', ['jordan'], ['frontend'], 'm1', 0, 0.2],
  [5, 'backlog', 'task', 'medium', 'Prepare App Store screenshots and listing', 'chris', [], ['design'], '', 14, 2],
  [6, 'backlog', 'research', 'low', 'Offline mode: what needs to work without signal?', 'maria', [], ['documentation'], '', null, 6]
];

const DESCRIPTIONS = {
  'WEB-4': '## Goal\nCustomers can see and download every invoice from the portal.\n\n## Acceptance criteria\n- [x] List of invoices, newest first\n- [x] Download as PDF\n- [ ] Empty state when there are no invoices\n- [ ] Works on mobile',
  'WEB-5': '## Steps to reproduce\n1. Add any product to the basket.\n2. Leave the **coupon** field empty.\n3. Press **Pay**.\n\n## Expected result\nThe payment goes through.\n\n## Actual result\n`400 Bad Request` and the basket is emptied.\n\n## Fix checklist\n- [x] Reproduced\n- [x] Fixed: treat an empty coupon as "no coupon"\n- [ ] Regression test added',
  'WEB-6': '## Goal\nOne pricing page that shows monthly and yearly plans.\n\n- [x] Layout from the design file\n- [ ] Toggle remembers the last choice\n- [ ] Yearly prices show the saving',
  'WEB-9': '## Business objective\nLet new customers set up their account without a call with sales.\n\n## Stakeholders\n- Sales\n- Customer success\n- Taylor (client)\n\n## Acceptance criteria\n- [x] Current process mapped\n- [ ] Interviews with three customers\n- [ ] Proposal reviewed by the client',
  'MOB-4': '## Steps to reproduce\n1. Open an order.\n2. Rotate the phone to landscape.\n\n## Expected result\nThe order screen redraws.\n\n## Actual result\nThe app closes.'
};

function seedTickets(pid, key, rows){
  rows.forEach(([n, status, type, priority, title, owner, reviewers, labels, sprintId, due, lastActive, extra = {}]) => {
    const id = `${key}-${String(n).padStart(3, '0')}`;
    const email = (short) => Object.keys(PEOPLE).find(e => e.startsWith(short + '@'));
    const dod = status === 'done' ? { tests: true, docs: true } : (n === 4 && key === 'WEB' ? { tests: true } : {});
    put(`projects/${pid}/tickets/${key.toLowerCase()}${n}`, {
      id, number: n, title, type, priority, status, labels, sprintId,
      description: DESCRIPTIONS[`${key}-${n}`] || '',
      owner: email(owner), reviewers: reviewers.map(email),
      dueDate: due === null ? '' : isoDay(due), linkUrl: '', dod,
      archived: false, blocked: false,
      createdBy: 'maria@example.com', createdAt: ago(40 - n * 2), lastActivityAt: ago(lastActive),
      ...extra
    });
  });
  put(`projects/${pid}/meta/counters`, { ticketNumber: rows.length });
}

/** Fills the in-memory database with the sample workspace. */
export function seedDemo(){
  /* workspace */
  put('meta/workspace', { version: DATA_VERSION, defaultProjectId: 'web' });
  DEFAULT_ROLES.forEach(r => put(`roles/${r.id}`, { name: r.name, description: r.description, order: r.order, permissions: r.permissions }));
  Object.entries(PEOPLE).forEach(([email, [name, title, availability, timezone, role]]) => {
    put(`allowlist/${email}`, { role, addedBy: 'alex@example.com', addedAt: ago(90) });
    put(`profiles/${email}`, { name, username: '', bio: '', title, availability, timezone, createdAt: ago(90), lastActive: ago(0.2) });
  });
  put('accessRequests/robin@example.com', { email: 'robin@example.com', requestedAt: ago(0.4) });
  put('projectRequests/req1', {
    name: 'Data platform', key: 'DATA', description: 'Reporting and dashboards for the sales team.',
    fromProjectId: 'web', requestedBy: 'maria@example.com', createdAt: ago(1), status: 'pending'
  });

  /* projects */
  Object.entries(PROJECTS).forEach(([pid, p]) => put(`projects/${pid}`, {
    name: p.name, key: p.key, description: p.description, status: p.status || 'active',
    members: p.members, memberEmails: Object.keys(p.members), createdBy: 'alex@example.com', createdAt: ago(p.created)
  }));

  /* Website relaunch */
  put('projects/web/config/settings', {
    staleDays: 5,
    wipLimits: { in_progress: 4, in_review: 3 },
    dodItems: [{ id: 'tests', text: 'Tests added or updated' }, { id: 'docs', text: 'Docs / changelog updated' }],
    dodRequired: ['tests', 'docs'],
    weeklySummary: false
  });
  put('projects/web/sprints/s6', { name: 'Sprint 6', goal: 'Foundations: design system and sign-up', start: isoDay(-27), end: isoDay(-14), status: 'closed', createdBy: 'maria@example.com', createdAt: ago(30) });
  put('projects/web/sprints/s7', { name: 'Sprint 7', goal: 'Customer portal and pricing page ready for the client demo', start: isoDay(-6), end: isoDay(7), status: 'active', createdBy: 'maria@example.com', createdAt: ago(8) });
  put('projects/web/sprints/s8', { name: 'Sprint 8', goal: 'Onboarding and hardening', start: isoDay(8), end: isoDay(21), status: 'planned', createdBy: 'maria@example.com', createdAt: ago(2) });
  seedTickets('web', 'WEB', WEB_TICKETS);

  const c = (ticket, id, author, text, daysAgo, mentions) =>
    put(`projects/web/tickets/${ticket}/comments/${id}`, { text, author, createdAt: ago(daysAgo), ...(mentions ? { mentions } : {}) });
  c('web5', 'c1', 'jordan@example.com', 'Reproduced on staging with an empty coupon. Card payments only — PayPal is fine.', 1);
  c('web5', 'c2', 'sam@example.com', 'Fix is up. @Jordan Lee can you re-test on staging before I close it?', 0.3, ['jordan@example.com']);
  c('web4', 'c1', 'lena@example.com', '@Alex Morgan the PDF download needs the new storage bucket — can you approve the cost?', 0.8, ['alex@example.com']);
  c('web4', 'c2', 'alex@example.com', 'Approved. Go ahead.', 0.6);
  c('web8', 'c1', 'lena@example.com', 'Opened an issue with the plugin maintainers; they expect a release next week.', 2);

  const a = (ticket, id, type, actor, daysAgo, extra = {}) =>
    put(`projects/web/tickets/${ticket}/activity/${id}`, { type, actor, createdAt: ago(daysAgo), ...extra });
  a('web5', 'a1', 'created', 'maria@example.com', 3);
  a('web5', 'a2', 'status_change', 'sam@example.com', 2, { from: 'backlog', to: 'in_progress' });
  a('web5', 'a3', 'status_change', 'sam@example.com', 0.3, { from: 'in_progress', to: 'in_review' });
  a('web4', 'a1', 'created', 'maria@example.com', 12);
  a('web4', 'a2', 'status_change', 'lena@example.com', 6, { from: 'backlog', to: 'in_progress' });
  a('web4', 'a3', 'status_change', 'lena@example.com', 1, { from: 'in_progress', to: 'in_review' });
  a('web8', 'a1', 'blocked', 'lena@example.com', 2, { reason: 'Waiting for the analytics plugin to support the new version.' });

  /* Mobile app */
  put('projects/mob/config/settings', { staleDays: 3, wipLimits: { in_progress: 3 } });
  put('projects/mob/sprints/m1', { name: 'MVP sprint 1', goal: 'Sign-in, orders and notifications', start: isoDay(-4), end: isoDay(10), status: 'active', createdBy: 'maria@example.com', createdAt: ago(5) });
  seedTickets('mob', 'MOB', MOB_TICKETS);

  /* Legacy CMS (archived) */
  put('projects/cms/meta/counters', { ticketNumber: 0 });

  /* notifications */
  const note = (id, to, by, pid, fid, ticketId, title, text, daysAgo, read) =>
    put(`notifications/${id}`, { to, by, type: 'mention', projectId: pid, ticketFid: fid, ticketId, ticketTitle: title, text, createdAt: ago(daysAgo), read });
  note('n1', 'alex@example.com', 'lena@example.com', 'web', 'web4', 'WEB-004', 'Customer portal: invoice history page',
    '@Alex Morgan the PDF download needs the new storage bucket — can you approve the cost?', 0.8, false);
  note('n2', 'jordan@example.com', 'sam@example.com', 'web', 'web5', 'WEB-005', 'Checkout fails when the coupon field is empty',
    'Fix is up. @Jordan Lee can you re-test on staging before I close it?', 0.3, false);
}
