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
// seeded), rotates four full-screen panels (day summaries ×2, radar
// loop with the swell chart, spectra), auto-refreshes data every
// 15 minutes, and holds a screen wake lock.
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
  panels: ['days1', 'days2', 'radar', 'spectral'],
  idx: 0,
  rotateMs: 20 * 1000,      // panel dwell time
  pauseMs: 60 * 1000,       // interaction pause before rotation resumes
  refreshMs: 15 * 60 * 1000, // data auto-refresh cadence
  radarStepMs: 1000,        // radar playback: 1 second = 1 forecast hour
  radarTimer: null,
  state: 'rotating',        // 'rotating' | 'paused'
  rotateTimer: null,
  resumeTimer: null,
  wakeLock: null,
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
    plotBg:        '#020604',
    grid:          'rgba(69, 255, 154, 0.14)',
    ink:           '#45ff9a',
    ink2:          'rgba(69, 255, 154, 0.55)',
    frame:         '#143526',
    swellFill:     'rgba(69, 255, 154, 0.16)',
    swellStroke:   '#45ff9a',
    secSwellFill:  'rgba(69, 255, 154, 0.07)',
    period:        '#b9ffd9',
    periodHalo:    'rgba(0, 0, 0, 0.85)',
    dirPrimary:    '#45ff9a',
    dirSecondary:  '#45ff9a',
    windOn:        'rgba(255, 82, 82, 0.70)',
    windCross:     'rgba(216, 166, 54, 0.50)',
    windOff:       'rgba(69, 255, 154, 0.35)',
    windNull:      'rgba(120, 150, 130, 0.3)',
    windStroke:    'rgba(230, 255, 240, 0.40)',
    windBand:      'rgba(69, 255, 154, 0.06)',
    tide:          '#45ff9a',
    tideMarkFaint: 'rgba(69, 255, 154, 0.45)',
    tideMark:      'rgba(69, 255, 154, 0.95)',
    tideConn:      'rgba(69, 255, 154, 0.6)',
    scrubDot:      '#eafff2',
    nowLine:       'rgba(255, 82, 82, 0.65)',
    daySep:        'rgba(230, 255, 240, 0.09)',
    nightShade:    'rgba(0, 0, 0, 0.38)',
    pastDim:       'rgba(0, 0, 0, 0.30)',
    obsFill:       '#020604',
    obsStroke:     '#45ff9a',
    pulseCore:     '#ff5252',
    pulseRing:     '255, 82, 82'
  });
  Object.assign(ROSE_THEME, {
    bg:       '#020604',
    ring:     'rgba(69, 255, 154, 0.25)',
    cardinal: '#45ff9a',
    window:   '#45ff9a',
    hs:       '#45ff9a',
    hsSub:    'rgba(69, 255, 154, 0.6)'
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
    // Owner call: secondary shows whenever the model reports one, no
    // matter how small — only truly absent data leaves the slot empty.
    secondary: band(sec, null),
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

// The arrow, per the sketch: a big filled glyph rotated to the TRAVEL
// direction (FROM label semantics preserved in the printed text), with
// the reading printed ON the arrow. The SVG rotates; the overlay text
// stays upright.
function kioskArrowHTML(fromDeg, overlayHTML, cls) {
  if (fromDeg == null) return '';
  const travel = Math.round((fromDeg + 180) % 360);
  return `<span class="np-bigarrow ${cls || ''}">` +
    `<svg viewBox="0 0 100 140" style="transform:rotate(${travel}deg)" aria-hidden="true">` +
      `<path d="M50 2 L98 62 L74 62 L74 138 L26 138 L26 62 L2 62 Z"/>` +
    `</svg>` +
    (overlayHTML ? `<span class="np-arrow-overlay">${overlayHTML}</span>` : '') +
    `</span>`;
}

// Crisp 14-segment readout — no ghost segments, no bloom.
function kioskSegHTML(text, extraClass, _noGhost) {
  return `<span class="np-seg ${extraClass || ''}">${text}</span>`;
}

// Wind on the day cards: a heading dial (owner's pick) — compass ring
// with a rim pointer at the travel direction; the reading never
// rotates. Swell keeps the big filled arrows; the radar keeps its
// vector arrows.
function kioskDialHTML(fromDeg, numHTML, capHTML) {
  const travel = fromDeg != null ? Math.round((fromDeg + 180) % 360) : null;
  let ticks = '';
  for (let a = 0; a < 360; a += 30) {
    ticks += `<line transform="rotate(${a} 50 50)" x1="50" y1="6" x2="50" y2="11"/>`;
  }
  return `<span class="np-dial">` +
    `<svg viewBox="0 0 100 100" aria-hidden="true">` +
      `<circle cx="50" cy="50" r="44" class="np-dial-ring"/>` +
      `<g class="np-dial-ticks">${ticks}</g>` +
      (travel != null
        ? `<path class="np-dial-ptr" transform="rotate(${travel} 50 50)" d="M50 1 L57 16 L43 16 Z"/>`
        : '') +
    `</svg>` +
    `<span class="np-dial-overlay">` +
      `<span class="np-dial-num">${numHTML}</span>` +
      `<span class="np-dial-cap">${capHTML}</span>` +
    `</span>` +
    `</span>`;
}

function kioskWindHTML(wind) {
  if (!wind) return '<span class="np-legend np-dim">NO DATA</span>';
  const cap = 'mph' + (wind.dir != null ? ' ' + directionLabel(wind.dir) : '');
  return `<span class="np-windline">` +
    kioskDialHTML(wind.dir, Math.round(wind.mph), cap) +
    `</span>`;
}

// One inline phrase — "3-5 FT @ 13 S" — with the direction arrow
// (reading printed on it) riding to the right as the co-hero.
function kioskSwellRowHTML(sw, cls) {
  if (!sw) return '';
  const range = sw.min === sw.max ? String(sw.max) : `${sw.min}-${sw.max}`;
  const primary = cls === 'np-primary';
  return `<div class="np-swell ${cls}">` +
    `<div class="np-swell-line">` +
      kioskSegHTML(range, primary ? 'np-seg-lg' : 'np-seg-md') +
      `<span class="np-unit">FT</span>` +
      (sw.period != null
        ? `<span class="np-at">@</span>${kioskSegHTML(sw.period, primary ? 'np-seg-md' : 'np-seg-sm')}<span class="np-unit np-unit-tight">s</span>`
        : '') +
    `</div>` +
    `<div class="np-swell-dir">${kioskArrowHTML(sw.dir,
      sw.dir != null
        ? `<span class="np-ao-num">${directionLabel(sw.dir)}</span><span class="np-ao-cap">${Math.round(sw.dir)}°</span>`
        : '')}</div>` +
    `</div>`;
}

function kioskDayCardHTML(s) {
  // Every card renders the SAME fixed slots (primary, secondary, low 1,
  // low 2, sun row, moon) so corresponding readings sit at identical
  // heights across the three cards; missing readings leave a quiet gap.
  const lowSlot = lo => {
    if (!lo) return '<div class="np-low np-slot-empty"></div>';
    const c = kioskFmtClock(lo.t);
    return `<div class="np-low">` +
      `<div class="np-low-when"><span class="np-legend">LOW @</span> ` +
        kioskSegHTML(c.seg, 'np-seg-md') + `<span class="np-unit">${c.ampm}</span></div>` +
      `<div class="np-low-wind">${kioskWindHTML(lo.wind)}</div>` +
      `</div>`;
  };
  const lowsHTML = lowSlot(s.lows[0]) + lowSlot(s.lows[1]);

  const sunCell = (key, label) => {
    const e = s.sun[key];
    if (!e) return `<div class="np-sun-cell"><span class="np-legend np-dim">${label} —</span></div>`;
    const c = kioskFmtClock(e.t);
    return `<div class="np-sun-cell">` +
      `<span class="np-legend">${label}</span>` +
      `<div class="np-sun-time">${kioskSegHTML(c.seg, 'np-seg-sm')}<span class="np-unit-sm">${c.ampm}</span></div>` +
      `<div class="np-sun-wind">${kioskWindHTML(e.wind)}</div>` +
      `</div>`;
  };

  const secondaryHTML = s.secondary
    ? kioskSwellRowHTML(s.secondary, 'np-secondary')
    : '<div class="np-swell np-secondary np-slot-empty"></div>';

  return `<div class="np-day">` +
    `<div class="np-day-title">${s.label}</div>` +
    (s.primary
      ? kioskSwellRowHTML(s.primary, 'np-primary')
      : '<div class="np-swell np-primary"><span class="np-legend np-dim">NO SWELL DATA</span></div>') +
    secondaryHTML +
    lowsHTML +
    `<div class="np-sunrow">${sunCell('sunrise', 'SUNRISE')}${sunCell('noon', 'NOON')}${sunCell('sunset', 'SUNSET')}</div>` +
    `<div class="np-moonrow"><span class="np-moon-icon">${s.moon.icon}</span><span class="np-legend">${s.moon.pct}% FULL</span></div>` +
    `</div>`;
}

// Digit size is UNIFORM across a panel's three cards (like real LED
// gear) but steps down when the widest range string that panel must
// show wouldn't fit the card ("12-15" needs smaller segments than "5").
function kioskSizeTier(summaries) {
  const len = Math.max(...summaries.map(s => {
    if (!s.primary) return 1;
    const r = s.primary.min === s.primary.max
      ? String(s.primary.max)
      : `${s.primary.min}-${s.primary.max}`;
    return r.length;
  }));
  return len <= 2 ? '' : len <= 4 ? 'np-t1' : 'np-t2';
}

function kioskRenderDays() {
  const p1 = el('kiosk-days-1');
  const p2 = el('kiosk-days-2');
  if (!p1 || !p2) return;
  try {
    const s1 = [0, 1, 2].map(kioskDaySummary);
    const s2 = [3, 4, 5].map(kioskDaySummary);
    p1.className = ('np-days ' + kioskSizeTier(s1)).trim();
    p2.className = ('np-days ' + kioskSizeTier(s2)).trim();
    p1.innerHTML = s1.map(kioskDayCardHTML).join('');
    p2.innerHTML = s2.map(kioskDayCardHTML).join('');
    KIOSK.lastDaysRender = STATE.lastLoadCompletedAt || 0;
  } catch (err) {
    console.warn('kiosk day render failed:', err);
  }
}

// ════════════════════════════════════════════════
// NIGHT RADAR — animated swell/wind arrows over the Fishers coastline
// ════════════════════════════════════════════════
//
// A radar-scope rendering of the same frame as the satellite lineup
// image: coastline outline, range rings, a rotating sweep, and the
// hour's primary swell / secondary swell / wind arrows converging on
// the lineup. Playback advances the forecast scrubber one hour per
// second (KIOSK.radarStepMs) through the full forecast, looping, with
// the live swell chart + its moving dots visible below the scope.

// OWNER-TRACED COASTLINE — digitized from the owner's sketch (traced
// over the radar frame, with their features drawn in). Points are
// normalized 0..1 [x, y] over the sketch's own frame (aspect below),
// listed SW end → E end; land is above/left of the shore. `lineup` is
// the arrows' convergence point, seated just seaward of the traced
// wave-break lines on the reef.
const KIOSK_COAST = {
  aspect: 2.122,
  lineup: [0.482, 0.306],
  shore: [
    [0.013, 0.978], [0.058, 0.942], [0.102, 0.917], [0.139, 0.894],
    [0.160, 0.880], [0.156, 0.833], [0.159, 0.772], [0.168, 0.711],
    [0.181, 0.656], [0.196, 0.606], [0.215, 0.556], [0.236, 0.506],
    [0.259, 0.456], [0.285, 0.400], [0.312, 0.350], [0.338, 0.306],
    [0.364, 0.261], [0.390, 0.220], [0.416, 0.183], [0.442, 0.156],
    [0.469, 0.139], [0.497, 0.113], [0.524, 0.091], [0.550, 0.072],
    [0.576, 0.058], [0.602, 0.050], [0.623, 0.056], [0.644, 0.067],
    [0.665, 0.080], [0.686, 0.098], [0.702, 0.120], [0.717, 0.150],
    [0.730, 0.183], [0.743, 0.220], [0.759, 0.244], [0.780, 0.267],
    [0.806, 0.291], [0.838, 0.313], [0.869, 0.330], [0.901, 0.344],
    [0.932, 0.353], [0.963, 0.356], [0.992, 0.359]
  ],
  ponds: [],
  // The owner's drawn features, in their traced positions: rock spots,
  // the wave-break lines on the reef, the parking lot, and the path
  // from the lot down to the beach.
  rocks: [
    [0.460, 0.186], [0.467, 0.174], [0.475, 0.167], [0.483, 0.162],
    [0.490, 0.169], [0.496, 0.176], [0.503, 0.180], [0.485, 0.181],
    [0.474, 0.183],
    [0.284, 0.473], [0.292, 0.489], [0.288, 0.513], [0.299, 0.520],
    [0.304, 0.500], [0.318, 0.531],
    [0.198, 0.602], [0.203, 0.622], [0.195, 0.647], [0.200, 0.667],
    [0.204, 0.689], [0.196, 0.713],
    [0.166, 0.887], [0.174, 0.902], [0.170, 0.922], [0.177, 0.936],
    [0.172, 0.956],
    [0.792, 0.298], [0.801, 0.307], [0.817, 0.311], [0.825, 0.318],
    [0.842, 0.322], [0.854, 0.331], [0.866, 0.339], [0.874, 0.344],
    [0.904, 0.351], [0.916, 0.359], [0.929, 0.364],
    [0.969, 0.358], [0.979, 0.364], [0.988, 0.369]
  ],
  breaks: [
    [[0.385, 0.302], [0.445, 0.233], [0.503, 0.164]],
    [[0.460, 0.299], [0.526, 0.230]],
    [[0.509, 0.343], [0.530, 0.320]]
  ],
  lot: [[0.325, 0.058], [0.336, 0.056], [0.350, 0.169], [0.338, 0.178]],
  path: [[0.344, 0.173], [0.356, 0.187], [0.372, 0.191], [0.390, 0.183]]
};

const KIOSK_RADAR = { idx: -1, sweep: 0, raf: null, lastT: 0 };

// External entry point: set the displayed forecast hour and repaint.
function kioskDrawRadar(idx) {
  if (typeof idx === 'number') KIOSK_RADAR.idx = idx;
  kioskRadarPaint();
}

function kioskRadarArrow(ctx, lx, ly, fromDeg, len, o) {
  const th = fromDeg * Math.PI / 180;
  const ux = Math.sin(th), uy = -Math.cos(th); // unit vector lineup → source
  const gap = 30;
  const hx = lx + ux * gap, hy = ly + uy * gap;             // head tip
  const tx = lx + ux * (gap + len), ty = ly + uy * (gap + len); // tail
  const headLen = 10 + o.width * 2.2;
  const headW = 5 + o.width * 1.6;

  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.width;
  ctx.setLineDash(o.dashed ? [10, 7] : []);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx + ux * headLen, hy + uy * headLen);
  ctx.stroke();
  ctx.setLineDash([]);
  // Head: triangle pointing at the lineup (travel direction).
  const bx = hx + ux * headLen, by = hy + uy * headLen;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(bx - uy * headW, by + ux * headW);
  ctx.lineTo(bx + uy * headW, by - ux * headW);
  ctx.closePath();
  if (o.dashed) { ctx.lineWidth = Math.max(1.5, o.width - 0.5); ctx.stroke(); }
  else ctx.fill();

  if (o.label) {
    const off = 18 + (o.labelPush || 0);
    let px = tx + ux * off, py = ty + uy * off;
    // Horizontal arrows run parallel to their (horizontal) label — float
    // the text up off the shaft in proportion to how horizontal it is.
    py -= 16 * Math.abs(ux);
    ctx.font = '700 16px "Orbitron", Tahoma, Geneva, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(o.label).width;
    px = Math.max(10 + tw / 2, Math.min(ctx.canvas.clientWidth - 10 - tw / 2, px));
    py = Math.max(14, Math.min(ctx.canvas.clientHeight - 12, py));
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.strokeText(o.label, px, py);
    ctx.fillStyle = o.color;
    ctx.fillText(o.label, px, py);
  }
}

function kioskRadarPaint() {
  const cv = el('kiosk-radar-canvas');
  if (!cv || !cv.clientWidth) return;
  const ctx = cv.getContext('2d');
  const dims = ensureCanvasCssDims(cv, ctx);
  const w = dims.cssW, h = dims.cssH;
  if (!w || !h) return;

  const G = '#45ff9a';
  // The canvas fills the screen; the owner's trace keeps its true
  // proportions contain-fitted and centered. Both shore ends extend
  // along their own headings past the canvas edges so the coast never
  // stops mid-air, whatever the screen shape.
  const FRAME_ASPECT = KIOSK_COAST.aspect;
  let fw = w, fh = w / FRAME_ASPECT;
  if (fh > h) { fh = h; fw = h * FRAME_ASPECT; }
  const fx = (w - fw) / 2, fy = (h - fh) / 2;
  const lx = fx + KIOSK_COAST.lineup[0] * fw, ly = fy + KIOSK_COAST.lineup[1] * fh;
  const rMax = h * 0.62;
  const px = p => [fx + p[0] * fw, fy + p[1] * fh];
  const trace = pts => {
    const [x0, y0] = px(pts[0]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) { const [x, y] = px(pts[i]); ctx.lineTo(x, y); }
  };
  const shore = KIOSK_COAST.shore;
  // Off-canvas extensions of the first/last shore segments.
  const EXT = w + h;
  const ext = (a, b) => {
    const [ax, ay] = px(a), [bx, by] = px(b);
    const d = Math.hypot(ax - bx, ay - by) || 1;
    return [ax + ((ax - bx) / d) * EXT, ay + ((ay - by) / d) * EXT];
  };
  const extStart = ext(shore[0], shore[1]);
  const extEnd = ext(shore[shore.length - 1], shore[shore.length - 2]);

  // Faceplate + land mass (everything above/left of the shore line).
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(extStart[0], extStart[1]);
  trace(shore);
  ctx.lineTo(extEnd[0], extEnd[1]);
  ctx.lineTo(w + EXT, -EXT); ctx.lineTo(-EXT, -EXT);
  ctx.closePath();
  ctx.fillStyle = 'rgba(69, 255, 154, 0.06)';
  ctx.fill();

  // Range rings + crosshair ticks around the lineup.
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.11)';
  ctx.lineWidth = 1;
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(lx, ly, rMax * k / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(lx - rMax, ly); ctx.lineTo(lx + rMax, ly);
  ctx.moveTo(lx, ly - rMax); ctx.lineTo(lx, ly + rMax);
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.06)';
  ctx.stroke();

  // Rotating sweep with a fading trail, clipped to the outer ring.
  ctx.save();
  ctx.beginPath();
  ctx.arc(lx, ly, rMax, 0, Math.PI * 2);
  ctx.clip();
  const a0 = (KIOSK_RADAR.sweep - 90) * Math.PI / 180;
  for (let i = 0; i < 30; i++) {
    const a = a0 - i * 0.022;
    ctx.strokeStyle = 'rgba(69, 255, 154, ' + (0.15 * (1 - i / 30)).toFixed(3) + ')';
    ctx.lineWidth = i === 0 ? 1.5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + rMax * Math.cos(a), ly + rMax * Math.sin(a));
    ctx.stroke();
  }
  ctx.restore();

  // Coastline stroke on top of the sweep.
  ctx.beginPath();
  ctx.moveTo(extStart[0], extStart[1]);
  trace(shore);
  ctx.lineTo(extEnd[0], extEnd[1]);
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  for (const pond of KIOSK_COAST.ponds) {
    ctx.beginPath();
    trace(pond);
    ctx.closePath();
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.strokeStyle = 'rgba(69, 255, 154, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Owner-traced features. Rocks: dark spots with a faint rim.
  const rockR = Math.max(2, fh * 0.006);
  for (let ri = 0; ri < KIOSK_COAST.rocks.length; ri++) {
    const [rx, ry] = px(KIOSK_COAST.rocks[ri]);
    ctx.beginPath();
    ctx.arc(rx, ry, rockR * (0.8 + (ri % 3) * 0.25), 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.strokeStyle = 'rgba(69, 255, 154, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Wave-break lines on the reef.
  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.5)';
  ctx.lineWidth = 2;
  for (const line of KIOSK_COAST.breaks) {
    ctx.beginPath();
    trace(line);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Parking lot + the path down to the beach.
  ctx.beginPath();
  trace(KIOSK_COAST.lot);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  trace(KIOSK_COAST.path);
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  // Swell window cone (compass bearing θ → canvas angle θ − 90°).
  const c1 = CONFIG.chocomount.swellWindowMin * Math.PI / 180 - Math.PI / 2;
  const c2 = CONFIG.chocomount.swellWindowMax * Math.PI / 180 - Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.arc(lx, ly, rMax * 0.92, c1, c2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(69, 255, 154, 0.045)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── The hour's arrows, converging on the lineup ──
  const fd = STATE.forecastData;
  const hr = fd && fd.marine && fd.marine.hourly;
  const wh = fd && fd.wind && fd.wind.hourly;
  const i = KIOSK_RADAR.idx;
  const clampLen = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  if (hr && hr.time && i >= 0 && i < hr.time.length) {
    const pH = (hr.swell_wave_height || hr.wave_height || [])[i];
    const pP = (hr.swell_wave_period || hr.wave_period || [])[i];
    const pD = (hr.swell_wave_direction || [])[i];
    const sH = (hr.secondary_swell_wave_height || [])[i];
    const sP = (hr.secondary_swell_wave_period || [])[i];
    const sD = (hr.secondary_swell_wave_direction || [])[i];
    const wS = wh && wh.wind_speed_10m ? wh.wind_speed_10m[i] : null;
    const wD = wh && wh.wind_direction_10m ? wh.wind_direction_10m[i] : null;

    // Secondary first so the primary draws on top. Owner call: it shows
    // whenever the model reports one, no matter how small.
    const closeDirs = sD != null && pD != null &&
      Math.abs(((sD - pD + 540) % 360) - 180) < 16; // bearings within ~16°
    // No compass words in the labels — the arrow's own bearing against
    // the swell-window cone carries the direction.
    if (sH != null && sD != null) {
      const len = clampLen(Math.sqrt(sH * sH * (sP || 1)) * 16, 70, rMax * 0.85);
      kioskRadarArrow(ctx, lx, ly, sD, len, {
        color: 'rgba(69, 255, 154, 0.55)', width: 3.5,
        label: sH.toFixed(1) + 'ft @ ' + (sP != null ? sP.toFixed(0) : '–') + 's',
        labelPush: closeDirs ? 30 : 10
      });
    }
    if (pH != null && pD != null) {
      const len = clampLen(Math.sqrt(pH * pH * (pP || 1)) * 16, 84, rMax * 0.9);
      kioskRadarArrow(ctx, lx, ly, pD, len, {
        color: G, width: 5.5,
        label: pH.toFixed(1) + 'ft @ ' + (pP != null ? pP.toFixed(0) : '–') + 's'
      });
    }
    if (wD != null) {
      const len = clampLen((wS || 0) * 8, 62, rMax * 0.8);
      kioskRadarArrow(ctx, lx, ly, wD, len, {
        color: 'rgba(69, 255, 154, 0.8)', width: 3.5, dashed: true,
        label: (wS != null ? Math.round(wS) : '–') + 'mph'
      });
    }

    // Time block, top-right: date / big clock / offset from now.
    const t = new Date(hr.time[i]);
    const c = kioskFmtClock(t);
    const dh = Math.round((t.getTime() - Date.now()) / 3600e3);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '500 13px "Orbitron", Tahoma, Geneva, sans-serif';
    ctx.fillStyle = 'rgba(69, 255, 154, 0.6)';
    ctx.fillText(t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(), w - 18, 30);
    ctx.font = '34px "DSEG14", "Courier New", monospace';
    ctx.fillStyle = G;
    ctx.fillText(c.seg + ' ' + c.ampm, w - 18, 72);
    ctx.font = '700 13px "Orbitron", Tahoma, Geneva, sans-serif';
    if (Math.abs(dh) < 1) {
      ctx.fillStyle = '#ff5252';
      ctx.fillText('● NOW', w - 18, 96);
    } else {
      ctx.fillStyle = dh > 0 ? 'rgba(69, 255, 154, 0.6)' : 'rgba(69, 255, 154, 0.35)';
      ctx.fillText((dh > 0 ? '+' : '−') + Math.abs(dh) + ' H', w - 18, 96);
    }
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 16px "Orbitron", Tahoma, Geneva, sans-serif';
    ctx.fillStyle = 'rgba(69, 255, 154, 0.5)';
    ctx.fillText('AWAITING FORECAST DATA', w / 2, h / 2 + rMax / 2);
  }

  // Lineup marker.
  ctx.beginPath();
  ctx.arc(lx, ly, 5, 0, Math.PI * 2);
  ctx.fillStyle = G;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx, ly, 11, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Continuous sweep animation — runs only while the radar panel is up
// (mirrors the chart's always-on now-pulse rAF loop; the browser parks
// rAF automatically when the display sleeps or the tab hides).
function kioskRadarLoop(ts) {
  if (document.body.dataset.kioskPanel !== 'radar') { KIOSK_RADAR.raf = null; return; }
  const dt = KIOSK_RADAR.lastT ? Math.min(200, ts - KIOSK_RADAR.lastT) : 16;
  KIOSK_RADAR.lastT = ts;
  KIOSK_RADAR.sweep = (KIOSK_RADAR.sweep + dt * 0.036) % 360; // 10 s / rev
  kioskRadarPaint();
  KIOSK_RADAR.raf = requestAnimationFrame(kioskRadarLoop);
}

// Playback: drive the app's own scrubber one forecast hour per step —
// applyScrubberToHour repaints the swell chart dots, detail bar, and
// (via the kiosk wrapper) this radar, so everything moves in lockstep.
function kioskRadarStart() {
  if (KIOSK.radarTimer) { clearInterval(KIOSK.radarTimer); KIOSK.radarTimer = null; }
  const cs = STATE.forecastChart;
  if (cs && cs.times.length) {
    const nowIdx = findHourIndexForTime(Date.now(), cs);
    KIOSK_RADAR.idx = nowIdx >= 0 ? nowIdx : 0;
    STATE.scrubberIdx = KIOSK_RADAR.idx;
    applyScrubberToHour(KIOSK_RADAR.idx);
    KIOSK.radarTimer = setInterval(kioskRadarTick, KIOSK.radarStepMs);
  } else {
    KIOSK_RADAR.idx = -1; // scope + "awaiting data" until the load lands
  }
  if (!KIOSK_RADAR.raf) {
    KIOSK_RADAR.lastT = 0;
    KIOSK_RADAR.raf = requestAnimationFrame(kioskRadarLoop);
  }
}

function kioskRadarTick() {
  const cs = STATE.forecastChart;
  if (!cs || !cs.times.length) return;
  if (KIOSK.state === 'paused') return; // a touch hands the dial to the user
  KIOSK_RADAR.idx = (KIOSK_RADAR.idx + 1) % cs.times.length;
  STATE.scrubberIdx = KIOSK_RADAR.idx;
  applyScrubberToHour(KIOSK_RADAR.idx);
}

// Stop playback when the rotation leaves the radar; snap the shared
// scrubber back to "now" so the forecast panel isn't left time-traveled.
function kioskRadarStop() {
  if (!KIOSK.radarTimer) return;
  clearInterval(KIOSK.radarTimer);
  KIOSK.radarTimer = null;
  if (STATE.forecastChart) resetScrubberToNow();
}

// ── Sources & methodology card ───────────────────
// One ⓘ button in the status strip opens a per-panel card explaining
// what the readings mean and where the data comes from. Plain text, no
// links — a tapped link would navigate the appliance away.
function kioskInfoHTML(panel) {
  const live = id => {
    const f = el(id);
    const t = f && f.textContent ? f.textContent.trim() : '';
    return t ? '<p class="np-info-live">' + t + '</p>' : '';
  };
  if (panel === 'radar') {
    return '<h3>Radar loop</h3>' +
      '<p>The scope replays the forecast at 1 second per hour and loops. Arrows show primary swell, secondary swell (dimmer), and wind (dashed), each pointing the way it travels and converging on the Chocomount lineup; arrow length scales with energy. The shaded cone is the 115–158° swell window, and the chart below tracks the same hour. Tap to pause, tap again to resume; dragging the chart scrubs by hand. The coastline, rocks, reef break lines, parking lot, and beach path are traced from the owner’s own sketch of the spot.</p>' +
      '<h3>Sources</h3>' +
      '<p>Swell &amp; wind: Open-Meteo Marine and Weather forecast (best_match model) at the offshore forecast point. Tide: NOAA CO-OPS predictions, Silver Eel Pond station 8510719.</p>';
  }
  if (panel === 'spectral') {
    return '<h3>Wave spectra</h3>' +
      '<p>The table decomposes the buoy’s raw wave spectrum into primary swell, wind waves, and total significant height (Hs — the mean of the highest third of waves). The rose bins spectral energy by arrival direction: petal length is that band’s height contribution, color is its period, and the outlined wedge is the 115–158° swell window.</p>' +
      '<h3>Sources</h3>' +
      '<p>NDBC buoy 44097 (Block Island) raw and directional spectra, fetched live via CORS proxy, with the repository’s two-hour pipeline (data/buoy.json) as fallback.</p>' +
      live('footer-spectral-summary') + live('footer-compass');
  }
  return '<h3>Day summaries</h3>' +
    '<p>Swell is the min–max over the incoming-tide windows (each low to the next high at Silver Eel) clipped to daylight, sampled from the offshore forecast point with a 1 h swell-travel lag (2 h when the buoy-coords toggle is on). Period is the window mean rounded up. Swell arrows point where the swell is going, with the FROM compass label printed on them; wind shows as a heading dial whose rim pointer marks where the wind is blowing toward, with speed and FROM label in the middle. Winds are read at each low tide and at sunrise / noon / sunset; the moon is percent of full.</p>' +
    '<h3>Sources</h3>' +
    '<p>Swell &amp; wind: Open-Meteo Marine and Weather (best_match model). Tides and lows: NOAA CO-OPS predictions, Silver Eel Pond station 8510719. Sunrise and sunset: computed solar position. Moon: computed from the synodic month.</p>';
}

function kioskToggleInfo(force) {
  const ov = el('kiosk-info-overlay');
  if (!ov) return;
  const show = force != null ? force : ov.style.display === 'none';
  if (show) {
    el('kiosk-info-card').innerHTML = kioskInfoHTML(document.body.dataset.kioskPanel);
    ov.style.display = '';
  } else {
    ov.style.display = 'none';
  }
}

function kioskShowPanel(name) {
  document.body.dataset.kioskPanel = name;
  kioskToggleInfo(false); // a stale card must not outlive its panel
  if (name === 'days1' || name === 'days2') kioskRenderDays();
  if (name !== 'radar') kioskRadarStop();
  // Redraw after the browser has laid out the newly-visible container —
  // canvases drawn while display:none cache 0-width dims.
  requestAnimationFrame(() => kioskRedrawPanel(name));
}

function kioskRedrawPanel(name) {
  try {
    if (name === 'radar') {
      // The swell chart rides below the scope at radar-mode sizes, so it
      // must be laid out fresh at those dims before playback starts.
      if (STATE.forecastData && STATE.forecastData.marine) {
        invalidateCanvasDPR(el('forecast-canvas-swell'));
        invalidateCanvasDPR(el('forecast-canvas-wind'));
        invalidateCanvasDPR(el('forecast-canvas-tide'));
        const d = STATE.forecastData;
        drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo, d.tidePred, d.buoyParsed);
      }
      invalidateCanvasDPR(el('kiosk-radar-canvas'));
      kioskRadarStart();
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
  if (KIOSK.state !== 'rotating') return;
  let ms = KIOSK.rotateMs;
  // The radar panel dwells long enough for one full pass through the
  // forecast at the playback rate (~168 s at 1 s/hr), plus a beat.
  if (KIOSK.panels[KIOSK.idx] === 'radar') {
    const cs = STATE.forecastChart;
    if (cs && cs.times.length) ms = cs.times.length * KIOSK.radarStepMs + 2000;
  }
  KIOSK.rotateTimer = setTimeout(kioskAdvance, ms);
}

// Any touch pauses rotation so the scrubber / rose hover can be used.
// On the radar a tap is a toggle: tap pauses the loop, re-tap resumes
// it in place (touches on the chart below are scrubbing, so they only
// re-arm the pause instead of resuming). Touches on the NEXT button
// are exempt — advancing shouldn't also freeze the rotation.
function kioskPause(ev) {
  const t = ev && ev.target && ev.target.closest ? ev.target : null;
  if (t && t.closest('#kiosk-next')) return;
  // Info-card touches pause and re-arm but never resume — closing the
  // card shouldn't restart the radar under the reader.
  const onInfo = t && (t.closest('#kiosk-info') || t.closest('#kiosk-info-overlay'));
  const onRadar = document.body.dataset.kioskPanel === 'radar';
  if (onRadar && KIOSK.state === 'paused' && !onInfo) {
    const onChart = t && t.closest('#panel-forecast');
    if (!onChart) { kioskResumeInPlace(); return; }
  }
  KIOSK.state = 'paused';
  clearTimeout(KIOSK.rotateTimer);
  const cue = el('kiosk-paused');
  if (cue) {
    cue.textContent = onRadar ? '⏸ PAUSED — TAP TO RESUME' : '⏸ PAUSED — RESUMES SHORTLY';
    cue.style.display = '';
  }
  clearTimeout(KIOSK.resumeTimer);
  // Backstop so an accidental tap can't freeze an unattended kiosk.
  KIOSK.resumeTimer = setTimeout(onRadar ? kioskResumeInPlace : kioskResume, KIOSK.pauseMs);
}

// Resume the radar loop where it left off — no panel change.
function kioskResumeInPlace() {
  KIOSK.state = 'rotating';
  clearTimeout(KIOSK.resumeTimer);
  const cue = el('kiosk-paused');
  if (cue) cue.style.display = 'none';
  kioskScheduleNext(); // re-arm the dwell; playback ticks pick back up
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
    // If the radar came up before the first load finished, its playback
    // never started — kick it now that there's a forecast to sweep.
    if (document.body.dataset.kioskPanel === 'radar' && !KIOSK.radarTimer) {
      requestAnimationFrame(() => kioskRedrawPanel('radar'));
    }
  }
}

// Builds the kiosk-only DOM (day panels, status strip, night-dim overlay,
// paused cue, NEXT button) so index.html carries no kiosk markup.
function kioskBuildChrome() {
  const app = el('app') || document.body;
  // Radar scope sits ABOVE the app window so the swell chart (inside
  // #panel-forecast) renders beneath it on the radar panel.
  const radar = document.createElement('div');
  radar.id = 'kiosk-radar';
  radar.innerHTML = '<canvas id="kiosk-radar-canvas"></canvas>';
  app.insertBefore(radar, app.firstChild);

  const days1 = document.createElement('div');
  days1.id = 'kiosk-days-1';
  days1.className = 'np-days';
  const days2 = document.createElement('div');
  days2.id = 'kiosk-days-2';
  days2.className = 'np-days';
  app.appendChild(days1);
  app.appendChild(days2);

  const strip = document.createElement('div');
  strip.id = 'kiosk-status';
  strip.innerHTML =
    '<span id="kiosk-pilot" title="power"></span>' +
    '<span id="kiosk-status-buoy">CHOC TV</span>' +
    '<span id="kiosk-status-updated">loading…</span>' +
    '<span id="kiosk-paused" style="display:none">⏸ PAUSED — RESUMES SHORTLY</span>' +
    '<span class="kiosk-status-spacer"></span>' +
    '<button type="button" id="kiosk-info" aria-label="Sources and methodology">ⓘ SOURCES</button>' +
    '<button type="button" id="kiosk-next">NEXT ▸</button>' +
    '<span id="kiosk-status-clock"></span>';
  document.body.appendChild(strip);

  // NEXT skips straight to the following panel without pausing rotation.
  el('kiosk-next').addEventListener('click', () => {
    if (KIOSK.state === 'paused') kioskResume();
    else kioskAdvance();
  });

  // Sources & methodology card (content filled per panel on open).
  const info = document.createElement('div');
  info.id = 'kiosk-info-overlay';
  info.style.display = 'none';
  info.innerHTML = '<div id="kiosk-info-card"></div>';
  document.body.appendChild(info);
  el('kiosk-info').addEventListener('click', () => kioskToggleInfo());
  info.addEventListener('click', () => kioskToggleInfo(false));
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
  // Instrument face type: chart canvases label in Orbitron too (axis
  // ticks, day labels). Segment digits stay DSEG14.
  FC_CHART_FONT = '"Orbitron", Tahoma, Geneva, sans-serif';
  // The radar shadows every scrubber repaint — including manual scrubs
  // while paused — by wrapping the app's applier (classic-script function
  // declarations are writable globals; app.js has already executed).
  const kioskAppApplyScrubber = applyScrubberToHour;
  applyScrubberToHour = function (idx) {
    kioskAppApplyScrubber(idx);
    if (document.body.dataset.kioskPanel === 'radar') kioskDrawRadar(idx);
  };
  // A full chart redraw (15-min data refresh, resize) resets the
  // scrubber to "now" — mid-loop or mid-pause that would yank the radar
  // off its hour. Hold the displayed hour across the redraw and re-apply
  // it synchronously, so the loop carries on where it was.
  const kioskAppDrawForecast = drawForecastChart;
  drawForecastChart = function () {
    const cs = STATE.forecastChart;
    const holdMs = document.body.dataset.kioskPanel === 'radar' && KIOSK.radarTimer &&
      cs && KIOSK_RADAR.idx >= 0 && KIOSK_RADAR.idx < cs.times.length
      ? cs.times[KIOSK_RADAR.idx].getTime() : null;
    kioskAppDrawForecast.apply(null, arguments);
    if (holdMs != null && STATE.forecastChart) {
      const hi = findHourIndexForTime(holdMs, STATE.forecastChart);
      if (hi >= 0) {
        STATE.scrubberIdx = hi;
        KIOSK_RADAR.idx = hi;
        applyScrubberToHour(hi);
      }
    }
  };
  // This script sits at the end of <body>, so body exists at parse time:
  // flag it immediately so kiosk CSS applies before first paint.
  document.body.classList.add('kiosk');
  document.body.dataset.kioskPanel = 'days1';
  // kioskInit after app.js's initGate (its listener registered first).
  document.addEventListener('DOMContentLoaded', kioskInit);
}
