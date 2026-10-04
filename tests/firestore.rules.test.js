/* =========================================================
   Security rules tests — run against the local Firestore emulator,
   never against real data.

     npm run test:rules        (needs Java 11+; GitHub Actions has it)

   A small workspace is seeded before every test: a workspace admin and
   members with different roles in project "p1", plus a second project
   "p2" that most of them can't see. Each test signs in as someone and
   checks that firestore.rules allows or refuses an operation. If you
   change the rules, add or adjust a test here.
========================================================= */
import { describe, it, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where,
  runTransaction, writeBatch, serverTimestamp, deleteField
} from 'firebase/firestore';

const U = {
  admin: 'admin@team.dev',     // workspace admin
  pm: 'pm@team.dev',           // Project manager in p1
  lead: 'lead@team.dev',       // Tech lead in p1
  dev: 'dev@team.dev',         // Developer in p1 — owner of the seeded ticket
  dev2: 'dev2@team.dev',       // Developer in p1 — reviewer of the seeded ticket; PM in p2
  qa: 'qa@team.dev',           // QA in p1
  viewer: 'viewer@team.dev',   // Viewer in p1
  outsider: 'outsider@team.dev'
};
const WEBHOOK = 'https://discord.com/api/webhooks/123456/abcDEF_-123';

// Mirrors DEFAULT_ROLES in public/js/core/constants.js.
const ALL = ['editTickets', 'comment', 'closeTickets', 'archiveTickets', 'moderateComments', 'manageSprints', 'manageContent', 'manageWorkflow', 'manageMembers', 'manageIntegrations', 'requestProjects'];
const perms = (...on) => Object.fromEntries(ALL.map(p => [p, on.includes(p)]));
const ROLES = {
  pm: perms(...ALL),
  techlead: perms('editTickets', 'comment', 'closeTickets', 'archiveTickets', 'moderateComments', 'manageSprints', 'manageContent'),
  developer: perms('editTickets', 'comment'),
  qa: perms('editTickets', 'comment'),
  viewer: perms('comment')
};

let env;
const as = (who, { verified = true } = {}) => {
  const email = U[who] || who;
  return env.authenticatedContext(email.replace(/\W/g, '_'), { email, email_verified: verified }).firestore();
};
const anonymous = () => env.unauthenticatedContext().firestore();
const T = (pid = 'p1', id = 't1') => `projects/${pid}/tickets/${id}`;

function newTicket(createdBy, extra = {}){
  return {
    title: 'Fix login', description: '', type: 'task', priority: 'medium', dueDate: '', owner: '', reviewers: [],
    linkUrl: '', labels: [], status: 'backlog', archived: false,
    createdBy, createdAt: serverTimestamp(), lastActivityAt: serverTimestamp(), ...extra
  };
}
/** Creates a ticket the way the app does: bump the project's counter and write the ticket in one transaction. */
function createTicket(db, fields, { pid = 'p1', key = 'TASK', numberOffset = 0 } = {}){
  return runTransaction(db, async tx => {
    const counterRef = doc(db, `projects/${pid}/meta/counters`);
    const snap = await tx.get(counterRef);
    const next = (snap.exists() ? snap.data().ticketNumber : 0) + 1;
    tx.set(counterRef, { ticketNumber: next });
    tx.set(doc(collection(db, `projects/${pid}/tickets`)), { ...fields, id: `${key}-${String(next).padStart(3, '0')}`, number: next + numberOffset });
  });
}
const project = (name, key, members, extra = {}) => ({
  name, key, description: '', status: 'active', members, memberEmails: Object.keys(members),
  createdBy: U.admin, createdAt: serverTimestamp(), ...extra
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-devflow',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'allowlist', U.admin), { role: 'admin' });
    for(const k of ['pm', 'lead', 'dev', 'dev2', 'qa', 'viewer']) await setDoc(doc(db, 'allowlist', U[k]), { role: 'member' });
    for(const [id, p] of Object.entries(ROLES)) await setDoc(doc(db, 'roles', id), { name: id, permissions: p });
    await setDoc(doc(db, 'projects/p1'), project('Website', 'TASK', {
      [U.pm]: 'pm', [U.lead]: 'techlead', [U.dev]: 'developer', [U.dev2]: 'developer', [U.qa]: 'qa', [U.viewer]: 'viewer'
    }));
    await setDoc(doc(db, 'projects/p2'), project('Mobile', 'APP', { [U.dev2]: 'pm' }));
    await setDoc(doc(db, 'projects/p1/meta/counters'), { ticketNumber: 1 });
    await setDoc(doc(db, T()), { ...newTicket(U.dev, { owner: U.dev, reviewers: [U.dev2], status: 'in_progress' }), id: 'TASK-001', number: 1 });
    await setDoc(doc(db, `${T()}/comments/c1`), { text: 'Hello', author: U.dev, createdAt: serverTimestamp() });
    await setDoc(doc(db, `${T()}/activity/a1`), { type: 'created', actor: U.dev, createdAt: serverTimestamp() });
    await setDoc(doc(db, 'projects/p1/config/settings'), { discordWebhookUrl: WEBHOOK, staleDays: 5, wipLimits: {} });
    await setDoc(doc(db, 'projects/p2/tickets/x1'), { ...newTicket(U.dev2), id: 'APP-001', number: 1 });
  });
});

/* ------------------------------------------------------------------ */
describe('who can get in', () => {
  it('signed-out visitors and unverified users see nothing', async () => {
    await assertFails(getDoc(doc(anonymous(), T())));
    await assertFails(getDoc(doc(as('dev', { verified: false }), T())));
  });
  it('verified people who are not in the workspace see nothing', async () => {
    await assertFails(getDoc(doc(as('outsider'), T())));
    await assertSucceeds(getDoc(doc(as('outsider'), 'allowlist', U.outsider))); // to learn they're pending
  });
  it('a verified outsider can request access for themselves only', async () => {
    await assertSucceeds(setDoc(doc(as('outsider'), 'accessRequests', U.outsider), { email: U.outsider, requestedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as('outsider'), 'accessRequests', 'victim@team.dev'), { email: 'victim@team.dev', requestedAt: serverTimestamp() }));
  });
});

/* ------------------------------------------------------------------ */
describe('projects', () => {
  it('members read their project; non-members cannot read it or its tickets', async () => {
    await assertSucceeds(getDoc(doc(as('dev'), 'projects/p1')));
    await assertFails(getDoc(doc(as('dev'), 'projects/p2')));
    await assertFails(getDoc(doc(as('dev'), 'projects/p2/tickets/x1')));
    await assertSucceeds(getDoc(doc(as('dev2'), 'projects/p2/tickets/x1')));
  });
  it('workspace admins read every project', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), 'projects/p2/tickets/x1')));
  });
  it('the project list query returns only your projects', async () => {
    await assertSucceeds(getDocs(query(collection(as('dev'), 'projects'), where('memberEmails', 'array-contains', U.dev))));
    await assertFails(getDocs(collection(as('dev'), 'projects')));
    await assertSucceeds(getDocs(collection(as('admin'), 'projects')));
  });
  it('only workspace admins create projects', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'projects/p3'), project('API', 'API', { [U.pm]: 'pm' })));
    await assertFails(setDoc(doc(as('pm'), 'projects/p4'), project('API', 'API', { [U.pm]: 'pm' })));
  });
  it('a project key must be short capitals, and the member list must match', async () => {
    await assertFails(setDoc(doc(as('admin'), 'projects/p5'), project('Bad', 'bad key', {})));
    await assertFails(setDoc(doc(as('admin'), 'projects/p6'), { ...project('X', 'XX', { [U.pm]: 'pm' }), memberEmails: [U.dev] }));
  });
  it('a PM can change members of their project, but not rename it', async () => {
    const members = { [U.pm]: 'pm', [U.dev]: 'qa' };
    await assertSucceeds(updateDoc(doc(as('pm'), 'projects/p1'), { members, memberEmails: Object.keys(members) }));
    await assertFails(updateDoc(doc(as('pm'), 'projects/p1'), { name: 'Renamed' }));
  });
  it('developers cannot change members', async () => {
    const members = { [U.dev]: 'pm' };
    await assertFails(updateDoc(doc(as('dev'), 'projects/p1'), { members, memberEmails: Object.keys(members) }));
  });
  it('projects cannot be deleted, only archived', async () => {
    await assertFails(deleteDoc(doc(as('admin'), 'projects/p1')));
    await assertSucceeds(updateDoc(doc(as('admin'), 'projects/p1'), { status: 'archived' }));
  });
  it('nobody but admins can edit an archived project\'s tickets', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'projects/p1'), { status: 'archived' }));
    await assertFails(updateDoc(doc(as('pm'), T()), { title: 'Changed' }));
    await assertSucceeds(updateDoc(doc(as('admin'), T()), { title: 'Changed' }));
  });
});

/* ------------------------------------------------------------------ */
describe('project requests', () => {
  const req = (by, extra = {}) => ({ name: 'Mobile 2', key: 'MOB', description: 'New app', fromProjectId: 'p1', requestedBy: by, createdAt: serverTimestamp(), status: 'pending', ...extra });
  it('a PM can request a project; a developer cannot', async () => {
    await assertSucceeds(setDoc(doc(as('pm'), 'projectRequests/r1'), req(U.pm)));
    await assertFails(setDoc(doc(as('dev'), 'projectRequests/r2'), req(U.dev)));
  });
  it('requests must be made as yourself, from a project where you have the permission', async () => {
    await assertFails(setDoc(doc(as('pm'), 'projectRequests/r3'), req(U.lead)));
    await assertFails(setDoc(doc(as('pm'), 'projectRequests/r4'), req(U.pm, { fromProjectId: 'p2' })));
  });
  it('only workspace admins approve or decline', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'projectRequests/r1'), req(U.pm)));
    await assertFails(updateDoc(doc(as('pm'), 'projectRequests/r1'), { status: 'approved' }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'projectRequests/r1'), { status: 'approved', decidedBy: U.admin, decidedAt: serverTimestamp(), projectId: 'p9' }));
  });
});

/* ------------------------------------------------------------------ */
describe('roles', () => {
  it('everyone in the workspace can read roles; only admins change them', async () => {
    await assertSucceeds(getDoc(doc(as('viewer'), 'roles/developer')));
    await assertFails(updateDoc(doc(as('pm'), 'roles/developer'), { permissions: perms(...ALL) }));
    await assertSucceeds(setDoc(doc(as('admin'), 'roles/designer'), { name: 'Designer', permissions: perms('editTickets', 'comment') }));
  });
  it('changing a role changes what people can do immediately', async () => {
    await assertFails(updateDoc(doc(as('viewer'), T()), { title: 'Edited by viewer' }));
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'roles/viewer'), { permissions: perms('comment', 'editTickets') }));
    await assertSucceeds(updateDoc(doc(as('viewer'), T()), { title: 'Edited by viewer' }));
  });
});

/* ------------------------------------------------------------------ */
describe('creating tickets', () => {
  it('works through the counter transaction, with the project key', async () => {
    await assertSucceeds(createTicket(as('dev'), newTicket(U.dev)));
  });
  it('viewers cannot create tickets', async () => {
    await assertFails(createTicket(as('viewer'), newTicket(U.viewer)));
  });
  it('you cannot create tickets in a project you are not in', async () => {
    await assertFails(createTicket(as('dev'), newTicket(U.dev), { pid: 'p2', key: 'APP' }));
  });
  it('rejects duplicate numbers, impersonation, a non-Backlog start, bad links, long titles, unknown fields', async () => {
    await assertFails(createTicket(as('dev'), newTicket(U.dev), { numberOffset: -1 }));
    await assertFails(createTicket(as('dev'), newTicket(U.dev2)));
    await assertFails(createTicket(as('dev'), newTicket(U.dev, { status: 'done' })));
    await assertFails(createTicket(as('dev'), newTicket(U.dev, { linkUrl: 'javascript:alert(1)' })));
    await assertFails(createTicket(as('dev'), newTicket(U.dev, { title: 'x'.repeat(201) })));
    await assertFails(createTicket(as('dev'), newTicket(U.dev, { isAdmin: true })));
  });
  it('accepts custom type keys but not malformed ones', async () => {
    await assertSucceeds(createTicket(as('dev'), newTicket(U.dev, { type: 'spike' })));
    await assertFails(createTicket(as('dev'), newTicket(U.dev, { type: 'Not A Key!' })));
  });
});

/* ------------------------------------------------------------------ */
describe('editing tickets', () => {
  it('developers edit; viewers cannot', async () => {
    await assertSucceeds(updateDoc(doc(as('dev2'), T()), { title: 'New title', labels: ['bug'] }));
    await assertFails(updateDoc(doc(as('viewer'), T()), { title: 'Nope' }));
  });
  it('id, number, createdBy and createdAt never change', async () => {
    await assertFails(updateDoc(doc(as('admin'), T()), { id: 'TASK-999' }));
    await assertFails(updateDoc(doc(as('admin'), T()), { createdBy: U.admin }));
  });
  it('blockedBy must be the person signed in', async () => {
    await assertSucceeds(updateDoc(doc(as('dev'), T()), { blocked: true, blockedReason: 'Waiting', blockedBy: U.dev }));
    await assertFails(updateDoc(doc(as('dev'), T()), { blockedBy: U.pm }));
  });
});

/* ------------------------------------------------------------------ */
describe('workflow', () => {
  const move = (who, status) => updateDoc(doc(as(who), T()), { status });

  it('In review needs at least one reviewer', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), T()), { reviewers: [] }));
    await assertFails(move('dev', 'in_review'));
  });
  it('a reviewer who is not the owner can close', async () => {
    await assertSucceeds(move('dev2', 'done'));
  });
  it('the owner cannot close their own ticket, even as a reviewer', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), T()), { reviewers: [U.dev] }));
    await assertFails(move('dev', 'done'));
  });
  it('roles with "close any ticket" (PM, Tech lead) can close; QA without it cannot', async () => {
    await assertFails(move('qa', 'done'));
    await assertSucceeds(move('lead', 'done'));
    await assertSucceeds(move('pm', 'backlog'));
  });
  it('old stage names cannot be moved into', async () => {
    await assertFails(move('admin', 'testing'));
  });
  it('the Definition of Done blocks closing until ticked — even for admins', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'projects/p1/config/settings'), { dodItems: [{ id: 'tests', text: 'Tests' }], dodRequired: ['tests'] }));
    await assertFails(move('admin', 'done'));
    await assertSucceeds(updateDoc(doc(as('dev2'), T()), { status: 'done', dod: { tests: true } }));
  });
});

/* ------------------------------------------------------------------ */
describe('archive and delete', () => {
  const archive = (who) => updateDoc(doc(as(who), T()), { archived: true, archivedBy: U[who], archivedAt: serverTimestamp() });
  it('developers cannot archive; tech leads can', async () => {
    await assertFails(archive('dev'));
    await assertSucceeds(archive('lead'));
  });
  it('only workspace admins delete, and only archived tickets', async () => {
    await assertFails(deleteDoc(doc(as('admin'), T())));
    await archive('pm');
    await assertFails(deleteDoc(doc(as('pm'), T())));
    await assertSucceeds(deleteDoc(doc(as('admin'), T())));
  });
  it('a PM can bulk-archive and restore in one batch', async () => {
    const db = as('pm');
    const batch = writeBatch(db);
    batch.update(doc(db, T()), { archived: true, archivedBy: U.pm, archivedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
    await assertSucceeds(updateDoc(doc(db, T()), { archived: false, archivedBy: deleteField(), archivedAt: deleteField() }));
  });
});

/* ------------------------------------------------------------------ */
describe('comments, mentions and activity', () => {
  const comment = (who) => doc(as(who), `${T()}/comments/c1`);
  it('viewers can comment (as themselves)', async () => {
    await assertSucceeds(addDoc(collection(as('viewer'), `${T()}/comments`), { text: 'Looks good', author: U.viewer, createdAt: serverTimestamp(), mentions: [U.dev] }));
    await assertFails(addDoc(collection(as('viewer'), `${T()}/comments`), { text: 'Hi', author: U.dev, createdAt: serverTimestamp() }));
  });
  it('authors edit their own comment; others cannot', async () => {
    await assertSucceeds(updateDoc(comment('dev'), { text: 'Edited', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(comment('dev2'), { text: 'Hijacked', editedAt: serverTimestamp() }));
  });
  it('moderators (tech lead) can hide; developers cannot', async () => {
    await assertFails(updateDoc(comment('dev2'), { hidden: true, hiddenBy: U.dev2, hiddenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(comment('lead'), { hidden: true, hiddenBy: U.lead, hiddenAt: serverTimestamp() }));
  });
  it('the activity log is append-only and written as yourself', async () => {
    await assertSucceeds(addDoc(collection(as('dev'), `${T()}/activity`), { type: 'edit', summary: 'title', actor: U.dev, createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(as('dev'), `${T()}/activity`), { type: 'edit', actor: U.admin, createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as('admin'), `${T()}/activity/a1`), { type: 'edit' }));
    await assertFails(deleteDoc(doc(as('admin'), `${T()}/activity/a1`)));
  });
});

/* ------------------------------------------------------------------ */
describe('sprints and templates', () => {
  const sprint = { name: 'Sprint 1', goal: '', start: '2026-10-05', end: '2026-10-18', status: 'active', createdBy: U.lead, createdAt: serverTimestamp() };
  const template = { name: 'Bug', type: 'bug', priority: 'high', labels: [], reviewers: [], description: '## Steps', order: 1, enabled: true };
  it('tech leads manage sprints; developers cannot', async () => {
    await assertSucceeds(setDoc(doc(as('lead'), 'projects/p1/sprints/s1'), sprint));
    await assertFails(setDoc(doc(as('dev'), 'projects/p1/sprints/s2'), sprint));
  });
  it('a sprint must end on or after it starts', async () => {
    await assertFails(setDoc(doc(as('pm'), 'projects/p1/sprints/s3'), { ...sprint, start: '2026-10-18', end: '2026-10-05' }));
  });
  it('tech leads and PMs manage templates; developers read them', async () => {
    await assertSucceeds(setDoc(doc(as('lead'), 'projects/p1/templates/bug'), template));
    await assertFails(setDoc(doc(as('dev'), 'projects/p1/templates/x'), template));
    await assertSucceeds(getDoc(doc(as('dev'), 'projects/p1/templates/bug')));
  });
});

/* ------------------------------------------------------------------ */
describe('project settings', () => {
  const S = (who) => doc(as(who), 'projects/p1/config/settings');
  it('members can read settings; outsiders and non-members cannot', async () => {
    await assertSucceeds(getDoc(S('viewer')));
    await assertFails(getDoc(S('outsider')));
    await assertFails(getDoc(doc(as('dev'), 'projects/p2/config/settings')));
  });
  it('labels and types need "manage content" (tech lead yes, developer no)', async () => {
    await assertSucceeds(updateDoc(S('lead'), { labels: [{ name: 'frontend', color: 'pink' }], types: [{ key: 'spike', label: 'Spike' }] }));
    await assertFails(updateDoc(S('dev'), { labels: [] }));
  });
  it('workflow settings need "manage workflow" (PM yes, tech lead no)', async () => {
    await assertSucceeds(updateDoc(S('pm'), { staleDays: 3, dodItems: [{ id: 'd', text: 'Docs' }], dodRequired: ['d'] }));
    await assertFails(updateDoc(S('lead'), { staleDays: 9 }));
  });
  it('integrations need "manage integrations", and the webhook must be Discord', async () => {
    await assertFails(updateDoc(S('lead'), { weeklySummary: true }));
    await assertSucceeds(updateDoc(S('pm'), { weeklySummary: true }));
    await assertFails(updateDoc(S('admin'), { discordWebhookUrl: 'https://evil.example/collect' }));
  });
});

/* ------------------------------------------------------------------ */
describe('notifications', () => {
  const note = (by, to, extra = {}) => ({ to, by, type: 'mention', projectId: 'p1', ticketFid: 't1', ticketId: 'TASK-001', ticketTitle: 'Fix login', text: 'Can you check?', createdAt: serverTimestamp(), read: false, ...extra });
  it('sent as yourself, to a workspace member', async () => {
    await assertSucceeds(setDoc(doc(as('dev'), 'notifications/n1'), note(U.dev, U.dev2)));
    await assertFails(setDoc(doc(as('dev'), 'notifications/n2'), note(U.pm, U.dev2)));
    await assertFails(setDoc(doc(as('dev'), 'notifications/n3'), note(U.dev, 'stranger@x.dev')));
  });
  it('only the recipient reads them or marks them read', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'notifications/n1'), note(U.dev, U.dev2)));
    await assertSucceeds(getDoc(doc(as('dev2'), 'notifications/n1')));
    await assertFails(getDoc(doc(as('pm'), 'notifications/n1')));
    await assertSucceeds(updateDoc(doc(as('dev2'), 'notifications/n1'), { read: true }));
    await assertFails(updateDoc(doc(as('dev2'), 'notifications/n1'), { text: 'changed' }));
  });
});

/* ------------------------------------------------------------------ */
describe('workspace members and profiles', () => {
  it('only admins add people, with a known workspace role', async () => {
    await assertFails(setDoc(doc(as('pm'), 'allowlist', 'new@team.dev'), { role: 'member' }));
    await assertFails(setDoc(doc(as('admin'), 'allowlist', 'new@team.dev'), { role: 'superuser' }));
    await assertSucceeds(setDoc(doc(as('admin'), 'allowlist', 'new@team.dev'), { role: 'member', addedBy: U.admin, addedAt: serverTimestamp() }));
  });
  it('members cannot promote themselves', async () => {
    await assertFails(updateDoc(doc(as('dev'), 'allowlist', U.dev), { role: 'admin' }));
  });
  it('people write only their own profile', async () => {
    await assertSucceeds(setDoc(doc(as('dev'), 'profiles', U.dev), { name: 'Dev One', title: 'Frontend developer', availability: 'busy' }));
    await assertFails(setDoc(doc(as('dev'), 'profiles', U.dev2), { name: 'Impersonated' }));
    await assertFails(setDoc(doc(as('dev'), 'profiles', U.dev), { availability: 'on the moon' }));
  });
});

/* ------------------------------------------------------------------ */
describe('upgrading from the single-board version', () => {
  it('the old collections are read-only', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'tickets/old1'), { title: 'Old', status: 'done', priority: 'low' }));
    await assertSucceeds(getDoc(doc(as('dev'), 'tickets/old1')));
    await assertFails(updateDoc(doc(as('admin'), 'tickets/old1'), { title: 'Changed' }));
    await assertFails(setDoc(doc(as('admin'), 'tickets/new1'), { title: 'New' }));
  });
  it('while a project is marked "migrating", an admin can copy old tickets, comments and activity as-is', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'projects/p1'), { migrating: true }));
    const db = as('admin');
    await assertSucceeds(setDoc(doc(db, T('p1', 'old1')), { ...newTicket(U.dev, { status: 'done', owner: U.dev }), id: 'TASK-050', number: 50 }));
    await assertSucceeds(setDoc(doc(db, `${T('p1', 'old1')}/comments/c9`), { text: 'Old comment', author: U.dev, createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, `${T('p1', 'old1')}/activity/a9`), { type: 'created', actor: U.dev, createdAt: serverTimestamp() }));
  });
  it('without the flag, copying as someone else is refused', async () => {
    await assertFails(setDoc(doc(as('admin'), `${T()}/activity/a9`), { type: 'created', actor: U.dev, createdAt: serverTimestamp() }));
  });
});
