/* =========================================================
   core/settings.js — board settings with defaults filled in.

   The saved values come from Firestore (config/settings, kept in
   state.settings by data/sync.js). Always read them through
   getSettings() so missing values fall back to DEFAULT_SETTINGS.
========================================================= */
import { state } from './state.js';
import { DEFAULT_SETTINGS } from './constants.js';

export function getSettings(){
  const s = state.settings || {};
  return {
    discordWebhookUrl: s.discordWebhookUrl || DEFAULT_SETTINGS.discordWebhookUrl,
    staleDays: Number.isFinite(s.staleDays) && s.staleDays > 0 ? s.staleDays : DEFAULT_SETTINGS.staleDays,
    wipLimits: { ...DEFAULT_SETTINGS.wipLimits, ...(s.wipLimits || {}) }
  };
}
