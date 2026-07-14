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
  panels: ['days1', 'days2', 'forecast', 'spectral'],
  idx: 0,
  rotateMs: 20 * 1000,      // panel dwell time
  pauseMs: 60 * 1000,       // interaction pause before rotation resumes
  refreshMs: 15 * 60 * 1000, // data auto-refresh cadence
  state: 'rotating',        // 'rotating' | 'paused'
  rotateTimer: null,
  resumeTimer: null,
  wakeLock: null,
  lastDimCheck: 0,
  lastDaysRender: 0         // lastLoadCompletedAt value the day panels reflect
};

// ── "Night Passage" chart palette ────────────────
// The chart drawers read every color from FC_RETRO / ROSE_THEME (app.js),
// so re-theming the canvases for the kiosk is a palette swap — glow
// hierarchy per the design spec: blue = primary live data, green =
// legends/secondary, red = alerts (now-marker, pulse), dark smoked glass
// everywhere.
function kioskApplyNightPalette() {
  Object.assign(FC_RETRO, {
    plotBg:        '#0c1116',
    grid:          'rgba(93, 230, 154, 0.16)',
    ink:           '#5de69a',
    ink2:          'rgba(93, 230, 154, 0.55)',
    frame:         '#26323b',
    swellFill:     'rgba(56, 182, 255, 0.25)',
    swellStroke:   '#38b6ff',
    secSwellFill:  'rgba(56, 182, 255, 0.10)',
    period:        '#5de69a',
    periodHalo:    'rgba(12, 17, 22, 0.85)',
    dirPrimary:    '#38b6ff',
    dirSecondary:  '#38b6ff',
    windOn:        'rgba(255, 82, 82, 0.70)',
    windCross:     'rgba(216, 166, 54, 0.55)',
    windOff:       'rgba(61, 220, 132, 0.45)',
    windNull:      'rgba(120, 140, 150, 0.3)',
    windStroke:    'rgba(226, 240, 248, 0.45)',
    windBand:      'rgba(93, 230, 154, 0.07)',
    tide:          '#38b6ff',
    tideMarkFaint: 'rgba(56, 182, 255, 0.45)',
    tideMark:      'rgba(56, 182, 255, 0.95)',
    tideConn:      'rgba(56, 182, 255, 0.6)',
    scrubDot:      '#e8f6ff',
    nowLine:       'rgba(255, 82, 82, 0.65)',
    daySep:        'rgba(226, 240, 248, 0.10)',
    nightShade:    'rgba(0, 0, 0, 0.38)',
    pastDim:       'rgba(0, 0, 0, 0.30)',
    obsFill:       '#0c1116',
    obsStroke:     '#38b6ff',
    pulseCore:     '#ff5252',
    pulseRing:     '255, 82, 82'
  });
  Object.assign(ROSE_THEME, {
    bg:       '#0c1116',
    ring:     'rgba(93, 230, 154, 0.28)',
    cardinal: '#5de69a',
    window:   '#5de69a',
    hs:       '#38b6ff',
    hsSub:    'rgba(93, 230, 154, 0.6)'
  });
}

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

  const lag = kioskSwellLagMs();
  const pri = { hts: [], pers: [], x: 0, y: 0, n: 0 };
  const sec = { hts: [], pers: [], x: 0, y: 0, n: 0 };
  if (mh && dl.sunrise && dl.sunset) {
    for (const w of windows) {
      const a = Math.max(w.start, dl.sunrise.getTime());
      const b = Math.min(w.end, dl.sunset.getTime());
      for (let t = a; t <= b; t += 3600e3) {
        const i = kioskHourIndex(mh, t - lag);
        if (i < 0) continue;
        const h = (mh.swell_wave_height || mh.wave_height || [])[i];
        const p = (mh.swell_wave_period || mh.wave_period || [])[i];
        const d = (mh.swell_wave_direction || [])[i];
        if (h != null) pri.hts.push(h);
        if (p != null && Number.isFinite(p)) pri.pers.push(p);
        if (d != null) { pri.x += Math.cos(d * Math.PI / 180); pri.y += Math.sin(d * Math.PI / 180); pri.n++; }
        const sh = (mh.secondary_swell_wave_height || [])[i];
        const sp = (mh.secondary_swell_wave_period || [])[i];
        const sd = (mh.secondary_swell_wave_direction || [])[i];
        if (sh != null) sec.hts.push(sh);
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
    return {
      min: Math.round(min),
      max: Math.round(max),
      period: s.pers.length ? Math.ceil(s.pers.reduce((a, b) => a + b, 0) / s.pers.length) : null,
      dir: s.n ? (Math.atan2(s.y / s.n, s.x / s.n) * 180 / Math.PI + 360) % 360 : null
    };
  };

  return {
    label: dayOffset === 0 ? 'TODAY'
      : dayOffset === 1 ? 'TOMORROW'
      : day.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase(),
    primary: band(pri, null),
    secondary: band(sec, 1.0),
    lows: lows.map(lo => ({ t: lo.t, wind: kioskWindAt(lo.t) })),
    sun: {
      sunrise: dl.sunrise ? { t: dl.sunrise, wind: kioskWindAt(dl.sunrise.getTime()) } : null,
      noon: { t: noon, wind: kioskWindAt(noon.getTime()) },
      sunset: dl.sunset ? { t: dl.sunset, wind: kioskWindAt(dl.sunset.getTime()) } : null
    },
    moon: kioskMoonPhase(noon)
  };
}

// ── Day panel rendering ──────────────────────────

function kioskFmtClock(t) {
  const d = t instanceof Date ? t : new Date(t);
  const h = d.getHours() % 12 || 12;
  return { seg: `${h}:${String(d.getMinutes()).padStart(2, '0')}`, ampm: d.getHours() >= 12 ? 'PM' : 'AM' };
}

// Directional arrow: FROM label, arrow points where it's going (travel),
// matching drawArrow and every arrow in the sketch. Yellow per the spec.
function kioskArrowHTML(fromDeg) {
  if (fromDeg == null) return '';
  const travel = Math.round((fromDeg + 180) % 360);
  return `<span class="np-arrow" style="transform:rotate(${travel}deg)">↑</span>`;
}

// noGhost: ghost segments read as mud at small sizes — only the big
// readouts carry them.
function kioskSegHTML(text, extraClass, noGhost) {
  if (noGhost) return `<span class="np-seg ${extraClass || ''}">${text}</span>`;
  const ghost = String(text).replace(/[0-9]/g, '8');
  return `<span class="np-seg ${extraClass || ''}" data-ghost="${ghost}">${text}</span>`;
}

// "↘ 11 MPH NW" — arrow, seven-seg speed, unit, FROM label. One shape
// everywhere wind appears so the reading is always parsed the same way.
function kioskWindHTML(wind) {
  if (!wind) return '<span class="np-legend np-dim">NO DATA</span>';
  return `<span class="np-windline">` +
    kioskArrowHTML(wind.dir) +
    kioskSegHTML(Math.round(wind.mph), 'np-seg-sm', true) +
    `<span class="np-unit-sm">MPH</span>` +
    `<span class="np-legend">${wind.dir != null ? directionLabel(wind.dir) : ''}</span>` +
    `</span>`;
}

// Sketch layout: height range huge with "@ period" stacked beneath it on
// its own line; direction arrow + FROM label as a right-hand column.
function kioskSwellRowHTML(sw, cls) {
  if (!sw) return '';
  const range = sw.min === sw.max ? String(sw.max) : `${sw.min}-${sw.max}`;
  const primary = cls === 'np-primary';
  const dirLabel = sw.dir != null ? `${directionLabel(sw.dir)} ${Math.round(sw.dir)}°` : '';
  return `<div class="np-swell ${cls}">` +
    `<div class="np-swell-nums">` +
      `<div class="np-micro">${primary ? 'SWELL' : 'SECONDARY'}</div>` +
      `<div class="np-swell-ht">${kioskSegHTML(range, primary ? 'np-seg-lg' : 'np-seg-md2')}<span class="np-unit">FT</span></div>` +
      (sw.period != null
        ? `<div class="np-swell-per"><span class="np-at">@</span>${kioskSegHTML(sw.period, primary ? 'np-seg-md' : 'np-seg-sm', !primary)}<span class="np-unit">S</span></div>`
        : '') +
    `</div>` +
    `<div class="np-swell-dir">${kioskArrowHTML(sw.dir)}<span class="np-legend">${dirLabel}</span></div>` +
    `</div>`;
}

function kioskDayCardHTML(s) {
  const lowsHTML = s.lows.length
    ? s.lows.map(lo => {
        const c = kioskFmtClock(lo.t);
        return `<div class="np-module np-low">` +
          `<div class="np-low-when"><span class="np-legend">LOW @</span> ` +
            kioskSegHTML(c.seg, 'np-seg-md') + `<span class="np-unit">${c.ampm}</span></div>` +
          `<div class="np-low-wind">${kioskWindHTML(lo.wind)}</div>` +
          `</div>`;
      }).join('')
    : '<div class="np-module np-low"><span class="np-legend np-dim">NO LOW TIDE</span></div>';

  const sunCell = (key, label) => {
    const e = s.sun[key];
    if (!e) return `<div class="np-sun-cell"><span class="np-legend np-dim">${label} —</span></div>`;
    const c = kioskFmtClock(e.t);
    return `<div class="np-sun-cell">` +
      `<span class="np-legend">${label}</span>` +
      `<div class="np-sun-time">${kioskSegHTML(c.seg, 'np-seg-sm', true)}<span class="np-unit-sm">${c.ampm}</span></div>` +
      `<div class="np-sun-wind">${kioskWindHTML(e.wind)}</div>` +
      `</div>`;
  };

  return `<div class="np-day">` +
    `<div class="np-day-title">${s.label}</div>` +
    (s.primary
      ? kioskSwellRowHTML(s.primary, 'np-primary') + kioskSwellRowHTML(s.secondary, 'np-secondary')
      : '<div class="np-swell np-primary"><span class="np-legend np-dim">NO SWELL DATA</span></div>') +
    lowsHTML +
    `<div class="np-sunrow">${sunCell('sunrise', 'SUNRISE')}${sunCell('noon', 'NOON')}${sunCell('sunset', 'SUNSET')}</div>` +
    `<div class="np-moonrow"><span class="np-moon-icon">${s.moon.icon}</span><span class="np-legend">${s.moon.pct}% FULL</span></div>` +
    `</div>`;
}

function kioskRenderDays() {
  const p1 = el('kiosk-days-1');
  const p2 = el('kiosk-days-2');
  if (!p1 || !p2) return;
  try {
    p1.innerHTML = [0, 1, 2].map(o => kioskDayCardHTML(kioskDaySummary(o))).join('');
    p2.innerHTML = [3, 4, 5].map(o => kioskDayCardHTML(kioskDaySummary(o))).join('');
    KIOSK.lastDaysRender = STATE.lastLoadCompletedAt || 0;
  } catch (err) {
    console.warn('kiosk day render failed:', err);
  }
}

function kioskShowPanel(name) {
  document.body.dataset.kioskPanel = name;
  if (name === 'days1' || name === 'days2') kioskRenderDays();
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
    // days panels are plain DOM — rendered by kioskShowPanel.
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
// every further touch re-arms the resume window. Touches on the NEXT
// button are exempt — advancing shouldn't also freeze the rotation.
function kioskPause(ev) {
  if (ev && ev.target && ev.target.closest && ev.target.closest('#kiosk-next')) return;
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
    const c = kioskFmtClock(now);
    // Only digits get the seven-segment face; letters render as legends.
    clock.innerHTML =
      `<span class="np-clock-txt">${formatDayShort(now).toUpperCase()}</span> ` +
      `${c.seg} <span class="np-clock-txt">${c.ampm}</span>`;
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
  // Fresh data while a day panel is up → re-render its readings.
  if (STATE.lastLoadCompletedAt && STATE.lastLoadCompletedAt !== KIOSK.lastDaysRender) {
    kioskRenderDays();
  }
  if (Date.now() - KIOSK.lastDimCheck > 60 * 1000) {
    KIOSK.lastDimCheck = Date.now();
    kioskUpdateNightDim();
  }
}

// Builds the kiosk-only DOM (day panels, status strip, night-dim overlay,
// paused cue, NEXT button) so index.html carries no kiosk markup.
function kioskBuildChrome() {
  const app = el('app') || document.body;
  const days1 = document.createElement('div');
  days1.id = 'kiosk-days-1';
  days1.className = 'np-days';
  const days2 = document.createElement('div');
  days2.id = 'kiosk-days-2';
  days2.className = 'np-days';
  app.appendChild(days1);
  app.appendChild(days2);

  const dim = document.createElement('div');
  dim.id = 'kiosk-dim';
  document.body.appendChild(dim);

  const strip = document.createElement('div');
  strip.id = 'kiosk-status';
  strip.innerHTML =
    '<span id="kiosk-pilot" title="power"></span>' +
    '<span id="kiosk-status-buoy">CHOC TV</span>' +
    '<span id="kiosk-status-updated">loading…</span>' +
    '<span id="kiosk-paused" style="display:none">⏸ PAUSED — RESUMES SHORTLY</span>' +
    '<span class="kiosk-status-spacer"></span>' +
    '<button type="button" id="kiosk-next">NEXT ▸</button>' +
    '<span id="kiosk-status-clock"></span>';
  document.body.appendChild(strip);

  // NEXT skips straight to the following panel without pausing rotation.
  el('kiosk-next').addEventListener('click', () => {
    if (KIOSK.state === 'paused') kioskResume();
    else kioskAdvance();
  });
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
  // Night Passage: swap the canvas palettes before any chart ever draws.
  kioskApplyNightPalette();
  // This script sits at the end of <body>, so body exists at parse time:
  // flag it immediately so kiosk CSS applies before first paint.
  document.body.classList.add('kiosk');
  document.body.dataset.kioskPanel = 'days1';
  // kioskInit after app.js's initGate (its listener registered first).
  document.addEventListener('DOMContentLoaded', kioskInit);
}
