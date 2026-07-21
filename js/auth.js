import { auth, db } from './firebase-init.js';
import { state } from './state.js';
import { showToast, escapeHtml, friendlyAuthError } from './utils.js';
import { switchTab } from './nav.js';
import { attachTicketsListener } from './tickets.js';
import { attachAllowlistListener, attachRequestsListener } from './team.js';
import { attachProfilesListener, ensureOwnProfile } from './profiles.js';

/* ---------------- LOGIN / SIGNUP UI ---------------- */
let authMode = 'login';
const tabLogin = document.getElementById('tabLogin');
const tabSignup = document.getElementById('tabSignup');
const authSubmit = document.getElementById('authSubmit');
const authError = document.getElementById('authError');
const authStatus = document.getElementById('authStatus');

tabLogin.addEventListener('click', () => {
  authMode = 'login'; tabLogin.classList.add('active'); tabSignup.classList.remove('active');
  authSubmit.textContent = 'Log in'; authError.textContent = '';
});
tabSignup.addEventListener('click', () => {
  authMode = 'signup'; tabSignup.classList.add('active'); tabLogin.classList.remove('active');
  authSubmit.textContent = 'Create account'; authError.textContent = '';
});

authSubmit.addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  authError.textContent = '';
  if(!email || !password){ authError.textContent = 'Enter an email and password.'; return; }
  authSubmit.disabled = true; authStatus.textContent = 'Working…';
  try{
    if(authMode === 'login') await auth.signInWithEmailAndPassword(email, password);
    else await auth.createUserWithEmailAndPassword(email, password);
  }catch(e){ authError.textContent = friendlyAuthError(e); }
  authSubmit.disabled = false; authStatus.textContent = '';
});

document.getElementById('forgotLink').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  if(!email){ authError.textContent = 'Enter your email above first, then click "Forgot password?"'; return; }
  try{
    await auth.sendPasswordResetEmail(email);
    showToast('Password reset email sent to ' + email);
  }catch(e){ authError.textContent = friendlyAuthError(e); }
});

document.getElementById('signOutPending').addEventListener('click', () => auth.signOut());

/* ---------------- ACCESS REQUEST (pending screen) ---------------- */
document.getElementById('requestAccessBtn').addEventListener('click', async () => {
  const email = (state.currentUser.email || '').toLowerCase();
  try{
    await db.collection('accessRequests').doc(email).set({
      email, requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Access requested — an admin has been notified.');
  }catch(e){ showToast('Could not send request: ' + e.message); }
});

function watchOwnRequest(email){
  if(state.unsub.ownRequest) state.unsub.ownRequest();
  state.unsub.ownRequest = db.collection('accessRequests').doc(email).onSnapshot(doc => {
    const btn = document.getElementById('requestAccessBtn');
    const msg = document.getElementById('pendingMsg');
    if(doc.exists){
      btn.disabled = true; btn.textContent = 'Request sent';
      msg.textContent = `Your access request for ${email} is waiting on an admin. Ask them to approve you in the Team tab, then reload this page.`;
    }else{
      btn.disabled = false; btn.textContent = 'Request access';
      msg.textContent = `Your account isn't approved for this board yet. Click below to notify an admin, or ask them directly to add ${email}.`;
    }
  });
}

/* ---------------- AUTH STATE / ALLOWLIST GATE ---------------- */
auth.onAuthStateChanged(async (user) => {
  detachAllListeners();
  if(!user){
    state.currentUser = null; state.currentRole = null;
    showScreen('auth');
    return;
  }
  state.currentUser = user;
  const email = (user.email || '').toLowerCase();
  try{
    const doc = await db.collection('allowlist').doc(email).get();
    if(doc.exists){
      state.currentRole = doc.data().role || 'developer';
      showScreen('app');
      document.getElementById('whoami').textContent = `${email} · ${state.currentRole}`;
      const isAdmin = state.currentRole === 'admin';
      document.getElementById('navTeam').classList.toggle('hidden', !isAdmin);
      switchTab('board');
      attachTicketsListener();
      attachAllowlistListener();
      attachProfilesListener();
      ensureOwnProfile();
      if(isAdmin) attachRequestsListener();
    }else{
      watchOwnRequest(email);
      showScreen('pending');
    }
  }catch(e){
    authError.textContent = 'Could not verify access: ' + (e.message || e);
    showScreen('auth');
  }
});

function showScreen(name){
  document.getElementById('authScreen').classList.toggle('hidden', name !== 'auth');
  document.getElementById('pendingScreen').classList.toggle('hidden', name !== 'pending');
  document.getElementById('app').classList.toggle('hidden', name !== 'app');
}

function detachAllListeners(){
  Object.keys(state.unsub).forEach(key => {
    if(state.unsub[key]) state.unsub[key]();
    state.unsub[key] = null;
  });
}

/* ---------------- ACCOUNT MODAL (change password) ---------------- */
document.getElementById('accountBtn').addEventListener('click', openAccountModal);

function openAccountModal(){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal narrow">
      <div class="modal-head"><h2>Account</h2><button class="ghost" id="closeAcc">✕</button></div>
      <div class="field"><label>Signed in as</label><input type="text" value="${escapeHtml(state.currentUser.email)} · ${state.currentRole}" disabled></div>
      <div class="field"><label>Current password</label><input type="password" id="acc-current"></div>
      <div class="field"><label>New password</label><input type="password" id="acc-new" placeholder="At least 6 characters"></div>
      <div class="field"><label>Confirm new password</label><input type="password" id="acc-confirm"></div>
      <div class="auth-error" id="accError"></div>
      <div class="modal-actions">
        <button class="danger" id="accSignOut">Sign out</button>
        <button class="primary" id="accSave">Update password</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  overlay.querySelector('#closeAcc').addEventListener('click', close);
  overlay.querySelector('#accSignOut').addEventListener('click', () => { auth.signOut(); close(); });

  overlay.querySelector('#accSave').addEventListener('click', async () => {
    const current = overlay.querySelector('#acc-current').value;
    const next = overlay.querySelector('#acc-new').value;
    const confirm = overlay.querySelector('#acc-confirm').value;
    const errEl = overlay.querySelector('#accError');
    errEl.textContent = '';
    if(!current || !next){ errEl.textContent = 'Fill in both password fields.'; return; }
    if(next.length < 6){ errEl.textContent = 'New password should be at least 6 characters.'; return; }
    if(next !== confirm){ errEl.textContent = 'New passwords do not match.'; return; }
    try{
      const cred = firebase.auth.EmailAuthProvider.credential(state.currentUser.email, current);
      await state.currentUser.reauthenticateWithCredential(cred);
      await state.currentUser.updatePassword(next);
      showToast('Password updated');
      close();
    }catch(e){ errEl.textContent = friendlyAuthError(e); }
  });
}