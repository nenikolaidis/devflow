import { state } from './state.js';
import { renderDashboard } from './dashboard.js';
import { renderAllowlist, renderRequests } from './team.js';
import { renderBoardView } from './tickets.js';

export function switchTab(tab){
  state.currentTab = tab;
  document.getElementById('navBoard').classList.toggle('active', tab === 'board');
  document.getElementById('navDashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('navTeam').classList.toggle('active', tab === 'team');
  document.getElementById('boardView').classList.toggle('hidden', tab !== 'board');
  document.getElementById('dashboardView').classList.toggle('hidden', tab !== 'dashboard');
  document.getElementById('teamView').classList.toggle('hidden', tab !== 'team');

  if(tab !== 'board' && state.selectMode){
    state.selectMode = false;
    state.selectedIds.clear();
    document.getElementById('selectModeBtn').classList.remove('active');
    const bar = document.getElementById('bulkBar');
    if(bar) bar.remove();
  }

  // Re-render whichever view we're switching into, using whatever data
  // has already arrived via the real-time listeners — those listeners
  // only paint the DOM while their tab is active, so a tab switch needs
  // to trigger a repaint itself (this also fixes tabs feeling "stale"
  // if data changed while you were looking at a different tab).
  if(tab === 'board') renderBoardView();
  if(tab === 'dashboard') renderDashboard();
  if(tab === 'team' && state.currentRole === 'admin'){
    renderAllowlist();
    renderRequests(state.requestsCache);
  }
}

document.getElementById('navBoard').addEventListener('click', () => switchTab('board'));
document.getElementById('navDashboard').addEventListener('click', () => switchTab('dashboard'));
document.getElementById('navTeam').addEventListener('click', () => switchTab('team'));