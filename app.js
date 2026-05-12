// ════════════════════════════════════════════════
// LetsCheckChoc — app.js
// Multi-buoy surf forecast dashboard
// ════════════════════════════════════════════════


'use strict';

// ── Surf Log Constants ──────────────────────────────
const CHOC_WIND_LAT = 41.276083;     // Chocomount land GPS for wind history
const CHOC_WIND_LON = -71.963725;

// ── Configuration ────────────────────────────────
const CONFIG = {
  chocomount: {
    name: 'Chocomount Beach',
    lat: 41.275693,
    lon: -71.963310,
    forecastLat: 41.089152,
    forecastLon: -71.721050,
    starLat: 41.089152,
    starLon: -71.721050,
    buoyId: '44097',
    tideStation: '8510719',
    waterTempStation: '8510560',
    swellWindowMin: 115,
    swellWindowMax: 158,
    swellWindowEdge: 5,
    buoyLat: 40.969,
    buoyLon: -71.124,
    buoyDistanceMiles: 50
  },
  api: {
    openMeteoMarine: 'https://marine-api.open-meteo.com/v1/marine',
    openMeteoWeather: 'https://api.open-meteo.com/v1/forecast',
    openMeteoArchive: 'https://archive-api.open-meteo.com/v1/archive',
    // Wave/swell reanalysis. The atmospheric `openMeteoArchive` endpoint
    // returns nulls for marine variables (secondary_swell_wave_*,
    // wind_wave_*), so historical swell must hit this marine archive.
    openMeteoMarineArchive: 'https://marine-api.open-meteo.com/v1/marine',
    coops: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
    ndbcProxies: [
      { name: 'corsproxy.io', wrap: function(url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); } },
      { name: 'allorigins',   wrap: function(url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); } },
      { name: 'codetabs',     wrap: function(url) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url); } }
    ],
    ndbcBase: 'https://www.ndbc.noaa.gov/data/realtime2/'
  },
  map: {
    center: [38.5, -73.0],
    zoom: 5,
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    tileAttr: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
  },
  coopsNearbyRadiusMiles: 50
};

// ── State ────────────────────────────────────────
const STATE = {
  isChocomount: false,
  boatGatePassed: false,
  selectedBuoy: null,
  pinLat: null,
  pinLon: null,
  buoys: [],
  tideStations: [],
  nearestTideStation: null,
  buoyMap: null,
  tideMap: null,
  forecastPin: null,
  buoyMarkers: [],
  chocMarker: null,
  tideMarkers: [],
  activeTideMarker: null,
  forecastChart: null,   // cached chart state for tooltip
  // Surf log
  surfLog: [],
  surfLogWaveWeights: null,
  surfLogWaveStats: null,
  surfLogWaveValidation: null,
  surfLogRideWeights: null,
  surfLogRideStats: null,
  surfLogRideValidation: null,
  surfLogCondWeights: null,
  surfLogCondStats: null,
  surfLogCondValidation: null,
  surfLogEditId: null,
  surfLogEditRepairCandidates: [],
  activeTab: 'forecast',
  personalMatchesOpen: false,
  matchModalData: null,
  matchModalPhotoIdx: 0,
  lastSpectral: null,
  lastBuoyParsed: null,
  roseScaleMode: 'linear'   // 'linear' | 'sqrt'; persisted to localStorage
};

// ── Utility functions ────────────────────────────

function degToRad(d) { return d * Math.PI / 180; }
function radToDeg(r) { return r * 180 / Math.PI; }

function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function directionLabel(deg) {
  if (deg == null || isNaN(deg)) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function directionArrow(deg) {
  if (deg == null || isNaN(deg)) return '';
  // Meteorological: deg is "from" direction.
  // Arrow points where wind is blowing TO: N wind (0°) → ↓ (southward).
  const arrows = ['↓','↙','←','↖','↑','↗','→','↘'];
  const idx = Math.round((((deg) % 360 + 360) % 360) / 45) % 8;
  return arrows[idx];
}

function tempColorClass(f) {
  if (f == null) return '';
  if (f < 50) return 'temp-cold';
  if (f < 60) return 'temp-cool';
  if (f < 70) return 'temp-warm';
  return 'temp-hot';
}

function swellDirClass(deg) {
  if (!STATE.isChocomount || deg == null) return '';
  const min = CONFIG.chocomount.swellWindowMin;
  const max = CONFIG.chocomount.swellWindowMax;
  const edge = CONFIG.chocomount.swellWindowEdge;
  if (deg >= min && deg <= max) return 'dir-in';
  if (deg >= min - edge && deg < min) return 'dir-edge';
  if (deg > max && deg <= max + edge) return 'dir-edge';
  return 'dir-out';
}

function swellDirColor(deg) {
  if (!STATE.isChocomount || deg == null) return '#5a7fa0'; // blue for non-choc
  const cls = swellDirClass(deg);
  if (cls === 'dir-in') return '#3a7d56';
  if (cls === 'dir-edge') return '#b87a2e';
  if (cls === 'dir-out') return '#a09890';
  return '#5a7fa0';
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDay(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
}

function formatDayShort(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function el(id) { return document.getElementById(id); }

// Apply HiDPI / DPR sizing to a canvas. Sets backing-store dimensions to
// cssW * dpr × cssH * dpr while keeping the on-screen CSS size unchanged,
// then scales the 2D context so existing draw code can keep using CSS-pixel
// coordinates. Setting canvas.width / height also resets any prior context
// state, so this is safe to call once per draw cycle.
function setCanvasDPR(canvas, ctx, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(cssW));
  const H = Math.max(1, Math.round(cssH));
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  _canvasDPRCache.set(canvas, { cssW: W, cssH: H, dpr });
}

// Per-canvas cache of the CSS dimensions last applied via setCanvasDPR.
// Used by ensureCanvasCssDims so per-frame redraws (e.g. scrubber moves)
// do NOT re-measure canvas.clientWidth — that read compounds when the
// canvas has a border + box-sizing: border-box (web1 era), causing the
// canvas to shrink a few pixels every redraw.
const _canvasDPRCache = new WeakMap();

// Returns the CSS width/height to use for drawing into `canvas`. On the
// first call (cache miss) — or after invalidateCanvasDPR — measures the
// canvas's natural CSS size and applies DPR scaling. On subsequent calls,
// returns the cached dims without touching canvas.width/height/ctx.scale,
// so the canvas does not shrink across redraws.
function ensureCanvasCssDims(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const cached = _canvasDPRCache.get(canvas);
  if (cached && cached.dpr === dpr) {
    // Reset the ctx transform to the cached DPR scale so per-frame draws
    // start from a clean baseline (matches the old setCanvasDPR call site
    // semantics) without resetting canvas.width / height.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cssW: cached.cssW, cssH: cached.cssH };
  }
  const cssW = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 0;
  const cssH = canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 0;
  setCanvasDPR(canvas, ctx, cssW, cssH);
  return { cssW, cssH };
}

// Drop the cached CSS dims for a canvas and strip its inline width/height
// so it reverts to its CSS-driven (typically `width: 100%`) size. Call
// this from a ResizeObserver before re-drawing — the next draw will then
// re-measure from the canvas's natural size, not from a previously-set
// inline style that compounds the box-sizing shrink.
function invalidateCanvasDPR(canvas) {
  if (!canvas) return;
  _canvasDPRCache.delete(canvas);
  canvas.style.width = '';
  canvas.style.height = '';
}

function setFooter(id, text, url, urlLabel) {
  const footer = el(id);
  if (!footer) return;
  if (url) {
    footer.innerHTML = `${text} · <a href="${url}" target="_blank" rel="noopener">${urlLabel || 'source'}</a>`;
  } else {
    footer.textContent = text;
  }
}

// ── Daylight calculator (solar position) ─────────
function calcDaylight(lat, lon, date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const declination = 23.45 * Math.sin(degToRad(360/365 * (dayOfYear - 81)));
  const latRad = degToRad(lat);
  const declRad = degToRad(declination);

  // Hour angle for sunrise/sunset
  const cosH = -Math.tan(latRad) * Math.tan(declRad);
  if (cosH < -1) return { alwaysDay: true };
  if (cosH > 1)  return { alwaysNight: true };
  const H = radToDeg(Math.acos(cosH));

  // Civil twilight (sun 6° below)
  const cosHCivil = (Math.cos(degToRad(96)) - Math.sin(latRad) * Math.sin(declRad)) / (Math.cos(latRad) * Math.cos(declRad));
  const HCivil = cosHCivil >= -1 && cosHCivil <= 1 ? radToDeg(Math.acos(cosHCivil)) : H + 1;

  // Solar noon in UTC hours
  // Approximate equation of time
  const B = degToRad(360/365 * (dayOfYear - 81));
  const EoT = 9.87 * Math.sin(2*B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const solarNoonUTC = 12 - (lon / 15) - (EoT / 60);

  const sunriseUTC = solarNoonUTC - H / 15;
  const sunsetUTC = solarNoonUTC + H / 15;
  const firstLightUTC = solarNoonUTC - HCivil / 15;
  const lastLightUTC = solarNoonUTC + HCivil / 15;

  function hoursToDate(h) {
    const nd = new Date(d);
    nd.setUTCHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    return nd;
  }

  const daylightHours = 2 * H / 15;

  return {
    firstLight: hoursToDate(firstLightUTC),
    sunrise: hoursToDate(sunriseUTC),
    sunset: hoursToDate(sunsetUTC),
    lastLight: hoursToDate(lastLightUTC),
    daylightHours: daylightHours
  };
}

function isNighttime(hour, daylight) {
  if (!daylight || daylight.alwaysDay) return false;
  if (daylight.alwaysNight) return true;
  const sunriseH = daylight.sunrise.getHours() + daylight.sunrise.getMinutes() / 60;
  const sunsetH = daylight.sunset.getHours() + daylight.sunset.getMinutes() / 60;
  return hour < sunriseH || hour > sunsetH;
}

// ── Swell arrival estimator ──────────────────────
function swellArrivalTime(periodSeconds, distanceMiles) {
  if (!periodSeconds || periodSeconds <= 0) return null;
  const g = 9.81;
  const groupVelocity = (g * periodSeconds) / (4 * Math.PI); // m/s
  const distanceMeters = distanceMiles * 1609.34;
  const travelSeconds = distanceMeters / groupVelocity;
  const travelMinutes = Math.round(travelSeconds / 60);
  const hours = Math.floor(travelMinutes / 60);
  const mins = travelMinutes % 60;
  return {
    minutes: travelMinutes,
    label: hours > 0 ? `~${hours} hr ${mins} min` : `~${mins} min`,
    velocityMs: groupVelocity.toFixed(1)
  };
}

// ── Gate logic ───────────────────────────────────
function initGate() {
  const saved = sessionStorage.getItem('lcc-gate');
  if (saved === 'no') {
    STATE.boatGatePassed = true;
    el('gate-overlay').classList.add('hidden');
    el('app').classList.remove('hidden');
    el('app-window')?.classList.remove('hidden');
    initApp();
    return;
  }

  el('gate-yes').addEventListener('click', () => {
    // No persistence: Yes means "go home". Show splash, then return to question.
    const question = el('gate-question');
    question.classList.add('hidden');
    const goHome = el('gate-go-home');
    const clone = goHome.cloneNode(true);
    clone.classList.remove('hidden');
    goHome.replaceWith(clone);
    setTimeout(() => {
      // Re-show the question; user can pick again or click No to enter.
      const splash = el('gate-go-home');
      splash.classList.add('hidden');
      question.classList.remove('hidden');
    }, 2000);
  });

  el('gate-no').addEventListener('click', () => {
    sessionStorage.setItem('lcc-gate', 'no');
    STATE.boatGatePassed = true;
    el('gate-overlay').classList.add('hidden');
    el('app').classList.remove('hidden');
    el('app-window')?.classList.remove('hidden');
    initApp();
  });
}

// ── Data fetching helpers ────────────────────────

async function fetchJSON(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    clearTimeout(timer);
    console.warn('Fetch failed:', url, err.message);
    return null;
  }
}

// ── Forecast cache (TTL-backed localStorage) ─────
// Goal: warm page loads render the chart from cache before the network call
// even returns. Open-Meteo and CO-OPS responses are deterministic over
// short windows, so caching them is safe; live spectral / Firestore reads
// are excluded.
const CACHE_TTL = {
  marine:   30 * 60 * 1000,
  wind:     30 * 60 * 1000,
  tide:      6 * 60 * 60 * 1000,
  hilo:      6 * 60 * 60 * 1000,
  water:    30 * 60 * 1000,
  pipeline: 30 * 60 * 1000
};
const PIPELINE_CACHE_KEY = 'lcc-cache-pipeline';

function roundCoord(v) { return Math.round(v * 1000) / 1000; }

function readCache(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts < ttlMs) return data;
  } catch (_) { /* fall through */ }
  return null;
}

function writeCache(key, data) {
  if (data == null) return;
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) { /* quota or serialization failure — non-fatal */ }
}

function marineCacheKey(lat, lon, model) {
  return `lcc-cache-marine-${roundCoord(lat)}-${roundCoord(lon)}-${model || 'default'}`;
}
function windCacheKey(lat, lon) {
  return `lcc-cache-wind-${roundCoord(lat)}-${roundCoord(lon)}`;
}
function tidePredCacheKey(stationId, rangeDays, rangeHours) {
  return `lcc-cache-tide-${stationId}-d${rangeDays || ''}-h${rangeHours || ''}`;
}
function tideHiLoCacheKey(stationId, rangeDays) {
  return `lcc-cache-hilo-${stationId}-d${rangeDays}`;
}
function waterTempCacheKey(stationId) {
  return `lcc-cache-water-${stationId}`;
}

async function fetchText(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (err) {
    clearTimeout(timer);
    console.warn('Fetch failed:', url, err.message);
    return null;
  }
}

async function fetchTextWithProxies(rawUrl, timeout = 15000) {
  for (const proxy of CONFIG.api.ndbcProxies) {
    const url = proxy.wrap(rawUrl);
    const result = await fetchText(url, timeout);
    if (result) return result;
  }
  return null;
}

// Proxy chain for the NDBC stdmet historical archive. Used only by
// fetchNDBCHistoricalYear. Returns the response body as text (NDBC's
// view_text_file.php endpoint serves plain text, so no decompression needed),
// or null if every proxy failed. Per-attempt logging stays in place so the
// next time a proxy rots we can tell from the console which one and how.
async function fetchWithProxies(rawUrl, timeout = 10000) {
  console.log(`[ndbc-fetch] target NDBC URL: ${rawUrl}`);
  const proxies = CONFIG.api.ndbcProxies;
  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    const url = proxy.wrap(rawUrl);
    console.log(`[ndbc-fetch] attempting proxy ${i + 1}/${proxies.length}: ${proxy.name}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const bodyText = await resp.text();
      console.log(`[ndbc-fetch] proxy ${proxy.name} → status ${resp.status}`, {
        ok: resp.ok,
        bodyLength: bodyText.length,
        bodyPreview: bodyText.slice(0, 300)
      });
      if (!resp.ok) continue;
      const head = bodyText.trimStart().slice(0, 500);
      // Content-Type / body-shape guard: a proxy that returned its own HTML
      // error page with status 200 will pass `resp.ok` but parse to garbage.
      // NDBC stdmet headers contain `#YY` or `YYYY` near the top.
      if (head.startsWith('<') || /<!DOCTYPE/i.test(head) || !/#YY|YYYY/.test(head)) {
        console.log(`[ndbc-fetch] proxy ${proxy.name} body does not look like NDBC stdmet; falling through`);
        continue;
      }
      return bodyText;
    } catch (err) {
      clearTimeout(timer);
      console.log(`[ndbc-fetch] proxy ${proxy.name} threw ${err.name}: ${err.message}`);
    }
  }
  return null;
}

// ── API: Open-Meteo Marine ───────────────────────
// List of Open-Meteo Marine API models verified against the live docs at
// https://open-meteo.com/en/docs/marine-weather-api (only those that
// expose swell_wave_* variables are user-selectable).
const FORECAST_MODELS = [
  { value: 'meteofrance_wave', label: 'MeteoFrance MFWAM (0.08°)' },
  { value: 'dwd_ewam',         label: 'DWD EWAM (0.05°)' },
  { value: 'dwd_gwam',         label: 'DWD GWAM (0.25°)' },
  { value: 'ecmwf_wam',        label: 'ECMWF WAM (~9 km)' },
  { value: 'ecmwf_wam025',     label: 'ECMWF WAM (0.25°)' },
  { value: 'gfs_wave025',      label: 'GFS Wave (NOAA, 0.25°)' },
  { value: 'gfs_wave016',      label: 'GFS Wave (NOAA, 0.16°)' },
  { value: 'era5_ocean',       label: 'ERA5-Ocean (0.5°)' }
];

async function fetchMarineForecast(lat, lon, model) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      'wave_height','wave_direction','wave_period',
      'swell_wave_height','swell_wave_direction','swell_wave_period','swell_wave_peak_period',
      'wind_wave_height','wind_wave_direction','wind_wave_period',
      'secondary_swell_wave_height','secondary_swell_wave_direction','secondary_swell_wave_period',
      'sea_surface_temperature'
    ].join(','),
    current: [
      'wave_height','wave_direction','wave_period',
      'swell_wave_height','swell_wave_direction','swell_wave_period',
      'wind_wave_height','wind_wave_direction','wind_wave_period',
      'sea_surface_temperature'
    ].join(','),
    length_unit: 'imperial',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: 7
  });
  if (model) params.set('models', model);
  const data = await fetchJSON(`${CONFIG.api.openMeteoMarine}?${params}`);
  if (data) writeCache(marineCacheKey(lat, lon, model), data);
  return data;
}

// ── API: Open-Meteo Weather (wind) ───────────────
async function fetchWindForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: 7
  });
  const data = await fetchJSON(`${CONFIG.api.openMeteoWeather}?${params}`);
  if (data) writeCache(windCacheKey(lat, lon), data);
  return data;
}

// ── API: CO-OPS tides ────────────────────────────
// rangeHours overrides rangeDays when supplied (max ~720h = 30 days).
async function fetchTidePredictions(stationId, rangeDays = 3, rangeHours) {
  const now = new Date();
  const beginDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const range = rangeHours != null ? rangeHours : rangeDays * 24;
  const params = new URLSearchParams({
    begin_date: beginDate,
    range,
    station: stationId,
    product: 'predictions',
    datum: 'MLLW',
    units: 'english',
    time_zone: 'lst_ldt',
    interval: '6',
    application: 'letscheckchoc',
    format: 'json'
  });
  const data = await fetchJSON(`${CONFIG.api.coops}?${params}`);
  if (data) writeCache(tidePredCacheKey(stationId, rangeDays, rangeHours), data);
  return data;
}

async function fetchTideHiLo(stationId, rangeDays = 3) {
  const now = new Date();
  const beginDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const params = new URLSearchParams({
    begin_date: beginDate,
    range: rangeDays * 24,
    station: stationId,
    product: 'predictions',
    datum: 'MLLW',
    units: 'english',
    time_zone: 'lst_ldt',
    interval: 'hilo',
    application: 'letscheckchoc',
    format: 'json'
  });
  const data = await fetchJSON(`${CONFIG.api.coops}?${params}`);
  if (data) writeCache(tideHiLoCacheKey(stationId, rangeDays), data);
  return data;
}

async function fetchWaterTemp(stationId) {
  const cached = readCache(waterTempCacheKey(stationId), CACHE_TTL.water);
  if (cached) return cached;
  const params = new URLSearchParams({
    date: 'latest',
    station: stationId,
    product: 'water_temperature',
    units: 'english',
    time_zone: 'lst_ldt',
    application: 'letscheckchoc',
    format: 'json'
  });
  const data = await fetchJSON(`${CONFIG.api.coops}?${params}`);
  if (data) writeCache(waterTempCacheKey(stationId), data);
  return data;
}

// ── API: NDBC via CORS proxy ─────────────────────
async function fetchNDBCStdmet(buoyId) {
  return fetchTextWithProxies(CONFIG.api.ndbcBase + buoyId + '.txt', 15000);
}

async function fetchNDBCSpectral(buoyId) {
  const base = CONFIG.api.ndbcBase + buoyId;
  const [spec, dataSpec, swdir, swdir2, swr1, swr2] = await Promise.all([
    fetchTextWithProxies(base + '.spec', 15000),
    fetchTextWithProxies(base + '.data_spec', 15000),
    fetchTextWithProxies(base + '.swdir', 15000),
    fetchTextWithProxies(base + '.swdir2', 15000),
    fetchTextWithProxies(base + '.swr1', 15000),
    fetchTextWithProxies(base + '.swr2', 15000)
  ]);
  return { spec, dataSpec, swdir, swdir2, swr1, swr2 };
}

// ── API: Pipeline fallback for Chocomount ────────
async function fetchPipelineBuoy() {
  const cached = readCache(PIPELINE_CACHE_KEY, CACHE_TTL.pipeline);
  if (cached) return cached;
  const data = await fetchJSON('data/buoy.json');
  if (data) writeCache(PIPELINE_CACHE_KEY, data);
  return data;
}

// ── Parse NDBC stdmet text ───────────────────────
function parseNDBCStdmet(text) {
  if (!text) return null;
  const lines = text.trim().split('\n');
  if (lines.length < 3) return null;
  // First two lines are headers
  const headers = lines[0].trim().split(/\s+/);
  const data = lines[2].trim().split(/\s+/);
  if (data.length < 10) return null;

  const obj = {};
  headers.forEach((h, i) => { obj[h] = data[i]; });

  const wvht = parseFloat(obj.WVHT);
  const dpd = parseFloat(obj.DPD);
  const apd = parseFloat(obj.APD);
  const mwd = parseFloat(obj.MWD);
  const wtmp = parseFloat(obj.WTMP);
  const wspd = parseFloat(obj.WSPD);
  const wdir = parseFloat(obj.WDIR);
  const gst = parseFloat(obj.GST);

  return {
    waveHeight: isNaN(wvht) || wvht >= 99 ? null : wvht * 3.28084,
    dominantPeriod: isNaN(dpd) || dpd >= 99 ? null : dpd,
    avgPeriod: isNaN(apd) || apd >= 99 ? null : apd,
    meanDirection: isNaN(mwd) || mwd >= 999 ? null : mwd,
    waterTemp: isNaN(wtmp) || wtmp >= 99 ? null : wtmp * 9/5 + 32,
    windSpeed: isNaN(wspd) || wspd >= 99 ? null : wspd * 2.237,
    windDir: isNaN(wdir) || wdir >= 999 ? null : wdir,
    windGust: isNaN(gst) || gst >= 99 ? null : gst * 2.237,
    time: `${obj['#YY']}-${obj.MM}-${obj.DD} ${obj.hh}:${obj.mm} UTC`
  };
}

// ── Parse NDBC spectral data ─────────────────────
// NDBC realtime2 spectral files interleave each value with its frequency in
// parens:  YY MM DD hh mm [sep_freq] v1 (f1) v2 (f2) v3 (f3) ...
// data_spec has the extra sep_freq scalar before the pairs; swdir/swdir2/
// swr1/swr2 do not.
function parseSpectralFile(text, hasSepFreq) {
  if (!text) return null;
  const lines = text.trim().split('\n');
  if (lines.length < 2) return null;
  const row = lines[1].trim().split(/\s+/);
  let i = 5 + (hasSepFreq ? 1 : 0);
  const freqs = [], values = [];
  while (i + 1 < row.length) {
    const v = Number(row[i]);
    const f = Number(row[i + 1].replace(/[()]/g, ''));
    if (!Number.isFinite(v) || !Number.isFinite(f)) break;
    values.push(v);
    freqs.push(f);
    i += 2;
  }
  return freqs.length ? { freqs, values } : null;
}

function parseNDBCSpectral(spectralData) {
  if (!spectralData || !spectralData.dataSpec) return null;

  const energy = parseSpectralFile(spectralData.dataSpec, true);
  if (!energy) return null;

  const dir1 = parseSpectralFile(spectralData.swdir, false);
  const dir2 = parseSpectralFile(spectralData.swdir2, false);
  const r1 = parseSpectralFile(spectralData.swr1, false);
  const r2 = parseSpectralFile(spectralData.swr2, false);

  const freqs = energy.freqs;
  const bins = freqs.map((f, i) => ({
    freq: f,
    period: f > 0 ? 1 / f : 0,
    energy: energy.values[i] || 0,
    dir1: dir1 && dir1.values[i] != null ? dir1.values[i] : 0,
    dir2: dir2 && dir2.values[i] != null ? dir2.values[i] : 0,
    r1: r1 && r1.values[i] != null ? r1.values[i] : 0.5,
    r2: r2 && r2.values[i] != null ? r2.values[i] : 0.25
  }));

  return { freqs, bins };
}

// ── Find nearest tide station ────────────────────
function findNearestTideStation(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const s of STATE.tideStations) {
    const d = haversineDistanceMiles(lat, lon, s.lat, s.lon);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (bestDist > CONFIG.coopsNearbyRadiusMiles) return null;
  return { ...best, distance: bestDist };
}

// ── Find nearest NDBC buoy ───────────────────────
function findNearestBuoy(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const b of STATE.buoys) {
    const d = haversineDistanceMiles(lat, lon, b.lat, b.lon);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return { ...best, distance: bestDist };
}

// ════════════════════════════════════════════════
// MAP INITIALIZATION
// ════════════════════════════════════════════════

function initBuoyMap() {
  STATE.buoyMap = L.map('buoy-map', {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView(CONFIG.map.center, CONFIG.map.zoom);

  L.tileLayer(CONFIG.map.tileUrl, {
    attribution: CONFIG.map.tileAttr,
    maxZoom: 18,
    subdomains: 'abcd'
  }).addTo(STATE.buoyMap);

  // Add buoy markers
  STATE.buoys.forEach(buoy => {
    if (buoy.home === 'chocomount' && !STATE.boatGatePassed) return;

    const color = '#5a7fa0'; // default blue
    // Chocomount buoy gets a regular dot marker (the star is placed separately)
    const icon = L.divIcon({
      className: 'buoy-marker',
      html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    const marker = L.marker([buoy.lat, buoy.lon], { icon })
      .addTo(STATE.buoyMap)
      .bindTooltip(`${buoy.name}<br>${buoy.id}`, { direction: 'top', offset: [0, -8] });

    marker.on('click', () => selectBuoy(buoy));
    STATE.buoyMarkers.push({ marker, buoy });
  });

  // Add permanent Chocomount Star marker at the forecast point
  if (STATE.boatGatePassed) {
    const starIcon = L.divIcon({
      className: 'choc-marker',
      html: '⭐',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    STATE.chocMarker = L.marker(
      [CONFIG.chocomount.starLat, CONFIG.chocomount.starLon],
      { icon: starIcon, zIndexOffset: 500 }
    )
      .addTo(STATE.buoyMap)
      .bindTooltip('Chocomount Star<br>41.089°N, 71.721°W', { direction: 'top', offset: [0, -10] });

    STATE.chocMarker.on('click', () => {
      const chocBuoy = STATE.buoys.find(b => b.home === 'chocomount');
      if (chocBuoy) selectBuoy(chocBuoy);
    });
  }

  // Add draggable forecast pin
  const pinIcon = L.divIcon({ className: 'pin-marker', html: '📍', iconSize: [24, 24], iconAnchor: [12, 24] });
  STATE.forecastPin = L.marker([40.5, -72.0], {
    icon: pinIcon,
    draggable: true,
    zIndexOffset: 1000
  }).addTo(STATE.buoyMap);

  STATE.forecastPin.on('dragend', () => {
    const pos = STATE.forecastPin.getLatLng();
    selectPin(pos.lat, pos.lng);
  });

  // Right-click to add custom spot
  STATE.buoyMap.on('contextmenu', (e) => {
    const name = prompt('Name this spot:');
    if (!name) return;
    const spots = JSON.parse(localStorage.getItem('lcc-spots') || '[]');
    spots.push({ name, lat: e.latlng.lat, lon: e.latlng.lng });
    localStorage.setItem('lcc-spots', JSON.stringify(spots));
    addCustomSpotMarker({ name, lat: e.latlng.lat, lon: e.latlng.lng });
  });

  // Load saved custom spots
  const spots = JSON.parse(localStorage.getItem('lcc-spots') || '[]');
  spots.forEach(s => addCustomSpotMarker(s));

  // Wire the [change] button on the collapsed summary
  const expandBtn = el('buoy-map-expand');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => setBuoyMapCollapsed(false));
  }

  // Restore collapse state on load. If a buoy/pin is already selected (saved
  // session restore would have set STATE.selectedBuoy), respect the stored
  // preference; otherwise force-expand.
  const storedCollapsed = localStorage.getItem('lcc-buoy-map-collapsed');
  const hasSelection = !!STATE.selectedBuoy || (STATE.pinLat != null && STATE.pinLon != null);
  if (hasSelection && storedCollapsed === 'true') {
    const lat = STATE.selectedBuoy ? STATE.selectedBuoy.lat : STATE.pinLat;
    const lon = STATE.selectedBuoy ? STATE.selectedBuoy.lon : STATE.pinLon;
    setBuoyMapCollapsed(true, buoyMapSummaryFor(STATE.selectedBuoy, lat, lon));
  } else {
    setBuoyMapCollapsed(false);
  }
}

function addCustomSpotMarker(spot) {
  const icon = L.divIcon({
    className: 'pin-marker',
    html: '📌',
    iconSize: [18, 18],
    iconAnchor: [9, 18]
  });
  L.marker([spot.lat, spot.lon], { icon })
    .addTo(STATE.buoyMap)
    .bindTooltip(spot.name, { direction: 'top', offset: [0, -12] })
    .on('click', () => selectPin(spot.lat, spot.lon));
}

function initTideMap() {
  STATE.tideMap = L.map('tide-map', {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView(CONFIG.map.center, CONFIG.map.zoom);

  L.tileLayer(CONFIG.map.tileUrl, {
    attribution: CONFIG.map.tileAttr,
    maxZoom: 18,
    subdomains: 'abcd'
  }).addTo(STATE.tideMap);

  STATE.tideStations.forEach(station => {
    const icon = L.divIcon({
      className: 'tide-station-marker',
      html: `<div style="width:8px;height:8px;border-radius:50%;background:#5a7fa0;"></div>`,
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    });
    const marker = L.marker([station.lat, station.lon], { icon })
      .addTo(STATE.tideMap)
      .bindTooltip(station.name, { direction: 'top', offset: [0, -6] });

    marker.on('click', () => selectTideStation(station));
    STATE.tideMarkers.push({ marker, station });
  });

  setFooter('footer-tide-map',
    'CO-OPS tide prediction stations',
    'https://tidesandcurrents.noaa.gov/tide_predictions.html',
    'tidesandcurrents.noaa.gov'
  );
}

// ════════════════════════════════════════════════
// SELECTION LOGIC
// ════════════════════════════════════════════════

function buoyMapSummaryFor(buoy, lat, lon) {
  const latStr = `${lat.toFixed(2)}°N`;
  const lonStr = `${lon.toFixed(2)}°W`;
  if (buoy) {
    const prefix = buoy.home === 'chocomount' ? 'Choc · ' : '';
    return `📍 ${prefix}${buoy.id} — ${buoy.name} · ${latStr}, ${lonStr}`;
  }
  return `📍 ${latStr}, ${lonStr}`;
}

function setBuoyMapCollapsed(collapsed, summaryText) {
  const panel = el('panel-map');
  if (!panel) return;
  const summary = el('buoy-map-summary');
  if (collapsed) {
    panel.classList.add('is-collapsed');
    if (summaryText && el('buoy-map-summary-text')) {
      el('buoy-map-summary-text').textContent = summaryText;
    }
    if (summary) summary.style.display = '';
  } else {
    panel.classList.remove('is-collapsed');
    if (summary) summary.style.display = 'none';
    // Force Leaflet to recompute size after re-show
    setTimeout(() => { if (STATE.buoyMap) STATE.buoyMap.invalidateSize(); }, 50);
  }
  localStorage.setItem('lcc-buoy-map-collapsed', collapsed ? 'true' : 'false');
}

function collapseBuoyMapForSelection(buoy, lat, lon) {
  setBuoyMapCollapsed(true, buoyMapSummaryFor(buoy, lat, lon));
}

function selectBuoy(buoy) {
  STATE.selectedBuoy = buoy;
  STATE.isChocomount = buoy.home === 'chocomount';

  const lat = buoy.lat;
  const lon = buoy.lon;
  STATE.pinLat = lat;
  STATE.pinLon = lon;

  // Move forecast pin near buoy
  STATE.forecastPin.setLatLng([lat, lon]);

  // Update header
  const prefix = STATE.isChocomount ? 'Choc · ' : '';
  el('header-location').textContent = `${prefix}${buoy.id} ${buoy.name}`;

  // Update tab bar / per-tab visibility
  updateTabBarVisibility();
  syncBuoySelectDropdown();

  // Collapse the buoy-selector map down to a one-line summary.
  collapseBuoyMapForSelection(buoy, lat, lon);

  // Load all data
  loadAllData(buoy);
  if (typeof updateW1StatusBar === 'function') updateW1StatusBar();
}

function selectPin(lat, lon) {
  STATE.selectedBuoy = null;
  STATE.isChocomount = false;
  STATE.pinLat = lat;
  STATE.pinLon = lon;

  el('header-location').textContent = `${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`;

  updateTabBarVisibility();
  syncBuoySelectDropdown();
  collapseBuoyMapForSelection(null, lat, lon);
  loadPinData(lat, lon);
  if (typeof updateW1StatusBar === 'function') updateW1StatusBar();
}

async function selectTideStation(station) {
  // Highlight the station on the map
  STATE.tideMarkers.forEach(tm => {
    tm.marker.getElement()?.querySelector('div')?.style.setProperty('background', '#5a7fa0');
    tm.marker.getElement()?.classList.remove('tide-station-marker-active');
  });
  const found = STATE.tideMarkers.find(tm => tm.station.id === station.id);
  if (found) {
    found.marker.getElement()?.querySelector('div')?.style.setProperty('background', '#2c2825');
    found.marker.getElement()?.classList.add('tide-station-marker-active');
  }

  // Fetch and display hi/lo tides
  el('tide-map-info').innerHTML = `Loading tides for ${station.name}...`;
  const hiloData = await fetchTideHiLo(station.id, 2);
  if (hiloData && hiloData.predictions) {
    let html = `<strong>${station.name}</strong> (${station.id})<br>`;
    hiloData.predictions.slice(0, 8).forEach(p => {
      const d = new Date(p.t);
      const type = p.type === 'H' ? 'High' : 'Low';
      const cls = p.type === 'H' ? 'tide-type-h' : 'tide-type-l';
      html += `<span class="tide-item"><span class="tide-type ${cls}">${type}</span> ${formatTime(d)} ${formatDay(d)} · ${parseFloat(p.v).toFixed(1)} ft</span><br>`;
    });
    el('tide-map-info').innerHTML = html;
  } else {
    el('tide-map-info').innerHTML = `No tide data available for ${station.name}`;
  }
}

// ════════════════════════════════════════════════
// DATA LOADING
// ════════════════════════════════════════════════

// Renders condition cards + forecast chart for a buoy/pin context. Reused
// by the SWR pre-render path (cached data) and the post-fetch refresh.
function renderForecastSet(ctx) {
  const {
    buoy, isChoc, selectedModel,
    forecastLat, forecastLon, displayLat, displayLon,
    marine, wind, buoyParsed, pipelineData,
    tideHiLo, tidePred, tideStn
  } = ctx;

  updateSwellCard(buoyParsed, marine, buoy, pipelineData?.spectral_summary);
  updateWindCard(wind, buoyParsed, isChoc, displayLat, displayLon);
  updateWaterTempCard(buoyParsed, marine, isChoc);
  updateDaylightCard(displayLat, displayLon);
  updateSecondarySwellCard(marine, isChoc, forecastLat, forecastLon);
  updateCoordFooters(buoy, forecastLat, forecastLon, displayLat, displayLon);

  if (marine && marine.hourly) {
    const daylight = calcDaylight(displayLat, displayLon, new Date());

    STATE._cachedMarine = marine;
    STATE._cachedWind = wind;
    STATE._cachedTideHiLo = tideHiLo;
    STATE._cachedTidePred = tidePred;

    updateTideCard(tideHiLo, tideStn);
    drawForecastChart(marine, wind, daylight, tideHiLo, tidePred);

    if (isChoc) drawLineupMap(marine, wind, buoyParsed);

    const coordLabel = isChoc
      ? `${forecastLat}°N, ${Math.abs(forecastLon)}°W (open water)`
      : `${forecastLat.toFixed(3)}°N, ${Math.abs(forecastLon).toFixed(3)}°W`;
    setFooter('footer-forecast',
      `Open-Meteo Marine · ${describeForecastModel(selectedModel)} · ${coordLabel}`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }
}

// Same as above, minus buoy-specific bits (used by pin loads).
function renderPinForecastSet(ctx) {
  const {
    selectedModel, lat, lon,
    marine, wind, tideHiLo, tidePred, tideStn
  } = ctx;

  updateSwellCard(null, marine, null);
  updateWindCard(wind, null, false, lat, lon);
  updateWaterTempCard(null, marine, false);
  updateDaylightCard(lat, lon);
  updateSecondarySwellCard(marine, false, lat, lon);
  updateCoordFooters(null, lat, lon, lat, lon);

  if (marine && marine.hourly) {
    const daylight = calcDaylight(lat, lon, new Date());
    STATE._cachedTidePred = tidePred;
    updateTideCard(tideHiLo, tideStn);
    drawForecastChart(marine, wind, daylight, tideHiLo, tidePred);
    setFooter('footer-forecast',
      `Open-Meteo Marine · ${describeForecastModel(selectedModel)} · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }
}

function setCacheRefreshIndicator(visible) {
  const ind = el('forecast-cache-indicator');
  if (!ind) return;
  ind.style.display = visible ? '' : 'none';
}

async function loadAllData(buoy) {
  const lat = buoy.lat;
  const lon = buoy.lon;
  const isChoc = buoy.home === 'chocomount';
  // For Choc, the user can flip "Use buoy coordinates for forecast" to query
  // the buoy's own lat/lon instead of the hardcoded open-water point.
  const useBuoyCoords = isChoc && getForecastUseBuoyCoords();
  const forecastLat = !isChoc ? lat
    : (useBuoyCoords ? lat : CONFIG.chocomount.forecastLat);
  const forecastLon = !isChoc ? lon
    : (useBuoyCoords ? lon : CONFIG.chocomount.forecastLon);
  const displayLat = isChoc ? CONFIG.chocomount.lat : lat;
  const displayLon = isChoc ? CONFIG.chocomount.lon : lon;

  const selectedModel = getForecastModel();
  const tideStn = findNearestTideStation(displayLat, displayLon);
  STATE.nearestTideStation = tideStn;

  // ── SWR: paint from cache before any network hits ──
  const cachedMarine   = readCache(marineCacheKey(forecastLat, forecastLon, selectedModel), CACHE_TTL.marine);
  const cachedWind     = readCache(windCacheKey(displayLat, displayLon), CACHE_TTL.wind);
  const cachedPipeline = isChoc ? readCache(PIPELINE_CACHE_KEY, CACHE_TTL.pipeline) : null;
  const cachedHiLoRaw  = tideStn ? readCache(tideHiLoCacheKey(tideStn.id, 10), CACHE_TTL.hilo) : null;
  const cachedPredRaw  = tideStn ? readCache(tidePredCacheKey(tideStn.id, undefined, 168), CACHE_TTL.tide) : null;
  const cachedHiLo = cachedHiLoRaw && cachedHiLoRaw.predictions ? cachedHiLoRaw.predictions : null;
  const cachedPred = cachedPredRaw && cachedPredRaw.predictions ? cachedPredRaw.predictions : null;

  const tidesCacheReady = !tideStn || (cachedHiLo && cachedPred);
  const canRenderFromCache = !!(cachedMarine && cachedMarine.hourly && cachedWind && tidesCacheReady);

  if (canRenderFromCache) {
    let cachedBuoyParsed = STATE._cachedBuoyParsed || null;
    if (!cachedBuoyParsed && cachedPipeline && cachedPipeline.buoy) {
      cachedBuoyParsed = {
        waveHeight: cachedPipeline.buoy.wave_height,
        dominantPeriod: cachedPipeline.buoy.dominant_period,
        meanDirection: cachedPipeline.buoy.mean_wave_direction,
        waterTemp: cachedPipeline.buoy.water_temp,
        windSpeed: cachedPipeline.buoy.wind_speed,
        windDir: cachedPipeline.buoy.wind_direction,
        windGust: cachedPipeline.buoy.wind_gust,
        time: cachedPipeline.buoy.time || 'pipeline data'
      };
    }
    renderForecastSet({
      buoy, isChoc, selectedModel,
      forecastLat, forecastLon, displayLat, displayLon,
      marine: cachedMarine, wind: cachedWind,
      buoyParsed: cachedBuoyParsed, pipelineData: cachedPipeline,
      tideHiLo: cachedHiLo, tidePred: cachedPred, tideStn
    });
    setCacheRefreshIndicator(true);
  } else {
    el('val-swell-height').textContent = '···';
    el('val-wind-speed').textContent = '···';
    el('val-water-temp').textContent = '···';
    el('val-tide').textContent = '···';
    setCacheRefreshIndicator(false);
  }

  // ── Fire all parallel fetches (forecast chart deps) ──
  let [marine, wind, buoyData, pipelineData, hiloRaw, predRaw] = await Promise.all([
    fetchMarineForecast(forecastLat, forecastLon, selectedModel),
    fetchWindForecast(displayLat, displayLon),
    buoy.spectral ? fetchNDBCStdmet(buoy.id) : Promise.resolve(null),
    isChoc ? fetchPipelineBuoy() : Promise.resolve(null),
    tideStn ? fetchTideHiLo(tideStn.id, 10) : Promise.resolve(null),
    tideStn ? fetchTidePredictions(tideStn.id, undefined, 168) : Promise.resolve(null)
  ]);
  if (selectedModel && !marineHasUsableData(marine)) {
    showToast(`Model ${selectedModel} unavailable, falling back to best_match`, 'warn');
    setForecastModel('');
    marine = await fetchMarineForecast(forecastLat, forecastLon, null);
  }

  // Parse buoy data (CORS proxy primary, pipeline fallback for Choc)
  let buoyParsed = parseNDBCStdmet(buoyData);
  if (!buoyParsed && pipelineData && pipelineData.buoy) {
    buoyParsed = {
      waveHeight: pipelineData.buoy.wave_height,
      dominantPeriod: pipelineData.buoy.dominant_period,
      meanDirection: pipelineData.buoy.mean_wave_direction,
      waterTemp: pipelineData.buoy.water_temp,
      windSpeed: pipelineData.buoy.wind_speed,
      windDir: pipelineData.buoy.wind_direction,
      windGust: pipelineData.buoy.wind_gust,
      time: pipelineData.buoy.time || 'pipeline data'
    };
  }
  STATE._cachedBuoyParsed = buoyParsed;

  const tideHiLoForChart = hiloRaw && hiloRaw.predictions ? hiloRaw.predictions : null;
  const tidePredForChart = predRaw && predRaw.predictions ? predRaw.predictions : null;

  renderForecastSet({
    buoy, isChoc, selectedModel,
    forecastLat, forecastLon, displayLat, displayLon,
    marine, wind, buoyParsed, pipelineData,
    tideHiLo: tideHiLoForChart, tidePred: tidePredForChart, tideStn
  });
  setCacheRefreshIndicator(false);

  // ── Tides panel ──
  if (STATE.nearestTideStation) {
    await loadTidesPanel(STATE.nearestTideStation);
    el('panel-tides').style.display = '';
  } else {
    el('panel-tides').style.display = 'none';
  }

  // ── Spectral data (compass rose + spectrum) ──
  if (buoy.spectral) {
    el('panel-spectral-row').style.display = '';
    el('panel-spectral-summary').style.display = '';
    let parsed = null;
    let spectralRaw = null;
    let isStale = false;

    // Try live CORS fetch first
    try {
      spectralRaw = await fetchNDBCSpectral(buoy.id);
      parsed = parseNDBCSpectral(spectralRaw);
    } catch (err) {
      console.warn('Spectral CORS fetch failed:', buoy.id, err);
    }

    // Fallback to pipeline data
    if (!parsed || !parsed.bins || parsed.bins.length === 0) {
      try {
        const pData = await fetchPipelineBuoy();
        if (pData && pData.spectral_bins && pData.spectral_bins.length > 0) {
          parsed = { freqs: pData.spectral_bins.map(b => b.freq), bins: pData.spectral_bins };
          isStale = true;
          // Use pipeline spectral summary for the summary table
          if (pData.spectral_summary) {
            spectralRaw = spectralRaw || {};
            spectralRaw._pipelineSummary = pData.spectral_summary;
            spectralRaw._fetchTime = pData.fetch_time;
          }
        }
      } catch (err) {
        console.warn('Pipeline spectral fallback failed:', err);
      }
    }

    if (parsed && parsed.bins && parsed.bins.length > 0) {
      STATE.lastSpectral = parsed;
      STATE.lastBuoyParsed = buoyParsed;
      showSpectralCharts();
      renderSpectralSummary(spectralRaw, buoyParsed);
      requestAnimationFrame(() => {
        drawCompassRose(parsed, buoyParsed);
        drawSpectrum(parsed);
      });
      const staleNote = isStale ? ' · pipeline fallback' : '';
      setFooter('footer-compass',
        `ndbc ${buoy.id} · ${buoy.name} · ${buoy.lat}°N, ${Math.abs(buoy.lon)}°W${staleNote}`,
        `https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}`,
        'ndbc station page'
      );
      setFooter('footer-spectrum',
        `ndbc ${buoy.id} spectral data${staleNote}`,
        `https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}`,
        'ndbc station page'
      );
      if (isStale && spectralRaw && spectralRaw._fetchTime) {
        setFooter('footer-spectral-summary',
          `pipeline fallback · fetched ${new Date(spectralRaw._fetchTime).toLocaleString()}`
        );
      }
    } else {
      console.warn('Spectral parse returned no bins for buoy', buoy.id);
      showSpectralEmpty(buoy.id);
      el('panel-spectral-summary').style.display = 'none';
    }
  } else {
    el('panel-spectral-row').style.display = '';
    el('panel-spectral-summary').style.display = 'none';
    showSpectralEmpty();
  }

  // ── Tide station map ──
  highlightNearestTideStation(displayLat, displayLon);

  // Update time
  el('header-update-time').textContent = `Updated ${formatTime(new Date())}`;
}

async function loadPinData(lat, lon) {
  const selectedModel = getForecastModel();
  const tideStn = findNearestTideStation(lat, lon);
  STATE.nearestTideStation = tideStn;

  // ── SWR: paint from cache before any network hits ──
  const cachedMarine  = readCache(marineCacheKey(lat, lon, selectedModel), CACHE_TTL.marine);
  const cachedWind    = readCache(windCacheKey(lat, lon), CACHE_TTL.wind);
  const cachedHiLoRaw = tideStn ? readCache(tideHiLoCacheKey(tideStn.id, 10), CACHE_TTL.hilo) : null;
  const cachedPredRaw = tideStn ? readCache(tidePredCacheKey(tideStn.id, undefined, 168), CACHE_TTL.tide) : null;
  const cachedHiLo = cachedHiLoRaw && cachedHiLoRaw.predictions ? cachedHiLoRaw.predictions : null;
  const cachedPred = cachedPredRaw && cachedPredRaw.predictions ? cachedPredRaw.predictions : null;

  const tidesCacheReady = !tideStn || (cachedHiLo && cachedPred);
  const canRenderFromCache = !!(cachedMarine && cachedMarine.hourly && cachedWind && tidesCacheReady);

  if (canRenderFromCache) {
    renderPinForecastSet({
      selectedModel, lat, lon,
      marine: cachedMarine, wind: cachedWind,
      tideHiLo: cachedHiLo, tidePred: cachedPred, tideStn
    });
    setCacheRefreshIndicator(true);
  } else {
    el('val-swell-height').textContent = '···';
    el('val-wind-speed').textContent = '···';
    el('val-water-temp').textContent = '···';
    el('val-tide').textContent = '···';
    setCacheRefreshIndicator(false);
  }

  // ── Fire fresh fetches in parallel ──
  let [marine, wind, hiloRaw, predRaw] = await Promise.all([
    fetchMarineForecast(lat, lon, selectedModel),
    fetchWindForecast(lat, lon),
    tideStn ? fetchTideHiLo(tideStn.id, 10) : Promise.resolve(null),
    tideStn ? fetchTidePredictions(tideStn.id, undefined, 168) : Promise.resolve(null)
  ]);
  if (selectedModel && !marineHasUsableData(marine)) {
    showToast(`Model ${selectedModel} unavailable, falling back to best_match`, 'warn');
    setForecastModel('');
    marine = await fetchMarineForecast(lat, lon, null);
  }

  const tideHiLoForChart = hiloRaw && hiloRaw.predictions ? hiloRaw.predictions : null;
  const tidePredForChart = predRaw && predRaw.predictions ? predRaw.predictions : null;

  renderPinForecastSet({
    selectedModel, lat, lon,
    marine, wind,
    tideHiLo: tideHiLoForChart, tidePred: tidePredForChart, tideStn
  });
  setCacheRefreshIndicator(false);

  if (STATE.nearestTideStation) {
    await loadTidesPanel(STATE.nearestTideStation);
    el('panel-tides').style.display = '';
  } else {
    el('panel-tides').style.display = 'none';
  }

  // No spectral for pin — show empty state
  el('panel-spectral-row').style.display = '';
  showSpectralEmpty();

  highlightNearestTideStation(lat, lon);
  el('header-update-time').textContent = `Updated ${formatTime(new Date())}`;
}

// ════════════════════════════════════════════════
// UPDATE CONDITION CARDS
// ════════════════════════════════════════════════

function updateSwellCard(buoyParsed, marine, buoy, spectralSummary) {
  const isChoc = STATE.isChocomount;
  const card = el('card-swell');
  card.classList.remove('quality-good', 'quality-fair', 'quality-poor');

  // Prefer buoy data for current swell
  if (buoyParsed && buoyParsed.waveHeight != null) {
    const totalH = buoyParsed.waveHeight;  // WVHT total (ft) — swell + wind waves
    const d = buoyParsed.meanDirection;

    // Use spectral swell-only height when available (consistent with ML model variable)
    const specSwellM = spectralSummary?.swell_height_m;
    const swellFt = (specSwellM != null && specSwellM < 90)
      ? Math.round(specSwellM * 3.28084 * 10) / 10 : null;
    const displayP = (swellFt != null && spectralSummary?.swell_period != null)
      ? spectralSummary.swell_period : buoyParsed.dominantPeriod;

    // Card accent based on total wave height
    if (totalH >= 3) card.classList.add('quality-good');
    else if (totalH >= 1.5) card.classList.add('quality-fair');
    else card.classList.add('quality-poor');

    el('val-swell-height').textContent = swellFt != null
      ? `${swellFt.toFixed(1)} ft swell`
      : `${totalH.toFixed(1)} ft`;
    el('val-swell-height').className = `condition-value ${swellDirClass(d)}`;
    el('val-swell-detail').textContent = `${displayP ? displayP.toFixed(0) + 's' : '—'} · ${directionLabel(d)} (${d != null ? d + '°' : '—'})${swellFt != null ? ' · ' + totalH.toFixed(1) + ' ft total' : ''}`;

    // Swell arrival estimator (Chocomount only)
    if (isChoc && displayP) {
      const arrival = swellArrivalTime(displayP, CONFIG.chocomount.buoyDistanceMiles);
      if (arrival) {
        el('val-swell-arrival').style.display = '';
        el('val-swell-arrival').textContent = `Swell arriving from ~${CONFIG.chocomount.buoyDistanceMiles} miles away: ${arrival.label}`;
      }
    } else {
      el('val-swell-arrival').style.display = 'none';
    }

    const buoyLabel = buoy ? `ndbc ${buoy.id} · ${buoy.name}` : 'ndbc buoy';
    const buoyUrl = buoy ? `https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}` : 'https://www.ndbc.noaa.gov/';
    setFooter('footer-swell', buoyLabel, buoyUrl, 'ndbc station page');

  } else if (marine && marine.current) {
    // Fallback to Open-Meteo current — use swell-only variables for consistency with ML model
    const c = marine.current;
    const h = c.swell_wave_height ?? c.wave_height;
    const p = c.swell_wave_period ?? c.wave_period;
    const d = c.swell_wave_direction ?? c.wave_direction;
    el('val-swell-height').textContent = h != null ? `${h.toFixed(1)} ft` : '—';
    el('val-swell-height').className = 'condition-value';
    el('val-swell-detail').textContent = `${p ? p.toFixed(0) + 's' : '—'} · ${directionLabel(d)}`;
    el('val-swell-arrival').style.display = 'none';
    setFooter('footer-swell', 'Open-Meteo Marine', 'https://open-meteo.com/en/docs/marine-weather-api', 'open-meteo.com');
  } else {
    el('val-swell-height').textContent = '—';
    el('val-swell-detail').textContent = 'No data available';
    el('val-swell-arrival').style.display = 'none';
    setFooter('footer-swell', 'No data source available');
  }
}

function updateWindCard(wind, buoyParsed, isChoc, lat, lon) {
  if (wind && wind.current) {
    const s = wind.current.wind_speed_10m;
    const d = wind.current.wind_direction_10m;
    const g = wind.current.wind_gusts_10m;
    const arrow = directionArrow(d);
    el('val-wind-speed').textContent = s != null ? `${Math.round(s)} mph` : '—';

    el('val-wind-detail').innerHTML = d != null
      ? `<span class="wind-arrow-inline">${arrow}</span> ${directionLabel(d)} (${Math.round(d)}°) · gusts ${g != null ? Math.round(g) : '—'} mph`
      : `${directionLabel(d)} · gusts ${g != null ? Math.round(g) : '—'} mph`;
    setFooter('footer-wind',
      `Open-Meteo Weather · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`,
      'https://open-meteo.com/en/docs',
      'open-meteo.com'
    );
  } else if (buoyParsed && buoyParsed.windSpeed != null) {
    const arrow = directionArrow(buoyParsed.windDir);
    el('val-wind-speed').textContent = `${Math.round(buoyParsed.windSpeed)} mph`;
    el('val-wind-detail').innerHTML = `<span class="wind-arrow-inline">${arrow}</span> ${directionLabel(buoyParsed.windDir)} · gusts ${buoyParsed.windGust ? Math.round(buoyParsed.windGust) : '—'} mph`;
    setFooter('footer-wind', 'ndbc buoy', 'https://www.ndbc.noaa.gov/', 'ndbc');
  } else {
    el('val-wind-speed').textContent = '—';
    el('val-wind-detail').textContent = 'No data available';
    setFooter('footer-wind', 'No data source available');
  }
}

async function updateWaterTempCard(buoyParsed, marine, isChoc) {
  let temp = null;
  let source = '';
  let sourceUrl = '';

  if (isChoc) {
    // Try CO-OPS Montauk first
    const coopsData = await fetchWaterTemp(CONFIG.chocomount.waterTempStation);
    if (coopsData && coopsData.data && coopsData.data.length > 0) {
      temp = parseFloat(coopsData.data[0].v);
      source = `CO-OPS ${CONFIG.chocomount.waterTempStation} · Montauk, NY`;
      sourceUrl = `https://tidesandcurrents.noaa.gov/stationhome.html?id=${CONFIG.chocomount.waterTempStation}`;
    }
  }

  if (temp == null && buoyParsed && buoyParsed.waterTemp != null) {
    temp = buoyParsed.waterTemp;
    source = 'ndbc buoy (offshore)';
    sourceUrl = 'https://www.ndbc.noaa.gov/';
  }

  if (temp == null && marine && marine.current && marine.current.sea_surface_temperature != null) {
    temp = marine.current.sea_surface_temperature;
    source = 'Open-Meteo sst';
    sourceUrl = 'https://open-meteo.com/en/docs/marine-weather-api';
  }

  if (temp != null) {
    el('val-water-temp').textContent = `${Math.round(temp)}°F`;
    el('val-water-temp').className = `condition-value ${tempColorClass(temp)}`;
    el('val-temp-detail').textContent = temp < 50 ? 'Very cold' : temp < 60 ? 'Cold' : temp < 70 ? 'Comfortable' : 'Warm';
    setFooter('footer-temp', source, sourceUrl, 'source');
  } else {
    el('val-water-temp').textContent = '—';
    el('val-water-temp').className = 'condition-value';
    el('val-temp-detail').textContent = 'No data available';
    setFooter('footer-temp', 'No data source available');
  }
}

function updateDaylightCard(lat, lon) {
  const dl = calcDaylight(lat, lon, new Date());
  if (dl.alwaysDay) {
    el('val-daylight').textContent = 'Midnight sun';
    el('val-daylight-detail').textContent = '24 hrs of daylight';
  } else if (dl.alwaysNight) {
    el('val-daylight').textContent = 'Polar night';
    el('val-daylight-detail').textContent = '0 hrs of daylight';
  } else {
    const h = Math.floor(dl.daylightHours);
    const m = Math.round((dl.daylightHours - h) * 60);
    el('val-daylight').textContent = `${formatTime(dl.firstLight)} → ${formatTime(dl.lastLight)}`;
    el('val-daylight-detail').textContent = `${h}h ${m}m of daylight`;
  }
  setFooter('footer-daylight', `Astronomical calc · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`);
}

// ════════════════════════════════════════════════
// TIDE CONDITION CARD
// ════════════════════════════════════════════════

function updateTideCard(tideHiLo, station) {
  const card = el('card-tide');
  if (!card) return;

  if (!tideHiLo || tideHiLo.length === 0) {
    el('val-tide').textContent = '—';
    el('val-tide-detail').textContent = 'No tide data';
    setFooter('footer-tide-card', '');
    return;
  }

  const now = Date.now();
  // Find next upcoming tide event
  let next = null;
  let prev = null;
  for (const p of tideHiLo) {
    const t = new Date(p.t).getTime();
    if (t > now && !next) next = p;
    if (t <= now) prev = p;
  }

  if (next) {
    const nd = new Date(next.t);
    const type = next.type === 'H' ? 'High' : 'Low';
    const timeStr = formatTime(nd);
    const dayStr = nd.toLocaleDateString('en-US', { weekday: 'short' });
    const val = parseFloat(next.v).toFixed(1);
    el('val-tide').textContent = `${type} ${timeStr}`;
    el('val-tide-detail').textContent = `${dayStr} · ${val} ft`;

    // Color accent: low tide = good for surfing
    card.classList.remove('quality-good', 'quality-fair', 'quality-poor');
    if (next.type === 'L') card.classList.add('quality-good');
    else card.classList.add('quality-fair');
  }

  if (prev && next) {
    // Show "rising" or "falling"
    const prevType = prev.type === 'H' ? 'High' : 'Low';
    const trend = prev.type === 'H' ? 'Falling' : 'Rising';
    el('val-tide-detail').textContent += ` · ${trend}`;
  }

  if (station) {
    setFooter('footer-tide-card',
      `CO-OPS ${station.id}`,
      `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${station.id}`,
      'tides'
    );
  }
}

// ════════════════════════════════════════════════
// TIDES PANEL
// ════════════════════════════════════════════════

async function loadTidesPanel(station) {
  const [predData, hiloData] = await Promise.all([
    fetchTidePredictions(station.id, 3),
    fetchTideHiLo(station.id, 3)
  ]);

  if (predData && predData.predictions && predData.predictions.length > 0) {
    drawTideChart(predData.predictions);
  }

  if (hiloData && hiloData.predictions) {
    const list = el('tide-hilo-list');
    list.innerHTML = '';
    hiloData.predictions.slice(0, 12).forEach(p => {
      const d = new Date(p.t);
      const type = p.type === 'H' ? 'H' : 'L';
      const cls = p.type === 'H' ? 'tide-type-h' : 'tide-type-l';
      const item = document.createElement('span');
      item.className = 'tide-item';
      item.innerHTML = `<span class="tide-type ${cls}">${type}</span> ${formatTime(d)} ${formatDayShort(d)} · ${parseFloat(p.v).toFixed(1)}ft`;
      list.appendChild(item);
    });
  }

  const distLabel = station.distance ? ` · ${Math.round(station.distance)} mi away` : '';
  setFooter('footer-tides',
    `CO-OPS ${station.id} · ${station.name}${distLabel}`,
    `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${station.id}`,
    'tidesandcurrents.noaa.gov'
  );
}

function highlightNearestTideStation(lat, lon) {
  const nearest = findNearestTideStation(lat, lon);
  STATE.tideMarkers.forEach(tm => {
    const div = tm.marker.getElement()?.querySelector('div');
    if (div) div.style.background = '#5a7fa0';
  });
  if (nearest) {
    const found = STATE.tideMarkers.find(tm => tm.station.id === nearest.id);
    if (found) {
      const div = found.marker.getElement()?.querySelector('div');
      if (div) div.style.background = '#2c2825';
    }
    // Center tide map on the area
    STATE.tideMap.setView([lat, lon], 8);
  }
}

// ════════════════════════════════════════════════
// SWELL FORECAST CHART (Canvas 2D, three stacked card-panels)
// ════════════════════════════════════════════════
//
// Three independent <canvas> elements, each inside its own card:
//
//   ┌─ #forecast-chart-container ─────────────────────────┐
//   │  ┌─ swell card ─ canvas#forecast-canvas-swell  ──┐  │
//   │  ┌─ wind  card ─ canvas#forecast-canvas-wind  ──┐  │
//   │  ┌─ tide  card ─ canvas#forecast-canvas-tide  ──┐  │
//   │  ┌─ day  row ── canvas#forecast-canvas-days  ──┐  │
//   └──────────────────────────────────────────────────────┘
//
// Coordination: a single `_drawForecastChartFull` cycle calls into
// drawSwellPanel → drawWindPanel → drawTidePanel → drawDayLabels in
// sequence. Every canvas uses the same horizontal
// padding (FC_PAD.left/right) so the per-canvas xPos is identical;
// day separators / nighttime shading land at the same x on every card.
// Visual reference: project/Swell Forecast.html (React prototype).

const FORECAST_HOURS = 168; // 7 × 24

// Canvas-internal padding (CSS px). Identical on every panel canvas so
// the time-axis (xPos) matches across all three cards.
const FC_PAD = { left: 36, right: 40 };

function drawForecastChart(marine, wind, daylight, tideHiLo, tidePred) {
  // Cache so the scrubber and external reflows can re-render without re-fetching.
  STATE.forecastData = { marine, wind, daylight, tideHiLo, tidePred };
  // New data → re-resolve scrubber position (may reload from sessionStorage).
  STATE.scrubberIdx = -1;
  _drawForecastChartFull(marine, wind, daylight, tideHiLo, tidePred);
}

// ── Shared per-canvas helpers ──────────────────────
//
// Every panel canvas receives the same `common` payload (time range,
// daylight, etc.). Each panel computes its own (cssW, cssH, plotW) but
// uses identical FC_PAD.left/right so the time-axis lines up across
// all three cards.

function _fcXFor(time, common, plotLeft, plotW) {
  return plotLeft + ((time.getTime() - common.t0) / common.tRange) * plotW;
}

function _fcDrawNightShading(ctx, common, plotLeft, plotW, top, height) {
  const dl0 = common.daylight;
  if (!dl0 || dl0.alwaysDay) return;
  ctx.fillStyle = 'rgba(44, 40, 37, 0.04)';
  for (let dayOff = 0; dayOff < common.dayCount + 1; dayOff++) {
    const dayDate = new Date(common.firstDay);
    dayDate.setDate(dayDate.getDate() + dayOff);
    const dl = calcDaylight(common.pinLat, common.pinLon, dayDate);
    if (!dl || !dl.sunset || !dl.sunrise) continue;
    const sunsetX = _fcXFor(dl.sunset, common, plotLeft, plotW);
    const midnightDate = new Date(dayDate);
    midnightDate.setDate(midnightDate.getDate() + 1);
    midnightDate.setHours(0, 0, 0, 0);
    const midnightX = _fcXFor(midnightDate, common, plotLeft, plotW);
    if (sunsetX < plotLeft + plotW && midnightX > plotLeft) {
      ctx.fillRect(Math.max(sunsetX, plotLeft), top,
        Math.min(midnightX, plotLeft + plotW) - Math.max(sunsetX, plotLeft), height);
    }
    const morningStart = new Date(dayDate); morningStart.setHours(0, 0, 0, 0);
    const mStartX = _fcXFor(morningStart, common, plotLeft, plotW);
    const sunriseX = _fcXFor(dl.sunrise, common, plotLeft, plotW);
    if (mStartX < plotLeft + plotW && sunriseX > plotLeft) {
      ctx.fillRect(Math.max(mStartX, plotLeft), top,
        Math.min(sunriseX, plotLeft + plotW) - Math.max(mStartX, plotLeft), height);
    }
  }
}

function _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, height) {
  // Solid grey midnight verticals — appear as continuous columns when
  // drawn on every panel canvas.
  ctx.strokeStyle = '#c0c0c0';
  ctx.lineWidth = 1;
  for (let dayOff = 0; dayOff <= common.dayCount; dayOff++) {
    const midDate = new Date(common.firstDay);
    midDate.setDate(midDate.getDate() + dayOff);
    const xx = _fcXFor(midDate, common, plotLeft, plotW);
    if (xx > plotLeft && xx < plotLeft + plotW) {
      ctx.beginPath();
      ctx.moveTo(xx, top);
      ctx.lineTo(xx, top + height);
      ctx.stroke();
    }
  }
}

// "You are here" cue — 2px blue stripe at the LEFT EDGE of today's
// column. Drawn on every panel canvas using identical x-coords so the
// accent reads as one continuous vertical mark across the cards.
function _fcDrawTodayAccent(ctx, common, plotLeft, plotW, top, height) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Skip if today is outside the chart window.
  if (today.getTime() < common.t0 - 1 || today.getTime() > common.tEnd) return;
  const xx = _fcXFor(today, common, plotLeft, plotW);
  if (xx < plotLeft - 1 || xx > plotLeft + plotW) return;
  ctx.save();
  ctx.strokeStyle = '#3a5570'; // primary-swell blue
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xx, top);
  ctx.lineTo(xx, top + height);
  ctx.stroke();
  ctx.restore();
}

// Filled dot in line color with a 1.5px white halo for separation.
// Drawn last in each panel so it sits above all data lines.
function drawScrubberDot(ctx, x, y, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ── Per-panel drawers ──────────────────────────────

function drawSwellPanel(common, data) {
  const canvas = el('forecast-canvas-swell');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);

  const isMobile = common.isMobile;
  const plotLeft = FC_PAD.left;
  const plotW    = cssW - FC_PAD.left - FC_PAD.right;
  // Upper region (height + period) is fixed-height; the divider sits at
  // y=180 and the direction sub-panel occupies the remaining space below.
  const top      = 4;
  const h        = 176;
  const dividerY = 180;
  const subTop   = dividerY + 1;
  const subBot   = cssH;

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  // Night shading + day separators (full canvas height — they extend
  // through the direction sub-panel using the same x-coords).
  _fcDrawNightShading(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawDaySeparators(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawTodayAccent(ctx, common, plotLeft, plotW, 0, cssH);

  const { heights, secHeights, swellDirs, secDirs, wavePeriods, swellMaxY, swellStep, periodMax } = data;
  const ySwell  = (val) => top + h - (Math.min(val, swellMaxY) / swellMaxY) * h;
  const yPeriod = (val) => {
    const v = Math.max(0, Math.min(periodMax, val));
    return top + h - (v / periodMax) * h;
  };
  const xPos = (t) => _fcXFor(t, common, plotLeft, plotW);

  // Clipped panel area
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, top, plotW, h);
  ctx.clip();

  // Secondary area
  if (secHeights.length) {
    ctx.beginPath();
    ctx.moveTo(xPos(common.allTimes[0]), ySwell(0));
    for (let i = 0; i <= common.lastIdx; i++) {
      const v = secHeights[i] != null ? secHeights[i] : 0;
      ctx.lineTo(xPos(common.allTimes[i]), ySwell(v));
    }
    ctx.lineTo(xPos(common.allTimes[common.lastIdx]), ySwell(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(140, 175, 205, 0.6)';
    ctx.fill();
  }

  // Primary area
  ctx.beginPath();
  ctx.moveTo(xPos(common.allTimes[0]), ySwell(0));
  for (let i = 0; i <= common.lastIdx; i++) {
    const v = heights[i] != null ? heights[i] : 0;
    ctx.lineTo(xPos(common.allTimes[i]), ySwell(v));
  }
  ctx.lineTo(xPos(common.allTimes[common.lastIdx]), ySwell(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(74, 110, 145, 0.85)';
  ctx.fill();

  // Primary stroke
  ctx.beginPath();
  ctx.strokeStyle = '#3a5570';
  ctx.lineWidth = 1.5;
  let started = false;
  for (let i = 0; i <= common.lastIdx; i++) {
    const v = heights[i];
    if (v == null) continue;
    const x = xPos(common.allTimes[i]);
    const y = ySwell(v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Period line on the right axis (burnt orange) with a white halo
  // beneath so it stays legible against the dark-blue swell area. Two
  // passes over the same coordinates: 4px white at 0.95 alpha, then
  // 2px solid orange. Direct beginPath avoids any Path2D edge cases.
  const periodPts = [];
  for (let i = 0; i <= common.lastIdx; i++) {
    const p = wavePeriods[i];
    if (p == null || !Number.isFinite(p)) continue;
    periodPts.push([xPos(common.allTimes[i]), yPeriod(p)]);
  }
  if (periodPts.length >= 2) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Halo
    ctx.beginPath();
    ctx.moveTo(periodPts[0][0], periodPts[0][1]);
    for (let i = 1; i < periodPts.length; i++) ctx.lineTo(periodPts[i][0], periodPts[i][1]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Orange line
    ctx.beginPath();
    ctx.moveTo(periodPts[0][0], periodPts[0][1]);
    for (let i = 1; i < periodPts.length; i++) ctx.lineTo(periodPts[i][0], periodPts[i][1]);
    ctx.strokeStyle = '#c46a32';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // Y-axis numeric labels
  const axisFont = isMobile ? '9px' : '10px';
  ctx.font = `${axisFont} "DM Mono", monospace`;
  ctx.fillStyle = '#3a5570';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= swellMaxY; v += swellStep) {
    ctx.fillText(`${v}`, plotLeft - 4, ySwell(v));
  }
  ctx.fillStyle = '#c46a32';
  ctx.textAlign = 'left';
  for (let v = 0; v <= periodMax; v += 5) {
    ctx.fillText(`${v}`, plotLeft + plotW + 4, yPeriod(v));
  }
  // Unit labels in top corners (extra 4px padding off the y-axis numbers).
  ctx.font = `${isMobile ? '8px' : '9px'} "DM Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3a5570';
  ctx.fillText('ft', plotLeft + 6, top + 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#c46a32';
  ctx.fillText('s', plotLeft + plotW - 6, top + 2);

  // ── Divider between upper region and direction sub-panel ──
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, dividerY, cssW, 1);

  // ── Direction sub-panel ──
  // Y-axis is compass degrees the swell is COMING FROM. The visible band
  // is auto-fit to ±120° around the configured swell-window midpoint, so
  // the window band itself + plenty of headroom for adjacent directions
  // is always in view.
  const winMin = CONFIG.chocomount.swellWindowMin;
  const winMax = CONFIG.chocomount.swellWindowMax;
  const winMid = (winMin + winMax) / 2;
  const dirRangeMin = winMid - 120;
  const dirRangeMax = winMid + 120;
  const dirRange    = dirRangeMax - dirRangeMin;
  const subInsetT = subTop + 4;
  const subInsetB = subBot - 4;
  const subInsetH = subInsetB - subInsetT;
  const yDir = (deg) => subInsetT + ((deg - dirRangeMin) / dirRange) * subInsetH;

  // Window band: shaded rectangle covering the swellWindow degrees.
  ctx.fillStyle = 'rgba(110, 169, 107, 0.18)';
  const yWinTop = yDir(winMin);
  const yWinBot = yDir(winMax);
  ctx.fillRect(plotLeft, Math.min(yWinTop, yWinBot), plotW, Math.abs(yWinBot - yWinTop));

  // Helper: draw a polyline through compass-degree values, breaking the
  // line wherever the absolute jump between consecutive samples exceeds
  // 180° (interpreted as a wraparound, not a real direction change).
  const drawDirPolyline = (ctx2, dirs, opts) => {
    const include = opts.include || (() => true);
    ctx2.save();
    ctx2.beginPath();
    ctx2.rect(plotLeft, subTop, plotW, subBot - subTop);
    ctx2.clip();
    if (opts.dash) ctx2.setLineDash(opts.dash);
    ctx2.strokeStyle = opts.color;
    ctx2.lineWidth = opts.lineWidth || 1.5;
    ctx2.lineCap = 'round';
    ctx2.beginPath();
    let prevVal = null;
    let prevOk = false;
    for (let i = 0; i <= common.lastIdx; i++) {
      const v = dirs[i];
      const ok = (v != null) && include(i);
      if (!ok) { prevOk = false; prevVal = null; continue; }
      const x = xPos(common.allTimes[i]);
      const y = yDir(v);
      if (!prevOk) {
        ctx2.moveTo(x, y);
      } else if (Math.abs(v - prevVal) > 180) {
        // Wraparound — start a new sub-segment instead of drawing a long
        // diagonal across the panel.
        ctx2.moveTo(x, y);
      } else {
        ctx2.lineTo(x, y);
      }
      prevVal = v;
      prevOk = true;
    }
    ctx2.stroke();
    ctx2.restore();
  };

  if (swellDirs && swellDirs.length) {
    drawDirPolyline(ctx, swellDirs, { color: '#3a5570', lineWidth: 1.5 });
  }
  if (secDirs && secDirs.length) {
    drawDirPolyline(ctx, secDirs, {
      color: '#8cafcd',
      lineWidth: 1.5,
      dash: [4, 3],
      // Only draw secondary direction where the secondary height is
      // meaningful — leaves natural gaps when there's no real secondary
      // swell to attribute the line to.
      include: (i) => secHeights[i] != null && secHeights[i] >= 1.0
    });
  }

  // Y-axis tick labels (compass abbreviations falling inside the
  // visible direction range).
  const compassPoints = [
    { deg:   0, label: 'N'   }, { deg:  45, label: 'NE'  },
    { deg:  90, label: 'E'   }, { deg: 135, label: 'SE'  },
    { deg: 180, label: 'S'   }, { deg: 225, label: 'SW'  },
    { deg: 270, label: 'W'   }, { deg: 315, label: 'NW'  }
  ];
  ctx.font = `${isMobile ? '8px' : '9px'} "DM Mono", monospace`;
  ctx.fillStyle = '#888';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const cp of compassPoints) {
    if (cp.deg < dirRangeMin || cp.deg > dirRangeMax) continue;
    ctx.fillText(cp.label, plotLeft - 4, yDir(cp.deg));
  }

  // "FROM" label clarifies the y-axis represents the direction the
  // swell is COMING FROM (oceanographic convention).
  ctx.font = `${isMobile ? '7px' : '8px'} "DM Mono", monospace`;
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('FROM', plotLeft + 6, subTop + 3);

  // Scrubber dots — one per data line at the scrubbed hour.
  const sIdx = STATE.scrubberIdx;
  if (typeof sIdx === 'number' && sIdx >= 0 && sIdx <= common.lastIdx) {
    const tx = xPos(common.allTimes[sIdx]);
    // Upper region: secondary height, primary height, period.
    const secH = secHeights[sIdx];
    if (secH != null && secH >= 1.0) {
      drawScrubberDot(ctx, tx, ySwell(secH), '#8cafcd');
    }
    const priH = heights[sIdx];
    if (priH != null) {
      drawScrubberDot(ctx, tx, ySwell(priH), '#3a5570');
    }
    const per = wavePeriods[sIdx];
    if (per != null && Number.isFinite(per)) {
      drawScrubberDot(ctx, tx, yPeriod(per), '#c46a32');
    }
    // Direction sub-panel: primary direction, secondary direction
    // (gated by secondary height ≥ 1ft, matching the line's gating).
    // Clipped so a direction outside the visible y-range is hidden — same
    // treatment the existing direction polylines get.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, subTop, plotW, subBot - subTop);
    ctx.clip();
    const priDir = swellDirs ? swellDirs[sIdx] : null;
    if (priDir != null) {
      drawScrubberDot(ctx, tx, yDir(priDir), '#3a5570');
    }
    const secDir = secDirs ? secDirs[sIdx] : null;
    if (secDir != null && secH != null && secH >= 1.0) {
      drawScrubberDot(ctx, tx, yDir(secDir), '#8cafcd');
    }
    ctx.restore();
  }

  return {
    canvas, cssW, cssH, plotLeft, plotW, top, h,
    swellMaxY, ySwell, yPeriod
  };
}

function drawWindPanel(common, data) {
  const canvas = el('forecast-canvas-wind');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);

  const isMobile = common.isMobile;
  const plotLeft = FC_PAD.left;
  const plotW    = cssW - FC_PAD.left - FC_PAD.right;
  const top      = 4;
  const h        = cssH - 8;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  _fcDrawNightShading(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawDaySeparators(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawTodayAccent(ctx, common, plotLeft, plotW, 0, cssH);

  const { windSpeeds, windDirs, windMaxY } = data;
  const yWind = (val) => top + h - (Math.min(val, windMaxY) / windMaxY) * h;
  const xPos  = (t) => _fcXFor(t, common, plotLeft, plotW);

  // Wind quality colors — offshore (green) / cross-shore (yellow) / onshore (red).
  // Light winds (<5 mph) upgrade one tier so colors don't mislead at calm hours.
  const OFFSHORE_CENTER = 335;
  const colorFor = (dir, speed) => {
    if (dir == null) return 'rgba(150, 145, 138, 0.5)';
    const gap = Math.min(((dir - OFFSHORE_CENTER) % 360 + 360) % 360,
                        ((OFFSHORE_CENTER - dir) % 360 + 360) % 360);
    let bucket;
    if (gap < 60)        bucket = 'off';
    else if (gap < 120)  bucket = 'cross';
    else                 bucket = 'on';
    if (speed != null && speed < 5) {
      if (bucket === 'cross') bucket = 'off';
      else if (bucket === 'on') bucket = 'cross';
    }
    if (bucket === 'off')   return 'rgba(110, 169, 107, 0.6)';
    if (bucket === 'cross') return 'rgba(212, 179, 74, 0.6)';
    return 'rgba(194, 94, 94, 0.6)';
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, top, plotW, h);
  ctx.clip();
  for (let i = 0; i < common.lastIdx; i++) {
    const x1 = xPos(common.allTimes[i]);
    const x2 = xPos(common.allTimes[i + 1]);
    const w1 = windSpeeds[i]     != null ? windSpeeds[i]     : 0;
    const w2 = windSpeeds[i + 1] != null ? windSpeeds[i + 1] : 0;
    ctx.beginPath();
    ctx.moveTo(x1, yWind(0));
    ctx.lineTo(x1, yWind(w1));
    ctx.lineTo(x2, yWind(w2));
    ctx.lineTo(x2, yWind(0));
    ctx.closePath();
    ctx.fillStyle = colorFor(windDirs[i], windSpeeds[i]);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.strokeStyle = '#4a443e';
  ctx.lineWidth = 1.25;
  let wStarted = false;
  for (let i = 0; i <= common.lastIdx; i++) {
    const w = windSpeeds[i];
    if (w == null) continue;
    const x = xPos(common.allTimes[i]);
    const y = yWind(w);
    if (!wStarted) { ctx.moveTo(x, y); wStarted = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Horizontal gridlines at 5 mph intervals. Drawn after the area fill
  // so they read as faint reference lines rather than data.
  ctx.save();
  ctx.strokeStyle = 'rgba(90, 85, 80, 0.12)';
  ctx.lineWidth = 1;
  for (let v = 5; v < windMaxY; v += 5) {
    const yy = yWind(v);
    ctx.beginPath();
    ctx.moveTo(plotLeft, yy);
    ctx.lineTo(plotLeft + plotW, yy);
    ctx.stroke();
  }
  ctx.restore();

  const axisFont = isMobile ? '9px' : '10px';
  ctx.font = `${axisFont} "DM Mono", monospace`;
  ctx.fillStyle = '#5a5550';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= windMaxY; v += 5) {
    ctx.fillText(`${v}`, plotLeft - 4, yWind(v));
  }
  ctx.font = `${isMobile ? '8px' : '9px'} "DM Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('mph', plotLeft + 2, top + 2);

  // Scrubber dot on the wind speed line. Color matches the dark-gray line
  // stroke so the dot stays legible against any quality-shade fill color.
  const sIdx = STATE.scrubberIdx;
  if (typeof sIdx === 'number' && sIdx >= 0 && sIdx <= common.lastIdx) {
    const ws = windSpeeds[sIdx];
    if (ws != null) {
      drawScrubberDot(ctx, xPos(common.allTimes[sIdx]), yWind(ws), '#4a443e');
    }
  }

  return { canvas, cssW, cssH, plotLeft, plotW, top, h, windMaxY };
}

function drawTidePanel(common, data) {
  const canvas = el('forecast-canvas-tide');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);

  const isMobile = common.isMobile;
  const plotLeft = FC_PAD.left;
  const plotW    = cssW - FC_PAD.left - FC_PAD.right;
  const top      = 4;
  const h        = cssH - 8;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  _fcDrawNightShading(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawDaySeparators(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawTodayAccent(ctx, common, plotLeft, plotW, 0, cssH);

  const { tidePred, tideHiLo } = data;
  let tideMin = 0, tideMax = 1, tideY = null;
  if (tidePred && tidePred.length > 1) {
    const vals = tidePred.map(p => parseFloat(p.v)).filter(Number.isFinite);
    tideMin = Math.min(...vals);
    tideMax = Math.max(...vals);
    const tideRange = (tideMax - tideMin) || 1;
    const padInside = 4;
    tideY = (v) => (top + padInside) + (1 - (v - tideMin) / tideRange) * (h - 2 * padInside);

    // Today's portion gets full opacity; days 2-7 fade to 0.7. Subtle
    // "you are here" cue without breaking the curve continuity.
    const todayEnd = new Date(); todayEnd.setHours(24, 0, 0, 0);
    const todayEndX = _fcXFor(todayEnd, common, plotLeft, plotW);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, top, plotW, h);
    ctx.clip();

    const tealStroke = '#3a9aa3';
    const drawSegment = (alpha, xClipMin, xClipMax) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(xClipMin, top, Math.max(0, xClipMax - xClipMin), h);
      ctx.clip();
      ctx.beginPath();
      ctx.strokeStyle = tealStroke;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.5;
      let tStarted = false;
      for (const p of tidePred) {
        const tt = new Date(p.t).getTime();
        if (tt < common.t0 || tt > common.tEnd) continue;
        const v = parseFloat(p.v);
        if (!Number.isFinite(v)) continue;
        const x = _fcXFor(new Date(tt), common, plotLeft, plotW);
        const y = tideY(v);
        if (!tStarted) { ctx.moveTo(x, y); tStarted = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };
    drawSegment(1.0, plotLeft, Math.min(todayEndX, plotLeft + plotW));
    drawSegment(0.7, Math.max(todayEndX, plotLeft), plotLeft + plotW);
    ctx.restore();
  }

  // Low-tide markers + sparse labels (with collision avoidance)
  const nowMs = Date.now();
  if (tideHiLo && tideY) {
    const lowsInWindow = tideHiLo
      .filter(p => p.type === 'L')
      .map(p => ({ t: new Date(p.t).getTime(), v: parseFloat(p.v) }))
      .filter(p => p.t >= common.t0 && p.t <= common.tEnd && Number.isFinite(p.v));
    const lowsAfterNow = lowsInWindow.filter(p => p.t >= nowMs).sort((a, b) => a.t - b.t);
    const labelSet = new Set(lowsAfterNow.slice(0, 2).map(p => p.t));

    // First pass: unlabeled markers.
    for (const lo of lowsInWindow) {
      if (labelSet.has(lo.t)) continue;
      const xx = _fcXFor(new Date(lo.t), common, plotLeft, plotW);
      if (xx < plotLeft || xx > plotLeft + plotW) continue;
      const yy = tideY(lo.v);
      ctx.fillStyle = 'rgba(58, 125, 125, 0.55)';
      ctx.beginPath();
      ctx.moveTo(xx, yy + 1);
      ctx.lineTo(xx - 3, yy - 4);
      ctx.lineTo(xx + 3, yy - 4);
      ctx.closePath();
      ctx.fill();
    }

    // Second pass: labeled lows (the next two after nowMs).
    // Estimate label width once so we can collision-check.
    ctx.font = `${isMobile ? '8px' : '9px'} "DM Mono", monospace`;
    const labelWidth = ctx.measureText('12:00pm').width + 8;
    const labeled = lowsAfterNow.slice(0, 2).map(lo => ({
      ...lo,
      xx: _fcXFor(new Date(lo.t), common, plotLeft, plotW),
      yy: tideY(lo.v)
    }));

    for (let li = 0; li < labeled.length; li++) {
      const lo = labeled[li];
      const xx = lo.xx, yy = lo.yy;
      if (xx < plotLeft || xx > plotLeft + plotW) continue;
      const td = new Date(lo.t);
      const hrs = td.getHours();
      const mins = td.getMinutes();
      const ampm = hrs >= 12 ? 'pm' : 'am';
      const h12 = hrs % 12 || 12;
      const timeStr = mins === 0 ? `${h12}${ampm}` : `${h12}:${String(mins).padStart(2, '0')}${ampm}`;
      const heightStr = `${lo.v.toFixed(1)}ft`;

      // Triangle marker at the trough
      ctx.fillStyle = 'rgba(58, 125, 125, 0.95)';
      ctx.beginPath();
      ctx.moveTo(xx, yy + 2);
      ctx.lineTo(xx - 3, yy - 3);
      ctx.lineTo(xx + 3, yy - 3);
      ctx.closePath();
      ctx.fill();

      // Collision: if the previous labeled low is closer than labelWidth
      // in x, push this one's stack down by ~14px and draw a connector.
      let pushDown = false;
      if (li > 0) {
        const prev = labeled[li - 1];
        if (Math.abs(xx - prev.xx) < labelWidth) pushDown = true;
      }

      ctx.font = `${isMobile ? '8px' : '9px'} "DM Mono", monospace`;
      ctx.fillStyle = '#3a7d7d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const baseTop = yy + 4;
      const lowOff = pushDown ? 14 : 0;
      const stackBelow = (baseTop + lowOff + 9) < (top + h) - 2;
      if (stackBelow) {
        if (pushDown) {
          // Connector: thin teal line from trough up to label baseline.
          ctx.save();
          ctx.strokeStyle = 'rgba(58, 125, 125, 0.7)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(xx, yy + 2);
          ctx.lineTo(xx, baseTop + lowOff - 1);
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillText(timeStr,   xx, baseTop + lowOff);
        ctx.fillText(heightStr, xx, baseTop + lowOff + 9);
      } else {
        ctx.textBaseline = 'bottom';
        const baseBot = yy - 4 - lowOff;
        if (pushDown) {
          ctx.save();
          ctx.strokeStyle = 'rgba(58, 125, 125, 0.7)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(xx, yy - 2);
          ctx.lineTo(xx, baseBot + 1);
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillText(heightStr, xx, baseBot);
        ctx.fillText(timeStr,   xx, baseBot - 9);
      }
    }
  }

  // Scrubber dot on the tide curve. Tide values come from tidePred
  // (non-hourly samples), so interpolate to the scrubbed hour timestamp.
  const sIdx = STATE.scrubberIdx;
  if (typeof sIdx === 'number' && sIdx >= 0 && sIdx <= common.lastIdx
      && tideY && tidePred && tidePred.length > 1) {
    const ts = common.allTimes[sIdx];
    const tMs = ts.getTime();
    let lo = null, hi = null;
    for (let i = 0; i < tidePred.length - 1; i++) {
      const a = new Date(tidePred[i].t).getTime();
      const b = new Date(tidePred[i + 1].t).getTime();
      if (tMs >= a && tMs <= b) { lo = tidePred[i]; hi = tidePred[i + 1]; break; }
    }
    if (lo && hi) {
      const a = new Date(lo.t).getTime();
      const b = new Date(hi.t).getTime();
      const va = parseFloat(lo.v), vb = parseFloat(hi.v);
      if (Number.isFinite(va) && Number.isFinite(vb) && b > a) {
        const v = va + (vb - va) * ((tMs - a) / (b - a));
        const tx = _fcXFor(ts, common, plotLeft, plotW);
        drawScrubberDot(ctx, tx, tideY(v), '#3a9aa3');
      }
    }
  }

  // Dashed "now" vertical, tide canvas only
  if (nowMs >= common.t0 && nowMs <= common.tEnd) {
    const nowX = _fcXFor(new Date(nowMs), common, plotLeft, plotW);
    ctx.save();
    ctx.strokeStyle = 'rgba(44, 40, 37, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(nowX, top);
    ctx.lineTo(nowX, top + h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  return { canvas, cssW, cssH, plotLeft, plotW, top, h, tideMin, tideMax };
}

function drawDayLabels(common) {
  const canvas = el('forecast-canvas-days');
  if (!canvas) return null;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssH = canvas.clientHeight || canvas.parentElement.clientHeight;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, cssW, cssH);

  const isMobile = common.isMobile;
  const plotLeft = FC_PAD.left;
  const plotW    = cssW - FC_PAD.left - FC_PAD.right;
  ctx.clearRect(0, 0, cssW, cssH);

  const todayLocal = new Date(); todayLocal.setHours(0, 0, 0, 0);
  ctx.fillStyle = '#3a352f';
  ctx.font = `600 ${isMobile ? '11px' : '13px'} "DM Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let dayOff = 0; dayOff < common.dayCount; dayOff++) {
    const dayStart = new Date(common.firstDay);
    dayStart.setDate(dayStart.getDate() + dayOff);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const visStart = Math.max(_fcXFor(dayStart, common, plotLeft, plotW), plotLeft);
    const visEnd   = Math.min(_fcXFor(dayEnd,   common, plotLeft, plotW), plotLeft + plotW);
    if (visEnd <= visStart + 8) continue;
    const xx = (visStart + visEnd) / 2;
    const dayDelta = Math.round((dayStart - todayLocal) / 86400000);
    let label;
    if (dayDelta === 0)      label = 'Today';
    else if (dayDelta === 1) label = 'Tomorrow';
    else label = `${dayStart.toLocaleDateString('en-US',{weekday:'short'})} ${dayStart.getMonth()+1}/${dayStart.getDate()}`;
    ctx.fillText(label, xx, cssH / 2);
  }
}

// ── Persistent compass dial (top-right of the swell card) ──
//
// Renders a small ~60x60 dial showing the primary and (when present)
// secondary swell FROM directions for the currently-scrubbed hour.
// Arrow points TOWARD the FROM direction (oceanographic convention),
// not where the swell is heading.
function drawCompassDial(scrubberIdx) {
  const canvas = el('forecast-compass');
  if (!canvas) return;
  const cssW = canvas.clientWidth || 72;
  const cssH = canvas.clientHeight || 72;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, cssW, cssH);
  ctx.clearRect(0, 0, cssW, cssH);

  const cx = cssW / 2, cy = cssH / 2;
  const r = Math.min(cx, cy) - 4;

  // Outline circle.
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Cardinal letters.
  ctx.fillStyle = '#666';
  ctx.font = '600 10px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx,         cy - r + 7);
  ctx.fillText('S', cx,         cy + r - 7);
  ctx.fillText('W', cx - r + 7, cy);
  ctx.fillText('E', cx + r - 7, cy);

  const marine = STATE.forecastData && STATE.forecastData.marine;
  if (!marine || !marine.hourly) return;
  const mh = marine.hourly;
  const idx = (typeof scrubberIdx === 'number' && scrubberIdx >= 0)
    ? scrubberIdx
    : null;
  if (idx == null) return;

  // Arrow points TOWARD the FROM direction. Compass 0° = N (up); canvas
  // 0° = E (right) so subtract 90° to align frames.
  const drawArrow = (deg, fillColor, lengthFactor) => {
    if (deg == null) return;
    const length = r * lengthFactor;
    const angle = (deg - 90) * Math.PI / 180;
    const tipX = cx + length * Math.cos(angle);
    const tipY = cy + length * Math.sin(angle);
    // Base perpendicular to the arrow axis, centered on the dial.
    const baseHalf = 4;
    const perp = angle + Math.PI / 2;
    const baseLX = cx + baseHalf * Math.cos(perp);
    const baseLY = cy + baseHalf * Math.sin(perp);
    const baseRX = cx - baseHalf * Math.cos(perp);
    const baseRY = cy - baseHalf * Math.sin(perp);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseLX, baseLY);
    ctx.lineTo(baseRX, baseRY);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  };

  // Secondary first so primary draws on top.
  const secHt  = mh.secondary_swell_wave_height    ? mh.secondary_swell_wave_height[idx]    : null;
  const secDir = mh.secondary_swell_wave_direction ? mh.secondary_swell_wave_direction[idx] : null;
  if (secDir != null && secHt != null && secHt >= 1.0) {
    drawArrow(secDir, '#8cafcd', 0.6);
  }

  const priDir = mh.swell_wave_direction ? mh.swell_wave_direction[idx] : null;
  if (priDir != null) {
    drawArrow(priDir, '#3a5570', 0.7);
  }
}

function _drawForecastChartFull(marine, wind, daylight, tideHiLo, tidePred) {
  const container = el('forecast-chart-container');
  if (!container) return;
  const W = container.clientWidth;
  const isMobile = W < 600;

  // ── Hourly arrays ──
  const allTimes = marine.hourly.time.map(t => new Date(t));
  const heights      = marine.hourly.swell_wave_height || marine.hourly.wave_height || [];
  const secHeights   = marine.hourly.secondary_swell_wave_height || [];
  const swellDirs    = marine.hourly.swell_wave_direction || [];
  const secDirs      = marine.hourly.secondary_swell_wave_direction || [];
  // Use peak period when the API actually filled it in, otherwise mean
  // period. Some Open-Meteo models return the peak_period key as an
  // array of all nulls — checking length alone hides the line because
  // every sample then fails the `p == null` guard at draw time.
  const peakPeriods  = marine.hourly.swell_wave_peak_period || [];
  const meanPeriods  = marine.hourly.swell_wave_period || marine.hourly.wave_period || [];
  const peakHasData  = peakPeriods.some(v => v != null && Number.isFinite(v));
  const wavePeriods  = peakHasData ? peakPeriods : meanPeriods;
  const windSpeeds   = wind && wind.hourly ? wind.hourly.wind_speed_10m   || [] : [];
  const windDirs     = wind && wind.hourly ? wind.hourly.wind_direction_10m || [] : [];
  const windGusts    = wind && wind.hourly ? wind.hourly.wind_gusts_10m   || [] : [];

  const t0      = allTimes[0].getTime();
  const lastIdx = Math.min(allTimes.length - 1, FORECAST_HOURS);
  const tEnd    = allTimes[lastIdx].getTime();
  const tRange  = tEnd - t0;
  const extStart = 0;
  const extEnd   = lastIdx;
  const firstDay = new Date(t0); firstDay.setHours(0, 0, 0, 0);
  const lastDay  = new Date(tEnd); lastDay.setHours(0, 0, 0, 0);
  const dayCount = Math.max(1, Math.round((lastDay - firstDay) / 86400000) + 1);

  // ── Per-panel scales ──
  // Swell left axis: 0 → max(primary, secondary) × 1.2, rounded up to nearest 2.
  let swellPeak = 0;
  for (let i = extStart; i <= extEnd; i++) {
    if (heights[i]    != null && heights[i]    > swellPeak) swellPeak = heights[i];
    if (secHeights[i] != null && secHeights[i] > swellPeak) swellPeak = secHeights[i];
  }
  let swellMaxY = Math.max(2, Math.ceil(swellPeak * 1.2 / 2) * 2);
  const swellStep = swellMaxY <= 4 ? 1 : (swellMaxY <= 10 ? 2 : 4);
  // Period right axis: fixed 0–25s.
  const periodMax = 25;
  // Wind axis: 0 → max(speed) × 1.2, rounded to nearest 5, floor 10.
  let windPeak = 0;
  for (let i = extStart; i <= extEnd; i++) {
    if (windSpeeds[i] != null && windSpeeds[i] > windPeak) windPeak = windSpeeds[i];
  }
  // Fixed 0–25 mph axis. Hours that exceed 25 mph clip at the ceiling
  // — communicates "wind is howling" without rescaling the whole panel
  // around a single storm hour.
  const windMaxY = 25;

  // Common payload passed to each panel drawer.
  const common = {
    t0, tEnd, tRange, allTimes,
    lastIdx,
    firstDay, dayCount,
    daylight,
    pinLat: STATE.pinLat || CONFIG.chocomount.lat,
    pinLon: STATE.pinLon || CONFIG.chocomount.lon,
    isMobile
  };

  // Draw each panel canvas.
  const swellPayload = { heights, secHeights, swellDirs, secDirs, wavePeriods, swellMaxY, swellStep, periodMax };
  const windPayload  = { windSpeeds, windDirs, windMaxY };
  const tidePayload  = { tidePred, tideHiLo };
  const swellInfo = drawSwellPanel(common, swellPayload);
  drawWindPanel(common, windPayload);
  const tideInfo = drawTidePanel(common, tidePayload);
  drawDayLabels(common);

  // Cache so the scrubber can re-render dots without recomputing axes.
  STATE._forecastPanelPayloads = { common, swellPayload, windPayload, tidePayload };

  // Container-relative geometry for the scrubber crosshair / handle.
  const swellCanvas = el('forecast-canvas-swell');
  const tideCanvas  = el('forecast-canvas-tide');
  const swellCard   = swellCanvas ? swellCanvas.parentElement : null;
  const tideCard    = tideCanvas ? tideCanvas.parentElement : null;

  const offsetTopWithin = (node, ancestor) => {
    let y = 0, n = node;
    while (n && n !== ancestor) { y += n.offsetTop; n = n.offsetParent; }
    return y;
  };
  const offsetLeftWithin = (node, ancestor) => {
    let x = 0, n = node;
    while (n && n !== ancestor) { x += n.offsetLeft; n = n.offsetParent; }
    return x;
  };

  // Container-relative plot anchor (uses swell card's canvas as reference;
  // every canvas shares the same FC_PAD so this anchor is canonical).
  const swellCanvasLeft = swellCanvas ? offsetLeftWithin(swellCanvas, container) : 0;
  const plotLeft = swellCanvasLeft + FC_PAD.left;
  const plotW    = swellInfo ? swellInfo.plotW : 0;

  const swellCardTop  = swellCard ? offsetTopWithin(swellCard, container) : 0;
  const tideCardTop   = tideCard  ? offsetTopWithin(tideCard,  container) : 0;
  const tideCardBot   = tideCard  ? tideCardTop + tideCard.offsetHeight : 0;

  // Swell drawing area within the container (for handle Y).
  const swellPanelTop = swellCanvas
    ? offsetTopWithin(swellCanvas, container) + (swellInfo ? swellInfo.top : 0)
    : swellCardTop;
  const swellPanelH = swellInfo ? swellInfo.h : 0;

  // ── Store chart state for interaction ──
  STATE.forecastChart = {
    pad: { left: plotLeft, right: 0, top: swellCardTop, bottom: 0 },
    plotW,
    plotH: swellPanelH,
    W, H: container.clientHeight,
    t0, tEnd, tRange,
    times: allTimes,
    heights, secHeights, wavePeriods, swellDirs, secDirs, windSpeeds, windDirs, windGusts,
    tideHiLo, tidePred, firstDay, dayCount,
    layout: {
      plotLeft, plotW,
      swellTop: swellPanelTop,
      swellH: swellPanelH,
      swellMaxY,
      tideMin: tideInfo ? tideInfo.tideMin : 0,
      tideMax: tideInfo ? tideInfo.tideMax : 1,
      crosshairTop: swellCardTop,
      crosshairBot: tideCardBot
    }
  };
  setupForecastInteraction(container);
}


// ════════════════════════════════════════════════
// FORECAST CHART SCRUBBER
// ════════════════════════════════════════════════
//
// Scrubber state lives at STATE.scrubberIdx (an integer index into the
// hourly arrays of the cached marine forecast). On idle, the scrubber
// resolves to the hour matching Date.now(); the user can click or drag
// to move it. The position persists for the session via
// sessionStorage 'lcc-scrubber-hour' (ISO hour string).

let _forecastInteractionAbort = null;

function findHourIndexForTime(targetMs, cs) {
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < cs.times.length; i++) {
    const tt = cs.times[i].getTime();
    if (tt > cs.tEnd + 30 * 60 * 1000) break;
    const d = Math.abs(tt - targetMs);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

function getScrubberIndex() {
  const cs = STATE.forecastChart;
  if (!cs) return -1;
  if (typeof STATE.scrubberIdx === 'number' && STATE.scrubberIdx >= 0 && STATE.scrubberIdx < cs.times.length) {
    return STATE.scrubberIdx;
  }
  // Restore from sessionStorage if present
  let stored = null;
  try { stored = sessionStorage.getItem('lcc-scrubber-hour'); } catch (_) {}
  if (stored) {
    const targetMs = new Date(stored).getTime();
    if (Number.isFinite(targetMs)) {
      const idx = findHourIndexForTime(targetMs, cs);
      if (idx >= 0) {
        STATE.scrubberIdx = idx;
        return idx;
      }
    }
  }
  // Default: nearest hour to "now"
  const idx = findHourIndexForTime(Date.now(), cs);
  STATE.scrubberIdx = idx;
  return idx;
}

function isScrubberAtNow() {
  const cs = STATE.forecastChart;
  if (!cs) return true;
  const nowIdx = findHourIndexForTime(Date.now(), cs);
  return STATE.scrubberIdx === nowIdx;
}

function applyScrubberToHour(idx) {
  const cs = STATE.forecastChart;
  if (!cs || idx < 0) return;
  const t = cs.times[idx];
  const h = cs.heights[idx];
  const p = cs.wavePeriods[idx];
  const dir = cs.swellDirs[idx];
  const ws = cs.windSpeeds[idx];
  const wd = cs.windDirs[idx];
  const wg = cs.windGusts[idx];

  // ── Floating label below chart ──
  // Field order: time | swell h @ p | swell dir | wind speed (gust) dir | tide level
  const detailBar = el('forecast-detail-bar');
  if (detailBar) {
    const dayName = t.toLocaleDateString('en-US', { weekday: 'short' });
    const timeStr = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const swellStr = (h != null && p != null)
      ? `${h.toFixed(1)}ft @ ${p.toFixed(1)}s`
      : (h != null ? `${h.toFixed(1)}ft` : '—');
    const swellDirStr = dir != null
      ? `${Math.round(dir)}° ${directionLabel(dir)}`
      : '—';
    let windStr = '—';
    if (ws != null) {
      windStr = `wind ${Math.round(ws)}mph`;
      if (wg != null) windStr += ` (gust ${Math.round(wg)})`;
      if (wd != null) windStr += ` ${directionLabel(wd)}`;
    }

    // Tide level interpolated from tidePred at t.
    let tideStr = '';
    if (cs.tidePred && cs.tidePred.length) {
      const tMs = t.getTime();
      let lo = null, hi = null;
      for (let i = 0; i < cs.tidePred.length - 1; i++) {
        const a = new Date(cs.tidePred[i].t).getTime();
        const b = new Date(cs.tidePred[i + 1].t).getTime();
        if (tMs >= a && tMs <= b) { lo = cs.tidePred[i]; hi = cs.tidePred[i + 1]; break; }
      }
      if (lo && hi) {
        const a = new Date(lo.t).getTime();
        const b = new Date(hi.t).getTime();
        const va = parseFloat(lo.v), vb = parseFloat(hi.v);
        if (Number.isFinite(va) && Number.isFinite(vb) && b > a) {
          const v = va + (vb - va) * ((tMs - a) / (b - a));
          tideStr = `tide ${v >= 0 ? '+' : ''}${v.toFixed(1)}ft`;
        }
      }
    }

    // Write only into the inner row so the sibling Reset-to-now button
    // (declared statically in HTML) stays wired up across re-renders.
    const detailRow = el('forecast-detail-row');
    const rowHTML =
      `<span class="detail-time">${dayName} ${timeStr}</span>` +
      `<span class="detail-item"><span class="detail-val">${swellStr}</span></span>` +
      `<span class="detail-item"><span class="detail-val">${swellDirStr}</span></span>` +
      `<span class="detail-item"><span class="detail-val">${windStr}</span></span>` +
      (tideStr ? `<span class="detail-item"><span class="detail-tide">${tideStr}</span></span>` : '');
    if (detailRow) {
      detailRow.innerHTML = rowHTML;
    } else {
      detailBar.innerHTML = `<div class="detail-row">${rowHTML}</div>`;
    }
    detailBar.classList.add('active');
    detailBar.classList.toggle('scrub-active', !isScrubberAtNow());
  }

  // ── Move overlay crosshair ──
  // The handle is now drawn on canvas as one of seven scrubber dots,
  // each tracking its own data line (see drawScrubberDot).
  const container = el('forecast-chart-container');
  if (container) {
    let crosshair = container.querySelector('.forecast-crosshair');
    if (!crosshair) {
      crosshair = document.createElement('div');
      crosshair.className = 'forecast-crosshair';
      container.appendChild(crosshair);
    }
    const L = cs.layout;
    const dataXPx = L.plotLeft + ((t.getTime() - cs.t0) / cs.tRange) * L.plotW;
    // Crosshair spans swell + wind + tide panels + arrow strip.
    crosshair.style.display = '';
    crosshair.style.left = dataXPx + 'px';
    crosshair.style.top = L.crosshairTop + 'px';
    crosshair.style.height = (L.crosshairBot - L.crosshairTop) + 'px';
  }

  // ── Repaint canvas panels so the scrubber dots snap to the new hour. ──
  const pp = STATE._forecastPanelPayloads;
  if (pp) {
    drawSwellPanel(pp.common, pp.swellPayload);
    drawWindPanel(pp.common, pp.windPayload);
    drawTidePanel(pp.common, pp.tidePayload);
  }

  // ── Compass dial in swell card top-right ──
  drawCompassDial(idx);

  // ── Cross-feature: lineup map arrows ──
  if (STATE.isChocomount && STATE.forecastData) {
    const fd = STATE.forecastData;
    drawLineupMap(fd.marine, fd.wind, null, idx);
  }

  // ── Cross-feature: stat grid (with +Xh / -Xh badge) ──
  applyStatGridForHour(idx);

  // ── "Reset to now" link visibility (lives inside the detail bar) ──
  const resetBtn = el('forecast-reset-now');
  if (resetBtn) resetBtn.style.display = isScrubberAtNow() ? 'none' : '';

  // ── Cross-feature: Tab 2 prediction widget tracks the scrubber too. ──
  if (typeof _regNotifyScrubberMoved === 'function') _regNotifyScrubberMoved();
}

function applyStatGridForHour(idx) {
  const cs = STATE.forecastChart;
  if (!cs) return;
  const fd = STATE.forecastData;
  if (!fd || !fd.marine || !fd.marine.hourly) return;
  const t = cs.times[idx];
  const offsetH = Math.round((t.getTime() - Date.now()) / 3600000);
  const isNow = offsetH === 0;
  const badgeText = isNow ? '' : (offsetH > 0 ? `+${offsetH}h` : `${offsetH}h`);

  const setBadge = (cardId, text) => {
    const card = el(cardId);
    if (!card) return;
    let b = card.querySelector('.scrub-badge');
    if (!text) {
      if (b) b.remove();
      return;
    }
    if (!b) {
      b = document.createElement('span');
      b.className = 'scrub-badge';
      const labelEl = card.querySelector('.condition-label');
      if (labelEl) labelEl.appendChild(b);
    }
    b.textContent = text;
  };

  if (isNow) {
    // Restore the cards to their "live" rendering. Re-call the regular
    // updaters from cached data so any scrub overrides clear cleanly.
    const buoy = STATE.selectedBuoy;
    const isChoc = STATE.isChocomount;
    if (fd.marine && fd.wind) {
      // Note: we don't have buoyParsed cached so we pass null for it; this
      // momentarily blanks the swell/wind cards' buoy-derived secondary
      // lines, but the next data refresh restores them. Acceptable trade-off.
      updateSwellCard(STATE._cachedBuoyParsed || null, fd.marine, buoy, null);
      updateWindCard(fd.wind, STATE._cachedBuoyParsed || null, isChoc, STATE.pinLat, STATE.pinLon);
    }
    setBadge('card-swell', '');
    setBadge('card-secondary-swell', '');
    setBadge('card-wind', '');
    setBadge('card-tide', '');
    setBadge('card-temp', '');
    setBadge('card-daylight', '');
    return;
  }

  // Override card values from forecast hourly data at idx.
  const mh = fd.marine.hourly;
  const wh = fd.wind && fd.wind.hourly ? fd.wind.hourly : null;

  // Swell
  const swellHt = mh.swell_wave_height ? mh.swell_wave_height[idx] : null;
  const swellPer = mh.swell_wave_period ? mh.swell_wave_period[idx] : null;
  const swellDir = mh.swell_wave_direction ? mh.swell_wave_direction[idx] : null;
  if (swellHt != null) {
    el('val-swell-height').textContent = `${swellHt.toFixed(1)} ft`;
    el('val-swell-detail').textContent = `${swellPer != null ? swellPer.toFixed(0) + 's' : '—'} ${swellDir != null ? directionLabel(swellDir) : ''}`.trim();
  }
  setBadge('card-swell', badgeText);

  // Secondary swell
  const secHt = mh.secondary_swell_wave_height ? mh.secondary_swell_wave_height[idx] : null;
  const secPer = mh.secondary_swell_wave_period ? mh.secondary_swell_wave_period[idx] : null;
  const secDir = mh.secondary_swell_wave_direction ? mh.secondary_swell_wave_direction[idx] : null;
  if (secHt != null) {
    el('val-sec-swell-height').textContent = `${secHt.toFixed(1)} ft`;
    el('val-sec-swell-detail').textContent = `${secPer != null ? secPer.toFixed(0) + 's' : '—'} ${secDir != null ? directionLabel(secDir) : ''}`.trim();
    setBadge('card-secondary-swell', badgeText);
  }

  // Wind
  if (wh) {
    const ws = wh.wind_speed_10m ? wh.wind_speed_10m[idx] : null;
    const wd = wh.wind_direction_10m ? wh.wind_direction_10m[idx] : null;
    const wg = wh.wind_gusts_10m ? wh.wind_gusts_10m[idx] : null;
    if (ws != null) {
      el('val-wind-speed').textContent = `${Math.round(ws)} mph`;
      const detail = `${wd != null ? directionLabel(wd) : ''}${wg != null ? ' · g ' + Math.round(wg) : ''}`;
      el('val-wind-detail').textContent = detail.trim() || '—';
    }
    setBadge('card-wind', badgeText);
  }

  // Tide / temp / daylight: leave as "now" — the scrubber doesn't change
  // these intuitively (tide is its own panel, temp varies slowly, daylight
  // is per-day). No badge, no override.
}

function setupForecastInteraction(container) {
  if (_forecastInteractionAbort) _forecastInteractionAbort.abort();
  _forecastInteractionAbort = new AbortController();
  const signal = _forecastInteractionAbort.signal;

  // Resolve initial scrubber position and apply it.
  const initialIdx = getScrubberIndex();
  if (initialIdx >= 0) applyScrubberToHour(initialIdx);

  // The scrubber is interactive on each panel canvas. Click X is mapped
  // to a chart-time using the canvas's own bounding rect; FC_PAD.left is
  // identical across all three canvases, so any of them can drive the
  // scrubber and the result is the same hour.
  function indexFromClientXOnCanvas(clientX, canvasEl) {
    const cs = STATE.forecastChart;
    if (!cs || !canvasEl) return -1;
    const rect = canvasEl.getBoundingClientRect();
    const localX = clientX - rect.left;
    const cssW = canvasEl.clientWidth || rect.width;
    const plotW = cssW - FC_PAD.left - FC_PAD.right;
    const tFrac = Math.max(0, Math.min(1, (localX - FC_PAD.left) / plotW));
    const targetT = cs.t0 + tFrac * cs.tRange;
    return findHourIndexForTime(targetT, cs);
  }

  function setScrubberToIdx(idx, persist) {
    const cs = STATE.forecastChart;
    if (!cs || idx < 0) return;
    STATE.scrubberIdx = idx;
    if (persist) {
      try {
        const t = cs.times[idx];
        const iso = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
          '-' + String(t.getDate()).padStart(2, '0') +
          'T' + String(t.getHours()).padStart(2, '0') + ':00';
        sessionStorage.setItem('lcc-scrubber-hour', iso);
      } catch (_) {}
    }
    applyScrubberToHour(idx);
  }

  const canvases = [
    el('forecast-canvas-swell'),
    el('forecast-canvas-wind'),
    el('forecast-canvas-tide')
  ].filter(Boolean);

  let dragging = false;
  let dragSrc = null;

  for (const cv of canvases) {
    cv.addEventListener('mousedown', (e) => {
      dragging = true;
      dragSrc = cv;
      cv.style.cursor = 'ew-resize';
      const idx = indexFromClientXOnCanvas(e.clientX, cv);
      setScrubberToIdx(idx, true);
      e.preventDefault();
    }, { signal });

    cv.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const idx = indexFromClientXOnCanvas(e.clientX, dragSrc || cv);
      setScrubberToIdx(idx, true);
    }, { signal });

    cv.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const idx = indexFromClientXOnCanvas(e.touches[0].clientX, cv);
      setScrubberToIdx(idx, true);
    }, { passive: true, signal });

    cv.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const idx = indexFromClientXOnCanvas(e.touches[0].clientX, cv);
      setScrubberToIdx(idx, true);
    }, { passive: false, signal });
  }

  // Even when the cursor strays off a canvas, dragging should still follow
  // until mouseup. Listen to window-level mousemove for that.
  window.addEventListener('mousemove', (e) => {
    if (!dragging || !dragSrc) return;
    const idx = indexFromClientXOnCanvas(e.clientX, dragSrc);
    setScrubberToIdx(idx, true);
  }, { signal });

  window.addEventListener('mouseup', () => {
    dragging = false;
    if (dragSrc) dragSrc.style.cursor = '';
    dragSrc = null;
  }, { signal });
}

function resetScrubberToNow() {
  const cs = STATE.forecastChart;
  if (!cs) return;
  STATE.scrubberIdx = findHourIndexForTime(Date.now(), cs);
  try { sessionStorage.removeItem('lcc-scrubber-hour'); } catch (_) {}
  applyScrubberToHour(STATE.scrubberIdx);
}

// Wire the "Reset to now" link once. The button is hidden by default
// and revealed by applyScrubberToHour when off-now.
(function wireForecastReset() {
  function attach() {
    const btn = el('forecast-reset-now');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', resetScrubberToNow);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();

function drawArrow(ctx, x, y, dirDeg, size, color, lineW) {
  // dirDeg is "from" direction (meteorological). Arrow points in the "to" direction.
  const rad = degToRad((dirDeg + 180) % 360 - 90);
  const headLen = Math.max(5, size * 0.6);
  const headW = Math.max(4, size * 0.45);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad);
  // Shaft with rounded cap
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW + 0.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.lineTo(size - headLen * 0.5, 0);
  ctx.stroke();
  // Filled arrowhead triangle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(size - headLen, -headW);
  ctx.lineTo(size - headLen, headW);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Filled triangle marker (no shaft) used for the inline daily-peak swell
// arrows. White fill, colored stroke. dirDeg is "from" direction;
// the arrow points where the swell is HEADING (dir + 180).
function drawArrowFilled(ctx, x, y, dirDeg, size, fillColor, strokeColor, lineW) {
  const rad = degToRad((dirDeg + 180) % 360 - 90);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.7);
  ctx.lineTo(-size * 0.4, 0);
  ctx.lineTo(-size * 0.7, size * 0.7);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineW;
  ctx.stroke();
  ctx.restore();
}

// ════════════════════════════════════════════════
// TIDE CHART (Canvas 2D)
// ════════════════════════════════════════════════

function drawTideChart(predictions) {
  const canvas = el('tide-canvas');
  const container = canvas.parentElement;
  const W = container.clientWidth;
  const H = container.clientHeight;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, W, H);

  const pad = { top: 12, right: 16, bottom: 28, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const data = predictions.map(p => ({ t: new Date(p.t), v: parseFloat(p.v) }));
  const minV = Math.min(...data.map(d => d.v));
  const maxV = Math.max(...data.map(d => d.v));
  const range = maxV - minV || 1;
  const padV = range * 0.1;

  const t0 = data[0].t.getTime();
  const tEnd = data[data.length - 1].t.getTime();
  const tRange = tEnd - t0;

  function xPos(t) { return pad.left + ((t.getTime() - t0) / tRange) * plotW; }
  function yPos(v) { return pad.top + plotH - ((v - minV + padV) / (range + 2 * padV)) * plotH; }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#eae6e0';
  ctx.lineWidth = 0.5;
  const gridStep = range > 6 ? 2 : 1;
  for (let v = Math.floor(minV); v <= Math.ceil(maxV); v += gridStep) {
    const yy = yPos(v);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(pad.left + plotW, yy);
    ctx.stroke();
    ctx.fillStyle = '#8a827a';
    ctx.font = '9px "DM Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${v}`, pad.left - 4, yy);
  }

  // Now line
  const nowX = xPos(new Date());
  if (nowX > pad.left && nowX < pad.left + plotW) {
    ctx.strokeStyle = '#d4844c';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(nowX, pad.top);
    ctx.lineTo(nowX, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Tide curve
  ctx.beginPath();
  ctx.strokeStyle = '#5a7fa0';
  ctx.lineWidth = 1.5;
  data.forEach((d, i) => {
    const x = xPos(d.t);
    const y = yPos(d.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill below
  ctx.lineTo(xPos(data[data.length - 1].t), yPos(minV - padV));
  ctx.lineTo(xPos(data[0].t), yPos(minV - padV));
  ctx.closePath();
  ctx.fillStyle = 'rgba(90, 127, 160, 0.08)';
  ctx.fill();

  // X-axis day labels
  ctx.fillStyle = '#8a827a';
  ctx.font = '9px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let dayOff = 0; dayOff < 4; dayOff++) {
    const d = new Date(data[0].t);
    d.setDate(d.getDate() + dayOff);
    d.setHours(12, 0, 0, 0);
    const xx = xPos(d);
    if (xx > pad.left && xx < pad.left + plotW) {
      ctx.fillText(formatDayShort(d), xx, pad.top + plotH + 6);
    }
  }
}

// ════════════════════════════════════════════════
// SPECTRAL SUMMARY TABLE
// ════════════════════════════════════════════════

const COMPASS_TO_DEG = {
  'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
  'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
  'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
  'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
};

// Parse NDBC .spec summary row.
// Columns: YY MM DD hh mm WVHT SwH SwP WWH WWP SwD WWD STEEPNESS APD MWD
// Indices: 0  1  2  3  4  5    6   7   8   9   10  11  12        13  14
// SwD and WWD are text compass (e.g. "SE", "SSE"); MWD is numeric degrees.
function parseSpecSummaryFromText(specText) {
  if (!specText) return null;
  const lines = specText.trim().split('\n');
  if (lines.length < 3) return null;
  const data = lines[2].trim().split(/\s+/);
  if (data.length < 15) return null;
  const sf = (idx, invalid) => {
    const v = parseFloat(data[idx]);
    if (!Number.isFinite(v)) return null;
    return v < (invalid || 99) ? v : null;
  };
  const compass = idx => {
    const t = data[idx];
    return t ? (COMPASS_TO_DEG[t.toUpperCase()] ?? null) : null;
  };
  return {
    hs: sf(5),
    swellHt: sf(6),
    swellPeriod: sf(7),
    windHt: sf(8),
    windPeriod: sf(9),
    swellDir: compass(10),
    windDir: compass(11),
    meanDir: sf(14, 999)
  };
}

// Energy-weighted circular mean of dir1 over bins in the swell band (>=8s).
// Falls back to all positive-energy bins if the swell band is empty.
function computePrimarySwellDir(bins) {
  if (!bins || !bins.length) return null;
  const swell = bins.filter(b => b.period >= 8 && b.energy > 0);
  const pool = swell.length ? swell : bins.filter(b => b.energy > 0);
  if (!pool.length) return null;
  let sx = 0, sy = 0, wsum = 0;
  for (const b of pool) {
    const rad = b.dir1 * Math.PI / 180;
    sx += Math.cos(rad) * b.energy;
    sy += Math.sin(rad) * b.energy;
    wsum += b.energy;
  }
  if (wsum === 0) return null;
  return (Math.atan2(sy / wsum, sx / wsum) * 180 / Math.PI + 360) % 360;
}

function renderSpectralSummary(spectralRaw, buoyParsed) {
  const container = el('spectral-summary-table');
  if (!container) return;
  container.innerHTML = '';

  let summary = null;
  if (spectralRaw && spectralRaw.spec) {
    summary = parseSpecSummaryFromText(spectralRaw.spec);
  }
  if (!summary && spectralRaw && spectralRaw._pipelineSummary) {
    const ps = spectralRaw._pipelineSummary;
    summary = {
      hs: ps.significant_wave_height_m,
      swellHt: ps.swell_height_m,
      swellPeriod: ps.swell_period,
      swellDir: ps.swell_direction,
      windHt: ps.wind_wave_height_m,
      windPeriod: ps.wind_wave_period,
      windDir: ps.wind_wave_direction
    };
  }
  if (!summary) {
    container.innerHTML = '<div class="spectral-empty-msg">Spectral summary unavailable</div>';
    return;
  }

  // Prefer the energy-weighted direction from the bins when available — more
  // precise than the 22.5° compass value in the .spec summary.
  const bins = STATE.lastSpectral && STATE.lastSpectral.bins;
  const derivedDir = computePrimarySwellDir(bins);
  if (derivedDir != null) summary.swellDir = derivedDir;

  const mToFt = v => v != null ? (v * 3.28084).toFixed(1) : '—';
  const fmtP = v => v != null ? v.toFixed(1) : '—';
  const fmtDir = v => v != null ? `${directionLabel(v)} (${Math.round(v)}°)` : '—';

  // Calculate total Hs from buoy data or summary
  let hsFt = '—';
  if (summary.hs != null) hsFt = mToFt(summary.hs);
  else if (buoyParsed && buoyParsed.waveHeight != null) hsFt = buoyParsed.waveHeight.toFixed(1);

  const rows = [
    { label: 'Primary Swell', ht: mToFt(summary.swellHt), period: fmtP(summary.swellPeriod), dir: fmtDir(summary.swellDir) },
    { label: 'Wind Waves', ht: mToFt(summary.windHt), period: fmtP(summary.windPeriod), dir: fmtDir(summary.windDir) },
    { label: 'Significant Hs', ht: hsFt, period: '—', dir: '—' }
  ];

  const table = document.createElement('table');
  table.className = 'spectral-summary-tbl';
  const thead = '<thead><tr><th>Component</th><th>Height (ft)</th><th>Period (s)</th><th>Direction</th></tr></thead>';
  const tbody = rows.map(r =>
    `<tr><td>${r.label}</td><td>${r.ht}</td><td>${r.period}</td><td>${r.dir}</td></tr>`
  ).join('');
  table.innerHTML = thead + '<tbody>' + tbody + '</tbody>';
  container.appendChild(table);
}

// ════════════════════════════════════════════════
// SPECTRAL EMPTY STATE HELPERS
// ════════════════════════════════════════════════

function showSpectralEmpty(buoyId) {
  const compassContainer = el('compass-canvas').parentElement;
  const spectrumContainer = el('spectrum-canvas').parentElement;
  el('compass-canvas').style.display = 'none';
  el('spectrum-canvas').style.display = 'none';
  // Remove old empty messages if present
  compassContainer.querySelectorAll('.spectral-empty-msg').forEach(e => e.remove());
  spectrumContainer.querySelectorAll('.spectral-empty-msg').forEach(e => e.remove());
  const msg = document.createElement('div');
  msg.className = 'spectral-empty-msg';
  msg.textContent = 'Please select a buoy with spectral data (e.g., 44097) to view wave energy.';
  const msg2 = msg.cloneNode(true);
  compassContainer.appendChild(msg);
  spectrumContainer.appendChild(msg2);
  if (buoyId) {
    setFooter('footer-compass', `ndbc ${buoyId} · no spectral data currently available`);
    setFooter('footer-spectrum', `ndbc ${buoyId} · no spectral data currently available`);
  } else {
    setFooter('footer-compass', 'Select a spectral buoy to view data');
    setFooter('footer-spectrum', 'Select a spectral buoy to view data');
  }
}

function showSpectralCharts() {
  el('compass-canvas').style.display = '';
  el('spectrum-canvas').style.display = '';
  const compassContainer = el('compass-canvas').parentElement;
  const spectrumContainer = el('spectrum-canvas').parentElement;
  compassContainer.querySelectorAll('.spectral-empty-msg').forEach(e => e.remove());
  spectrumContainer.querySelectorAll('.spectral-empty-msg').forEach(e => e.remove());
}

// ════════════════════════════════════════════════
// COMPASS ROSE (Canvas 2D)
// ════════════════════════════════════════════════

// Period (s) → [R,G,B] anchor stops. Colors keyed to the app's earth-tone
// palette, re-purposed as a continuous period ramp. Short = wind chop;
// long = long-period groundswell.
const PERIOD_COLOR_STOPS = [
  [2,  [90, 127, 160]],   // #5a7fa0 steel blue
  [7,  [58, 125, 125]],   // #3a7d7d teal
  [11, [58, 125,  86]],   // #3a7d56 sage
  [16, [184, 122, 46]],   // #b87a2e burnt orange
  [22, [138,  58, 46]]    // #8a3a2e deep rust
];

function periodColorRGBA(period, alpha) {
  const stops = PERIOD_COLOR_STOPS;
  if (!(period > 0) || period <= stops[0][0]) {
    const c = stops[0][1];
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }
  if (period >= stops[stops.length - 1][0]) {
    const c = stops[stops.length - 1][1];
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (period >= p0 && period <= p1) {
      const t = (period - p0) / (p1 - p0);
      const rr = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const gg = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const bb = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgba(${rr},${gg},${bb},${alpha})`;
    }
  }
  return `rgba(128,128,128,${alpha})`;
}

function drawCompassRose(spectral, buoyParsed) {
  const canvas = el('compass-canvas');
  const container = canvas.parentElement;
  const size = Math.min(
    container.clientWidth || container.offsetWidth || 260,
    container.clientHeight || container.offsetHeight || 260
  );
  if (size <= 0) return;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, size, size);

  const compact = size < 380;
  const padLabel = compact ? 10 : 14;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - (compact ? 22 : 30);

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Concentric reference rings (geometric scaffolding only; radial axis now
  // encodes wave energy density, so no period labels).
  const guideRings = [0.25, 0.5, 0.75, 1.0];
  guideRings.forEach(frac => {
    ctx.strokeStyle = '#eae6e0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, frac * r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Cardinal labels
  ctx.fillStyle = '#8a827a';
  ctx.font = (compact ? '9px' : '10px') + ' "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - r - padLabel);
  ctx.fillText('S', cx, cy + r + padLabel);
  ctx.fillText('E', cx + r + padLabel + 2, cy);
  ctx.fillText('W', cx - r - padLabel - 2, cy);

  // Swell window (Chocomount only)
  if (STATE.isChocomount) {
    const min = CONFIG.chocomount.swellWindowMin;
    const max = CONFIG.chocomount.swellWindowMax;
    ctx.strokeStyle = '#3a7d56';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    [min, max].forEach(deg => {
      const rad = degToRad(deg - 90);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
      ctx.stroke();
    });
    // Fill the window arc
    ctx.fillStyle = '#3a7d56';
    ctx.globalAlpha = 0.06;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, degToRad(min - 90), degToRad(max - 90));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // Swell window degree labels
    ctx.font = '8px "DM Mono", monospace';
    ctx.fillStyle = '#3a7d56';
    ctx.globalAlpha = 0.6;
    [min, max].forEach(deg => {
      const rad = degToRad(deg - 90);
      const lx = cx + Math.cos(rad) * (r + 8);
      const ly = cy + Math.sin(rad) * (r + 8);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${deg}°`, lx, ly);
    });
    // "swell window" label along the arc midpoint
    const midDeg = (min + max) / 2;
    const midRad = degToRad(midDeg - 90);
    const labelR = r * 0.55;
    ctx.font = '7px "DM Mono", monospace';
    ctx.fillStyle = '#3a7d56';
    ctx.globalAlpha = 0.5;
    ctx.fillText('swell window', cx + Math.cos(midRad) * labelR, cy + Math.sin(midRad) * labelR);
    ctx.globalAlpha = 1;
  }

  // Hopewaves-style directional wave spectrum. One wedge per NDBC
  // frequency bin, centered on that bin's mean direction (dir1). Radial
  // length encodes wave energy density S(f); color encodes period; angular
  // half-width follows the directional-spread parameter r1. All wedges
  // originate at center and overlap at a fixed alpha so distinct swell
  // trains remain visually separable.
  if (spectral && spectral.bins && spectral.bins.length) {
    const rMax = r * 0.95;
    const compressed = STATE.roseScaleMode === 'sqrt';
    const scaleFn = compressed ? Math.sqrt : (v => v);

    const wedges = [];
    let maxScaled = 0;
    for (const b of spectral.bins) {
      if (!(b.energy > 0) || !(b.period > 0) || !Number.isFinite(b.dir1)) continue;
      const scaled = scaleFn(b.energy);
      if (scaled > maxScaled) maxScaled = scaled;
      wedges.push({
        period: b.period,
        dir: ((b.dir1 % 360) + 360) % 360,
        r1: Number.isFinite(b.r1) ? Math.max(0, Math.min(1, b.r1)) : null,
        scaled
      });
    }

    if (maxScaled > 0) {
      // Render largest wedges first so small ones stay visible on top.
      wedges.sort((a, b) => b.scaled - a.scaled);

      const ALPHA = 0.55;
      for (const w of wedges) {
        const rOuter = (w.scaled / maxScaled) * rMax;
        if (rOuter <= 0.5) continue;
        // Angular half-width: σ_θ = sqrt(2·(1 − r1)) radians, converted to
        // degrees and clamped to a legible range. Narrow r1 (tight beam) →
        // thin wedge; diffuse sea → wider.
        const halfDeg = w.r1 == null
          ? 6
          : Math.max(3, Math.min(25, Math.sqrt(2 * (1 - w.r1)) * (180 / Math.PI)));
        const startAngle = degToRad(w.dir - halfDeg - 90);
        const endAngle = degToRad(w.dir + halfDeg - 90);

        ctx.fillStyle = periodColorRGBA(w.period, ALPHA);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rOuter, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Hs value at center
  let hsVal = null;
  if (buoyParsed && buoyParsed.waveHeight != null) {
    hsVal = buoyParsed.waveHeight.toFixed(1);
  } else if (spectral && spectral.bins) {
    // Calculate Hs from spectral bins: Hs = 4 * sqrt(m0), m0 = sum(energy * df)
    let m0 = 0;
    const bins = spectral.bins;
    for (let i = 0; i < bins.length; i++) {
      const df = i < bins.length - 1
        ? Math.abs(bins[i + 1].freq - bins[i].freq)
        : (i > 0 ? Math.abs(bins[i].freq - bins[i - 1].freq) : 0.005);
      m0 += bins[i].energy * df;
    }
    if (m0 > 0) hsVal = (4 * Math.sqrt(m0) * 3.28084).toFixed(1);
  }
  if (hsVal) {
    ctx.font = 'bold 14px "DM Mono", monospace';
    ctx.fillStyle = '#2c2825';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${hsVal} ft`, cx, cy);
    ctx.font = '8px "DM Mono", monospace';
    ctx.fillStyle = '#8a827a';
    ctx.fillText('Hs', cx, cy + 14);
  }
}

// ════════════════════════════════════════════════
// WAVE ENERGY SPECTRUM (Canvas 2D)
// ════════════════════════════════════════════════

function drawSpectrum(spectral) {
  const canvas = el('spectrum-canvas');
  const container = canvas.parentElement;
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (W <= 0 || H <= 0) return;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, W, H);

  const pad = { top: 12, right: 16, bottom: 36, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  if (!spectral || !spectral.bins || spectral.bins.length === 0) return;

  const bins = spectral.bins.filter(b => b.freq > 0.03 && b.freq < 0.5 && b.energy > 0);
  if (bins.length === 0) return;

  const maxE = Math.max(...bins.map(b => b.energy));

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Y-axis grid lines first (behind the fill)
  ctx.fillStyle = '#8a827a';
  ctx.font = '9px "DM Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const eStep = maxE > 10 ? Math.ceil(maxE / 5) : maxE > 1 ? 1 : 0.5;
  for (let e = 0; e <= maxE; e += eStep) {
    const y = pad.top + plotH - (e / maxE) * plotH;
    ctx.fillText(e.toFixed(e < 1 ? 1 : 0), pad.left - 6, y);
    ctx.strokeStyle = '#eae6e0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  }

  // Filled area chart — per-bin vertical strips colored by direction
  const baseline = pad.top + plotH;
  let peakIdx = 0;
  let peakE = 0;
  bins.forEach((bin, i) => {
    if (bin.energy > peakE) { peakE = bin.energy; peakIdx = i; }
    const x0 = pad.left + (i / bins.length) * plotW;
    const x1 = pad.left + ((i + 1) / bins.length) * plotW;
    const h = (bin.energy / maxE) * plotH;
    const y = baseline - h;

    ctx.fillStyle = swellDirColor(bin.dir1);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x0, y, x1 - x0, h);
    ctx.globalAlpha = 1;
  });

  // Smooth line on top of area
  ctx.beginPath();
  ctx.strokeStyle = '#5c554d';
  ctx.lineWidth = 1.5;
  bins.forEach((bin, i) => {
    const x = pad.left + ((i + 0.5) / bins.length) * plotW;
    const y = baseline - (bin.energy / maxE) * plotH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Peak period annotation (vertical dashed line)
  if (peakE > 0) {
    const peakX = pad.left + ((peakIdx + 0.5) / bins.length) * plotW;
    const peakY = baseline - (peakE / maxE) * plotH;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#2c2825';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(peakX, pad.top);
    ctx.lineTo(peakX, baseline);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Peak label
    ctx.font = '8px "DM Mono", monospace';
    ctx.fillStyle = '#2c2825';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const peakPeriod = bins[peakIdx].period;
    ctx.fillText(`${peakPeriod.toFixed(1)}s peak`, peakX, peakY - 4);
  }

  // X-axis: period labels (thin out on narrow screens to avoid overlap)
  ctx.fillStyle = '#8a827a';
  ctx.font = '9px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelPeriods = W < 360
    ? [4, 8, 12, 16, 20]
    : [4, 6, 8, 10, 12, 14, 16, 18, 20];
  labelPeriods.forEach(p => {
    const f = 1 / p;
    const idx = bins.findIndex(b => b.freq >= f);
    if (idx >= 0) {
      const x = pad.left + (idx / bins.length) * plotW;
      ctx.fillText(`${p}s`, x, baseline + 8);
    }
  });

  // X-axis title
  ctx.fillText('period', pad.left + plotW / 2, baseline + 22);

  // Y-axis label (rotated)
  ctx.save();
  ctx.translate(10, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '8px "DM Mono", monospace';
  ctx.fillStyle = '#8a827a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Energy (m\u00B2/Hz)', 0, 0);
  ctx.restore();
}

// ════════════════════════════════════════════════
// CANVAS RESIZE OBSERVER (all four charts)
// ════════════════════════════════════════════════

(function initCanvasResizeObserver() {
  let resizeTimer = null;
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (STATE.lastSpectral) {
        drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed);
        drawSpectrum(STATE.lastSpectral);
      }
      if (STATE.forecastData && STATE.forecastData.marine) {
        // Drop cached CSS dims and inline sizing on the chart canvases
        // so the next draw re-measures from their CSS-driven natural
        // size (rather than reusing dims that pre-date the resize).
        invalidateCanvasDPR(el('forecast-canvas-swell'));
        invalidateCanvasDPR(el('forecast-canvas-wind'));
        invalidateCanvasDPR(el('forecast-canvas-tide'));
        invalidateCanvasDPR(el('forecast-canvas-days'));
        const d = STATE.forecastData;
        drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo, d.tidePred);
      }
      if (STATE._cachedTidePred) {
        drawTideChart(STATE._cachedTidePred);
      }
    }, 250);
  });
  function attach() {
    const cc = el('compass-canvas');
    const sc = el('spectrum-canvas');
    const fcContainer = el('forecast-chart-container');
    const tc = el('tide-canvas');
    if (cc && cc.parentElement) observer.observe(cc.parentElement);
    if (sc && sc.parentElement) observer.observe(sc.parentElement);
    if (fcContainer) observer.observe(fcContainer);
    if (tc && tc.parentElement) observer.observe(tc.parentElement);
    initRoseScaleToggle();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();

function initRoseScaleToggle() {
  try {
    const saved = localStorage.getItem('lcc-rose-scale');
    if (saved === 'linear' || saved === 'sqrt') STATE.roseScaleMode = saved;
  } catch (_) { /* localStorage unavailable */ }

  const chips = document.querySelectorAll('.rose-scale-chip');
  if (!chips.length) return;

  const sync = () => {
    chips.forEach(c => {
      c.classList.toggle('is-active', c.dataset.scale === STATE.roseScaleMode);
    });
  };
  sync();

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const mode = chip.dataset.scale;
      if (mode !== 'linear' && mode !== 'sqrt') return;
      if (STATE.roseScaleMode === mode) return;
      STATE.roseScaleMode = mode;
      try { localStorage.setItem('lcc-rose-scale', mode); } catch (_) {}
      sync();
      if (STATE.lastSpectral) drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed);
    });
  });
}


// ════════════════════════════════════════════════
// Auth UI & toast notifications
// ════════════════════════════════════════════════

function showToast(message, type) {
  var container = el('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.classList.add('toast-fade');
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 450);
  }, 3500);
}

function updateAuthUI(user) {
  var signinBtn = el('auth-signin-btn');
  var signoutBtn = el('auth-signout-btn');
  var userName = el('auth-user-name');
  var authPrompt = el('sl-auth-prompt');
  if (user && !user.isAnonymous) {
    if (signinBtn) signinBtn.style.display = 'none';
    if (signoutBtn) signoutBtn.style.display = '';
    if (userName) {
      userName.textContent = user.displayName || user.email || '';
      userName.style.display = '';
    }
    if (authPrompt) authPrompt.style.display = 'none';
  } else {
    if (signinBtn) signinBtn.style.display = '';
    if (signoutBtn) signoutBtn.style.display = 'none';
    if (userName) userName.style.display = 'none';
  }
  updateStorageNote();
}

async function migrateAnonDataToUser() {
  var entriesToMigrate = STATE.surfLog ? STATE.surfLog.slice() : [];
  if (entriesToMigrate.length > 0) {
    var count = 0;
    for (var i = 0; i < entriesToMigrate.length; i++) {
      try {
        await saveLogEntryToFirebase(entriesToMigrate[i]);
        count++;
      } catch(e) {
        console.warn('Migration failed for entry:', e);
      }
    }
    if (count > 0) {
      showToast(count + ' session' + (count !== 1 ? 's' : '') + ' synced to your account', 'success');
    }
  }
  try {
    await loadLogsFromFirebase();
  } catch(e) {
    console.warn('Post-migration Firebase load failed:', e);
  }
  updateStorageNote();
}

// ════════════════════════════════════════════════
// SURF LOG — Storage
// ════════════════════════════════════════════════

async function loadSurfLog() {
  try {
    // Wait for Firebase auth to settle (avoid querying with anonymous UID)
    if (window._fbAuthReady) {
      await window._fbAuthReady;
    }
    await loadLogsFromFirebase();
  } catch(e) {
    console.warn('Firebase load failed, falling back to localStorage:', e);
    try {
      const raw = localStorage.getItem('lcc_surfLog');
      STATE.surfLog = raw ? JSON.parse(raw) : [];
    } catch (e2) { STATE.surfLog = []; }
  }
  if (typeof updateW1StatusBar === 'function') updateW1StatusBar();
}

function saveSurfLog() {
  try {
    localStorage.setItem('lcc_surfLog', JSON.stringify(STATE.surfLog));
    updateStorageNote();
  } catch (e) { alert('Storage full — try removing photos or exporting.'); }
  if (typeof updateW1StatusBar === 'function') updateW1StatusBar();
}

async function addLogEntry(entry) {
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  entry.userId = window._fbUserId || '';
  entry.displayName = window._fbDisplayName || '';
  STATE.surfLog.unshift(entry);
  saveSurfLog(); slRetrain(); renderSurfLogTable(); updatePersonalMatchToggle();
  try {
    await saveLogEntryToFirebase(entry);
    // Re-save after Firebase upload replaces data-URI photos with Storage URLs
    saveSurfLog();
    renderSurfLogTable();
  } catch(e) {
    console.warn('Firebase save failed (entry saved locally):', e);
    showToast('\u26a0 Saved locally \u2014 sync failed', 'warn');
  }
}

async function updateLogEntry(id, updates) {
  const idx = STATE.surfLog.findIndex(e => e.id === id);
  if (idx < 0) return;
  Object.assign(STATE.surfLog[idx], updates);
  saveSurfLog(); slRetrain(); renderSurfLogTable();
  try {
    await saveLogEntryToFirebase(STATE.surfLog[idx]);
    // Re-save after Firebase upload replaces data-URI photos with Storage URLs
    saveSurfLog();
    renderSurfLogTable();
  } catch(e) {
    console.warn('Firebase save failed (entry saved locally):', e);
    showToast('\u26a0 Saved locally \u2014 sync failed', 'warn');
  }
}

async function deleteLogEntry(id) {
  STATE.surfLog = STATE.surfLog.filter(e => e.id !== id);
  if (window._fbUserId) {
    try { await fbFirestore.collection('surf_logs').doc(id).delete(); } catch(e) { console.warn('Firestore delete failed:', e); }
  }
  saveSurfLog(); slRetrain(); renderSurfLogTable(); updatePersonalMatchToggle();
}

function updateStorageNote() {
  const noteEl = el('sl-storage-note');
  if (!noteEl) return;
  const count = STATE.surfLog.length;
  const synced = window._fbUserIsAnon === false;
  noteEl.textContent = count + ' entries \u00b7 ' + (synced ? '\u2713 Synced to cloud' : '\u26a0 Local only \u2014 sign in to sync');
  noteEl.classList.toggle('note-synced', synced);
  noteEl.classList.toggle('note-local', !synced);
}

// ════════════════════════════════════════════════
// SURF LOG — Firebase persistence helpers
// ════════════════════════════════════════════════

function photoUrl(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (p.url) return p.url;
  if (p._uploadFailed && typeof p._localDataURI === 'string') return p._localDataURI;
  return '';
}

// Walks every entry's photos and re-saves any that still carry _uploadFailed.
// Called once after the surf log finishes loading on page init; saveLogEntry-
// ToFirebase will retry the upload when given a marker that has a stored
// _localDataURI, and silently re-mark on continued failure.
async function retryFailedPhotoUploads() {
  if (!window._fbUserId || window._fbUserIsAnon) return;
  const candidates = (STATE.surfLog || []).filter(function(e) {
    return Array.isArray(e.photos) && e.photos.some(function(p) {
      return p && p._uploadFailed && typeof p._localDataURI === 'string';
    });
  });
  if (candidates.length === 0) return;
  showToast('Retrying ' + candidates.length + ' photo upload(s)…');
  let stillFailing = 0;
  for (const entry of candidates) {
    try {
      await saveLogEntryToFirebase(entry);
    } catch (e) {
      console.warn('Retry save failed:', e);
    }
    const remaining = (entry.photos || []).filter(function(p) { return p && p._uploadFailed; }).length;
    if (remaining > 0) stillFailing++;
  }
  saveSurfLog();
  renderSurfLogTable();
  if (stillFailing === 0) {
    showToast('All photos synced', 'success');
  } else {
    showToast(stillFailing + ' photos still failing — will retry next load', 'warn');
  }
}

async function saveLogEntryToFirebase(entry) {
  if (!window._fbUserId) {
    await new Promise(function(resolve) {
      let attempts = 0;
      const check = setInterval(function() {
        attempts++;
        if (window._fbUserId || attempts > 150) { clearInterval(check); resolve(); }
      }, 100);
    });
  }
  if (!window._fbUserId) {
    throw new Error('Not authenticated — cannot sync to cloud');
  }
  const d = new Date(entry.timestamp);
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const ts = Date.now();
  const processedPhotos = [];
  for (let i = 0; i < (entry.photos || []).length; i++) {
    const p = entry.photos[i];
    if (typeof p === 'object' && p && p.url) {
      processedPhotos.push(p);
    } else if (typeof p === 'object' && p && p._uploadFailed && typeof p._localDataURI === 'string') {
      // Retry a previously-failed upload using the cached data URI.
      try {
        const path = 'surf-photos/raw/' + window._fbUserId + '/' + YYYY + '/' + MM + '/' + ts + '_' + i + '.jpg';
        const ref = fbStorage.ref(path);
        const res = await fetch(p._localDataURI);
        const blob = await res.blob();
        await ref.put(blob, { contentType: 'image/jpeg' });
        const url = await ref.getDownloadURL();
        processedPhotos.push({ url: url, path: path });
      } catch (err) {
        console.warn('Photo upload retry failed:', err);
        // Keep the failure marker so the next attempt can try again.
        processedPhotos.push(p);
      }
    } else if (typeof p === 'string' && p.startsWith('http')) {
      processedPhotos.push({ url: p, path: '' });
    } else if (typeof p === 'string' && p.startsWith('data:')) {
      try {
        const path = 'surf-photos/raw/' + window._fbUserId + '/' + YYYY + '/' + MM + '/' + ts + '_' + i + '.jpg';
        const ref = fbStorage.ref(path);
        const file = _slPhotoFiles && _slPhotoFiles[i] ? _slPhotoFiles[i] : null;
        if (file) {
          await ref.put(file);
        } else {
          const res = await fetch(p);
          const blob = await res.blob();
          await ref.put(blob, { contentType: 'image/jpeg' });
        }
        const url = await ref.getDownloadURL();
        processedPhotos.push({ url: url, path: path });
      } catch (err) {
        console.warn('Photo upload failed:', err);
        showToast('\u26a0 A photo failed to upload — will retry', 'warn');
        // Mark the photo for a later retry instead of dropping it. The local
        // mirror keeps the data URI under _localDataURI; on the next save or
        // page load, retryFailedPhotoUploads picks it up again.
        processedPhotos.push({ url: null, path: null, _uploadFailed: true, _localDataURI: p });
      }
    }
    // Other formats (unknown objects without .url, etc.) are silently dropped
  }
  entry.photos = processedPhotos;
  // Strip the local-only _localDataURI from anything we ship to Firestore — those
  // strings can be hundreds of kilobytes and would push the doc past the 1 MB cap.
  const remotePhotos = processedPhotos.map(function(p) {
    if (p && p._uploadFailed) return { url: null, path: null, _uploadFailed: true };
    return p;
  });
  const payload = {
    id: entry.id,
    userId: window._fbUserId,
    displayName: window._fbDisplayName || '',
    timestamp: entry.timestamp,
    photos: remotePhotos,
    ratings: entry.ratings,
    notes: entry.notes || '',
    conditions: entry.conditions || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (Array.isArray(entry.repairedFields) && entry.repairedFields.length > 0) {
    payload.repairedAt = firebase.firestore.FieldValue.serverTimestamp();
    payload.repairedFields = entry.repairedFields;
  }
  await fbFirestore.collection('surf_logs').doc(entry.id).set(payload);
}

async function loadLogsFromFirebase() {
  if (!window._fbUserId) {
    await new Promise(function(resolve) {
      var attempts = 0;
      var check = setInterval(function() {
        attempts++;
        if (window._fbUserId || attempts > 150) { clearInterval(check); resolve(); }
      }, 100);
    });
  }
  if (!window._fbUserId) throw new Error('Not authenticated');

  // Don't query Firestore with anonymous UID — data is only stored under real user IDs
  if (window._fbUserIsAnon) {
    console.log('loadLogsFromFirebase: skipping — user is anonymous');
    return;
  }

  // Fetch all entries (community log — all authenticated users see all sessions)
  const snap = await fbFirestore.collection('surf_logs')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();
  STATE.surfLog = snap.docs.map(function(doc) {
    const d = doc.data();
    return {
      id: d.id,
      timestamp: d.timestamp,
      photos: (d.photos || []).filter(function(p) { return p && (p.url || typeof p === 'string' || p._uploadFailed); }),
      ratings: d.ratings,
      notes: d.notes || '',
      conditions: d.conditions || null,
      userId: d.userId || '',
      displayName: d.displayName || ''
    };
  });
  saveSurfLog();
  slRetrain(); renderSurfLogTable(); updatePersonalMatchToggle();
}

// ════════════════════════════════════════════════
// SURF LOG — Tab Navigation
// ════════════════════════════════════════════════

function initTabBar() {
  el('tab-btn-forecast')?.addEventListener('click', () => switchTab('forecast'));
  el('tab-btn-regression')?.addEventListener('click', () => switchTab('regression'));
  el('tab-btn-surflog')?.addEventListener('click', () => switchTab('surflog'));
}

function switchTab(tab) {
  STATE.activeTab = tab;
  el('tab-btn-forecast')?.classList.toggle('active', tab === 'forecast');
  el('tab-btn-regression')?.classList.toggle('active', tab === 'regression');
  el('tab-btn-surflog')?.classList.toggle('active', tab === 'surflog');
  const vF = el('view-forecast'), vR = el('view-regression'), vS = el('view-surflog');
  if (vF) vF.style.display = tab === 'forecast' ? '' : 'none';
  if (vR) vR.style.display = tab === 'regression' ? '' : 'none';
  if (vS) vS.style.display = tab === 'surflog' ? '' : 'none';
  // Win95 chrome: update the decorative address bar to mirror the active tab.
  const addr = el('w1-addr-url');
  if (addr) {
    const file = tab === 'regression' ? 'regression.html' : tab === 'surflog' ? 'log.html' : 'index.html';
    addr.textContent = 'http://www.letscheckchoc.com/' + file;
  }
  if (tab === 'regression') {
    renderRegressionTab();
  }
  if (tab === 'surflog') {
    renderSurfLogTable();
    const authPrompt = el('sl-auth-prompt');
    if (authPrompt && window._fbUserIsAnon !== false) {
      authPrompt.style.display = '';
    }
  }
  if (typeof updateW1StatusBar === 'function') updateW1StatusBar();
}

// Win95 status bar: mirrors session count + active buoy. Decorative.
function updateW1StatusBar() {
  const seg1 = document.getElementById('w1-status-1');
  const seg2 = document.getElementById('w1-status-2');
  if (seg1) {
    const n = (STATE.surfLog && STATE.surfLog.length) || 0;
    seg1.textContent = 'Done · ' + n + ' session' + (n === 1 ? '' : 's') + ' loaded';
  }
  if (seg2) {
    if (STATE.selectedBuoy) {
      seg2.textContent = 'Buoy ' + STATE.selectedBuoy.id;
    } else if (STATE.pinLat != null && STATE.pinLon != null) {
      seg2.textContent = 'Pin ' + STATE.pinLat.toFixed(2) + '°N, ' + STATE.pinLon.toFixed(2) + '°W';
    } else {
      seg2.textContent = 'No buoy selected';
    }
  }
}

// Tabs are always visible. Per-tab content gates on STATE.isChocomount instead.
function updateTabBarVisibility() {
  const tabBar = el('tab-bar');
  if (tabBar) tabBar.style.display = '';
  applyChocOnlyVisibility();
}

// Tab 1: lineup map shown only for Choc.
// Tab 2: weights panel + summary shown only for Choc; otherwise empty-state.
// Tab 3: log form shown only for Choc; past sessions stay visible regardless.
function applyChocOnlyVisibility() {
  const isChoc = STATE.isChocomount;
  // Tab 1
  const lineup = el('panel-lineup');
  if (lineup) lineup.style.display = isChoc ? '' : 'none';
  const fcToggleWrap = el('forecast-coord-toggle-wrap');
  if (fcToggleWrap) fcToggleWrap.style.display = isChoc ? '' : 'none';
  // Tab 3
  const slForm = el('panel-surflog-form');
  if (slForm) slForm.style.display = isChoc ? '' : 'none';
  // Tab 2 surfaces refreshed lazily on switchTab; pull current values now too
  // so the rendered tab reflects the latest selection without re-clicking.
  if (STATE.activeTab === 'regression') renderRegressionTab();
}

// ════════════════════════════════════════════════
// SURF LOG — Photo Helpers
// ════════════════════════════════════════════════

let _slPhotos = [];
let _slPhotoFiles = [];

function resizeImageFile(file, maxW, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality || 0.7));
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function renderPhotoGallery() {
  const gallery = el('sl-photo-gallery');
  if (!gallery) return;
  gallery.innerHTML = '';
  _slPhotos.forEach((src, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'sl-photo-thumb';
    const img = document.createElement('img');
    img.src = src; img.alt = 'Photo ' + (i + 1);
    img.onerror = () => { thumb.classList.add('sl-photo-thumb-broken'); img.style.display = 'none'; thumb.textContent = '?'; };
    const rm = document.createElement('button');
    rm.className = 'sl-photo-remove'; rm.textContent = '\u00d7';
    rm.addEventListener('click', () => { _slPhotos.splice(i, 1); _slPhotoFiles.splice(i, 1); renderPhotoGallery(); });
    thumb.append(img, rm);
    gallery.appendChild(thumb);
  });
}

// ════════════════════════════════════════════════
// SURF LOG — Slider Descriptions
// ════════════════════════════════════════════════

function getSizeDesc(val) {
  const v = parseInt(val);
  if (v === 0) return 'Flat';
  if (v === 1) return 'Ankle high';
  if (v === 2) return 'Knee high';
  if (v === 3) return 'Knee to thigh';
  if (v === 4) return 'Waist high';
  if (v === 5) return 'Waist to chest';
  if (v === 6) return 'Chest high';
  if (v === 7) return 'Head high';
  if (v === 8) return 'Overhead';
  if (v === 9) return '1.5x OH';
  return '2X OH';
}

function getWindDesc(val) {
  const v = parseInt(val);
  if (v <= 2) return 'Unmanageable (blown out mess)';
  if (v <= 4) return 'Choppy';
  if (v <= 6) return 'Choppy but enjoyable';
  return 'Glassy to light offshore (clean, perfectly groomed)';
}

function getRideDesc(val) {
  const v = parseInt(val);
  if (v <= 1) return 'Breaking inside out (negative peeling)';
  if (v <= 3) return 'Go straight (mushy shoulder)';
  if (v <= 5) return 'One critical turn possible';
  if (v <= 7) return 'Connecting sections to the beach';
  return 'Reeling perfect lines to the beach';
}

// ════════════════════════════════════════════════
// SURF LOG — NDBC Historical Buoy Data
// ════════════════════════════════════════════════

// Cache parsed NDBC yearly stdmet data so we don't re-download for multiple entries
const _ndbcYearCache = {};

// STOPGAP — proxy-chained fetch of NDBC stdmet historical archive.
//
// Pre-fix state (for the forthcoming Cloud Function migration brief):
//   - URL was: https://www.ndbc.noaa.gov/data/historical/stdmet/{buoy}h{year}.txt.gz
//     (raw binary gzip; decompressed client-side via DecompressionStream).
//   - Proxies: corsproxy.io, api.allorigins.win — both struggled with binary
//     gzip + Content-Encoding handling, producing intermittent failures
//     (e.g. 2021-09-10 always failed with "all proxies failed").
//
// Current state:
//   - URL is now view_text_file.php (NDBC decompresses server-side, returns plain text).
//   - Proxies (in order): corsproxy.io, allorigins, codetabs — see CONFIG.api.ndbcProxies.
//   - Parser format expectations (_parseNDBCHistoricalText):
//       header = line 0 (strip leading '#'), units = line 1 (skipped), data = line 2+
//       columns read: YY/YYYY, MM, DD, hh, mm, WVHT, DPD, MWD, WSPD, WDIR, GST
//       sentinels: WVHT/DPD/WSPD/GST >= 99 → null; MWD/WDIR >= 999 → null
//
// The Cloud Function migration will replace fetchWithProxies entirely with
// a server-side fetch from *.cloudfunctions.net, eliminating CORS, proxy
// rot, HTML-error-page failures, and most network-firewall blocking.
// TODO(cloud-fn): current-year-month observations live at
//   https://www.ndbc.noaa.gov/data/stdmet/{Mon}/{buoy}.txt
// — not the historical archive. Out of scope here; user's logged sessions
// are all historical years.
async function fetchNDBCHistoricalYear(buoyId, year) {
  const cacheKey = buoyId + '-' + year;
  if (_ndbcYearCache[cacheKey]) return _ndbcYearCache[cacheKey];

  const url = 'https://www.ndbc.noaa.gov/view_text_file.php?filename=' + buoyId + 'h' + year + '.txt.gz&dir=data/historical/stdmet/';
  const text = await fetchWithProxies(url, 10000);
  if (!text) throw new Error('NDBC historical fetch failed: all proxies failed');

  const rows = _parseNDBCHistoricalText(text);
  _ndbcYearCache[cacheKey] = rows;
  return rows;
}

function _parseNDBCHistoricalText(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 3) return [];
  const headers = lines[0].replace(/^#/, '').trim().split(/\s+/);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 10) continue;
    const obj = {};
    headers.forEach(function(h, j) { obj[h] = parts[j]; });
    try {
      let yr = parseInt(obj.YY || obj.YYYY || 0);
      if (yr < 100) yr += 2000;
      const t = new Date(Date.UTC(yr, parseInt(obj.MM) - 1, parseInt(obj.DD), parseInt(obj.hh), parseInt(obj.mm || '0')));
      const wvht = parseFloat(obj.WVHT); const dpd = parseFloat(obj.DPD);
      const mwd = parseFloat(obj.MWD);   const wspd = parseFloat(obj.WSPD);
      const wdir = parseFloat(obj.WDIR); const gst = parseFloat(obj.GST);
      rows.push({
        t,
        waveHeight: (isNaN(wvht) || wvht >= 99) ? null : wvht * 3.28084,  // m → ft
        period:     (isNaN(dpd)  || dpd  >= 99) ? null : dpd,
        direction:  (isNaN(mwd)  || mwd  >= 999) ? null : mwd,
        windSpeed:  (isNaN(wspd) || wspd >= 99) ? null : wspd * 2.237,    // m/s → mph
        windDir:    (isNaN(wdir) || wdir >= 999) ? null : wdir,
        windGust:   (isNaN(gst)  || gst  >= 99) ? null : gst  * 2.237
      });
    } catch (_) { /* skip malformed rows */ }
  }
  return rows;
}

function _findNearestNDBCRow(rows, targetMs, requireWave) {
  let best = null, bestDiff = Infinity;
  for (const row of rows) {
    if (requireWave && row.waveHeight === null) continue;
    const diff = Math.abs(row.t.getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = row; }
  }
  return best;
}

// Diagnostic: enumerate which logged sessions can/can't fetch historical conditions.
// Run from DevTools: await window._llcDiagnoseHistoricalFetch()
window._llcDiagnoseHistoricalFetch = async function() {
  const entries = (STATE.surfLog || []).slice();
  const buoyId = CONFIG.chocomount.buoyId;
  const results = [];
  for (const e of entries) {
    const ts = e.timestamp;
    try {
      const year = new Date(ts).getUTCFullYear();
      const rows = await fetchNDBCHistoricalYear(buoyId, year);
      const swell = _findNearestNDBCRow(rows, new Date(ts).getTime(), true);
      results.push({
        id: e.id,
        timestamp: ts,
        ok: !!swell,
        rows: rows.length,
        waveHeightFt: swell ? Math.round(swell.waveHeight * 10) / 10 : null
      });
    } catch (err) {
      results.push({ id: e.id, timestamp: ts, ok: false, error: err.message });
    }
  }
  console.table(results);
  return results;
};

// Diagnostic: regenerate the post-backfill bucket report from the current
// STATE.surfLog. Run after the backfill button completes, then copy the
// printed markdown into INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md.
// Run from DevTools: console.log(window._llcGeneratePostBackfillReport())
window._llcGeneratePostBackfillReport = function() {
  const min = CONFIG.chocomount.swellWindowMin;
  const max = CONFIG.chocomount.swellWindowMax;
  const inWindow = d => (d != null && d >= min && d <= max);

  const entries = (STATE.surfLog || []).slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const rows = [];
  let secIn = 0, bothIn = 0, priIn = 0, bothOut = 0, withSecondary = 0;
  let archiveCount = 0, ndbcCount = 0, ndbcWindCount = 0, otherCount = 0;

  for (const e of entries) {
    const c = e.conditions || {};
    const s = c.swell || {};
    const sec = s.secondary;
    const priInWin = inWindow(s.direction);
    const secInWin = sec && inWindow(sec.direction);
    let bucket;
    if (priInWin && secInWin) { bucket = 'BOTH IN'; bothIn++; }
    else if (!priInWin && secInWin) { bucket = 'SEC IN'; secIn++; }
    else if (priInWin && !secInWin) { bucket = 'PRI IN'; priIn++; }
    else { bucket = 'BOTH OUT'; bothOut++; }
    if (sec && sec.direction != null) withSecondary++;
    if (c.source === 'openmeteo-archive') archiveCount++;
    else if (c.source === 'ndbc-stdmet+openmeteo-wind') ndbcWindCount++;
    else if (c.source === 'ndbc-stdmet') ndbcCount++;
    else otherCount++;

    const r = e.ratings || {};
    const date = new Date(e.timestamp).toISOString().slice(0, 10);
    const priStr = (s.height != null ? s.height + 'ft' : '—') + ' @ '
      + (s.period != null ? s.period + 's' : '—') + ' '
      + (s.direction != null ? s.direction + '° ' + directionLabel(s.direction) : '—');
    const secStr = sec
      ? (sec.height != null ? sec.height + 'ft' : '—') + ' @ '
        + (sec.period != null ? sec.period + 's' : '—') + ' '
        + (sec.direction != null ? sec.direction + '° ' + directionLabel(sec.direction) : '—')
      : '—';
    const wind = c.wind || {};
    const windStr = (wind.speed != null ? wind.speed : '—') + ' mph '
      + (wind.direction != null ? directionLabel(wind.direction) : '');
    const notes = (e.notes || '').replace(/\|/g, '\\|').slice(0, 60);
    rows.push({ bucket, date, priStr, secStr, size: r.size ?? '', wind: windStr, ride: r.rideQuality ?? '', notes, source: c.source || 'unknown' });
  }

  // Sort: SEC IN → BOTH IN → PRI IN → BOTH OUT (matches original report)
  const order = { 'SEC IN': 0, 'BOTH IN': 1, 'PRI IN': 2, 'BOTH OUT': 3 };
  rows.sort((a, b) => order[a.bucket] - order[b.bucket] || a.date.localeCompare(b.date));

  let md = '';
  md += '| Date | Bucket | Primary | Secondary | Size | Wind | Ride | Source | Notes |\n';
  md += '|---|---|---|---|---|---|---|---|---|\n';
  for (const r of rows) {
    md += '| ' + r.date + ' | ' + r.bucket + ' | ' + r.priStr + ' | ' + r.secStr + ' | '
      + r.size + ' | ' + r.wind + ' | ' + r.ride + ' | ' + r.source + ' | ' + r.notes + ' |\n';
  }
  md += '\n## Summary statistics\n\n';
  md += '- **Total sessions analyzed:** ' + entries.length + '\n';
  md += '- **BOTH IN:**  ' + bothIn + '\n';
  md += '- **PRI IN:**   ' + priIn + '\n';
  md += '- **SEC IN:**   ' + secIn + '\n';
  md += '- **BOTH OUT:** ' + bothOut + '\n';
  md += '- **Sessions with secondary-swell data:** ' + withSecondary + ' of ' + entries.length + '\n';
  md += '\n### Source breakdown\n\n';
  md += '- openmeteo-archive:              ' + archiveCount + '\n';
  md += '- ndbc-stdmet + openmeteo-wind:   ' + ndbcWindCount + '\n';
  md += '- ndbc-stdmet:                    ' + ndbcCount + '\n';
  md += '- other / unknown:                ' + otherCount + '\n';
  return md;
};

// NDBC stdmet historical lookup — fallback for Chocomount only when the
// Open-Meteo archive returns no data. Returns conditions data without
// touching the DOM (display rendering is the caller's job). Optional
// `preFetchedTide` lets the caller share a tide response already fetched
// in the archive code path.
async function _fetchNDBCHistoricalConditionsCore(dateStr, preFetchedTide) {
  const sessionMs = new Date(dateStr).getTime();
  const buoyId = CONFIG.chocomount.buoyId;
  const year = new Date(dateStr).getUTCFullYear();

  const [rows, tide] = await Promise.all([
    fetchNDBCHistoricalYear(buoyId, year),
    preFetchedTide !== undefined ? Promise.resolve(preFetchedTide) : fetchHistoricalTide(dateStr)
  ]);

  if (!rows || rows.length === 0) return null;

  // Compute swell travel lag using buoy period observations in the window [T-5h, T-2h]
  const windowStart = sessionMs - 5 * 3600000;
  const windowEnd   = sessionMs - 2 * 3600000;
  const lagPeriods = rows.filter(function(r) {
    return r.t.getTime() >= windowStart && r.t.getTime() <= windowEnd && r.period > 0;
  }).map(function(r) { return r.period; });
  const avgPeriod = lagPeriods.length > 0 ? lagPeriods.reduce(function(s, p) { return s + p; }, 0) / lagPeriods.length : 0;
  const ndbcLagHours = avgPeriod > 0 ? CONFIG.chocomount.buoyDistanceMiles / (SWELL_SPEED_KTS_PER_PERIOD * avgPeriod) : 0;
  const laggedMs = ndbcLagHours > 0 ? sessionMs - ndbcLagHours * 3600000 : sessionMs;

  const swellRow = _findNearestNDBCRow(rows, laggedMs, true);
  const windRow  = _findNearestNDBCRow(rows.filter(function(r) { return r.windSpeed !== null; }), sessionMs, false);

  if (!swellRow) return null;

  const tideInfo = parseTideAtTime(tide, dateStr);
  // If no NDBC row carried wind data near session time, store nulls so the
  // Conditions extractor skips this session instead of treating a fabricated
  // 0 mph / 0° entry as a real datapoint.
  const haveWind = windRow && windRow.windSpeed != null && windRow.windDir != null;
  const wSpd = haveWind ? windRow.windSpeed : null;
  const wDir = haveWind ? windRow.windDir  : null;

  const conditions = {
    swell: {
      height: Math.round((swellRow.waveHeight || 0) * 10) / 10,
      direction: Math.round(swellRow.direction || 0),
      period: Math.round((swellRow.period || 0) * 10) / 10,
      lagHours: Math.round(ndbcLagHours * 10) / 10
    },
    wind: haveWind
      ? { speed: Math.round(wSpd), direction: Math.round(wDir) }
      : { speed: null, direction: null },
    tide: {
      height: Math.round(tideInfo.height * 10) / 10,
      rate: Math.round(tideInfo.rate * 100) / 100,
      stage: tideInfo.stage,
      timeToNearest: tideInfo.timeToNearest
    }
  };

  if (ndbcLagHours > 0) {
    conditions.swellLagHours = Math.round(ndbcLagHours * 10) / 10;
    conditions.originalLoggedTime = dateStr;
    conditions.calculatedFromBuoyTime = new Date(laggedMs).toISOString();
  }

  return conditions;
}

// ════════════════════════════════════════════════
// SURF LOG — Historical Condition Lookup
// ════════════════════════════════════════════════

function fmtDate(d) { return d.toISOString().split('T')[0]; }

function angularDist(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// Wave group velocity approximation: speed (knots) ≈ SWELL_SPEED_KTS_PER_PERIOD × period (seconds)
// This is the standard surf forecaster rule (deep-water group velocity ~1.5 × period).
const SWELL_SPEED_KTS_PER_PERIOD = 1.5;

// Estimate swell travel lag from buoy to Chocomount.
// Algorithm: average primary swell period in the window [T-5h, T-2h] to represent
// the swell arriving at session time T; then lag = distance / (SWELL_SPEED_KTS_PER_PERIOD × avgPeriod).
function getSwellLagHours(marineData, dateStr) {
  if (!marineData?.hourly?.time) return 0;
  const times = marineData.hourly.time;
  const periods = marineData.hourly.swell_wave_period || marineData.hourly.wave_period || [];
  const T = new Date(dateStr).getTime();
  const windowStart = T - 5 * 3600000;
  const windowEnd = T - 2 * 3600000;
  let sum = 0, count = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (t >= windowStart && t <= windowEnd && periods[i] > 0) { sum += periods[i]; count++; }
  }
  const avgPeriod = count > 0 ? sum / count : 0;
  if (avgPeriod <= 0) return 0;
  const speedKts = SWELL_SPEED_KTS_PER_PERIOD * avgPeriod;
  return CONFIG.chocomount.buoyDistanceMiles / speedKts;
}

// Wind history for surf-log scoring. Always uses Open-Meteo's archive
// (reanalysis) endpoint regardless of session age — the forecast endpoint
// returns the FORECAST that was made for past hours, not what actually
// happened, which corrupts the regression's training labels.
async function fetchHistoricalWind(dateStr) {
  const target = new Date(dateStr);
  const dayBefore = new Date(target); dayBefore.setDate(dayBefore.getDate() - 1);
  const p = new URLSearchParams({
    latitude: CHOC_WIND_LAT,
    longitude: CHOC_WIND_LON,
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    start_date: fmtDate(dayBefore),
    end_date: fmtDate(target)
  });
  return fetchJSON(CONFIG.api.openMeteoArchive + '?' + p);
}

// Hourly predictions over a 24h window centered on the session's local date.
// `interval=h` lets us linearly interpolate water level at the exact session
// time and compute a ±30-min central-difference rate. The previous `hilo`
// interval returned only 2-4 extrema per day, which forced cond.tide.height
// to be the next-extremum value rather than the actual water level under the
// wave at session time.
async function fetchHistoricalTide(dateStr) {
  const d = new Date(dateStr);
  const bd = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('');
  const p = new URLSearchParams({ begin_date: bd, range: 24, station: CONFIG.chocomount.tideStation, product: 'predictions', datum: 'MLLW', units: 'english', time_zone: 'lst_ldt', interval: 'h', application: 'letscheckchoc', format: 'json' });
  return fetchJSON(CONFIG.api.coops + '?' + p);
}

function findNearestHour(times, dateStr) {
  const t = new Date(dateStr).getTime();
  let best = 0, bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(new Date(times[i]).getTime() - t);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Normalize a CO-OPS predictions payload (hourly samples) or a raw array
// of {t,v[,type]} into a sorted array of {t: Date, v: number} with `type`
// preserved when present. Accepts either {predictions: [...]} or [...].
function _normalizeTidePredictions(tideData) {
  const raw = Array.isArray(tideData) ? tideData : (tideData?.predictions || []);
  return raw
    .map(p => ({ t: new Date(p.t), v: parseFloat(p.v), type: p.type }))
    .filter(p => !isNaN(p.t.getTime()) && !isNaN(p.v))
    .sort((a, b) => a.t - b.t);
}

// Linear interpolation of water level at sessionDateTime, given a
// time-sorted array of {t,v} samples. Returns null if the session falls
// entirely outside the sample range and only one side has data.
function tideHeightAt(predictions, sessionDateTime) {
  if (!predictions.length) return null;
  const ts = sessionDateTime.getTime();
  let before = null, after = null;
  for (const p of predictions) {
    if (p.t.getTime() <= ts) before = p;
    else { after = p; break; }
  }
  if (!before) return after ? after.v : null;
  if (!after) return before.v;
  const span = after.t.getTime() - before.t.getTime();
  if (span <= 0) return before.v;
  const fraction = (ts - before.t.getTime()) / span;
  return before.v + fraction * (after.v - before.v);
}

// Central difference: water level at T+30min minus T-30min. Divisor is
// 1.0 hr so the result is signed ft/hr (positive = rising tide / incoming,
// negative = falling tide / outgoing).
function tideRateAt(predictions, sessionDateTime) {
  const tPlus  = new Date(sessionDateTime.getTime() + 30 * 60 * 1000);
  const tMinus = new Date(sessionDateTime.getTime() - 30 * 60 * 1000);
  const hPlus  = tideHeightAt(predictions, tPlus);
  const hMinus = tideHeightAt(predictions, tMinus);
  if (hPlus == null || hMinus == null) return 0;
  return hPlus - hMinus;
}

// Detect local extrema in a time-sorted samples array. Used to compute
// timeToNearest from hourly samples (sub-classifying as 'H'/'L') when the
// payload doesn't carry an explicit `type` field.
function _detectTideExtrema(predictions) {
  const out = [];
  for (let i = 1; i < predictions.length - 1; i++) {
    const a = predictions[i-1].v, b = predictions[i].v, c = predictions[i+1].v;
    if (b > a && b > c) out.push({ t: predictions[i].t, v: b, type: 'H' });
    else if (b < a && b < c) out.push({ t: predictions[i].t, v: b, type: 'L' });
  }
  return out;
}

// Hours to nearest hi/lo extremum (signed magnitude, rounded to 0.1h).
// Prefers explicit `type`-tagged samples (CO-OPS hilo product) when
// present; otherwise scans for local extrema in the hourly series.
function _timeToNearestExtremum(predictions, sessionDateTime) {
  const tagged = predictions.filter(p => p.type === 'H' || p.type === 'L');
  const extrema = tagged.length ? tagged : _detectTideExtrema(predictions);
  if (!extrema.length) return 0;
  const ts = sessionDateTime.getTime();
  let best = Infinity;
  for (const e of extrema) {
    const d = Math.abs(e.t.getTime() - ts);
    if (d < best) best = d;
  }
  return Math.round(best / 3600000 * 10) / 10;
}

// Stage: |rate| < 0.1 ft/hr is slack (sub-classified by absolute height
// percentile across the day), otherwise rising / falling per sign.
function _tideStageFromRate(rate, height, predictions) {
  if (Math.abs(rate) < 0.1) {
    const heights = predictions.map(p => p.v);
    if (!heights.length) return 'slack-low';
    const min = Math.min(...heights), max = Math.max(...heights);
    const mid = (min + max) / 2;
    return height >= mid ? 'slack-high' : 'slack-low';
  }
  return rate > 0 ? 'rising' : 'falling';
}

// Returns { height, rate, stage, timeToNearest } at session time.
//
// `height` is the linear-interpolated water level at sessionDateTime
// (NOT the next hi/lo value, as the previous hilo-only implementation
// returned). `rate` is the signed central-difference water-level slope
// in ft/hr. `stage` is derived from `rate` ('rising' / 'falling' /
// 'slack-high' / 'slack-low'). `timeToNearest` is hours to the nearest
// hi/lo extremum, kept for UI display.
function parseTideAtTime(tideData, dateStr) {
  const preds = _normalizeTidePredictions(tideData);
  if (!preds.length) return { height: 0, rate: 0, stage: 'rising', timeToNearest: 0 };
  const sessionTime = new Date(dateStr);
  const heightRaw = tideHeightAt(preds, sessionTime);
  const height = heightRaw == null ? 0 : heightRaw;
  const rate = tideRateAt(preds, sessionTime);
  const stage = _tideStageFromRate(rate, height, preds);
  const timeToNearest = _timeToNearestExtremum(preds, sessionTime);
  return { height, rate, stage, timeToNearest };
}

// Estimate swell travel lag from buoy to Chocomount.
// Looks at swell periods 2-5 hours before session, computes average group velocity travel time.
function estimateSwellLag(marine, sessionDateStr) {
  if (!marine?.hourly) return 0;
  const sessionT = new Date(sessionDateStr).getTime();
  const t5h = sessionT - 5 * 3600000;
  const t2h = sessionT - 2 * 3600000;
  const times = marine.hourly.time || [];
  const periods = marine.hourly.swell_wave_period || marine.hourly.wave_period || [];
  let sumPeriod = 0, count = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (t >= t5h && t <= t2h && periods[i] > 0) { sumPeriod += periods[i]; count++; }
  }
  if (count === 0) return 0;
  const avgPeriod = sumPeriod / count;
  const arrival = swellArrivalTime(avgPeriod, CONFIG.chocomount.buoyDistanceMiles);
  return arrival ? arrival.minutes : 0;
}

// Open-Meteo marine archive (reanalysis) lookup — primary historical-
// conditions source for ALL session ages. Reanalysis is grid-model output
// rerun after the fact, incorporating actual observations including buoy
// readings; it's much closer to ground truth than the forecast endpoint,
// which returns what the model *predicted* for past hours. Coverage starts
// ~2016 for marine variables.
//
// IMPORTANT: this MUST hit the marine archive endpoint
// (`marine-api.open-meteo.com/v1/marine`), not the atmospheric archive
// (`archive-api.open-meteo.com/v1/archive`). The atmospheric endpoint
// silently returns null arrays for secondary_swell_* / wind_wave_* — see
// INVESTIGATION_BACKFILL_REGRESSIONS.md.
//
// Returns a swell-only object: { swell: {...}, _laggedDateStr, _lagHours }
// or null if the archive has no data for the requested date. Wind and tide
// remain on their existing sources; only swell is rerouted here.
async function lookupOpenMeteoArchive(lat, lon, dateStr) {
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const dayBefore = new Date(target); dayBefore.setDate(dayBefore.getDate() - 1);
  const startDate = fmtDate(dayBefore);
  const endDate = fmtDate(target);

  const vars = [
    'wave_height','wave_direction','wave_period',
    'swell_wave_height','swell_wave_direction','swell_wave_period',
    'secondary_swell_wave_height','secondary_swell_wave_direction','secondary_swell_wave_period',
    'wind_wave_height','wind_wave_direction','wind_wave_period'
  ].join(',');
  const p = new URLSearchParams({
    latitude: Number(lat).toFixed(4),
    longitude: Number(lon).toFixed(4),
    start_date: startDate,
    end_date: endDate,
    hourly: vars,
    length_unit: 'imperial',
    timezone: 'auto'
  });

  const data = await fetchJSON(CONFIG.api.openMeteoMarineArchive + '?' + p);
  if (!data || !data.hourly || !Array.isArray(data.hourly.time) || data.hourly.time.length === 0) return null;

  // Apply swell-arrival lag (offshore-forecast-point → beach travel time).
  const lagHours = getSwellLagHours(data, dateStr);
  const laggedDateStr = lagHours > 0
    ? new Date(target.getTime() - lagHours * 3600000).toISOString()
    : dateStr;
  const idx = findNearestHour(data.hourly.time, laggedDateStr);
  if (idx == null || idx < 0) return null;

  const swH = data.hourly.swell_wave_height?.[idx];
  if (swH == null) return null;
  const swD = data.hourly.swell_wave_direction?.[idx];
  const swP = data.hourly.swell_wave_period?.[idx];

  const swell = {
    height: Math.round(swH * 10) / 10,
    direction: Math.round(swD || 0),
    period: Math.round((swP || 0) * 10) / 10,
    lagHours
  };

  const secH = data.hourly.secondary_swell_wave_height?.[idx];
  if (secH != null && secH > 0.05) {
    swell.secondary = {
      height: Math.round(secH * 10) / 10,
      direction: Math.round(data.hourly.secondary_swell_wave_direction?.[idx] || 0),
      period: Math.round((data.hourly.secondary_swell_wave_period?.[idx] || 0) * 10) / 10
    };
  }
  const wwH = data.hourly.wind_wave_height?.[idx];
  if (wwH != null && wwH > 0.05) {
    swell.windWave = {
      height: Math.round(wwH * 10) / 10,
      direction: Math.round(data.hourly.wind_wave_direction?.[idx] || 0),
      period: Math.round((data.hourly.wind_wave_period?.[idx] || 0) * 10) / 10
    };
  }
  return { swell, _laggedDateStr: laggedDateStr, _lagHours: lagHours };
}

// Coordinates within ~3 mi of the Chocomount beach point or its offshore
// forecast pair count as Choc — both are valid for the same NDBC buoy 44097.
function isChocomountSpot(lat, lon) {
  if (lat == null || lon == null) return STATE.isChocomount === true;
  const close = (a, b) => Math.abs(a - b) < 0.05;
  if (close(lat, CONFIG.chocomount.lat) && close(lon, CONFIG.chocomount.lon)) return true;
  if (close(lat, CONFIG.chocomount.forecastLat) && close(lon, CONFIG.chocomount.forecastLon)) return true;
  return false;
}

// Archive-first historical lookup. NDBC stdmet is fallback for Chocomount
// only when archive returns no data (e.g., dates pre-2016 archive coverage
// or temporary endpoint failure).
async function lookupHistoricalConditions(lat, lon, dateStr) {
  // Wind and tide come from existing sources regardless of swell source;
  // fetched in parallel to keep latency similar to the old code path.
  const [archiveResult, wind, tide] = await Promise.all([
    lookupOpenMeteoArchive(lat, lon, dateStr).catch(err => {
      console.warn('Open-Meteo archive failed, will try NDBC fallback', err);
      return null;
    }),
    fetchHistoricalWind(dateStr).catch(err => {
      console.warn('Historical wind fetch failed:', err);
      return null;
    }),
    fetchHistoricalTide(dateStr).catch(err => {
      console.warn('Historical tide fetch failed:', err);
      return null;
    })
  ]);

  // Null sentinels when the Open-Meteo Weather wind fetch fails or returns
  // no value at the session hour — downstream extractCondFeatures skips the
  // session rather than train on a fake 0 mph / 0° datapoint.
  const openMeteoWind = _windAtHour(wind, dateStr);

  if (archiveResult && archiveResult.swell && archiveResult.swell.height != null) {
    const tideInfo = parseTideAtTime(tide, dateStr);
    const conditions = {
      swell: archiveResult.swell,
      wind: openMeteoWind || { speed: null, direction: null },
      tide: {
        height: Math.round(tideInfo.height * 10) / 10,
        rate: Math.round(tideInfo.rate * 100) / 100,
        stage: tideInfo.stage,
        timeToNearest: tideInfo.timeToNearest
      },
      source: 'openmeteo-archive'
    };
    if (archiveResult._lagHours > 0) {
      conditions.swellLagHours = Math.round(archiveResult._lagHours * 10) / 10;
      conditions.originalLoggedTime = dateStr;
      conditions.calculatedFromBuoyTime = archiveResult._laggedDateStr;
    }
    return conditions;
  }

  if (isChocomountSpot(lat, lon)) {
    try {
      const ndbc = await _fetchNDBCHistoricalConditionsCore(dateStr, tide);
      if (ndbc && ndbc.swell && ndbc.swell.height != null) {
        // Buoy 44097 has no historical anemometer column, so the NDBC core
        // returns wind={null,null}. Prefer the parallel Open-Meteo Weather
        // value when available — the dual-source label makes the provenance
        // explicit, and the Conditions model can train on it.
        if (openMeteoWind) {
          ndbc.wind = openMeteoWind;
          ndbc.source = 'ndbc-stdmet+openmeteo-wind';
          ndbc.note = 'Open-Meteo marine archive unavailable; NDBC swell + Open-Meteo wind';
        } else {
          ndbc.source = 'ndbc-stdmet';
          ndbc.note = 'Open-Meteo archive unavailable; NDBC measurement used (no secondary swell)';
        }
        return ndbc;
      }
    } catch (err) {
      console.warn('NDBC fallback failed', err);
    }
  }

  return null;
}

// Extract { speed, direction } at the session hour from an Open-Meteo Weather
// hourly response. Returns null when the response is missing or the value at
// the nearest hour is null — callers decide how to represent the absence.
function _windAtHour(wind, dateStr) {
  if (!wind?.hourly?.time) return null;
  const wIdx = findNearestHour(wind.hourly.time, dateStr);
  const s = wind.hourly.wind_speed_10m?.[wIdx];
  const d = wind.hourly.wind_direction_10m?.[wIdx];
  if (s == null || d == null) return null;
  return { speed: Math.round(s), direction: Math.round(d) };
}

// "2.4ft rising at +0.6 ft/hr (2.4h to next)" — falls back gracefully when
// rate is missing (sessions logged before the hourly-interpolation backfill).
function _formatTideReadout(tide) {
  if (!tide) return '—';
  const h = (typeof tide.height === 'number') ? tide.height.toFixed(1) : (tide.height ?? '?');
  const stage = tide.stage || '';
  const ttn = (tide.timeToNearest != null) ? tide.timeToNearest : '?';
  if (typeof tide.rate === 'number') {
    const sign = tide.rate >= 0 ? '+' : '';
    return h + 'ft ' + stage + ' at ' + sign + tide.rate.toFixed(2) + ' ft/hr (' + ttn + 'h to next)';
  }
  return h + 'ft ' + stage + ' (' + ttn + 'h to next)';
}

function renderConditionsDisplay(cond) {
  const display = el('sl-conditions-display');
  if (!display || !cond) return;
  const dl = (l,v) => '<span class="sl-cond-label">'+l+'</span> <span class="sl-cond-val">'+v+'</span>';
  const lagNote = cond.swell.lagHours ? ' ('+cond.swell.lagHours+'h buoy lag)' : '';
  let h = '<div class="sl-cond-row">';
  h += dl('Swell'+lagNote+':', cond.swell.height+'ft '+cond.swell.period+'s '+directionLabel(cond.swell.direction)+' ('+cond.swell.direction+'\u00b0)');
  if (cond.swell.secondary) h += dl('2nd:', cond.swell.secondary.height+'ft '+(cond.swell.secondary.period||'')+'s '+directionLabel(cond.swell.secondary.direction));
  h += '</div><div class="sl-cond-row">';
  const _w = cond.wind || {};
  const _windText = (_w.speed != null && _w.direction != null)
    ? _w.speed + ' mph ' + directionLabel(_w.direction) + ' (' + _w.direction + '\u00b0)'
    : '\u2014';
  h += dl('Wind:', _windText);
  h += dl('Tide:', _formatTideReadout(cond.tide));
  h += '</div>';
  if (cond.swellLagHours > 0) {
    h += `<div class="sl-cond-row"><span class="sl-hint">Using swell from ~${cond.swellLagHours}h ago at buoy (travel time estimate)</span></div>`;
  }
  if (cond.source) {
    let srcLabel;
    if (cond.source === 'openmeteo-archive')              srcLabel = 'Open-Meteo archive (reanalysis)';
    else if (cond.source === 'ndbc-stdmet+openmeteo-wind') srcLabel = 'NDBC buoy 44097 swell + Open-Meteo archive wind';
    else if (cond.source === 'ndbc-stdmet')               srcLabel = 'NDBC buoy 44097 (measured, stdmet historical)';
    else if (cond.source === 'ndbc')                      srcLabel = 'NDBC buoy 44097 (measured)';
    else                                                  srcLabel = 'Open-Meteo marine API';
    h += '<div class="sl-cond-row"><span class="sl-hint">Source: ' + srcLabel + '</span></div>';
    if (cond.note) h += '<div class="sl-cond-row"><span class="sl-hint">' + cond.note + '</span></div>';
  }
  display.innerHTML = h;
}

// ════════════════════════════════════════════════
// SURF LOG — Form Logic
// ════════════════════════════════════════════════

let _slConditions = null;

// Slider description maps
const SIZE_DESCS = { 1:'Ankle', 2:'Flat', 3:'Knee', 4:'Waist', 5:'Waist', 6:'Chest', 7:'Chest', 8:'Head high', 9:'Overhead', 10:'2X Overhead' };
const WIND_DESCS = { 1:'Unmanageable', 2:'Unmanageable', 3:'Choppy', 4:'Choppy', 5:'Choppy but enjoyable', 6:'Choppy but enjoyable', 7:'Glassy / Light Offshore', 8:'Glassy / Light Offshore', 9:'Glassy / Light Offshore', 10:'Glassy / Light Offshore' };
const RIDE_DESCS = { 1:'Breaking inside out', 2:'Go straight', 3:'Go straight', 4:'One critical turn', 5:'One critical turn', 6:'Connecting to beach', 7:'Connecting to beach', 8:'Reeling to beach', 9:'Reeling to beach', 10:'Reeling to beach' };

function updateSliderDesc(sliderId, descId, val) {
  const descEl = el(descId);
  if (!descEl) return;
  const v = parseInt(val);
  if (sliderId.includes('size')) descEl.textContent = SIZE_DESCS[v] || '';
  else if (sliderId.includes('wind')) descEl.textContent = WIND_DESCS[v] || '';
  else if (sliderId.includes('ride')) descEl.textContent = RIDE_DESCS[v] || '';
}

// Save button stays disabled until all three rating sliders have been
// touched. Editing an existing entry pre-touches the sliders.
function _slUpdateSaveEnabled() {
  const btn = document.getElementById('sl-save-btn');
  if (!btn) return;
  const ids = ['sl-size','sl-wind-quality','sl-ride-quality'];
  const allTouched = ids.every(id => {
    const s = document.getElementById(id);
    return s && !s.classList.contains('w1-untouched');
  });
  btn.disabled = !allTouched;
}

function initSurfLogForm() {
  const dtInput = el('sl-datetime');
  if (dtInput) {
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.value = now.toISOString().slice(0, 16);
  }
  // Main form sliders. Each slider starts in the "untouched" state (thumb
  // hidden via CSS, "Tap to rate" placeholder visible) and the Save button
  // stays disabled until all three sliders have been touched at least once.
  // This avoids the (10,10) cluster artifact where unmoved defaults were
  // saved as user ratings.
  [['sl-size','sl-size-val','sl-size-desc','size'],['sl-wind-quality','sl-wind-val','sl-wind-desc','windQuality'],['sl-ride-quality','sl-ride-val','sl-ride-desc','rideQuality']].forEach(([id,vid,did,fieldName]) => {
    const s = el(id);
    const descFn = id === 'sl-size' ? getSizeDesc : id === 'sl-wind-quality' ? getWindDesc : getRideDesc;
    const markTouched = () => {
      const grp = s?.closest('.sl-slider-group');
      if (s) s.classList.remove('w1-untouched');
      if (grp) grp.classList.remove('w1-untouched');
      _slUpdateSaveEnabled();
    };
    s?.addEventListener('input', () => {
      markTouched();
      el(vid).textContent = s.value; if(el(did)) el(did).textContent = descFn(s.value);
      s.closest('.sl-slider-group')?.classList.remove('sl-needs-review');
      if (Array.isArray(STATE.surfLogEditRepairCandidates)) STATE.surfLogEditRepairCandidates = STATE.surfLogEditRepairCandidates.filter(n => n !== fieldName);
    });
    s?.addEventListener('pointerdown', markTouched);
    s?.addEventListener('keydown', markTouched);
    if (s && el(did)) el(did).textContent = descFn(s.value);
  });
  _slUpdateSaveEnabled();
  el('sl-add-url')?.addEventListener('click', () => {
    const input = el('sl-photo-url'), url = (input.value||'').trim();
    if (url) { _slPhotos.push(url); _slPhotoFiles.push(null); input.value = ''; renderPhotoGallery(); }
  });
  el('sl-photo-file')?.addEventListener('change', async e => {
    for (const f of Array.from(e.target.files)) {
      const uri = await resizeImageFile(f, 800, 0.7);
      if (uri) { _slPhotos.push(uri); _slPhotoFiles.push(f); }
    }
    e.target.value = ''; renderPhotoGallery();
  });
  el('sl-lookup-btn')?.addEventListener('click', async () => {
    const dt = el('sl-datetime')?.value;
    if (!dt) { alert('Set a date first.'); return; }
    const btn = el('sl-lookup-btn'); btn.disabled = true; btn.textContent = 'Looking up...';
    const display = el('sl-conditions-display');
    if (display) display.innerHTML = '<span class="sl-hint">Looking up conditions from Open-Meteo archive…</span>';
    const lat = CONFIG.chocomount.forecastLat;
    const lon = CONFIG.chocomount.forecastLon;
    _slConditions = await lookupHistoricalConditions(lat, lon, dt);
    btn.disabled = false; btn.textContent = 'Lookup Historical Conditions';
    if (_slConditions) {
      renderConditionsDisplay(_slConditions);
      const condDisplay = el('sl-conditions-display');
      const condWrapper = condDisplay ? condDisplay.parentElement : null;
      if (condWrapper) {
        condWrapper.classList.remove('sl-needs-review');
        const oldWarn = condWrapper.querySelector('.sl-conditions-warning');
        if (oldWarn) oldWarn.remove();
      }
      if (Array.isArray(STATE.surfLogEditRepairCandidates)) STATE.surfLogEditRepairCandidates = STATE.surfLogEditRepairCandidates.filter(n => n !== 'swell');
    } else {
      if (display) display.innerHTML = '<span class="sl-hint">Lookup failed. You can enter conditions manually.</span>';
    }
  });
  el('sl-save-btn')?.addEventListener('click', async () => {
    // Defensive: re-check the touched-state guard. The :disabled attribute
    // should already prevent clicks, but a stale handler call shouldn't sneak
    // through.
    const ratingIds = ['sl-size','sl-wind-quality','sl-ride-quality'];
    if (ratingIds.some(id => el(id)?.classList.contains('w1-untouched'))) {
      showToast('Set Size, Wind, and Ride before saving.', 'warn');
      return;
    }
    const repairCandidates = Array.isArray(STATE.surfLogEditRepairCandidates) ? STATE.surfLogEditRepairCandidates : [];
    const formPanel = el('panel-surflog-form');
    const flaggedCount = formPanel ? formPanel.querySelectorAll('.sl-needs-review').length : 0;
    if (repairCandidates.length > 0 || flaggedCount > 0) {
      showToast('Fill in the highlighted fields before updating.', 'warn');
      return;
    }
    const dt = el('sl-datetime')?.value;
    if (!dt) { alert('Set a date and time.'); return; }
    const entry = {
      timestamp: dt, photos: [..._slPhotos],
      ratings: { size: parseInt(el('sl-size')?.value||'5'), windQuality: parseInt(el('sl-wind-quality')?.value||'5'), rideQuality: parseInt(el('sl-ride-quality')?.value||'5') },
      notes: el('sl-notes')?.value || '', conditions: _slConditions || null
    };
    const originalRepairFields = Array.isArray(STATE.surfLogEditOriginalRepairFields) ? STATE.surfLogEditOriginalRepairFields : [];
    if (STATE.surfLogEditId && originalRepairFields.length > 0) {
      entry.repairedFields = originalRepairFields.slice();
    }
    try {
      if (STATE.surfLogEditId) {
        await updateLogEntry(STATE.surfLogEditId, entry);
        STATE.surfLogEditId = null;
        el('sl-cancel-edit-btn').style.display = 'none';
        el('sl-save-btn').textContent = 'Save Entry';
      } else { await addLogEntry(entry); }
      STATE.surfLogEditRepairCandidates = [];
      STATE.surfLogEditOriginalRepairFields = [];
      resetSurfLogForm();
      showToast('✓ Session saved!', 'success');
    } catch(e) {
      console.error('Save entry failed:', e);
      alert('Entry saved locally but cloud sync failed. It will sync when connection is restored.');
    }
  });
  el('sl-cancel-edit-btn')?.addEventListener('click', () => {
    STATE.surfLogEditId = null; el('sl-cancel-edit-btn').style.display = 'none';
    el('sl-save-btn').textContent = 'Save Entry'; resetSurfLogForm();
  });
  el('sl-export-json')?.addEventListener('click', exportJSON);
  el('sl-export-csv')?.addEventListener('click', exportCSV);
  el('sl-import-json-btn')?.addEventListener('click', () => el('sl-import-json')?.click());
  el('sl-import-json')?.addEventListener('change', importJSON);
  el('sl-backfill-archive-btn')?.addEventListener('click', backfillAllSessionsFromArchive);
  ['sl-filter-from','sl-filter-to','sl-filter-rating'].forEach(id => {
    el(id)?.addEventListener('change', () => renderSurfLogTable());
  });
}

function resetSurfLogForm() {
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  if (el('sl-datetime')) el('sl-datetime').value = now.toISOString().slice(0, 16);
  ['sl-size','sl-wind-quality','sl-ride-quality'].forEach(id => {
    const s = el(id);
    if (s) {
      s.value = 5;
      s.classList.add('w1-untouched');
      s.closest('.sl-slider-group')?.classList.add('w1-untouched');
    }
  });
  ['sl-size-val','sl-wind-val','sl-ride-val'].forEach(id => { if(el(id)) el(id).textContent = '5'; });
  if (el('sl-size-desc')) el('sl-size-desc').textContent = getSizeDesc(5);
  if (el('sl-wind-desc')) el('sl-wind-desc').textContent = getWindDesc(5);
  if (el('sl-ride-desc')) el('sl-ride-desc').textContent = getRideDesc(5);
  if (el('sl-notes')) el('sl-notes').value = '';
  _slUpdateSaveEnabled();
  _slPhotos = []; _slPhotoFiles = []; _slConditions = null; renderPhotoGallery();
  STATE.surfLogEditRepairCandidates = [];
  document.querySelectorAll('#panel-surflog-form .sl-needs-review').forEach(elx => elx.classList.remove('sl-needs-review'));
  const oldWarn = document.querySelector('#panel-surflog-form .sl-conditions-warning');
  if (oldWarn) oldWarn.remove();
  const d = el('sl-conditions-display');
  if (d) d.innerHTML = '<span class="sl-hint">Click "Lookup" to auto-fill from historical data</span>';
  const formEl = el('panel-surflog-form');
  if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editLogEntry(id) {
  const e = STATE.surfLog.find(x => x.id === id);
  if (!e) return;
  STATE.surfLogEditId = id;
  STATE.surfLogEditRepairCandidates = [];
  el('sl-cancel-edit-btn').style.display = '';
  el('sl-save-btn').textContent = 'Update Entry';
  if (el('sl-datetime')) el('sl-datetime').value = e.timestamp;

  const ratings = e.ratings || {};
  const setupRatingSlider = (fieldName, sliderId, valId, descId, descFn) => {
    const slider = el(sliderId);
    if (!slider) return;
    const wrapper = slider.closest('.sl-slider-group');
    const stored = ratings[fieldName];
    const isValid = typeof stored === 'number' && isFinite(stored) && stored >= 0 && stored <= 10;
    if (isValid) {
      slider.value = stored;
      if (el(valId)) el(valId).textContent = stored;
      if (el(descId)) el(descId).textContent = descFn(stored);
      wrapper?.classList.remove('sl-needs-review');
      // Existing valid rating ⇒ slider counts as touched.
      slider.classList.remove('w1-untouched');
      wrapper?.classList.remove('w1-untouched');
    } else {
      const fallback = parseInt(slider.defaultValue, 10);
      slider.value = isFinite(fallback) ? fallback : 5;
      if (el(valId)) el(valId).textContent = slider.value;
      if (el(descId)) el(descId).textContent = '⚠ previously blank — fill in';
      wrapper?.classList.add('sl-needs-review');
      // Stale entries with bad ratings still need user input → keep untouched.
      slider.classList.add('w1-untouched');
      wrapper?.classList.add('w1-untouched');
      STATE.surfLogEditRepairCandidates.push(fieldName);
    }
  };
  setupRatingSlider('size', 'sl-size', 'sl-size-val', 'sl-size-desc', getSizeDesc);
  setupRatingSlider('windQuality', 'sl-wind-quality', 'sl-wind-val', 'sl-wind-desc', getWindDesc);
  setupRatingSlider('rideQuality', 'sl-ride-quality', 'sl-ride-val', 'sl-ride-desc', getRideDesc);
  _slUpdateSaveEnabled();

  if (el('sl-notes')) el('sl-notes').value = e.notes || '';
  _slPhotos = (e.photos||[]).map(p => photoUrl(p) || p).filter(Boolean); _slPhotoFiles = new Array(_slPhotos.length).fill(null); _slConditions = e.conditions || null;
  renderPhotoGallery();

  const condDisplay = el('sl-conditions-display');
  const condWrapper = condDisplay ? condDisplay.parentElement : null;
  if (condWrapper) {
    condWrapper.classList.remove('sl-needs-review');
    const stale = condWrapper.querySelector('.sl-conditions-warning');
    if (stale) stale.remove();
  }
  if (_slConditions) {
    renderConditionsDisplay(_slConditions);
    const sw = _slConditions.swell || {};
    if (sw.height === 0 && sw.period === 0 && condDisplay && condWrapper) {
      condWrapper.classList.add('sl-needs-review');
      const warn = document.createElement('div');
      warn.className = 'sl-conditions-warning';
      warn.textContent = '⚠ swell data looks empty — re-Lookup recommended';
      condDisplay.parentNode.insertBefore(warn, condDisplay);
      STATE.surfLogEditRepairCandidates.push('swell');
    }
  } else if (condDisplay) {
    condDisplay.innerHTML = '<span class="sl-hint">Click "Lookup" to auto-fill from historical data</span>';
  }
  STATE.surfLogEditOriginalRepairFields = STATE.surfLogEditRepairCandidates.slice();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ════════════════════════════════════════════════
// SURF LOG — Export / Import
// ════════════════════════════════════════════════

function exportJSON() {
  const blob = new Blob([JSON.stringify(STATE.surfLog, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'surflog-export.json'; a.click();
}

function exportCSV() {
  const rows = [['id','date','size','windQuality','rideQuality','avg','notes','swellH','swellDir','swellPer','windSpd','windDir','tideH','tideRate','tideStage']];
  STATE.surfLog.forEach(e => {
    const c = e.conditions||{}, s = c.swell||{}, w = c.wind||{}, t = c.tide||{};
    rows.push([e.id,e.timestamp,e.ratings.size,e.ratings.windQuality,e.ratings.rideQuality,
      ((e.ratings.size+e.ratings.windQuality+e.ratings.rideQuality)/3).toFixed(1),
      '"'+(e.notes||'').replace(/"/g,'""')+'"',
      s.height||'',s.direction||'',s.period||'',w.speed||'',w.direction||'',
      t.height||'',(t.rate!=null?t.rate:''),t.stage||'']);
  });
  const blob = new Blob([rows.map(r=>r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'surflog-export.csv'; a.click();
}

function importJSON(ev) {
  const file = ev.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Not an array');
      let imported = 0;
      for (const entry of data) {
        if (!entry.timestamp || !entry.ratings) continue;
        if (!entry.id) entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        if (!STATE.surfLog.find(x => x.id === entry.id)) {
          STATE.surfLog.push(entry);
          await saveLogEntryToFirebase(entry);
          imported++;
        }
      }
      STATE.surfLog.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveSurfLog(); slRetrain(); renderSurfLogTable(); updatePersonalMatchToggle();
      alert('Imported ' + imported + ' entries.');
    } catch (err) { alert('Invalid JSON: ' + err.message); }
  };
  reader.readAsText(file); ev.target.value = '';
}

// ════════════════════════════════════════════════
// SURF LOG — Backfill (re-fetch all sessions from Open-Meteo archive)
// ════════════════════════════════════════════════
//
// Replaces each logged session's `cond.swell` AND `cond.tide` blocks with
// reanalysis data. Subjective ratings (size, wind quality, ride quality),
// notes, and photos are untouched. The wind block is preserved per entry
// (wind source unchanged); the tide block is REWRITTEN because we are
// migrating from the old hilo-extremum lookup (cond.tide.height was the
// next hi/lo value) to the new hourly-interpolated lookup (cond.tide.height
// is the actual water level at session time, and cond.tide.rate is added).
// NDBC stdmet is the fallback when archive returns no data.
async function backfillAllSessionsFromArchive() {
  if (!Array.isArray(STATE.surfLog) || STATE.surfLog.length === 0) {
    alert('No sessions to backfill.');
    return;
  }
  const proceed = confirm(
    'This will re-fetch conditions for all your logged sessions from Open-Meteo archive: ' +
    'swell + wind from the archive reanalysis, plus tide data from CO-OPS using hourly ' +
    'predictions (interpolated water level at session time, with signed ft/hr rate). ' +
    'Sessions where the wind fetch fails will be stored with null wind (skipped by the ' +
    'Conditions model). Your subjective ratings (size, wind quality, ride quality) will ' +
    'not be touched. Proceed?'
  );
  if (!proceed) return;

  const btn = el('sl-backfill-archive-btn');
  const progress = el('sl-backfill-progress');
  const bar = el('sl-backfill-bar-fill');
  const status = el('sl-backfill-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Backfilling…'; }
  if (progress) progress.style.display = '';
  if (bar) bar.style.width = '0%';

  const entries = STATE.surfLog.slice();
  const total = entries.length;
  let processed = 0, archive = 0, ndbcOnly = 0, ndbcWithWind = 0, failed = 0;
  let tideRising = 0, tideFalling = 0, tideSlack = 0;
  const failures = [];

  for (const entry of entries) {
    processed++;
    if (status) status.textContent = 'Processing ' + processed + ' / ' + total + '…';
    if (bar) bar.style.width = ((processed - 1) / total * 100).toFixed(1) + '%';

    try {
      const ts = entry.timestamp;
      // Logged sessions don't carry their own lat/lon — they are at
      // Chocomount by construction. Use the offshore forecast pair that
      // matches the live-forecast query for consistency.
      const lat = CONFIG.chocomount.forecastLat;
      const lon = CONFIG.chocomount.forecastLon;
      const result = await lookupHistoricalConditions(lat, lon, ts);
      if (!result || !result.swell || result.swell.height == null) {
        failed++;
        failures.push({ id: entry.id, ts, reason: 'no swell data returned' });
      } else {
        const oldCond = entry.conditions || {};
        const newCond = Object.assign({}, oldCond, {
          swell: result.swell,
          source: result.source
        });
        if (result.swellLagHours != null) newCond.swellLagHours = result.swellLagHours;
        else delete newCond.swellLagHours;
        if (result.calculatedFromBuoyTime) newCond.calculatedFromBuoyTime = result.calculatedFromBuoyTime;
        else delete newCond.calculatedFromBuoyTime;
        if (result.originalLoggedTime) newCond.originalLoggedTime = result.originalLoggedTime;
        else delete newCond.originalLoggedTime;
        if (result.note) newCond.note = result.note; else delete newCond.note;

        // Wind: ALWAYS overwrite — earlier backfills stored failed fetches
        // as { speed: 0, direction: 0 }, biasing the Conditions model with
        // fake calm-offshore datapoints. Re-running uses the same archive
        // source the live forecast uses; failed fetches now land as
        // { speed: null, direction: null } and the extractor skips them.
        // Tide: ALWAYS overwrite with the freshly-computed block — we are
        // migrating from hilo-nearest-extremum to hourly-interpolated
        // height plus a new signed ft/hr `rate` field, so any tide values
        // already on the entry are stale by definition.
        if (result.wind) newCond.wind = result.wind;
        else if (oldCond.wind) newCond.wind = oldCond.wind;
        if (result.tide) newCond.tide = result.tide;
        else if (oldCond.tide) newCond.tide = oldCond.tide;

        entry.conditions = newCond;
        try {
          await saveLogEntryToFirebase(entry);
        } catch (e) {
          console.warn('Backfill: Firestore save failed for', entry.id, e);
        }

        if (result.source === 'openmeteo-archive') archive++;
        else if (result.source === 'ndbc-stdmet+openmeteo-wind') ndbcWithWind++;
        else if (result.source === 'ndbc-stdmet') ndbcOnly++;

        const r = result.tide?.rate;
        if (typeof r === 'number') {
          if (Math.abs(r) < 0.1) tideSlack++;
          else if (r > 0) tideRising++;
          else tideFalling++;
        }
      }
    } catch (err) {
      failed++;
      failures.push({ id: entry.id, ts: entry.timestamp, reason: (err && err.message) || String(err) });
      console.warn('Backfill failed for', entry.id, err);
    }

    if (processed < total) await new Promise(r => setTimeout(r, 500));
  }

  if (bar) bar.style.width = '100%';
  saveSurfLog();
  if (typeof slRetrain === 'function') slRetrain();
  if (typeof renderSurfLogTable === 'function') renderSurfLogTable();
  if (btn) { btn.disabled = false; btn.textContent = 'Re-fetch all session conditions from Open-Meteo archive'; }

  const tideTotal = tideRising + tideFalling + tideSlack;
  const tideSummary = tideTotal
    ? '\n\nTide rate distribution across ' + tideTotal + ' sessions: ' +
      tideRising + ' positive (rising), ' +
      tideFalling + ' negative (falling), ' +
      tideSlack + ' near-zero (slack).'
    : '';
  const ndbcTotal = ndbcOnly + ndbcWithWind;
  const summary =
    processed + ' sessions processed.\n\n' +
    archive + ' populated with archive data (openmeteo-archive)\n' +
    ndbcWithWind + ' populated with NDBC swell + Open-Meteo wind (ndbc-stdmet+openmeteo-wind)\n' +
    ndbcOnly + ' populated with NDBC fallback, no wind (ndbc-stdmet)\n' +
    failed + ' failed' +
    tideSummary +
    (failures.length
      ? '\n\nFailures:\n' + failures.slice(0, 8).map(f => '• ' + new Date(f.ts).toLocaleDateString() + ' — ' + f.reason).join('\n')
      : '');
  if (status) status.textContent = 'Done. ' + archive + ' archive · ' + ndbcTotal + ' NDBC · ' + failed + ' failed.';
  console.log('Tide rate distribution across ' + tideTotal + ' sessions: ' +
    tideRising + ' positive (rising), ' + tideFalling + ' negative (falling), ' +
    tideSlack + ' near-zero (slack).');
  alert(summary);
}

// ════════════════════════════════════════════════
// SURF LOG — Table Rendering
// ════════════════════════════════════════════════

function ratingBadge(val) {
  const v = typeof val === 'number' ? val : parseFloat(val);
  const cls = v >= 7 ? 'sl-badge-good' : v >= 4 ? 'sl-badge-fair' : 'sl-badge-poor';
  return '<span class="sl-rating-badge '+cls+'">'+v+'</span>';
}

function isLogEntryIncomplete(entry) {
  if (!entry || typeof entry !== 'object') return true;
  const r = entry.ratings;
  if (!r || typeof r !== 'object') return true;
  for (const k of ['size', 'rideQuality', 'windQuality']) {
    const v = r[k];
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 10) return true;
  }
  const c = entry.conditions;
  if (!c || typeof c !== 'object') return true;
  const s = c.swell;
  if (!s) return true;
  if (s.size === 0 && s.period === 0) return true;
  if (s.size > 0 && (s.direction === undefined || s.direction === null || s.direction === 0)) return true;
  return false;
}

function getIncompleteFields(entry) {
  const fields = [];
  if (!entry || typeof entry !== 'object') {
    return ['size', 'rideQuality', 'windQuality', 'conditions', 'swell'];
  }
  const r = entry.ratings;
  const ratingsObj = r && typeof r === 'object' ? r : null;
  for (const k of ['size', 'rideQuality', 'windQuality']) {
    const v = ratingsObj ? ratingsObj[k] : undefined;
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 10) fields.push(k);
  }
  const c = entry.conditions;
  if (!c || typeof c !== 'object') {
    fields.push('conditions');
    fields.push('swell');
    return fields;
  }
  const s = c.swell;
  if (!s) {
    fields.push('swell');
  } else if (s.size === 0 && s.period === 0) {
    fields.push('swell');
  } else if (s.size > 0 && (s.direction === undefined || s.direction === null || s.direction === 0)) {
    fields.push('swell');
  }
  return fields;
}

window._llcIsLogEntryIncomplete = isLogEntryIncomplete;
window._llcGetIncompleteFields = getIncompleteFields;

function renderSurfLogTable() {
  const tbody = el('surflog-tbody'), emptyEl = el('surflog-empty'), exportRow = el('sl-export-row');
  if (!tbody) return;
  tbody.innerHTML = '';
  let entries = [...STATE.surfLog];
  const fromD = el('sl-filter-from')?.value, toD = el('sl-filter-to')?.value;
  const minR = parseFloat(el('sl-filter-rating')?.value || '0');
  if (fromD) entries = entries.filter(e => e.timestamp >= fromD);
  if (toD) entries = entries.filter(e => e.timestamp <= toD + 'T23:59:59');
  if (minR > 0) entries = entries.filter(e => (e.ratings.size+e.ratings.windQuality+e.ratings.rideQuality)/3 >= minR);

  // Partition into incomplete + complete so flagged rows surface at the top of the table.
  const isIncomplete = (entry) => !!(window._llcIsLogEntryIncomplete && window._llcIsLogEntryIncomplete(entry));
  const byDateDesc = (a, b) => new Date(b.timestamp) - new Date(a.timestamp);
  const incomplete = entries.filter(isIncomplete).sort(byDateDesc);
  const complete = entries.filter(e => !isIncomplete(e)).sort(byDateDesc);
  entries = [...incomplete, ...complete];

  renderIncompleteBanner(incomplete.length);

  const tableEl = el('surflog-table');
  if (entries.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    if (tableEl) tableEl.style.display = 'none';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = '';
  }

  entries.forEach(entry => {
    const tr = document.createElement('tr');
    const d = new Date(entry.timestamp);
    const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'});
    const timeStr = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
    const avg = ((entry.ratings.size+entry.ratings.windQuality+entry.ratings.rideQuality)/3).toFixed(1);
    const validPhotos = (entry.photos||[]).map(p=>photoUrl(p)).filter(Boolean).slice(0,3);
    const photoHtml = validPhotos.length > 0
      ? '<div class="sl-row-photos">'+validPhotos.map(url=>'<img src="'+url+'" alt="" onerror="this.style.display=\'none\'">').join('')+'</div>'
      : '<span style="color:var(--ink4)">\u2014</span>';
    const notes = (entry.notes||'').slice(0,30) + ((entry.notes||'').length>30?'...':'');
    const isOwn = entry.userId === window._fbUserId;
    const attribution = (!isOwn && entry.displayName) ? '<br><span style="color:var(--ink4);font-size:0.6rem">'+entry.displayName+'</span>' : '';
    const incompletePill = isIncomplete(entry) ? '<br><span class="sl-incomplete-pill">\u26a0 incomplete</span>' : '';
    const actionHtml = isOwn
      ? '<button class="sl-btn sl-btn-sm sl-edit-btn" data-id="'+entry.id+'">Edit</button> <button class="sl-btn sl-btn-sm sl-btn-danger sl-delete-btn" data-id="'+entry.id+'">Del</button>'
      : '<span style="color:var(--ink4);font-size:0.65rem">community</span>';
    tr.innerHTML = '<td style="white-space:nowrap">'+dateStr+'<br><span style="color:var(--ink4);font-size:0.65rem">'+timeStr+'</span>'+attribution+incompletePill+'</td>'
      +'<td>'+photoHtml+'</td>'
      +'<td>'+ratingBadge(entry.ratings.size)+'</td>'
      +'<td>'+ratingBadge(entry.ratings.windQuality)+'</td>'
      +'<td>'+ratingBadge(entry.ratings.rideQuality)+'</td>'
      +'<td>'+ratingBadge(parseFloat(avg))+'</td>'
      +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">'+(notes||'<span style="color:var(--ink4)">\u2014</span>')+'</td>'
      +'<td style="white-space:nowrap">'+actionHtml+'</td>';
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', ev => { if (!ev.target.closest('button')) toggleEntryDetail(entry, tr); });
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.sl-edit-btn').forEach(b => b.addEventListener('click', () => editLogEntry(b.dataset.id)));
  tbody.querySelectorAll('.sl-delete-btn').forEach(b => b.addEventListener('click', () => { if(confirm('Delete this session?')) deleteLogEntry(b.dataset.id); }));
  updateStorageNote();
  if (exportRow) exportRow.style.display = STATE.surfLog.length > 0 ? '' : 'none';
}

function renderIncompleteBanner(count) {
  const existing = el('sl-incomplete-banner');
  if (count <= 0) {
    if (existing) existing.remove();
    return;
  }
  const noun = count === 1 ? 'entry is' : 'entries are';
  const text = count + ' ' + noun + ' incomplete and excluded from your model. Click Edit on flagged rows to repair.';
  if (existing) {
    existing.textContent = text;
    return;
  }
  const tableWrap = document.querySelector('#panel-surflog-entries .surflog-table-wrap');
  if (!tableWrap) return;
  const banner = document.createElement('div');
  banner.id = 'sl-incomplete-banner';
  banner.className = 'sl-incomplete-banner';
  banner.textContent = text;
  tableWrap.parentNode.insertBefore(banner, tableWrap);
}

function toggleEntryDetail(entry, tr) {
  const existing = tr.nextElementSibling;
  if (existing?.classList.contains('sl-detail-row')) { existing.remove(); return; }
  const dr = document.createElement('tr'); dr.className = 'sl-detail-row';
  const c = entry.conditions;
  let h = '<td colspan="8"><div class="sl-detail-content">';
  if (c) {
    h += '<div class="sl-cond-group"><span class="sl-cond-group-title">Swell</span>'+c.swell.height+'ft '+c.swell.period+'s '+directionLabel(c.swell.direction)+' ('+c.swell.direction+'\u00b0)';
    if (c.swell.secondary) h += '<br>2nd: '+c.swell.secondary.height+'ft '+c.swell.secondary.period+'s '+directionLabel(c.swell.secondary.direction);
    h += '</div><div class="sl-cond-group"><span class="sl-cond-group-title">Wind</span>'+c.wind.speed+' mph '+directionLabel(c.wind.direction)+' ('+c.wind.direction+'\u00b0)</div>';
    h += '<div class="sl-cond-group"><span class="sl-cond-group-title">Tide</span>'+_formatTideReadout(c.tide)+'</div>';
  } else { h += '<div style="grid-column:1/-1;color:var(--ink4)">No conditions recorded</div>'; }
  h += '</div></td>';
  dr.innerHTML = h; tr.after(dr);
}

// ════════════════════════════════════════════════
// SURF LOG — Linear Regression (Normal Equation)
// ════════════════════════════════════════════════

// Three independent models train on the same logged sessions:
//   wave  — predicts ratings.size: did swell arrive at Choc with size (pure swell-arrival signal)
//   ride  — predicts ratings.rideQuality: how cleanly the wave peeled (direction fit, period, tide phase)
//   cond  — predicts ratings.windQuality: local wind quality
// Splitting size off from ride lets each model isolate its physical signal.
//
// Direction encoded as two window-relative features (alignment + outside_deg) instead
// of raw sin/cos so the regression can reveal whether the swell window acts as a hard
// gate, a gradual ramp, or both.

// Wave features (target: ratings.size). Effective in-window energy aggregates
// primary + secondary swell — when primary is out of window and secondary is
// in window, secondary becomes the de facto swell at the spot. See
// CHOCOMOUNT_KNOWLEDGE.md "Swell window: the central concept".
const WAVE_FEATURE_NAMES = [
  'effective_in_window_height',
  'effective_in_window_period',
  'total_swell_height'
];

// Ride features (target: ratings.rideQuality). Direction belongs in the Wave
// model — perceived size already encodes window-gating. Ride is shape: tide
// height (reef depth), tide rate (incoming amplifies, outgoing mutes),
// effective in-window period (long period drives energy through the
// eelgrass section), and effective in-window height (bigger waves carry
// energy through all 4-5 segments; small waves die early).
const RIDE_FEATURE_NAMES = [
  'tide_height',
  'tide_rate',
  'effective_in_window_period',
  'effective_in_window_height'
];

// Conditions features (target: ratings.windQuality). wind_offshore is cos of
// the angular gap between wind direction and the reef's offshore bearing,
// ranging −1 (directly onshore) to +1 (directly offshore).
const COND_FEATURE_NAMES = [
  'wind_speed','wind_offshore'
];

// Reef's offshore bearing — wind blowing FROM this direction is directly offshore.
const REEF_OFFSHORE_BEARING = 335;
function windOffshoreness(windDir) {
  if (windDir == null || isNaN(windDir)) return 0;
  const raw = Math.abs(windDir - REEF_OFFSHORE_BEARING);
  const diff = Math.min(raw, 360 - raw);
  return Math.cos(diff * Math.PI / 180);
}

// Graduated swell-window alignment. Returns 1 inside [min, max], linearly
// decaying to 0 over the next 30° outside either edge, 0 beyond. This gives
// partial credit to swells just outside the window (refraction / leak)
// instead of a hard binary gate.
function _alignmentScore(directionDeg) {
  if (directionDeg == null || !isFinite(directionDeg)) return 0;
  const lo = CONFIG.chocomount.swellWindowMin;
  const hi = CONFIG.chocomount.swellWindowMax;
  const LEAK_DEG = 30;
  if (directionDeg >= lo && directionDeg <= hi) return 1;
  const distOutside = directionDeg < lo
    ? (lo - directionDeg)
    : (directionDeg - hi);
  if (distOutside >= LEAK_DEG) return 0;
  return 1 - (distOutside / LEAK_DEG);
}

// Aggregates primary + secondary swell into "what's actually hitting the
// reef". Both Wave and Ride extractors share this. Each swell train is
// weighted by its alignment score so trains just outside the window
// contribute partial energy rather than dropping to zero.
//   effHeight   = alignment-weighted height (ft)
//   effPeriod   = weighted-height average period (s, 0 if none)
//   totalHeight = gross swell magnitude regardless of direction (sanity-check baseline)
function _effectiveInWindowSwell(cond) {
  const pri = cond?.swell || {};
  const sec = cond?.swell?.secondary;
  const priScore = _alignmentScore(pri.direction);
  const secScore = sec ? _alignmentScore(sec.direction) : 0;
  const wPri = priScore * (pri.height || 0);
  const wSec = secScore * (sec?.height || 0);
  const effHeight = wPri + wSec;
  const effPeriod = effHeight > 1e-6
    ? (wPri * (pri.period || 0) + wSec * (sec?.period || 0)) / effHeight
    : 0;
  const totalHeight = (pri.height || 0) + (sec?.height || 0);
  return { effHeight, effPeriod, totalHeight };
}

function extractWaveFeatures(cond) {
  if (!cond?.swell) return null;
  const { effHeight, effPeriod, totalHeight } = _effectiveInWindowSwell(cond);
  return [effHeight, effPeriod, totalHeight];
}

// Ride model focuses on shape: tide depth on the reef, the signed water-
// movement rate, the in-window period that drives energy through the
// eelgrass section, and the in-window height (bigger waves push through
// all segments; small waves die early). Direction lives in the Wave model
// — perceived size already encodes window-gating.
function extractRideFeatures(cond) {
  if (!cond?.swell) return null;
  const t = cond.tide;
  if (!t || typeof t.height !== 'number' || !isFinite(t.height)) {
    // Backfill should have populated tide.height on every session; bail on
    // training rows that somehow lack it rather than imputing.
    return null;
  }
  let rate = t.rate;
  if (typeof rate !== 'number' || !isFinite(rate)) {
    // Last-resort fallback for sessions missed by the tide backfill.
    if (t.stage === 'rising') rate = 0.5;
    else if (t.stage === 'falling') rate = -0.5;
    else rate = 0;   // 'slack-high' / 'slack-low' / unknown
    console.warn('[extractRideFeatures] missing cond.tide.rate, inferring from stage',
      { stage: t.stage, inferredRate: rate, height: t.height });
  }
  const { effHeight, effPeriod } = _effectiveInWindowSwell(cond);
  return [t.height, rate, effPeriod, effHeight];
}

function extractCondFeatures(cond) {
  const w = cond?.wind || {};
  // Sessions with missing wind data (failed fetch stored as null sentinels)
  // are dropped from training rather than median-filled — fabricating a
  // datapoint biases the Conditions model toward the median + cross-shore.
  const haveSpd = w.speed != null && isFinite(w.speed);
  const haveDir = w.direction != null && isFinite(w.direction);
  if (!haveSpd || !haveDir) return null;
  return [w.speed, windOffshoreness(w.direction)];
}

function matTranspose(A) { const r=A.length,c=A[0].length,T=[]; for(let j=0;j<c;j++){T[j]=[]; for(let i=0;i<r;i++) T[j][i]=A[i][j];} return T; }
function matMul(A,B) { const rA=A.length,cA=A[0].length,cB=B[0].length,C=Array.from({length:rA},()=>new Array(cB).fill(0)); for(let i=0;i<rA;i++) for(let j=0;j<cB;j++) for(let k=0;k<cA;k++) C[i][j]+=A[i][k]*B[k][j]; return C; }
function matInvert(m) {
  const n=m.length, aug=m.map((r,i)=>{const row=[...r]; for(let j=0;j<n;j++) row.push(i===j?1:0); return row;});
  for(let c=0;c<n;c++){
    let mr=c; for(let r=c+1;r<n;r++) if(Math.abs(aug[r][c])>Math.abs(aug[mr][c])) mr=r;
    [aug[c],aug[mr]]=[aug[mr],aug[c]];
    if(Math.abs(aug[c][c])<1e-10) return null;
    const piv=aug[c][c]; for(let j=0;j<2*n;j++) aug[c][j]/=piv;
    for(let r=0;r<n;r++){ if(r===c) continue; const f=aug[r][c]; for(let j=0;j<2*n;j++) aug[r][j]-=f*aug[c][j]; }
  }
  return aug.map(r=>r.slice(n));
}

function normalEquation(X,y) {
  const Xt=matTranspose(X), XtX=matMul(Xt,X);
  for(let i=0;i<XtX.length;i++) XtX[i][i]+=0.001;
  const inv=matInvert(XtX); if(!inv) return null;
  return matMul(inv, matMul(Xt, y.map(v=>[v]))).map(r=>r[0]);
}

// Z-score normalization keeps weights stable across retrains; min-max would
// drift each time a new outlier session is logged, making the weights panel
// hard to interpret over time.
//
// Target is mean-centered (not z-scored) so weights stay in rating-space units
// and predictions land in rating space without an inverse-transform step. The
// intercept is implicit: prediction = stats.targetMean + Σ wj·zj.
function _trainOnArrays(X, y) {
  if (!X.length) return null;
  const nF = X[0].length;
  const stats = { mean: [], std: [] };
  for (let j = 0; j < nF; j++) {
    const col = X.map(r => r[j]);
    const mean = col.reduce((a,b) => a+b, 0) / col.length;
    const variance = col.reduce((a,b) => a + (b-mean)*(b-mean), 0) / col.length;
    stats.mean[j] = mean;
    stats.std[j] = Math.sqrt(variance);
  }
  const Xn = X.map(row => row.map((v,j) => stats.std[j] > 1e-10 ? (v - stats.mean[j]) / stats.std[j] : 0));
  const yMean = y.reduce((a,b) => a+b, 0) / y.length;
  const yCentered = y.map(v => v - yMean);
  const weights = normalEquation(Xn, yCentered);
  if (!weights) return null;
  stats.targetMean = yMean;
  return { weights, stats };
}

function trainModel(entries, featureExtractor, targetFn) {
  const X = [], y = [];
  entries.forEach(e => { const f = featureExtractor(e.conditions); if(f){ X.push(f); y.push(targetFn(e)); }});
  if (!X.length) return null;
  const nF = X[0].length;
  const minSamples = Math.max(2 * nF, 12);
  if (X.length < minSamples) return null;
  return _trainOnArrays(X, y);
}

// Train on all samples except `holdoutIdx`, predict the held-out target,
// repeat for every sample, return RMSE across held-out predictions.
function leaveOneOutRMSE(entries, featureExtractor, targetFn) {
  const X = [], y = [];
  entries.forEach(e => { const f = featureExtractor(e.conditions); if(f){ X.push(f); y.push(targetFn(e)); }});
  if (!X.length) return null;
  const nF = X[0].length;
  const minSamples = Math.max(2 * nF, 12);
  // Need one more than minSamples so each fold still has at least minSamples training rows.
  if (X.length < minSamples + 1) return null;
  let sse = 0, count = 0;
  for (let h = 0; h < X.length; h++) {
    const Xtr = X.slice(0, h).concat(X.slice(h+1));
    const ytr = y.slice(0, h).concat(y.slice(h+1));
    const m = _trainOnArrays(Xtr, ytr);
    if (!m) continue;
    let pred = m.stats.targetMean;
    for (let j = 0; j < nF; j++) {
      const z = m.stats.std[j] > 1e-10 ? (X[h][j] - m.stats.mean[j]) / m.stats.std[j] : 0;
      pred += m.weights[j] * z;
    }
    const err = pred - y[h];
    sse += err * err; count++;
  }
  return count ? Math.sqrt(sse / count) : null;
}

function slRetrain() {
  // Calibrate to the current user's rating taste rather than mixing community ratings.
  const uid = window._fbUserId;
  const userScoped = uid ? STATE.surfLog.filter(e => e.userId === uid) : STATE.surfLog;
  const entries = userScoped.filter(e => e.conditions?.swell);
  // Wave model: target = size (pure swell arrival, no peel quality mixed in).
  const wave = trainModel(entries, extractWaveFeatures, e => e.ratings.size);
  STATE.surfLogWaveWeights = wave?.weights || null;
  STATE.surfLogWaveStats = wave?.stats || null;
  STATE.surfLogWaveValidation = leaveOneOutRMSE(entries, extractWaveFeatures, e => e.ratings.size);
  // Ride model: target = rideQuality (how cleanly it peeled).
  const ride = trainModel(entries, extractRideFeatures, e => e.ratings.rideQuality);
  STATE.surfLogRideWeights = ride?.weights || null;
  STATE.surfLogRideStats = ride?.stats || null;
  STATE.surfLogRideValidation = leaveOneOutRMSE(entries, extractRideFeatures, e => e.ratings.rideQuality);
  // Conditions model: target = windQuality
  const cond = trainModel(entries, extractCondFeatures, e => e.ratings.windQuality);
  STATE.surfLogCondWeights = cond?.weights || null;
  STATE.surfLogCondStats = cond?.stats || null;
  STATE.surfLogCondValidation = leaveOneOutRMSE(entries, extractCondFeatures, e => e.ratings.windQuality);
  // Stamp the wall-clock time of this fit for the Tab 2 sample summary.
  STATE._lastFitAt = Date.now();
  STATE._lastFitN = entries.length;
  if (entries.length > 0) {
    let minT = Infinity, maxT = -Infinity;
    for (const e of entries) {
      const t = new Date(e.timestamp).getTime();
      if (!isFinite(t)) continue;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    STATE._lastFitDateRange = (isFinite(minT) && isFinite(maxT)) ? { min: minT, max: maxT } : null;
  } else {
    STATE._lastFitDateRange = null;
  }
  renderWeightsPanel();
  _logRetrainSummary();
  if (STATE.activeTab === 'regression') renderRegressionTab();
}

function _pairWeights(weights, names) {
  if (!weights) return null;
  const out = {};
  weights.forEach((w, i) => { out[names[i] || ('f'+i)] = Math.round(w * 1000) / 1000; });
  return out;
}
function _logRetrainSummary() {
  console.groupCollapsed('[surf-log] retrain — model weights & validation');
  console.log('wave (target=size)',  { weights: _pairWeights(STATE.surfLogWaveWeights, WAVE_FEATURE_NAMES), rmse_loo: STATE.surfLogWaveValidation });
  console.log('ride (target=rideQuality)', { weights: _pairWeights(STATE.surfLogRideWeights, RIDE_FEATURE_NAMES), rmse_loo: STATE.surfLogRideValidation });
  console.log('cond (target=windQuality)', { weights: _pairWeights(STATE.surfLogCondWeights, COND_FEATURE_NAMES), rmse_loo: STATE.surfLogCondValidation });
  console.groupEnd();
  _logRegressionSanity();
}

// Per-model post-retrain sanity output. Catches the class of bug where
// predictions slip out of rating space (e.g. z-space leak from a missing
// inverse transform) by checking pred range / mean / std against actuals,
// and flags models that don't beat "predict the mean" baseline.
function _runLOOForSanity(entries, featureExtractor, targetFn) {
  const X = [], y = [];
  entries.forEach(e => { const f = featureExtractor(e.conditions); if (f) { X.push(f); y.push(targetFn(e)); } });
  if (!X.length) return null;
  const nF = X[0].length;
  const minSamples = Math.max(2 * nF, 12);
  if (X.length < minSamples + 1) return null;
  const preds = [], actuals = [];
  for (let h = 0; h < X.length; h++) {
    const Xtr = X.slice(0, h).concat(X.slice(h + 1));
    const ytr = y.slice(0, h).concat(y.slice(h + 1));
    const m = _trainOnArrays(Xtr, ytr);
    if (!m) continue;
    let p = m.stats.targetMean;
    for (let j = 0; j < nF; j++) {
      const z = m.stats.std[j] > 1e-10 ? (X[h][j] - m.stats.mean[j]) / m.stats.std[j] : 0;
      p += m.weights[j] * z;
    }
    preds.push(p);
    actuals.push(y[h]);
  }
  return preds.length ? { preds, actuals } : null;
}
function _stats1D(arr) {
  if (!arr || !arr.length) return null;
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  let v = 0; for (let i = 0; i < n; i++) v += (arr[i] - mean) * (arr[i] - mean);
  return { n, mean, std: Math.sqrt(v / n), min: Math.min(...arr), max: Math.max(...arr) };
}
function _logSanityModel(label, target, featureNames, looOut, weights) {
  console.groupCollapsed('[regression-sanity] ' + label);
  console.log('target          : ' + target);
  console.log('features        : ' + (featureNames || []).join(', '));
  if (weights && weights.length) {
    let topIdx = 0;
    for (let i = 1; i < weights.length; i++) {
      if (Math.abs(weights[i]) > Math.abs(weights[topIdx])) topIdx = i;
    }
    const topW = weights[topIdx];
    const sign = topW >= 0 ? '+' : '−';
    console.log('top feature     : ' + (featureNames[topIdx] || ('f' + topIdx)) +
      ' (w=' + sign + Math.abs(topW).toFixed(3) + ')');
  }
  if (!looOut) {
    console.log('n               : 0  (insufficient data for LOO)');
    console.groupEnd();
    return;
  }
  const ps = _stats1D(looOut.preds), as = _stats1D(looOut.actuals);
  let sse = 0; for (let i = 0; i < looOut.preds.length; i++) {
    const e = looOut.preds[i] - looOut.actuals[i]; sse += e * e;
  }
  const rmse = Math.sqrt(sse / looOut.preds.length);
  const baselineRMSE = as.std;
  const ssTot = as.std * as.std * as.n;
  const r2 = ssTot > 1e-10 ? 1 - sse / ssTot : null;
  const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);
  console.log('n               : ' + ps.n);
  console.log('pred range      : [' + fmt(ps.min) + ', ' + fmt(ps.max) + ']');
  console.log('actual range    : [' + fmt(as.min) + ', ' + fmt(as.max) + ']');
  console.log('pred mean       : ' + fmt(ps.mean));
  console.log('actual mean     : ' + fmt(as.mean));
  console.log('pred std        : ' + fmt(ps.std));
  console.log('actual std      : ' + fmt(as.std));
  console.log('RMSE            : ' + fmt(rmse));
  console.log('baseline RMSE   : ' + fmt(baselineRMSE));
  console.log('R²              : ' + (r2 == null ? '—' : (r2 >= 0 ? '+' : '') + fmt(r2)));
  // Scale-mismatch guard: predictions in z-space have std ~1 and range ~[−2, +3].
  const scaleBad = (ps.min < 0 || ps.max > 12) || (as.std > 1.5 && ps.std < 1.5 && ps.max < 4);
  if (scaleBad) {
    console.log('✗ SCALE MISMATCH — predictions may be in z-space, check inverse-transform');
  }
  if (rmse >= baselineRMSE) {
    console.log('✗ worse than predicting the mean');
  } else {
    console.log('✓ beats baseline (RMSE < baseline RMSE)');
  }
  console.groupEnd();
}
function _logRegressionSanity() {
  const uid = window._fbUserId;
  const userScoped = uid ? STATE.surfLog.filter(e => e.userId === uid) : STATE.surfLog;
  const entries = userScoped.filter(e => e.conditions?.swell);
  _logSanityModel('WAVE', 'size', WAVE_FEATURE_NAMES,
    _runLOOForSanity(entries, extractWaveFeatures, e => e.ratings.size),
    STATE.surfLogWaveWeights);
  _logSanityModel('RIDE', 'rideQuality', RIDE_FEATURE_NAMES,
    _runLOOForSanity(entries, extractRideFeatures, e => e.ratings.rideQuality),
    STATE.surfLogRideWeights);
  _logSanityModel('COND', 'windQuality', COND_FEATURE_NAMES,
    _runLOOForSanity(entries, extractCondFeatures, e => e.ratings.windQuality),
    STATE.surfLogCondWeights);
}

// Spot-owner-facing metrics report. Run from DevTools after retrain to copy
// a plain-text summary of n / R² / LOO RMSE / top feature for each sub-model.
function _llcRegressionMetricsReport() {
  const uid = window._fbUserId;
  const userScoped = uid ? STATE.surfLog.filter(e => e.userId === uid) : STATE.surfLog;
  const entries = userScoped.filter(e => e.conditions?.swell);
  const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);
  const block = (label, target, featureNames, extractor, targetFn, weights, rmse) => {
    const looOut = _runLOOForSanity(entries, extractor, targetFn);
    let n = 0, r2 = null;
    if (looOut) {
      n = looOut.preds.length;
      let sse = 0; for (let i = 0; i < n; i++) {
        const e = looOut.preds[i] - looOut.actuals[i]; sse += e * e;
      }
      const aMean = looOut.actuals.reduce((a, b) => a + b, 0) / n;
      let ssTot = 0; for (let i = 0; i < n; i++) {
        const d = looOut.actuals[i] - aMean; ssTot += d * d;
      }
      r2 = ssTot > 1e-10 ? 1 - sse / ssTot : null;
    }
    let topLine = '—';
    if (weights && weights.length) {
      let topIdx = 0;
      for (let i = 1; i < weights.length; i++) {
        if (Math.abs(weights[i]) > Math.abs(weights[topIdx])) topIdx = i;
      }
      const sign = weights[topIdx] >= 0 ? '+' : '−';
      topLine = (featureNames[topIdx] || ('f' + topIdx)) + ' (sign: ' + sign + ')';
    }
    return label + ':\n' +
      '  n trained on: ' + n + '\n' +
      '  R²: ' + (r2 == null ? '—' : fmt(r2)) + '\n' +
      '  LOO RMSE: ' + fmt(rmse) + '\n' +
      '  Top feature by |w_j|: ' + topLine + '\n';
  };
  return [
    block('Wave', 'size', WAVE_FEATURE_NAMES,
      extractWaveFeatures, e => e.ratings.size,
      STATE.surfLogWaveWeights, STATE.surfLogWaveValidation),
    block('Ride', 'rideQuality', RIDE_FEATURE_NAMES,
      extractRideFeatures, e => e.ratings.rideQuality,
      STATE.surfLogRideWeights, STATE.surfLogRideValidation),
    block('Conditions', 'windQuality', COND_FEATURE_NAMES,
      extractCondFeatures, e => e.ratings.windQuality,
      STATE.surfLogCondWeights, STATE.surfLogCondValidation)
  ].join('\n');
}
if (typeof window !== 'undefined') {
  window._llcRegressionMetricsReport = _llcRegressionMetricsReport;
}

// Run from DevTools: window._llcLeakDegSweep()
// Sweeps the swell-window leak tolerance across a range of degrees, retrains
// Wave and Ride on the active user's surfLog at each value, and prints LOO
// R² + RMSE per leak. Diagnostic only — production LEAK_DEG (30) is untouched.
function _llcLeakDegSweep() {
  const uid = window._fbUserId;
  const userScoped = uid ? STATE.surfLog.filter(e => e.userId === uid) : STATE.surfLog;
  const entries = userScoped.filter(e => e.conditions?.swell);

  const alignParam = (directionDeg, LEAK_DEG) => {
    if (directionDeg == null || !isFinite(directionDeg)) return 0;
    const lo = CONFIG.chocomount.swellWindowMin;
    const hi = CONFIG.chocomount.swellWindowMax;
    if (directionDeg >= lo && directionDeg <= hi) return 1;
    if (LEAK_DEG <= 0) return 0;
    const distOutside = directionDeg < lo ? (lo - directionDeg) : (directionDeg - hi);
    if (distOutside >= LEAK_DEG) return 0;
    return 1 - (distOutside / LEAK_DEG);
  };
  const effSwellParam = (cond, LEAK_DEG) => {
    const pri = cond?.swell || {};
    const sec = cond?.swell?.secondary;
    const priScore = alignParam(pri.direction, LEAK_DEG);
    const secScore = sec ? alignParam(sec.direction, LEAK_DEG) : 0;
    const wPri = priScore * (pri.height || 0);
    const wSec = secScore * (sec?.height || 0);
    const effHeight = wPri + wSec;
    const effPeriod = effHeight > 1e-6
      ? (wPri * (pri.period || 0) + wSec * (sec?.period || 0)) / effHeight
      : 0;
    const totalHeight = (pri.height || 0) + (sec?.height || 0);
    return { effHeight, effPeriod, totalHeight };
  };
  const waveExtractorAt = (LEAK_DEG) => (cond) => {
    if (!cond?.swell) return null;
    const { effHeight, effPeriod, totalHeight } = effSwellParam(cond, LEAK_DEG);
    return [effHeight, effPeriod, totalHeight];
  };
  const rideExtractorAt = (LEAK_DEG) => (cond) => {
    if (!cond?.swell) return null;
    const t = cond.tide;
    if (!t || typeof t.height !== 'number' || !isFinite(t.height)) return null;
    let rate = t.rate;
    if (typeof rate !== 'number' || !isFinite(rate)) {
      if (t.stage === 'rising') rate = 0.5;
      else if (t.stage === 'falling') rate = -0.5;
      else rate = 0;
    }
    const { effHeight, effPeriod } = effSwellParam(cond, LEAK_DEG);
    return [t.height, rate, effPeriod, effHeight];
  };

  const metricsFor = (extractor, targetFn) => {
    const trained = trainModel(entries, extractor, targetFn);
    const looOut = _runLOOForSanity(entries, extractor, targetFn);
    if (!looOut) return { n: trained ? null : 0, r2: null, rmse: null };
    const n = looOut.preds.length;
    let sse = 0; for (let i = 0; i < n; i++) {
      const e = looOut.preds[i] - looOut.actuals[i]; sse += e * e;
    }
    const aMean = looOut.actuals.reduce((a, b) => a + b, 0) / n;
    let ssTot = 0; for (let i = 0; i < n; i++) {
      const d = looOut.actuals[i] - aMean; ssTot += d * d;
    }
    const rmse = Math.sqrt(sse / n);
    const r2 = ssTot > 1e-10 ? 1 - sse / ssTot : null;
    return { n, r2, rmse };
  };

  const fmt = (v, d = 3) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);
  const LEAKS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
  const rows = LEAKS.map(L => {
    const w = metricsFor(waveExtractorAt(L), e => e.ratings.size);
    const r = metricsFor(rideExtractorAt(L), e => e.ratings.rideQuality);
    return {
      LEAK_DEG: L,
      wave_n: w.n ?? 0,
      wave_R2: fmt(w.r2),
      wave_LOO_RMSE: fmt(w.rmse),
      ride_n: r.n ?? 0,
      ride_R2: fmt(r.r2),
      ride_LOO_RMSE: fmt(r.rmse),
    };
  });
  console.table(rows);

  // Wave-only extended sweep across wider softening ranges. The base sweep
  // showed Wave LOO-RMSE still falling at the right edge of [0..45]; this
  // grid checks whether the curve plateaus, bottoms out, or keeps falling.
  const WAVE_EXT_LEAKS = [30, 40, 50, 60, 75, 90, 120];
  const waveExtRows = WAVE_EXT_LEAKS.map(L => {
    const w = metricsFor(waveExtractorAt(L), e => e.ratings.size);
    return {
      LEAK_DEG: L,
      wave_n: w.n ?? 0,
      wave_R2: fmt(w.r2),
      wave_LOO_RMSE: fmt(w.rmse),
    };
  });
  console.log('Wave-only extended sweep:');
  console.table(waveExtRows);

  return { rows, waveExtRows };
}
if (typeof window !== 'undefined') {
  window._llcLeakDegSweep = _llcLeakDegSweep;
}

function renderWeightSection(weights, stats, featureNames, rmse) {
  const minSamples = Math.max(2 * featureNames.length, 12);
  if (!weights) return '<span class="sl-hint">Need '+minSamples+'+ sessions to train.</span>';
  const tot = weights.reduce((s,v)=>s+Math.abs(v),0);
  if (tot===0) return '<span class="sl-hint">Not enough variance.</span>';
  const bars = weights.map((v,i) => {
    const pctAbs = Math.abs(v)/tot*100;
    const pctRounded = Math.round(pctAbs);
    const sign = v < 0 ? '−' : '+';
    // Near-zero contributions (< 3%) shown gray regardless of sign.
    const cls = pctAbs < 3 ? 'zero' : (v < 0 ? 'neg' : 'pos');
    const w = Math.max(2, pctRounded * 1.5);
    return '<div class="sl-weight-bar"><span class="sl-w-label">'+(featureNames[i]||'f'+i)+'</span><div class="sl-w-bar sl-w-'+cls+'" style="width:'+w+'px"></div><span class="sl-w-val sl-w-'+cls+'">'+sign+pctRounded+'%</span></div>';
  }).join('');
  const v = rmse == null
    ? '<div class="sl-w-rmse">Validation: not enough data</div>'
    : '<div class="sl-w-rmse">Validation RMSE: '+rmse.toFixed(2)+' (leave-one-out)</div>';
  return bars + v;
}

function renderWeightsPanel() {
  const panel = el('panel-surflog-weights'), container = el('surflog-weights');
  if (!panel||!container) return;
  if (!STATE.surfLogWaveWeights && !STATE.surfLogRideWeights && !STATE.surfLogCondWeights) { panel.style.display='none'; return; }
  panel.style.display = '';
  let h = '<div class="sl-weights-section"><h4 class="sl-weights-heading">Wave Score Weights</h4>';
  h += renderWeightSection(STATE.surfLogWaveWeights, STATE.surfLogWaveStats, WAVE_FEATURE_NAMES, STATE.surfLogWaveValidation);
  h += '</div><div class="sl-weights-section"><h4 class="sl-weights-heading">Ride Quality Score Weights</h4>';
  h += renderWeightSection(STATE.surfLogRideWeights, STATE.surfLogRideStats, RIDE_FEATURE_NAMES, STATE.surfLogRideValidation);
  h += '</div><div class="sl-weights-section"><h4 class="sl-weights-heading">Conditions Score Weights</h4>';
  h += renderWeightSection(STATE.surfLogCondWeights, STATE.surfLogCondStats, COND_FEATURE_NAMES, STATE.surfLogCondValidation);
  h += '</div>';
  container.innerHTML = h;
}

// ════════════════════════════════════════════════
// SURF LOG — Forecast Matching
// ════════════════════════════════════════════════

function _matchPct(ef, ff, weights, stats) {
  if (!stats) return 0;
  const w = weights || new Array(ef.length).fill(1);
  let dist = 0;
  for (let i=0;i<ef.length;i++) {
    const sd = stats.std[i]; if (sd < 1e-10) continue;
    const ze = (ef[i] - stats.mean[i]) / sd;
    const zf = (ff[i] - stats.mean[i]) / sd;
    dist += Math.abs(w[i]) * Math.pow(ze - zf, 2);
  }
  return Math.round(Math.exp(-Math.sqrt(dist))*100);
}
function computeWaveMatch(ef, ff) { return _matchPct(ef, ff, STATE.surfLogWaveWeights, STATE.surfLogWaveStats); }
function computeRideMatch(ef, ff) { return _matchPct(ef, ff, STATE.surfLogRideWeights, STATE.surfLogRideStats); }
function computeCondMatch(ef, ff) { return _matchPct(ef, ff, STATE.surfLogCondWeights, STATE.surfLogCondStats); }

function _predict(ff, weights, stats) {
  if (!weights||!stats) return null;
  let pred = stats.targetMean || 0;
  for(let i=0;i<ff.length;i++){ const sd=stats.std[i]; pred += weights[i] * (sd>1e-10 ? (ff[i]-stats.mean[i])/sd : 0); }
  return Math.max(1,Math.min(10,Math.round(pred*10)/10));
}
function predictWaveRating(wf) { return _predict(wf, STATE.surfLogWaveWeights, STATE.surfLogWaveStats); }
function predictRideRating(rf) { return _predict(rf, STATE.surfLogRideWeights, STATE.surfLogRideStats); }
function predictCondRating(cf) { return _predict(cf, STATE.surfLogCondWeights, STATE.surfLogCondStats); }

function simpleMatchPct(a,b) {
  let dist=0; for(let i=0;i<a.length;i++) dist+=Math.pow(a[i]-b[i],2);
  return Math.round(Math.exp(-Math.sqrt(dist)/a.length)*100);
}

// `tidePred` is the 6-min predictions series (CO-OPS interval=6) and is
// used for height + rate via interpolation. `tideHiLo` is consulted only
// for `timeToNearest` (hours to the next labelled extremum) — it has
// explicit H/L type tags so the readout is exact rather than detected.
function buildForecastConditions(marine, wind, tideHiLo, tidePred, hi) {
  if (!marine?.hourly||!wind?.hourly) return null;
  const swH=marine.hourly.swell_wave_height?.[hi]??marine.hourly.wave_height?.[hi]??0;
  const swD=marine.hourly.swell_wave_direction?.[hi]??marine.hourly.wave_direction?.[hi]??0;
  const swP=marine.hourly.swell_wave_period?.[hi]??marine.hourly.wave_period?.[hi]??0;
  const secH=marine.hourly.secondary_swell_wave_height?.[hi]??0;
  const secD=marine.hourly.secondary_swell_wave_direction?.[hi]??0;
  const secP=marine.hourly.secondary_swell_wave_period?.[hi]??0;
  const wSpd=wind.hourly.wind_speed_10m?.[hi]??0, wDir=wind.hourly.wind_direction_10m?.[hi]??0;
  const targetTime = marine.hourly.time?.[hi];
  let tideInfo = { height: 0, rate: 0, stage: 'rising', timeToNearest: 0 };
  if (targetTime && tidePred && tidePred.length) {
    tideInfo = parseTideAtTime({ predictions: tidePred }, targetTime);
    if (tideHiLo && tideHiLo.length) {
      const hi2 = parseTideAtTime({ predictions: tideHiLo }, targetTime);
      tideInfo.timeToNearest = hi2.timeToNearest;
    }
  } else if (targetTime && tideHiLo && tideHiLo.length) {
    tideInfo = parseTideAtTime({ predictions: tideHiLo }, targetTime);
  }
  return { swell:{height:swH,direction:swD,period:swP,secondary:secH>0.3?{height:secH,direction:secD,period:secP}:undefined},
    wind:{speed:wSpd,direction:wDir}, tide:tideInfo };
}

function findBestMatchPerDay(marine, wind, tideHiLo, tidePred) {
  if (!STATE.surfLog.length||!marine?.hourly) return [];
  const entries = STATE.surfLog.filter(e=>e.conditions).map(e=>({
    entry:e,
    wf:extractWaveFeatures(e.conditions),
    rf:extractRideFeatures(e.conditions),
    cf:extractCondFeatures(e.conditions)
  })).filter(x=>x.wf&&x.rf);
  if (!entries.length) return [];
  const times = marine.hourly.time||[], dayMap={};
  times.forEach((t,i) => { const day=t.split('T')[0]; if(!dayMap[day]) dayMap[day]=[]; dayMap[day].push(i); });
  const results = [];
  Object.entries(dayMap).forEach(([day, idxs]) => {
    let bestWM=0,bestRM=0,bestCM=0,bestE=null,bestWP=null,bestRP=null,bestCP=null,bestH=0;
    idxs.forEach(hi => {
      const fc=buildForecastConditions(marine,wind,tideHiLo,tidePred,hi); if(!fc) return;
      const fwf=extractWaveFeatures(fc), frf=extractRideFeatures(fc), fcf=extractCondFeatures(fc);
      if(!fwf||!frf) return;
      entries.forEach(({entry,wf,rf,cf}) => {
        const wPct=STATE.surfLogWaveWeights?computeWaveMatch(wf,fwf):simpleMatchPct(wf,fwf);
        const rPct=STATE.surfLogRideWeights?computeRideMatch(rf,frf):simpleMatchPct(rf,frf);
        const cPct=STATE.surfLogCondWeights?computeCondMatch(cf,fcf):simpleMatchPct(cf,fcf);
        const avg=(wPct+rPct+cPct)/3;
        if(avg>((bestWM+bestRM+bestCM)/3)){
          bestWM=wPct;bestRM=rPct;bestCM=cPct;bestE=entry;bestH=hi;
          bestWP=STATE.surfLogWaveWeights?predictWaveRating(fwf):null;
          bestRP=STATE.surfLogRideWeights?predictRideRating(frf):null;
          bestCP=STATE.surfLogCondWeights?predictCondRating(fcf):null;
        }
      });
    });
    if(bestE) results.push({day,waveMatch:bestWM,rideMatch:bestRM,condMatch:bestCM,entry:bestE,waveRating:bestWP,rideRating:bestRP,condRating:bestCP,hourIdx:bestH});
  });
  return results;
}

// The personal-matches surface was removed from Tab 1 in favour of the
// regression results coming on Tab 2. The match-scoring functions below
// (findBestMatchPerDay, renderPersonalMatchCards) stay because the upcoming
// Tab 2 work will reuse them; this wrapper is now a no-op kept so existing
// call sites in addLogEntry/updateLogEntry/loadLogsFromFirebase don't blow up.
function updatePersonalMatchToggle() { /* intentionally empty */ }

function renderPersonalMatchCards() {
  const container = el('personal-match-cards');
  if (!container||!STATE.personalMatchesOpen) return;
  if (!STATE._cachedMarine||!STATE._cachedWind) {
    container.innerHTML = '<div style="padding:16px;text-align:center;font-family:var(--mono);font-size:0.75rem;color:var(--ink3)">Load forecast data first.</div>';
    return;
  }
  const matches = findBestMatchPerDay(STATE._cachedMarine, STATE._cachedWind, STATE._cachedTideHiLo, STATE._cachedTidePred);
  if (!matches.length) { container.innerHTML = '<div style="padding:16px;text-align:center;font-family:var(--mono);font-size:0.75rem;color:var(--ink3)">No matches. Log more sessions.</div>'; return; }
  let h = '<div class="pm-cards-row">';
  matches.slice(0,7).forEach(m => {
    const dl = new Date(m.day).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    const thumb = m.entry.photos?.[0] ? photoUrl(m.entry.photos[0]) : '';
    const imgH = thumb ? '<img class="pm-card-img" src="'+thumb+'" alt="" onerror="this.style.display=\'none\'">' : '<div class="pm-card-img" style="display:flex;align-items:center;justify-content:center;color:var(--ink4);font-family:var(--mono);font-size:0.7rem">No photo</div>';
    const waveLine = '<span class="pm-score-wave">Wave: '+(m.waveRating?m.waveRating.toFixed(1):'--')+'</span>';
    const rideLine = '<span class="pm-score-ride">Ride: '+(m.rideRating?m.rideRating.toFixed(1):'--')+'</span>';
    const condLine = '<span class="pm-score-cond">Cond: '+(m.condRating?m.condRating.toFixed(1):'--')+'</span>';
    const matchLine = '<span class="pm-match-wave">W '+m.waveMatch+'%</span> <span class="pm-match-ride">R '+m.rideMatch+'%</span> <span class="pm-match-cond">C '+m.condMatch+'%</span>';
    h += '<div class="pm-card" data-day="'+m.day+'" data-eid="'+m.entry.id+'" data-hi="'+m.hourIdx+'">'+imgH+'<div class="pm-card-body"><div class="pm-card-date">'+dl+'</div><div class="pm-card-scores">'+waveLine+' '+rideLine+' '+condLine+'</div><div class="pm-card-match">'+matchLine+'</div></div></div>';
  });
  h += '</div>'; container.innerHTML = h;
  container.querySelectorAll('.pm-card').forEach(c => c.addEventListener('click', () => {
    const e = STATE.surfLog.find(x=>x.id===c.dataset.eid);
    if (e) openMatchModal(e, c.dataset.day, parseInt(c.dataset.hi));
  }));
}

// ════════════════════════════════════════════════
// SURF LOG — Match Modal
// ════════════════════════════════════════════════

function openMatchModal(entry, forecastDay, hi) {
  STATE.matchModalData = { entry, forecastDay, forecastHourIdx: hi };
  STATE.matchModalPhotoIdx = 0;
  el('match-modal').style.display = '';
  updateModalCarousel(entry.photos||[], 0);
  const fc = buildForecastConditions(STATE._cachedMarine, STATE._cachedWind, STATE._cachedTideHiLo, STATE._cachedTidePred, hi);
  let wPct = 0, cPct = 0;
  if (fc && entry.conditions) {
    const ewf=extractWaveFeatures(entry.conditions), fwf=extractWaveFeatures(fc);
    const ecf=extractCondFeatures(entry.conditions), fcf=extractCondFeatures(fc);
    if(ewf&&fwf) wPct = STATE.surfLogWaveWeights ? computeWaveMatch(ewf,fwf) : simpleMatchPct(ewf,fwf);
    if(ecf&&fcf) cPct = STATE.surfLogCondWeights ? computeCondMatch(ecf,fcf) : simpleMatchPct(ecf,fcf);
  }
  el('modal-match-badge').innerHTML = '<span class="pm-match-wave">Wave '+wPct+'%</span> <span class="pm-match-cond">Cond '+cPct+'%</span>';
  el('modal-title').textContent = new Date(entry.timestamp).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const ce = el('modal-conditions');
  if (ce && entry.conditions) {
    const c=entry.conditions, dl=(l,v)=>'<span class="mc-label">'+l+'</span><span class="mc-val">'+v+'</span>';
    const tideStr = c.tide ? (c.tide.height+'ft '+c.tide.stage + (typeof c.tide.rate === 'number' ? ' ('+(c.tide.rate>=0?'+':'')+c.tide.rate.toFixed(2)+' ft/hr)' : '')) : '—';
    ce.innerHTML = [dl('Swell',c.swell.height+'ft '+c.swell.period+'s '+directionLabel(c.swell.direction)), dl('Wind',c.wind.speed+'mph '+directionLabel(c.wind.direction)), dl('Tide',tideStr), fc?dl('Fcst Wind',Math.round(fc.wind.speed)+'mph '+directionLabel(fc.wind.direction)):''].join('');
  }
  el('modal-ratings').innerHTML = ratingBadge(entry.ratings.size)+' Size '+ratingBadge(entry.ratings.windQuality)+' Wind '+ratingBadge(entry.ratings.rideQuality)+' Ride';
  el('modal-notes').textContent = entry.notes || '';
}

function updateModalCarousel(photos, idx) {
  const img=el('modal-carousel-img'), dots=el('modal-carousel-dots'), prev=el('modal-carousel-prev'), next=el('modal-carousel-next');
  if (!img) return;
  if (!photos.length) { img.src=''; prev.style.display='none'; next.style.display='none'; dots.innerHTML=''; return; }
  img.src = photoUrl(photos[idx]);
  prev.style.display = photos.length>1?'':'none';
  next.style.display = photos.length>1?'':'none';
  dots.innerHTML = photos.map((_,i)=>'<span class="dot'+(i===idx?' active':'')+'"></span>').join('');
}

function initMatchModal() {
  el('match-modal-close')?.addEventListener('click', () => { el('match-modal').style.display='none'; });
  el('match-modal')?.addEventListener('click', e => { if(e.target===el('match-modal')) el('match-modal').style.display='none'; });
  el('modal-carousel-prev')?.addEventListener('click', () => {
    if(!STATE.matchModalData) return; const p=STATE.matchModalData.entry.photos||[];
    STATE.matchModalPhotoIdx=(STATE.matchModalPhotoIdx-1+p.length)%p.length; updateModalCarousel(p,STATE.matchModalPhotoIdx);
  });
  el('modal-carousel-next')?.addEventListener('click', () => {
    if(!STATE.matchModalData) return; const p=STATE.matchModalData.entry.photos||[];
    STATE.matchModalPhotoIdx=(STATE.matchModalPhotoIdx+1)%p.length; updateModalCarousel(p,STATE.matchModalPhotoIdx);
  });
}

// ════════════════════════════════════════════════
// SECONDARY SWELL CARD (Tab 1)
// ════════════════════════════════════════════════

function updateSecondarySwellCard(marine, isChoc, forecastLat, forecastLon) {
  const card = el('card-secondary-swell');
  if (!card) return;
  const cur = marine && marine.current ? marine.current : null;
  const hourly = marine && marine.hourly ? marine.hourly : null;
  // The "current" block on Open-Meteo Marine doesn't include secondary-swell
  // fields — pull from the first hourly slot (which is the current hour).
  const h = hourly && hourly.secondary_swell_wave_height ? hourly.secondary_swell_wave_height[0] : null;
  const p = hourly && hourly.secondary_swell_wave_period ? hourly.secondary_swell_wave_period[0] : null;
  const d = hourly && hourly.secondary_swell_wave_direction ? hourly.secondary_swell_wave_direction[0] : null;
  if (h == null || h < 1) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  el('val-sec-swell-height').textContent = h.toFixed(1) + ' ft';
  el('val-sec-swell-detail').textContent = (p != null ? p.toFixed(0) + 's' : '—') + ' · ' + directionLabel(d) + (d != null ? ' (' + Math.round(d) + '°)' : '');
  setFooter('footer-sec-swell', 'Open-Meteo Marine', 'https://open-meteo.com/en/docs/marine-weather-api', 'open-meteo.com');
  setFooter('footer-sec-swell-coord', _forecastCoordLabel(isChoc, forecastLat, forecastLon));
}

// ════════════════════════════════════════════════
// COORD FOOTERS (Tab 1 stat grid)
// ════════════════════════════════════════════════

function _forecastCoordLabel(isChoc, lat, lon) {
  if (isChoc) {
    return 'Forecast pt: ' + lat.toFixed(3) + '°N, ' + lon.toFixed(3) + '°W';
  }
  return lat.toFixed(3) + '°N, ' + Math.abs(lon).toFixed(3) + '°W';
}
function _windCoordLabel(isChoc, lat, lon) {
  if (isChoc) {
    return 'Wind pt: ' + lat.toFixed(3) + '°N, ' + lon.toFixed(3) + '°W (land)';
  }
  return lat.toFixed(3) + '°N, ' + Math.abs(lon).toFixed(3) + '°W';
}
function _buoyCoordLabel(buoy) {
  if (!buoy) return '';
  return 'Buoy ' + buoy.id + ': ' + buoy.lat.toFixed(3) + '°N, ' + Math.abs(buoy.lon).toFixed(3) + '°W';
}

// Refreshes the small italic coord footer beneath each card on Tab 1.
// Called from selectBuoy / selectPin after the data loaders run.
function updateCoordFooters(buoy, forecastLat, forecastLon, displayLat, displayLon) {
  const isChoc = !!(buoy && buoy.home === 'chocomount');
  // Swell card: forecast pt (Choc → open water; non-Choc → buoy/pin coord).
  // For non-Choc the buoy lat/lon equals the forecast pt, so show one line.
  if (isChoc && buoy) {
    setFooter('footer-swell-coord', _forecastCoordLabel(true, forecastLat, forecastLon) + ' · ' + _buoyCoordLabel(buoy));
  } else if (buoy) {
    setFooter('footer-swell-coord', _buoyCoordLabel(buoy));
  } else {
    setFooter('footer-swell-coord', _forecastCoordLabel(false, forecastLat, forecastLon));
  }
  setFooter('footer-wind-coord', _windCoordLabel(isChoc, displayLat, displayLon));
}

// ════════════════════════════════════════════════
// LINEUP MAP (Tab 1, Choc only)
// ════════════════════════════════════════════════

const LINEUP_REEF_HEADING = 335;

function _lineupArrow(svg, fromDeg, length, color, label) {
  if (fromDeg == null) return;
  const rad = (((fromDeg % 360) + 360) % 360) * Math.PI / 180;
  const ux = Math.sin(rad);     // forward (apex → origin) unit x
  const uy = -Math.cos(rad);    // forward unit y (screen y inverted)
  const px = Math.cos(rad);     // 90° CW perpendicular
  const py = Math.sin(rad);
  const HEAD_LEN = 5, HEAD_HALF_W = 3;
  const originX = 50 + length * ux;
  const originY = 50 + length * uy;
  const headBaseX = 50 + HEAD_LEN * ux;
  const headBaseY = 50 + HEAD_LEN * uy;
  const cornerLX = headBaseX - HEAD_HALF_W * px;
  const cornerLY = headBaseY - HEAD_HALF_W * py;
  const cornerRX = headBaseX + HEAD_HALF_W * px;
  const cornerRY = headBaseY + HEAD_HALF_W * py;
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('style', 'filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6))');
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', headBaseX.toFixed(2));
  line.setAttribute('y1', headBaseY.toFixed(2));
  line.setAttribute('x2', originX.toFixed(2));
  line.setAttribute('y2', originY.toFixed(2));
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linecap', 'round');
  g.appendChild(line);
  const poly = document.createElementNS(ns, 'polygon');
  poly.setAttribute('points', '50,50 ' + cornerLX.toFixed(2) + ',' + cornerLY.toFixed(2) + ' ' + cornerRX.toFixed(2) + ',' + cornerRY.toFixed(2));
  poly.setAttribute('fill', color);
  g.appendChild(poly);
  if (label) {
    const OFFSET = 1.8;
    const fontSize = 2.6;
    const charW = fontSize * (1.35 / 2.6);
    const w = Math.max(6, label.length * charW + 2.8);
    const h = fontSize + 1.4;
    const cx = originX + (OFFSET + w / 2) * px;
    const cy = originY + (OFFSET + w / 2) * py;
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', (cx - w / 2).toFixed(2));
    rect.setAttribute('y', (cy - h / 2).toFixed(2));
    rect.setAttribute('width', w.toFixed(2));
    rect.setAttribute('height', h.toFixed(2));
    rect.setAttribute('rx', '0.9');
    rect.setAttribute('fill', '#ffffff');
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-width', '0.25');
    g.appendChild(rect);
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', cx.toFixed(2));
    text.setAttribute('y', cy.toFixed(2));
    text.setAttribute('font-size', fontSize);
    text.setAttribute('fill', '#0a0c18');
    text.setAttribute('font-weight', '700');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = label;
    g.appendChild(text);
  }
  svg.appendChild(g);
}

function drawLineupMap(marine, wind, buoyParsed, hourIdx) {
  const svg = el('lineup-overlay');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const ns = 'http://www.w3.org/2000/svg';

  // When hourIdx is supplied (scrubber moved), pull all values from
  // marine.hourly[hourIdx] / wind.hourly[hourIdx]. Otherwise fall back to
  // hourly[0] / current as before.
  const hr = marine && marine.hourly ? marine.hourly : null;
  const cur = marine && marine.current ? marine.current : {};
  const i = (typeof hourIdx === 'number' && hourIdx >= 0) ? hourIdx : 0;
  const useScrub = typeof hourIdx === 'number' && hourIdx >= 0;
  const waveFt = (hr && hr.swell_wave_height ? hr.swell_wave_height[i] : null) ?? (useScrub ? null : (cur.swell_wave_height ?? cur.wave_height));
  const period = (hr && hr.swell_wave_period ? hr.swell_wave_period[i] : null) ?? (useScrub ? null : (cur.swell_wave_period ?? cur.wave_period));
  const swellDir = (hr && hr.swell_wave_direction ? hr.swell_wave_direction[i] : null) ?? (useScrub ? null : (cur.swell_wave_direction ?? cur.wave_direction));
  const sHeight = hr && hr.secondary_swell_wave_height ? hr.secondary_swell_wave_height[i] : null;
  const sPeriod = hr && hr.secondary_swell_wave_period ? hr.secondary_swell_wave_period[i] : null;
  const sDir    = hr && hr.secondary_swell_wave_direction ? hr.secondary_swell_wave_direction[i] : null;
  const wHr = wind && wind.hourly ? wind.hourly : null;
  const wSpd = useScrub
    ? (wHr && wHr.wind_speed_10m ? wHr.wind_speed_10m[i] : null)
    : (wind && wind.current ? wind.current.wind_speed_10m : null);
  const wDir = useScrub
    ? (wHr && wHr.wind_direction_10m ? wHr.wind_direction_10m[i] : null)
    : (wind && wind.current ? wind.current.wind_direction_10m : null);

  // ── Cone (swell window) ──
  const coneRadius = 40;
  const minRad = (CONFIG.chocomount.swellWindowMin * Math.PI) / 180;
  const maxRad = (CONFIG.chocomount.swellWindowMax * Math.PI) / 180;
  const coneX1 = 50 + coneRadius * Math.sin(minRad);
  const coneY1 = 50 - coneRadius * Math.cos(minRad);
  const coneX2 = 50 + coneRadius * Math.sin(maxRad);
  const coneY2 = 50 - coneRadius * Math.cos(maxRad);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M 50 50 L ' + coneX1.toFixed(2) + ' ' + coneY1.toFixed(2) +
    ' A ' + coneRadius + ' ' + coneRadius + ' 0 0 1 ' + coneX2.toFixed(2) + ' ' + coneY2.toFixed(2) + ' Z');
  path.setAttribute('fill', 'rgba(103, 232, 249, 0.18)');
  svg.appendChild(path);

  // ── Reef heading dashed line ──
  const reefRad = LINEUP_REEF_HEADING * Math.PI / 180;
  const reefLen = 15;
  const reefEndX = 50 + reefLen * Math.sin(reefRad);
  const reefEndY = 50 - reefLen * Math.cos(reefRad);
  const reefLine = document.createElementNS(ns, 'line');
  reefLine.setAttribute('x1', '50'); reefLine.setAttribute('y1', '50');
  reefLine.setAttribute('x2', reefEndX.toFixed(2));
  reefLine.setAttribute('y2', reefEndY.toFixed(2));
  reefLine.setAttribute('stroke', 'rgba(255,255,255,0.45)');
  reefLine.setAttribute('stroke-width', '0.6');
  reefLine.setAttribute('stroke-dasharray', '2 2');
  svg.appendChild(reefLine);
  const reefLabel = document.createElementNS(ns, 'text');
  reefLabel.setAttribute('x', (50 + (reefLen + 5) * Math.sin(reefRad)).toFixed(2));
  reefLabel.setAttribute('y', (50 - (reefLen + 5) * Math.cos(reefRad)).toFixed(2));
  reefLabel.setAttribute('font-size', '3');
  reefLabel.setAttribute('fill', 'rgba(255,255,255,0.6)');
  reefLabel.setAttribute('text-anchor', 'middle');
  reefLabel.setAttribute('dominant-baseline', 'middle');
  reefLabel.textContent = 'reef ' + LINEUP_REEF_HEADING + '°';
  svg.appendChild(reefLabel);

  // ── Arrow length helpers ──
  const ARROW_MIN = 10, ARROW_MAX = 32;
  const K_SWELL = 1.4, K_WIND = 0.6;
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  // Secondary first (so primary draws on top)
  const showSecondary = sHeight != null && sHeight >= 1
    && (waveFt == null || sHeight >= 0.25 * waveFt);
  if (showSecondary) {
    const energy2 = sHeight * sHeight * (sPeriod || 1);
    const len2 = clamp(Math.sqrt(energy2) * K_SWELL, ARROW_MIN, ARROW_MAX);
    const lbl = sHeight.toFixed(1) + 'ft @ ' + (sPeriod ? sPeriod.toFixed(0) + 's' : '–') + ' ' + directionLabel(sDir);
    _lineupArrow(svg, sDir, len2, '#67e8f9', lbl);
  }
  if (waveFt != null && swellDir != null) {
    const energy = waveFt * waveFt * (period || 1);
    const len = clamp(Math.sqrt(energy) * K_SWELL, ARROW_MIN, ARROW_MAX);
    const lbl = waveFt.toFixed(1) + 'ft @ ' + (period ? period.toFixed(0) + 's' : '–') + ' ' + directionLabel(swellDir);
    _lineupArrow(svg, swellDir, len, '#67e8f9', lbl);
  }
  if (wDir != null) {
    const len = clamp((wSpd || 0) * K_WIND, ARROW_MIN, ARROW_MAX);
    const lbl = (wSpd != null ? Math.round(wSpd) : '–') + 'mph ' + directionLabel(wDir);
    _lineupArrow(svg, wDir, len, '#fbbf24', lbl);
  }
  const caption = el('lineup-caption');
  if (caption) {
    if (useScrub && hr && hr.time && hr.time[i]) {
      const t = new Date(hr.time[i]);
      const stamp = t.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      caption.textContent = `Scrubbed to ${stamp} — primary swell, secondary swell, wind. Arrows converge on the lineup.`;
    } else {
      caption.textContent = 'Live "now" — primary swell, secondary swell, wind. Arrows converge on the lineup.';
    }
  }
}

// ════════════════════════════════════════════════
// FORECAST-COORDS TOGGLE (Tab 1, Choc only)
// ════════════════════════════════════════════════

function getForecastUseBuoyCoords() {
  return localStorage.getItem('lcc-forecast-use-buoy-coords') === '1';
}

function initForecastCoordsToggle() {
  const cb = el('forecast-coord-toggle');
  if (!cb) return;
  cb.checked = getForecastUseBuoyCoords();
  cb.addEventListener('change', () => {
    try {
      localStorage.setItem('lcc-forecast-use-buoy-coords', cb.checked ? '1' : '0');
    } catch (_) {}
    // Re-fetch and re-render the active selection.
    if (STATE.selectedBuoy) {
      loadAllData(STATE.selectedBuoy);
    }
  });
}

// ════════════════════════════════════════════════
// FORECAST MODEL TOGGLE (Tab 1)
// ════════════════════════════════════════════════

function getForecastModel() {
  try {
    const v = localStorage.getItem('lcc-forecast-model');
    if (!v) return '';
    if (v === 'best_match' || v === 'default') return '';
    if (FORECAST_MODELS.some(m => m.value === v)) return v;
    return '';
  } catch (_) { return ''; }
}

function setForecastModel(v) {
  try {
    if (v) localStorage.setItem('lcc-forecast-model', v);
    else localStorage.removeItem('lcc-forecast-model');
  } catch (_) {}
  const sel = el('forecast-model-select');
  if (sel) sel.value = v || '';
}

function describeForecastModel(v) {
  if (!v) return 'best_match (default)';
  const m = FORECAST_MODELS.find(x => x.value === v);
  return m ? `${v} · ${m.label}` : v;
}

// Quick sanity check for the post-fetch fallback path.
function marineHasUsableData(marine) {
  if (!marine || !marine.hourly) return false;
  const h = marine.hourly.swell_wave_height || marine.hourly.wave_height;
  if (!h || h.length === 0) return false;
  return h.some(v => v != null && Number.isFinite(v));
}

function initForecastModelDropdown() {
  const sel = el('forecast-model-select');
  if (!sel) return;
  // Populate options (default option already exists in HTML).
  for (const m of FORECAST_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  sel.value = getForecastModel();
  sel.addEventListener('change', () => {
    setForecastModel(sel.value);
    // Re-fetch the active selection with the new model.
    if (STATE.selectedBuoy) loadAllData(STATE.selectedBuoy);
    else if (STATE.pinLat != null && STATE.pinLon != null) loadPinData(STATE.pinLat, STATE.pinLon);
  });
}

// ════════════════════════════════════════════════
// BUOY SELECT DROPDOWN (global header)
// ════════════════════════════════════════════════

function initBuoySelectDropdown() {
  const sel = el('buoy-select');
  if (!sel) return;
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Pick a buoy —';
  sel.appendChild(placeholder);
  STATE.buoys.forEach(buoy => {
    if (buoy.home === 'chocomount' && !STATE.boatGatePassed) return;
    const opt = document.createElement('option');
    opt.value = buoy.id;
    opt.textContent = (buoy.home === 'chocomount' ? 'Choc · ' : '') + buoy.id + ' — ' + buoy.name;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    const id = sel.value;
    if (!id) return;
    const buoy = STATE.buoys.find(b => b.id === id);
    if (buoy) selectBuoy(buoy);
  });
}

function syncBuoySelectDropdown() {
  const sel = el('buoy-select');
  if (!sel) return;
  if (STATE.selectedBuoy) sel.value = STATE.selectedBuoy.id;
  else sel.value = '';
}

// ════════════════════════════════════════════════
// REGRESSION TAB (Tab 2)
// ════════════════════════════════════════════════

// Tab 2 sub-model state — drives §6, §7, §8, §9 below.
let _regActiveSubmodel = 'wave';

// Trim a trailing "now" indicator off the summary so it reads cleanly.
function _regFmtFitTimestamp(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  // ISO-ish UTC stamp matches the spec's "2026-05-04 14:32 UTC" form.
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi + ' UTC';
}

function _regFmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderRegressionTab() {
  const isChoc = STATE.isChocomount;
  const empty = el('panel-regression-empty');
  const summary = el('panel-regression-summary');
  const prediction = el('panel-regression-prediction');
  const pva = el('panel-regression-pva');
  const thresholds = el('panel-regression-thresholds');
  const submodel = el('panel-regression-submodel');
  const weights = el('panel-surflog-weights');
  const sections = [summary, prediction, pva, thresholds, submodel, weights];
  if (!isChoc) {
    if (empty) empty.style.display = '';
    sections.forEach(s => { if (s) s.style.display = 'none'; });
    return;
  }
  if (empty) empty.style.display = 'none';
  if (summary) summary.style.display = '';

  // Header strip
  const box = el('regression-sample-summary');
  if (box) {
    const n = STATE._lastFitN || 0;
    const range = STATE._lastFitDateRange;
    const earliest = range ? _regFmtDate(range.min) : '—';
    const latest = range ? _regFmtDate(range.max) : '—';
    const fitText = _regFmtFitTimestamp(STATE._lastFitAt);
    box.innerHTML = 'Trained on <strong>' + n + '</strong> session' + (n === 1 ? '' : 's') +
      ' · earliest <strong>' + earliest + '</strong>' +
      ' · latest <strong>' + latest + '</strong>' +
      ' · last refit <strong>' + fitText + '</strong>';
  }

  // The remaining sections are populated incrementally per Prompt #5.
  if (prediction) prediction.style.display = '';
  if (pva) pva.style.display = '';
  if (thresholds) thresholds.style.display = '';
  if (submodel) submodel.style.display = '';

  renderRegressionPredictionWidget();
  renderRegressionPVA();
  renderRegressionThresholds();
  _regWireSubmodelTabs();
  _regUpdateSubmodelSurfaces();

  // Weights panel (renderWeightsPanel toggles its own display).
  renderWeightsPanel();
}

// ── Tab 2 §6: Sub-model selector ──────────────────────────────────────
function _regWireSubmodelTabs() {
  const tabs = document.querySelectorAll('.reg-submodel-tab');
  tabs.forEach(t => {
    if (t._wired) return;
    t._wired = true;
    t.addEventListener('click', () => {
      const sub = t.dataset.submodel;
      if (!sub || !REG_SUBMODELS[sub]) return;
      _regActiveSubmodel = sub;
      tabs.forEach(x => x.classList.toggle('active', x.dataset.submodel === sub));
      _regUpdateSubmodelSurfaces();
    });
  });
  // Restore active class to currently-selected submodel.
  tabs.forEach(t => t.classList.toggle('active', t.dataset.submodel === _regActiveSubmodel));
}

// ── Tab 2 §6: Per-feature scatter grid (per active sub-model) ──────────
//
// One mini-scatter per feature in the active sub-model. Dots include the
// whole community surf log; the OLS fit line is computed from the
// user-scoped subset only. User dots in primary blue, community dots in
// muted gray.
const REG_FG_W = 220, REG_FG_H = 160;
const REG_FG_PAD = { left: 32, right: 8, top: 12, bottom: 26 };

function _regNiceTicks(min, max) {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span))) * (span / Math.pow(10, Math.floor(Math.log10(span))) >= 5 ? 1 : 0.5);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 100) / 100);
    if (ticks.length > 6) break;
  }
  return ticks;
}

function _regOLSFit(xs, ys) {
  if (xs.length < 2) return null;
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-10) return null;
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return { m, b };
}

function _regBuildFeatureMini(sub, featureIdx) {
  const cfg = REG_SUBMODELS[sub];
  const featureName = cfg.featureNames[featureIdx];
  const wrap = document.createElement('div');
  wrap.className = 'reg-feature-mini';
  const title = document.createElement('div');
  title.className = 'reg-feature-mini-title';
  const unit = regFeatureUnit(featureName);
  title.textContent = regFeatureLabel(featureName) + (unit ? ' (' + unit + ')' : '');
  wrap.appendChild(title);

  // Build all-sessions feature/target arrays
  const uid = window._fbUserId;
  const all = STATE.surfLog.filter(e => e.conditions?.swell);
  const points = [];
  for (const e of all) {
    const f = cfg.extractor(e.conditions);
    const t = cfg.targetFn(e);
    if (!f || typeof t !== 'number' || !isFinite(t)) continue;
    const isOwn = uid && e.userId === uid;
    points.push({ entry: e, x: f[featureIdx], y: t, isOwn: !!isOwn });
  }
  if (!points.length) {
    const empty = document.createElement('div');
    empty.className = 'reg-feature-mini-empty sl-hint';
    empty.textContent = 'No data';
    wrap.appendChild(empty);
    return wrap;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'reg-feature-mini-canvas';
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, REG_FG_W, REG_FG_H);
  // Axis bounds
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  if (xMin === xMax) { xMin -= 1; xMax += 1; }
  const xPad = (xMax - xMin) * 0.05;
  xMin -= xPad; xMax += xPad;
  const yMin = 0, yMax = 10;
  const pad = REG_FG_PAD;
  const plotW = REG_FG_W - pad.left - pad.right;
  const plotH = REG_FG_H - pad.top - pad.bottom;
  // Background + axes
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, REG_FG_W, REG_FG_H);
  ctx.strokeStyle = '#d0cbc3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, REG_FG_H - pad.bottom);
  ctx.lineTo(REG_FG_W - pad.right, REG_FG_H - pad.bottom);
  ctx.stroke();
  // Tick labels
  ctx.fillStyle = '#8a827a';
  ctx.font = '9px DM Mono, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, 5, 10]) {
    const y = pad.top + plotH * (1 - (v - yMin) / (yMax - yMin));
    ctx.fillText(String(v), pad.left - 3, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = _regNiceTicks(xMin, xMax);
  for (const v of xTicks) {
    const x = pad.left + plotW * ((v - xMin) / (xMax - xMin));
    ctx.fillText(String(v), x, REG_FG_H - pad.bottom + 3);
  }
  // Dots
  const projected = [];
  for (const p of points) {
    const x = pad.left + plotW * ((p.x - xMin) / (xMax - xMin));
    const y = pad.top + plotH * (1 - (p.y - yMin) / (yMax - yMin));
    projected.push({ x, y, p });
  }
  // Draw community first, user on top
  ctx.lineWidth = 0.5;
  for (const pt of projected.filter(p => !p.p.isOwn)) {
    ctx.fillStyle = REG_DOT_FILL_OTHER;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const pt of projected.filter(p => p.p.isOwn)) {
    ctx.fillStyle = REG_DOT_FILL_OWN;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // OLS fit line on user-scoped subset only
  const ownXs = points.filter(p => p.isOwn).map(p => p.x);
  const ownYs = points.filter(p => p.isOwn).map(p => p.y);
  if (ownXs.length >= 2) {
    const fit = _regOLSFit(ownXs, ownYs);
    if (fit) {
      const x0 = xMin, x1 = xMax;
      const y0 = fit.m * x0 + fit.b, y1 = fit.m * x1 + fit.b;
      const px0 = pad.left + plotW * ((x0 - xMin) / (xMax - xMin));
      const py0 = pad.top + plotH * (1 - (Math.max(yMin, Math.min(yMax, y0)) - yMin) / (yMax - yMin));
      const px1 = pad.left + plotW * ((x1 - xMin) / (xMax - xMin));
      const py1 = pad.top + plotH * (1 - (Math.max(yMin, Math.min(yMax, y1)) - yMin) / (yMax - yMin));
      ctx.strokeStyle = '#5a7fa0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px1, py1);
      ctx.stroke();
    }
  }
  // Click → drilldown
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let hit = null;
    for (const pt of projected) {
      const d = Math.hypot(mx - pt.x, my - pt.y);
      if (d <= 5) { hit = pt; break; }
    }
    if (hit && typeof openRegressionDrilldown === 'function') {
      openRegressionDrilldown(hit.p.entry, sub);
    }
  });
  return wrap;
}

function renderRegressionFeatureGrid() {
  const grid = el('reg-feature-grid');
  if (!grid) return;
  const sub = _regActiveSubmodel;
  const cfg = REG_SUBMODELS[sub];
  grid.innerHTML = '';
  for (let i = 0; i < cfg.featureNames.length; i++) {
    grid.appendChild(_regBuildFeatureMini(sub, i));
  }
}

// ── Tab 2 §7: Feature importance bars ─────────────────────────────────
//
// Sortable bar chart of |w_j| normalised so the largest is 100%. Bar
// colour = green for positive, red for negative. Sign suffix after the
// percentage. Sourced from STATE.surfLog{Wave,Ride,Cond}Weights — same
// data the existing weights panel renders, just visualised differently.
function renderRegressionImportance() {
  const container = el('reg-importance');
  if (!container) return;
  const sub = _regActiveSubmodel;
  const cfg = REG_SUBMODELS[sub];
  const weights = STATE[cfg.weightsKey];
  if (!weights) {
    container.innerHTML = '<div class="reg-empty sl-hint">' + cfg.title + ' isn\'t trained yet.</div>';
    return;
  }
  const maxAbs = weights.reduce((m, w) => Math.max(m, Math.abs(w)), 0);
  if (maxAbs < 1e-10) {
    container.innerHTML = '<div class="reg-empty sl-hint">All weights near zero.</div>';
    return;
  }
  const rows = weights.map((w, i) => ({
    name: cfg.featureNames[i] || ('f' + i),
    label: regFeatureLabel(cfg.featureNames[i] || ''),
    weight: w,
    pct: Math.abs(w) / maxAbs * 100
  }));
  rows.sort((a, b) => b.pct - a.pct);
  container.innerHTML = rows.map(r => {
    const sign = r.weight >= 0 ? '+' : '−';
    const cls = r.weight >= 0 ? 'reg-imp-pos' : 'reg-imp-neg';
    const pct = Math.round(r.pct);
    return '<div class="reg-imp-row ' + cls + '">' +
      '<span class="reg-imp-label">' + r.label + '</span>' +
      '<div class="reg-imp-bar-wrap">' +
        '<div class="reg-imp-bar" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<span class="reg-imp-pct">' + pct + '% (' + sign + ')</span>' +
      '</div>';
  }).join('');
}

// ── Tab 2 §8: Preferred conditions card ───────────────────────────────
//
// For each feature with non-trivial |w_j| (≥ 5% of max), report the
// implicit "ideal" feature value. Linear model is monotonic in the
// feature value: positive coefficient ⇒ "more is better" so the
// preferred range is high; negative ⇒ low. Confidence band derived from
// user-scoped training mean ± std.
function _regUserScopedFeatureSeries(sub) {
  const cfg = REG_SUBMODELS[sub];
  const uid = window._fbUserId;
  const userScoped = uid ? STATE.surfLog.filter(e => e.userId === uid) : STATE.surfLog;
  const out = [];
  for (const e of userScoped) {
    if (!e.conditions?.swell) continue;
    const f = cfg.extractor(e.conditions);
    const t = cfg.targetFn(e);
    if (!f || typeof t !== 'number' || !isFinite(t)) continue;
    out.push({ f, t });
  }
  return out;
}

function _regFmtFeatureValue(name, v) {
  const unit = regFeatureUnit(name);
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  if (unit === 'ft/hr') return (v >= 0 ? '+' : '') + v.toFixed(2) + ' ' + unit;
  if (unit === 'mph' || unit === 'ft') return v.toFixed(1) + unit;
  if (unit === 's') return v.toFixed(1) + unit;
  return v.toFixed(2);
}

function renderRegressionPreferred() {
  const container = el('reg-preferred');
  if (!container) return;
  const sub = _regActiveSubmodel;
  const cfg = REG_SUBMODELS[sub];
  const weights = STATE[cfg.weightsKey];
  const stats = STATE[cfg.statsKey];
  if (!weights || !stats) {
    container.innerHTML = '<div class="reg-empty sl-hint">' + cfg.title + ' isn\'t trained yet.</div>';
    return;
  }
  const series = _regUserScopedFeatureSeries(sub);
  if (!series.length) {
    container.innerHTML = '<div class="reg-empty sl-hint">No user-scoped sessions to summarise.</div>';
    return;
  }
  const maxAbs = weights.reduce((m, w) => Math.max(m, Math.abs(w)), 0);
  if (maxAbs < 1e-10) {
    container.innerHTML = '<div class="reg-empty sl-hint">All weights near zero.</div>';
    return;
  }
  const items = [];
  for (let j = 0; j < weights.length; j++) {
    const w = weights[j];
    if (Math.abs(w) / maxAbs < 0.05) continue;   // skip noise
    const name = cfg.featureNames[j] || ('f' + j);
    const col = series.map(r => r.f[j]);
    const fmin = Math.min(...col), fmax = Math.max(...col);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    // Top 25% subset for the "rated highest at" range — by target value.
    const sorted = series.slice().sort((a, b) => b.t - a.t);
    const topQuartile = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
    const topVals = topQuartile.map(r => r.f[j]);
    const topMin = Math.min(...topVals), topMax = Math.max(...topVals);
    const direction = w >= 0 ? 'higher' : 'lower';
    const preferredRange = w >= 0
      ? '> ' + _regFmtFeatureValue(name, mean)
      : '< ' + _regFmtFeatureValue(name, mean);
    const topRangeStr = '[' + _regFmtFeatureValue(name, topMin) + ', ' +
      _regFmtFeatureValue(name, topMax) + ']';
    items.push({
      sortKey: Math.abs(w) / maxAbs,
      name,
      label: regFeatureLabel(name),
      direction,
      preferredRange,
      topRangeStr,
      n: topVals.length
    });
  }
  if (!items.length) {
    container.innerHTML = '<div class="reg-empty sl-hint">No features cleared the 5% importance threshold.</div>';
    return;
  }
  items.sort((a, b) => b.sortKey - a.sortKey);
  container.innerHTML = items.map(it =>
    '<div class="reg-pref-row">' +
      '<span class="reg-pref-label">' + it.label + ':</span>' +
      ' prefers <strong>' + it.preferredRange + '</strong>' +
      ' <span class="reg-pref-detail">(your top ' + it.n + ' sessions: ' + it.topRangeStr + ')</span>' +
    '</div>'
  ).join('');
}

// ── Tab 2 §9: Fit metrics + residual chart ────────────────────────────
function _regHumanRefitAge(ms) {
  if (!ms) return '—';
  const ageS = (Date.now() - ms) / 1000;
  if (ageS < 60) return Math.max(1, Math.floor(ageS)) + 's ago';
  if (ageS < 3600) return Math.floor(ageS / 60) + ' min ago';
  if (ageS < 86400) return Math.floor(ageS / 3600) + 'h ago';
  return Math.floor(ageS / 86400) + 'd ago';
}

function renderRegressionFitMetrics() {
  const container = el('reg-fit-metrics');
  if (!container) return;
  const sub = _regActiveSubmodel;
  const cfg = REG_SUBMODELS[sub];
  const looData = _regLOOFor(sub);
  if (!looData.rows.length) {
    container.innerHTML = '<div class="reg-empty sl-hint">' + cfg.title + ' isn\'t trained yet.</div>';
    return;
  }
  const r2 = looData.r2 == null ? '—' : looData.r2.toFixed(2);
  const rmse = looData.rmse == null ? '—' : looData.rmse.toFixed(2);
  const baseline = looData.baselineRMSE == null ? '—' : looData.baselineRMSE.toFixed(2);
  let improvementHtml;
  let improvementWarning = '';
  if (looData.rmse != null && looData.baselineRMSE != null && looData.baselineRMSE > 0) {
    const improvement = 1 - looData.rmse / looData.baselineRMSE;
    const pct = Math.round(improvement * 100);
    if (improvement <= 0) {
      improvementHtml = '<span class="reg-fit-bad">' + pct + '%</span>';
      improvementWarning = '<div class="reg-fit-warning">⚠ Model is no better than guessing the mean. ' +
        'Consider logging more sessions or removing the model from match scoring.</div>';
    } else {
      improvementHtml = pct + '%';
    }
  } else {
    improvementHtml = '—';
  }
  const lastFit = _regHumanRefitAge(STATE._lastFitAt);
  const rowsHtml =
    '<div class="reg-fit-metric-row"><span class="reg-fit-key">R²:</span><span class="reg-fit-val">' + r2 + '</span></div>' +
    '<div class="reg-fit-metric-row"><span class="reg-fit-key">RMSE (LOO):</span><span class="reg-fit-val">' + rmse + '</span></div>' +
    '<div class="reg-fit-metric-row"><span class="reg-fit-key">Baseline RMSE:</span><span class="reg-fit-val">' + baseline + '</span></div>' +
    '<div class="reg-fit-metric-row"><span class="reg-fit-key">Improvement:</span><span class="reg-fit-val">' + improvementHtml + '</span></div>' +
    '<div class="reg-fit-metric-row"><span class="reg-fit-key">N sessions:</span><span class="reg-fit-val">' + looData.rows.length + '</span></div>' +
    '<div class="reg-fit-metric-row"><span class="reg-fit-key">Last refit:</span><span class="reg-fit-val">' + lastFit + '</span></div>';
  container.innerHTML = rowsHtml + improvementWarning;
}

const REG_RESID_W = 280, REG_RESID_H = 220;
const REG_RESID_PAD = { left: 36, right: 12, top: 16, bottom: 32 };

function renderRegressionResidual() {
  const container = el('reg-residual');
  if (!container) return;
  const sub = _regActiveSubmodel;
  const cfg = REG_SUBMODELS[sub];
  const looData = _regLOOFor(sub);
  container.innerHTML = '';
  const heading = document.createElement('div');
  heading.className = 'reg-residual-title';
  heading.textContent = 'Residuals — should hover around zero. Patterns indicate model bias.';
  container.appendChild(heading);
  if (!looData.rows.length) {
    const empty = document.createElement('div');
    empty.className = 'reg-empty sl-hint';
    empty.textContent = cfg.title + ' isn\'t trained yet.';
    container.appendChild(empty);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'reg-residual-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, REG_RESID_W, REG_RESID_H);
  const xMin = 0, xMax = 10, yMin = -5, yMax = 5;
  const pad = REG_RESID_PAD;
  const plotW = REG_RESID_W - pad.left - pad.right;
  const plotH = REG_RESID_H - pad.top - pad.bottom;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, REG_RESID_W, REG_RESID_H);
  // Axes
  ctx.strokeStyle = '#d0cbc3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, REG_RESID_H - pad.bottom);
  ctx.lineTo(REG_RESID_W - pad.right, REG_RESID_H - pad.bottom);
  ctx.stroke();
  // Tick labels
  ctx.fillStyle = '#8a827a';
  ctx.font = '10px DM Mono, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [-5, -2.5, 0, 2.5, 5]) {
    const y = pad.top + plotH * (1 - (v - yMin) / (yMax - yMin));
    ctx.fillText(String(v), pad.left - 4, y);
    ctx.strokeStyle = v === 0 ? '#a8a098' : '#f0ece6';
    ctx.beginPath();
    if (v === 0) ctx.setLineDash([4, 3]);
    ctx.moveTo(pad.left, y);
    ctx.lineTo(REG_RESID_W - pad.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of [0, 5, 10]) {
    const x = pad.left + plotW * ((v - xMin) / (xMax - xMin));
    ctx.fillText(String(v), x, REG_RESID_H - pad.bottom + 4);
  }
  ctx.fillStyle = '#5c554d';
  ctx.fillText('Predicted', pad.left + plotW / 2, REG_RESID_H - 14);
  ctx.save();
  ctx.translate(10, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'bottom';
  ctx.fillText('Residual', 0, 0);
  ctx.restore();
  // Dots
  const projected = [];
  for (const row of looData.rows) {
    const resid = row.target - row.pred;
    const px = pad.left + plotW * ((row.pred - xMin) / (xMax - xMin));
    const py = pad.top + plotH * (1 - (resid - yMin) / (yMax - yMin));
    ctx.fillStyle = REG_DOT_FILL;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, REG_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    projected.push({ px, py, row });
  }
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    for (const p of projected) {
      const d = Math.hypot(mx - p.px, my - p.py);
      if (d <= REG_DOT_RADIUS + 3) {
        if (typeof openRegressionDrilldown === 'function') {
          openRegressionDrilldown(p.row.entry, sub);
        }
        return;
      }
    }
  });
}

// Per-submodel surfaces: per-feature scatters, importance bars, preferred
// conditions, fit metrics, residual chart. Dispatcher calls each one if it
// has shipped (renderers added incrementally per Prompt #5 commit order).
function _regUpdateSubmodelSurfaces() {
  ['renderRegressionFeatureGrid',
   'renderRegressionImportance',
   'renderRegressionPreferred',
   'renderRegressionFitMetrics',
   'renderRegressionResidual'].forEach(name => {
    const fn = window[name];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.warn('[reg]', name, e); }
    }
  });
}

// ── Tab 2 §3: "If I went at scrubbed time" prediction widget ──────────
//
// Reads the scrubbed hour index from STATE.scrubberIdx (or the persisted
// sessionStorage hour). Pulls the same cached marine/wind/tide data Tab 1
// uses, runs buildForecastConditions + the three predict* helpers, and
// renders three rating bars with forecast detail.
function _regResolveScrubberHour() {
  const cs = STATE.forecastChart;
  const marine = STATE._cachedMarine, wind = STATE._cachedWind;
  if (!marine?.hourly?.time?.length || !wind?.hourly) return null;
  let idx = (typeof STATE.scrubberIdx === 'number' && STATE.scrubberIdx >= 0)
    ? STATE.scrubberIdx
    : -1;
  // Fall back to sessionStorage if scrubber state isn't initialized yet.
  if (idx < 0) {
    let stored = null;
    try { stored = sessionStorage.getItem('lcc-scrubber-hour'); } catch (_) {}
    if (stored && cs) {
      const targetMs = new Date(stored).getTime();
      if (Number.isFinite(targetMs)) idx = findHourIndexForTime(targetMs, cs);
    }
  }
  if (idx < 0) {
    // Default to "now" — find the hour closest to now in marine.hourly.time.
    const now = Date.now();
    const times = marine.hourly.time;
    let best = 0, bd = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(new Date(times[i]).getTime() - now);
      if (d < bd) { bd = d; best = i; }
    }
    idx = best;
  }
  return idx;
}

function _regRatingBar(label, value) {
  const v = (typeof value === 'number' && isFinite(value)) ? value : null;
  const filled = v == null ? 0 : Math.max(0, Math.min(10, Math.round(v)));
  const dots = [];
  for (let i = 0; i < 10; i++) {
    dots.push('<span class="reg-dot' + (i < filled ? ' filled' : '') + '"></span>');
  }
  const right = v == null ? '<span class="reg-rating-empty">— / 10 · needs more sessions</span>'
    : '<span class="reg-rating-num">' + v.toFixed(1) + ' / 10</span>';
  return '<div class="reg-rating-row">' +
    '<span class="reg-rating-label">' + label + '</span>' +
    '<span class="reg-rating-dots">' + dots.join('') + '</span>' +
    right +
    '</div>';
}

function _regForecastSummaryLine(cond) {
  if (!cond?.swell) return '';
  const s = cond.swell, w = cond.wind || {}, t = cond.tide || {};
  const swH = (s.height != null) ? s.height.toFixed(1) + 'ft' : '—';
  const swP = (s.period != null) ? s.period.toFixed(1) + 's' : '—';
  const swD = (s.direction != null) ? directionLabel(s.direction) : '—';
  const wSpd = (w.speed != null) ? Math.round(w.speed) : '—';
  const wDir = (w.direction != null) ? directionLabel(w.direction) : '';
  const tH = (t.height != null) ? (t.height >= 0 ? '+' : '') + t.height.toFixed(1) + 'ft' : '—';
  return 'Forecast: ' + swH + ' @ ' + swP + ' ' + swD + ' · wind ' + wSpd + 'mph ' + wDir + ' · tide ' + tH;
}

function _regHeaderLabelForHour(hourMs) {
  const cs = STATE.forecastChart;
  const nowIdx = cs ? findHourIndexForTime(Date.now(), cs) : -1;
  const t = new Date(hourMs);
  const dayMs = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const todayMs = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); })();
  const diffDays = Math.round((dayMs - todayMs) / 86400000);
  const isNow = (cs && nowIdx >= 0 && cs.times && cs.times[nowIdx] && cs.times[nowIdx].getTime() === t.getTime());
  if (isNow) return 'IF I WENT NOW';
  let dayLabel;
  if (diffDays === 0) dayLabel = 'Today';
  else if (diffDays === 1) dayLabel = 'Tomorrow';
  else dayLabel = t.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  const timeLabel = formatTime(t);
  return 'IF I WENT AT ' + dayLabel + ', ' + timeLabel.replace(/\s/g, '');
}

function renderRegressionPredictionWidget() {
  const card = el('reg-prediction-card');
  if (!card) return;
  const marine = STATE._cachedMarine, wind = STATE._cachedWind, tideHiLo = STATE._cachedTideHiLo, tidePred = STATE._cachedTidePred;
  if (!marine?.hourly || !wind?.hourly) {
    card.innerHTML = '<div class="reg-prediction-empty sl-hint">Forecast not loaded yet — predictions will appear once the chart is populated.</div>';
    return;
  }
  const idx = _regResolveScrubberHour();
  if (idx == null || idx < 0) {
    card.innerHTML = '<div class="reg-prediction-empty sl-hint">Couldn\'t resolve the scrubbed hour.</div>';
    return;
  }
  const hourTimeStr = marine.hourly.time?.[idx];
  if (!hourTimeStr) {
    card.innerHTML = '<div class="reg-prediction-empty sl-hint">Hour out of range.</div>';
    return;
  }
  const cond = buildForecastConditions(marine, wind, tideHiLo, tidePred, idx);
  const wf = cond ? extractWaveFeatures(cond) : null;
  const rf = cond ? extractRideFeatures(cond) : null;
  const cf = cond ? extractCondFeatures(cond) : null;
  const wavePred = wf ? predictWaveRating(wf) : null;
  const ridePred = rf ? predictRideRating(rf) : null;
  const condPred = cf ? predictCondRating(cf) : null;
  const header = _regHeaderLabelForHour(new Date(hourTimeStr).getTime());
  const bars = _regRatingBar('Wave size', wavePred) +
    _regRatingBar('Ride quality', ridePred) +
    _regRatingBar('Wind/conditions', condPred);
  const summary = _regForecastSummaryLine(cond);
  card.innerHTML = '<div class="reg-prediction-header">' + header + '</div>' +
    '<div class="reg-prediction-bars">' + bars + '</div>' +
    (summary ? '<div class="reg-prediction-summary">' + summary + '</div>' : '');
}

// Lightweight notify hook called by applyScrubberToHour so Tab 2 can
// re-render the scrubber-tracking surfaces.
function _regNotifyScrubberMoved() {
  if (STATE.activeTab !== 'regression') return;
  try { renderRegressionPredictionWidget(); } catch (_) {}
  try { _regUpdateThresholdLights(); } catch (_) {}
  try { renderRegressionFeatureGrid(); } catch (_) {}
}

// ── Tab 2: Sub-model registry ─────────────────────────────────────────
//
// Centralises the three sub-models so per-feature/per-importance/etc.
// renderers can pivot off a single source of truth.
const REG_SUBMODELS = {
  wave: {
    label: 'Wave',
    title: 'Wave model',
    target: 'size',
    targetLabel: 'Size rating',
    extractor: extractWaveFeatures,
    targetFn: e => e.ratings && e.ratings.size,
    featureNames: WAVE_FEATURE_NAMES,
    weightsKey: 'surfLogWaveWeights',
    statsKey: 'surfLogWaveStats',
    rmseKey: 'surfLogWaveValidation',
    predict: predictWaveRating
  },
  ride: {
    label: 'Ride',
    title: 'Ride model',
    target: 'rideQuality',
    targetLabel: 'Ride rating',
    extractor: extractRideFeatures,
    targetFn: e => e.ratings && e.ratings.rideQuality,
    featureNames: RIDE_FEATURE_NAMES,
    weightsKey: 'surfLogRideWeights',
    statsKey: 'surfLogRideStats',
    rmseKey: 'surfLogRideValidation',
    predict: predictRideRating
  },
  cond: {
    label: 'Conditions',
    title: 'Conditions model',
    target: 'windQuality',
    targetLabel: 'Wind quality rating',
    extractor: extractCondFeatures,
    targetFn: e => e.ratings && e.ratings.windQuality,
    featureNames: COND_FEATURE_NAMES,
    weightsKey: 'surfLogCondWeights',
    statsKey: 'surfLogCondStats',
    rmseKey: 'surfLogCondValidation',
    predict: predictCondRating
  }
};

// Human-readable feature names. Underscore form falls through unchanged.
const REG_FEATURE_LABELS = {
  effective_in_window_height: 'Effective swell height (aligned, with edge softening)',
  effective_in_window_period: 'Effective swell period (aligned, with edge softening)',
  total_swell_height: 'Total swell height (any direction)',
  tide_height: 'Tide height',
  tide_rate: 'Tide rate (incoming/outgoing)',
  wind_speed: 'Wind speed',
  wind_offshore: 'Wind offshoreness'
};
const REG_FEATURE_UNITS = {
  effective_in_window_height: 'ft',
  effective_in_window_period: 's',
  total_swell_height: 'ft',
  tide_height: 'ft',
  tide_rate: 'ft/hr',
  wind_speed: 'mph',
  wind_offshore: ''
};
function regFeatureLabel(name) { return REG_FEATURE_LABELS[name] || name; }
function regFeatureUnit(name) { return REG_FEATURE_UNITS[name] || ''; }

// Returns { id, timestamp, isOwn, displayName, x, target, features } for the
// user-scoped training set, plus the leave-one-out prediction at the
// held-out index. Mirrors leaveOneOutRMSE at app.js:4813 — same fold layout
// — so the per-session predictions reconcile with the surfaced LOO RMSE.
function _regComputeLOOData(sub) {
  const cfg = REG_SUBMODELS[sub];
  const uid = window._fbUserId;
  const userScoped = uid ? STATE.surfLog.filter(e => e.userId === uid) : STATE.surfLog;
  const entries = userScoped.filter(e => e.conditions?.swell);
  const rows = [];
  for (const e of entries) {
    const f = cfg.extractor(e.conditions);
    const t = cfg.targetFn(e);
    if (!f || typeof t !== 'number' || !isFinite(t)) continue;
    rows.push({ entry: e, features: f, target: t });
  }
  if (!rows.length) return { rows: [], r2: null, rmse: null, baselineRMSE: null, n: 0 };
  const X = rows.map(r => r.features);
  const y = rows.map(r => r.target);
  const nF = X[0].length;
  const minSamples = Math.max(2 * nF, 12);
  if (X.length < minSamples + 1) {
    return { rows: [], r2: null, rmse: null, baselineRMSE: null, n: rows.length };
  }
  const preds = new Array(X.length).fill(null);
  for (let h = 0; h < X.length; h++) {
    const Xtr = X.slice(0, h).concat(X.slice(h + 1));
    const ytr = y.slice(0, h).concat(y.slice(h + 1));
    const m = _trainOnArrays(Xtr, ytr);
    if (!m) continue;
    let p = m.stats.targetMean;
    for (let j = 0; j < nF; j++) {
      const z = m.stats.std[j] > 1e-10 ? (X[h][j] - m.stats.mean[j]) / m.stats.std[j] : 0;
      p += m.weights[j] * z;
    }
    preds[h] = p;
  }
  // Aggregate metrics
  let sse = 0, n = 0, sum = 0;
  for (let i = 0; i < y.length; i++) {
    if (preds[i] == null) continue;
    sum += y[i]; n++;
  }
  if (!n) return { rows: [], r2: null, rmse: null, baselineRMSE: null, n: rows.length };
  const yMean = sum / n;
  let ssTot = 0;
  for (let i = 0; i < y.length; i++) {
    if (preds[i] == null) continue;
    sse += (preds[i] - y[i]) * (preds[i] - y[i]);
    ssTot += (y[i] - yMean) * (y[i] - yMean);
  }
  const rmse = Math.sqrt(sse / n);
  const baselineRMSE = Math.sqrt(ssTot / n);
  const r2 = ssTot > 1e-10 ? 1 - sse / ssTot : null;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (preds[i] == null) continue;
    out.push({
      id: rows[i].entry.id,
      entry: rows[i].entry,
      timestamp: rows[i].entry.timestamp,
      target: rows[i].target,
      pred: preds[i],
      features: rows[i].features
    });
  }
  return { rows: out, r2, rmse, baselineRMSE, n: rows.length };
}

// Cache so we don't re-run LOO for every panel that needs it.
let _regLOOCache = { wave: null, ride: null, cond: null, key: null };
function _regLOOFor(sub) {
  // Bust cache when the underlying training set changes (use _lastFitAt + n
  // as a lightweight version stamp).
  const key = (STATE._lastFitAt || 0) + ':' + (STATE._lastFitN || 0);
  if (_regLOOCache.key !== key) {
    _regLOOCache = { wave: null, ride: null, cond: null, key };
  }
  if (!_regLOOCache[sub]) _regLOOCache[sub] = _regComputeLOOData(sub);
  return _regLOOCache[sub];
}

// ── Tab 2 §4: Predicted-vs-actual scatter plots (3 sub-models) ────────
//
// Hand-rolled Canvas 2D scatter — one per sub-model. Diagonal y=x reference,
// dot-per-session, R²/RMSE/n caption coloured by R² band.

const REG_SCATTER_W = 280, REG_SCATTER_H = 280;
const REG_SCATTER_PAD = { left: 36, right: 12, top: 18, bottom: 32 };
const REG_DOT_RADIUS = 5;
const REG_DOT_FILL = 'rgba(90, 127, 160, 0.7)';   // primary swell blue, alpha 0.7
const REG_DOT_FILL_OWN = 'rgba(90, 127, 160, 0.7)';
const REG_DOT_FILL_OTHER = 'rgba(160, 152, 144, 0.4)';

function _regDrawScatterAxes(ctx, w, h, opts) {
  const pad = REG_SCATTER_PAD;
  const xMin = opts.xMin, xMax = opts.xMax, yMin = opts.yMin, yMax = opts.yMax;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // Axes
  ctx.strokeStyle = '#d0cbc3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, h - pad.bottom);
  ctx.lineTo(w - pad.right, h - pad.bottom);
  ctx.stroke();
  // Tick labels
  ctx.fillStyle = '#8a827a';
  ctx.font = '10px DM Mono, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yTicks = opts.yTicks || [0, 5, 10];
  for (const v of yTicks) {
    const y = pad.top + plotH * (1 - (v - yMin) / (yMax - yMin));
    ctx.fillText(String(v), pad.left - 4, y);
    ctx.strokeStyle = '#f0ece6';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = opts.xTicks || [0, 5, 10];
  for (const v of xTicks) {
    const x = pad.left + plotW * ((v - xMin) / (xMax - xMin));
    ctx.fillText(String(v), x, h - pad.bottom + 4);
  }
  // Axis labels
  ctx.fillStyle = '#5c554d';
  ctx.font = '10px DM Mono, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(opts.xLabel || '', pad.left + plotW / 2, h - 2);
  ctx.save();
  ctx.translate(10, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(opts.yLabel || '', 0, 0);
  ctx.restore();
  ctx.restore();
  return { plotW, plotH };
}

function _regProjectXY(v, opts, plotW, plotH) {
  const pad = REG_SCATTER_PAD;
  const x = pad.left + plotW * ((v.x - opts.xMin) / (opts.xMax - opts.xMin));
  const y = pad.top + plotH * (1 - (v.y - opts.yMin) / (opts.yMax - opts.yMin));
  return { x, y };
}

function _regR2Color(r2) {
  if (r2 == null || !isFinite(r2)) return 'var(--ink3)';
  if (r2 > 0.5) return 'var(--green)';
  if (r2 >= 0.2) return 'var(--orange)';
  return 'var(--red-m)';
}

function _regBuildScatterCanvas(sub, looData) {
  const cfg = REG_SUBMODELS[sub];
  const wrap = document.createElement('div');
  wrap.className = 'reg-scatter';
  wrap.dataset.sub = sub;
  const title = document.createElement('div');
  title.className = 'reg-scatter-title';
  title.textContent = cfg.title;
  wrap.appendChild(title);
  if (!looData.rows.length) {
    const empty = document.createElement('div');
    empty.className = 'reg-scatter-empty sl-hint';
    const minSamples = Math.max(2 * cfg.featureNames.length, 12) + 1;
    empty.textContent = looData.n < minSamples
      ? 'Need ' + (minSamples - looData.n) + ' more session' + ((minSamples - looData.n) === 1 ? '' : 's') + ' to train this model.'
      : 'Not enough data to plot.';
    wrap.appendChild(empty);
    return wrap;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'reg-scatter-canvas';
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, REG_SCATTER_W, REG_SCATTER_H);
  const opts = {
    xMin: 0, xMax: 10, yMin: 0, yMax: 10,
    xTicks: [0, 5, 10], yTicks: [0, 5, 10],
    xLabel: 'Predicted', yLabel: 'Actual'
  };
  const { plotW, plotH } = _regDrawScatterAxes(ctx, REG_SCATTER_W, REG_SCATTER_H, opts);
  // Diagonal y=x reference (perfect prediction line)
  const pad = REG_SCATTER_PAD;
  ctx.save();
  ctx.strokeStyle = '#c0bab2';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  const a = _regProjectXY({ x: 0, y: 0 }, opts, plotW, plotH);
  const b = _regProjectXY({ x: 10, y: 10 }, opts, plotW, plotH);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Dots
  const points = [];
  for (const row of looData.rows) {
    const px = pad.left + plotW * (row.pred / 10);
    const py = pad.top + plotH * (1 - row.target / 10);
    ctx.beginPath();
    ctx.fillStyle = REG_DOT_FILL;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.arc(px, py, REG_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    points.push({ px, py, row });
  }
  ctx.restore();
  // Caption
  const cap = document.createElement('div');
  cap.className = 'reg-scatter-caption';
  const r2Class = looData.r2 == null ? 'reg-r2-na'
    : looData.r2 > 0.5 ? 'reg-r2-good'
    : looData.r2 >= 0.2 ? 'reg-r2-fair'
    : 'reg-r2-bad';
  const r2Str = looData.r2 == null ? '—' : looData.r2.toFixed(2);
  const rmseStr = looData.rmse == null ? '—' : looData.rmse.toFixed(2);
  cap.innerHTML = '<span class="reg-r2 ' + r2Class + '">R² ' + r2Str + '</span>'
    + ' · RMSE ' + rmseStr
    + ' · n=' + looData.rows.length;
  wrap.appendChild(cap);
  // Hover + click → drill-down (drill-down panel is a separate prompt, but
  // wire the click target so commit 4 has the entry available).
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let hit = null;
    for (const p of points) {
      const d = Math.hypot(mx - p.px, my - p.py);
      if (d <= REG_DOT_RADIUS + 3) { hit = p; break; }
    }
    canvas.title = hit
      ? new Date(hit.row.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        + ' · pred ' + hit.row.pred.toFixed(1) + ' / actual ' + hit.row.target.toFixed(1)
      : '';
  });
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    for (const p of points) {
      const d = Math.hypot(mx - p.px, my - p.py);
      if (d <= REG_DOT_RADIUS + 3) {
        if (typeof openRegressionDrilldown === 'function') {
          openRegressionDrilldown(p.row.entry, sub);
        }
        return;
      }
    }
  });
  return wrap;
}

function renderRegressionPVA() {
  const grid = el('reg-pva-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const sub of ['wave', 'ride', 'cond']) {
    const looData = _regLOOFor(sub);
    grid.appendChild(_regBuildScatterCanvas(sub, looData));
  }
}

// ── Tab 2 §11: Drill-down side panel ──────────────────────────────────
//
// Shared overlay rendered for any dot click. The structure is built in
// commit 4; per-feature attribution (the most informative section) is
// layered on in commit 5.

let _regDrilldownState = { entry: null, sub: 'wave', photoIdx: 0 };

function _regFmtConditionsBlock(cond) {
  if (!cond) return '<div class="reg-drill-empty sl-hint">No conditions recorded</div>';
  const s = cond.swell || {}, w = cond.wind || {}, t = cond.tide || {};
  const swellH = (s.height != null ? s.height.toFixed(1) : '—') + 'ft';
  const swellP = (s.period != null ? s.period.toFixed(1) : '—') + 's';
  const swellD = (s.direction != null ? directionLabel(s.direction) + ' (' + Math.round(s.direction) + '°)' : '—');
  const secLine = s.secondary
    ? '<div class="reg-drill-line"><span class="reg-drill-key">Secondary:</span> ' +
      (s.secondary.height != null ? s.secondary.height.toFixed(1) + 'ft' : '—') + ' @ ' +
      (s.secondary.period != null ? s.secondary.period.toFixed(1) + 's' : '—') + ' · ' +
      (s.secondary.direction != null ? directionLabel(s.secondary.direction) : '—') + '</div>'
    : '';
  const windLine = (w.speed != null ? Math.round(w.speed) : '—') + 'mph · ' +
    (w.direction != null ? directionLabel(w.direction) : '—') +
    (w.direction != null ? ' (' + Math.round(w.direction) + '°)' : '');
  const tideLine = (t.height != null ? (t.height >= 0 ? '+' : '') + t.height.toFixed(1) + 'ft' : '—') +
    ' · ' + (t.stage || '—') +
    (typeof t.rate === 'number' ? ' · ' + (t.rate >= 0 ? '+' : '') + t.rate.toFixed(2) + ' ft/hr' : '') +
    (t.timeToNearest != null ? ' · time to nearest: ' + t.timeToNearest + 'h' : '');
  let sourceLabel;
  if (cond.source === 'openmeteo-archive')              sourceLabel = 'Open-Meteo archive (reanalysis)';
  else if (cond.source === 'ndbc-stdmet+openmeteo-wind') sourceLabel = 'NDBC buoy 44097 swell + Open-Meteo archive wind';
  else if (cond.source === 'ndbc-stdmet')               sourceLabel = 'NDBC buoy 44097 (measured, stdmet historical)';
  else if (cond.source === 'ndbc')                      sourceLabel = 'NDBC buoy 44097 (measured)';
  else                                                  sourceLabel = 'Open-Meteo marine API';
  return '<div class="reg-drill-line"><span class="reg-drill-key">Swell:</span> ' + swellH + ' @ ' + swellP + ' · ' + swellD + '</div>' +
    secLine +
    '<div class="reg-drill-line"><span class="reg-drill-key">Wind:</span> ' + windLine + '</div>' +
    '<div class="reg-drill-line"><span class="reg-drill-key">Tide:</span> ' + tideLine + '</div>' +
    '<div class="reg-drill-line reg-drill-source">Source: ' + sourceLabel + '</div>';
}

function _regFmtRatingsBlock(entry, isOwn) {
  const r = entry.ratings || {};
  const stats = STATE.surfLogWaveStats;
  // Each predicted rating + residual: actual − predicted.
  const wf = entry.conditions ? extractWaveFeatures(entry.conditions) : null;
  const rf = entry.conditions ? extractRideFeatures(entry.conditions) : null;
  const cf = entry.conditions ? extractCondFeatures(entry.conditions) : null;
  const wPred = wf ? predictWaveRating(wf) : null;
  const rPred = rf ? predictRideRating(rf) : null;
  const cPred = cf ? predictCondRating(cf) : null;
  const row = (label, actual, pred) => {
    const aStr = (typeof actual === 'number') ? actual.toFixed(1) : '—';
    const pStr = (typeof pred === 'number') ? pred.toFixed(1) : '—';
    const resStr = (typeof actual === 'number' && typeof pred === 'number')
      ? (() => { const r = actual - pred; return (r >= 0 ? '+' : '') + r.toFixed(1); })()
      : '—';
    return '<div class="reg-drill-rating-row">' +
      '<span class="reg-drill-rating-label">' + label + ':</span>' +
      '<span>actual <strong>' + aStr + '</strong></span>' +
      '<span>predicted <strong>' + pStr + '</strong></span>' +
      '<span class="reg-drill-resid">(residual ' + resStr + ')</span>' +
      '</div>';
  };
  const heading = isOwn ? 'Your ratings vs predicted' : 'Their ratings vs predicted';
  return '<div class="reg-drill-section-heading">' + heading + '</div>' +
    row('Wave size', r.size, wPred) +
    row('Ride quality', r.rideQuality, rPred) +
    row('Wind/conditions', r.windQuality, cPred);
}

// Per-feature attribution: contribution_j = w_j × ((feature_value − mean_j) / std_j)
// Predictions computed manually here (rather than via _predict) so we can
// also report the unbounded sum before the [1, 10] clamp at app.js:5054.
function _regBuildAttribution(entry, sub) {
  const cfg = REG_SUBMODELS[sub] || REG_SUBMODELS.wave;
  const weights = STATE[cfg.weightsKey];
  const stats = STATE[cfg.statsKey];
  if (!weights || !stats) {
    return '<div class="reg-drill-section-heading">Per-feature attribution</div>' +
      '<div class="reg-drill-empty sl-hint">' + cfg.title + ' isn\'t trained yet — log more sessions.</div>';
  }
  const features = cfg.extractor(entry.conditions);
  if (!features) {
    return '<div class="reg-drill-section-heading">Per-feature attribution</div>' +
      '<div class="reg-drill-empty sl-hint">No conditions on this session.</div>';
  }
  const targetMean = stats.targetMean || 0;
  const contribs = [];
  let sumContrib = 0;
  for (let j = 0; j < features.length; j++) {
    const sd = stats.std[j];
    const z = sd > 1e-10 ? (features[j] - stats.mean[j]) / sd : 0;
    const w = weights[j];
    const c = w * z;
    sumContrib += c;
    contribs.push({
      name: cfg.featureNames[j] || ('f' + j),
      label: regFeatureLabel(cfg.featureNames[j] || ''),
      z, w, contribution: c
    });
  }
  const predictedRaw = targetMean + sumContrib;
  const predictedBounded = Math.max(1, Math.min(10, Math.round(predictedRaw * 10) / 10));
  contribs.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = contribs.slice(0, 5);
  const subModelTitle = cfg.title;
  const rows = top.map(c => {
    const sign = c.contribution >= 0 ? '+' : '−';
    const cls = c.contribution >= 0 ? 'reg-attr-pos' : 'reg-attr-neg';
    const mag = Math.abs(c.contribution).toFixed(1);
    const zStr = (c.z >= 0 ? '+' : '') + c.z.toFixed(2);
    const wStr = (c.w >= 0 ? '+' : '') + c.w.toFixed(2);
    return '<div class="reg-attr-row ' + cls + '">' +
      '<span class="reg-attr-sign">' + sign + '</span>' +
      '<span class="reg-attr-mag">' + mag + '</span>' +
      '<span class="reg-attr-name">' + c.label + '</span>' +
      '<span class="reg-attr-detail">(z ' + zStr + ' × w ' + wStr + ')</span>' +
      '</div>';
  }).join('');
  const sumStr = (sumContrib >= 0 ? '+' : '') + sumContrib.toFixed(2);
  const reconcile = '<div class="reg-attr-reconcile sl-hint">' +
    'Sum ' + sumStr + ' + target mean ' + targetMean.toFixed(2) +
    ' = predicted ' + predictedRaw.toFixed(2) +
    ' → bounded to ' + predictedBounded.toFixed(1) +
    '</div>';
  const tip = 'Each feature\'s contribution to the prediction. Positive contributions push the prediction up; negative push it down.';
  return '<div class="reg-drill-section-heading">Per-feature attribution <span class="reg-tooltip" title="' + tip + '">?</span></div>' +
    '<div class="reg-attr-summary">' + subModelTitle + ' predicted ' + predictedBounded.toFixed(1) +
    ' (target mean: ' + targetMean.toFixed(1) + ')</div>' +
    '<div class="reg-attr-list">' + rows + '</div>' +
    reconcile;
}
// Compatibility shim — older call sites invoked the placeholder name.
function _regBuildAttributionPlaceholder(entry, sub) {
  return _regBuildAttribution(entry, sub);
}

// ── Tab 2 §5: Match threshold tuning ──────────────────────────────────
//
// Three independent sliders (wave / ride / cond), 0–100 step 5, default 60.
// Stored at lcc-match-threshold-{wave,ride,cond}. Live preview light shows
// how the currently-scrubbed hour scores against the user's average past
// session — green ≥ threshold, yellow ≥ (threshold − 15), red otherwise.
const REG_THRESHOLD_KEYS = {
  wave: 'lcc-match-threshold-wave',
  ride: 'lcc-match-threshold-ride',
  cond: 'lcc-match-threshold-cond'
};
function _regGetThreshold(sub) {
  let raw = null;
  try { raw = localStorage.getItem(REG_THRESHOLD_KEYS[sub]); } catch (_) {}
  const v = parseInt(raw, 10);
  return (isFinite(v) && v >= 0 && v <= 100) ? v : 60;
}
function _regSetThreshold(sub, v) {
  try { localStorage.setItem(REG_THRESHOLD_KEYS[sub], String(v)); } catch (_) {}
}

// Computes the best match score at the scrubbed hour for the given sub-
// model: pick the past session whose features are closest to the scrubbed-
// hour features under the current sub-model's match formula.
function _regBestMatchAtScrub(sub) {
  const cfg = REG_SUBMODELS[sub];
  const marine = STATE._cachedMarine, wind = STATE._cachedWind, tideHiLo = STATE._cachedTideHiLo, tidePred = STATE._cachedTidePred;
  if (!marine?.hourly || !wind?.hourly) return null;
  const idx = _regResolveScrubberHour();
  if (idx == null || idx < 0) return null;
  const fc = buildForecastConditions(marine, wind, tideHiLo, tidePred, idx);
  if (!fc) return null;
  const ff = cfg.extractor(fc);
  if (!ff) return null;
  const stats = STATE[cfg.statsKey];
  const weights = STATE[cfg.weightsKey];
  if (!stats) return null;
  const uid = window._fbUserId;
  const userScoped = uid ? STATE.surfLog.filter(e => e.userId === uid) : STATE.surfLog;
  let best = 0;
  for (const e of userScoped) {
    if (!e.conditions?.swell) continue;
    const ef = cfg.extractor(e.conditions);
    if (!ef) continue;
    const m = _matchPct(ef, ff, weights, stats);
    if (m > best) best = m;
  }
  return best;
}

function _regThresholdLightClass(matchPct, threshold) {
  if (matchPct == null) return 'reg-light-none';
  if (matchPct >= threshold) return 'reg-light-green';
  if (matchPct >= threshold - 15) return 'reg-light-yellow';
  return 'reg-light-red';
}

function renderRegressionThresholds() {
  const panel = el('reg-threshold-panel');
  if (!panel) return;
  const rows = ['wave', 'ride', 'cond'].map(sub => {
    const cfg = REG_SUBMODELS[sub];
    const v = _regGetThreshold(sub);
    const lbl = sub === 'wave' ? 'Wave (size match)'
      : sub === 'ride' ? 'Ride (quality match)'
      : 'Conditions match';
    return '<div class="reg-threshold-row" data-sub="' + sub + '">' +
      '<label class="reg-threshold-label" for="reg-thresh-' + sub + '">' + lbl + '</label>' +
      '<input type="range" id="reg-thresh-' + sub + '" class="reg-threshold-slider" ' +
        'min="0" max="100" step="5" value="' + v + '" data-sub="' + sub + '">' +
      '<span class="reg-threshold-value" id="reg-thresh-val-' + sub + '">' + v + '%</span>' +
      '<span class="reg-threshold-light" id="reg-thresh-light-' + sub + '"></span>' +
      '<span class="reg-threshold-pct" id="reg-thresh-pct-' + sub + '"></span>' +
      '</div>';
  }).join('');
  panel.innerHTML = rows;
  for (const sub of ['wave', 'ride', 'cond']) {
    const slider = el('reg-thresh-' + sub);
    if (!slider) continue;
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      _regSetThreshold(sub, v);
      const valEl = el('reg-thresh-val-' + sub);
      if (valEl) valEl.textContent = v + '%';
      _regUpdateThresholdLights();
    });
  }
  _regUpdateThresholdLights();
}

function _regUpdateThresholdLights() {
  for (const sub of ['wave', 'ride', 'cond']) {
    const lightEl = el('reg-thresh-light-' + sub);
    const pctEl = el('reg-thresh-pct-' + sub);
    if (!lightEl) continue;
    const threshold = _regGetThreshold(sub);
    const matchPct = _regBestMatchAtScrub(sub);
    lightEl.className = 'reg-threshold-light ' + _regThresholdLightClass(matchPct, threshold);
    if (pctEl) pctEl.textContent = matchPct == null ? '—' : matchPct + '%';
  }
}

function openRegressionDrilldown(entry, sub) {
  if (!entry) return;
  _regDrilldownState = { entry, sub: sub || 'wave', photoIdx: 0 };
  const panel = el('reg-drilldown');
  const backdrop = el('reg-drilldown-backdrop');
  const inner = el('reg-drilldown-inner');
  if (!panel || !inner) return;
  const isOwn = entry.userId === window._fbUserId;
  const dt = new Date(entry.timestamp);
  const dtStr = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + formatTime(dt);
  const photos = (entry.photos || []).map(p => photoUrl(p) || p).filter(Boolean);
  const photoBlock = photos.length
    ? '<div class="reg-drill-photo-wrap">' +
      '<img class="reg-drill-photo" src="' + photos[0] + '" alt="Session photo" onerror="this.style.display=\'none\'">' +
      (photos.length > 1 ? '<span class="reg-drill-photo-counter">1/' + photos.length + '</span>' : '') +
      '</div>'
    : '';
  const communityBadge = !isOwn ? '<span class="reg-drill-badge">from community log</span>' : '';
  const loggedBy = isOwn ? 'you' : (entry.displayName || 'Anonymous');
  const notesBlock = entry.notes
    ? '<div class="reg-drill-section"><div class="reg-drill-section-heading">Notes</div><div class="reg-drill-notes">' +
      entry.notes.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</div></div>'
    : '';

  panel.setAttribute('data-w1-title', 'Session detail · ' + dtStr);
  inner.innerHTML =
    '<div class="reg-drill-header">' +
      '<div class="reg-drill-header-text">' +
        '<div class="reg-drill-date">' + dtStr + '</div>' +
        '<div class="reg-drill-meta">Logged by ' + loggedBy + ' ' + communityBadge + '</div>' +
      '</div>' +
      '<button class="reg-drill-close" id="reg-drill-close" aria-label="Close">&times;</button>' +
    '</div>' +
    photoBlock +
    '<div class="reg-drill-section">' + _regFmtRatingsBlock(entry, isOwn) + '</div>' +
    '<div class="reg-drill-section">' +
      '<div class="reg-drill-section-heading">Conditions snapshot</div>' +
      _regFmtConditionsBlock(entry.conditions) +
    '</div>' +
    '<div class="reg-drill-section">' + _regBuildAttributionPlaceholder(entry, _regDrilldownState.sub) + '</div>' +
    notesBlock +
    '<div class="reg-drill-section reg-drill-footer">' +
      '<a href="#" class="reg-drill-link" id="reg-drill-open-log">Open in surf log →</a>' +
    '</div>';
  panel.style.display = '';
  panel.setAttribute('aria-hidden', 'false');
  if (backdrop) backdrop.style.display = '';
  // Reflow so the slide-in transition fires.
  // eslint-disable-next-line no-unused-expressions
  panel.offsetWidth;
  panel.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  el('reg-drill-close')?.addEventListener('click', closeRegressionDrilldown);
  el('reg-drill-open-log')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    closeRegressionDrilldown();
    if (typeof switchTab === 'function') switchTab('surflog');
    setTimeout(() => {
      const tbody = el('surflog-tbody');
      if (!tbody) return;
      // Match by inspecting Edit button data-id (rendered for own rows) — for
      // community rows, fall back to scrolling to the table top.
      const target = tbody.querySelector('button[data-id="' + entry.id + '"]');
      const row = target ? target.closest('tr') : null;
      (row || el('panel-surflog-entries'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  });
}

function closeRegressionDrilldown() {
  const panel = el('reg-drilldown');
  const backdrop = el('reg-drilldown-backdrop');
  if (panel) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) backdrop.classList.remove('open');
  setTimeout(() => {
    if (panel && !panel.classList.contains('open')) panel.style.display = 'none';
    if (backdrop && !backdrop.classList.contains('open')) backdrop.style.display = 'none';
  }, 220);
}

(function _regWireDrilldown() {
  if (typeof document === 'undefined') return;
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (target && target.id === 'reg-drilldown-backdrop') closeRegressionDrilldown();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const panel = el('reg-drilldown');
      if (panel && panel.classList.contains('open')) closeRegressionDrilldown();
    }
  });
})();

// ════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════

async function initApp() {
  // Load static data files
  const [buoys, tideStations] = await Promise.all([
    fetchJSON('data/buoys-east-coast.json'),
    fetchJSON('data/tide-stations.json')
  ]);

  STATE.buoys = buoys || [];
  STATE.tideStations = tideStations || [];

  // Init maps
  initBuoyMap();
  initTideMap();

  // Wire forecast-coords toggle (Choc only behaviour; the wrap is hidden for
  // non-Choc selections via applyChocOnlyVisibility).
  initForecastCoordsToggle();
  initForecastModelDropdown();

  // Populate the buoy <select> dropdown that mirrors the map for keyboard /
  // accessibility users.
  initBuoySelectDropdown();

  // Wire surf log
  await loadSurfLog();
  initTabBar();
  initSurfLogForm();
  initMatchModal();
  slRetrain();
  // Re-attempt any photo uploads that failed on a prior session.
  retryFailedPhotoUploads().catch(function(e) { console.warn('Retry pass failed:', e); });

  // Wire auth buttons
  el('auth-signin-btn')?.addEventListener('click', function() {
    if (typeof signInWithGoogle === 'function') signInWithGoogle();
  });
  el('auth-signout-btn')?.addEventListener('click', function() {
    if (typeof signOutUser === 'function') signOutUser();
  });
  el('sl-auth-prompt-signin')?.addEventListener('click', function() {
    if (typeof signInWithGoogle === 'function') signInWithGoogle();
  });
  el('sl-auth-prompt-dismiss')?.addEventListener('click', function() {
    const authPrompt = el('sl-auth-prompt');
    if (authPrompt) authPrompt.style.display = 'none';
  });

  // Tabs are always visible. For initial load with no buoy selected (the
  // boat-yes path or the open buoy map view), still apply per-tab gating so
  // Tab 1's lineup map and Tab 3's log form stay hidden.
  updateTabBarVisibility();

  // Default: if gate passed (not by boat), load Chocomount
  if (STATE.boatGatePassed) {
    const chocBuoy = STATE.buoys.find(b => b.home === 'chocomount');
    if (chocBuoy) {
      selectBuoy(chocBuoy);
      STATE.buoyMap.setView([chocBuoy.lat, chocBuoy.lon], 8);
    }
  }
  // If by boat, just show the map, no auto-select
}

// ── Start ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initGate);
