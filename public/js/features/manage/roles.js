/* =========================================================
   features/manage/roles.js — Manage → Roles (workspace admins).

   Roles are named sets of permissions, shared by every project. Each
   role is a card: name, description, a checkbox per permission. Changes
   apply immediately to everyone with that role, in every project
   (firestore.rules reads the role on every request).
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { PERMISSIONS, DEFAULT_ROLES, LIMITS } from '../../core/constants.js';
import { showToast, confirmDialog, promptDialog } from '../../core/ui.js';
import * as api from '../../data/api.js';
import { sectionHead, attempt, slug } from './common.js';

const GROUPS = [...new Set(PERMISSIONS.map(p => p.group))];

/** How many project memberships use a role. */
function usage(roleId){
  return state.projects.reduce((n, p) => n + Object.values(p.members || {}).filter(r => r === roleId).length, 0);
}

export function renderRoles(root){
  const roles = Object.entries(state.roles).map(([id, r]) => ({ id, ...r })).sort((a, b) => (a.order || 99) - (b.order || 99));
  root.innerHTML = html`
    ${sectionHead('Roles', 'What each role can do in a project. Changes apply straight away, in every project. Workspace admins always have every permission.', 'workspace')}
    ${roles.length === 0 ? html`<div class="card-section empty-state"><p>No roles yet.</p><button type="button" class="primary" id="seedRoles">Create the built-in roles</button></div>` : ''}
    <div class="role-list" id="roleList">
      ${roles.map(r => {
        const count = PERMISSIONS.filter(p => r.permissions && r.permissions[p.key]).length;
        const used = usage(r.id);
        return html`
          <details class="card-section role-card" data-id="${r.id}">
            <summary>
              <span class="role-title">${r.name}</span>
              <span class="muted-text">${count} of ${PERMISSIONS.length} permissions · ${used} ${used === 1 ? 'person' : 'people'}</span>
            </summary>
            <div class="row2">
              <div class="field"><label>Name</label><input type="text" class="role-name" maxlength="${LIMITS.ROLE_NAME}" value="${r.name}"></div>
              <div class="field"><label>Description</label><input type="text" class="role-desc" maxlength="200" value="${r.description || ''}"></div>
            </div>
            ${GROUPS.map(g => html`
              <fieldset class="field perm-group"><legend>${g}</legend>
                ${PERMISSIONS.filter(p => p.group === g).map(p => html`
                  <label class="toggle-row"><input type="checkbox" data-perm="${p.key}" ${r.permissions && r.permissions[p.key] ? 'checked' : ''}><span>${p.label}</span></label>`)}
              </fieldset>`)}
            <div class="modal-actions">
              <button type="button" class="ghost" data-action="delete" ${used ? 'disabled title="People have this role — give them another role first"' : ''}>${icon('trash', 14)}Delete role</button>
              <button type="button" class="primary" data-action="save">Save role</button>
            </div>
          </details>`;
      })}
    </div>
    ${roles.length ? html`<div class="modal-actions"><button type="button" id="addRoleBtn">${icon('plus', 14)}Add a role</button></div>` : ''}`.toString();

  const seed = root.querySelector('#seedRoles');
  if(seed) seed.addEventListener('click', () => attempt('Could not create roles', async () => { await api.ensureDefaultRoles(); showToast('Built-in roles created', 'success'); }));

  root.querySelector('#roleList').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const card = btn.closest('.role-card');
    const id = card.dataset.id;
    if(btn.dataset.action === 'save'){
      const name = card.querySelector('.role-name').value.trim();
      if(!name){ showToast('Give the role a name'); return; }
      const permissions = Object.fromEntries(PERMISSIONS.map(p => [p.key, card.querySelector(`[data-perm="${p.key}"]`).checked]));
      const ok = await attempt('Could not save the role', () => api.saveRole(id, { name, description: card.querySelector('.role-desc').value.trim(), order: state.roles[id].order || 99, permissions }));
      if(ok !== false){ delete root.dataset.dirty; showToast(`${name} saved — applies to everyone with this role`, 'success'); }
    }
    if(btn.dataset.action === 'delete'){
      const ok = await confirmDialog({ title: `Delete ${state.roles[id].name}?`, message: 'Nobody has this role, so nothing else changes.', confirmLabel: 'Delete', danger: true });
      if(ok) attempt('Could not delete the role', async () => { await api.deleteRole(id); showToast('Role deleted'); });
    }
  });

  const add = root.querySelector('#addRoleBtn');
  if(add) add.addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Add a role', label: 'Role name', placeholder: 'e.g. DevOps engineer', maxLength: LIMITS.ROLE_NAME, confirmLabel: 'Add role' });
    if(!name) return;
    let id = slug(name);
    while(state.roles[id]) id = slug(name) + '-' + Math.random().toString(36).slice(2, 5);
    const order = Math.max(0, ...Object.values(state.roles).map(r => r.order || 0)) + 1;
    const ok = await attempt('Could not add the role', () => api.saveRole(id, {
      name, description: '', order,
      // New roles start like Developer; tick more as needed.
      permissions: { ...DEFAULT_ROLES.find(r => r.id === 'developer').permissions }
    }));
    if(ok !== false){
      showToast(`${name} added — set its permissions below`, 'success');
      setTimeout(() => { const card = root.querySelector(`.role-card[data-id="${id}"]`); if(card){ card.open = true; card.scrollIntoView({ block: 'center' }); } }, 300);
    }
  });
}
