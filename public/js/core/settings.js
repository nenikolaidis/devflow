/* =========================================================
   core/settings.js — board settings with defaults filled in.

   The saved values come from Firestore (config/settings, kept in
   state.settings by data/sync.js). Always read them through
   getSettings() so missing values fall back to DEFAULT_SETTINGS.
========================================================= */
import { state } from './state.js';
import { DEFAULT_SETTINGS, LABEL_PALETTE } from './constants.js';

export function getSettings(){
  const s = state.settings || {};
  return {
    discordWebhookUrl: s.discordWebhookUrl || DEFAULT_SETTINGS.discordWebhookUrl,
    staleDays: Number.isFinite(s.staleDays) && s.staleDays > 0 ? s.staleDays : DEFAULT_SETTINGS.staleDays,
    wipLimits: { ...DEFAULT_SETTINGS.wipLimits, ...(s.wipLimits || {}) },
    labels: Array.isArray(s.labels) && s.labels.length ? s.labels : DEFAULT_SETTINGS.labels,
    dodItems: Array.isArray(s.dodItems) ? s.dodItems : DEFAULT_SETTINGS.dodItems,
    weeklySummary: s.weeklySummary === true
  };
}

/** CSS color for a label name (labels not in the list, e.g. old ones, are gray). */
export function labelColor(name){
  const found = getSettings().labels.find(l => l.name === name);
  return LABEL_PALETTE[found && found.color] || LABEL_PALETTE.gray;
}

/** Label names, in the admin's order. */
export function labelNames(){
  return getSettings().labels.map(l => l.name);
}
