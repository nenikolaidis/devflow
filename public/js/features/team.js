/* =========================================================
   features/team.js — the Team tab (admins only): pending access
   requests, team members and their roles, and adding people directly.
   Board settings on the same tab live in settings-panel.js.
========================================================= */
import { state } from '../core/state.js';
import { ROLES, ROLE_LABELS } from '../core/constants.js';
import { html } from '../core/html.js';
import { isMe, normEmail } from '../core/permissions.js';
import { displayName, avatarHtml, profileOf, availabilityBadge, localTime } from '../core/people.js';
import { showToast, confirmDialog } from '../core/ui.js';
import * as api from '../data/api.js';
import { openProfileModal } from './profiles.js';

const $ = (id) => document.getElementById(id);

function roleOptions(selected){
  return Object.values(ROLES).map(r => html`<option value="${r}" ${r === selected ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`);
}

/* ---------------- TEAM MEMBERS ---------------- */

export function renderAllowlist(){
  const list = $('allowList');
  list.innerHTML = html`${state.allowlist.map(u => html`
    <div class="allow-row" data-email="${u.id}">
      ${avatarHtml(u.id, 32)}
      <span class="em">
        <span class="member-name">${displayName(u.id)}${isMe(u.id) ? ' (you)' : ''}</span>
        <span class="member-meta">${profileOf(u.id).title ? `${profileOf(u.id).title} · ` : ''}${availabilityBadge(u.id)}${localTime(u.id) ? ` · ${localTime(u.id)} local` : ''}</span>
      </span>
      <select class="roleSelect" aria-label="Role for ${u.id}" ${isMe(u.id) ? 'disabled' : ''}>${roleOptions(u.role)}</select>
      <button type="button" class="ghost small" data-action="view">View</button>
      ${isMe(u.id) ? '' : html`<button type="button" class="ghost small" data-action="remove">Remove</button>`}
    </div>`)}`;
}

$('allowList').addEventListener('change', async e => {
  if(!e.target.classList.contains('roleSelect')) return;
  const email = e.target.closest('.allow-row').dataset.email;
  try{
    await api.setRole(email, e.target.value);
    showToast(`${email} is now ${ROLE_LABELS[e.target.value]}`);
  }catch(err){ showToast('Could not update role: ' + err.message); renderAllowlist(); }
});

$('allowList').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const email = btn.closest('.allow-row').dataset.email;
  if(btn.dataset.action === 'view') openProfileModal(email);
  if(btn.dataset.action === 'remove'){
    const ok = await confirmDialog({
      title: `Remove ${displayName(email)}?`,
      message: `${email} will lose access to the board immediately. Their tickets and comments stay.`,
      confirmLabel: 'Remove', danger: true
    });
    if(!ok) return;
    try{ await api.removeMember(email); showToast(`${email} removed`); }
    catch(err){ showToast('Could not remove: ' + err.message); }
  }
});

$('addAllowBtn').addEventListener('click', async () => {
  const email = normEmail($('newAllowEmail').value);
  const role = $('newAllowRole').value;
  if(!email || !email.includes('@')){ showToast('Enter an email address'); return; }
  try{
    await api.addMember(email, role);
    $('newAllowEmail').value = '';
    showToast(`${email} added as ${ROLE_LABELS[role]}`);
  }catch(e){ showToast('Could not add: ' + e.message); }
});

/* ---------------- ACCESS REQUESTS ---------------- */

export function renderRequests(){
  const requests = state.accessRequests;
  $('noRequests').classList.toggle('hidden', requests.length !== 0);
  $('requestList').innerHTML = html`${requests.map(r => html`
    <div class="request-row" data-email="${r.id}">
      <span class="em">${r.id}</span>
      <select class="reqRole" aria-label="Role for ${r.id}">${roleOptions(ROLES.DEVELOPER)}</select>
      <button type="button" class="primary small" data-action="approve">Approve</button>
      <button type="button" class="ghost small" data-action="deny">Deny</button>
    </div>`)}`;
}

$('requestList').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const row = btn.closest('.request-row');
  const email = row.dataset.email;
  try{
    if(btn.dataset.action === 'approve'){
      const role = row.querySelector('.reqRole').value;
      await api.addMember(email, role);
      showToast(`${email} approved as ${ROLE_LABELS[role]}`);
    }else{
      await api.deleteRequest(email);
      showToast(`${email} denied`);
    }
  }catch(err){ showToast('Could not update request: ' + err.message); }
});
