// ════════════════════════════════════════════════
// LetsCheckChoc — app.js
// Multi-buoy surf forecast dashboard
// ════════════════════════════════════════════════

'use strict';

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
    coops: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
    nws: 'https://api.weather.gov/points/',
    ndbcProxy: 'https://corsproxy.io/?',
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
  forecastChart: null   // cached chart state for tooltip
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

// Light wind threshold
function isLightWind(speedMph) { return speedMph != null && speedMph < 8; }

// ── Surf quality rating (1-5 scale) ─────────────
function calcSurfRating(waveHeightFt, periodSec, windSpeedMph, windDirDeg, swellDirDeg) {
  let score = 0;

  // Wave height contribution (0-2 points)
  if (waveHeightFt != null) {
    if (waveHeightFt >= 3 && waveHeightFt <= 8) score += 2;       // sweet spot
    else if (waveHeightFt >= 2 && waveHeightFt < 3) score += 1.5;
    else if (waveHeightFt > 8 && waveHeightFt <= 12) score += 1.5;
    else if (waveHeightFt >= 1) score += 0.5;
  }

  // Period contribution (0-1 point)
  if (periodSec != null) {
    if (periodSec >= 10) score += 1;
    else if (periodSec >= 7) score += 0.5;
  }

  // Wind contribution (0-1.5 points, based on speed only)
  if (windSpeedMph != null) {
    if (isLightWind(windSpeedMph)) score += 1.5;
    else if (windSpeedMph < 15) score += 1;
    else if (windSpeedMph < 25) score += 0.5;
  }

  // Swell direction bonus (0-0.5 points, Chocomount only)
  if (STATE.isChocomount && swellDirDeg != null) {
    const cls = swellDirClass(swellDirDeg);
    if (cls === 'dir-in') score += 0.5;
    else if (cls === 'dir-edge') score += 0.25;
  } else if (swellDirDeg != null) {
    score += 0.25; // generic small bonus for having direction data
  }

  // Clamp to 1-5
  return Math.max(1, Math.min(5, Math.round(score)));
}

function ratingLabel(score) {
  if (score >= 5) return { text: 'Epic', color: 'var(--green)' };
  if (score >= 4) return { text: 'Good', color: 'var(--green)' };
  if (score >= 3) return { text: 'Fair', color: 'var(--orange)' };
  if (score >= 2) return { text: 'Poor', color: 'var(--gray-c)' };
  return { text: 'Flat', color: 'var(--ink4)' };
}

// ── Natural language conditions summary ─────────
function buildConditionsSummary(waveH, periodSec, windSpeedMph, windDirDeg, swellDirDeg) {
  const parts = [];

  // Swell description
  if (waveH != null) {
    let sizeWord;
    if (waveH < 1) sizeWord = 'flat';
    else if (waveH < 2) sizeWord = 'ankle-to-knee high';
    else if (waveH < 3) sizeWord = 'waist high';
    else if (waveH < 4) sizeWord = 'chest high';
    else if (waveH < 6) sizeWord = 'overhead';
    else if (waveH < 8) sizeWord = 'well overhead';
    else if (waveH < 12) sizeWord = 'double overhead';
    else sizeWord = 'triple overhead+';

    const periodDesc = periodSec != null && periodSec >= 10 ? 'long-period' :
                       periodSec != null && periodSec >= 7 ? 'mid-period' : 'short-period';
    if (waveH < 1) {
      parts.push('Flat conditions');
    } else {
      parts.push(`${sizeWord} ${periodDesc} surf`);
    }
  }

  // Wind description (speed only, no direction quality)
  if (windSpeedMph != null) {
    if (isLightWind(windSpeedMph)) {
      parts.push('light winds');
    } else {
      const strength = windSpeedMph < 15 ? 'light' : windSpeedMph < 25 ? 'moderate' : 'strong';
      parts.push(`${strength} winds`);
    }
  }

  // Direction note for Chocomount
  if (STATE.isChocomount && swellDirDeg != null) {
    const cls = swellDirClass(swellDirDeg);
    if (cls === 'dir-in') parts.push('swell in the window');
    else if (cls === 'dir-edge') parts.push('swell on edge of window');
  }

  if (parts.length === 0) return '';

  // Capitalize first letter
  let text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

// ── Best window predictor ───────────────────────
function findBestWindow(marine, wind, tideHiLo) {
  if (!marine || !marine.hourly || !wind || !wind.hourly) return null;

  const times = marine.hourly.time;
  const heights = marine.hourly.wave_height || [];
  const periods = marine.hourly.wave_period || [];
  const swDirs = marine.hourly.swell_wave_direction || [];
  const windSpeeds = wind.hourly.wind_speed_10m || [];
  const windDirs = wind.hourly.wind_direction_10m || [];

  const now = Date.now();
  let bestScore = -1;
  let bestIdx = -1;

  for (let i = 0; i < Math.min(times.length, 168); i++) { // up to 7 days
    const t = new Date(times[i]).getTime();
    if (t < now) continue;

    const h = heights[i];
    const p = periods[i];
    const ws = windSpeeds[i];
    const wd = windDirs[i];
    const sd = swDirs[i];

    if (h == null || h < 1) continue;

    // Skip nighttime (6pm-5am is less useful)
    const hour = new Date(times[i]).getHours();
    if (hour < 5 || hour > 18) continue;

    const score = calcSurfRating(h, p, ws, wd, sd);

    // Tiebreak: prefer mornings and lower tides
    let tideBonus = 0;
    if (tideHiLo) {
      const twoHrs = 2 * 60 * 60 * 1000;
      const nearLow = tideHiLo.find(tp => tp.type === 'L' && Math.abs(new Date(tp.t).getTime() - t) < twoHrs);
      if (nearLow) tideBonus = 0.3;
    }
    const morningBonus = (hour >= 5 && hour <= 10) ? 0.2 : 0;
    const adjusted = score + tideBonus + morningBonus;

    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;

  const bestTime = new Date(times[bestIdx]);
  const dayName = bestTime.toLocaleDateString('en-US', { weekday: 'short' });
  const timeStr = bestTime.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
  const h = heights[bestIdx];

  return {
    label: `Best: ${dayName} ~${timeStr} (${h.toFixed(1)}ft)`,
    time: bestTime,
    score: bestScore
  };
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
  if (saved) {
    STATE.boatGatePassed = saved === 'no';
    el('gate-overlay').classList.add('hidden');
    el('app').classList.remove('hidden');
    initApp();
    return;
  }

  el('gate-yes').addEventListener('click', () => {
    sessionStorage.setItem('lcc-gate', 'yes');
    STATE.boatGatePassed = false;
    el('gate-overlay').classList.add('hidden');
    el('app').classList.remove('hidden');
    initApp();
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

// ── API: Open-Meteo Marine ───────────────────────
async function fetchMarineForecast(lat, lon) {
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
async function fetchTidePredictions(stationId, rangeDays = 3) {
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
  const url = CONFIG.api.ndbcProxy + encodeURIComponent(CONFIG.api.ndbcBase + buoyId + '.txt');
  return fetchText(url, 15000);
}

async function fetchNDBCSpectral(buoyId) {
  const base = CONFIG.api.ndbcBase + buoyId;
  const proxy = CONFIG.api.ndbcProxy;
  const [spec, dataSpec, swdir, swdir2, swr1, swr2] = await Promise.all([
    fetchText(proxy + encodeURIComponent(base + '.spec'), 15000),
    fetchText(proxy + encodeURIComponent(base + '.data_spec'), 15000),
    fetchText(proxy + encodeURIComponent(base + '.swdir'), 15000),
    fetchText(proxy + encodeURIComponent(base + '.swdir2'), 15000),
    fetchText(proxy + encodeURIComponent(base + '.swr1'), 15000),
    fetchText(proxy + encodeURIComponent(base + '.swr2'), 15000)
  ]);
  return { spec, dataSpec, swdir, swdir2, swr1, swr2 };
}

// ── API: NWS wind (Chocomount) ───────────────────
async function fetchNWSWind(lat, lon) {
  const meta = await fetchJSON(`${CONFIG.api.nws}${lat.toFixed(4)},${lon.toFixed(4)}`);
  if (!meta || !meta.properties || !meta.properties.forecastHourly) return null;
  return fetchJSON(meta.properties.forecastHourly);
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
function parseNDBCSpectral(spectralData) {
  if (!spectralData.dataSpec || !spectralData.swdir) return null;

  function parseSpectralFile(text) {
    if (!text) return null;
    const lines = text.trim().split('\n');
    if (lines.length < 3) return null;
    const freqLine = lines[0].trim().split(/\s+/).slice(5);
    const dataLine = lines[2].trim().split(/\s+/).slice(5);
    return {
      freqs: freqLine.map(Number),
      values: dataLine.map(Number)
    };
  }

  const energy = parseSpectralFile(spectralData.dataSpec);
  const dir1 = parseSpectralFile(spectralData.swdir);
  const dir2 = parseSpectralFile(spectralData.swdir2);
  const r1 = parseSpectralFile(spectralData.swr1);
  const r2 = parseSpectralFile(spectralData.swr2);

  if (!energy || !dir1) return null;

  const freqs = energy.freqs;
  const bins = freqs.map((f, i) => ({
    freq: f,
    period: f > 0 ? 1 / f : 0,
    energy: energy.values[i] || 0,
    dir1: dir1.values[i] || 0,
    dir2: dir2 ? dir2.values[i] || 0 : 0,
    r1: r1 ? r1.values[i] || 0 : 0.5,
    r2: r2 ? r2.values[i] || 0 : 0.25
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

  // Load all data
  loadAllData(buoy);
}

function selectPin(lat, lon) {
  STATE.selectedBuoy = null;
  STATE.isChocomount = false;
  STATE.pinLat = lat;
  STATE.pinLon = lon;

  el('header-location').textContent = `${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`;

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
  // Reset forecast chart to first page when loading new data
  _forecastDayOffset = 0;

  const lat = buoy.lat;
  const lon = buoy.lon;
  const isChoc = buoy.home === 'chocomount';
  const forecastLat = isChoc ? CONFIG.chocomount.forecastLat : lat;
  const forecastLon = isChoc ? CONFIG.chocomount.forecastLon : lon;
  const displayLat = isChoc ? CONFIG.chocomount.lat : lat;
  const displayLon = isChoc ? CONFIG.chocomount.lon : lon;

  // Show loading states
  el('val-swell-height').textContent = '···';
  el('val-wind-speed').textContent = '···';
  el('val-water-temp').textContent = '···';
  el('val-tide').textContent = '···';

  // Fetch all in parallel
  const [marine, wind, buoyData, pipelineData] = await Promise.all([
    fetchMarineForecast(forecastLat, forecastLon),
    fetchWindForecast(displayLat, displayLon),
    buoy.spectral ? fetchNDBCStdmet(buoy.id) : Promise.resolve(null),
    isChoc ? fetchPipelineBuoy() : Promise.resolve(null)
  ]);

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
  updateSwellCard(buoyParsed, marine, buoy);
  updateWindCard(wind, buoyParsed, isChoc, displayLat, displayLon);
  updateWaterTempCard(buoyParsed, marine, isChoc);
  updateDaylightCard(displayLat, displayLon);

  // ── Windy embeds ──
  updateWindyEmbeds(displayLat, displayLon);

  // ── Swell forecast chart ──
  if (marine && marine.hourly) {
    const daylight = calcDaylight(displayLat, displayLon, new Date());
    const tideStn = findNearestTideStation(displayLat, displayLon);
    STATE.nearestTideStation = tideStn;
    let tideHiLoForChart = null;
    if (tideStn) {
      const td = await fetchTideHiLo(tideStn.id, 10);
      tideHiLoForChart = td && td.predictions ? td.predictions : null;
    }

    // ── Tide condition card ──
    updateTideCard(tideHiLoForChart, tideStn);

    // ── Conditions summary + rating + best window ──
    const wH = buoyParsed ? buoyParsed.waveHeight : (marine.current ? marine.current.wave_height : null);
    const pS = buoyParsed ? buoyParsed.dominantPeriod : (marine.current ? marine.current.wave_period : null);
    const wS = wind && wind.current ? wind.current.wind_speed_10m : null;
    const wD = wind && wind.current ? wind.current.wind_direction_10m : null;
    const sD = buoyParsed ? buoyParsed.meanDirection : (marine.current ? marine.current.wave_direction : null);
    updateConditionsSummary(wH, pS, wS, wD, sD, marine, wind, tideHiLoForChart);

    drawForecastChart(marine, wind, daylight, tideHiLoForChart);
    const coordLabel = isChoc ? `${forecastLat}°N, ${Math.abs(forecastLon)}°W (open water)` : `${forecastLat.toFixed(3)}°N, ${Math.abs(forecastLon).toFixed(3)}°W`;
    setFooter('footer-forecast',
      `Open-Meteo Marine · gfs Wave 0.16° · ${coordLabel}`,
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
    try {
      const spectral = await fetchNDBCSpectral(buoy.id);
      const parsed = parseNDBCSpectral(spectral);
      if (parsed && parsed.bins && parsed.bins.length > 0) {
        showSpectralCharts();
        drawCompassRose(parsed);
        drawSpectrum(parsed);
        setFooter('footer-compass',
          `ndbc ${buoy.id} · ${buoy.name} · ${buoy.lat}°N, ${Math.abs(buoy.lon)}°W`,
          `https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}`,
          'ndbc station page'
        );
        setFooter('footer-spectrum',
          `ndbc ${buoy.id} spectral data`,
          `https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}`,
          'ndbc station page'
        );
      } else {
        console.warn('Spectral parse returned no bins for buoy', buoy.id);
        showSpectralEmpty(buoy.id);
      }
    } catch (err) {
      console.warn('Spectral fetch error for buoy', buoy.id, err);
      showSpectralEmpty(buoy.id);
    }
  } else {
    el('panel-spectral-row').style.display = '';
    showSpectralEmpty();
  }

  // ── Hourly table ──
  if (marine && marine.hourly && wind && wind.hourly) {
    buildHourlyTable(marine, wind, displayLat, displayLon);
    const coordLabel2 = isChoc ? `${forecastLat}°N, ${Math.abs(forecastLon)}°W` : `${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`;
    setFooter('footer-hourly',
      `Open-Meteo Marine + Weather · ${coordLabel2}`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }

  // ── Tide station map ──
  highlightNearestTideStation(displayLat, displayLon);

  // Update time
  el('header-update-time').textContent = `Updated ${formatTime(new Date())}`;
}

async function loadPinData(lat, lon) {
  _forecastPage = 0; // Reset to first page

  el('val-swell-height').textContent = '···';
  el('val-wind-speed').textContent = '···';
  el('val-water-temp').textContent = '···';
  el('val-tide').textContent = '···';

  const [marine, wind] = await Promise.all([
    fetchMarineForecast(lat, lon),
    fetchWindForecast(lat, lon)
  ]);

  // Current conditions from Open-Meteo only
  updateSwellCard(null, marine, null);
  updateWindCard(wind, null, false, lat, lon);
  updateWaterTempCard(null, marine, false);
  updateDaylightCard(lat, lon);

  updateWindyEmbeds(lat, lon);

  // Forecast chart
  if (marine && marine.hourly) {
    const daylight = calcDaylight(lat, lon, new Date());
    const tideStn = findNearestTideStation(lat, lon);
    STATE.nearestTideStation = tideStn;
    let tideHiLoForChart = null;
    if (tideStn) {
      const td = await fetchTideHiLo(tideStn.id, 10);
      tideHiLoForChart = td && td.predictions ? td.predictions : null;
    }

    // ── Tide condition card ──
    updateTideCard(tideHiLoForChart, tideStn);

    // ── Conditions summary + rating + best window ──
    const wH = marine.current ? marine.current.wave_height : null;
    const pS = marine.current ? marine.current.wave_period : null;
    const wS = wind && wind.current ? wind.current.wind_speed_10m : null;
    const wD = wind && wind.current ? wind.current.wind_direction_10m : null;
    const sD = marine.current ? marine.current.wave_direction : null;
    updateConditionsSummary(wH, pS, wS, wD, sD, marine, wind, tideHiLoForChart);

    drawForecastChart(marine, wind, daylight, tideHiLoForChart);
    setFooter('footer-forecast',
      `Open-Meteo Marine · gfs Wave 0.16° · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }

  // Tides
  if (STATE.nearestTideStation) {
    await loadTidesPanel(STATE.nearestTideStation);
    el('panel-tides').style.display = '';
  } else {
    el('panel-tides').style.display = 'none';
  }

  // No spectral for pin — show empty state
  el('panel-spectral-row').style.display = '';
  showSpectralEmpty();

  // Hourly table
  if (marine && marine.hourly && wind && wind.hourly) {
    buildHourlyTable(marine, wind, lat, lon);
    setFooter('footer-hourly',
      `Open-Meteo Marine + Weather · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`,
      'https://open-meteo.com/en/docs/marine-weather-api',
      'open-meteo.com'
    );
  }

  highlightNearestTideStation(lat, lon);
  el('header-update-time').textContent = `Updated ${formatTime(new Date())}`;
}

// ════════════════════════════════════════════════
// UPDATE CONDITION CARDS
// ════════════════════════════════════════════════

function updateSwellCard(buoyParsed, marine, buoy) {
  const isChoc = STATE.isChocomount;
  const card = el('card-swell');
  card.classList.remove('quality-good', 'quality-fair', 'quality-poor');

  // Prefer buoy data for current swell
  if (buoyParsed && buoyParsed.waveHeight != null) {
    const h = buoyParsed.waveHeight;
    const p = buoyParsed.dominantPeriod;
    const d = buoyParsed.meanDirection;
    // Add card border accent based on wave height
    if (h >= 3) card.classList.add('quality-good');
    else if (h >= 1.5) card.classList.add('quality-fair');
    else card.classList.add('quality-poor');
    el('val-swell-height').textContent = `${h.toFixed(1)} ft`;
    el('val-swell-height').className = `condition-value ${swellDirClass(d)}`;
    el('val-swell-detail').textContent = `${p ? p.toFixed(0) + 's' : '—'} · ${directionLabel(d)} (${d != null ? d + '°' : '—'})`;

    // Swell arrival estimator (Chocomount only)
    if (isChoc && p) {
      const arrival = swellArrivalTime(p, CONFIG.chocomount.buoyDistanceMiles);
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
    // Fallback to Open-Meteo current
    const c = marine.current;
    const h = c.wave_height;
    const p = c.wave_period;
    const d = c.wave_direction;
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
// CONDITIONS SUMMARY BANNER
// ════════════════════════════════════════════════

function updateConditionsSummary(waveH, periodSec, windSpeedMph, windDirDeg, swellDirDeg, marine, wind, tideHiLo) {
  const banner = el('conditions-summary');
  if (!banner) return;

  // Calculate rating
  const score = calcSurfRating(waveH, periodSec, windSpeedMph, windDirDeg, swellDirDeg);
  const rl = ratingLabel(score);

  // Build rating dots
  const ratingEl = el('summary-rating');
  let dotsHtml = '';
  for (let i = 1; i <= 5; i++) {
    let dotCls = 'dot';
    if (i <= score) {
      if (score >= 4) dotCls += ' filled';
      else if (score >= 3) dotCls += ' filled-fair';
      else dotCls += ' filled-poor';
    }
    dotsHtml += `<span class="${dotCls}"></span>`;
  }
  dotsHtml += `<span class="rating-label" style="color:${rl.color}">${rl.text}</span>`;
  ratingEl.innerHTML = dotsHtml;

  // Build summary text
  const summaryText = buildConditionsSummary(waveH, periodSec, windSpeedMph, windDirDeg, swellDirDeg);
  el('summary-text').textContent = summaryText;

  // Best window
  const best = findBestWindow(marine, wind, tideHiLo);
  el('summary-best').textContent = best ? best.label : '';

  banner.style.display = '';
}

// ════════════════════════════════════════════════
// ADVANCED DATA TOGGLE
// ════════════════════════════════════════════════

function initAdvancedToggle() {
  const btn = el('advanced-toggle-btn');
  const sections = el('advanced-sections');
  const icon = el('advanced-toggle-icon');
  if (!btn || !sections) return;

  // Restore preference
  const saved = localStorage.getItem('lcc-advanced');
  if (saved === 'open') {
    sections.classList.remove('collapsed');
    sections.classList.add('expanded');
    icon.classList.add('open');
  }

  btn.addEventListener('click', () => {
    const isOpen = sections.classList.contains('expanded');
    if (isOpen) {
      sections.classList.remove('expanded');
      sections.classList.add('collapsed');
      icon.classList.remove('open');
      localStorage.setItem('lcc-advanced', 'closed');
    } else {
      sections.classList.remove('collapsed');
      sections.classList.add('expanded');
      icon.classList.add('open');
      localStorage.setItem('lcc-advanced', 'open');
    }
  });
}

// ════════════════════════════════════════════════
// WINDY EMBEDS
// ════════════════════════════════════════════════

function updateWindyEmbeds(lat, lon) {
  const windBase = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricWind=mph&metricTemp=%C2%B0F&zoom=8';
  const wavesBase = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricWind=mph&metricTemp=%C2%B0F&zoom=6';
  el('windy-wind').src = `${windBase}&overlay=wind&product=ecmwf&level=surface&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
  el('windy-swell').src = `${wavesBase}&overlay=waves&product=ecmwf&level=surface&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
  setFooter('footer-wind-map', 'Windy.com · ecmwf model', 'https://www.windy.com/', 'windy.com');
  setFooter('footer-swell-map', 'Windy.com · ecmwf waves layer', 'https://www.windy.com/', 'windy.com');
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
// SWELL FORECAST CHART (Canvas 2D)
// ════════════════════════════════════════════════

// ── Forecast chart paging state ──
let _forecastDayOffset = 0; // day offset from first day (advances 1 day per click)
const FORECAST_DAYS_VISIBLE = 3;

function drawForecastChart(marine, wind, daylight, tideHiLo) {
  // Store raw data for paging
  STATE.forecastData = { marine, wind, daylight, tideHiLo };

  // Determine total days available
  const allTimes = marine.hourly.time.map(t => new Date(t));
  const firstDay = new Date(allTimes[0]); firstDay.setHours(0,0,0,0);
  const lastDay = new Date(allTimes[allTimes.length - 1]); lastDay.setHours(0,0,0,0);
  const totalDays = Math.round((lastDay - firstDay) / 86400000) + 1;
  const maxOffset = Math.max(0, totalDays - FORECAST_DAYS_VISIBLE);

  // Clamp offset
  if (_forecastDayOffset > maxOffset) _forecastDayOffset = maxOffset;
  if (_forecastDayOffset < 0) _forecastDayOffset = 0;

  // Update nav buttons
  const prevBtn = el('forecast-prev');
  const nextBtn = el('forecast-next');
  const navLabel = el('forecast-nav-label');
  if (prevBtn) prevBtn.disabled = _forecastDayOffset === 0;
  if (nextBtn) nextBtn.disabled = _forecastDayOffset >= maxOffset;

  // Calculate time window: 3 days starting from offset
  const pageStart = new Date(firstDay);
  pageStart.setDate(pageStart.getDate() + _forecastDayOffset);
  const pageEnd = new Date(pageStart);
  pageEnd.setDate(pageEnd.getDate() + FORECAST_DAYS_VISIBLE);

  // Update nav label
  if (navLabel) {
    const startLabel = pageStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const endDateMinusOne = new Date(pageEnd); endDateMinusOne.setDate(endDateMinusOne.getDate() - 1);
    const endLabel = endDateMinusOne.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    navLabel.textContent = `${startLabel} – ${endLabel}`;
  }

  _drawForecastChartPage(marine, wind, daylight, tideHiLo, pageStart, pageEnd);
}

function _drawForecastChartPage(marine, wind, daylight, tideHiLo, pageStart, pageEnd) {
  const canvas = el('forecast-canvas');
  const container = el('forecast-chart-container');
  const dpr = window.devicePixelRatio || 1;

  const W = container.clientWidth;
  const H = container.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Responsive padding: tighter on mobile for more plot area
  const isMobile = W < 600;
  const pad = isMobile
    ? { top: 24, right: 10, bottom: 44, left: 34 }
    : { top: 32, right: 16, bottom: 52, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const allTimes = marine.hourly.time.map(t => new Date(t));
  const heights = marine.hourly.wave_height || [];
  const swellDirs = marine.hourly.swell_wave_direction || [];
  const wavePeriods = marine.hourly.wave_period || [];
  const windSpeeds = wind && wind.hourly ? wind.hourly.wind_speed_10m || [] : [];
  const windDirs = wind && wind.hourly ? wind.hourly.wind_direction_10m || [] : [];
  const windGusts = wind && wind.hourly ? wind.hourly.wind_gusts_10m || [] : [];

  // Filter to page window
  const t0 = pageStart.getTime();
  const tEnd = pageEnd.getTime();
  const tRange = tEnd - t0;

  // Indices within page range (inclusive of start, exclusive of end)
  const pageIndices = [];
  for (let i = 0; i < allTimes.length; i++) {
    const tt = allTimes[i].getTime();
    if (tt >= t0 && tt < tEnd) pageIndices.push(i);
  }

  // Also keep one extra point on each side for smooth line drawing
  const firstPageIdx = pageIndices.length > 0 ? pageIndices[0] : 0;
  const lastPageIdx = pageIndices.length > 0 ? pageIndices[pageIndices.length - 1] : allTimes.length - 1;
  const extStart = Math.max(0, firstPageIdx - 1);
  const extEnd = Math.min(allTimes.length - 1, lastPageIdx + 1);

  const maxY = 20;
  const yStep = 2;

  function xPos(time) { return pad.left + ((time.getTime() - t0) / tRange) * plotW; }
  function yPos(val) { return pad.top + plotH - (val / maxY) * plotH; }

  // Helper: get wave height Y for a given time (interpolated)
  function getHeightAtTime(timeMs) {
    for (let i = 0; i < allTimes.length - 1; i++) {
      const t1 = allTimes[i].getTime();
      const t2 = allTimes[i + 1].getTime();
      if (timeMs >= t1 && timeMs <= t2) {
        const frac = (timeMs - t1) / (t2 - t1);
        const h1 = heights[i] != null ? heights[i] : 0;
        const h2 = heights[i + 1] != null ? heights[i + 1] : 0;
        return h1 + frac * (h2 - h1);
      }
    }
    return 0;
  }

  // ── Background ──
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── Nighttime shading ──
  if (daylight && !daylight.alwaysDay) {
    for (let dayOff = 0; dayOff < FORECAST_DAYS_VISIBLE + 1; dayOff++) {
      const dayDate = new Date(pageStart);
      dayDate.setDate(dayDate.getDate() + dayOff);
      const dl = calcDaylight(STATE.pinLat || CONFIG.chocomount.lat, STATE.pinLon || CONFIG.chocomount.lon, dayDate);
      if (dl && dl.sunset && dl.sunrise) {
        const sunsetX = xPos(dl.sunset);
        const midnightDate = new Date(dayDate);
        midnightDate.setDate(midnightDate.getDate() + 1);
        midnightDate.setHours(0, 0, 0, 0);
        const midnightX = xPos(midnightDate);
        if (sunsetX < pad.left + plotW && midnightX > pad.left) {
          ctx.fillStyle = 'rgba(44, 40, 37, 0.04)';
          ctx.fillRect(Math.max(sunsetX, pad.left), pad.top, Math.min(midnightX, pad.left + plotW) - Math.max(sunsetX, pad.left), plotH);
        }
        const morningStart = new Date(dayDate);
        morningStart.setHours(0, 0, 0, 0);
        const mStartX = xPos(morningStart);
        const sunriseX = xPos(dl.sunrise);
        if (mStartX < pad.left + plotW && sunriseX > pad.left) {
          ctx.fillStyle = 'rgba(44, 40, 37, 0.04)';
          ctx.fillRect(Math.max(mStartX, pad.left), pad.top, Math.min(sunriseX, pad.left + plotW) - Math.max(mStartX, pad.left), plotH);
        }
      }
    }
  }

  // ── Grid lines ──
  ctx.strokeStyle = '#eae6e0';
  ctx.lineWidth = 0.5;
  for (let y = 0; y <= maxY; y += yStep) {
    const yy = yPos(y);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(pad.left + plotW, yy);
    ctx.stroke();
  }

  // ── Day separators (at midnight) ──
  ctx.strokeStyle = '#e0dbd3';
  ctx.lineWidth = 0.5;
  for (let dayOff = 0; dayOff <= FORECAST_DAYS_VISIBLE; dayOff++) {
    const midDate = new Date(pageStart);
    midDate.setDate(midDate.getDate() + dayOff);
    midDate.setHours(0, 0, 0, 0);
    const xx = xPos(midDate);
    if (xx > pad.left && xx < pad.left + plotW) {
      ctx.beginPath();
      ctx.moveTo(xx, pad.top);
      ctx.lineTo(xx, pad.top + plotH);
      ctx.stroke();
    }
  }

  // ── Area fill (swell height) ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, 0, plotW, H); // clip to plot area
  ctx.clip();

  ctx.beginPath();
  ctx.moveTo(xPos(allTimes[extStart]), yPos(0));
  for (let i = extStart; i <= extEnd; i++) {
    const h = heights[i] != null ? heights[i] : 0;
    ctx.lineTo(xPos(allTimes[i]), yPos(Math.min(h, maxY)));
  }
  ctx.lineTo(xPos(allTimes[extEnd]), yPos(0));
  ctx.closePath();

  if (STATE.isChocomount) {
    ctx.save();
    ctx.clip();
    for (let i = extStart; i < extEnd; i++) {
      const x1 = xPos(allTimes[i]);
      const x2 = xPos(allTimes[i + 1]);
      const dir = swellDirs[i];
      ctx.fillStyle = swellDirColor(dir);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x1, pad.top, x2 - x1, plotH);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(90, 127, 160, 0.25)';
    ctx.fill();
  }

  // ── Swell height line ──
  ctx.beginPath();
  ctx.strokeStyle = STATE.isChocomount ? '#3a7d56' : '#5a7fa0';
  ctx.lineWidth = 2;
  let started = false;
  for (let i = extStart; i <= extEnd; i++) {
    const h = heights[i];
    if (h == null) continue;
    const x = xPos(allTimes[i]);
    const y = yPos(Math.min(h, maxY));
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.restore(); // remove clip

  // ── Low tide vertical drop lines (no labels — labels are below x-axis) ──
  if (tideHiLo) {
    tideHiLo.forEach(p => {
      if (p.type !== 'L') return;
      const d = new Date(p.t);
      const dMs = d.getTime();
      if (dMs < t0 || dMs >= tEnd) return;
      const xx = xPos(d);
      if (xx < pad.left || xx > pad.left + plotW) return;

      const waveH = getHeightAtTime(dMs);
      const lineTop = yPos(Math.min(waveH, maxY));
      const lineBottom = yPos(0);

      ctx.save();
      ctx.strokeStyle = 'rgba(90, 127, 160, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xx, lineTop);
      ctx.lineTo(xx, lineBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });
  }

  // ── Direction arrows at 6am each day ──
  const arrowSize = isMobile ? 10 : 14;
  const arrowLineW = isMobile ? 2 : 2.5;
  const windArrowSize = isMobile ? 7 : 10;
  const windArrowOffset = isMobile ? 18 : 24;
  const windFontSize = isMobile ? '8px' : '10px';
  const arrowY = pad.top + (isMobile ? 10 : 14);
  const windLabelY = pad.top + (isMobile ? 22 : 29);

  for (let dayOff = 0; dayOff < FORECAST_DAYS_VISIBLE; dayOff++) {
    const arrowDate = new Date(pageStart);
    arrowDate.setDate(arrowDate.getDate() + dayOff);
    arrowDate.setHours(6, 0, 0, 0);
    const xx = xPos(arrowDate);
    if (xx < pad.left || xx > pad.left + plotW) continue;

    const targetT = arrowDate.getTime();
    let closest = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < allTimes.length; i++) {
      const diff = Math.abs(allTimes[i].getTime() - targetT);
      if (diff < closestDiff) { closestDiff = diff; closest = i; }
    }

    // Swell arrow (colored by direction)
    const swDir = swellDirs[closest];
    if (swDir != null) {
      drawArrow(ctx, xx, arrowY, swDir, arrowSize, swellDirColor(swDir), arrowLineW);
    }

    // Wind arrow (offset right, dark for contrast)
    const wDir = windDirs[closest];
    const wSpd = windSpeeds[closest];
    if (wDir != null) {
      drawArrow(ctx, xx + windArrowOffset, arrowY, wDir, windArrowSize, '#4a443e', 2);
      if (wSpd != null) {
        ctx.fillStyle = '#4a443e';
        ctx.font = `${windFontSize} "DM Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(wSpd)}`, xx + windArrowOffset, windLabelY);
      }
    }
  }

  // ── Y-axis labels ──
  const axisFont = isMobile ? '9px' : '11px';
  ctx.fillStyle = '#8a827a';
  ctx.font = `${axisFont} "DM Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = 0; y <= maxY; y += yStep) {
    ctx.fillText(`${y}`, pad.left - (isMobile ? 4 : 6), yPos(y));
  }

  // ── X-axis labels (date + low tides below) ──
  const dayLabelFont = isMobile ? '9px' : '11px';
  const tideLabelFont = isMobile ? '8px' : '9px';
  const dayLabelY = pad.top + plotH + (isMobile ? 3 : 4);
  const tideLabelY = pad.top + plotH + (isMobile ? 14 : 18);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let dayOff = 0; dayOff < FORECAST_DAYS_VISIBLE; dayOff++) {
    const noonDate = new Date(pageStart);
    noonDate.setDate(noonDate.getDate() + dayOff);
    noonDate.setHours(12, 0, 0, 0);
    const xx = xPos(noonDate);
    if (xx <= pad.left || xx >= pad.left + plotW) continue;

    // Line 1: day label
    ctx.fillStyle = '#8a827a';
    ctx.font = `${dayLabelFont} "DM Mono", monospace`;
    ctx.fillText(formatDay(noonDate), xx, dayLabelY);

    // Line 2: low tide times for this day
    if (tideHiLo) {
      const dayStart = new Date(pageStart);
      dayStart.setDate(dayStart.getDate() + dayOff);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const lowTides = tideHiLo.filter(p => {
        if (p.type !== 'L') return false;
        const pt = new Date(p.t).getTime();
        return pt >= dayStart.getTime() && pt < dayEnd.getTime();
      });

      if (lowTides.length > 0) {
        const tideStr = lowTides.map(p => {
          const td = new Date(p.t);
          const hrs = td.getHours();
          const mins = td.getMinutes();
          const ampm = hrs >= 12 ? 'pm' : 'am';
          const h12 = hrs % 12 || 12;
          return mins === 0 ? `${h12}${ampm}` : `${h12}:${String(mins).padStart(2, '0')}${ampm}`;
        }).join(', ');

        ctx.fillStyle = '#5a7fa0';
        ctx.font = `${tideLabelFont} "DM Mono", monospace`;
        ctx.fillText(`Low ${tideStr}`, xx, tideLabelY);
      }
    }
  }

  // ── "ft" label ──
  ctx.save();
  ctx.fillStyle = '#b5afa8';
  ctx.font = `${isMobile ? '8px' : '10px'} "DM Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.translate(isMobile ? 8 : 12, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('ft', 0, 0);
  ctx.restore();

  // ── Store chart state for interaction ──
  STATE.forecastChart = {
    pad, plotW, plotH, W, H, t0, tEnd, tRange,
    times: allTimes, heights, wavePeriods, swellDirs, windSpeeds, windDirs, windGusts,
    tideHiLo, pageStart, pageEnd
  };
  setupForecastInteraction(canvas, container);
}

// ════════════════════════════════════════════════
// FORECAST CHART INTERACTION (click/tap to select + hover)
// ════════════════════════════════════════════════

let _forecastInteractionAbort = null;

function setupForecastInteraction(canvas, container) {
  if (_forecastInteractionAbort) _forecastInteractionAbort.abort();
  _forecastInteractionAbort = new AbortController();
  const signal = _forecastInteractionAbort.signal;

  const detailBar = el('forecast-detail-bar');

  // Create or reuse crosshair line element
  let crosshair = container.querySelector('.forecast-crosshair');
  if (!crosshair) {
    crosshair = document.createElement('div');
    crosshair.className = 'forecast-crosshair';
    container.appendChild(crosshair);
  }
  crosshair.style.display = 'none';

  function findNearestIndex(clientX) {
    const cs = STATE.forecastChart;
    if (!cs) return -1;

    const rect = canvas.getBoundingClientRect();
    const chartX = clientX - rect.left;
    const tFrac = (chartX - cs.pad.left) / cs.plotW;
    if (tFrac < 0 || tFrac > 1) return -1;

    const targetT = cs.t0 + tFrac * cs.tRange;

    // Find nearest hour within the visible page window
    let closest = -1;
    let closestDiff = Infinity;
    for (let i = 0; i < cs.times.length; i++) {
      const tt = cs.times[i].getTime();
      if (tt < cs.t0 || tt >= cs.tEnd) continue;
      const diff = Math.abs(tt - targetT);
      if (diff < closestDiff) { closestDiff = diff; closest = i; }
    }
    return closest;
  }

  function selectHour(idx) {
    const cs = STATE.forecastChart;
    if (!cs || idx < 0) { clearSelection(); return; }

    const t = cs.times[idx];
    const h = cs.heights[idx];
    const p = cs.wavePeriods[idx];
    const dir = cs.swellDirs[idx];
    const ws = cs.windSpeeds[idx];
    const wd = cs.windDirs[idx];
    const wg = cs.windGusts[idx];

    const dayName = t.toLocaleDateString('en-US', { weekday: 'short' });
    const timeStr = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Find nearby low tide (within 2 hours)
    let tideHtml = '';
    if (cs.tideHiLo) {
      const twoHrs = 2 * 60 * 60 * 1000;
      const nearby = cs.tideHiLo.find(p =>
        p.type === 'L' && Math.abs(new Date(p.t).getTime() - t.getTime()) < twoHrs
      );
      if (nearby) {
        const td = new Date(nearby.t);
        const tideTime = td.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        tideHtml = `<span class="detail-item"><span class="detail-tide">Low Tide ${tideTime}</span></span>`;
      }
    }

    if (detailBar) {
      detailBar.innerHTML =
        `<div class="detail-row">` +
        `<span class="detail-time">${dayName} ${timeStr}</span>` +
        `<span class="detail-item"><span class="detail-label">Wave</span> <span class="detail-val">${h != null ? h.toFixed(1) + ' ft' : '—'}</span></span>` +
        `<span class="detail-item"><span class="detail-label">Period</span> <span class="detail-val">${p != null ? p.toFixed(0) + 's' : '—'}</span></span>` +
        `<span class="detail-item"><span class="detail-label">Dir</span> <span class="detail-val">${directionLabel(dir)}${dir != null ? ' (' + Math.round(dir) + '°)' : ''}</span></span>` +
        `<span class="detail-item"><span class="detail-label">Wind</span> <span class="detail-val">${ws != null ? Math.round(ws) + ' mph ' + directionLabel(wd) : '—'}</span></span>` +
        `<span class="detail-item"><span class="detail-label">Gusts</span> <span class="detail-val">${wg != null ? Math.round(wg) + ' mph' : '—'}</span></span>` +
        tideHtml +
        `</div>`;
      detailBar.classList.add('active');
    }

    // Show crosshair
    const dataXPx = cs.pad.left + ((t.getTime() - cs.t0) / cs.tRange) * cs.plotW;
    crosshair.style.display = '';
    crosshair.style.left = dataXPx + 'px';
    crosshair.style.top = cs.pad.top + 'px';
    crosshair.style.height = cs.plotH + 'px';
  }

  function clearSelection() {
    crosshair.style.display = 'none';
    if (detailBar) detailBar.classList.remove('active');
  }

  // ── Mouse events (desktop: hover to preview, click to select) ──
  canvas.addEventListener('mousemove', function(e) {
    const idx = findNearestIndex(e.clientX);
    if (idx >= 0) {
      selectHour(idx);
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = '';
    }
  }, { signal });

  canvas.addEventListener('mouseleave', function() {
    clearSelection();
    canvas.style.cursor = '';
  }, { signal });

  // ── Touch events (mobile: tap/drag to select + swipe to page) ──
  let touching = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;
  let swipeHandled = false;
  const SWIPE_THRESHOLD = 60;
  const SWIPE_ANGLE_LIMIT = 35; // max degrees from horizontal

  canvas.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      touching = true;
      touchMoved = false;
      swipeHandled = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true, signal });

  canvas.addEventListener('touchmove', function(e) {
    if (!touching || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    touchMoved = true;

    // Determine if this is a horizontal swipe
    const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    const isHorizontal = (angle < SWIPE_ANGLE_LIMIT || angle > (180 - SWIPE_ANGLE_LIMIT));

    if (isHorizontal && Math.abs(dx) > SWIPE_THRESHOLD && !swipeHandled) {
      // Swipe detected — page the forecast
      swipeHandled = true;
      if (dx < 0) {
        // Swipe left → next page
        _forecastDayOffset++;
      } else {
        // Swipe right → prev page
        if (_forecastDayOffset > 0) _forecastDayOffset--;
      }
      if (STATE.forecastData) {
        const fd = STATE.forecastData;
        drawForecastChart(fd.marine, fd.wind, fd.daylight, fd.tideHiLo);
      }
    } else if (!swipeHandled && !isHorizontal) {
      // Vertical-ish drag — select hour
      e.preventDefault();
      const idx = findNearestIndex(t.clientX);
      selectHour(idx);
    }
  }, { passive: false, signal });

  canvas.addEventListener('touchend', function() {
    // If it was a quick tap (no swipe, minimal move), select hour at tap position
    if (touching && !touchMoved && !swipeHandled) {
      // Already handled in touchstart implicitly via no move
    }
    touching = false;
    // Keep selection visible on mobile after lifting finger
  }, { signal });

  canvas.addEventListener('touchcancel', function() {
    touching = false;
  }, { signal });
}

// ── Forecast nav button wiring (called once on init) ──
let _forecastNavWired = false;
function wireForecastNav() {
  if (_forecastNavWired) return;
  _forecastNavWired = true;

  el('forecast-prev').addEventListener('click', function() {
    if (_forecastDayOffset > 0) {
      _forecastDayOffset--;
      if (STATE.forecastData) {
        const d = STATE.forecastData;
        drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo);
      }
    }
  });

  el('forecast-next').addEventListener('click', function() {
    _forecastDayOffset++;
    if (STATE.forecastData) {
      const d = STATE.forecastData;
      drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo);
    }
  });
}

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

// ════════════════════════════════════════════════
// TIDE CHART (Canvas 2D)
// ════════════════════════════════════════════════

function drawTideChart(predictions) {
  const canvas = el('tide-canvas');
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = container.clientWidth;
  const H = container.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

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

function drawCompassRose(spectral) {
  const canvas = el('compass-canvas');
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(container.clientWidth, container.clientHeight);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 30;

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Compass circles
  ctx.strokeStyle = '#eae6e0';
  ctx.lineWidth = 0.5;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r / 4) * i, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Cardinal labels
  ctx.fillStyle = '#8a827a';
  ctx.font = '10px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - r - 12);
  ctx.fillText('S', cx, cy + r + 12);
  ctx.fillText('E', cx + r + 14, cy);
  ctx.fillText('W', cx - r - 14, cy);

  // Swell window lines (Chocomount only)
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
  }

  // Plot spectral energy by direction
  if (spectral && spectral.bins) {
    const maxEnergy = Math.max(...spectral.bins.map(b => b.energy));
    if (maxEnergy > 0) {
      spectral.bins.forEach(bin => {
        if (bin.energy <= 0 || bin.freq <= 0) return;
        const dir = bin.dir1;
        const mag = (bin.energy / maxEnergy) * r * 0.85;
        const rad = degToRad(dir - 90);
        const x = cx + Math.cos(rad) * mag;
        const y = cy + Math.sin(rad) * mag;
        const dotSize = Math.max(2, Math.min(6, bin.period / 4));

        ctx.fillStyle = swellDirColor(dir);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }
  }
}

// ════════════════════════════════════════════════
// WAVE ENERGY SPECTRUM (Canvas 2D)
// ════════════════════════════════════════════════

function drawSpectrum(spectral) {
  const canvas = el('spectrum-canvas');
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = container.clientWidth;
  const H = container.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { top: 12, right: 16, bottom: 36, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  if (!spectral || !spectral.bins || spectral.bins.length === 0) return;

  const bins = spectral.bins.filter(b => b.freq > 0.03 && b.freq < 0.5 && b.energy > 0);
  if (bins.length === 0) return;

  const maxE = Math.max(...bins.map(b => b.energy));

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Bars
  const barW = Math.max(2, plotW / bins.length - 1);
  bins.forEach((bin, i) => {
    const x = pad.left + (i / bins.length) * plotW;
    const h = (bin.energy / maxE) * plotH;
    const y = pad.top + plotH - h;

    ctx.fillStyle = swellDirColor(bin.dir1);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(x, y, barW, h);
    ctx.globalAlpha = 1;
  });

  // X-axis: period labels
  ctx.fillStyle = '#8a827a';
  ctx.font = '9px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelPeriods = [4, 6, 8, 10, 12, 14, 16, 18, 20];
  labelPeriods.forEach(p => {
    const f = 1 / p;
    const idx = bins.findIndex(b => b.freq >= f);
    if (idx >= 0) {
      const x = pad.left + (idx / bins.length) * plotW;
      ctx.fillText(`${p}s`, x, pad.top + plotH + 8);
    }
  });

  // X-axis title
  ctx.fillText('period', pad.left + plotW / 2, pad.top + plotH + 22);

  // Y-axis
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const eStep = maxE > 10 ? Math.ceil(maxE / 5) : maxE > 1 ? 1 : 0.5;
  for (let e = 0; e <= maxE; e += eStep) {
    const y = pad.top + plotH - (e / maxE) * plotH;
    ctx.fillText(e.toFixed(e < 1 ? 1 : 0), pad.left - 4, y);
    ctx.strokeStyle = '#eae6e0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  }
}

// ════════════════════════════════════════════════
// HOURLY TABLE
// ════════════════════════════════════════════════

function buildHourlyTable(marine, wind, lat, lon) {
  const tbody = el('hourly-tbody');
  tbody.innerHTML = '';

  const times = marine.hourly.time;
  const waveH = marine.hourly.wave_height || [];
  const waveP = marine.hourly.wave_period || [];
  const waveD = marine.hourly.wave_direction || [];
  const windS = wind.hourly.wind_speed_10m || [];
  const windG = wind.hourly.wind_gusts_10m || [];

  let lastDate = '';

  // Show 72 hours
  const maxHours = Math.min(times.length, 72);
  for (let i = 0; i < maxHours; i++) {
    const d = new Date(times[i]);
    const dayStr = formatDay(d);
    const daylight = calcDaylight(lat, lon, d);
    const hour = d.getHours();
    const night = isNighttime(hour, daylight);

    // Day separator
    if (dayStr !== lastDate) {
      lastDate = dayStr;
      const sepRow = document.createElement('tr');
      sepRow.className = 'day-separator';
      sepRow.innerHTML = `<td colspan="6">${dayStr}</td>`;
      tbody.appendChild(sepRow);
    }

    const row = document.createElement('tr');
    if (night) row.className = 'night-row';

    const h = waveH[i];
    const p = waveP[i];
    const dir = waveD[i];
    const ws = windS[i];
    const wg = windG[i];

    const dirCls = swellDirClass(dir);

    row.innerHTML = `
      <td>${formatTime(d)}</td>
      <td>${h != null ? h.toFixed(1) + ' ft' : '—'}</td>
      <td>${p != null ? p.toFixed(0) + 's' : '—'}</td>
      <td class="${dirCls}">${directionLabel(dir)} ${dir != null ? '(' + Math.round(dir) + '°)' : ''}</td>
      <td>${ws != null ? Math.round(ws) + ' mph' : '—'}</td>
      <td>${wg != null ? Math.round(wg) + ' mph' : '—'}</td>
    `;
    tbody.appendChild(row);
  }
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

  // Wire forecast chart navigation buttons
  wireForecastNav();

  // Wire advanced data toggle
  initAdvancedToggle();

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
