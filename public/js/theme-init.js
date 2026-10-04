/* theme-init.js — runs before the page paints (a plain script in <head>,
   not a module) so a saved light/dark choice applies without a flash.
   No saved choice = follow the computer's setting (see core/theme.js). */
(function(){
  try{
    var t = localStorage.getItem('devflow:theme');
    if(t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  }catch(e){ /* storage blocked: follow the system setting */ }
})();
