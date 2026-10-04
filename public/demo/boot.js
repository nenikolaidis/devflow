/* =========================================================
   demo/boot.js — starts the public demo.

   1. Installs the in-memory stand-in for Firebase (demo/backend.js)
      and fills it with the sample workspace (demo/seed.js).
   2. Copies the real app's markup from index.html, so the demo is always
      the same app — only the data layer underneath is different.
   3. Adds the demo bar ("Viewing as …") and starts the app as usual.
========================================================= */
import { installDemoFirebase, signInAs } from './backend.js';
import { seedDemo, PEOPLE } from './seed.js';

const START_AS = 'alex@example.com';
// Shown next to each person in "Viewing as", so visitors can try each role.
const ROLE_HINTS = {
  'alex@example.com': 'Workspace admin',
  'maria@example.com': 'Project manager',
  'sam@example.com': 'Tech lead',
  'lena@example.com': 'Developer',
  'jordan@example.com': 'QA / Tester',
  'chris@example.com': 'Designer',
  'taylor@client.example.com': 'Viewer (client)'
};

function demoBar(){
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'About this demo');

  const pill = document.createElement('span');
  pill.className = 'demo-pill';
  pill.textContent = 'Live demo';

  const text = document.createElement('span');
  text.className = 'demo-text';
  text.textContent = 'Sample data that lives only in this tab. Nothing is saved — reload to start over.';

  const label = document.createElement('label');
  label.className = 'demo-person';
  label.textContent = 'Viewing as ';
  const select = document.createElement('select');
  select.id = 'demoPerson';
  Object.entries(PEOPLE).forEach(([email, [name]]) => {
    const option = new Option(`${name} · ${ROLE_HINTS[email]}`, email);
    option.selected = email === START_AS;
    select.append(option);
  });
  select.addEventListener('change', () => {
    signInAs(select.value);
    select.blur();
  });
  label.append(select);

  const link = document.createElement('a');
  link.className = 'demo-link';
  link.href = 'https://github.com/nenikolaidis/devflow.github.io';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Source on GitHub';

  bar.append(pill, text, label, link);
  return bar;
}

async function start(){
  installDemoFirebase();
  seedDemo();
  signInAs(START_AS);

  const res = await fetch('index.html', { cache: 'no-cache' });
  if(!res.ok) throw new Error(`Could not load the app (${res.status})`);
  const page = new DOMParser().parseFromString(await res.text(), 'text/html');
  page.querySelectorAll('script').forEach(s => s.remove());

  document.getElementById('demoLoading').remove();
  document.body.append(demoBar(), ...Array.from(page.body.childNodes, n => document.importNode(n, true)));

  // The app reads window.firebase (now the demo's) when it loads.
  await import('../js/app.js');
}

start().catch(e => {
  console.error(e);
  const msg = document.getElementById('demoLoading');
  if(msg) msg.textContent = 'The demo could not start. Please reload the page.';
});
