// Dedicated, lazily loaded sea-floor and research map.
(function () {
  'use strict';
  if (!window.CLEAN) return;
  var C = window.CLEAN, frame, pendingDate = null;
  function sync(extra) {
    if (!frame || !frame.contentWindow || !frame.getAttribute('src')) return;
    frame.contentWindow.postMessage(Object.assign({ type: 'lcc-map', theme: C.theme() === 'night' ? 'dark' : 'light', active: C.tab() === 'map' && C.sub.depth() === 0 }, extra || {}), location.origin);
  }
  function load() {
    if (!frame || frame.getAttribute('src')) return;
    frame.src = 'map/index.html?embed=1&theme=' + (C.theme() === 'night' ? 'dark' : 'light') + (pendingDate ? '&date=' + encodeURIComponent(pendingDate) : '');
  }
  C.register('map', {
    mount: function (el) {
      el.innerHTML = '<div class="cl-map-wrap"><iframe class="cl-map-frame" title="Map: bathymetry, terrain and swell layers" allow="fullscreen"></iframe><p class="cl-map-link"><a href="map/index.html" target="_blank" rel="noopener">Open map in its own window ↗</a></p></div>';
      frame = el.querySelector('iframe');
      frame.addEventListener('load', function () { sync(pendingDate ? { date: pendingDate } : {}); });
      C.on('tab', function () { sync(); });
      C.on('sub', function () { sync(); });
      window.addEventListener('message', function (event) {
        if (event.origin !== location.origin || !event.data) return;
        if (event.source === frame.contentWindow && event.data.type === 'lcc-map-ready') sync(pendingDate ? { date: pendingDate } : {});
      });
    },
    render: function () {},
    onShow: function () { load(); sync(); },
    onTheme: function () { sync(); }
  });
  C.on('x-open-map', function (data) {
    pendingDate = data && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
    C.show('map');
    load();
    sync(pendingDate ? { date: pendingDate } : {});
  });
})();
