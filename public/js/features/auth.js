/* =========================================================
   features/auth.js — sign in / sign up, email verification, the
   "pending approval" screen, the Account dialog, and the gate that
   decides which screen a user sees:

     signed out            → login screen (Continue with Google, or email
                             and password)
     email not verified    → "Confirm your email" screen
     temporary password    → "Choose your own password" (an admin gave
                             them one with scripts/admin.mjs)
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
import { logProblem, flushLogs } from '../data/log.js';
import { MIN_PASSWORD_LENGTH } from '../config.js';
import { state } from '../core/state.js';
import { WORKSPACE_ROLES, WORKSPACE_ROLE_LABELS } from '../core/constants.js';
import { html } from '../core/html.js';
import { friendlyAuthError } from '../core/format.js';
import { myEmail } from '../core/permissions.js';
import { showToast, openModal, closeAllModals, copyText, promptDialog } from '../core/ui.js';
import { switchTab } from './nav.js';
import { refreshUserBadge } from './topbar.js';

const $ = (id) => document.getElementById(id);

/* ---------------- SCREENS ---------------- */
const SCREENS = { auth: 'authScreen', verify: 'verifyScreen', newPassword: 'newPasswordScreen', pending: 'pendingScreen', offline: 'offlineScreen', app: 'app' };

function showScreen(name){
  Object.entries(SCREENS).forEach(([key, id]) => $(id).classList.toggle('hidden', key !== name));
}

/* ---------------- CONTINUE WITH GOOGLE ---------------- */
// Google has already confirmed the address, so there's no confirmation
// email: people go straight to approval (or straight in, if an admin added
// them). Someone who already has a devflow password for the same email is
// asked for it once, and Google is linked to that same account.
async function signInWithGoogle(){
  $('authError').textContent = '';
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  $('googleBtn').disabled = true;
  try{
    await auth.signInWithPopup(provider);
  }catch(e){
    if(e.code === 'auth/account-exists-with-different-credential' && e.credential) await linkGoogleToPasswordAccount(e);
    else if(!/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(e.code || '')) $('authError').textContent = friendlyAuthError(e);
  }
  $('googleBtn').disabled = false;
}
$('googleBtn').addEventListener('click', signInWithGoogle);

async function linkGoogleToPasswordAccount(e){
  const email = e.email || (e.customData && e.customData.email) || '';
  const password = await promptDialog({
    title: 'Add Google to your account',
    label: `You already have a devflow password for ${email}. Enter it once, and from then on you can also continue with Google.`,
    inputType: 'password', autocomplete: 'current-password', confirmLabel: 'Link Google'
  });
  if(!password) return;
  try{
    const cred = await auth.signInWithEmailAndPassword(email, password);
    await cred.user.linkWithCredential(e.credential);
    showToast('Google is now linked to your account', 'success');
  }catch(err){ $('authError').textContent = friendlyAuthError(err); }
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
    showToast('If that email has an account, a reset link is on its way. Nothing after a few minutes? Check Junk / Spam — or you may not have an account yet: choose "Create account".');
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

/* ---------------- CHOOSE YOUR OWN PASSWORD ---------------- */
// After an admin gave someone a temporary password with the admin tool.
async function saveOwnPassword(){
  const next = $('npNew').value;
  $('npError').textContent = '';
  if(next.length < MIN_PASSWORD_LENGTH){ $('npError').textContent = `Use at least ${MIN_PASSWORD_LENGTH} characters.`; return; }
  if(next !== $('npConfirm').value){ $('npError').textContent = 'The two passwords don\'t match.'; return; }
  $('npSave').disabled = true;
  try{
    await api.chooseOwnPassword(next);
    $('npNew').value = $('npConfirm').value = '';
    showToast('Password saved', 'success');
    await routeSignedInUser(auth.currentUser);
  }catch(e){ $('npError').textContent = friendlyAuthError(e); }
  $('npSave').disabled = false;
}
$('npSave').addEventListener('click', saveOwnPassword);
$('npConfirm').addEventListener('keydown', e => { if(e.key === 'Enter') saveOwnPassword(); });
$('signOutNewPassword').addEventListener('click', () => auth.signOut());

/* ---------------- WAITING FOR THE EMAIL TO BE CONFIRMED ---------------- */
// People click the link in another tab or on their phone and come back —
// often by reloading. Check every few seconds, and as soon as this tab is
// visible again, so the page moves on by itself.
let confirmationTimer = null;
let checkConfirmation = null;
function watchForConfirmation(user){
  checkConfirmation = async () => {
    try{ await user.reload(); }catch(e){ return; }
    if(!user.emailVerified || checkConfirmation === null) return;
    checkConfirmation = null;
    clearInterval(confirmationTimer);
    await user.getIdToken(true); // so the database sees the confirmed email
    routeSignedInUser(user);
  };
  confirmationTimer = setInterval(() => checkConfirmation && checkConfirmation(), 4000);
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && checkConfirmation) checkConfirmation(); });

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
    api.setJoinStatus('waiting-approval', requested ? 'asked for access' : 'hasn\'t pressed Request access');
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
  clearInterval(confirmationTimer);
  checkConfirmation = null;
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
    $('verifyMsg').textContent = `We sent a confirmation link to ${email}. Click it — this page continues by itself once you have. (Not there after a few minutes? Check Junk / Spam, or press "Resend email".)`;
    showScreen('verify');
    api.setJoinStatus('confirm-email', `created ${user.metadata && user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString().slice(0, 16).replace('T', ' ') : ''}`);
    watchForConfirmation(user);
    return;
  }
  try{
    if(await api.mustChoosePassword(email)){ api.setJoinStatus('choose-password'); showScreen('newPassword'); $('npNew').focus(); return; }
    const role = await api.getRole(email);
    const failed = offlineAttempts + attemptsBeforeReload;
    if(failed) logProblem('reconnected', `Got through after ${failed} failed attempt${failed === 1 ? '' : 's'}${attemptsBeforeReload ? ', after switching to the compatibility connection' : ''}`,
      { detail: `connection: ${usingLongPolling ? 'long polling (compatibility mode)' : 'standard'}` });
    offlineAttempts = 0;
    attemptsBeforeReload = 0;
    try{ sessionStorage.removeItem(ATTEMPTS_KEY); }catch(e){ /* fine */ }
    flushLogs(); // anything recorded while offline
    if(!role){ showPending(email); return; }
    api.setJoinStatus('signed-in');
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
const ATTEMPTS_KEY = 'devflow:offlineAttempts'; // survives the reload into long polling
let offlineAttempts = 0;
let attemptsBeforeReload = (() => { try{ return Number(sessionStorage.getItem(ATTEMPTS_KEY)) || 0; }catch(e){ return 0; } })();
let offlineTimer = null;
let lastOfflineError = null;

function showOffline(error){
  lastOfflineError = error;
  offlineAttempts++;
  // Queued on this device, sent as soon as the database can be reached.
  logProblem('offline', 'Can\'t reach the database from this device', {
    detail: `${error.code || ''}: ${error.message || ''}\nattempt ${offlineAttempts} · connection: ${usingLongPolling ? 'long polling' : 'standard'} · browser says online: ${navigator.onLine ? 'yes' : 'no'}`
  });
  showScreen('offline');
  if(offlineAttempts >= SWITCH_TO_LONG_POLLING_AFTER && !usingLongPolling && useLongPollingFromNowOn()){
    $('offlineStatus').textContent = 'Switching to a more compatible connection…';
    try{ sessionStorage.setItem(ATTEMPTS_KEY, String(offlineAttempts + attemptsBeforeReload)); }catch(e){ /* fine */ }
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
  // People who only ever continue with Google have no devflow password to change.
  const providers = (state.currentUser.providerData || []).map(p => p.providerId);
  const hasPassword = providers.includes('password') || providers.length === 0;
  const via = providers.includes('google.com') ? (hasPassword ? 'Google or password' : 'Google') : 'password';
  const who = html`
      <div class="field"><label for="acc-who">Signed in as</label>
        <input type="text" id="acc-who" value="${state.currentUser.email} · ${WORKSPACE_ROLE_LABELS[state.workspaceRole] || state.workspaceRole} · signs in with ${via}" disabled></div>`;
  if(!hasPassword){
    const g = openModal({
      title: 'Account', size: 'narrow',
      body: html`${who}
        <p class="field-hint">You continue with Google, so there's no devflow password to change — your Google account's security applies.</p>
        <div class="modal-actions"><button type="button" class="danger" id="accSignOut">Sign out</button></div>`
    });
    g.$('#accSignOut').addEventListener('click', () => auth.signOut());
    return;
  }
  const m = openModal({
    title: 'Account',
    size: 'narrow',
    initialFocus: '#acc-current',
    body: html`${who}
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
