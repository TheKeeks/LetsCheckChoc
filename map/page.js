/* Map page, the Explore tab: one map. It opens on the Sound Check map's Past view
 * (research/index.html?view=map&fill=1&ui=explore: any day since 2016, with the ten years month by
 * month beside it, and Drop a wave; this week's forecast is the Forecast tab's), and its "3D"
 * button opens the sea floor around Fishers in 3D for a closer look (map.js, with MapLibre, loaded
 * the first time it is asked for); "← Map" goes back.
 *
 * Embedded (?embed=1) the parent page drives theme, spot, hour and day with postMessage
 * {type: 'lcc-map', theme, spot, time, active, date, ui, open3d}; a date opens that day on the Sound
 * Check map, and open3d the sea floor in 3D at that spot ('choc' | 'wild') and time. ?show=3d (and ?compact=1, a 3D picture with no Sound Check map) start in 3D.
 * The 3D map answers {type: 'lcc-map-ready'} once and {type: 'lcc-map-spot', spot} when its
 * spot buttons are used. window.ChocMap is the same API for tests.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const q = new URLSearchParams(location.search);
  const EMBED = q.get('embed') === '1', COMPACT = q.get('compact') === '1';
  const VIEWS = ['choc', 'race', 'fishers', 'sound'];
  const PANES = ['explorer', 'seafloor'];
  const state = {
    tab: COMPACT || q.get('show') === '3d' ? 'seafloor' : 'explorer',
    view: q.get('spot') === 'race' ? 'race' : VIEWS.includes(q.get('view')) ? q.get('view') : 'choc',
    theme: root.dataset.theme || 'light', active: true,
    wantTime: Date.parse(q.get('time') || '') || null,
    ui: q.get('ui') === 'peek' ? 'peek' : 'full',
    pastDate: /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : null
  };
  const status = t => { $('status').textContent = t || ''; };
  const frame = $('explorerFrame');
  let sea = null, seaLoad = null;                  // the 3D map, once built

  // ── Which map is on screen. The hidden one keeps its size (the 3D map must not resize to zero).
  function show(t, focus) {
    if (!PANES.includes(t)) return;
    state.tab = t;
    PANES.forEach(k => { const on = k === t; $(k).classList.toggle('off', !on); $(k).setAttribute('aria-hidden', String(!on)); $(k).inert = !on; });
    if (t === 'explorer') {
      loadExplorer();
      if (sea) sea.setPanel(false);
      if (focus) { try { const b = frame.contentDocument && frame.contentDocument.getElementById('hub3d'); if (b) b.focus(); else frame.focus(); } catch (e) { frame.focus(); } }
    } else {
      startSeafloor();
      if (focus) $('back').focus();
    }
    if (sea) sea.onShow();
  }
  function loadExplorer() {
    if (frame.getAttribute('src')) return;
    frame.src = '../research/index.html?view=map&fill=1&ui=explore&theme=' + state.theme + (state.pastDate ? '&date=' + state.pastDate : '');
  }
  function hasWebGL() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  function loadScript(src) {
    return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  }
  function startSeafloor() {
    if (seaLoad) return seaLoad;
    if (!hasWebGL()) {
      status('This browser can’t draw the 3D map (WebGL is off). The Sound Check map still works.');
      root.classList.add('no3d');
      return (seaLoad = Promise.resolve(null));
    }
    status('Loading the 3D map…');
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '../vendor/maplibre/maplibre-gl.css'; document.head.appendChild(css);
    seaLoad = loadScript('../vendor/maplibre/maplibre-gl.js').then(() => loadScript('geometry.js')).then(() => loadScript('map.js')).then(() => {
      if ($('status').textContent === 'Loading the 3D map…') status('');
      sea = window.LCCSeafloor({ q, EMBED, COMPACT, state, status, hasWebGL }) || null;
      if (!sea) root.classList.add('no3d');
      else sea.onShow();
      return sea;
    }).catch(() => {
      status('The 3D map didn’t load. The Sound Check map still works.');
      root.classList.add('no3d');
      return null;
    });
    return seaLoad;
  }

  // ── Theme: the Sound Check map and the 3D map follow the page
  function setTheme(t) {
    t = t === 'dark' || t === 'night' ? 'dark' : 'light';
    if (t === state.theme && root.dataset.theme === t) return;
    state.theme = t; root.dataset.theme = t;
    if (frame.getAttribute('src') && frame.contentWindow) frame.contentWindow.postMessage({ type: 'lcc-theme', theme: t }, location.origin);
    if (sea) sea.applyTheme();
  }

  // ── The Sound Check map's "3D" button: the sea floor at the same spot and hour
  function open3D(d) {
    const t = Date.parse(d.time || '');
    const view = d.spot === 'wild' ? 'fishers' : 'choc';
    state.wantTime = Number.isFinite(t) ? t : Date.now();
    if (sea) { sea.go(view, { instant: true }); sea.toTime(state.wantTime); } else state.view = view;
    show('seafloor', true);
  }
  $('back').addEventListener('click', () => show('explorer', true));

  // ════════════════════════════════════════════════════════════════════
  // Parent page and tests
  // ════════════════════════════════════════════════════════════════════
  function receive(d) {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'lcc-theme') { setTheme(d.theme); return; }
    if (d.type !== 'lcc-map') return;
    if (d.theme) setTheme(d.theme);
    if ((d.spot === 'choc' || d.spot === 'race') && d.spot !== state.view) { if (sea) sea.go(d.spot); else state.view = d.spot; }
    const t = Date.parse(d.time || (d.forecast && d.forecast.time) || '');
    if (Number.isFinite(t)) { state.wantTime = t; if (sea) sea.toTime(t); }
    if ((d.ui === 'peek' || d.ui === 'full') && d.ui !== state.ui) { if (sea) sea.setUI(d.ui); else state.ui = d.ui; }
    if (typeof d.active === 'boolean' && d.active !== state.active) { state.active = d.active; if (sea) sea.onActive(); }
    if (d.open3d) { open3D({ spot: d.spot, time: d.time }); return; }   // the Forecast tab's map: its "3D" button
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) {
      state.pastDate = d.date;
      if (frame.getAttribute('src') && frame.contentWindow) frame.contentWindow.postMessage({ type: 'lcc-map-date', date: d.date }, location.origin);
      if (!COMPACT) show('explorer');
    }
  }
  addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    if (e.source === parent && parent !== window) receive(e.data);
    else if (e.source === frame.contentWindow && e.data && e.data.type === 'lcc-open-3d') open3D(e.data);
  });

  window.ChocMap = {
    get map() { return sea ? sea.map : null; },
    receive, setTheme, show, open3D, startSeafloor,
    go: (v, o) => { if (sea) sea.go(v, o); else if (VIEWS.includes(v)) state.view = v; },
    setSpot: s => window.ChocMap.go(s),
    set3D: on => { if (sea) sea.set3D(on); },
    setStep: i => { if (sea) sea.setStep(i); },
    setUI: m => { if (sea) sea.setUI(m); else state.ui = m === 'peek' ? 'peek' : 'full'; },
    getState: () => Object.assign({ ready: false, tab: state.tab, view: state.view, ui: state.ui, theme: state.theme, active: state.active,
      explorer: frame.getAttribute('src'), seafloor: sea ? 'ok' : seaLoad ? (root.classList.contains('no3d') ? 'failed' : 'loading') : 'idle' },
      sea ? sea.getState() : {})
  };

  show(state.tab);
})();
