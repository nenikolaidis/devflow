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
import { raw, escapeHtml } from './html.js';
import { normalizeStatus } from './constants.js';
import { typeInfo } from './settings.js';

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
  alert: '<path d="M8 2.5 14 13H2Z"/><path d="M8 6.5v3M8 11.5h.01"/>',
  checkSquare: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="m5.5 8 1.8 1.8L10.8 6"/>',
  bug: '<rect x="5" y="5.5" width="6" height="8" rx="3"/><path d="M6 5.5a2 2 0 0 1 4 0M2.5 8.5H5M11 8.5h2.5M3 12l2-1M13 12l-2-1M3 5l2 1.5M13 5l-2 1.5M8 8v5"/>',
  sparkle: '<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M4 12l1.8-1.8M10.2 5.8 12 4"/>',
  shield: '<path d="M8 1.8 13 3.8v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4Z"/><path d="m5.8 8 1.5 1.5L10.4 6.4"/>',
  wrench: '<path d="M10.5 2.5a3 3 0 0 0-2.8 4L2.8 11.4a1.2 1.2 0 0 0 1.7 1.7L9.4 8.2a3 3 0 0 0 4-2.8l-1.8 1.1-1.7-.4-.4-1.7Z"/>',
  chartLine: '<path d="M2.5 13.5h11M3.5 11l3-3.5 2.5 2 4-5"/>',
  flask: '<path d="M6 2h4M6.5 2v4L3 12.5A1 1 0 0 0 3.9 14h8.2a1 1 0 0 0 .9-1.5L9.5 6V2M5 10h6"/>',
  users: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5a4.5 4.5 0 0 1 9 0M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 9.3a4.5 4.5 0 0 1 2.5 4.2"/>',
  inbox: '<path d="M2 9h3.5l1 2h3l1-2H14"/><path d="M3.5 3.5h9L14 9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9Z"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  listCheck: '<path d="M7 4h7M7 8h7M7 12h7"/><path d="m2 4 1 1 2-2M2 8.5l1 1 2-2M2 12.5l1 1 2-2"/>',
  book: '<path d="M2.5 3.5c2-.8 4-.6 5.5.5 1.5-1.1 3.5-1.3 5.5-.5v9c-2-.8-4-.6-5.5.5-1.5-1.1-3.5-1.3-5.5-.5Z"/><path d="M8 4v9"/>',
  rocket: '<path d="M9.5 2.5c2 .2 3.8 2 4 4L9 11 5 7Z"/><path d="M5 7 3 7.5l-.5 2L5 9M9 11l-.5 2-2 .5L7 11M4.5 11.5l-2 2"/>',
  layers: '<path d="M8 2.5 14 6 8 9.5 2 6Z"/><path d="m2 9 6 3.5L14 9"/>',
  palette: '<path d="M8 2a6 6 0 1 0 0 12c1 0 1.5-.6 1.5-1.4 0-1-.9-1.3-.9-2.1 0-.8.7-1.5 1.5-1.5h1.4A2.5 2.5 0 0 0 14 6.5C14 4 11.3 2 8 2Z"/><circle cx="5" cy="7" r=".8"/><circle cx="7.5" cy="4.8" r=".8"/><circle cx="10.5" cy="5.2" r=".8"/>',
  server: '<rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.2"/><path d="M5 4.8h.01M5 11.2h.01"/>',
  folder: '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  tag: '<path d="M2.5 2.5h5l6 6-5 5-6-6Z"/><circle cx="5.2" cy="5.2" r=".9"/>',
  file: '<path d="M4 1.8h5.5L12.5 5v8.7a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2.3a.5.5 0 0 1 .5-.5Z"/><path d="M9.5 1.8V5h3M5.8 8.5h4.4M5.8 11h4.4"/>',
  key2: '<circle cx="5.5" cy="10.5" r="3"/><path d="m7.6 8.4 5.4-5.4M11 5l1.5 1.5"/>',
  plug: '<path d="M6 1.8v3M10 1.8v3M4 4.8h8v2.5a4 4 0 0 1-8 0Z"/><path d="M8 11.3v2.9"/>',
  home: '<path d="M2.5 7.5 8 2.5l5.5 5"/><path d="M4 6.5v7h8v-7"/>',
  inboxIn: '<path d="M2 9h3.5l1 2h3l1-2H14"/><path d="M3.5 3.5h9L14 9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9Z"/><path d="M8 1.8v5M6 4.8l2 2 2-2"/>'
};

/** The icon for a ticket type (from the project's types), colored by type. */
export function typeIcon(typeKey, size = 16){
  const info = typeInfo(typeKey);
  return raw(`<span class="type-icon" style="color:${info.css}" title="${escapeHtml(info.label)}">${icon(info.icon, size)}</span>`);
}

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
