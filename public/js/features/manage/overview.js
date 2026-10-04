/* =========================================================
   features/manage/overview.js — Manage → Overview.

   - Not upgraded yet (workspace admin): the one-time "Upgrade to
     projects" (or, for a brand-new workspace, "Create your first project")
   - Otherwise: the current project at a glance, plus things waiting for
     an admin (access requests, project requests).
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { isAdmin, myRoleId, roleName } from '../../core/permissions.js';
import { normalizeStatus, STATUS } from '../../core/constants.js';
import { showToast, confirmDialog } from '../../core/ui.js';
import { workspaceStatus, upgradeToProjects, setUpNewWorkspace } from '../../data/upgrade.js';
import { switchProject } from '../../data/sync.js';
import { sectionHead, attempt } from './common.js';

let cachedStatus = null; // { upgraded, hasLegacyData }

export async function renderOverview(root, goTo){
  if(isAdmin() && !state.workspaceMeta){
    root.innerHTML = html`${sectionHead('Overview', '', 'workspace')}<div class="card-section"><p class="muted-text">Checking your workspace…</p></div>`.toString();
    cachedStatus = cachedStatus || await workspaceStatus().catch(() => ({ upgraded: false, hasLegacyData: false }));
    if(!cachedStatus.upgraded) return renderSetup(root, cachedStatus.hasLegacyData);
  }

  const p = state.project;
  const open = state.tickets.filter(t => !t.archived && normalizeStatus(t.status) !== STATUS.DONE).length;
  root.innerHTML = html`
    ${sectionHead('Overview', 'Everything you can manage, in one place. The sections you see depend on your role.', 'workspace')}
    <div class="stat-grid">
      ${p ? html`
        <div class="stat-card"><div class="stat-label">Current project</div><div class="stat-num small-num">${p.key} · ${p.name}</div></div>
        <div class="stat-card"><div class="stat-label">Your role here</div><div class="stat-num small-num">${isAdmin() ? 'Workspace admin' : roleName(myRoleId())}</div></div>
        <div class="stat-card"><div class="stat-label">Members</div><div class="stat-num">${(p.memberEmails || []).length}</div></div>
        <div class="stat-card"><div class="stat-label">Open tickets</div><div class="stat-num">${open}</div></div>` : ''}
      <div class="stat-card"><div class="stat-label">Your projects</div><div class="stat-num">${state.projects.length}</div></div>
      ${isAdmin() ? html`<div class="stat-card"><div class="stat-label">People in the workspace</div><div class="stat-num">${state.allowlist.length}</div></div>` : ''}
    </div>
    ${isAdmin() && (state.accessRequests.length || state.projectRequests.length) ? html`
      <div class="card-section attention">
        <h3>${icon('inboxIn')}Waiting for you</h3>
        ${state.accessRequests.length ? html`<button type="button" class="link" data-go="members">${state.accessRequests.length} ${state.accessRequests.length === 1 ? 'person wants' : 'people want'} to join the workspace →</button>` : ''}
        ${state.projectRequests.length ? html`<button type="button" class="link" data-go="projects">${state.projectRequests.length} project ${state.projectRequests.length === 1 ? 'request' : 'requests'} to review →</button>` : ''}
      </div>` : ''}
    ${!p && !isAdmin() ? html`<div class="card-section empty-state"><p>You're not in any project yet. Ask a workspace admin or a project manager to add you.</p></div>` : ''}`.toString();
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.go)));
}

/** First-time setup: upgrade the single board, or create the first project. */
function renderSetup(root, hasLegacyData){
  root.innerHTML = html`
    ${sectionHead('Overview', '', 'workspace')}
    <div class="card-section setup-card">
      <h3>${icon('rocket')}${hasLegacyData ? 'Upgrade to projects' : 'Create your first project'}</h3>
      ${hasLegacyData ? html`
        <p>devflow now supports several projects, each with its own board, sprints, labels, types, templates and settings, and roles you can edit. This moves your current board into the first project:</p>
        <ul class="plain-list">
          <li>Every ticket, comment, activity entry, sprint and setting is copied as-is — same IDs, authors and dates.</li>
          <li>Everyone keeps access: admins and project managers become <strong>Project manager</strong>, developers become <strong>Developer</strong>. You stay a workspace admin.</li>
          <li>The original data isn't deleted — it stays as a read-only backup.</li>
        </ul>` : html`<p>Give your first project a name and a short key. The key starts every ticket ID (for example <code>WEB-001</code>).</p>`}
      <div class="row2">
        <div class="field"><label for="setupName">Project name</label><input type="text" id="setupName" maxlength="60" value="${hasLegacyData ? 'devflow' : ''}" placeholder="Website"></div>
        <div class="field"><label for="setupKey">Key</label><input type="text" id="setupKey" maxlength="10" value="${hasLegacyData ? 'TASK' : ''}" placeholder="WEB" ${hasLegacyData ? 'readonly' : ''}>
          ${hasLegacyData ? html`<p class="field-hint">Kept as <code>TASK</code> so existing ticket IDs don't change.</p>` : ''}</div>
      </div>
      <p class="setup-progress muted-text" id="setupProgress" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button type="button" class="primary" id="setupGo">${hasLegacyData ? 'Upgrade now' : 'Create project'}</button></div>
    </div>`.toString();

  const nameEl = root.querySelector('#setupName');
  const keyEl = root.querySelector('#setupKey');
  if(!hasLegacyData) nameEl.addEventListener('input', () => { if(!keyEl.dataset.touched) keyEl.value = suggestKey(nameEl.value); });
  keyEl.addEventListener('input', () => { keyEl.dataset.touched = '1'; keyEl.value = keyEl.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  root.querySelector('#setupGo').addEventListener('click', async e => {
    const name = nameEl.value.trim();
    const key = keyEl.value.trim();
    if(!name){ showToast('Give the project a name'); nameEl.focus(); return; }
    if(!/^[A-Z][A-Z0-9]{1,9}$/.test(key)){ showToast('The key must be 2–10 capital letters or digits, starting with a letter'); keyEl.focus(); return; }
    if(hasLegacyData){
      const ok = await confirmDialog({ title: 'Upgrade to projects?', message: 'This copies your board into the first project. It can take a minute for large boards — keep this tab open until it finishes.', confirmLabel: 'Upgrade' });
      if(!ok) return;
    }
    e.target.disabled = true;
    const progress = root.querySelector('#setupProgress');
    const result = await attempt(hasLegacyData ? 'Upgrade failed' : 'Could not create the project', () =>
      hasLegacyData ? upgradeToProjects({ name, key, onProgress: msg => { progress.textContent = msg; } }) : setUpNewWorkspace({ name, key }));
    e.target.disabled = false;
    if(!result){ progress.textContent = ''; return; }
    cachedStatus = { upgraded: true, hasLegacyData: false };
    const pid = typeof result === 'string' ? result : result.projectId;
    showToast(hasLegacyData
      ? `Upgrade complete: ${result.tickets} tickets, ${result.comments} comments, ${result.activity} activity entries and ${result.sprints} sprints moved into ${name}.`
      : `${name} created`, 'success');
    setTimeout(() => switchProject(pid), 300);
  });
}

/** "Mobile app" → "MOB". */
export function suggestKey(name){
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if(!words.length) return '';
  const key = words.length > 1 ? words.map(w => w[0]).join('') : words[0].slice(0, 3);
  return (/^[A-Z]/.test(key) ? key : 'P' + key).slice(0, 10);
}
