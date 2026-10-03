/* ════════════════════════════════════════════════════════════════════
   CHART ROOM — overlay for LetsCheckChoc (direction C)
   ────────────────────────────────────────────────────────────────────
   The nautical chart and the tide almanac, used sincerely. Loaded as a
   classic script AFTER kiosk.js, so every app.js / kiosk.js global is
   reachable and every top-level function declaration is reassignable
   (the same mechanism kiosk.js already uses on applyScrubberToHour).

   What it does, in order:
     0. era + sheets — body[data-era="chart"]; the three Win95 sheets
        and styles-kiosk.css are switched off (theme.css replaces them).
     1. light       — one sky from calcDaylight: day (paper chart),
        dusk (sunset→last light: the bridge's dimmed chart) and night
        (after last light: the red chart-table lamp). Tokens live in CSS;
        canvases read them once per change (crReadTokens), so a palette
        is a token set, never another override sheet.
     2. charts      — drawSwellPanel / drawWindPanel / drawTidePanel are
        replaced: what reaches the reef is ink, blocked swell a ghost.
     3. web flow    — header, NOW verdict, This week at Choc (from
        kioskDaySummary), chartlet (lineup), pinned hour card, more
        conditions, sources & settings, log book, notice-to-mariners gate.
     4. Choc TV     — the chart table at night: almanac day cards sized in
        vh, radar on the chart with a compositor sweep, time-aware lead
        day, crossfades, a home-panel rotation.
   Nothing here loops: the radar sweep is a CSS transform at steps(200)
   over 10 s (20 Hz, compositor only); everything else paints on data,
   on a scrub, or once a minute (sky check).
   ════════════════════════════════════════════════════════════════════ */
(function chartRoom() {
  'use strict';
  if (typeof STATE === 'undefined' || typeof CONFIG === 'undefined') return;

  const TV = typeof isKioskMode === 'function' && isKioskMode();
  const B = document.body;
  const H = document.documentElement;
  const $ = id => document.getElementById(id);
  const LAT = CONFIG.chocomount.lat, LON = CONFIG.chocomount.lon;
  const WMIN = CONFIG.chocomount.swellWindowMin, WMAX = CONFIG.chocomount.swellWindowMax;
  const REEF = 335;
  const esc = s => (typeof escHtml === 'function' ? escHtml(s) : String(s));
  const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── 0. Era + stylesheets ──────────────────────────────────────────
  B.dataset.era = 'chart';
  document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
    if (/styles-(web1|web1-extensions|retro|kiosk)\.css/.test(l.getAttribute('href') || '')) l.disabled = true;
  });
  // Two faces, one role each: Source Serif 4 letters the chart (titles,
  // place names, water in italic); Barlow Semi Condensed carries every
  // number and control. Canvas text uses the data face.
  FC_CHART_FONT = '"Barlow Semi Condensed", "Arial Narrow", sans-serif';
  const SERIF = '"Source Serif 4", Georgia, serif';
  const SANS = '"Barlow Semi Condensed", "Arial Narrow", sans-serif';

  // ── Small helpers ─────────────────────────────────────────────────
  function mk(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }
  const pad2 = n => String(n).padStart(2, '0');
  function clock(t, opts) {
    const d = t instanceof Date ? t : new Date(t);
    const h = d.getHours() % 12 || 12;
    const ap = d.getHours() >= 12 ? 'PM' : 'AM';
    if (opts === 'short') return `${h}:${pad2(d.getMinutes())}${ap === 'AM' ? 'a' : 'p'}`;
    return `${h}:${pad2(d.getMinutes())} ${ap}`;
  }
  const dayShort = d => d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const dayLong = d => d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayLabel(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    const k = Math.round((dd - today) / 86400e3);
    return k === 0 ? 'TODAY' : k === 1 ? 'TOMORROW' : dayLong(dd);
  }
  function windBucket(dir, mph) {
    if (dir == null) return null;
    const gap = Math.min(((dir - REEF) % 360 + 360) % 360, ((REEF - dir) % 360 + 360) % 360);
    let b = gap < 60 ? 'off' : gap < 120 ? 'cross' : 'on';
    if (mph != null && mph < 5) b = b === 'cross' ? 'off' : b === 'on' ? 'cross' : b;
    return b;
  }
  const WIND_WORD = { off: 'offshore', cross: 'cross-shore', on: 'onshore' };
  const WIN_WORD = { 'dir-in': 'IN WINDOW', 'dir-edge': 'EDGE', 'dir-out': 'OUT OF WINDOW' };
  const WIN_KEY = { 'dir-in': 'in', 'dir-edge': 'edge', 'dir-out': 'out' };
  function winClass(d) {
    if (d == null) return '';
    if (d >= WMIN && d <= WMAX) return 'dir-in';
    const e = CONFIG.chocomount.swellWindowEdge;
    if ((d >= WMIN - e && d < WMIN) || (d > WMAX && d <= WMAX + e)) return 'dir-edge';
    return 'dir-out';
  }
  const fmtFt = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));

  // Inline icons (the faces carry no arrows): drawn, in the app's ink.
  const ICON = {
    up: '<svg class="cr-i" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 L9 7 H1 Z"/></svg>',
    down: '<svg class="cr-i" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9 L9 3 H1 Z"/></svg>',
    prev: '<svg class="cr-i" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1 L2 5 L7 9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    next: '<svg class="cr-i" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1 L8 5 L3 9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    refresh: '<svg class="cr-i" viewBox="0 0 12 12" aria-hidden="true"><path d="M10 6a4 4 0 1 1-1.2-2.85" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.6 1.4 L10.4 4.2 L7.6 4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
  };

  // Wind as a pictogram (never hue alone): a heading tick inside a ring,
  // filled solid when offshore, hatched for cross, open for onshore.
  function windGlyph(dir, bucket, size) {
    const s = size || 18;
    const travel = dir != null ? (dir + 180) % 360 : 0;
    return `<svg class="cr-wg cr-wg-${bucket || 'na'}" width="${s}" height="${s}" viewBox="0 0 20 20" aria-hidden="true">` +
      `<circle cx="10" cy="10" r="8.2" class="cr-wg-ring"/>` +
      (dir != null ? `<path class="cr-wg-ptr" transform="rotate(${travel} 10 10)" d="M10 1.2 L14 9 L10 7.2 L6 9 Z"/>` : '') +
      `</svg>`;
  }

  // NOAA-style compass rose. True ring outside (1°/5°/10° ticks, figures
  // every 30°, star at north), magnetic ring inside turned by the local
  // variation (about 14°W at Fishers Island), "VAR" note in the middle.
  function roseSVG(o) {
    o = o || {};
    const R = 100, detail = o.detail || 'full';
    let s = `<svg class="cr-rose ${o.cls || ''}" viewBox="-108 -108 216 216" aria-hidden="true">`;
    s += `<circle r="${R}" class="cr-rose-ring"/><circle r="${R * 0.86}" class="cr-rose-ring"/>`;
    const tick = (a, r0, r1, cls) => {
      const t = a * Math.PI / 180, x0 = Math.sin(t) * r0, y0 = -Math.cos(t) * r0, x1 = Math.sin(t) * r1, y1 = -Math.cos(t) * r1;
      return `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" class="${cls}"/>`;
    };
    for (let a = 0; a < 360; a += (detail === 'full' ? 1 : 5)) {
      const r0 = a % 10 === 0 ? R * 0.86 : a % 5 === 0 ? R * 0.905 : R * 0.94;
      s += tick(a, r0, R, a % 10 === 0 ? 'cr-rose-t10' : 'cr-rose-t1');
    }
    if (detail === 'full') {
      for (let a = 0; a < 360; a += 30) {
        const t = a * Math.PI / 180, r = R * 0.77;
        s += `<text x="${(Math.sin(t) * r).toFixed(2)}" y="${(-Math.cos(t) * r).toFixed(2)}" transform="rotate(${a} ${(Math.sin(t) * r).toFixed(2)} ${(-Math.cos(t) * r).toFixed(2)})" class="cr-rose-fig">${a === 0 ? '0' : a}</text>`;
      }
    }
    // Inner (magnetic) rose, turned 14° west.
    const V = -14;
    s += `<g transform="rotate(${V})"><circle r="${R * 0.6}" class="cr-rose-ring cr-rose-mag"/>`;
    for (let a = 0; a < 360; a += (detail === 'full' ? 5 : 15)) s += tick(a, a % 30 === 0 ? R * 0.52 : R * 0.56, R * 0.6, 'cr-rose-t1');
    s += `<path d="M0 ${-R * 0.6} L4 ${-R * 0.44} L0 ${-R * 0.48} L-4 ${-R * 0.44} Z" class="cr-rose-star"/></g>`;
    // True north star.
    s += `<path d="M0 ${-R * 1.06} L5 ${-R * 0.86} L0 ${-R * 0.9} L-5 ${-R * 0.86} Z" class="cr-rose-star"/>`;
    s += `<line x1="0" y1="${-R * 0.42}" x2="0" y2="${R * 0.42}" class="cr-rose-t1"/><line x1="${-R * 0.42}" y1="0" x2="${R * 0.42}" y2="0" class="cr-rose-t1"/>`;
    if (detail === 'full' && o.var !== false) {
      s += `<text y="-7" class="cr-rose-var">VAR 14°15′W</text><text y="9" class="cr-rose-var">(2026)</text>`;
    }
    if (o.window) {
      // The 115–158° swell window as a magenta wedge on the rose.
      const a0 = WMIN * Math.PI / 180, a1 = WMAX * Math.PI / 180, r = R * 0.84;
      s += `<path class="cr-rose-win" d="M0 0 L${(Math.sin(a0) * r).toFixed(2)} ${(-Math.cos(a0) * r).toFixed(2)} A${r} ${r} 0 0 1 ${(Math.sin(a1) * r).toFixed(2)} ${(-Math.cos(a1) * r).toFixed(2)} Z"/>`;
    }
    if (o.arrowFrom != null) {
      const t = o.arrowFrom * Math.PI / 180, ux = Math.sin(t), uy = -Math.cos(t);
      const x0 = ux * R * 0.8, y0 = uy * R * 0.8, x1 = ux * 12, y1 = uy * 12;
      const px = -uy, py = ux;
      s += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${(ux * 26).toFixed(1)}" y2="${(uy * 26).toFixed(1)}" class="cr-rose-arrow-shaft ${o.arrowCls || ''}"/>` +
        `<path class="cr-rose-arrow-head ${o.arrowCls || ''}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${(ux * 34 + px * 11).toFixed(1)} ${(uy * 34 + py * 11).toFixed(1)} L${(ux * 34 - px * 11).toFixed(1)} ${(uy * 34 - py * 11).toFixed(1)} Z"/>`;
    }
    return s + '</svg>';
  }
  // Fishers Island's south shore at Choc, from kiosk.js's hand trace of
  // the lineup photo: land buff above the shore, a shoal-blue band and a
  // dashed depth curve below it, the pond as water.
  function coastSVG(cls) {
    if (typeof KIOSK_COAST === 'undefined') return '';
    const W = 1000, Hc = W / KIOSK_COAST.aspect;
    const P = p => `${(p[0] * W).toFixed(1)} ${(p[1] * Hc).toFixed(1)}`;
    const sh = KIOSK_COAST.shore;
    const line = 'M' + sh.map(P).join(' L');
    const land = line + ` L${W} 0 L0 0 L0 ${Hc} Z`;
    const pond = 'M' + KIOSK_COAST.ponds[0].map(P).join(' L') + ' Z';
    const off = (dy) => 'M' + sh.map(p => `${(p[0] * W).toFixed(1)} ${(p[1] * Hc + dy).toFixed(1)}`).join(' L');
    return `<svg class="${cls}" viewBox="0 0 ${W} ${Hc.toFixed(0)}" preserveAspectRatio="xMidYMin slice" aria-hidden="true">` +
      `<path d="${line}" class="cr-coast-shoal"/>` +
      `<path d="${off(46)}" class="cr-coast-curve"/>` +
      `<path d="${land}" class="cr-coast-land"/>` +
      `<path d="${pond}" class="cr-coast-pond"/>` +
      `<path d="${line}" class="cr-coast-line"/></svg>`;
  }
  // The NOAA chart anchorage symbol (magenta anchor), for the gate.
  const ANCHOR = '<svg class="cr-anchor" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="10" r="5" fill="none" stroke-width="3.2"/><line x1="32" y1="15" x2="32" y2="56" stroke-width="3.6"/><line x1="20" y1="22" x2="44" y2="22" stroke-width="3.2"/><path d="M8 36 C10 50 20 56 32 57 C44 56 54 50 56 36" fill="none" stroke-width="3.6"/><path d="M4 40 L8 32 L13 40 Z M51 40 L56 32 L60 40 Z" stroke-width="0"/></svg>';

  // ── 1. Light: the sky from calcDaylight ───────────────────────────
  function phaseAt(ms) {
    const dl = calcDaylight(LAT, LON, new Date(ms));
    if (!dl || !dl.sunrise) return 'day';
    if (ms < dl.firstLight.getTime() || ms >= dl.lastLight.getTime()) return 'night';
    if (ms < dl.sunrise.getTime() || ms >= dl.sunset.getTime()) return 'dusk';
    return 'day';
  }
  // Light on the lineup photo follows the SELECTED hour (finer: golden).
  function gradeAt(ms) {
    const dl = calcDaylight(LAT, LON, new Date(ms));
    if (!dl || !dl.sunrise) return 'day';
    const t = ms;
    if (t < dl.firstLight.getTime() || t >= dl.lastLight.getTime()) return 'night';
    if (t < dl.sunrise.getTime()) return 'dawn';
    if (t >= dl.sunset.getTime()) return 'dusk';
    if (t < dl.sunrise.getTime() + 60 * 60e3 || t >= dl.sunset.getTime() - 75 * 60e3) return 'golden';
    return 'day';
  }
  let lightOverride = null;
  try { lightOverride = new URLSearchParams(location.search).get('light'); } catch (_) {}
  function currentPhase() { return /^(day|dusk|night)$/.test(lightOverride || '') ? lightOverride : phaseAt(Date.now()); }
  H.dataset.light = currentPhase();

  // ── Tokens → canvas palettes (SYS-2: one source of truth) ─────────
  const C = {};
  const TOKENS = ['paper', 'sheet', 'sheet-2', 'ink', 'ink-2', 'ink-3', 'hair', 'hair-2', 'land', 'shoal', 'shoal-2',
    'sea', 'sea-2', 'sea-ink', 'tide', 'mag', 'mag-tint', 'good', 'good-tint', 'cross', 'bad', 'night', 'past',
    'ghost', 'halo', 'ramp-lo', 'ramp-hi', 'obs'];
  function rgbOf(c) {
    const m = String(c).match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    const r = String(c).match(/[\d.]+/g);
    return r ? r.slice(0, 3).map(Number) : [0, 0, 0];
  }
  function readTokens() {
    const cs = getComputedStyle(B);
    for (const k of TOKENS) {
      const v = cs.getPropertyValue('--c-' + k).trim();
      if (v) C[k] = v;
    }
    Object.assign(FC_RETRO, {
      plotBg: C.sheet, grid: C.hair, ink: C.ink, ink2: C['ink-2'], frame: C['hair-2'],
      swellFill: C.sea, swellStroke: C['sea-ink'], secSwellFill: C.ghost, period: C.ink,
      periodHalo: C.halo, dirPrimary: C['sea-ink'], dirSecondary: C['ink-3'],
      windOn: C.bad, windCross: C.cross, windOff: C.good, windNull: C.hair, windStroke: C.ink,
      windBand: C['mag-tint'], tide: C.tide, tideMarkFaint: C['ink-3'], tideMark: C.ink, tideConn: C['ink-3'],
      scrubDot: C.ink, nowLine: C.mag, daySep: C.hair, nightShade: C.night, pastDim: C.past,
      obsFill: C.sheet, obsStroke: C.ink, pulseCore: C.mag, pulseRing: rgbOf(C.mag).join(', ')
    });
    Object.assign(ROSE_THEME, { bg: C.sheet, ring: C.hair, cardinal: C.ink, window: C.mag, hs: C.ink, hsSub: C['ink-3'] });
    // Period ramp: one hue, light → dark (short chop pale, groundswell deep).
    const lo = rgbOf(C['ramp-lo']), hi = rgbOf(C['ramp-hi']);
    const stops = [2, 7, 11, 16, 22].map((p, i) => {
      const t = i / 4;
      return [p, lo.map((v, j) => Math.round(v + (hi[j] - v) * t))];
    });
    PERIOD_COLOR_STOPS.splice(0, PERIOD_COLOR_STOPS.length, ...stops);
  }

  function redrawAll() {
    const d = STATE.forecastData;
    if (d && d.marine && STATE.forecastChart && !TV) {
      drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo, d.tidePred, d.buoyParsed);
    }
    if (STATE.lastSpectral && typeof drawCompassRose === 'function') {
      try { drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed); } catch (_) {}
    }
    if (TV && typeof kioskRenderDays === 'function') { kioskRenderDays(); if (B.dataset.kioskPanel === 'radar') kioskRadarPaint(); }
  }
  function setLight(p) {
    if (H.dataset.light === p && C.ink) return;
    H.dataset.light = p;
    readTokens();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', C.paper || '#F3EFE4');
    redrawAll();
  }
  window.crSetLight = p => { lightOverride = p; setLight(currentPhase()); };
  // Sky check once a minute: cheap, and the only clock-driven repaint.
  setInterval(() => setLight(currentPhase()), 60e3);
  readTokens();

  // Which side of an arrow its lettering goes: away from the other arrows.
  // (+1 = the clockwise side of the shaft.)
  function labelSide(deg, others) {
    let sum = 0;
    for (const o of others) { if (o == null) continue; sum += (((o - deg) % 360) + 540) % 360 - 180; }
    return sum > 0 ? -1 : 1;
  }
  // ── Per-hour derivation: what reaches the reef ────────────────────
  // Each train is weighted by app.js _alignmentScore (1 inside 115–158°,
  // fading to 0 over 30° outside), exactly as kioskDaySummary weighs the
  // day cards: reef = √(Σ a·H²), ghost = √(Σ H²). The period line follows
  // whichever train carries more in-window energy that hour.
  function derive(data) {
    if (data._cr) return data._cr;
    const mh = STATE.forecastData && STATE.forecastData.marine && STATE.forecastData.marine.hourly;
    const secP = (mh && mh.secondary_swell_wave_period) || [];
    const n = data.heights.length;
    const reef = new Array(n), total = new Array(n), per = new Array(n), perIn = new Array(n), leadDir = new Array(n), leadIdx = new Array(n);
    for (let i = 0; i < n; i++) {
      const hp = data.heights[i], hs = data.secHeights[i];
      const ap = _alignmentScore(data.swellDirs[i]), as = _alignmentScore(data.secDirs[i]);
      const ep = hp != null ? ap * hp * hp : 0, es = hs != null ? as * hs * hs : 0;
      reef[i] = hp == null && hs == null ? null : Math.sqrt(ep + es);
      total[i] = hp == null && hs == null ? null : Math.sqrt((hp || 0) * (hp || 0) + (hs || 0) * (hs || 0));
      const secLead = hs != null && es > ep;
      per[i] = secLead ? secP[i] : data.wavePeriods[i];
      perIn[i] = (secLead ? as : ap) > 0.5;
      leadDir[i] = secLead ? data.secDirs[i] : data.swellDirs[i];
      leadIdx[i] = secLead ? 1 : 0;
    }
    let mx = 0;
    for (let i = 0; i < n; i++) if (total[i] != null && total[i] > mx) mx = total[i];
    const nice = [2, 3, 4, 6, 8, 12, 16, 20, 24, 32];
    const maxY = nice.find(v => v >= mx * 1.08) || Math.ceil(mx * 1.1);
    data._cr = { reef, total, per, perIn, leadDir, leadIdx, maxY };
    return data._cr;
  }

  // One hour, in surf terms (used by NOW, the hour card and the TV).
  function hourFacts(i) {
    const fd = STATE.forecastData, cs = STATE.forecastChart;
    if (!fd || !fd.marine || !cs || i == null || i < 0 || i >= cs.times.length) return null;
    const mh = fd.marine.hourly;
    const P = { h: cs.heights[i], p: cs.wavePeriods[i], d: cs.swellDirs[i] };
    const S = { h: cs.secHeights[i], p: (mh.secondary_swell_wave_period || [])[i], d: cs.secDirs[i] };
    P.e = P.h != null ? _alignmentScore(P.d) * P.h * P.h : 0;
    S.e = S.h != null ? _alignmentScore(S.d) * S.h * S.h : 0;
    const lead = S.h != null && S.e > P.e ? S : P;
    const other = lead === P ? S : P;
    lead.cls = winClass(lead.d); other.cls = winClass(other.d);
    const t = cs.times[i];
    const tide = tideAt(t.getTime());
    const ws = cs.windSpeeds[i], wd = cs.windDirs[i], wg = cs.windGusts[i];
    return {
      i, t, lead, other, reef: Math.sqrt(P.e + S.e),
      wind: ws != null ? { mph: ws, dir: wd, gust: wg, b: windBucket(wd, ws) } : null,
      tide, model: modelAt(i)
    };
  }

  function tideAt(ms) {
    const fd = STATE.forecastData;
    const tp = fd && fd.tidePred;
    if (!tp || tp.length < 2) return null;
    for (let k = 0; k < tp.length - 1; k++) {
      const a = new Date(tp[k].t).getTime(), b = new Date(tp[k + 1].t).getTime();
      if (ms >= a && ms <= b) {
        const va = parseFloat(tp[k].v), vb = parseFloat(tp[k + 1].v);
        if (!Number.isFinite(va) || !Number.isFinite(vb)) return null;
        const v = va + (vb - va) * ((ms - a) / (b - a || 1));
        const ev = (fd.tideHiLo || []).map(p => ({ t: new Date(p.t).getTime(), type: p.type, v: parseFloat(p.v) })).sort((x, y) => x.t - y.t);
        const next = ev.find(e => e.t > ms);
        const rising = next ? next.type === 'H' : vb >= va;
        return { v, rising, next };
      }
    }
    return null;
  }

  function modelAt(i) {
    if (!STATE.surfLogWaveWeights) return null;
    try {
      const fd = STATE.forecastData;
      const cond = buildForecastConditions(fd.marine, fd.wind, fd.tideHiLo, fd.tidePred, i);
      if (!cond) return null;
      const wf = extractWaveFeatures(cond), rf = extractRideFeatures(cond), cf = extractCondFeatures(cond);
      const v = [wf && predictWaveRating(wf), rf && predictRideRating(rf), cf && predictCondRating(cf)]
        .filter(x => typeof x === 'number' && isFinite(x));
      return v.length === 3 ? Math.max(0, Math.min(10, v.reduce((a, b) => a + b, 0) / 3)) : null;
    } catch (_) { return null; }
  }

  // Daylight incoming windows for a day: each low → next high, clipped to
  // sunrise–sunset (the same rule kioskDaySummary samples).
  function dayWindows(dayStart) {
    const fd = STATE.forecastData || {};
    const ev = (fd.tideHiLo || []).map(p => ({ t: new Date(p.t).getTime(), type: p.type, v: parseFloat(p.v) })).filter(e => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
    const d0 = new Date(dayStart); d0.setHours(0, 0, 0, 0);
    const d1 = d0.getTime() + 86400e3;
    const dl = calcDaylight(LAT, LON, d0) || {};
    const out = [];
    for (const lo of ev.filter(e => e.type === 'L' && e.t >= d0.getTime() && e.t < d1)) {
      const hi = ev.find(e => e.type === 'H' && e.t > lo.t);
      const end = hi ? hi.t : lo.t + 6.2 * 3600e3;
      const a = dl.sunrise ? Math.max(lo.t, dl.sunrise.getTime()) : lo.t;
      const b = dl.sunset ? Math.min(end, dl.sunset.getTime()) : end;
      out.push({ low: lo, high: hi || null, start: a, end: b, daylight: b - a >= 45 * 60e3, dark: !(b - a >= 45 * 60e3) });
    }
    return { windows: out, dl };
  }

  // Best hour of the owner's model inside a day's daylight windows.
  function bestModelIn(wins) {
    const cs = STATE.forecastChart;
    if (!cs || !STATE.surfLogWaveWeights) return null;
    let best = null;
    for (const w of wins) {
      if (!w.daylight) continue;
      for (let t = Math.ceil(w.start / 3600e3) * 3600e3; t <= w.end; t += 3600e3) {
        const i = findHourIndexForTime(t, cs);
        if (i < 0) continue;
        const m = modelAt(i);
        if (m != null && (!best || m > best.v)) best = { v: m, t, i };
      }
    }
    return best;
  }

  /* ══════════════════════════════════════════════════════════════════
     2. CHARTS — replacement drawers (same signatures and returns)
     ══════════════════════════════════════════════════════════════════ */
  const DPR = () => window.devicePixelRatio || 1;
  const patCache = new Map();
  function hatch(ctx, color, kind, alpha) {
    const key = color + kind + alpha + DPR();
    if (patCache.has(key)) return patCache.get(key);
    const d = DPR(), s = Math.round(6 * d);
    const c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.strokeStyle = color; g.globalAlpha = alpha == null ? 1 : alpha; g.lineWidth = Math.max(1, d * 0.9);
    g.beginPath();
    if (kind === 'diag' || kind === 'cross') { g.moveTo(-1, s + 1); g.lineTo(s + 1, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1); }
    if (kind === 'cross') { g.moveTo(-1, -1); g.lineTo(s + 1, s + 1); }
    if (kind === 'dots') { g.fillStyle = color; g.arc(s / 2, s / 2, d * 0.9, 0, Math.PI * 2); g.fill(); }
    g.stroke();
    const p = ctx.createPattern(c, 'repeat');
    if (p && p.setTransform && typeof DOMMatrix === 'function') p.setTransform(new DOMMatrix().scale(1 / d));
    patCache.set(key, p);
    return p;
  }
  function phonePad() {
    const w = ($('forecast-chart-container') || {}).clientWidth || 600;
    if (TV) { FC_PAD.left = 56; FC_PAD.right = 52; }
    else if (w < 600) { FC_PAD.left = 34; FC_PAD.right = 30; }
    else { FC_PAD.left = 44; FC_PAD.right = 40; }
  }

  // Night bands with a short dawn/dusk ramp; light on the world, not data.
  _fcDrawNightShading = function (ctx, common, plotLeft, plotW, top, height) {
    const x = t => _fcXFor(new Date(t), common, plotLeft, plotW);
    const R = plotLeft + plotW;
    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, height); ctx.clip();
    for (let k = -1; k <= common.dayCount; k++) {
      const day = new Date(common.firstDay); day.setDate(day.getDate() + k);
      const dl = calcDaylight(LAT, LON, day);
      const nx = new Date(day); nx.setDate(nx.getDate() + 1);
      const dl2 = calcDaylight(LAT, LON, nx);
      if (!dl || !dl.sunset || !dl2 || !dl2.sunrise) continue;
      const a = x(dl.lastLight), b = x(dl2.firstLight);
      if (b < plotLeft || a > R) { /* off-chart */ } else {
        ctx.fillStyle = C.night; ctx.fillRect(a, top, b - a, height);
      }
      // twilight ramps (sunset→last light, first light→sunrise)
      const ramp = (x0, x1, rev) => {
        if (x1 < plotLeft || x0 > R) return;
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        const n = C.night;
        g.addColorStop(rev ? 1 : 0, 'rgba(0,0,0,0)'); g.addColorStop(rev ? 0 : 1, n);
        ctx.fillStyle = g; ctx.fillRect(x0, top, x1 - x0, height);
      };
      ramp(x(dl.sunset), x(dl.lastLight), false);
      ramp(x(dl2.firstLight), x(dl2.sunrise), true);
    }
    ctx.restore();
  };
  _fcDrawPastDim = function () { /* drawn after the data, as a veil — see veilPast */ };
  function veilPast(ctx, common, plotLeft, plotW, top, h) {
    const now = Date.now();
    if (now <= common.t0) return;
    const nx = Math.min(_fcXFor(new Date(now), common, plotLeft, plotW), plotLeft + plotW);
    ctx.fillStyle = C.past; ctx.fillRect(plotLeft, top, nx - plotLeft, h);
  }
  function nowTick(ctx, common, plotLeft, plotW, top, bottom, label) {
    const now = Date.now();
    if (now < common.t0 || now > common.tEnd) return null;
    const x = _fcXFor(new Date(now), common, plotLeft, plotW);
    ctx.save();
    ctx.strokeStyle = C.mag; ctx.lineWidth = 1.25; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = C.mag;
      ctx.beginPath(); ctx.moveTo(x, top + 7); ctx.lineTo(x + 4.5, top + 2); ctx.lineTo(x, top - 3); ctx.lineTo(x - 4.5, top + 2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    return x;
  }
  drawScrubberDot = function (ctx, x, y) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = C.sheet; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.restore();
  };
  function hGrid(ctx, x0, x1, y) {
    ctx.save(); ctx.strokeStyle = C.hair; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
    ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); ctx.restore();
  }
  function frame(ctx, x, y, w, h) {
    ctx.strokeStyle = C['hair-2']; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }
  const fs = px => `${TV ? Math.round(px * 1.35) : px}px ${FC_CHART_FONT}`;
  const fsb = px => `600 ${TV ? Math.round(px * 1.35) : px}px ${FC_CHART_FONT}`;

  drawSwellPanel = function (common, data) {
    const canvas = el('forecast-canvas-swell');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);
    const plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    const top = 6, usable = cssH - 10;
    const h = Math.round(usable * (TV ? 0.74 : 0.69));
    const subTop = top + h + 8, subBot = cssH - 2;
    const D = derive(data);
    const maxY = D.maxY;
    const yS = v => top + h - (Math.min(v, maxY) / maxY) * h;
    const yP = v => top + h - (Math.max(0, Math.min(24, v)) / 24) * h;
    const X = t => _fcXFor(t, common, plotLeft, plotW);
    const T = common.allTimes, L = common.lastIdx;

    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, cssW, cssH);
    _fcDrawNightShading(ctx, common, plotLeft, plotW, top, subBot - top);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, subBot - top);
    const step = maxY <= 4 ? 1 : maxY <= 8 ? 2 : 4;
    for (let v = step; v < maxY; v += step) hGrid(ctx, plotLeft, plotLeft + plotW, yS(v));

    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, h); ctx.clip();
    const area = (arr) => {
      ctx.beginPath(); ctx.moveTo(X(T[0]), yS(0));
      for (let i = 0; i <= L; i++) ctx.lineTo(X(T[i]), yS(arr[i] != null ? arr[i] : 0));
      ctx.lineTo(X(T[L]), yS(0)); ctx.closePath();
    };
    const line = (arr) => {
      ctx.beginPath(); let s = false;
      for (let i = 0; i <= L; i++) { if (arr[i] == null) { s = false; continue; } const x = X(T[i]), y = yS(arr[i]); if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y); }
    };
    // Ghost: everything out there, including swell Montauk and Block stop.
    area(D.total);
    ctx.fillStyle = hatch(ctx, C.ghost, 'diag', 1); ctx.fill();
    line(D.total); ctx.strokeStyle = C.ghost; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
    // What reaches the reef: the ink. Top-lit, like depth tint on a chart.
    area(D.reef);
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, C.sea); g.addColorStop(1, C['sea-2']);
    ctx.fillStyle = g; ctx.fill();
    line(D.reef); ctx.strokeStyle = C['sea-ink']; ctx.lineWidth = TV ? 2.5 : 2; ctx.lineJoin = 'round'; ctx.stroke();
    // Period of the lead train: ink, halo'd; dashed where that train is
    // outside the window (it is only telling you about chop then).
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const perSeg = (inWin) => {
      ctx.beginPath(); let s = false;
      for (let i = 0; i <= L; i++) {
        const p = D.per[i];
        const ok = p != null && Number.isFinite(p) && (D.perIn[i] === inWin || (i > 0 && D.perIn[i - 1] === inWin));
        if (!ok) { s = false; continue; }
        const x = X(T[i]), y = yP(p);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      }
    };
    for (const inWin of [false, true]) {
      perSeg(inWin); ctx.strokeStyle = C.halo; ctx.lineWidth = 4.5; ctx.setLineDash([]); ctx.stroke();
      perSeg(inWin); ctx.strokeStyle = C.ink; ctx.lineWidth = inWin ? 1.75 : 1.25; ctx.setLineDash(inWin ? [] : [4, 3]); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
    veilPast(ctx, common, plotLeft, plotW, top, h);

    // Axes: feet left (ink-2), seconds right (ink, matching the line).
    ctx.font = fs(TV ? 12 : 11); ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillStyle = C['ink-2'];
    for (let v = 0; v <= maxY; v += step) ctx.fillText(v === maxY ? v + 'ft' : String(v), plotLeft - 5, Math.min(Math.max(yS(v), 7), top + h - 4));
    ctx.textAlign = 'left'; ctx.fillStyle = C.ink;
    for (const v of [6, 12, 18]) ctx.fillText(v + (v === 18 ? 's' : ''), plotLeft + plotW + 5, yP(v));

    // ── Direction strip: FROM bearing against the magenta window ──
    const dMin = Math.max((WMIN + WMAX) / 2 - 110, 90), dMax = (WMIN + WMAX) / 2 + 110;
    const yD = deg => subTop + 3 + ((deg - dMin) / (dMax - dMin)) * (subBot - subTop - 6);
    ctx.fillStyle = C['mag-tint'];
    ctx.fillRect(plotLeft, yD(WMIN), plotW, yD(WMAX) - yD(WMIN));
    ctx.strokeStyle = C.mag; ctx.lineWidth = 1; ctx.setLineDash([5, 3]);
    for (const d of [WMIN, WMAX]) { ctx.beginPath(); ctx.moveTo(plotLeft, Math.round(yD(d)) + 0.5); ctx.lineTo(plotLeft + plotW, Math.round(yD(d)) + 0.5); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, subTop, plotW, subBot - subTop); ctx.clip();
    const dirLine = (dirs, gate, w) => {
      let prev = null;
      for (let i = 1; i <= L; i++) {
        const a = dirs[i - 1], b = dirs[i];
        if (a == null || b == null || !gate(i) || !gate(i - 1) || Math.abs(a - b) > 180) continue;
        const c = winClass((a + b) / 2);
        ctx.beginPath(); ctx.moveTo(X(T[i - 1]), yD(a)); ctx.lineTo(X(T[i]), yD(b));
        if (c === 'dir-in') { ctx.strokeStyle = C['sea-ink']; ctx.lineWidth = w; ctx.setLineDash([]); }
        else if (c === 'dir-edge') { ctx.strokeStyle = C['sea-ink']; ctx.lineWidth = w * 0.75; ctx.setLineDash([3, 2]); }
        else { ctx.strokeStyle = C['ink-3']; ctx.lineWidth = 1; ctx.setLineDash([1.5, 2.5]); }
        ctx.stroke();
        prev = c;
      }
      ctx.setLineDash([]);
    };
    dirLine(data.secDirs, i => data.secHeights[i] != null && data.secHeights[i] >= 1, TV ? 1.75 : 1.4);
    dirLine(data.swellDirs, () => true, TV ? 2.75 : 2.2);
    ctx.restore();
    ctx.font = fs(TV ? 11 : 10); ctx.fillStyle = C['ink-2']; ctx.textAlign = 'right';
    let lastY = -1e9;
    const lh = TV ? 15 : 12;
    for (const cp of [{ d: 135, l: 'SE' }, { d: 180, l: 'S' }, { d: 90, l: 'E' }, { d: 225, l: 'SW' }].sort((a, b) => a.d - b.d)) {
      if (cp.d < dMin || cp.d > dMax) continue;
      const y = yD(cp.d);
      if (y - lastY < lh) continue;
      ctx.fillText(cp.l, plotLeft - 5, y); lastY = y;
    }
    ctx.font = fsb(TV ? 11 : 10); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = C.halo; ctx.lineJoin = 'round';
    ctx.strokeText('WINDOW', plotLeft + 5, (yD(WMIN) + yD(WMAX)) / 2);
    ctx.fillStyle = C.mag; ctx.fillText('WINDOW', plotLeft + 5, (yD(WMIN) + yD(WMAX)) / 2);
    veilPast(ctx, common, plotLeft, plotW, subTop, subBot - subTop);
    frame(ctx, plotLeft, top, plotW, h);
    frame(ctx, plotLeft, subTop, plotW, subBot - subTop);
    nowTick(ctx, common, plotLeft, plotW, top, subBot, true);

    // Buoy observation (measured total sea): open diamond at obs time.
    const obsOk = data.obsHsFt != null && data.obsMs != null && Date.now() - data.obsMs <= BUOY_OBS_OLD_MS && data.obsMs >= common.t0;
    if (obsOk) {
      const ox = X(new Date(data.obsMs)), oy = yS(Math.min(data.obsHsFt, maxY));
      ctx.save(); ctx.beginPath(); ctx.moveTo(ox, oy - 5); ctx.lineTo(ox + 5, oy); ctx.lineTo(ox, oy + 5); ctx.lineTo(ox - 5, oy); ctx.closePath();
      ctx.fillStyle = C.sheet; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    }
    const sI = STATE.scrubberIdx;
    if (typeof sI === 'number' && sI >= 0 && sI <= L) {
      const x = X(T[sI]);
      if (D.reef[sI] != null) drawScrubberDot(ctx, x, yS(D.reef[sI]));
      if (D.per[sI] != null && Number.isFinite(D.per[sI])) drawScrubberDot(ctx, x, yP(D.per[sI]));
      const dd = D.leadDir[sI];
      if (dd != null && dd >= dMin && dd <= dMax) drawScrubberDot(ctx, x, yD(dd));
    }
    CR.swellGeom = { plotLeft, plotW, top, h, maxY };
    return { canvas, cssW, cssH, plotLeft, plotW, top, h, swellMaxY: maxY, ySwell: yS, yPeriod: yP };
  };

  drawWindPanel = function (common, data) {
    const canvas = el('forecast-canvas-wind');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);
    const plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    const top = 4, h = cssH - 8;
    const X = t => _fcXFor(t, common, plotLeft, plotW);
    const maxY = 25;
    const yW = v => top + h - (Math.min(v, maxY) / maxY) * h;
    const T = common.allTimes, L = common.lastIdx;
    const { windSpeeds: S, windDirs: Dd } = data;
    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, cssW, cssH);
    _fcDrawNightShading(ctx, common, plotLeft, plotW, top, h);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, h);
    for (const v of [10, 20]) hGrid(ctx, plotLeft, plotLeft + plotW, yW(v));
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, plotW, h); ctx.clip();
    // Quality by luminance AND pattern: offshore solid, cross hatched,
    // onshore open cross-hatch. Readable in sun and without colour.
    const fills = { off: C.good, cross: hatch(ctx, C.cross, 'diag', 1), on: hatch(ctx, C.bad, 'cross', 1), na: C.hair };
    for (let i = 0; i < L; i++) {
      const w1 = S[i] != null ? S[i] : 0, w2 = S[i + 1] != null ? S[i + 1] : 0;
      const b = windBucket(Dd[i], S[i]) || 'na';
      ctx.beginPath(); ctx.moveTo(X(T[i]), yW(0)); ctx.lineTo(X(T[i]), yW(w1)); ctx.lineTo(X(T[i + 1]), yW(w2)); ctx.lineTo(X(T[i + 1]), yW(0)); ctx.closePath();
      if (b === 'cross') { ctx.fillStyle = C['good-tint']; ctx.fill(); }
      ctx.fillStyle = fills[b]; ctx.fill();
    }
    ctx.beginPath(); let s = false;
    for (let i = 0; i <= L; i++) { if (S[i] == null) { s = false; continue; } const x = X(T[i]), y = yW(S[i]); if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y); }
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.25; ctx.stroke();
    ctx.restore();
    veilPast(ctx, common, plotLeft, plotW, top, h);
    ctx.font = fs(TV ? 12 : 11); ctx.fillStyle = C['ink-2']; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('0', plotLeft - 5, yW(0) - 4); ctx.fillText('10', plotLeft - 5, yW(10)); ctx.fillText('20', plotLeft - 5, yW(20));
    ctx.textAlign = 'left'; ctx.fillText('mph', plotLeft + plotW + 5, yW(20));
    frame(ctx, plotLeft, top, plotW, h);
    nowTick(ctx, common, plotLeft, plotW, top, top + h, false);
    const sI = STATE.scrubberIdx;
    if (typeof sI === 'number' && sI >= 0 && sI <= L && S[sI] != null) drawScrubberDot(ctx, X(T[sI]), yW(S[sI]));
    return { canvas, cssW, cssH, plotLeft, plotW, top, h, windMaxY: maxY };
  };

  drawTidePanel = function (common, data) {
    const canvas = el('forecast-canvas-tide');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);
    const plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    const top = 4, h = cssH - 8;
    const X = t => _fcXFor(t, common, plotLeft, plotW);
    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, cssW, cssH);
    _fcDrawNightShading(ctx, common, plotLeft, plotW, top, h);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, h);
    const { tidePred, tideHiLo } = data;
    let tMin = 0, tMax = 1, yT = null;
    const pts = (tidePred || []).map(p => ({ t: new Date(p.t).getTime(), v: parseFloat(p.v) }))
      .filter(p => Number.isFinite(p.v) && p.t >= common.t0 - 3600e3 && p.t <= common.tEnd + 3600e3);
    if (pts.length > 1) {
      tMin = Math.min(...pts.map(p => p.v)); tMax = Math.max(...pts.map(p => p.v));
      const pad = 0.12 * (tMax - tMin || 1);
      yT = v => top + 12 + (1 - (v - (tMin - pad)) / ((tMax + pad) - (tMin - pad))) * (h - 26);
      // Incoming daylight windows (low → high, clipped to daylight): the
      // sessions the crew actually surfs. Shoal-blue bands.
      ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, plotW, h); ctx.clip();
      for (let k = 0; k < common.dayCount; k++) {
        const day = new Date(common.firstDay); day.setDate(day.getDate() + k);
        for (const w of dayWindows(day).windows) {
          if (!w.daylight) continue;
          const a = X(new Date(w.start)), b = X(new Date(w.end));
          ctx.fillStyle = C['shoal-2']; ctx.globalAlpha = 0.55; ctx.fillRect(a, top, b - a, h); ctx.globalAlpha = 1;
        }
      }
      // Water under the curve, like a tint band; the curve in tide blue.
      ctx.beginPath(); ctx.moveTo(X(new Date(pts[0].t)), top + h);
      for (const p of pts) ctx.lineTo(X(new Date(p.t)), yT(p.v));
      ctx.lineTo(X(new Date(pts[pts.length - 1].t)), top + h); ctx.closePath();
      ctx.fillStyle = C.shoal; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); pts.forEach((p, i) => { const x = X(new Date(p.t)), y = yT(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = C.tide; ctx.lineWidth = TV ? 2.5 : 2; ctx.stroke();
      ctx.restore();
      veilPast(ctx, common, plotLeft, plotW, top, h);
      // Lows: daylight lows labelled (time), dark lows a faint tick only.
      const lows = (tideHiLo || []).filter(p => p.type === 'L').map(p => ({ t: new Date(p.t).getTime(), v: parseFloat(p.v) }))
        .filter(p => p.t >= common.t0 && p.t <= common.tEnd && Number.isFinite(p.v));
      let lastLabelX = -1e9;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const lo of lows) {
        const x = X(new Date(lo.t)), y = yT(lo.v);
        const ph = phaseAt(lo.t), lit = ph === 'day';
        ctx.fillStyle = lit ? C.ink : C['ink-3'];
        ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x - 3.5, y + 9); ctx.lineTo(x + 3.5, y + 9); ctx.closePath(); ctx.fill();
        const lbl = clock(lo.t, 'short');
        ctx.font = lit ? fsb(TV ? 12 : 11) : fs(TV ? 11 : 10);
        const wpx = ctx.measureText(lbl).width + 6;
        if (lit && x - lastLabelX > wpx && x > plotLeft + wpx / 2 && x < plotLeft + plotW - wpx / 2) {
          ctx.fillText(lbl, x, Math.min(y + 10, top + h - (TV ? 15 : 13)));
          lastLabelX = x;
        }
      }
    }
    if (yT) {
      ctx.font = fs(TV ? 12 : 11); ctx.fillStyle = C['ink-2']; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const f = v => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(1);
      ctx.fillText(f(tMax) + 'ft', plotLeft - 5, yT(tMax));
      ctx.fillText(f(tMin), plotLeft - 5, yT(tMin));
    }
    frame(ctx, plotLeft, top, plotW, h);
    nowTick(ctx, common, plotLeft, plotW, top, top + h, false);
    const sI = STATE.scrubberIdx;
    if (yT && typeof sI === 'number' && sI >= 0 && sI <= common.lastIdx) {
      const tt = tideAt(common.allTimes[sI].getTime());
      if (tt) drawScrubberDot(ctx, X(common.allTimes[sI]), yT(tt.v));
    }
    return { canvas, cssW, cssH, plotLeft, plotW, top, h, tideMin: tMin, tideMax: tMax };
  };

  // Day header: weekday + date, today in magenta, the selected day inked.
  renderDayLabels = function (common) {
    const host = el('forecast-day-header');
    if (!host) return;
    host.replaceChildren();
    const W = host.clientWidth;
    const plotW = W - FC_PAD.left - FC_PAD.right;
    if (W <= 0 || plotW <= 0) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const sel = STATE.forecastChart && STATE.scrubberIdx >= 0 && STATE.forecastChart.times[STATE.scrubberIdx];
    for (let k = 0; k < common.dayCount; k++) {
      const d0 = new Date(common.firstDay); d0.setDate(d0.getDate() + k);
      const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
      const a = Math.max(_fcXFor(d0, common, FC_PAD.left, plotW), FC_PAD.left);
      const b = Math.min(_fcXFor(d1, common, FC_PAD.left, plotW), FC_PAD.left + plotW);
      if (b - a < 18) continue;
      const span = document.createElement('button');
      span.type = 'button';
      span.className = 'forecast-day-label cr-dl' + (sameDay(d0, today) ? ' is-today' : '') + (sel && sameDay(d0, sel) ? ' is-sel' : '');
      span.innerHTML = b - a >= 60 ? `<b>${dayShort(d0)}</b> ${d0.getDate()}` : `<b>${dayShort(d0).slice(0, b - a >= 34 ? 3 : 1)}</b>`;
      span.style.left = ((a + b) / 2) + 'px';
      span.style.width = (b - a) + 'px';
      span.addEventListener('click', () => jumpToDay(d0));
      host.appendChild(span);
    }
  };

  // The "now" marker is drawn statically on the charts (nowTick); the
  // 10 fps pulse overlay goes (M7): nothing on this page loops.
  startNowPulse = function () {
    const ov = el('forecast-now-overlay');
    if (ov) { const c = ov.getContext('2d'); c.clearRect(0, 0, ov.width, ov.height); }
  };

  /* ══════════════════════════════════════════════════════════════════
     3. WEB FLOW
     ══════════════════════════════════════════════════════════════════ */
  const CR = window.CR = { swellGeom: null, buoy: null };

  // ── Selecting an hour: the single object every panel follows ──
  function selectIdx(i, persist) {
    const cs = STATE.forecastChart;
    if (!cs || i == null || i < 0) return;
    i = Math.max(0, Math.min(cs.times.length - 1, i));
    STATE.scrubberIdx = i;
    if (persist !== false) {
      try {
        const t = cs.times[i];
        sessionStorage.setItem('lcc-scrubber-hour', `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}T${pad2(t.getHours())}:00`);
      } catch (_) {}
    }
    applyScrubberToHour(i);
  }
  CR.selectIdx = selectIdx;
  function jumpToDay(d0) {
    const cs = STATE.forecastChart;
    if (!cs) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d0); day.setHours(0, 0, 0, 0);
    const { windows, dl } = dayWindows(day);
    const w = windows.find(x => x.daylight && x.end > Date.now());
    let t;
    if (sameDay(day, today) && (!w || w.start <= Date.now())) t = w && w.end > Date.now() ? Date.now() : (w ? w.start : Date.now());
    else t = w ? w.start : (dl.sunrise ? dl.sunrise.getTime() + 2 * 3600e3 : day.getTime() + 9 * 3600e3);
    // Facts first: land on the daylight low that opens the window (the
    // card's own "low" line); the model's best hour stays a labelled note.
    selectIdx(findHourIndexForTime(t, cs));
  }
  CR.jumpToDay = jumpToDay;
  function jumpLow(dir) {
    const cs = STATE.forecastChart, fd = STATE.forecastData;
    if (!cs || !fd) return;
    const cur = cs.times[STATE.scrubberIdx >= 0 ? STATE.scrubberIdx : 0].getTime();
    const lows = (fd.tideHiLo || []).filter(p => p.type === 'L').map(p => new Date(p.t).getTime())
      .filter(t => t >= cs.t0 && t <= cs.tEnd && phaseAt(t) === 'day').sort((a, b) => a - b);
    const tgt = dir > 0 ? lows.find(t => t > cur + 30 * 60e3) : lows.reverse().find(t => t < cur - 30 * 60e3);
    if (tgt != null) selectIdx(findHourIndexForTime(tgt, cs));
  }

  function buildWeb() {
    // ---- Header: one line of identity + freshness, then the tabs ----
    const head = mk('header', { id: 'cr-head' });
    head.innerHTML =
      `<div class="cr-head-row">` +
        `<a class="cr-brand" href="./" aria-label="LetsCheckChoc">${roseSVG({ detail: 'lite', cls: 'cr-brand-rose', var: false })}` +
          `<span class="cr-brand-txt"><span class="cr-brand-name">LetsCheckChoc</span><span class="cr-brand-sub">Chocomount · Fishers I., N.Y.</span></span></a>` +
        `<span class="cr-fresh" id="cr-fresh"><span class="cr-pilot" id="cr-pilot"></span><span id="cr-fresh-slot"></span><button type="button" class="cr-refresh" id="cr-refresh" aria-label="Refresh">${ICON.refresh}</button></span>` +
        `<span class="cr-auth" id="cr-auth-slot"></span>` +
      `</div>` +
      `<div class="cr-head-tabs" id="cr-tabs-slot"></div>` +
      `<div class="cr-ladder" aria-hidden="true"></div>`;
    const appEl = $('app');
    appEl.insertBefore(head, appEl.firstChild);
    $('cr-fresh-slot').appendChild($('header-update-time'));
    $('cr-auth-slot').appendChild($('auth-bar'));
    $('cr-tabs-slot').appendChild($('tab-bar'));
    const tabTxt = { forecast: 'Forecast', regression: 'My Model', surflog: 'Log' };
    document.querySelectorAll('#tab-bar .tab-btn').forEach(b => { if (tabTxt[b.dataset.tab]) b.textContent = tabTxt[b.dataset.tab]; });
    const surfBtn = document.querySelector('#tab-bar [data-tab="surflog"]');
    const regBtn = document.querySelector('#tab-bar [data-tab="regression"]');
    if (surfBtn && regBtn) regBtn.parentNode.insertBefore(surfBtn, regBtn);
    $('cr-refresh').addEventListener('click', () => {
      $('cr-fresh').classList.add('is-busy');
      if (STATE.selectedBuoy) Promise.resolve(loadAllData(STATE.selectedBuoy)).finally(() => $('cr-fresh').classList.remove('is-busy'));
    });

    // ---- Forecast view: columns (stack on phone, side by side wide) ----
    const vf = $('view-forecast');
    const colA = mk('div', { id: 'cr-col-a', class: 'cr-col' });
    const colB = mk('div', { id: 'cr-col-b', class: 'cr-col' });
    const now = mk('section', { id: 'cr-now', class: 'cr-card', 'aria-live': 'polite' });
    const week = mk('section', { id: 'cr-week-wrap', class: 'cr-card' });
    week.innerHTML = `<div class="cr-sec-head"><h2 class="cr-h">This week at Choc</h2><span class="cr-sec-note">tap a day to see it</span></div><div id="cr-week" role="list"></div>`;
    const proof = mk('section', { id: 'cr-proof' });
    const hour = mk('div', { id: 'cr-hour', class: 'cr-hour' });
    const jumps = mk('div', { id: 'cr-jumps', class: 'cr-jumps' });
    const more = mk('details', { id: 'cr-more', class: 'cr-card cr-fold' });
    more.innerHTML = `<summary><span class="cr-h">Tides, buoy &amp; light</span><span class="cr-sec-note">almanac · spectra · water</span></summary><div class="cr-fold-body"><div id="cr-almanac"></div><div id="cr-light"></div><div id="cr-spec-slot"></div></div>`;
    const src = mk('details', { id: 'cr-sources', class: 'cr-card cr-fold' });
    src.innerHTML = `<summary><span class="cr-h">Sources &amp; settings</span><span class="cr-sec-note">buoy · model · stations</span></summary><div class="cr-fold-body" id="cr-src-body"></div>`;

    vf.insertBefore(colA, vf.firstChild);
    vf.insertBefore(colB, colA.nextSibling);
    colA.append(now, $('panel-lineup'), more);
    proof.append(hour, jumps, $('panel-forecast'));
    colB.append(week, proof, src);
    $('cr-spec-slot').appendChild($('panel-spectral-row'));
    const rr = $('rose-readout'); if (rr) rr.textContent = 'Tap a petal to read that swell band.';

    const sb = $('cr-src-body');
    const row = (label, node, note) => {
      const r = mk('div', { class: 'cr-src-row' }, `<div class="cr-src-label">${label}</div>`);
      const box = mk('div', { class: 'cr-src-val' });
      if (node) box.appendChild(node);
      if (note) box.appendChild(mk('div', { class: 'cr-src-note' }, note));
      r.appendChild(box); sb.appendChild(r);
      return box;
    };
    row('Buoy', document.querySelector('.header-buoy-selector'), 'Choc reads its buoy from the repo pipeline (NDBC 44097, every 2 h). Other buoys have no live relay.');
    row('Map', $('panel-map'));
    row('Model', $('forecast-controls-bar'));
    row('Tide stations', $('panel-tide-map'));
    row('Credits', null,
      'Swell &amp; wind: Open-Meteo Marine + Weather at the forecast point 41.089°N 71.721°W (1 h swell travel to Choc). ' +
      'Tides: NOAA CO-OPS 8510719 Silver Eel Pond. Water: CO-OPS 8510560 Montauk. Buoy: NDBC 44097 Block Island. Sun: NOAA solar algorithm.');
    $('cr-sources').addEventListener('toggle', () => {
      setTimeout(() => { try { STATE.buoyMap && STATE.buoyMap.invalidateSize(); STATE.tideMap && STATE.tideMap.invalidateSize(); } catch (_) {} }, 60);
    });

    // ---- Chart section labels + legends (they say what reaches the reef) ----
    const lab = (sel, html) => { const n = document.querySelector(sel); if (n) n.innerHTML = html; };
    lab('.forecast-card-swell .forecast-section-label',
      `<span class="cr-lab">Swell</span><span class="cr-key"><i class="k-reef"></i>reaches reef</span><span class="cr-key"><i class="k-ghost"></i>blocked</span><span class="cr-key"><i class="k-per"></i>period</span>`);
    lab('.forecast-card-wind .forecast-section-label',
      `<span class="cr-lab">Wind</span><span class="cr-key"><i class="k-off"></i>offshore</span><span class="cr-key"><i class="k-cross"></i>cross</span><span class="cr-key"><i class="k-on"></i>onshore</span>`);
    lab('.forecast-card-tide .forecast-section-label',
      `<span class="cr-lab">Tide</span><span class="cr-key"><i class="k-inc"></i>incoming in daylight</span><span class="cr-key"><i class="k-low"></i>low</span>`);

    // ---- Lineup → chartlet ----
    const lf = $('lineup-frame');
    if (lf) {
      lf.insertAdjacentHTML('afterbegin', '<div class="cr-grade" id="cr-grade"></div>');
      const panel = $('panel-lineup');
      const strip = panel.querySelector('.retro-card-title-strip');
      if (strip) strip.innerHTML = '<span class="cr-h">The lineup</span><span class="cr-sec-note" id="cr-lineup-when"></span>';
    }

    // ---- Hour card (pinned) + jumps ----
    hour.innerHTML =
      `<div class="cr-hour-top">` +
        `<button type="button" class="cr-step" id="cr-prev" aria-label="One hour earlier">${ICON.prev}</button>` +
        `<button type="button" class="cr-hour-when" id="cr-hour-when" aria-label="Back to now"></button>` +
        `<button type="button" class="cr-step" id="cr-next" aria-label="One hour later">${ICON.next}</button>` +
      `</div>` +
      `<div class="cr-hour-slots" id="cr-hour-slots"></div>`;
    jumps.innerHTML =
      `<button type="button" class="cr-jump" id="cr-low-prev">${ICON.prev}<span>low</span></button>` +
      `<span class="cr-jump-note">step by hour, or by daylight low</span>` +
      `<button type="button" class="cr-jump" id="cr-low-next"><span>low</span>${ICON.next}</button>`;
    $('cr-prev').addEventListener('click', () => selectIdx((STATE.scrubberIdx | 0) - 1));
    $('cr-next').addEventListener('click', () => selectIdx((STATE.scrubberIdx | 0) + 1));
    $('cr-hour-when').addEventListener('click', () => resetScrubberToNow());
    $('cr-low-prev').addEventListener('click', () => jumpLow(-1));
    $('cr-low-next').addEventListener('click', () => jumpLow(1));

    // Footer: the chart's title-block note.
    const pf = $('page-footer');
    if (pf) pf.innerHTML = `<span>LetsCheckChoc · a chart for one reef. Data: Open-Meteo, NOAA CO-OPS, NDBC. Not for navigation.</span>`;
  }

  // ── NOW at Choc: the verdict ──
  function renderNow() {
    const host = $('cr-now');
    const cs = STATE.forecastChart;
    if (!host || !cs) return;
    const nowMs = Date.now();
    const ni = findHourIndexForTime(nowMs, cs);
    const f = hourFacts(ni);
    if (!f) return;
    const ph = phaseAt(nowMs);
    const dlToday = calcDaylight(LAT, LON, new Date());
    // After last light the useful question is the next session.
    let lead = f.lead, headTxt = `Now · ${dayShort(new Date())} ${clock(nowMs)}`, sub = '', nextNote = '';
    if (ph === 'night') {
      const tm = new Date(); tm.setHours(0, 0, 0, 0);
      if (nowMs > dlToday.lastLight.getTime()) tm.setDate(tm.getDate() + 1);
      const s = kioskDaySummary(Math.round((tm - new Date().setHours(0, 0, 0, 0)) / 86400e3));
      const dw = dayWindows(tm).windows.find(w => w.daylight);
      const dlN = calcDaylight(LAT, LON, tm);
      if (s && s.primary) {
        lead = { h: null, range: s.primary.min === s.primary.max ? String(s.primary.max) : `${s.primary.min}–${s.primary.max}`, p: s.primary.period, d: s.primary.dir, cls: s.primary.cls };
      }
      headTxt = `Next light · ${dayShort(tm)} ${clock(dlN.firstLight)}`;
      nextNote = dw ? `low ${clock(dw.low.t)} · incoming until ${clock(dw.end)}` : 'no daylight low';
      sub = `Now ${clock(nowMs)}, dark · ${fmtFt(f.lead.h)}ft @ ${f.lead.p != null ? Math.round(f.lead.p) : '–'}s ${directionLabel(f.lead.d)}`;
    } else if (ph === 'dusk') {
      sub = nowMs >= dlToday.sunset.getTime() ? `sun down ${clock(dlToday.sunset)} · last light ${clock(dlToday.lastLight)}` : `first light ${clock(dlToday.firstLight)} · sunrise ${clock(dlToday.sunrise)}`;
    }
    const cls = lead.cls || winClass(lead.d);
    const big = lead.range != null ? lead.range : fmtFt(lead.h);
    const per = lead.p != null ? Math.round(lead.p) : '–';
    const chip = cls ? `<span class="cr-chip cr-chip-${WIN_KEY[cls]}">${WIN_WORD[cls]}</span>` : '';
    const w = f.wind, t = f.tide;
    const buoyRow = buoyLine();
    host.innerHTML =
      `<div class="cr-now-head"><span class="cr-kicker">${esc(headTxt)}</span>${sub ? `<span class="cr-now-sub">${esc(sub)}</span>` : ''}</div>` +
      `<div class="cr-now-hero">` +
        `<div class="cr-now-read">` +
          `<div class="cr-hero"><span class="cr-hero-n">${big}</span><span class="cr-hero-u">ft</span><span class="cr-hero-at">@</span><span class="cr-hero-n">${per}</span><span class="cr-hero-u">s</span></div>` +
          `<div class="cr-hero-dir"><span class="cr-dir">${lead.d != null ? directionLabel(lead.d) + ' ' + Math.round(lead.d) + '°' : '—'}</span>${chip}</div>` +
          (nextNote ? `<div class="cr-hero-next">${esc(nextNote)}</div>` : '') +
        `</div>` +
        `<div class="cr-now-rose">${roseSVG({ detail: 'lite', window: true, arrowFrom: lead.d, arrowCls: cls === 'dir-out' ? 'is-out' : '', var: false })}</div>` +
      `</div>` +
      `<dl class="cr-facts">` +
        (ph !== 'night' ? (
          `<div class="cr-fact"><dt>Wind</dt><dd>${w ? `${windGlyph(w.dir, w.b, 18)}<b>${Math.round(w.mph)}mph ${directionLabel(w.dir)}</b> <span class="cr-word cr-w-${w.b}">${WIND_WORD[w.b] || ''}</span>` : '<span class="cr-missing">no wind data</span>'}</dd></div>` +
          `<div class="cr-fact"><dt>Tide</dt><dd>${t ? `<b>${t.v.toFixed(1)}ft</b> ${t.rising ? ICON.up + 'rising' : ICON.down + 'falling'}${t.next ? ` · ${t.next.type === 'H' ? 'high' : 'low'} ${clock(t.next.t)}` : ''}` : '<span class="cr-missing">no tide data</span>'}</dd></div>`
        ) : '') +
        (buoyRow ? `<div class="cr-fact"><dt>Buoy</dt><dd>${buoyRow}</dd></div>` : '') +
      `</dl>`;
  }

  function buoyLine() {
    const b = CR.buoy;
    if (!b || !b.bp || b.bp.waveHeight == null) return '';
    const band = b.band && Number.isFinite(b.band.hsM) ? b.band : null;
    const ft = band ? band.hsM * 3.28084 : b.bp.waveHeight;
    const p = band ? band.peakPeriod : b.bp.dominantPeriod;
    const d = band && band.dir != null ? Math.round(band.dir) : b.bp.meanDirection;
    const age = buoyObsAge(b.bp.obsMs);
    const arr = p ? buoySwellArrivalText(p, b.bp.obsMs) : null;
    const lvl = age ? age.level : 'fresh';
    return `<b>${fmtFt(ft)}ft @ ${p ? Math.round(p) : '–'}s ${directionLabel(d)}</b> <span class="cr-age">at ${b.bp.obsMs ? clock(b.bp.obsMs) : '—'}</span>` +
      (age ? ` <span class="cr-age cr-age-${lvl}">${age.label.replace(' ago', ' old')}</span>` : '') +
      (arr ? ` <span class="cr-arr">· ${esc(arr.replace('Choc', 'the reef'))}</span>` : '');
  }

  // ── This week at Choc (same words and numbers as Choc TV) ──
  function renderWeek() {
    const host = $('cr-week');
    const cs = STATE.forecastChart;
    if (!host || !cs || typeof kioskDaySummary !== 'function') return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const selT = STATE.scrubberIdx >= 0 ? cs.times[STATE.scrubberIdx] : null;
    const nowMs = Date.now();
    let html = '';
    for (let k = 0; k < 7; k++) {
      let s;
      try { s = kioskDaySummary(k); } catch (_) { s = null; }
      if (!s) continue;
      const day = new Date(today); day.setDate(day.getDate() + k);
      const { windows, dl } = dayWindows(day);
      const dw = windows.find(w => w.daylight);
      const passed = k === 0 && (!windows.some(w => w.daylight && w.end > nowMs) || nowMs > dl.lastLight.getTime());
      const pr = s.primary;
      const cls = pr ? pr.cls : '';
      const range = pr ? (pr.min === pr.max ? String(pr.max) : `${pr.min}–${pr.max}`) : '—';
      const lw = dw ? (s.lows.find(l => l.t === dw.low.t) || {}).wind : null;
      const lb = lw ? windBucket(lw.dir, lw.mph) : null;
      const best = bestModelIn(windows);
      const sel = selT && sameDay(selT, day);
      html += `<button type="button" role="listitem" class="cr-day${k === 0 ? ' is-today' : ''}${sel ? ' is-sel' : ''}${passed ? ' is-passed' : ''} cr-win-${WIN_KEY[cls] || 'na'}" data-k="${k}">` +
        `<span class="cr-day-name">${k === 0 ? 'Today' : k === 1 ? 'Tmrw' : day.toLocaleDateString('en-US', { weekday: 'short' })} <span class="cr-day-date">${day.getDate()}</span></span>` +
        `<span class="cr-day-hero"><b>${range}</b>ft</span>` +
        `<span class="cr-day-per">@ ${pr && pr.period != null ? pr.period : '–'}s ${pr && pr.dir != null ? directionLabel(pr.dir) : ''}</span>` +
        (cls ? `<span class="cr-chip cr-chip-${WIN_KEY[cls]} cr-chip-sm">${cls === 'dir-in' ? 'IN' : cls === 'dir-edge' ? 'EDGE' : 'OUT'}</span>` : '<span class="cr-chip cr-chip-sm cr-chip-na">—</span>') +
        `<span class="cr-day-rule"></span>` +
        (s.tidesDown ? `<span class="cr-day-low cr-missing">no tide data</span>` :
          dw ? `<span class="cr-day-low">low <b>${clock(dw.low.t, 'short')}</b></span>` : `<span class="cr-day-low cr-dim">low after dark</span>`) +
        (lw ? `<span class="cr-day-wind">${windGlyph(lw.dir, lb, 15)}${Math.round(lw.mph)} ${directionLabel(lw.dir)}</span>` : `<span class="cr-day-wind cr-dim">wind —</span>`) +
        (best ? `<span class="cr-day-model" title="your model, best hour in the window"><i>model</i> <b>${best.v.toFixed(1)}</b> ${clock(best.t, 'short')}</span>` : '') +
      `</button>`;
    }
    host.innerHTML = html;
    host.querySelectorAll('.cr-day').forEach(b => b.addEventListener('click', () => {
      const d = new Date(today); d.setDate(d.getDate() + (+b.dataset.k)); jumpToDay(d);
    }));
    // After dark, open the strip on tomorrow.
    if (phaseAt(nowMs) === 'night' && !host._scrolled) {
      const t1 = host.querySelector('[data-k="1"]');
      if (t1) { host.scrollLeft = t1.offsetLeft - 12; host._scrolled = true; }
    }
  }

  // ── The pinned hour card ──
  function renderHour(i) {
    const f = hourFacts(i);
    const when = $('cr-hour-when'), slots = $('cr-hour-slots');
    if (!f || !when) return;
    const cs = STATE.forecastChart;
    const atNow = findHourIndexForTime(Date.now(), cs) === i;
    const dh = Math.round((f.t.getTime() - Date.now()) / 3600e3);
    const dk = phaseAt(f.t.getTime());
    when.innerHTML = `<span class="cr-when-day">${dayShort(f.t)} ${f.t.getDate()}</span> <span class="cr-when-t">${clock(f.t)}</span> ` +
      (atNow ? '<span class="cr-chip cr-chip-now">NOW</span>' : `<span class="cr-when-off">${dh > 0 ? '+' : '−'}${Math.abs(dh)}h · tap for now</span>`) +
      (dk !== 'day' ? `<span class="cr-when-dark">${dk === 'night' ? 'dark' : 'twilight'}</span>` : '');
    const L = f.lead, cls = L.cls;
    const w = f.wind, t = f.tide;
    slots.innerHTML =
      `<div class="cr-slot"><span class="cr-slot-k">Swell at reef</span><span class="cr-slot-v">${fmtFt(L.h)}ft @ ${L.p != null ? Math.round(L.p) : '–'}s</span><span class="cr-slot-s">${directionLabel(L.d)} ${cls ? `<span class="cr-chip cr-chip-${WIN_KEY[cls]} cr-chip-xs">${cls === 'dir-in' ? 'IN' : cls === 'dir-edge' ? 'EDGE' : 'OUT'}</span>` : ''}</span></div>` +
      `<div class="cr-slot"><span class="cr-slot-k">Tide</span><span class="cr-slot-v">${t ? t.v.toFixed(1) + 'ft' : '—'}</span><span class="cr-slot-s">${t ? (t.rising ? ICON.up + 'rising' : ICON.down + 'falling') : 'no data'}</span></div>` +
      `<div class="cr-slot"><span class="cr-slot-k">Wind</span><span class="cr-slot-v">${w ? Math.round(w.mph) + 'mph ' + directionLabel(w.dir) : '—'}</span><span class="cr-slot-s">${w ? windGlyph(w.dir, w.b, 13) + (w.b === 'cross' ? 'cross' : w.b === 'off' ? 'offshore' : 'onshore') : ''}</span></div>` +
      `<div class="cr-slot"><span class="cr-slot-k">Your model</span><span class="cr-slot-v">${f.model != null ? f.model.toFixed(1) : '—'}</span><span class="cr-slot-s">${f.model != null ? 'of 10' : 'log more'}</span></div>`;
    const lw = $('cr-lineup-when');
    if (lw) lw.textContent = `${dayShort(f.t)} ${clock(f.t)}${atNow ? ' · now' : ''}`;
    // The lineup photo is lit by the selected hour's sun.
    const lf = $('lineup-frame');
    if (lf) lf.dataset.grade = gradeAt(atNow ? Date.now() : f.t.getTime());
    // Week strip + day labels: mark the selected day.
    document.querySelectorAll('#cr-week .cr-day').forEach(b => {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + (+b.dataset.k));
      b.classList.toggle('is-sel', sameDay(d, f.t));
    });
    document.querySelectorAll('#forecast-day-header .cr-dl').forEach((b, k) => {
      const d0 = new Date(STATE.forecastChart.firstDay); d0.setDate(d0.getDate() + k);
    });
  }

  // ── Chartlet: the lineup photo as a chart inset ──
  // Replaces drawLineupMap: the SVG is laid out in the frame's own pixels
  // so every label is real ≥12 px type, never 5 px user units.
  function drawChartlet(marine, wind, buoyParsed, hourIdx) {
    const svg = $('lineup-overlay'), fr = $('lineup-frame');
    if (!svg || !fr) return;
    const W = fr.clientWidth, Hh = fr.clientHeight;
    if (!W || !Hh) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const cx = W / 2, cy = Hh / 2;
    const i = typeof hourIdx === 'number' && hourIdx >= 0 ? hourIdx : (STATE.forecastChart ? findHourIndexForTime(Date.now(), STATE.forecastChart) : 0);
    const f = hourFacts(i);
    const R = Math.min(Hh * 0.47, W * 0.4);
    const pt = (deg, r) => [cx + Math.sin(deg * Math.PI / 180) * r, cy - Math.cos(deg * Math.PI / 180) * r];
    let s = '';
    // Graduated neatline ladder (top + left), like a chart's border scale.
    const seg = 22;
    for (let x = 0, k = 0; x < W; x += seg, k++) s += `<rect x="${x}" y="0" width="${seg}" height="5" class="${k % 2 ? 'cr-lad-a' : 'cr-lad-b'}"/>`;
    for (let y = 0, k = 0; y < Hh; y += seg, k++) s += `<rect x="0" y="${y}" width="5" height="${seg}" class="${k % 2 ? 'cr-lad-a' : 'cr-lad-b'}"/>`;
    // Place names: land upright caps, water italic (chart convention).
    s += `<text x="${Math.max(14, W * 0.04)}" y="${Hh * 0.17}" class="cr-cl-land">FISHERS ISLAND</text>`;
    s += `<text x="${W * 0.08}" y="${Hh - 12}" class="cr-cl-water">Block Island Sound</text>`;
    // Swell window: magenta wedge, edges named where they point.
    const [ax, ay] = pt(WMIN, R), [bx, by] = pt(WMAX, R);
    s += `<path class="cr-cl-win" d="M${cx} ${cy} L${ax.toFixed(1)} ${ay.toFixed(1)} A${R} ${R} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)} Z"/>`;
    s += `<path class="cr-cl-win-arc" d="M${ax.toFixed(1)} ${ay.toFixed(1)} A${R} ${R} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}"/>`;
    s += `<text x="${W - 10}" y="${(ay - 22).toFixed(1)}" text-anchor="end" class="cr-cl-mag">SW Pt (Block)</text>` +
      `<text x="${W - 10}" y="${(ay - 7).toFixed(1)}" text-anchor="end" class="cr-cl-mag cr-cl-deg">115°</text>`;
    s += `<text x="${(bx + 8).toFixed(1)}" y="${Math.min(by + 4, Hh - 8).toFixed(1)}" class="cr-cl-mag">Montauk Pt <tspan class="cr-cl-deg">158°</tspan></text>`;
    // Reef heading.
    const [rx, ry] = pt(REEF, R * 0.42);
    s += `<line x1="${cx}" y1="${cy}" x2="${rx.toFixed(1)}" y2="${ry.toFixed(1)}" class="cr-cl-reef"/>`;
    s += `<text x="${(rx - 4).toFixed(1)}" y="${(ry - 4).toFixed(1)}" class="cr-cl-reeflab" text-anchor="end">reef 335°</text>`;
    // Arrows converge on the lineup; each reading is lettered ALONG its
    // shaft, as current arrows are on a tidal-current chart.
    const arrow = (deg, len, cls, label, side) => {
      if (deg == null) return '';
      const t = deg * Math.PI / 180, ux = Math.sin(t), uy = -Math.cos(t), px = -uy, py = ux;
      const gap = 8, hl = 13, hw = 7;
      const tipX = cx + ux * gap, tipY = cy + uy * gap;
      const bX = cx + ux * (gap + hl), bY = cy + uy * (gap + hl);
      const tX = cx + ux * (gap + len), tY = cy + uy * (gap + len);
      let o = `<g class="cr-cl-arrow ${cls}">` +
        `<line x1="${bX.toFixed(1)}" y1="${bY.toFixed(1)}" x2="${tX.toFixed(1)}" y2="${tY.toFixed(1)}" class="cr-cl-shaft"/>` +
        `<path d="M${tipX.toFixed(1)} ${tipY.toFixed(1)} L${(bX + px * hw).toFixed(1)} ${(bY + py * hw).toFixed(1)} L${(bX - px * hw).toFixed(1)} ${(bY - py * hw).toFixed(1)} Z" class="cr-cl-head"/></g>`;
      if (label) {
        // midpoint of the shaft, nudged to one side, text kept upright
        const fr2 = cls.indexOf('is-lead') >= 0 ? 0.55 : 0.72;
        const mx = cx + ux * (gap + hl + (len - hl) * fr2), my = cy + uy * (gap + hl + (len - hl) * fr2);
        let ang = Math.atan2(uy, ux) * 180 / Math.PI;
        let sd = side || 1;
        if (ang > 90 || ang < -90) { ang += 180; }
        const ox = mx + px * 11 * sd, oy = my + py * 11 * sd;
        o += `<text transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) rotate(${ang.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" class="cr-cl-lab ${cls}">${label}</text>`;
      }
      return o;
    };
    if (f) {
      const L = f.lead, O = f.other;
      const lenOf = (hh, pp) => Math.max(58, Math.min(R * 1.05, Math.sqrt((hh || 0) * (hh || 0) * (pp || 1)) * 17));
      if (O && O.h != null && O.h >= 0.5 && O.d != null) {
        s += arrow(O.d, lenOf(O.h, O.p) * 0.85, 'is-sec' + (O.cls === 'dir-out' ? ' is-out' : ''), `${fmtFt(O.h)}ft @ ${O.p != null ? Math.round(O.p) : '–'}s`, labelSide(O.d, [L.d, f.wind && f.wind.dir]));
      }
      if (L && L.h != null && L.d != null) {
        s += arrow(L.d, lenOf(L.h, L.p), 'is-lead' + (L.cls === 'dir-out' ? ' is-out' : ''), `${fmtFt(L.h)}ft @ ${L.p != null ? Math.round(L.p) : '–'}s`, labelSide(L.d, [O && O.h >= 0.5 ? O.d : null, f.wind && f.wind.dir]));
      }
      if (f.wind && f.wind.dir != null) {
        s += arrow(f.wind.dir, Math.max(58, Math.min(R * 0.95, f.wind.mph * 7)), 'is-wind', `${Math.round(f.wind.mph)}mph ${f.wind.b === 'cross' ? 'cross' : f.wind.b === 'off' ? 'offshore' : 'onshore'}`, labelSide(f.wind.dir, [L && L.d, O && O.h >= 0.5 ? O.d : null]));
      }
    }
    // Lineup mark (chart "position" symbol: circle + dot).
    s += `<circle cx="${cx}" cy="${cy}" r="5.5" class="cr-cl-pos"/><circle cx="${cx}" cy="${cy}" r="1.8" class="cr-cl-pos-dot"/>`;
    // Corner coordinates.
    s += `<text x="${W - 6}" y="16" text-anchor="end" class="cr-cl-coord">41°16.5′N  71°57.8′W</text>`;
    svg.innerHTML = s;
  }
  drawLineupMap = drawChartlet;

  // ── Almanac: 7-day tide table + light + water ──
  function renderAlmanac() {
    const host = $('cr-almanac');
    const fd = STATE.forecastData;
    if (!host || !fd) return;
    const ev = (fd.tideHiLo || []).map(p => ({ t: new Date(p.t).getTime(), type: p.type, v: parseFloat(p.v) })).filter(e => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let rows = '';
    for (let k = 0; k < 7; k++) {
      const d0 = new Date(today); d0.setDate(d0.getDate() + k);
      const d1 = d0.getTime() + 86400e3;
      const evs = ev.filter(e => e.t >= d0.getTime() && e.t < d1);
      const dl = calcDaylight(LAT, LON, d0);
      const cell = e => {
        if (!e) return '<td class="cr-al-e"></td>';
        const lit = e.t >= dl.sunrise.getTime() && e.t <= dl.sunset.getTime();
        const past = e.t < Date.now();
        return `<td class="cr-al-e ${e.type === 'L' ? 'is-low' : 'is-high'}${lit ? ' is-lit' : ''}${past ? ' is-past' : ''}"><span class="cr-al-t">${clock(e.t, 'short')}</span><span class="cr-al-v">${e.v >= 0 ? '' : '−'}${Math.abs(e.v).toFixed(1)}</span></td>`;
      };
      const cells = [0, 1, 2, 3].map(j => cell(evs[j])).join('');
      rows += `<tr${k === 0 ? ' class="is-today"' : ''}><th scope="row"><span class="cr-al-d">${dayShort(d0)}</span> <span class="cr-al-n">${d0.getDate()}</span></th>${cells}<td class="cr-al-sun">${clock(dl.sunrise, 'short')}<br>${clock(dl.sunset, 'short')}</td></tr>`;
    }
    host.innerHTML =
      `<h3 class="cr-h3">Tide table · Silver Eel Pond <span class="cr-sec-note">times EDT · heights ft above MLLW · <b>bold</b> = low in daylight</span></h3>` +
      `<div class="cr-al-wrap"><table class="cr-al"><thead><tr><th>Day</th><th colspan="4">High &amp; low water</th><th>Sun</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    const lt = $('cr-light');
    const dl = calcDaylight(LAT, LON, new Date());
    const water = ($('val-water-temp') || {}).textContent || '—';
    if (lt) lt.innerHTML =
      `<div class="cr-lt"><span class="cr-lt-k">First light</span><span class="cr-lt-v">${clock(dl.firstLight)}</span></div>` +
      `<div class="cr-lt"><span class="cr-lt-k">Sunrise</span><span class="cr-lt-v">${clock(dl.sunrise)}</span></div>` +
      `<div class="cr-lt"><span class="cr-lt-k">Sunset</span><span class="cr-lt-v">${clock(dl.sunset)}</span></div>` +
      `<div class="cr-lt"><span class="cr-lt-k">Last light</span><span class="cr-lt-v">${clock(dl.lastLight)}</span></div>` +
      `<div class="cr-lt"><span class="cr-lt-k">Water</span><span class="cr-lt-v">${esc(water)}</span></div>`;
  }

  // ── Freshness pilot (one status grammar with Choc TV) ──
  function renderFresh() {
    const hdr = $('header-update-time'), p = $('cr-pilot');
    if (!hdr || !p) return;
    const stale = hdr.classList.contains('is-stale');
    p.className = 'cr-pilot' + (stale ? ' is-stale' : '');
    hdr.textContent = hdr.textContent.replace(/^Updated /, '');
  }

  let pending = 0;
  function schedule() {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      try { renderNow(); renderWeek(); renderAlmanac(); renderFresh(); renderWhenChips(); if (STATE.scrubberIdx >= 0) renderHour(STATE.scrubberIdx); }
      catch (e) { console.warn('[cr] render', e); }
    });
  }
  CR.schedule = schedule;

  /* ══════════════════════════════════════════════════════════════════
     GATE — a Notice to Mariners on the chart
     ══════════════════════════════════════════════════════════════════ */
  function buildGate() {
    const ov = $('gate-overlay'), card = $('gate-card');
    if (!ov || !card) return;
    ov.insertAdjacentHTML('afterbegin', `<div class="cr-gate-chart" aria-hidden="true">${coastSVG('cr-gate-coast')}${roseSVG({ detail: 'full', cls: 'cr-gate-rose' })}` +
      `<span class="cr-gate-water">Block Island Sound</span><span class="cr-gate-land">FISHERS ISLAND</span></div>`);
    const tb = card.querySelector('.w1-titlebar');
    if (tb) tb.innerHTML = '<span class="cr-notice-k">Notice to mariners</span><span class="cr-notice-n">No. 335</span>';
    const icon = card.querySelector('.gate-icon');
    if (icon) icon.innerHTML = ANCHOR;
    const q = card.querySelector('#gate-question h2');
    if (q) q.innerHTML = 'Are you coming by <em>boat</em> today?';
    const gh = $('gate-go-home');
    if (gh) gh.innerHTML = 'Go home.';
    // Remember "No" for the day (IA-10): the joke stays, the toll goes.
    try {
      const k = new Date(); const tag = `${k.getFullYear()}-${k.getMonth() + 1}-${k.getDate()}`;
      if (localStorage.getItem('lcc-gate-day') === tag) sessionStorage.setItem('lcc-gate', 'no');
      const no = $('gate-no');
      if (no) no.addEventListener('click', () => { try { localStorage.setItem('lcc-gate-day', tag); } catch (_) {} });
    } catch (_) {}
  }

  /* ══════════════════════════════════════════════════════════════════
     LOG BOOK — the Surf Log tab as a ship's log
     ══════════════════════════════════════════════════════════════════ */
  function buildLog() {
    const form = $('surflog-form');
    if (!form) return;
    // When: chips over the native picker (wet hands, one tap).
    const dtField = $('sl-datetime') && $('sl-datetime').closest('.sl-field');
    if (dtField) {
      const chips = mk('div', { class: 'cr-when-chips', id: 'cr-when-chips' });
      dtField.insertBefore(chips, dtField.querySelector('input'));
      dtField.querySelector('label').textContent = 'When';
    }
    // Ratings: 1–10 tap cells drive the real range inputs (app.js keeps
    // its untouched-state guard; a cell tap dispatches 'input').
    document.querySelectorAll('.sl-slider-group').forEach(g => {
      const input = g.querySelector('input[type=range]');
      if (!input) return;
      const row = mk('div', { class: 'cr-rate', 'data-for': input.id, role: 'radiogroup', 'aria-label': g.querySelector('label').textContent.replace(/\d+$/, '').trim() });
      for (let v = 1; v <= 10; v++) row.appendChild(mk('button', { type: 'button', class: 'cr-rcell', 'data-v': v, role: 'radio', 'aria-label': String(v) }, String(v)));
      g.insertBefore(row, input);
      const desc = g.querySelector('.sl-slider-desc');
      if (desc) g.insertBefore(desc, row);
      row.addEventListener('click', ev => {
        const c = ev.target.closest('.cr-rcell');
        if (!c) return;
        input.value = c.dataset.v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        paintRate(row, input);
      });
      input.addEventListener('input', () => paintRate(row, input));
    });
    const lbl = { 'sl-size': 'Size', 'sl-wind-quality': 'Wind', 'sl-ride-quality': 'Ride' };
    for (const id in lbl) { const l = document.querySelector(`label[for="${id}"]`); if (l && l.firstChild) l.firstChild.textContent = lbl[id] + ' '; }
    // Photos first: camera/library as the main action; URL under "more".
    const up = form.querySelector('.sl-btn-file');
    const notes = $('sl-notes');
    if (up && notes) {
      // Notes and the camera share one row: a session is a line and a photo.
      up.firstChild.textContent = '';
      up.insertAdjacentHTML('afterbegin', '<svg class="cr-cam" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h4l2-2.5h6L17 7h4v12H3z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>Photo</span>');
      up.setAttribute('aria-label', 'Add a photo from camera or library');
      const rowN = mk('div', { class: 'cr-notes-row' });
      notes.parentNode.insertBefore(rowN, notes);
      rowN.append(notes, up);
      const pf = form.querySelector('.sl-photo-input-row');
      if (pf) pf.closest('.sl-field').classList.add('cr-photo-field');
    }
    const save = $('sl-save-btn');
    if (save) save.textContent = 'Enter in log';
    const lookup = $('sl-lookup-btn');
    if (lookup) lookup.textContent = 'Look up conditions';
    const hint = form.querySelector('#sl-conditions-display .sl-hint');
    if (hint) hint.textContent = 'Swell, wind & tide fill in from the archive for the time you pick.';
    const fs2 = $('panel-surflog-form') && $('panel-surflog-form').querySelector('legend');
    if (fs2) fs2.textContent = 'Log a session';
    const pl = $('panel-surflog-entries') && $('panel-surflog-entries').querySelector('legend');
    if (pl) pl.textContent = 'The log';
    // Auto look-up when the time changes (IA-07), still via app.js.
    const dt = $('sl-datetime');
    if (dt) dt.addEventListener('change', () => { const b = $('sl-lookup-btn'); if (b && !b.disabled) b.click(); });
    const note = document.querySelector('#panel-surflog-entries .sl-crowdsource-note');
    if (note) note.innerHTML = 'The crew\'s log. Your model learns from <b>your</b> entries only. <button type="button" class="cr-filter-btn" id="cr-filter-btn">Filter</button>';
    const fb = $('cr-filter-btn');
    if (fb) fb.addEventListener('click', () => { const f = $('sl-filters'); if (f) f.classList.toggle('is-open'); });
    const cards = mk('div', { id: 'cr-logcards', class: 'cr-logcards' });
    const wrap = document.querySelector('#panel-surflog-entries .surflog-table-wrap');
    if (wrap) wrap.parentNode.insertBefore(cards, wrap);
  }
  // Conditions confirmed in one rounded surf-terms line (IA-07), not a
  // debug readout. Missing stays missing: "wind —", "tide —".
  renderConditionsDisplay = function (cond) {
    const display = $('sl-conditions-display');
    if (!display || !cond || !cond.swell) return;
    const sw = cond.swell, cl = winClass(sw.direction);
    const r1 = v => (v == null || !isFinite(v) ? '–' : (Math.round(v * 10) / 10).toFixed(1));
    const w = cond.wind || {};
    const t = cond.tide;
    const src = cond.source === 'openmeteo-archive' ? 'Open-Meteo archive' : /ndbc/.test(cond.source || '') ? 'NDBC 44097, measured' : 'Open-Meteo';
    display.innerHTML =
      `<div class="cr-cond-line"><b>${r1(sw.height)}ft @ ${Math.round(sw.period || 0)}s ${directionLabel(sw.direction)}</b>` +
      (cl ? ` <span class="cr-chip cr-chip-xs cr-chip-${WIN_KEY[cl]}">${cl === 'dir-in' ? 'IN' : cl === 'dir-edge' ? 'EDGE' : 'OUT'}</span>` : '') +
      (sw.secondary ? ` <span class="cr-dim">+ ${r1(sw.secondary.height)}ft @ ${Math.round(sw.secondary.period || 0)}s ${directionLabel(sw.secondary.direction)}</span>` : '') +
      ` · wind ${w.speed != null && w.direction != null ? Math.round(w.speed) + 'mph ' + directionLabel(w.direction) : '—'}` +
      ` · tide ${t && t.height != null ? r1(t.height) + 'ft ' + (t.stage === 'rising' ? ICON.up + 'rising' : t.stage === 'falling' ? ICON.down + 'falling' : esc(t.stage || '')) : '—'}</div>` +
      `<div class="cr-cond-src">${esc(src)}${cond.swellLagHours > 0 ? ` · swell read ~${Math.round(cond.swellLagHours * 10) / 10} h earlier at the buoy` : ''}</div>`;
  };
  function paintRate(row, input) {
    const v = +input.value, touched = !input.classList.contains('w1-untouched');
    row.querySelectorAll('.cr-rcell').forEach(c => {
      const cv = +c.dataset.v;
      c.classList.toggle('is-on', touched && cv <= v);
      c.classList.toggle('is-val', touched && cv === v);
      c.setAttribute('aria-checked', touched && cv === v ? 'true' : 'false');
    });
  }
  function renderWhenChips() {
    const host = $('cr-when-chips');
    if (!host) return;
    const now = new Date();
    const { windows } = dayWindows(now);
    const lo = windows.find(w => w.daylight && w.low.t <= now.getTime());
    const sig = (lo ? lo.low.t : 0) + ':' + now.getHours();
    if (host.dataset.sig === sig) return;
    host.dataset.sig = sig;
    const on = (host.querySelector('.cr-wchip.is-on') || {}).dataset;
    const opts = [];
    if (lo) opts.push({ k: 'low', t: lo.low.t, l: `Low · ${clock(lo.low.t)}` });
    opts.push({ k: 'now', t: now.getTime(), l: 'Now' });
    opts.push({ k: '2h', t: now.getTime() - 2 * 3600e3, l: '2 h ago' });
    opts.push({ k: 'other', t: null, l: 'Other…' });
    const cur = on ? on.k : 'now';
    host.innerHTML = opts.map(o => `<button type="button" class="cr-wchip${o.k === cur ? ' is-on' : ''}" data-k="${o.k}" data-t="${o.t || ''}">${esc(o.l)}</button>`).join('');
    if (host._wired) return;
    host._wired = true;
    host.addEventListener('click', ev => {
      const b = ev.target.closest('.cr-wchip');
      if (!b) return;
      host.querySelectorAll('.cr-wchip').forEach(x => x.classList.toggle('is-on', x === b));
      const dt = $('sl-datetime');
      if (b.dataset.k === 'other') { dt.classList.add('is-open'); try { dt.showPicker && dt.showPicker(); } catch (_) {} dt.focus(); return; }
      dt.classList.remove('is-open');
      const d = new Date(+b.dataset.t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      dt.value = d.toISOString().slice(0, 16);
      dt.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function renderLogCards() {
    const host = $('cr-logcards');
    if (!host) return;
    const isInc = e => !!(window._llcIsLogEntryIncomplete && window._llcIsLogEntryIncomplete(e));
    const entries = [...(STATE.surfLog || [])].sort((a, b) => (isInc(b) - isInc(a)) || (new Date(b.timestamp) - new Date(a.timestamp)));
    const pips = v => { let s = ''; for (let k = 1; k <= 10; k++) s += `<i${k <= v ? ' class="on"' : ''}></i>`; return `<span class="cr-pips">${s}</span>`; };
    host.innerHTML = entries.map(e => {
      const d = new Date(e.timestamp);
      const r = e.ratings || {};
      const avg = ((r.size || 0) + (r.windQuality || 0) + (r.rideQuality || 0)) / 3;
      const c = e.conditions;
      const own = e.userId === window._fbUserId;
      let cond = '<span class="cr-missing">conditions pending</span>';
      if (c && c.swell) {
        const cl = winClass(c.swell.direction);
        cond = `${fmtFt(c.swell.height)}ft @ ${Math.round(c.swell.period || 0)}s ${directionLabel(c.swell.direction)}` +
          (cl ? ` <span class="cr-chip cr-chip-xs cr-chip-${WIN_KEY[cl]}">${cl === 'dir-in' ? 'IN' : cl === 'dir-edge' ? 'EDGE' : 'OUT'}</span>` : '') +
          (c.tide && c.tide.height != null ? ` · tide ${c.tide.height.toFixed(1)}ft ${c.tide.stage === 'rising' ? ICON.up : ICON.down}` : '') +
          (c.wind && c.wind.speed != null ? ` · ${Math.round(c.wind.speed)}mph ${directionLabel(c.wind.direction)}` : '');
      }
      const ph = (e.photos || []).map(p => safeUrl(photoUrl(p))).filter(Boolean)[0];
      return `<article class="cr-entry${isInc(e) ? ' is-inc' : ''}${own ? ' is-own' : ''}">` +
        `<div class="cr-entry-date"><span class="cr-entry-d">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><span class="cr-entry-y">${d.getFullYear()}</span><span class="cr-entry-t">${clock(d, 'short')}</span></div>` +
        `<div class="cr-entry-body">` +
          `<div class="cr-entry-top"><span class="cr-entry-avg"><b>${avg.toFixed(1)}</b></span>` +
            `<span class="cr-entry-r"><span>size</span>${pips(r.size)}</span><span class="cr-entry-r"><span>wind</span>${pips(r.windQuality)}</span><span class="cr-entry-r"><span>ride</span>${pips(r.rideQuality)}</span></div>` +
          `<div class="cr-entry-cond">${cond}</div>` +
          (e.notes ? `<div class="cr-entry-note">${esc(String(e.notes).slice(0, 90))}</div>` : '') +
          `<div class="cr-entry-foot"><span class="cr-entry-who">${own ? 'you' : esc(e.displayName || 'crew')}</span>` +
            (isInc(e) ? '<span class="cr-entry-flag">incomplete — not in your model</span>' : '') +
            (own ? `<button type="button" class="cr-entry-btn" data-edit="${esc(e.id)}">Edit</button>` : '') + `</div>` +
        `</div>` +
        (ph ? `<img class="cr-entry-ph" src="${ph}" alt="" loading="lazy">` : '') +
      `</article>`;
    }).join('');
    host.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editLogEntry(b.dataset.edit); window.scrollTo({ top: 0 }); }));
  }

  /* ══════════════════════════════════════════════════════════════════
     Wiring (web)
     ══════════════════════════════════════════════════════════════════ */
  function wireWeb() {
    buildGate();
    buildWeb();
    buildLog();
    const appApply = applyScrubberToHour;
    applyScrubberToHour = function (idx) {
      appApply(idx);
      try { renderHour(idx); } catch (e) { console.warn('[cr] hour', e); }
    };
    const appDraw = drawForecastChart;
    drawForecastChart = function () {
      phonePad();
      appDraw.apply(null, arguments);
      schedule();
    };
    const appSwell = updateSwellCard;
    updateSwellCard = function (bp, marine, buoy, band) {
      CR.buoy = { bp, band };
      const r = appSwell.apply(this, arguments);
      schedule();
      return r;
    };
    for (const name of ['updateWindCard', 'updateDaylightCard', 'updateTideCard']) {
      const fn = window[name];
      if (typeof fn === 'function') window[name] = function () { const r = fn.apply(this, arguments); schedule(); return r; };
    }
    const appWater = updateWaterTempCard;
    updateWaterTempCard = async function () { const r = await appWater.apply(this, arguments); schedule(); return r; };
    const appTable = renderSurfLogTable;
    renderSurfLogTable = function () { appTable.apply(this, arguments); try { renderLogCards(); } catch (e) { console.warn('[cr] log', e); } };
    const appUpdateAuth = updateAuthUI;
    updateAuthUI = function (user) {
      appUpdateAuth.apply(this, arguments);
      const n = $('auth-user-name');
      if (n && user && !user.isAnonymous) {
        const nm = user.displayName || user.email || '';
        n.dataset.initials = nm.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        n.title = nm;
      }
      setTimeout(renderLogCards, 0);
    };
    document.addEventListener('DOMContentLoaded', () => {
      renderWhenChips();
      const s = $('auth-signin-btn');
      if (s) s.textContent = 'Sign in';
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     4. CHOC TV — the chart table at night
     ────────────────────────────────────────────────────────────────
     Same chart, the plotter's dark ("day, black back") palette by day
     and the red chart-table lamp after last light. Day panels are an
     almanac page sized in vh; the radar is the radar overlay on the
     chart, centred on a compass rose; the sweep is one CSS transform.
     ══════════════════════════════════════════════════════════════════ */
  function wireTV() {
    const TVR = { sweepEl: null, timer: null, cycle: 0, stepEnd: 0, played: 0, enterTimer: null };
    // Home-panel rotation: TODAY is never more than one panel away, and
    // the radar is a ~30 s interlude (daylight hours 1 s, dark hours ¼ s).
    const ROT = [
      { p: 'days1', ms: 30e3 }, { p: 'radar', ms: 0 }, { p: 'days1', ms: 30e3 },
      { p: 'days2', ms: 20e3 }, { p: 'days1', ms: 30e3 }, { p: 'spectral', ms: 20e3 }
    ];
    const RADAR_HOURS = 48;
    const slow = (KIOSK.rotateMs || 20e3) > 60e3; // capture/debug overrides freeze the rotation
    let ri = 0;
    KIOSK.panels = ROT.map(r => r.p);

    // ── Day selection: after the day's last daylight window, lead with tomorrow ──
    function leadOffset() {
      const now = Date.now();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { windows, dl } = dayWindows(today);
      const live = windows.some(w => w.daylight && w.end > now);
      if (dl && dl.lastLight && now > dl.lastLight.getTime()) return 1;
      if (!live && dl && dl.sunset && now > dl.sunset.getTime() - 90 * 60e3) return 1;
      return 0;
    }
    function moonSVG(date) {
      const syn = 29.530588853 * 86400e3, ep = Date.UTC(2000, 0, 6, 18, 14);
      const frac = (((date.getTime() - ep) % syn) + syn) % syn / syn;
      const lit = (1 - Math.cos(2 * Math.PI * frac)) / 2;
      const waxing = frac < 0.5;
      const r = 10, k = (1 - 2 * lit) * r; // terminator ellipse x-radius (signed)
      const sweepOuter = waxing ? 1 : 0;
      // lit limb half-circle + terminator ellipse
      const d = `M0 ${-r} A${r} ${r} 0 0 ${sweepOuter} 0 ${r} A${Math.abs(k).toFixed(2)} ${r} 0 0 ${(k > 0) === waxing ? 0 : 1} 0 ${-r} Z`;
      return `<svg class="tv-moon" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="${r}" class="tv-moon-dark"/><path d="${d}" class="tv-moon-lit"/></svg>`;
    }
    function dialHTML(w) {
      if (!w) return '<span class="tv-dial tv-dial-na">—</span>';
      const b = windBucket(w.dir, w.mph);
      const travel = w.dir != null ? (w.dir + 180) % 360 : 0;
      let ticks = '';
      for (let a = 0; a < 360; a += 30) ticks += `<line transform="rotate(${a} 50 50)" x1="50" y1="5" x2="50" y2="11"/>`;
      return `<span class="tv-dial tv-dial-${b}">` +
        `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="tv-dial-ring"/><g class="tv-dial-ticks">${ticks}</g>` +
        (w.dir != null ? `<path class="tv-dial-ptr" transform="rotate(${travel} 50 50)" d="M50 0 L59 17 L41 17 Z"/>` : '') + `</svg>` +
        `<span class="tv-dial-in"><b>${Math.round(w.mph)}</b><i>${directionLabel(w.dir)}</i></span></span>`;
    }
    function arrowHTML(deg, cls, sz) {
      if (deg == null) return '';
      const travel = Math.round((deg + 180) % 360);
      return `<span class="tv-arrow ${cls || ''} ${sz || ''}"><svg viewBox="0 0 100 140" style="transform:rotate(${travel}deg)" aria-hidden="true"><path d="M50 2 L98 62 L74 62 L74 138 L26 138 L26 62 L2 62 Z"/></svg>` +
        `<span class="tv-arrow-txt"><b>${directionLabel(deg)}</b><i>${Math.round(deg)}°</i></span></span>`;
    }
    const chip = cls => cls ? `<span class="cr-chip cr-chip-${WIN_KEY[cls]}">${WIN_WORD[cls]}</span>` : '';
    function cardHTML(k) {
      const s = kioskDaySummary(k);
      const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + k);
      const { windows, dl } = dayWindows(day);
      const now = Date.now();
      const p = s.primary, q = s.secondary;
      const range = p ? (p.min === p.max ? String(p.max) : `${p.min}–${p.max}`) : null;
      const label = k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : day.toLocaleDateString('en-US', { weekday: 'long' });
      const lowRow = (w, i) => {
        if (!w) return '<div class="tv-low tv-slot-empty"></div>';
        const lw = (s.lows.find(l => l.t === w.low.t) || {}).wind || null;
        const past = w.end < now, live = w.start <= now && w.end > now;
        if (!w.daylight) {
          return `<div class="tv-low is-dark"><span class="tv-low-k">Low</span><span class="tv-low-t">${clock(w.low.t)}</span><span class="tv-low-note">after dark</span></div>`;
        }
        return `<div class="tv-low${past ? ' is-past' : ''}${live ? ' is-live' : ''}">` +
          `<div class="tv-low-l"><span class="tv-low-k">${live ? '<span class="cr-chip cr-chip-now">NOW</span> ' : ''}Low</span>` +
            `<span class="tv-low-t">${clock(w.low.t).replace(/ (AM|PM)/, '<small>$1</small>')}</span>` +
            `<span class="tv-low-note">incoming until ${clock(w.end)}</span></div>` +
          dialHTML(lw) + `</div>`;
      };
      const lows = s.tidesDown
        ? '<div class="tv-low"><span class="tv-low-note">No NOAA tide predictions — swell is the all-day range</span></div><div class="tv-low tv-slot-empty"></div>'
        : lowRow(windows[0], 0) + lowRow(windows[1], 1);
      return `<article class="tv-day${k === leadOffset() ? ' is-lead' : ''}">` +
        `<header class="tv-day-h"><span class="tv-day-name">${label}</span><span class="tv-day-date">${day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></header>` +
        (p ? `<div class="tv-hero ${p.cls === 'dir-out' ? 'is-out' : ''}">` +
            `<div class="tv-hero-read"><div class="tv-hero-n">${range}<span class="tv-hero-u">ft</span></div>` +
            `<div class="tv-hero-p">@ <b>${p.period != null ? p.period : '–'}</b>s</div></div>` +
            arrowHTML(p.dir, p.cls === 'dir-out' ? 'is-out' : '', '') +
          `</div><div class="tv-win">${chip(p.cls)}</div>`
          : '<div class="tv-hero is-none"><span class="tv-missing">No swell data</span></div><div class="tv-win"></div>') +
        (q ? `<div class="tv-sec ${q.cls === 'dir-out' ? 'is-out' : ''}"><span class="tv-sec-r">${q.min === q.max ? q.max : q.min + '–' + q.max}ft @ ${q.period != null ? q.period : '–'}s ${directionLabel(q.dir)}</span>${q.cls === 'dir-out' ? '<span class="cr-chip cr-chip-out cr-chip-sm">OUT</span>' : q.cls === 'dir-edge' ? '<span class="cr-chip cr-chip-edge cr-chip-sm">EDGE</span>' : '<span class="cr-chip cr-chip-in cr-chip-sm">IN</span>'}</div>`
          : '<div class="tv-sec tv-slot-empty"></div>') +
        `<div class="tv-lows">${lows}</div>` +
        `<div class="tv-winds">${[['sunrise', s.sun.sunrise], ['noon', s.sun.noon], ['sunset', s.sun.sunset]].map(([k, e]) => {
          const past = e && e.t && new Date(e.t).getTime() < now;
          return `<div class="tv-wcell${past ? ' is-past' : ''}"><span class="tv-wk">${k}</span>${e && e.wind ? dialHTML(e.wind) : '<span class="tv-dial tv-dial-na">—</span>'}<span class="tv-wt">${e && k !== 'noon' ? clock(e.t).replace(/ (AM|PM)/, '<small>$1</small>') : k === 'noon' ? '12:00<small>PM</small>' : '—'}</span></div>`;
        }).join('')}</div>` +
        `<footer class="tv-sun"><span>first light <b>${dl.firstLight ? clock(dl.firstLight) : '—'}</b></span><span>last <b>${dl.lastLight ? clock(dl.lastLight) : '—'}</b></span><span class="tv-moon-w">${moonSVG(new Date(day.getTime() + 12 * 3600e3))}${s.moon.pct}%</span></footer>` +
      `</article>`;
    }

    kioskRenderDays = function () {
      const p1 = el('kiosk-days-1'), p2 = el('kiosk-days-2');
      if (!p1 || !p2) return;
      try {
        const L = leadOffset();
        const tonight = L === 1 ? tonightHTML() : '';
        p1.className = 'tv-days' + (tonight ? ' has-tonight' : '');
        p2.className = 'tv-days';
        p1.innerHTML = tonight + [L, L + 1, L + 2].map(cardHTML).join('');
        p2.innerHTML = [L + 3, L + 4, L + 5].map(cardHTML).join('');
        KIOSK.lastDaysRender = STATE.lastLoadCompletedAt || 0;
      } catch (err) { console.warn('[cr] tv days', err); }
    };
    function tonightHTML() {
      const cs = STATE.forecastChart;
      if (!cs) return '';
      const f = hourFacts(findHourIndexForTime(Date.now(), cs));
      if (!f) return '';
      const dl = calcDaylight(LAT, LON, new Date(Date.now() + 86400e3));
      return `<div class="tv-tonight"><span class="tv-tn-k">Tonight</span><span>${clock(Date.now())} · dark · ${fmtFt(f.lead.h)}ft @ ${f.lead.p != null ? Math.round(f.lead.p) : '–'}s ${directionLabel(f.lead.d)}${f.wind ? ` · wind ${Math.round(f.wind.mph)} ${directionLabel(f.wind.dir)}` : ''}</span><span class="tv-tn-r">first light <b>${clock(dl.firstLight)}</b></span></div>`;
    }

    // ── Radar on the chart ──
    function radarPaint() {
      const cv = el('kiosk-radar-canvas');
      if (!cv || !cv.clientWidth) return;
      const ctx = cv.getContext('2d');
      const { cssW: w, cssH: h } = ensureCanvasCssDims(cv, ctx);
      if (!w || !h) return;
      const fh = h / 0.85, fw = fh * KIOSK_COAST.aspect, fx = (w - fw) / 2, fy = -0.15 * fh;
      const lx = fx + KIOSK_COAST.lineup[0] * fw, ly = fy + KIOSK_COAST.lineup[1] * fh;
      const rMax = h * 0.56;
      const P = p => [fx + p[0] * fw, fy + p[1] * fh];
      const trace = pts => { pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
      const shore = KIOSK_COAST.shore, endY = fy + shore[shore.length - 1][1] * fh;
      const i = KIOSK_RADAR.idx;
      const fd = STATE.forecastData, cs = STATE.forecastChart;
      const tMs = cs && i >= 0 && cs.times[i] ? cs.times[i].getTime() : Date.now();
      const dark = phaseAt(tMs) !== 'day';
      const vh = (window.innerHeight || h / 0.62) / 100;
      ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
      // shoal band, depth curve, land, pond, coastline
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.beginPath(); trace(shore); ctx.lineTo(w, endY);
      ctx.strokeStyle = C.shoal; ctx.lineWidth = fh * 0.07; ctx.stroke();
      ctx.beginPath(); shore.forEach((p, k) => { const [x, y] = P(p); const yy = y + fh * 0.075; k ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }); ctx.lineTo(w, endY + fh * 0.075);
      ctx.strokeStyle = C['hair-2']; ctx.lineWidth = 1.2; ctx.setLineDash([7, 6]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); trace(shore); ctx.lineTo(w, endY); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = C.land; ctx.fill();
      for (const pond of KIOSK_COAST.ponds) { ctx.beginPath(); trace(pond); ctx.closePath(); ctx.fillStyle = C.shoal; ctx.fill(); }
      ctx.beginPath(); trace(shore); ctx.lineTo(w, endY); ctx.strokeStyle = C['ink-2']; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.restore();
      // chart lettering
      ctx.save();
      ctx.fillStyle = C['ink-3'];
      ctx.font = `600 ${Math.round(2.3 * vh)}px ${SERIF}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${Math.round(0.9 * vh)}px`;
      ctx.fillText('FISHERS ISLAND', 2.4 * vh, 5.4 * vh);
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${Math.round(0.4 * vh)}px`;
      ctx.font = `italic 400 ${Math.round(3 * vh)}px ${SERIF}`;
      ctx.fillStyle = C['ink-3'];
      ctx.textAlign = 'right'; ctx.fillText('Block Island Sound', w - 3 * vh, h * 0.8);
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
      ctx.restore();
      // compass rose around the lineup (true ring), range rings dotted
      ctx.save();
      ctx.strokeStyle = C.mag; ctx.fillStyle = C.mag;
      ctx.globalAlpha = dark ? 0.55 : 0.9;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(lx, ly, rMax, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(lx, ly, rMax * 0.93, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.stroke();
      for (let a = 0; a < 360; a += 2) {
        const t = a * Math.PI / 180, r0 = a % 10 === 0 ? rMax * 0.93 : a % 10 === 5 ? rMax * 0.955 : rMax * 0.975;
        ctx.beginPath(); ctx.moveTo(lx + Math.sin(t) * r0, ly - Math.cos(t) * r0); ctx.lineTo(lx + Math.sin(t) * rMax, ly - Math.cos(t) * rMax);
        ctx.lineWidth = a % 10 === 0 ? 1.4 : 0.9; ctx.stroke();
      }
      ctx.font = `500 ${Math.round(1.9 * vh)}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let a = 0; a < 360; a += 30) {
        const t = a * Math.PI / 180, r = rMax * 0.875;
        const x = lx + Math.sin(t) * r, y = ly - Math.cos(t) * r;
        if (y < 8 || y > h - 8) continue;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t); ctx.fillText(String(a).padStart(3, '0'), 0, 0); ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C['hair-2']; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      for (const k of [1, 2]) { ctx.beginPath(); ctx.arc(lx, ly, rMax * 0.93 * k / 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.restore();
      // the window: brighter the more energy it carries this hour
      const f = hourFacts(i);
      const winE = f ? Math.min(1, f.reef / 2.5) : 0;
      const c1 = (WMIN - 90) * Math.PI / 180, c2 = (WMAX - 90) * Math.PI / 180, rw = rMax * 0.93;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, rw, c1, c2); ctx.closePath();
      ctx.fillStyle = C['mag-tint']; ctx.globalAlpha = 0.6 + winE * 1.4; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.mag; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(c1) * rw, ly + Math.sin(c1) * rw); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(c2) * rw, ly + Math.sin(c2) * rw); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(lx, ly, rw, c1, c2); ctx.stroke();
      ctx.fillStyle = C.mag; ctx.font = `italic 600 ${Math.round(2.5 * vh)}px ${SERIF}`;
      const edge = (deg, r) => [lx + Math.sin(deg * Math.PI / 180) * r, ly - Math.cos(deg * Math.PI / 180) * r];
      ctx.lineWidth = 5; ctx.strokeStyle = C.paper; ctx.lineJoin = 'round';
      let [bx, by] = edge(WMIN, rMax + 1.4 * vh);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.strokeText('SW Pt (Block) 115°', bx, by + 1.2 * vh); ctx.fillText('SW Pt (Block) 115°', bx, by + 1.2 * vh);
      let [mx, my] = edge(WMAX, rMax + 1.2 * vh);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const myy = Math.min(my, h - 3.6 * vh);
      ctx.strokeText('Montauk Pt 158°', mx + 1.4 * vh, myy); ctx.fillText('Montauk Pt 158°', mx + 1.4 * vh, myy);
      ctx.restore();
      // night frames: the land and rose recede, the readings stay lit
      if (dark) { ctx.fillStyle = C.night; ctx.fillRect(0, 0, w, h); }
      // arrows
      if (f) {
        const arrow = (deg, len, o) => {
          const t = deg * Math.PI / 180, ux = Math.sin(t), uy = -Math.cos(t), px = -uy, py = ux;
          const gap = 2.6 * vh, hl = o.w * 3.2, hw = o.w * 2.2;
          const tx = lx + ux * gap, ty = ly + uy * gap, bx2 = lx + ux * (gap + hl), by2 = ly + uy * (gap + hl), ex = lx + ux * (gap + len), ey = ly + uy * (gap + len);
          ctx.save();
          ctx.strokeStyle = o.c; ctx.fillStyle = o.c; ctx.lineWidth = o.w; ctx.lineCap = o.dash ? 'butt' : 'round';
          if (o.dash) ctx.setLineDash(o.dash);
          ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx2 + px * hw, by2 + py * hw); ctx.lineTo(bx2 - px * hw, by2 - py * hw); ctx.closePath(); ctx.fill();
          if (o.label) {
            // lettered along the shaft, upright, to one side (current-chart style)
            ctx.font = `600 ${Math.round(o.fs * vh)}px ${SANS}`;
            const m = gap + hl + (len - hl) * (o.at || 0.55);
            let ang = Math.atan2(uy, ux);
            if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
            const sd = o.side || 1, off = (o.fs * 0.62 + o.w / vh * 0.6) * vh;
            ctx.translate(lx + ux * m + px * off * sd, ly + uy * m + py * off * sd);
            ctx.rotate(ang);
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 6; ctx.strokeStyle = C.paper; ctx.lineJoin = 'round';
            ctx.strokeText(o.label, 0, 0); ctx.fillText(o.label, 0, 0);
          }
          ctx.restore();
        };
        const len = (hh, pp) => Math.max(9 * vh, Math.min(rMax * 0.82, Math.sqrt((hh || 0) * (hh || 0) * (pp || 1)) * 7.5 * vh));
        const L = f.lead, O = f.other;
        const dirs = [L && L.h != null ? L.d : null, O && O.h != null && O.h >= 0.3 ? O.d : null, f.wind ? f.wind.dir : null];
        if (f.wind && f.wind.dir != null) arrow(f.wind.dir, Math.max(15 * vh, Math.min(rMax * 0.7, f.wind.mph * 1.6 * vh)), { c: C['good'], w: 0.55 * vh, dash: [0.9 * vh, 0.8 * vh], label: `${Math.round(f.wind.mph)}mph ${f.wind.b === 'cross' ? 'cross' : f.wind.b === 'off' ? 'offshore' : 'onshore'}`, fs: 2.4, at: 0.62, side: labelSide(f.wind.dir, [dirs[0], dirs[1]]) });
        if (O && O.h != null && O.d != null && O.h >= 0.3) arrow(O.d, Math.max(17 * vh, len(O.h, O.p) * 0.9), { c: O.cls === 'dir-out' ? C['ink-3'] : C['sea-ink'], w: 0.6 * vh, dash: O.cls === 'dir-out' ? [1.4 * vh, 1 * vh] : null, label: `${fmtFt(O.h)}ft @ ${O.p != null ? Math.round(O.p) : '–'}s${O.cls === 'dir-out' ? ' · out' : ''}`, fs: 2.4, at: 0.66, side: labelSide(O.d, [dirs[0], dirs[2]]) });
        if (L && L.h != null && L.d != null) arrow(L.d, len(L.h, L.p), { c: L.cls === 'dir-out' ? C['ink-2'] : C['sea-ink'], w: 1.05 * vh, dash: L.cls === 'dir-out' ? [1.6 * vh, 1 * vh] : null, label: `${fmtFt(L.h)}ft @ ${L.p != null ? Math.round(L.p) : '–'}s`, fs: 3.4, side: labelSide(L.d, [dirs[1], dirs[2]]) });
      }
      // lineup position mark
      ctx.beginPath(); ctx.arc(lx, ly, 1.1 * vh, 0, Math.PI * 2); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(lx, ly, 0.4 * vh, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
      // sweep layer geometry (CSS transform does the motion)
      const sw = TVR.sweepEl;
      if (sw) { sw.style.left = (lx - rMax * 0.93) + 'px'; sw.style.top = (ly - rMax * 0.93) + 'px'; sw.style.width = sw.style.height = (rMax * 1.86) + 'px'; }
      renderRadarTime(f);
    }
    kioskRadarPaint = radarPaint;
    kioskRadarLoop = function () { KIOSK_RADAR.raf = null; };

    // Time block: forecast position, not a clock; the across-room number.
    function renderRadarTime(f) {
      const host = el('tv-radar-time');
      const cs = STATE.forecastChart;
      if (!host || !cs || !f) return;
      const dh = Math.round((f.t.getTime() - Date.now()) / 3600e3);
      const t0 = cs.times[findHourIndexForTime(Date.now(), cs)].getTime();
      const span = RADAR_HOURS * 3600e3;
      const pos = Math.max(0, Math.min(1, (f.t.getTime() - t0) / span));
      let bands = '';
      for (let k = 0; k < 3; k++) {
        const d = new Date(t0); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + k);
        const dl = calcDaylight(LAT, LON, d);
        const a = (dl.sunrise.getTime() - t0) / span, b = (dl.sunset.getTime() - t0) / span;
        if (b > 0 && a < 1) bands += `<i style="left:${Math.max(0, a) * 100}%;width:${(Math.min(1, b) - Math.max(0, a)) * 100}%"></i>`;
      }
      const L = f.lead, cls = L.cls;
      host.innerHTML =
        `<div class="tv-rt-when"><span class="tv-rt-day">${dayShort(f.t)}</span> <span class="tv-rt-clock">${clock(f.t)}</span></div>` +
        `<div class="tv-rt-off">${Math.abs(dh) < 1 ? '<span class="cr-chip cr-chip-now">NOW</span>' : `<span class="tv-rt-plus">${dh > 0 ? '+' : '−'}${Math.abs(dh)} h</span>`}${phaseAt(f.t.getTime()) !== 'day' ? '<span class="tv-rt-dark">dark</span>' : ''}</div>` +
        `<div class="tv-rt-line"><div class="tv-rt-days">${bands}</div><span class="tv-rt-head" style="left:${(pos * 100).toFixed(2)}%"></span></div>` +
        `<div class="tv-rt-read"><span class="tv-rt-n">${fmtFt(L.h)}<small>ft</small> @ ${L.p != null ? Math.round(L.p) : '–'}<small>s</small></span>${cls ? `<span class="cr-chip cr-chip-${WIN_KEY[cls]}">${WIN_WORD[cls]}</span>` : ''}</div>`;
    }

    // Playback: next 48 h, daylight hours 1 s, dark hours 0.25 s.
    function stepDelay(idx) {
      const cs = STATE.forecastChart;
      const t = cs && cs.times[idx] ? cs.times[idx].getTime() : Date.now();
      return (phaseAt(t) === 'day' ? 1 : 0.25) * (KIOSK.radarStepMs || 1000);
    }
    kioskRadarStart = function () {
      clearTimeout(TVR.timer); clearInterval(KIOSK.radarTimer); KIOSK.radarTimer = null;
      const cs = STATE.forecastChart;
      if (cs && cs.times.length) {
        const ni = findHourIndexForTime(Date.now(), cs);
        KIOSK_RADAR.idx = ni >= 0 ? ni : 0;
        TVR.played = 0;
        STATE.scrubberIdx = KIOSK_RADAR.idx;
        applyScrubberToHour(KIOSK_RADAR.idx);
        KIOSK.radarTimer = 1; // truthy: playback running (kiosk.js checks it)
        const tick = () => {
          if (KIOSK.state !== 'paused') {
            TVR.played++;
            if (TVR.played >= RADAR_HOURS) { if (!slow) { kioskAdvance(); return; } TVR.played = 0; KIOSK_RADAR.idx = findHourIndexForTime(Date.now(), cs) - 1; }
            KIOSK_RADAR.idx = (KIOSK_RADAR.idx + 1) % cs.times.length;
            STATE.scrubberIdx = KIOSK_RADAR.idx;
            applyScrubberToHour(KIOSK_RADAR.idx);
          }
          TVR.timer = setTimeout(tick, stepDelay(KIOSK_RADAR.idx));
        };
        TVR.timer = setTimeout(tick, stepDelay(KIOSK_RADAR.idx));
      } else KIOSK_RADAR.idx = -1;
      radarPaint();
    };
    kioskRadarTick = function () {};
    kioskRadarStop = function () {
      clearTimeout(TVR.timer);
      if (!KIOSK.radarTimer) return;
      KIOSK.radarTimer = null;
      if (STATE.forecastChart) resetScrubberToNow();
    };

    // Rotation with a home panel; crossfade after the incoming panel is drawn.
    kioskScheduleNext = function () {
      clearTimeout(KIOSK.rotateTimer);
      if (KIOSK.state !== 'rotating') return;
      const r = ROT[ri % ROT.length];
      if (r.p === 'radar') return; // the radar advances itself after its 48 h pass
      KIOSK.rotateTimer = setTimeout(kioskAdvance, slow ? KIOSK.rotateMs : r.ms);
      renderPips();
    };
    kioskAdvance = function () {
      ri = (ri + 1) % ROT.length;
      KIOSK.idx = ri;
      kioskShowPanel(ROT[ri].p);
      kioskScheduleNext();
    };
    const appShow = kioskShowPanel;
    kioskShowPanel = function (name) {
      const k = ROT.findIndex((r, j) => r.p === name && j >= ri) ;
      if (k >= 0 && ROT[ri].p !== name) ri = k;
      appShow(name);
      B.classList.remove('tv-in'); void B.offsetWidth;
      // the radar fades in only after its first frame is drawn (M6)
      clearTimeout(TVR.enterTimer);
      TVR.enterTimer = setTimeout(() => { if (!RM) B.classList.add('tv-in'); }, name === 'radar' ? 60 : 0);
      renderPips();
    };
    function renderPips() {
      const host = el('tv-pips');
      if (!host) return;
      const name = { days1: 'Next 3 days', days2: 'Days 4–6', radar: 'Radar', spectral: 'Buoy now' };
      host.innerHTML = ROT.map((r, j) => `<i class="${j === ri ? 'is-on' : ''} ${r.p === 'days1' ? 'is-home' : ''}"></i>`).join('') +
        `<span class="tv-pips-l">${name[ROT[ri].p] || ''}</span>`;
    }

    // Chrome: sweep layer, time block, pips, strip lettering.
    const appChrome = kioskBuildChrome;
    kioskBuildChrome = function () {
      appChrome();
      const rad = el('kiosk-radar');
      if (rad) {
        rad.insertAdjacentHTML('beforeend', '<div class="tv-sweep" id="tv-sweep" aria-hidden="true"></div><div class="tv-radar-time" id="tv-radar-time"></div>');
        TVR.sweepEl = el('tv-sweep');
      }
      const strip = el('kiosk-status');
      if (strip) {
        const sp = strip.querySelector('.kiosk-status-spacer');
        sp && sp.insertAdjacentHTML('beforebegin', '<span class="tv-pips" id="tv-pips"></span>');
        const info = el('kiosk-info');
        if (info) info.textContent = 'Sources';
        const nx = el('kiosk-next');
        if (nx) nx.innerHTML = 'Next ' + ICON.next;
      }
      renderPips();
    };
    // Freshness: stale data reads as stale in-world (the age on the strip
    // goes amber, the cards fade one step; dead = red lamp + banner).
    const appFresh = kioskShowFreshness;
    kioskShowFreshness = function (f) {
      appFresh(f);
      B.dataset.fresh = f && f.level ? f.level : 'live';
    };
    // Clock: digits in the data face; the strip is the real time, always.
    const appStatus = kioskStatusTick;
    kioskStatusTick = function () {
      appStatus();
      const ck = el('kiosk-status-clock');
      if (ck) { const n = new Date(); ck.innerHTML = `<span class="tv-ck-d">${dayShort(n)}</span> <span class="tv-ck-t">${clock(n).replace(/ (AM|PM)/, '<small>$1</small>')}</span>`; }
      const up = el('kiosk-status-updated');
      if (up) up.textContent = up.textContent.toLowerCase().replace(/^updated/, 'updated');
    };
    // Buoy now: the measured swell (8 s+ band) as the panel's one answer,
    // above the spectra table, with its true age and arrival at the reef.
    const tvSwell = updateSwellCard;
    updateSwellCard = function (bp, marine, buoy, band) {
      CR.buoy = { bp, band };
      const r = tvSwell.apply(this, arguments);
      renderBuoyNow();
      return r;
    };
    function renderBuoyNow() {
      const host = el('panel-spectral-summary');
      if (!host) return;
      let box = el('tv-buoy-now');
      if (!box) { box = mk('div', { id: 'tv-buoy-now', class: 'tv-buoy-now' }); host.insertBefore(box, host.querySelector('#spectral-summary-table')); }
      const b = CR.buoy;
      if (!b || !b.bp || b.bp.waveHeight == null) { box.innerHTML = '<span class="tv-missing">No buoy reading</span>'; return; }
      const band = b.band && Number.isFinite(b.band.hsM) ? b.band : null;
      const ft = band ? band.hsM * 3.28084 : b.bp.waveHeight;
      const p = band ? band.peakPeriod : b.bp.dominantPeriod;
      const d = band && band.dir != null ? Math.round(band.dir) : b.bp.meanDirection;
      const age = buoyObsAge(b.bp.obsMs);
      const arr = p ? buoySwellArrivalText(p, b.bp.obsMs) : '';
      const cls = winClass(d);
      box.innerHTML =
        `<div class="tv-bn-k">Buoy 44097 · measured ${clock(b.bp.obsMs)} <span class="tv-bn-age is-${age ? age.level : 'fresh'}">${age ? age.label.replace(' ago', ' old') : ''}</span></div>` +
        `<div class="tv-bn-read"><span class="tv-bn-n">${fmtFt(ft)}<small>ft</small> @ ${p ? Math.round(p) : '–'}<small>s</small></span><span class="tv-bn-d">${directionLabel(d)} ${d != null ? d + '°' : ''}</span>${cls ? `<span class="cr-chip cr-chip-${WIN_KEY[cls]}">${WIN_WORD[cls]}</span>` : ''}</div>` +
        `<div class="tv-bn-arr">${band ? (band.minPeriod || 8) + ' s+ swell' : 'total sea'}${arr ? ' · ' + esc(arr.replace('Choc', 'the reef')) : ''}</div>`;
    }
    // For captures: freeze the sweep at a bearing.
    window.crFreezeSweep = deg => { const s = el('tv-sweep'); if (s) { s.style.animation = 'none'; s.style.transform = `rotate(${deg}deg)`; } };
    // Light: TV day = the plotter's dark palette; night = red lamp.
    B.classList.add('tv-chart');
  }

  /* ══════════════════════════════════════════════════════════════════
     4. CHOC TV — see the TV section below
     ══════════════════════════════════════════════════════════════════ */
  if (!TV) {
    wireWeb();
  } else {
    wireTV();
  }
  CR.phaseAt = phaseAt; CR.hourFacts = hourFacts; CR.readTokens = readTokens;
})();
