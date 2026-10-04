/* =========================================================
   features/manage/members.js — Manage → Members.

   Project members (needs "manage members", or workspace admin):
     who is in the current project and their role; add or remove.
   Workspace people (workspace admins only):
     access requests (approve into the workspace, optionally straight into
     this project), everyone in the workspace, admin/member, remove.
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { DEFAULT_MEMBER_ROLE, WORKSPACE_ROLES } from '../../core/constants.js';
import { isAdmin, can, isMe, normEmail, roleName } from '../../core/permissions.js';
import { displayName, avatarHtml, availabilityBadge } from '../../core/people.js';
import { showToast, confirmDialog } from '../../core/ui.js';
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

function workspacePeopleHtml(){
  const p = state.project;
  const people = [...state.allowlist].sort((a, b) => displayName(a.id).localeCompare(displayName(b.id)));
  return html`
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
        ${people.map(u => html`
          <div class="allow-row" data-email="${u.id}">
            ${avatarHtml(u.id, 32)}
            <span class="em"><span class="member-name">${displayName(u.id)}${isMe(u.id) ? ' (you)' : ''}</span>
              <span class="member-meta">${u.id} · ${state.projects.filter(pr => pr.members && pr.members[u.id]).map(pr => pr.key).join(', ') || 'no projects'}</span></span>
            <select class="wsRole" aria-label="Workspace role for ${u.id}" ${isMe(u.id) ? 'disabled' : ''}>
              <option value="member" ${u.role !== 'admin' ? 'selected' : ''}>Member</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Workspace admin</option>
            </select>
            <button type="button" class="ghost small" data-action="view">View</button>
            ${isMe(u.id) ? '' : html`<button type="button" class="ghost small" data-action="remove">Remove</button>`}
          </div>`)}
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
      showToast(`${email} added${roleId ? ` to ${p.name} as ${roleName(roleId)}` : ' to the workspace'}`, 'success');
    });
  });
}
