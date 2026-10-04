/* =========================================================
   core/icons.js — the app's line icons as inline SVG (no icon font,
   no network request, works with the Content-Security-Policy).

     icon('plus')            → 16px icon, inherits the text color
     icon('search', 18)
     statusIcon('in_review') → the column / status-step icon
     priorityIcon('high')    → signal bars (critical = red badge)

   All return trusted markup for use inside html``. Icons are
   decorative (aria-hidden); give their button an aria-label.
========================================================= */
import { raw } from './html.js';
import { normalizeStatus } from './constants.js';

const STROKE = {
  plus: '<path d="M8 3v10M3 8h10"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
  chevronDown: '<path d="m4 6 4 4 4-4"/>',
  chevronRight: '<path d="m6 4 4 4-4 4"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/>',
  monitor: '<rect x="2" y="2.5" width="12" height="8.5" rx="1.5"/><path d="M5.5 14h5M8 11v3"/>',
  board: '<rect x="2" y="2.5" width="3.5" height="11" rx="1"/><rect x="6.25" y="2.5" width="3.5" height="7" rx="1"/><rect x="10.5" y="2.5" width="3.5" height="9" rx="1"/>',
  table: '<path d="M2 4h12M2 8h12M2 12h12"/>',
  sort: '<path d="M3 4h10M5 8h6M7 12h2"/>',
  select: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="m5.5 8 1.8 1.8L10.8 6"/>',
  archive: '<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3"/>',
  restore: '<path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.5h2.5"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.5"/>',
  x: '<path d="m4 4 8 8M12 4l-8 8"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5"/>',
  link: '<path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a3 3 0 0 1 4.5 4.5l-1 1M9 11.5l-1 1A3 3 0 0 1 3.5 8l1-1"/>',
  lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  blocked: '<circle cx="8" cy="8" r="6"/><path d="m4 12 8-8"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>',
  edit: '<path d="M10.5 2.5 13.5 5.5 6 13H3v-3z"/>',
  user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5a5 5 0 0 1 10 0"/>',
  key: '<circle cx="5.5" cy="10.5" r="3"/><path d="m7.6 8.4 5.4-5.4M11 5l1.5 1.5"/>',
  logout: '<path d="M6 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6M10.5 11 13.5 8l-3-3M13.5 8H6"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.5v3.5M8 5h.01"/>',
  alert: '<path d="M8 2.5 14 13H2Z"/><path d="M8 6.5v3M8 11.5h.01"/>'
};

/** A named line icon (see STROKE above for the names). */
export function icon(name, size = 16){
  return raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${STROKE[name] || ''}</svg>`);
}

/** Status icon: dashed circle → half → three-quarters → filled check. */
export function statusIcon(status, size = 16){
  const shapes = {
    backlog: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 2.2"/>',
    in_progress: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor"/>',
    in_review: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5a3.5 3.5 0 1 1-3.5 3.5H8Z" fill="currentColor"/>',
    done: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m5 8.2 2.1 2 3.9-4.2" fill="none" stroke="var(--panel)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  const key = normalizeStatus(status);
  return raw(`<svg class="icon status-icon status-${key}" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${shapes[key] || shapes.backlog}</svg>`);
}

/** Priority as signal bars (low = 1, medium = 2, high = 3); critical is a red "!" badge. */
export function priorityIcon(priority, size = 16){
  if(priority === 'critical'){
    return raw(`<svg class="icon priority-icon priority-critical" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor"/><path d="M8 4.5v4.2" stroke="var(--card)" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1.05" fill="var(--card)"/></svg>`);
  }
  const lit = { low: 1, medium: 2, high: 3 }[priority] || 1;
  const bar = (n, x, y, h) => `<rect x="${x}" y="${y}" width="3" height="${h}" rx="1" fill="currentColor" opacity="${n <= lit ? 1 : 0.25}"/>`;
  return raw(`<svg class="icon priority-icon priority-${priority}" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${bar(1, 2, 9, 5)}${bar(2, 6.5, 6, 8)}${bar(3, 11, 3, 11)}</svg>`);
}

/** The devflow logo mark. */
export function logo(size = 26){
  return raw(`<svg class="logo" width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true" focusable="false"><rect width="26" height="26" rx="7" fill="var(--accent)"/><path d="M7 9h7M7 13h12M7 17h5" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round"/></svg>`);
}
