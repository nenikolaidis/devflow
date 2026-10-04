/* =========================================================
   Security rules tests — run against the local Firestore emulator,
   never against real data.

     npm run test:rules        (needs Java 11+; GitHub Actions has it)

   Each test signs in as a role (admin, pm, dev…) and checks that the
   rules in firestore.rules allow or refuse an operation. If you change
   the rules, add or adjust a test here.
========================================================= */
import { describe, it, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  runTransaction, writeBatch, serverTimestamp, deleteField
} from 'firebase/firestore';

const USERS = {
  admin: 'admin@team.dev',
  pm: 'pm@team.dev',
  dev: 'dev@team.dev',      // owner of the seeded ticket
  dev2: 'dev2@team.dev',    // reviewer of the seeded ticket
  outsider: 'outsider@team.dev'
};
const WEBHOOK = 'https://discord.com/api/webhooks/123456/abcDEF_-123';

let env;

/** Firestore as a signed-in user. verified=false simulates an unconfirmed email. */
function as(who, { verified = true } = {}){
  const email = USERS[who] || who;
  return env.authenticatedContext(email.replace(/\W/g, '_'), { email, email_verified: verified }).firestore();
}
const anonymous = () => env.unauthenticatedContext().firestore();

/** A valid new ticket body (before id/number are added). */
function newTicket(createdBy, extra = {}){
  return {
    title: 'Fix login', description: '', priority: 'medium', dueDate: '', owner: '', reviewer: '',
    linkUrl: '', labels: [], status: 'backlog', archived: false,
    createdBy, createdAt: serverTimestamp(), lastActivityAt: serverTimestamp(), ...extra
  };
}

/** Creates a ticket the way the app does: bump the counter and write the ticket in one transaction. */
function createTicket(db, fields, { numberOffset = 0 } = {}){
  return runTransaction(db, async tx => {
    const counterRef = doc(db, 'meta/counters');
    const snap = await tx.get(counterRef);
    const next = (snap.exists() ? snap.data().ticketNumber : 0) + 1;
    tx.set(counterRef, { ticketNumber: next });
    tx.set(doc(collection(db, 'tickets')), { ...fields, id: `TASK-${String(next).padStart(3, '0')}`, number: next + numberOffset });
  });
}

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
    await setDoc(doc(db, 'allowlist', USERS.admin), { role: 'admin' });
    await setDoc(doc(db, 'allowlist', USERS.pm), { role: 'pm' });
    await setDoc(doc(db, 'allowlist', USERS.dev), { role: 'developer' });
    await setDoc(doc(db, 'allowlist', USERS.dev2), { role: 'developer' });
    await setDoc(doc(db, 'meta/counters'), { ticketNumber: 1 });
    await setDoc(doc(db, 'tickets/t1'), {
      ...newTicket(USERS.dev, { owner: USERS.dev, reviewer: USERS.dev2, status: 'in_progress' }),
      id: 'TASK-001', number: 1
    });
    await setDoc(doc(db, 'tickets/t1/comments/c1'), { text: 'Hello', author: USERS.dev, createdAt: serverTimestamp() });
    await setDoc(doc(db, 'tickets/t1/activity/a1'), { type: 'created', actor: USERS.dev, createdAt: serverTimestamp() });
    await setDoc(doc(db, 'config/settings'), { discordWebhookUrl: WEBHOOK, staleDays: 5, wipLimits: {} });
  });
});

/* ------------------------------------------------------------------ */
describe('who can get in', () => {
  it('signed-out visitors cannot read tickets', async () => {
    await assertFails(getDoc(doc(anonymous(), 'tickets/t1')));
  });
  it('approved users with an unverified email cannot read tickets', async () => {
    await assertFails(getDoc(doc(as('dev', { verified: false }), 'tickets/t1')));
  });
  it('verified users who are not on the allowlist cannot read tickets', async () => {
    await assertFails(getDoc(doc(as('outsider'), 'tickets/t1')));
  });
  it('approved, verified users can read tickets', async () => {
    await assertSucceeds(getDoc(doc(as('dev'), 'tickets/t1')));
  });
  it('outsiders can read their own allowlist entry (to learn they are pending)', async () => {
    await assertSucceeds(getDoc(doc(as('outsider'), 'allowlist', USERS.outsider)));
    await assertFails(getDocs(collection(as('outsider'), 'allowlist')));
  });
});

/* ------------------------------------------------------------------ */
describe('access requests', () => {
  it('a verified outsider can request access for themselves', async () => {
    await assertSucceeds(setDoc(doc(as('outsider'), 'accessRequests', USERS.outsider), { email: USERS.outsider, requestedAt: serverTimestamp() }));
  });
  it('an unverified user cannot request access', async () => {
    await assertFails(setDoc(doc(as('outsider', { verified: false }), 'accessRequests', USERS.outsider), { email: USERS.outsider, requestedAt: serverTimestamp() }));
  });
  it('nobody can request access on behalf of someone else', async () => {
    await assertFails(setDoc(doc(as('outsider'), 'accessRequests', 'victim@team.dev'), { email: 'victim@team.dev', requestedAt: serverTimestamp() }));
  });
});

/* ------------------------------------------------------------------ */
describe('creating tickets', () => {
  it('works through the counter transaction', async () => {
    await assertSucceeds(createTicket(as('dev'), newTicket(USERS.dev)));
  });
  it('fails if the ticket number does not match the counter (duplicate ids)', async () => {
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev), { numberOffset: -1 }));
  });
  it('fails when pretending to be someone else', async () => {
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev2)));
  });
  it('fails if not starting in Backlog', async () => {
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev, { status: 'done' })));
  });
  it('rejects javascript: links', async () => {
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev, { linkUrl: 'javascript:alert(1)' })));
  });
  it('accepts https links', async () => {
    await assertSucceeds(createTicket(as('dev'), newTicket(USERS.dev, { linkUrl: 'https://github.com/x/y/pull/1' })));
  });
  it('rejects titles over 200 characters', async () => {
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev, { title: 'x'.repeat(201) })));
  });
  it('rejects unknown fields', async () => {
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev, { isAdmin: true })));
  });
  it('rejects an invalid priority', async () => {
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev, { priority: 'urgent!!' })));
  });
});

/* ------------------------------------------------------------------ */
describe('editing tickets', () => {
  it('approved users can edit normal fields', async () => {
    await assertSucceeds(updateDoc(doc(as('dev2'), 'tickets/t1'), { title: 'New title', labels: ['bug'] }));
  });
  it('id, number, createdBy and createdAt can never change', async () => {
    const db = as('admin');
    await assertFails(updateDoc(doc(db, 'tickets/t1'), { id: 'TASK-999' }));
    await assertFails(updateDoc(doc(db, 'tickets/t1'), { number: 99 }));
    await assertFails(updateDoc(doc(db, 'tickets/t1'), { createdBy: USERS.admin }));
  });
  it('blockedBy must be the person signed in', async () => {
    await assertSucceeds(updateDoc(doc(as('dev'), 'tickets/t1'), { blocked: true, blockedReason: 'Waiting', blockedBy: USERS.dev }));
    await assertFails(updateDoc(doc(as('dev'), 'tickets/t1'), { blockedBy: USERS.pm }));
  });
});

/* ------------------------------------------------------------------ */
describe('workflow rules', () => {
  const move = (who, status) => updateDoc(doc(as(who), 'tickets/t1'), { status });

  it('In review needs a reviewer', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'tickets/t1'), { reviewer: '' }));
    await assertFails(move('dev', 'in_review'));
  });
  it('moving to In review works when there is a reviewer', async () => {
    await assertSucceeds(move('dev', 'in_review'));
  });
  it('the owner cannot close their own ticket, even by making themselves reviewer', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'tickets/t1'), { reviewer: USERS.dev }));
    await assertFails(move('dev', 'done'));
  });
  it('a developer who is not the reviewer cannot move to Done', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'allowlist', 'dev3@team.dev'), { role: 'developer' }));
    await assertFails(move('dev3@team.dev', 'done'));
  });
  it('the reviewer (not the owner) can move to Done', async () => {
    await assertSucceeds(move('dev2', 'done'));
  });
  it('PMs and admins can move any ticket to Done', async () => {
    await assertSucceeds(move('pm', 'done'));
    await assertSucceeds(move('admin', 'backlog'));
  });
  it('old stage names cannot be moved into', async () => {
    await assertFails(move('admin', 'testing'));
  });
});

/* ------------------------------------------------------------------ */
describe('archive and delete', () => {
  const archive = (who) => updateDoc(doc(as(who), 'tickets/t1'), { archived: true, archivedBy: USERS[who], archivedAt: serverTimestamp() });

  it('developers cannot archive', async () => {
    await assertFails(archive('dev'));
  });
  it('PMs can archive', async () => {
    await assertSucceeds(archive('pm'));
  });
  it('developers cannot edit an archived ticket', async () => {
    await archive('pm');
    await assertFails(updateDoc(doc(as('dev'), 'tickets/t1'), { title: 'Sneaky edit' }));
  });
  it('nobody can delete an active ticket — not even admins', async () => {
    await assertFails(deleteDoc(doc(as('admin'), 'tickets/t1')));
  });
  it('PMs cannot permanently delete, admins can (once archived)', async () => {
    await archive('pm');
    await assertFails(deleteDoc(doc(as('pm'), 'tickets/t1')));
    await assertSucceeds(deleteDoc(doc(as('admin'), 'tickets/t1')));
  });
});

/* ------------------------------------------------------------------ */
describe('comments', () => {
  const comment = (who) => doc(as(who), 'tickets/t1/comments/c1');

  it('approved users post as themselves only', async () => {
    await assertSucceeds(addDoc(collection(as('dev2'), 'tickets/t1/comments'), { text: 'Hi', author: USERS.dev2, createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(as('dev2'), 'tickets/t1/comments'), { text: 'Hi', author: USERS.dev, createdAt: serverTimestamp() }));
  });
  it('comments over 5,000 characters are rejected', async () => {
    await assertFails(addDoc(collection(as('dev'), 'tickets/t1/comments'), { text: 'x'.repeat(5001), author: USERS.dev, createdAt: serverTimestamp() }));
  });
  it('authors can edit their own comment, nobody else can', async () => {
    await assertSucceeds(updateDoc(comment('dev'), { text: 'Edited', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(comment('dev2'), { text: 'Hijacked', editedAt: serverTimestamp() }));
  });
  it('PMs can hide a comment, developers cannot', async () => {
    await assertFails(updateDoc(comment('dev2'), { hidden: true, hiddenBy: USERS.dev2, hiddenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(comment('pm'), { hidden: true, hiddenBy: USERS.pm, hiddenAt: serverTimestamp() }));
  });
  it('authors cannot edit a hidden comment', async () => {
    await updateDoc(comment('pm'), { hidden: true, hiddenBy: USERS.pm, hiddenAt: serverTimestamp() });
    await assertFails(updateDoc(comment('dev'), { text: 'Sneaky', editedAt: serverTimestamp() }));
  });
  it('authors and moderators can delete; others cannot', async () => {
    await assertFails(deleteDoc(comment('dev2')));
    await assertSucceeds(deleteDoc(comment('dev')));
  });
});

/* ------------------------------------------------------------------ */
describe('activity log', () => {
  it('entries can be added as yourself only', async () => {
    await assertSucceeds(addDoc(collection(as('dev'), 'tickets/t1/activity'), { type: 'edit', summary: 'title', actor: USERS.dev, createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(as('dev'), 'tickets/t1/activity'), { type: 'edit', summary: 'title', actor: USERS.admin, createdAt: serverTimestamp() }));
  });
  it('entries can never be edited or deleted, even by admins', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'tickets/t1/activity/a1'), { type: 'edit' }));
    await assertFails(deleteDoc(doc(as('admin'), 'tickets/t1/activity/a1')));
  });
  it('unknown entry types are rejected', async () => {
    await assertFails(addDoc(collection(as('dev'), 'tickets/t1/activity'), { type: 'hacked', actor: USERS.dev, createdAt: serverTimestamp() }));
  });
});

/* ------------------------------------------------------------------ */
describe('ticket counter', () => {
  it('can only go up', async () => {
    await assertFails(setDoc(doc(as('dev'), 'meta/counters'), { ticketNumber: 0 }));
    await assertSucceeds(setDoc(doc(as('dev'), 'meta/counters'), { ticketNumber: 5 }));
  });
});

/* ------------------------------------------------------------------ */
describe('board settings', () => {
  it('approved users can read them (the app needs the webhook to post)', async () => {
    await assertSucceeds(getDoc(doc(as('dev'), 'config/settings')));
    await assertFails(getDoc(doc(as('outsider'), 'config/settings')));
  });
  it('only admins can change them', async () => {
    await assertFails(updateDoc(doc(as('pm'), 'config/settings'), { staleDays: 3 }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'config/settings'), { staleDays: 3 }));
  });
  it('the webhook must be a Discord webhook URL', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'config/settings'), { discordWebhookUrl: 'https://evil.example/collect' }));
  });
});

/* ------------------------------------------------------------------ */
describe('team and profiles', () => {
  it('only admins can approve people, and only with a real role', async () => {
    await assertFails(setDoc(doc(as('pm'), 'allowlist', 'new@team.dev'), { role: 'developer' }));
    await assertFails(setDoc(doc(as('admin'), 'allowlist', 'new@team.dev'), { role: 'superuser' }));
    await assertSucceeds(setDoc(doc(as('admin'), 'allowlist', 'new@team.dev'), { role: 'developer', addedBy: USERS.admin, addedAt: serverTimestamp() }));
  });
  it('developers cannot promote themselves', async () => {
    await assertFails(updateDoc(doc(as('dev'), 'allowlist', USERS.dev), { role: 'admin' }));
  });
  it('people can only write their own profile', async () => {
    await assertSucceeds(setDoc(doc(as('dev'), 'profiles', USERS.dev), { name: 'Dev One', bio: '' }));
    await assertFails(setDoc(doc(as('dev'), 'profiles', USERS.dev2), { name: 'Impersonated' }));
  });
  it('unapproved users cannot write a profile', async () => {
    await assertFails(setDoc(doc(as('outsider'), 'profiles', USERS.outsider), { name: 'Outsider' }));
  });
});

/* ------------------------------------------------------------------ */
describe('batched writes the app uses', () => {
  it('a PM can bulk-archive with one batch', async () => {
    const db = as('pm');
    const batch = writeBatch(db);
    batch.update(doc(db, 'tickets/t1'), { archived: true, archivedBy: USERS.pm, archivedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });
  it('restoring clears archivedBy/archivedAt', async () => {
    const db = as('pm');
    await updateDoc(doc(db, 'tickets/t1'), { archived: true, archivedBy: USERS.pm, archivedAt: serverTimestamp() });
    await assertSucceeds(updateDoc(doc(db, 'tickets/t1'), { archived: false, archivedBy: deleteField(), archivedAt: deleteField() }));
  });
});

/* ------------------------------------------------------------------ */
describe('multiple reviewers', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'allowlist', 'dev3@team.dev'), { role: 'developer' });
      await updateDoc(doc(db, 'tickets/t1'), { reviewer: deleteField(), reviewers: ['dev2@team.dev', 'dev3@team.dev'], status: 'in_review' });
    });
  });
  it('any listed reviewer can move to Done', async () => {
    await assertSucceeds(updateDoc(doc(as('dev3@team.dev'), 'tickets/t1'), { status: 'done' }));
  });
  it('someone not in the list cannot', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'allowlist', 'dev4@team.dev'), { role: 'developer' }));
    await assertFails(updateDoc(doc(as('dev4@team.dev'), 'tickets/t1'), { status: 'done' }));
  });
  it('the owner cannot close even if listed as a reviewer', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'tickets/t1'), { reviewers: [USERS.dev, 'dev3@team.dev'] }));
    await assertFails(updateDoc(doc(as('dev'), 'tickets/t1'), { status: 'done' }));
  });
  it('In review accepts a reviewers list', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'tickets/t1'), { status: 'in_progress' }));
    await assertSucceeds(updateDoc(doc(as('dev'), 'tickets/t1'), { status: 'in_review' }));
  });
  it('In review fails with an empty reviewers list', async () => {
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'tickets/t1'), { status: 'in_progress', reviewers: [] }));
    await assertFails(updateDoc(doc(as('dev'), 'tickets/t1'), { status: 'in_review' }));
  });
  it('more than 5 reviewers is rejected', async () => {
    await assertFails(updateDoc(doc(as('dev'), 'tickets/t1'), { reviewers: ['a@x', 'b@x', 'c@x', 'd@x', 'e@x', 'f@x'] }));
  });
});

/* ------------------------------------------------------------------ */
describe('Definition of Done', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await updateDoc(doc(db, 'config/settings'), { dodItems: [{ id: 'tests', text: 'Tests added' }], dodRequired: ['tests'] });
      await updateDoc(doc(db, 'tickets/t1'), { status: 'in_review' });
    });
  });
  it('blocks Done until every item is ticked — even for admins', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'tickets/t1'), { status: 'done' }));
    await assertFails(updateDoc(doc(as('admin'), 'tickets/t1'), { status: 'done', dod: { tests: false } }));
  });
  it('allows Done once ticked', async () => {
    await assertSucceeds(updateDoc(doc(as('dev2'), 'tickets/t1'), { status: 'done', dod: { tests: true } }));
  });
  it('anyone approved can tick items', async () => {
    await assertSucceeds(updateDoc(doc(as('dev'), 'tickets/t1'), { dod: { tests: true } }));
  });
});

/* ------------------------------------------------------------------ */
describe('ticket types, labels and profiles', () => {
  it('accepts a known type and rejects an unknown one', async () => {
    await assertSucceeds(createTicket(as('dev'), newTicket(USERS.dev, { type: 'research' })));
    await assertFails(createTicket(as('dev'), newTicket(USERS.dev, { type: 'epic-saga' })));
  });
  it('admins can save the label list and Definition of Done', async () => {
    await assertSucceeds(updateDoc(doc(as('admin'), 'config/settings'), {
      labels: [{ name: 'frontend', color: 'pink' }], dodItems: [{ id: 'docs', text: 'Docs updated' }], dodRequired: ['docs']
    }));
    await assertFails(updateDoc(doc(as('pm'), 'config/settings'), { labels: [] }));
  });
  it('profiles accept a job title and a known availability', async () => {
    await assertSucceeds(setDoc(doc(as('dev'), 'profiles', USERS.dev), { name: 'Dev', title: 'Frontend developer', availability: 'busy' }));
    await assertFails(setDoc(doc(as('dev'), 'profiles', USERS.dev), { name: 'Dev', availability: 'on the moon' }));
  });
});

/* ------------------------------------------------------------------ */
describe('sprints', () => {
  const sprint = (extra = {}) => ({ name: 'Sprint 1', goal: 'Ship v1', start: '2026-10-05', end: '2026-10-18', status: 'active', createdBy: USERS.pm, createdAt: serverTimestamp(), ...extra });
  it('PMs and admins can create sprints, developers cannot', async () => {
    await assertSucceeds(setDoc(doc(as('pm'), 'sprints/s1'), sprint()));
    await assertFails(setDoc(doc(as('dev'), 'sprints/s2'), sprint()));
  });
  it('a sprint must end on or after it starts', async () => {
    await assertFails(setDoc(doc(as('admin'), 'sprints/s3'), sprint({ start: '2026-10-18', end: '2026-10-05' })));
  });
  it('everyone approved can read sprints and plan tickets into one', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'sprints/s1'), sprint()));
    await assertSucceeds(getDoc(doc(as('dev'), 'sprints/s1')));
    await assertSucceeds(updateDoc(doc(as('dev'), 'tickets/t1'), { sprintId: 's1' }));
  });
});

/* ------------------------------------------------------------------ */
describe('mentions and notifications', () => {
  const note = (by, to, extra = {}) => ({ to, by, type: 'mention', ticketFid: 't1', ticketId: 'TASK-001', ticketTitle: 'Fix login', text: 'Can you check?', createdAt: serverTimestamp(), read: false, ...extra });
  it('comments can carry a mentions list', async () => {
    await assertSucceeds(addDoc(collection(as('dev'), 'tickets/t1/comments'), { text: '@Dev Two look', author: USERS.dev, createdAt: serverTimestamp(), mentions: [USERS.dev2] }));
  });
  it('you can notify an approved teammate, as yourself', async () => {
    await assertSucceeds(setDoc(doc(as('dev'), 'notifications/n1'), note(USERS.dev, USERS.dev2)));
    await assertFails(setDoc(doc(as('dev'), 'notifications/n2'), note(USERS.pm, USERS.dev2)));        // pretending
    await assertFails(setDoc(doc(as('dev'), 'notifications/n3'), note(USERS.dev, 'stranger@x.dev'))); // not on the team
  });
  it('only the recipient can read or mark it read', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'notifications/n1'), note(USERS.dev, USERS.dev2)));
    await assertSucceeds(getDoc(doc(as('dev2'), 'notifications/n1')));
    await assertFails(getDoc(doc(as('pm'), 'notifications/n1')));
    await assertSucceeds(updateDoc(doc(as('dev2'), 'notifications/n1'), { read: true }));
    await assertFails(updateDoc(doc(as('dev2'), 'notifications/n1'), { text: 'changed' }));
  });
});
