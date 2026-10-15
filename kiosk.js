// ════════════════════════════════════════════════════════════════════
// CHOC TV — iPad kiosk mode (?kiosk=1)
// ────────────────────────────────────────────────────────────────────
// The machinery Choc TV runs on; the screen itself is previews/clean/
// tv.js. Loaded as a classic script AFTER app.js, so every app function
// used here (loadAllData, selectBuoy, fetchJSON, calcDaylight, formatAgo,
// el, STATE, CONFIG) is already a global. Strict no-op unless the URL
// carries ?kiosk=1.
//
// It rotates the TV's panels (tv.js wraps kioskShowPanel,
// kioskScheduleNext and kioskPause by name, so they stay function
// declarations), pauses on a touch, refreshes the data every 15 minutes,
// holds a screen wake lock, and reloads itself (behind guards) when a
// deploy lands, nightly at 03:30, when boot stalls, or when the TV
// screen didn't start. kioskDaySummary feeds the TV's day cards through
// the look's CLEAN.data.week().
// ════════════════════════════════════════════════════════════════════
'use strict';

function isKioskMode() {
  if (typeof location === 'undefined' || !location.search) return false;
  try {
    return new URLSearchParams(location.search).get('kiosk') === '1';
  } catch (_) {
    return false;
  }
}

const KIOSK = {
  panels: ['cl-days1', 'cl-days2', 'cl-radar'],   // tv.js's panels
  idx: 0,
  rotateMs: 20 * 1000,      // panel dwell time (tv.js sets its own per panel)
  pauseMs: 60 * 1000,       // interaction pause before rotation resumes
  refreshMs: 15 * 60 * 1000, // data auto-refresh cadence
  radarStepMs: 1000,        // tv.js's radar playback step (?kioskRadarStep)
  state: 'rotating',        // 'rotating' | 'paused'
  rotateTimer: null,
  resumeTimer: null,
  wakeLock: null,
  nightlyHour: 3,           // nightly code/memory refresh, local time (03:30)
  nightlyMinute: 30,
  bootAt: 0,                // kioskInit time (self-heal clocks start here)
  nightlyAt: 0,             // next nightly reload attempt (epoch ms)
  watchdogNextTry: 0,       // next boot-watchdog probe (epoch ms)
  staticNextTry: 0,         // next static-catalog re-fetch (epoch ms)
  staticBusy: false,
  kickLoad: false,          // a catalog arrived late → reload the data once
  codeSig: null,            // signature of the code this page booted with
  codeBusy: false,
  reloadBusy: false,
  lastReloadAt: null,       // in-memory twin of the persisted reload stamp
  downNextTry: 0            // next reload attempt while the TV screen is down
};

// Debug overrides (seconds): ?kiosk=1&kioskRotate=2&kioskPause=3&kioskRefresh=5
function kioskReadOverrides() {
  try {
    const p = new URLSearchParams(location.search);
    const num = k => { const v = parseFloat(p.get(k)); return Number.isFinite(v) && v > 0 ? v * 1000 : null; };
    KIOSK.rotateMs = num('kioskRotate') || KIOSK.rotateMs;
    KIOSK.pauseMs = num('kioskPause') || KIOSK.pauseMs;
    KIOSK.refreshMs = num('kioskRefresh') || KIOSK.refreshMs;
    KIOSK.radarStepMs = num('kioskRadarStep') || KIOSK.radarStepMs;
  } catch (_) { /* keep defaults */ }
}

// ════════════════════════════════════════════════
// DAY SUMMARIES — the "instrument cluster" panels
// ════════════════════════════════════════════════

// Swell travel lag from the forecast point to Choc. The default forecast
// point is the fixed open-water spot at Montauk's latitude
// (CONFIG.chocomount.forecastLat/Lon, 41.089°N 71.721°W) → 1 h. When the
// "buoy coords" toggle moves the point out to 44097 (~50 mi) → 2 h.
function kioskSwellLagMs() {
  const useBuoy = typeof getForecastUseBuoyCoords === 'function' && getForecastUseBuoyCoords();
  return (useBuoy ? 2 : 1) * 3600 * 1000;
}

// Moon age from a known new moon (2000-01-06 18:14 UTC), synodic month
// 29.530589 d. Illuminated fraction = (1 − cos(2π·age/syn)) / 2.
function kioskMoonPhase(date) {
  const syn = 29.530588853 * 86400e3;
  const epoch = Date.UTC(2000, 0, 6, 18, 14);
  const age = ((date.getTime() - epoch) % syn + syn) % syn;
  const frac = age / syn;
  const pct = Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100);
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  return { pct, icon: icons[Math.round(frac * 8) % 8] };
}

// Nearest hourly index in an Open-Meteo hourly block for an epoch ms,
// or -1 when more than 90 min from any sample.
function kioskHourIndex(hourly, tMs) {
  if (!hourly || !hourly.time) return -1;
  let best = -1, bestD = 90 * 60 * 1000;
  for (let i = 0; i < hourly.time.length; i++) {
    const d = Math.abs(new Date(hourly.time[i]).getTime() - tMs);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function kioskWindAt(tMs) {
  const wh = STATE.forecastData && STATE.forecastData.wind && STATE.forecastData.wind.hourly;
  const i = kioskHourIndex(wh, tMs);
  if (i < 0) return null;
  const mph = (wh.wind_speed_10m || [])[i];
  const dir = (wh.wind_direction_10m || [])[i];
  return mph != null ? { mph, dir } : null;
}

// One day's instrument readings. Swell range = min–max hourly swell over
// the pooled incoming-tide windows (each low → next high at Silver Eel)
// clipped to daylight, sampled at (t − lag) from the forecast point.
// Period = ceil(mean) over the same samples; direction = circular mean.
function kioskDaySummary(dayOffset) {
  const fd = STATE.forecastData || {};
  const mh = fd.marine && fd.marine.hourly;
  const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + dayOffset);
  const dayEndMs = day.getTime() + 86400e3;
  const dl = calcDaylight(CONFIG.chocomount.lat, CONFIG.chocomount.lon, day) || {};
  const noon = new Date(day); noon.setHours(12, 0, 0, 0);

  // Tide events at Silver Eel (8510719), already fetched as hi/lo predictions.
  const events = (fd.tideHiLo || [])
    .map(p => ({ t: new Date(p.t).getTime(), type: p.type }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const lows = events.filter(p => p.type === 'L' && p.t >= day.getTime() && p.t < dayEndMs).slice(0, 2);
  const windows = lows.map(lo => {
    const nextHigh = events.find(p => p.type === 'H' && p.t > lo.t);
    return { start: lo.t, end: nextHigh ? nextHigh.t : lo.t + 6.2 * 3600e3 };
  });

  // Degrade gracefully when NOAA's tide predictions are down (it
  // happens): sample the whole daylight span instead of the
  // incoming-tide windows, and say so on the card, rather than
  // blanking every reading to NO SWELL DATA.
  const tidesDown = !windows.length;
  const sampleWindows = !tidesDown ? windows
    : (dl.sunrise && dl.sunset ? [{ start: dl.sunrise.getTime(), end: dl.sunset.getTime() }] : []);

  const lag = kioskSwellLagMs();
  // e = in-window energy, Σ alignment(dir)·H² (app.js _alignmentScore:
  // 1 inside 115–158°, fading to 0 over 30° outside).
  const pri = { hts: [], pers: [], x: 0, y: 0, n: 0, e: 0 };
  const sec = { hts: [], pers: [], x: 0, y: 0, n: 0, e: 0 };
  if (mh && dl.sunrise && dl.sunset) {
    for (const w of sampleWindows) {
      const a = Math.max(w.start, dl.sunrise.getTime());
      const b = Math.min(w.end, dl.sunset.getTime());
      for (let t = a; t <= b; t += 3600e3) {
        const i = kioskHourIndex(mh, t - lag);
        if (i < 0) continue;
        const h = (mh.swell_wave_height || mh.wave_height || [])[i];
        const p = (mh.swell_wave_period || mh.wave_period || [])[i];
        const d = (mh.swell_wave_direction || [])[i];
        if (h != null) { pri.hts.push(h); pri.e += _alignmentScore(d) * h * h; }
        if (p != null && Number.isFinite(p)) pri.pers.push(p);
        if (d != null) { pri.x += Math.cos(d * Math.PI / 180); pri.y += Math.sin(d * Math.PI / 180); pri.n++; }
        const sh = (mh.secondary_swell_wave_height || [])[i];
        const sp = (mh.secondary_swell_wave_period || [])[i];
        const sd = (mh.secondary_swell_wave_direction || [])[i];
        if (sh != null) { sec.hts.push(sh); sec.e += _alignmentScore(sd) * sh * sh; }
        if (sp != null && Number.isFinite(sp)) sec.pers.push(sp);
        if (sd != null) { sec.x += Math.cos(sd * Math.PI / 180); sec.y += Math.sin(sd * Math.PI / 180); sec.n++; }
      }
    }
  }

  const band = (s, minShow) => {
    if (!s.hts.length) return null;
    const max = Math.max(...s.hts);
    if (minShow != null && max < minShow) return null; // no real secondary → blank
    const min = Math.min(...s.hts);
    const dir = s.n ? (Math.atan2(s.y / s.n, s.x / s.n) * 180 / Math.PI + 360) % 360 : null;
    return {
      min: Math.round(min),
      max: Math.round(max),
      period: s.pers.length ? Math.ceil(s.pers.reduce((a, b) => a + b, 0) / s.pers.length) : null,
      dir,
      cls: swellDirClass(dir) // 'dir-in' | 'dir-edge' | 'dir-out' ('' off Choc)
    };
  };

  // Hero = the train that actually reaches the reef. Per the spec, when
  // the model's primary is out of the window and the secondary is in, the
  // secondary is the de facto primary at Choc. Decided once per DAY by
  // in-window energy, so the hero is always one real train, never an
  // hourly blend of two.
  let primary = band(pri, null);
  // Owner call: secondary shows whenever the model reports one, no
  // matter how small — only truly absent data leaves the slot empty.
  let secondary = band(sec, null);
  if (STATE.isChocomount && primary && secondary && sec.e > pri.e) {
    [primary, secondary] = [secondary, primary];
  }

  return {
    label: dayOffset === 0 ? 'TODAY'
      : dayOffset === 1 ? 'TOMORROW'
      : day.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase(),
    primary,
    secondary,
    tidesDown,
    lows: lows.map(lo => ({ t: lo.t, wind: kioskWindAt(lo.t) })),
    sun: {
      sunrise: dl.sunrise ? { t: dl.sunrise, wind: kioskWindAt(dl.sunrise.getTime()) } : null,
      noon: { t: noon, wind: kioskWindAt(noon.getTime()) },
      sunset: dl.sunset ? { t: dl.sunset, wind: kioskWindAt(dl.sunset.getTime()) } : null
    },
    moon: kioskMoonPhase(noon)
  };
}

// ════════════════════════════════════════════════
// COASTLINE (tv.js draws the radar's land from it)
// ════════════════════════════════════════════════

// COASTLINE — hand-traced from project/assets/lineup.jpg (1992×949).
// Points are normalized 0..1 [x, y] over that image frame, listed
// upcoast → downcoast; `lineup` is the arrows' convergence point
// (image center, matching the lineup-map overlay). Land is everything
// above/left of the shore polyline.
const KIOSK_COAST = {
  aspect: 1992 / 949,
  lineup: [0.5, 0.5],
  shore: [
    [0.216, 1.000], [0.199, 0.915], [0.201, 0.845], [0.216, 0.775],
    [0.238, 0.708], [0.259, 0.649], [0.281, 0.594], [0.306, 0.545],
    [0.336, 0.499], [0.367, 0.463], [0.399, 0.428], [0.433, 0.392],
    [0.468, 0.357], [0.503, 0.327], [0.541, 0.303], [0.577, 0.288],
    [0.612, 0.282], [0.647, 0.286], [0.678, 0.301], [0.700, 0.329],
    [0.719, 0.364], [0.741, 0.409], [0.766, 0.451], [0.796, 0.482],
    [0.833, 0.508], [0.874, 0.527], [0.919, 0.544], [0.963, 0.556],
    [1.000, 0.562]
  ],
  ponds: [[
    [0.667, 0.290], [0.673, 0.245], [0.690, 0.212], [0.712, 0.200],
    [0.733, 0.208], [0.744, 0.238], [0.749, 0.275], [0.757, 0.300],
    [0.752, 0.345], [0.735, 0.378], [0.712, 0.392], [0.692, 0.380],
    [0.678, 0.350], [0.669, 0.318]
  ]]
};

// ── Rotation and the Sources card ────────────────
// tv.js draws the panels and fills the Sources card; this runs the
// rotation under them. tv.js wraps kioskShowPanel, kioskScheduleNext and
// kioskPause by name, so they stay function declarations.

// The Sources card is open (tv.js adopts the overlay into its screen): no
// self-heal reload fires under a reader.
function kioskInfoOpen() {
  const ov = el('kiosk-info-overlay');
  return !!ov && ov.style.display !== 'none';
}

function kioskCloseInfo() {
  const ov = el('kiosk-info-overlay');
  if (ov) ov.style.display = 'none';
}

function kioskShowPanel(name) {
  document.body.dataset.kioskPanel = name;
  kioskCloseInfo(); // a stale card must not outlive its panel
}

function kioskAdvance() {
  KIOSK.idx = (KIOSK.idx + 1) % KIOSK.panels.length;
  kioskShowPanel(KIOSK.panels[KIOSK.idx]);
  kioskScheduleNext();
}

function kioskScheduleNext() {
  clearTimeout(KIOSK.rotateTimer);
  if (KIOSK.state !== 'rotating') return;
  KIOSK.rotateTimer = setTimeout(kioskAdvance, KIOSK.rotateMs);
}

// Any touch pauses the rotation, so a reader can look; a backstop resumes
// it, so an accidental tap can't freeze an unattended TV. tv.js wraps
// this: its Next skips without pausing, and on its radar a tap pauses and
// the next one plays on in place.
function kioskPause() {
  KIOSK.state = 'paused';
  clearTimeout(KIOSK.rotateTimer);
  clearTimeout(KIOSK.resumeTimer);
  KIOSK.resumeTimer = setTimeout(kioskResume, KIOSK.pauseMs);
}

// Resume where it left off: no panel change (tv.js's radar).
function kioskResumeInPlace() {
  KIOSK.state = 'rotating';
  clearTimeout(KIOSK.resumeTimer);
  kioskScheduleNext();
}

function kioskResume() {
  KIOSK.state = 'rotating';
  clearTimeout(KIOSK.resumeTimer);
  kioskAdvance(); // advancing immediately signals the resume
}

function kioskRefreshTick() {
  if (document.hidden) return;
  kioskCheckCode(); // a deploy landed? (reloads only behind the guards)
  if (typeof isDataLoadInFlight === 'function' && isDataLoadInFlight()) return;
  // loadAllData, not selectBuoy: its saved-copy path and the
  // load-generation guard handle everything else.
  if (STATE.selectedBuoy) loadAllData(STATE.selectedBuoy);
}

async function kioskAcquireWakeLock() {
  if (!('wakeLock' in navigator) || KIOSK.wakeLock) return;
  try {
    KIOSK.wakeLock = await navigator.wakeLock.request('screen');
    KIOSK.wakeLock.addEventListener('release', () => { KIOSK.wakeLock = null; });
  } catch (_) {
    // Best-effort: Guided Access + Auto-Lock "Never" is the reliable path.
    KIOSK.wakeLock = null;
  }
}

// ── Self-heal and code refresh ───────────────────
// Choc TV runs for weeks under Guided Access, out of reach of the reload
// button. Three things reload the page by themselves: a boot that never
// produced a load, a deploy that changed the code, and a nightly 03:30
// refresh. Every reload goes through kioskTryReload's guards.
const KIOSK_STATIC_FIRST_MS = 12 * 1000;   // after initApp's own 10 s attempt
const KIOSK_STATIC_RETRY_MS = 15 * 1000;
const KIOSK_BOOT_WATCHDOG_MS = 10 * 60 * 1000;
const KIOSK_RELOAD_MIN_GAP_MS = 30 * 60 * 1000;
const KIOSK_RELOAD_KEY = 'lcc-kiosk-last-reload';
const KIOSK_DOWN_FIRST_MS = 60 * 1000;      // the TV screen didn't start: first retry
const KIOSK_DOWN_RETRY_MS = 5 * 60 * 1000;  // then (the 30-min reload gap still applies)
// The files that make up Choc TV, the look's own included, so a fix to the
// TV screen reaches the iPad even when the running tv.js failed to start.
const KIOSK_CODE_FILES = ['index.html', 'app.js', 'kiosk.js',
  'previews/clean/theme.js', 'previews/clean/core.js', 'previews/clean/tv.js',
  'previews/clean/theme.css', 'previews/clean/base.css', 'previews/clean/tv.css'];

// initApp fetches the two static catalogs once, with no retry: a Wi-Fi
// blip during boot left Choc TV on "loading…" forever (no buoy list) or
// on NO TIDE DATA forever (no station list). Re-fetch whichever list is
// still empty; a station list that arrives late re-runs the data load.
function kioskEnsureStatic() {
  const needB = !STATE.buoys || !STATE.buoys.length;
  const needT = !STATE.tideStations || !STATE.tideStations.length;
  if ((!needB && !needT) || KIOSK.staticBusy) return;
  const now = Date.now();
  if (now < KIOSK.bootAt + KIOSK_STATIC_FIRST_MS || now < KIOSK.staticNextTry) return;
  KIOSK.staticBusy = true;
  KIOSK.staticNextTry = now + KIOSK_STATIC_RETRY_MS;
  Promise.all([
    needB ? fetchJSON('data/buoys-east-coast.json') : null,
    needT ? fetchJSON('data/tide-stations.json') : null
  ]).then(([b, t]) => {
    if (Array.isArray(b) && b.length && !(STATE.buoys && STATE.buoys.length)) STATE.buoys = b;
    if (Array.isArray(t) && t.length && !(STATE.tideStations && STATE.tideStations.length)) {
      STATE.tideStations = t;
      KIOSK.kickLoad = true;
    }
  }).finally(() => { KIOSK.staticBusy = false; });
}

// Kiosk boot watchdog: the normal boot selects Chocomount at the tail of
// initApp, AFTER the surf-log/Firebase await — on a flaky network that
// can stall for a long time. An always-on appliance can't wait for a
// backend it doesn't need: once the buoy list is in and nothing is
// selected, select Chocomount directly. If initApp's own selectBuoy
// fires later, the load-generation guard makes the duplicate harmless.
function kioskEnsureSelected() {
  kioskEnsureStatic();
  if (STATE.selectedBuoy || (STATE.pinLat != null && STATE.pinLon != null)) {
    // A catalog arrived after the last load started: load once more.
    if (KIOSK.kickLoad && STATE.selectedBuoy && !isDataLoadInFlight()) {
      KIOSK.kickLoad = false;
      loadAllData(STATE.selectedBuoy);
    }
    return;
  }
  if (!STATE.buoys || !STATE.buoys.length) return;
  const choc = STATE.buoys.find(b => b.home === 'chocomount');
  if (choc) {
    KIOSK.kickLoad = false; // this load already has every catalog in hand
    selectBuoy(choc);
  }
}

// Pure reload guard: never within 30 min of the last reload (no reload
// loop, even while CDN edges serve mixed versions), and never under a
// reader's hand (rotation paused or the SOURCES card open).
function kioskShouldReload({ now, lastReloadAt, paused, infoOpen }) {
  if (paused || infoOpen) return false;
  if (lastReloadAt == null || !Number.isFinite(lastReloadAt)) return true;
  const since = now - lastReloadAt;
  return since < 0 || since >= KIOSK_RELOAD_MIN_GAP_MS; // a stamp from the future is ignored
}

function kioskLastReloadAt() {
  let stored = 0;
  try { stored = Number(localStorage.getItem(KIOSK_RELOAD_KEY)) || 0; } catch (_) { /* private mode */ }
  return Math.max(stored, KIOSK.lastReloadAt || 0) || null;
}

// Is the site reachable right now? Without a service worker, reloading
// while offline would strand the appliance on Safari's error page, so a
// reload only follows a no-store fetch of the kiosk page itself.
async function kioskProbe() {
  if (navigator.onLine === false) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('./?kiosk=1&probe=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
    return r.ok && /kiosk\.js/.test(await r.text());
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// → 'reloaded' | 'blocked' (guards) | 'offline' (probe failed) | 'busy'
async function kioskTryReload(reason) {
  if (KIOSK.reloadBusy) return 'busy';
  const allowed = () => kioskShouldReload({
    now: Date.now(),
    lastReloadAt: kioskLastReloadAt(),
    paused: KIOSK.state === 'paused',
    infoOpen: kioskInfoOpen()
  });
  if (!allowed()) return 'blocked';
  KIOSK.reloadBusy = true;
  try {
    if (!(await kioskProbe())) return 'offline';
    if (!allowed()) return 'blocked'; // a touch landed during the probe
    KIOSK.lastReloadAt = Date.now();
    try { localStorage.setItem(KIOSK_RELOAD_KEY, String(KIOSK.lastReloadAt)); } catch (_) { /* private mode */ }
    console.info('Choc TV reloading:', reason);
    location.reload();
    return 'reloaded';
  } finally {
    KIOSK.reloadBusy = false;
  }
}

// Cheap content signature: 32-bit FNV-1a over the text, plus its length.
function kioskHashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + s.length.toString(36);
}

// Signature of the files that make up Choc TV; null if any fetch fails.
// The boot baseline reads with 'force-cache' (the bytes this page just
// ran, not a deploy that landed seconds after it loaded). Polls use
// 'no-cache', which revalidates with the server AND refreshes the HTTP
// cache, so the reload that follows a change runs the new files instead
// of a copy still fresh under Pages' max-age=600.
async function kioskCodeSig(cacheMode) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const texts = await Promise.all(KIOSK_CODE_FILES.map(async f => {
      // The page loads as ./?kiosk=1, never as index.html: sign the
      // document's own URL so the force-cache baseline is the copy it ran.
      const url = f === 'index.html' ? location.pathname + location.search : f;
      const r = await fetch(url, { cache: cacheMode, signal: ctl.signal });
      if (!r.ok) throw new Error(f + ' HTTP ' + r.status);
      return r.text();
    }));
    return kioskHashText(texts.join('\n'));
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Boot: take the baseline. Refresh ticks: reload when the deployed code
// differs. Pages' ETag / Last-Modified change on every 2-hourly data
// commit, so only the content can say whether the code changed.
async function kioskCheckCode() {
  if (KIOSK.codeBusy) return;
  KIOSK.codeBusy = true;
  try {
    if (!KIOSK.codeSig) {
      KIOSK.codeSig = await kioskCodeSig('force-cache');
      return;
    }
    const sig = await kioskCodeSig('no-cache');
    if (sig && sig !== KIOSK.codeSig) {
      await kioskTryReload(`code changed ${KIOSK.codeSig.slice(0, 7)} → ${sig.slice(0, 7)}`);
    }
  } finally {
    KIOSK.codeBusy = false;
  }
}

// Epoch ms of the next local hour:minute strictly after fromMs (DST-safe:
// the wall-clock time is set on the calendar day, not added as ms).
function kioskNextLocalTime(hour, minute, fromMs) {
  const d = new Date(fromMs);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= fromMs) {
    d.setDate(d.getDate() + 1);
    d.setHours(hour, minute, 0, 0);
  }
  return d.getTime();
}

// 1 Hz, from kioskStatusTick.
function kioskSelfHealTick() {
  if (!KIOSK.bootAt) return;
  const now = Date.now();
  // Boot watchdog: no load has completed in 10 min (a CDN script or a
  // catalog failed in a way the retries above can't mend) → start over,
  // once the site answers. Data AGE never triggers a reload: that would
  // wipe the in-memory forecast during an API outage.
  if (!STATE.lastLoadCompletedAt && now - KIOSK.bootAt >= KIOSK_BOOT_WATCHDOG_MS &&
      now >= KIOSK.watchdogNextTry) {
    KIOSK.watchdogNextTry = now + 60 * 1000;
    kioskTryReload('boot watchdog: no data load completed');
  }
  // Nightly: picks up any deploy the signature check missed and starts
  // each day from a clean page. Retried every 15 min until the guards and
  // the probe let it through.
  if (KIOSK.nightlyAt && now >= KIOSK.nightlyAt) {
    KIOSK.nightlyAt = now + 15 * 60 * 1000;
    kioskTryReload('nightly');
  }
  // The TV screen didn't start (index.html lccDown: the look's scripts
  // failed to load or to mount). Its card says so; try again a minute
  // later, then every 5 min, through the same guards, so a fixed deploy or
  // a network that came back brings the TV back without a hand.
  if (document.documentElement.classList.contains('lcc-down')) {
    if (!KIOSK.downNextTry) KIOSK.downNextTry = now + KIOSK_DOWN_FIRST_MS;
    else if (now >= KIOSK.downNextTry) {
      KIOSK.downNextTry = now + KIOSK_DOWN_RETRY_MS;
      kioskTryReload('the TV screen didn\'t start');
    }
  }
}

function kioskStatusTick() {
  // First, so a throw below can never starve the watchdog that exists to
  // mend exactly that.
  kioskSelfHealTick();
  kioskEnsureSelected();
}

// The Sources card's overlay: tv.js adopts it into its screen and fills it,
// and kioskInfoOpen() keeps reading it. A tap on it closes it.
function kioskBuildChrome() {
  const info = document.createElement('div');
  info.id = 'kiosk-info-overlay';
  info.style.display = 'none';
  info.innerHTML = '<div id="kiosk-info-card"></div>';
  document.body.appendChild(info);
  info.addEventListener('click', kioskCloseInfo);
}

function kioskInit() {
  KIOSK.bootAt = Date.now();
  // First nightly reload: the next 03:30 at least an hour after boot, so
  // a kiosk started at 03:00 isn't restarted half an hour later.
  KIOSK.nightlyAt = kioskNextLocalTime(KIOSK.nightlyHour, KIOSK.nightlyMinute, KIOSK.bootAt + 3600e3);
  kioskReadOverrides();
  kioskBuildChrome();
  kioskShowPanel(KIOSK.panels[KIOSK.idx]);
  kioskScheduleNext();

  // Any touch/click pauses rotation (capture so canvas handlers still run).
  document.addEventListener('pointerdown', kioskPause, { capture: true, passive: true });

  setInterval(kioskStatusTick, 1000);
  setInterval(kioskRefreshTick, KIOSK.refreshMs);
  kioskStatusTick();
  kioskAcquireWakeLock();
  kioskCheckCode(); // boot code signature (the baseline for deploy checks)

  // iOS throttles timers while locked/backgrounded: on return, re-grab the
  // wake lock and catch up if the data went stale.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    kioskAcquireWakeLock();
    const ts = STATE.lastLoadCompletedAt;
    if (!ts || Date.now() - ts > KIOSK.refreshMs) kioskRefreshTick();
  });
}

if (isKioskMode()) {
  // kioskInit after app.js's startApp (its listener registered first).
  document.addEventListener('DOMContentLoaded', kioskInit);
}
