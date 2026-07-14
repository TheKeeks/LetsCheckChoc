// ════════════════════════════════════════════════════════════════════
// CHOC TV — iPad kiosk mode (?kiosk=1)
// ────────────────────────────────────────────────────────────────────
// Loaded as a classic script AFTER app.js, so every app function used
// here (loadAllData, calcDaylight, formatAgo, resetScrubberToNow,
// invalidateCanvasDPR, drawForecastChart, drawCompassRose, el, STATE,
// CONFIG) is already a global. Strict no-op unless the URL carries
// ?kiosk=1. Never loaded by the Node test harnesses.
//
// Behavior: skips the boat gate, boots straight into Chocomount (the
// existing initGate 'no' branch does both once sessionStorage is
// seeded), rotates three full-screen panels, auto-refreshes data every
// 15 minutes, holds a screen wake lock, and dims after sunset.
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
  panels: ['conditions', 'forecast', 'spectral'],
  idx: 0,
  rotateMs: 20 * 1000,      // panel dwell time
  pauseMs: 60 * 1000,       // interaction pause before rotation resumes
  refreshMs: 15 * 60 * 1000, // data auto-refresh cadence
  state: 'rotating',        // 'rotating' | 'paused'
  rotateTimer: null,
  resumeTimer: null,
  wakeLock: null,
  lastDimCheck: 0
};

// Debug overrides (seconds): ?kiosk=1&kioskRotate=2&kioskPause=3&kioskRefresh=5
function kioskReadOverrides() {
  try {
    const p = new URLSearchParams(location.search);
    const num = k => { const v = parseFloat(p.get(k)); return Number.isFinite(v) && v > 0 ? v * 1000 : null; };
    KIOSK.rotateMs = num('kioskRotate') || KIOSK.rotateMs;
    KIOSK.pauseMs = num('kioskPause') || KIOSK.pauseMs;
    KIOSK.refreshMs = num('kioskRefresh') || KIOSK.refreshMs;
  } catch (_) { /* keep defaults */ }
}

function kioskShowPanel(name) {
  document.body.dataset.kioskPanel = name;
  // Redraw after the browser has laid out the newly-visible container —
  // canvases drawn while display:none cache 0-width dims.
  requestAnimationFrame(() => kioskRedrawPanel(name));
}

function kioskRedrawPanel(name) {
  try {
    if (name === 'forecast' && STATE.forecastData && STATE.forecastData.marine) {
      invalidateCanvasDPR(el('forecast-canvas-swell'));
      invalidateCanvasDPR(el('forecast-canvas-wind'));
      invalidateCanvasDPR(el('forecast-canvas-tide'));
      const d = STATE.forecastData;
      drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo, d.tidePred, d.buoyParsed);
      resetScrubberToNow();
    } else if (name === 'spectral' && STATE.lastSpectral) {
      invalidateCanvasDPR(el('compass-canvas'));
      drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed);
    }
    // 'conditions' is plain DOM — nothing to redraw.
  } catch (err) {
    console.warn('kiosk redraw failed:', err);
  }
}

function kioskAdvance() {
  KIOSK.idx = (KIOSK.idx + 1) % KIOSK.panels.length;
  kioskShowPanel(KIOSK.panels[KIOSK.idx]);
  kioskScheduleNext();
}

function kioskScheduleNext() {
  clearTimeout(KIOSK.rotateTimer);
  if (KIOSK.state === 'rotating') {
    KIOSK.rotateTimer = setTimeout(kioskAdvance, KIOSK.rotateMs);
  }
}

// Any touch pauses rotation so the scrubber / rose hover can be used;
// every further touch re-arms the resume window.
function kioskPause() {
  KIOSK.state = 'paused';
  clearTimeout(KIOSK.rotateTimer);
  const cue = el('kiosk-paused');
  if (cue) cue.style.display = '';
  clearTimeout(KIOSK.resumeTimer);
  KIOSK.resumeTimer = setTimeout(kioskResume, KIOSK.pauseMs);
}

function kioskResume() {
  KIOSK.state = 'rotating';
  const cue = el('kiosk-paused');
  if (cue) cue.style.display = 'none';
  kioskAdvance(); // advancing immediately signals the resume
}

function kioskRefreshTick() {
  if (document.hidden) return;
  if (typeof isDataLoadInFlight === 'function' && isDataLoadInFlight()) return;
  // loadAllData, not selectBuoy — no map/header churn, and its SWR cache
  // path + the load-generation guard handle everything else.
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

function kioskUpdateNightDim() {
  try {
    const dl = calcDaylight(CONFIG.chocomount.lat, CONFIG.chocomount.lon, new Date());
    const now = Date.now();
    const night = !!(dl && (dl.alwaysNight ||
      (!dl.alwaysDay && dl.sunrise && dl.sunset &&
        (now < dl.sunrise.getTime() || now > dl.sunset.getTime()))));
    document.body.classList.toggle('kiosk-night', night);
  } catch (_) { /* leave current dim state */ }
}

// Kiosk boot watchdog: the normal boot selects Chocomount at the tail of
// initApp, AFTER the surf-log/Firebase await — on a flaky network that
// can stall for a long time. An always-on appliance can't wait for a
// backend it doesn't need: once the buoy list is in and nothing is
// selected, select Chocomount directly. If initApp's own selectBuoy
// fires later, the load-generation guard makes the duplicate harmless.
function kioskEnsureSelected() {
  if (STATE.selectedBuoy || (STATE.pinLat != null && STATE.pinLon != null)) return;
  if (!STATE.buoys || !STATE.buoys.length) return;
  const choc = STATE.buoys.find(b => b.home === 'chocomount');
  if (choc) selectBuoy(choc);
}

function kioskStatusTick() {
  kioskEnsureSelected();
  const clock = el('kiosk-status-clock');
  if (clock) {
    const now = new Date();
    clock.textContent = `${formatDayShort(now)} ${formatTime(now)}`;
  }
  const buoyEl = el('kiosk-status-buoy');
  if (buoyEl && STATE.selectedBuoy) {
    const b = STATE.selectedBuoy;
    buoyEl.textContent = b.home === 'chocomount' ? `Choc · ndbc ${b.id}` : `${b.name} · ndbc ${b.id}`;
  }
  const upd = el('kiosk-status-updated');
  if (upd) {
    upd.textContent = STATE.lastLoadCompletedAt
      ? `updated ${formatAgo(new Date(STATE.lastLoadCompletedAt))}`
      : 'loading…';
  }
  if (Date.now() - KIOSK.lastDimCheck > 60 * 1000) {
    KIOSK.lastDimCheck = Date.now();
    kioskUpdateNightDim();
  }
}

// Builds the kiosk-only DOM (status strip, night-dim overlay, paused cue)
// so index.html carries no kiosk markup.
function kioskBuildChrome() {
  const dim = document.createElement('div');
  dim.id = 'kiosk-dim';
  document.body.appendChild(dim);

  const strip = document.createElement('div');
  strip.id = 'kiosk-status';
  strip.innerHTML =
    '<span id="kiosk-status-buoy">Choc TV</span>' +
    '<span id="kiosk-status-updated">loading…</span>' +
    '<span id="kiosk-paused" style="display:none">⏸ PAUSED — resumes shortly</span>' +
    '<span class="kiosk-status-spacer"></span>' +
    '<span id="kiosk-status-clock"></span>';
  document.body.appendChild(strip);
}

function kioskInit() {
  kioskReadOverrides();
  kioskBuildChrome();
  kioskShowPanel(KIOSK.panels[KIOSK.idx]);
  kioskScheduleNext();

  // Any touch/click pauses rotation (capture so canvas handlers still run).
  document.addEventListener('pointerdown', kioskPause, { capture: true, passive: true });

  setInterval(kioskStatusTick, 1000);
  setInterval(kioskRefreshTick, KIOSK.refreshMs);
  kioskStatusTick();
  kioskUpdateNightDim();
  kioskAcquireWakeLock();

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
  // Seed the gate answer BEFORE DOMContentLoaded: app.js's initGate then
  // takes its existing 'no' branch — gate hidden, app shown, Chocomount
  // auto-selected — with zero app.js boot changes.
  try { sessionStorage.setItem('lcc-gate', 'no'); } catch (_) { /* private mode */ }
  // This script sits at the end of <body>, so body exists at parse time:
  // flag it immediately so kiosk CSS applies before first paint.
  document.body.classList.add('kiosk');
  document.body.dataset.kioskPanel = 'conditions';
  // kioskInit after app.js's initGate (its listener registered first).
  document.addEventListener('DOMContentLoaded', kioskInit);
}
