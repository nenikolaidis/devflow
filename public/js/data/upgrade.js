/* =========================================================
   data/upgrade.js — moving a workspace from the single-board layout to
   projects, and setting up a brand-new workspace.

   Upgrade (run once, by a workspace admin, from Manage → Overview):
     1. create the built-in roles (roles/*)
     2. create the first project ("main") marked `migrating`, with every
        current member: old admins/PMs → Project manager, developers →
        Developer
     3. copy settings, sprints, the ticket counter, and every ticket with
        its comments and activity — same ids, authors and dates
     4. check the counts match, clear `migrating`, turn old pm/developer
        workspace roles into "member", record meta/workspace
   The old collections stay untouched (read-only backup). firestore.rules
   only allows copying "as-is" while the project is marked `migrating`.
========================================================= */
import { db, deleteField, serverTime } from './firebase.js';
import { refs, ensureDefaultRoles, createProject, setWorkspaceMeta } from './api.js';
import { state } from '../core/state.js';
import { DEFAULT_TYPES } from '../core/constants.js';

const MAIN = 'main';
const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch

/** Writes [ref, data] pairs in batches. */
async function writeAll(pairs, onProgress){
  for(let i = 0; i < pairs.length; i += BATCH_LIMIT){
    const batch = db.batch();
    pairs.slice(i, i + BATCH_LIMIT).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
    if(onProgress) onProgress(Math.min(i + BATCH_LIMIT, pairs.length), pairs.length);
  }
}

/** { upgraded, hasLegacyData } for the signed-in admin. */
export async function workspaceStatus(){
  const meta = await refs.workspace().get();
  if(meta.exists && meta.data().version >= 2) return { upgraded: true, hasLegacyData: false, meta: meta.data() };
  const [tickets, settings] = await Promise.all([refs.legacy.tickets().limit(1).get(), refs.legacy.settings().get()]);
  return { upgraded: false, hasLegacyData: !tickets.empty || settings.exists, meta: null };
}

/**
 * Copies the single-board data into project "main".
 * @param {{ name: string, key: string, onProgress?: (msg: string) => void }} opts
 * @returns {{ projectId, tickets, comments, activity, sprints }}
 */
export async function upgradeToProjects({ name, key, onProgress = () => {} }){
  onProgress('Creating roles…');
  await ensureDefaultRoles();

  // Everyone currently approved becomes a member of the first project.
  onProgress('Creating the first project…');
  const people = (await db.collection('allowlist').get()).docs.map(d => ({ email: d.id, role: d.data().role }));
  const members = {};
  people.forEach(p => { members[p.email] = (p.role === 'admin' || p.role === 'pm') ? 'pm' : 'developer'; });
  await refs.project(MAIN).set({
    name, key, description: 'Created from the original board when devflow moved to projects.',
    status: 'active', members, memberEmails: Object.keys(members), migrating: true,
    createdBy: state.currentUser.email, createdAt: serverTime()
  });

  // Settings, sprints, counter.
  onProgress('Copying settings and sprints…');
  const [settings, sprints, counters] = await Promise.all([refs.legacy.settings().get(), refs.legacy.sprints().get(), refs.legacy.counters().get()]);
  const pairs = [];
  pairs.push([refs.settings(MAIN), { types: DEFAULT_TYPES, ...(settings.exists ? settings.data() : {}) }]);
  sprints.docs.forEach(d => pairs.push([refs.sprint(d.id, MAIN), d.data()]));

  // Tickets with their comments and activity.
  onProgress('Reading tickets…');
  const tickets = await refs.legacy.tickets().get();
  let maxNumber = counters.exists ? (counters.data().ticketNumber || 0) : 0;
  let commentCount = 0, activityCount = 0;
  for(const t of tickets.docs){
    const data = t.data();
    if(Number.isInteger(data.number)) maxNumber = Math.max(maxNumber, data.number);
    else{ const m = /-(\d+)$/.exec(data.id || ''); if(m) maxNumber = Math.max(maxNumber, parseInt(m[1], 10)); }
    pairs.push([refs.ticket(t.id, MAIN), data]);
    const [comments, activity] = await Promise.all([refs.legacy.sub(t.id, 'comments').get(), refs.legacy.sub(t.id, 'activity').get()]);
    comments.docs.forEach(c => pairs.push([refs.comments(t.id, MAIN).doc(c.id), c.data()]));
    activity.docs.forEach(a => pairs.push([refs.activity(t.id, MAIN).doc(a.id), a.data()]));
    commentCount += comments.size;
    activityCount += activity.size;
  }
  pairs.push([refs.counters(MAIN), { ticketNumber: maxNumber }]);

  onProgress(`Copying ${tickets.size} tickets, ${commentCount} comments and ${activityCount} activity entries…`);
  await writeAll(pairs, (done, total) => onProgress(`Copying… ${done} of ${total} records`));

  // Verify before finishing.
  onProgress('Checking the copy…');
  const copied = await refs.tickets(MAIN).get();
  if(copied.size < tickets.size) throw new Error(`Only ${copied.size} of ${tickets.size} tickets were copied. Nothing has been removed — try again.`);

  // Finish: old workspace roles become "member" (their project role now says what they do).
  onProgress('Finishing…');
  const batch = db.batch();
  people.filter(p => p.role === 'pm' || p.role === 'developer').forEach(p => batch.update(db.collection('allowlist').doc(p.email), { role: 'member' }));
  batch.update(refs.project(MAIN), { migrating: deleteField() });
  await batch.commit();
  await setWorkspaceMeta({ defaultProjectId: MAIN, migratedAt: serverTime(), migratedBy: state.currentUser.email });

  return { projectId: MAIN, tickets: tickets.size, comments: commentCount, activity: activityCount, sprints: sprints.size };
}

/** A brand-new workspace: built-in roles, a first project with me as Project manager, and meta/workspace. */
export async function setUpNewWorkspace({ name, key }){
  await ensureDefaultRoles();
  const pid = await createProject({ name, key, members: { [state.currentUser.email.toLowerCase()]: 'pm' } });
  await setWorkspaceMeta({ defaultProjectId: pid, createdAt: serverTime() });
  return pid;
}
