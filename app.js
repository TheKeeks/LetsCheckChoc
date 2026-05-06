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
  return fetchJSON(`${CONFIG.api.openMeteoMarine}?${params}`);
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
  return fetchJSON(`${CONFIG.api.openMeteoWeather}?${params}`);
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
  return fetchJSON(`${CONFIG.api.coops}?${params}`);
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
  return fetchJSON(`${CONFIG.api.coops}?${params}`);
}

async function fetchWaterTemp(stationId) {
  const params = new URLSearchParams({
    date: 'latest',
    station: stationId,
    product: 'water_temperature',
    units: 'english',
    time_zone: 'lst_ldt',
    application: 'letscheckchoc',
    format: 'json'
  });
  return fetchJSON(`${CONFIG.api.coops}?${params}`);
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
  return fetchJSON('data/buoy.json');
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

  // Show loading states
  el('val-swell-height').textContent = '···';
  el('val-wind-speed').textContent = '···';
  el('val-water-temp').textContent = '···';
  el('val-tide').textContent = '···';

  // Fetch all in parallel
  const selectedModel = getForecastModel();
  let [marine, wind, buoyData, pipelineData] = await Promise.all([
    fetchMarineForecast(forecastLat, forecastLon, selectedModel),
    fetchWindForecast(displayLat, displayLon),
    buoy.spectral ? fetchNDBCStdmet(buoy.id) : Promise.resolve(null),
    isChoc ? fetchPipelineBuoy() : Promise.resolve(null)
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

  // ── Current conditions cards ──
  STATE._cachedBuoyParsed = buoyParsed;
  updateSwellCard(buoyParsed, marine, buoy, pipelineData?.spectral_summary);
  updateWindCard(wind, buoyParsed, isChoc, displayLat, displayLon);
  updateWaterTempCard(buoyParsed, marine, isChoc);
  updateDaylightCard(displayLat, displayLon);

  // ── Secondary swell card ──
  updateSecondarySwellCard(marine, isChoc, forecastLat, forecastLon);

  // ── Coord footers under each card ──
  updateCoordFooters(buoy, forecastLat, forecastLon, displayLat, displayLon);

  // ── Swell forecast chart ──
  if (marine && marine.hourly) {
    const daylight = calcDaylight(displayLat, displayLon, new Date());
    const tideStn = findNearestTideStation(displayLat, displayLon);
    STATE.nearestTideStation = tideStn;
    let tideHiLoForChart = null;
    let tidePredForChart = null;
    if (tideStn) {
      const [td, predData] = await Promise.all([
        fetchTideHiLo(tideStn.id, 10),
        fetchTidePredictions(tideStn.id, undefined, 168)
      ]);
      tideHiLoForChart = td && td.predictions ? td.predictions : null;
      tidePredForChart = predData && predData.predictions ? predData.predictions : null;
    }

    // Cache forecast data for personal-match scoring (consumed by Tab 2 / future).
    STATE._cachedMarine = marine;
    STATE._cachedWind = wind;
    STATE._cachedTideHiLo = tideHiLoForChart;
    STATE._cachedTidePred = tidePredForChart;

    // ── Tide condition card ──
    updateTideCard(tideHiLoForChart, tideStn);

    drawForecastChart(marine, wind, daylight, tideHiLoForChart, tidePredForChart);

    // Refresh lineup overlay (Choc only — uses current Open-Meteo + wind values).
    if (isChoc) drawLineupMap(marine, wind, buoyParsed);

    const coordLabel = isChoc ? `${forecastLat}°N, ${Math.abs(forecastLon)}°W (open water)` : `${forecastLat.toFixed(3)}°N, ${Math.abs(forecastLon).toFixed(3)}°W`;
    setFooter('footer-forecast',
      `Open-Meteo Marine · ${describeForecastModel(selectedModel)} · ${coordLabel}`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }

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
  el('val-swell-height').textContent = '···';
  el('val-wind-speed').textContent = '···';
  el('val-water-temp').textContent = '···';
  el('val-tide').textContent = '···';

  const selectedModel = getForecastModel();
  let [marine, wind] = await Promise.all([
    fetchMarineForecast(lat, lon, selectedModel),
    fetchWindForecast(lat, lon)
  ]);
  if (selectedModel && !marineHasUsableData(marine)) {
    showToast(`Model ${selectedModel} unavailable, falling back to best_match`, 'warn');
    setForecastModel('');
    marine = await fetchMarineForecast(lat, lon, null);
  }

  // Current conditions from Open-Meteo only
  updateSwellCard(null, marine, null);
  updateWindCard(wind, null, false, lat, lon);
  updateWaterTempCard(null, marine, false);
  updateDaylightCard(lat, lon);

  updateSecondarySwellCard(marine, false, lat, lon);

  // Coord footer (single line — pin coord only).
  updateCoordFooters(null, lat, lon, lat, lon);

  // Forecast chart
  if (marine && marine.hourly) {
    const daylight = calcDaylight(lat, lon, new Date());
    const tideStn = findNearestTideStation(lat, lon);
    STATE.nearestTideStation = tideStn;
    let tideHiLoForChart = null;
    let tidePredForChart = null;
    if (tideStn) {
      const [td, predData] = await Promise.all([
        fetchTideHiLo(tideStn.id, 10),
        fetchTidePredictions(tideStn.id, undefined, 168)
      ]);
      tideHiLoForChart = td && td.predictions ? td.predictions : null;
      tidePredForChart = predData && predData.predictions ? predData.predictions : null;
    }

    STATE._cachedTidePred = tidePredForChart;
    updateTideCard(tideHiLoForChart, tideStn);

    drawForecastChart(marine, wind, daylight, tideHiLoForChart, tidePredForChart);
    setFooter('footer-forecast',
      `Open-Meteo Marine · ${describeForecastModel(selectedModel)} · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }

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
//   │  ┌─ tide callout row (NEXT LOW …) ──────────────┐  │
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

// Render the "NEXT LOW: …" callout text relative to a target ms timestamp
// (defaults to Date.now()). Returns the formatted line.
function formatNextLowCallout(tideHiLo, fromMs) {
  if (!tideHiLo) return '';
  const fm = fromMs != null ? fromMs : Date.now();
  const lows = tideHiLo
    .filter(p => p.type === 'L')
    .map(p => ({ t: new Date(p.t).getTime(), v: parseFloat(p.v) }))
    .filter(p => Number.isFinite(p.v) && p.t > fm)
    .sort((a, b) => a.t - b.t);
  const next = lows[0];
  if (!next) return '';
  const td = new Date(next.t);
  const hrs = td.getHours();
  const mins = td.getMinutes();
  const ampm = hrs >= 12 ? 'pm' : 'am';
  const h12 = hrs % 12 || 12;
  const timeStr = mins === 0 ? `${h12}${ampm}` : `${h12}:${String(mins).padStart(2, '0')}${ampm}`;
  // Day word: Today / Tomorrow / weekday
  const refDay = new Date(fm); refDay.setHours(0, 0, 0, 0);
  const lowDay = new Date(td); lowDay.setHours(0, 0, 0, 0);
  const dayDelta = Math.round((lowDay - refDay) / 86400000);
  let dayWord;
  if (dayDelta <= 0)      dayWord = 'Today';
  else if (dayDelta === 1) dayWord = 'Tomorrow';
  else                     dayWord = td.toLocaleDateString('en-US', { weekday: 'short' });
  const heightStr = `${next.v.toFixed(1)}ft`;
  // "in Xh Ym" — relative to fromMs.
  const deltaMin = Math.max(0, Math.round((next.t - fm) / 60000));
  const dh = Math.floor(deltaMin / 60);
  const dm = deltaMin % 60;
  const inStr = dh > 0 ? `${dh}h ${dm}m` : `${dm}m`;
  return `${dayWord} ${timeStr} · ${heightStr} · in ${inStr}`;
}

function positionAndUpdateTideCallout(container, geom, scrubMs) {
  const cal = container.querySelector('#forecast-tide-callout, .forecast-tide-callout');
  if (!cal) return;
  const tideHiLo = geom.tideHiLo;
  if (!tideHiLo) { cal.textContent = ''; return; }
  const isScrub = scrubMs != null && Math.abs(scrubMs - Date.now()) > 30 * 60 * 1000;
  const line = formatNextLowCallout(tideHiLo, isScrub ? scrubMs : null);
  if (!line) { cal.innerHTML = ''; return; }
  const scrubLabel = isScrub
    ? `NEXT LOW AFTER ${new Date(scrubMs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}`
    : 'NEXT LOW';
  cal.innerHTML = `<span class="tide-callout-prefix">${scrubLabel}:</span> <strong>${line}</strong>`;
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

// ── Per-panel drawers ──────────────────────────────

function drawSwellPanel(common, data) {
  const canvas = el('forecast-canvas-swell');
  if (!canvas) return null;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssH = canvas.clientHeight || canvas.parentElement.clientHeight;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, cssW, cssH);

  const isMobile = common.isMobile;
  const plotLeft = FC_PAD.left;
  const plotW    = cssW - FC_PAD.left - FC_PAD.right;
  const top      = 4;
  const h        = cssH - 8;

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  // Night shading + day separators (full canvas height)
  _fcDrawNightShading(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawDaySeparators(ctx, common, plotLeft, plotW, 0, cssH);
  _fcDrawTodayAccent(ctx, common, plotLeft, plotW, 0, cssH);

  const { heights, secHeights, swellDirs, wavePeriods, swellMaxY, swellStep, periodMax } = data;
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
  // beneath so it stays legible against the dark-blue swell area.
  const periodPath = new Path2D();
  let pStarted = false;
  for (let i = 0; i <= common.lastIdx; i++) {
    const p = wavePeriods[i];
    if (p == null) continue;
    const x = xPos(common.allTimes[i]);
    const y = yPeriod(p);
    if (!pStarted) { periodPath.moveTo(x, y); pStarted = true; }
    else periodPath.lineTo(x, y);
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 4;
  ctx.stroke(periodPath);
  ctx.strokeStyle = '#c46a32';
  ctx.lineWidth = 2;
  ctx.stroke(periodPath);
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

  return {
    canvas, cssW, cssH, plotLeft, plotW, top, h,
    swellMaxY, ySwell, yPeriod
  };
}

function drawWindPanel(common, data) {
  const canvas = el('forecast-canvas-wind');
  if (!canvas) return null;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssH = canvas.clientHeight || canvas.parentElement.clientHeight;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, cssW, cssH);

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

  const axisFont = isMobile ? '9px' : '10px';
  ctx.font = `${axisFont} "DM Mono", monospace`;
  ctx.fillStyle = '#5a5550';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${windMaxY}`, plotLeft - 4, yWind(windMaxY));
  ctx.fillText('0', plotLeft - 4, yWind(0));
  ctx.font = `${isMobile ? '8px' : '9px'} "DM Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('mph', plotLeft + 2, top + 2);

  return { canvas, cssW, cssH, plotLeft, plotW, top, h, windMaxY };
}

function drawTidePanel(common, data) {
  const canvas = el('forecast-canvas-tide');
  if (!canvas) return null;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssH = canvas.clientHeight || canvas.parentElement.clientHeight;
  const ctx = canvas.getContext('2d');
  setCanvasDPR(canvas, ctx, cssW, cssH);

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
    ctx.fillText(label, xx, cssH * 0.55);
  }

  // Hour ticks (00:00 / 06:00 / 12:00 / 18:00) — day 1 only.
  ctx.fillStyle = '#b5afa8';
  ctx.font = `${isMobile ? '8px' : '9px'} "DM Mono", monospace`;
  ctx.textBaseline = 'bottom';
  for (const hh of [0, 6, 12, 18]) {
    const tick = new Date(common.firstDay);
    tick.setHours(hh, 0, 0, 0);
    const xx = _fcXFor(tick, common, plotLeft, plotW);
    if (xx <= plotLeft + 8 || xx >= plotLeft + plotW - 8) continue;
    ctx.fillText(`${String(hh).padStart(2, '0')}:00`, xx, cssH - 1);
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
  // Use peak period when present, otherwise mean period. (Open-Meteo Marine
  // exposes both depending on model — we asked for both in the fetch.)
  const peakPeriods  = marine.hourly.swell_wave_peak_period || [];
  const meanPeriods  = marine.hourly.swell_wave_period || marine.hourly.wave_period || [];
  const wavePeriods  = peakPeriods.length ? peakPeriods : meanPeriods;
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
  const windMaxY = Math.max(10, Math.ceil(windPeak * 1.2 / 5) * 5);

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
  const swellInfo = drawSwellPanel(common, {
    heights, secHeights, swellDirs, wavePeriods, swellMaxY, swellStep, periodMax
  });
  drawWindPanel(common, { windSpeeds, windDirs, windMaxY });
  const tideInfo = drawTidePanel(common, { tidePred, tideHiLo });
  drawDayLabels(common);

  // Tide callout (HTML overlay, populated as text only).
  positionAndUpdateTideCallout(container, { tideHiLo });

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
    heights, secHeights, wavePeriods, swellDirs, windSpeeds, windDirs, windGusts,
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

    detailBar.innerHTML =
      `<div class="detail-row">` +
      `<span class="detail-time">${dayName} ${timeStr}</span>` +
      `<span class="detail-item"><span class="detail-val">${swellStr}</span></span>` +
      `<span class="detail-item"><span class="detail-val">${swellDirStr}</span></span>` +
      `<span class="detail-item"><span class="detail-val">${windStr}</span></span>` +
      (tideStr ? `<span class="detail-item"><span class="detail-tide">${tideStr}</span></span>` : '') +
      `</div>`;
    detailBar.classList.add('active');
    detailBar.classList.toggle('scrub-active', !isScrubberAtNow());
  }

  // ── Move overlay crosshair + handle ──
  const container = el('forecast-chart-container');
  if (container) {
    let crosshair = container.querySelector('.forecast-crosshair');
    if (!crosshair) {
      crosshair = document.createElement('div');
      crosshair.className = 'forecast-crosshair';
      container.appendChild(crosshair);
    }
    let handle = container.querySelector('.forecast-handle');
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'forecast-handle';
      container.appendChild(handle);
    }
    const L = cs.layout;
    const dataXPx = L.plotLeft + ((t.getTime() - cs.t0) / cs.tRange) * L.plotW;
    // Crosshair spans swell + wind + tide panels + arrow strip.
    crosshair.style.display = '';
    crosshair.style.left = dataXPx + 'px';
    crosshair.style.top = L.crosshairTop + 'px';
    crosshair.style.height = (L.crosshairBot - L.crosshairTop) + 'px';
    // Handle snaps to the swell-height curve in the swell panel.
    handle.style.display = '';
    handle.style.left = dataXPx + 'px';
    const handleY = L.swellTop + L.swellH - (Math.min(h != null ? h : 0, L.swellMaxY) / L.swellMaxY) * L.swellH;
    handle.style.top = handleY + 'px';
  }

  // ── Cross-feature: lineup map arrows ──
  if (STATE.isChocomount && STATE.forecastData) {
    const fd = STATE.forecastData;
    drawLineupMap(fd.marine, fd.wind, null, idx);
  }

  // ── Cross-feature: stat grid (with +Xh / -Xh badge) ──
  applyStatGridForHour(idx);

  // ── Tide callout: re-render relative to scrubbed hour ──
  if (cs.layout) {
    const containerEl = el('forecast-chart-container');
    if (containerEl) {
      positionAndUpdateTideCallout(containerEl, {
        tideHiLo: cs.tideHiLo
      }, isScrubberAtNow() ? null : t.getTime());
    }
  }

  // ── "Reset to now" link visibility ──
  const resetRow = el('forecast-reset-row');
  if (resetRow) resetRow.style.display = isScrubberAtNow() ? 'none' : '';
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

async function lookupNDBCHistoricalConditions(dateStr) {
  const display = el('sl-conditions-display');
  const sessionMs = new Date(dateStr).getTime();
  const buoyId = CONFIG.chocomount.buoyId;
  const year = new Date(dateStr).getUTCFullYear();

  if (display) display.innerHTML = '<span class="sl-hint">Loading NDBC buoy ' + buoyId + ' (' + year + ')…</span>';

  try {
    const [rows, tide] = await Promise.all([
      fetchNDBCHistoricalYear(buoyId, year),
      fetchHistoricalTide(dateStr)
    ]);

    if (!rows || rows.length === 0) {
      if (display) display.innerHTML = '<span class="sl-hint">NDBC historical data not available for ' + year + '.</span>';
      return null;
    }

    // Compute swell travel lag using buoy period observations in the window [T-5h, T-2h]
    const windowStart = sessionMs - 5 * 3600000;
    const windowEnd   = sessionMs - 2 * 3600000;
    const lagPeriods = rows.filter(function(r) {
      return r.t.getTime() >= windowStart && r.t.getTime() <= windowEnd && r.period > 0;
    }).map(function(r) { return r.period; });
    const avgPeriod = lagPeriods.length > 0 ? lagPeriods.reduce(function(s, p) { return s + p; }, 0) / lagPeriods.length : 0;
    const ndbcLagHours = avgPeriod > 0 ? CONFIG.chocomount.buoyDistanceMiles / (SWELL_SPEED_KTS_PER_PERIOD * avgPeriod) : 0;
    const laggedMs = ndbcLagHours > 0 ? sessionMs - ndbcLagHours * 3600000 : sessionMs;

    console.log(`[ndbc-parse] searching for swell row matching ${new Date(laggedMs).toISOString()} (lagged ${ndbcLagHours.toFixed(2)}h from session)`);
    console.log(`[ndbc-parse] candidate rows in ±2hr window:`, rows.filter(function(r) { return Math.abs(r.t.getTime() - laggedMs) <= 2 * 3600000; }).length);

    // Wave observation at lagged time (buoy reading that arrived at beach by session time)
    const swellRow = _findNearestNDBCRow(rows, laggedMs, true);
    // Wind at session time (local, no lag)
    const windRow  = _findNearestNDBCRow(rows.filter(function(r) { return r.windSpeed !== null; }), sessionMs, false);

    if (!swellRow) {
      const nearest = rows.slice().sort(function(a, b) {
        return Math.abs(a.t.getTime() - laggedMs) - Math.abs(b.t.getTime() - laggedMs);
      }).slice(0, 4);
      console.log(`[ndbc-parse] no swell match — nearest 4 rows:`, nearest);
      if (display) display.innerHTML = '<span class="sl-hint">No NDBC wave observations found near this date.</span>';
      return null;
    }
    console.log(`[ndbc-parse] swell match Δ=${Math.round(Math.abs(swellRow.t.getTime() - laggedMs) / 60000)}min`, swellRow);

    const tideInfo = parseTideAtTime(tide, dateStr);
    const wSpd = windRow ? (windRow.windSpeed || 0) : 0;
    const wDir = windRow ? (windRow.windDir  || 0) : 0;

    const conditions = {
      swell: {
        height: Math.round((swellRow.waveHeight || 0) * 10) / 10,
        direction: Math.round(swellRow.direction || 0),
        period: Math.round((swellRow.period || 0) * 10) / 10,
        lagHours: Math.round(ndbcLagHours * 10) / 10
      },
      wind: { speed: Math.round(wSpd), direction: Math.round(wDir) },
      tide: { height: Math.round(tideInfo.height * 10) / 10, stage: tideInfo.stage, timeToNearest: tideInfo.timeToNearest },
      source: 'ndbc'
    };

    if (ndbcLagHours > 0) {
      conditions.swellLagHours = Math.round(ndbcLagHours * 10) / 10;
      conditions.originalLoggedTime = dateStr;
      conditions.calculatedFromBuoyTime = new Date(laggedMs).toISOString();
    }

    renderConditionsDisplay(conditions);
    return conditions;
  } catch (err) {
    console.warn('NDBC historical lookup failed:', err);
    if (display) display.innerHTML = '<span class="sl-hint">NDBC lookup failed (' + err.message + '). Try entering conditions manually.</span>';
    return null;
  }
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

async function fetchHistoricalWind(dateStr) {
  const target = new Date(dateStr);
  const dayBefore = new Date(target); dayBefore.setDate(dayBefore.getDate() - 1);
  const diffDays = (Date.now() - target.getTime()) / 86400000;
  if (diffDays <= 5) {
    const p = new URLSearchParams({ latitude: CHOC_WIND_LAT, longitude: CHOC_WIND_LON, hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m', wind_speed_unit: 'mph', timezone: 'auto', past_days: 7, forecast_days: 1 });
    return fetchJSON(CONFIG.api.openMeteoWeather + '?' + p);
  }
  const p = new URLSearchParams({ latitude: CHOC_WIND_LAT, longitude: CHOC_WIND_LON, hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m', wind_speed_unit: 'mph', timezone: 'auto', start_date: fmtDate(dayBefore), end_date: fmtDate(target) });
  return fetchJSON(CONFIG.api.openMeteoArchive + '?' + p);
}

async function fetchHistoricalMarine(dateStr) {
  const target = new Date(dateStr);
  const diffDays = (Date.now() - target.getTime()) / 86400000;
  const vars = 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period';
  if (diffDays <= 5) {
    const p = new URLSearchParams({ latitude: CONFIG.chocomount.forecastLat, longitude: CONFIG.chocomount.forecastLon, hourly: vars, length_unit: 'imperial', timezone: 'auto', past_days: 7, forecast_days: 1 });
    return fetchJSON(CONFIG.api.openMeteoMarine + '?' + p);
  }
  const d = fmtDate(target);
  const p = new URLSearchParams({ latitude: CONFIG.chocomount.forecastLat, longitude: CONFIG.chocomount.forecastLon, hourly: vars, length_unit: 'imperial', timezone: 'auto', start_date: d, end_date: d });
  return fetchJSON(CONFIG.api.openMeteoMarine + '?' + p);
}

async function fetchHistoricalTide(dateStr) {
  const d = new Date(dateStr);
  const bd = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('');
  const p = new URLSearchParams({ begin_date: bd, range: 24, station: CONFIG.chocomount.tideStation, product: 'predictions', datum: 'MLLW', units: 'english', time_zone: 'lst_ldt', interval: 'hilo', application: 'letscheckchoc', format: 'json' });
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

function parseTideAtTime(tideData, dateStr) {
  if (!tideData?.predictions?.length) return { height: 0, stage: 'rising', timeToNearest: 0 };
  const preds = tideData.predictions, tt = new Date(dateStr).getTime();
  let ni = 0, nd = Infinity;
  for (let i = 0; i < preds.length; i++) {
    const d = Math.abs(new Date(preds[i].t).getTime() - tt);
    if (d < nd) { nd = d; ni = i; }
  }
  const n = preds[ni], nt = new Date(n.t).getTime();
  const stage = nt > tt ? (n.type === 'H' ? 'rising' : 'falling') : (n.type === 'H' ? 'falling' : 'rising');
  return { height: parseFloat(n.v) || 0, stage, timeToNearest: Math.round(Math.abs(nt - tt) / 3600000 * 10) / 10 };
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

async function lookupHistoricalConditions(dateStr) {
  const display = el('sl-conditions-display');
  if (display) display.innerHTML = '<span class="sl-hint">Looking up conditions...</span>';

  // Dates older than 5 days: use actual NDBC buoy observations (Chocomount only)
  // Open-Meteo Marine API does not reliably provide historical swell for these dates
  const diffDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (diffDays > 5 && STATE.isChocomount) {
    return lookupNDBCHistoricalConditions(dateStr);
  }

  try {
    const [wind, marine, tide] = await Promise.all([fetchHistoricalWind(dateStr), fetchHistoricalMarine(dateStr), fetchHistoricalTide(dateStr)]);
    if (!wind?.hourly || !marine?.hourly) {
      if (display) display.innerHTML = '<span class="sl-hint">Historical data not available for this date.</span>';
      return null;
    }
    const lagHours = getSwellLagHours(marine, dateStr);
    const laggedDateStr = lagHours > 0 ? new Date(new Date(dateStr).getTime() - lagHours * 3600000).toISOString() : dateStr;
    const swellIdx = findNearestHour(marine.hourly.time, laggedDateStr);
    const wIdx = findNearestHour(wind.hourly.time, dateStr);
    const swH = marine.hourly.swell_wave_height?.[swellIdx] ?? marine.hourly.wave_height?.[swellIdx] ?? 0;
    const swD = marine.hourly.swell_wave_direction?.[swellIdx] ?? marine.hourly.wave_direction?.[swellIdx] ?? 0;
    const swP = marine.hourly.swell_wave_period?.[swellIdx] ?? marine.hourly.wave_period?.[swellIdx] ?? 0;
    const secH = marine.hourly.secondary_swell_wave_height?.[swellIdx] ?? 0;
    const secD = marine.hourly.secondary_swell_wave_direction?.[swellIdx] ?? 0;
    const secP = marine.hourly.secondary_swell_wave_period?.[swellIdx] ?? 0;
    const wSpd = wind.hourly.wind_speed_10m?.[wIdx] ?? 0;
    const wDir = wind.hourly.wind_direction_10m?.[wIdx] ?? 0;
    const tideInfo = parseTideAtTime(tide, dateStr);

    const conditions = {
      swell: { height: Math.round(swH*10)/10, direction: Math.round(swD), period: Math.round(swP*10)/10, lagHours: lagHours },
      wind: { speed: Math.round(wSpd), direction: Math.round(wDir) },
      tide: { height: Math.round(tideInfo.height*10)/10, stage: tideInfo.stage, timeToNearest: tideInfo.timeToNearest },
      source: 'openmeteo'
    };
    if (lagHours > 0) {
      conditions.swellLagHours = Math.round(lagHours * 10) / 10;
      conditions.originalLoggedTime = dateStr;
      conditions.calculatedFromBuoyTime = laggedDateStr;
    }
    if (secH > 0.3) conditions.swell.secondary = { height: Math.round(secH*10)/10, direction: Math.round(secD), period: Math.round(secP*10)/10 };
    renderConditionsDisplay(conditions);
    return conditions;
  } catch (err) {
    console.warn('Historical lookup failed:', err);
    if (display) display.innerHTML = '<span class="sl-hint">Lookup failed. You can enter conditions manually.</span>';
    return null;
  }
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
  h += dl('Wind:', cond.wind.speed+' mph '+directionLabel(cond.wind.direction)+' ('+cond.wind.direction+'\u00b0)');
  h += dl('Tide:', cond.tide.height+'ft '+cond.tide.stage+' ('+cond.tide.timeToNearest+'h to next)');
  h += '</div>';
  if (cond.swellLagHours > 0) {
    h += `<div class="sl-cond-row"><span class="sl-hint">Using swell from ~${cond.swellLagHours}h ago at buoy (travel time estimate)</span></div>`;
  }
  if (cond.source) {
    const srcLabel = cond.source === 'ndbc' ? 'NDBC buoy 44097 (measured)' : 'Open-Meteo marine API';
    h += '<div class="sl-cond-row"><span class="sl-hint">Source: ' + srcLabel + '</span></div>';
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

function initSurfLogForm() {
  const dtInput = el('sl-datetime');
  if (dtInput) {
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.value = now.toISOString().slice(0, 16);
  }
  // Main form sliders
  [['sl-size','sl-size-val','sl-size-desc','size'],['sl-wind-quality','sl-wind-val','sl-wind-desc','windQuality'],['sl-ride-quality','sl-ride-val','sl-ride-desc','rideQuality']].forEach(([id,vid,did,fieldName]) => {
    const s = el(id);
    const descFn = id === 'sl-size' ? getSizeDesc : id === 'sl-wind-quality' ? getWindDesc : getRideDesc;
    s?.addEventListener('input', () => {
      el(vid).textContent = s.value; if(el(did)) el(did).textContent = descFn(s.value);
      s.closest('.sl-slider-group')?.classList.remove('sl-needs-review');
      if (Array.isArray(STATE.surfLogEditRepairCandidates)) STATE.surfLogEditRepairCandidates = STATE.surfLogEditRepairCandidates.filter(n => n !== fieldName);
    });
    if (s && el(did)) el(did).textContent = descFn(s.value);
  });
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
    _slConditions = await lookupHistoricalConditions(dt);
    btn.disabled = false; btn.textContent = 'Lookup Historical Conditions';
    if (_slConditions) {
      const condDisplay = el('sl-conditions-display');
      const condWrapper = condDisplay ? condDisplay.parentElement : null;
      if (condWrapper) {
        condWrapper.classList.remove('sl-needs-review');
        const oldWarn = condWrapper.querySelector('.sl-conditions-warning');
        if (oldWarn) oldWarn.remove();
      }
      if (Array.isArray(STATE.surfLogEditRepairCandidates)) STATE.surfLogEditRepairCandidates = STATE.surfLogEditRepairCandidates.filter(n => n !== 'swell');
    }
  });
  el('sl-save-btn')?.addEventListener('click', async () => {
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
  ['sl-filter-from','sl-filter-to','sl-filter-rating'].forEach(id => {
    el(id)?.addEventListener('change', () => renderSurfLogTable());
  });
}

function resetSurfLogForm() {
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  if (el('sl-datetime')) el('sl-datetime').value = now.toISOString().slice(0, 16);
  ['sl-size','sl-wind-quality','sl-ride-quality'].forEach(id => { if(el(id)) el(id).value = 5; });
  ['sl-size-val','sl-wind-val','sl-ride-val'].forEach(id => { if(el(id)) el(id).textContent = '5'; });
  if (el('sl-size-desc')) el('sl-size-desc').textContent = getSizeDesc(5);
  if (el('sl-wind-desc')) el('sl-wind-desc').textContent = getWindDesc(5);
  if (el('sl-ride-desc')) el('sl-ride-desc').textContent = getRideDesc(5);
  if (el('sl-notes')) el('sl-notes').value = '';
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
    } else {
      const fallback = parseInt(slider.defaultValue, 10);
      slider.value = isFinite(fallback) ? fallback : 5;
      if (el(valId)) el(valId).textContent = slider.value;
      if (el(descId)) el(descId).textContent = '⚠ previously blank — fill in';
      wrapper?.classList.add('sl-needs-review');
      STATE.surfLogEditRepairCandidates.push(fieldName);
    }
  };
  setupRatingSlider('size', 'sl-size', 'sl-size-val', 'sl-size-desc', getSizeDesc);
  setupRatingSlider('windQuality', 'sl-wind-quality', 'sl-wind-val', 'sl-wind-desc', getWindDesc);
  setupRatingSlider('rideQuality', 'sl-ride-quality', 'sl-ride-val', 'sl-ride-desc', getRideDesc);

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
  const rows = [['id','date','size','windQuality','rideQuality','avg','notes','swellH','swellDir','swellPer','windSpd','windDir','tideH','tideStage']];
  STATE.surfLog.forEach(e => {
    const c = e.conditions||{}, s = c.swell||{}, w = c.wind||{}, t = c.tide||{};
    rows.push([e.id,e.timestamp,e.ratings.size,e.ratings.windQuality,e.ratings.rideQuality,
      ((e.ratings.size+e.ratings.windQuality+e.ratings.rideQuality)/3).toFixed(1),
      '"'+(e.notes||'').replace(/"/g,'""')+'"',
      s.height||'',s.direction||'',s.period||'',w.speed||'',w.direction||'',t.height||'',t.stage||'']);
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
    h += '<div class="sl-cond-group"><span class="sl-cond-group-title">Tide</span>'+c.tide.height+'ft '+c.tide.stage+' ('+c.tide.timeToNearest+'h to next)</div>';
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

// Wave features (target: ratings.size). period_x_alignment tests whether long
// period only matters when direction lets it through.
const WAVE_FEATURE_NAMES = [
  'swell_height','swell_period','swell_dir_alignment','swell_dir_outside_deg',
  'period_x_alignment',
  'sec_swell_height','sec_swell_period','sec_dir_in_window'
];

// Ride features (target: ratings.rideQuality). Tide enters here, not in wave —
// tide affects how the wave peels, not whether swell arrived.
const RIDE_FEATURE_NAMES = [
  'swell_dir_alignment','swell_dir_outside_deg','swell_period',
  'tide_height','time_to_low','low_incoming'
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

// Median wind speed across logged sessions — used to fill missing windSpd in
// the Conditions model. Refreshed at slRetrain start.
let _COND_WIND_MEDIAN = 0;

// Median tide height (ft, MLLW) used by extractRideFeatures.low_incoming.
// Refreshed at the start of slRetrain from logged-session tide heights so the
// "below median" threshold reflects the user's actual surf history.
let _TIDE_MEDIAN = 2.0;

// Chocomount swell window: 115°–158°, center 136.5°, half-width 21.5°.
function _windowGeometry() {
  const min = CONFIG.chocomount.swellWindowMin;
  const max = CONFIG.chocomount.swellWindowMax;
  return { min, max, center: (min + max) / 2, half: (max - min) / 2 };
}
// 1.0 at window center, 0.0 at edges and outside.
function _dirAlignment(dir, geo) { return Math.max(0, 1 - Math.abs(dir - geo.center) / geo.half); }
// Degrees beyond the nearer window edge; 0 if in-window, capped at 45°.
function _dirOutsideDeg(dir, geo) { return Math.min(45, Math.max(0, geo.min - dir, dir - geo.max)); }

function extractWaveFeatures(cond) {
  if (!cond?.swell) return null;
  const s = cond.swell;
  const sec = s.secondary || { height: 0, direction: 0, period: 0 };
  const geo = _windowGeometry();
  const dir = s.direction || 0;
  const period = s.period || 0;
  const dirAlignment = _dirAlignment(dir, geo);
  const dirOutside = _dirOutsideDeg(dir, geo);
  const secDir = sec.direction || 0;
  const secInWindow = (secDir >= geo.min && secDir <= geo.max) ? 1 : 0;
  return [
    s.height || 0, period,
    dirAlignment, dirOutside,
    period * dirAlignment,
    sec.height || 0, sec.period || 0,
    secInWindow
  ];
}

function extractRideFeatures(cond) {
  if (!cond?.swell) return null;
  const s = cond.swell;
  const t = cond.tide || { height: 0, stage: 'rising', timeToNearest: 0 };
  const geo = _windowGeometry();
  const dir = s.direction || 0;
  const dirAlignment = _dirAlignment(dir, geo);
  const dirOutside = _dirOutsideDeg(dir, geo);
  // Signed hours to low: rising → low just passed (negative); falling → low upcoming (positive).
  // Approximation: timeToNearest is to nearest H or L, so this conflates the two when
  // we're closer to a high than the bracketing lows — acceptable since we mostly surf near low.
  const timeToLow = t.stage === 'rising' ? -(t.timeToNearest || 0) : (t.timeToNearest || 0);
  const lowIncoming = ((t.height || 0) < _TIDE_MEDIAN && t.stage === 'rising') ? 1 : 0;
  return [
    dirAlignment, dirOutside, s.period || 0,
    t.height || 0, timeToLow, lowIncoming
  ];
}

function extractCondFeatures(cond) {
  const w = cond?.wind || {};
  // Median-fill missing windSpd so the one session in the dataset with both
  // wind fields blank still trains; cross-shore (0) for missing windDir.
  const haveSpd = w.speed != null && isFinite(w.speed);
  const haveDir = w.direction != null && isFinite(w.direction);
  return [
    haveSpd ? w.speed : _COND_WIND_MEDIAN,
    haveDir ? windOffshoreness(w.direction) : 0
  ];
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
  // Refresh tide median from logged tide heights so low_incoming reflects user's history.
  const tideHeights = entries.map(e => e.conditions?.tide?.height).filter(h => typeof h === 'number');
  if (tideHeights.length) {
    const sorted = [...tideHeights].sort((a,b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    _TIDE_MEDIAN = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  }
  // Refresh wind-speed median (Conditions model only) for missing-data fill.
  const windSpeeds = entries.map(e => e.conditions?.wind?.speed).filter(s => typeof s === 'number' && isFinite(s));
  if (windSpeeds.length) {
    const sortedW = [...windSpeeds].sort((a,b) => a - b);
    const mid = Math.floor(sortedW.length / 2);
    _COND_WIND_MEDIAN = sortedW.length % 2 ? sortedW[mid] : (sortedW[mid-1] + sortedW[mid]) / 2;
  } else {
    _COND_WIND_MEDIAN = 0;
  }
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
function _logSanityModel(label, target, featureNames, looOut) {
  console.groupCollapsed('[regression-sanity] ' + label);
  console.log('target          : ' + target);
  console.log('features        : ' + (featureNames || []).join(', '));
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
    _runLOOForSanity(entries, extractWaveFeatures, e => e.ratings.size));
  _logSanityModel('RIDE', 'rideQuality', RIDE_FEATURE_NAMES,
    _runLOOForSanity(entries, extractRideFeatures, e => e.ratings.rideQuality));
  _logSanityModel('COND', 'windQuality', COND_FEATURE_NAMES,
    _runLOOForSanity(entries, extractCondFeatures, e => e.ratings.windQuality));
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

function buildForecastConditions(marine, wind, tideHiLo, hi) {
  if (!marine?.hourly||!wind?.hourly) return null;
  const swH=marine.hourly.swell_wave_height?.[hi]??marine.hourly.wave_height?.[hi]??0;
  const swD=marine.hourly.swell_wave_direction?.[hi]??marine.hourly.wave_direction?.[hi]??0;
  const swP=marine.hourly.swell_wave_period?.[hi]??marine.hourly.wave_period?.[hi]??0;
  const secH=marine.hourly.secondary_swell_wave_height?.[hi]??0;
  const secD=marine.hourly.secondary_swell_wave_direction?.[hi]??0;
  const secP=marine.hourly.secondary_swell_wave_period?.[hi]??0;
  const wSpd=wind.hourly.wind_speed_10m?.[hi]??0, wDir=wind.hourly.wind_direction_10m?.[hi]??0;
  const tideInfo = tideHiLo ? parseTideAtTime({predictions:tideHiLo}, marine.hourly.time?.[hi]) : {height:0,stage:'rising',timeToNearest:0};
  return { swell:{height:swH,direction:swD,period:swP,secondary:secH>0.3?{height:secH,direction:secD,period:secP}:undefined},
    wind:{speed:wSpd,direction:wDir}, tide:tideInfo };
}

function findBestMatchPerDay(marine, wind, tideHiLo) {
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
      const fc=buildForecastConditions(marine,wind,tideHiLo,hi); if(!fc) return;
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
  const matches = findBestMatchPerDay(STATE._cachedMarine, STATE._cachedWind, STATE._cachedTideHiLo);
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
  const fc = buildForecastConditions(STATE._cachedMarine, STATE._cachedWind, STATE._cachedTideHiLo, hi);
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
    ce.innerHTML = [dl('Swell',c.swell.height+'ft '+c.swell.period+'s '+directionLabel(c.swell.direction)), dl('Wind',c.wind.speed+'mph '+directionLabel(c.wind.direction)), dl('Tide',c.tide.height+'ft '+c.tide.stage), fc?dl('Fcst Wind',Math.round(fc.wind.speed)+'mph '+directionLabel(fc.wind.direction)):''].join('');
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
  if (useScrub && hr && hr.time && hr.time[i]) {
    const t = new Date(hr.time[i]);
    const stamp = t.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    setFooter('footer-lineup', `Scrubbed to ${stamp} — primary swell, secondary swell, wind. Arrows converge on the lineup.`);
  } else {
    setFooter('footer-lineup', 'Live "now" — primary swell, secondary swell, wind. Arrows converge on the lineup.');
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

function renderRegressionTab() {
  const isChoc = STATE.isChocomount;
  const empty = el('panel-regression-empty');
  const summary = el('panel-regression-summary');
  const weights = el('panel-surflog-weights');
  const future = el('panel-tab2-future');
  if (!isChoc) {
    if (empty) empty.style.display = '';
    if (summary) summary.style.display = 'none';
    if (weights) weights.style.display = 'none';
    if (future) future.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (summary) summary.style.display = '';
  if (future) future.style.display = '';
  // Sample summary line
  const box = el('regression-sample-summary');
  if (box) {
    const n = STATE._lastFitN || 0;
    const range = STATE._lastFitDateRange;
    const fmt = ms => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const rangeText = range ? fmt(range.min) + ' → ' + fmt(range.max) : '—';
    const fitText = STATE._lastFitAt ? new Date(STATE._lastFitAt).toLocaleString() : 'not yet fit';
    box.innerHTML = '<div><strong>Sample size:</strong> ' + n + ' session' + (n === 1 ? '' : 's') + ' used in training</div>' +
      '<div><strong>Date range:</strong> ' + rangeText + '</div>' +
      '<div><strong>Last refitted:</strong> ' + fitText + '</div>';
  }
  // Weights panel (renderWeightsPanel toggles its own display).
  renderWeightsPanel();
}

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
