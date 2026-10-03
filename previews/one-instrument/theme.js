// ════════════════════════════════════════════════════════════════════
// ONE INSTRUMENT — LetsCheckChoc skin, behaviour half (classic script)
// ────────────────────────────────────────────────────────────────────
// Loads after kiosk.js. Everything app.js / kiosk.js declares is a
// writable global (function declarations) or a mutable palette object
// (FC_RETRO / ROSE_THEME), so the skin works by:
//   • light: body[data-oi-light] = day | dusk | night from calcDaylight
//     (the app's NOAA sun), palettes swapped into FC_RETRO;
//   • DOM: one bezel, four soft keys, an answer-first Forecast page
//     (readout → this week → hour dial → chart page → graph page →
//     more), Sources & settings behind the SET key;
//   • wrappers on applyScrubberToHour / drawForecastChart /
//     renderSurfLogTable, and replacements for drawSwellPanel /
//     drawLineupMap / renderDayLabels / the now-pulse (all function
//     declarations, so the app's own call sites pick them up).
// Choc TV gets the same instrument upgrades in kioskOI() below.
// In a real PR this file's pieces move into app.js / kiosk.js and
// theme.css replaces styles-web1*.css + styles-retro.css.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var OI = window.OI = { ready: false, errors: [], light: null };
  function err(where, e) {
    var m = where + ': ' + (e && e.message ? e.message : e);
    OI.errors.push(m);
    if (window.console) console.warn('[OI]', m, e && e.stack);
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

  // Light at an instant: reflective LCD by day, EL backlight through the
  // twilight (20 min either side of the horizon to civil light), phosphor
  // after dark. Uses the app's own NOAA calculator.
  function lightAt(ms) {
    var dl = sun(ms);
    if (dl.alwaysDay) return 'day';
    if (dl.alwaysNight || !dl.sunrise) return 'night';
    var rise = dl.sunrise.getTime(), set = dl.sunset.getTime();
    var fl = dl.firstLight.getTime(), ll = dl.lastLight.getTime();
    if (ms >= rise + 20 * 60e3 && ms < set - 20 * 60e3) return 'day';
    if (ms >= fl && ms < ll) return 'dusk';
    return 'night';
  }
  function sceneAt(ms) { var l = lightAt(ms); return l === 'dusk' ? 'twilight' : l; }

  function windClass(mph, dir) {
    if (dir == null) return null;
    var OFF = 335;
    var gap = Math.min(((dir - OFF) % 360 + 360) % 360, ((OFF - dir) % 360 + 360) % 360);
    var b = gap < 60 ? 'off' : gap < 120 ? 'cross' : 'on';
    if (mph != null && mph < 5) b = b === 'cross' ? 'off' : b === 'on' ? 'cross' : b;
    return b;
  }
  var WIND_WORD = { off: 'OFFSHORE', cross: 'CROSS-SHORE', on: 'ONSHORE' };
  var WIND_SHORT = { off: 'OFF', cross: 'CROSS', on: 'ON' };
  var TAG = { 'dir-in': ['oi-tag-in', 'IN WINDOW', 'IN'], 'dir-edge': ['oi-tag-edge', 'EDGE', 'EDGE'], 'dir-out': ['oi-tag-out', 'OUT OF WINDOW', 'OUT'] };
  function tagHTML(cls, short) {
    var t = TAG[cls]; if (!t) return '';
    return '<span class="oi-tag ' + t[0] + '">' + (short ? t[2] : t[1]) + '</span>';
  }

  // The big filled arrow from Choc TV, reading printed on it. Rotated to
  // the TRAVEL direction; the FROM label stays upright.
  function arrowHTML(fromDeg, cls, label, sub) {
    if (fromDeg == null) return '';
    var travel = Math.round((fromDeg + 180) % 360);
    return '<span class="oi-arrow ' + (cls || '') + '">' +
      '<svg viewBox="0 0 100 140" style="transform:rotate(' + travel + 'deg)" aria-hidden="true">' +
      '<path d="M50 2 L98 62 L74 62 L74 138 L26 138 L26 62 L2 62 Z"/></svg>' +
      (label ? '<span class="oi-ao"><b>' + label + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</span>' : '') +
      '</span>';
  }
  // Wind heading dial (owner pick): ring + rim pointer at the travel bearing.
  function dialSVG(fromDeg) {
    var ticks = '';
    for (var a = 0; a < 360; a += 30) ticks += '<line class="tick" transform="rotate(' + a + ' 50 50)" x1="50" y1="7" x2="50" y2="14"/>';
    var ptr = fromDeg == null ? '' :
      '<path class="ptr" transform="rotate(' + Math.round((fromDeg + 180) % 360) + ' 50 50)" d="M50 0 L61 20 L39 20 Z"/>';
    return '<svg class="oi-dial" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="42"/>' + ticks + ptr + '</svg>';
  }
  function meter(v) {
    var n = v == null ? 0 : Math.max(0, Math.min(10, Math.round(v))), s = '';
    for (var i = 0; i < 10; i++) s += '<i' + (i < n ? ' class="on"' : '') + '></i>';
    return '<span class="oi-meter">' + s + '</span>';
  }
  var ICON_SUN = '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="2.6"/><g stroke="currentColor" stroke-width="1.3"><path d="M6 0.5v1.8M6 9.7v1.8M0.5 6h1.8M9.7 6h1.8M2.1 2.1l1.3 1.3M8.6 8.6l1.3 1.3M2.1 9.9l1.3-1.3M8.6 3.4l1.3-1.3"/></g></svg>';
  var ICON_MOON = '<svg viewBox="0 0 12 12"><path d="M8.6 9.8A4.6 4.6 0 0 1 4.3 1.6 4.6 4.6 0 1 0 10.6 7.6 4.6 4.6 0 0 1 8.6 9.8Z"/></svg>';
  var ICON_N = '<svg viewBox="0 0 12 12"><path d="M6 0.5 9.5 11 6 8.6 2.5 11Z"/></svg>';
  var CHEV_L = '<svg viewBox="0 0 16 12"><path d="M10 0 4 6l6 6z"/></svg>';
  var CHEV_R = '<svg viewBox="0 0 16 12"><path d="M6 0l6 6-6 6z"/></svg>';
  var CHEV_LL = '<svg viewBox="0 0 16 12"><path d="M8 0 2 6l6 6zM15 0 9 6l6 6z"/></svg>';
  var CHEV_RR = '<svg viewBox="0 0 16 12"><path d="M1 0l6 6-6 6zM8 0l6 6-6 6z"/></svg>';

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
    var tide = tideAt(t);
    var next = null, ev = tideEvents();
    for (var i = 0; i < ev.length; i++) if (ev[i].t > t) { next = ev[i]; break; }
    return {
      idx: idx, t: t, isNow: idx === nowIdx(),
      lead: lead.h != null ? lead : null, other: other.h != null && other.h >= 0.3 ? other : null,
      wind: ws != null ? { mph: ws, dir: wd, gust: wg, cls: windClass(ws, wd) } : null,
      tide: tide, next: next, model: modelAt(idx), scene: sceneAt(t)
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Palettes (canvas charts read every colour from FC_RETRO)
  // ════════════════════════════════════════════════════════════════════
  var PAL = {
    day:   { ground: '#c6cdb4', ink: '#141a14', rgb: '20,26,20' },
    dusk:  { ground: '#63dcc4', ink: '#03211c', rgb: '3,33,28' },
    night: { ground: '#000000', ink: '#45ff9a', rgb: '69,255,154' }
  };
  // LCD dot-matrix fills (CSS-px cells, so they sit on the glass grid).
  function pattern(kind, rgb, a) {
    var cv = document.createElement('canvas');
    var n = kind === 'check' ? 2 : 4;
    cv.width = n; cv.height = n;
    var x = cv.getContext('2d');
    x.fillStyle = 'rgba(' + rgb + ',' + a + ')';
    var px = {
      dots: [[0, 0], [2, 2]],
      check: [[0, 0], [1, 1]],
      hatch: [[0, 3], [1, 2], [2, 1], [3, 0]]
    }[kind];
    px.forEach(function (p) { x.fillRect(p[0], p[1], 1, 1); });
    return x.createPattern(cv, 'repeat');
  }
  function chartPalette(mode) {
    var b = PAL[mode], night = mode === 'night';
    var I = function (a) { return 'rgba(' + b.rgb + ',' + a + ')'; };
    return {
      plotBg: 'rgba(0,0,0,0)', grid: I(night ? 0.22 : 0.3), ink: b.ink, ink2: I(0.74), frame: I(night ? 0.3 : 0.42),
      swellFill: night ? I(0.34) : I(0.86), swellStroke: b.ink, secSwellFill: pattern('dots', b.rgb, night ? 0.6 : 0.8),
      period: b.ink, periodHalo: night ? 'rgba(0,0,0,0.92)' : b.ground,
      dirPrimary: b.ink, dirSecondary: I(0.5),
      windOn: pattern('hatch', b.rgb, night ? 0.8 : 0.9), windCross: pattern('check', b.rgb, night ? 0.55 : 0.7),
      windOff: night ? I(0.62) : I(0.86), windNull: I(0.12), windStroke: b.ink, windBand: I(night ? 0.09 : 0.13),
      tide: b.ink, tideMarkFaint: I(0.5), tideMark: b.ink, tideConn: I(0.6),
      scrubDot: b.ink, nowLine: I(night ? 0.7 : 0.6), daySep: I(night ? 0.16 : 0.2),
      nightShade: I(night ? 0.045 : 0.085), pastDim: 'rgba(0,0,0,0)',
      obsFill: b.ground, obsStroke: b.ink, pulseCore: b.ink, pulseRing: b.rgb,
      _ground: b.ground, _rgb: b.rgb
    };
  }
  function rosePalette(mode) {
    var b = PAL[mode];
    return { bg: 'rgba(0,0,0,0)', ring: 'rgba(' + b.rgb + ',0.25)', cardinal: b.ink, window: b.ink, hs: b.ink, hsSub: 'rgba(' + b.rgb + ',0.6)' };
  }

  function chooseLight() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('oiLight'); } catch (_) { /* old browser */ }
    if (q === 'day' || q === 'dusk' || q === 'night') return q;
    var pref = 'auto';
    try { pref = localStorage.getItem('oi-light') || 'auto'; } catch (_) { /* private mode */ }
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
    var mode = KIOSK_ON ? 'night' : chooseLight();
    if (mode === OI.light && !force) return;
    var first = OI.light == null;
    OI.light = mode;
    document.body.setAttribute('data-oi-light', mode);
    if (!KIOSK_ON) {
      Object.assign(FC_RETRO, chartPalette(mode));
      Object.assign(ROSE_THEME, rosePalette(mode));
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#222529');
      if (!first) redrawCharts();
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Chart drawers (replacements / wrappers)
  // ════════════════════════════════════════════════════════════════════
  function clearCanvas(id) {
    var c = el(id); if (!c) return;
    var x = c.getContext('2d');
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.restore();
  }
  function veilPast(ctx, common, plotLeft, plotW, top, hgt) {
    var now = Date.now();
    if (now <= common.t0) return;
    var nx = Math.min(_fcXFor(new Date(now), common, plotLeft, plotW), plotLeft + plotW);
    ctx.save();
    ctx.globalAlpha = OI.light === 'night' ? 0.55 : 0.5;
    ctx.fillStyle = FC_RETRO._ground || '#000';
    ctx.fillRect(plotLeft, top, nx - plotLeft, hgt);
    ctx.restore();
  }
  function axisMax(peak) {
    var t = peak * 1.1;
    var m = t <= 4 ? 4 : t <= 6 ? 6 : Math.ceil(t / 4) * 4;
    return { max: m, div: m === 6 ? 3 : 4 };
  }

  // "Plot what reaches the reef": solid ink = window-weighted energy
  // (√Σ alignment·H², the energy rule kioskDaySummary uses), dotted ghost
  // behind it = everything offshore including what Montauk / Block
  // Island blocks. Period follows the lead in-window train.
  function oiDrawSwellPanel(common, data) {
    var canvas = el('forecast-canvas-swell');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var dims = ensureCanvasCssDims(canvas, ctx), cssW = dims.cssW, cssH = dims.cssH;
    ctx.clearRect(0, 0, cssW, cssH);
    var P = FC_RETRO, kiosk = document.body.classList.contains('kiosk');
    var plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    var top = 6, usableH = cssH - 10;
    var hgt = Math.round(usableH * (kiosk ? 0.7 : 0.68));
    var subTop = top + hgt + 8, subBot = cssH - 2;
    var mh = (fd() && fd().marine && fd().marine.hourly) || {};
    var secPer = mh.secondary_swell_wave_period || [];
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
      // Period: in-window-height-weighted across both trains (the model's
      // effPeriod); with nothing in the window it falls back to the
      // primary and draws dashed.
      lead[i] = { p: PER[i], d: pri ? D1[i] : D2[i], a: swellDirClass(D1[i]) !== 'dir-out' ? 1 : 0, a1: swellDirClass(D1[i]) !== 'dir-out' ? 1 : 0, a2: swellDirClass(D2[i]) !== 'dir-out' ? 1 : 0, d1: D1[i], d2: D2[i], h2: h2 };
      if (total[i] > peak) peak = total[i];
    }
    var ax = axisMax(peak), maxY = ax.max, div = ax.div, periodMax = 24;
    OI.reef = reef; OI.swellGeom = { top: top, h: hgt, maxY: maxY, plotLeft: plotLeft, plotW: plotW };
    var X = function (t) { return _fcXFor(t, common, plotLeft, plotW); };
    var Y = function (v) { return top + hgt - (Math.min(v, maxY) / maxY) * hgt; };
    var YP = function (v) { return top + hgt - (Math.max(0, Math.min(periodMax, v)) / periodMax) * hgt; };

    _fcDrawNightShading(ctx, common, plotLeft, plotW, top, subBot - top);
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
    // Ghost: all swell offshore, blocked or not.
    area(total); ctx.fillStyle = P.secSwellFill; ctx.fill();
    edge(total); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeStyle = P.frame; ctx.stroke(); ctx.setLineDash([]);
    // Hero: what reaches the reef.
    area(reef); ctx.fillStyle = P.swellFill; ctx.fill();
    edge(reef); ctx.lineWidth = 2; ctx.strokeStyle = P.swellStroke; ctx.lineJoin = 'round'; ctx.stroke();
    if (OI.light === 'night' || kiosk) {
      ctx.save(); ctx.shadowColor = 'rgba(69,255,154,0.8)'; ctx.shadowBlur = 8; edge(reef); ctx.stroke(); ctx.restore();
    }
    // Period of the lead train: solid while it's in the window, dashed when not.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (var j = 0; j < n; j++) {
        var L0 = lead[j], L1 = lead[j + 1];
        if (!L0 || !L1 || L0.p == null || L1.p == null || !isFinite(L0.p) || !isFinite(L1.p)) continue;
        ctx.beginPath();
        ctx.moveTo(X(common.allTimes[j]), YP(L0.p)); ctx.lineTo(X(common.allTimes[j + 1]), YP(L1.p));
        if (pass === 0) { ctx.setLineDash([]); ctx.strokeStyle = P.periodHalo; ctx.lineWidth = 4; }
        else { ctx.setLineDash(L0.a > 0 ? [] : [2, 4]); ctx.strokeStyle = P.period; ctx.lineWidth = L0.a > 0 ? 1.5 : 1.1; }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
    veilPast(ctx, common, plotLeft, plotW, top, subBot - top);

    // Axes: ft left in ink, period right in the line's own ink.
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

    // Direction strip: the window as a lit band, lead train bold inside it.
    var winMin = CH.swellWindowMin, winMax = CH.swellWindowMax, winMid = (winMin + winMax) / 2;
    var dMin = Math.max(winMid - 120, 90), dMax = winMid + 120;
    var sT = subTop + 3, sB = subBot - 3;
    var YD = function (deg) { return sT + ((deg - dMin) / (dMax - dMin)) * (sB - sT); };
    ctx.fillStyle = P.windBand;
    ctx.fillRect(plotLeft, YD(winMin), plotW, YD(winMax) - YD(winMin));
    ctx.strokeStyle = P.frame; ctx.setLineDash([2, 3]);
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
      function (k) { return lead[k].a2 > 0 ? { w: 1.6, c: P.dirSecondary } : { w: 1.1, c: P.dirSecondary, dash: [2, 3] }; });
    dirLine(function (k) { return lead[k] ? lead[k].d1 : null; },
      function (k) { return lead[k].a1 > 0 ? { w: 2.6, c: P.dirPrimary } : { w: 1.3, c: P.dirPrimary, dash: [1, 3] }; });
    ctx.restore();
    ctx.font = '700 ' + (kiosk ? 13 : 10) + 'px ' + FC_CHART_FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = P.ink;
    [[90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW']].forEach(function (cp) {
      if (cp[0] >= dMin && cp[0] <= dMax) ctx.fillText(cp[1], plotLeft - 5, YD(cp[0]));
    });
    ctx.textAlign = 'left';
    var wl = 'WINDOW ' + winMin + '–' + winMax + '°', wy = (YD(winMin) + YD(winMax)) / 2, ww = ctx.measureText(wl).width;
    ctx.fillStyle = P._ground || '#000'; ctx.globalAlpha = 0.85; ctx.fillRect(plotLeft + 3, wy - 7, ww + 6, 14); ctx.globalAlpha = 1;
    ctx.fillStyle = P.ink; ctx.fillText(wl, plotLeft + 6, wy);
    ctx.textAlign = 'left'; ctx.fillStyle = P.ink2;
    ctx.fillText('SWELL FROM', plotLeft + 6, subBot - 9);
    veilPast(ctx, common, plotLeft, plotW, subTop, subBot - subTop);

    _fcDrawNowLine(ctx, common, plotLeft, plotW, top, subBot);

    // Buoy observation diamond (measured total Hs at the buoy).
    var obsH = data.obsHsFt, obsMs = data.obsMs;
    if (obsH != null && obsMs != null && Date.now() - obsMs <= BUOY_OBS_OLD_MS && obsMs >= common.t0 && obsMs <= common.tEnd) {
      var ox = X(new Date(obsMs)), oy = Y(Math.min(obsH, maxY));
      ctx.beginPath(); ctx.moveTo(ox, oy - 5); ctx.lineTo(ox + 5, oy); ctx.lineTo(ox, oy + 5); ctx.lineTo(ox - 5, oy); ctx.closePath();
      ctx.fillStyle = P.obsFill; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = P.obsStroke; ctx.stroke();
    }

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

  function wrapPanel(name, canvasId, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (common, data) {
      clearCanvas(canvasId);
      var r = orig(common, data);
      try { if (r && after) after(r, common, data); } catch (e) { err(name + '+', e); }
      return r;
    };
  }

  // Tide panel: mark each daylight incoming window (low → next high)
  // as a bar along the floor of the plot — the spot's "go" band.
  function tideExtras(r, common) {
    var ctx = r.canvas.getContext('2d');
    var ev = tideEvents(), P = FC_RETRO;
    ctx.save();
    ctx.fillStyle = P.ink;
    ev.forEach(function (lo, i) {
      if (lo.type !== 'L') return;
      var hi = null; for (var k = i + 1; k < ev.length; k++) if (ev[k].type === 'H') { hi = ev[k]; break; }
      var end = hi ? hi.t : lo.t + 6.2 * HOUR;
      var dl = sun(lo.t); if (!dl.sunrise) return;
      var a = Math.max(lo.t, dl.sunrise.getTime()), b = Math.min(end, dl.sunset.getTime());
      if (b <= a) return;
      var x1 = _fcXFor(new Date(a), common, r.plotLeft, r.plotW), x2 = _fcXFor(new Date(b), common, r.plotLeft, r.plotW);
      x1 = Math.max(x1, r.plotLeft); x2 = Math.min(x2, r.plotLeft + r.plotW);
      if (x2 > x1) ctx.fillRect(x1, r.top + r.h - 5, x2 - x1, 4);
    });
    ctx.restore();
    veilPast(ctx, common, r.plotLeft, r.plotW, r.top, r.h);
  }
  function windExtras(r, common) {
    veilPast(r.canvas.getContext('2d'), common, r.plotLeft, r.plotW, r.top, r.h);
  }

  // Now marker: a 14 px DOM dot with a CSS ring (compositor only), moved
  // when the chart redraws or once a minute. Replaces the 10 fps repaint
  // of a full-container canvas (audit M7).
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
  function cssVar(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
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
    var night = OI.light === 'night';
    // The photo is printed on the glass: LCD ink with a ground halo by
    // day / dusk, phosphor with a black halo at night.
    var ink = night ? '#45ff9a' : PAL[OI.light || 'day'].ink;
    var halo = night ? '#000000' : PAL[OI.light || 'day'].ground;
    var cx = Wd / 2, cy = Hd / 2, R = Math.min(Wd, Hd) * 0.47;
    var pt = function (deg, r) { var t = deg * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
    var t = new Date(hr.time[i]).getTime();
    frame.setAttribute('data-scene', sceneAt(t));

    // Swell window cone, edges named for what frames it.
    var e1 = pt(CH.swellWindowMin, R), e2 = pt(CH.swellWindowMax, R);
    mk('path', { d: 'M' + cx + ' ' + cy + ' L' + e1[0] + ' ' + e1[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + e2[0] + ' ' + e2[1] + ' Z',
      fill: night ? 'rgba(69,255,154,0.10)' : 'rgba(' + PAL[OI.light || 'day'].rgb + ',0.12)', stroke: ink, 'stroke-opacity': '0.8', 'stroke-width': '1.5', 'stroke-dasharray': '5 4' });
    var placed = [];
    var collide = function (b) { for (var q = 0; q < placed.length; q++) { var o = placed[q]; if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) return true; } return false; };
    // Label = one or two lines, halo'd, nudged off anything already placed.
    var lab = function (lines, x, y, anchor, size, op, dir) {
      lines = [].concat(lines).filter(Boolean);
      var w = Math.max.apply(null, lines.map(function (l, k) { return l.length * (k ? size * 0.68 : size) * 0.74; })) + 6;
      var hh = size * 1.2 + (lines.length > 1 ? size * 0.95 : 0);
      var bx = function (xx, yy) { return { x: anchor === 'end' ? xx - w : anchor === 'start' ? xx : xx - w / 2, y: yy - size * 0.65, w: w, h: hh }; };
      var dx = dir ? dir[0] : 0, dy = dir ? dir[1] : 1;
      var fit = function (xx, yy) {
        xx = Math.max(anchor === 'end' ? w + 4 : anchor === 'start' ? 4 : w / 2 + 4, Math.min(anchor === 'end' ? Wd - 4 : anchor === 'start' ? Wd - w - 4 : Wd - w / 2 - 4, xx));
        yy = Math.max(size, Math.min(Hd - hh + size * 0.4, yy));
        return [xx, yy];
      };
      // Candidates: outward along the arrow, then sideways either way.
      var best = null;
      for (var step = 0; step < 14 && !best; step++) {
        var cands = [[x + dx * 6 * step, y + dy * 6 * step], [x - dy * 7 * step, y + dx * 7 * step], [x + dy * 7 * step, y - dx * 7 * step]];
        for (var c = 0; c < cands.length; c++) { var f = fit(cands[c][0], cands[c][1]); if (!collide(bx(f[0], f[1]))) { best = f; break; } }
      }
      if (!best) best = fit(x, y);
      x = best[0]; y = best[1];
      placed.push(bx(x, y));
      var tx = mk('text', { x: x, y: y, 'text-anchor': anchor || 'middle', 'dominant-baseline': 'middle', class: 'oi-svg-label',
        'font-size': size, fill: ink, stroke: halo, 'stroke-width': night ? 4 : 3.6, 'fill-opacity': op || 1 });
      lines.forEach(function (l, k) {
        var ts = document.createElementNS(ns, 'tspan');
        ts.setAttribute('x', x);
        if (k) { ts.setAttribute('dy', size * 1.02); ts.setAttribute('font-size', (size * 0.68).toFixed(1)); ts.setAttribute('letter-spacing', '0.12em'); }
        ts.textContent = l;
        tx.appendChild(ts);
      });
      if (night) tx.setAttribute('style', 'filter: drop-shadow(0 0 4px rgba(69,255,154,.55))');
      return tx;
    };
    placed.push({ x: cx - 14, y: cy - 14, w: 28, h: 28 });

    var scale = R / 40;
    var labels = [];
    var arrow = function (fromDeg, len, w, solid, dashed, label, push) {
      if (fromDeg == null) return;
      var head = pt(fromDeg, 11), tail = pt(fromDeg, 11 + len);
      var g = mk('g', {});
      if (night) g.setAttribute('style', 'filter: drop-shadow(0 0 5px rgba(69,255,154,.6))');
      var th = fromDeg * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th), px = Math.cos(th), py = Math.sin(th);
      var hl = 8 + w * 2.2, hw = 4 + w * 1.4;
      var hb = [head[0] + ux * hl, head[1] + uy * hl];
      var tri = head[0] + ',' + head[1] + ' ' + (hb[0] - px * hw) + ',' + (hb[1] - py * hw) + ' ' + (hb[0] + px * hw) + ',' + (hb[1] + py * hw);
      mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: halo, 'stroke-width': w + 3.5, 'stroke-linecap': 'round', 'stroke-opacity': night ? 1 : 0.9 }, g);
      mk('polygon', { points: tri, fill: halo, stroke: halo, 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'stroke-opacity': night ? 1 : 0.9 }, g);
      mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: ink, 'stroke-width': w, 'stroke-linecap': solid ? 'round' : 'butt', 'stroke-dasharray': dashed ? '7 5' : 'none' }, g);
      mk('polygon', { points: tri, fill: solid ? ink : halo, stroke: ink, 'stroke-width': solid ? 0 : 1.8, 'stroke-linejoin': 'round' }, g);
      for (var k = 0.1; k <= 1.01; k += 0.15) { var q = pt(fromDeg, 11 + len * k); placed.push({ x: q[0] - 5, y: q[1] - 5, w: 10, h: 10 }); }
      if (label) labels.push({ lines: label, tail: tail, ux: ux, uy: uy, push: push || 0, solid: solid, rank: solid ? 2 : 1 });
    };
    var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
    var h1 = (hr.swell_wave_height || [])[i], p1 = (hr.swell_wave_period || [])[i], d1 = (hr.swell_wave_direction || [])[i];
    var h2 = (hr.secondary_swell_wave_height || [])[i], p2 = (hr.secondary_swell_wave_period || [])[i], d2 = (hr.secondary_swell_wave_direction || [])[i];
    var wH = wind && wind.hourly, ws = wH ? (wH.wind_speed_10m || [])[i] : null, wd = wH ? (wH.wind_direction_10m || [])[i] : null;
    var sl = function (hh, pp) { return ftStr(hh) + 'ft @ ' + (pp != null ? Math.round(pp) : '–') + 's'; };
    var c1 = swellDirClass(d1), c2 = swellDirClass(d2);
    var word = function (c) { return c === 'dir-in' ? 'IN WINDOW' : c === 'dir-edge' ? 'EDGE' : 'BLOCKED'; };
    var in1 = d1 != null && c1 !== 'dir-out', in2 = d2 != null && c2 !== 'dir-out';
    if (h2 != null && d2 != null && h2 >= 0.3) arrow(d2, clamp(Math.sqrt(h2 * h2 * (p2 || 1)) * 1.5, 13, 30) * scale, 3, in2, !in2, [sl(h2, p2), word(c2)], 6);
    if (h1 != null && d1 != null) arrow(d1, clamp(Math.sqrt(h1 * h1 * (p1 || 1)) * 1.5, 16, 32) * scale, 5, in1, !in1, [sl(h1, p1), word(c1)], 0);
    if (wd != null) {
      var wc = windClass(ws, wd);
      arrow(wd, clamp((ws || 0) * 0.7, 13, 30) * scale, 2.4, false, true, [(ws != null ? Math.round(ws) : '–') + 'mph ' + directionLabel(wd), wc ? WIND_WORD[wc] : ''], 0);
    }
    var b1 = pt(CH.swellWindowMin, R + 4), b2 = pt(CH.swellWindowMax, R + 4);
    lab(['SW PT (BLOCK)', CH.swellWindowMin + '°'], b1[0], b1[1] + 8, 'middle', 10.5, 0.9, [0.3, 1]);
    lab(['MONTAUK PT', CH.swellWindowMax + '°'], b2[0], Math.min(b2[1] + 6, Hd - 22), 'middle', 10.5, 0.9, [-1, 0]);
    labels.sort(function (a, b) { return b.rank - a.rank; });
    labels.forEach(function (L) {
      var off = 18 + L.push;
      lab(L.lines, L.tail[0] + L.ux * off, L.tail[1] + L.uy * off + 4, 'middle', 13, L.solid ? 1 : 0.92, [L.ux, L.uy]);
    });
    var rf = pt(LINEUP_REEF_HEADING, R * 0.28);
    mk('line', { x1: cx, y1: cy, x2: rf[0], y2: rf[1], stroke: ink, 'stroke-width': 1.4, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.8 });
    var rl = pt(LINEUP_REEF_HEADING, R * 0.28 + 8);
    lab('REEF ' + LINEUP_REEF_HEADING + '°', rl[0], rl[1], 'end', 10, 0.85, [-1, -0.2]);

    // Lineup mark.
    mk('circle', { cx: cx, cy: cy, r: 9, fill: 'none', stroke: halo, 'stroke-width': 4, 'stroke-opacity': 0.7 });
    mk('circle', { cx: cx, cy: cy, r: 9, fill: 'none', stroke: ink, 'stroke-width': 1.6 });
    mk('circle', { cx: cx, cy: cy, r: 3.2, fill: ink });

    var hud = el('oi-chart-hud');
    if (hud) {
      var sc = sceneAt(t), dl = sun(t);
      var light = sc === 'day' ? ICON_SUN + 'DAYLIGHT' : sc === 'twilight' ? ICON_SUN + 'TWILIGHT' : ICON_MOON + 'NIGHT';
      var sunTxt = dl.sunset ? (t < dl.sunset.getTime() && t > dl.sunrise.getTime() ? 'SUNSET ' + clock(dl.sunset).hm + clock(dl.sunset).ap.charAt(0) : 'FIRST LIGHT ' + clock(t > dl.sunset.getTime() ? sun(t + 864e5).firstLight : dl.firstLight).hm + 'A') : '';
      hud.innerHTML = '<span class="oi-chip">' + light + '</span>' + (sunTxt ? '<span class="oi-chip">' + sunTxt + '</span>' : '');
    }

  }

  // ════════════════════════════════════════════════════════════════════
  // Web: build the instrument
  // ════════════════════════════════════════════════════════════════════
  var LOGO = '<svg class="oi-logo" viewBox="0 0 22 14" aria-hidden="true"><path fill="#45ff9a" d="M0 9 Q3 3 6 8 T12 8 T18 8 L22 8 L22 14 L0 14Z" opacity=".9"/><circle cx="17.5" cy="3" r="1.6" fill="#b4b9b2"/></svg>';
  // 32×32, 16-colour pixel anchor for the gate (no emoji in the skin).
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

  function bar(left, right, id) {
    var b = h('div', { class: 'oi-bar' }, '<span>' + dots(left) + '</span>' + (right ? '<span class="oi-bar-r">' + dots(right) + '</span>' : ''));
    if (id) b.id = id;
    return b;
  }

  var buildWeb = guard('buildWeb', function () {
    var body = document.body;
    // One skin: the three Win95 sheets step aside (the gate is restyled here).
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      if (/styles-(web1|web1-extensions|retro)\.css/.test(l.getAttribute('href') || '')) l.disabled = true;
    });
    body.classList.add('oi');

    var top = h('div', { id: 'oi-top' },
      LOGO + '<span class="oi-brand">LETSCHECKCHOC</span><span class="oi-model">CHOC<span class="oi-sep"></span>44097</span>' +
      '<span class="oi-spacer"></span><span class="oi-ledwrap"><span id="oi-led-label">STANDBY</span><span class="oi-led" id="oi-led" data-state="busy"></span></span>');
    var keys = h('nav', { id: 'oi-keys', 'aria-label': 'Pages' });
    [['fcst', 'FCST'], ['log', 'LOG'], ['model', 'MODEL'], ['set', 'SET']].forEach(function (k) {
      var b = h('button', { type: 'button', class: 'oi-key', 'data-key': k[0], 'aria-pressed': k[0] === 'fcst' ? 'true' : 'false' }, k[1]);
      b.addEventListener('click', function () { OI.softkey(k[0]); });
      keys.appendChild(b);
    });
    var self = h('div', { id: 'oi-selftest', 'aria-hidden': 'true' },
      '<div class="oi-st-cap">' + dots('LETSCHECKCHOC · CHOC 44097') + '</div>' +
      '<div class="oi-st-line oi-st-big">' + seg('88.8') + '</div>' +
      '<div class="oi-st-line oi-st-mid">' + seg('88:88') + seg('888') + '</div>' +
      '<div class="oi-st-cap" style="margin-top:auto">SELF TEST</div>');
    body.appendChild(self);
    body.appendChild(h('div', { id: 'oi-mask', 'aria-hidden': 'true' }));
    body.appendChild(h('div', { id: 'oi-glass', 'aria-hidden': 'true' }));
    body.appendChild(top);
    body.appendChild(keys);

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

    // Legends inside the stacked chart labels.
    var lbl = function (sel, html) { var l = document.querySelector(sel + ' .forecast-section-label'); if (l) l.innerHTML = html; };
    lbl('.forecast-card-swell', '<span>SWELL</span><span class="oi-legend"><span><i class="oi-sw oi-sw-solid"></i>REACHES</span><span><i class="oi-sw oi-sw-dots"></i>BLOCKED</span><span><i class="oi-sw oi-sw-line"></i>PERIOD</span></span>');
    lbl('.forecast-card-wind', '<span>WIND</span><span class="oi-legend"><span><i class="oi-sw oi-sw-solid"></i>OFF</span><span><i class="oi-sw oi-sw-check"></i>CROSS</span><span><i class="oi-sw oi-sw-hatch"></i>ON</span></span>');
    lbl('.forecast-card-tide', '<span>TIDE</span><span class="oi-legend"><span><i class="oi-sw oi-sw-bar"></i>INCOMING IN DAYLIGHT</span></span>');
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
    var setLink = h('div', { class: 'oi-setlink', role: 'button', tabindex: '0' }, 'SOURCES &amp; SETTINGS<span class="oi-sum-r" style="margin-left:auto;font-weight:600;font-size:12px;color:var(--oi-ink-2)">SET KEY</span>');
    setLink.addEventListener('click', function () { OI.softkey('set'); });
    menu.appendChild(setLink);
    more.appendChild(menu);
    main.appendChild(more);

    // ── Setup page (Sources & settings) ──
    var setup = h('div', { id: 'oi-view-setup' });
    setup.appendChild(bar('SETUP', 'SOURCES &amp; SETTINGS'));
    var setRow = function (cap, nodes, note) {
      var r = h('div', { class: 'oi-setrow' }, '<div class="oi-cap">' + cap + '</div>');
      nodes.forEach(function (n) { if (n) r.appendChild(n); });
      if (note) r.appendChild(h('div', { class: 'oi-note' }, note));
      setup.appendChild(r);
      return r;
    };
    var lightSeg = h('div', { class: 'oi-seg-toggle', id: 'oi-light-toggle' });
    [['auto', 'SUN'], ['system', 'SYSTEM'], ['day', 'DAY'], ['night', 'NIGHT']].forEach(function (o) {
      var b = h('button', { type: 'button', 'data-v': o[0] }, o[1]);
      b.addEventListener('click', function () { try { localStorage.setItem('oi-light', o[0]); } catch (_) { /* private mode */ } syncLightToggle(); applyLight(); });
      lightSeg.appendChild(b);
    });
    setRow('DISPLAY LIGHT', [lightSeg], 'SUN follows Choc’s own sunrise and sunset: reflective LCD by day, backlight through twilight, phosphor after dark.');
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

  function syncLightToggle() {
    var pref = 'auto';
    try { pref = localStorage.getItem('oi-light') || 'auto'; } catch (_) { /* private mode */ }
    document.querySelectorAll('#oi-light-toggle button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === pref ? 'true' : 'false'); });
  }

  OI.softkey = guard('softkey', function (k) {
    var body = document.body;
    body.classList.toggle('oi-setup', k === 'set');
    if (k === 'fcst' || k === 'set') switchTab('forecast');
    else if (k === 'log') switchTab('surflog');
    else if (k === 'model') switchTab('regression');
    document.querySelectorAll('#oi-keys .oi-key').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.key === k ? 'true' : 'false'); });
    if (k === 'set') {
      setTimeout(function () {
        try { if (STATE.buoyMap) STATE.buoyMap.invalidateSize(); if (STATE.tideMap) STATE.tideMap.invalidateSize(); } catch (_) { /* maps optional */ }
      }, 60);
    }
    window.scrollTo(0, 0);
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
    var obs = (arr.match(/Buoy obs ([^(]+?)\s*\(([^)]+)\)/) || []);
    return '<div class="oi-buoy"><b>BUOY 44097 MEASURED</b>&nbsp; ' + seg(hgt) + '<b>ft</b> @ ' + seg(per || '–') + '<b>s</b> ' + dir +
      '<br>' + (reach[1] ? (reach[1] === 'reaches' ? 'AT THE REEF ' : 'AT THE REEF ') + '<b>' + reach[2].replace(/ ([AP])M$/, '$1') + '</b>' : '') +
      (obs[1] ? '<span class="oi-sep"></span>OBS ' + esc(obs[1].replace(/ ([AP])M$/, '$1')) + ' (' + esc(obs[2].replace(/ ago/i, '').replace(/ \d+m$/i, '').toUpperCase()) + ')' : '') + '</div>';
  }

  function annAge() {
    var asOf = STATE.dataAsOf, now = Date.now();
    if (!STATE.lastLoadCompletedAt) return { text: 'FETCHING CHOC FORECAST…', state: 'busy', stale: false };
    if (asOf == null || !isFinite(asOf)) return { text: 'NO FORECAST DATA', state: 'dead', stale: true };
    var age = now - asOf, mins = Math.round(age / 60e3);
    if (age < 75 * 60e3) { var c = clock(asOf); return { text: 'UPD ' + c.hm + c.ap.charAt(0), state: 'live', stale: false }; }
    var hrs = Math.floor(mins / 60);
    return { text: 'DATA ' + (hrs ? hrs + 'H ' : '') + (mins % 60) + 'M OLD', state: age > 6 * HOUR ? 'dead' : 'stale', stale: true };
  }
  function syncLed() {
    var a = annAge(), led = el('oi-led'), lab = el('oi-led-label');
    if (led) led.setAttribute('data-state', a.state);
    if (lab) lab.textContent = a.state === 'live' ? 'LIVE' : a.state === 'busy' ? 'LOADING' : a.state === 'stale' ? 'STALE' : 'NO DATA';
    return a;
  }

  function renderReadout(d) {
    var box = el('oi-readout');
    if (!box) return;
    if (!d) {
      box.innerHTML = '<div class="oi-ann"><span class="oi-mode">NOW</span><span class="oi-when">FETCHING CHOC FORECAST…</span></div>' +
        '<div class="oi-hero"><div class="oi-hero-cap oi-cap">REACHES THE REEF</div><div class="oi-hero-row"><div class="oi-hero-num">' + seg('!!!', 'oi-seg-xl oi-b') + '</div></div></div>';
      return;
    }
    var ck = clock(d.t), age = syncLed();
    var off = Math.round((d.t - Date.now()) / HOUR);
    var ann = '<div class="oi-ann"><span class="oi-mode">' + (d.isNow ? 'NOW' : (off > 0 ? '+' : '-') + Math.abs(off) + ' H') + '</span>' +
      '<span class="oi-when">' + dow(d.t) + ' ' + (new Date(d.t).getMonth() + 1) + '/' + new Date(d.t).getDate() + '<span class="oi-sep"></span>' + ck.hm + ' ' + ck.ap + '</span>' +
      '<span class="oi-age' + (age.stale ? ' is-stale' : '') + '">' + age.text + '</span></div>';
    var L = d.lead, hero;
    if (L) {
      var out = L.cls === 'dir-out';
      hero = '<div class="oi-hero' + (out ? ' is-out' : '') + '">' +
        '<div class="oi-hero-cap oi-cap">' + (out ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + (d.scene === 'night' ? '<span class="oi-sep"></span>NIGHT' : '') + '</div>' +
        '<div class="oi-hero-row"><div class="oi-hero-num">' + seg(ftStr(L.h), 'oi-seg-xl oi-b') + '<span class="oi-u oi-u-xl">ft</span>' +
        '<span class="oi-at">@</span>' + seg(L.p != null ? Math.round(L.p) : '–', 'oi-seg-l oi-b') + '<span class="oi-u oi-u-l">s</span></div>' +
        arrowHTML(L.d, out ? 'is-out' : '', directionLabel(L.d), Math.round(L.d) + '°') + '</div>' +
        '<div class="oi-hero-sub">' + tagHTML(L.cls) +
        (d.other ? '<span class="oi-also">+ ' + ftStr(d.other.h) + 'ft @ ' + (d.other.p != null ? Math.round(d.other.p) : '–') + 's ' + directionLabel(d.other.d) +
          '<span class="oi-sep"></span>' + (d.other.cls === 'dir-out' ? 'BLOCKED' : d.other.cls === 'dir-edge' ? 'EDGE' : 'IN') + '</span>' : '') +
        '</div></div>';
    } else {
      hero = '<div class="oi-hero"><div class="oi-hero-cap oi-cap">NO SWELL DATA FOR THIS HOUR</div></div>';
    }
    var T = d.tide, tideCell = '<div class="oi-cell"><div class="oi-cap">TIDE</div>';
    if (T) {
      tideCell += '<div class="oi-cell-val">' + seg((T.v >= 0 ? '' : '-') + fmt1(Math.abs(T.v))) + '<span class="oi-u">ft</span></div>' +
        '<div class="oi-cell-sub"><span class="oi-tri ' + (T.rising ? 'up' : 'down') + '"></span>' + (T.rising ? 'RISING' : 'FALLING') + '</div>';
    } else {
      tideCell += '<div class="oi-cell-val">' + seg('!!!') + '</div><div class="oi-cell-sub dim">NO TIDE DATA</div>';
    }
    if (d.next) { var nc = clock(d.next.t); tideCell += '<div class="oi-cell-sub dim" style="margin-top:4px">' + (d.next.type === 'H' ? 'HIGH ' : 'LOW ') + nc.hm + nc.ap.charAt(0) + '</div>'; }
    tideCell += '</div>';
    var Wn = d.wind, windCell = '<div class="oi-cell oi-cell-wind"><div class="oi-cap">WIND</div>';
    if (Wn) {
      windCell += dialSVG(Wn.dir) + '<div><div class="oi-cell-val">' + seg(Math.round(Wn.mph)) + '<span class="oi-u">mph ' + directionLabel(Wn.dir) + '</span></div>' +
        '<div class="oi-cell-sub">' + (WIND_WORD[Wn.cls] || '') + '</div>' +
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
      var dl = sun(d.t), lows = daylightLows(), nextLow = null;
      for (var i = 0; i < lows.length; i++) if (lows[i].t > d.t) { nextLow = lows[i]; break; }
      var afterDark = !dl.sunset || d.t > dl.sunset.getTime() - 45 * 60e3;
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
    var ck = clock(d.t), L = d.lead, W2 = d.wind, T = d.tide, M = d.model;
    var off = Math.round((d.t - Date.now()) / HOUR);
    mid.innerHTML = '<span class="oi-hb-time"><span class="oi-dow">' + dow(d.t) + '</span>' + seg(ck.hm) + '<span class="oi-u">' + ck.ap + '</span></span>' +
      '<span class="oi-hb-now' + (d.isNow ? '' : ' is-off') + '">' + (d.isNow ? 'NOW' : (off > 0 ? '+' : '-') + Math.abs(off) + ' H<span class="oi-sep"></span>TAP FOR NOW') + '</span>';
    if (!echo) return;
    var f = [];
    f.push(L ? '<b>' + ftStr(L.h) + 'ft@' + (L.p != null ? Math.round(L.p) : '–') + 's</b> ' + (TAG[L.cls] ? TAG[L.cls][2] : '') : '<b>–</b>');
    f.push(W2 ? '<b>' + Math.round(W2.mph) + 'mph</b> ' + WIND_SHORT[W2.cls] : '<b>–</b>');
    f.push(T ? '<b>' + fmt1(T.v) + 'ft</b> <span class="oi-tri ' + (T.rising ? 'up' : 'down') + '"></span>' : '<b>–</b>');
    f.push(M ? 'MODEL <b>' + fmt1(M.mean) + '</b>' : 'MODEL <b>–</b>');
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
          (low.wind ? '<div class="w">' + dialSVG(low.wind.dir) + Math.round(low.wind.mph) + ' ' + directionLabel(low.wind.dir) + '<span class="oi-wtag oi-wtag-' + wc + '">' + WIND_SHORT[wc] + '</span></div>' : '') + '</div>';
      } else if (s.tidesDown) {
        body += '<div class="oi-day-low"><span class="oi-cap">NO TIDE DATA</span></div>';
      } else {
        body += '<div class="oi-day-low"><span class="oi-cap">NO DAYLIGHT LOW</span></div>';
      }
      if (D.best) { var bc = clock(D.best.t); body += '<div class="oi-day-model"><span>MODEL</span>' + seg(fmt1(D.best.mean)) + '<span>@' + bc.hr + bc.ap.charAt(0) + '</span></div>'; }
      var past = D.k === 0 && D.dl.sunset && now > D.dl.sunset.getTime();
      return '<button type="button" class="oi-day' + (D.k === selOff ? ' is-sel' : '') + (P && P.cls === 'dir-out' ? ' is-out' : '') + (past ? ' is-past' : '') + '" data-k="' + D.k + '">' +
        '<div class="oi-day-h"><span>' + lbl + '</span><span class="d">' + date + '</span></div><div class="oi-day-b">' + body + '</div></button>';
    }).join('');
    host.querySelectorAll('.oi-day').forEach(function (b) { b.addEventListener('click', function () { OI.jumpDay(+b.dataset.k); }); });
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
        if (l < host.scrollLeft || r > host.scrollLeft + host.clientWidth) host.scrollLeft = Math.max(0, l - (b.dataset.k > 0 ? b.offsetWidth * 0.6 : 0));
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
      g.querySelectorAll('.oi-rate button').forEach(function (b) { b.classList.toggle('on', !untouched && +b.dataset.v <= v); });
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
    // Lit limb on the right while waxing; terminator is an ellipse arc.
    var limb = waxing ? 1 : 0, term = (k > 0.5) === waxing ? 1 : 0;
    var d = 'M12 2 A' + r + ' ' + r + ' 0 0 ' + limb + ' 12 22 A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + term + ' 12 2Z';
    return { pct: Math.round(k * 100), svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(69,255,154,.35)" stroke-width="1.2"/><path d="' + d + '" fill="#45ff9a" style="filter:drop-shadow(0 0 3px rgba(69,255,154,.6))"/></svg>' };
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
      html += '<div><div class="oi-tvday-cap">' + (out ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + '</div>' +
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
      var cap = !w.daylight ? 'NIGHT LOW · NO DAYLIGHT' : w.low < w.a - 10 * 60e3 ? 'INCOMING FROM FIRST LIGHT' : 'INCOMING FROM LOW';
      html += '<div class="' + cls + '"><div class="oi-tvday-cap"><span>' + dots(cap) + '</span><span class="r">' +
        (w.live ? '<span class="oi-nowtick">NOW</span>' : w.past ? 'DONE' : '') + '</span></div>' +
        '<div class="oi-tvwin-t' + (c1.hm.length > 4 ? ' long' : '') + '">' + seg(c1.hm) + '<span class="oi-u">' + c1.ap + '</span></div>' +
        '<div class="oi-tvwind">' + (wd ? '<span class="oi-tvdial">' + dialSVG(wd.dir) + '<span class="n">' + seg(Math.round(wd.mph)) + '<i>' + directionLabel(wd.dir) + '</i></span></span>' +
          '<div class="oi-tvwind-txt"><span class="w2">WIND MPH</span><span class="w">' + (WIND_WORD[wc] || '').replace('CROSS-SHORE', 'CROSS') + '</span></div>' : '<span class="oi-tvday-cap">NO WIND DATA</span>') + '</div>' +
        '<div class="oi-tvwin-to">' + (w.daylight ? 'UNTIL ' + seg(c2.hm) + c2.ap.charAt(0) + (w.hi && w.b >= w.hi.t - 60e3 ? ' HIGH' : ' DARK') : 'LOW AFTER DARK') + '</div></div>';
    });
    html += '</div>';
    var m = moonSVG(new Date(d0 + 12 * HOUR));
    var sr = dl.sunrise ? clock(dl.sunrise) : null, ss = dl.sunset ? clock(dl.sunset) : null, fl = dl.firstLight ? clock(dl.firstLight) : null;
    var ll = dl.lastLight ? clock(dl.lastLight) : null;
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
        (nx ? '<span class="oi-sep"></span>NEXT WINDOW&nbsp;<b>' + dow(lows[0].t) + ' ' + nx.hm + ' ' + nx.ap + '</b>' : '');
    } else {
      left = '<b>THIS WEEK AT CHOC</b><span class="oi-sep"></span>WHAT REACHES THE REEF ON THE INCOMING TIDE';
    }
    return '<span>' + left + '</span><span class="r">' + seg(c.hm, 'oi-tvclock') + '<span class="oi-u" style="font-size:1.8vmin;margin-left:.6vmin">' + c.ap + '</span></span>';
  }

  function kioskOI() {
    var body = document.body;
    body.classList.add('oi');
    Object.assign(FC_RETRO, {
      swellFill: 'rgba(69,255,154,0.30)', swellStroke: '#45ff9a', secSwellFill: pattern('dots', '69,255,154', 0.5),
      nowLine: 'rgba(220,255,235,0.55)', pulseCore: '#eafff2', pulseRing: '220,255,235',
      period: '#b9ffd9', periodHalo: 'rgba(0,0,0,0.9)', _ground: '#000000', _rgb: '69,255,154',
      windBand: 'rgba(69,255,154,0.10)', frame: 'rgba(69,255,154,0.3)', ink2: 'rgba(69,255,154,0.62)',
      nightShade: 'rgba(69,255,154,0.035)', dirSecondary: 'rgba(69,255,154,0.45)'
    });
    // Rose period ramp: phosphor intensity, short = dim, long = hot white-green. No red.
    var hot = [[2, [18, 80, 48]], [7, [30, 150, 90]], [11, [69, 255, 154]], [16, [150, 255, 200]], [22, [225, 255, 238]]];
    hot.forEach(function (st, i) { if (PERIOD_COLOR_STOPS[i]) PERIOD_COLOR_STOPS[i] = st; });

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
        if (upd) upd.after(h('span', { class: 'oi-pips', id: 'oi-pips', 'aria-hidden': 'true' }));
        var radar = el('kiosk-radar');
        if (radar) {
          radar.appendChild(h('div', { id: 'oi-sweep' }, '<div class="arm"></div>'));
          radar.appendChild(h('div', { id: 'oi-echoes' }));
        }
      } catch (e) { err('tvchrome', e); }
      return r;
    };

    // TODAY is home: never more than ~30 s away; radar is an interlude.
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
      for (var k = 0; k < 16; k++) { i = (i + 1) % n; if (lightAt(c.times[i].getTime()) !== 'night') break; }
      KIOSK_RADAR.idx = i; STATE.scrubberIdx = i; applyScrubberToHour(i);
    };
    // No rAF loop: the sweep is a compositor layer (audit M1).
    window.kioskRadarLoop = function () { KIOSK_RADAR.raf = null; };
    var prevStart = kioskRadarStart;
    window.kioskRadarStart = function () { restartSweep(); return prevStart.apply(this, arguments); };

    // Panel change: phosphor decay → switch → warm-up. Opacity only.
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
    };
    ['kioskPause', 'kioskResume', 'kioskResumeInPlace'].forEach(function (n) {
      var prev = window[n];
      window[n] = function () { var r = prev.apply(this, arguments); body.classList.toggle('oi-paused', KIOSK.state === 'paused'); return r; };
    });
    window.kioskRadarPaint = oiRadarPaint;
    setInterval(guard('tvminute', function () {
      var p = body.dataset.kioskPanel;
      if (p === 'days1' || p === 'days2') kioskRenderDays();
      body.classList.toggle('oi-calm', lightAt(Date.now()) === 'night');
    }), 60e3);
    body.classList.toggle('oi-calm', lightAt(Date.now()) === 'night');
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
  function oiRadarPaint() {
    var cv = el('kiosk-radar-canvas');
    if (!cv || !cv.clientWidth) return;
    var ctx = cv.getContext('2d');
    var dims = ensureCanvasCssDims(cv, ctx), w = dims.cssW, hgt = dims.cssH;
    if (!w || !hgt) return;
    var G = function (a) { return 'rgba(69,255,154,' + a + ')'; };
    var CROP = 0.15, fh = hgt / (1 - CROP), fw = fh * KIOSK_COAST.aspect, fx = (w - fw) / 2, fy = -CROP * fh;
    var lx = fx + KIOSK_COAST.lineup[0] * fw, ly = fy + KIOSK_COAST.lineup[1] * fh, rMax = hgt * 0.62;
    var px = function (p) { return [fx + p[0] * fw, fy + p[1] * fh]; };
    var trace = function (pts) { var a = px(pts[0]); ctx.moveTo(a[0], a[1]); for (var i = 1; i < pts.length; i++) { var b = px(pts[i]); ctx.lineTo(b[0], b[1]); } };
    var shore = KIOSK_COAST.shore, shoreEndY = fy + shore[shore.length - 1][1] * fh;
    var c = cs(), i = KIOSK_RADAR.idx;
    var d = c && i >= 0 && i < c.times.length ? hourData(i) : null;
    var t = d ? d.t : Date.now(), scene = lightAt(t);
    var lit = scene === 'day' ? 1 : scene === 'dusk' ? 0.75 : 0.5;   // light the world, not the data

    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hgt);
    ctx.beginPath(); trace(shore); ctx.lineTo(w, shoreEndY); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.lineTo(0, hgt); ctx.closePath();
    var land = ctx.createLinearGradient(0, 0, 0, hgt);
    land.addColorStop(0, G(0.11 * lit)); land.addColorStop(1, G(0.04 * lit));
    ctx.fillStyle = land; ctx.fill();
    ctx.strokeStyle = G(0.12 * lit + 0.03); ctx.lineWidth = 1;
    for (var k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(lx, ly, rMax * k / 3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(lx - rMax, ly); ctx.lineTo(lx + rMax, ly); ctx.moveTo(lx, ly - rMax); ctx.lineTo(lx, ly + rMax);
    ctx.strokeStyle = G(0.06); ctx.stroke();

    // The window cone glows with the in-window energy this hour.
    var e = 0;
    if (d && d.lead) [d.lead, d.other].forEach(function (s) { if (s && s.h != null) e += _alignmentScore(s.d) * s.h * s.h; });
    var c1 = CH.swellWindowMin * Math.PI / 180 - Math.PI / 2, c2 = CH.swellWindowMax * Math.PI / 180 - Math.PI / 2;
    var cone = ctx.createRadialGradient(lx, ly, 0, lx, ly, rMax * 0.92);
    var ca = Math.min(0.2, 0.04 + e * 0.035);
    cone.addColorStop(0, G(ca * 1.6)); cone.addColorStop(1, G(ca * 0.4));
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, rMax * 0.92, c1, c2); ctx.closePath();
    ctx.fillStyle = cone; ctx.fill();
    ctx.strokeStyle = G(0.35); ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
    var edge = function (deg, r) { var th = deg * Math.PI / 180; return [lx + r * Math.sin(th), ly - r * Math.cos(th)]; };
    ctx.font = '600 14px "OI Sans", "Orbitron", sans-serif';
    ctx.fillStyle = G(0.7);
    var m = edge(CH.swellWindowMax, rMax * 0.92 + 10);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('MONTAUK PT ' + CH.swellWindowMax + '°', m[0], Math.min(m[1], hgt - 20));
    var b = edge(CH.swellWindowMin, rMax * 0.92 + 10);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('SOUTHWEST PT (BLOCK) ' + CH.swellWindowMin + '°', b[0] + 4, b[1]);

    // Coastline, lit once per paint (shadowBlur is free at 1 Hz).
    ctx.save();
    ctx.shadowColor = G(0.8); ctx.shadowBlur = 10;
    ctx.beginPath(); trace(shore); ctx.lineTo(w, shoreEndY);
    ctx.strokeStyle = G(0.6 + 0.35 * lit); ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
    KIOSK_COAST.ponds.forEach(function (pond) {
      ctx.beginPath(); trace(pond); ctx.closePath(); ctx.fillStyle = '#000'; ctx.fill(); ctx.strokeStyle = G(0.35); ctx.lineWidth = 1; ctx.stroke();
    });

    var echoes = [];
    var arrow = function (fromDeg, len, o) {
      var th = fromDeg * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th);
      var gap = 30, hx = lx + ux * gap, hy = ly + uy * gap, tx = lx + ux * (gap + len), ty = ly + uy * (gap + len);
      var headLen = 12 + o.width * 2.4, headW = 6 + o.width * 1.7, bx = hx + ux * headLen, by = hy + uy * headLen;
      ctx.save();
      if (o.glow) { ctx.shadowColor = G(0.85); ctx.shadowBlur = 14; }
      ctx.strokeStyle = o.color; ctx.fillStyle = o.color; ctx.lineWidth = o.width; ctx.lineCap = 'round';
      ctx.setLineDash(o.dashed ? [10, 8] : []);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(bx - uy * headW, by + ux * headW); ctx.lineTo(bx + uy * headW, by - ux * headW); ctx.closePath();
      if (o.hollow) { ctx.lineWidth = 2; ctx.stroke(); } else ctx.fill();
      ctx.restore();
      if (o.label) {
        var off = 22 + (o.push || 0), lxp = tx + ux * off, lyp = ty + uy * off - 18 * Math.abs(ux);
        ctx.font = '700 ' + (o.size || 18) + 'px "OI Sans", "Orbitron", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var tw = ctx.measureText(o.label).width;
        lxp = Math.max(12 + tw / 2, Math.min(w - 12 - tw / 2, lxp)); lyp = Math.max(16, Math.min(hgt - 26, lyp));
        ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(o.label, lxp, lyp);
        ctx.fillStyle = o.color; ctx.fillText(o.label, lxp, lyp);
        if (o.sub) { ctx.font = '700 11px "OI Sans", "Orbitron", sans-serif'; ctx.strokeText(o.sub, lxp, lyp + 17); ctx.fillStyle = o.color; ctx.fillText(o.sub, lxp, lyp + 17); }
      }
      echoes.push({ deg: fromDeg, x: lx + ux * (gap + len * 0.6), y: ly + uy * (gap + len * 0.6), big: !!o.glow });
    };
    var clampLen = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
    if (d) {
      var sl = function (s) { return ftStr(s.h) + 'ft @ ' + (s.p != null ? Math.round(s.p) : '–') + 's'; };
      var draw = function (s, primary) {
        var out = s.cls === 'dir-out';
        arrow(s.d, clampLen(Math.sqrt(s.h * s.h * (s.p || 1)) * 16, primary ? 90 : 70, rMax * 0.88), {
          color: out ? G(0.45) : primary ? '#45ff9a' : G(0.8), width: primary ? 6 : 3.5, dashed: out, hollow: out, glow: !out && primary,
          label: sl(s), sub: out ? 'BLOCKED' : s.cls === 'dir-edge' ? 'EDGE' : 'IN WINDOW', size: primary ? 20 : 15, push: primary ? 0 : 14
        });
      };
      if (d.other) draw(d.other, false);
      if (d.lead) draw(d.lead, true);
      if (d.wind && d.wind.dir != null) {
        arrow(d.wind.dir, clampLen((d.wind.mph || 0) * 8, 62, rMax * 0.8), { color: G(0.85), width: 3, dashed: true, label: Math.round(d.wind.mph) + 'mph', sub: WIND_WORD[d.wind.cls] || '', size: 16 });
      }

      // Forecast position, top right: day + hour, offset, and the one
      // number you need from across the room.
      var ck = clock(t), dh = Math.round((t - Date.now()) / HOUR), R0 = w - 24;
      ctx.save();
      var bg = ctx.createLinearGradient(w - 360, 0, w, 0);
      bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(0.22, 'rgba(0,0,0,0.9)'); bg.addColorStop(1, 'rgba(0,0,0,0.94)');
      ctx.fillStyle = bg; ctx.fillRect(w - 360, 0, 360, 236);
      ctx.restore();
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 15px "OI Sans", "Orbitron", sans-serif'; ctx.fillStyle = G(0.7);
      ctx.fillText(new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() + (scene === 'night' ? '  ·  NIGHT' : ''), R0, 34);
      var segText = function (txt, size, x, y, color) {
        ctx.font = size + 'px "DSEG14", "OI Seg", monospace';
        ctx.fillStyle = G(0.07); ctx.fillText(txt.replace(/[0-9A-Za-z\-]/g, '~'), x, y);
        ctx.save(); ctx.shadowColor = G(0.75); ctx.shadowBlur = size * 0.18; ctx.fillStyle = color; ctx.fillText(txt, x, y); ctx.restore();
      };
      ctx.font = '700 16px "OI Sans", "Orbitron", sans-serif';
      var apW = ctx.measureText(ck.ap).width;
      ctx.fillStyle = G(0.8); ctx.fillText(ck.ap, R0, 82);
      segText(ck.hm, 40, R0 - apW - 8, 82, '#45ff9a');
      ctx.font = '800 14px "OI Sans", "Orbitron", sans-serif';
      if (Math.abs(dh) < 1) { ctx.fillStyle = '#eafff2'; ctx.fillText('NOW', R0, 108); }
      else { ctx.fillStyle = G(dh > 0 ? 0.75 : 0.45); ctx.fillText((dh > 0 ? '+' : '-') + Math.abs(dh) + ' H FROM NOW', R0, 108); }
      if (d.lead) {
        var L = d.lead, out2 = L.cls === 'dir-out';
        ctx.font = '700 13px "OI Sans", "Orbitron", sans-serif'; ctx.fillStyle = G(0.65);
        ctx.fillText(out2 ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF', R0, 146);
        ctx.font = '700 18px "OI Sans", "Orbitron", sans-serif';
        var sW = ctx.measureText('s').width;
        ctx.fillStyle = G(0.85); ctx.fillText('s', R0, 214);
        segText(String(L.p != null ? Math.round(L.p) : '–'), 34, R0 - sW - 4, 214, out2 ? G(0.6) : '#45ff9a');
        ctx.font = '34px "DSEG14", monospace';
        var pW = ctx.measureText(String(L.p != null ? Math.round(L.p) : '–')).width;
        ctx.font = '600 18px "OI Sans", "Orbitron", sans-serif'; ctx.fillStyle = G(0.7);
        var atX = R0 - sW - 4 - pW - 10; ctx.fillText('ft @', atX, 214);
        var ftW = ctx.measureText('ft @').width;
        segText(ftStr(L.h), 72, atX - ftW - 8, 214, out2 ? G(0.6) : '#45ff9a');
      }
    } else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 18px "OI Sans", "Orbitron", sans-serif'; ctx.fillStyle = G(0.5);
      ctx.fillText('AWAITING FORECAST DATA', w / 2, hgt / 2 + rMax / 2);
    }
    ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.fillStyle = '#45ff9a'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 12, 0, Math.PI * 2); ctx.strokeStyle = G(0.5); ctx.lineWidth = 1.5; ctx.stroke();

    // Sweep + echoes: DOM layers on the compositor, synced to one epoch.
    var sw = el('oi-sweep');
    if (sw) { sw.style.left = lx + 'px'; sw.style.top = ly + 'px'; sw.style.setProperty('--r', rMax + 'px'); }
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
  // Install
  // ════════════════════════════════════════════════════════════════════
  function installShared() {
    FC_CHART_FONT = '"OI Sans", "Orbitron", sans-serif';
    window.drawSwellPanel = oiDrawSwellPanel;
    window.renderDayLabels = oiRenderDayLabels;
    window.startNowPulse = function () { placeNowDot(); };
    window.stopNowPulse = function () { var d = el('oi-nowdot'); if (d) d.style.display = 'none'; };
    wrapPanel('drawWindPanel', 'forecast-canvas-wind', windExtras);
    wrapPanel('drawTidePanel', 'forecast-canvas-tide', tideExtras);
    var prevApply = applyScrubberToHour;
    window.applyScrubberToHour = function (idx) { prevApply(idx); onHour(idx); };
    var prevDraw = drawForecastChart;
    window.drawForecastChart = function () { var r = prevDraw.apply(this, arguments); afterChart(); return r; };
    setInterval(guard('minute', function () { placeNowDot(); syncLed(); applyLight(); }), 60e3);
  }

  function installWeb() {
    window.drawLineupMap = oiDrawLineupMap;
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
    }
    OI.ready = true;
  } catch (e) {
    err('install', e);
    OI.ready = true;
  }
})();
