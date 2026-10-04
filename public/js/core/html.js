/* =========================================================
   core/html.js — safe HTML templates.

   Every value placed inside an html`` template is escaped automatically,
   so text typed by users (titles, names, comments) can never turn into
   markup or script. Use it for ALL HTML built from data:

     el.innerHTML = html`<p class="title">${ticket.title}</p>`;

   - Arrays are joined:           html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`
   - Nested html`` is kept as-is: html`<div>${cond ? html`<b>yes</b>` : ''}</div>`
   - null / undefined / false render as nothing.
   - raw(str) inserts trusted markup unescaped. Only use it for markup
     the code itself wrote, never for data.
========================================================= */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for use in HTML content *and* attribute values (quotes included). */
export function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ENTITIES[ch]);
}

class SafeHtml {
  constructor(value){ this.value = value; }
  toString(){ return this.value; }
}

/** Marks a string of trusted, code-authored markup as safe to insert unescaped. */
export function raw(markup){
  return new SafeHtml(String(markup));
}

function render(value){
  if(value === null || value === undefined || value === false) return '';
  if(value instanceof SafeHtml) return value.value;
  if(Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/** Tagged template: html`<b>${userText}</b>` → safe markup. */
export function html(strings, ...values){
  let out = strings[0];
  for(let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
