/* =========================================================
   features/auth.js — sign in / sign up, email verification, the
   "pending approval" screen, the Account dialog, and the gate that
   decides which screen a user sees:

     signed out            → login screen
     email not verified    → "Confirm your email" screen
     verified, not on the  → "pending approval" screen (Request access)
       allowlist
     approved              → the app (starts live data sync)
     database unreachable  → "Can't reach devflow" screen, which keeps
                             retrying (see CAN'T REACH THE DATABASE)

   While someone is in the app or on the pending screen, their own
   allowlist entry is watched: added → straight in; removed or role
   changed → re-routed.
========================================================= */
import { auth, usingLongPolling, useLongPollingFromNowOn } from '../data/firebase.js';
import * as api from '../data/api.js';
import { startSync, stopSync, watchOwnRequest, watchOwnAccess } from '../data/sync.js';
import { MIN_PASSWORD_LENGTH } from '../config.js';
import { state } from '../core/state.js';
import { WORKSPACE_ROLES, WORKSPACE_ROLE_LABELS } from '../core/constants.js';
import { html } from '../core/html.js';
import { friendlyAuthError } from '../core/format.js';
import { myEmail } from '../core/permissions.js';
import { showToast, openModal, closeAllModals, copyText } from '../core/ui.js';
import { switchTab } from './nav.js';
import { refreshUserBadge } from './topbar.js';

const $ = (id) => document.getElementById(id);

/* ---------------- SCREENS ---------------- */
const SCREENS = { auth: 'authScreen', verify: 'verifyScreen', pending: 'pendingScreen', offline: 'offlineScreen', app: 'app' };

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
let stopWatchingAccess = null;

$('requestAccessBtn').addEventListener('click', async () => {
  try{
    await api.requestAccess(myEmail());
    showToast('Access requested — an admin has been notified.');
  }catch(e){ showToast('Could not send request: ' + e.message); }
});

function showPending(email){
  showScreen('pending');
  // Approved — from a request, or added directly by an admin — goes straight in.
  stopWatchingAccess = watchOwnAccess(email, role => { if(role) routeSignedInUser(auth.currentUser); });
  stopWatchingRequest = watchOwnRequest(email, requested => {
    $('requestAccessBtn').disabled = requested;
    $('requestAccessBtn').textContent = requested ? 'Request sent' : 'Request access';
    $('pendingMsg').textContent = requested
      ? `Your access request for ${email} is waiting on an admin. This page opens devflow as soon as they approve you.`
      : `Your account isn't approved yet. Click below to notify an admin, or ask them directly to add ${email}.`;
  });
}

/* ---------------- THE GATE ---------------- */

function resetSession(){
  stopSync();
  if(stopWatchingRequest){ stopWatchingRequest(); stopWatchingRequest = null; }
  if(stopWatchingAccess){ stopWatchingAccess(); stopWatchingAccess = null; }
  clearTimeout(offlineTimer);
  // Dialogs live on document.body, outside #app, so close them explicitly.
  closeAllModals();
}

auth.onAuthStateChanged(async user => {
  resetSession();
  if(!user){
    state.currentUser = null;
    state.workspaceRole = null;
    offlineAttempts = 0;
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
    offlineAttempts = 0;
    if(!role){ showPending(email); return; }
    state.workspaceRole = role;
    refreshUserBadge();
    showScreen('app');
    startSync({ isAdmin: role === WORKSPACE_ROLES.ADMIN });
    switchTab('board');
    api.ensureOwnProfile();
    // Removed from the workspace, or made admin / member, while signed in → re-route.
    stopWatchingAccess = watchOwnAccess(email, current => { if(current !== state.workspaceRole) routeSignedInUser(auth.currentUser); });
  }catch(e){
    if(isOfflineError(e)){ showOffline(e); return; }
    $('authError').textContent = 'Could not verify access: ' + (e.message || e);
    showScreen('auth');
  }
}

/* ---------------- CAN'T REACH THE DATABASE ---------------- */
// Firestore says "the client is offline" (code "unavailable") when it can't
// connect at all: a blip on mobile data, or a VPN, ad blocker, antivirus or
// iCloud Private Relay in the way. Instead of giving up, keep retrying with
// growing pauses, and after a few failures switch this browser to long
// polling (see data/firebase.js), which gets through almost anything.
const isOfflineError = (e) => !!e && (e.code === 'unavailable' || /offline/i.test(e.message || ''));
const RETRY_DELAYS = [3000, 6000, 12000, 20000, 30000];
const SWITCH_TO_LONG_POLLING_AFTER = 3;
let offlineAttempts = 0;
let offlineTimer = null;
let lastOfflineError = null;

function showOffline(error){
  lastOfflineError = error;
  offlineAttempts++;
  showScreen('offline');
  if(offlineAttempts >= SWITCH_TO_LONG_POLLING_AFTER && !usingLongPolling && useLongPollingFromNowOn()){
    $('offlineStatus').textContent = 'Switching to a more compatible connection…';
    offlineTimer = setTimeout(() => location.reload(), 800);
    return;
  }
  const delay = RETRY_DELAYS[Math.min(offlineAttempts - 1, RETRY_DELAYS.length - 1)];
  $('offlineStatus').textContent = `Still trying — next attempt in ${delay / 1000} seconds.`;
  offlineTimer = setTimeout(retryConnection, delay);
}

async function retryConnection(){
  clearTimeout(offlineTimer);
  if(!auth.currentUser) return;
  $('offlineStatus').textContent = 'Connecting…';
  await api.reconnect();
  routeSignedInUser(auth.currentUser);
}

$('offlineRetry').addEventListener('click', retryConnection);
$('signOutOffline').addEventListener('click', () => auth.signOut());
window.addEventListener('online', () => { if(!$('offlineScreen').classList.contains('hidden')) retryConnection(); });
$('offlineCopy').addEventListener('click', () => copyText([
  'devflow connection problem',
  `Account: ${(auth.currentUser && auth.currentUser.email) || '—'}`,
  `Time: ${new Date().toString()}`,
  `Error: ${(lastOfflineError && lastOfflineError.code) || '—'} — ${(lastOfflineError && lastOfflineError.message) || '—'}`,
  `Attempts: ${offlineAttempts} · connection: ${usingLongPolling ? 'long polling' : 'standard'} · browser says online: ${navigator.onLine ? 'yes' : 'no'}`,
  `Browser: ${navigator.userAgent}`
].join('\n'), { done: 'Copied — paste it to your admin', title: 'Details for your admin' }));

/* ---------------- ACCOUNT DIALOG (change password, sign out) ---------------- */
$('accountBtn').addEventListener('click', openAccountModal);

function openAccountModal(){
  const m = openModal({
    title: 'Account',
    size: 'narrow',
    initialFocus: '#acc-current',
    body: html`
      <div class="field"><label for="acc-who">Signed in as</label>
        <input type="text" id="acc-who" value="${state.currentUser.email} · ${WORKSPACE_ROLE_LABELS[state.workspaceRole] || state.workspaceRole}" disabled></div>
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
