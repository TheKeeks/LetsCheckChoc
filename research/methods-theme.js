// Shared by the standalone research page and its Methods / Map embeds.
(function () {
  'use strict';
  var root = document.documentElement;
  var query = new URLSearchParams(location.search);
  var view = query.get('view');
  root.dataset.researchView = view === 'methods' || view === 'map' ? view : 'full';
  // The Map page's Model tab: only the map, filling its frame.
  if (view === 'map' && query.get('fill') === '1') root.dataset.researchFill = '1';
  // ui=forecast: the Forecast tab's map (research/map.html), the forecast alone, its hour, spot and zoom set by the tab;
  // ui=explore: the Explore tab's map
  var ui = query.get('ui');
  if (view === 'map' && (ui === 'forecast' || ui === 'explore')) root.dataset.researchUi = ui;

  function normalizeTheme(value) {
    if (value === 'dark' || value === 'night') return 'dark';
    if (value === 'light' || value === 'day') return 'light';
    return null;
  }
  function applyTheme(value) {
    var theme = normalizeTheme(value);
    if (!theme || root.dataset.researchTheme === theme) return;
    root.dataset.researchTheme = theme;
    window.dispatchEvent(new Event('lcc-theme-change'));
  }
  var initial = normalizeTheme(query.get('theme'));
  if (!initial) {
    try { initial = normalizeTheme(localStorage.getItem('lcc-clean-display')); } catch (_) { /* private mode */ }
  }
  applyTheme(initial || 'light');

  // Only the embedding page can change the theme or selected historical day, or say the surf log changed.
  var logTimer = 0;
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== window.parent || window.parent === window) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'lcc-theme') applyTheme(data.theme);
    if (data.type === 'lcc-map-date' && root.dataset.researchView === 'map' && /^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) {
      if (window.CHOC && window.CHOC.showPast) window.CHOC.showPast(data.date);
    }
    // a session saved, edited or deleted on the site: the ten years' sessions and photos read the log again
    // (once for a burst: a save says so as it starts and again once it is in the cloud)
    if (data.type === 'lcc-log') {
      clearTimeout(logTimer);
      logTimer = setTimeout(function () { if (window.CHOC && window.CHOC.reloadLog) window.CHOC.reloadLog(); }, 400);
    }
  });

  // The spot and, on the forecast, the hour the map shows, for the 3D map to open on.
  function open3D() {
    var trip = window.CHOC && window.CHOC.trip, fc = trip && trip.fc, st = trip && trip.state;
    var row = fc && fc.d && fc.d.gfs && fc.d.gfs[fc.i];
    var msg = { type: 'lcc-open-3d', spot: fc && fc.spot === 'wild' ? 'wild' : 'choc', time: st && st.phase === 'week' && row ? row.t : null };
    if (window.parent !== window) { window.parent.postMessage(msg, location.origin); return; }
    var target = new URL('../map/index.html', location.href);
    target.searchParams.set('show', '3d');
    target.searchParams.set('theme', root.dataset.researchTheme);
    if (msg.spot === 'wild') target.searchParams.set('view', 'fishers');
    if (msg.time) target.searchParams.set('time', msg.time);
    location.href = target.href;
  }

  window.addEventListener('DOMContentLoaded', function () {
    document.title = root.dataset.researchUi === 'forecast' ? 'Forecast map · LetsCheckChoc' : root.dataset.researchView === 'map' ? 'Map explorer · LetsCheckChoc' : 'Methods · LetsCheckChoc';
    function openMap(date) {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'lcc-open-map', date: date || null }, location.origin);
      } else {
        var target = new URL('../map/index.html', location.href);
        target.searchParams.set('theme', root.dataset.researchTheme);
        if (date) target.searchParams.set('date', date);
        location.href = target.href;
      }
    }
    document.querySelectorAll('[data-open-map]').forEach(function (link) {
      link.addEventListener('click', function (event) { event.preventDefault(); openMap(); });
    });
    if (root.dataset.researchView === 'methods' && window.CHOC) window.CHOC.showPast = openMap;
    // The Map page's map: a "3D" button beside Layers, the key and Full screen opens the sea floor
    // around Fishers in 3D at the same spot and hour (the Map page answers lcc-open-3d).
    var tr = document.getElementById('hubTr');
    if (root.dataset.researchView === 'map' && tr && !document.getElementById('hub3d')) {
      var b3 = document.createElement('button');
      b3.type = 'button'; b3.className = 'hub-ib hub-3d'; b3.id = 'hub3d';
      b3.title = 'The sea floor in 3D';
      b3.setAttribute('aria-label', 'Explore the sea floor around Fishers in 3D');
      b3.innerHTML = '<span aria-hidden="true">3D</span>';
      b3.addEventListener('click', open3D);
      tr.appendChild(b3);
    }
    var date = query.get('date');
    if (root.dataset.researchView === 'map' && /^\d{4}-\d{2}-\d{2}$/.test(date || '') && window.CHOC && window.CHOC.showPast) window.CHOC.showPast(date);
  });
})();
