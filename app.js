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
    // CORS relays for www.ndbc.noaa.gov, which sends no CORS headers, so a
    // browser can't read it directly. Empty on purpose: the free relays we
    // used are dead (corsproxy.io 403 "keyless_legacy_url", allorigins 522
    // after ~20 s, codetabs 503), and walking them cost every load ~15 s
    // before the chart and ~34 s before the spectra. Chocomount reads the
    // pipeline's data/buoy.json instead (scripts/fetch_buoy.py, every 2 h);
    // other buoys show an honest "no live data" state.
    // To re-add a WORKING relay you control (e.g. a Cloudflare Worker that
    // fetches the NDBC URL and adds Access-Control-Allow-Origin: *):
    //   { name: 'worker', wrap: function(url) { return 'https://<your-worker>.workers.dev/?url=' + encodeURIComponent(url); } }
    // It is then tried for non-Choc buoys (off the chart's critical path)
    // and by the surf log's NDBC-history fallback.
    ndbcProxies: [],
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
  lastSpecSummary: null,    // latest .spec/pipeline summary row (shared Hs source)
  roseScaleMode: 'linear',  // 'linear' | 'sqrt'; persisted to localStorage
  _roseHover: null,         // wedge id under the cursor (compass rose inspection)
  _roseWedges: null,        // hit-test geometry recorded by drawCompassRose
  _roseGeom: null
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

// Human-readable age for freshness labels: "just now", "14 min ago",
// "3h 10m ago", "2d ago".
function formatAgo(date) {
  const ms = Date.now() - date.getTime();
  if (!Number.isFinite(ms) || ms < 60 * 1000) return 'just now';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) {
    const m = min % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  return `${Math.round(h / 24)}d ago`;
}

function formatDay(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
}

function formatDayShort(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function el(id) { return document.getElementById(id); }

// Escape text for an innerHTML string (element content or a quoted
// attribute). Anything that came from Firestore, an import or another crew
// member (notes, displayName, ids, condition values) goes through this:
// the community log is rendered for everyone (audit C27).
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A photo URL safe to put in a src="" attribute: http(s), blob: or an image
// data: URI only, escaped for the attribute. Anything else becomes ''.
function safeUrl(u) {
  const s = String(u == null ? '' : u).trim();
  return /^(https?:|blob:|data:image\/)/i.test(s) ? escHtml(s) : '';
}

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
// NOAA Solar Calculator equations (Meeus, "Astronomical Algorithms"):
// the sun's declination and the equation of time (minutes) at Julian
// day `jd`. Good to well under a minute of time for this century.
function _solarPosition(jd) {
  const T = (jd - 2451545) / 36525;                        // Julian centuries since J2000
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = degToRad(M), L0r = degToRad(L0);
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = degToRad(125.04 - 1934.136 * T);
  const lambda = degToRad(L0 + C - 0.00569 - 0.00478 * Math.sin(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = degToRad(eps0 + 0.00256 * Math.cos(omega));
  const y = Math.tan(eps / 2) * Math.tan(eps / 2);
  return {
    decl: radToDeg(Math.asin(Math.sin(eps) * Math.sin(lambda))),
    eot: 4 * radToDeg(y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr))
  };
}

// Sunrise/sunset put the sun's centre at the standard -0.833° altitude
// (34' of refraction plus the 16' solar semi-diameter), civil twilight at
// -6°. The old geometric-horizon formula ran 5-9 min late at sunrise and
// early at sunset at Choc; this matches USNO to about a minute (audit C22).
function calcDaylight(lat, lon, date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  // The viewer's calendar day, as 0h UTC. Events are solved in UTC hours
  // after it (a summer sunset at Choc lands past 24, i.e. 00:2xZ next day).
  const day0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const jd0 = day0 / 86400000 + 2440587.5;
  const latRad = degToRad(lat);

  function cosHourAngle(alt, decl) {
    const declRad = degToRad(decl);
    return (Math.sin(degToRad(alt)) - Math.sin(latRad) * Math.sin(declRad)) /
      (Math.cos(latRad) * Math.cos(declRad));
  }
  // UTC hours of the rising/setting crossing of `alt`. Three passes
  // re-evaluate the sun at the event itself; null if it never crosses.
  function eventUTC(alt, rising) {
    let t = 12 - lon / 15, ok = false;
    for (let i = 0; i < 3; i++) {
      const sun = _solarPosition(jd0 + t / 24);
      const cosH = cosHourAngle(alt, sun.decl);
      if (cosH < -1 || cosH > 1) break;
      const H = radToDeg(Math.acos(cosH));
      t = (720 - 4 * lon - sun.eot + (rising ? -4 : 4) * H) / 60;
      ok = true;
    }
    return ok ? t : null;
  }

  const noonSun = _solarPosition(jd0 + (12 - lon / 15) / 24);
  const cosH0 = cosHourAngle(-0.833, noonSun.decl);
  if (cosH0 < -1) return { alwaysDay: true };
  if (cosH0 > 1)  return { alwaysNight: true };

  const sunriseUTC = eventUTC(-0.833, true);
  const sunsetUTC = eventUTC(-0.833, false);
  if (sunriseUTC == null || sunsetUTC == null) return cosH0 < 0 ? { alwaysDay: true } : { alwaysNight: true };
  // No civil dusk (high-latitude summer): first/last light 4 min out, as before.
  const civilRise = eventUTC(-6, true);
  const civilSet = eventUTC(-6, false);
  const firstLightUTC = civilRise != null ? civilRise : sunriseUTC - 1 / 15;
  const lastLightUTC = civilSet != null ? civilSet : sunsetUTC + 1 / 15;

  // Whole minutes, as the cards print them.
  const hoursToDate = h => new Date(day0 + Math.round(h * 60) * 60000);

  return {
    firstLight: hoursToDate(firstLightUTC),
    sunrise: hoursToDate(sunriseUTC),
    sunset: hoursToDate(sunsetUTC),
    lastLight: hoursToDate(lastLightUTC),
    daylightHours: sunsetUTC - sunriseUTC
  };
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

// readCache(key, ttlMs) → the cached data while younger than ttlMs, else
// null. With { allowStale: true } it returns { data, ts, stale } for a copy
// of ANY age (stale = past ttlMs), so a failed refresh can fall back to the
// last good copy and still report when that copy was really fetched.
function readCache(key, ttlMs, opts) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    const fresh = Date.now() - ts < ttlMs;
    if (opts && opts.allowStale) return data == null ? null : { data, ts, stale: !fresh };
    if (fresh) return data;
  } catch (_) { /* fall through */ }
  return null;
}

// Timestamp of the last cache write for `key`, ignoring TTL. The cache ts
// is the true fetch time even when a fetch function later serves from
// cache, so it backs the "updated X min ago" freshness labels.
function readCacheTs(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw).ts || null;
  } catch (_) { /* non-fatal */ }
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
// Keyed by the span actually fetched (rangeHours wins, as in
// fetchTidePredictions), so a call with rangeDays left to its default and
// a read that passes undefined can never disagree again.
function tidePredCacheKey(stationId, rangeDays, rangeHours) {
  const hours = rangeHours != null ? rangeHours : (rangeDays || 3) * 24;
  return `lcc-cache-tide-${stationId}-h${hours}`;
}
function tideHiLoCacheKey(stationId, rangeDays) {
  return `lcc-cache-hilo-${stationId}-d${rangeDays}`;
}
function waterTempCacheKey(stationId) {
  return `lcc-cache-water-${stationId}`;
}

// Tide spans the forecast chart (and Choc TV's day cards) fetch. The fetch
// calls and the cache-first reads both use these, so their keys match.
const CHART_TIDE_SPAN = { hiloDays: 10, predHours: 168 };

// CO-OPS answers an outage with HTTP 200 and {"error": ...}; only a body
// with predictions is data (and only that may overwrite a good cached copy).
function tidesUsable(data) {
  return !!(data && Array.isArray(data.predictions) && data.predictions.length);
}

// The 6-min tide copies used to be keyed "...-d3-h168" / "...-d3-h", which
// nothing reads any more; drop them (~70 KB each of a ~5 MB iOS quota).
function dropLegacyTideCacheKeys() {
  try {
    Object.keys(localStorage)
      .filter(k => /^lcc-cache-tide-.+-d\d*-h\d*$/.test(k))
      .forEach(k => localStorage.removeItem(k));
  } catch (_) { /* non-fatal */ }
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
// Open-Meteo Marine models that return a usable swell partition at the
// Choc forecast point, probed live with fetchMarineForecast's exact query
// (audit C21, 2026-10-01). Auto (best_match) is MeteoFrance MFWAM there.
// Left out on purpose: gfs_wave025/016 (not model ids; HTTP 400 — the
// NOAA ids are ncep_*), dwd_ewam (HTTP 400, no data this far west),
// ecmwf_wam/ecmwf_wam025 (total sea only, swell_* all null) and
// era5_ocean (all null). Stale stored ids fall back to Auto in
// getForecastModel.
const FORECAST_MODELS = [
  { value: 'meteofrance_wave', label: 'MeteoFrance MFWAM (0.08°)' },
  { value: 'ncep_gfswave025',  label: 'NOAA GFS-Wave (0.25°)' },
  { value: 'ncep_gfswave016',  label: 'NOAA GFS-Wave (0.16°)' },
  { value: 'dwd_gwam',         label: 'DWD GWAM (0.25°, no secondary swell)' }
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
  // Only real data may replace the last good copy (an all-null model
  // response would otherwise wipe the stale fallback).
  if (marineHasUsableData(data)) writeCache(marineCacheKey(lat, lon, model), data);
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
  if (data && data.hourly) writeCache(windCacheKey(lat, lon), data);
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
  if (tidesUsable(data)) writeCache(tidePredCacheKey(stationId, rangeDays, rangeHours), data);
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
  if (tidesUsable(data)) writeCache(tideHiLoCacheKey(stationId, rangeDays), data);
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

  // Move forecast pin near buoy (no pin when Leaflet failed to load)
  STATE.forecastPin?.setLatLng([lat, lon]);

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

  updateSwellCard(buoyParsed, marine, buoy, pipelineSwellBand(pipelineData, buoy));
  updateWindCard(wind, buoyParsed, isChoc, displayLat, displayLon);
  updateWaterTempCard(buoyParsed, marine, isChoc);
  updateDaylightCard(displayLat, displayLon);
  updateSecondarySwellCard(marine, isChoc, forecastLat, forecastLon);
  updateCoordFooters(buoy, forecastLat, forecastLon, displayLat, displayLon);
  setForecastUnavailable(!(marine && marine.hourly));

  if (marine && marine.hourly) {
    const daylight = calcDaylight(displayLat, displayLon, new Date());

    STATE._cachedMarine = marine;
    STATE._cachedWind = wind;
    STATE._cachedTideHiLo = tideHiLo;
    STATE._cachedTidePred = tidePred;

    updateTideCard(tideHiLo, tideStn);
    drawForecastChart(marine, wind, daylight, tideHiLo, tidePred, buoyParsed);

    if (isChoc) drawLineupMap(marine, wind, buoyParsed);

    const coordLabel = isChoc
      ? `${forecastLat}°N, ${Math.abs(forecastLon)}°W (open water)`
      : `${forecastLat.toFixed(3)}°N, ${Math.abs(forecastLon).toFixed(3)}°W`;
    // The marine cache ts is the true fetch time on both the SWR pre-paint
    // and the post-fetch refresh (fetchMarineForecast writes it per fetch).
    const marineTs = readCacheTs(marineCacheKey(forecastLat, forecastLon, selectedModel));
    const updatedStr = marineTs
      ? ` · updated ${formatTime(new Date(marineTs))} (${formatAgo(new Date(marineTs))})`
      : '';
    setFooter('footer-forecast',
      `Open-Meteo Marine · ${describeForecastModel(selectedModel)} · ${coordLabel}${updatedStr}`,
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
  setForecastUnavailable(!(marine && marine.hourly));

  if (marine && marine.hourly) {
    const daylight = calcDaylight(lat, lon, new Date());
    STATE._cachedTidePred = tidePred;
    updateTideCard(tideHiLo, tideStn);
    drawForecastChart(marine, wind, daylight, tideHiLo, tidePred);
    const marineTs = readCacheTs(marineCacheKey(lat, lon, selectedModel));
    const updatedStr = marineTs
      ? ` · updated ${formatTime(new Date(marineTs))} (${formatAgo(new Date(marineTs))})`
      : '';
    setFooter('footer-forecast',
      `Open-Meteo Marine · ${describeForecastModel(selectedModel)} · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W${updatedStr}`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }
}

// visible: the cache-first paint is up while the refresh runs. staleAsOf
// (epoch ms): the refresh FAILED and the chart shows the last good copy
// from then, so say so instead of "refreshing…".
function setCacheRefreshIndicator(visible, staleAsOf) {
  const ind = el('forecast-cache-indicator');
  if (!ind) return;
  const stale = Number.isFinite(staleAsOf);
  ind.style.display = visible || stale ? '' : 'none';
  ind.classList.toggle('is-stale', stale);
  ind.textContent = stale
    ? `Saved forecast from ${formatAsOfTime(staleAsOf)} · refresh failed`
    : 'Cached · refreshing…';
}

// Explicit empty state for the forecast chart when there is truly no
// forecast (Open-Meteo failed and no saved copy is young enough), instead
// of blank canvases under a header claiming "Updated".
function setForecastUnavailable(on) {
  const container = el('forecast-chart-container');
  if (!container) return;
  container.classList.toggle('is-unavailable', !!on);
  let note = el('forecast-unavailable-msg');
  if (!on) {
    if (note) note.style.display = 'none';
    return;
  }
  if (!note) {
    note = document.createElement('div');
    note.id = 'forecast-unavailable-msg';
    note.className = 'forecast-unavailable-msg';
    note.setAttribute('role', 'status');
    container.insertBefore(note, container.firstChild);
  }
  note.textContent = "Forecast unavailable: Open-Meteo didn't respond and there's no saved forecast from the last 24 h. Reload to try again.";
  note.style.display = '';
}

// "6:12 AM" today, "Wed 6:12 PM" on any other day.
function formatAsOfTime(ms) {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? formatTime(d)
    : `${formatDayShort(d)} ${formatTime(d)}`;
}

// ── Buoy obs from the pipeline / NDBC ──
// Obs times arrive as "YYYY-MM-DD HH:mm UTC" (NDBC stdmet rows and the
// pipeline's buoy.time). → epoch ms, or null.
function parseBuoyObsTime(s) {
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

// Tags a parsed obs with its buoy, its obs time (parsed once) and where it
// came from ('pipeline' | 'live'), so a cached reading can never paint
// under another buoy's name and the cards can show its true age.
function tagBuoyParsed(parsed, buoy, src) {
  if (!parsed) return null;
  return Object.assign(parsed, { buoyId: buoy.id, obsMs: parseBuoyObsTime(parsed.time), src });
}

// The pipeline's data/buoy.json carries one buoy (44097). Use it only for
// that buoy: before, every spectral buoy showed 44097's numbers.
function pipelineIsFor(pData, buoy) {
  return !!(pData && buoy && pData.buoy_id === buoy.id);
}

function buoyParsedFromPipeline(pData, buoy) {
  if (!pipelineIsFor(pData, buoy) || !pData.buoy) return null;
  const b = pData.buoy;
  return tagBuoyParsed({
    waveHeight: b.wave_height,
    dominantPeriod: b.dominant_period,
    meanDirection: b.mean_wave_direction,
    waterTemp: b.water_temp,
    windSpeed: b.wind_speed,
    windDir: b.wind_direction,
    windGust: b.wind_gust,
    time: b.time || 'pipeline data'
  }, buoy, 'pipeline');
}

// Pipeline spectral bins for the compass rose / spectrum, or null when the
// pipeline file isn't this buoy's or has no bins.
function pipelineSpectralFor(buoy, pData) {
  if (!pipelineIsFor(pData, buoy)) return null;
  const bins = pData.spectral_bins;
  if (!Array.isArray(bins) || !bins.length) return null;
  return { freqs: bins.map(b => b.freq), bins };
}

// The swell card's 8 s+ band for this buoy: the pipeline's own swell_band
// when it provides one, else integrated here from its spectral bins.
function pipelineSwellBand(pData, buoy) {
  if (!pipelineIsFor(pData, buoy)) return null;
  const sb = pData.swell_band;
  if (sb && Number.isFinite(sb.hs_m)) {
    return {
      hsM: sb.hs_m,
      peakPeriod: Number.isFinite(sb.peak_period_s) ? sb.peak_period_s : null,
      dir: Number.isFinite(sb.dir_deg) ? sb.dir_deg : null,
      minPeriod: Number.isFinite(sb.min_period_s) ? sb.min_period_s : SWELL_BAND_MIN_PERIOD_S
    };
  }
  return swellBandFromBins(pData.spectral_bins, SWELL_BAND_MIN_PERIOD_S);
}

// ── Forecast fetch round (buoy and pin loads) ──
// How old a saved copy may be and still stand in for a failed refresh: a
// day-old forecast is still a useful guide (shown as stale), and tide
// predictions are astronomical, so a 10-day hi/lo saved 4 days ago still
// covers today through Choc TV's day 5.
const STALE_FALLBACK_MAX_MS = {
  forecast: 24 * 60 * 60 * 1000,
  tide: 4 * 24 * 60 * 60 * 1000
};

// One source after its fetch: the live response when usable (as of the
// moment its fetcher saved it under liveKey), else the first usable saved
// copy among `keys` younger than maxAgeMs (keeping its ORIGINAL fetch
// time), else nothing.
// → { data, asOf, origin: 'live' | 'stale-cache' | 'failed', keyIdx }
function settleSource(live, usable, liveKey, keys, maxAgeMs, roundStart) {
  if (usable(live)) {
    // Saved during this round (5 s slack for clock jitter); else the save
    // failed (quota) and an older copy is sitting there, so use now.
    const savedAt = readCacheTs(liveKey);
    const asOf = savedAt != null && savedAt >= roundStart - 5000 ? savedAt : Date.now();
    return { data: live, asOf, origin: 'live', keyIdx: -1 };
  }
  for (let i = 0; i < keys.length; i++) {
    const hit = readCache(keys[i], maxAgeMs, { allowStale: true });
    if (hit && !hit.stale && usable(hit.data)) {
      return { data: hit.data, asOf: hit.ts, origin: 'stale-cache', keyIdx: i };
    }
  }
  return { data: null, asOf: null, origin: 'failed', keyIdx: -1 };
}

// Fetches marine, wind and the chart's tide spans in parallel, then settles
// each (live → saved copy → nothing). A network blip on a chosen model
// shows best_match for this load only; the choice is forgotten only when
// the model answered with no usable data for the spot.
// → { marine, marineModel (model of the data returned), wind, hiloRaw,
//     predRaw, health: { marine, wind, tides } as { asOf, origin } }
async function fetchForecastRound({ forecastLat, forecastLon, windLat, windLon, tideStn, selectedModel }) {
  const roundStart = Date.now();
  let [marine, wind, hiloRaw, predRaw] = await Promise.all([
    fetchMarineForecast(forecastLat, forecastLon, selectedModel),
    fetchWindForecast(windLat, windLon),
    tideStn ? fetchTideHiLo(tideStn.id, CHART_TIDE_SPAN.hiloDays) : Promise.resolve(null),
    tideStn ? fetchTidePredictions(tideStn.id, undefined, CHART_TIDE_SPAN.predHours) : Promise.resolve(null)
  ]);
  let marineModel = selectedModel;
  let noCoverage = false;
  if (selectedModel && !marineHasUsableData(marine)) {
    // fetchJSON returns null for a timeout, HTTP error or offline; a real
    // body with all-null series means the model doesn't cover this spot.
    noCoverage = marine != null;
    showToast(noCoverage
      ? `Model ${selectedModel} has no data here, falling back to best_match`
      : `Model ${selectedModel} didn't respond, showing best_match for now`, 'warn');
    if (noCoverage) setForecastModel('');
    marineModel = '';
    marine = await fetchMarineForecast(forecastLat, forecastLon, null);
  }
  const maxAge = STALE_FALLBACK_MAX_MS;
  // Saved copies to fall back on: the user's model first, then best_match.
  const models = selectedModel && !noCoverage ? [selectedModel, ''] : [''];
  const m = settleSource(marine, marineHasUsableData, marineCacheKey(forecastLat, forecastLon, marineModel),
    models.map(mm => marineCacheKey(forecastLat, forecastLon, mm)), maxAge.forecast, roundStart);
  if (m.origin === 'stale-cache') marineModel = models[m.keyIdx];
  const windKey = windCacheKey(windLat, windLon);
  const w = settleSource(wind, d => !!(d && d.hourly), windKey, [windKey], maxAge.forecast, roundStart);
  const none = { data: null, asOf: null, origin: 'failed' };
  const hiloKey = tideStn && tideHiLoCacheKey(tideStn.id, CHART_TIDE_SPAN.hiloDays);
  const predKey = tideStn && tidePredCacheKey(tideStn.id, undefined, CHART_TIDE_SPAN.predHours);
  const h = tideStn ? settleSource(hiloRaw, tidesUsable, hiloKey, [hiloKey], maxAge.tide, roundStart) : none;
  const p = tideStn ? settleSource(predRaw, tidesUsable, predKey, [predKey], maxAge.tide, roundStart) : none;
  // Tides = hi/lo + 6-min curve: the oldest of whichever rendered.
  const tideParts = [h, p].filter(s => s.data);
  const tides = tideParts.length
    ? {
        asOf: Math.min(...tideParts.map(s => s.asOf)),
        origin: tideParts.some(s => s.origin === 'stale-cache') ? 'stale-cache' : 'live'
      }
    : { asOf: null, origin: 'failed' };
  return {
    marine: m.data, marineModel, wind: w.data, hiloRaw: h.data, predRaw: p.data,
    health: {
      marine: { asOf: m.asOf, origin: m.origin },
      wind: { asOf: w.asOf, origin: w.origin },
      tides
    }
  };
}

// SHARED CONTRACT with kiosk.js (Choc TV status strip), set after every
// completed load:
//   STATE.dataAsOf    epoch ms of the OLDEST fetch time among the marine
//                     forecast, wind and tides actually rendered (a stale
//                     fallback keeps its original cache time), or null.
//   STATE.dataHealth  { marine:{asOf, origin}, wind:{asOf, origin},
//                     tides:{asOf, origin}, buoy:{obsMs, origin} }; origin is
//                     'live' | 'cache' | 'stale-cache' | 'pipeline' | 'failed'.
// STATE.lastLoadCompletedAt stays the "a load finished" signal; these say
// how old the data on screen really is. The header shows the same truth.
function recordDataHealth(health, buoyHealth, hasTideStation) {
  STATE.dataHealth = {
    marine: health.marine,
    wind: health.wind,
    tides: health.tides,
    buoy: buoyHealth
  };
  const asOfs = [health.marine, health.wind, health.tides]
    .map(s => s.asOf).filter(Number.isFinite);
  STATE.dataAsOf = asOfs.length ? Math.min(...asOfs) : null;

  const shown = [health.marine, health.wind, hasTideStation ? health.tides : null].filter(Boolean);
  const anyStale = shown.some(s => s.origin === 'stale-cache');
  const hdr = el('header-update-time');
  if (!hdr) return;
  let text;
  if (health.marine.origin === 'failed') {
    text = 'Forecast unavailable';
  } else if (anyStale) {
    text = `Refresh failed · data from ${formatAsOfTime(STATE.dataAsOf)}`;
  } else {
    const missing = [];
    if (health.wind.origin === 'failed') missing.push('wind');
    if (hasTideStation && health.tides.origin === 'failed') missing.push('tides');
    text = `Updated ${formatAsOfTime(STATE.dataAsOf)}` + (missing.length ? ` · no ${missing.join(' or ')}` : '');
  }
  hdr.textContent = text;
  hdr.classList.toggle('is-stale', health.marine.origin === 'failed' || anyStale);
}

// ── Load concurrency guard ──────────────────────
// Rapid buoy clicks, model changes, or the kiosk auto-refresh can start a
// new load while an older one is still awaiting fetches; the generation
// counter makes the superseded run stop touching the DOM at its next
// checkpoint, and _loadInFlight lets timers skip firing mid-load.
let _loadGen = 0;
let _loadInFlight = false;
function isDataLoadInFlight() { return _loadInFlight; }

async function loadAllData(buoy) {
  const gen = ++_loadGen;
  _loadInFlight = true;
  try {
    await _loadAllDataImpl(buoy, gen);
  } finally {
    if (gen === _loadGen) _loadInFlight = false;
  }
}

async function _loadAllDataImpl(buoy, _gen) {
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
  const cachedHiLoRaw  = tideStn ? readCache(tideHiLoCacheKey(tideStn.id, CHART_TIDE_SPAN.hiloDays), CACHE_TTL.hilo) : null;
  const cachedPredRaw  = tideStn ? readCache(tidePredCacheKey(tideStn.id, undefined, CHART_TIDE_SPAN.predHours), CACHE_TTL.tide) : null;
  const cachedHiLo = cachedHiLoRaw && cachedHiLoRaw.predictions ? cachedHiLoRaw.predictions : null;
  const cachedPred = cachedPredRaw && cachedPredRaw.predictions ? cachedPredRaw.predictions : null;

  const tidesCacheReady = !tideStn || (cachedHiLo && cachedPred);
  const canRenderFromCache = !!(cachedMarine && cachedMarine.hourly && cachedWind && tidesCacheReady);

  if (canRenderFromCache) {
    // Only this buoy's own reading: another buoy's cached obs (or 44097's
    // pipeline data) must never paint under this buoy's name.
    const prevParsed = STATE._cachedBuoyParsed;
    const cachedBuoyParsed = prevParsed && prevParsed.buoyId === buoy.id
      ? prevParsed
      : buoyParsedFromPipeline(cachedPipeline, buoy);
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
    // The whole swell card, so the previous buoy's detail and source can't
    // sit under this buoy's name while the load runs.
    el('val-swell-detail').textContent = '···';
    el('val-swell-arrival').style.display = 'none';
    setFooter('footer-swell', '');
    el('val-wind-speed').textContent = '···';
    el('val-water-temp').textContent = '···';
    el('val-tide').textContent = '···';
    setCacheRefreshIndicator(false);
  }

  // Live NDBC (non-Choc buoys, and only with a relay in
  // CONFIG.api.ndbcProxies) starts now but never gates the chart: the
  // forecast renders on Open-Meteo + CO-OPS and the buoy reading is patched
  // in when it lands. Choc's buoy comes from the pipeline's data/buoy.json.
  const liveBuoyP = buoy.spectral && !isChoc ? fetchNDBCStdmet(buoy.id) : Promise.resolve(null);
  const pipelineP = isChoc ? fetchPipelineBuoy() : Promise.resolve(null);

  // ── Forecast chart deps (live → saved copy → nothing) ──
  const round = await fetchForecastRound({
    forecastLat, forecastLon, windLat: displayLat, windLon: displayLon, tideStn, selectedModel
  });
  const pipelineData = await pipelineP;
  if (_gen !== _loadGen) return; // superseded by a newer load

  let buoyParsed = buoyParsedFromPipeline(pipelineData, buoy);
  STATE._cachedBuoyParsed = buoyParsed;

  const renderCtx = {
    buoy, isChoc, selectedModel: round.marineModel,
    forecastLat, forecastLon, displayLat, displayLon,
    marine: round.marine, wind: round.wind, buoyParsed, pipelineData,
    tideHiLo: round.hiloRaw ? round.hiloRaw.predictions : null,
    tidePred: round.predRaw ? round.predRaw.predictions : null,
    tideStn
  };
  renderForecastSet(renderCtx);
  setCacheRefreshIndicator(false,
    round.health.marine.origin === 'stale-cache' ? round.health.marine.asOf : undefined);

  // ── Tides panel ──
  if (STATE.nearestTideStation) {
    await loadTidesPanel(STATE.nearestTideStation);
    el('panel-tides').style.display = '';
  } else {
    el('panel-tides').style.display = 'none';
  }
  if (_gen !== _loadGen) return; // superseded by a newer load

  // ── Live buoy reading (non-Choc, relay configured) ──
  const liveParsed = tagBuoyParsed(parseNDBCStdmet(await liveBuoyP), buoy, 'live');
  if (_gen !== _loadGen) return; // superseded by a newer load
  if (liveParsed) {
    buoyParsed = liveParsed;
    STATE._cachedBuoyParsed = buoyParsed;
    renderForecastSet(Object.assign(renderCtx, { buoyParsed }));
  }

  // ── Spectral data (compass rose + spectrum) ──
  if (buoy.spectral) {
    el('panel-spectral-row').style.display = '';
    el('panel-spectral-summary').style.display = '';
    // Drop the previous buoy's summary so a failed load can't leak a stale
    // Hs into the compass-rose center (resolveHsFt prefers it).
    STATE.lastSpecSummary = null;
    let parsed = null;
    let spectralRaw = null;
    let isStale = false;

    // Live NDBC for non-Choc buoys (only with a relay configured; with none
    // every file comes back null at once). Choc is pipeline-only.
    if (!isChoc) {
      try {
        spectralRaw = await fetchNDBCSpectral(buoy.id);
        parsed = parseNDBCSpectral(spectralRaw);
      } catch (err) {
        console.warn('Spectral CORS fetch failed:', buoy.id, err);
      }
    }

    // Pipeline data, only when it is this buoy's own
    if (!parsed || !parsed.bins || parsed.bins.length === 0) {
      try {
        const pData = pipelineData || await fetchPipelineBuoy();
        const fromPipeline = pipelineSpectralFor(buoy, pData);
        if (fromPipeline) {
          parsed = fromPipeline;
          isStale = true;
          // Use pipeline spectral summary for the summary table
          if (pData.spectral_summary) {
            spectralRaw = spectralRaw || {};
            spectralRaw._pipelineSummary = pData.spectral_summary;
            spectralRaw._fetchTime = pData.fetch_time;
            // Buoy observation time ("YYYY-MM-DD HH:mm UTC") for the
            // ARCHIVE freshness badge.
            spectralRaw._obsTimeStr = pData.buoy && pData.buoy.time ? pData.buoy.time : null;
          }
        }
      } catch (err) {
        console.warn('Pipeline spectral fallback failed:', err);
      }
    }
    if (_gen !== _loadGen) return; // superseded by a newer load

    if (parsed && parsed.bins && parsed.bins.length > 0) {
      STATE.lastSpectral = parsed;
      STATE.lastBuoyParsed = buoyParsed;
      // New bins → any prior hover selection points at stale wedges.
      _setRoseHover(null);
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
      // Freshness (live/stale/archive + timestamps) lives in the table's
      // status strip; the footer keeps only the station identity.
      setFooter('footer-spectral-summary',
        `ndbc ${buoy.id} spectral summary`,
        `https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}`,
        'ndbc station page'
      );
    } else {
      console.warn('Spectral parse returned no bins for buoy', buoy.id);
      if (!isChoc) {
        // Nothing of this buoy's own: drop the last buoy's spectrum so a
        // resize or rose-scale redraw can't repaint it under this name.
        STATE.lastSpectral = null;
        STATE.lastBuoyParsed = null;
      }
      showSpectralEmpty(buoy.id, isChoc
        ? `No spectral data for ${buoy.id} in the latest pipeline update.`
        : `No live spectrum for ${buoy.id}: NDBC doesn't allow browser requests and no relay is set up. ` +
          `Only Choc's buoy (44097) is fetched, every 2 h, by the pipeline.`);
      el('panel-spectral-summary').style.display = 'none';
    }
  } else {
    el('panel-spectral-row').style.display = '';
    el('panel-spectral-summary').style.display = 'none';
    STATE.lastSpecSummary = null;
    showSpectralEmpty();
  }

  // ── Tide station map ──
  highlightNearestTideStation(displayLat, displayLon);

  // Update time: lastLoadCompletedAt = this load finished; dataAsOf and the
  // header = how old the data on screen really is.
  STATE.lastLoadCompletedAt = Date.now();
  recordDataHealth(round.health, {
    obsMs: buoyParsed ? buoyParsed.obsMs : null,
    origin: buoyParsed ? buoyParsed.src : 'failed'
  }, !!tideStn);
}

async function loadPinData(lat, lon) {
  const gen = ++_loadGen;
  _loadInFlight = true;
  try {
    await _loadPinDataImpl(lat, lon, gen);
  } finally {
    if (gen === _loadGen) _loadInFlight = false;
  }
}

async function _loadPinDataImpl(lat, lon, _gen) {
  const selectedModel = getForecastModel();
  const tideStn = findNearestTideStation(lat, lon);
  STATE.nearestTideStation = tideStn;

  // ── SWR: paint from cache before any network hits ──
  const cachedMarine  = readCache(marineCacheKey(lat, lon, selectedModel), CACHE_TTL.marine);
  const cachedWind    = readCache(windCacheKey(lat, lon), CACHE_TTL.wind);
  const cachedHiLoRaw = tideStn ? readCache(tideHiLoCacheKey(tideStn.id, CHART_TIDE_SPAN.hiloDays), CACHE_TTL.hilo) : null;
  const cachedPredRaw = tideStn ? readCache(tidePredCacheKey(tideStn.id, undefined, CHART_TIDE_SPAN.predHours), CACHE_TTL.tide) : null;
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
    el('val-swell-detail').textContent = '···';
    el('val-swell-arrival').style.display = 'none';
    setFooter('footer-swell', '');
    el('val-wind-speed').textContent = '···';
    el('val-water-temp').textContent = '···';
    el('val-tide').textContent = '···';
    setCacheRefreshIndicator(false);
  }

  // ── Fire fresh fetches in parallel (live → saved copy → nothing) ──
  const round = await fetchForecastRound({
    forecastLat: lat, forecastLon: lon, windLat: lat, windLon: lon, tideStn, selectedModel
  });
  if (_gen !== _loadGen) return; // superseded by a newer load

  renderPinForecastSet({
    selectedModel: round.marineModel, lat, lon,
    marine: round.marine, wind: round.wind,
    tideHiLo: round.hiloRaw ? round.hiloRaw.predictions : null,
    tidePred: round.predRaw ? round.predRaw.predictions : null,
    tideStn
  });
  setCacheRefreshIndicator(false,
    round.health.marine.origin === 'stale-cache' ? round.health.marine.asOf : undefined);

  if (STATE.nearestTideStation) {
    await loadTidesPanel(STATE.nearestTideStation);
    el('panel-tides').style.display = '';
  } else {
    el('panel-tides').style.display = 'none';
  }
  if (_gen !== _loadGen) return; // superseded by a newer load

  // No spectral for pin — show empty state
  el('panel-spectral-row').style.display = '';
  showSpectralEmpty();

  highlightNearestTideStation(lat, lon);
  STATE.lastLoadCompletedAt = Date.now();
  recordDataHealth(round.health, { obsMs: null, origin: 'failed' }, !!tideStn);
}

// ════════════════════════════════════════════════
// UPDATE CONDITION CARDS
// ════════════════════════════════════════════════

// ── Swell band (hero swell card) ──
// The card reports the >= 8 s part of the buoy spectrum. NDBC's own SwH at
// 44097 only counts >= 10 s energy (its separation frequency is missing, so
// it splits at a fixed 0.10 Hz), which files the 8-9 s swell that
// CHOCOMOUNT_KNOWLEDGE.md counts among Choc's best days under "wind waves".
// 8 s matches computePrimarySwellDir's band. NDBC's split stays in the
// spectral table.
const SWELL_BAND_MIN_PERIOD_S = 8;

// Hs, peak period and energy-weighted direction of the >= minPeriod part of
// a spectrum: Hs = 4·sqrt(Σ E·df), each bin's df running between the
// midpoints to its neighbours (NDBC bands are unevenly spaced).
// → { hsM, peakPeriod, dir, minPeriod }, or null without bins.
function swellBandFromBins(bins, minPeriod = SWELL_BAND_MIN_PERIOD_S) {
  if (!Array.isArray(bins)) return null;
  const sorted = bins.filter(b => b && b.freq > 0).sort((a, b) => a.freq - b.freq);
  if (!sorted.length) return null;
  let m0 = 0, sx = 0, sy = 0, peak = null;
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (1 / b.freq < minPeriod - 1e-6) continue;
    const prev = sorted[i - 1], next = sorted[i + 1];
    const lo = prev ? (prev.freq + b.freq) / 2 : b.freq - (next ? (next.freq - b.freq) / 2 : 0.0025);
    const hi = next ? (b.freq + next.freq) / 2 : b.freq + (b.freq - lo);
    const e = b.energy > 0 ? b.energy * (hi - lo) : 0;
    if (!e) continue;
    m0 += e;
    if (!peak || b.energy > peak.energy) peak = b;
    if (Number.isFinite(b.dir1)) {
      sx += Math.cos(b.dir1 * Math.PI / 180) * e;
      sy += Math.sin(b.dir1 * Math.PI / 180) * e;
    }
  }
  return {
    hsM: 4 * Math.sqrt(m0),
    peakPeriod: peak ? 1 / peak.freq : null,
    dir: sx || sy ? (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360 : null,
    minPeriod
  };
}

// ── Buoy obs age ──
// The pipeline lands every 2-8 h, so a "current" reading can be most of a
// tide cycle old. Amber past 2 h, red past 6 h; "Current" only within 90 min.
const BUOY_OBS_CURRENT_MS = 90 * 60 * 1000;
const BUOY_OBS_STALE_MS = 2 * 60 * 60 * 1000;
const BUOY_OBS_OLD_MS = 6 * 60 * 60 * 1000;

// → { ageMs, label: '2h 30m ago', level: 'fresh' | 'stale' | 'old' }, or
// null when the obs time is unknown.
function buoyObsAge(obsMs, nowMs = Date.now()) {
  if (!Number.isFinite(obsMs)) return null;
  const ageMs = Math.max(0, nowMs - obsMs);
  return {
    ageMs,
    // formatAgo measures from Date.now(); shift so it measures ageMs.
    label: formatAgo(new Date(Date.now() - ageMs)),
    level: ageMs > BUOY_OBS_OLD_MS ? 'old' : ageMs > BUOY_OBS_STALE_MS ? 'stale' : 'fresh'
  };
}

// The buoy sits ~50 mi out, so what it measured reaches Choc one travel
// time after the OBSERVATION, not after now. A clock time keeps an old
// reading from passing for an ETA.
function buoySwellArrivalText(periodS, obsMs, nowMs = Date.now()) {
  const arrival = swellArrivalTime(periodS, CONFIG.chocomount.buoyDistanceMiles);
  if (!arrival) return null;
  if (!Number.isFinite(obsMs)) return `${arrival.label} buoy-to-Choc travel`;
  const atMs = obsMs + arrival.minutes * 60 * 1000;
  return `${atMs > nowMs ? 'reaches' : 'reached'} Choc ~${formatTime(new Date(atMs))}`;
}

function updateSwellCard(buoyParsed, marine, buoy, swellBand) {
  const isChoc = STATE.isChocomount;
  const card = el('card-swell');
  card.classList.remove('quality-good', 'quality-fair', 'quality-poor', 'is-stale', 'is-old');
  const label = card.querySelector('.condition-label');
  const extra = el('val-swell-arrival');

  // Prefer buoy data for current swell
  if (buoyParsed && buoyParsed.waveHeight != null) {
    const totalH = buoyParsed.waveHeight;  // WVHT total (ft) — swell + wind waves
    const age = buoyObsAge(buoyParsed.obsMs);

    // Hero number: the 8 s+ band of the spectrum (see SWELL_BAND_MIN_PERIOD_S),
    // with its own peak period and direction (none when the band is flat).
    // Total WVHT stays in the detail.
    const band = swellBand && Number.isFinite(swellBand.hsM) ? swellBand : null;
    const swellFt = band ? Math.round(band.hsM * 3.28084 * 10) / 10 : null;
    const d = band ? (band.dir != null ? Math.round(band.dir) : null) : buoyParsed.meanDirection;
    const displayP = band ? band.peakPeriod : buoyParsed.dominantPeriod;

    // Card accent based on total wave height
    if (totalH >= 3) card.classList.add('quality-good');
    else if (totalH >= 1.5) card.classList.add('quality-fair');
    else card.classList.add('quality-poor');
    if (age && age.level !== 'fresh') card.classList.add('is-' + age.level);

    if (label) {
      const what = band ? `Swell ${band.minPeriod}+ sec` : 'Swell';
      label.textContent = `${what}: ${age && age.ageMs <= BUOY_OBS_CURRENT_MS ? 'Current' : 'Buoy'}`;
    }
    el('val-swell-height').textContent = swellFt != null
      ? `${swellFt.toFixed(1)} ft swell`
      : `${totalH.toFixed(1)} ft`;
    el('val-swell-height').className = `condition-value ${swellDirClass(d)}`;
    el('val-swell-detail').textContent = `${displayP ? displayP.toFixed(0) + 's' : '—'} · ${directionLabel(d)} (${d != null ? d + '°' : '—'})${swellFt != null ? ' · ' + totalH.toFixed(1) + ' ft total' : ''}`;

    // When the buoy measured it, and (Choc) when that swell reaches the
    // beach, from the band's period.
    const parts = [];
    if (age) parts.push(`Buoy obs ${formatAsOfTime(buoyParsed.obsMs)} (${age.label})`);
    const arrivalText = isChoc && displayP ? buoySwellArrivalText(displayP, buoyParsed.obsMs) : null;
    if (arrivalText) parts.push(arrivalText);
    extra.style.display = parts.length ? '' : 'none';
    extra.textContent = parts.join(' · ');

    const buoyLabel = buoy ? `ndbc ${buoy.id} · ${buoy.name}` : 'ndbc buoy';
    const obsNote = age ? ` · obs ${formatAsOfTime(buoyParsed.obsMs)}` : '';
    const buoyUrl = buoy ? `https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}` : 'https://www.ndbc.noaa.gov/';
    setFooter('footer-swell', buoyLabel + obsNote, buoyUrl, 'ndbc station page');

  } else if (marine && marine.current) {
    // No buoy reading: Open-Meteo's model nowcast (swell-only variables)
    const c = marine.current;
    const h = c.swell_wave_height ?? c.wave_height;
    const p = c.swell_wave_period ?? c.wave_period;
    const d = c.swell_wave_direction ?? c.wave_direction;
    if (label) label.textContent = 'Swell: Current';
    el('val-swell-height').textContent = h != null ? `${h.toFixed(1)} ft` : '—';
    el('val-swell-height').className = 'condition-value';
    el('val-swell-detail').textContent = `${p ? p.toFixed(0) + 's' : '—'} · ${directionLabel(d)}`;
    extra.style.display = 'none';
    setFooter('footer-swell', 'Open-Meteo Marine', 'https://open-meteo.com/en/docs/marine-weather-api', 'open-meteo.com');
  } else {
    if (label) label.textContent = 'Swell: Current';
    el('val-swell-height').textContent = '—';
    el('val-swell-detail').textContent = 'No data available';
    extra.style.display = 'none';
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
    STATE.tideMap?.setView([lat, lon], 8);
  }
}

// ════════════════════════════════════════════════
// SWELL FORECAST CHART (Canvas 2D, three stacked card-panels)
// ════════════════════════════════════════════════
//
// Three independent <canvas> elements, each inside its own card:
//
//   ┌─ #forecast-chart-container ─────────────────────────┐
//   │  ┌─ day row ── HTML #forecast-day-header ────────┐  │
//   │  ┌─ swell card ─ canvas#forecast-canvas-swell  ──┐  │
//   │  ┌─ wind  card ─ canvas#forecast-canvas-wind  ──┐  │
//   │  ┌─ tide  card ─ canvas#forecast-canvas-tide  ──┐  │
//   └──────────────────────────────────────────────────────┘
//
// Coordination: a single `_drawForecastChartFull` cycle calls into
// drawSwellPanel → drawWindPanel → drawTidePanel → renderDayLabels in
// sequence. Every canvas (and the HTML day row) uses the same
// horizontal padding (FC_PAD.left/right) so the per-canvas xPos
// matches the HTML label positions; day separators / nighttime shading
// land at the same x on every card and below each day header label.
// Visual reference: project/Swell Forecast.html (React prototype).

const FORECAST_HOURS = 168; // 7 × 24

// Canvas-internal padding (CSS px). Identical on every panel canvas so
// the time-axis (xPos) matches across all three cards.
// Left gutter is sized for the longest tick label ("+3.5ft" — the top
// tick of each axis carries the unit suffix so no unit text floats
// inside the plot).
const FC_PAD = { left: 44, right: 40 };

// Web1-era font stacks for all chart-rendered text on the forecast tab.
// Primary chart labels (numbers, axes, compass cardinals, inline tide
// markers) use the same Tahoma-family sans-serif as the surrounding IE
// chrome so canvas text reads as text rather than a rasterized image.
// Monospace numeric readouts use Courier New, matching the address-bar
// and detail-bar field fonts.
let FC_CHART_FONT = '"MS Sans Serif", Tahoma, sans-serif'; // kiosk.js re-points this at Orbitron
const FC_CHART_FONT_MONO = '"Courier New", Courier, monospace';

// Retro Win95 chart palette — hardcoded hex literals to match the
// Forecast-tab visual overhaul. NO css variable indirection.
// NOTE: every color the chart drawers use lives in this palette (no
// hardcoded literals in the draw functions) so kiosk.js can re-theme the
// charts at boot via Object.assign without touching any drawing code.
const FC_RETRO = {
  plotBg:        '#F8F4E8',
  grid:          '#808080',
  ink:           '#000000',
  ink2:          '#404040',                   // unit labels, FROM, obs caption
  frame:         '#808080',                   // 1px plot frames
  swellFill:     '#4A6B9A',
  swellStroke:   '#1A3B6A',
  secSwellFill:  'rgba(74, 107, 154, 0.35)', // primary at 35%
  period:        '#B85A12',
  periodHalo:    'rgba(248, 244, 232, 0.85)', // legibility halo under period line
  dirPrimary:    '#1A3B6A',
  dirSecondary:  '#1A3B6A',
  // Wind quality colors keyed to the app's earth-tone palette (same stops
  // as the compass-rose period ramp) so the wind bars sit with the rest of
  // the retro chrome instead of shouting traffic-light primaries.
  windOn:        '#8a3a2e',
  windCross:     '#b87a2e',
  windOff:       '#3a7d56',
  windNull:      'rgba(128, 128, 128, 0.5)',
  windStroke:    '#404040',
  windBand:      'rgba(216, 232, 208, 0.6)',
  tide:          '#2A5D8C',
  tideMarkFaint: 'rgba(42, 93, 140, 0.55)',
  tideMark:      'rgba(42, 93, 140, 0.95)',
  tideConn:      'rgba(42, 93, 140, 0.7)',
  scrubDot:      '#000000',
  nowLine:       'rgba(44, 40, 37, 0.5)',
  daySep:        'rgba(44, 40, 37, 0.16)',
  nightShade:    'rgba(44, 40, 37, 0.04)',
  pastDim:       'rgba(44, 40, 37, 0.045)',
  obsFill:       '#FFFFFF',
  obsStroke:     '#000000',
  pulseCore:     '#1A3B6A',
  pulseRing:     '26, 59, 106'               // rgb triplet; alpha composed per frame
};

// Dashed gridline helper — 0.5px stroke, 2-2 dash, color #808080.
function _fcDrawDashedHGrid(ctx, x0, x1, y) {
  ctx.save();
  ctx.strokeStyle = FC_RETRO.grid;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawForecastChart(marine, wind, daylight, tideHiLo, tidePred, buoyParsed) {
  // Cache so the scrubber and external reflows can re-render without re-fetching.
  STATE.forecastData = { marine, wind, daylight, tideHiLo, tidePred, buoyParsed };
  // New data → re-resolve scrubber position (may reload from sessionStorage).
  STATE.scrubberIdx = -1;
  _drawForecastChartFull(marine, wind, daylight, tideHiLo, tidePred, buoyParsed);
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

// Dashed vertical "now" marker — drawn on every panel so the current
// moment reads as one continuous line across the stacked cards. Returns
// the x position (CSS px) or null when "now" is outside the chart window.
function _fcDrawNowLine(ctx, common, plotLeft, plotW, top, bottom) {
  const nowMs = Date.now();
  if (nowMs < common.t0 || nowMs > common.tEnd) return null;
  const nowX = _fcXFor(new Date(nowMs), common, plotLeft, plotW);
  ctx.save();
  ctx.strokeStyle = FC_RETRO.nowLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(nowX, top);
  ctx.lineTo(nowX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  return nowX;
}

// Subtle wash over hours already in the past, so elapsed vs upcoming
// reads at a glance without fighting the night shading.
function _fcDrawPastDim(ctx, common, plotLeft, plotW, top, h) {
  const nowMs = Date.now();
  if (nowMs <= common.t0) return;
  const nowX = Math.min(
    _fcXFor(new Date(nowMs), common, plotLeft, plotW),
    plotLeft + plotW
  );
  ctx.fillStyle = FC_RETRO.pastDim;
  ctx.fillRect(plotLeft, top, nowX - plotLeft, h);
}

function _fcDrawNightShading(ctx, common, plotLeft, plotW, top, height) {
  const dl0 = common.daylight;
  if (!dl0 || dl0.alwaysDay) return;
  ctx.fillStyle = FC_RETRO.nightShade;
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
  // Light midnight verticals — appear as continuous columns when drawn
  // on every panel canvas; kept faint so they read as calendar guides,
  // not data.
  ctx.strokeStyle = FC_RETRO.daySep;
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

// Filled black 3px circle. Color arg is accepted for backwards-compat
// with prior call sites but the retro spec mandates black dots.
function drawScrubberDot(ctx, x, y, _color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = FC_RETRO.scrubDot;
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
  // Upper region (~66%) hosts swell-height area + period line — the main
  // signal gets the space; the direction sub-panel takes the rest.
  const top      = 4;
  const usableH  = cssH - 8;
  const h        = Math.round(usableH * 0.66);
  const subTop   = top + h + 5;
  const subBot   = cssH - 2;

  // Cream plot background.
  ctx.fillStyle = FC_RETRO.plotBg;
  ctx.fillRect(0, 0, cssW, cssH);

  const { heights, secHeights, swellDirs, secDirs, wavePeriods, swellMaxY, swellDiv, periodMax, obsHsFt, obsMs } = data;

  // Dashed horizontal gridlines on the upper region, one per axis division.
  for (let q = 1; q < swellDiv; q++) {
    const yy = top + (h * q / swellDiv);
    _fcDrawDashedHGrid(ctx, plotLeft, plotLeft + plotW, yy);
  }

  // Night shading + day separators span both regions (same x-coords) but
  // stay inside the framed plot band, not the full canvas.
  _fcDrawNightShading(ctx, common, plotLeft, plotW, top, subBot - top);
  _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, subBot - top);
  _fcDrawPastDim(ctx, common, plotLeft, plotW, top, subBot - top);
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
    ctx.fillStyle = FC_RETRO.secSwellFill;
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
  ctx.fillStyle = FC_RETRO.swellFill;
  ctx.fill();

  // Primary stroke (1px outline on filled area).
  ctx.beginPath();
  ctx.strokeStyle = FC_RETRO.swellStroke;
  ctx.lineWidth = 1;
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
    // Background-tinted halo for legibility against the swell fill.
    ctx.beginPath();
    ctx.moveTo(periodPts[0][0], periodPts[0][1]);
    for (let i = 1; i < periodPts.length; i++) ctx.lineTo(periodPts[i][0], periodPts[i][1]);
    ctx.strokeStyle = FC_RETRO.periodHalo;
    ctx.lineWidth = 4;
    ctx.stroke();
    // Period line — rust orange, 2px.
    ctx.beginPath();
    ctx.moveTo(periodPts[0][0], periodPts[0][1]);
    for (let i = 1; i < periodPts.length; i++) ctx.lineTo(periodPts[i][0], periodPts[i][1]);
    ctx.strokeStyle = FC_RETRO.period;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // Y-axis labels: quartile ticks in regular 11px MS Sans Serif black
  // (classic dialog text). The top tick carries the unit ("6ft", "24s")
  // so no unit text floats inside the plot, and label y is clamped so
  // the end glyphs never clip against the panel edges.
  const clampLabelY = (yy) => Math.min(Math.max(yy, 7), cssH - 7);
  ctx.font = `11px ${FC_CHART_FONT}`;
  ctx.fillStyle = FC_RETRO.ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let q = 0; q <= swellDiv; q++) {
    const v = swellMaxY * (1 - q / swellDiv);
    const label = q === 0 ? `${v}ft` : String(v);
    ctx.fillText(label, plotLeft - 4, clampLabelY(top + (h * q / swellDiv)));
  }
  // Period axis wears the period line's own color so the right-hand
  // scale reads as belonging to that line.
  ctx.textAlign = 'left';
  ctx.fillStyle = FC_RETRO.period;
  for (let q = 0; q <= swellDiv; q++) {
    const v = periodMax * (1 - q / swellDiv);
    const label = q === 0 ? `${v}s` : String(v);
    ctx.fillText(label, plotLeft + plotW + 4, clampLabelY(top + (h * q / swellDiv)));
  }
  ctx.fillStyle = FC_RETRO.ink;

  // ── Direction sub-panel ──
  // Y-axis is compass degrees the swell is COMING FROM. The visible band
  // is auto-fit to ±120° around the configured swell-window midpoint, so
  // the window band itself + plenty of headroom for adjacent directions
  // is always in view.
  const winMin = CONFIG.chocomount.swellWindowMin;
  const winMax = CONFIG.chocomount.swellWindowMax;
  const winMid = (winMin + winMax) / 2;
  // Owner call: the axis never shows north of due east — swell at Choc
  // can't arrive from over the island, so E (90°) caps the top.
  const dirRangeMin = Math.max(winMid - 120, 90);
  const dirRangeMax = winMid + 120;
  const dirRange    = dirRangeMax - dirRangeMin;
  const subInsetT = subTop + 4;
  const subInsetB = subBot - 4;
  const subInsetH = subInsetB - subInsetT;
  const yDir = (deg) => subInsetT + ((deg - dirRangeMin) / dirRange) * subInsetH;

  // Window band: shaded rectangle covering the swellWindow degrees.
  ctx.fillStyle = FC_RETRO.windBand;
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
    drawDirPolyline(ctx, swellDirs, { color: FC_RETRO.dirPrimary, lineWidth: 1.5 });
  }
  if (secDirs && secDirs.length) {
    drawDirPolyline(ctx, secDirs, {
      color: FC_RETRO.dirSecondary,
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
  ctx.font = `11px ${FC_CHART_FONT}`;
  ctx.fillStyle = FC_RETRO.ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const cp of compassPoints) {
    if (cp.deg < dirRangeMin || cp.deg > dirRangeMax) continue;
    ctx.fillText(cp.label, plotLeft - 4, yDir(cp.deg));
  }

  // "FROM" label clarifies the y-axis represents the direction the
  // swell is COMING FROM (oceanographic convention). Top-right of the
  // sub-panel, away from the compass tick labels in the left gutter.
  ctx.font = `bold 10px ${FC_CHART_FONT}`;
  ctx.fillStyle = FC_RETRO.ink2;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('FROM', plotLeft + plotW - 6, subTop + 3);

  // Crisp 1px frames around both plot regions — Excel-97 style finished
  // edges instead of fills bleeding into the cream.
  ctx.strokeStyle = FC_RETRO.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, h - 1);
  ctx.strokeRect(plotLeft + 0.5, subTop + 0.5, plotW - 1, subBot - subTop - 1);

  // Dashed "now" line spanning the height region and the direction
  // sub-panel, drawn before the scrubber dots so markers layer on top.
  _fcDrawNowLine(ctx, common, plotLeft, plotW, top, subBot);

  // Buoy observation — white diamond on the swell panel at the time it was
  // MEASURED (the pipeline lands every 2-8 h, so pinning it to the now line
  // passed an old reading off as current); skipped when that time is
  // unknown or over 6 h old. The buoy reports TOTAL significant height while
  // the line plots the swell component, so this reads as "measured sea vs
  // forecast swell" (approximate by design). Clamped to the axis ceiling.
  const obsX = obsHsFt != null && obsMs != null && Date.now() - obsMs <= BUOY_OBS_OLD_MS &&
    obsMs >= common.t0 && obsMs <= common.tEnd ? xPos(new Date(obsMs)) : null;
  if (obsX != null) {
    const oy = ySwell(Math.min(obsHsFt, swellMaxY));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(obsX, oy - 4);
    ctx.lineTo(obsX + 4, oy);
    ctx.lineTo(obsX, oy + 4);
    ctx.lineTo(obsX - 4, oy);
    ctx.closePath();
    ctx.fillStyle = FC_RETRO.obsFill;
    ctx.fill();
    ctx.strokeStyle = FC_RETRO.obsStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (!isMobile) {
      ctx.font = `9px ${FC_CHART_FONT}`;
      ctx.fillStyle = FC_RETRO.ink2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('obs', obsX + 7, oy);
    }
    ctx.restore();
  }

  // Scrubber dots. The vertical scrub line itself is the HTML
  // .forecast-crosshair overlay — drawing a second line on the canvas at
  // the same x doubled it into a smudge, so the canvas only marks values.
  const sIdx = STATE.scrubberIdx;
  if (typeof sIdx === 'number' && sIdx >= 0 && sIdx <= common.lastIdx) {
    const tx = xPos(common.allTimes[sIdx]);
    // Upper region: secondary height, primary height, period.
    const secH = secHeights[sIdx];
    if (secH != null && secH >= 1.0) {
      drawScrubberDot(ctx, tx, ySwell(secH));
    }
    const priH = heights[sIdx];
    if (priH != null) {
      drawScrubberDot(ctx, tx, ySwell(priH));
    }
    const per = wavePeriods[sIdx];
    if (per != null && Number.isFinite(per)) {
      drawScrubberDot(ctx, tx, yPeriod(per));
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
      drawScrubberDot(ctx, tx, yDir(priDir));
    }
    const secDir = secDirs ? secDirs[sIdx] : null;
    if (secDir != null && secH != null && secH >= 1.0) {
      drawScrubberDot(ctx, tx, yDir(secDir));
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

  ctx.fillStyle = FC_RETRO.plotBg;
  ctx.fillRect(0, 0, cssW, cssH);
  _fcDrawNightShading(ctx, common, plotLeft, plotW, top, h);
  _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, h);
  _fcDrawPastDim(ctx, common, plotLeft, plotW, top, h);

  const { windSpeeds, windDirs, windMaxY } = data;
  const yWind = (val) => top + h - (Math.min(val, windMaxY) / windMaxY) * h;
  const xPos  = (t) => _fcXFor(t, common, plotLeft, plotW);

  // Wind quality colors — offshore (green) / cross-shore (yellow) / onshore (red).
  // Light winds (<5 mph) upgrade one tier so colors don't mislead at calm hours.
  const OFFSHORE_CENTER = 335;
  const colorFor = (dir, speed) => {
    if (dir == null) return FC_RETRO.windNull;
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
    if (bucket === 'off')   return FC_RETRO.windOff;
    if (bucket === 'cross') return FC_RETRO.windCross;
    return FC_RETRO.windOn;
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
  ctx.strokeStyle = FC_RETRO.windStroke;
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

  // Horizontal dashed gridlines at 5 mph intervals — #808080, 0.5px, 2-2.
  for (let v = 5; v < windMaxY; v += 5) {
    _fcDrawDashedHGrid(ctx, plotLeft, plotLeft + plotW, yWind(v));
  }

  // Y-axis labels: every 5 mph in regular 11px sans, black. Top tick
  // carries the unit ("25mph"); label y clamped so end glyphs don't clip.
  ctx.font = `11px ${FC_CHART_FONT}`;
  ctx.fillStyle = FC_RETRO.ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= windMaxY; v += 5) {
    const label = v === windMaxY ? `${v}mph` : String(v);
    const yy = Math.min(Math.max(yWind(v), 7), cssH - 7);
    ctx.fillText(label, plotLeft - 4, yy);
  }

  // Crisp 1px plot frame, then the dashed "now" line beneath the markers.
  ctx.strokeStyle = FC_RETRO.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, h - 1);
  _fcDrawNowLine(ctx, common, plotLeft, plotW, top, top + h);

  // Scrubber dot (the scrub line is the HTML crosshair overlay).
  const sIdx = STATE.scrubberIdx;
  if (typeof sIdx === 'number' && sIdx >= 0 && sIdx <= common.lastIdx) {
    const tx = xPos(common.allTimes[sIdx]);
    const ws = windSpeeds[sIdx];
    if (ws != null) {
      drawScrubberDot(ctx, tx, yWind(ws));
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

  ctx.fillStyle = FC_RETRO.plotBg;
  ctx.fillRect(0, 0, cssW, cssH);
  _fcDrawNightShading(ctx, common, plotLeft, plotW, top, h);
  _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, h);
  _fcDrawPastDim(ctx, common, plotLeft, plotW, top, h);

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

    const tideStroke = FC_RETRO.tide;
    const drawSegment = (alpha, xClipMin, xClipMax) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(xClipMin, top, Math.max(0, xClipMax - xClipMin), h);
      ctx.clip();
      ctx.beginPath();
      ctx.strokeStyle = tideStroke;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.5;
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

  // Y-axis labels for tide range: max / 0 / min in regular 11px sans.
  // Top tick carries the unit ("+3.5ft"); ends clamped against clipping.
  if (tideY && Number.isFinite(tideMin) && Number.isFinite(tideMax)) {
    ctx.font = `11px ${FC_CHART_FONT}`;
    ctx.fillStyle = FC_RETRO.ink;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
    ctx.fillText(fmt(tideMax) + 'ft', plotLeft - 4, Math.max(tideY(tideMax), 7));
    ctx.fillText(fmt(tideMin), plotLeft - 4, Math.min(tideY(tideMin), cssH - 7));
    if (tideMin < 0 && tideMax > 0) {
      ctx.fillText('0', plotLeft - 4, tideY(0));
      _fcDrawDashedHGrid(ctx, plotLeft, plotLeft + plotW, tideY(0));
    }
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
      ctx.fillStyle = FC_RETRO.tideMarkFaint;
      ctx.beginPath();
      ctx.moveTo(xx, yy + 1);
      ctx.lineTo(xx - 3, yy - 4);
      ctx.lineTo(xx + 3, yy - 4);
      ctx.closePath();
      ctx.fill();
    }

    // Second pass: labeled lows (the next two after nowMs).
    // Estimate label width once so we can collision-check.
    ctx.font = `${isMobile ? '9px' : '10px'} ${FC_CHART_FONT}`;
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
      ctx.fillStyle = FC_RETRO.tideMark;
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

      ctx.font = `bold 10px ${FC_CHART_FONT}`;
      ctx.fillStyle = FC_RETRO.tide;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const baseTop = yy + 4;
      const lowOff = pushDown ? 14 : 0;
      const stackBelow = (baseTop + lowOff + 9) < (top + h) - 2;
      if (stackBelow) {
        if (pushDown) {
          // Connector: thin teal line from trough up to label baseline.
          ctx.save();
          ctx.strokeStyle = FC_RETRO.tideConn;
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
          ctx.strokeStyle = FC_RETRO.tideConn;
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

  // Crisp 1px plot frame, then the dashed "now" line beneath the markers.
  ctx.strokeStyle = FC_RETRO.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, h - 1);
  _fcDrawNowLine(ctx, common, plotLeft, plotW, top, top + h);

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
        drawScrubberDot(ctx, tx, tideY(v));
      }
    }
  }

  return { canvas, cssW, cssH, plotLeft, plotW, top, h, tideMin, tideMax };
}

// Day labels are native HTML — positioned above the chart cards as a
// header strip, x-aligned to the canvas plot area via the same FC_PAD
// padding the chart canvases use. Rendered as bold text in the web1
// sans family so they read as crisp window-bar labels rather than
// rasterized canvas text.
function renderDayLabels(common) {
  const host = el('forecast-day-header');
  if (!host) return;
  host.replaceChildren();
  const W = host.clientWidth;
  if (W <= 0) return;
  const plotLeft = FC_PAD.left;
  const plotW    = W - FC_PAD.left - FC_PAD.right;
  if (plotW <= 0) return;

  const todayLocal = new Date(); todayLocal.setHours(0, 0, 0, 0);
  for (let dayOff = 0; dayOff < common.dayCount; dayOff++) {
    const dayStart = new Date(common.firstDay);
    dayStart.setDate(dayStart.getDate() + dayOff);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const visStart = Math.max(_fcXFor(dayStart, common, plotLeft, plotW), plotLeft);
    const visEnd   = Math.min(_fcXFor(dayEnd,   common, plotLeft, plotW), plotLeft + plotW);
    if (visEnd <= visStart + 8) continue;
    const xx = (visStart + visEnd) / 2;
    const colW = visEnd - visStart;
    const dayDelta = Math.round((dayStart - todayLocal) / 86400000);
    // Pick a label that fits the day's column so narrow (mobile) charts
    // don't render "Tue 7/TodayomorrTni…" overlaps: full name when the
    // column is wide, bare weekday when tight, alternating when tighter.
    let label;
    if (colW >= 76) {
      if (dayDelta === 0)      label = 'Today';
      else if (dayDelta === 1) label = 'Tomorrow';
      else label = `${dayStart.toLocaleDateString('en-US',{weekday:'short'})} ${dayStart.getMonth()+1}/${dayStart.getDate()}`;
    } else if (colW >= 34) {
      label = dayDelta === 0 ? 'Today' : dayStart.toLocaleDateString('en-US', { weekday: 'short' });
    } else if (dayOff % 2 === 0 || dayDelta === 0) {
      label = dayDelta === 0 ? 'Now' : dayStart.toLocaleDateString('en-US', { weekday: 'narrow' });
    } else {
      continue; // too narrow — skip to keep neighbors legible
    }
    const span = document.createElement('span');
    span.className = 'forecast-day-label';
    span.textContent = label;
    span.style.left = xx + 'px';
    host.appendChild(span);
  }
}

// ── Persistent compass dial (top-right of the swell card) ──
//
// Renders a small ~60x60 dial showing the primary and (when present)
// secondary swell FROM directions for the currently-scrubbed hour.
// Arrow points TOWARD the FROM direction (oceanographic convention),
// not where the swell is heading.
function drawCompassDial(_scrubberIdx) {
  // Compass dial removed in the Win95 visual overhaul. Direction reads
  // off the swell card's expanded direction sub-panel (~45% of plot
  // height); the corner is freed for the sub-title strip.
}

function _drawForecastChartFull(marine, wind, daylight, tideHiLo, tidePred, buoyParsed) {
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
  // Tight, even axis: smallest max from {4, 6, 8, 12, 16, …} that clears the
  // peak by ~10%, so a small week isn't squashed into the bottom quarter of
  // an oversized scale. 6 splits into thirds (0/2/4/6); multiples of 4 into
  // quarters — either way every tick (and the paired period tick) lands on a
  // whole number.
  const swellTarget = swellPeak * 1.1;
  let swellMaxY;
  if (swellTarget <= 4) swellMaxY = 4;
  else if (swellTarget <= 6) swellMaxY = 6;
  else swellMaxY = Math.ceil(swellTarget / 4) * 4;
  const swellDiv = swellMaxY === 6 ? 3 : 4; // shared y-axis division count
  // Period right axis: fixed 0–24s (divides evenly by 3 and 4).
  const periodMax = 24;
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
  const swellPayload = {
    heights, secHeights, swellDirs, secDirs, wavePeriods, swellMaxY, swellDiv, periodMax,
    // Observed total Hs (feet) from the buoy and when it was measured, for
    // the "obs" marker.
    obsHsFt: buoyParsed && buoyParsed.waveHeight != null ? buoyParsed.waveHeight : null,
    obsMs: buoyParsed && Number.isFinite(buoyParsed.obsMs) ? buoyParsed.obsMs : null
  };
  const windPayload  = { windSpeeds, windDirs, windMaxY };
  const tidePayload  = { tidePred, tideHiLo };
  const swellInfo = drawSwellPanel(common, swellPayload);
  drawWindPanel(common, windPayload);
  const tideInfo = drawTidePanel(common, tidePayload);
  renderDayLabels(common);

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

  // "Now" pulse overlay — re-sized to the container on every full draw
  // (covers resizes), then the rAF loop keeps the marker drifting in
  // real time without touching the panel canvases.
  const overlay = _ensureNowOverlay(container);
  setCanvasDPR(overlay, overlay.getContext('2d'), W, container.clientHeight);
  _nowPulsePrev = null;
  startNowPulse();
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
// Gesture state lives here, not in setupForecastInteraction's closure:
// a ResizeObserver redraw re-wires the listeners, and a drag must survive
// that (audit C45). drag = the canvas a mouse drag started on; touch =
// the touch's start point and its locked direction ('h' scrubs, 'v'
// scrolls the page).
const _fcGesture = { drag: null, touchStart: null, touchMode: null };
const FC_TOUCH_SLOP_PX = 8;

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
  // Restore from sessionStorage if present — but only honor it if the
  // stored hour is still close enough to "now" to be meaningful. Without
  // this guard, a mobile tab kept alive overnight will resurrect an
  // 11-hour-stale scrubber position on next view (the "-11H" bug).
  let stored = null;
  try { stored = sessionStorage.getItem('lcc-scrubber-hour'); } catch (_) {}
  if (stored) {
    const targetMs = new Date(stored).getTime();
    if (Number.isFinite(targetMs)) {
      // Honor stored value only if it points to the current hour or a
      // future hour; if it's >1 hour in the past treat it as stale and
      // default to "now" instead.
      const stalenessMs = Date.now() - targetMs;
      if (stalenessMs <= 60 * 60 * 1000) {
        const idx = findHourIndexForTime(targetMs, cs);
        if (idx >= 0) {
          STATE.scrubberIdx = idx;
          return idx;
        }
      } else {
        // Drop the stale value so we don't keep re-evaluating it.
        try { sessionStorage.removeItem('lcc-scrubber-hour'); } catch (_) {}
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

  // Stat grid cards (Swell/Wind/Tide/Temp/Daylight) intentionally do
  // NOT follow the scrubber — they are a real-time "what's it doing
  // right now" snapshot. The chart is the time-travel surface. Strip
  // any leftover scrub badge so old state can't leak in.
  document.querySelectorAll('.scrub-badge').forEach(b => b.remove());

  // ── "Reset to now" link visibility (lives inside the detail bar) ──
  // visibility, not display: its space stays reserved, so showing it on
  // the first scrub doesn't re-wrap the detail bar and resize the chart
  // container (which costs a full redraw + listener re-wire, audit C45).
  const resetBtn = el('forecast-reset-now');
  if (resetBtn) resetBtn.style.visibility = isScrubberAtNow() ? 'hidden' : 'visible';

  // ── Cross-feature: Tab 2 prediction widget tracks the scrubber too. ──
  if (typeof _regNotifyScrubberMoved === 'function') _regNotifyScrubberMoved();
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

  const g = _fcGesture;

  for (const cv of canvases) {
    cv.addEventListener('mousedown', (e) => {
      g.drag = cv;
      cv.style.cursor = 'ew-resize';
      const idx = indexFromClientXOnCanvas(e.clientX, cv);
      setScrubberToIdx(idx, true);
      e.preventDefault();
    }, { signal });

    cv.addEventListener('mousemove', (e) => {
      if (!g.drag) return;
      const idx = indexFromClientXOnCanvas(e.clientX, g.drag);
      setScrubberToIdx(idx, true);
    }, { signal });

    // Touch: the canvases are touch-action: pan-y, so the browser keeps
    // vertical swipes as page scrolls. Nothing moves on touchstart; once
    // the finger has travelled FC_TOUCH_SLOP_PX the gesture locks to a
    // direction, and only a horizontal drag scrubs (and blocks the
    // default). A plain tap still scrubs via the compatibility mousedown.
    cv.addEventListener('touchstart', (e) => {
      g.touchMode = null;
      g.touchStart = e.touches.length === 1
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }, { passive: true, signal });

    cv.addEventListener('touchmove', (e) => {
      if (!g.touchStart || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!g.touchMode) {
        const dx = Math.abs(t.clientX - g.touchStart.x);
        const dy = Math.abs(t.clientY - g.touchStart.y);
        if (dx < FC_TOUCH_SLOP_PX && dy < FC_TOUCH_SLOP_PX) return;
        g.touchMode = dx > dy ? 'h' : 'v';
      }
      if (g.touchMode !== 'h') return;
      if (e.cancelable) e.preventDefault();
      setScrubberToIdx(indexFromClientXOnCanvas(t.clientX, cv), true);
    }, { passive: false, signal });

    const endTouch = () => { g.touchStart = null; g.touchMode = null; };
    cv.addEventListener('touchend', endTouch, { passive: true, signal });
    cv.addEventListener('touchcancel', endTouch, { passive: true, signal });
  }

  // Even when the cursor strays off a canvas, dragging should still follow
  // until mouseup. Listen to window-level mousemove for that.
  window.addEventListener('mousemove', (e) => {
    if (!g.drag) return;
    const idx = indexFromClientXOnCanvas(e.clientX, g.drag);
    setScrubberToIdx(idx, true);
  }, { signal });

  window.addEventListener('mouseup', () => {
    if (g.drag) g.drag.style.cursor = '';
    g.drag = null;
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

// ── "Now" pulse overlay ─────────────────────────
//
// A lazily-created canvas layered over the whole forecast-chart container
// and animated with rAF. It lives OUTSIDE the three panel canvases, so
// scrubber repaints and the pulse never invalidate each other; it is
// pointer-events:none so the canvases' scrubber hit-testing is unaffected.

let _nowPulseRAF = null;
let _nowPulsePrev = null; // last drawn {x, y} for dirty-rect clearing
// Each frame makes the browser re-composite the whole overlay, so the
// ring animates at ~10 fps (it is a 3 px, 1.6 s fade; 60 fps bought
// nothing visible) and the loop stops while the chart is hidden or
// scrolled off-screen (audit C36).
const NOW_PULSE_FRAME_MS = 100;
let _nowPulseInView = true;   // IntersectionObserver verdict; true until it reports
let _nowPulseIO = null;

function _ensureNowOverlay(container) {
  let overlay = el('forecast-now-overlay');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.id = 'forecast-now-overlay';
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.pointerEvents = 'none';
    // Below the crosshair (z 5) and the sticky detail bar (z 10).
    overlay.style.zIndex = '3';
    container.appendChild(overlay);
  }
  return overlay;
}

// Container-relative marker position: x tracks Date.now() continuously,
// y is the primary swell height interpolated between the bounding hourly
// samples. Returns null when "now" is outside the chart window.
function _nowMarkerGeom() {
  const cs = STATE.forecastChart;
  if (!cs || !cs.layout) return null;
  const nowMs = Date.now();
  if (nowMs < cs.t0 || nowMs > cs.tEnd) return null;
  const L = cs.layout;
  const x = L.plotLeft + ((nowMs - cs.t0) / cs.tRange) * L.plotW;
  let y = null;
  for (let i = 0; i < cs.times.length - 1; i++) {
    const a = cs.times[i].getTime(), b = cs.times[i + 1].getTime();
    if (nowMs >= a && nowMs <= b) {
      const va = cs.heights[i], vb = cs.heights[i + 1];
      if (va != null && vb != null && b > a) {
        const v = va + (vb - va) * ((nowMs - a) / (b - a));
        y = L.swellTop + L.swellH - (Math.min(v, L.swellMaxY) / L.swellMaxY) * L.swellH;
      }
      break;
    }
  }
  if (y == null) return null;
  return { x, y };
}

function _drawNowPulseFrame(staticFrame) {
  const container = el('forecast-chart-container');
  const overlay = el('forecast-now-overlay');
  // Skip while the tab/panel is hidden (zero-width container).
  if (!container || !overlay || container.offsetWidth === 0) return;
  const ctx = overlay.getContext('2d');
  // Clear only a dirty square around the previously drawn marker.
  if (_nowPulsePrev) {
    ctx.clearRect(_nowPulsePrev.x - 14, _nowPulsePrev.y - 14, 28, 28);
    _nowPulsePrev = null;
  }
  const g = _nowMarkerGeom();
  if (!g) return;
  // Core dot.
  ctx.beginPath();
  ctx.arc(g.x, g.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = FC_RETRO.pulseCore;
  ctx.fill();
  // Expanding, fading ring (~1.6s cycle).
  if (!staticFrame) {
    const phase = (performance.now() % 1600) / 1600;
    ctx.beginPath();
    ctx.arc(g.x, g.y, 3 + phase * 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${FC_RETRO.pulseRing}, ${(0.6 * (1 - phase)).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  _nowPulsePrev = g;
}

function startNowPulse() {
  if (_nowPulseRAF != null) return; // idempotent — full draws can't stack loops
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    _drawNowPulseFrame(true); // single static marker, no animation loop
    return;
  }
  _watchNowPulseViewport();
  let last = -Infinity;
  const tick = (ts) => {
    // Hidden (another tab, a kiosk panel without the chart) or scrolled
    // away: end the loop instead of spinning. switchTab, the observer
    // below, visibilitychange and every full chart draw restart it.
    const container = el('forecast-chart-container');
    if (!container || container.offsetWidth === 0 || !_nowPulseInView) {
      _nowPulseRAF = null;
      return;
    }
    if (ts - last >= NOW_PULSE_FRAME_MS) {
      last = ts;
      _drawNowPulseFrame(false);
    }
    _nowPulseRAF = requestAnimationFrame(tick);
  };
  _nowPulseRAF = requestAnimationFrame(tick);
}

// Pause the pulse while the chart is scrolled off-screen (long phone
// pages) and resume when it comes back. Created once, on first start.
function _watchNowPulseViewport() {
  if (_nowPulseIO || typeof IntersectionObserver !== 'function') return;
  const container = el('forecast-chart-container');
  if (!container) return;
  _nowPulseIO = new IntersectionObserver(entries => {
    _nowPulseInView = entries[entries.length - 1].isIntersecting;
    if (_nowPulseInView && STATE.forecastChart && !document.hidden) startNowPulse();
  });
  _nowPulseIO.observe(container);
}

function stopNowPulse() {
  if (_nowPulseRAF != null) {
    cancelAnimationFrame(_nowPulseRAF);
    _nowPulseRAF = null;
  }
  const overlay = el('forecast-now-overlay');
  if (overlay) {
    const octx = overlay.getContext('2d');
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }
  _nowPulsePrev = null;
}

// No rAF burn while the browser tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopNowPulse();
  else if (STATE.forecastChart) startNowPulse();
});

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
    ctx.font = `10px ${FC_CHART_FONT}`;
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
  ctx.font = `bold 10px ${FC_CHART_FONT}`;
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

// Parse the UTC observation timestamp from a .spec data row's first five
// columns (YY MM DD hh mm). Old-format files use 2-digit years.
function parseSpecRowTime(cols) {
  let y = parseInt(cols[0], 10);
  const mo = parseInt(cols[1], 10), d = parseInt(cols[2], 10);
  const h = parseInt(cols[3], 10), mi = parseInt(cols[4], 10);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  if (y < 100) y += 2000;
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

// Parse NDBC .spec summary rows, newest first (lines[0]/[1] are header/units).
// Columns: YY MM DD hh mm WVHT SwH SwP WWH WWP SwD WWD STEEPNESS APD MWD
// Indices: 0  1  2  3  4  5    6   7   8   9   10  11  12        13  14
// SwD and WWD are text compass (e.g. "SE", "SSE"); MWD is numeric degrees.
// Returns [] for garbage input — e.g. an HTML error page handed back by a
// CORS proxy as a "successful" response (real files start with "#YY ...").
function parseSpecRows(specText, maxRows) {
  if (!specText) return [];
  const limit = maxRows || 12;
  const lines = specText.trim().split('\n');
  if (lines.length < 3 || !lines[0].trim().startsWith('#')) return [];
  const out = [];
  for (let li = 2; li < lines.length && out.length < limit; li++) {
    const data = lines[li].trim().split(/\s+/);
    if (data.length < 15) continue;
    const time = parseSpecRowTime(data);
    if (!time) continue;
    const sf = (idx, invalid) => {
      const v = parseFloat(data[idx]);
      if (!Number.isFinite(v)) return null;
      return v < (invalid || 99) ? v : null;
    };
    const compass = idx => {
      const t = data[idx];
      return t ? (COMPASS_TO_DEG[t.toUpperCase()] ?? null) : null;
    };
    out.push({
      time,
      hs: sf(5),
      swellHt: sf(6),
      swellPeriod: sf(7),
      windHt: sf(8),
      windPeriod: sf(9),
      swellDir: compass(10),
      windDir: compass(11),
      meanDir: sf(14, 999)
    });
  }
  return out;
}

function parseSpecSummaryFromText(specText) {
  return parseSpecRows(specText, 1)[0] || null;
}

// Pick the historical row to diff against: the one closest to one hour
// before the latest observation, accepted only when its age relative to
// the latest is between 45 min and 3.5 h. Time-based (not row-index) so
// 30-min-cadence stations and files with gaps both behave.
function pickTrendBaseline(rows) {
  if (!rows || rows.length < 2) return null;
  const latestMs = rows[0].time.getTime();
  const targetMs = latestMs - 60 * 60 * 1000;
  let best = null, bestDiff = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const age = latestMs - rows[i].time.getTime();
    if (age < 45 * 60 * 1000 || age > 3.5 * 60 * 60 * 1000) continue;
    const diff = Math.abs(rows[i].time.getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = rows[i]; }
  }
  return best;
}

// Per-cell deltas vs the baseline row, in DISPLAY units (ft / s) so the
// arrow numbers match the rendered cells. dir: 'up' | 'down' | 'flat';
// null when either side is missing. Thresholds: ±0.2 ft, ±0.5 s.
function computeSpecTrends(latest, baseline) {
  if (!latest || !baseline) return null;
  const mft = v => v == null ? null : v * 3.28084;
  const trend = (a, b, threshold) => {
    if (a == null || b == null) return null;
    const delta = a - b;
    if (Math.abs(delta) < threshold) return { delta, dir: 'flat' };
    return { delta, dir: delta > 0 ? 'up' : 'down' };
  };
  return {
    hs:          trend(mft(latest.hs),      mft(baseline.hs),      0.2),
    swellHt:     trend(mft(latest.swellHt), mft(baseline.swellHt), 0.2),
    swellPeriod: trend(latest.swellPeriod,  baseline.swellPeriod,  0.5),
    windHt:      trend(mft(latest.windHt),  mft(baseline.windHt),  0.2),
    windPeriod:  trend(latest.windPeriod,   baseline.windPeriod,   0.5)
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
  let trends = null;
  let source = null; // 'live' (realtime NDBC .spec) | 'pipeline' (2h archive)
  if (spectralRaw && spectralRaw.spec) {
    const specRows = parseSpecRows(spectralRaw.spec);
    summary = specRows[0] || null;
    if (summary) {
      source = 'live';
      trends = computeSpecTrends(summary, pickTrendBaseline(specRows));
    }
  }
  if (!summary && spectralRaw && spectralRaw._pipelineSummary) {
    const ps = spectralRaw._pipelineSummary;
    source = 'pipeline';
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
    STATE.lastSpecSummary = null;
    container.innerHTML = '<div class="spectral-empty-msg">Spectral summary unavailable</div>';
    return;
  }

  // Prefer the energy-weighted direction from the bins when available — more
  // precise than the 22.5° compass value in the .spec summary.
  const bins = STATE.lastSpectral && STATE.lastSpectral.bins;
  const derivedDir = computePrimarySwellDir(bins);
  if (derivedDir != null) summary.swellDir = derivedDir;

  // Share with the compass rose so both surfaces resolve the same Hs.
  STATE.lastSpecSummary = summary;

  const mToFt = v => v != null ? (v * 3.28084).toFixed(1) : '—';
  const fmtP = v => v != null ? v.toFixed(1) : '—';

  // Trend marker (▲ / ▼ + delta in display units) next to a numeric cell.
  // Flat / unavailable trends render nothing.
  const trendHTML = (t, unit) => {
    if (!t || t.dir === 'flat') return '';
    const cls = t.dir === 'up' ? 'trend-up' : 'trend-down';
    const sym = t.dir === 'up' ? '▲' : '▼';
    const sign = t.delta > 0 ? '+' : '−';
    const mag = Math.abs(t.delta).toFixed(1);
    return ` <span class="trend ${cls}" title="${sign}${mag} ${unit} vs ~1h ago">${sym}${mag}</span>`;
  };

  // NDBC directions are FROM (meteorological). The glyph points in the
  // TRAVEL (to) direction — same convention as drawArrow() and the
  // lineup-map arrows — while the text keeps the FROM label.
  const fmtDir = v => {
    if (v == null) return '—';
    const toDeg = (v + 180) % 360;
    return `<span class="dir-arrow" style="transform:rotate(${Math.round(toDeg)}deg)" ` +
      `title="from ${directionLabel(v)} (${Math.round(v)}°), traveling ${directionLabel(toDeg)}">↑</span>` +
      `${directionLabel(v)} (${Math.round(v)}°)`;
  };

  // Period cell: color chip keyed to the compass-rose legend ramp (2s→22s+).
  const fmtPeriodCell = (p, t) => {
    if (p == null) return '—';
    return `<span class="period-chip" style="background:${periodColorRGBA(p, 1)}"></span>` +
      fmtP(p) + trendHTML(t, 's');
  };
  const fmtHtCell = (m, t) => m == null ? '—' : mToFt(m) + trendHTML(t, 'ft');

  const hsFt = resolveHsFt(summary.hs, buoyParsed && buoyParsed.waveHeight, bins);
  const hsCell = hsFt != null
    ? hsFt.toFixed(1) + trendHTML(trends && trends.hs, 'ft')
    : '—';

  const t = trends || {};
  // NDBC's own swell / wind-sea split (SwH / WWH). The pipeline's buoy,
  // 44097, reports no separation frequency, so NDBC cuts at a fixed 10 s
  // and 8-9 s swell lands under wind waves; the swell card's 8 s+ band is
  // the number to read for Choc.
  const split = source === 'pipeline' ? ' 10 s' : '';
  const rows = [
    { label: `Swell (NDBC${split} split)`, ht: fmtHtCell(summary.swellHt, t.swellHt), period: fmtPeriodCell(summary.swellPeriod, t.swellPeriod), dir: fmtDir(summary.swellDir) },
    { label: `Wind Waves (NDBC${split} split)`, ht: fmtHtCell(summary.windHt, t.windHt), period: fmtPeriodCell(summary.windPeriod, t.windPeriod), dir: fmtDir(summary.windDir) },
    { label: 'Significant Hs', ht: hsCell, period: '—', dir: '—' }
  ];

  // Freshness strip — green LIVE for a recent realtime observation, amber
  // STALE for an old one, amber ARCHIVE on the pipeline fallback.
  const strip = document.createElement('div');
  strip.className = 'spectral-status-strip';
  if (source === 'live' && summary.time) {
    const ageMs = Date.now() - summary.time.getTime();
    const state = ageMs <= 2 * 60 * 60 * 1000 ? 'live' : 'stale';
    strip.classList.add(`is-${state}`);
    strip.textContent =
      `${state.toUpperCase()} · obs ${formatTime(summary.time)} (${formatAgo(summary.time)})`;
  } else if (source === 'pipeline') {
    strip.classList.add('is-archive');
    let txt = 'ARCHIVE · pipeline';
    // Pipeline timestamps arrive as "YYYY-MM-DD HH:mm UTC" strings.
    const obs = spectralRaw._obsTimeStr
      ? new Date(spectralRaw._obsTimeStr.replace(' UTC', 'Z').replace(' ', 'T'))
      : null;
    if (obs && !isNaN(obs)) txt += ` · obs ${formatTime(obs)} (${formatAgo(obs)})`;
    if (spectralRaw._fetchTime) {
      const ft = new Date(spectralRaw._fetchTime);
      if (!isNaN(ft)) txt += ` · fetched ${formatTime(ft)}`;
    }
    strip.textContent = txt;
  } else {
    strip.classList.add('is-stale');
    strip.textContent = 'obs time unavailable';
  }
  container.appendChild(strip);

  const table = document.createElement('table');
  table.className = 'spectral-summary-tbl';
  const thead = '<thead><tr><th>Component</th><th>Height (ft)</th><th>Period (s)</th><th>Direction</th></tr></thead>';
  const tbody = rows.map(r =>
    `<tr><td>${r.label}</td><td class="num-cell">${r.ht}</td><td class="num-cell">${r.period}</td><td class="num-cell">${r.dir}</td></tr>`
  ).join('');
  table.innerHTML = thead + '<tbody>' + tbody + '</tbody>';
  container.appendChild(table);
}

// ════════════════════════════════════════════════
// SPECTRAL EMPTY STATE HELPERS
// ════════════════════════════════════════════════

// buoyId: a spectral buoy whose data isn't available; message says why.
function showSpectralEmpty(buoyId, message) {
  const compassContainer = el('compass-canvas').parentElement;
  const spectrumContainer = el('spectrum-canvas').parentElement;
  el('compass-canvas').style.display = 'none';
  el('spectrum-canvas').style.display = 'none';
  // Remove old empty messages if present
  compassContainer.querySelectorAll('.spectral-empty-msg').forEach(e => e.remove());
  spectrumContainer.querySelectorAll('.spectral-empty-msg').forEach(e => e.remove());
  const msg = document.createElement('div');
  msg.className = 'spectral-empty-msg';
  msg.textContent = message || 'Please select a buoy with spectral data (e.g., 44097) to view wave energy.';
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
// Rose/compass colors — palette object (not literals) so kiosk.js can
// re-theme the rose the same way it re-themes FC_RETRO.
const ROSE_THEME = {
  bg:       '#F8F4E8',
  ring:     '#808080',
  cardinal: '#000000',
  window:   '#3a7d56',
  hs:       '#2c2825',
  hsSub:    '#8a827a'
};

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

// Hs = 4 * sqrt(m0) from spectral bins, in FEET (m0 = Σ energy·df).
function hsFromBinsFt(bins) {
  if (!bins || !bins.length) return null;
  let m0 = 0;
  for (let i = 0; i < bins.length; i++) {
    const df = i < bins.length - 1
      ? Math.abs(bins[i + 1].freq - bins[i].freq)
      : (i > 0 ? Math.abs(bins[i].freq - bins[i - 1].freq) : 0.005);
    m0 += bins[i].energy * df;
  }
  return m0 > 0 ? 4 * Math.sqrt(m0) * 3.28084 : null;
}

// Single source of truth for the significant wave height shown in the
// Wave Spectra table and the compass-rose center, so the two adjacent
// widgets can never disagree. Preference: .spec/pipeline-reported Hs
// (meters) → buoy stdmet Hs (already feet) → 4√m0 from the bins.
function resolveHsFt(specHsM, buoyHsFt, bins) {
  if (specHsM != null) return specHsM * 3.28084;
  if (buoyHsFt != null) return buoyHsFt;
  return hsFromBinsFt(bins);
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

  // Cream Win95 background.
  ctx.fillStyle = ROSE_THEME.bg;
  ctx.fillRect(0, 0, size, size);

  // Concentric reference rings (geometric scaffolding only; radial axis now
  // encodes wave energy density, so no period labels).
  const guideRings = [0.25, 0.5, 0.75, 1.0];
  guideRings.forEach(frac => {
    ctx.strokeStyle = ROSE_THEME.ring;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(cx, cy, frac * r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // Cardinal labels — bold black MS Sans Serif.
  ctx.fillStyle = ROSE_THEME.cardinal;
  ctx.font = `bold 11px ${FC_CHART_FONT}`;
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
    ctx.strokeStyle = ROSE_THEME.window;
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
    ctx.fillStyle = ROSE_THEME.window;
    ctx.globalAlpha = 0.06;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, degToRad(min - 90), degToRad(max - 90));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // Swell window degree labels
    ctx.font = `9px ${FC_CHART_FONT}`;
    ctx.fillStyle = ROSE_THEME.window;
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
    ctx.font = `italic 9px ${FC_CHART_FONT}`;
    ctx.fillStyle = ROSE_THEME.window;
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
  STATE._roseWedges = null;
  STATE._roseGeom = null;
  if (spectral && spectral.bins && spectral.bins.length) {
    const rMax = r * 0.95;
    const compressed = STATE.roseScaleMode === 'sqrt';
    const scaleFn = compressed ? Math.sqrt : (v => v);

    // Total spectral energy (Σ energy·df) so each wedge can report its
    // share in the hover readout. df mirrors hsFromBinsFt's differencing.
    const bins = spectral.bins;
    let m0 = 0;
    const binShare = bins.map((b, i) => {
      const df = i < bins.length - 1
        ? Math.abs(bins[i + 1].freq - bins[i].freq)
        : (i > 0 ? Math.abs(bins[i].freq - bins[i - 1].freq) : 0.005);
      const e = b.energy > 0 ? b.energy * df : 0;
      m0 += e;
      return e;
    });

    const wedges = [];
    let maxScaled = 0;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      if (!(b.energy > 0) || !(b.period > 0) || !Number.isFinite(b.dir1)) continue;
      const scaled = scaleFn(b.energy);
      if (scaled > maxScaled) maxScaled = scaled;
      wedges.push({
        id: wedges.length,
        period: b.period,
        dir: ((b.dir1 % 360) + 360) % 360,
        r1: Number.isFinite(b.r1) ? Math.max(0, Math.min(1, b.r1)) : null,
        share: m0 > 0 ? binShare[i] / m0 : 0,
        scaled
      });
    }
    if (maxScaled > 0) {
      // Render largest wedges first so small ones stay visible on top.
      wedges.sort((a, b) => b.scaled - a.scaled);

      const hoverId = STATE._roseHover;
      const hasHover = hoverId != null && wedges.some(w => w.id === hoverId);
      const ALPHA = 0.55;
      const drawn = [];
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
        const isHover = hasHover && w.id === hoverId;

        ctx.fillStyle = periodColorRGBA(w.period, isHover ? 0.9 : (hasHover ? 0.18 : ALPHA));
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rOuter, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();
        if (isHover) {
          ctx.strokeStyle = periodColorRGBA(w.period, 1);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        // Keep hit-test geometry only for wedges actually drawn.
        drawn.push({ id: w.id, dir: w.dir, halfDeg, rOuter, period: w.period, share: w.share });
      }
      STATE._roseWedges = drawn;
      STATE._roseGeom = { cx, cy, size };
    }
  }

  // Hs value at center — shared resolver (resolveHsFt) so the rose and
  // the Wave Spectra table always display the same number.
  const hsFt = resolveHsFt(
    STATE.lastSpecSummary && STATE.lastSpecSummary.hs,
    buoyParsed && buoyParsed.waveHeight,
    spectral && spectral.bins
  );
  const hsVal = hsFt != null ? hsFt.toFixed(1) : null;
  if (hsVal) {
    ctx.font = `bold 14px ${FC_CHART_FONT_MONO}`;
    ctx.fillStyle = ROSE_THEME.hs;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${hsVal} ft`, cx, cy);
    ctx.font = `9px ${FC_CHART_FONT}`;
    ctx.fillStyle = ROSE_THEME.hsSub;
    ctx.fillText('Hs', cx, cy + 14);
  }
}

// ── Compass rose hover / tap inspection ─────────
//
// Hit-tests the pointer against the wedge geometry recorded by
// drawCompassRose, highlights the most specific (smallest) wedge under
// the cursor, and describes that swell band in the readout strip.
// Desktop: hover; touch: tap toggles, tapping empty space clears.

function _roseWedgeAt(evX, evY) {
  const g = STATE._roseGeom;
  const wedges = STATE._roseWedges;
  if (!g || !wedges || !wedges.length) return null;
  const dx = evX - g.cx;
  const dy = evY - g.cy;
  const radius = Math.hypot(dx, dy);
  if (radius > g.size / 2) return null;
  const angle = (radToDeg(Math.atan2(dy, dx)) + 90 + 360) % 360;
  let best = null;
  for (const w of wedges) {
    let d = Math.abs(angle - w.dir) % 360;
    if (d > 180) d = 360 - d;
    if (d > w.halfDeg + 1) continue;
    if (radius > w.rOuter + 2) continue;
    // Smallest covering wedge = the one visually on top (largest drawn first).
    if (!best || w.rOuter < best.rOuter) best = w;
  }
  return best;
}

function _setRoseHover(w) {
  const id = w ? w.id : null;
  if (STATE._roseHover === id) return;
  STATE._roseHover = id;
  const readout = el('rose-readout');
  if (readout) {
    if (w) {
      const inWin = STATE.isChocomount && swellDirClass(w.dir) === 'dir-in';
      const pct = w.share >= 0.01 ? Math.round(w.share * 100) + '%' : '<1%';
      readout.textContent =
        `${w.period.toFixed(1)}s from ${directionLabel(w.dir)} (${Math.round(w.dir)}°) · ${pct} of energy${inWin ? ' · in window' : ''}`;
      readout.classList.add('has-band');
      readout.classList.toggle('in-window', inWin);
    } else {
      readout.textContent = 'hover a petal to inspect that swell band';
      readout.classList.remove('has-band', 'in-window');
    }
  }
  if (STATE.lastSpectral) drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed);
}

(function initRoseHover() {
  let raf = null;
  function attach() {
    const canvas = el('compass-canvas');
    if (!canvas || canvas._roseHoverWired) return;
    canvas._roseHoverWired = true;
    canvas.addEventListener('mousemove', (e) => {
      if (raf) return; // one hit-test per frame
      raf = requestAnimationFrame(() => {
        raf = null;
        const rect = canvas.getBoundingClientRect();
        _setRoseHover(_roseWedgeAt(e.clientX - rect.left, e.clientY - rect.top));
      });
    });
    canvas.addEventListener('mouseleave', () => _setRoseHover(null));
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const w = _roseWedgeAt(e.clientX - rect.left, e.clientY - rect.top);
      // Tap a petal to select it (no-op if already selected via hover);
      // tap empty space to clear — the touch equivalent of mouseleave.
      _setRoseHover(w);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();

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
  ctx.font = `10px ${FC_CHART_FONT}`;
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
    ctx.font = `bold 9px ${FC_CHART_FONT}`;
    ctx.fillStyle = '#2c2825';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const peakPeriod = bins[peakIdx].period;
    ctx.fillText(`${peakPeriod.toFixed(1)}s peak`, peakX, peakY - 4);
  }

  // X-axis: period labels (thin out on narrow screens to avoid overlap)
  ctx.fillStyle = '#8a827a';
  ctx.font = `10px ${FC_CHART_FONT}`;
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
  ctx.font = `9px ${FC_CHART_FONT}`;
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
        const d = STATE.forecastData;
        drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo, d.tidePred, d.buoyParsed);
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

// Canvas text is rasterized at draw time, so charts painted before the
// self-hosted pixel font (style.css @font-face "MS Sans Serif") finished
// loading would keep fallback glyphs forever. Repaint once fonts settle;
// the guards make this a no-op when nothing has been drawn yet.
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (STATE.forecastData && STATE.forecastData.marine) {
      const d = STATE.forecastData;
      drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo, d.tidePred, d.buoyParsed);
    }
    if (STATE.lastSpectral) {
      drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed);
      drawSpectrum(STATE.lastSpectral);
    }
  }).catch(() => { /* font load failure → fallback stack already on screen */ });
}

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

// Called by firebase-config.js just before an anonymous session signs in to
// a Google account that already exists (a returning crew member on a new
// device, the home-screen app, after Sign out). That account has its own
// uid, and firestore.rules refuse an update that changes a doc's owner, so
// the migration could not move a session the anonymous uid already synced.
// While we are still that uid, delete its docs (an owner delete is allowed)
// and keep the entries here, unowned: migrateAnonDataToUser then re-creates
// them as the Google uid. Resolves with the released entries, so a sign-in
// that does not complete can put them back (restoreReleasedEntries).
async function releaseAnonEntries(anonUid) {
  var released = [];
  var mine = (STATE.surfLog || []).filter(function(e) { return e && anonUid && e.userId === anonUid; });
  await Promise.all(mine.map(function(entry) {
    return fbFirestore.collection('surf_logs').doc(entry.id).delete().then(function() {
      entry.userId = '';
      _slUnsyncedIds.add(entry.id);   // only this device holds it now
      released.push(entry);
    }, function(e) {
      // Never synced (no doc to delete), or refused: the migration still
      // tries it, and says so if it cannot be moved.
      console.warn('Could not release anonymous entry:', e);
    });
  }));
  if (released.length) saveSurfLog();
  return released;
}

// The Google sign-in did not complete, so we are still the anonymous uid:
// re-create the released sessions under it. One that cannot be saved stays
// here unowned, and moves with the next sign-in.
async function restoreReleasedEntries(released) {
  for (var i = 0; i < released.length; i++) {
    try {
      await saveLogEntryToFirebase(released[i]);
    } catch(e) {
      console.warn('Could not restore released entry:', e);
    }
  }
  saveSurfLog(); renderSurfLogTable();
}

// Called by firebase-config.js when an anonymous session becomes a Google
// one. Moves only the sessions logged under the anonymous uid being left
// (`prevAnonUid`) or never synced (no userId). STATE.surfLog can also hold
// the community log mirrored from an earlier Google session on this device;
// re-saving those would stamp them with this account's uid (audit C26).
async function migrateAnonDataToUser(prevAnonUid) {
  var entriesToMigrate = (STATE.surfLog || []).filter(function(e) {
    return e && (!e.userId || (!!prevAnonUid && e.userId === prevAnonUid));
  });
  if (entriesToMigrate.length > 0) {
    var count = 0, failed = 0;
    for (var i = 0; i < entriesToMigrate.length; i++) {
      var entry = entriesToMigrate[i];
      var prevOwner = entry.userId;
      // Unowned: saveLogEntryToFirebase stamps the new uid once the write
      // lands. signInWithGoogle released the docs the anonymous uid had
      // synced, so this is a create. One it could not release is still that
      // uid's doc (the rules refuse a change of owner), so restore on failure.
      entry.userId = '';
      try {
        await saveLogEntryToFirebase(entry);
        count++;
      } catch(e) {
        entry.userId = prevOwner;
        failed++;
        console.warn('Migration failed for entry:', e);
      }
    }
    if (count > 0) {
      showToast(count + ' session' + (count !== 1 ? 's' : '') + ' synced to your account', 'success');
    }
    if (failed > 0) {
      showToast('\u26a0 ' + failed + ' session' + (failed !== 1 ? 's' : '') + ' logged before sign-in could not be moved to your account', 'warn');
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
      STATE.surfLog.forEach(e => { if (e) _dropFabricatedTide(e.conditions); });
    } catch (e2) { STATE.surfLog = []; }
  }
}

function saveSurfLog() {
  try {
    localStorage.setItem('lcc_surfLog', JSON.stringify(STATE.surfLog));
    updateStorageNote();
  } catch (e) { alert('Storage full — try removing photos or exporting.'); }
}

async function addLogEntry(entry) {
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  entry.userId = window._fbUserId || '';
  entry.displayName = window._fbDisplayName || '';
  STATE.surfLog.unshift(entry);
  saveSurfLog(); slRetrain(); renderSurfLogTable(); updatePersonalMatchToggle();
  try {
    await saveLogEntryToFirebase(entry);
  } catch(e) {
    console.warn('Firebase save failed (entry saved locally):', e);
    showToast('\u26a0 Saved locally \u2014 sync failed', 'warn');
  }
  // Re-save after Firebase upload replaces data-URI photos with Storage URLs.
  // A log load that landed meanwhile kept this entry (loadLogsFromFirebase).
  saveSurfLog();
  renderSurfLogTable();
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
    // Only this account's entries: saveLogEntryToFirebase refuses others'.
    if (e.userId && e.userId !== window._fbUserId) return false;
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

// Ids of entries (or edits) this device holds that have not reached
// Firestore yet: a save in flight (a photo still uploading) or one that
// failed. loadLogsFromFirebase keeps the local copy of these instead of
// letting a snapshot without them wipe them out (load-path#4).
const _slUnsyncedIds = new Set();
// The log query in flight, { uid, snap }; see loadLogsFromFirebase.
let _slLogQuery = null;

async function saveLogEntryToFirebase(entry) {
  _slUnsyncedIds.add(entry.id);
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
  // Only the owner may write an entry. STATE.surfLog also holds other crew
  // members' entries; the payload below stamps userId with OUR uid, so
  // saving one of theirs would take it over (audit C26). firestore.rules
  // refuses that too; refusing here keeps local state honest.
  if (entry.userId && entry.userId !== window._fbUserId) {
    _slUnsyncedIds.delete(entry.id);
    throw new Error('Not your entry (owner ' + entry.userId + ') — not saved to cloud');
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
        // storage.rules only accepts these image types; anything else (or a
        // File with no type) goes up as the resized JPEG instead.
        if (file && /^image\/(jpeg|png|webp|heic|heif|gif)$/.test(file.type || '')) {
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
  _slUnsyncedIds.delete(entry.id);
  // An entry logged before sign-in finished had no owner; it is ours now.
  if (!entry.userId) entry.userId = window._fbUserId;
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

  // Fetch all entries (community log — all authenticated users see all sessions).
  // A restored Google session asks for the log twice at once (the auth
  // handler in firebase-config.js and initApp's loadSurfLog): share one
  // query, so a second copy cannot land a moment later and re-render the
  // table under the user's finger (an open row detail would close).
  const uid = window._fbUserId;
  if (!_slLogQuery || _slLogQuery.uid !== uid) {
    const q = _slLogQuery = {
      uid: uid,
      snap: fbFirestore.collection('surf_logs').orderBy('createdAt', 'desc').limit(200).get()
    };
    const done = function() { if (_slLogQuery === q) _slLogQuery = null; };
    q.snap.then(done, done);
  }
  const snap = await _slLogQuery.snap;
  const fresh = snap.docs.map(function(doc) {
    const d = doc.data();
    return {
      id: d.id,
      timestamp: d.timestamp,
      photos: (d.photos || []).filter(function(p) { return p && (p.url || typeof p === 'string' || p._uploadFailed); }),
      ratings: d.ratings,
      notes: d.notes || '',
      conditions: _dropFabricatedTide(d.conditions || null),
      userId: d.userId || '',
      displayName: d.displayName || ''
    };
  });
  // The Surf Log form works before this load lands. Keep what this device
  // holds that the snapshot lacks or has an older copy of (a session saved
  // meanwhile, an edit still uploading, a failed sync) rather than dropping
  // it from the table and the local mirror (load-path#4).
  const unsynced = (STATE.surfLog || []).filter(function(e) { return e && _slUnsyncedIds.has(e.id); });
  STATE.surfLog = unsynced.concat(fresh.filter(function(e) {
    return !unsynced.some(function(u) { return u.id === e.id; });
  }));
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
  // The now-pulse stops itself while the forecast view is hidden.
  if (tab === 'forecast' && STATE.forecastChart) startNowPulse();
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
      // Missing MWD stays null (flagged incomplete), not 0° = due north,
      // which the Wave model would read as out-of-window swell (audit C16).
      direction: Number.isFinite(swellRow.direction) ? Math.round(swellRow.direction) : null,
      period: Math.round((swellRow.period || 0) * 10) / 10,
      lagHours: Math.round(ndbcLagHours * 10) / 10
    },
    wind: haveWind
      ? { speed: Math.round(wSpd), direction: Math.round(wDir) }
      : { speed: null, direction: null },
    // null when CO-OPS had no predictions (see parseTideAtTime)
    tide: tideInfo ? {
      height: Math.round(tideInfo.height * 10) / 10,
      rate: Math.round(tideInfo.rate * 100) / 100,
      stage: tideInfo.stage,
      timeToNearest: tideInfo.timeToNearest
    } : null
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
//
// Returns null when there are no predictions: a failed fetch, an HTTP error,
// or CO-OPS's HTTP 200 {"error":{"message":"No Predictions data was
// found..."}} outage body. Missing tide must stay missing — a made-up 0 ft
// "rising" looks exactly like Choc's favourite low incoming tide and would
// train the Ride model on fiction (audit C11).
function parseTideAtTime(tideData, dateStr) {
  const preds = _normalizeTidePredictions(tideData);
  if (!preds.length) return null;
  const sessionTime = new Date(dateStr);
  const heightRaw = tideHeightAt(preds, sessionTime);
  const height = heightRaw == null ? 0 : heightRaw;
  const rate = tideRateAt(preds, sessionTime);
  const stage = _tideStageFromRate(rate, height, preds);
  const timeToNearest = _timeToNearestExtremum(preds, sessionTime);
  return { height, rate, stage, timeToNearest };
}

// The tide the old parseTideAtTime made up during a CO-OPS outage:
// { height: 0, rate: 0, stage: 'rising', timeToNearest: 0 }. Real data can
// never say 'rising' at 0 ft/hr (_tideStageFromRate calls |rate| < 0.1
// slack), so this signature is exact.
function _isFabricatedTide(t) {
  return !!t && t.stage === 'rising' && t.rate === 0;
}

// Read-time repair for sessions saved during an outage: their tide becomes
// null (shown as unavailable, skipped by the Ride model) until a Lookup or
// Backfill re-fetches it while CO-OPS is up.
function _dropFabricatedTide(cond) {
  if (cond && _isFabricatedTide(cond.tide)) cond.tide = null;
  return cond;
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
    // Missing direction stays null (flagged incomplete), not 0° (audit C16).
    direction: Number.isFinite(swD) ? Math.round(swD) : null,
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
      // null when CO-OPS had no predictions; extractRideFeatures skips it
      tide: tideInfo ? {
        height: Math.round(tideInfo.height * 10) / 10,
        rate: Math.round(tideInfo.rate * 100) / 100,
        stage: tideInfo.stage,
        timeToNearest: tideInfo.timeToNearest
      } : null,
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
// Plain text (stage etc. come from stored entries): escHtml() it before
// putting it in innerHTML.
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
  // Values can come from a stored or imported entry: escape them (audit C27).
  const dl = (l,v) => '<span class="sl-cond-label">'+escHtml(l)+'</span> <span class="sl-cond-val">'+escHtml(v)+'</span>';
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
  // No tide = CO-OPS had no predictions for that time (or a legacy entry).
  // Say so rather than show a number: the Ride model skips this session.
  h += dl('Tide:', cond.tide ? _formatTideReadout(cond.tide) : 'Tide unavailable (NOAA CO-OPS down) \u2014 re-Lookup later');
  h += '</div>';
  if (cond.swellLagHours > 0) {
    h += `<div class="sl-cond-row"><span class="sl-hint">Using swell from ~${escHtml(cond.swellLagHours)}h ago at buoy (travel time estimate)</span></div>`;
  }
  if (cond.source) {
    let srcLabel;
    if (cond.source === 'openmeteo-archive')              srcLabel = 'Open-Meteo archive (reanalysis)';
    else if (cond.source === 'ndbc-stdmet+openmeteo-wind') srcLabel = 'NDBC buoy 44097 swell + Open-Meteo archive wind';
    else if (cond.source === 'ndbc-stdmet')               srcLabel = 'NDBC buoy 44097 (measured, stdmet historical)';
    else if (cond.source === 'ndbc')                      srcLabel = 'NDBC buoy 44097 (measured)';
    else                                                  srcLabel = 'Open-Meteo marine API';
    h += '<div class="sl-cond-row"><span class="sl-hint">Source: ' + srcLabel + '</span></div>';
    if (cond.note) h += '<div class="sl-cond-row"><span class="sl-hint">' + escHtml(cond.note) + '</span></div>';
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
      let imported = 0, skipped = 0, unsynced = 0;
      // A rating is a 0–10 number, or null for a blank slider (flagged
      // incomplete later); anything else is not something the form wrote.
      const okRating = v => v == null || (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 10);
      for (const entry of data) {
        if (!entry || !entry.timestamp || !entry.ratings || typeof entry.ratings !== 'object') continue;
        // An export holds the whole community log. Someone else's entry is
        // theirs: importing it would re-save it under our uid (audit C26).
        if (entry.userId && entry.userId !== window._fbUserId) { skipped++; continue; }
        if (!['size', 'windQuality', 'rideQuality'].every(k => okRating(entry.ratings[k]))) { skipped++; continue; }
        if (!entry.id) entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        if (!STATE.surfLog.find(x => x.id === entry.id)) {
          STATE.surfLog.push(entry);
          imported++;
          // One failed sync (offline, rules) must not abort the rest; the
          // entry stays in the local log like any unsynced save.
          try { await saveLogEntryToFirebase(entry); }
          catch (err) { unsynced++; console.warn('Import: Firestore save failed for', entry.id, err); }
        }
      }
      STATE.surfLog.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveSurfLog(); slRetrain(); renderSurfLogTable(); updatePersonalMatchToggle();
      alert('Imported ' + imported + ' entries.' +
        (skipped ? ' Skipped ' + skipped + ' (owned by another account — sign in as its owner — or invalid ratings).' : '') +
        (unsynced ? ' ' + unsynced + ' saved locally only — sync failed.' : ''));
    } catch (err) { alert('Invalid JSON: ' + err.message); }
  };
  reader.readAsText(file); ev.target.value = '';
}

// ════════════════════════════════════════════════
// SURF LOG — Backfill (re-fetch all sessions from Open-Meteo archive)
// ════════════════════════════════════════════════
//
// Replaces each of the signed-in user's sessions' `cond.swell` AND
// `cond.tide` blocks with reanalysis data. Subjective ratings (size, wind
// quality, ride quality), notes, and photos are untouched. The tide block is
// REWRITTEN because we are migrating from the old hilo-extremum lookup
// (cond.tide.height was the next hi/lo value) to the new hourly-interpolated
// lookup (cond.tide.height is the actual water level at session time, and
// cond.tide.rate is added) — but only when CO-OPS answered; an outage keeps
// the stored tide. NDBC stdmet is the fallback when archive returns no data.
async function backfillAllSessionsFromArchive() {
  // Only the signed-in user's own sessions. STATE.surfLog also holds the
  // community log, and re-saving another crew member's entry would stamp it
  // with this account's uid and take it over (audit C26).
  const uid = window._fbUserId;
  const mine = Array.isArray(STATE.surfLog) ? STATE.surfLog.filter(e => uid && e.userId === uid) : [];
  if (mine.length === 0) {
    alert('No sessions of yours to backfill.');
    return;
  }
  const proceed = confirm(
    'This will re-fetch conditions for all your logged sessions from Open-Meteo archive: ' +
    'swell + wind from the archive reanalysis, plus tide data from CO-OPS using hourly ' +
    'predictions (interpolated water level at session time, with signed ft/hr rate). ' +
    'If the wind or tide fetch fails for a session, its stored wind/tide is kept. Only ' +
    'your own sessions are updated. Your subjective ratings (size, wind quality, ride ' +
    'quality) will not be touched. Proceed?'
  );
  if (!proceed) return;

  const btn = el('sl-backfill-archive-btn');
  const progress = el('sl-backfill-progress');
  const bar = el('sl-backfill-bar-fill');
  const status = el('sl-backfill-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Backfilling…'; }
  if (progress) progress.style.display = '';
  if (bar) bar.style.width = '0%';

  const entries = mine.slice();
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

        // Wind and tide: take the fresh value whenever the fetch returned a
        // real one (the archive wind and the hourly-interpolated tide with
        // its signed ft/hr `rate` replace older formats). When a fetch FAILED
        // (CO-OPS outage, archive down) keep what the entry already had
        // rather than overwrite good data with nothing (audit C11). Stored
        // values that were themselves fabricated by an earlier outage — wind
        // { speed: 0, direction: 0 }, tide 'rising' at 0 ft/hr — become null
        // so the models skip them instead of training on them.
        if (result.wind && result.wind.speed != null) newCond.wind = result.wind;
        else if (oldCond.wind && oldCond.wind.speed != null && !(oldCond.wind.speed === 0 && oldCond.wind.direction === 0)) newCond.wind = oldCond.wind;
        else newCond.wind = { speed: null, direction: null };
        if (result.tide && typeof result.tide.height === 'number') newCond.tide = result.tide;
        else if (oldCond.tide && !_isFabricatedTide(oldCond.tide)) newCond.tide = oldCond.tide;
        else newCond.tide = null;

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

// One predicate (audit C44): an entry is incomplete when getIncompleteFields
// finds anything. It drives the "needs review" banner AND _modelRows, so a
// flagged entry really is excluded from the models.
function isLogEntryIncomplete(entry) {
  return getIncompleteFields(entry).length > 0;
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
  // Swell objects store `height`; `size` is only on legacy entries.
  const sh = s ? (s.height ?? s.size) : undefined;
  if (!s) {
    fields.push('swell');
  } else if (sh === 0 && s.period === 0) {
    fields.push('swell');
  } else if (sh > 0 && (s.direction === undefined || s.direction === null || s.direction === 0)) {
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
    // Every entry field below can be written by any crew member (or an
    // import), and the community log renders for everyone: escape it all
    // (audit C27). Notes are escaped AFTER slicing so an entity is never cut.
    const validPhotos = (entry.photos||[]).map(p=>safeUrl(photoUrl(p))).filter(Boolean).slice(0,3);
    const photoHtml = validPhotos.length > 0
      ? '<div class="sl-row-photos">'+validPhotos.map(url=>'<img src="'+url+'" alt="" onerror="this.style.display=\'none\'">').join('')+'</div>'
      : '<span style="color:var(--ink4)">\u2014</span>';
    const notesRaw = String(entry.notes||'');
    const notes = escHtml(notesRaw.slice(0,30)) + (notesRaw.length>30?'...':'');
    const isOwn = entry.userId === window._fbUserId;
    const attribution = (!isOwn && entry.displayName) ? '<br><span style="color:var(--ink4);font-size:0.6rem">'+escHtml(entry.displayName)+'</span>' : '';
    const incompletePill = isIncomplete(entry) ? '<br><span class="sl-incomplete-pill">\u26a0 incomplete</span>' : '';
    const actionHtml = isOwn
      ? '<button class="sl-btn sl-btn-sm sl-edit-btn" data-id="'+escHtml(entry.id)+'">Edit</button> <button class="sl-btn sl-btn-sm sl-btn-danger sl-delete-btn" data-id="'+escHtml(entry.id)+'">Del</button>'
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
    // Stored values from any crew member's entry: escape them (audit C27).
    const sw = c.swell || {}, w = c.wind || {}, e = escHtml;
    h += '<div class="sl-cond-group"><span class="sl-cond-group-title">Swell</span>'+e(sw.height)+'ft '+e(sw.period)+'s '+directionLabel(sw.direction)+' ('+e(sw.direction)+'\u00b0)';
    if (sw.secondary) h += '<br>2nd: '+e(sw.secondary.height)+'ft '+e(sw.secondary.period)+'s '+directionLabel(sw.secondary.direction);
    h += '</div><div class="sl-cond-group"><span class="sl-cond-group-title">Wind</span>'+e(w.speed)+' mph '+directionLabel(w.direction)+' ('+e(w.direction)+'\u00b0)</div>';
    h += '<div class="sl-cond-group"><span class="sl-cond-group-title">Tide</span>'+e(_formatTideReadout(c.tide))+'</div>';
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

// The single gate between logged sessions and the models (audit C16).
// trainModel, leaveOneOutRMSE, _runLOOForSanity and every Regression-tab
// builder use it, so the live model, the tab's R²/RMSE and the banner's
// "excluded from your model" all agree. A row is kept only when the entry
// is complete (isLogEntryIncomplete: ratings 0–10, real swell), the
// extractor returns finite numbers, and the target is a 0–10 number — one
// null or "7" rating can otherwise flip weights or blank a model.
function _modelRows(entries, featureExtractor, targetFn) {
  const X = [], y = [], kept = [];
  for (const e of entries || []) {
    if (isLogEntryIncomplete(e)) continue;
    const f = featureExtractor(e.conditions);
    if (!f || !f.every(Number.isFinite)) continue;
    const t = targetFn(e);
    if (typeof t !== 'number' || !isFinite(t) || t < 0 || t > 10) continue;
    X.push(f); y.push(t); kept.push(e);
  }
  return { X, y, kept };
}

function trainModel(entries, featureExtractor, targetFn) {
  const { X, y } = _modelRows(entries, featureExtractor, targetFn);
  if (!X.length) return null;
  const nF = X[0].length;
  const minSamples = Math.max(2 * nF, 12);
  if (X.length < minSamples) return null;
  return _trainOnArrays(X, y);
}

// Train on all samples except `holdoutIdx`, predict the held-out target,
// repeat for every sample, return RMSE across held-out predictions.
function leaveOneOutRMSE(entries, featureExtractor, targetFn) {
  const { X, y } = _modelRows(entries, featureExtractor, targetFn);
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
  const { X, y } = _modelRows(entries, featureExtractor, targetFn);
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
  // No tide data (CO-OPS down) → tide: null, never a made-up 0 ft 'rising':
  // the Ride prediction then shows '—' instead of rating fictional water
  // (audit C11).
  let tideInfo = null;
  if (targetTime && tidePred && tidePred.length) {
    tideInfo = parseTideAtTime({ predictions: tidePred }, targetTime);
    if (tideInfo && tideHiLo && tideHiLo.length) {
      const hi2 = parseTideAtTime({ predictions: tideHiLo }, targetTime);
      if (hi2) tideInfo.timeToNearest = hi2.timeToNearest;
    }
  }
  if (!tideInfo && targetTime && tideHiLo && tideHiLo.length) {
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
    const thumb = m.entry.photos?.[0] ? safeUrl(photoUrl(m.entry.photos[0])) : '';
    const imgH = thumb ? '<img class="pm-card-img" src="'+thumb+'" alt="" onerror="this.style.display=\'none\'">' : '<div class="pm-card-img" style="display:flex;align-items:center;justify-content:center;color:var(--ink4);font-family:var(--mono);font-size:0.7rem">No photo</div>';
    const waveLine = '<span class="pm-score-wave">Wave: '+(m.waveRating?m.waveRating.toFixed(1):'--')+'</span>';
    const rideLine = '<span class="pm-score-ride">Ride: '+(m.rideRating?m.rideRating.toFixed(1):'--')+'</span>';
    const condLine = '<span class="pm-score-cond">Cond: '+(m.condRating?m.condRating.toFixed(1):'--')+'</span>';
    const matchLine = '<span class="pm-match-wave">W '+m.waveMatch+'%</span> <span class="pm-match-ride">R '+m.rideMatch+'%</span> <span class="pm-match-cond">C '+m.condMatch+'%</span>';
    h += '<div class="pm-card" data-day="'+escHtml(m.day)+'" data-eid="'+escHtml(m.entry.id)+'" data-hi="'+m.hourIdx+'">'+imgH+'<div class="pm-card-body"><div class="pm-card-date">'+dl+'</div><div class="pm-card-scores">'+waveLine+' '+rideLine+' '+condLine+'</div><div class="pm-card-match">'+matchLine+'</div></div></div>';
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
    const c=entry.conditions, dl=(l,v)=>'<span class="mc-label">'+l+'</span><span class="mc-val">'+escHtml(v)+'</span>';
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

// Index of the current hour in an Open-Meteo hourly series. The series is
// in the spot's local time (timezone=auto) from local midnight, so "now" is
// shifted by the response's utc_offset_seconds rather than the device's time
// zone. Clamped to the series ends; -1 without a series.
function marineNowIndex(marine, nowMs = Date.now()) {
  const times = marine && marine.hourly && marine.hourly.time;
  if (!times || !times.length) return -1;
  const key = new Date(nowMs + (marine.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13);
  const i = times.findIndex(t => String(t).slice(0, 13) === key);
  if (i >= 0) return i;
  return key < String(times[0]).slice(0, 13) ? 0 : times.length - 1;
}

function updateSecondarySwellCard(marine, isChoc, forecastLat, forecastLon) {
  const card = el('card-secondary-swell');
  if (!card) return;
  const hourly = marine && marine.hourly ? marine.hourly : null;
  // Open-Meteo's "current" block has no secondary-swell fields, so read the
  // hourly slot for the current hour (slot 0 is local midnight).
  const i = marineNowIndex(marine);
  const h = hourly && hourly.secondary_swell_wave_height ? hourly.secondary_swell_wave_height[i] : null;
  const p = hourly && hourly.secondary_swell_wave_period ? hourly.secondary_swell_wave_period[i] : null;
  const d = hourly && hourly.secondary_swell_wave_direction ? hourly.secondary_swell_wave_direction[i] : null;
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
  if (!v) return 'Auto (Open-Meteo best_match = MeteoFrance MFWAM 0.08° at Choc)';
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
// PANEL INFO/SOURCE TOGGLE
// ════════════════════════════════════════════════
//
// Each forecast-tab panel (.panel / .panel-half / .condition-card) hides
// its attribution footer by default. A ⓘ button injected into the top-
// right toggles the footer visible. Default state: collapsed.

function initPanelInfoToggles() {
  const containers = document.querySelectorAll(
    '#view-forecast .panel, #view-forecast .panel-half, #view-forecast .condition-card'
  );
  containers.forEach(panel => {
    // Only inject if the panel actually contains an attribution footer.
    const footers = Array.from(panel.children).filter(c =>
      c.classList && c.classList.contains('panel-footer'));
    if (!footers.length) return;
    // Avoid double-init across re-renders.
    if (panel.querySelector(':scope > .panel-info-toggle')) return;
    // Establish positioning context for the absolute button.
    const cs = getComputedStyle(panel);
    if (cs.position === 'static') panel.style.position = 'relative';
    // Wrap the panel-footer(s) in a single popover container so the
    // ⓘ click reveals one anchored yellow callout, not an inline block.
    const popover = document.createElement('div');
    popover.className = 'panel-info-popover';
    popover.setAttribute('role', 'tooltip');
    footers.forEach(f => popover.appendChild(f));
    panel.appendChild(popover);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-info-toggle';
    btn.setAttribute('aria-label', 'Show sources');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Sources';
    btn.textContent = 'ⓘ';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.classList.toggle('show-info');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    panel.appendChild(btn);
  });
  // Click anywhere outside an open popover to close it.
  if (!window._panelInfoOutsideHandlerInstalled) {
    document.addEventListener('click', (e) => {
      document.querySelectorAll('#view-forecast .show-info').forEach(p => {
        if (!p.contains(e.target)) {
          p.classList.remove('show-info');
          const b = p.querySelector(':scope > .panel-info-toggle');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
    });
    window._panelInfoOutsideHandlerInstalled = true;
  }
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
  const verification = el('panel-verification');
  const sections = [summary, prediction, pva, thresholds, submodel, weights, verification];
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

  renderVerificationPanel();
}

// ════════════════════════════════════════════════
// MODEL vs BUOY — nowcast verification (Tab 2)
// ════════════════════════════════════════════════
//
// The update-buoy pipeline logs one row every 2 hours pairing the
// buoy's latest observation with the Open-Meteo model value for that
// same hour at two grid points: the buoy itself ("mb" — pure model
// skill) and the Choc forecast point ("mc" — how different the point
// the app actually forecasts from is). This panel plots the series
// and summarizes bias/MAE for both analyses.

let _verifDoc = null;
let _verifFetchedAt = 0;

// Signed shortest angular difference a − b, in (−180, 180].
function verifAngDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Mean error (bias) + mean absolute error over rows where both the
// observation and the model value exist. `circular` treats values as
// compass degrees.
function verifStats(rows, getObs, getModel, circular) {
  let n = 0, sum = 0, sumAbs = 0;
  for (const r of rows) {
    const o = getObs(r), m = getModel(r);
    if (o == null || m == null) continue;
    const e = circular ? verifAngDiff(m, o) : (m - o);
    n++; sum += e; sumAbs += Math.abs(e);
  }
  return n ? { n, bias: sum / n, mae: sumAbs / n } : { n: 0, bias: null, mae: null };
}

// Row accessors shared by the stats table and the charts. Each pairs
// like with like (audit C15): NDBC's swell split at 44097 is a fixed
// 0.1 Hz cut (SwP is always ≥ 10 s) while the model's swell_wave_* is
// its own partition (median 5.6 s at the buoy), so SwP vs swell period
// measured the two definitions, not the forecast (a fake −5.8 s bias).
//   Period: buoy energy period Tm-1,0 (tm10, from the spectrum) vs the
//     model's mean wave period, which MFWAM computes the same way. Rows
//     logged before the pipeline recorded tm10 use the buoy's DPD.
//   Direction: rows carrying the model's total-sea direction (wvd)
//     compare it with the buoy's MWD. Older rows compare the buoy's
//     ≥ 8 s direction with the model's swell partition only where that
//     partition is itself ≥ 8 s; otherwise they describe different trains.
const VERIF_SWELL_MIN_S = 8;

function _verifRowHasWvd(r) {
  return !!((r.mb && r.mb.wvd != null) || (r.mc && r.mc.wvd != null));
}

function _verifModelDir(m, r) {
  if (!m) return null;
  if (_verifRowHasWvd(r)) return m.wvd;
  return m.swp != null && m.swp >= VERIF_SWELL_MIN_S ? m.swd : null;
}

const VERIF_GET = {
  height: {
    obs: r => r.buoy && r.buoy.hs,
    mb: r => r.mb && r.mb.hs,
    mc: r => r.mc && r.mc.hs
  },
  period: {
    obs: r => r.buoy && (r.buoy.tm10 != null ? r.buoy.tm10 : r.buoy.dpd),
    mb: r => r.mb && r.mb.wvp,
    mc: r => r.mc && r.mc.wvp
  },
  dir: {
    obs: r => r.buoy && (_verifRowHasWvd(r) ? r.buoy.mwd : r.buoy.swd),
    mb: r => _verifModelDir(r.mb, r),
    mc: r => _verifModelDir(r.mc, r),
    circular: true,
    // Compass names read better than raw degrees for the axis.
    fmtY: v => directionLabel(((v % 360) + 360) % 360)
  }
};

const VERIF_SERIES_STYLE = [
  { key: 'obs', label: 'Buoy — actually measured', dash: null, width: 2 },
  { key: 'mb', label: 'Model’s claim at the buoy', dash: [6, 4], width: 1.5 },
  { key: 'mc', label: 'Model’s claim at the Choc forecast point', dash: [2, 3], width: 1.5 }
];

function _verifSeriesColor(key) {
  return key === 'obs' ? FC_RETRO.ink
    : key === 'mb' ? FC_RETRO.swellStroke
    : FC_RETRO.windCross;
}

function drawVerifChart(canvasId, rows, getters) {
  const canvas = el(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dims = ensureCanvasCssDims(canvas, ctx);
  const w = dims.cssW, h = dims.cssH;
  if (!w || !h) return;

  const padL = 8, padR = 44, padT = 8, padB = 20;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  ctx.fillStyle = FC_RETRO.plotBg;
  ctx.fillRect(0, 0, w, h);

  const t0 = new Date(rows[0].t).getTime();
  const t1 = new Date(rows[rows.length - 1].t).getTime();
  const tRange = Math.max(1, t1 - t0);
  const xFor = t => padL + ((t - t0) / tRange) * plotW;

  // Y extent across every plotted value, padded.
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) {
    for (const s of VERIF_SERIES_STYLE) {
      const v = getters[s.key](r);
      if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  if (!isFinite(lo)) return;
  const span = Math.max(1e-6, hi - lo);
  lo -= span * 0.12; hi += span * 0.12;
  const yFor = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;

  // Grid: three horizontal lines + a tick at each local midnight.
  ctx.strokeStyle = FC_RETRO.grid;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 2; g++) {
    const y = padT + (plotH * g / 2);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
  }
  const fmtY = getters.fmtY || (v => v.toFixed(0));
  ctx.font = `10px ${FC_CHART_FONT}`;
  ctx.fillStyle = FC_RETRO.ink2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmtY(hi), padL + plotW + 4, padT);
  ctx.fillText(fmtY((hi + lo) / 2), padL + plotW + 4, padT + plotH / 2);
  ctx.fillText(fmtY(lo), padL + plotW + 4, padT + plotH);
  const dayMs = 86400e3;
  const labelEvery = Math.max(1, Math.ceil((tRange / dayMs) / 7));
  let dayN = 0;
  // Step calendar days from the first local midnight at/after t0, so each
  // tick sits on the start of the day its local-date label names (UTC
  // midnight put "9/29" at 8 PM on 9/29) and 23/25 h DST days stay aligned.
  const tick = new Date(t0);
  if (tick.getHours() || tick.getMinutes() || tick.getSeconds() || tick.getMilliseconds()) tick.setHours(24, 0, 0, 0);
  for (let d = tick.getTime(); d <= t1; tick.setDate(tick.getDate() + 1), d = tick.getTime(), dayN++) {
    const x = xFor(d);
    ctx.strokeStyle = FC_RETRO.daySep;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    if (dayN % labelEvery === 0) {
      ctx.fillStyle = FC_RETRO.ink2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(new Date(d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }), x, padT + plotH + 4);
    }
  }

  // Series: break segments at nulls and (for direction) at wraparounds.
  for (const s of VERIF_SERIES_STYLE) {
    ctx.strokeStyle = _verifSeriesColor(s.key);
    ctx.fillStyle = _verifSeriesColor(s.key);
    ctx.lineWidth = s.width;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    let prev = null;
    for (const r of rows) {
      const v = getters[s.key](r);
      if (v == null) { prev = null; continue; }
      const x = xFor(new Date(r.t).getTime());
      const y = yFor(v);
      if (prev == null || (getters.circular && Math.abs(v - prev) > 180)) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      prev = v;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Dots make short/holey series readable.
    if (rows.length <= 60) {
      for (const r of rows) {
        const v = getters[s.key](r);
        if (v == null) continue;
        ctx.beginPath();
        ctx.arc(xFor(new Date(r.t).getTime()), yFor(v), 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.strokeStyle = FC_RETRO.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(padL + 0.5, padT + 0.5, plotW - 1, plotH - 1);
}

function _verifFmt(v, digits, unit) {
  if (v == null) return '—';
  const s = v.toFixed(digits);
  return (v >= 0 ? '+' : '') + s + unit;
}

function _verifRender() {
  const statsBox = el('verif-stats');
  const legendBox = el('verif-legend');
  if (!statsBox) return;
  const rows = (_verifDoc && Array.isArray(_verifDoc.rows)) ? _verifDoc.rows : [];

  if (legendBox) {
    legendBox.innerHTML = VERIF_SERIES_STYLE.map(s =>
      `<span class="verif-legend-item"><span class="verif-swatch verif-swatch-${s.key}"></span>${s.label}</span>`
    ).join('');
  }

  if (rows.length < 2) {
    statsBox.innerHTML = `<span class="sl-hint">Collecting — ${rows.length} observation${rows.length === 1 ? '' : 's'} logged so far. ` +
      'The update-buoy pipeline adds one every 2 hours; charts appear once a few accumulate.</span>';
    document.querySelectorAll('#panel-verification .verif-chart-block').forEach(b => { b.style.display = rows.length ? '' : 'none'; });
    if (!rows.length) return;
  } else {
    const metric = (label, g, digits, unit) => {
      const mb = verifStats(rows, g.obs, g.mb, g.circular);
      const mc = verifStats(rows, g.obs, g.mc, g.circular);
      return `<tr><td>${label}</td>` +
        `<td>${_verifFmt(mb.bias, digits, unit)}</td><td>${mb.mae == null ? '—' : mb.mae.toFixed(digits) + unit}</td>` +
        `<td>${_verifFmt(mc.bias, digits, unit)}</td><td>${mc.mae == null ? '—' : mc.mae.toFixed(digits) + unit}</td>` +
        `<td>${mb.n}</td></tr>`;
    };
    statsBox.innerHTML =
      '<table class="verif-table"><thead><tr><th></th>' +
      '<th colspan="2">How accurate is the model?<br><span class="verif-th-sub">its claim at the buoy vs what the buoy measured</span></th>' +
      '<th colspan="2">How different is the Choc forecast point?<br><span class="verif-th-sub">its claim at the Choc point vs the buoy</span></th><th rowspan="2">readings</th></tr>' +
      '<tr><th></th><th>typical miss</th><th>typical size</th><th>typical miss</th><th>typical size</th></tr></thead><tbody>' +
      metric('Height', VERIF_GET.height, 1, ' ft') +
      metric('Period', VERIF_GET.period, 1, ' s') +
      metric('Direction', VERIF_GET.dir, 0, '°') +
      '</tbody></table>' +
      '<p class="verif-table-note sl-hint"><strong>Typical miss</strong> (bias): which way the model is usually wrong — ' +
      '<strong>+</strong> means it claims more than the buoy measures, <strong>−</strong> means less. ' +
      '<strong>Typical size</strong> (mean absolute error): how far off it usually is, ignoring direction. ' +
      'Small numbers are good.</p>';
    document.querySelectorAll('#panel-verification .verif-chart-block').forEach(b => { b.style.display = ''; });
  }

  if (rows.length) {
    drawVerifChart('verif-canvas-height', rows, VERIF_GET.height);
    drawVerifChart('verif-canvas-period', rows, VERIF_GET.period);
    drawVerifChart('verif-canvas-dir', rows, VERIF_GET.dir);
  }

  setFooter('footer-verification',
    'Measured: NDBC buoy 44097 (Block Island). Claimed: Open-Meteo best_match (MeteoFrance MFWAM) for the same hour, at the buoy’s own coordinates and at the Choc forecast point. ' +
    'Logged every 2 h by the update-buoy pipeline. Gaps in a line are missing readings (buoy outages or skipped pipeline runs; never interpolated); a direction line that jumps edges crossed north. ' +
    'Technically: typical miss = bias = mean(model − buoy); typical size = MAE. Height: total Hs on both sides. ' +
    'Period: buoy energy period Tm-1,0 from its spectrum (its dominant period DPD on rows logged before Tm-1,0 was recorded) vs the model’s mean wave period. ' +
    'Direction: buoy MWD vs the model’s mean wave direction; on older rows without it, the buoy’s ≥ 8 s swell direction vs the model swell partition, only at hours when that partition is ≥ 8 s. ' +
    'NDBC’s own swell split (SwH/SwP) counts only ≥ 10 s energy at this buoy, so it is not compared with the model’s swell partition.');
}

function renderVerificationPanel() {
  const panel = el('panel-verification');
  if (!panel) return;
  panel.style.display = '';
  const stale = !_verifDoc || Date.now() - _verifFetchedAt > 10 * 60e3;
  if (stale) {
    fetch('data/verification.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(doc => {
        _verifFetchedAt = Date.now();
        if (doc && Array.isArray(doc.rows)) _verifDoc = doc;
        _verifRender();
      })
      .catch(() => { _verifRender(); });
  }
  _verifRender();
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
  const mr = _modelRows(all, cfg.extractor, cfg.targetFn);
  mr.kept.forEach((e, i) => {
    const isOwn = uid && e.userId === uid;
    points.push({ entry: e, x: mr.X[i][featureIdx], y: mr.y[i], isOwn: !!isOwn });
  });
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
  const mr = _modelRows(userScoped.filter(e => e.conditions?.swell), cfg.extractor, cfg.targetFn);
  return mr.X.map((f, i) => ({ f, t: mr.y[i] }));
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
  // Same rows as leaveOneOutRMSE (via _modelRows), so these per-session
  // predictions reconcile with STATE.surfLog*Validation.
  const mr = _modelRows(entries, cfg.extractor, cfg.targetFn);
  const rows = mr.kept.map((e, i) => ({ entry: e, features: mr.X[i], target: mr.y[i] }));
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
  // typeof checks, not != null: a stored string must not throw on toFixed
  // and take the whole drill-down with it.
  const swellH = (typeof s.height === 'number' ? s.height.toFixed(1) : '—') + 'ft';
  const swellP = (typeof s.period === 'number' ? s.period.toFixed(1) : '—') + 's';
  const swellD = (s.direction != null ? directionLabel(s.direction) + ' (' + Math.round(s.direction) + '°)' : '—');
  const secLine = s.secondary
    ? '<div class="reg-drill-line"><span class="reg-drill-key">Secondary:</span> ' +
      (typeof s.secondary.height === 'number' ? s.secondary.height.toFixed(1) + 'ft' : '—') + ' @ ' +
      (typeof s.secondary.period === 'number' ? s.secondary.period.toFixed(1) + 's' : '—') + ' · ' +
      (s.secondary.direction != null ? directionLabel(s.secondary.direction) : '—') + '</div>'
    : '';
  const windLine = (w.speed != null ? Math.round(w.speed) : '—') + 'mph · ' +
    (w.direction != null ? directionLabel(w.direction) : '—') +
    (w.direction != null ? ' (' + Math.round(w.direction) + '°)' : '');
  // stage / timeToNearest are stored values from any crew member's entry:
  // escape them (audit C27). The numbers go through toFixed()/Math.round().
  const tideLine = (typeof t.height === 'number' ? (t.height >= 0 ? '+' : '') + t.height.toFixed(1) + 'ft' : '—') +
    ' · ' + escHtml(t.stage || '—') +
    (typeof t.rate === 'number' ? ' · ' + (t.rate >= 0 ? '+' : '') + t.rate.toFixed(2) + ' ft/hr' : '') +
    (t.timeToNearest != null ? ' · time to nearest: ' + escHtml(t.timeToNearest) + 'h' : '');
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
  // Community entries land here too (feature-mini scatter): escape every
  // stored field and allow only http(s)/blob/data:image photo URLs (C27).
  const photos = (entry.photos || []).map(p => safeUrl(photoUrl(p) || p)).filter(Boolean);
  const photoBlock = photos.length
    ? '<div class="reg-drill-photo-wrap">' +
      '<img class="reg-drill-photo" src="' + photos[0] + '" alt="Session photo" onerror="this.style.display=\'none\'">' +
      (photos.length > 1 ? '<span class="reg-drill-photo-counter">1/' + photos.length + '</span>' : '') +
      '</div>'
    : '';
  const communityBadge = !isOwn ? '<span class="reg-drill-badge">from community log</span>' : '';
  const loggedBy = isOwn ? 'you' : escHtml(entry.displayName || 'Anonymous');
  const notesBlock = entry.notes
    ? '<div class="reg-drill-section"><div class="reg-drill-section-heading">Notes</div><div class="reg-drill-notes">' +
      escHtml(entry.notes) + '</div></div>'
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
  dropLegacyTideCacheKeys();
  // Load static data files
  const [buoys, tideStations] = await Promise.all([
    fetchJSON('data/buoys-east-coast.json'),
    fetchJSON('data/tide-stations.json')
  ]);

  STATE.buoys = buoys || [];
  STATE.tideStations = tideStations || [];

  // Init maps. They're optional: if Leaflet didn't load, the forecast must
  // still load, so a map failure never aborts initApp.
  if (typeof L !== 'undefined') {
    try {
      initBuoyMap();
      initTideMap();
    } catch (e) {
      console.warn('Map init failed:', e);
    }
  } else {
    console.warn('Leaflet unavailable: maps disabled');
  }

  // Wire forecast-coords toggle (Choc only behaviour; the wrap is hidden for
  // non-Choc selections via applyChocOnlyVisibility).
  initForecastCoordsToggle();
  initForecastModelDropdown();

  // Populate the buoy <select> dropdown that mirrors the map for keyboard /
  // accessibility users.
  initBuoySelectDropdown();

  // Default: if gate passed (not by boat), load Chocomount now, before the
  // surf log (whose Firebase wait used to hold the forecast back by 2-15 s).
  // Choc TV's boot watchdog may already have selected it: don't load twice.
  if (STATE.boatGatePassed && !STATE.selectedBuoy) {
    const chocBuoy = STATE.buoys.find(b => b.home === 'chocomount');
    if (chocBuoy) {
      selectBuoy(chocBuoy);
      STATE.buoyMap?.setView([chocBuoy.lat, chocBuoy.lon], 8);
    }
  }
  // If by boat, just show the map, no auto-select

  // Wire surf log. It loads in the background: nothing on the forecast
  // needs it, and Firebase auth + Firestore can take seconds (or hang).
  initTabBar();
  initSurfLogForm();
  initMatchModal();
  initPanelInfoToggles();
  loadSurfLog().then(function() {
    slRetrain();
    renderSurfLogTable();
    // Re-attempt any photo uploads that failed on a prior session.
    retryFailedPhotoUploads().catch(function(e) { console.warn('Retry pass failed:', e); });
  }).catch(function(e) { console.warn('Surf log load failed:', e); });

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
}

// ── Start ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initGate);
