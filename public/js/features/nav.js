/* =========================================================
   features/nav.js — tab switching, and repainting the visible tab
   whenever live data changes.

   Data flow: Firestore → data/sync.js updates state → emits an event →
   the handlers below repaint only the tab that's currently showing.
========================================================= */
import { state } from '../core/state.js';
import { on, EVENTS } from '../core/events.js';
import { isAdmin } from '../core/permissions.js';
import { renderBoardView, exitSelectMode } from './board.js';
import { renderDashboard } from './dashboard.js';
import { renderMyWork } from './my-work.js';
import { renderAllowlist, renderRequests } from './team.js';
import { renderSettings } from './settings-panel.js';

const TABS = {
  board: { button: 'navBoard', view: 'boardView' },
  mywork: { button: 'navMyWork', view: 'myWorkView' },
  dashboard: { button: 'navDashboard', view: 'dashboardView' },
  team: { button: 'navTeam', view: 'teamView' }
};

export function switchTab(tab){
  if(tab === 'team' && !isAdmin()) tab = 'board';
  state.currentTab = tab;
  Object.entries(TABS).forEach(([name, ids]) => {
    const btn = document.getElementById(ids.button);
    btn.classList.toggle('active', name === tab);
    btn.setAttribute('aria-selected', String(name === tab));
    document.getElementById(ids.view).classList.toggle('hidden', name !== tab);
  });
  if(tab !== 'board') exitSelectMode();
  renderCurrentTab();
}

/** Repaints the visible tab from whatever is in state. */
export function renderCurrentTab(){
  if(state.currentTab === 'board') renderBoardView();
  if(state.currentTab === 'mywork') renderMyWork();
  if(state.currentTab === 'dashboard') renderDashboard();
  if(state.currentTab === 'team' && isAdmin()){
    renderAllowlist();
    renderRequests();
    renderSettings();
  }
}

Object.entries(TABS).forEach(([name, ids]) => {
  document.getElementById(ids.button).addEventListener('click', () => switchTab(name));
});

// Live data changed → repaint what's visible.
on(EVENTS.TICKETS_CHANGED, () => {
  if(state.currentTab === 'board') renderBoardView();
  if(state.currentTab === 'mywork') renderMyWork();
  if(state.currentTab === 'dashboard') renderDashboard();
});
on(EVENTS.PROFILES_CHANGED, renderCurrentTab);           // names/avatars appear everywhere
on(EVENTS.SETTINGS_CHANGED, renderCurrentTab);           // WIP limits, stale threshold
on(EVENTS.SPRINTS_CHANGED, renderCurrentTab);            // sprint filter, dashboard sprint panel
on(EVENTS.TEAM_CHANGED, () => {
  if(state.currentTab === 'board') renderBoardView();    // assignee filter
  if(state.currentTab === 'team' && isAdmin()) renderAllowlist();
});
on(EVENTS.REQUESTS_CHANGED, () => {
  if(state.currentTab === 'team' && isAdmin()) renderRequests();
});
