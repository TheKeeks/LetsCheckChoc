(function () {
  'use strict';
  // ── say so on the page when something breaks. The crew use this on iPads and phones with no developer tools, so a
  // failure used to leave no trace at all. Two cases:
  //  - a script error: its message and where it happened;
  //  - the browser killed the page and reloaded it (iPad Safari does this when a tab uses too much memory): noticed on
  //    the next load from a heartbeat that closing, reloading or switching away would have cleared.
  // One heartbeat per kind of page (file, view, profile): the site runs several at once in one tab (the Forecast tab's
  // map, Explore's, Methods), and one finding another's heartbeat took it for a crash.
  const Q = new URLSearchParams(location.search);
  const KEY = ['sc-alive', location.pathname.split('/').pop() || 'index.html', Q.get('view') || '', Q.get('ui') || ''].join(':');
  let box = null, shown = 0;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function show(html) {
    if (!document.body) { addEventListener('DOMContentLoaded', () => show(html), { once: true }); return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'scErr'; box.setAttribute('role', 'alert');
      box.innerHTML = '<button type="button" aria-label="Dismiss">×</button><div></div>';
      box.firstChild.addEventListener('click', () => { box.hidden = true; });
      document.body.appendChild(box);
    }
    box.hidden = false; box.lastChild.innerHTML = html;
  }
  addEventListener('error', (e) => {
    if (!e || !e.message || /ResizeObserver loop/.test(e.message) || shown++ > 2) return;
    const where = e.filename ? ` (${esc(e.filename.split(/[?#]/)[0].split('/').pop() || 'page')}${e.lineno ? ' line ' + e.lineno : ''})` : '';
    show(`<b>Something went wrong on this page:</b> ${esc(e.message)}${where}. Reloading usually clears it; if it keeps happening, a screenshot of this note helps get it fixed.`);
  });
  try {
    const prev = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (prev && Date.now() - prev.t < 10 * 60 * 1000) {
      const W = prev.W ? ` while the map was zoomed in to about ${prev.W < 10 ? prev.W.toFixed(1) : Math.round(prev.W)} km across` : '';
      show(`<b>This page stopped and was reloaded</b>${W}. That usually means the browser ran out of memory. A screenshot of this note helps get it fixed.`);
    }
    sessionStorage.removeItem(KEY);
  } catch (e) { /* no storage: no note */ }
  const beat = () => {
    if (document.visibilityState === 'hidden') return;
    try { const c = window.CHOC && window.CHOC.trip && window.CHOC.trip.state && window.CHOC.trip.state.cam; sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), W: c ? +c.W : null })); } catch (e) { /* ignore */ }
  };
  const clear = () => { try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
  setInterval(beat, 2000); addEventListener('pageshow', beat); addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clear(); else beat(); });   // a tab the system discards in the background is not a crash
})();
