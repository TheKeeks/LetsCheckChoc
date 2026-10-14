// The Explore tab (part 'map', #map): map/index.html, loaded the first time the tab is opened. It shows
// the Sound Check map's past days, with the ten years month by month beside them, and Drop a wave, and,
// from its "3D" button, the sea floor in 3D. (This week's forecast is the Forecast tab's map.)
(function () {
  'use strict';
  if (!window.CLEAN) return;
  var C = window.CLEAN, frame, pendingDate = null, pending3d = null;
  function sync(extra) {
    if (!frame || !frame.contentWindow || !frame.getAttribute('src')) return;
    frame.contentWindow.postMessage(Object.assign({ type: 'lcc-map', theme: C.theme() === 'night' ? 'dark' : 'light', active: C.tab() === 'map' && C.sub.depth() === 0 }, extra || {}), location.origin);
  }
  function load() {
    if (!frame || frame.getAttribute('src')) return;
    var p3 = pending3d;
    frame.src = 'map/index.html?embed=1&theme=' + (C.theme() === 'night' ? 'dark' : 'light') + (pendingDate ? '&date=' + encodeURIComponent(pendingDate) : '') +
      (p3 ? '&show=3d&view=' + (p3.spot === 'wild' ? 'fishers' : 'choc') + (p3.time ? '&time=' + encodeURIComponent(new Date(p3.time).toISOString()) : '') : '');
    pending3d = null;
  }
  C.register('map', {
    mount: function (el) {
      el.innerHTML = '<div class="cl-map-wrap"><iframe class="cl-map-frame" title="Explore: past days, ten years month by month, drop a wave, and the sea floor in 3D" allow="fullscreen"></iframe><p class="cl-map-link"><a href="map/index.html" target="_blank" rel="noopener">Open Explore in its own window ↗</a></p></div>';
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
  // the Forecast map's "3D" button: the sea floor in 3D at that spot and hour
  C.on('x-open-3d', function (data) {
    var p3 = { spot: data && data.spot === 'wild' ? 'wild' : 'choc', time: data && data.time ? data.time : null };
    var fresh = !frame || !frame.getAttribute('src');
    pendingDate = null;
    if (fresh) pending3d = p3;            // the first load opens straight into 3D (onShow loads the frame)
    C.show('map');
    if (!fresh) sync({ open3d: true, spot: p3.spot, time: p3.time });
  });
  C.on('x-open-map', function (data) {
    pendingDate = data && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
    C.show('map');
    load();
    sync(pendingDate ? { date: pendingDate } : {});
  });
})();
