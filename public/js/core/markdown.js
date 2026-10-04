/* =========================================================
   core/markdown.js — a deliberately small, safe formatter for ticket
   descriptions.

   Supported (one per line):
     # Heading / ## Heading      → heading
     - item  or  * item          → bullet list
     1. item                     → numbered list
     - [ ] todo  /  - [x] done   → checklist (tickable in the ticket panel)
     blank line                  → new paragraph
   Inline: `code`, **bold**, and http(s) links become clickable.

   Everything is HTML-escaped BEFORE any formatting is applied, so text
   from users can never become markup. Nothing else (images, raw HTML,
   tables) is supported, on purpose.
========================================================= */
import { escapeHtml, raw } from './html.js';

const CHECK_RE = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUMBER_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^\s*#{1,3}\s+(.*)$/;

/** Inline formatting on one line of text (escapes first). */
function inline(text){
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // The URL is already escaped, so it's safe inside the attribute.
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return out;
}

/**
 * Renders a description to safe HTML.
 * @param {string} text
 * @param {{ interactive?: boolean }} opts  interactive: checklist boxes can be ticked
 */
export function renderMarkdown(text, { interactive = false } = {}){
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;      // 'ul' | 'ol' | 'check'
  let para = [];

  const closeList = () => { if(list){ out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } };
  const closePara = () => { if(para.length){ out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
  const openList = (kind) => {
    if(list === kind) return;
    closeList(); closePara();
    out.push(kind === 'ol' ? '<ol>' : kind === 'check' ? '<ul class="md-checklist">' : '<ul>');
    list = kind;
  };

  lines.forEach((line, i) => {
    let m;
    if((m = line.match(CHECK_RE))){
      openList('check');
      const done = m[1].toLowerCase() === 'x';
      out.push(`<li class="${done ? 'done' : ''}"><label><input type="checkbox" data-line="${i}" ${done ? 'checked' : ''} ${interactive ? '' : 'disabled'}><span>${inline(m[2]) || '&nbsp;'}</span></label></li>`);
    }else if((m = line.match(HEADING_RE))){
      closeList(); closePara();
      out.push(`<h4 class="md-h">${inline(m[1])}</h4>`);
    }else if((m = line.match(BULLET_RE))){
      openList('ul');
      out.push(`<li>${inline(m[1])}</li>`);
    }else if((m = line.match(NUMBER_RE))){
      openList('ol');
      out.push(`<li>${inline(m[1])}</li>`);
    }else if(!line.trim()){
      closeList(); closePara();
    }else{
      closeList();
      para.push(inline(line));
    }
  });
  closeList(); closePara();
  return raw(out.join(''));
}

/** Checklist items in a description: [{ line, done, text }]. Empty "- [ ]" lines are ignored. */
export function checklistItems(text){
  return String(text || '').split(/\r?\n/).map((line, i) => {
    const m = line.match(CHECK_RE);
    return m && m[2].trim() ? { line: i, done: m[1].toLowerCase() === 'x', text: m[2].trim() } : null;
  }).filter(Boolean);
}

/** { done, total } for the checklist in a description. */
export function checklistProgress(text){
  const items = checklistItems(text);
  return { done: items.filter(i => i.done).length, total: items.length };
}

/** Returns the description with the checklist item on `lineIndex` ticked or unticked. */
export function toggleChecklistLine(text, lineIndex){
  const lines = String(text || '').split(/\r?\n/);
  const line = lines[lineIndex];
  if(line === undefined || !CHECK_RE.test(line)) return text;
  lines[lineIndex] = line.replace(/\[( |x|X)\]/, (_, mark) => (mark === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}
