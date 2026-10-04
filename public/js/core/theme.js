/* =========================================================
   core/theme.js — light / dark theme.

   Default: follow the computer's setting (prefers-color-scheme).
   The toggle saves an explicit choice in localStorage; "Use system
   theme" clears it. The colors themselves are CSS variables in
   css/style.css; js/theme-init.js applies a saved choice before paint.
========================================================= */
const KEY = 'devflow:theme';
const root = document.documentElement;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = [];

/** The theme actually showing: 'light' or 'dark'. */
export function currentTheme(){
  const forced = root.getAttribute('data-theme');
  if(forced === 'light' || forced === 'dark') return forced;
  return systemDark.matches ? 'dark' : 'light';
}

/** True when no explicit choice is saved. */
export function isFollowingSystem(){
  return !root.hasAttribute('data-theme');
}

export function setTheme(theme){
  root.setAttribute('data-theme', theme);
  try{ localStorage.setItem(KEY, theme); }catch(e){ /* not saved; still applied */ }
  notify();
}

export function toggleTheme(){
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function followSystem(){
  root.removeAttribute('data-theme');
  try{ localStorage.removeItem(KEY); }catch(e){ /* ignore */ }
  notify();
}

/** Runs fn(theme) now and whenever the theme changes. */
export function onThemeChange(fn){
  listeners.push(fn);
  fn(currentTheme());
}

function notify(){ listeners.forEach(fn => fn(currentTheme())); }
systemDark.addEventListener('change', () => { if(isFollowingSystem()) notify(); });
