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
// seeded), rotates five full-screen panels (day summaries ×2, night
// radar, forecast charts, spectra), auto-refreshes data every
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
  panels: ['days1', 'days2', 'radar', 'forecast', 'spectral'],
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

// Wind: one shape everywhere — a medium arrow with the reading printed
// on it (speed big, "MPH <from>" beneath).
function kioskWindHTML(wind) {
  if (!wind) return '<span class="np-legend np-dim">NO DATA</span>';
  const cap = 'MPH' + (wind.dir != null ? ' ' + directionLabel(wind.dir) : '');
  return `<span class="np-windline">` +
    kioskArrowHTML(wind.dir,
      `<span class="np-ao-num">${Math.round(wind.mph)}</span>` +
      `<span class="np-ao-cap">${cap}</span>`,
      'np-arrow-med') +
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
        ? `<span class="np-at">@</span>${kioskSegHTML(sw.period, primary ? 'np-seg-md' : 'np-seg-sm')}<span class="np-unit">S</span>`
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

// PROVISIONAL COASTLINE — hand-traced from project/assets/lineup.jpg
// (1992×949). Swap in the owner's traced file when it arrives: points
// are normalized 0..1 [x, y] over that exact image frame, listed
// upcoast → downcoast; `lineup` is the arrows' convergence point
// (image center, matching the lineup-map overlay). Land is everything
// above/left of the shore polyline.
const KIOSK_COAST = {
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

const KIOSK_RADAR = { idx: -1, sweep: 0, raf: null, lastT: 0 };

// External entry point: set the displayed forecast hour and repaint.
function kioskDrawRadar(idx) {
  if (typeof idx === 'number') KIOSK_RADAR.idx = idx;
  kioskRadarPaint();
}

function kioskRadarArrow(ctx, lx, ly, fromDeg, len, o) {
  const th = fromDeg * Math.PI / 180;
  const ux = Math.sin(th), uy = -Math.cos(th); // unit vector lineup → source
  const gap = 26;
  const hx = lx + ux * gap, hy = ly + uy * gap;             // head tip
  const tx = lx + ux * (gap + len), ty = ly + uy * (gap + len); // tail
  const headLen = 10 + o.width * 2.2;
  const headW = 5 + o.width * 1.6;

  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.width;
  ctx.setLineDash(o.dashed ? [7, 5] : []);
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
    const off = 14 + (o.labelPush || 0);
    let px = tx + ux * off, py = ty + uy * off;
    ctx.font = 'bold 13px Tahoma, Geneva, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(o.label).width;
    px = Math.max(8 + tw / 2, Math.min(ctx.canvas.clientWidth - 8 - tw / 2, px));
    py = Math.max(12, Math.min(ctx.canvas.clientHeight - 10, py));
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
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
  const lx = KIOSK_COAST.lineup[0] * w, ly = KIOSK_COAST.lineup[1] * h;
  const rMax = h * 0.62;
  const px = p => [p[0] * w, p[1] * h];
  const trace = pts => {
    const [x0, y0] = px(pts[0]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) { const [x, y] = px(pts[i]); ctx.lineTo(x, y); }
  };

  // Faceplate + land mass (everything above/left of the shore line).
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  trace(KIOSK_COAST.shore);
  ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.lineTo(0, h);
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

  // Coastline stroke + ponds on top of the sweep.
  ctx.beginPath();
  trace(KIOSK_COAST.shore);
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
    if (sH != null && sD != null) {
      const len = clampLen(Math.sqrt(sH * sH * (sP || 1)) * 12, 34, rMax * 0.85);
      kioskRadarArrow(ctx, lx, ly, sD, len, {
        color: 'rgba(69, 255, 154, 0.55)', width: 2,
        label: sH.toFixed(1) + ' FT @ ' + (sP != null ? sP.toFixed(0) : '–') + ' S ' + directionLabel(sD),
        labelPush: closeDirs ? 26 : 0
      });
    }
    if (pH != null && pD != null) {
      const len = clampLen(Math.sqrt(pH * pH * (pP || 1)) * 12, 40, rMax * 0.9);
      kioskRadarArrow(ctx, lx, ly, pD, len, {
        color: G, width: 3.5,
        label: pH.toFixed(1) + ' FT @ ' + (pP != null ? pP.toFixed(0) : '–') + ' S ' + directionLabel(pD)
      });
    }
    if (wD != null) {
      const len = clampLen((wS || 0) * 6, 30, rMax * 0.8);
      kioskRadarArrow(ctx, lx, ly, wD, len, {
        color: 'rgba(69, 255, 154, 0.8)', width: 2, dashed: true,
        label: (wS != null ? Math.round(wS) : '–') + ' MPH ' + directionLabel(wD)
      });
    }

    // Time block, top-right: date / big clock / offset from now.
    const t = new Date(hr.time[i]);
    const c = kioskFmtClock(t);
    const dh = Math.round((t.getTime() - Date.now()) / 3600e3);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '12px Tahoma, Geneva, sans-serif';
    ctx.fillStyle = 'rgba(69, 255, 154, 0.6)';
    ctx.fillText(t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(), w - 14, 24);
    ctx.font = '26px "DSEG14", "Courier New", monospace';
    ctx.fillStyle = G;
    ctx.fillText(c.seg + ' ' + c.ampm, w - 14, 56);
    ctx.font = 'bold 12px Tahoma, Geneva, sans-serif';
    if (Math.abs(dh) < 1) {
      ctx.fillStyle = '#ff5252';
      ctx.fillText('● NOW', w - 14, 76);
    } else {
      ctx.fillStyle = dh > 0 ? 'rgba(69, 255, 154, 0.6)' : 'rgba(69, 255, 154, 0.35)';
      ctx.fillText((dh > 0 ? '+' : '−') + Math.abs(dh) + ' H', w - 14, 76);
    }
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '15px Tahoma, Geneva, sans-serif';
    ctx.fillStyle = 'rgba(69, 255, 154, 0.5)';
    ctx.fillText('AWAITING FORECAST DATA', w / 2, h / 2 + rMax / 2);
  }

  // Lineup marker.
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = G;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx, ly, 8, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(69, 255, 154, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Scope captions, top-left.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '12px Tahoma, Geneva, sans-serif';
  ctx.fillStyle = 'rgba(69, 255, 154, 0.8)';
  ctx.fillText('CHOCOMOUNT — NIGHT RADAR', 14, 24);
  ctx.font = '10px Tahoma, Geneva, sans-serif';
  ctx.fillStyle = 'rgba(69, 255, 154, 0.4)';
  ctx.fillText('1 SEC = 1 HR · FULL FORECAST LOOP · SWELL / 2ND / WIND', 14, 42);
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

function kioskShowPanel(name) {
  document.body.dataset.kioskPanel = name;
  if (name === 'days1' || name === 'days2') kioskRenderDays();
  if (name !== 'radar') kioskRadarStop();
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
    } else if (name === 'radar') {
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
  // The radar shadows every scrubber repaint — including manual scrubs
  // while paused — by wrapping the app's applier (classic-script function
  // declarations are writable globals; app.js has already executed).
  const kioskAppApplyScrubber = applyScrubberToHour;
  applyScrubberToHour = function (idx) {
    kioskAppApplyScrubber(idx);
    if (document.body.dataset.kioskPanel === 'radar') kioskDrawRadar(idx);
  };
  // This script sits at the end of <body>, so body exists at parse time:
  // flag it immediately so kiosk CSS applies before first paint.
  document.body.classList.add('kiosk');
  document.body.dataset.kioskPanel = 'days1';
  // kioskInit after app.js's initGate (its listener registered first).
  document.addEventListener('DOMContentLoaded', kioskInit);
}
