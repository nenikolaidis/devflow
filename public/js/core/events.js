/* =========================================================
   core/events.js — a tiny publish/subscribe hub.

   Lets the data layer say "tickets changed" without knowing which
   screens exist, and lets screens react without importing each other.

     on(EVENTS.TICKETS_CHANGED, () => repaint());
     emit(EVENTS.TICKETS_CHANGED);
========================================================= */

export const EVENTS = {
  TICKETS_CHANGED: 'tickets-changed',
  TEAM_CHANGED: 'team-changed',          // allowlist
  REQUESTS_CHANGED: 'requests-changed',  // access requests
  PROFILES_CHANGED: 'profiles-changed',
  SETTINGS_CHANGED: 'settings-changed'
};

const listeners = {};

export function on(event, handler){
  (listeners[event] = listeners[event] || []).push(handler);
}

export function emit(event, payload){
  (listeners[event] || []).forEach(handler => {
    try{ handler(payload); }
    catch(e){ console.error(`Error in "${event}" handler:`, e); }
  });
}
