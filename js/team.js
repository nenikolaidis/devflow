import { db } from './firebase-init.js';
import { state } from './state.js';
import { showToast } from './utils.js';
import { avatarHtml, displayName, openProfileModal } from './profiles.js';

export function attachAllowlistListener(){
  state.unsub.allowlist = db.collection('allowlist').onSnapshot(snap => {
    state.allowlistCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(state.currentRole === 'admin' && state.currentTab === 'team') renderAllowlist();
  }, err => { if(state.currentRole === 'admin') showToast('Team sync error: ' + err.message); });
}

export function renderAllowlist(){
  const list = document.getElementById('allowList');
  list.innerHTML = '';
  state.allowlistCache.forEach(u => {
    const row = document.createElement('div');
    row.className = 'allow-row';
    const isSelf = u.id === state.currentUser.email.toLowerCase();
    row.innerHTML = `
      ${avatarHtml(u.id, 22)}
      <span class="em">${displayName(u.id)}${isSelf ? ' (you)' : ''}</span>
      <select class="roleSelect" ${isSelf ? 'disabled' : ''}>
        <option value="developer" ${u.role==='developer'?'selected':''}>Developer</option>
        <option value="pm" ${u.role==='pm'?'selected':''}>Project manager</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Administrator</option>
      </select>
    `;
    row.querySelector('.roleSelect').addEventListener('change', async (e) => {
      try{ await db.collection('allowlist').doc(u.id).update({ role: e.target.value }); showToast(`${u.id} is now ${e.target.value}`); }
      catch(err){ showToast('Could not update role: ' + err.message); }
    });
    const view = document.createElement('button');
    view.className = 'ghost small'; view.textContent = 'View';
    view.addEventListener('click', () => openProfileModal(u.id));
    row.appendChild(view);
    if(!isSelf){
      const rm = document.createElement('button');
      rm.className = 'ghost small'; rm.textContent = 'Remove';
      rm.addEventListener('click', async () => {
        try{ await db.collection('allowlist').doc(u.id).delete(); showToast(`${u.id} removed`); }
        catch(err){ showToast('Could not remove: ' + err.message); }
      });
      row.appendChild(rm);
    }
    list.appendChild(row);
  });
}

document.getElementById('addAllowBtn').addEventListener('click', async () => {
  const email = document.getElementById('newAllowEmail').value.trim().toLowerCase();
  const role = document.getElementById('newAllowRole').value;
  if(!email){ showToast('Enter an email'); return; }
  try{
    await db.collection('allowlist').doc(email).set({ role, addedBy: state.currentUser.email, addedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection('accessRequests').doc(email).delete().catch(() => {});
    document.getElementById('newAllowEmail').value = '';
    showToast(`${email} added as ${role}`);
  }catch(e){ showToast('Could not add: ' + e.message); }
});

export function attachRequestsListener(){
  state.unsub.requests = db.collection('accessRequests').onSnapshot(snap => {
    state.requestsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(state.currentTab === 'team') renderRequests(state.requestsCache);
  }, err => showToast('Requests sync error: ' + err.message));
}

export function renderRequests(requests){
  const list = document.getElementById('requestList');
  const noReq = document.getElementById('noRequests');
  list.innerHTML = '';
  noReq.classList.toggle('hidden', requests.length !== 0);
  requests.forEach(r => {
    const row = document.createElement('div');
    row.className = 'request-row';
    row.innerHTML = `
      <span class="em">${r.id}</span>
      <select class="reqRole">
        <option value="developer">Developer</option>
        <option value="pm">Project manager</option>
        <option value="admin">Administrator</option>
      </select>
    `;
    const approve = document.createElement('button');
    approve.className = 'primary small'; approve.textContent = 'Approve';
    approve.addEventListener('click', async () => {
      const role = row.querySelector('.reqRole').value;
      try{
        await db.collection('allowlist').doc(r.id).set({ role, addedBy: state.currentUser.email, addedAt: firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('accessRequests').doc(r.id).delete();
        showToast(`${r.id} approved as ${role}`);
      }catch(e){ showToast('Could not approve: ' + e.message); }
    });
    const deny = document.createElement('button');
    deny.className = 'ghost small'; deny.textContent = 'Deny';
    deny.addEventListener('click', async () => {
      try{ await db.collection('accessRequests').doc(r.id).delete(); showToast(`${r.id} denied`); }
      catch(e){ showToast('Could not deny: ' + e.message); }
    });
    row.appendChild(approve); row.appendChild(deny);
    list.appendChild(row);
  });
}