/* =========================================================
   features/auth.js — sign in / sign up, email verification, the
   "pending approval" screen, the Account dialog, and the gate that
   decides which screen a user sees:

     signed out            → login screen
     email not verified    → "Confirm your email" screen
     verified, not on the  → "pending approval" screen (Request access)
       allowlist
     approved              → the app (starts live data sync)
========================================================= */
import { auth } from '../data/firebase.js';
import * as api from '../data/api.js';
import { startSync, stopSync, watchOwnRequest } from '../data/sync.js';
import { MIN_PASSWORD_LENGTH } from '../config.js';
import { state } from '../core/state.js';
import { ROLES, ROLE_LABELS } from '../core/constants.js';
import { html } from '../core/html.js';
import { friendlyAuthError } from '../core/format.js';
import { myEmail } from '../core/permissions.js';
import { showToast, openModal, closeAllModals } from '../core/ui.js';
import { switchTab } from './nav.js';

const $ = (id) => document.getElementById(id);

/* ---------------- SCREENS ---------------- */
const SCREENS = { auth: 'authScreen', verify: 'verifyScreen', pending: 'pendingScreen', app: 'app' };

function showScreen(name){
  Object.entries(SCREENS).forEach(([key, id]) => $(id).classList.toggle('hidden', key !== name));
}

/* ---------------- LOGIN / SIGN UP ---------------- */
let authMode = 'login';

function setAuthMode(mode){
  authMode = mode;
  $('tabLogin').classList.toggle('active', mode === 'login');
  $('tabSignup').classList.toggle('active', mode === 'signup');
  $('tabLogin').setAttribute('aria-selected', String(mode === 'login'));
  $('tabSignup').setAttribute('aria-selected', String(mode === 'signup'));
  $('authSubmit').textContent = mode === 'login' ? 'Log in' : 'Create account';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authError').textContent = '';
}
$('tabLogin').addEventListener('click', () => setAuthMode('login'));
$('tabSignup').addEventListener('click', () => setAuthMode('signup'));

async function submitAuth(){
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const errorEl = $('authError');
  errorEl.textContent = '';
  if(!email || !password){ errorEl.textContent = 'Enter an email and password.'; return; }
  if(authMode === 'signup' && password.length < MIN_PASSWORD_LENGTH){
    errorEl.textContent = `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`; return;
  }
  $('authSubmit').disabled = true;
  $('authStatus').textContent = 'Working…';
  try{
    if(authMode === 'login'){
      await auth.signInWithEmailAndPassword(email, password);
    }else{
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      // New accounts must prove they own the address before they can be approved
      // (otherwise anyone could register a teammate's email before they do).
      await cred.user.sendEmailVerification();
    }
  }catch(e){ errorEl.textContent = friendlyAuthError(e); }
  $('authSubmit').disabled = false;
  $('authStatus').textContent = '';
}
$('authSubmit').addEventListener('click', submitAuth);
$('authPassword').addEventListener('keydown', e => { if(e.key === 'Enter') submitAuth(); });

$('forgotLink').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  if(!email){ $('authError').textContent = 'Enter your email above first, then click "Forgot password?"'; return; }
  try{
    await auth.sendPasswordResetEmail(email);
    showToast('If that email has an account, a reset link is on its way.');
  }catch(e){ $('authError').textContent = friendlyAuthError(e); }
});

$('signOutPending').addEventListener('click', () => auth.signOut());
$('signOutVerify').addEventListener('click', () => auth.signOut());

/* ---------------- EMAIL VERIFICATION SCREEN ---------------- */
$('resendVerifyBtn').addEventListener('click', async () => {
  try{
    await auth.currentUser.sendEmailVerification();
    showToast('Verification email sent to ' + auth.currentUser.email);
  }catch(e){ showToast(friendlyAuthError(e)); }
});

$('verifiedBtn').addEventListener('click', async () => {
  const user = auth.currentUser;
  if(!user) return;
  try{
    await user.reload();
    if(!user.emailVerified){ showToast('Not confirmed yet — click the link in the email first'); return; }
    // Refresh the ID token so Firestore's rules see email_verified = true.
    await user.getIdToken(true);
    await routeSignedInUser(user);
  }catch(e){ showToast(friendlyAuthError(e)); }
});

/* ---------------- PENDING APPROVAL SCREEN ---------------- */
let stopWatchingRequest = null;

$('requestAccessBtn').addEventListener('click', async () => {
  try{
    await api.requestAccess(myEmail());
    showToast('Access requested — an admin has been notified.');
  }catch(e){ showToast('Could not send request: ' + e.message); }
});

function showPending(email){
  showScreen('pending');
  stopWatchingRequest = watchOwnRequest(email, requested => {
    $('requestAccessBtn').disabled = requested;
    $('requestAccessBtn').textContent = requested ? 'Request sent' : 'Request access';
    $('pendingMsg').textContent = requested
      ? `Your access request for ${email} is waiting on an admin. Ask them to approve you in the Team tab, then reload this page.`
      : `Your account isn't approved for this board yet. Click below to notify an admin, or ask them directly to add ${email}.`;
  });
}

/* ---------------- THE GATE ---------------- */

function resetSession(){
  stopSync();
  if(stopWatchingRequest){ stopWatchingRequest(); stopWatchingRequest = null; }
  // Dialogs live on document.body, outside #app, so close them explicitly.
  closeAllModals();
}

auth.onAuthStateChanged(async user => {
  resetSession();
  if(!user){
    state.currentUser = null;
    state.currentRole = null;
    showScreen('auth');
    return;
  }
  await routeSignedInUser(user);
});

/** Sends a signed-in user to the verify screen, the pending screen, or into the app. */
async function routeSignedInUser(user){
  resetSession();
  state.currentUser = user;
  const email = myEmail();
  if(!user.emailVerified){
    $('verifyMsg').textContent = `We sent a confirmation link to ${email}. Click it, then come back and press the button below. (Check your spam folder too.)`;
    showScreen('verify');
    return;
  }
  try{
    const role = await api.getRole(email);
    if(!role){ showPending(email); return; }
    state.currentRole = role;
    $('whoami').textContent = `${email} · ${ROLE_LABELS[role] || role}`;
    $('navTeam').classList.toggle('hidden', role !== ROLES.ADMIN);
    showScreen('app');
    startSync({ isAdmin: role === ROLES.ADMIN });
    switchTab('board');
    api.ensureOwnProfile();
  }catch(e){
    $('authError').textContent = 'Could not verify access: ' + (e.message || e);
    showScreen('auth');
  }
}

/* ---------------- ACCOUNT DIALOG (change password, sign out) ---------------- */
$('accountBtn').addEventListener('click', openAccountModal);

function openAccountModal(){
  const m = openModal({
    title: 'Account',
    size: 'narrow',
    initialFocus: '#acc-current',
    body: html`
      <div class="field"><label for="acc-who">Signed in as</label>
        <input type="text" id="acc-who" value="${state.currentUser.email} · ${ROLE_LABELS[state.currentRole] || state.currentRole}" disabled></div>
      <div class="field"><label for="acc-current">Current password</label>
        <input type="password" id="acc-current" autocomplete="current-password"></div>
      <div class="field"><label for="acc-new">New password</label>
        <input type="password" id="acc-new" autocomplete="new-password" placeholder="At least ${MIN_PASSWORD_LENGTH} characters"></div>
      <div class="field"><label for="acc-confirm">Confirm new password</label>
        <input type="password" id="acc-confirm" autocomplete="new-password"></div>
      <div class="auth-error" id="accError" role="alert"></div>
      <div class="modal-actions">
        <button type="button" class="danger" id="accSignOut">Sign out</button>
        <button type="button" class="primary" id="accSave">Update password</button>
      </div>`
  });
  m.$('#accSignOut').addEventListener('click', () => auth.signOut());
  m.$('#accSave').addEventListener('click', async () => {
    const current = m.$('#acc-current').value;
    const next = m.$('#acc-new').value;
    const errEl = m.$('#accError');
    errEl.textContent = '';
    if(!current || !next){ errEl.textContent = 'Fill in both password fields.'; return; }
    if(next.length < MIN_PASSWORD_LENGTH){ errEl.textContent = `New password should be at least ${MIN_PASSWORD_LENGTH} characters.`; return; }
    if(next !== m.$('#acc-confirm').value){ errEl.textContent = 'New passwords do not match.'; return; }
    try{
      const cred = firebase.auth.EmailAuthProvider.credential(state.currentUser.email, current);
      await state.currentUser.reauthenticateWithCredential(cred);
      await state.currentUser.updatePassword(next);
      showToast('Password updated');
      m.close();
    }catch(e){ errEl.textContent = friendlyAuthError(e); }
  });
}
