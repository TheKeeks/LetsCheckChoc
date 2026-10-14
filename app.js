// ════════════════════════════════════════════════
// LetsCheckChoc — app.js
// The app underneath the look: Chocomount's forecast, tides and buoy (with
// their saved copies and true ages), the surf log and its ratings models,
// and the panels My ratings borrows. The look (previews/clean/) draws the
// screens; Choc TV runs on kiosk.js.
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
    // pipeline's data/buoy.json instead (scripts/fetch_buoy.py, every 2 h).
    // To re-add a WORKING relay you control (e.g. a Cloudflare Worker that
    // fetches the NDBC URL and adds Access-Control-Allow-Origin: *):
    //   { name: 'worker', wrap: function(url) { return 'https://<your-worker>.workers.dev/?url=' + encodeURIComponent(url); } }
    // It is then tried by the surf log's NDBC-history fallback.
    ndbcProxies: [],
    ndbcBase: 'https://www.ndbc.noaa.gov/data/realtime2/'
  },
  coopsNearbyRadiusMiles: 50
};

// ── State ────────────────────────────────────────
const STATE = {
  isChocomount: false,
  appStarted: false,     // startApp ran (once per page)
  selectedBuoy: null,
  pinLat: null,
  pinLon: null,
  buoys: [],
  tideStations: [],
  nearestTideStation: null,
  forecastData: null,    // the forecast on screen: { marine, wind, tideHiLo, tidePred, buoyParsed }
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
  activeTab: 'forecast'   // the look's tab in the app's names (switchTab)
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

// ── API: Pipeline fallback for Chocomount ────────
async function fetchPipelineBuoy() {
  const cached = readCache(PIPELINE_CACHE_KEY, CACHE_TTL.pipeline);
  if (cached) return cached;
  const data = await fetchJSON('data/buoy.json');
  if (data) writeCache(PIPELINE_CACHE_KEY, data);
  return data;
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

// ════════════════════════════════════════════════
// SELECTION LOGIC
// ════════════════════════════════════════════════

function selectBuoy(buoy) {
  STATE.selectedBuoy = buoy;
  STATE.isChocomount = buoy.home === 'chocomount';
  STATE.pinLat = buoy.lat;
  STATE.pinLon = buoy.lon;
  loadAllData(buoy);
}

// ════════════════════════════════════════════════
// DATA LOADING
// ════════════════════════════════════════════════

// One forecast for the selected buoy: the SWR pre-paint (saved copies) and the
// post-fetch refresh both land here, with the whole context. The look hooks
// this function by name (previews/clean/core.js keeps ctx and raises 'data');
// the look and Choc TV read STATE.forecastData.
function renderForecastSet(ctx) {
  const { marine, wind, buoyParsed, tideHiLo, tidePred } = ctx;
  if (marine && marine.hourly) STATE.forecastData = { marine, wind, tideHiLo, tidePred, buoyParsed };
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

// The swell card's 8 s+ band for this buoy: the pipeline's own swell_band
// when it provides one, else integrated here from its spectral bins.
// null when the spectrum is not as new as buoy.time: the card would show
// it under the obs time's "Current", so it falls back to WVHT / DPD / MWD.
const SPECTRUM_MAX_LAG_MS = 2 * 60 * 60 * 1000;
function pipelineSwellBand(pData, buoy) {
  if (!pipelineIsFor(pData, buoy)) return null;
  // Carried over from an earlier run (data_spec failed), or well behind
  // the stdmet row (the hourly spectrum normally trails it by < 1 h).
  const carried = Array.isArray(pData.stale_sections) && pData.stale_sections.includes('spectral_bins');
  const specMs = parseBuoyObsTime(pData.spectral_obs_time);
  const obsMs = parseBuoyObsTime(pData.buoy && pData.buoy.time);
  if (carried || (specMs != null && obsMs != null && obsMs - specMs > SPECTRUM_MAX_LAG_MS)) return null;
  const bins = pData.spectral_bins;
  const hasDir = binsHaveMeasuredDir(bins);
  const sb = pData.swell_band;
  const band = sb && Number.isFinite(sb.hs_m)
    ? {
        hsM: sb.hs_m,
        peakPeriod: Number.isFinite(sb.peak_period_s) ? sb.peak_period_s : null,
        dir: Number.isFinite(sb.dir_deg) ? sb.dir_deg : null,
        minPeriod: Number.isFinite(sb.min_period_s) ? sb.min_period_s : SWELL_BAND_MIN_PERIOD_S
      }
    : swellBandFromBins(bins, SWELL_BAND_MIN_PERIOD_S);
  if (band && !hasDir) band.dir = null;
  return band;
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

// A saved Open-Meteo copy's `current` block is the conditions when it was
// fetched (up to 24 h ago), and the cards label it "Current". Rebuild it
// from the copy's own forecast for this hour (every `current` field is
// also an hourly series in both queries).
function currentFromHourly(data) {
  const i = marineNowIndex(data);
  if (i < 0 || !data.current) return data;
  const current = Object.assign({}, data.current, { time: data.hourly.time[i] });
  for (const k of Object.keys(current)) {
    const s = data.hourly[k];
    if (k !== 'time' && Array.isArray(s)) current[k] = s[i] ?? null;
  }
  return Object.assign({}, data, { current });
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
  if (m.origin === 'stale-cache') {
    marineModel = models[m.keyIdx];
    m.data = currentFromHourly(m.data);
  }
  const windKey = windCacheKey(windLat, windLon);
  const w = settleSource(wind, d => !!(d && d.hourly), windKey, [windKey], maxAge.forecast, roundStart);
  if (w.origin === 'stale-cache') w.data = currentFromHourly(w.data);
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
//   STATE.dataAsOf    epoch ms: how old the swell + wind FORECAST on screen
//                     is (the older of the two fetch times; a stale fallback
//                     keeps its original cache time). A load whose marine
//                     fetch failed leaves the last forecast drawn in
//                     STATE.forecastData, so that one's age keeps counting;
//                     null when no forecast is on screen at all. Saved tide
//                     predictions never age it: they are astronomical and
//                     stay right within their 4-day cap.
//   STATE.dataHealth  { marine:{asOf, origin}, wind:{asOf, origin},
//                     tides:{asOf, origin}, buoy:{obsMs, origin} }; origin is
//                     'live' | 'cache' | 'stale-cache' | 'pipeline' | 'failed'.
// STATE.lastLoadCompletedAt stays the "a load finished" signal; these say
// how old the data on screen really is. The look hooks this function by name
// (previews/clean/core.js raises 'data').
let _forecastDrawnAsOf = null;   // age of the forecast last drawn by a load
function recordDataHealth(health, buoyHealth) {
  STATE.dataHealth = {
    marine: health.marine,
    wind: health.wind,
    tides: health.tides,
    buoy: buoyHealth
  };
  const forecast = [health.marine, health.wind];
  if (health.marine.origin !== 'failed') {
    // renderForecastSet just drew this marine (+ wind) into forecastData.
    const asOfs = forecast.map(s => s.asOf).filter(Number.isFinite);
    _forecastDrawnAsOf = asOfs.length ? Math.min(...asOfs) : null;
  }
  // Without marine nothing was redrawn: an older forecast still on the
  // cards keeps its real age (past the 24 h fallback cap); none → null.
  const fd = STATE.forecastData;
  STATE.dataAsOf = fd && fd.marine ? _forecastDrawnAsOf : null;
}

// ── Load concurrency guard ──────────────────────
// A model change, the ↻ refresh or Choc TV's auto-refresh can start a new
// load while an older one is still awaiting fetches; the generation counter
// makes the superseded run stop writing STATE at its next checkpoint, and
// _loadInFlight lets timers skip firing mid-load.
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
  }

  // Choc's buoy comes from the pipeline's data/buoy.json (scripts/fetch_buoy.py
  // reads NDBC every 2 h: a browser can't). It never gates the forecast.
  const pipelineP = isChoc ? fetchPipelineBuoy() : Promise.resolve(null);

  // ── Forecast (live → saved copy → nothing) ──
  const round = await fetchForecastRound({
    forecastLat, forecastLon, windLat: displayLat, windLon: displayLon, tideStn, selectedModel
  });
  const pipelineData = await pipelineP;
  if (_gen !== _loadGen) return; // superseded by a newer load

  const buoyParsed = buoyParsedFromPipeline(pipelineData, buoy);
  STATE._cachedBuoyParsed = buoyParsed;

  renderForecastSet({
    buoy, isChoc, selectedModel: round.marineModel,
    forecastLat, forecastLon, displayLat, displayLon,
    marine: round.marine, wind: round.wind, buoyParsed, pipelineData,
    tideHiLo: round.hiloRaw ? round.hiloRaw.predictions : null,
    tidePred: round.predRaw ? round.predRaw.predictions : null,
    tideStn
  });

  // lastLoadCompletedAt = this load finished; dataAsOf and dataHealth = how
  // old the data on screen really is.
  STATE.lastLoadCompletedAt = Date.now();
  recordDataHealth(round.health, {
    obsMs: buoyParsed ? buoyParsed.obsMs : null,
    origin: buoyParsed ? buoyParsed.src : 'failed'
  });
}

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

// ════════════════════════════════════════════════
// CHART PALETTE (the forecast-vs-buoy check in My ratings' Details)
// ════════════════════════════════════════════════

// The look's own type (previews/clean/theme.css --sans), for the canvas labels.
let FC_CHART_FONT = '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif';

// Every color the chart drawers use lives here (model.js swaps plotBg to
// match the theme).
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

// ════════════════════════════════════════════════
// BUOY SPECTRUM BINS
// ════════════════════════════════════════════════

// A bin's dir1 is a measurement only when it is finite and not NDBC's 999
// sentinel. Without the swdir file, older pipeline runs wrote dir1 = 0 in
// every bin (newer ones write null): a direction nobody measured, not swell
// from due north.
function binHasMeasuredDir(b) {
  return !!b && Number.isFinite(b.dir1) && b.dir1 < 999;
}
function binsHaveMeasuredDir(bins) {
  return Array.isArray(bins) && bins.some(b => binHasMeasuredDir(b) && b.dir1 !== 0);
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

// Every sign-in change lands here (firebase-config.js). The look hooks it by
// name (previews/clean/core.js raises 'auth'): Settings, Log and My ratings
// follow who is signed in.
function updateAuthUI(user) {}

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
  saveSurfLog(); surfLogChanged();
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
  } catch (e) { alert('Storage full — try removing photos or exporting.'); }
}

async function addLogEntry(entry) {
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  entry.userId = window._fbUserId || '';
  entry.displayName = window._fbDisplayName || '';
  STATE.surfLog.unshift(entry);
  saveSurfLog(); slRetrain(); surfLogChanged();
  try {
    await saveLogEntryToFirebase(entry);
  } catch(e) {
    console.warn('Firebase save failed (entry saved locally):', e);
    showToast('\u26a0 Saved locally \u2014 sync failed', 'warn');
  }
  // Re-save after Firebase upload replaces data-URI photos with Storage URLs.
  // A log load that landed meanwhile kept this entry (loadLogsFromFirebase).
  saveSurfLog();
  surfLogChanged();
}

async function updateLogEntry(id, updates) {
  const idx = STATE.surfLog.findIndex(e => e.id === id);
  if (idx < 0) return;
  Object.assign(STATE.surfLog[idx], updates);
  saveSurfLog(); slRetrain(); surfLogChanged();
  try {
    await saveLogEntryToFirebase(STATE.surfLog[idx]);
    // Re-save after Firebase upload replaces data-URI photos with Storage URLs
    saveSurfLog();
    surfLogChanged();
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
  saveSurfLog(); slRetrain(); surfLogChanged();
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
  surfLogChanged();
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
  slRetrain(); surfLogChanged();
}

// ════════════════════════════════════════════════
// THE LOOK'S TAB
// ════════════════════════════════════════════════

// The look keeps the app's tab in step (previews/clean/core.js showTab): My
// ratings is the app's 'regression' tab, whose borrowed panels redraw while it
// shows, and Log is 'surflog', whose list hook ('log') fires on the switch.
function switchTab(tab) {
  STATE.activeTab = tab;
  if (tab === 'regression') renderRegressionTab();
  if (tab === 'surflog') surfLogChanged();
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

// Wave group velocity approximation: speed (knots) ≈ SWELL_SPEED_KTS_PER_PERIOD × period (seconds)
// This is the standard surf forecaster rule (deep-water group velocity ~1.5 × period).
const SWELL_SPEED_KTS_PER_PERIOD = 1.5;

// Nautical miles from where the swell was read to the beach. Knots × hours
// is nautical miles, so the 1.5 kt × period rule needs nmi: the forecast
// point is ~15.7 nmi out, buoy 44097 ~42 nmi.
function swellLagDistanceNmi(fromLat, fromLon) {
  return haversineDistanceMiles(fromLat, fromLon, CONFIG.chocomount.lat, CONFIG.chocomount.lon) * 0.868976;
}

// Hours for the swell read at (fromLat, fromLon) to reach the reef by
// session time T: distance / (SWELL_SPEED_KTS_PER_PERIOD × mean period over
// the 2 h before T). Defaults to the forecast point, where the archive is
// read. This used to apply the buoy's 50 mi from the forecast point, so each
// logged session's tide sat next to swell from 4–7 h before the session (for
// the usual 5–8 s swell).
// Training (lookupOpenMeteoArchive) and prediction (buildForecastConditions)
// both call this, so a tide is paired with swell the same way on both sides.
function getSwellLagHours(marineData, dateStr, fromLat = CONFIG.chocomount.forecastLat, fromLon = CONFIG.chocomount.forecastLon) {
  if (!marineData?.hourly?.time) return 0;
  const times = marineData.hourly.time;
  const periods = marineData.hourly.swell_wave_period || marineData.hourly.wave_period || [];
  const T = new Date(dateStr).getTime();
  const windowStart = T - 2 * 3600000;
  let sum = 0, count = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (t >= windowStart && t <= T && periods[i] > 0) { sum += periods[i]; count++; }
  }
  const avgPeriod = count > 0 ? sum / count : 0;
  if (avgPeriod <= 0) return 0;
  const speedKts = SWELL_SPEED_KTS_PER_PERIOD * avgPeriod;
  return swellLagDistanceNmi(fromLat, fromLon) / speedKts;
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
  // Swell only: the session's tide is read at the session time itself.
  const lagHours = getSwellLagHours(data, dateStr, lat, lon);
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
  // Archive swell is read at the offshore forecast point; only the NDBC
  // fallback reads buoy 44097.
  const fromBuoy = String(cond.source || '').startsWith('ndbc');
  const lagH = cond.swell.lagHours ? Math.round(cond.swell.lagHours * 10) / 10 : 0;
  const lagNote = lagH ? ' ('+lagH+'h '+(fromBuoy ? 'buoy lag' : 'travel')+')' : '';
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
    h += `<div class="sl-cond-row"><span class="sl-hint">Using swell from ~${escHtml(cond.swellLagHours)}h earlier ${fromBuoy ? 'at buoy 44097' : 'at the offshore forecast point'} (travel time to the reef)</span></div>`;
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
      saveSurfLog(); slRetrain(); surfLogChanged();
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
  if (typeof surfLogChanged === 'function') surfLogChanged();
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
// SURF LOG — Incomplete entries
// ════════════════════════════════════════════════

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

// Every change to the surf log ends here: loaded, saved, edited, deleted, or
// a crew member's session arriving from Firestore. The look hooks it by name
// (previews/clean/core.js raises 'log'): the Log list, My ratings, and
// Explore's and Methods' ten years follow.
function surfLogChanged() {}

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

function _predict(ff, weights, stats) {
  if (!weights||!stats) return null;
  let pred = stats.targetMean || 0;
  for(let i=0;i<ff.length;i++){ const sd=stats.std[i]; pred += weights[i] * (sd>1e-10 ? (ff[i]-stats.mean[i])/sd : 0); }
  return Math.max(1,Math.min(10,Math.round(pred*10)/10));
}
function predictWaveRating(wf) { return _predict(wf, STATE.surfLogWaveWeights, STATE.surfLogWaveStats); }
function predictRideRating(rf) { return _predict(rf, STATE.surfLogRideWeights, STATE.surfLogRideStats); }
function predictCondRating(cf) { return _predict(cf, STATE.surfLogCondWeights, STATE.surfLogCondStats); }

// Where the live marine forecast is read: the open-water forecast point, or
// buoy 44097 when "Use buoy coordinates" is on (see _loadAllDataImpl).
function forecastSwellPoint() {
  const c = CONFIG.chocomount;
  return getForecastUseBuoyCoords() ? { lat: c.buoyLat, lon: c.buoyLon } : { lat: c.forecastLat, lon: c.forecastLon };
}

// True when a tide series actually spans time t. Past either end,
// tideHeightAt would hold the end value and tideRateAt would read 0 ft/hr:
// a frozen slack tide that never happens (a saved copy from a CO-OPS outage
// can end days before the forecast does).
function _tideSeriesCovers(series, t) {
  const preds = _normalizeTidePredictions(series);
  if (!preds.length) return false;
  const ms = new Date(t).getTime();
  return ms >= preds[0].t.getTime() && ms <= preds[preds.length - 1].t.getTime();
}

// Conditions for forecast hour `hi`, paired the way a logged session is
// paired in training (lookupHistoricalConditions): tide and wind at the hour
// itself, with no lag (Silver Eel's times are Choc's tide times), and the
// swell that reaches the reef at that hour, read getSwellLagHours earlier.
// `tidePred` is the 6-min predictions series (CO-OPS interval=6) and is
// used for height + rate via interpolation. `tideHiLo` is consulted only
// for `timeToNearest` (hours to the next labelled extremum) — it has
// explicit H/L type tags so the readout is exact rather than detected.
function buildForecastConditions(marine, wind, tideHiLo, tidePred, hi) {
  if (!marine?.hourly||!wind?.hourly) return null;
  const targetTime = marine.hourly.time?.[hi];
  // The surf-log model is Choc's: another buoy's forecast gets no Choc lag.
  let si = hi, lagH = 0;
  if (targetTime && STATE.isChocomount) {
    const p = forecastSwellPoint();
    lagH = getSwellLagHours(marine, targetTime, p.lat, p.lon);
    if (lagH > 0) si = findNearestHour(marine.hourly.time, new Date(new Date(targetTime).getTime() - lagH * 3600000).toISOString());
  }
  const swH=marine.hourly.swell_wave_height?.[si]??marine.hourly.wave_height?.[si]??0;
  const swD=marine.hourly.swell_wave_direction?.[si]??marine.hourly.wave_direction?.[si]??0;
  const swP=marine.hourly.swell_wave_period?.[si]??marine.hourly.wave_period?.[si]??0;
  const secH=marine.hourly.secondary_swell_wave_height?.[si]??0;
  const secD=marine.hourly.secondary_swell_wave_direction?.[si]??0;
  const secP=marine.hourly.secondary_swell_wave_period?.[si]??0;
  const wSpd=wind.hourly.wind_speed_10m?.[hi]??0, wDir=wind.hourly.wind_direction_10m?.[hi]??0;
  // No tide data (CO-OPS down) → tide: null, never a made-up 0 ft 'rising':
  // the Ride prediction then shows '—' instead of rating fictional water
  // (audit C11). The same goes for an hour past the end of the series.
  let tideInfo = null;
  if (targetTime && tidePred && tidePred.length && _tideSeriesCovers(tidePred, targetTime)) {
    tideInfo = parseTideAtTime({ predictions: tidePred }, targetTime);
    if (tideInfo && tideHiLo && tideHiLo.length) {
      const hi2 = parseTideAtTime({ predictions: tideHiLo }, targetTime);
      if (hi2) tideInfo.timeToNearest = hi2.timeToNearest;
    }
  }
  if (!tideInfo && targetTime && tideHiLo && tideHiLo.length && _tideSeriesCovers(tideHiLo, targetTime)) {
    tideInfo = parseTideAtTime({ predictions: tideHiLo }, targetTime);
  }
  return { swell:{height:swH,direction:swD,period:swP,secondary:secH>0.3?{height:secH,direction:secD,period:secP}:undefined},
    wind:{speed:wSpd,direction:wDir}, tide:tideInfo, swellLagHours: si !== hi ? Math.round(lagH * 10) / 10 : 0 };
}

// ════════════════════════════════════════════════
// FORECAST HOURS
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

// ════════════════════════════════════════════════
// FORECAST POINT (Settings › Spot: at the buoy or off the reef)
// ════════════════════════════════════════════════

function getForecastUseBuoyCoords() {
  return localStorage.getItem('lcc-forecast-use-buoy-coords') === '1';
}

// ════════════════════════════════════════════════
// FORECAST MODEL (Settings › Forecast model)
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
}

// Quick sanity check for the post-fetch fallback path.
function marineHasUsableData(marine) {
  if (!marine || !marine.hourly) return false;
  const h = marine.hourly.swell_wave_height || marine.hourly.wave_height;
  if (!h || h.length === 0) return false;
  return h.some(v => v != null && Number.isFinite(v));
}

// ════════════════════════════════════════════════
// MY RATINGS' DETAILS (the app's Tab 2 panels, borrowed)
// ════════════════════════════════════════════════

// Tab 2 sub-model state — drives §6, §7, §8, §9 below.
let _regActiveSubmodel = 'wave';

// My ratings' Details (previews/clean/model.js) borrows these panels and
// calls this to draw them: predicted vs actual, the per-factor charts, the raw
// weights and the forecast-vs-buoy check. Chocomount only.
function renderRegressionTab() {
  const pva = el('panel-regression-pva');
  const submodel = el('panel-regression-submodel');
  const weights = el('panel-surflog-weights');
  const verification = el('panel-verification');
  if (!STATE.isChocomount) {
    [pva, submodel, weights, verification].forEach(s => { if (s) s.style.display = 'none'; });
    return;
  }
  if (pva) pva.style.display = '';
  if (submodel) submodel.style.display = '';
  renderRegressionPVA();
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

// The getters above switch definition row by row, but one average over
// both kinds of row isn't a model score: the buoy's DPD runs ~1 s above
// its Tm-1,0 for the same sea, so as new rows pile up the period "typical
// miss" would drift from about −0.7 s to +0.5 s with no change in the
// model. Period and direction are therefore scored on the new-format rows
// once a day of them is logged, and on the older rows alone (labelled as
// such) until then. The charts keep every row.
const VERIF_MIN_NEW_ROWS = 24;   // one day of hourly rows

function _verifRowHasTm10(r) {
  return !!(r.buoy && r.buoy.tm10 != null);
}

// → { rows, isNew }: the rows one statistic is scored on.
function _verifScoringRows(rows, isNewRow) {
  const fresh = rows.filter(isNewRow);
  if (fresh.length >= VERIF_MIN_NEW_ROWS || fresh.length === rows.length) return { rows: fresh, isNew: true };
  return { rows: rows.filter(r => !isNewRow(r)), isNew: false };
}

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
    const metric = (label, g, digits, unit, rs = rows) => {
      const mb = verifStats(rs, g.obs, g.mb, g.circular);
      const mc = verifStats(rs, g.obs, g.mc, g.circular);
      return `<tr><td>${label}</td>` +
        `<td>${_verifFmt(mb.bias, digits, unit)}</td><td>${mb.mae == null ? '—' : mb.mae.toFixed(digits) + unit}</td>` +
        `<td>${_verifFmt(mc.bias, digits, unit)}</td><td>${mc.mae == null ? '—' : mc.mae.toFixed(digits) + unit}</td>` +
        `<td>${mb.n}</td></tr>`;
    };
    const per = _verifScoringRows(rows, _verifRowHasTm10);
    const dir = _verifScoringRows(rows, _verifRowHasWvd);
    statsBox.innerHTML =
      '<table class="verif-table"><thead><tr><th></th>' +
      '<th colspan="2">How accurate is the model?<br><span class="verif-th-sub">its claim at the buoy vs what the buoy measured</span></th>' +
      '<th colspan="2">How different is the Choc forecast point?<br><span class="verif-th-sub">its claim at the Choc point vs the buoy</span></th><th rowspan="2">readings</th></tr>' +
      '<tr><th></th><th>typical miss</th><th>typical size</th><th>typical miss</th><th>typical size</th></tr></thead><tbody>' +
      metric('Height', VERIF_GET.height, 1, ' ft') +
      metric(per.isNew ? 'Period' : 'Period (buoy peak)', VERIF_GET.period, 1, ' s', per.rows) +
      metric(dir.isNew ? 'Direction' : 'Direction (swell ≥ 8 s)', VERIF_GET.dir, 0, '°', dir.rows) +
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
    `The table never averages the two kinds of row together: period and direction are scored on the newer rows once ${VERIF_MIN_NEW_ROWS} of them are logged, and until then on the older rows alone, labelled “buoy peak” and “swell ≥ 8 s”. The charts show every row. ` +
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

// ── Tab 2 §11: Drill-down, open and close ─────────────────────────────

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

  // Load Chocomount now, before the surf log (whose Firebase wait used to hold
  // the forecast back by 2-15 s). Choc TV's boot watchdog, or the look's own
  // boot recovery, may already have selected it: don't load twice.
  if (!STATE.selectedBuoy) {
    const chocBuoy = STATE.buoys.find(b => b.home === 'chocomount');
    if (chocBuoy) selectBuoy(chocBuoy);
  }

  // The surf log loads in the background: nothing on the forecast needs it,
  // and Firebase auth + Firestore can take seconds (or hang).
  initSurfLogForm();
  loadSurfLog().then(function() {
    slRetrain();
    surfLogChanged();
    // Re-attempt any photo uploads that failed on a prior session.
    retryFailedPhotoUploads().catch(function(e) { console.warn('Retry pass failed:', e); });
  }).catch(function(e) { console.warn('Surf log load failed:', e); });
}

// The page starts straight into the app, once per page (the look and Choc TV
// take the same path).
function startApp() {
  if (STATE.appStarted) return;
  STATE.appStarted = true;
  initApp();
}

// ── Start ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', startApp);
