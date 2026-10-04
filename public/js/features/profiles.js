/* =========================================================
   features/profiles.js — the profile dialog. Your own profile is
   editable (name, username, bio, time zone); a teammate's is read-only
   and shows their tickets. Opened from the Profile button or the Team tab.
========================================================= */
import { state } from '../core/state.js';
import { FALLBACK_TIMEZONES, LIMITS, ROLE_LABELS } from '../core/constants.js';
import { html } from '../core/html.js';
import { formatDateTime, initials } from '../core/format.js';
import { normEmail, isMe } from '../core/permissions.js';
import { avatarColor, profileOf } from '../core/people.js';
import { openModal, showToast } from '../core/ui.js';
import { saveOwnProfile } from '../data/api.js';
import { openDetail } from './ticket-detail.js';

const TIMEZONES = (() => {
  try{
    const list = Intl.supportedValuesOf('timeZone');
    if(list && list.length) return list;
  }catch(e){ /* not supported in this browser */ }
  return FALLBACK_TIMEZONES;
})();

/** Opens a profile — your own if no email is given. */
export function openProfileModal(targetEmail){
  const email = normEmail(targetEmail || state.currentUser.email);
  const self = isMe(email);
  const p = profileOf(email);
  const role = (state.allowlist.find(u => u.id === email) || {}).role;
  const assigned = state.tickets.filter(t => !t.archived && normEmail(t.owner) === email);
  const createdCount = state.tickets.filter(t => normEmail(t.createdBy) === email).length;
  const color = avatarColor(email);
  const lastActive = p.lastActive ? formatDateTime(p.lastActive) : '—';

  const m = openModal({
    title: self ? 'My profile' : 'Profile',
    initialFocus: self ? '#p-name' : '',
    body: html`
      <div class="profile-head">
        <span class="avatar avatar-lg" style="background:${color}22;color:${color};" aria-hidden="true">${initials(p.name || email)}</span>
        <div>
          <div class="profile-name">${p.name || email}</div>
          <div class="profile-sub">${p.username ? `@${p.username} · ` : ''}${email}</div>
          <span class="role-pill">${ROLE_LABELS[role] || role || '—'}</span>
        </div>
      </div>

      ${self ? html`
        <div class="field"><label for="p-name">Name</label>
          <input type="text" id="p-name" maxlength="${LIMITS.PROFILE_NAME}" value="${p.name || ''}" placeholder="Your full name"></div>
        <div class="field"><label for="p-username">Username</label>
          <input type="text" id="p-username" maxlength="${LIMITS.PROFILE_USERNAME}" value="${p.username || ''}" placeholder="jsmith"></div>
        <div class="field"><label for="p-bio">Bio</label>
          <textarea id="p-bio" rows="2" maxlength="${LIMITS.PROFILE_BIO}" placeholder="A short line about what you work on">${p.bio || ''}</textarea></div>
        <div class="field"><label for="p-tz">Time zone</label>
          <select id="p-tz">${TIMEZONES.map(tz => html`<option value="${tz}" ${p.timezone === tz ? 'selected' : ''}>${tz}</option>`)}</select></div>
      ` : html`
        ${p.bio ? html`<div class="detail-desc">${p.bio}</div>` : ''}
        <div class="detail-meta">
          <div><span>Time zone</span>${p.timezone || '—'}</div>
          <div><span>Last active</span>${lastActive}</div>
        </div>`}

      <div class="detail-meta">
        ${self ? html`<div><span>Last active</span>${lastActive}</div>` : ''}
        <div><span>Assigned tickets</span>${assigned.length}</div>
        <div><span>Created tickets</span>${createdCount}</div>
      </div>

      ${assigned.length ? html`
        <div class="profile-tickets">
          <h4>Assigned tickets</h4>
          ${assigned.slice(0, 8).map(t => html`<button type="button" class="mini-ticket" data-fid="${t.firestoreId}"><span class="card-id">${t.id}</span> <span class="mini-title">${t.title}</span></button>`)}
        </div>` : ''}

      ${self ? html`<div class="modal-actions"><button type="button" class="primary" id="saveProfile">Save profile</button></div>` : ''}`
  });

  m.$$('.mini-ticket').forEach(el => el.addEventListener('click', () => { m.close(); openDetail(el.dataset.fid); }));

  const saveBtn = m.$('#saveProfile');
  if(saveBtn){
    saveBtn.addEventListener('click', async () => {
      try{
        await saveOwnProfile({
          name: m.$('#p-name').value.trim(),
          username: m.$('#p-username').value.trim(),
          bio: m.$('#p-bio').value.trim(),
          timezone: m.$('#p-tz').value
        });
        showToast('Profile updated');
        m.close();
      }catch(e){ showToast('Could not save profile: ' + e.message); }
    });
  }
}

document.getElementById('profileBtn').addEventListener('click', () => openProfileModal());
