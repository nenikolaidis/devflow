/* =========================================================
   features/manage/members.js — Manage → Members.

   Project members (needs "manage members", or workspace admin):
     who is in the current project and their role; add or remove.
   Workspace people (workspace admins only):
     access requests (approve into the workspace, optionally straight into
     this project), everyone in the workspace, admin/member, remove — and
     the tools for helping someone get in: who's trying to get in and where
     they're stuck, when people last signed in, a password reset email,
     and a ready-made invite to paste to them.
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { DEFAULT_MEMBER_ROLE, WORKSPACE_ROLES } from '../../core/constants.js';
import { isAdmin, can, isMe, normEmail, roleName } from '../../core/permissions.js';
import { displayName, avatarHtml, availabilityBadge } from '../../core/people.js';
import { showToast, confirmDialog, copyText } from '../../core/ui.js';
import { timeAgo } from '../../core/format.js';
import * as api from '../../data/api.js';
import { openProfileModal } from '../profiles.js';
import { sectionHead, noProject, attempt } from './common.js';

function sortedRoles(){
  return Object.entries(state.roles).map(([id, r]) => ({ id, ...r })).sort((a, b) => (a.order || 99) - (b.order || 99));
}
function roleOptions(selected){
  return sortedRoles().map(r => html`<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${r.name}</option>`);
}

export function renderMembers(root){
  const canProject = state.project && (isAdmin() || can('manageMembers'));
  const p = state.project;
  const members = p ? Object.entries(p.members || {}).sort((a, b) => displayName(a[0]).localeCompare(displayName(b[0]))) : [];
  const outside = state.allowlist.map(u => u.id).filter(e => !(p && p.members && p.members[e])).sort();

  root.innerHTML = html`
    ${sectionHead('Members', 'Who works on this project, and what their role lets them do. Roles are defined in Roles.')}
    ${!p ? noProject() : !canProject ? '' : html`
      <div class="card-section">
        <h3>${p.name} members <span class="count-pill">${members.length}</span></h3>
        <div class="row-list" id="projectMembers">
          ${members.map(([email, roleId]) => html`
            <div class="allow-row" data-email="${email}">
              ${avatarHtml(email, 32)}
              <span class="em"><span class="member-name">${displayName(email)}${isMe(email) ? ' (you)' : ''}</span><span class="member-meta">${email} · ${availabilityBadge(email)}</span></span>
              <select class="memberRole" aria-label="Role for ${email} in ${p.name}">${roleOptions(roleId)}</select>
              <button type="button" class="ghost small" data-action="remove" aria-label="Remove ${email} from ${p.name}">Remove</button>
            </div>`)}
          ${members.length === 0 ? html`<div class="empty-note">No members yet.</div>` : ''}
        </div>
        <div class="add-row">
          <select id="addMemberEmail" aria-label="Person to add">
            <option value="">${outside.length ? 'Add someone from the workspace…' : 'Everyone in the workspace is already in this project'}</option>
            ${outside.map(e => html`<option value="${e}">${displayName(e)}${displayName(e) !== e ? ` (${e})` : ''}</option>`)}
          </select>
          <select id="addMemberRole" aria-label="Their role">${roleOptions(DEFAULT_MEMBER_ROLE)}</select>
          <button type="button" id="addMemberBtn" ${outside.length ? '' : 'disabled'}>Add to project</button>
        </div>
        ${isAdmin() ? '' : html`<p class="field-hint">To bring someone new into devflow, ask a workspace admin.</p>`}
      </div>`}
    ${isAdmin() ? workspacePeopleHtml() : ''}`.toString();

  if(canProject) wireProjectMembers(root);
  if(isAdmin()) wireWorkspacePeople(root);
}

/* ---------------- PROJECT MEMBERS ---------------- */

function wireProjectMembers(root){
  const p = state.project;
  const save = (members, msg) => attempt('Could not update members', async () => { await api.setProjectMembers(p.id, members); showToast(msg, 'success'); });

  root.querySelector('#projectMembers').addEventListener('change', e => {
    if(!e.target.classList.contains('memberRole')) return;
    const email = e.target.closest('.allow-row').dataset.email;
    save({ ...p.members, [email]: e.target.value }, `${displayName(email)} is now ${roleName(e.target.value)} in ${p.name}`);
  });
  root.querySelector('#projectMembers').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action=remove]');
    if(!btn) return;
    const email = btn.closest('.allow-row').dataset.email;
    const open = state.tickets.filter(t => !t.archived && normEmail(t.owner) === email && t.status !== 'done').length;
    const ok = await confirmDialog({
      title: `Remove ${displayName(email)} from ${p.name}?`,
      message: `They'll lose access to this project immediately.${open ? ` They still own ${open} open ticket${open === 1 ? '' : 's'} — reassign ${open === 1 ? 'it' : 'them'} from the board.` : ''}`,
      confirmLabel: 'Remove', danger: true
    });
    if(!ok) return;
    const members = { ...p.members };
    delete members[email];
    save(members, `${displayName(email)} removed from ${p.name}`);
  });
  // Picking a person or role counts as editing, so a live update doesn't reset the choice.
  ['#addMemberEmail', '#addMemberRole'].forEach(sel => root.querySelector(sel).addEventListener('change', () => { root.dataset.dirty = '1'; }));
  root.querySelector('#addMemberBtn').addEventListener('click', () => {
    const email = root.querySelector('#addMemberEmail').value;
    if(!email){ showToast('Choose someone to add'); return; }
    const roleId = root.querySelector('#addMemberRole').value;
    delete root.dataset.dirty; // before saving, so the update that follows redraws the list
    save({ ...p.members, [email]: roleId }, `${displayName(email)} added to ${p.name} as ${roleName(roleId)}`);
  });
}

/* ---------------- WORKSPACE PEOPLE (admins) ---------------- */

/* ---------------- TRYING TO GET IN (admins) ---------------- */
// Each signed-in account reports which step it's at (data/api.js
// setJoinStatus), including before its email is confirmed — so admins see
// people the problem log can't reach yet.
const STUCK_FOR_DAYS = 30;
const STUCK_STEPS = {
  'confirm-email': j => `created an account${j.detail ? ` (${j.detail.replace(/^created /, '')})` : ''} but hasn't confirmed their email — ask them to look in Junk / Spam and click the link, or confirm it for them with the admin tool ("Copy fix")`,
  'waiting-approval': j => `signed in and waiting — ${j.detail || 'hasn\'t pressed Request access'}`,
  'choose-password': () => 'signed in with a temporary password but hasn\'t chosen their own yet'
};

/** The same mailbox, as far as people are concerned: case, "+tags", and Gmail's ignored dots. */
function mailbox(email){
  let [local, domain] = normEmail(email).split('@');
  if(!domain) return normEmail(email);
  local = local.split('+')[0];
  if(domain === 'googlemail.com') domain = 'gmail.com';
  if(domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}
/** An approved address that's the same mailbox as `email` but spelled differently, if any. */
function lookalike(email){
  const twin = state.allowlist.find(u => u.id !== normEmail(email) && mailbox(u.id) === mailbox(email));
  return twin ? twin.id : '';
}

/** People who signed in but haven't made it into devflow, newest first. */
export function stuckPeople(){
  const approved = new Set(state.allowlist.map(u => u.id));
  const requested = new Set(state.accessRequests.map(r => r.id));
  const since = Date.now() - STUCK_FOR_DAYS * 86400000;
  const at = (j) => (j.updatedAt && j.updatedAt.toMillis ? j.updatedAt.toMillis() : Date.now());
  return state.joinStatus
    .filter(j => STUCK_STEPS[j.stage] && at(j) > since)
    .filter(j => !(j.stage === 'waiting-approval' && (approved.has(j.id) || requested.has(j.id))))
    .sort((a, b) => at(b) - at(a));
}

function stuckHtml(){
  const list = stuckPeople();
  if(!list.length) return '';
  const p = state.project;
  return html`
    <div class="card-section">
      <h3>Trying to get in <span class="count-pill">${list.length}</span></h3>
      <p class="field-hint">People who signed in but haven't made it into devflow yet — and where they're stuck.</p>
      <div class="row-list" id="stuckPeople">
        ${list.map(j => { const twin = lookalike(j.id); return html`
          <div class="request-row stuck-row" data-email="${j.id}">
            <span class="em"><span class="member-name">${j.id}</span>
              <span class="member-meta signin-status warn">${STUCK_STEPS[j.stage](j)} · ${timeAgo(j.updatedAt) || 'just now'}</span>
              ${twin ? html`<span class="member-meta lookalike">You added <strong>${twin}</strong>, but they sign in as <strong>${j.id}</strong>. Their mailbox treats these as the same; devflow doesn't. Approve this address (and remove the other).</span>` : ''}</span>
            ${j.stage === 'waiting-approval' ? html`
              ${p ? html`<label class="inline-check"><input type="checkbox" class="addToProject" checked> add to ${p.name} as</label>
                <select class="reqRole" aria-label="Role in ${p.name}">${roleOptions(DEFAULT_MEMBER_ROLE)}</select>` : ''}
              <button type="button" class="primary small" data-action="approve">Approve</button>` : ''}
            ${j.stage === 'confirm-email' ? html`<button type="button" class="ghost small" data-action="copy-fix" title="Copy the admin-tool command that confirms their email">Copy fix</button>` : ''}
            <button type="button" class="ghost small" data-action="dismiss">Dismiss</button>
          </div>`; })}
      </div>
    </div>`;
}

/** When someone last opened devflow — shows at a glance whether a new or returning person actually got in. */
function signInStatus(u){
  const last = state.profiles[u.id] && state.profiles[u.id].lastActive;
  const lastMs = last && last.toMillis ? last.toMillis() : 0;
  const addedMs = u.addedAt && u.addedAt.toMillis ? u.addedAt.toMillis() : 0;
  if(!lastMs) return { text: 'hasn\'t signed in yet', warn: true };
  if(addedMs && lastMs < addedMs) return { text: 'hasn\'t signed in since being added', warn: true };
  return { text: `last opened devflow ${timeAgo(last)}`, warn: false };
}

/** Step-by-step joining instructions to paste into an email or chat. */
function inviteText(email){
  const projects = state.projects.filter(pr => pr.members && pr.members[email] && pr.status !== 'archived').map(pr => pr.name);
  return [
    `Hi! You've been added to devflow${projects.length ? ` (${projects.join(', ')})` : ''}.`,
    '',
    `1. Open ${location.origin}/`,
    `2. Log in with ${email}. No account yet? Choose "Create account" with this email.`,
    '3. New accounts get a confirmation email: click the link in it (check Junk / Spam), then press "I\'ve confirmed it — continue".',
    '',
    'Forgot your password? Use "Forgot password?" on the sign-in screen.',
    'If it says "Can\'t reach devflow", turn off ad blockers, VPN or iCloud Private Relay, or try another browser.'
  ].join('\n');
}

function workspacePeopleHtml(){
  const p = state.project;
  const people = [...state.allowlist].sort((a, b) => displayName(a.id).localeCompare(displayName(b.id)));
  return html`
    ${stuckHtml()}
    <div class="card-section">
      <h3>Access requests <span class="count-pill">${state.accessRequests.length}</span></h3>
      <div class="row-list" id="accessRequests">
        ${state.accessRequests.map(r => html`
          <div class="request-row" data-email="${r.id}">
            <span class="em">${r.id}</span>
            ${p ? html`<label class="inline-check"><input type="checkbox" class="addToProject" checked> add to ${p.name} as</label>
              <select class="reqRole" aria-label="Role in ${p.name}">${roleOptions(DEFAULT_MEMBER_ROLE)}</select>` : ''}
            <button type="button" class="primary small" data-action="approve">Approve</button>
            <button type="button" class="ghost small" data-action="deny">Deny</button>
          </div>`)}
        ${state.accessRequests.length === 0 ? html`<div class="empty-note">No one is waiting to join.</div>` : ''}
      </div>
    </div>
    <div class="card-section">
      <h3>Everyone in the workspace <span class="count-pill">${people.length}</span></h3>
      <p class="field-hint">Workspace admins can do everything in every project. Members get the role they're given in each project.</p>
      <div class="row-list" id="workspacePeople">
        ${people.map(u => { const status = signInStatus(u); return html`
          <div class="allow-row" data-email="${u.id}">
            ${avatarHtml(u.id, 32)}
            <span class="em"><span class="member-name">${displayName(u.id)}${isMe(u.id) ? ' (you)' : ''}</span>
              <span class="member-meta">${u.id} · ${state.projects.filter(pr => pr.members && pr.members[u.id]).map(pr => pr.key).join(', ') || 'no projects'}</span>
              <span class="member-meta signin-status ${status.warn ? 'warn' : ''}">${status.text}</span></span>
            <select class="wsRole" aria-label="Workspace role for ${u.id}" ${isMe(u.id) ? 'disabled' : ''}>
              <option value="member" ${u.role !== 'admin' ? 'selected' : ''}>Member</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Workspace admin</option>
            </select>
            <button type="button" class="ghost small" data-action="view">View</button>
            ${isMe(u.id) ? '' : html`
              <button type="button" class="ghost small" data-action="invite" title="Copy joining instructions to send them">Copy invite</button>
              <button type="button" class="ghost small" data-action="reset" title="Email them a link to choose a new password">Reset password</button>
              <button type="button" class="ghost small" data-action="remove">Remove</button>`}
          </div>`; })}
      </div>
      <div class="add-row">
        <input type="email" id="newPersonEmail" aria-label="Email to add" placeholder="teammate@company.com">
        ${p ? html`<select id="newPersonRole" aria-label="Role in ${p.name}"><option value="">Workspace only</option>${roleOptions(DEFAULT_MEMBER_ROLE)}</select>` : ''}
        <button type="button" id="addPersonBtn">${icon('plus', 14)}Add person</button>
      </div>
      ${p ? html`<p class="field-hint">Choose a role to also add them to ${p.name}.</p>` : ''}
    </div>`;
}

function wireWorkspacePeople(root){
  const p = state.project;
  const addToProject = async (email, roleId) => {
    if(!p || !roleId) return;
    await api.setProjectMembers(p.id, { ...p.members, [email]: roleId });
  };

  root.querySelector('#accessRequests').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const row = btn.closest('.request-row');
    const email = row.dataset.email;
    if(btn.dataset.action === 'approve'){
      const roleId = p && row.querySelector('.addToProject') && row.querySelector('.addToProject').checked ? row.querySelector('.reqRole').value : '';
      await attempt('Could not approve', async () => {
        await api.addWorkspaceMember(email, WORKSPACE_ROLES.MEMBER);
        await addToProject(email, roleId);
        showToast(`${email} approved${roleId ? ` and added to ${p.name} as ${roleName(roleId)}` : ''}`, 'success');
      });
    }else{
      await attempt('Could not deny', async () => { await api.deleteRequest(email); showToast(`${email} denied`); });
    }
  });

  const stuck = root.querySelector('#stuckPeople');
  if(stuck) stuck.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const row = btn.closest('.stuck-row');
    const email = row.dataset.email;
    if(btn.dataset.action === 'approve'){
      const roleId = p && row.querySelector('.addToProject') && row.querySelector('.addToProject').checked ? row.querySelector('.reqRole').value : '';
      await attempt('Could not approve', async () => {
        await api.addWorkspaceMember(email, WORKSPACE_ROLES.MEMBER);
        await addToProject(email, roleId);
        showToast(`${email} approved${roleId ? ` and added to ${p.name} as ${roleName(roleId)}` : ''} — their page opens devflow by itself`, 'success');
      });
    }
    if(btn.dataset.action === 'copy-fix') copyText(`npm run admin -- verify ${email}`, { done: 'Command copied — run it in Terminal, in the devflow folder (SETUP.md step 13)', title: 'Confirm their email' });
    if(btn.dataset.action === 'dismiss') attempt('Could not dismiss', () => api.dismissJoinStatus(email));
  });

  root.querySelector('#workspacePeople').addEventListener('change', e => {
    if(!e.target.classList.contains('wsRole')) return;
    const email = e.target.closest('.allow-row').dataset.email;
    attempt('Could not change role', async () => {
      await api.setWorkspaceRole(email, e.target.value);
      showToast(`${displayName(email)} is now ${e.target.value === 'admin' ? 'a workspace admin' : 'a member'}`, 'success');
    });
  });
  root.querySelector('#workspacePeople').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const email = btn.closest('.allow-row').dataset.email;
    if(btn.dataset.action === 'view') openProfileModal(email);
    if(btn.dataset.action === 'invite'){
      copyText(inviteText(email), { done: `Invite for ${displayName(email)} copied — paste it into an email or chat`, title: `Invite for ${displayName(email)}` });
    }
    if(btn.dataset.action === 'reset'){
      const ok = await confirmDialog({
        title: `Send ${displayName(email)} a password reset email?`,
        message: `They'll get a link to choose a new password. If it doesn't arrive within a few minutes, they should check Junk / Spam. Nobody can see their password — admins included.`,
        confirmLabel: 'Send email'
      });
      if(ok) attempt('Could not send the email', async () => { await api.sendPasswordReset(email); showToast(`Password reset email sent to ${email}`, 'success'); });
    }
    if(btn.dataset.action === 'remove'){
      const ok = await confirmDialog({
        title: `Remove ${displayName(email)} from devflow?`,
        message: `${email} loses access to every project immediately. Their tickets and comments stay.`,
        confirmLabel: 'Remove', danger: true
      });
      if(ok) attempt('Could not remove', async () => { await api.removeWorkspaceMember(email); showToast(`${email} removed`, 'success'); });
    }
  });

  root.querySelector('#addPersonBtn').addEventListener('click', async () => {
    const email = normEmail(root.querySelector('#newPersonEmail').value);
    if(!email || !email.includes('@')){ showToast('Enter an email address'); return; }
    const roleSel = root.querySelector('#newPersonRole');
    const roleId = roleSel ? roleSel.value : '';
    await attempt('Could not add', async () => {
      await api.addWorkspaceMember(email, WORKSPACE_ROLES.MEMBER);
      await addToProject(email, roleId);
      showToast(`${email} added${roleId ? ` to ${p.name} as ${roleName(roleId)}` : ' to the workspace'} — use "Copy invite" to send them the steps`, 'success');
    });
  });
}
