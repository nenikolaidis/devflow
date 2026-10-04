/* =========================================================
   core/people.js — how a teammate is shown: display name and
   initials avatar. Reads profiles from state (no Firestore calls).
========================================================= */
import { state } from './state.js';
import { AVATAR_COLORS } from './constants.js';
import { html } from './html.js';
import { initials } from './format.js';
import { normEmail } from './permissions.js';

/** A stable color per person, picked from AVATAR_COLORS by hashing their email. */
export function avatarColor(email){
  const str = normEmail(email) || 'x';
  let hash = 0;
  for(let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function profileOf(email){
  return state.profiles[normEmail(email)] || {};
}

/** Profile name if set, otherwise the email itself. */
export function displayName(email){
  if(!email) return 'Unassigned';
  return profileOf(email).name || email;
}

/** Round initials avatar (safe html). */
export function avatarHtml(email, size = 20){
  const font = Math.max(9, Math.round(size * 0.42));
  const box = `width:${size}px;height:${size}px;font-size:${font}px;`;
  if(!email) return html`<span class="avatar" style="${box}">—</span>`;
  const label = displayName(email);
  const color = avatarColor(email);
  return html`<span class="avatar" style="${box}background:${color}22;color:${color};" title="${label}">${initials(label)}</span>`;
}
