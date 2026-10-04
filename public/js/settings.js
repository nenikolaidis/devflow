import { db } from './firebase-init.js';
import { state } from './state.js';
import { STATUSES, DEFAULT_SETTINGS } from './constants.js';
import { showToast, escapeHtml } from './utils.js';
import { sendTestMessage, isValidWebhookUrl } from './discord.js';

/* Board-wide settings live in Firestore at config/settings, so the
   Discord webhook URL never has to be committed to the (public) site
   source. Approved users can read them; only admins can save them. */
const settingsRef = () => db.collection('config').doc('settings');

/** Current settings, with defaults filled in for anything not saved yet. */
export function getSettings(){
  const s = state.settings || {};
  return {
    discordWebhookUrl: s.discordWebhookUrl || DEFAULT_SETTINGS.discordWebhookUrl,
    staleDays: Number.isFinite(s.staleDays) && s.staleDays > 0 ? s.staleDays : DEFAULT_SETTINGS.staleDays,
    wipLimits: { ...DEFAULT_SETTINGS.wipLimits, ...(s.wipLimits || {}) }
  };
}

export function attachSettingsListener(){
  state.unsub.settings = settingsRef().onSnapshot(doc => {
    state.settings = doc.exists ? doc.data() : {};
    // WIP limits and stale badges depend on these, so repaint whatever's showing.
    import('./tickets.js').then(m => { if(state.currentTab === 'board') m.renderBoardView(); });
    import('./dashboard.js').then(m => { if(state.currentTab === 'dashboard') m.renderDashboard(); });
    if(state.currentRole === 'admin' && state.currentTab === 'team') renderSettings();
  }, err => console.error('Settings sync error:', err));
}

/* ---------------- TEAM TAB: SETTINGS FORM (admin only) ---------------- */
export function renderSettings(){
  const s = getSettings();
  document.getElementById('setWebhook').value = s.discordWebhookUrl;
  document.getElementById('setStaleDays').value = s.staleDays;
  document.getElementById('setWipLimits').innerHTML = STATUSES.map(st => `
    <label class="wip-input">${escapeHtml(st.label)}
      <input type="number" min="0" step="1" data-status="${st.key}" value="${s.wipLimits[st.key] || 0}">
    </label>`).join('');
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const webhook = document.getElementById('setWebhook').value.trim();
  if(webhook && !isValidWebhookUrl(webhook)){
    showToast('That doesn\'t look like a Discord webhook URL (https://discord.com/api/webhooks/…)');
    return;
  }
  const staleDays = parseInt(document.getElementById('setStaleDays').value, 10);
  const wipLimits = {};
  document.querySelectorAll('#setWipLimits input').forEach(inp => {
    const n = parseInt(inp.value, 10);
    wipLimits[inp.dataset.status] = Number.isFinite(n) && n > 0 ? n : 0;
  });
  try{
    await settingsRef().set({
      discordWebhookUrl: webhook,
      staleDays: Number.isFinite(staleDays) && staleDays > 0 ? staleDays : DEFAULT_SETTINGS.staleDays,
      wipLimits,
      updatedBy: state.currentUser.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast('Settings saved');
  }catch(e){ showToast('Could not save settings: ' + e.message); }
});

document.getElementById('testWebhookBtn').addEventListener('click', async () => {
  const url = document.getElementById('setWebhook').value.trim();
  if(!isValidWebhookUrl(url)){ showToast('Paste a Discord webhook URL first'); return; }
  const ok = await sendTestMessage(url);
  showToast(ok ? 'Test message sent — check your Discord channel' : 'Discord rejected the test message — check the URL');
});
