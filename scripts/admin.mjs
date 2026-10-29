#!/usr/bin/env node
/* =========================================================
   scripts/admin.mjs — account rescue for workspace admins, run on your
   own computer. Does what a browser isn't allowed to (only Firebase's
   server-side tools can change someone else's account), for free —
   no Blaze plan or Cloud Functions.

     npm run admin -- check <email>          everything about one person: account, approval, projects, last sign-in
     npm run admin -- list                   every account and whether it can get into devflow
     npm run admin -- set-password <email>   give them a temporary password; devflow makes them choose their own
     npm run admin -- verify <email>         mark their email as confirmed (when the email never arrives)
     npm run admin -- disable <email>        stop them signing in at all (keeps the account)
     npm run admin -- enable <email>         undo disable
     npm run admin -- delete <email>         delete the sign-in account (asks you to type the email first)

   Options: --key <path> (default: ~/.config/devflow/admin-key.json, or
   $DEVFLOW_ADMIN_KEY), --yes (skip the confirmation for delete).

   It needs a private key for a service account with the roles
   "Firebase Authentication Admin" and "Cloud Datastore User" — see
   SETUP.md → Admin tool. Keep that file OUTSIDE the repository and never
   share it: it can change any account.

   Changes are recorded in Manage → Logs → Admin actions. Temporary
   passwords are printed once, here, and stored nowhere.

   Against the local emulators (tests): FIREBASE_AUTH_EMULATOR_HOST and
   FIRESTORE_EMULATOR_HOST set, project "demo-devflow", no key needed.
========================================================= */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const COMMANDS = ['check', 'list', 'set-password', 'verify', 'disable', 'enable', 'delete'];
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const [command, rawEmail] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--key');
const email = (rawEmail || '').trim().toLowerCase();

function usage(message){
  if(message) console.error(`\n  ${message}\n`);
  console.error(`  Usage: npm run admin -- <${COMMANDS.join(' | ')}> [email] [--key <path>] [--yes]\n`);
  process.exit(1);
}
if(!COMMANDS.includes(command)) usage(command ? `Unknown command "${command}".` : 'Which command?');
if(command !== 'list' && !email.includes('@')) usage(`"${command}" needs an email address.`);

/* ---------------- CONNECT ---------------- */
const KEY_PATH = option('--key') || process.env.DEVFLOW_ADMIN_KEY || join(homedir(), '.config', 'devflow', 'admin-key.json');
const usingEmulators = !!(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);
let operator = 'admin tool';

if(usingEmulators){
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-devflow' });
  console.log('  (local emulators — no real accounts are touched)');
}else{
  if(!existsSync(KEY_PATH)) usage(`No key at ${KEY_PATH}. See SETUP.md → "Admin tool" to create one, or pass --key <path>.`);
  const account = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
  initializeApp({ credential: cert(account), projectId: account.project_id });
  operator = `admin tool (${account.client_email})`;
  console.log(`  Project: ${account.project_id}`);
}
const auth = getAuth();
const db = getFirestore();

/* ---------------- HELPERS ---------------- */
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');
const millis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

async function findUser(address){
  try{ return await auth.getUserByEmail(address); }
  catch(e){ if(e.code === 'auth/user-not-found') return null; throw e; }
}
async function requireUser(address){
  const user = await findUser(address);
  if(!user){
    console.error(`\n  No sign-in account for ${address}.\n  They need to choose "Create account" on the sign-in screen first (with exactly this email).\n`);
    process.exit(2);
  }
  return user;
}

/** Records the action in Manage → Logs → Admin actions. Never includes the password. */
async function logAction(type, message, target){
  await db.collection('logs').add({
    kind: 'admin', type, message, target, email: operator, page: 'admin tool', browser: 'admin tool (node)',
    count: 1, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86400000)
  });
}

/** 3 groups of 4 from letters and digits that can't be confused (no 0/O, 1/l/I), with at least one of each kind. */
function temporaryPassword(){
  const sets = ['ABCDEFGHJKMNPQRSTUVWXYZ', 'abcdefghjkmnpqrstuvwxyz', '23456789'];
  const all = sets.join('');
  for(;;){
    const chars = Array.from({ length: 12 }, () => all[randomInt(all.length)]);
    if(sets.every(set => chars.some(c => set.includes(c)))) return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
  }
}

async function devflowAccess(address){
  const [allow, request, profile, projects, reset] = await Promise.all([
    db.doc(`allowlist/${address}`).get(),
    db.doc(`accessRequests/${address}`).get(),
    db.doc(`profiles/${address}`).get(),
    db.collection('projects').where('memberEmails', 'array-contains', address).get(),
    db.doc(`passwordResets/${address}`).get()
  ]);
  return { allow, request, profile, projects: projects.docs.map(d => d.data()), reset };
}

/* ---------------- COMMANDS ---------------- */
async function check(){
  const user = await findUser(email);
  const { allow, request, profile, projects, reset } = await devflowAccess(email);
  const lastOpened = millis(profile.exists && profile.data().lastActive);
  const added = millis(allow.exists && allow.data().addedAt);
  console.log(`\n  ${email}`);
  console.log(`  Sign-in account  ${user ? `exists · email ${user.emailVerified ? 'confirmed' : 'NOT confirmed'} · ${user.disabled ? 'DISABLED' : 'enabled'}` : 'NONE — they need to "Create account" first'}`);
  if(user) console.log(`  Created          ${when(user.metadata.creationTime)} · last sign-in ${when(user.metadata.lastSignInTime)}`);
  console.log(`  devflow access   ${allow.exists ? (allow.data().role === 'admin' ? 'Workspace admin' : 'Member') : 'NOT approved'}${request.exists ? ' · access request waiting' : ''}`);
  console.log(`  Projects         ${projects.length ? projects.map(p => `${p.key} (${p.members[email]})`).join(', ') : 'none'}`);
  console.log(`  Last opened app  ${lastOpened ? new Date(lastOpened).toLocaleString() : 'never'}${added && lastOpened && lastOpened < added ? ' — not since being added' : ''}`);
  if(reset.exists) console.log('  Password         temporary — they\'ll be asked to choose their own');

  const advice = [];
  if(!user) advice.push('Ask them to choose "Create account" with exactly this email.');
  else{
    if(user.disabled) advice.push(`Their account is disabled: npm run admin -- enable ${email}`);
    if(!user.emailVerified) advice.push(`Their email isn't confirmed. If the email never arrived: npm run admin -- verify ${email}`);
  }
  if(!allow.exists) advice.push(request.exists ? 'Approve their request in Manage → Members.' : 'Add them in Manage → Members → Add a person by email.');
  else if(!projects.length && allow.data().role !== 'admin') advice.push('They\'re approved but in no project: add them to one in Manage → Members.');
  if(advice.length) console.log(`\n  What to do:\n${advice.map(a => `   • ${a}`).join('\n')}\n`);
  else if(!lastOpened) console.log('\n  Their account looks right, but they haven\'t got in yet. Check Manage → Logs → Problems for them\n  (e.g. "Can\'t reach devflow"), or give them a temporary password: npm run admin -- set-password ' + email + '\n');
  else console.log('\n  All good: they can sign in.\n');
}

async function list(){
  const users = [];
  let page;
  do{ const res = await auth.listUsers(1000, page); users.push(...res.users); page = res.pageToken; }while(page);
  const allow = new Map((await db.collection('allowlist').get()).docs.map(d => [d.id, d.data().role]));
  const requests = new Set((await db.collection('accessRequests').get()).docs.map(d => d.id));
  const rows = users.map(u => {
    const e = (u.email || '').toLowerCase();
    const access = allow.has(e) ? (allow.get(e) === 'admin' ? 'admin' : 'member') : requests.has(e) ? 'request waiting' : 'not approved';
    return [e || u.uid, u.emailVerified ? 'yes' : 'NO', u.disabled ? 'DISABLED' : '', access, when(u.metadata.lastSignInTime)];
  });
  allow.forEach((role, e) => { if(!users.some(u => (u.email || '').toLowerCase() === e)) rows.push([e, '—', '', `${role} · NO ACCOUNT YET`, 'never']); });
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const head = ['Email', 'Confirmed', '', 'devflow access', 'Last sign-in'];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = (r) => '  ' + r.map((c, i) => String(c).padEnd(width[i])).join('  ');
  console.log('\n' + line(head) + '\n' + line(width.map(w => '-'.repeat(w))) + '\n' + rows.map(line).join('\n') + `\n\n  ${users.length} accounts\n`);
}

async function setPassword(){
  const user = await requireUser(email);
  const password = temporaryPassword();
  await auth.updateUser(user.uid, { password });
  await auth.revokeRefreshTokens(user.uid); // signs them out everywhere
  await db.doc(`passwordResets/${email}`).set({ requiredAt: FieldValue.serverTimestamp(), by: operator });
  await logAction('account-temp-password', `Temporary password set for ${email} (they choose their own at next sign-in)`, email);
  console.log(`\n  Temporary password for ${email}:\n\n      ${password}\n`);
  console.log('  Send it to them privately (not in a group chat). When they sign in with it,');
  console.log('  devflow asks them to choose their own password. They\'ve been signed out everywhere.\n');
}

async function setFlag(fields, type, message){
  const user = await requireUser(email);
  await auth.updateUser(user.uid, fields);
  if(fields.disabled) await auth.revokeRefreshTokens(user.uid);
  await logAction(type, message, email);
  console.log(`\n  Done: ${message}\n`);
}

async function remove(){
  const user = await requireUser(email);
  if(!flag('--yes')){
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`\n  This deletes the sign-in account of ${email} for good.\n  Their tickets and comments stay; remove them from devflow in Manage → Members too.\n  Type the email to confirm: `)).trim().toLowerCase();
    rl.close();
    if(typed !== email){ console.log('\n  Not deleted.\n'); process.exit(1); }
  }
  await auth.deleteUser(user.uid);
  await db.doc(`passwordResets/${email}`).delete().catch(() => {});
  await logAction('account-deleted', `Sign-in account of ${email} deleted`, email);
  console.log(`\n  Deleted the sign-in account of ${email}. They can "Create account" again later if needed.\n`);
}

try{
  if(command === 'check') await check();
  if(command === 'list') await list();
  if(command === 'set-password') await setPassword();
  if(command === 'verify') await setFlag({ emailVerified: true }, 'account-verified', `Email of ${email} marked as confirmed`);
  if(command === 'disable') await setFlag({ disabled: true }, 'account-disabled', `Sign-in disabled for ${email}`);
  if(command === 'enable') await setFlag({ disabled: false }, 'account-enabled', `Sign-in enabled again for ${email}`);
  if(command === 'delete') await remove();
}catch(e){
  console.error(`\n  Failed: ${e.message}\n`);
  if(/permission|PERMISSION_DENIED|insufficient/i.test(e.message)) console.error('  The key\'s service account needs the roles "Firebase Authentication Admin" and "Cloud Datastore User" (SETUP.md → Admin tool).\n');
  process.exit(1);
}
process.exit(0);
