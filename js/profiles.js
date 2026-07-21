import { db } from './firebase-init.js';
import { state } from './state.js';
import { AVATAR_COLORS, FALLBACK_TIMEZONES } from './constants.js';
import { showToast, escapeHtml, initials, formatDateTime } from './utils.js';

const TIMEZONES = (() => {
  try{
    const list = Intl.supportedValuesOf('timeZone');
    if(list && list.length) return list;
  }catch(e){ /* not supported in this browser */ }
  return FALLBACK_TIMEZONES;
})();

function normEmail(email){ return (email || '').trim().toLowerCase(); }

function avatarColor(email){
  const str = normEmail(email) || 'x';
  let hash = 0;
  for(let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Display name: profile name if set, otherwise the email itself. */
export function displayName(email){
  if(!email) return 'Unassigned';
  const p = state.profilesCache[normEmail(email)];
  return (p && p.name) ? p.name : email;
}

/** Returns an <span> avatar HTML string using initials and a per-person color. */
export function avatarHtml(email, size){
  size = size || 20;
  const font = Math.max(9, Math.round(size * 0.42));
  if(!email){
    return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${font}px;">—</span>`;
  }
  const p = state.profilesCache[normEmail(email)];
  const label = (p && p.name) ? p.name : email;
  const color = avatarColor(email);
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${font}px;background:${color}22;color:${color};" title="${escapeHtml(label)}">${initials(label)}</span>`;
}

/* ---------------- SYNC ---------------- */
export function attachProfilesListener(){
  state.unsub.profiles = db.collection('profiles').onSnapshot(snap => {
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    state.profilesCache = map;
  }, err => console.error('Profiles sync error:', err));
}

/** Creates a blank profile doc on first login, or bumps lastActive on every login after that. */
export async function ensureOwnProfile(){
  const email = normEmail(state.currentUser.email);
  const ref = db.collection('profiles').doc(email);
  try{
    const doc = await ref.get();
    if(!doc.exists){
      await ref.set({
        name: '', username: '', bio: '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        lastActive: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }else{
      await ref.update({ lastActive: firebase.firestore.FieldValue.serverTimestamp() });
    }
  }catch(e){ console.error('Could not initialize profile:', e); }
}

/* ---------------- PROFILE MODAL ---------------- */
export function openProfileModal(targetEmail){
  const email = normEmail(targetEmail || state.currentUser.email);
  const isSelf = email === normEmail(state.currentUser.email);
  const p = state.profilesCache[email] || {};
  const role = (state.allowlistCache.find(u => u.id === email) || {}).role || '—';
  const assigned = state.tickets.filter(t => normEmail(t.owner) === email);
  const created = state.tickets.filter(t => normEmail(t.createdBy) === email);
  const color = avatarColor(email);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>${isSelf ? 'My profile' : 'Profile'}</h2><button class="ghost" id="closeProfile">✕</button></div>

      <div class="profile-head">
        <span class="avatar" style="width:56px;height:56px;font-size:20px;background:${color}22;color:${color};">${initials((p.name)||email)}</span>
        <div>
          <div class="profile-name">${escapeHtml(p.name) || email}</div>
          <div class="profile-sub">${p.username ? '@' + escapeHtml(p.username) + ' · ' : ''}${escapeHtml(email)}</div>
          <span class="role-pill">${role}</span>
        </div>
      </div>

      ${isSelf ? `
        <div class="field"><label>Name</label><input type="text" id="p-name" value="${escapeHtml(p.name)}" placeholder="Your full name"></div>
        <div class="field"><label>Username</label><input type="text" id="p-username" value="${escapeHtml(p.username)}" placeholder="jsmith"></div>
        <div class="field"><label>Bio</label><textarea id="p-bio" rows="2" placeholder="A short line about what you work on">${escapeHtml(p.bio)}</textarea></div>
        <div class="field"><label>Time zone</label>
          <select id="p-tz">${TIMEZONES.map(tz => `<option value="${tz}" ${p.timezone===tz?'selected':''}>${tz}</option>`).join('')}</select>
        </div>
      ` : `
        ${p.bio ? `<div class="detail-desc">${escapeHtml(p.bio)}</div>` : ''}
        <div class="detail-meta">
          <div><span>Time zone</span>${escapeHtml(p.timezone) || '—'}</div>
          <div><span>Last active</span>${p.lastActive ? formatDateTime(p.lastActive) : '—'}</div>
        </div>
      `}

      <div class="detail-meta" style="margin-top:${isSelf ? '0' : '14px'};">
        ${isSelf ? `<div><span>Last active</span>${p.lastActive ? formatDateTime(p.lastActive) : '—'}</div>` : ''}
        <div><span>Assigned tickets</span>${assigned.length}</div>
        <div><span>Created tickets</span>${created.length}</div>
      </div>

      ${assigned.length ? `
        <div class="profile-tickets">
          <h4>Assigned tickets</h4>
          ${assigned.slice(0, 8).map(t => `<div class="mini-ticket" data-fid="${t.firestoreId}"><span class="card-id">${t.id}</span> ${escapeHtml(t.title)}</div>`).join('')}
        </div>` : ''}

      ${isSelf ? `<div class="modal-actions"><button class="primary" id="saveProfile">Save profile</button></div>` : ''}
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  overlay.querySelector('#closeProfile').addEventListener('click', close);
  overlay.querySelectorAll('.mini-ticket').forEach(el => {
    el.addEventListener('click', () => {
      close();
      import('./tickets.js').then(m => m.openDetail(el.dataset.fid));
    });
  });

  const saveBtn = overlay.querySelector('#saveProfile');
  if(saveBtn){
    saveBtn.addEventListener('click', async () => {
      const data = {
        name: overlay.querySelector('#p-name').value.trim(),
        username: overlay.querySelector('#p-username').value.trim(),
        bio: overlay.querySelector('#p-bio').value.trim(),
        timezone: overlay.querySelector('#p-tz').value
      };
      try{
        await db.collection('profiles').doc(email).set(data, { merge: true });
        showToast('Profile updated');
        close();
      }catch(e){ showToast('Could not save profile: ' + e.message); }
    });
  }
}

document.getElementById('profileBtn').addEventListener('click', () => openProfileModal());