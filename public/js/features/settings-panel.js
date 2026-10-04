/* =========================================================
   features/settings-panel.js — "Board settings" on the Team tab
   (admins only): Discord webhook URL, stale threshold, WIP limits.
   Saved to Firestore config/settings; read everywhere via
   core/settings.js getSettings().
========================================================= */
import { STATUSES, DEFAULT_SETTINGS } from '../core/constants.js';
import { html } from '../core/html.js';
import { getSettings } from '../core/settings.js';
import { showToast } from '../core/ui.js';
import { saveSettings } from '../data/api.js';
import { sendTestMessage, isValidWebhookUrl } from '../integrations/discord.js';

const $ = (id) => document.getElementById(id);

/** Fills the form from saved settings. Skipped while an admin is typing in it. */
export function renderSettings({ force = false } = {}){
  if(!force && $('settingsBox').contains(document.activeElement)) return;
  const s = getSettings();
  $('setWebhook').value = s.discordWebhookUrl;
  $('setStaleDays').value = s.staleDays;
  $('setWipLimits').innerHTML = html`${STATUSES.map(st => html`
    <label class="wip-input">${st.label}
      <input type="number" min="0" step="1" data-status="${st.key}" value="${s.wipLimits[st.key] || 0}">
    </label>`)}`;
}

$('saveSettingsBtn').addEventListener('click', async () => {
  const webhook = $('setWebhook').value.trim();
  if(webhook && !isValidWebhookUrl(webhook)){
    showToast('That doesn\'t look like a Discord webhook URL (https://discord.com/api/webhooks/…)');
    return;
  }
  const staleDays = parseInt($('setStaleDays').value, 10);
  const wipLimits = {};
  document.querySelectorAll('#setWipLimits input').forEach(inp => {
    const n = parseInt(inp.value, 10);
    wipLimits[inp.dataset.status] = Number.isFinite(n) && n > 0 ? n : 0;
  });
  try{
    await saveSettings({
      discordWebhookUrl: webhook,
      staleDays: Number.isFinite(staleDays) && staleDays > 0 && staleDays <= 365 ? staleDays : DEFAULT_SETTINGS.staleDays,
      wipLimits
    });
    showToast('Settings saved');
  }catch(e){ showToast('Could not save settings: ' + e.message); }
});

$('testWebhookBtn').addEventListener('click', async () => {
  const url = $('setWebhook').value.trim();
  if(!isValidWebhookUrl(url)){ showToast('Paste a Discord webhook URL first'); return; }
  const ok = await sendTestMessage(url);
  showToast(ok ? 'Test message sent — check your Discord channel' : 'Discord rejected the test message — check the URL');
});
