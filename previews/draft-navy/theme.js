// ════════════════════════════════════════════════════════════════════
// DRAFT 2 · NAVY — LetsCheckChoc skin, behaviour half (classic script)
// ────────────────────────────────────────────────────────────────────
// One Instrument's layout and behaviour (this file started as its
// theme.js), re-lit in Chart Room's navy plotter colours with one shared
// colour code. Loads after kiosk.js. Everything app.js / kiosk.js
// declares is a writable global (function declarations) or a mutable
// palette object (FC_RETRO / ROSE_THEME / PERIOD_COLOR_STOPS), so:
//   • light: body[data-oi-light] = day | night. Night starts at sunset at
//     Choc (the app's own NOAA calcDaylight) and ends at sunrise; SET ›
//     DISPLAY LIGHT overrides it (SUN / SYSTEM / DAY / NIGHT). Choc TV
//     follows the same sun: navy by day, phosphor after dark.
//   • DOM: one bezel, four soft keys, an answer-first Forecast page
//     (readout → this week → hour dial → chart page → graph page →
//     more), Sources & settings + the colour key behind SET (and "?").
//   • the three forecast panels, the lineup and the radar are redrawn
//     here with the colour code; everything else is wrapped, not edited.
// In a real PR these pieces move into app.js / kiosk.js and theme.css
// replaces styles-web1*.css + styles-retro.css.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var OI = window.OI = { ready: false, errors: [], light: null, draft: 'navy' };
  function err(where, e) {
    var m = where + ': ' + (e && e.message ? e.message : e);
    OI.errors.push(m);
    if (window.console) console.warn('[NAVY]', m, e && e.stack);
  }
  function guard(where, fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { err(where, e); }
    };
  }

  var KIOSK_ON = typeof isKioskMode === 'function' && isKioskMode();
  var CH = CONFIG.chocomount;
  var HOUR = 3600e3;

  // ── Small helpers ──────────────────────────────────────────────────
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return typeof escHtml === 'function' ? escHtml(s) : String(s); }
  // DSEG14 readout with its unlit ghost cells underneath ("~" lights all
  // 14 segments, "!" is a blank cell; "." and ":" are zero-width).
  function seg(text, cls) {
    var t = String(text).replace(/ /g, '!');
    var ghost = t.replace(/[0-9A-Za-z\-]/g, '~');
    return '<span class="oi-seg ' + (cls || '') + '"><span class="oi-gh" aria-hidden="true">' + ghost +
      '</span><span class="oi-lit">' + t + '</span></span>';
  }
  // Orbitron has no middle dot: separators are drawn, not typed.
  function dots(str) { return String(str).split(' · ').join('<span class="oi-sep"></span>'); }
  function clock(t) {
    var d = new Date(t), hh = d.getHours();
    return { hm: (hh % 12 || 12) + ':' + pad2(d.getMinutes()), ap: hh >= 12 ? 'PM' : 'AM', hr: hh % 12 || 12 };
  }
  function dow(t) { return new Date(t).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(); }
  function dayName(t) { return new Date(t).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase(); }
  function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function ftStr(v) { return v >= 9.95 ? String(Math.round(v)) : fmt1(v); }
  function startOfDay(ms, off) { var d = new Date(ms); d.setHours(0, 0, 0, 0); if (off) d.setDate(d.getDate() + off); return d; }
  function dayOffsetOf(ms) { return Math.round((startOfDay(ms) - startOfDay(Date.now())) / 864e5); }
  function sun(ms) { return calcDaylight(CH.lat, CH.lon, new Date(ms)) || {}; }

  // Light at an instant: navy from sunrise to sunset at Choc, phosphor
  // from sunset to sunrise (the owner's rule). Uses the app's NOAA sun.
  function lightAt(ms) {
    var dl = sun(ms);
    if (dl.alwaysDay) return 'day';
    if (dl.alwaysNight || !dl.sunrise) return 'night';
    return ms >= dl.sunrise.getTime() && ms < dl.sunset.getTime() ? 'day' : 'night';
  }
  // Scene = the light on the WORLD (photo grade, HUD, "after dark"):
  // day, twilight (first light → sunrise, sunset → last light), night.
  function sceneAt(ms) {
    var dl = sun(ms);
    if (dl.alwaysDay) return 'day';
    if (dl.alwaysNight || !dl.sunrise) return 'night';
    if (ms >= dl.sunrise.getTime() && ms < dl.sunset.getTime()) return 'day';
    if (ms >= dl.firstLight.getTime() && ms < dl.lastLight.getTime()) return 'twilight';
    return 'night';
  }
  function isDaylight(ms) { return sceneAt(ms) === 'day'; }

  function windClass(mph, dir) {
    if (dir == null) return null;
    var OFF = 335;
    var gap = Math.min(((dir - OFF) % 360 + 360) % 360, ((OFF - dir) % 360 + 360) % 360);
    var b = gap < 60 ? 'off' : gap < 120 ? 'cross' : 'on';
    if (mph != null && mph < 5) b = b === 'cross' ? 'off' : b === 'on' ? 'cross' : b;
    return b;
  }
  // Words only — never the ambiguous ON / OFF.
  var WIND_WORD = { off: 'OFFSHORE', cross: 'CROSS-SHORE', on: 'ONSHORE' };
  var WIND_SHORT = { off: 'OFFSHORE', cross: 'CROSS', on: 'ONSHORE' };
  function windWord(cls, short, extra) {
    if (!cls) return '<span class="oi-windword nv-w-none ' + (extra || '') + '">NO WIND</span>';
    return '<span class="oi-windword nv-w-' + cls + ' ' + (extra || '') + '">' + (short ? WIND_SHORT[cls] : WIND_WORD[cls]) + '</span>';
  }
  // One word per window state everywhere (BLOCKED, never OUT).
  var TAG = { 'dir-in': ['oi-tag-in', 'IN WINDOW', 'IN'], 'dir-edge': ['oi-tag-edge', 'EDGE', 'EDGE'], 'dir-out': ['oi-tag-out', 'BLOCKED', 'BLOCKED'] };
  function tagHTML(cls, short) {
    var t = TAG[cls]; if (!t) return '';
    return '<span class="oi-tag ' + t[0] + '">' + (short ? t[2] : t[1]) + '</span>';
  }
  var ICON_MOON = '<svg viewBox="0 0 12 12"><path fill="currentColor" d="M6 1A5 5 0 1 0 11 6A4 4 0 0 1 6 1Z"/></svg>';
  // Out of daylight: dimmed + labelled. Twilight says so; night is AFTER DARK.
  function darkChip(scene) { return '<span class="nv-dark">' + ICON_MOON + (scene === 'twilight' ? 'TWILIGHT' : 'AFTER DARK') + '</span>'; }

  // The big filled arrow from Choc TV, reading printed on it. Rotated to
  // the TRAVEL direction; the FROM label stays upright and sits on the
  // arrow's head (its widest part), haloed in the arrow's own colour.
  function arrowHTML(fromDeg, cls, label, sub) {
    if (fromDeg == null) return '';
    var travel = Math.round((fromDeg + 180) % 360), r = travel * Math.PI / 180;
    var dx = (Math.sin(r) * 14).toFixed(1), dy = (-Math.cos(r) * 14).toFixed(1);
    return '<span class="oi-arrow ' + (cls || '') + '">' +
      '<svg viewBox="0 0 100 140" style="transform:rotate(' + travel + 'deg)" aria-hidden="true">' +
      '<path d="M50 4 L96 62 L73 62 L73 136 L27 136 L27 62 L4 62 Z"/></svg>' +
      (label ? '<span class="oi-ao" style="transform:translate(' + dx + '%,' + dy + '%)"><b>' + label + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</span>' : '') +
      '</span>';
  }
  // Wind heading dial (owner pick): ring + rim pointer at the travel
  // bearing, both in the wind's code colour (ring dashes = its pattern).
  function dialSVG(fromDeg, cls) {
    var ticks = '';
    for (var a = 0; a < 360; a += 30) ticks += '<line class="tick" transform="rotate(' + a + ' 50 50)" x1="50" y1="7" x2="50" y2="14"/>';
    var ptr = fromDeg == null ? '' :
      '<path class="ptr" transform="rotate(' + Math.round((fromDeg + 180) % 360) + ' 50 50)" d="M50 0 L62 21 L38 21 Z"/>';
    return '<svg class="oi-dial' + (cls ? ' nv-w-' + cls : '') + '" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="42"/>' + ticks + ptr + '</svg>';
  }

  // ════════════════════════════════════════════════════════════════════
  // Palettes. The CSS tokens and these values are the same code; canvases
  // read FC_RETRO, so every chart colour comes from here.
  // ════════════════════════════════════════════════════════════════════
  // Every meaning keeps ONE hue day and night. Night only dims the light:
  // black glass, a cool-grey ink, the same magenta / blue / green / amber
  // / coral / red. Green means offshore wind and fresh data, nothing else.
  var PAL = {
    day: {
      ground: '#0a1524', halo: '#06101c', ink: '#f2f6fb', ink2: '#cdd7e4', ink3: '#8597b0', rgb: '242,246,251',
      win: '#ff78d2', winRgb: '255,120,210', winFill: '#b8187f', winFillInk: '#ffffff', edge: '#ffb547', out: '#8d9aae', outRgb: '141,154,174',
      reef: '#2f80d4', reefRgb: '47,128,212', reefInk: '#8ccbff', reefInkRgb: '140,203,255', arrow: '#1e62ad',
      off: '#4fe08a', offRgb: '79,224,138', cross: '#ffb547', crossRgb: '255,181,71', on: '#ff9a7d', onRgb: '255,154,125',
      tide: '#5db4ff', tideRgb: '93,180,255', band: '#1c3f66', rampLo: [102, 98, 180], rampHi: [212, 203, 255],
      fresh: '#4fe08a', stale: '#ffb547', dead: '#ff4d4d', panelLine: '#2e4c72'
    },
    night: {
      ground: '#000000', halo: '#000000', ink: '#d2dae4', ink2: '#9aa6b5', ink3: '#6c7a8c', rgb: '210,218,228',
      win: '#ff70d0', winRgb: '255,112,208', winFill: '#a8166f', winFillInk: '#ffffff', edge: '#ffb547', out: '#8593a6', outRgb: '133,147,166',
      reef: '#3d8fe0', reefRgb: '61,143,224', reefInk: '#8ccbff', reefInkRgb: '140,203,255', arrow: '#174c8a',
      off: '#4fe08a', offRgb: '79,224,138', cross: '#ffb547', crossRgb: '255,181,71', on: '#ff9a7d', onRgb: '255,154,125',
      tide: '#5db4ff', tideRgb: '93,180,255', band: '#10284a', rampLo: [94, 90, 172], rampHi: [200, 188, 255],
      fresh: '#4fe08a', stale: '#ffb547', dead: '#ff4d4d', panelLine: '#2a4262'
    }
  };
  PAL.tvday = Object.assign({}, PAL.day, { ground: '#050d17', halo: '#050d17' });
  function palKey(mode) { return mode === 'night' ? 'night' : (KIOSK_ON ? 'tvday' : 'day'); }
  function curPal() { return PAL[palKey(OI.light || 'day')]; }
  function A(rgb, a) { return 'rgba(' + rgb + ',' + a + ')'; }
  // Your model: one lavender ramp, dim → bright with the score.
  function rampColor(t) {
    var p = curPal(), lo = p.rampLo, hi = p.rampHi;
    t = Math.max(0, Math.min(1, t));
    return 'rgb(' + lo.map(function (v, i) { return Math.round(v + (hi[i] - v) * t); }).join(',') + ')';
  }
  function meter(v) {
    var n = v == null ? 0 : Math.max(0, Math.min(10, Math.round(v))), s = '';
    for (var i = 0; i < 10; i++) s += i < n ? '<i class="on" style="background:' + rampColor(i / 9) + '"></i>' : '<i></i>';
    return '<span class="oi-meter">' + s + '</span>';
  }

  // Canvas fills: pixel patterns in CSS px cells. dots = blocked ghost,
  // hatch = cross-shore, xhatch = onshore.
  function pattern(kind, rgb, a, tint) {
    var n = kind === 'dots' ? 3 : 5;
    var cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    var x = cv.getContext('2d');
    if (tint) { x.fillStyle = A(rgb, tint); x.fillRect(0, 0, n, n); }
    x.fillStyle = A(rgb, a);
    var px = kind === 'dots' ? [[1, 1]]
      : kind === 'hatch' ? [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]]
      : [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0], [0, 0], [1, 1], [3, 3], [4, 4]];
    px.forEach(function (p) { x.fillRect(p[0], p[1], 1, 1); });
    return x.createPattern(cv, 'repeat');
  }
  function chartPalette(key) {
    var b = PAL[key], night = key === 'night';
    return {
      plotBg: 'rgba(0,0,0,0)', grid: A(b.rgb, night ? 0.18 : 0.16), ink: b.ink, ink2: b.ink2, frame: A(b.rgb, night ? 0.28 : 0.24),
      swellFill: A(b.reefRgb, night ? 0.86 : 0.92), swellStroke: b.reefInk, secSwellFill: pattern('dots', b.outRgb, 0.9),
      period: b.ink, periodHalo: b.halo,
      dirPrimary: b.reefInk, dirSecondary: A(b.reefInkRgb, 0.55),
      windOn: pattern('xhatch', b.onRgb, 1, 0.2), windCross: pattern('hatch', b.crossRgb, 1, 0.16), windOff: A(b.offRgb, night ? 0.72 : 0.8),
      windNull: A(b.outRgb, 0.3), windStroke: b.ink2, windBand: A(b.winRgb, 0.14),
      tide: b.tide, tideMarkFaint: A(b.tideRgb, 0.5), tideMark: b.tide, tideConn: A(b.tideRgb, 0.6),
      scrubDot: b.ink, nowLine: A(b.rgb, 0.6), daySep: A(b.rgb, night ? 0.16 : 0.14),
      nightShade: night ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.36)', pastDim: 'rgba(0,0,0,0)',
      obsFill: b.ground, obsStroke: b.ink, pulseCore: b.ink, pulseRing: b.rgb,
      _ground: b.ground, _rgb: b.rgb, _b: b, _night: night
    };
  }
  function rosePalette(key) {
    var b = PAL[key];
    return { bg: 'rgba(0,0,0,0)', ring: A(b.rgb, 0.22), cardinal: b.ink, window: b.win, hs: b.ink, hsSub: b.ink2 };
  }
  // Period swatches (spectral table): neutral grey → white, short = dim,
  // long = bright. Blue is kept for "reaches the reef"; the rose shows
  // period as printed labels, not hue.
  function periodStops(key) {
    return key === 'night'
      ? [[2, [64, 74, 88]], [7, [104, 118, 136]], [11, [150, 162, 178]], [16, [190, 200, 212]], [22, [222, 228, 236]]]
      : [[2, [74, 88, 108]], [7, [122, 138, 160]], [11, [172, 186, 205]], [16, [212, 222, 234]], [22, [246, 248, 252]]];
  }
  // Colours the canvases drew with, for the contrast probe.
  OI.codes = function () {
    var b = curPal();
    return { reefFill: b.reef, swellStroke: b.reefInk, ghostInk: A(b.outRgb, 0.9), period: b.ink, win: b.win,
      off: b.off, cross: b.cross, on: b.on, tide: b.tide, band: b.band, ink: b.ink, ink2: b.ink2, ground: b.ground, out: b.out };
  };

  function chooseLight() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('oiLight'); } catch (_) { /* old browser */ }
    if (q === 'day' || q === 'night') return q;
    var pref = 'auto';
    if (!KIOSK_ON) { try { pref = localStorage.getItem('oi-light') || 'auto'; } catch (_) { /* private mode */ } }
    if (pref === 'day' || pref === 'night') return pref;
    if (pref === 'system') return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
    return lightAt(Date.now());
  }

  function redrawCharts() {
    var f = fd();
    if (f && f.marine) {
      ['forecast-canvas-swell', 'forecast-canvas-wind', 'forecast-canvas-tide'].forEach(function (id) { invalidateCanvasDPR(el(id)); });
      drawForecastChart(f.marine, f.wind, f.daylight, f.tideHiLo, f.tidePred, f.buoyParsed);
    }
    if (STATE.lastSpectral) { try { drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed); } catch (_) { /* rose optional */ } }
    if (STATE._cachedTidePred) { try { drawTideChart(STATE._cachedTidePred); } catch (_) { /* tides optional */ } }
  }

  var applyLight = guard('applyLight', function (force) {
    var mode = chooseLight();
    if (mode === OI.light && !force) return;
    var first = OI.light == null;
    OI.light = mode;
    document.body.setAttribute('data-oi-light', mode);
    var key = palKey(mode);
    Object.assign(FC_RETRO, chartPalette(key));
    Object.assign(ROSE_THEME, rosePalette(key));
    periodStops(key).forEach(function (st, i) { if (PERIOD_COLOR_STOPS[i]) PERIOD_COLOR_STOPS[i] = st; });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'night' ? '#0b0e12' : '#131d2b');
    if (first) return;
    if (KIOSK_ON) {
      try {
        var p = document.body.dataset.kioskPanel;
        if (p === 'days1' || p === 'days2') kioskRenderDays();
        else kioskRedrawPanel(p);
      } catch (e) { err('tvlight', e); }
    } else {
      redrawCharts();
      afterChart();
    }
  });

  // ── Forecast access ─────────────────────────────────────────────────
  function fd() { return STATE.forecastData || null; }
  function cs() { return STATE.forecastChart || null; }
  function nowIdx() { var c = cs(); return c ? findHourIndexForTime(Date.now(), c) : -1; }
  function selIdx() { var c = cs(); if (!c) return -1; var i = STATE.scrubberIdx; return (typeof i === 'number' && i >= 0 && i < c.times.length) ? i : nowIdx(); }

  function tideAt(ms) {
    var c = cs(), pred = (c && c.tidePred) || (fd() && fd().tidePred);
    if (!pred || pred.length < 2) return null;
    for (var i = 0; i < pred.length - 1; i++) {
      var a = new Date(pred[i].t).getTime(), b = new Date(pred[i + 1].t).getTime();
      if (ms >= a && ms <= b && b > a) {
        var va = parseFloat(pred[i].v), vb = parseFloat(pred[i + 1].v);
        if (!Number.isFinite(va) || !Number.isFinite(vb)) return null;
        return { v: va + (vb - va) * ((ms - a) / (b - a)), rising: vb >= va };
      }
    }
    return null;
  }
  function tideEvents() {
    var f = fd(); if (!f || !f.tideHiLo) return [];
    return f.tideHiLo.map(function (p) { return { t: new Date(p.t).getTime(), type: p.type, v: parseFloat(p.v) }; })
      .filter(function (p) { return Number.isFinite(p.t); }).sort(function (a, b) { return a.t - b.t; });
  }
  // Daylight lows: the start of a surfable incoming window.
  function daylightLows() {
    return tideEvents().filter(function (p) {
      if (p.type !== 'L') return false;
      var dl = sun(p.t);
      return dl.sunrise && p.t >= dl.firstLight.getTime() - 1.5 * HOUR && p.t <= dl.sunset.getTime() - 30 * 60e3;
    });
  }
  // Daylight incoming windows (low → next high, clipped to sunrise–sunset).
  function incomingWindows() {
    var ev = tideEvents(), out = [];
    ev.forEach(function (lo, i) {
      if (lo.type !== 'L') return;
      var hi = null; for (var k = i + 1; k < ev.length; k++) if (ev[k].type === 'H') { hi = ev[k]; break; }
      var end = hi ? hi.t : lo.t + 6.2 * HOUR;
      var dl = sun(lo.t); if (!dl.sunrise) return;
      var a = Math.max(lo.t, dl.sunrise.getTime()), b = Math.min(end, dl.sunset.getTime());
      if (b > a + 10 * 60e3) out.push({ a: a, b: b, low: lo });
    });
    return out;
  }
  function modelAt(idx) {
    try {
      if (typeof buildForecastConditions !== 'function') return null;
      var cond = buildForecastConditions(STATE._cachedMarine, STATE._cachedWind, STATE._cachedTideHiLo, STATE._cachedTidePred, idx);
      if (!cond) return null;
      var w = predictWaveRating(extractWaveFeatures(cond));
      var r = predictRideRating(extractRideFeatures(cond));
      var c = predictCondRating(extractCondFeatures(cond));
      var vals = [w, r, c].filter(function (v) { return typeof v === 'number' && isFinite(v); });
      if (vals.length < 3) return null;
      return { w: w, r: r, c: c, mean: (w + r + c) / 3 };
    } catch (e) { return null; }
  }

  // One hour, in surf terms. Lead = the train carrying more energy into
  // the 115–158° window (the same rule kioskDaySummary uses per day).
  function hourData(idx) {
    var f = fd(), c = cs();
    if (!f || !f.marine || !c || idx < 0) return null;
    var mh = f.marine.hourly, wh = f.wind && f.wind.hourly;
    var t = c.times[idx].getTime();
    var p1 = { h: (mh.swell_wave_height || mh.wave_height || [])[idx], p: c.wavePeriods[idx], d: (mh.swell_wave_direction || [])[idx] };
    var p2 = { h: (mh.secondary_swell_wave_height || [])[idx], p: (mh.secondary_swell_wave_period || [])[idx], d: (mh.secondary_swell_wave_direction || [])[idx] };
    [p1, p2].forEach(function (s) {
      s.a = _alignmentScore(s.d);
      s.e = s.h != null ? s.a * s.h * s.h : 0;
      s.cls = swellDirClass(s.d);
    });
    var lead = p1, other = p2;
    if (p2.h != null && (p2.e > p1.e || (p1.h == null))) { lead = p2; other = p1; }
    if (lead.e === 0 && other.e === 0 && other.h != null && lead.h != null && other.h > lead.h) { var x = lead; lead = other; other = x; }
    var ws = wh ? (wh.wind_speed_10m || [])[idx] : null, wd = wh ? (wh.wind_direction_10m || [])[idx] : null, wg = wh ? (wh.wind_gusts_10m || [])[idx] : null;
    var isNow = idx === nowIdx();
    // NOW reads the real clock (the nearest forecast hour supplies the
    // numbers); a picked hour reads its own time.
    var showT = isNow ? Date.now() : t;
    var tide = tideAt(showT);
    var next = null, ev = tideEvents();
    for (var i = 0; i < ev.length; i++) if (ev[i].t > showT) { next = ev[i]; break; }
    return {
      idx: idx, t: t, showT: showT, isNow: isNow,
      lead: lead.h != null ? lead : null, other: other.h != null && other.h >= 0.3 ? other : null,
      wind: ws != null ? { mph: ws, dir: wd, gust: wg, cls: windClass(ws, wd) } : null,
      tide: tide, next: next, model: modelAt(idx), scene: sceneAt(showT)
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Chart drawers (replacements / wrappers)
  // ════════════════════════════════════════════════════════════════════
  function veilPast(ctx, common, plotLeft, plotW, top, hgt) {
    var now = Date.now();
    if (now <= common.t0) return;
    var nx = Math.min(_fcXFor(new Date(now), common, plotLeft, plotW), plotLeft + plotW);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = FC_RETRO._ground || '#000';
    ctx.fillRect(plotLeft, top, nx - plotLeft, hgt);
    ctx.restore();
  }
  // Out-of-daylight hours are dimmed: darker bands on the navy screen;
  // on the black night screen the DAYLIGHT hours get a faint lift instead
  // so the dark hours still read as the dimmer ones.
  function shadeDark(ctx, common, plotLeft, plotW, top, hgt) {
    var P = FC_RETRO, spans = [], d0 = startOfDay(common.t0, -1);
    for (var k = 0; k < common.dayCount + 3; k++) {
      var day = new Date(d0); day.setDate(day.getDate() + k);
      var dl = calcDaylight(CH.lat, CH.lon, new Date(day.getTime() + 12 * HOUR));
      if (dl && dl.sunrise && dl.sunset) spans.push([dl.sunrise.getTime(), dl.sunset.getTime()]);
    }
    var X = function (ms) { return Math.max(plotLeft, Math.min(plotLeft + plotW, _fcXFor(new Date(ms), common, plotLeft, plotW))); };
    ctx.save();
    if (P._night) {
      ctx.fillStyle = A(P._rgb, 0.05);
      spans.forEach(function (s) { var a = X(s[0]), b = X(s[1]); if (b > a) ctx.fillRect(a, top, b - a, hgt); });
    } else {
      ctx.fillStyle = P.nightShade;
      for (var i = 0; i < spans.length - 1; i++) { var a = X(spans[i][1]), b = X(spans[i + 1][0]); if (b > a) ctx.fillRect(a, top, b - a, hgt); }
      if (spans.length) { var a0 = X(common.t0), b0 = X(spans[0][0]); if (b0 > a0) ctx.fillRect(a0, top, b0 - a0, hgt); }
    }
    ctx.restore();
  }
  // Sunset → next sunrise spans across the chart (the dark hours).
  function darkSpans(common) {
    var out = [], d0 = startOfDay(common.t0, -1), prevSet = null;
    for (var k = 0; k < common.dayCount + 3; k++) {
      var day = new Date(d0); day.setDate(day.getDate() + k);
      var dl = calcDaylight(CH.lat, CH.lon, new Date(day.getTime() + 12 * HOUR));
      if (!dl || !dl.sunrise || !dl.sunset) continue;
      if (prevSet != null) out.push([prevSet, dl.sunrise.getTime()]);
      prevSet = dl.sunset.getTime();
    }
    return out;
  }
  // The selected hour's cursor, drawn inside each plot only: it never
  // crosses the panel titles, legends or the tide label lane.
  function drawCursor(ctx, common, plotLeft, plotW, y0, y1) {
    var si = STATE.scrubberIdx;
    if (typeof si !== 'number' || si < 0 || si > common.lastIdx || document.body.classList.contains('kiosk')) return;
    var x = Math.round(_fcXFor(common.allTimes[si], common, plotLeft, plotW)) + 0.5;
    if (x < plotLeft || x > plotLeft + plotW) return;
    ctx.save();
    ctx.strokeStyle = FC_RETRO._ground || '#000'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    ctx.strokeStyle = FC_RETRO.ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    ctx.restore();
  }
  function axisMax(peak) {
    var t = peak * 1.1;
    var m = t <= 4 ? 4 : t <= 6 ? 6 : Math.ceil(t / 4) * 4;
    return { max: m, div: m === 6 ? 3 : 4 };
  }

  // "Plot what reaches the reef": solid sounding blue = window-weighted
  // energy (√Σ alignment·H², the rule kioskDaySummary uses), grey dots
  // behind it = everything offshore including what Montauk / Block
  // Island blocks. Period follows the in-window train. The direction
  // strip shows the window as a magenta band.
  function oiDrawSwellPanel(common, data) {
    var canvas = el('forecast-canvas-swell');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var dims = ensureCanvasCssDims(canvas, ctx), cssW = dims.cssW, cssH = dims.cssH;
    ctx.clearRect(0, 0, cssW, cssH);
    var P = FC_RETRO, B = P._b || PAL.day, kiosk = document.body.classList.contains('kiosk');
    var plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    var top = 6, usableH = cssH - 10;
    var hgt = Math.round(usableH * (kiosk ? 0.7 : 0.68));
    var subTop = top + hgt + 8, subBot = cssH - 2;
    var H1 = data.heights, H2 = data.secHeights, D1 = data.swellDirs, D2 = data.secDirs, PER = data.wavePeriods;
    var n = common.lastIdx, reef = [], total = [], lead = [], peak = 0;
    for (var i = 0; i <= n; i++) {
      var h1 = H1[i], h2 = H2[i];
      if (h1 == null && h2 == null) { reef[i] = total[i] = null; lead[i] = null; continue; }
      var a1 = _alignmentScore(D1[i]), a2 = _alignmentScore(D2[i]);
      var e1 = h1 != null ? h1 * h1 : 0, e2 = h2 != null ? h2 * h2 : 0;
      reef[i] = Math.sqrt(a1 * e1 + a2 * e2);
      total[i] = Math.sqrt(e1 + e2);
      var pri = (a1 * e1 > a2 * e2) || (a1 * e1 === a2 * e2 && e1 >= e2);
      lead[i] = { p: PER[i], d: pri ? D1[i] : D2[i], a: swellDirClass(D1[i]) !== 'dir-out' ? 1 : 0, a1: swellDirClass(D1[i]) !== 'dir-out' ? 1 : 0, a2: swellDirClass(D2[i]) !== 'dir-out' ? 1 : 0, d1: D1[i], d2: D2[i], h2: h2 };
      if (total[i] > peak) peak = total[i];
    }
    var ax = axisMax(peak), maxY = ax.max, div = ax.div, periodMax = 24;
    OI.reef = reef; OI.swellGeom = { top: top, h: hgt, maxY: maxY, plotLeft: plotLeft, plotW: plotW };
    var X = function (t) { return _fcXFor(t, common, plotLeft, plotW); };
    var Y = function (v) { return top + hgt - (Math.min(v, maxY) / maxY) * hgt; };
    var YP = function (v) { return top + hgt - (Math.max(0, Math.min(periodMax, v)) / periodMax) * hgt; };

    shadeDark(ctx, common, plotLeft, plotW, top, subBot - top);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, subBot - top);
    for (var q = 1; q < div; q++) _fcDrawDashedHGrid(ctx, plotLeft, plotLeft + plotW, top + hgt * q / div);

    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, hgt); ctx.clip();
    var area = function (arr) {
      ctx.beginPath(); ctx.moveTo(X(common.allTimes[0]), Y(0));
      for (var k = 0; k <= n; k++) ctx.lineTo(X(common.allTimes[k]), Y(arr[k] != null ? arr[k] : 0));
      ctx.lineTo(X(common.allTimes[n]), Y(0)); ctx.closePath();
    };
    var edge = function (arr) {
      ctx.beginPath(); var s = false;
      for (var k = 0; k <= n; k++) { if (arr[k] == null) { s = false; continue; } var x = X(common.allTimes[k]), y = Y(arr[k]); if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y); }
    };
    // Ghost: all swell offshore, blocked or not (grey dots, dotted edge).
    area(total); ctx.fillStyle = P.secSwellFill; ctx.fill();
    edge(total); ctx.setLineDash([2, 3]); ctx.lineWidth = 1.2; ctx.strokeStyle = A(B.outRgb, 0.9); ctx.stroke(); ctx.setLineDash([]);
    // Hero: what reaches the reef (solid sounding blue, bright edge).
    area(reef); ctx.fillStyle = P.swellFill; ctx.fill();
    edge(reef); ctx.lineWidth = 2.2; ctx.strokeStyle = P.swellStroke; ctx.lineJoin = 'round'; ctx.stroke();
    // Period of the lead train: solid while it's in the window, dashed when not.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (var j = 0; j < n; j++) {
        var L0 = lead[j], L1 = lead[j + 1];
        if (!L0 || !L1 || L0.p == null || L1.p == null || !isFinite(L0.p) || !isFinite(L1.p)) continue;
        ctx.beginPath();
        ctx.moveTo(X(common.allTimes[j]), YP(L0.p)); ctx.lineTo(X(common.allTimes[j + 1]), YP(L1.p));
        if (pass === 0) { ctx.setLineDash([]); ctx.strokeStyle = P.periodHalo; ctx.lineWidth = 4.5; }
        else { ctx.setLineDash(L0.a > 0 ? [] : [2, 4]); ctx.strokeStyle = P.period; ctx.lineWidth = L0.a > 0 ? 1.6 : 1.2; }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
    veilPast(ctx, common, plotLeft, plotW, top, subBot - top);

    // Axes: ft left in ink, period right in ink-2.
    var fs = kiosk ? 14 : 11;
    var clampY = function (y) { return Math.min(Math.max(y, 7), cssH - 7); };
    ctx.font = '700 ' + fs + 'px ' + FC_CHART_FONT;
    ctx.textBaseline = 'middle';
    for (var r = 0; r <= div; r++) {
      var v = maxY * (1 - r / div), yy = clampY(top + hgt * r / div);
      ctx.textAlign = 'right'; ctx.fillStyle = P.ink;
      ctx.fillText(r === 0 ? v + 'ft' : String(v), plotLeft - 5, yy);
      ctx.textAlign = 'left'; ctx.fillStyle = P.ink2;
      var pv = periodMax * (1 - r / div);
      ctx.fillText(r === 0 ? pv + 's' : String(pv), plotLeft + plotW + 5, yy);
    }
    ctx.strokeStyle = P.frame; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotLeft, top + hgt + 0.5); ctx.lineTo(plotLeft + plotW, top + hgt + 0.5); ctx.stroke();

    // Direction strip: the window as a magenta band, lead train bold
    // sounding blue inside it, grey dotted when it's blocked.
    var winMin = CH.swellWindowMin, winMax = CH.swellWindowMax, winMid = (winMin + winMax) / 2;
    var dMin = Math.max(winMid - 120, 90), dMax = winMid + 120;
    var sT = subTop + 3, sB = subBot - 3;
    var YD = function (deg) { return sT + ((deg - dMin) / (dMax - dMin)) * (sB - sT); };
    ctx.fillStyle = A(B.winRgb, 0.16);
    ctx.fillRect(plotLeft, YD(winMin), plotW, YD(winMax) - YD(winMin));
    ctx.strokeStyle = A(B.winRgb, 0.85); ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(plotLeft, YD(winMin) + 0.5); ctx.lineTo(plotLeft + plotW, YD(winMin) + 0.5);
    ctx.moveTo(plotLeft, YD(winMax) - 0.5); ctx.lineTo(plotLeft + plotW, YD(winMax) - 0.5); ctx.stroke(); ctx.setLineDash([]);
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, subTop, plotW, subBot - subTop); ctx.clip();
    var dirLine = function (getD, styleFor) {
      var prev = null;
      for (var k = 0; k <= n; k++) {
        var d = getD(k);
        if (d == null) { prev = null; continue; }
        if (prev && Math.abs(d - prev.d) <= 180) {
          var st = styleFor(k);
          if (st) {
            ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(X(common.allTimes[k]), YD(d));
            ctx.setLineDash(st.dash || []); ctx.lineWidth = st.w; ctx.strokeStyle = st.c; ctx.stroke();
          }
        }
        prev = { d: d, x: X(common.allTimes[k]), y: YD(d) };
      }
      ctx.setLineDash([]);
    };
    dirLine(function (k) { return lead[k] && lead[k].h2 != null && lead[k].h2 >= 0.6 ? lead[k].d2 : null; },
      function (k) { return lead[k].a2 > 0 ? { w: 1.6, c: P.dirSecondary } : { w: 1.2, c: A(B.outRgb, 0.8), dash: [2, 3] }; });
    dirLine(function (k) { return lead[k] ? lead[k].d1 : null; },
      function (k) { return lead[k].a1 > 0 ? { w: 2.8, c: P.dirPrimary } : { w: 1.4, c: A(B.outRgb, 0.95), dash: [1, 3] }; });
    ctx.restore();
    ctx.font = '700 ' + (kiosk ? 13 : 10) + 'px ' + FC_CHART_FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = P.ink;
    // The window's edges in magenta, in the gutter (never over the data);
    // compass points only where they don't crowd them.
    var fsz = kiosk ? 13 : 10, wy1 = Math.max(YD(winMin) - 1, subTop + fsz * 0.6 + 2), wy2 = Math.max(YD(winMax) + 3, wy1 + fsz + 1);
    [[90, 'E'], [180, 'S'], [225, 'SW']].forEach(function (cp) {
      var y = YD(cp[0]);
      if (cp[0] < dMin || cp[0] > dMax || y < subTop + fsz * 0.6 || Math.abs(y - wy1) < fsz + 1 || Math.abs(y - wy2) < fsz + 1) return;
      ctx.fillText(cp[1], plotLeft - 5, y);
    });
    ctx.fillStyle = B.win;
    ctx.fillText(winMin + '°', plotLeft - 5, wy1);
    ctx.fillText(winMax + '°', plotLeft - 5, wy2);
    ctx.textAlign = 'right'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = B.ground;
    ctx.strokeText('SWELL FROM', plotLeft + plotW - 6, subBot - 8);
    ctx.fillStyle = P.ink2; ctx.fillText('SWELL FROM', plotLeft + plotW - 6, subBot - 8);
    veilPast(ctx, common, plotLeft, plotW, subTop, subBot - subTop);

    _fcDrawNowLine(ctx, common, plotLeft, plotW, top, subBot);

    // Buoy observation diamond (measured total Hs at the buoy).
    var obsH = data.obsHsFt, obsMs = data.obsMs;
    if (obsH != null && obsMs != null && Date.now() - obsMs <= BUOY_OBS_OLD_MS && obsMs >= common.t0 && obsMs <= common.tEnd) {
      var ox = X(new Date(obsMs)), oy = Y(Math.min(obsH, maxY));
      ctx.beginPath(); ctx.moveTo(ox, oy - 5); ctx.lineTo(ox + 5, oy); ctx.lineTo(ox, oy + 5); ctx.lineTo(ox - 5, oy); ctx.closePath();
      ctx.fillStyle = P.obsFill; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = P.obsStroke; ctx.stroke();
    }

    drawCursor(ctx, common, plotLeft, plotW, top, top + hgt);
    drawCursor(ctx, common, plotLeft, plotW, subTop, subBot);
    // Scrubber marks: ring on the reef height, dot on the period / bearing.
    var si = STATE.scrubberIdx;
    if (typeof si === 'number' && si >= 0 && si <= n) {
      var tx = X(common.allTimes[si]);
      if (reef[si] != null) {
        ctx.beginPath(); ctx.arc(tx, Y(reef[si]), 5, 0, Math.PI * 2);
        ctx.fillStyle = P._ground || P.plotBg; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = P.scrubDot; ctx.stroke();
      }
      if (lead[si] && lead[si].p != null && isFinite(lead[si].p)) drawScrubberDot(ctx, tx, YP(lead[si].p));
      if (lead[si] && lead[si].d1 != null && lead[si].d1 >= dMin && lead[si].d1 <= dMax) drawScrubberDot(ctx, tx, YD(lead[si].d1));
    }
    return { canvas: canvas, cssW: cssW, cssH: cssH, plotLeft: plotLeft, plotW: plotW, top: top, h: hgt, swellMaxY: maxY, ySwell: Y, yPeriod: YP };
  }

  // Wind: OFFSHORE solid green, CROSS amber hatch, ONSHORE coral
  // cross-hatch (the pattern carries it without the hue).
  function oiDrawWindPanel(common, data) {
    var canvas = el('forecast-canvas-wind');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var dims = ensureCanvasCssDims(canvas, ctx), cssW = dims.cssW, cssH = dims.cssH;
    ctx.clearRect(0, 0, cssW, cssH);
    var P = FC_RETRO, kiosk = document.body.classList.contains('kiosk');
    var plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right, top = 4, hgt = cssH - 8;
    shadeDark(ctx, common, plotLeft, plotW, top, hgt);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, hgt);
    var S = data.windSpeeds, D = data.windDirs, maxY = data.windMaxY;
    var Y = function (v) { return top + hgt - (Math.min(v, maxY) / maxY) * hgt; };
    var X = function (t) { return _fcXFor(t, common, plotLeft, plotW); };
    var fillFor = function (dir, sp) { var c = windClass(sp, dir); return c === 'off' ? P.windOff : c === 'cross' ? P.windCross : c === 'on' ? P.windOn : P.windNull; };
    for (var v = 5; v < maxY; v += 5) _fcDrawDashedHGrid(ctx, plotLeft, plotLeft + plotW, Y(v));
    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, hgt); ctx.clip();
    for (var i = 0; i < common.lastIdx; i++) {
      var x1 = X(common.allTimes[i]), x2 = X(common.allTimes[i + 1]);
      var w1 = S[i] != null ? S[i] : 0, w2 = S[i + 1] != null ? S[i + 1] : 0;
      ctx.beginPath(); ctx.moveTo(x1, Y(0)); ctx.lineTo(x1, Y(w1)); ctx.lineTo(x2, Y(w2)); ctx.lineTo(x2 + 0.4, Y(0)); ctx.closePath();
      ctx.fillStyle = fillFor(D[i], S[i]); ctx.fill();
    }
    ctx.beginPath(); ctx.strokeStyle = P.windStroke; ctx.lineWidth = 1.4;
    var st = false;
    for (var k = 0; k <= common.lastIdx; k++) { if (S[k] == null) continue; var xx = X(common.allTimes[k]), yy = Y(S[k]); if (!st) { ctx.moveTo(xx, yy); st = true; } else ctx.lineTo(xx, yy); }
    ctx.stroke();
    ctx.restore();
    veilPast(ctx, common, plotLeft, plotW, top, hgt);
    // Axis: numbers only; the unit sits once, inside the plot's corner.
    ctx.font = '700 ' + (kiosk ? 13 : 10.5) + 'px ' + FC_CHART_FONT;
    ctx.fillStyle = P.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var a = 0; a <= maxY; a += (maxY > 25 ? 10 : 5)) ctx.fillText(String(a), plotLeft - 5, Math.min(Math.max(Y(a), 7), cssH - 7));
    ctx.strokeStyle = P.frame; ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, hgt - 1);
    _fcDrawNowLine(ctx, common, plotLeft, plotW, top, top + hgt);
    drawCursor(ctx, common, plotLeft, plotW, top + 1, top + hgt - 1);
    var si = STATE.scrubberIdx;
    if (typeof si === 'number' && si >= 0 && si <= common.lastIdx && S[si] != null) drawScrubberDot(ctx, X(common.allTimes[si]), Y(S[si]));
    return { canvas: canvas, cssW: cssW, cssH: cssH, plotLeft: plotLeft, plotW: plotW, top: top, h: hgt, windMaxY: maxY };
  }

  // Tide: sounding-blue curve; the daylight incoming windows (low → high)
  // as a blue band with a floor bar; lows marked ▼, daylight lows
  // labelled, after-dark lows hollow and dimmed.
  function oiDrawTidePanel(common, data) {
    var canvas = el('forecast-canvas-tide');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var dims = ensureCanvasCssDims(canvas, ctx), cssW = dims.cssW, cssH = dims.cssH;
    ctx.clearRect(0, 0, cssW, cssH);
    var P = FC_RETRO, B = P._b || PAL.day, kiosk = document.body.classList.contains('kiosk');
    var plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right, top = 4, hgt = cssH - 8;
    var X = function (ms) { return _fcXFor(new Date(ms), common, plotLeft, plotW); };
    shadeDark(ctx, common, plotLeft, plotW, top, hgt);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, hgt);
    var pred = data.tidePred, tMin = 0, tMax = 1, Y = null;
    var lane = kiosk ? 20 : 17, floorY = top + hgt - lane - 5;
    if (pred && pred.length > 1) {
      var vals = pred.map(function (p) { return parseFloat(p.v); }).filter(Number.isFinite);
      tMin = Math.min.apply(null, vals); tMax = Math.max.apply(null, vals);
      var rng = (tMax - tMin) || 1, padT = 8, padB = 9;
      Y = function (v) { return top + padT + (1 - (v - tMin) / rng) * (floorY - top - padT - padB); };
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, hgt); ctx.clip();
    // After dark: a grey dotted floor under every dark span (the legend's
    // swatch), so the floor lane reads blue = go window, dots = dark.
    darkSpans(common).forEach(function (sp) {
      var a = Math.max(X(sp[0]), plotLeft), b = Math.min(X(sp[1]), plotLeft + plotW);
      if (b <= a) return;
      ctx.fillStyle = B.out;
      for (var dx = Math.ceil(a / 3) * 3; dx < b; dx += 3) { ctx.fillRect(dx, floorY + 1, 1.2, 1.2); ctx.fillRect(dx + 1.5, floorY + 2.5, 1.2, 1.2); }
    });
    // Daylight incoming windows: a solid band step over the curve area,
    // sounding-blue hairlines where it starts and ends, and a floor bar.
    incomingWindows().forEach(function (w) {
      var a = Math.max(X(w.a), plotLeft), b = Math.min(X(w.b), plotLeft + plotW);
      if (b <= a) return;
      ctx.fillStyle = B.band; ctx.fillRect(a, top, b - a, floorY - top + 4);
      ctx.fillStyle = A(B.tideRgb, 0.85);
      if (X(w.a) >= plotLeft) ctx.fillRect(a, top, 1, floorY - top);
      if (X(w.b) <= plotLeft + plotW) ctx.fillRect(b - 1, top, 1, floorY - top);
      ctx.fillStyle = B.tide; ctx.fillRect(a, floorY, b - a, 4);
    });
    if (Y) {
      ctx.beginPath(); ctx.strokeStyle = P.tide; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      var st = false;
      pred.forEach(function (p) {
        var t = new Date(p.t).getTime(); if (t < common.t0 - HOUR || t > common.tEnd + HOUR) return;
        var v = parseFloat(p.v); if (!Number.isFinite(v)) return;
        var x = X(t), y = Y(v); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.restore();
    // Label lane under the floor.
    ctx.strokeStyle = P.frame; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotLeft, floorY + 5.5); ctx.lineTo(plotLeft + plotW, floorY + 5.5); ctx.stroke();
    veilPast(ctx, common, plotLeft, plotW, top, hgt);
    // Lows: ▼ at each trough. Daylight lows filled, their time in the
    // lane below; lows after dark hollow and dimmed (the legend says so).
    if (Y && data.tideHiLo) {
      var placed = [], nowMs = Date.now();
      ctx.font = '800 ' + (kiosk ? 12 : 10) + 'px ' + FC_CHART_FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      data.tideHiLo.forEach(function (p) {
        if (p.type !== 'L') return;
        var t = new Date(p.t).getTime(), v = parseFloat(p.v);
        if (!Number.isFinite(v) || t < common.t0 || t > common.tEnd) return;
        var x = X(t), y = Y(v), day = isDaylight(t);
        ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x - 5, y - 6); ctx.lineTo(x + 5, y - 6); ctx.closePath();
        if (day) { ctx.fillStyle = B.tide; ctx.fill(); }
        else { ctx.globalAlpha = 0.6; ctx.lineWidth = 1.3; ctx.strokeStyle = B.tide; ctx.stroke(); ctx.globalAlpha = 1; }
        if (!day || t < nowMs - HOUR) return;
        var c = clock(t), lbl = c.hm + c.ap.charAt(0), w = ctx.measureText(lbl).width + 8;
        var lx = Math.max(plotLeft + w / 2 + 1, Math.min(plotLeft + plotW - w / 2 - 1, x)), ly = floorY + 6 + lane / 2;
        var box = { x: lx - w / 2, w: w };
        for (var i = 0; i < placed.length; i++) { var o = placed[i]; if (box.x < o.x + o.w && box.x + box.w > o.x) return; }
        placed.push(box);
        ctx.fillStyle = B.tide; ctx.fillText(lbl, lx, ly + 0.5);
      });
    }
    if (Y) {
      ctx.font = '700 ' + (kiosk ? 13 : 10.5) + 'px ' + FC_CHART_FONT;
      ctx.fillStyle = P.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      var f = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(1); };
      ctx.fillText(f(tMax), plotLeft - 5, Math.max(Y(tMax), 8));
      ctx.fillText(f(tMin), plotLeft - 5, Y(tMin));
    }
    ctx.strokeStyle = P.frame; ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, hgt - 1);
    _fcDrawNowLine(ctx, common, plotLeft, plotW, top, top + hgt);
    drawCursor(ctx, common, plotLeft, plotW, top + 1, floorY + 5);
    var si = STATE.scrubberIdx;
    if (Y && typeof si === 'number' && si >= 0 && si <= common.lastIdx) {
      var tv = tideAt(common.allTimes[si].getTime());
      if (tv) drawScrubberDot(ctx, X(common.allTimes[si].getTime()), Y(tv.v));
    }
    return { canvas: canvas, cssW: cssW, cssH: cssH, plotLeft: plotLeft, plotW: plotW, top: top, h: hgt, tideMin: tMin, tideMax: tMax };
  }

  // Day labels: same geometry as the app's, plus the selected day lit and
  // a data-off hook so tapping a day jumps to its incoming window.
  function oiRenderDayLabels(common) {
    var host = el('forecast-day-header');
    if (!host) return;
    host.replaceChildren();
    var Wd = host.clientWidth;
    if (Wd <= 0) return;
    var plotLeft = FC_PAD.left, plotW = Wd - FC_PAD.left - FC_PAD.right;
    if (plotW <= 0) return;
    var today = startOfDay(Date.now());
    var sel = selIdx(), c = cs();
    var selOff = c && sel >= 0 ? dayOffsetOf(c.times[sel].getTime()) : 0;
    for (var off = 0; off < common.dayCount; off++) {
      var ds = new Date(common.firstDay); ds.setDate(ds.getDate() + off);
      var de = new Date(ds); de.setDate(de.getDate() + 1);
      var a = Math.max(_fcXFor(ds, common, plotLeft, plotW), plotLeft);
      var b = Math.min(_fcXFor(de, common, plotLeft, plotW), plotLeft + plotW);
      if (b <= a + 8) continue;
      var delta = Math.round((ds - today) / 864e5);
      var w = b - a;
      var label = w >= 96 ? (delta === 0 ? 'TODAY' : delta === 1 ? 'TOMORROW' : dow(ds) + ' ' + (ds.getMonth() + 1) + '/' + ds.getDate())
        : w >= 62 ? (delta === 0 ? 'TODAY' : dow(ds)) : w >= 28 ? dow(ds) : dow(ds).charAt(0);
      var s = document.createElement('span');
      s.className = 'forecast-day-label' + (delta === selOff ? ' is-sel' : '');
      s.textContent = label;
      s.dataset.off = String(delta);
      s.style.left = ((a + b) / 2) + 'px';
      host.appendChild(s);
    }
  }

  // Now marker: a 14 px DOM dot with a CSS ring (compositor only), moved
  // when the chart redraws or once a minute (audit M7).
  function placeNowDot() {
    var cont = el('forecast-chart-container'), c = cs(), g = OI.swellGeom, reef = OI.reef;
    if (!cont || !c || !g || !reef) return;
    var dot = el('oi-nowdot');
    if (!dot) { dot = h('div', { id: 'oi-nowdot', 'aria-hidden': 'true' }); cont.appendChild(dot); }
    var now = Date.now();
    if (now < c.t0 || now > c.tEnd) { dot.style.display = 'none'; return; }
    var v = null;
    for (var i = 0; i < c.times.length - 1; i++) {
      var a = c.times[i].getTime(), b = c.times[i + 1].getTime();
      if (now >= a && now <= b) { var va = reef[i], vb = reef[i + 1]; if (va != null && vb != null) v = va + (vb - va) * (now - a) / (b - a); break; }
    }
    if (v == null) { dot.style.display = 'none'; return; }
    var cv = el('forecast-canvas-swell');
    var top = 0, nd = cv;
    while (nd && nd !== cont) { top += nd.offsetTop; nd = nd.offsetParent; }
    dot.style.display = '';
    dot.style.left = (c.layout.plotLeft + (now - c.t0) / c.tRange * c.layout.plotW) + 'px';
    dot.style.top = (top + g.top + g.h - Math.min(v, g.maxY) / g.maxY * g.h) + 'px';
  }

  // ════════════════════════════════════════════════════════════════════
  // Lineup "chart page"
  // ════════════════════════════════════════════════════════════════════
  var ICON_SUN = '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="2.6"/><g stroke="currentColor" stroke-width="1.3"><path d="M6 0.5v1.8M6 9.7v1.8M0.5 6h1.8M9.7 6h1.8M2.1 2.1l1.3 1.3M8.6 8.6l1.3 1.3M2.1 9.9l1.3-1.3M8.6 3.4l1.3-1.3"/></g></svg>';
  var ICON_N = '<svg viewBox="0 0 12 12"><path d="M6 0.5 9.5 11 6 8.6 2.5 11Z"/></svg>';
  var CHEV_L = '<svg viewBox="0 0 16 12"><path d="M10 0 4 6l6 6z"/></svg>';
  var CHEV_R = '<svg viewBox="0 0 16 12"><path d="M6 0l6 6-6 6z"/></svg>';
  var CHEV_LL = '<svg viewBox="0 0 16 12"><path d="M8 0 2 6l6 6zM15 0 9 6l6 6z"/></svg>';
  var CHEV_RR = '<svg viewBox="0 0 16 12"><path d="M1 0l6 6-6 6zM8 0l6 6-6 6z"/></svg>';

  // Fallback search directions for label placement (after the preferred ones).
  var COMPASS8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  // Label geometry: measured with the real face (Orbitron 800 + its
  // letter-spacing), so boxes are true and the gap check means something.
  var _mctx = null;
  function textW(str, size, track) {
    if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
    _mctx.font = '800 ' + size + 'px "OI Sans", "Orbitron", sans-serif';
    return _mctx.measureText(str).width + str.length * size * (track || 0.04);
  }

  function oiDrawLineupMap(marine, wind, _buoy, hourIdx) {
    var svg = el('lineup-overlay'), frame = el('lineup-frame');
    if (!svg || !frame) return;
    var Wd = frame.clientWidth, Hd = frame.clientHeight;
    if (!Wd || !Hd) return;
    svg.setAttribute('viewBox', '0 0 ' + Wd + ' ' + Hd);
    svg.setAttribute('preserveAspectRatio', 'none');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var ns = 'http://www.w3.org/2000/svg';
    var mk = function (tag, at, parent) { var e = document.createElementNS(ns, tag); for (var k in at) e.setAttribute(k, at[k]); (parent || svg).appendChild(e); return e; };
    var hr = marine && marine.hourly;
    var i = typeof hourIdx === 'number' && hourIdx >= 0 ? hourIdx : selIdx();
    if (!hr || i < 0) return;
    var B = curPal(), night = OI.light === 'night';
    var ink = B.ink, halo = night ? '#000000' : '#04101c';
    var cx = Wd / 2, cy = Hd / 2, R = Math.min(Wd, Hd) * 0.47;
    var pt = function (deg, r) { var t = deg * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
    var t = new Date(hr.time[i]).getTime();
    frame.setAttribute('data-scene', sceneAt(t));
    var gLines = mk('g', {}), gLabels = mk('g', {});

    // ── Obstacles: everything a label must not sit on.
    var placed = [];
    var GAP = 4;   // minimum clear gap between a label and anything else
    var hit = function (b) {
      for (var q = 0; q < placed.length; q++) {
        var o = placed[q];
        if (b.x - GAP < o.x + o.w && b.x + b.w + GAP > o.x && b.y - GAP < o.y + o.h && b.y + b.h + GAP > o.y) return true;
      }
      return false;
    };
    var block = function (x, y, r) { placed.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }); };
    var blockSeg = function (a, b, r) {
      var n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
      for (var k = 0; k <= n; k++) block(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, r);
    };

    // Swell window cone in chart magenta.
    var e1 = pt(CH.swellWindowMin, R), e2 = pt(CH.swellWindowMax, R);
    mk('path', { d: 'M' + cx + ' ' + cy + ' L' + e1[0] + ' ' + e1[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + e2[0] + ' ' + e2[1] + ' Z',
      fill: A(B.winRgb, night ? 0.13 : 0.16), stroke: B.win, 'stroke-width': '1.8', 'stroke-dasharray': '6 4' }, gLines);
    blockSeg([cx, cy], e1, 3); blockSeg([cx, cy], e2, 3);
    for (var ad = CH.swellWindowMin; ad <= CH.swellWindowMax; ad += 4) { var ap = pt(ad, R); block(ap[0], ap[1], 3); }
    block(cx, cy, 14);
    var rf = pt(LINEUP_REEF_HEADING, R * 0.28);
    blockSeg([cx, cy], rf, 3);

    // ── Label placer. Tries positions around an anchor along preferred
    // directions, box edge `dist` px out; first clear one wins. Far from
    // its anchor → a short leader line in the label's colour.
    var place = function (spec) {
      var lines = spec.lines.filter(Boolean), size = spec.size, s2 = size * 0.72;
      var ws = lines.map(function (l, k) { return k ? textW(l, s2, 0.12) : textW(l, size, 0.04); });
      var w = Math.max.apply(null, ws) + 6, hgt = size * 1.15 + (lines.length > 1 ? s2 * 1.25 : 0);
      var best = null, bestHits = 1e9;
      var tryAt = function (bx, by) {
        bx = Math.max(3, Math.min(Wd - w - 3, bx)); by = Math.max(3, Math.min(Hd - hgt - 3, by));
        var b = { x: bx, y: by, w: w, h: hgt };
        if (!hit(b)) { best = b; return true; }
        return false;
      };
      var dirsP = spec.dirs.concat(COMPASS8);
      outer:
      for (var dist = spec.min || 4; dist <= 170; dist += 5) {
        for (var d = 0; d < (dist <= 90 ? spec.dirs.length : dirsP.length); d++) {
          var u = dirsP[d], m = Math.hypot(u[0], u[1]); u = [u[0] / m, u[1] / m];
          var ext = Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * hgt / 2;
          var ccx = spec.at[0] + u[0] * (dist + ext), ccy = spec.at[1] + u[1] * (dist + ext);
          if (tryAt(ccx - w / 2, ccy - hgt / 2)) break outer;
        }
      }
      if (!best) best = { x: Math.max(3, Math.min(Wd - w - 3, spec.at[0] - w / 2)), y: Math.max(3, Math.min(Hd - hgt - 3, spec.at[1] + 8)), w: w, h: hgt };
      placed.push(best);
      // Leader when the label sits off its anchor.
      var nx = Math.max(best.x, Math.min(best.x + best.w, spec.at[0])), ny = Math.max(best.y, Math.min(best.y + best.h, spec.at[1]));
      var far = Math.hypot(nx - spec.at[0], ny - spec.at[1]);
      if (far > (spec.leaderAt || 14)) {
        mk('line', { x1: spec.at[0], y1: spec.at[1], x2: nx, y2: ny, stroke: halo, 'stroke-width': 3.6, 'stroke-linecap': 'round', 'stroke-opacity': 0.85 }, gLines);
        mk('line', { x1: spec.at[0], y1: spec.at[1], x2: nx, y2: ny, stroke: spec.colors[0], 'stroke-width': 1.3, 'stroke-linecap': 'round' }, gLines);
        mk('circle', { cx: spec.at[0], cy: spec.at[1], r: 2.2, fill: spec.colors[0] }, gLines);
      }
      var mx = best.x + best.w / 2;
      var tx = mk('text', { x: mx, y: best.y + size * 0.62, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'oi-svg-label',
        'font-size': size, fill: spec.colors[0] || ink, stroke: halo, 'stroke-width': 4.2, 'data-r': spec.role || '' }, gLabels);
      lines.forEach(function (l, k) {
        var ts = document.createElementNS(ns, 'tspan');
        ts.setAttribute('x', mx);
        if (k) { ts.setAttribute('dy', (size * 0.55 + s2 * 0.75).toFixed(1)); ts.setAttribute('font-size', s2.toFixed(1)); ts.setAttribute('letter-spacing', '0.12em'); if (spec.colors[k]) ts.setAttribute('fill', spec.colors[k]); }
        ts.textContent = l;
        tx.appendChild(ts);
      });
      OI.lineupBoxes = (OI.lineupBoxes || []).concat([{ text: lines.join(' / '), x: best.x, y: best.y, w: best.w, h: best.h }]);
      return best;
    };
    OI.lineupBoxes = [];

    var scale = R / 40;
    var arrows = [];
    // Arrow styles: reef = solid sounding blue; blocked = grey dashed
    // hollow; wind = its code colour, dashed.
    var arrow = function (fromDeg, len, w, style) {
      if (fromDeg == null) return null;
      var head = pt(fromDeg, 11), tail = pt(fromDeg, 11 + len);
      var g = mk('g', {}, gLines);
      var th = fromDeg * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th), px = Math.cos(th), py = Math.sin(th);
      var hl = 8 + w * 2.2, hw = 4 + w * 1.4;
      var hb = [head[0] + ux * hl, head[1] + uy * hl];
      var tri = head[0] + ',' + head[1] + ' ' + (hb[0] - px * hw) + ',' + (hb[1] - py * hw) + ' ' + (hb[0] + px * hw) + ',' + (hb[1] + py * hw);
      mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: halo, 'stroke-width': w + 4, 'stroke-linecap': 'round', 'stroke-opacity': 0.9 }, g);
      mk('polygon', { points: tri, fill: halo, stroke: halo, 'stroke-width': 4, 'stroke-linejoin': 'round', 'stroke-opacity': 0.9 }, g);
      mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: style.c, 'stroke-width': w, 'stroke-linecap': style.solid ? 'round' : 'butt', 'stroke-dasharray': style.dash || 'none' }, g);
      mk('polygon', { points: tri, fill: style.hollow ? halo : style.c, stroke: style.c, 'stroke-width': style.hollow ? 1.8 : 0, 'stroke-linejoin': 'round' }, g);
      blockSeg(head, tail, Math.max(4, w / 2 + 2));
      return { tail: tail, u: [ux, uy] };
    };
    var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
    var h1 = (hr.swell_wave_height || [])[i], p1 = (hr.swell_wave_period || [])[i], d1 = (hr.swell_wave_direction || [])[i];
    var h2 = (hr.secondary_swell_wave_height || [])[i], p2 = (hr.secondary_swell_wave_period || [])[i], d2 = (hr.secondary_swell_wave_direction || [])[i];
    var wH = wind && wind.hourly, ws = wH ? (wH.wind_speed_10m || [])[i] : null, wd = wH ? (wH.wind_direction_10m || [])[i] : null;
    var sl = function (hh, pp) { return ftStr(hh) + 'ft @ ' + (pp != null ? Math.round(pp) : '–') + 's'; };
    var c1 = swellDirClass(d1), c2 = swellDirClass(d2);
    var word = function (c) { return c === 'dir-in' ? 'IN WINDOW' : c === 'dir-edge' ? 'EDGE' : 'BLOCKED'; };
    var wcol = function (c) { return c === 'dir-in' ? B.win : c === 'dir-edge' ? B.edge : B.out; };
    var sty = function (inw) { return inw ? { c: night ? B.reefInk : '#5aa9f2', solid: true } : { c: B.out, dash: '7 5', hollow: true }; };
    var in1 = d1 != null && c1 !== 'dir-out', in2 = d2 != null && c2 !== 'dir-out';
    // Draw all three arrows first (so every shaft is an obstacle) …
    var a2 = (h2 != null && d2 != null && h2 >= 0.3) ? arrow(d2, clamp(Math.sqrt(h2 * h2 * (p2 || 1)) * 1.5, 13, 30) * scale, 3, sty(in2)) : null;
    var a1 = (h1 != null && d1 != null) ? arrow(d1, clamp(Math.sqrt(h1 * h1 * (p1 || 1)) * 1.5, 16, 32) * scale, 5, sty(in1)) : null;
    var wc = wd != null ? windClass(ws, wd) : null, wcl = wc ? B[wc] : B.ink2;
    var aw = wd != null ? arrow(wd, clamp((ws || 0) * 0.7, 13, 30) * scale, 2.6, { c: wcl, dash: '6 4' }) : null;

    // … then the window's edges, named at the outer end of their own ray,
    // on the outside of the cone …
    var dirOut = function (deg, sign) { var r = deg * Math.PI / 180; return [sign * Math.cos(r), sign * Math.sin(r)]; };
    var u1 = pt(CH.swellWindowMin, 1), u1v = [u1[0] - cx, u1[1] - cy], u2 = pt(CH.swellWindowMax, 1), u2v = [u2[0] - cx, u2[1] - cy];
    var o1 = dirOut(CH.swellWindowMin, -1), o2 = dirOut(CH.swellWindowMax, 1);
    place({ role: 'swpt', lines: ['SW PT (BLOCK)', CH.swellWindowMin + '°'], colors: [B.win, B.win], size: 10.5, at: e1,
      dirs: [o1, [o1[0] + u1v[0], o1[1] + u1v[1]], u1v, [0, -1], [1, 0]], min: 3, leaderAt: 10 });
    place({ role: 'montauk', lines: ['MONTAUK PT', CH.swellWindowMax + '°'], colors: [B.win, B.win], size: 10.5, at: e2,
      dirs: [o2, [o2[0] + u2v[0], o2[1] + u2v[1]], [-1, 0], u2v, [-1, -0.4]], min: 3, leaderAt: 10 });

    // … then the readings: primary swell first, then the second train,
    // then the wind. Each off its arrow's tail, a leader if it had to move.
    var arrowLabel = function (a, lines, colors, role) {
      if (!a) return;
      var u = a.u, pr = [-u[1], u[0]], pl = [u[1], -u[0]];
      place({ role: role, lines: lines, colors: colors, size: 13, at: a.tail, dirs: [u, [u[0] + pr[0], u[1] + pr[1]], [u[0] + pl[0], u[1] + pl[1]], pr, pl], min: 3, leaderAt: 12 });
    };
    if (a1) arrowLabel(a1, [sl(h1, p1), word(c1)], [in1 ? ink : B.out, wcol(c1)], 'swell1');
    if (a2) arrowLabel(a2, [sl(h2, p2), word(c2)], [in2 ? ink : B.out, wcol(c2)], 'swell2');
    if (aw) arrowLabel(aw, [(ws != null ? Math.round(ws) : '–') + 'mph ' + directionLabel(wd), wc ? WIND_WORD[wc] : ''], [wcl, wcl], 'wind');

    mk('line', { x1: cx, y1: cy, x2: rf[0], y2: rf[1], stroke: ink, 'stroke-width': 1.4, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.85 }, gLines);
    var rl = pt(LINEUP_REEF_HEADING, R * 0.28 + 4);
    place({ lines: ['REEF ' + LINEUP_REEF_HEADING + '°'], colors: [ink], size: 10, at: rl, dirs: [[-1, -0.3], [-1, 0], [0, -1], [1, -0.3]], min: 2, leaderAt: 30 });

    // Lineup mark.
    mk('circle', { cx: cx, cy: cy, r: 9, fill: 'none', stroke: halo, 'stroke-width': 4, 'stroke-opacity': 0.8 });
    mk('circle', { cx: cx, cy: cy, r: 9, fill: 'none', stroke: ink, 'stroke-width': 1.6 });
    mk('circle', { cx: cx, cy: cy, r: 3.2, fill: ink });
    svg.appendChild(gLabels);

    var hud = el('oi-chart-hud');
    if (hud) {
      var sc = sceneAt(t), dl = sun(t);
      var light = sc === 'day' ? ICON_SUN + 'DAYLIGHT' : sc === 'twilight' ? ICON_SUN + 'TWILIGHT' : ICON_MOON + 'AFTER DARK';
      var sunTxt = dl.sunset ? (t < dl.sunset.getTime() && t > dl.sunrise.getTime() ? 'SUNSET ' + clock(dl.sunset).hm + clock(dl.sunset).ap.charAt(0) : 'FIRST LIGHT ' + clock(t > dl.sunset.getTime() ? sun(t + 864e5).firstLight : dl.firstLight).hm + 'A') : '';
      hud.innerHTML = '<span class="oi-chip' + (sc === 'day' ? '' : ' is-dark') + '">' + light + '</span>' + (sunTxt ? '<span class="oi-chip">' + sunTxt + '</span>' : '');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Web: build the instrument
  // ════════════════════════════════════════════════════════════════════
  var LOGO = '<svg class="oi-logo" viewBox="0 0 22 14" aria-hidden="true"><path fill="#5db4ff" d="M0 9 Q3 3 6 8 T12 8 T18 8 L22 8 L22 14 L0 14Z" opacity=".95"/><circle cx="17.5" cy="3" r="1.6" fill="#b3c1d4"/></svg>';
  // 16×16, 16-colour pixel anchor for the gate (no emoji in the skin).
  function anchorSVG() {
    var rows = [
      '......0000......',
      '.....0dd110.....',
      '.....01..10.....',
      '.....01..10.....',
      '......0110......',
      '...000011000....',
      '...0dddddd10....',
      '...000011000....',
      '.......11.......',
      '.......11.......',
      '.0.....11.....0.',
      '010....11....010',
      '.010...11...010.',
      '..0110.11.0110..',
      '...0111111110...',
      '.....000000.....'
    ];
    var col = { '0': '#000080', '1': '#008080', 'd': '#ffffff' }, s = '';
    rows.forEach(function (r, y) { for (var x = 0; x < 16; x++) { var c = col[r[x]]; if (c) s += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + c + '"/>'; } });
    return '<svg viewBox="0 0 16 16" aria-hidden="true">' + s + '</svg>';
  }

  // Swell legend (phone graph + Choc TV radar chart): every mark drawn.
  // Row 1 (beside the title): the lines; row 2 (on the plot): the code.
  var LEG = {
    reef: '<span class="lr"><i class="oi-sw oi-sw-reef"></i>REACHES</span>', dots: '<span class="lo"><i class="oi-sw oi-sw-dots"></i>BLOCKED</span>',
    win: '<span class="lw"><i class="oi-sw oi-sw-win"></i>WINDOW</span>', per: '<span class="lp"><i class="oi-sw oi-sw-line"></i>PERIOD<i class="u">s&nbsp;→</i></span>',
    buoy: '<span class="lb"><i class="oi-dia"></i>BUOY</span>', br: '<span class="oi-lbr"></span>'
  };
  var SWELL_LEGEND = '<span class="oi-legend">' + LEG.per + LEG.buoy + LEG.br + LEG.reef + LEG.dots + LEG.win + '</span>';
  var SWELL_LEGEND_TV = '<span class="oi-legend">' + LEG.reef + LEG.dots + LEG.win + LEG.per + LEG.buoy + '</span>';
  function bar(left, right, id) {
    var b = h('div', { class: 'oi-bar' }, '<span>' + dots(left) + '</span>' + (right ? '<span class="oi-bar-r">' + dots(right) + '</span>' : ''));
    if (id) b.id = id;
    return b;
  }

  // The colour key (SET › COLOUR KEY, and the "?" key on the bezel).
  function keySheetHTML() {
    var row = function (lead, text) { return '<div class="nv-key-r"><span class="nv-key-l">' + lead + '</span><span class="nv-key-t">' + text + '</span></div>'; };
    var grp = function (cap, rows) { return '<div class="nv-key-g"><span class="oi-cap">' + cap + '</span><div class="nv-key-rows">' + rows + '</div></div>'; };
    var ramp = '<span class="nv-key-ramp">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (k) { return '<i style="background:' + rampColor(k / 9) + '"></i>'; }).join('') + '</span>';
    var dot = function (c) { return '<i class="nv-key-dot" style="background:var(--c-' + c + ')"></i>'; };
    return grp('WINDOW<br>' + CH.swellWindowMin + '–' + CH.swellWindowMax + '°',
        row(tagHTML('dir-in'), 'Aimed through the gap between Montauk Pt and SW Pt (Block). Magenta is the window, everywhere.') +
        row(tagHTML('dir-edge'), 'On the edge: some of it wraps in.') +
        row(tagHTML('dir-out'), 'Aimed outside the gap: Montauk or Block Island stops it. Grey + hatch.')) +
      grp('SWELL',
        row('<i class="oi-sw oi-sw-reef"></i><span class="nv-key-w">REACHES</span>', 'Solid sounding blue: the swell that gets to the reef.') +
        row('<i class="oi-sw oi-sw-dots"></i><span class="nv-key-w">BLOCKED<br>SWELL</span>', 'Grey dots behind the blue: swell offshore that the points stop.') +
        row('<i class="oi-sw oi-sw-line"></i><span class="nv-key-w">PERIOD</span>', 'White line, right axis. Dashed while the lead swell is blocked. <span class="oi-dia"></span> is the buoy.')) +
      grp('WIND',
        row(windWord('off'), 'Solid. Grooms the faces.') +
        row(windWord('cross', true), 'Hatched. Side-shore.') +
        row(windWord('on'), 'Cross-hatched. Bumpy. Coral, never red.')) +
      grp('TIDE',
        row('<span class="nv-key-w"><span class="oi-tri up nv-tide-c"></span> RISING</span>', 'Sounding blue ▲; <span class="nv-tide-c">▼</span> falling, and the lows.') +
        row('<i class="oi-sw oi-sw-band"></i><span class="nv-key-w">INCOMING</span>', 'Low to high in daylight: Choc’s go window. Blue band, blue floor bar.') +
        row('<i class="oi-sw oi-sw-dark"></i>' + darkChip('night'), 'Outside daylight: darker hours, grey dotted floor, dimmed and labelled.')) +
      grp('YOUR<br>MODEL', row(ramp, 'Lavender ramp + the number, 0–10, from your logged sessions.')) +
      grp('DATA',
        row(dot('fresh') + '<span class="nv-key-w" style="color:var(--c-fresh)">FRESH</span>', 'Forecast under 75 min, buoy under 2 h.') +
        row(dot('stale') + '<span class="nv-key-w" style="color:var(--c-stale)">STALE</span>', 'Forecast over 75 min, buoy 2–6 h.') +
        row(dot('dead') + '<span class="nv-key-w" style="color:var(--c-dead)">DEAD</span>', 'Forecast over 3 h, buoy over 6 h. Red means dead data and nothing else.'));
  }
  function renderKey() { var k = el('oi-key'); if (k) k.innerHTML = keySheetHTML(); }

  var buildWeb = guard('buildWeb', function () {
    var body = document.body;
    // One skin: the three Win95 sheets step aside (the gate is restyled here).
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      if (/styles-(web1|web1-extensions|retro)\.css/.test(l.getAttribute('href') || '')) l.disabled = true;
    });
    body.classList.add('oi');

    var top = h('div', { id: 'oi-top' },
      LOGO + '<span class="oi-brand">LETSCHECKCHOC</span><span class="oi-model">CHOC<span class="oi-sep"></span>44097</span>' +
      '<span class="oi-spacer"></span>' +
      // Two pilots, two ages: the forecast and the buoy are never one light.
      '<span class="oi-ledwrap" id="oi-ledwrap" data-state="busy" title="Forecast age"><span class="oi-led" id="oi-led" data-state="busy"></span><span id="oi-led-label">FCST</span></span>' +
      '<span class="oi-ledwrap" id="oi-ledwrap-b" data-state="busy" title="Buoy 44097 age"><span class="oi-led" id="oi-led-b" data-state="busy"></span><span>BUOY</span></span>' +
      '<button type="button" id="oi-keybtn" aria-label="Colour key">?</button>');
    var keys = h('nav', { id: 'oi-keys', 'aria-label': 'Pages' });
    [['fcst', 'FCST'], ['log', 'LOG'], ['model', 'MODEL'], ['set', 'SET']].forEach(function (k) {
      var b = h('button', { type: 'button', class: 'oi-key', 'data-key': k[0], 'aria-pressed': k[0] === 'fcst' ? 'true' : 'false' }, k[1]);
      b.addEventListener('click', function () { OI.softkey(k[0]); });
      keys.appendChild(b);
    });
    var lamp = ['win', 'edge', 'out', 'reef', 'off', 'on', 'tide', 'ramp-hi', 'dead'].map(function (c) { return '<i style="background:var(--c-' + c + ')"></i>'; }).join('');
    var self = h('div', { id: 'oi-selftest', 'aria-hidden': 'true' },
      '<div class="oi-st-cap">' + dots('LETSCHECKCHOC · CHOC 44097') + '</div>' +
      '<div class="oi-st-line oi-st-big">' + seg('88.8') + '</div>' +
      '<div class="oi-st-line oi-st-mid">' + seg('88:88') + seg('888') + '</div>' +
      '<div class="oi-st-codes">' + lamp + '</div>' +
      '<div class="oi-st-cap" style="margin-top:auto">LAMP TEST</div>');
    body.appendChild(self);
    body.appendChild(h('div', { id: 'oi-mask', 'aria-hidden': 'true' }));
    body.appendChild(h('div', { id: 'oi-glass', 'aria-hidden': 'true' }));
    body.appendChild(top);
    body.appendChild(keys);
    el('oi-keybtn').addEventListener('click', function () { OI.showKey(); });

    // Gate: question once (title bar says who's asking), pixel anchor.
    var gt = el('gate-titlebar-text'); if (gt) gt.textContent = 'LetsCheckChoc';
    var gi = document.querySelector('#gate-card .gate-icon'); if (gi) gi.innerHTML = anchorSVG();
    var gov = el('gate-overlay');
    var syncGate = function () { body.classList.toggle('oi-gate', !!gov && !gov.classList.contains('hidden')); };
    if (gov) { syncGate(); new MutationObserver(syncGate).observe(gov, { attributes: true, attributeFilter: ['class'] }); }

    // ── Forecast page ──
    var vf = el('view-forecast');
    var readout = h('section', { id: 'oi-readout', 'aria-live': 'polite' });
    var week = h('section', { id: 'oi-week' });
    week.appendChild(bar('THIS WEEK AT CHOC', 'TAP A DAY'));
    week.appendChild(h('div', { class: 'oi-days', id: 'oi-days' }));
    var hb = h('div', { id: 'oi-hourbar' },
      '<button type="button" class="oi-hb-btn" data-j="pl" aria-label="Previous daylight low">' + CHEV_LL + 'LOW</button>' +
      '<button type="button" class="oi-hb-btn" data-j="ph" aria-label="Previous hour">' + CHEV_L + '1H</button>' +
      '<button type="button" class="oi-hb-mid" id="oi-hb-mid" aria-label="Selected hour (tap to return to now)"></button>' +
      '<button type="button" class="oi-hb-btn" data-j="nh" aria-label="Next hour">' + CHEV_R + '1H</button>' +
      '<button type="button" class="oi-hb-btn" data-j="nl" aria-label="Next daylight low">' + CHEV_RR + 'LOW</button>' +
      '<div class="oi-hb-echo" id="oi-hb-echo"></div>');
    hb.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'oi-hb-mid') { if (!(selIdx() === nowIdx())) resetScrubberToNow(); return; }
      OI.step(b.dataset.j);
    });
    var chart = h('section', { id: 'oi-right' });
    chart.appendChild(h('div', { class: 'oi-chart-head' }));
    var graph = h('section', { id: 'oi-graphcol' });
    graph.appendChild(bar('GRAPH · 7 DAYS', 'TAP A DAY · DRAG'));
    var lineup = el('panel-lineup'), pf = el('panel-forecast');
    var left = h('div', { id: 'oi-left' }), main = h('div', { id: 'oi-main' });
    vf.insertBefore(left, vf.firstChild);
    left.after(main);
    left.appendChild(readout);
    left.appendChild(week);
    main.appendChild(hb);
    main.appendChild(chart);
    chart.appendChild(lineup);
    main.appendChild(graph);
    graph.appendChild(pf);
    var frame = el('lineup-frame');
    if (frame) {
      frame.appendChild(h('div', { class: 'oi-chart-hud', id: 'oi-chart-hud' }));
      var north = h('div', { class: 'oi-chart-hud', style: 'left:auto;right:8px' }, '<span class="oi-chip">' + ICON_N + 'N</span>');
      frame.appendChild(north);
    }
    vf.classList.add('oi-grid');

    // Legends inside the stacked chart labels: the colour code, first time it appears.
    var lbl = function (sel, html) { var l = document.querySelector(sel + ' .forecast-section-label'); if (l) l.innerHTML = html; };
    lbl('.forecast-card-swell', '<span>SWELL</span>' + SWELL_LEGEND);
    lbl('.forecast-card-wind', '<span>WIND<i class="u">MPH</i></span><span class="oi-legend"><span class="oi-lbr"></span><span class="loff"><i class="oi-sw oi-sw-off"></i>OFFSHORE</span><span class="lcr"><i class="oi-sw oi-sw-cross"></i>CROSS</span><span class="lon"><i class="oi-sw oi-sw-on"></i>ONSHORE</span></span>');
    lbl('.forecast-card-tide', '<span>TIDE<i class="u">FT</i></span><span class="oi-legend"><span class="oi-lbr"></span><span class="lt"><i class="oi-sw oi-sw-band"></i>INCOMING</span><span class="lt"><i class="oi-tri-sm"></i>LOW</span><span class="ld"><i class="oi-sw oi-sw-dark"></i>AFTER DARK</span></span>');
    var dayRow = el('forecast-day-header');
    if (dayRow) {
      dayRow.removeAttribute('aria-hidden');
      dayRow.addEventListener('click', function (e) {
        var s = e.target.closest('.forecast-day-label');
        if (s) OI.jumpDay(parseInt(s.dataset.off, 10));
      });
    }

    // More at Choc: what used to sit between the chart and the footer.
    var more = h('section', { id: 'oi-more' });
    more.appendChild(bar('MORE AT CHOC', ''));
    var menu = h('div', { class: 'oi-menu' });
    var row = function (title, right, nodes, onOpen) {
      var d = h('details', {}, '<summary>' + title + '<span class="oi-sum-r">' + (right || '') + '</span></summary>');
      var bd = h('div', { class: 'oi-menu-body' });
      nodes.forEach(function (n) { if (n) bd.appendChild(n); });
      d.appendChild(bd);
      d.addEventListener('toggle', function () { if (d.open && onOpen) setTimeout(onOpen, 30); });
      menu.appendChild(d);
      return d;
    };
    row('BUOY 44097 SPECTRA', '<span id="oi-sum-buoy"></span>', [el('panel-spectral-row')], function () {
      if (STATE.lastSpectral) { invalidateCanvasDPR(el('compass-canvas')); drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed); }
    });
    row('TIDE TABLE', '<span id="oi-sum-tide"></span>', [el('panel-tides')], function () {
      if (STATE._cachedTidePred) { invalidateCanvasDPR(el('tide-canvas')); drawTideChart(STATE._cachedTidePred); }
    });
    row('WATER &amp; LIGHT', '<span id="oi-sum-water"></span>', [el('conditions-row')]);
    var setLink = h('div', { class: 'oi-setlink', role: 'button', tabindex: '0' }, 'SOURCES, SETTINGS &amp; KEY<span class="oi-sum-r" style="margin-left:auto;font-weight:600;font-size:12px;color:var(--oi-ink-2)">SET KEY</span>');
    setLink.addEventListener('click', function () { OI.softkey('set'); });
    menu.appendChild(setLink);
    more.appendChild(menu);
    main.appendChild(more);

    // ── Setup page (Sources & settings + the colour key) ──
    var setup = h('div', { id: 'oi-view-setup' });
    setup.appendChild(bar('SETUP', 'SOURCES · SETTINGS · KEY'));
    var setRow = function (cap, nodes, note, id) {
      var r = h('div', { class: 'oi-setrow' }, '<div class="oi-cap">' + cap + '</div>');
      if (id) r.id = id;
      nodes.forEach(function (n) { if (n) r.appendChild(n); });
      if (note) r.appendChild(h('div', { class: 'oi-note', id: id ? id + '-note' : null }, note));
      setup.appendChild(r);
      return r;
    };
    var lightSeg = h('div', { class: 'oi-seg-toggle', id: 'oi-light-toggle' });
    [['auto', 'SUN'], ['system', 'SYSTEM'], ['day', 'DAY'], ['night', 'NIGHT']].forEach(function (o) {
      var b = h('button', { type: 'button', 'data-v': o[0] }, o[1]);
      b.addEventListener('click', function () { try { localStorage.setItem('oi-light', o[0]); } catch (_) { /* private mode */ } syncLightToggle(); applyLight(); });
      lightSeg.appendChild(b);
    });
    setRow('DISPLAY LIGHT', [lightSeg], '', 'oi-lightrow');
    setRow('COLOUR KEY', [h('div', { id: 'oi-key' })], null, 'oi-keyrow');
    setRow('STATION &amp; ACCOUNT', [el('app-header')]);
    setRow('FORECAST MODEL', [el('forecast-controls-bar')]);
    setRow('BUOY MAP', [el('panel-map')]);
    setRow('TIDE STATIONS', [el('panel-tide-map')]);
    setRow('SOURCES', [el('page-footer')], 'Swell &amp; wind: Open-Meteo. Tides: NOAA CO-OPS 8510719 Silver Eel Pond. Buoy: NDBC 44097 via the repo pipeline.');
    el('app').appendChild(setup);

    // ── Surf Log ──
    buildLog();
    syncLightToggle();
  });

  function lightNote() {
    var n = el('oi-lightrow-note'); if (!n) return;
    var dl = sun(Date.now()), ss = dl.sunset ? clock(dl.sunset) : null, sr = dl.sunrise ? clock(sun(Date.now() + 864e5).sunrise) : null;
    n.innerHTML = '<b>SUN</b> switches at sunset at Choc' + (ss ? ' (' + ss.hm + ' ' + ss.ap + ' today)' : '') +
      ': navy by day, phosphor after dark, back at sunrise' + (sr ? ' (' + sr.hm + ' ' + sr.ap + ')' : '') + '. <b>SYSTEM</b> follows the phone’s dark mode. <b>DAY</b> / <b>NIGHT</b> hold one.';
  }
  function syncLightToggle() {
    var pref = 'auto';
    try { pref = localStorage.getItem('oi-light') || 'auto'; } catch (_) { /* private mode */ }
    document.querySelectorAll('#oi-light-toggle button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === pref ? 'true' : 'false'); });
    lightNote();
  }

  OI.softkey = guard('softkey', function (k) {
    var body = document.body;
    body.classList.toggle('oi-setup', k === 'set');
    if (k === 'fcst' || k === 'set') switchTab('forecast');
    else if (k === 'log') switchTab('surflog');
    else if (k === 'model') switchTab('regression');
    document.querySelectorAll('#oi-keys .oi-key').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.key === k ? 'true' : 'false'); });
    if (k === 'set') {
      renderKey(); lightNote();
      setTimeout(function () {
        try { if (STATE.buoyMap) STATE.buoyMap.invalidateSize(); if (STATE.tideMap) STATE.tideMap.invalidateSize(); } catch (_) { /* maps optional */ }
      }, 60);
    }
    window.scrollTo(0, 0);
  });
  OI.showKey = guard('showKey', function () {
    OI.softkey('set');
    var k = el('oi-keyrow');
    if (k) window.scrollTo(0, Math.max(0, k.getBoundingClientRect().top + scrollY - 44));
  });

  // ── Hour selection ─────────────────────────────────────────────────
  function setIdx(i) {
    var c = cs(); if (!c) return;
    i = Math.max(0, Math.min(c.times.length - 1, i));
    STATE.scrubberIdx = i;
    try {
      var t = c.times[i];
      sessionStorage.setItem('lcc-scrubber-hour', t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate()) + 'T' + pad2(t.getHours()) + ':00');
    } catch (_) { /* private mode */ }
    applyScrubberToHour(i);
  }
  OI.jumpTo = function (ms) { var c = cs(); if (c) setIdx(findHourIndexForTime(ms, c)); };
  OI.step = guard('step', function (j) {
    var c = cs(); if (!c) return;
    var i = selIdx(), t = c.times[i].getTime();
    if (j === 'ph') return setIdx(i - 1);
    if (j === 'nh') return setIdx(i + 1);
    var lows = daylightLows();
    if (j === 'nl') { for (var k = 0; k < lows.length; k++) if (lows[k].t > t + 40 * 60e3) return OI.jumpTo(lows[k].t); }
    if (j === 'pl') { for (var m = lows.length - 1; m >= 0; m--) if (lows[m].t < t - 40 * 60e3) return OI.jumpTo(lows[m].t); }
  });
  OI.jumpDay = guard('jumpDay', function (off) {
    var d0 = startOfDay(Date.now(), off).getTime(), d1 = d0 + 864e5;
    var lows = daylightLows().filter(function (l) { return l.t >= d0 && l.t < d1; });
    if (lows.length) return OI.jumpTo(lows[0].t);
    var dl = sun(d0 + 12 * HOUR);
    OI.jumpTo(dl.sunrise ? dl.sunrise.getTime() + HOUR : d0 + 8 * HOUR);
  });

  // ── Readout ────────────────────────────────────────────────────────
  function buoyLine() {
    var txt = function (id) { var e = el(id); return e ? (e.textContent || '').trim() : ''; };
    var hgt = (txt('val-swell-height').match(/([\d.]+)\s*ft/) || [])[1];
    var det = txt('val-swell-detail'), arr = txt('val-swell-arrival');
    if (!hgt) return '';
    var per = (det.match(/(\d+(?:\.\d+)?)s/) || [])[1];
    var dir = (det.match(/·\s*([NESW]{1,3})\s*\(/) || [])[1] || '';
    var reach = (arr.match(/(reach(?:es|ed)) Choc ~([\d:]+ [AP]M)/) || []);
    var obs = (arr.match(/Buoy obs ([^(]+?)\s*\(/) || []);
    // Freshness code on the buoy's real age: < 2 h live, 2–6 h stale, > 6 h dead.
    var ba = buoyAge(), age = '';
    if (ba.ms != null) age = '<span class="oi-agecode" data-s="' + (ba.state === 'live' ? 'fresh' : ba.state) + '">' + ageText(ba.ms) + '</span>';
    return '<div class="oi-buoy"><b>BUOY 44097 MEASURED</b>&nbsp; ' + seg(hgt) + '<b>ft</b> @ ' + seg(per || '–') + '<b>s</b> ' + dir +
      '<br>' + (reach[1] ? 'AT THE REEF <b>' + reach[2].replace(/ ([AP])M$/, '$1') + '</b>' : '') +
      (obs[1] ? '<span class="oi-sep"></span>OBS ' + esc(obs[1].replace(/ ([AP])M$/, '$1')) + ' ' : '') + age + '</div>';
  }

  // Forecast data age, same thresholds as Choc TV: live < 75 min,
  // stale after that, dead after 3 h (KIOSK_DEAD_MS).
  function annAge() {
    var asOf = STATE.dataAsOf, now = Date.now();
    if (!STATE.lastLoadCompletedAt) return { text: 'FETCHING CHOC FORECAST…', state: 'busy', stale: false };
    if (asOf == null || !isFinite(asOf)) return { text: 'NO FORECAST DATA', state: 'dead', stale: true };
    var age = now - asOf, mins = Math.round(age / 60e3);
    if (age < 75 * 60e3) { var c = clock(asOf); return { text: 'UPD ' + c.hm + c.ap.charAt(0), state: 'live', stale: false }; }
    var hrs = Math.floor(mins / 60);
    return { text: 'DATA ' + (hrs ? hrs + 'H ' : '') + (mins % 60) + 'M OLD', state: age > 3 * HOUR ? 'dead' : 'stale', stale: true };
  }
  // Buoy observation age, the thresholds the app's buoy card uses:
  // fresh < 2 h (BUOY_OBS_STALE_MS), stale to 6 h (BUOY_OBS_OLD_MS), dead after.
  function buoyAge() {
    var obsMs = STATE.lastBuoyParsed && STATE.lastBuoyParsed.obsMs;
    if (!obsMs) return { state: STATE.lastLoadCompletedAt ? 'dead' : 'busy', ms: null, obs: null };
    var ms = Date.now() - obsMs;
    return { state: ms > BUOY_OBS_OLD_MS ? 'dead' : ms > BUOY_OBS_STALE_MS ? 'stale' : 'live', ms: ms, obs: obsMs };
  }
  function ageText(ms) {
    var hh = Math.floor(ms / HOUR), mm = Math.round((ms % HOUR) / 60e3);
    return (hh ? hh + 'H ' : '') + (hh < 6 ? mm + 'M ' : '') + 'OLD';
  }
  var STATE_WORD = { live: 'fresh', busy: 'loading', stale: 'stale', dead: 'dead' };
  function syncLed() {
    var a = annAge(), b = buoyAge();
    [['oi-led', 'oi-ledwrap', a, 'Forecast'], ['oi-led-b', 'oi-ledwrap-b', b, 'Buoy 44097']].forEach(function (x) {
      var led = el(x[0]), wrap = el(x[1]);
      if (led) led.setAttribute('data-state', x[2].state);
      if (wrap) { wrap.setAttribute('data-state', x[2].state); wrap.setAttribute('aria-label', x[3] + ' ' + STATE_WORD[x[2].state]); }
    });
    return a;
  }

  function renderReadout(d) {
    var box = el('oi-readout');
    if (!box) return;
    if (!d) {
      box.innerHTML = '<div class="oi-ann"><span class="oi-mode">NOW</span><span class="oi-when">FETCHING CHOC FORECAST…</span></div>' +
        '<div class="oi-hero"><div class="oi-hero-cap oi-cap"><i class="nv-sw"></i>REACHES THE REEF</div><div class="oi-hero-row"><div class="oi-hero-num">' + seg('!!!', 'oi-seg-xl oi-b') + '</div></div></div>';
      return;
    }
    var ck = clock(d.showT), age = syncLed();
    var off = Math.round((d.t - Date.now()) / HOUR);
    var ageCode = age.state === 'live' ? 'fresh' : age.state === 'busy' ? 'fresh' : age.state;
    var ann = '<div class="oi-ann"><span class="oi-mode' + (d.isNow ? '' : ' is-off') + '">' + (d.isNow ? 'NOW' : (off > 0 ? '+' : '-') + Math.abs(off) + ' H') + '</span>' +
      '<span class="oi-when">' + dow(d.showT) + ' ' + (new Date(d.showT).getMonth() + 1) + '/' + new Date(d.showT).getDate() + '<span class="oi-sep"></span>' + ck.hm + ' ' + ck.ap + '</span>' +
      '<span class="oi-age"><span class="oi-agecode" data-s="' + ageCode + '">' + age.text + '</span></span></div>';
    var L = d.lead, hero, dark = d.scene !== 'day';
    if (L) {
      var out = L.cls === 'dir-out';
      var otherTag = d.other ? (d.other.cls === 'dir-out' ? '<span class="nv-blk">BLOCKED</span>' : d.other.cls === 'dir-edge' ? '<span class="nv-blk is-edge">EDGE</span>' : '<span class="nv-blk is-in">IN</span>') : '';
      hero = '<div class="oi-hero' + (out ? ' is-out' : '') + (dark ? ' is-dark' : '') + '">' +
        '<div class="oi-hero-cap oi-cap"><i class="nv-sw"></i>' + (out ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + (dark ? darkChip(d.scene) : '') + '</div>' +
        '<div class="oi-hero-row"><div class="oi-hero-num">' + seg(ftStr(L.h), 'oi-seg-xl oi-b') + '<span class="oi-u oi-u-xl">ft</span>' +
        '<span class="oi-at">@</span>' + seg(L.p != null ? Math.round(L.p) : '–', 'oi-seg-l oi-b') + '<span class="oi-u oi-u-l">s</span></div>' +
        arrowHTML(L.d, out ? 'is-out' : '', directionLabel(L.d), Math.round(L.d) + '°') + '</div>' +
        '<div class="oi-hero-sub">' + tagHTML(L.cls) +
        (d.other ? '<span class="oi-also">' + (d.other.cls === 'dir-out' ? '<i class="nv-ghost"></i>' : '') + '+ ' + ftStr(d.other.h) + 'ft @ ' + (d.other.p != null ? Math.round(d.other.p) : '–') + 's ' + directionLabel(d.other.d) +
          '<span class="oi-sep"></span>' + otherTag + '</span>' : '') +
        '</div></div>';
    } else {
      hero = '<div class="oi-hero"><div class="oi-hero-cap oi-cap">NO SWELL DATA FOR THIS HOUR</div></div>';
    }
    var T = d.tide, tideCell = '<div class="oi-cell"><div class="oi-cap">TIDE</div>';
    if (T) {
      tideCell += '<div class="oi-cell-val">' + seg((T.v >= 0 ? '' : '-') + fmt1(Math.abs(T.v))) + '<span class="oi-u">ft</span></div>' +
        '<div class="oi-cell-sub nv-tide"><span class="oi-tri ' + (T.rising ? 'up' : 'down') + '"></span>' + (T.rising ? 'RISING' : 'FALLING') + '</div>';
    } else {
      tideCell += '<div class="oi-cell-val">' + seg('!!!') + '</div><div class="oi-cell-sub dim">NO TIDE DATA</div>';
    }
    if (d.next) { var nc = clock(d.next.t); tideCell += '<div class="oi-cell-sub dim" style="margin-top:4px">' + (d.next.type === 'H' ? 'HIGH ' : 'LOW ') + nc.hm + nc.ap.charAt(0) + (d.next.type === 'L' && !isDaylight(d.next.t) ? '<span class="nv-dark" style="margin-left:5px;padding:1px 3px" aria-label="after dark">' + ICON_MOON + '</span>' : '') + '</div>'; }
    tideCell += '</div>';
    var Wn = d.wind, windCell = '<div class="oi-cell oi-cell-wind"><div class="oi-cap">WIND</div>';
    if (Wn) {
      windCell += dialSVG(Wn.dir, Wn.cls) + '<div><div class="oi-cell-val">' + seg(Math.round(Wn.mph)) + '<span class="oi-u">mph ' + directionLabel(Wn.dir) + '</span></div>' +
        '<div class="oi-cell-sub">' + windWord(Wn.cls) + '</div>' +
        (Wn.gust != null ? '<div class="oi-cell-sub dim" style="margin-top:4px">GUST ' + Math.round(Wn.gust) + '</div>' : '') + '</div>';
    } else {
      windCell += '<div class="oi-cell-sub dim">NO WIND DATA</div>';
    }
    windCell += '</div>';
    var M = d.model, modelCell = '<div class="oi-modelstrip"><span class="oi-cap">YOUR<br>MODEL</span>';
    if (M) {
      modelCell += '<span class="oi-val">' + seg(fmt1(M.mean), 'oi-b') + '<span class="oi-u">/10</span></span>' +
        '<span class="oi-mrow"><span>SIZE</span>' + meter(M.w) + '</span><span class="oi-mrow"><span>RIDE</span>' + meter(M.r) + '</span><span class="oi-mrow"><span>WIND</span>' + meter(M.c) + '</span>';
    } else {
      modelCell += '<span class="oi-cell-sub dim">LOG 3+ SESSIONS TO TRAIN IT</span>';
    }
    modelCell += '</div>';
    var extra = '';
    if (d.isNow) {
      extra += buoyLine();
      var dl = sun(d.showT), lows = daylightLows(), nextLow = null;
      for (var i = 0; i < lows.length; i++) if (lows[i].t > d.showT) { nextLow = lows[i]; break; }
      var afterDark = !dl.sunset || d.showT > dl.sunset.getTime() - 45 * 60e3;
      if (afterDark && nextLow) {
        var c2 = clock(nextLow.t);
        extra += '<button type="button" class="oi-nextwin" data-t="' + nextLow.t + '"><span>NEXT WINDOW<span class="oi-sep"></span>' + dayName(nextLow.t).slice(0, 3) + ' LOW ' + c2.hm + ' ' + c2.ap + '</span><span class="oi-chev"></span></button>';
      }
    }
    box.innerHTML = ann + hero + '<div class="oi-cells">' + tideCell + windCell + '</div>' + modelCell + extra;
    var nw = box.querySelector('.oi-nextwin');
    if (nw) nw.addEventListener('click', function () { OI.jumpTo(+nw.dataset.t); });
  }

  function renderHourbar(d) {
    var mid = el('oi-hb-mid'), echo = el('oi-hb-echo');
    if (!mid || !d) return;
    var ck = clock(d.showT), L = d.lead, W2 = d.wind, T = d.tide, M = d.model;
    var off = Math.round((d.t - Date.now()) / HOUR);
    var chip = d.isNow ? '<span class="oi-hb-now">NOW</span>'
      : '<span class="oi-hb-now is-off">' + (off > 0 ? '+' : '-') + Math.abs(off) + ' H<span class="oi-sep"></span>TAP FOR NOW</span>';
    mid.innerHTML = '<span class="oi-hb-time"><span class="oi-dow">' + dow(d.showT) + '</span>' + seg(ck.hm) + '<span class="oi-u">' + ck.ap + '</span></span>' +
      '<span style="display:flex;gap:5px;align-items:center">' + chip + (d.scene !== 'day' ? darkChip(d.scene) : '') + '</span>';
    if (!echo) return;
    var f = [];
    var tc = L ? (L.cls === 'dir-in' ? 'c-in' : L.cls === 'dir-edge' ? 'c-edge' : 'c-out') : '';
    f.push(L ? '<b>' + ftStr(L.h) + 'ft@' + (L.p != null ? Math.round(L.p) : '–') + 's</b> <span class="' + tc + '">' + (TAG[L.cls] ? TAG[L.cls][2] : '') + '</span>' : '<b>–</b>');
    f.push(W2 ? '<span class="oi-windword nv-w-' + (W2.cls || 'none') + '" title="' + (WIND_WORD[W2.cls] || '') + '">' + Math.round(W2.mph) + 'mph</span>' : '<b>–</b>');
    f.push(T ? '<b>' + fmt1(T.v) + 'ft</b> <span class="nv-tide-c oi-tri ' + (T.rising ? 'up' : 'down') + '"></span>' : '<b>–</b>');
    f.push(M ? '<span class="c-model">MODEL</span> <b>' + fmt1(M.mean) + '</b>' : '<span class="c-model">MODEL</span> <b>–</b>');
    echo.innerHTML = f.map(function (x) { return '<span>' + x + '</span>'; }).join('');
  }

  // ── This week at Choc (day cards from kioskDaySummary) ─────────────
  function weekData() {
    var out = [], c = cs(), ev = tideEvents();
    if (!c || !fd() || typeof kioskDaySummary !== 'function') return out;
    for (var k = 0; k < 7; k++) {
      var s;
      try { s = kioskDaySummary(k); } catch (e) { continue; }
      var d0 = startOfDay(Date.now(), k).getTime();
      var dl = sun(d0 + 12 * HOUR);
      var low = null;
      (s.lows || []).forEach(function (lo) {
        if (!low && dl.sunrise && lo.t >= dl.firstLight.getTime() - 1.5 * HOUR && lo.t <= dl.sunset.getTime() - 30 * 60e3) low = lo;
      });
      // Best "your model" hour inside that day's daylight incoming windows.
      var best = null;
      ev.forEach(function (lo, i) {
        if (lo.type !== 'L' || lo.t < d0 || lo.t >= d0 + 864e5 || !dl.sunrise) return;
        var hi = null; for (var m = i + 1; m < ev.length; m++) if (ev[m].type === 'H') { hi = ev[m]; break; }
        var a = Math.max(lo.t, dl.sunrise.getTime()), b = Math.min(hi ? hi.t : lo.t + 6 * HOUR, dl.sunset.getTime());
        for (var t = a; t <= b; t += HOUR) {
          var idx = findHourIndexForTime(t, c);
          if (idx < 0 || Math.abs(c.times[idx].getTime() - t) > 45 * 60e3) continue;
          var M = modelAt(idx);
          if (M && (!best || M.mean > best.mean)) best = { mean: M.mean, t: c.times[idx].getTime() };
        }
      });
      out.push({ k: k, s: s, low: low, best: best, d0: d0, dl: dl });
    }
    return out;
  }

  function renderWeek() {
    var host = el('oi-days');
    if (!host) return;
    var days = weekData();
    if (!days.length) { host.innerHTML = ''; return; }
    var c = cs(), sel = selIdx();
    var selOff = c && sel >= 0 ? dayOffsetOf(c.times[sel].getTime()) : 0;
    host.innerHTML = days.map(function (D) {
      var s = D.s, P = s.primary, low = D.low, now = Date.now();
      var lbl = D.k === 0 ? 'TODAY' : D.k === 1 ? 'TMRW' : dow(D.d0);
      var date = (new Date(D.d0).getMonth() + 1) + '/' + new Date(D.d0).getDate();
      var body = '';
      if (P) {
        var range = P.min === P.max ? String(P.max) : P.min + '-' + P.max;
        body += '<div class="oi-day-sw">' + seg(range, 'oi-b') + '<span class="oi-u">ft</span></div>' +
          '<div class="oi-day-p"><span class="oi-cap" style="font-size:11px">@</span>' + seg(P.period != null ? P.period : '–') + '<span class="oi-u">s</span>' +
          '<span class="oi-day-dir">' + directionLabel(P.dir) + '</span>' + tagHTML(P.cls, true) + '</div>';
      } else {
        body += '<div class="oi-day-sw"><span class="oi-cap">NO SWELL DATA</span></div>';
      }
      if (low) {
        var lc = clock(low.t), wc = low.wind ? windClass(low.wind.mph, low.wind.dir) : null;
        body += '<div class="oi-day-low"><div class="t"><span class="oi-cap">LOW</span>' + seg(lc.hm) + '<span class="oi-u">' + lc.ap + '</span></div>' +
          (low.wind ? '<div class="w">' + dialSVG(low.wind.dir, wc) + Math.round(low.wind.mph) + ' ' + directionLabel(low.wind.dir) + '</div>' +
            '<span class="oi-wtag nv-w-' + wc + '">' + WIND_SHORT[wc] + '</span>' : '') + '</div>';
      } else if (s.tidesDown) {
        body += '<div class="oi-day-low"><span class="oi-cap">NO TIDE DATA</span></div>';
      } else {
        body += '<div class="oi-day-low"><span class="oi-cap">NO DAYLIGHT LOW</span></div>';
      }
      if (D.best) { var bc = clock(D.best.t); body += '<div class="oi-day-model"><i class="nv-chip" style="background:' + rampColor(D.best.mean / 10) + '"></i><span>MODEL</span>' + seg(fmt1(D.best.mean)) + '<span class="r">@' + bc.hr + bc.ap.charAt(0) + '</span></div>'; }
      var past = D.k === 0 && D.dl.sunset && now > D.dl.sunset.getTime();
      return '<button type="button" class="oi-day' + (D.k === selOff ? ' is-sel' : '') + (P && P.cls === 'dir-out' ? ' is-out' : '') + (past ? ' is-past' : '') + '" data-k="' + D.k + '">' +
        '<div class="oi-day-h"><span>' + lbl + '</span><span class="d">' + date + '</span></div><div class="oi-day-b">' + body + '</div></button>';
    }).join('');
    host.insertAdjacentHTML('beforeend', '<button type="button" class="oi-day oi-day-key" aria-label="Colour key">' +
      '<div class="oi-day-h"><span>COLOUR KEY</span><span class="d">?</span></div><div class="oi-day-b">' +
      tagHTML('dir-in') + tagHTML('dir-edge') + tagHTML('dir-out') +
      '<span class="k lr"><i class="oi-sw oi-sw-reef"></i>REACHES</span>' +
      '<span class="k loff"><i class="oi-sw oi-sw-off"></i>OFFSHORE</span><span class="k lcr"><i class="oi-sw oi-sw-cross"></i>CROSS</span>' +
      '<span class="k lon"><i class="oi-sw oi-sw-on"></i>ONSHORE</span><span class="k lt"><i class="oi-sw oi-sw-band"></i>INCOMING</span>' +
      '<span class="k lm"><i class="oi-sw" style="background:linear-gradient(90deg,' + rampColor(0) + ',' + rampColor(1) + ')"></i>MODEL</span><span class="k lo"><i class="oi-sw oi-sw-dots"></i>BLOCKED SWELL</span>' +
      '</div></button>');
    host.querySelectorAll('.oi-day').forEach(function (b) { b.addEventListener('click', function () { if (b.classList.contains('oi-day-key')) OI.showKey(); else OI.jumpDay(+b.dataset.k); }); });
    // The right-edge fade is a "more days" cue; at the end of the strip it goes.
    if (!host._nvEnd) {
      host._nvEnd = true;
      var edges = function () { host.classList.toggle('at-end', host.scrollLeft + host.clientWidth >= host.scrollWidth - 6); host.classList.toggle('is-scrolled', host.scrollLeft > 4); };
      host.addEventListener('scroll', edges, { passive: true });
      setTimeout(edges, 0);
    }
  }

  function syncWeekSel() {
    var c = cs(), sel = selIdx();
    if (!c || sel < 0) return;
    var off = dayOffsetOf(c.times[sel].getTime());
    var host = el('oi-days');
    document.querySelectorAll('#oi-days .oi-day').forEach(function (b) {
      var on = +b.dataset.k === off;
      b.classList.toggle('is-sel', on);
      if (on && host && host.scrollWidth > host.clientWidth + 4) {
        var l = b.offsetLeft - host.offsetLeft - 12, r = l + b.offsetWidth + 24;
        // Two whole cards: the picked day and the one before it.
        if (l < host.scrollLeft || r > host.scrollLeft + host.clientWidth) host.scrollLeft = Math.max(0, l - (b.dataset.k > 0 ? b.offsetWidth + 8 : 0));
      }
    });
    document.querySelectorAll('#forecast-day-header .forecast-day-label').forEach(function (s) { s.classList.toggle('is-sel', +s.dataset.off === off); });
  }

  function summaries() {
    var t = function (id) { var e = el(id); return e ? (e.textContent || '').trim() : ''; };
    var b = el('oi-sum-buoy'), tide = el('oi-sum-tide'), w = el('oi-sum-water');
    if (b) b.textContent = (t('val-swell-height').match(/[\d.]+ ft/) || [''])[0];
    if (tide) tide.textContent = t('val-tide');
    if (w) w.textContent = t('val-water-temp') + (t('val-daylight') ? '  ' + t('val-daylight').replace(/\s*→\s*/, '–') : '');
  }

  var onHour = guard('onHour', function (idx) {
    if (!el('oi-readout')) return;
    var d = hourData(typeof idx === 'number' && idx >= 0 ? idx : selIdx());
    renderReadout(d);
    renderHourbar(d);
    syncWeekSel();
  });
  var afterChart = guard('afterChart', function () {
    renderWeek();
    onHour(selIdx());
    placeNowDot();
    summaries();
  });
  OI.refresh = function () { afterChart(); };

  // ════════════════════════════════════════════════════════════════════
  // Surf Log: entry page
  // ════════════════════════════════════════════════════════════════════
  function localISO(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function buildLog() {
    var dt = el('sl-datetime');
    if (dt) {
      var when = h('div', { class: 'oi-whenpick', id: 'oi-when' });
      dt.parentNode.insertBefore(when, dt);
      var lbl = dt.parentNode.querySelector('.sl-label'); if (lbl) { lbl.textContent = 'WHEN'; dt.parentNode.insertBefore(lbl, when); }
      dt.addEventListener('change', function () { syncWhen(); autoLookup(); });
    }
    document.querySelectorAll('#panel-surflog-form .sl-slider-group').forEach(function (g) {
      var s = g.querySelector('.sl-range'), label = g.querySelector('.sl-label');
      if (!s || !label) return;
      var head = h('div', { class: 'oi-rate-head' });
      g.insertBefore(head, g.firstChild);
      head.appendChild(label);
      head.appendChild(h('span', { class: 'oi-rate-slot' }));
      var row = h('div', { class: 'oi-rate', role: 'group', 'aria-label': label.textContent.trim() + ' rating' });
      for (var k = 1; k <= 10; k++) {
        var b = h('button', { type: 'button', 'data-v': k, 'aria-label': String(k) }, String(k));
        b.addEventListener('click', function (e) {
          s.value = e.currentTarget.dataset.v;
          s.dispatchEvent(new Event('pointerdown'));
          s.dispatchEvent(new Event('input', { bubbles: true }));
          syncRates();
        });
        row.appendChild(b);
      }
      s.after(row);
      s.addEventListener('input', syncRates);
    });
    ['resetSurfLogForm', 'editLogEntry'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig === 'function') window[name] = function () { var r = orig.apply(this, arguments); try { syncRates(); syncWhen(); } catch (e) { err(name, e); } return r; };
    });
    var save = el('sl-save-btn'); if (save) save.textContent = 'SAVE SESSION';
    var up = document.querySelector('label.sl-btn-file');
    if (up && up.firstChild && up.firstChild.nodeType === 3) up.firstChild.textContent = 'CAMERA / PHOTOS ';
    var url = el('sl-photo-url'); if (url) url.placeholder = 'or paste an image URL';
    var cond = el('sl-conditions-display');
    if (cond && /Lookup/.test(cond.textContent)) cond.innerHTML = '<span class="sl-hint">Conditions fill in by themselves for the time above.</span>';
    var entries = el('panel-surflog-entries');
    if (entries) {
      var wrap = entries.querySelector('.surflog-table-wrap');
      var cards = h('div', { class: 'oi-sessions', id: 'oi-sessions' });
      if (wrap) wrap.parentNode.insertBefore(cards, wrap);
      var fs = entries.querySelector('fieldset');
      if (fs) fs.insertBefore(bar('PAST SESSIONS', '<span id="oi-sess-count"></span>'), fs.firstChild);
    }
    var form = el('panel-surflog-form');
    if (form) { var ffs = form.querySelector('fieldset'); if (ffs) ffs.insertBefore(bar('LOG A SESSION', 'AT CHOC'), ffs.firstChild); }
    var origRender = window.renderSurfLogTable;
    if (typeof origRender === 'function') {
      window.renderSurfLogTable = function () { var r = origRender.apply(this, arguments); try { renderSessions(); } catch (e) { err('sessions', e); } return r; };
    }
    // Display-only: the buoy lag prints as "4.7h", never a raw float.
    var origCond = window.renderConditionsDisplay;
    if (typeof origCond === 'function') {
      window.renderConditionsDisplay = function (c) {
        try {
          if (c && c.swell && typeof c.swell.lagHours === 'number') { c = Object.assign({}, c, { swell: Object.assign({}, c.swell, { lagHours: +c.swell.lagHours.toFixed(1) }) }); }
          if (c && typeof c.swellLagHours === 'number') c = Object.assign({}, c, { swellLagHours: +c.swellLagHours.toFixed(1) });
        } catch (_) { /* show as-is */ }
        return origCond.call(this, c);
      };
    }
  }
  var lookedUpFor = null;
  function autoLookup() {
    var dt = el('sl-datetime'), btn = el('sl-lookup-btn');
    if (!dt || !btn || !dt.value || dt.value === lookedUpFor) return;
    lookedUpFor = dt.value;
    btn.click();
  }
  function whenOptions() {
    var now = Date.now(), d0 = startOfDay(now).getTime();
    var lows = tideEvents().filter(function (p) { return p.type === 'L' && p.t >= d0 && p.t <= now; });
    var opts = [];
    if (lows.length) { var c = clock(lows[0].t); opts.push({ k: 'low', t: lows[0].t, html: "THIS MORNING'S LOW" + seg(c.hm) }); }
    else opts.push({ k: 'low', t: null, html: "THIS MORNING'S LOW" + seg('!!!!') });
    var c2 = clock(now - 2 * HOUR); opts.push({ k: '2h', t: now - 2 * HOUR, html: '2 H AGO' + seg(c2.hm) });
    opts.push({ k: 'now', t: now, html: 'NOW' + seg(clock(now).hm) });
    return opts;
  }
  function syncWhen() {
    var host = el('oi-when'), dt = el('sl-datetime');
    if (!host || !dt) return;
    var opts = whenOptions();
    host.innerHTML = opts.map(function (o) {
      var on = o.t != null && dt.value === localISO(o.t);
      return '<button type="button" data-t="' + (o.t || '') + '" aria-pressed="' + on + '"' + (o.t == null ? ' disabled' : '') + '>' + o.html + '</button>';
    }).join('');
    host.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!b.dataset.t) return;
        dt.value = localISO(+b.dataset.t);
        dt.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  function syncRates() {
    document.querySelectorAll('#panel-surflog-form .sl-slider-group').forEach(function (g) {
      var s = g.querySelector('.sl-range'); if (!s) return;
      var untouched = s.classList.contains('w1-untouched'), v = +s.value;
      g.querySelectorAll('.oi-rate button').forEach(function (b) {
        var bv = +b.dataset.v, on = !untouched && bv <= v;
        b.classList.toggle('on', on);
        b.style.background = on ? rampColor((bv - 1) / 9) : '';
        b.style.color = on ? (bv <= 4 ? '#f2f6fb' : '#0b0a1e') : '';
      });
      var slot = g.querySelector('.oi-rate-slot');
      if (slot) slot.outerHTML = '<span class="oi-rate-slot ' + (untouched ? 'oi-untouched' : 'oi-rate-val') + '">' + (untouched ? 'TAP TO RATE' : seg(v, 'oi-b') + '<span class="oi-u">/10</span>') + '</span>';
    });
  }
  function condLine(c) {
    if (!c || !c.swell) return '';
    var s = c.swell, w = c.wind || {}, t = c.tide || {};
    var bits = [];
    if (s.height != null) bits.push(ftStr(+s.height) + 'ft @ ' + Math.round(+s.period || 0) + 's ' + directionLabel(s.direction));
    if (w.speed != null) bits.push(Math.round(+w.speed) + 'mph ' + directionLabel(w.direction));
    if (t.height != null) bits.push('tide ' + fmt1(+t.height) + ' ' + (t.stage || ''));
    return bits.join('<span class="oi-sep"></span>');
  }
  function renderSessions() {
    var host = el('oi-sessions');
    if (!host) return;
    var entries = (STATE.surfLog || []).slice();
    var fromD = el('sl-filter-from') && el('sl-filter-from').value, toD = el('sl-filter-to') && el('sl-filter-to').value;
    var minR = parseFloat((el('sl-filter-rating') && el('sl-filter-rating').value) || '0');
    if (fromD) entries = entries.filter(function (e) { return e.timestamp >= fromD; });
    if (toD) entries = entries.filter(function (e) { return e.timestamp <= toD + 'T23:59:59'; });
    var avgOf = function (e) { var r = e.ratings || {}; return (r.size + r.windQuality + r.rideQuality) / 3; };
    if (minR > 0) entries = entries.filter(function (e) { return avgOf(e) >= minR; });
    var inc = function (e) { return !!(window._llcIsLogEntryIncomplete && window._llcIsLogEntryIncomplete(e)); };
    entries.sort(function (a, b) { return (inc(b) - inc(a)) || (new Date(b.timestamp) - new Date(a.timestamp)); });
    var cnt = el('oi-sess-count'); if (cnt) cnt.textContent = entries.length + ' LOGGED';
    host.innerHTML = entries.slice(0, 40).map(function (e) {
      var d = new Date(e.timestamp), own = e.userId === window._fbUserId, r = e.ratings || {};
      var avg = avgOf(e), ck = clock(d);
      var photo = (e.photos || []).map(function (p) { return safeUrl(photoUrl(p)); }).filter(Boolean)[0];
      var date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() + " '" + String(d.getFullYear()).slice(2);
      return '<div class="oi-sess' + (inc(e) ? ' is-inc' : '') + '">' +
        '<div class="oi-sess-when">' + seg(ck.hm) + '<span class="oi-u" style="font-size:10px">' + ck.ap + '</span><span class="oi-cap" style="font-size:11px;color:var(--oi-ink)">' + date + '</span>' +
          '<span class="who">' + (own ? 'YOU' : esc(e.displayName || 'CREW')) + '</span>' + (inc(e) ? '<span class="oi-inc-pill">INCOMPLETE</span>' : '') + '</div>' +
        '<div class="oi-sess-avg">' + (isFinite(avg) ? seg(fmt1(avg), 'oi-b') : seg('!!!')) + '<span class="oi-cap">AVG /10</span></div>' +
        '<div class="oi-sess-r"><span>SIZE</span>' + meter(r.size) + '<b>' + (r.size != null ? r.size : '–') + '</b>' +
          '<span>WIND</span>' + meter(r.windQuality) + '<b>' + (r.windQuality != null ? r.windQuality : '–') + '</b>' +
          '<span>RIDE</span>' + meter(r.rideQuality) + '<b>' + (r.rideQuality != null ? r.rideQuality : '–') + '</b></div>' +
        '<div class="oi-sess-notes">' + (photo ? '<img src="' + photo + '" alt="">' : '') + '<div>' + esc(String(e.notes || '').slice(0, 70)) +
          '<span class="cond">' + (condLine(e.conditions) || (inc(e) ? 'CONDITIONS MISSING, EDIT TO REPAIR' : '')) + '</span></div></div>' +
        (own ? '<div class="oi-sess-act"><button type="button" class="sl-btn" data-edit="' + esc(e.id) + '">EDIT</button><button type="button" class="sl-btn" data-del="' + esc(e.id) + '">DELETE</button></div>' : '') +
        '</div>';
    }).join('');
    host.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { editLogEntry(b.dataset.edit); }); });
    host.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('Delete this session?')) deleteLogEntry(b.dataset.del); }); });
  }

  // ════════════════════════════════════════════════════════════════════
  // CHOC TV: the same instrument, wall-mounted
  // ════════════════════════════════════════════════════════════════════
  function moonSVG(date) {
    var syn = 29.530588853 * 864e5, epoch = Date.UTC(2000, 0, 6, 18, 14);
    var frac = (((date.getTime() - epoch) % syn) + syn) % syn / syn;
    var k = (1 - Math.cos(2 * Math.PI * frac)) / 2, r = 10, waxing = frac < 0.5;
    var rx = Math.abs(1 - 2 * k) * r;
    var limb = waxing ? 1 : 0, term = (k > 0.5) === waxing ? 1 : 0;
    var d = 'M12 2 A' + r + ' ' + r + ' 0 0 ' + limb + ' 12 22 A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + term + ' 12 2Z';
    var B = curPal();
    return { pct: Math.round(k * 100), svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="' + A(B.rgb, 0.4) + '" stroke-width="1.2"/><path d="' + d + '" fill="' + B.ink + '"/></svg>' };
  }

  function tvWindows(d0) {
    var ev = tideEvents(), out = [], now = Date.now();
    ev.forEach(function (lo, i) {
      if (lo.type !== 'L' || lo.t < d0 || lo.t >= d0 + 864e5) return;
      var hi = null; for (var k = i + 1; k < ev.length; k++) if (ev[k].type === 'H') { hi = ev[k]; break; }
      var end = hi ? hi.t : lo.t + 6.2 * HOUR, dl = sun(lo.t);
      var a = dl.sunrise ? Math.max(lo.t, dl.sunrise.getTime()) : lo.t, b = dl.sunset ? Math.min(end, dl.sunset.getTime()) : end;
      out.push({ low: lo.t, end: end, hi: hi, a: a, b: b, daylight: b > a + 20 * 60e3, past: end < now, live: lo.t <= now && now < end });
    });
    return out;
  }

  function tvCardHTML(k) {
    var s = kioskDaySummary(k), d0 = startOfDay(Date.now(), k).getTime(), dl = sun(d0 + 12 * HOUR);
    var title = k === 0 ? 'TODAY' : k === 1 ? 'TOMORROW' : dayName(d0);
    var date = dow(d0) + ' ' + (new Date(d0).getMonth() + 1) + '/' + new Date(d0).getDate();
    var P = s.primary, S = s.secondary, html = '<div class="oi-tvday">';
    html += '<div class="oi-tvday-title"><span>' + title + '</span><span class="d">' + date + '</span></div>';
    if (P) {
      var out = P.cls === 'dir-out', range = P.min === P.max ? String(P.max) : P.min + '-' + P.max;
      html += '<div><div class="oi-tvday-cap nv-reef' + (out ? ' is-out' : '') + '"><i class="nv-sw"></i>' + (out ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + '</div>' +
        '<div class="oi-tvhero' + (out ? ' is-out' : '') + '"><div class="oi-tvhero-num">' + seg(range) + '<span class="oi-u">ft</span></div>' +
        '<div class="oi-tvhero-sub"><span class="oi-at">@</span>' + seg(P.period != null ? P.period : '–') + '<span class="oi-u">s</span>' +
        '<span class="oi-tvhero-tag">' + tagHTML(P.cls) + '</span>' + arrowHTML(P.dir, out ? 'is-out' : '', directionLabel(P.dir), Math.round(P.dir) + '°') + '</div></div></div>';
    } else {
      html += '<div><div class="oi-tvday-cap">NO SWELL DATA</div></div>';
    }
    html += S ? '<div class="oi-tvsec">ALSO ' + seg(S.min === S.max ? S.max : S.min + '-' + S.max) + 'ft @ ' + seg(S.period != null ? S.period : '–') + 's ' + directionLabel(S.dir) + tagHTML(S.cls, true) + '</div>'
      : '<div class="oi-tvsec" style="visibility:hidden">–</div>';
    var wins = tvWindows(d0), lowWind = {};
    (s.lows || []).forEach(function (lo) { lowWind[lo.t] = lo.wind; });
    var bestIdx = -1;
    wins.forEach(function (w, i) { if (bestIdx < 0 && w.daylight && !w.past) bestIdx = i; });
    html += '<div class="oi-tvwins">';
    if (s.tidesDown) html += '<div class="oi-tvwin"><div class="oi-tvday-cap">NOAA TIDES DOWN · SWELL IS ALL DAYLIGHT</div></div>';
    wins.slice(0, 2).forEach(function (w, i) {
      var c1 = clock(w.daylight ? Math.max(w.low, w.a) : w.low), c2 = clock(w.daylight ? w.b : w.end), wd = lowWind[w.low], wc = wd ? windClass(wd.mph, wd.dir) : null;
      var cls = 'oi-tvwin' + (w.past ? ' is-past' : !w.daylight ? ' is-night' : '') + (i === bestIdx ? ' is-best' : '');
      var cap = !w.daylight ? 'LOW' : w.low < w.a - 10 * 60e3 ? 'INCOMING FROM FIRST LIGHT' : 'INCOMING FROM LOW';
      html += '<div class="' + cls + '"><div class="oi-tvday-cap"><span>' + dots(cap) + '</span><span class="r">' +
        (!w.daylight ? darkChip() : w.live ? '<span class="oi-nowtick">NOW</span>' : w.past ? 'DONE' : '') + '</span></div>' +
        '<div class="oi-tvwin-t' + (c1.hm.length > 4 ? ' long' : '') + '">' + seg(c1.hm) + '<span class="oi-u">' + c1.ap + '</span></div>' +
        '<div class="oi-tvwind">' + (wd ? '<span class="oi-tvdial" title="wind mph">' + dialSVG(wd.dir, wc) + '<span class="n">' + seg(Math.round(wd.mph)) + '<i>' + directionLabel(wd.dir) + '</i></span></span>' : '<span class="oi-tvday-cap">NO WIND DATA</span>') + '</div>' +
        (wd ? windWord(wc, true, 'oi-tvwword') : '') +
        '<div class="oi-tvwin-to">' + (w.daylight ? 'UNTIL ' + seg(c2.hm) + c2.ap.charAt(0) + (w.hi && w.b >= w.hi.t - 60e3 ? ' HIGH' : ' DARK') : 'NO DAYLIGHT') + '</div></div>';
    });
    html += '</div>';
    var m = moonSVG(new Date(d0 + 12 * HOUR));
    var fl = dl.firstLight ? clock(dl.firstLight) : null, ll = dl.lastLight ? clock(dl.lastLight) : null;
    html += '<div class="oi-tvfoot">' + (fl && ll ? 'LIGHT ' + seg(fl.hm) + 'A<span class="to">TO</span>' + seg(ll.hm) + 'P' : '') +
      '<span class="moon">' + m.svg + m.pct + '%</span></div>';
    return html + '</div>';
  }

  function tvLeadOffset() {
    var now = Date.now(), dl = sun(now);
    if (!dl.sunset) return 0;
    var wins = tvWindows(startOfDay(now).getTime()).filter(function (w) { return w.daylight; });
    var lastEnd = wins.length ? Math.max.apply(null, wins.map(function (w) { return w.b; })) : 0;
    return now > dl.sunset.getTime() - 20 * 60e3 || (lastEnd && now > lastEnd && now > dl.sunset.getTime() - 2 * HOUR) ? 1 : 0;
  }

  function tvHeadHTML(lead) {
    var now = Date.now(), c = clock(now), left;
    if (lead) {
      var lows = daylightLows().filter(function (l) { return l.t > now; });
      var nx = lows[0] ? clock(lows[0].t) : null;
      left = '<b>TONIGHT</b><span class="oi-sep"></span>DARK UNTIL ' + clock(sun(now + 864e5).firstLight).hm + ' AM' +
        (nx ? '<span class="oi-sep"></span>NEXT WINDOW&nbsp;<b class="nv-t">' + dow(lows[0].t) + ' ' + nx.hm + ' ' + nx.ap + '</b>' : '');
    } else {
      left = '<b>THIS WEEK AT CHOC</b><span class="oi-sep"></span>WHAT REACHES THE REEF ON THE <span class="nv-t">&nbsp;INCOMING TIDE</span>';
    }
    return '<span>' + left + '</span><span class="r">' + seg(c.hm, 'oi-tvclock') + '<span class="oi-u" style="font-size:1.8vmin;margin-left:.6vmin">' + c.ap + '</span></span>';
  }

  function kioskOI() {
    var body = document.body;
    body.classList.add('oi');

    // kiosk.js builds its chrome on DOMContentLoaded: add ours right after.
    var prevChrome = kioskBuildChrome;
    window.kioskBuildChrome = function () {
      var r = prevChrome.apply(this, arguments);
      try {
        var app = el('app'), d1 = el('kiosk-days-1');
        if (app && d1) app.insertBefore(h('div', { id: 'oi-tvhead', class: 'oi-tvhead' }), d1);
        body.appendChild(h('div', { id: 'oi-tvglass', 'aria-hidden': 'true' }));
        body.appendChild(h('div', { id: 'oi-veil', 'aria-hidden': 'true' }));
        body.appendChild(h('div', { id: 'oi-progress', 'aria-hidden': 'true' }));
        var upd = el('kiosk-status-updated');
        if (upd) {
          // Two readings, two pilots: the forecast's age (kiosk.js's own
          // pilot + levels) and the buoy observation's age. Never one light.
          upd.after(h('span', { id: 'nv-st-buoy', 'data-s': 'busy' }, '<i class="nv-pilot"></i><span class="nv-st-lbl">BUOY 44097</span><span id="nv-st-buoy-t">…</span>'));
          el('nv-st-buoy').after(h('span', { class: 'oi-pips', id: 'oi-pips', 'aria-hidden': 'true' }));
        }
        var radar = el('kiosk-radar');
        if (radar) {
          radar.appendChild(h('div', { id: 'oi-sweep' }, '<div class="arm"></div>'));
          radar.appendChild(h('div', { id: 'oi-echoes' }));
          // The position panel is its own opaque layer ABOVE the sweep; its
          // ground-coloured shadow fades coast, rings and sweep before them.
          radar.appendChild(h('canvas', { id: 'oi-rpanel', 'aria-hidden': 'true' }));
        }
      } catch (e) { err('tvchrome', e); }
      return r;
    };

    // TODAY is home: never more than ~30 s away; radar is an interlude.
    var swl = document.querySelector('.forecast-card-swell .forecast-section-label');
    if (swl) swl.innerHTML = '<span>SWELL</span>' + SWELL_LEGEND_TV;
    KIOSK.panels = ['days1', 'radar', 'days1', 'days2', 'days1', 'spectral'];
    function progress(ms) {
      var p = el('oi-progress'); if (!p) return;
      p.classList.remove('run'); void p.offsetWidth;
      p.style.animationDuration = ms + 'ms'; p.classList.add('run');
    }
    function pips() {
      var host = el('oi-pips'); if (!host) return;
      var cur = body.dataset.kioskPanel, idx = KIOSK.panels[KIOSK.idx] === cur ? KIOSK.idx : KIOSK.panels.indexOf(cur);
      host.innerHTML = KIOSK.panels.map(function (p, i) { return '<i class="' + (p === 'days1' ? 'home ' : '') + (i === idx ? 'on' : '') + '"></i>'; }).join('');
    }
    window.kioskScheduleNext = function () {
      clearTimeout(KIOSK.rotateTimer);
      if (KIOSK.state !== 'rotating') return;
      var p = KIOSK.panels[KIOSK.idx], ms = KIOSK.rotateMs;
      if (p === 'days1') ms = Math.round(KIOSK.rotateMs * 1.5);
      if (p === 'radar') ms = 60 * KIOSK.radarStepMs + 1500;
      KIOSK.rotateTimer = setTimeout(kioskAdvance, ms);
      progress(ms);
    };
    // Radar playback skips the dark: daylight hours at 1 s each.
    window.kioskRadarTick = function () {
      var c = cs(); if (!c || !c.times.length || KIOSK.state === 'paused') return;
      var n = c.times.length, i = KIOSK_RADAR.idx;
      for (var k = 0; k < 16; k++) { i = (i + 1) % n; if (sceneAt(c.times[i].getTime()) !== 'night') break; }
      KIOSK_RADAR.idx = i; STATE.scrubberIdx = i; applyScrubberToHour(i);
    };
    // No rAF loop: the sweep is a compositor layer (audit M1).
    window.kioskRadarLoop = function () { KIOSK_RADAR.raf = null; };
    var prevStart = kioskRadarStart;
    window.kioskRadarStart = function () { restartSweep(); return prevStart.apply(this, arguments); };

    // Panel change: a short fade → switch → fade in. Opacity only.
    var prevShow = kioskShowPanel;
    var shown = false;
    window.kioskShowPanel = function (name) {
      var veil = el('oi-veil');
      var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      var go = function () { prevShow(name); pips(); renderHead(); };
      if (!veil || reduce || !shown) { shown = true; go(); return; }
      veil.classList.remove('off'); veil.classList.add('on');
      setTimeout(function () {
        go();
        requestAnimationFrame(function () { requestAnimationFrame(function () { veil.classList.add('off'); veil.classList.remove('on'); }); });
      }, 190);
    };
    var renderHead = guard('tvhead', function () { var hd = el('oi-tvhead'); if (hd) hd.innerHTML = tvHeadHTML(tvLeadOffset()); });
    window.kioskRenderDays = guard('tvdays', function () {
      var p1 = el('kiosk-days-1'), p2 = el('kiosk-days-2');
      if (!p1 || !p2 || !STATE.forecastData) return;
      var lead = tvLeadOffset();
      var o1 = [0, 1, 2].map(function (x) { return x + lead; }), o2 = [3, 4, 5].map(function (x) { return x + lead; });
      p1.className = ('np-days ' + kioskSizeTier(o1.map(kioskDaySummary))).trim();
      p2.className = ('np-days ' + kioskSizeTier(o2.map(kioskDaySummary))).trim();
      p1.innerHTML = o1.map(tvCardHTML).join('');
      p2.innerHTML = o2.map(tvCardHTML).join('');
      KIOSK.lastDaysRender = STATE.lastLoadCompletedAt || 0;
      renderHead();
    });
    var prevFresh = kioskShowFreshness;
    window.kioskShowFreshness = function (f) {
      prevFresh(f);
      body.classList.toggle('oi-stale', f.level === 'stale');
      body.classList.toggle('oi-dead', f.level === 'dead' || f.level === 'nodata');
      try { tvStatus(f); } catch (e) { err('tvstatus', e); }
    };
    function tvStatus(f) {
      var upd = el('kiosk-status-updated');
      if (upd) {
        var t = f.level === 'loading' ? 'LOADING' : f.level === 'nodata' || f.ageMs == null ? 'NO DATA'
          : f.level === 'fresh' ? (function () { var c = clock(Date.now() - f.ageMs); return 'UPD ' + c.hm + c.ap.charAt(0); })() : ageText(f.ageMs);
        upd.innerHTML = '<span class="nv-st-lbl">FORECAST</span>' + t;
      }
      var bx = el('nv-st-buoy'), bt = el('nv-st-buoy-t');
      if (bx && bt) {
        var b = buoyAge();
        bx.setAttribute('data-s', b.state);
        if (b.obs) { var oc = clock(b.obs); bt.innerHTML = 'OBS ' + oc.hm + oc.ap.charAt(0) + '<span class="oi-sep"></span>' + ageText(b.ms); }
        else bt.textContent = b.state === 'busy' ? 'LOADING' : 'NO OBS';
      }
    }
    ['kioskPause', 'kioskResume', 'kioskResumeInPlace'].forEach(function (n) {
      var prev = window[n];
      window[n] = function () { var r = prev.apply(this, arguments); body.classList.toggle('oi-paused', KIOSK.state === 'paused'); return r; };
    });
    window.kioskRadarPaint = oiRadarPaint;
    setInterval(guard('tvminute', function () {
      applyLight();
      var p = body.dataset.kioskPanel;
      if (p === 'days1' || p === 'days2') kioskRenderDays();
      body.classList.toggle('oi-calm', OI.light === 'night');
    }), 60e3);
    body.classList.toggle('oi-calm', OI.light === 'night');
    setTimeout(function () { pips(); renderHead(); }, 0);
  }

  var SWEEP = { epoch: 0, period: 10 };
  function restartSweep() {
    var arm = document.querySelector('#oi-sweep .arm');
    SWEEP.period = document.body.classList.contains('oi-calm') ? 30 : 10;
    if (arm) { arm.style.animation = 'none'; void arm.offsetWidth; arm.style.animation = ''; arm.style.animationDuration = SWEEP.period + 's'; }
    SWEEP.epoch = performance.now();
  }

  // The scope, repainted once per forecast hour (1 Hz), never per frame.
  // Navy plotter by day, phosphor after dark; the code stays: magenta
  // window cone, sounding-blue reef arrow, grey blocked, wind in its colour.
  function oiRadarPaint() {
    var cv = el('kiosk-radar-canvas');
    if (!cv || !cv.clientWidth) return;
    var ctx = cv.getContext('2d');
    var dims = ensureCanvasCssDims(cv, ctx), w = dims.cssW, hgt = dims.cssH;
    if (!w || !hgt) return;
    var B = curPal(), night = OI.light === 'night';
    var G = function (a) { return A(night ? B.rgb : B.reefInkRgb, a); };
    var CROP = 0.15, fh = hgt / (1 - CROP), fw = fh * KIOSK_COAST.aspect, fx = (w - fw) / 2, fy = -CROP * fh;
    var lx = fx + KIOSK_COAST.lineup[0] * fw, ly = fy + KIOSK_COAST.lineup[1] * fh, rMax = hgt * 0.62;
    var px = function (p) { return [fx + p[0] * fw, fy + p[1] * fh]; };
    // Coast traced through segment midpoints (quadratic), so the coarse
    // survey polygon reads as a smooth shoreline, not facets.
    var trace = function (pts) {
      var P0 = pts.map(px); ctx.moveTo(P0[0][0], P0[0][1]);
      if (P0.length < 3) { for (var i = 1; i < P0.length; i++) ctx.lineTo(P0[i][0], P0[i][1]); return; }
      for (var j = 1; j < P0.length - 1; j++) { var mxp = (P0[j][0] + P0[j + 1][0]) / 2, myp = (P0[j][1] + P0[j + 1][1]) / 2; ctx.quadraticCurveTo(P0[j][0], P0[j][1], mxp, myp); }
      var L2 = P0[P0.length - 1]; ctx.lineTo(L2[0], L2[1]);
    };
    var shore = KIOSK_COAST.shore, shoreEndY = fy + shore[shore.length - 1][1] * fh;
    var c = cs(), i = KIOSK_RADAR.idx;
    var d = c && i >= 0 && i < c.times.length ? hourData(i) : null;
    var t = d ? d.t : Date.now(), scene = sceneAt(t);
    var lit = scene === 'day' ? 1 : scene === 'twilight' ? 0.75 : 0.5;   // light the world, not the data
    var SANS = '"OI Sans", "Orbitron", sans-serif';

    ctx.fillStyle = B.ground; ctx.fillRect(0, 0, w, hgt);
    ctx.beginPath(); trace(shore); ctx.lineTo(w, shoreEndY); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.lineTo(0, hgt); ctx.closePath();
    var land = ctx.createLinearGradient(0, 0, 0, hgt);
    if (night) { land.addColorStop(0, G(0.11 * lit)); land.addColorStop(1, G(0.04 * lit)); }
    else { land.addColorStop(0, 'rgba(120,150,190,' + (0.16 * lit) + ')'); land.addColorStop(1, 'rgba(120,150,190,' + (0.07 * lit) + ')'); }
    ctx.fillStyle = land; ctx.fill();
    ctx.strokeStyle = G(0.13 * lit + 0.04); ctx.lineWidth = 1;
    for (var k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(lx, ly, rMax * k / 3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(lx - rMax, ly); ctx.lineTo(lx + rMax, ly); ctx.moveTo(lx, ly - rMax); ctx.lineTo(lx, ly + rMax);
    ctx.strokeStyle = G(0.07); ctx.stroke();

    var edge = function (deg, r) { var th = deg * Math.PI / 180; return [lx + r * Math.sin(th), ly - r * Math.cos(th)]; };
    // The position panel's zone (top right). The cone is sized so its
    // 115° tip stays clear of it; the world (land, rings, coast) fades out
    // before it; the readings never do.
    var PZ = { x: w - 356, y: 14, w: 340, h: 278 };
    var rC = rMax * 0.92;
    var inPZ = function (p, m) { return p[0] > PZ.x - m && p[1] < PZ.y + PZ.h + m; };
    while (rC > rMax * 0.6 && (inPZ(edge(CH.swellWindowMin, rC), 34) || inPZ(edge(CH.swellWindowMin, rC * 0.7), 20))) rC -= 4;
    // Scope labels: placed after everything they must avoid (the panel and
    // its fade, the cone's dashed edges, every arrow shaft, each other).
    var obs = [], GAPR = 6;
    var hitR = function (b) { for (var q = 0; q < obs.length; q++) { var o = obs[q]; if (b.x - GAPR < o.x + o.w && b.x + b.w + GAPR > o.x && b.y - GAPR < o.y + o.h && b.y + b.h + GAPR > o.y) return true; } return false; };
    var blockR = function (x, y, r) { obs.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }); };
    var blockSegR = function (a, b2, r) { var n = Math.max(2, Math.ceil(Math.hypot(b2[0] - a[0], b2[1] - a[1]) / 8)); for (var k = 0; k <= n; k++) blockR(a[0] + (b2[0] - a[0]) * k / n, a[1] + (b2[1] - a[1]) * k / n, r); };
    obs.push({ x: w - 356 - 30, y: 0, w: 356 + 30, h: 14 + 278 + 30 });
    blockSegR([lx, ly], edge(CH.swellWindowMin, rC), 4); blockSegR([lx, ly], edge(CH.swellWindowMax, rC), 4);
    for (var adg = CH.swellWindowMin; adg <= CH.swellWindowMax; adg += 3) { var ap = edge(adg, rC); blockR(ap[0], ap[1], 4); }
    blockR(lx, ly, 16);
    var placeR = function (spec) {
      var fonts = ['700 ' + spec.sizes[0] + 'px ' + SANS, '800 ' + (spec.sizes[1] || 12) + 'px ' + SANS];
      var lines = spec.lines.filter(Boolean);
      var ws = lines.map(function (l, k) { ctx.font = fonts[k ? 1 : 0]; return ctx.measureText(l).width; });
      var bw = Math.max.apply(null, ws) + 10, lh0 = spec.sizes[0] * 1.15, lh1 = lines.length > 1 ? (spec.sizes[1] || 12) * 1.35 : 0, bh = lh0 + lh1;
      var best = null, dirsR = spec.dirs.concat(COMPASS8);
      outer:
      for (var dist = 6; dist <= 260; dist += (dist < 120 ? 6 : 10)) {
        for (var dd = 0; dd < (dist <= 120 ? spec.dirs.length : dirsR.length); dd++) {
          var u = dirsR[dd], mg = Math.hypot(u[0], u[1]); u = [u[0] / mg, u[1] / mg];
          var ext = Math.abs(u[0]) * bw / 2 + Math.abs(u[1]) * bh / 2;
          var bx = spec.at[0] + u[0] * (dist + ext) - bw / 2, by = spec.at[1] + u[1] * (dist + ext) - bh / 2;
          bx = Math.max(10, Math.min(w - bw - 10, bx)); by = Math.max(8, Math.min(hgt - bh - 8, by));
          var bb = { x: bx, y: by, w: bw, h: bh };
          if (!hitR(bb)) { best = bb; break outer; }
        }
      }
      if (!best) best = { x: Math.max(10, Math.min(w - bw - 10, spec.at[0] - bw / 2)), y: Math.max(8, Math.min(hgt - bh - 8, spec.at[1] + 10)), w: bw, h: bh };
      obs.push(best);
      var nx = Math.max(best.x, Math.min(best.x + best.w, spec.at[0])), ny = Math.max(best.y, Math.min(best.y + best.h, spec.at[1]));
      if (Math.hypot(nx - spec.at[0], ny - spec.at[1]) > (spec.leaderAt || 18)) {
        ctx.save(); ctx.lineCap = 'round';
        ctx.strokeStyle = B.ground; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(spec.at[0], spec.at[1]); ctx.lineTo(nx, ny); ctx.stroke();
        ctx.strokeStyle = spec.colors[0]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(spec.at[0], spec.at[1]); ctx.lineTo(nx, ny); ctx.stroke();
        ctx.fillStyle = spec.colors[0]; ctx.beginPath(); ctx.arc(spec.at[0], spec.at[1], 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      var mx = best.x + best.w / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = B.ground;
      lines.forEach(function (l, k) {
        ctx.font = fonts[k ? 1 : 0];
        var yy = k ? best.y + lh0 + lh1 / 2 : best.y + lh0 / 2;
        ctx.strokeText(l, mx, yy); ctx.fillStyle = spec.colors[k] || spec.colors[0]; ctx.fillText(l, mx, yy);
      });
    };
    var labelsR = [];

    // Coastline (no glow: bloom is for lit segments only).
    ctx.beginPath(); trace(shore); ctx.lineTo(w, shoreEndY);
    ctx.strokeStyle = night ? G(0.55 + 0.35 * lit) : 'rgba(180,205,235,' + (0.55 + 0.35 * lit) + ')'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
    KIOSK_COAST.ponds.forEach(function (pond) {
      ctx.beginPath(); trace(pond); ctx.closePath(); ctx.fillStyle = B.ground; ctx.fill(); ctx.strokeStyle = G(0.35); ctx.lineWidth = 1; ctx.stroke();
    });
    // World fade around the panel zone: ground with a soft edge, painted
    // over land / rings / coast only (cone, arrows and labels come after).
    if (d) {
      ctx.save();
      ctx.shadowColor = B.ground; ctx.shadowBlur = 34; ctx.fillStyle = B.ground;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(PZ.x - 14, -40, w - PZ.x + 60, PZ.y + PZ.h + 54, 18); else ctx.rect(PZ.x - 14, -40, w - PZ.x + 60, PZ.y + PZ.h + 54);
      ctx.fill(); ctx.fill();
      ctx.restore();
    }
    // The window cone (magenta) brightens with the in-window energy.
    var e = 0;
    if (d && d.lead) [d.lead, d.other].forEach(function (s) { if (s && s.h != null) e += _alignmentScore(s.d) * s.h * s.h; });
    var c1 = CH.swellWindowMin * Math.PI / 180 - Math.PI / 2, c2 = CH.swellWindowMax * Math.PI / 180 - Math.PI / 2;
    var cone = ctx.createRadialGradient(lx, ly, 0, lx, ly, rC);
    var ca = Math.min(0.26, 0.06 + e * 0.045);
    cone.addColorStop(0, A(B.winRgb, ca * 1.5)); cone.addColorStop(1, A(B.winRgb, ca * 0.35));
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, rC, c1, c2); ctx.closePath();
    ctx.fillStyle = cone; ctx.fill();
    ctx.strokeStyle = A(B.winRgb, 0.85); ctx.lineWidth = 1.6; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);

    var echoes = [];
    var arrow = function (fromDeg, len, o) {
      var th = fromDeg * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th);
      var gap = 30, hx = lx + ux * gap, hy = ly + uy * gap, tx = lx + ux * (gap + len), ty = ly + uy * (gap + len);
      var headLen = 12 + o.width * 2.4, headW = 6 + o.width * 1.7, bx = hx + ux * headLen, by = hy + uy * headLen;
      ctx.save();
      ctx.strokeStyle = o.color; ctx.fillStyle = o.color; ctx.lineWidth = o.width; ctx.lineCap = 'round';
      ctx.setLineDash(o.dashed ? [10, 8] : []);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(bx - uy * headW, by + ux * headW); ctx.lineTo(bx + uy * headW, by - ux * headW); ctx.closePath();
      if (o.hollow) { ctx.lineWidth = 2; ctx.stroke(); } else ctx.fill();
      ctx.restore();
      blockSegR([hx, hy], [tx, ty], Math.max(6, o.width));
      if (o.label) {
        var pr = [-uy, ux], pl = [uy, -ux];
        labelsR.push({ rank: o.rank || 0, lines: [o.label, o.sub], colors: [o.color, o.subColor || o.color], sizes: [o.size || 18, 12], at: [tx, ty],
          dirs: [[ux, uy], [ux + pr[0], uy + pr[1]], [ux + pl[0], uy + pl[1]], pr, pl] });
      }
      echoes.push({ deg: fromDeg, x: lx + ux * (gap + len * 0.6), y: ly + uy * (gap + len * 0.6), big: !!o.primary });
    };
    var clampLen = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
    if (d) {
      var sl = function (s) { return ftStr(s.h) + 'ft @ ' + (s.p != null ? Math.round(s.p) : '–') + 's'; };
      var reefCol = night ? B.reefInk : '#6db8ff';
      var draw = function (s, primary) {
        var out = s.cls === 'dir-out';
        arrow(s.d, clampLen(Math.sqrt(s.h * s.h * (s.p || 1)) * 16, primary ? 90 : 70, rMax * 0.88), {
          color: out ? B.out : reefCol, width: primary ? 6 : 3.5, dashed: out, hollow: out, primary: primary && !out,
          label: sl(s), sub: out ? 'BLOCKED' : s.cls === 'dir-edge' ? 'EDGE' : 'IN WINDOW', subColor: out ? B.out : s.cls === 'dir-edge' ? B.edge : B.win,
          size: primary ? 20 : 15, rank: primary ? 3 : 2
        });
      };
      if (d.other) draw(d.other, false);
      if (d.lead) draw(d.lead, true);
      if (d.wind && d.wind.dir != null) {
        var wcol = d.wind.cls ? B[d.wind.cls] : B.ink2;
        arrow(d.wind.dir, clampLen((d.wind.mph || 0) * 8, 62, rMax * 0.8), { color: wcol, width: 3, dashed: true, label: Math.round(d.wind.mph) + 'mph', sub: WIND_WORD[d.wind.cls] || '', size: 16, rank: 1 });
      }
    }
    // The window's edges, named at the end of their own ray, outside the cone.
    var eMin = edge(CH.swellWindowMin, rC), eMax = edge(CH.swellWindowMax, rC);
    var thMin = CH.swellWindowMin * Math.PI / 180, thMax = CH.swellWindowMax * Math.PI / 180;
    placeR({ lines: ['SOUTHWEST PT (BLOCK)', CH.swellWindowMin + '°'], colors: [B.win, B.win], sizes: [15, 13], at: eMin,
      dirs: [[-Math.cos(thMin), -Math.sin(thMin)], [Math.sin(thMin), -Math.cos(thMin)], [1, 0.3], [0.2, 1]], leaderAt: 14 });
    placeR({ lines: ['MONTAUK PT', CH.swellWindowMax + '°'], colors: [B.win, B.win], sizes: [15, 13], at: eMax,
      dirs: [[Math.cos(thMax), Math.sin(thMax)], [Math.sin(thMax), -Math.cos(thMax)], [-1, 0], [0, 1]], leaderAt: 14 });
    labelsR.sort(function (a, b2) { return b2.rank - a.rank; }).forEach(placeR);
    if (d) {

      // Forecast position, top right, on its own panel so the coast and
      // sweep never cross the figures: day + hour, offset, the one number.
      // The hour on show contains now → read the real clock, as the phone does.
      var near = Math.abs(t - Date.now()) <= 30 * 60e3;
      var ck = clock(near ? Date.now() : t), dh = near ? 0 : Math.round((t - Date.now()) / HOUR);
      var PX = w - 356, PW = 340, PY = 14, PH = 278, R0 = PX + PW - 20;
      var mainCtx = ctx, pc = el('oi-rpanel');
      if (pc) {
        pc.style.display = ''; pc.style.left = PX + 'px'; pc.style.top = PY + 'px';
        ctx = pc.getContext('2d');
        setCanvasDPR(pc, ctx, PW, PH);
        ctx.fillStyle = B.ground; ctx.fillRect(0, 0, PW, PH);
        ctx.translate(-PX, -PY);
      }
      var segText = function (txt, size, x, y, color) {
        ctx.font = '700 ' + size + 'px "OI Seg", "DSEG14", monospace';
        ctx.fillStyle = 'rgba(150,190,245,' + (night ? 0.07 : 0.085) + ')'; ctx.fillText(txt.replace(/[0-9A-Za-z\-]/g, '~'), x, y);
        ctx.save(); ctx.shadowColor = 'rgba(140,200,255,' + (night ? 0.28 : 0.35) + ')'; ctx.shadowBlur = size * 0.12; ctx.fillStyle = color; ctx.fillText(txt, x, y); ctx.restore();
        return ctx.measureText(txt).width;
      };
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 15px ' + SANS; ctx.fillStyle = B.ink2;
      ctx.fillText(new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(), R0, PY + 32);
      ctx.font = '700 17px ' + SANS;
      var apW = ctx.measureText(ck.ap).width;
      ctx.fillStyle = B.ink2; ctx.fillText(ck.ap, R0, PY + 84);
      segText(ck.hm, 44, R0 - apW - 8, PY + 84, B.ink);
      ctx.font = '800 14px ' + SANS;
      var tagTxt = Math.abs(dh) < 1 ? 'NOW' : (dh > 0 ? '+' : '-') + Math.abs(dh) + ' H FROM NOW';
      if (Math.abs(dh) < 1) {
        var tw2 = ctx.measureText(tagTxt).width + 14;
        ctx.fillStyle = B.ink; ctx.fillRect(R0 - tw2, PY + 96, tw2, 20);
        ctx.fillStyle = B.ground; ctx.fillText(tagTxt, R0 - 7, PY + 111);
      } else { ctx.fillStyle = B.ink2; ctx.fillText(tagTxt, R0, PY + 111); }
      if (scene !== 'day') { ctx.textAlign = 'left'; ctx.fillStyle = B.ink2; ctx.fillText('AFTER DARK', PX + 20, PY + 111); ctx.textAlign = 'right'; }
      ctx.strokeStyle = B.panelLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PX + 18, PY + 130.5); ctx.lineTo(PX + PW - 18, PY + 130.5); ctx.stroke();
      if (d.lead) {
        var L = d.lead, out2 = L.cls === 'dir-out';
        ctx.textAlign = 'left'; ctx.font = '800 13px ' + SANS; ctx.fillStyle = out2 ? B.out : B.reefInk;
        ctx.fillRect(PX + 20, PY + 147, 14, 9);
        ctx.fillText(out2 ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF', PX + 42, PY + 157);
        ctx.textAlign = 'right';
        ctx.font = '700 20px ' + SANS;
        var sW = ctx.measureText('s').width;
        ctx.fillStyle = B.ink2; ctx.fillText('s', R0, PY + 232);
        var pW = segText(String(L.p != null ? Math.round(L.p) : '–'), 38, R0 - sW - 4, PY + 232, out2 ? B.ink2 : B.ink);
        ctx.font = '600 20px ' + SANS; ctx.fillStyle = B.ink2;
        var atX = R0 - sW - 4 - pW - 10; ctx.fillText('ft @', atX, PY + 232);
        var ftW = ctx.measureText('ft @').width;
        segText(ftStr(L.h), 64, atX - ftW - 8, PY + 232, out2 ? B.ink2 : B.ink);
        // Window tag, in the code.
        var tg = TAG[L.cls] ? TAG[L.cls][1] : '';
        ctx.font = '800 13px ' + SANS;
        var tgw = ctx.measureText(tg).width + 18, tx0 = R0 - tgw, ty0 = PY + 246;
        if (L.cls === 'dir-in') { ctx.fillStyle = B.winFill; ctx.fillRect(tx0, ty0, tgw, 22); ctx.strokeStyle = B.win; ctx.lineWidth = 1; ctx.strokeRect(tx0 + 0.5, ty0 + 0.5, tgw - 1, 21); ctx.fillStyle = B.winFillInk; }
        else if (L.cls === 'dir-edge') { ctx.strokeStyle = B.edge; ctx.lineWidth = 2; ctx.strokeRect(tx0 + 1, ty0 + 1, tgw - 2, 20); ctx.fillStyle = B.edge; }
        else { ctx.strokeStyle = B.out; ctx.lineWidth = 1; ctx.strokeRect(tx0 + 0.5, ty0 + 0.5, tgw - 1, 21); ctx.fillStyle = B.out; }
        ctx.textAlign = 'center'; ctx.fillText(tg, tx0 + tgw / 2, ty0 + 16);
      }
      ctx = mainCtx;
    } else {
      var pc0 = el('oi-rpanel'); if (pc0) pc0.style.display = 'none';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 18px ' + SANS; ctx.fillStyle = B.ink2;
      ctx.fillText('AWAITING FORECAST DATA', w / 2, hgt / 2 + rMax / 2);
    }
    ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.fillStyle = B.ink; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 12, 0, Math.PI * 2); ctx.strokeStyle = A(B.rgb, 0.5); ctx.lineWidth = 1.5; ctx.stroke();

    // Sweep + echoes: DOM layers on the compositor, synced to one epoch.
    var sw = el('oi-sweep');
    if (sw) {
      // The sweep layer covers the scope; the arm sits at the lineup. A
      // mask fades the sweep out over 70 px before the position panel.
      sw.style.setProperty('--lx', lx + 'px'); sw.style.setProperty('--ly', ly + 'px'); sw.style.setProperty('--r', rMax + 'px');
      var mx0 = w - 356 - 20, my0 = 14 + 278 + 20;
      var msk = d ? 'linear-gradient(90deg, #000 ' + (mx0 - 70) + 'px, transparent ' + mx0 + 'px), linear-gradient(180deg, transparent ' + my0 + 'px, #000 ' + (my0 + 70) + 'px)' : 'none';
      sw.style.webkitMaskImage = msk; sw.style.maskImage = msk;
      sw.style.webkitMaskComposite = 'source-over'; sw.style.maskComposite = 'add';
    }
    var host = el('oi-echoes');
    if (host) {
      if (!SWEEP.epoch) restartSweep();
      var T = ((performance.now() - SWEEP.epoch) / 1000) % SWEEP.period;
      host.innerHTML = echoes.map(function (ec) {
        var peak = ((ec.deg % 360) + 360) % 360 / 360 * SWEEP.period;
        var delay = -(((T - peak) % SWEEP.period) + SWEEP.period) % SWEEP.period;
        return '<span class="oi-echo" style="left:' + ec.x.toFixed(1) + 'px;top:' + ec.y.toFixed(1) + 'px"><i style="animation-duration:' + SWEEP.period + 's;animation-delay:' + delay.toFixed(2) + 's' + (ec.big ? '' : ';transform:scale(.7)') + '"></i></span>';
      }).join('');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Spectral rose, in the colour code: the 115–158° window is a magenta
  // wedge with solid edges; a petal is sounding blue when it reaches the
  // reef (inside the window; amber rim on the edge), a grey dotted ghost
  // when it's blocked. Radius = energy (as before); period is printed on
  // the strongest petals instead of being a second blue ramp.
  // Same hit-test geometry as app.js, so tap / hover inspection still works.
  // ════════════════════════════════════════════════════════════════════
  function oiDrawCompassRose(spectral, buoyParsed) {
    var canvas = el('compass-canvas');
    if (!canvas) return;
    var container = canvas.parentElement;
    var size = Math.min(container.clientWidth || container.offsetWidth || 260, container.clientHeight || container.offsetHeight || 260);
    if (size <= 0) return;
    var ctx = canvas.getContext('2d');
    setCanvasDPR(canvas, ctx, size, size);
    var B = curPal(), kiosk = document.body.classList.contains('kiosk');
    var SANS = '"OI Sans", "Orbitron", sans-serif';
    var compact = size < 380, cx = size / 2, cy = size / 2, r = size / 2 - (compact ? 24 : 34);
    var fs = kiosk ? 15 : compact ? 11 : 12;
    var rad = function (deg) { return (deg - 90) * Math.PI / 180; };
    ctx.clearRect(0, 0, size, size);
    ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.strokeStyle = A(B.rgb, 0.22);
    [0.25, 0.5, 0.75, 1].forEach(function (f) { ctx.beginPath(); ctx.arc(cx, cy, f * r, 0, Math.PI * 2); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.fillStyle = B.ink; ctx.font = '800 ' + fs + 'px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var pad = compact ? 12 : 18;
    ctx.fillText('N', cx, cy - r - pad); ctx.fillText('S', cx, cy + r + pad); ctx.fillText('E', cx + r + pad, cy); ctx.fillText('W', cx - r - pad, cy);
    var mn = CH.swellWindowMin, mx = CH.swellWindowMax;
    if (STATE.isChocomount) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, rad(mn), rad(mx)); ctx.closePath();
      ctx.fillStyle = A(B.winRgb, 0.16); ctx.fill();
      ctx.strokeStyle = B.win; ctx.lineWidth = 1.6; ctx.stroke();
    }
    STATE._roseWedges = null; STATE._roseGeom = null;
    var tips = [];
    if (spectral && spectral.bins && spectral.bins.length) {
      var rMax = r * 0.95, scaleFn = STATE.roseScaleMode === 'sqrt' ? Math.sqrt : function (v) { return v; };
      var bins = spectral.bins, m0 = 0;
      var share = bins.map(function (b, i) {
        var df = i < bins.length - 1 ? Math.abs(bins[i + 1].freq - bins[i].freq) : (i > 0 ? Math.abs(bins[i].freq - bins[i - 1].freq) : 0.005);
        var e = b.energy > 0 ? b.energy * df : 0; m0 += e; return e;
      });
      var wedges = [], maxS = 0;
      bins.forEach(function (b, i) {
        if (!(b.energy > 0) || !(b.period > 0) || !Number.isFinite(b.dir1)) return;
        var sc = scaleFn(b.energy); if (sc > maxS) maxS = sc;
        wedges.push({ id: wedges.length, period: b.period, dir: ((b.dir1 % 360) + 360) % 360, r1: Number.isFinite(b.r1) ? Math.max(0, Math.min(1, b.r1)) : null, share: m0 > 0 ? share[i] / m0 : 0, scaled: sc });
      });
      if (maxS > 0) {
        wedges.sort(function (a, b) { return b.scaled - a.scaled; });
        var hov = STATE._roseHover, hasHov = hov != null && wedges.some(function (w) { return w.id === hov; });
        var dots = pattern('dots', B.outRgb, 0.95, 0.12), drawn = [];
        wedges.forEach(function (w) {
          var ro = (w.scaled / maxS) * rMax; if (ro <= 0.5) return;
          var half = w.r1 == null ? 6 : Math.max(3, Math.min(25, Math.sqrt(2 * (1 - w.r1)) * 180 / Math.PI));
          var cls = STATE.isChocomount ? swellDirClass(w.dir) : 'dir-in', reach = cls !== 'dir-out', isH = hasHov && w.id === hov;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, ro, rad(w.dir - half), rad(w.dir + half)); ctx.closePath();
          ctx.globalAlpha = hasHov && !isH ? 0.35 : 1;
          ctx.fillStyle = reach ? A(B.reefRgb, 0.62) : dots; ctx.fill();
          ctx.lineWidth = isH ? 2.2 : 1; ctx.setLineDash(reach ? [] : [3, 2]);
          ctx.strokeStyle = isH ? B.ink : reach ? (cls === 'dir-edge' ? B.edge : B.reefInk) : B.out; ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          drawn.push({ id: w.id, dir: w.dir, halfDeg: half, rOuter: ro, period: w.period, share: w.share });
        });
        STATE._roseWedges = drawn; STATE._roseGeom = { cx: cx, cy: cy, size: size };
        // Period on the three strongest petals, at their tips, never stacked.
        drawn.slice().sort(function (a, b) { return b.rOuter - a.rOuter; }).forEach(function (w) {
          if (tips.length >= 3) return;
          var rr = w.rOuter + fs * 0.9, x = cx + Math.cos(rad(w.dir)) * rr, y = cy + Math.sin(rad(w.dir)) * rr;
          if (tips.some(function (t) { return Math.hypot(t.x - x, t.y - y) < fs * 2.6; })) return;
          tips.push({ x: x, y: y, t: Math.round(w.period) + 's' });
        });
      }
    }
    ctx.font = '800 ' + fs + 'px ' + SANS; ctx.lineJoin = 'round';
    tips.forEach(function (t) { ctx.lineWidth = 4; ctx.strokeStyle = B.ground; ctx.strokeText(t.t, t.x, t.y); ctx.fillStyle = B.ink; ctx.fillText(t.t, t.x, t.y); });
    if (STATE.isChocomount) {
      ctx.font = '800 ' + fs + 'px ' + SANS;
      [mn, mx].forEach(function (deg) {
        var x = cx + Math.cos(rad(deg)) * (r + fs * 1.4), y = cy + Math.sin(rad(deg)) * (r + fs * 1.1);
        ctx.lineWidth = 4; ctx.strokeStyle = B.ground; ctx.strokeText(deg + '°', x, y); ctx.fillStyle = B.win; ctx.fillText(deg + '°', x, y);
      });
    }
    var hsFt = resolveHsFt(STATE.lastSpecSummary && STATE.lastSpecSummary.hs, buoyParsed && buoyParsed.waveHeight, spectral && spectral.bins);
    if (hsFt != null) {
      ctx.font = '700 ' + (fs + 4) + 'px "OI Seg", "DSEG14", monospace'; ctx.lineWidth = 5; ctx.strokeStyle = B.ground;
      ctx.strokeText(hsFt.toFixed(1), cx, cy - 2); ctx.fillStyle = B.ink; ctx.fillText(hsFt.toFixed(1), cx, cy - 2);
      ctx.font = '800 ' + (fs - 2) + 'px ' + SANS; ctx.strokeText('FT HS', cx, cy + fs + 2); ctx.fillStyle = B.ink2; ctx.fillText('FT HS', cx, cy + fs + 2);
    }
  }
  function roseLegend() {
    var lg = document.querySelector('.rose-legend');
    if (lg) lg.innerHTML = '<span class="oi-legend">' + LEG.reef + LEG.dots + LEG.win + '<span class="lpd"><b>9s</b>PERIOD</span></span>';
    var help = document.querySelector('#panel-compass .widget-help p');
    if (help) help.textContent = 'Wave energy by the direction it comes from: the further out a petal reaches, the more energy. Blue petals sit inside the magenta 115–158° window and reach the reef; grey dotted petals are aimed outside it and Montauk or Block Island stops them. The numbers are the period of the strongest bands.';
    var ro = el('rose-readout'); if (ro && /hover a petal/.test(ro.textContent)) ro.textContent = 'tap a petal to read that swell band';
  }

  // ════════════════════════════════════════════════════════════════════
  // MODEL page charts: app.js draws them dark-on-white with literal
  // colours. After each draws, remap its pixels into the instrument: white
  // → the card's ground, neutral ink → ice (lifted so ticks hold 4.5:1),
  // the session dots and fit lines → the model's lavender. Geometry and
  // anti-aliasing are untouched.
  // ════════════════════════════════════════════════════════════════════
  function hex3(c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; var p = m[1].split(/[ ,/]+/).map(Number); return p.length > 3 && p[3] === 0 ? null : p.slice(0, 3); }
  function groundOf(node) {
    for (var n = node; n && n.nodeType === 1; n = n.parentElement) { var c = hex3(getComputedStyle(n).backgroundColor); if (c) return c; }
    var g = curPal().ground; return [parseInt(g.slice(1, 3), 16), parseInt(g.slice(3, 5), 16), parseInt(g.slice(5, 7), 16)];
  }
  function darkRemap(cv) {
    if (!cv || !cv.width || cv.dataset.nvDark === String(cv.width) + OI.light) return;
    var ctx = cv.getContext('2d'), W = cv.width, Hh = cv.height;
    var img; try { img = ctx.getImageData(0, 0, W, Hh); } catch (e) { return; }
    var d = img.data, G = groundOf(cv.parentElement), night = OI.light === 'night';
    var I = night ? [210, 218, 228] : [236, 241, 247], Lv = night ? [200, 188, 255] : [212, 203, 255];
    for (var i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var l = (0.299 * r + 0.587 * g + 0.114 * b) / 255, t = Math.pow(Math.max(0, 1 - l), 0.62), T, C;
      if (mx - mn > 28 && b >= r) { T = Math.min(1, (1 - l) * 2.1); C = Lv; }
      else { T = t; C = I; }
      d[i] = Math.round(G[0] + (C[0] - G[0]) * T); d[i + 1] = Math.round(G[1] + (C[1] - G[1]) * T); d[i + 2] = Math.round(G[2] + (C[2] - G[2]) * T); d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    cv.dataset.nvDark = String(cv.width) + OI.light;
  }
  function remapModelCharts() {
    document.querySelectorAll('#view-regression canvas.reg-scatter-canvas, #view-regression canvas.reg-residual-canvas, #view-regression canvas.reg-feature-mini-canvas').forEach(function (cv) {
      if (cv.offsetWidth) darkRemap(cv);
    });
  }
  function installModelCharts() {
    ['_regBuildScatterCanvas', '_regBuildFeatureMini', 'renderRegressionResidual', 'renderRegressionTab', 'slRetrain'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(function () { try { remapModelCharts(); } catch (e) { err('modelcharts', e); } }, 0);
        return r;
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Install
  // ════════════════════════════════════════════════════════════════════
  function installShared() {
    FC_CHART_FONT = '"OI Sans", "Orbitron", sans-serif';
    window.drawCompassRose = oiDrawCompassRose;
    try { roseLegend(); } catch (e) { err('roselegend', e); }
    window.drawSwellPanel = oiDrawSwellPanel;
    window.drawWindPanel = oiDrawWindPanel;
    window.drawTidePanel = oiDrawTidePanel;
    window.renderDayLabels = oiRenderDayLabels;
    window.startNowPulse = function () { placeNowDot(); };
    window.stopNowPulse = function () { var d = el('oi-nowdot'); if (d) d.style.display = 'none'; };
    var prevApply = applyScrubberToHour;
    window.applyScrubberToHour = function (idx) { prevApply(idx); onHour(idx); };
    var prevDraw = drawForecastChart;
    window.drawForecastChart = function () { var r = prevDraw.apply(this, arguments); afterChart(); return r; };
    setInterval(guard('minute', function () { placeNowDot(); syncLed(); if (!KIOSK_ON) applyLight(); }), 60e3);
  }

  function installWeb() {
    window.drawLineupMap = oiDrawLineupMap;
    installModelCharts();
    // A load finished (good or failed): the status light and the readout's
    // age line follow STATE.dataAsOf, the same contract Choc TV reads.
    var prevHealth = recordDataHealth;
    window.recordDataHealth = function () { var r = prevHealth.apply(this, arguments); try { syncLed(); onHour(selIdx()); } catch (e) { err('health', e); } return r; };
    var prevSwellCard = updateSwellCard;
    window.updateSwellCard = function () { var r = prevSwellCard.apply(this, arguments); try { if (selIdx() === nowIdx()) onHour(selIdx()); summaries(); } catch (e) { err('swellcard', e); } return r; };
    var prevSwitch = switchTab;
    window.switchTab = function (tab) {
      var r = prevSwitch.apply(this, arguments);
      var key = tab === 'surflog' ? 'log' : tab === 'regression' ? 'model' : (document.body.classList.contains('oi-setup') ? 'set' : 'fcst');
      document.querySelectorAll('#oi-keys .oi-key').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.key === key ? 'true' : 'false'); });
      if (tab === 'surflog') { try { syncWhen(); syncRates(); renderSessions(); } catch (e) { err('logtab', e); } }
      if (tab === 'regression') setTimeout(function () { try { remapModelCharts(); } catch (e) { err('modeltab', e); } }, 60);
      return r;
    };
  }

  try {
    installShared();
    if (KIOSK_ON) {
      document.body.classList.add('oi');
      applyLight(true);
      kioskOI();
    } else {
      buildWeb();
      installWeb();
      applyLight(true);
      renderReadout(null);
      renderKey();
    }
    OI.ready = true;
  } catch (e) {
    err('install', e);
    OI.ready = true;
  }
})();
