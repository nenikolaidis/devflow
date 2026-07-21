// Entry point. Each imported module wires up its own DOM event
// listeners as a side effect of being loaded — this file just makes
// sure all of them get loaded, in a safe order (auth.js needs the
// others, so it's imported last).
import './firebase-init.js';
import './state.js';
import './constants.js';
import './utils.js';
import './notify.js';
import './discord.js';
import './dashboard.js';
import './profiles.js';
import './team.js';
import './tickets.js';
import './nav.js';
import './auth.js';