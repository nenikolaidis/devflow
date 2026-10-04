/* =========================================================
   features/manage/projects.js — Manage → Projects.

   Workspace admins: every project (open, edit name/description,
   archive/restore), create a project, and approve or decline requests.
   Roles with "request projects": ask for a new project and follow
   their requests.
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { LIMITS } from '../../core/constants.js';
import { isAdmin, can, myEmail } from '../../core/permissions.js';
import { displayName } from '../../core/people.js';
import { formatDate } from '../../core/format.js';
import { showToast, confirmDialog, openModal } from '../../core/ui.js';
import * as api from '../../data/api.js';
import { switchProject } from '../../data/sync.js';
import { sectionHead, attempt } from './common.js';
import { suggestKey } from './overview.js';

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

function keyTaken(key, exceptId){
  return state.projects.some(p => p.key === key && p.id !== exceptId);
}

export function renderProjects(root){
  const admin = isAdmin();
  const mine = state.projectRequests.filter(r => r.requestedBy === myEmail());
  root.innerHTML = html`
    ${sectionHead('Projects', admin ? 'Every project in the workspace. Each has its own board, sprints, labels, types, templates and settings.' : 'Ask an admin for a new project.', 'workspace')}

    ${admin && state.projectRequests.length ? html`
      <div class="card-section attention">
        <h3>Requests to review <span class="count-pill">${state.projectRequests.length}</span></h3>
        <div class="row-list" id="projectRequests">
          ${state.projectRequests.map(r => html`
            <div class="request-row" data-id="${r.id}">
              <span class="project-key">${r.key}</span>
              <span class="em"><span class="member-name">${r.name}</span>
                <span class="member-meta">Requested by ${displayName(r.requestedBy)}${r.createdAt ? ` · ${formatDate(r.createdAt)}` : ''}${r.description ? ` — ${r.description}` : ''}</span></span>
              <button type="button" class="primary small" data-action="approve">Approve</button>
              <button type="button" class="ghost small" data-action="decline">Decline</button>
            </div>`)}
        </div>
        <p class="field-hint">Approving creates the project with the requester as its Project manager.</p>
      </div>` : ''}

    ${admin ? html`
      <div class="card-section">
        <h3>All projects <span class="count-pill">${state.projects.length}</span></h3>
        <div class="row-list" id="projectList">
          ${state.projects.map(p => html`
            <div class="allow-row ${p.status === 'archived' ? 'is-archived' : ''}" data-id="${p.id}">
              <span class="project-key">${p.key}</span>
              <span class="em"><span class="member-name">${p.name}${p.id === state.projectId ? ' (open)' : ''}${p.status === 'archived' ? ' · archived' : ''}</span>
                <span class="member-meta">${(p.memberEmails || []).length} members${p.description ? ` · ${p.description}` : ''}</span></span>
              ${p.id !== state.projectId ? html`<button type="button" class="ghost small" data-action="open">Open</button>` : ''}
              <button type="button" class="ghost small" data-action="edit">${icon('edit', 14)}Edit</button>
              <button type="button" class="ghost small" data-action="archive">${p.status === 'archived' ? 'Restore' : 'Archive'}</button>
            </div>`)}
          ${state.projects.length === 0 ? html`<div class="empty-note">No projects yet.</div>` : ''}
        </div>
      </div>` : ''}

    <form class="card-section" id="newProjectForm" novalidate>
      <h3>${admin ? 'New project' : 'Request a project'}</h3>
      ${!admin && !can('requestProjects') ? html`<p class="muted-text">Your role in this project can't request new projects.</p>` : html`
        <div class="row2">
          <div class="field"><label for="np-name">Name</label><input type="text" id="np-name" maxlength="${LIMITS.PROJECT_NAME}" placeholder="Mobile app"></div>
          <div class="field"><label for="np-key">Key</label><input type="text" id="np-key" maxlength="10" placeholder="MOB">
            <p class="field-hint">Starts every ticket ID, e.g. <code>MOB-001</code>. 2–10 capitals or digits; can't be changed later.</p></div>
        </div>
        <div class="field"><label for="np-desc">${admin ? 'Description (optional)' : 'Why it\'s needed'}</label>
          <textarea id="np-desc" rows="2" maxlength="${LIMITS.PROJECT_DESCRIPTION}"></textarea></div>
        <div class="modal-actions"><button type="submit" class="primary">${admin ? 'Create project' : 'Send request'}</button></div>`}
    </form>

    ${!admin && mine.length ? html`
      <div class="card-section">
        <h3>Your requests</h3>
        <div class="row-list" id="myRequests">
          ${mine.map(r => html`<div class="request-row" data-id="${r.id}">
            <span class="project-key">${r.key}</span><span class="em">${r.name}</span>
            <span class="sprint-status status-${r.status === 'approved' ? 'active' : r.status === 'pending' ? 'planned' : 'closed'}">${r.status}</span>
            ${r.status === 'pending' ? html`<button type="button" class="ghost small" data-action="withdraw">Withdraw</button>` : ''}
          </div>`)}
        </div>
      </div>` : ''}`.toString();

  wire(root);
}

function wire(root){
  const form = root.querySelector('#newProjectForm');
  const nameEl = form.querySelector('#np-name');
  const keyEl = form.querySelector('#np-key');
  if(nameEl){
    nameEl.addEventListener('input', () => { if(!keyEl.dataset.touched) keyEl.value = suggestKey(nameEl.value); });
    keyEl.addEventListener('input', () => { keyEl.dataset.touched = '1'; keyEl.value = keyEl.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = nameEl.value.trim();
      const key = keyEl.value.trim();
      const description = form.querySelector('#np-desc').value.trim();
      if(!name){ showToast('Give the project a name'); nameEl.focus(); return; }
      if(!KEY_RE.test(key)){ showToast('The key must be 2–10 capital letters or digits, starting with a letter'); keyEl.focus(); return; }
      if(keyTaken(key)){ showToast(`${key} is already used by another project`); keyEl.focus(); return; }
      if(isAdmin()){
        const pid = await attempt('Could not create the project', () => api.createProject({ name, key, description, members: { [myEmail()]: 'pm' } }));
        if(pid){ showToast(`${name} created — you're its Project manager`, 'success'); switchProject(pid); }
      }else{
        const ok = await attempt('Could not send the request', () => api.requestProject({ name, key, description }));
        if(ok !== false){ showToast('Request sent — an admin will review it', 'success'); form.reset(); }
      }
    });
  }

  const requests = root.querySelector('#projectRequests');
  if(requests) requests.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const r = state.projectRequests.find(x => x.id === btn.closest('.request-row').dataset.id);
    if(!r) return;
    if(btn.dataset.action === 'approve'){
      if(keyTaken(r.key)){ showToast(`${r.key} is already used — decline and ask for a different key`); return; }
      const pid = await attempt('Could not approve', () => api.approveProjectRequest(r));
      if(pid) showToast(`${r.name} created with ${displayName(r.requestedBy)} as Project manager`, 'success');
    }else{
      const ok = await confirmDialog({ title: `Decline "${r.name}"?`, message: `${displayName(r.requestedBy)} will see it as declined.`, confirmLabel: 'Decline', danger: true });
      if(ok) attempt('Could not decline', async () => { await api.declineProjectRequest(r); showToast('Request declined'); });
    }
  });

  const list = root.querySelector('#projectList');
  if(list) list.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const p = state.projects.find(x => x.id === btn.closest('.allow-row').dataset.id);
    if(!p) return;
    if(btn.dataset.action === 'open') switchProject(p.id);
    if(btn.dataset.action === 'edit') editProject(p);
    if(btn.dataset.action === 'archive'){
      const archiving = p.status !== 'archived';
      const ok = !archiving || await confirmDialog({
        title: `Archive ${p.name}?`,
        message: 'It becomes read-only for everyone except workspace admins and moves to the bottom of the project list. You can restore it at any time.',
        confirmLabel: 'Archive'
      });
      if(ok) attempt('Could not update the project', async () => {
        await api.updateProject(p.id, { status: archiving ? 'archived' : 'active' });
        showToast(`${p.name} ${archiving ? 'archived' : 'restored'}`, 'success');
      });
    }
  });

  const mine = root.querySelector('#myRequests');
  if(mine) mine.addEventListener('click', e => {
    const btn = e.target.closest('[data-action=withdraw]');
    if(btn) attempt('Could not withdraw', async () => { await api.withdrawProjectRequest(btn.closest('.request-row').dataset.id); showToast('Request withdrawn'); });
  });
}

function editProject(p){
  const m = openModal({
    title: `Edit ${p.name}`,
    size: 'narrow',
    body: html`
      <div class="field"><label for="ep-name">Name</label><input type="text" id="ep-name" maxlength="${LIMITS.PROJECT_NAME}" value="${p.name}"></div>
      <div class="field"><label for="ep-key">Key</label><input type="text" id="ep-key" value="${p.key}" readonly>
        <p class="field-hint">Keys can't change — every ticket ID starts with it.</p></div>
      <div class="field"><label for="ep-desc">Description</label><textarea id="ep-desc" rows="3" maxlength="${LIMITS.PROJECT_DESCRIPTION}">${p.description || ''}</textarea></div>
      <div class="modal-actions"><button type="button" class="ep-cancel">Cancel</button><button type="button" class="primary ep-save">Save</button></div>`
  });
  m.$('.ep-cancel').addEventListener('click', () => m.close());
  m.$('.ep-save').addEventListener('click', async () => {
    const name = m.$('#ep-name').value.trim();
    if(!name){ showToast('Give the project a name'); return; }
    const ok = await attempt('Could not save', () => api.updateProject(p.id, { name, description: m.$('#ep-desc').value.trim() }));
    if(ok !== false){ showToast(`${name} saved`, 'success'); m.close(); }
  });
}
