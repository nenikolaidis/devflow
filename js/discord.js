import { state } from './state.js';

/* =========================================================
   DISCORD WEBHOOK CONFIG — replace with your own
   Discord: Server Settings → Integrations → Webhooks → New Webhook
   → pick the channel → Copy Webhook URL → paste it below.
   See SETUP.md for the full walkthrough and a security note about
   this URL being visible in your site's source code.
========================================================= */
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1529151262237393048/xDGRd7zml6yL0wkPjrdtZbLMJe4FtiESNe8EnJVeFBk73yPwyOr2qJj6pZ2t8J-W2ycx";
/* ========================================================= */

const configured = DISCORD_WEBHOOK_URL && !DISCORD_WEBHOOK_URL.startsWith('YOUR_');

if(!configured){
  console.info('DevFlow: Discord webhook is not configured yet, so Discord notifications are disabled. See SETUP.md.');
}

const PRIORITY_HEX = { critical: 0xD9635B, high: 0xE8A33D, medium: 0x5B8DD9, low: 0x4FA98C };
const NEUTRAL_HEX = 0x6E7060;

async function post(payload){
  if(!configured) return;
  try{
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }catch(e){ console.error('Discord notification failed to send:', e); }
}

function actorEmail(){ return state.currentUser ? state.currentUser.email : 'unknown'; }
function pingFor(ticket){ return ticket.priority === 'critical' ? '@here' : undefined; }

/** Posts a message when a new ticket is created. */
export function notifyTicketCreated(ticket){
  post({
    content: pingFor(ticket),
    embeds: [{
      title: `🆕 New ticket — ${ticket.id}: ${ticket.title}`,
      description: ticket.description || undefined,
      color: PRIORITY_HEX[ticket.priority] || NEUTRAL_HEX,
      fields: [
        { name: 'Priority', value: ticket.priority, inline: true },
        { name: 'Owner', value: ticket.owner || 'Unassigned', inline: true },
        { name: 'Labels', value: (ticket.labels||[]).join(', ') || '—', inline: true },
        { name: 'Created by', value: actorEmail(), inline: false }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when a ticket is assigned (or reassigned) to someone. */
export function notifyTicketAssigned(ticket){
  post({
    content: pingFor(ticket),
    embeds: [{
      title: `👤 ${ticket.id} assigned to ${ticket.owner}`,
      description: ticket.title,
      color: PRIORITY_HEX[ticket.priority] || NEUTRAL_HEX,
      fields: [
        { name: 'Priority', value: ticket.priority, inline: true },
        { name: 'Assigned by', value: actorEmail(), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when one or more tickets are deleted (single delete or bulk delete). */
export function notifyTicketsDeleted(tickets){
  if(!tickets || tickets.length === 0) return;
  const hasCritical = tickets.some(t => t.priority === 'critical');
  const list = tickets.map(t => `**${t.id}** — ${t.title}`).join('\n');
  post({
    content: hasCritical ? '@here' : undefined,
    embeds: [{
      title: tickets.length === 1 ? '🗑️ Ticket deleted' : `🗑️ ${tickets.length} tickets deleted`,
      description: list,
      color: NEUTRAL_HEX,
      fields: [{ name: 'Deleted by', value: actorEmail(), inline: false }],
      timestamp: new Date().toISOString()
    }]
  });
}