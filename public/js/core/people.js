/* =========================================================
   core/people.js — how a teammate is shown: display name and
   initials avatar. Reads profiles from state (no Firestore calls).
========================================================= */
import { state } from './state.js';
import { AVATAR_COLORS, AVAILABILITY } from './constants.js';
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

/**
 * People who can be picked as owner/reviewer/@mention in the current
 * project: its members, plus workspace admins (who can work anywhere).
 */
export function projectPeople(){
  const members = (state.project && state.project.memberEmails) || [];
  const admins = state.allowlist.filter(u => u.role === 'admin').map(u => u.id);
  return [...new Set([...members, ...admins])];
}

/** Round initials avatar (safe html). */
export function avatarHtml(email, size = 20){
  const font = Math.max(9, Math.round(size * 0.42));
  const box = `width:${size}px;height:${size}px;font-size:${font}px;`;
  if(!email) return html`<span class="avatar avatar-empty" style="${box}" title="Unassigned"></span>`;
  const label = displayName(email);
  const color = avatarColor(email);
  // Tint background; initials mixed toward the text color so they stay readable in both themes.
  return html`<span class="avatar" style="${box}background:${color}2E;color:color-mix(in srgb, ${color} 55%, var(--text));" title="${label}">${initials(label)}</span>`;
}

/** "14:05" in the person's own time zone ('' if unknown). */
export function localTime(email){
  const tz = profileOf(email).timezone;
  if(!tz) return '';
  try{ return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date()); }
  catch(e){ return ''; }
}

/** { key, label, color } of the person's status (Available when not set). */
export function availabilityOf(email){
  const key = profileOf(email).availability;
  return AVAILABILITY.find(a => a.key === key) || AVAILABILITY[0];
}

/** Small status dot + label (safe html). */
export function availabilityBadge(email){
  const a = availabilityOf(email);
  return html`<span class="availability"><span class="label-dot" style="background:${a.color}"></span>${a.label}</span>`;
}

/**
 * Team members matching what someone typed, best matches first.
 * Matches the display name and the part of the email before "@" — not
 * the domain, which everyone on a team usually shares.
 * @param {string} query
 * @param {{ exclude?: string[] }} opts  emails to leave out (e.g. yourself, already picked)
 */
export function matchPeople(query, { exclude = [], pool = projectPeople() } = {}){
  const q = (query || '').trim().toLowerCase();
  const skip = exclude.map(normEmail);
  const scored = pool.map(id => ({ id }))
    .filter(u => !skip.includes(u.id))
    .map(u => {
      const name = displayName(u.id).toLowerCase();
      const local = u.id.split('@')[0];
      const score = !q ? 4
        : name === q || local === q || u.id === q ? 0
        : name.startsWith(q) || local.startsWith(q) ? 1
        : name.split(/\s+/).some(w => w.startsWith(q)) ? 2
        : name.includes(q) || local.includes(q) ? 3
        : -1;
      return { u, score, name };
    })
    .filter(x => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.map(x => x.u);
}
