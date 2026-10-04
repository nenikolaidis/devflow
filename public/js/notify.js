import { state } from './state.js';

/* =========================================================
   EMAILJS CONFIG — replace with your own, from emailjs.com
   (Dashboard → Email Services / Email Templates / Account → API Keys)
   See SETUP.md for the full walkthrough, including the template
   variables this code sends: to_email, ticket_id, ticket_title,
   actor_email, board_url.
========================================================= */
const EMAILJS_PUBLIC_KEY = "YOUR_EMAILJS_PUBLIC_KEY";
const EMAILJS_SERVICE_ID = "YOUR_EMAILJS_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "YOUR_EMAILJS_TEMPLATE_ID";
/* ========================================================= */

const configured = EMAILJS_PUBLIC_KEY && !EMAILJS_PUBLIC_KEY.startsWith('YOUR_')
  && EMAILJS_SERVICE_ID && !EMAILJS_SERVICE_ID.startsWith('YOUR_')
  && EMAILJS_TEMPLATE_ID && !EMAILJS_TEMPLATE_ID.startsWith('YOUR_');

if(configured && window.emailjs){
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
}else if(!configured){
  console.info('DevFlow: EmailJS is not configured yet, so assignment emails are disabled. See SETUP.md.');
}

/**
 * Emails a ticket's assignee to let them know they were assigned.
 * Silently does nothing if EmailJS isn't configured, the owner field
 * isn't a real email address, or the assigner is assigning themself.
 */
export function notifyAssignment(ticket){
  if(!configured || !window.emailjs) return;
  const to = (ticket.owner || '').trim();
  if(!to || !to.includes('@')) return;
  if(state.currentUser && to.toLowerCase() === state.currentUser.email.toLowerCase()) return;

  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_email: to,
    ticket_id: ticket.id,
    ticket_title: ticket.title,
    actor_email: state.currentUser ? state.currentUser.email : '',
    board_url: window.location.href
  }).catch(err => console.error('Assignment email failed to send:', err));
}