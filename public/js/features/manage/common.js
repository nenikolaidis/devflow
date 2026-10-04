/* =========================================================
   features/manage/common.js — small pieces shared by the Manage
   sections: headings, "choose a project first", and saving a group of
   project settings.
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { showToast } from '../../core/ui.js';
import { isPermissionError } from '../../core/format.js';
import * as api from '../../data/api.js';

/** Section title + one-line explanation (+ optional "scope" chip: Workspace / project name). */
export function sectionHead(title, description, scope = 'project'){
  const chip = scope === 'workspace' ? 'Workspace' : (state.project ? `${state.project.key} · ${state.project.name}` : '');
  return html`<div class="manage-head">
    <div><h2>${title}</h2>${description ? html`<p class="manage-desc">${description}</p>` : ''}</div>
    ${chip ? html`<span class="scope-chip">${chip}</span>` : ''}
  </div>`;
}

/** Shown in project sections when no project is open. */
export function noProject(){
  return html`<div class="card-section empty-state"><p>Choose a project from the menu in the top bar first${state.projects.length ? '' : ' — or create one in Projects'}.</p></div>`;
}

/** Saves some project settings fields; shows a toast either way. Returns true on success. */
export async function saveProjectSettings(fields, what = 'Settings'){
  try{
    await api.saveSettings(fields);
    showToast(`${what} saved`, 'success');
    return true;
  }catch(e){
    showToast(isPermissionError(e) ? `${what}: your role can't change this.` : `Could not save ${what.toLowerCase()}: ${e.message}`, 'error');
    return false;
  }
}

/** Runs an async action with a toast on failure. */
export async function attempt(what, fn){
  try{ return await fn(); }
  catch(e){
    console.error(what, e);
    showToast(isPermissionError(e) ? `${what}: you don't have permission for that.` : `${what}: ${e.message}`, 'error');
    return false;
  }
}

/** A lowercase id made from a name ("QA Lead" → "qa-lead"). */
export function slug(text, max = 30){
  return String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'item';
}

/** Marks a section as having unsaved edits so live updates don't overwrite them. */
export function trackDirty(container){
  container.addEventListener('input', () => { container.dataset.dirty = '1'; });
  container.addEventListener('change', () => { container.dataset.dirty = '1'; });
}
