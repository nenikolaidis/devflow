/* =========================================================
   core/settings.js — the current project's settings with defaults
   filled in, plus helpers for labels and ticket types.

   The saved values come from Firestore (projects/{pid}/config/settings,
   kept in state.settings by data/sync.js). Always read them through
   these functions so missing values fall back to DEFAULT_SETTINGS.
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
    types: Array.isArray(s.types) && s.types.length ? s.types : DEFAULT_SETTINGS.types,
    dodItems: Array.isArray(s.dodItems) ? s.dodItems : DEFAULT_SETTINGS.dodItems,
    weeklySummary: s.weeklySummary === true
  };
}

/* ---------------- LABELS ---------------- */

/** CSS color for a label name (labels not in the list, e.g. old ones, are gray). */
export function labelColor(name){
  const found = getSettings().labels.find(l => l.name === name);
  return LABEL_PALETTE[found && found.color] || LABEL_PALETTE.gray;
}

/** Label names, in the project's order. */
export function labelNames(){
  return getSettings().labels.map(l => l.name);
}

/* ---------------- TICKET TYPES ---------------- */

/** All of the project's types (including switched-off ones), with CSS colors resolved. */
export function allTypes(){
  return getSettings().types.map(t => ({ ...t, css: LABEL_PALETTE[t.color] || LABEL_PALETTE.gray }));
}

/** Types offered when creating or editing a ticket (switched-on ones). */
export function activeTypes(){
  return allTypes().filter(t => t.enabled !== false);
}

/** { key, label, icon, css } for a type key; unknown keys show as a plain type. */
export function typeInfo(key){
  return allTypes().find(t => t.key === key)
    || { key, label: key ? key[0].toUpperCase() + key.slice(1) : 'Task', icon: 'checkSquare', css: LABEL_PALETTE.gray };
}

/**
 * A ticket's type. Tickets created before types existed get one from
 * their labels (a "bug" label → Bug), so nothing needs migrating.
 */
export function typeOf(t){
  if(t.type) return t.type;
  const keys = allTypes().map(x => x.key);
  return (t.labels || []).find(l => keys.includes(l)) || 'task';
}

/** Type keys (used to hide old labels that are now types). */
export function typeKeys(){
  return allTypes().map(t => t.key);
}
