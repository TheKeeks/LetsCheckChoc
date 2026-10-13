/* The sea floor in 3D: Fishers Island's sea floor in 2D or 3D, with the forecast on the water.
 * Loaded by page.js (with MapLibre and geometry.js) the first time the 3D map is opened;
 * window.LCCSeafloor(shell) builds it and returns its controls.
 *
 * One MapLibre map. "3D bathymetry" raises the terrain from the Fishers Island
 * viewer's elevation (0.8 m near the island, 4 m around it, then the Sound's
 * 16 m and 144 m grids) at an adjustable depth stretch; off, the same map lies
 * flat. Everything on the water is draped on that surface, so in 3D it rides
 * over the bottom:
 *
 *   wave height   the Sound Check refraction model for the forecast hour (height-worker.js)
 *   swell motion  streaks that follow wave rays traced over the bottom and slow
 *                 as they shoal (swell-worker.js), animated here on a canvas
 *   swell paths   the model's rays that reach Choc and Wilderness (research/fr)
 *
 * Sea-floor colors and terrain are drawn tile by tile in bathy-worker.js and
 * reach the map through the lccbathy:// protocol; aerial photos, the ocean
 * basemap and NOAA charts are live tile services.
 *
 * The page (page.js) owns the theme, the spot, the hour and whether the map is
 * on screen (shell.state); ui 'peek' (?compact=1&ui=peek: no controls, no
 * gestures) or 'full'.
 */
window.LCCSeafloor = function (shell) {
  'use strict';
  const $ = id => document.getElementById(id);
  const G = window.MapGeometry, ML = window.maplibregl;
  const q = shell.q, EMBED = shell.EMBED, COMPACT = shell.COMPACT, state = shell.state, status = shell.status;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const DPR = Math.min(2, devicePixelRatio || 1);
  const SOUND = [-72.4, 40.6, -70.85, 41.5];
  const FT = 3.28084;
  const ET = { timeZone: 'America/New_York' };
  const FC_LIVE = 'https://raw.githubusercontent.com/TheKeeks/LetsCheckChoc/fc-data/fc/';

  // Camera presets. Choc looks north onto the beach from Block Island Sound;
  // the Race looks north-east up the channel at the island's west end.
  const VIEWS = {
    choc: { center: [-71.9625, 41.2722], zoom: 15.1, pitch: 63, bearing: -12 },
    race: { center: [-72.052, 41.2335], zoom: 13.5, pitch: 62, bearing: 35 },
    fishers: { center: [-71.975, 41.262], zoom: 12.3, pitch: 52, bearing: -8 },
    sound: { center: [-71.72, 41.13], zoom: 9.3, pitch: 40, bearing: 0 }
  };
  const SPOTS = [
    { name: 'Choc', at: [-71.96339, 41.27557], cls: '' },
    { name: 'Wilderness', at: [-72.00845, 41.25419], cls: 'w' },
    { name: 'The Race', at: [-72.052, 41.2335], cls: 'r' }
  ];

  // ── Preferences (survive reloads); the view, hour and theme come from the page
  const PREF_KEY = 'lcc-map-prefs';
  Object.assign(state, {
    threeD: true, ex: 3, hill: 0.85, base: 'photo', model: 'gfs',
    layers: { waves: true, swell: true, rays: false, contours: false },
    step: 0, playing: false, fc: null
  });
  document.documentElement.classList.toggle('peek', state.ui === 'peek');
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    if (typeof p.threeD === 'boolean') state.threeD = p.threeD;
    if (p.ex >= 1 && p.ex <= 10) state.ex = p.ex;
    if (p.hill >= 0 && p.hill <= 1) state.hill = p.hill;
    if (['photo', 'color', 'aerial', 'chart'].includes(p.base)) state.base = p.base;
    if (p.model === 'ec') state.model = 'ec';
    if (p.layers) for (const k in state.layers) if (typeof p.layers[k] === 'boolean') state.layers[k] = p.layers[k];
  } catch (e) { /* defaults */ }
  if (q.get('3d') === '0') state.threeD = false;
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ threeD: state.threeD, ex: state.ex, hill: state.hill, base: state.base, model: state.model, layers: state.layers })); } catch (e) { /* private mode */ }
  }

  function setPanel(open, focus) {
    $('panel').hidden = !open; $('layersBtn').setAttribute('aria-expanded', String(open));
    if (open && focus) $('panelClose').focus({ preventScroll: true });
  }
  if (!ML || !shell.hasWebGL()) {
    status('This browser can’t draw the 3D map (WebGL is off). The Sound Check map still works.');
    return null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Sea-floor tiles: the lccbathy:// protocol, answered by bathy-worker.js
  // ════════════════════════════════════════════════════════════════════
  const bathy = new Worker('bathy-worker.js');
  const pending = new Map();
  let seq = 0, tilesServed = 0, tileErrors = 0;
  bathy.onmessage = e => {
    const m = e.data;
    if (m.type === 'error') { tileErrors++; status('Sea-floor data didn’t load (' + m.where + '). Aerial and chart layers still work.'); return; }
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
  };
  function askBathy(msg) {
    return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); bathy.postMessage(Object.assign({ id }, msg)); });
  }
  ML.addProtocol('lccbathy', (params, abort) => new Promise((resolve, reject) => {
    const m = /^lccbathy:\/\/(dem|color)\/(\d+)\/(\d+)\/(\d+)\??(.*)$/.exec(params.url);
    if (!m) { reject(new Error('Bad sea-floor tile ' + params.url)); return; }
    const o = new URLSearchParams(m[5]), id = ++seq;
    pending.set(id, {
      resolve: r => { tilesServed++; if (tilesServed === 1 && /^Loading sea floor/.test($('status').textContent)) status(''); resolve({ data: r.data }); },
      reject: e => { tileErrors++; reject(e); }
    });
    abort.signal.addEventListener('abort', () => { if (pending.delete(id)) { bathy.postMessage({ type: 'abort', id }); reject(new DOMException('Aborted', 'AbortError')); } });
    bathy.postMessage({
      type: 'tile', id, kind: m[1], z: +m[2], x: +m[3], y: +m[4],
      o: { size: +o.get('size') || 256, ex: +o.get('ex') || 3, hill: o.has('hill') ? +o.get('hill') : 0.85, mode: o.get('mode') || 'nautical', land: o.get('land') || 'photo', contours: o.get('contours') === '1' }
    });
  }));
  const colorUrl = () => 'lccbathy://color/{z}/{x}/{y}?size=' + (DPR > 1.4 ? 512 : 256) + '&ex=' + state.ex + '&hill=' + state.hill +
    '&land=' + (state.base === 'color' ? 'color' : 'photo') + '&contours=' + (state.layers.contours ? 1 : 0);
  const demUrl = () => 'lccbathy://dem/{z}/{x}/{y}?ex=' + state.ex;

  // ════════════════════════════════════════════════════════════════════
  // Map
  // ════════════════════════════════════════════════════════════════════
  const ESRI = ['https://server.arcgisonline.com/ArcGIS/rest/services/', 'https://services.arcgisonline.com/ArcGIS/rest/services/'];
  const NOAA_ENC = 'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png&transparent=true&f=image';
  const blank = () => { const c = document.createElement('canvas'); c.width = c.height = 2; return c; };
  const canvases = { sound: blank(), fine: blank(), swell: document.createElement('canvas') };
  canvases.swell.width = canvases.swell.height = 2;
  const far = [[-72.4, 41.5], [-72.39, 41.5], [-72.39, 41.49], [-72.4, 41.49]];
  const style = {
    version: 8,
    sources: {
      ocean: { type: 'raster', tiles: ESRI.map(h => h + 'Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'), tileSize: 256, maxzoom: 13, attribution: 'Esri, GEBCO, NOAA' },
      photo: { type: 'raster', tiles: ESRI.map(h => h + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'), tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      chart: { type: 'raster', tiles: [NOAA_ENC], tileSize: 256, minzoom: 8, maxzoom: 18, attribution: 'NOAA Office of Coast Survey' },
      bathy: { type: 'raster', tiles: [colorUrl()], tileSize: 256, minzoom: 7, maxzoom: 18, bounds: SOUND, attribution: 'Sea floor: NOAA NGS, NOAA NCEI, USGS 3DEP' },
      dem: { type: 'raster-dem', tiles: [demUrl()], tileSize: 256, minzoom: 7, maxzoom: 17, bounds: SOUND, encoding: 'mapbox' },
      wavesSound: { type: 'canvas', canvas: canvases.sound, coordinates: far, animate: false },
      wavesFine: { type: 'canvas', canvas: canvases.fine, coordinates: far, animate: false },
      swell: { type: 'canvas', canvas: canvases.swell, coordinates: far, animate: false },
      rays: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#9cc3d5' } },
      { id: 'ocean', type: 'raster', source: 'ocean' },
      { id: 'photo', type: 'raster', source: 'photo', paint: { 'raster-fade-duration': 150 } },
      { id: 'bathy', type: 'raster', source: 'bathy', paint: { 'raster-fade-duration': 120 } },
      { id: 'chart', type: 'raster', source: 'chart', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 150 } },
      { id: 'wavesSound', type: 'raster', source: 'wavesSound', paint: { 'raster-opacity': 0.5, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
      { id: 'wavesFine', type: 'raster', source: 'wavesFine', paint: { 'raster-opacity': 0.5, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
      { id: 'rays', type: 'line', source: 'rays', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['*', 0.5, ['get', 'w']], 14, ['get', 'w'], 17, ['*', 2, ['get', 'w']]], 'line-opacity': ['case', ['get', 'hit'], 0.95, 0.35] } },
      { id: 'swell', type: 'raster', source: 'swell', paint: { 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }
    ]
  };
  const v0 = VIEWS[state.view];
  let map;
  try {
    map = new ML.Map({
      container: 'map', style, center: v0.center, zoom: v0.zoom - (EMBED ? 0.4 : 0), bearing: v0.bearing,
      pitch: state.threeD ? v0.pitch : 0, maxPitch: state.threeD ? 85 : 0, minZoom: 6, maxZoom: 19.5,
      pixelRatio: DPR, attributionControl: { compact: true }, canvasContextAttributes: { antialias: true },
      fadeDuration: 0, maxTileCacheSize: 400
    });
  } catch (e) {
    status('This browser can’t draw the 3D map. The Sound Check map still works.');
    return null;
  }
  map.addControl(new ML.NavigationControl({ visualizePitch: true }), 'top-right');
  // Peek: a picture of the water at the forecast hour that the page scrolls past; 'full' hands the gestures back.
  const HANDLERS = ['scrollZoom', 'boxZoom', 'dragRotate', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'];
  function setUI(m) {
    m = m === 'peek' ? 'peek' : 'full';
    state.ui = m;
    document.documentElement.classList.toggle('peek', m === 'peek');
    HANDLERS.forEach(h => { if (map[h]) map[h][m === 'peek' ? 'disable' : 'enable'](); });
    if (m === 'peek') { setPanel(false); if (mapReady) hideProbe(); }
    if (mapReady) { map.resize(); swellBounds(true); }
  }
  map.addControl(new ML.ScaleControl({ unit: 'imperial' }), 'bottom-left');
  status('Loading sea floor…');
  let mapReady = false;
  setUI(state.ui);
  map.on('error', e => {
    const src = e && e.sourceId;
    if (src === 'photo' || src === 'ocean' || src === 'chart') { if (!$('status').textContent) status((src === 'chart' ? 'NOAA chart' : 'Esri') + ' tiles are slow or offline; the sea floor still works.'); }
  });

  // ── markers
  for (const s of SPOTS) {
    const el = document.createElement('div');
    el.className = 'spot ' + s.cls; el.innerHTML = '<i></i><span>' + s.name + '</span>';
    new ML.Marker({ element: el, anchor: 'left', offset: [-8, 0] }).setLngLat(s.at).addTo(map);
  }

  map.on('load', () => {
    mapReady = true;
    // Embedded, the credits start folded behind their (i) button so they don't cover the readout.
    if (COMPACT) { const a = map.getContainer().querySelector('.maplibregl-compact-show'); if (a) a.classList.remove('maplibregl-compact-show'); }
    applyBase(); applyLayers(); applyTheme(); set3D(state.threeD, true);
    loadForecast();
    if (EMBED && parent !== window) parent.postMessage({ type: 'lcc-map-ready' }, location.origin);
    map.on('moveend', () => swellBounds(false));
    map.on('resize', () => swellBounds(true));
    swellBounds(true);
  });

  // ════════════════════════════════════════════════════════════════════
  // 3D on / off, depth stretch, base and layers
  // ════════════════════════════════════════════════════════════════════
  function set3D(on, instant) {
    state.threeD = on;
    const b = $('threeD'); b.setAttribute('aria-checked', String(on));
    document.documentElement.classList.toggle('is-2d', !on);
    if (!mapReady) return;
    if (on) {
      map.setMaxPitch(85);
      map.setTerrain({ source: 'dem', exaggeration: state.ex });
      const p = Math.max(map.getPitch(), (VIEWS[state.view] || VIEWS.choc).pitch);
      if (instant) map.jumpTo({ pitch: p }); else map.easeTo({ pitch: p, duration: reduceMotion ? 0 : 900 });
    } else {
      map.setTerrain(null);
      const done = () => { if (!state.threeD) map.setMaxPitch(0); };
      if (instant || reduceMotion) { map.jumpTo({ pitch: 0 }); done(); } else { map.easeTo({ pitch: 0, duration: 700 }); map.once('moveend', done); }
    }
    swellBounds(true);
  }
  let reloadTimer = 0;
  function setEx(ex) {
    state.ex = ex; $('exOut').textContent = ex + '×';
    if (mapReady && state.threeD) map.setTerrain({ source: 'dem', exaggeration: ex });
    // Land rides at 1.25x whatever the stretch, so the terrain and shading tiles are redrawn once the slider rests.
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (!mapReady) return; map.getSource('dem').setTiles([demUrl()]); map.getSource('bathy').setTiles([colorUrl()]); }, 350);
  }
  function refreshColors() { if (mapReady) map.getSource('bathy').setTiles([colorUrl()]); }
  function applyBase() {
    if (!mapReady) return;
    const b = state.base, vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('photo', b === 'photo' || b === 'aerial');
    vis('bathy', b === 'photo' || b === 'color');
    vis('chart', b === 'chart');
    vis('ocean', b !== 'aerial');
    $('depthKey').hidden = !(b === 'photo' || b === 'color');
    refreshColors();
  }
  function applyLayers() {
    if (!mapReady) return;
    const vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('wavesSound', state.layers.waves); vis('wavesFine', state.layers.waves);
    vis('rays', state.layers.rays); vis('swell', state.layers.swell);
    $('waveKey').hidden = !state.layers.waves;
    document.querySelectorAll('[data-layer]').forEach(i => { i.checked = !!state.layers[i.dataset.layer]; });
    if (state.layers.rays) updateRays();
    swellRun();
  }
  function applyTheme() {
    const dark = state.theme === 'dark';
    document.documentElement.dataset.theme = state.theme;
    if (!mapReady) return;
    map.setPaintProperty('bg', 'background-color', dark ? '#0b1a2c' : '#9cc3d5');
    try {
      map.setSky(dark
        ? { 'sky-color': '#0b1d2e', 'horizon-color': '#24384a', 'fog-color': '#1a2a38', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.9, 'atmosphere-blend': 0 }
        : { 'sky-color': '#9fcbe8', 'horizon-color': '#e4eef3', 'fog-color': '#dfeaf0', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.9, 'atmosphere-blend': 0 });
    } catch (e) { /* older engines: no sky */ }
  }
  function go(view, opts) {
    if (!VIEWS[view]) return;
    state.view = view;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    if (!mapReady) return;
    const v = VIEWS[view], cam = { center: v.center, zoom: v.zoom - (EMBED ? 0.4 : 0), bearing: v.bearing, pitch: state.threeD ? v.pitch : 0 };
    if ((opts && opts.instant) || reduceMotion) map.jumpTo(cam); else map.flyTo(Object.assign(cam, { duration: 1800, essential: true }));
  }

  // ════════════════════════════════════════════════════════════════════
  // Forecast: GFS-Wave / ECMWF trains for each 3-hour step (research/fc)
  // ════════════════════════════════════════════════════════════════════
  async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  async function loadForecast() {
    let d = null;
    try { d = await getJSON('../research/fc/fc.json'); } catch (e) { /* try the live copy */ }
    useForecast(d);
    try {
      const live = await getJSON(FC_LIVE + 'fc.json');
      if (live && live.gfs && (!d || Date.parse(live.made) > Date.parse(d.made))) useForecast(live);
    } catch (e) { /* the copy that ships with the site is fine */ }
    if (!state.fc) { $('hudTime').textContent = 'Forecast unavailable'; $('hudSwell').textContent = 'The sea floor and map layers still work.'; }
  }
  function useForecast(d) {
    if (!d || !d.gfs || !d.gfs.length) return;
    const ecByTime = new Map((d.ec || []).map(r => [Math.round(Date.parse(r.t) / 36e5), r]));
    state.fc = { made: d.made, rows: d.gfs.map(r => ({ t: Date.parse(r.t), gfs: r, ec: ecByTime.get(Math.round(Date.parse(r.t) / 36e5)) || null })) };
    const s = $('step'); s.max = String(state.fc.rows.length - 1);
    $('timebar').hidden = false;
    setStep(nearestStep(state.wantTime || Date.now()), true);
  }
  function nearestStep(t) {
    const rows = state.fc ? state.fc.rows : []; let best = 0;
    rows.forEach((r, i) => { if (Math.abs(r.t - t) < Math.abs(rows[best].t - t)) best = i; });
    return best;
  }
  function trainsAt(row) {
    if (!row) return [];
    if (state.model === 'ec') return row.ec && row.ec.hs != null ? [{ ft: row.ec.hs, T: row.ec.T, D: row.ec.D }] : [];
    return (row.gfs.trains || []).filter(t => t.T >= 4).map(t => ({ ft: t.ft, T: t.T, D: t.D }));
  }
  let stepTimer = 0;
  function setStep(i, now) {
    if (!state.fc) return;
    state.step = Math.max(0, Math.min(state.fc.rows.length - 1, i));
    $('step').value = String(state.step);
    hud();
    clearTimeout(stepTimer);
    const apply = () => { requestWaves(); swellTrains(); if (state.layers.rays) updateRays(); };
    if (now) apply(); else stepTimer = setTimeout(apply, 60);
  }
  const fmtTime = t => new Date(t).toLocaleString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }, ET));
  const arrow = from => '<svg class="arr" viewBox="0 0 12 12" aria-hidden="true" style="transform:rotate(' + Math.round((from + 180) % 360) + 'deg)"><path d="M6 1 L9.6 10 L6 8 L2.4 10 Z" fill="currentColor"/></svg>';
  function hud() {
    const row = state.fc && state.fc.rows[state.step];
    if (!row) return;
    const src = state.model === 'ec' ? row.ec : row.gfs;
    $('hudTime').textContent = fmtTime(row.t);
    $('hudSpot').innerHTML = src && src.choc != null ? (COMPACT ? '<span class="model-tag">Sound Check model: </span>' : '') + 'Choc ' + src.choc.toFixed(1) + ' ft' + (src.wild != null ? ' · Wilderness ' + src.wild.toFixed(1) + ' ft' : '') : (state.model === 'ec' ? 'No ECMWF run for this hour' : '');
    const tr = trainsAt(row).filter(t => t.T >= 5 && t.ft >= 0.2).sort((a, b) => b.ft - a.ft).slice(0, 3);
    const parts = tr.map(t => arrow(t.D) + ' ' + t.ft.toFixed(1) + ' ft @ ' + Math.round(t.T) + ' s ' + G.compass(t.D));
    const w = row.gfs.wind; if (w) parts.push('Wind ' + arrow(w[1]) + ' ' + Math.round(w[0]) + ' kn ' + G.compass(w[1]));
    $('hudSwell').innerHTML = parts.join(' · ') + (state.model === 'gfs' ? '' : ' · ECMWF');
  }

  // ── wave height (height-worker.js)
  const hw = new Worker('height-worker.js');
  let hwSeq = 0, hAll = null, hGrid = null, wavesReady = false;
  function requestWaves() {
    const row = state.fc && state.fc.rows[state.step];
    if (!row) return;
    hw.postMessage({ id: ++hwSeq, trains: trainsAt(row) });
  }
  hw.onmessage = e => {
    const m = e.data;
    if (m.id !== hwSeq || m.error) { if (m.error) status('Wave heights unavailable: ' + m.error); return; }
    hAll = m.hAll; hGrid = m.grid;
    paintCanvas('wavesSound', canvases.sound, m.sound);
    if (m.fine) paintCanvas('wavesFine', canvases.fine, m.fine);
    wavesReady = true;
  };
  function paintCanvas(id, cv, f) {
    if (cv.width !== f.w || cv.height !== f.h) { cv.width = f.w; cv.height = f.h; }
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.img.buffer), f.w, f.h), 0, 0);
    const src = map.getSource(id); if (!src) return;
    const [w, s, e, n] = f.bounds;
    if (!src._lccSet) { src.setCoordinates([[w, n], [e, n], [e, s], [w, s]]); src._lccSet = true; }
    pushCanvas(id);
  }
  // Canvas sources upload only while "playing"; play+pause uploads once. With terrain on,
  // draped layers are cached per tile, so bump the source's feature state to redraw them.
  let bump = 0;
  function pushCanvas(id) {
    const src = map.getSource(id); if (!src || !src.play) return;
    src.play(); src.pause();
    if (state.threeD) map.setFeatureState({ source: id, id: 1 }, { n: ++bump });
  }

  // ── swell paths (research/fr): Part 1's rays for each train, the ones reaching the spots bright
  const frCache = new Map();
  function frFile(T) {
    if (!frCache.has(T)) frCache.set(T, getJSON('../research/fr/' + T + '.json').catch(() => { frCache.delete(T); return null; }));
    return frCache.get(T);
  }
  let raySeq = 0;
  async function updateRays() {
    const row = state.fc && state.fc.rows[state.step], my = ++raySeq;
    const tr = trainsAt(row).filter(t => t.T >= 5 && t.ft >= 0.2);
    const features = [];
    for (const t of tr) {
      const Te = Math.max(6, Math.min(16, Math.round(t.T / 2) * 2)), De = Math.round(t.D / 5) * 5, f = await frFile(Te);
      if (my !== raySeq) return;
      if (!f || !f[De]) continue;
      const c = G.perRGB(t.T), color = 'rgb(' + c.join(',') + ')', w = Math.max(1, Math.min(5, 0.6 + t.ft * 0.45));
      for (const r of f[De].rays) {
        const p = r.p; if (p.length < 4) continue;
        const coords = [];
        for (let k = 0; k < p.length; k += 2) coords.push([-72.4 + p[k] / 100 / 83.95050561668964, 41.5 - p[k + 1] / 100 / 110.95]);
        features.push({ type: 'Feature', properties: { color, w, hit: /[cw]/.test(r.h || '') }, geometry: { type: 'LineString', coordinates: coords } });
      }
    }
    if (my === raySeq && mapReady) map.getSource('rays').setData({ type: 'FeatureCollection', features });
  }

  // ════════════════════════════════════════════════════════════════════
  // Swell motion: streaks along the traced rays, drawn on a canvas draped on the map
  // ════════════════════════════════════════════════════════════════════
  const sw = new Worker('swell-worker.js');
  const SW = { ctx: canvases.swell.getContext('2d'), b: null, W: 2, H: 2, cpp: 1, parts: [], trains: [], fields: new Map(), seq: 0, raf: 0, last: 0, drawn: 0, key: '' };
  const swPending = new Map();
  sw.onmessage = e => { const p = swPending.get(e.data.id); if (!p) return; swPending.delete(e.data.id); if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.field); };
  function swellField(T, D) {
    const Tq = Math.max(5, Math.min(20, Math.round(T))), Dq = ((Math.round(D / 3) * 3) % 360 + 360) % 360, key = Tq + '_' + Dq;
    let f = SW.fields.get(key);
    if (!f) {
      f = new Promise((resolve, reject) => { const id = ++SW.seq; swPending.set(id, { resolve, reject }); sw.postMessage({ id, T: Tq, from: Dq }); });
      SW.fields.set(key, f);
      if (SW.fields.size > 10) SW.fields.delete(SW.fields.keys().next().value);
    }
    return f;
  }
  let swTrainSeq = 0;
  async function swellTrains() {
    const row = state.fc && state.fc.rows[state.step], my = ++swTrainSeq;
    const tr = trainsAt(row).filter(t => t.T >= 5 && t.ft >= 0.25).sort((a, b) => b.ft - a.ft).slice(0, 3);
    const e = tr.reduce((s, t) => s + t.ft * t.ft, 0) || 1;
    const out = [];
    for (const t of tr) {
      try {
        const field = await swellField(t.T, t.D);
        if (my !== swTrainSeq) return;
        const c = G.perRGB(t.T).map(v => Math.round(v + (255 - v) * 0.45));
        out.push({ T: t.T, D: t.D, ft: t.ft, share: t.ft * t.ft / e, field, style: 'rgba(' + c.join(',') + ',0.8)' });
      } catch (err) { /* this train stays still; the others move */ }
    }
    if (my !== swTrainSeq) return;
    let acc = 0; out.forEach(t => { t.share = Math.max(t.share, 0.18); acc += t.share; }); out.forEach(t => { t.share /= acc; });
    SW.trains = out;
    for (const p of SW.parts) p.age = p.life;   // re-seed on the new hour
    swellRun();
  }
  /** [east, north, speed share, ray density] for a train at a point, or null on land / off the grids. */
  function flowAt(F, lon, lat) {
    for (const g of [F.fine, F.coarse]) {
      const x = (lon - g.left) * g.sx - 0.5, y = (g.top - lat) * g.sy - 0.5;
      if (!(x >= 0 && y >= 0 && x <= g.w - 1 && y <= g.h - 1)) continue;
      const i = Math.round(y) * g.w + Math.round(x);
      if (!g.sp[i]) return null;
      const x0 = Math.min(g.w - 2, x | 0), y0 = Math.min(g.h - 2, y | 0), fx = x - x0, fy = y - y0, j = y0 * g.w + x0;
      const ux = (g.ux[j] * (1 - fx) + g.ux[j + 1] * fx) * (1 - fy) + (g.ux[j + g.w] * (1 - fx) + g.ux[j + g.w + 1] * fx) * fy;
      const uy = (g.uy[j] * (1 - fx) + g.uy[j + 1] * fx) * (1 - fy) + (g.uy[j + g.w] * (1 - fx) + g.uy[j + g.w + 1] * fx) * fy;
      const l = Math.hypot(ux, uy); if (l < 8) return null;
      return [ux / l, uy / l, g.sp[i] / 255, g.dn[i] / 50];
    }
    return null;
  }
  /**
   * The canvas covers the view (in 3D, the ground out to a few screen-widths) on
   * Web Mercator. It stays put while the map moves and is re-placed only when the
   * view has moved well away from it, so streaks never jump.
   */
  function swellBounds(force) {
    if (!mapReady) return;
    const c = map.getCenter(), z = map.getZoom(), mpp = G.metersPerPixel(z), el = map.getContainer();
    const cx = G.mercX(c.lng), cy = G.mercY(c.lat), w = el.clientWidth || 800, h = el.clientHeight || 600;
    const pitch = map.getPitch(), key = [Math.round(z * 2), Math.round(pitch / 10), Math.round(map.getBearing() / 15), state.threeD, w, h].join();
    const b = SW.b;
    if (!force && b && key === SW.key && cx > b[0] + (b[2] - b[0]) * 0.22 && cx < b[2] - (b[2] - b[0]) * 0.22 && cy > b[1] + (b[3] - b[1]) * 0.22 && cy < b[3] - (b[3] - b[1]) * 0.22) return;
    SW.key = key;
    let nb;
    if (state.threeD && pitch > 10) {
      // Tilted: cover the ground actually on screen from the bottom edge to a little below the
      // horizon, not a box around the center, so the canvas pixels go where the eye is.
      const xs = [], ys = [], top = Math.min(0.5, 0.12 + Math.max(0, pitch - 45) / 100);
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const ll = map.unproject([w * i / 4, h * (top + (1 - top) * j / 4)]);
        if (ll && Number.isFinite(ll.lat)) { xs.push(G.mercX(ll.lng)); ys.push(G.mercY(ll.lat)); }
      }
      const cap = Math.max(w, h) * mpp * 2.6, pad = 0.08;
      let x0 = Math.max(Math.min(...xs), cx - cap), x1 = Math.min(Math.max(...xs), cx + cap), y0 = Math.max(Math.min(...ys), cy - cap), y1 = Math.min(Math.max(...ys), cy + cap);
      const px = (x1 - x0) * pad, py = (y1 - y0) * pad;
      nb = [x0 - px, y0 - py, x1 + px, y1 + py];
    } else {
      nb = [cx - w * mpp * 0.62, cy - h * mpp * 0.62, cx + w * mpp * 0.62, cy + h * mpp * 0.62];
    }
    const maxSide = coarsePointer ? 1280 : (state.threeD ? 2048 : (DPR > 1.4 ? 1600 : 1280)), span = Math.max(nb[2] - nb[0], nb[3] - nb[1]);
    SW.cpp = span / maxSide;
    SW.W = Math.max(2, Math.round((nb[2] - nb[0]) / SW.cpp)); SW.H = Math.max(2, Math.round((nb[3] - nb[1]) / SW.cpp));
    SW.b = nb;
    canvases.swell.width = SW.W; canvases.swell.height = SW.H;
    const per = (coarsePointer ? 600 : 480) / (state.threeD ? 1.7 : 1);   // 3D spreads them over far more ground
    const n = Math.round(Math.max(500, Math.min(coarsePointer ? 1800 : 3000, w * h / per)));
    SW.parts = Array.from({ length: n }, () => ({ x: 0, y: 0, age: 1, life: 0, tr: null }));
    const src = map.getSource('swell');
    if (src) src.setCoordinates([[G.lonOf(nb[0]), G.latOf(nb[3])], [G.lonOf(nb[2]), G.latOf(nb[3])], [G.lonOf(nb[2]), G.latOf(nb[1])], [G.lonOf(nb[0]), G.latOf(nb[1])]]);
    if (reduceMotion) drawStill(); else swellRun();
  }
  function pickTrain() {
    let r = Math.random();
    for (const t of SW.trains) { if ((r -= t.share) <= 0) return t; }
    return SW.trains[SW.trains.length - 1];
  }
  function spawn(p) {
    p.tr = pickTrain(); p.age = 0; p.life = 1.6 + Math.random() * 3.2; p.fresh = true;
    const b = SW.b;
    for (let k = 0; k < 10; k++) {
      const x = b[0] + Math.random() * (b[2] - b[0]), y = b[1] + Math.random() * (b[3] - b[1]);
      const f = flowAt(p.tr.field, G.lonOf(x), G.latOf(y));
      // More streaks where the rays bunch up (focused swell), few in the shadows.
      if (f && Math.random() < 0.15 + 0.85 * Math.min(1, f[3])) { p.x = x; p.y = y; return; }
    }
    p.age = p.life;   // nothing found this time; try again next frame
  }
  function swellActive() { return mapReady && state.tab === 'seafloor' && state.layers.swell && state.active && !document.hidden && SW.trains.length && SW.b; }
  function swellRun() {
    if (reduceMotion) { drawStill(); return; }
    if (!SW.raf && swellActive()) { SW.last = 0; SW.raf = requestAnimationFrame(swellFrame); }
    if (!state.layers.swell || !SW.trains.length) clearSwell();
  }
  function clearSwell() { SW.ctx.setTransform(1, 0, 0, 1, 0, 0); SW.ctx.clearRect(0, 0, SW.W, SW.H); if (mapReady) pushCanvas('swell'); }
  function swellFrame(now) {
    SW.raf = 0;
    if (!swellActive()) return;
    SW.raf = requestAnimationFrame(swellFrame);
    if (SW.last && now - SW.drawn < 30) return;              // about 30 frames a second is plenty for streaks
    const dt = SW.last ? Math.min(0.08, (now - SW.last) / 1000) : 0.033;
    SW.last = now; SW.drawn = now;
    stepParticles(dt, true);
    pushCanvas('swell');
  }
  function stepParticles(dt, fade) {
    const ctx = SW.ctx, b = SW.b, cpp = SW.cpp, mpp = G.metersPerPixel(map.getZoom());
    if (fade) {
      // Trails fade by half in about a quarter second.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - Math.pow(0.5, dt / 0.26)).toFixed(3) + ')';
      ctx.fillRect(0, 0, SW.W, SW.H);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, Math.min(3, 1.3 * mpp / cpp));
    for (const t of SW.trains) {
      ctx.beginPath();
      // Screen speed grows with period (long-period swell moves faster) and drops with the group speed in shallow water.
      const pxps = 9 + 2.4 * t.T;
      for (const p of SW.parts) {
        if (p.tr !== t && p.age < p.life) continue;
        if (p.age >= p.life) { spawn(p); if (p.tr !== t || p.age >= p.life) continue; }
        const lon = G.lonOf(p.x), lat = G.latOf(p.y), f = flowAt(t.field, lon, lat);
        if (!f) { p.age = p.life; continue; }
        const d = pxps * f[2] * mpp * dt, nx = p.x + f[0] * d, ny = p.y + f[1] * d;
        if (nx < b[0] || nx > b[2] || ny < b[1] || ny > b[3]) { p.age = p.life; continue; }
        if (!p.fresh) { ctx.moveTo((p.x - b[0]) / cpp, (b[3] - p.y) / cpp); ctx.lineTo((nx - b[0]) / cpp, (b[3] - ny) / cpp); }
        p.fresh = false; p.x = nx; p.y = ny; p.age += dt;
      }
      ctx.strokeStyle = t.style; ctx.stroke();
    }
  }
  function drawStill() {                                      // reduced motion: short still streamlines instead
    if (!mapReady || !SW.b) return;
    SW.ctx.clearRect(0, 0, SW.W, SW.H);
    if (!state.layers.swell || !SW.trains.length) { pushCanvas('swell'); return; }
    for (const p of SW.parts) p.age = p.life;
    for (let k = 0; k < 24; k++) stepParticles(0.05, false);
    pushCanvas('swell');
  }
  document.addEventListener('visibilitychange', swellRun);

  // ════════════════════════════════════════════════════════════════════
  // Depth probe: hover (or tap) for depth, source and modeled wave height
  // ════════════════════════════════════════════════════════════════════
  let probeSeq = 0, probeTimer = 0, dragging = false;
  map.on('dragstart', () => { dragging = true; hideProbe(); });
  map.on('dragend', () => { dragging = false; });
  map.on('mousemove', e => {
    if (dragging || coarsePointer || state.ui === 'peek') return;
    clearTimeout(probeTimer); probeTimer = setTimeout(() => probe(e.lngLat, e.point), 70);
  });
  map.getCanvas().addEventListener('mouseleave', hideProbe);
  map.on('click', e => { if (coarsePointer && state.ui !== 'peek') probe(e.lngLat, e.point); });
  map.on('movestart', () => { if (coarsePointer) hideProbe(); });
  function hideProbe() { $('probe').hidden = true; probeSeq++; }
  function waveAt(lon, lat) {
    if (!hAll || !hGrid) return null;
    const x = Math.round((lon - hGrid.left) * hGrid.sx - 0.5), y = Math.round((hGrid.top - lat) * hGrid.sy - 0.5);
    if (x < 0 || y < 0 || x >= hGrid.w || y >= hGrid.h) return null;
    return hAll[y * hGrid.w + x];
  }
  async function probe(ll, pt) {
    const my = ++probeSeq;
    let r; try { r = await askBathy({ type: 'sample', lon: ll.lng, lat: ll.lat }); } catch (e) { return; }
    if (my !== probeSeq || r.h == null) { if (my === probeSeq) hideProbe(); return; }
    const h = r.h, el = $('probe'), m = Math.abs(h).toFixed(h > -10 && h < 10 ? 1 : 0), ft = Math.round(Math.abs(h) * FT);
    let html = h < 0 ? '<b>' + m + ' m deep</b> (' + ft + ' ft)' : '<b>' + m + ' m high</b> (' + ft + ' ft)';
    if (r.source) html += '<br>' + r.source;
    const w = h < 0 && state.layers.waves ? waveAt(ll.lng, ll.lat) : null;
    if (w != null && w >= 0) html += '<br>Waves ' + w.toFixed(1) + ' ft (model)';
    html += '<br><span style="color:var(--muted)">' + ll.lat.toFixed(4) + '° N, ' + Math.abs(ll.lng).toFixed(4) + '° W</span>';
    el.innerHTML = html; el.hidden = false;
    const W = innerWidth, H = innerHeight, bw = el.offsetWidth, bh = el.offsetHeight;
    el.style.left = Math.min(W - bw - 8, pt.x + 14) + 'px'; el.style.top = Math.min(H - bh - 8, Math.max(8, pt.y + 14)) + 'px';
  }

  // ════════════════════════════════════════════════════════════════════
  // Controls
  // ════════════════════════════════════════════════════════════════════
  $('threeD').addEventListener('click', () => { set3D(!state.threeD); savePrefs(); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    go(b.dataset.view);
    if (EMBED && parent !== window && (b.dataset.view === 'choc' || b.dataset.view === 'race')) parent.postMessage({ type: 'lcc-map-spot', spot: b.dataset.view }, location.origin);
  }));
  $('layersBtn').addEventListener('click', () => setPanel($('panel').hidden, true));
  $('panelClose').addEventListener('click', () => { setPanel(false); $('layersBtn').focus(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('panel').hidden) { setPanel(false); $('layersBtn').focus(); } });
  document.querySelectorAll('input[name="base"]').forEach(r => {
    r.checked = r.value === state.base;
    r.addEventListener('change', () => { if (r.checked) { state.base = r.value; applyBase(); savePrefs(); } });
  });
  document.querySelectorAll('[data-layer]').forEach(i => i.addEventListener('change', () => {
    state.layers[i.dataset.layer] = i.checked;
    if (i.dataset.layer === 'contours') refreshColors(); else applyLayers();
    savePrefs();
  }));
  document.querySelectorAll('[data-model]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.model === state.model));
    b.addEventListener('click', () => {
      state.model = b.dataset.model;
      document.querySelectorAll('[data-model]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      setStep(state.step, true); savePrefs();
    });
  });
  $('ex').value = String(state.ex); $('exOut').textContent = state.ex + '×';
  $('ex').addEventListener('input', () => setEx(+$('ex').value));
  $('ex').addEventListener('change', savePrefs);
  $('hill').value = String(state.hill); $('hillOut').textContent = Math.round(state.hill * 100) + '%';
  $('hill').addEventListener('input', () => { state.hill = +$('hill').value; $('hillOut').textContent = Math.round(state.hill * 100) + '%'; clearTimeout(reloadTimer); reloadTimer = setTimeout(refreshColors, 250); });
  $('hill').addEventListener('change', savePrefs);
  $('step').addEventListener('input', () => { stopPlay(); setStep(+$('step').value); });
  $('nowBtn').addEventListener('click', () => { stopPlay(); setStep(nearestStep(Date.now()), true); });
  let playTimer = 0;
  function stopPlay() { if (!state.playing) return; state.playing = false; clearInterval(playTimer); $('play').setAttribute('aria-label', 'Play forecast'); $('play').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'; }
  $('play').addEventListener('click', () => {
    if (state.playing) { stopPlay(); return; }
    if (!state.fc) return;
    state.playing = true;
    $('play').setAttribute('aria-label', 'Pause forecast'); $('play').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
    playTimer = setInterval(() => setStep((state.step + 1) % state.fc.rows.length, true), 1400);
  });
  hud();
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('threeD').setAttribute('aria-checked', String(state.threeD));
  if (!COMPACT && innerWidth > 1100) setPanel(true);

  // ════════════════════════════════════════════════════════════════════
  // What the page drives
  // ════════════════════════════════════════════════════════════════════
  return {
    map, go, set3D, setStep, setUI, setPanel, applyTheme,
    // the hour the page asks for (a time from the Sound Check map or the parent)
    toTime(t) { state.wantTime = t; if (state.fc) { const i = nearestStep(t); if (i !== state.step) setStep(i); } },
    // on screen again: the map may have been resized while hidden; restart the streaks
    onShow() { if (state.tab === 'seafloor' && mapReady) { map.resize(); swellBounds(true); } swellRun(); },
    onActive() { if (state.active && mapReady) map.resize(); swellRun(); },
    getState: () => ({
      ready: mapReady, threeD: state.threeD, terrain: !!(mapReady && map.getTerrain()), pitch: map.getPitch(), zoom: map.getZoom(),
      ui: state.ui, view: state.view, base: state.base, layers: Object.assign({}, state.layers), ex: state.ex, model: state.model,
      step: state.step, time: state.fc && state.fc.rows[state.step] ? new Date(state.fc.rows[state.step].t).toISOString() : null,
      steps: state.fc ? state.fc.rows.length : 0, tilesServed, tileErrors, wavesReady,
      swellTrains: SW.trains.length, particles: SW.parts.length, swellCanvas: [SW.W, SW.H]
    })
  };
};
