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
    forecastLat: 41.074783,
    forecastLon: -71.692795,
    buoyId: '44097',
    tideStation: '8510719',
    waterTempStation: '8510560',
    swellWindowMin: 115,
    swellWindowMax: 158,
    swellWindowEdge: 5,
    buoyLat: 40.969,
    buoyLon: -71.124,
    buoyDistanceMiles: 22
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
  activeTideMarker: null
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
  // Meteorological: "from" direction. Arrow points where wave/wind is going.
  return '↓';
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

    const color = '#5a7fa0'; // default blue, will be updated with live data
    const icon = buoy.home === 'chocomount'
      ? L.divIcon({ className: 'choc-marker', html: '⭐', iconSize: [24, 24], iconAnchor: [12, 12] })
      : L.divIcon({
          className: 'buoy-marker',
          html: '',
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        });

    // Style the buoy dot
    if (buoy.home !== 'chocomount') {
      icon.options.html = `<div style="width:12px;height:12px;border-radius:50%;background:${color};"></div>`;
    }

    const marker = L.marker([buoy.lat, buoy.lon], { icon })
      .addTo(STATE.buoyMap)
      .bindTooltip(`${buoy.name}<br>${buoy.id}`, { direction: 'top', offset: [0, -8] });

    marker.on('click', () => selectBuoy(buoy));

    if (buoy.home === 'chocomount') {
      STATE.chocMarker = marker;
    }
    STATE.buoyMarkers.push({ marker, buoy });
  });

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
    const spectral = await fetchNDBCSpectral(buoy.id);
    const parsed = parseNDBCSpectral(spectral);
    if (parsed) {
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
      el('panel-spectral-row').style.display = 'none';
    }
  } else {
    el('panel-spectral-row').style.display = 'none';
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
  el('val-swell-height').textContent = '···';
  el('val-wind-speed').textContent = '···';
  el('val-water-temp').textContent = '···';

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

  // No spectral for pin
  el('panel-spectral-row').style.display = 'none';

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

  // Prefer buoy data for current swell
  if (buoyParsed && buoyParsed.waveHeight != null) {
    const h = buoyParsed.waveHeight;
    const p = buoyParsed.dominantPeriod;
    const d = buoyParsed.meanDirection;
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
  // For Chocomount, attempt NWS first (handled async separately)
  // For now, use Open-Meteo wind
  if (wind && wind.current) {
    const s = wind.current.wind_speed_10m;
    const d = wind.current.wind_direction_10m;
    const g = wind.current.wind_gusts_10m;
    el('val-wind-speed').textContent = s != null ? `${Math.round(s)} mph` : '—';
    el('val-wind-detail').textContent = `${directionLabel(d)} · gusts ${g != null ? Math.round(g) : '—'} mph`;
    setFooter('footer-wind',
      `Open-Meteo Weather · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`,
      'https://open-meteo.com/en/docs',
      'open-meteo.com'
    );
  } else if (buoyParsed && buoyParsed.windSpeed != null) {
    el('val-wind-speed').textContent = `${Math.round(buoyParsed.windSpeed)} mph`;
    el('val-wind-detail').textContent = `${directionLabel(buoyParsed.windDir)} · gusts ${buoyParsed.windGust ? Math.round(buoyParsed.windGust) : '—'} mph`;
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
    el('val-daylight').textContent = '24 hrs';
    el('val-daylight-detail').textContent = 'Midnight sun';
  } else if (dl.alwaysNight) {
    el('val-daylight').textContent = '0 hrs';
    el('val-daylight-detail').textContent = 'Polar night';
  } else {
    const h = Math.floor(dl.daylightHours);
    const m = Math.round((dl.daylightHours - h) * 60);
    el('val-daylight').textContent = `${h}h ${m}m`;
    el('val-daylight-detail').textContent = `${formatTime(dl.firstLight)} → ${formatTime(dl.lastLight)}`;
  }
  setFooter('footer-daylight', `Astronomical calc · ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W`);
}

// ════════════════════════════════════════════════
// WINDY EMBEDS
// ════════════════════════════════════════════════

function updateWindyEmbeds(lat, lon) {
  const base = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricWind=mph&metricTemp=%C2%B0F&zoom=8';
  el('windy-wind').src = `${base}&overlay=wind&product=ecmwf&level=surface&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
  el('windy-swell').src = `${base}&overlay=swell&product=ecmwf&level=surface&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
  setFooter('footer-wind-map', 'Windy.com · ecmwf model', 'https://www.windy.com/', 'windy.com');
  setFooter('footer-swell-map', 'Windy.com · ecmwf model', 'https://www.windy.com/', 'windy.com');
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

function drawForecastChart(marine, wind, daylight, tideHiLo) {
  const canvas = el('forecast-canvas');
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

  const pad = { top: 30, right: 16, bottom: 32, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const times = marine.hourly.time.map(t => new Date(t));
  const heights = marine.hourly.wave_height || [];
  const swellHeights = marine.hourly.swell_wave_height || [];
  const swellDirs = marine.hourly.swell_wave_direction || [];
  const windSpeeds = wind && wind.hourly ? wind.hourly.wind_speed_10m || [] : [];
  const windDirs = wind && wind.hourly ? wind.hourly.wind_direction_10m || [] : [];

  const maxY = 20;
  const yStep = 2;

  const t0 = times[0].getTime();
  const tEnd = times[times.length - 1].getTime();
  const tRange = tEnd - t0;

  function xPos(time) { return pad.left + ((time.getTime() - t0) / tRange) * plotW; }
  function yPos(val) { return pad.top + plotH - (val / maxY) * plotH; }

  // ── Background ──
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── Nighttime shading ──
  if (daylight && !daylight.alwaysDay) {
    for (let dayOff = 0; dayOff < 8; dayOff++) {
      const dayDate = new Date(times[0]);
      dayDate.setDate(dayDate.getDate() + dayOff);
      const dl = calcDaylight(STATE.pinLat || CONFIG.chocomount.lat, STATE.pinLon || CONFIG.chocomount.lon, dayDate);
      if (dl && dl.sunset && dl.sunrise) {
        // Evening: sunset to midnight
        const sunsetX = xPos(dl.sunset);
        const midnightDate = new Date(dayDate);
        midnightDate.setDate(midnightDate.getDate() + 1);
        midnightDate.setHours(0, 0, 0, 0);
        const midnightX = xPos(midnightDate);
        if (sunsetX < pad.left + plotW && midnightX > pad.left) {
          ctx.fillStyle = 'rgba(44, 40, 37, 0.04)';
          ctx.fillRect(Math.max(sunsetX, pad.left), pad.top, Math.min(midnightX, pad.left + plotW) - Math.max(sunsetX, pad.left), plotH);
        }
        // Morning: midnight to sunrise
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
  for (let dayOff = 0; dayOff < 8; dayOff++) {
    const midDate = new Date(times[0]);
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
  ctx.beginPath();
  ctx.moveTo(xPos(times[0]), yPos(0));
  for (let i = 0; i < times.length; i++) {
    const h = heights[i] != null ? heights[i] : 0;
    ctx.lineTo(xPos(times[i]), yPos(Math.min(h, maxY)));
  }
  ctx.lineTo(xPos(times[times.length - 1]), yPos(0));
  ctx.closePath();

  if (STATE.isChocomount) {
    // Color segments by direction
    // For simplicity in Canvas, use a single gradient approximation
    // or paint segments. We'll paint hour-by-hour rectangles then overlay the line.
    ctx.save();
    ctx.clip();
    for (let i = 0; i < times.length - 1; i++) {
      const x1 = xPos(times[i]);
      const x2 = xPos(times[i + 1]);
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
  ctx.lineWidth = 1.5;
  let started = false;
  for (let i = 0; i < times.length; i++) {
    const h = heights[i];
    if (h == null) continue;
    const x = xPos(times[i]);
    const y = yPos(Math.min(h, maxY));
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── Low tide diamonds ──
  if (tideHiLo) {
    tideHiLo.forEach(p => {
      if (p.type !== 'L') return;
      const d = new Date(p.t);
      const xx = xPos(d);
      if (xx < pad.left || xx > pad.left + plotW) return;
      const yy = yPos(0) + 4;
      ctx.save();
      ctx.fillStyle = '#5a7fa0';
      ctx.translate(xx, yy);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    });
  }

  // ── Direction arrows at 6am each day ──
  for (let dayOff = 0; dayOff < 7; dayOff++) {
    const arrowDate = new Date(times[0]);
    arrowDate.setDate(arrowDate.getDate() + dayOff);
    arrowDate.setHours(6, 0, 0, 0);
    const xx = xPos(arrowDate);
    if (xx < pad.left || xx > pad.left + plotW) continue;

    // Find nearest hour index
    const targetT = arrowDate.getTime();
    let closest = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(times[i].getTime() - targetT);
      if (diff < closestDiff) { closestDiff = diff; closest = i; }
    }

    // Swell arrow
    const swDir = swellDirs[closest];
    if (swDir != null) {
      drawArrow(ctx, xx, pad.top + 12, swDir, 8, swellDirColor(swDir), 1.5);
    }

    // Wind arrow (smaller, above)
    const wDir = windDirs[closest];
    const wSpd = windSpeeds[closest];
    if (wDir != null) {
      drawArrow(ctx, xx + 14, pad.top + 12, wDir, 6, '#8a827a', 1);
      if (wSpd != null) {
        ctx.fillStyle = '#8a827a';
        ctx.font = '8px "DM Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(wSpd)}`, xx + 14, pad.top + 24);
      }
    }
  }

  // ── Y-axis labels ──
  ctx.fillStyle = '#8a827a';
  ctx.font = '10px "DM Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = 0; y <= maxY; y += yStep) {
    ctx.fillText(`${y}`, pad.left - 6, yPos(y));
  }

  // ── X-axis labels (at noon each day) ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let dayOff = 0; dayOff < 7; dayOff++) {
    const noonDate = new Date(times[0]);
    noonDate.setDate(noonDate.getDate() + dayOff);
    noonDate.setHours(12, 0, 0, 0);
    const xx = xPos(noonDate);
    if (xx > pad.left && xx < pad.left + plotW) {
      ctx.fillText(formatDay(noonDate), xx, pad.top + plotH + 8);
    }
  }

  // ── "ft" label ──
  ctx.save();
  ctx.fillStyle = '#b5afa8';
  ctx.font = '9px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.translate(12, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('ft', 0, 0);
  ctx.restore();
}

function drawArrow(ctx, x, y, dirDeg, size, color, lineW) {
  // dirDeg is "from" direction (meteorological). Arrow points in the "to" direction.
  const rad = degToRad((dirDeg + 180) % 360 - 90);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.lineTo(size, 0);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(size - 3, -2);
  ctx.lineTo(size - 3, 2);
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
