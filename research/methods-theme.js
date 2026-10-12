// Shared by the standalone research page and its Methods / Map embeds.
(function () {
  'use strict';
  var root = document.documentElement;
  var query = new URLSearchParams(location.search);
  var view = query.get('view');
  root.dataset.researchView = view === 'methods' || view === 'map' ? view : 'full';

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

  // Only the embedding page can change the theme or selected historical day.
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== window.parent || window.parent === window) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'lcc-theme') applyTheme(data.theme);
    if (data.type === 'lcc-map-date' && root.dataset.researchView === 'map' && /^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) {
      if (window.CHOC && window.CHOC.showPast) window.CHOC.showPast(data.date);
    }
  });

  window.addEventListener('DOMContentLoaded', function () {
    document.title = root.dataset.researchView === 'map' ? 'Map explorer · LetsCheckChoc' : 'Methods · LetsCheckChoc';
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
    var date = query.get('date');
    if (root.dataset.researchView === 'map' && /^\d{4}-\d{2}-\d{2}$/.test(date || '') && window.CHOC && window.CHOC.showPast) window.CHOC.showPast(date);
  });
})();
