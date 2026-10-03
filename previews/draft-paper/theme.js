// ════════════════════════════════════════════════════════════════════
// DRAFT 1 · PAPER — LetsCheckChoc skin, behaviour half (classic script)
// ────────────────────────────────────────────────────────────────────
// One Instrument's layout and behaviour, re-coloured and re-typed with
// Chart Room's chart paper, with one shared colour code. Loads after
// kiosk.js (index.html ?preview=draft-paper). Everything app.js /
// kiosk.js declares is a writable global (function declarations) or a
// mutable palette object (FC_RETRO / ROSE_THEME / PERIOD_COLOR_STOPS),
// so the skin works by:
//   • light: body[data-pp-light] = day | dusk | night. Day until SUNSET
//     AT CHOC (calcDaylight), navy chart from sunset, one step deeper
//     after last light; SET › DISPLAY LIGHT overrides (SUN / SYSTEM /
//     DAY / NIGHT). Canvas palettes are read from the CSS tokens, so no
//     chart colour lives in this file.
//   • DOM: the chart-table frame, four soft keys, an answer-first
//     Forecast page (readout → this week → hour dial → chart page →
//     graph page → more), Sources & settings + the colour key under SET.
//   • replacements for drawSwellPanel / drawWindPanel / drawTidePanel /
//     drawLineupMap / renderDayLabels / the now-pulse, and wrappers on
//     applyScrubberToHour / drawForecastChart / renderSurfLogTable.
// Choc TV gets the navy plotter in kioskPaper() below.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var PP = window.PP = { ready: false, errors: [], light: null };
  function err(where, e) {
    var m = where + ': ' + (e && e.message ? e.message : e);
    PP.errors.push(m);
    if (window.console) console.warn('[PP]', m, e && e.stack);
  }
  function guard(where, fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { err(where, e); }
    };
  }

  var KIOSK_ON = typeof isKioskMode === 'function' && isKioskMode();
  var CH = CONFIG.chocomount;
  var HOUR = 3600e3;
  var DATA_FONT = '"Paper Data", "Barlow Semi Condensed", "Arial Narrow", sans-serif';
  var CHART_FONT = '"Paper Chart", "Source Serif 4", Georgia, serif';

  // ── Small helpers ──────────────────────────────────────────────────
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return typeof escHtml === 'function' ? escHtml(s) : String(s); }
  // Every number is set in Barlow Semi Condensed, tabular. ("!" is a
  // blank cell in One Instrument's segment grammar: it prints as a dash.)
  function seg(text, cls) {
    var t = String(text);
    if (/^!+$/.test(t)) t = '—';
    t = t.replace(/!/g, ' ').replace(/(\d)-(\d)/g, '$1–$2');
    return '<span class="pp-seg ' + (cls || '') + '">' + esc(t) + '</span>';
  }
  function dots(str) { return String(str).split(' · ').join('<span class="pp-sep"></span>'); }
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

  // Light at an instant, from the app's own NOAA sun. The owner's rule:
  // the phone turns to the navy chart AT SUNSET AT CHOC (and back at
  // sunrise). "night" is the same navy one step deeper after last light.
  function lightAt(ms) {
    var dl = sun(ms);
    if (dl.alwaysDay) return 'day';
    if (dl.alwaysNight || !dl.sunrise) return 'night';
    var rise = dl.sunrise.getTime(), set = dl.sunset.getTime();
    if (ms >= rise && ms < set) return 'day';
    if (dl.firstLight && dl.lastLight && ms >= dl.firstLight.getTime() && ms < dl.lastLight.getTime()) return 'dusk';
    return 'night';
  }
  function sceneAt(ms) { var l = lightAt(ms); return l === 'dusk' ? 'twilight' : l; }
  function isDark(ms) { return lightAt(ms) !== 'day'; }

  function windClass(mph, dir) {
    if (dir == null) return null;
    var OFF = 335;
    var gap = Math.min(((dir - OFF) % 360 + 360) % 360, ((OFF - dir) % 360 + 360) % 360);
    var b = gap < 60 ? 'off' : gap < 120 ? 'cross' : 'on';
    if (mph != null && mph < 5) b = b === 'cross' ? 'off' : b === 'on' ? 'cross' : b;
    return b;
  }
  // Words, never "ON"/"OFF" (the judges read those as switch states).
  var WIND_WORD = { off: 'OFFSHORE', cross: 'CROSS-SHORE', on: 'ONSHORE' };
  var WIND_SHORT = { off: 'OFFSHORE', cross: 'CROSS', on: 'ONSHORE' };
  function windWord(cls, short) {
    if (!cls) return '';
    return '<span class="pp-ww pp-ww-' + cls + '">' + (short ? WIND_SHORT[cls] : WIND_WORD[cls]) + '</span>';
  }
  var TAG = { 'dir-in': ['pp-tag-in', 'IN WINDOW', 'IN'], 'dir-edge': ['pp-tag-edge', 'EDGE', 'EDGE'], 'dir-out': ['pp-tag-out', 'OUT OF WINDOW', 'OUT'] };
  function tagHTML(cls, short) {
    var t = TAG[cls]; if (!t) return '';
    return '<span class="pp-tag ' + t[0] + '">' + (short ? t[2] : t[1]) + '</span>';
  }
  var KEYW = { 'dir-in': ['k-in', 'IN'], 'dir-edge': ['k-edge', 'EDGE'], 'dir-out': ['k-out', 'OUT'] };

  // The big filled arrow from Choc TV, reading printed on it. Rotated to
  // the TRAVEL direction about the centre of the largest circle that fits
  // inside the arrow, so the upright FROM label always sits inside the
  // ink at any bearing (r = 29 of the 112-unit box; the tail may overhang).
  function arrowHTML(fromDeg, cls, label, sub) {
    if (fromDeg == null) return '';
    var travel = Math.round((fromDeg + 180) % 360);
    return '<span class="pp-arrow ' + (cls || '') + '">' +
      '<svg viewBox="-56 -56 112 112" style="transform:rotate(' + travel + 'deg)" aria-hidden="true">' +
      '<path d="M0 -44 L50 12 L27 12 L27 62 L-27 62 L-27 12 L-50 12 Z"/></svg>' +
      (label ? '<span class="pp-ao"><b>' + label + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</span>' : '') +
      '</span>';
  }
  function arrowCls(cls) { return cls === 'dir-out' ? 'is-out' : cls === 'dir-edge' ? 'is-edge' : ''; }
  // Wind heading dial (owner pick): ring + rim pointer at the travel
  // bearing. The ring carries the wind code: solid green, dashed amber,
  // dotted coral (pattern doubles the hue).
  function dialSVG(fromDeg, wcls) {
    var ticks = '';
    for (var a = 0; a < 360; a += 30) ticks += '<line class="tick" transform="rotate(' + a + ' 50 50)" x1="50" y1="7" x2="50" y2="14"/>';
    var ptr = fromDeg == null ? '' :
      '<path class="ptr" transform="rotate(' + Math.round((fromDeg + 180) % 360) + ' 50 50)" d="M50 0 L63 22 L37 22 Z"/>';
    return '<svg class="pp-dial' + (wcls ? ' is-' + wcls : '') + '" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="41"/>' + ticks + ptr + '</svg>';
  }

  // Your model: five stepped violet bins, always with the number.
  function hexRgb(c) {
    var m = String(c).trim().match(/^#([0-9a-f]{6})$/i);
    if (m) { var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    var r = String(c).match(/[\d.]+/g);
    return r ? r.slice(0, 3).map(Number) : [0, 0, 0];
  }
  function relLum(rgb) {
    var f = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  // A linear ramp made 3.4 and 4.4 look the same (ΔE 3), and real days
  // score 3–5. Five stepped bins over the range scores actually reach,
  // each ≥ 10 L* from the next: < 3 · 3–4 · 4–5 · 5–6 · 6+. Light bins
  // carry dark figures, deep bins white ones; every figure clears 4.5:1
  // and 3:1 under the glare model. Binned on the printed (0.1) value so a
  // chip never disagrees with its own number. The navy chart runs the same
  // bins dim → bright.
  var RAMP_EDGES = [3, 4, 5, 6];
  var RAMP_FALLBACK = [['#E9E5F9', '#1B1440'], ['#C9C0F1', '#1B1440'], ['#6A58C2', '#FFFFFF'], ['#4A3A9F', '#FFFFFF'], ['#2A1D6E', '#FFFFFF']];
  function rampBin(v) {
    var x = Math.round(Math.max(0, Math.min(10, v || 0)) * 10) / 10, b = 0;
    for (var i = 0; i < RAMP_EDGES.length; i++) if (x >= RAMP_EDGES[i]) b = i + 1;
    return b;
  }
  function ramp(v) {
    var b = rampBin(v);
    var bg = C['ramp' + b] || RAMP_FALLBACK[b][0], fg = C['ramp' + b + 'fg'] || RAMP_FALLBACK[b][1];
    return { bg: bg, fg: fg, light: relLum(hexRgb(fg)) < 0.2, bin: b, quiet: relLum(hexRgb(bg)) > 0.4 || relLum(hexRgb(bg)) < 0.04 };
  }
  PP.rampOf = function (v) { return 'rgb(' + hexRgb(ramp(v).bg).join(',') + ')'; };
  function scoreHTML(v, big) {
    if (v == null || !isFinite(v)) return '<span class="pp-score" style="box-shadow:inset 0 0 0 1px var(--pp-rule-2)">' + seg('—') + '</span>';
    var r = ramp(v);
    // The palest (and on navy the dimmest) bins get the ramp's edge line so
    // the chip still reads as a chip against the sheet.
    return '<span class="pp-score pp-bin' + r.bin + '" style="background:' + r.bg + ';color:' + r.fg + (r.quiet ? ';box-shadow:inset 0 0 0 1px var(--pp-ramp-edge)' : '') + '">' +
      seg(fmt1(v), big ? 'pp-b' : '') + (big ? '<span class="pp-u">/10</span>' : '') + '</span>';
  }
  function meter(v) {
    var n = v == null ? 0 : Math.max(0, Math.min(10, Math.round(v))), s = '';
    var r = ramp(v);
    for (var i = 0; i < 10; i++) s += '<i' + (i < n ? ' class="on" style="background:' + r.bg + '"' : '') + '></i>';
    return '<span class="pp-meter">' + s + '</span>';
  }
  var ICON_SUN = '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="2.6"/><g stroke="currentColor" stroke-width="1.3"><path d="M6 0.5v1.8M6 9.7v1.8M0.5 6h1.8M9.7 6h1.8M2.1 2.1l1.3 1.3M8.6 8.6l1.3 1.3M2.1 9.9l1.3-1.3M8.6 3.4l1.3-1.3"/></g></svg>';
  var ICON_MOON = '<svg viewBox="0 0 12 12"><path d="M7.2 0.8A5.4 5.4 0 1 0 11.4 8.6 4.5 4.5 0 0 1 7.2 0.8Z"/></svg>';
  var ICON_N = '<svg viewBox="0 0 12 12"><path d="M6 0.5 9.5 11 6 8.6 2.5 11Z"/></svg>';
  var CHEV_L = '<svg viewBox="0 0 16 12"><path d="M10 0 4 6l6 6z"/></svg>';
  var CHEV_R = '<svg viewBox="0 0 16 12"><path d="M6 0l6 6-6 6z"/></svg>';
  var CHEV_LL = '<svg viewBox="0 0 16 12"><path d="M8 0 2 6l6 6zM15 0 9 6l6 6z"/></svg>';
  var CHEV_RR = '<svg viewBox="0 0 16 12"><path d="M1 0l6 6-6 6zM8 0l6 6-6 6z"/></svg>';
  function darkTag(txt, icon) { return '<span class="pp-dark">' + (icon || ICON_MOON) + (txt || 'AFTER DARK') + '</span>'; }
  // The light tag for an instant: TWILIGHT until last light (with its
  // time), then AFTER DARK. Never the rounded forecast slot's light.
  function lightTag(ms) {
    var l = lightAt(ms);
    if (l === 'day') return '';
    if (l === 'dusk') { var dl = sun(ms), ll = dl.lastLight ? clock(dl.lastLight) : null; return darkTag('TWILIGHT' + (ll ? ' · LAST LIGHT ' + ll.hm + ' ' + ll.ap : ''), ICON_SUN); }
    return darkTag('AFTER DARK');
  }

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
      // NOW is the real minute: its light comes from the clock, not from the
      // forecast slot it rounds to (18:40 is twilight, not the 7 PM slot).
      tide: tide, next: next, model: modelAt(idx), scene: sceneAt(idx === nowIdx() ? Date.now() : t)
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Palettes: the CSS tokens are the one source of truth. Canvases read
  // them once per light change, never per frame.
  // ════════════════════════════════════════════════════════════════════
  var C = {};
  var TOK = {
    sheet: 'sheet', sheet2: 'sheet-2', ink: 'ink', ink2: 'ink-2', ink3: 'ink-3', rule: 'rule', rule2: 'rule-2', halo: 'halo',
    mag: 'mag', magTint: 'mag-tint', amber: 'amber', amberInk: 'amber-ink', amberLine: 'amber-line', grey: 'grey', greyInk: 'grey-ink',
    reef: 'reef', reef2: 'reef-2', reefInk: 'reef-ink', tide: 'tide', shoal: 'shoal', shoal2: 'shoal-2',
    off: 'off', offInk: 'off-ink', offTint: 'off-tint', cross: 'cross', on: 'on', onInk: 'on-ink',
    rampLo: 'ramp-lo', rampHi: 'ramp-hi', ramp0: 'ramp-0', ramp0fg: 'ramp-0-fg', ramp1: 'ramp-1', ramp1fg: 'ramp-1-fg', ramp2: 'ramp-2', ramp2fg: 'ramp-2-fg',
    ramp3: 'ramp-3', ramp3fg: 'ramp-3-fg', ramp4: 'ramp-4', ramp4fg: 'ramp-4-fg', past: 'past', reefPast: 'reef-past',
    night: 'night', fresh: 'fresh', stale: 'stale', dead: 'dead'
  };
  function rgba(c, a) { var v = hexRgb(c); return 'rgba(' + v.join(',') + ',' + a + ')'; }
  var patCache = {};
  // Chart patterns, in CSS px: hatch = one diagonal, cross = both.
  function hatch(ctx, color, kind, alpha) {
    var d = window.devicePixelRatio || 1;
    var key = color + kind + alpha + d;
    if (patCache[key]) return patCache[key];
    var s = Math.round(5 * d);
    var cv = document.createElement('canvas'); cv.width = cv.height = s;
    var g = cv.getContext('2d');
    g.strokeStyle = color; g.globalAlpha = alpha == null ? 1 : alpha; g.lineWidth = Math.max(1, d * 1.1);
    g.beginPath();
    if (kind === 'diag' || kind === 'cross') { g.moveTo(-1, s + 1); g.lineTo(s + 1, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1); }
    if (kind === 'cross') { g.moveTo(-1, -1); g.lineTo(s + 1, s + 1); g.moveTo(s - 1, -1); g.lineTo(s + 1, 1); g.moveTo(-1, s - 1); g.lineTo(1, s + 1); }
    g.stroke();
    var p = ctx.createPattern(cv, 'repeat');
    if (p && p.setTransform && typeof DOMMatrix === 'function') p.setTransform(new DOMMatrix().scale(1 / d));
    patCache[key] = p;
    return p;
  }
  function readTokens() {
    var csd = getComputedStyle(document.body);
    for (var k in TOK) { var v = csd.getPropertyValue('--pp-' + TOK[k]).trim(); if (v) C[k] = v; }
    patCache = {};
    Object.assign(FC_RETRO, {
      plotBg: C.sheet, grid: C.rule, ink: C.ink, ink2: C.ink2, frame: C.rule2,
      swellFill: C.reef, swellStroke: C.reefInk, secSwellFill: rgba(C.grey, 0.3), period: C.ink, periodHalo: C.halo,
      dirPrimary: C.reefInk, dirSecondary: C.ink3,
      windOn: C.on, windCross: C.cross, windOff: C.off, windNull: C.rule, windStroke: C.ink, windBand: C.magTint,
      tide: C.tide, tideMarkFaint: C.ink3, tideMark: C.ink, tideConn: C.ink3,
      scrubDot: C.ink, nowLine: C.ink, daySep: C.rule, nightShade: C.night, pastDim: 'rgba(0,0,0,0)',
      obsFill: C.sheet, obsStroke: C.ink, pulseCore: C.ink, pulseRing: hexRgb(C.ink).join(','),
      _ground: C.sheet
    });
    Object.assign(ROSE_THEME, { bg: 'rgba(0,0,0,0)', ring: C.rule2, cardinal: C.ink, window: C.mag, hs: C.ink, hsSub: C.ink2 });
    // Period ramp on the rose: one blue, pale (chop) → deep (groundswell).
    var lo = hexRgb(C.shoal2), hi = hexRgb(C.reefInk);
    var stops = [2, 7, 11, 16, 22].map(function (p, i) { var t = i / 4; return [p, lo.map(function (v, j) { return Math.round(v + (hi[j] - v) * t); })]; });
    PERIOD_COLOR_STOPS.splice.apply(PERIOD_COLOR_STOPS, [0, PERIOD_COLOR_STOPS.length].concat(stops));
  }

  function chooseLight() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('ppLight'); } catch (_) { /* old browser */ }
    if (q === 'day' || q === 'dusk' || q === 'night') return q;
    var pref = 'auto';
    try { pref = localStorage.getItem('lcc-paper-light') || 'auto'; } catch (_) { /* private mode */ }
    if (pref === 'day' || pref === 'night') return pref;
    if (pref === 'system') return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
    return lightAt(Date.now());
  }

  function redrawCharts() {
    var f = fd();
    if (f && f.marine && !KIOSK_ON) {
      ['forecast-canvas-swell', 'forecast-canvas-wind', 'forecast-canvas-tide'].forEach(function (id) { invalidateCanvasDPR(el(id)); });
      drawForecastChart(f.marine, f.wind, f.daylight, f.tideHiLo, f.tidePred, f.buoyParsed);
    }
    if (STATE.lastSpectral) { try { drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed); } catch (_) { /* rose optional */ } }
    if (STATE._cachedTidePred && !KIOSK_ON) { try { drawTideChart(STATE._cachedTidePred); } catch (_) { /* tides optional */ } }
  }

  // TV: the navy plotter by day, deeper at night (never red, never dimmed
  // readings). Phone: paper by day, navy from sunset.
  var applyLight = guard('applyLight', function (force) {
    var mode = KIOSK_ON ? (lightAt(Date.now()) === 'night' ? 'night' : 'dusk') : chooseLight();
    if (mode === PP.light && !force) return;
    var first = PP.light == null;
    PP.light = mode;
    document.body.setAttribute('data-pp-light', mode);
    readTokens();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'day' ? '#ECE5D3' : '#050A10');
    if (!first) {
      redrawCharts();
      if (KIOSK_ON && typeof kioskRenderDays === 'function') { kioskRenderDays(); if (document.body.dataset.kioskPanel === 'radar') kioskRadarPaint(); }
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Chart drawers (replacements, same signatures and returns)
  // ════════════════════════════════════════════════════════════════════
  function clearCanvas(id) {
    var c = el(id); if (!c) return;
    var x = c.getContext('2d');
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.restore();
  }
  // The past is marked by a wash BEHIND the data (and the word PAST when
  // there is room), never by a see-through veil over it: a veil took the
  // past reef fill and wind hatches down to 1.7–2.1:1.
  function pastX(common, plotLeft, plotW) {
    var now = Date.now();
    if (now <= common.t0) return null;
    return Math.min(_fcXFor(new Date(now), common, plotLeft, plotW), plotLeft + plotW);
  }
  function pastWash(ctx, common, plotLeft, plotW, top, hgt) {
    var nx = pastX(common, plotLeft, plotW);
    if (nx == null || nx <= plotLeft + 1) return;
    ctx.save(); ctx.fillStyle = C.past || C.sheet2; ctx.fillRect(plotLeft, top, nx - plotLeft, hgt); ctx.restore();
  }
  function pastLabel(ctx, common, plotLeft, plotW, top) {
    var nx = pastX(common, plotLeft, plotW);
    if (nx == null) return;
    ctx.save(); ctx.font = '700 ' + fsz(10); ctx.textBaseline = 'top'; ctx.textAlign = 'right';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1px';
    var w = ctx.measureText('PAST').width + 10;
    if (nx - plotLeft > w) { ctx.fillStyle = C.ink2; ctx.fillText('PAST', nx - 5, top + 4); }
    ctx.restore();
  }
  function hGrid(ctx, x0, x1, y) {
    ctx.save(); ctx.strokeStyle = C.rule2; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
    ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); ctx.restore();
  }
  function frame(ctx, x, y, w, hh) {
    ctx.save(); ctx.strokeStyle = C.rule2; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(hh) - 1); ctx.restore();
  }
  function nowTick(ctx, common, plotLeft, plotW, top, bottom, mark) {
    var now = Date.now();
    if (now < common.t0 || now > common.tEnd) return null;
    var x = _fcXFor(new Date(now), common, plotLeft, plotW);
    ctx.save();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.25; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
    if (mark) { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(x, top + 7); ctx.lineTo(x + 4.5, top + 2); ctx.lineTo(x, top - 3); ctx.lineTo(x - 4.5, top + 2); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    return x;
  }
  function scrubDot(ctx, x, y) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = C.sheet; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.restore();
  }
  function fsz(px) { return (KIOSK_ON ? Math.round(px * 1.3) : px) + 'px ' + DATA_FONT; }
  // Night bands: true night solid, twilight as a ramp (light on the world).
  function nightBands(ctx, common, plotLeft, plotW, top, height) {
    var X = function (t) { return _fcXFor(new Date(t), common, plotLeft, plotW); };
    var R = plotLeft + plotW;
    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, height); ctx.clip();
    for (var k = -1; k <= common.dayCount; k++) {
      var day = new Date(common.firstDay); day.setDate(day.getDate() + k);
      var nx = new Date(day); nx.setDate(nx.getDate() + 1);
      var dl = calcDaylight(CH.lat, CH.lon, day), dl2 = calcDaylight(CH.lat, CH.lon, nx);
      if (!dl || !dl.sunset || !dl2 || !dl2.sunrise) continue;
      var a = X(dl.lastLight), b = X(dl2.firstLight);
      if (!(b < plotLeft || a > R)) { ctx.fillStyle = C.night; ctx.fillRect(a, top, b - a, height); }
      var rampF = function (x0, x1, rev) {
        if (x1 < plotLeft || x0 > R) return;
        var g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(rev ? 1 : 0, 'rgba(0,0,0,0)'); g.addColorStop(rev ? 0 : 1, C.night);
        ctx.fillStyle = g; ctx.fillRect(x0, top, x1 - x0, height);
      };
      rampF(X(dl.sunset), X(dl.lastLight), false);
      rampF(X(dl2.firstLight), X(dl2.sunrise), true);
    }
    ctx.restore();
  }
  function daySeps(ctx, common, plotLeft, plotW, top, height) {
    ctx.save(); ctx.strokeStyle = C.rule2; ctx.lineWidth = 1;
    for (var k = 0; k <= common.dayCount; k++) {
      var d = new Date(common.firstDay); d.setDate(d.getDate() + k);
      var x = _fcXFor(d, common, plotLeft, plotW);
      if (x > plotLeft && x < plotLeft + plotW) { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, top + height); ctx.stroke(); }
    }
    ctx.restore();
  }
  function axisMax(peak) {
    var nice = [2, 3, 4, 6, 8, 12, 16, 20, 24, 32];
    for (var i = 0; i < nice.length; i++) if (nice[i] >= peak * 1.08) return nice[i];
    return Math.ceil(peak * 1.1);
  }

  // "Plot what reaches the reef": solid sounding blue = window-weighted
  // energy (√Σ alignment·H², the rule kioskDaySummary uses), grey hatched
  // ghost behind it = everything offshore including what Montauk / Block
  // Island blocks. Period follows the lead train, dashed when it's out.
  function ppDrawSwellPanel(common, data) {
    var canvas = el('forecast-canvas-swell');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var dims = ensureCanvasCssDims(canvas, ctx), cssW = dims.cssW, cssH = dims.cssH;
    ctx.clearRect(0, 0, cssW, cssH);
    var plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    var top = 6, usableH = cssH - 10;
    var hgt = Math.round(usableH * (KIOSK_ON ? 0.72 : 0.7));
    var subTop = top + hgt + 8, subBot = cssH - 2;
    var mh = (fd() && fd().marine && fd().marine.hourly) || {};
    var secPer = mh.secondary_swell_wave_period || [];
    var H1 = data.heights, H2 = data.secHeights, D1 = data.swellDirs, D2 = data.secDirs, PER = data.wavePeriods;
    var n = common.lastIdx, reef = [], total = [], per = [], perIn = [], leadDir = [], peak = 0;
    for (var i = 0; i <= n; i++) {
      var h1 = H1[i], h2 = H2[i];
      if (h1 == null && h2 == null) { reef[i] = total[i] = per[i] = leadDir[i] = null; continue; }
      var a1 = _alignmentScore(D1[i]), a2 = _alignmentScore(D2[i]);
      var e1 = h1 != null ? a1 * h1 * h1 : 0, e2 = h2 != null ? a2 * h2 * h2 : 0;
      reef[i] = Math.sqrt(e1 + e2);
      total[i] = Math.sqrt((h1 || 0) * (h1 || 0) + (h2 || 0) * (h2 || 0));
      var secLead = h2 != null && e2 > e1;
      per[i] = secLead ? secPer[i] : PER[i];
      perIn[i] = (secLead ? a2 : a1) > 0.5;
      leadDir[i] = secLead ? D2[i] : D1[i];
      if (total[i] > peak) peak = total[i];
    }
    var maxY = axisMax(peak), step = maxY <= 4 ? 1 : maxY <= 8 ? 2 : 4;
    PP.reef = reef; PP.swellGeom = { top: top, h: hgt, maxY: maxY, plotLeft: plotLeft, plotW: plotW };
    var T = common.allTimes;
    var X = function (t) { return _fcXFor(t, common, plotLeft, plotW); };
    var Y = function (v) { return top + hgt - (Math.min(v, maxY) / maxY) * hgt; };
    var YP = function (v) { return top + hgt - (Math.max(0, Math.min(24, v)) / 24) * hgt; };

    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, cssW, cssH);
    pastWash(ctx, common, plotLeft, plotW, top, subBot - top);
    nightBands(ctx, common, plotLeft, plotW, top, subBot - top);
    daySeps(ctx, common, plotLeft, plotW, top, subBot - top);
    for (var v = step; v < maxY; v += step) hGrid(ctx, plotLeft, plotLeft + plotW, Y(v));

    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, hgt); ctx.clip();
    var area = function (arr) {
      ctx.beginPath(); ctx.moveTo(X(T[0]), Y(0));
      for (var k = 0; k <= n; k++) ctx.lineTo(X(T[k]), Y(arr[k] != null ? arr[k] : 0));
      ctx.lineTo(X(T[n]), Y(0)); ctx.closePath();
    };
    var edge = function (arr) {
      ctx.beginPath(); var s = false;
      for (var k = 0; k <= n; k++) { if (arr[k] == null) { s = false; continue; } var x = X(T[k]), y = Y(arr[k]); if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y); }
    };
    // Ghost: all swell offshore, blocked or not (grey hatch + dashed edge).
    area(total); ctx.fillStyle = rgba(C.grey, PP.light === 'day' ? 0.08 : 0.12); ctx.fill();
    ctx.fillStyle = hatch(ctx, C.grey, 'diag', PP.light === 'day' ? 0.75 : 0.85); ctx.fill();
    edge(total); ctx.setLineDash([3, 2]); ctx.lineWidth = 1.25; ctx.strokeStyle = C.grey; ctx.stroke(); ctx.setLineDash([]);
    // Hero: what reaches the reef — solid deep sounding blue, bold edge.
    area(reef); ctx.fillStyle = C.reef; ctx.fill();
    // The past keeps its reef area, one step lighter (≥ 3:1 on the wash).
    var pnx = pastX(common, plotLeft, plotW);
    if (pnx != null && pnx > plotLeft + 1) {
      ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, pnx - plotLeft, hgt); ctx.clip();
      area(reef); ctx.fillStyle = C.reefPast || C.reef2; ctx.fill(); ctx.restore();
    }
    edge(reef); ctx.lineWidth = KIOSK_ON ? 3 : 2.5; ctx.strokeStyle = C.reefInk; ctx.lineJoin = 'round'; ctx.stroke();
    // Period of the lead train: ink with a halo; dashed where it's out.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var perSeg = function (inWin) {
      ctx.beginPath(); var s = false;
      for (var k = 0; k <= n; k++) {
        var p = per[k];
        var ok = p != null && isFinite(p) && (perIn[k] === inWin || (k > 0 && perIn[k - 1] === inWin));
        if (!ok) { s = false; continue; }
        var x = X(T[k]), y = YP(p);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      }
    };
    [false, true].forEach(function (inWin) {
      perSeg(inWin); ctx.strokeStyle = C.halo; ctx.lineWidth = 5; ctx.setLineDash([]); ctx.stroke();
      perSeg(inWin); ctx.strokeStyle = C.ink; ctx.lineWidth = inWin ? 2 : 1.4; ctx.setLineDash(inWin ? [] : [4, 3]); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
    pastLabel(ctx, common, plotLeft, plotW, top);

    // Axes: feet left (ink), seconds right (ink-2, matching the line).
    ctx.font = '600 ' + fsz(12); ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillStyle = C.ink;
    for (var q = 0; q <= maxY; q += step) ctx.fillText(q === maxY ? q + 'ft' : String(q), plotLeft - 5, Math.min(Math.max(Y(q), 8), top + hgt - 5));
    ctx.textAlign = 'left'; ctx.fillStyle = C.ink2;
    [6, 12, 18].forEach(function (s) { ctx.fillText(s + (s === 18 ? 's' : ''), plotLeft + plotW + 5, YP(s)); });

    // Direction strip: the window as a magenta band, edges named in the
    // right gutter (115° / 158°) so no label sits on a line.
    var winMin = CH.swellWindowMin, winMax = CH.swellWindowMax;
    var dMin = Math.max((winMin + winMax) / 2 - 110, 90), dMax = (winMin + winMax) / 2 + 110;
    var YD = function (deg) { return subTop + 3 + ((deg - dMin) / (dMax - dMin)) * (subBot - subTop - 6); };
    ctx.fillStyle = C.magTint;
    ctx.fillRect(plotLeft, YD(winMin), plotW, YD(winMax) - YD(winMin));
    ctx.strokeStyle = C.mag; ctx.lineWidth = 1.25; ctx.setLineDash([5, 3]);
    [winMin, winMax].forEach(function (dd) { ctx.beginPath(); ctx.moveTo(plotLeft, Math.round(YD(dd)) + 0.5); ctx.lineTo(plotLeft + plotW, Math.round(YD(dd)) + 0.5); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, subTop, plotW, subBot - subTop); ctx.clip();
    var dirLine = function (dirs, gate, w) {
      for (var k = 1; k <= n; k++) {
        var a = dirs[k - 1], b = dirs[k];
        if (a == null || b == null || !gate(k) || !gate(k - 1) || Math.abs(a - b) > 180) continue;
        var c = swellDirClass((a + b) / 2);
        ctx.beginPath(); ctx.moveTo(X(T[k - 1]), YD(a)); ctx.lineTo(X(T[k]), YD(b));
        if (c === 'dir-in') { ctx.strokeStyle = C.reefInk; ctx.lineWidth = w; ctx.setLineDash([]); }
        else if (c === 'dir-edge') { ctx.strokeStyle = C.amberLine; ctx.lineWidth = w * 0.85; ctx.setLineDash([4, 2]); }
        else { ctx.strokeStyle = C.grey; ctx.lineWidth = 1.3; ctx.setLineDash([1.5, 2.5]); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    dirLine(D2, function (k) { return H2[k] != null && H2[k] >= 0.8; }, KIOSK_ON ? 2 : 1.6);
    dirLine(D1, function () { return true; }, KIOSK_ON ? 3.2 : 2.6);
    ctx.restore();
    ctx.font = '600 ' + fsz(11); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink2;
    var lastY = -1e9;
    [[90, 'E'], [180, 'S'], [225, 'SW']].forEach(function (cp) {
      if (cp[0] < dMin || cp[0] > dMax) return;
      var y = YD(cp[0]); if (Math.abs(y - lastY) < 12 || (y > YD(winMin) - 8 && y < YD(winMax) + 8)) return;
      ctx.fillText(cp[1], plotLeft - 5, y); lastY = y;
    });
    ctx.fillStyle = C.mag; ctx.font = '700 ' + fsz(11);
    ctx.fillText('SE', plotLeft - 5, (YD(winMin) + YD(winMax)) / 2);
    ctx.textAlign = 'left';
    ctx.fillText(winMin + '°', plotLeft + plotW + 4, YD(winMin) - 1);
    ctx.fillText(winMax + '°', plotLeft + plotW + 4, YD(winMax) + 3);
    frame(ctx, plotLeft, top, plotW, hgt);
    frame(ctx, plotLeft, subTop, plotW, subBot - subTop);
    nowTick(ctx, common, plotLeft, plotW, top, subBot, true);

    // Buoy observation (measured total sea at the buoy): open diamond.
    var obsH = data.obsHsFt, obsMs = data.obsMs;
    if (obsH != null && obsMs != null && Date.now() - obsMs <= BUOY_OBS_OLD_MS && obsMs >= common.t0 && obsMs <= common.tEnd) {
      var ox = X(new Date(obsMs)), oy = Y(Math.min(obsH, maxY));
      ctx.save(); ctx.beginPath(); ctx.moveTo(ox, oy - 5.5); ctx.lineTo(ox + 5.5, oy); ctx.lineTo(ox, oy + 5.5); ctx.lineTo(ox - 5.5, oy); ctx.closePath();
      ctx.fillStyle = C.sheet; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.restore();
    }
    var si = STATE.scrubberIdx;
    if (typeof si === 'number' && si >= 0 && si <= n) {
      var tx = X(T[si]);
      if (reef[si] != null) scrubDot(ctx, tx, Y(reef[si]));
      if (per[si] != null && isFinite(per[si])) scrubDot(ctx, tx, YP(per[si]));
      if (leadDir[si] != null && leadDir[si] >= dMin && leadDir[si] <= dMax) scrubDot(ctx, tx, YD(leadDir[si]));
    }
    return { canvas: canvas, cssW: cssW, cssH: cssH, plotLeft: plotLeft, plotW: plotW, top: top, h: hgt, swellMaxY: maxY, ySwell: Y, yPeriod: YP };
  }

  // Wind: offshore solid green, cross amber hatch, onshore coral
  // cross-hatch (pattern + hue + the word in the legend).
  function ppDrawWindPanel(common, data) {
    var canvas = el('forecast-canvas-wind');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var dims = ensureCanvasCssDims(canvas, ctx), cssW = dims.cssW, cssH = dims.cssH;
    ctx.clearRect(0, 0, cssW, cssH);
    var plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    var top = 4, hh = cssH - 8, maxY = 25;
    var X = function (t) { return _fcXFor(t, common, plotLeft, plotW); };
    var Y = function (v) { return top + hh - (Math.min(v, maxY) / maxY) * hh; };
    var T = common.allTimes, L = common.lastIdx, S = data.windSpeeds, Dd = data.windDirs;
    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, cssW, cssH);
    pastWash(ctx, common, plotLeft, plotW, top, hh);
    nightBands(ctx, common, plotLeft, plotW, top, hh);
    daySeps(ctx, common, plotLeft, plotW, top, hh);
    [10, 20].forEach(function (v) { hGrid(ctx, plotLeft, plotLeft + plotW, Y(v)); });
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, plotW, hh); ctx.clip();
    var fills = { off: C.off, cross: hatch(ctx, C.cross, 'diag', 1), on: hatch(ctx, C.on, 'cross', 1), na: C.rule };
    var tints = { cross: rgba(C.cross, 0.16), on: rgba(C.on, 0.14) };
    for (var i = 0; i < L; i++) {
      var w1 = S[i] != null ? S[i] : 0, w2 = S[i + 1] != null ? S[i + 1] : 0;
      var b = windClass(S[i], Dd[i]) || 'na';
      ctx.beginPath(); ctx.moveTo(X(T[i]), Y(0)); ctx.lineTo(X(T[i]), Y(w1)); ctx.lineTo(X(T[i + 1]), Y(w2)); ctx.lineTo(X(T[i + 1]), Y(0)); ctx.closePath();
      if (tints[b]) { ctx.fillStyle = tints[b]; ctx.fill(); }
      ctx.fillStyle = fills[b]; ctx.fill();
    }
    ctx.beginPath(); var s = false;
    for (var k = 0; k <= L; k++) { if (S[k] == null) { s = false; continue; } var x = X(T[k]), y = Y(S[k]); if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y); }
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    ctx.font = '600 ' + fsz(12); ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('0', plotLeft - 5, Y(0) - 5); ctx.fillText('10', plotLeft - 5, Y(10)); ctx.fillText('20', plotLeft - 5, Y(20));
    ctx.textAlign = 'left'; ctx.fillStyle = C.ink2; ctx.fillText('mph', plotLeft + plotW + 4, Y(20));
    frame(ctx, plotLeft, top, plotW, hh);
    nowTick(ctx, common, plotLeft, plotW, top, top + hh, false);
    var si = STATE.scrubberIdx;
    if (typeof si === 'number' && si >= 0 && si <= L && S[si] != null) scrubDot(ctx, X(T[si]), Y(S[si]));
    return { canvas: canvas, cssW: cssW, cssH: cssH, plotLeft: plotLeft, plotW: plotW, top: top, h: hh, windMaxY: maxY };
  }

  // Tide: sounding-blue curve; the daylight incoming windows (low → high,
  // clipped to daylight) as blue bands; lows marked ▼ with their time.
  // Lows after dark are dimmed and say so.
  function ppDrawTidePanel(common, data) {
    var canvas = el('forecast-canvas-tide');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var dims = ensureCanvasCssDims(canvas, ctx), cssW = dims.cssW, cssH = dims.cssH;
    ctx.clearRect(0, 0, cssW, cssH);
    var plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    var top = 4, hh = cssH - 8;
    var X = function (t) { return _fcXFor(new Date(t), common, plotLeft, plotW); };
    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, cssW, cssH);
    pastWash(ctx, common, plotLeft, plotW, top, hh);
    nightBands(ctx, common, plotLeft, plotW, top, hh);
    daySeps(ctx, common, plotLeft, plotW, top, hh);
    var pts = (data.tidePred || []).map(function (p) { return { t: new Date(p.t).getTime(), v: parseFloat(p.v) }; })
      .filter(function (p) { return Number.isFinite(p.v) && p.t >= common.t0 - HOUR && p.t <= common.tEnd + HOUR; });
    var tMin = 0, tMax = 1, yT = null;
    if (pts.length > 1) {
      tMin = Math.min.apply(null, pts.map(function (p) { return p.v; })); tMax = Math.max.apply(null, pts.map(function (p) { return p.v; }));
      var pad = 0.12 * (tMax - tMin || 1);
      yT = function (v) { return top + 8 + (1 - (v - (tMin - pad)) / ((tMax + pad) - (tMin - pad))) * (hh - 30); };
      ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, plotW, hh); ctx.clip();
      // Incoming in daylight: the go band.
      var ev = tideEvents();
      ev.forEach(function (lo, i) {
        if (lo.type !== 'L') return;
        var hi = null; for (var k = i + 1; k < ev.length; k++) if (ev[k].type === 'H') { hi = ev[k]; break; }
        var end = hi ? hi.t : lo.t + 6.2 * HOUR, dl = sun(lo.t);
        if (!dl.sunrise) return;
        var a = Math.max(lo.t, dl.sunrise.getTime()), b = Math.min(end, dl.sunset.getTime());
        if (b <= a) return;
        ctx.fillStyle = C.shoal2; ctx.globalAlpha = PP.light === 'day' ? 0.6 : 0.75; ctx.fillRect(X(a), top, X(b) - X(a), hh); ctx.globalAlpha = 1;
        ctx.fillStyle = C.tide; ctx.fillRect(X(a), top + hh - 4, X(b) - X(a), 4);
      });
      ctx.beginPath(); ctx.moveTo(X(pts[0].t), top + hh - 4);
      pts.forEach(function (p) { ctx.lineTo(X(p.t), yT(p.v)); });
      ctx.lineTo(X(pts[pts.length - 1].t), top + hh - 4); ctx.closePath();
      ctx.fillStyle = C.shoal; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); pts.forEach(function (p, i) { var x = X(p.t), y = yT(p.v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.strokeStyle = C.tide; ctx.lineWidth = KIOSK_ON ? 3 : 2.25; ctx.stroke();
      ctx.restore();
      var lows = ev.filter(function (p) { return p.type === 'L' && p.t >= common.t0 && p.t <= common.tEnd && isFinite(p.v); });
      var lastX = -1e9;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      lows.forEach(function (lo) {
        var x = X(lo.t), y = yT(lo.v), lit = !isDark(lo.t);
        ctx.fillStyle = lit ? C.tide : C.ink3;
        ctx.globalAlpha = lit ? 1 : 0.7;
        ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x - 4.5, y - 6); ctx.lineTo(x + 4.5, y - 6); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        if (!lit) return;
        var c = clock(lo.t), lbl = c.hm + c.ap.charAt(0).toLowerCase();
        ctx.font = '700 ' + fsz(12);
        var wpx = ctx.measureText(lbl).width + 8;
        if (x - lastX > wpx && x > plotLeft + wpx / 2 && x < plotLeft + plotW - wpx / 2) {
          ctx.lineWidth = 3; ctx.strokeStyle = C.halo; ctx.lineJoin = 'round';
          var ly = Math.min(y + 5, top + hh - 20);
          ctx.strokeText(lbl, x, ly); ctx.fillStyle = C.tide; ctx.fillText(lbl, x, ly);
          lastX = x;
        }
      });
      ctx.font = '600 ' + fsz(12); ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      var f = function (v) { return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(1); };
      ctx.fillText(f(tMax) + 'ft', plotLeft - 5, Math.max(yT(tMax), 10)); ctx.fillText(f(tMin), plotLeft - 5, yT(tMin));
    } else {
      ctx.font = '600 ' + fsz(13); ctx.fillStyle = C.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No NOAA tide predictions for these days', plotLeft + plotW / 2, top + hh / 2);
    }
    frame(ctx, plotLeft, top, plotW, hh);
    nowTick(ctx, common, plotLeft, plotW, top, top + hh, false);
    var si = STATE.scrubberIdx;
    if (yT && typeof si === 'number' && si >= 0 && si <= common.lastIdx) {
      var tt = tideAt(common.allTimes[si].getTime());
      if (tt) scrubDot(ctx, X(common.allTimes[si].getTime()), yT(tt.v));
    }
    return { canvas: canvas, cssW: cssW, cssH: cssH, plotLeft: plotLeft, plotW: plotW, top: top, h: hh, tideMin: tMin, tideMax: tMax };
  }

  // Day labels: same geometry as the app's, the selected day inked and a
  // data-off hook so tapping a day jumps to its incoming window.
  function ppRenderDayLabels(common) {
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

  // Now marker: a 16 px DOM dot with a CSS ring (compositor only), moved
  // when the chart redraws or once a minute (audit M7).
  function placeNowDot() {
    var cont = el('forecast-chart-container'), c = cs(), g = PP.swellGeom, reef = PP.reef;
    if (!cont || !c || !g || !reef) return;
    var dot = el('pp-nowdot');
    if (!dot) { dot = h('div', { id: 'pp-nowdot', 'aria-hidden': 'true' }); cont.appendChild(dot); }
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
  // Lineup "chart page": the photo in colour, chart-lettered
  // ════════════════════════════════════════════════════════════════════
  function ppDrawLineupMap(marine, wind, _buoy, hourIdx) {
    var svg = el('lineup-overlay'), frameEl = el('lineup-frame');
    if (!svg || !frameEl) return;
    var Wd = frameEl.clientWidth, Hd = frameEl.clientHeight;
    if (!Wd || !Hd) return;
    svg.setAttribute('viewBox', '0 0 ' + Wd + ' ' + Hd);
    svg.setAttribute('preserveAspectRatio', 'none');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var ns = 'http://www.w3.org/2000/svg';
    var mk = function (tag, at, parent) { var e = document.createElementNS(ns, tag); for (var k in at) e.setAttribute(k, at[k]); (parent || svg).appendChild(e); return e; };
    var hr = marine && marine.hourly;
    var i = typeof hourIdx === 'number' && hourIdx >= 0 ? hourIdx : selIdx();
    if (!hr || i < 0) return;
    var t = new Date(hr.time[i]).getTime();
    var isNowHr = i === nowIdx();
    // NOW lights the photo by the real minute, not by its rounded slot.
    var tLight = isNowHr ? Date.now() : t;
    var scene = sceneAt(tLight);
    frameEl.setAttribute('data-scene', scene);
    // Printed over a photo: white figures with a dark halo read on water
    // and foam alike; the window keeps its magenta (light tint on dark).
    var INK = '#FFFFFF', HALO = 'rgba(6,14,22,0.92)';
    var MAG = '#FF8AD4', MAGH = 'rgba(40,6,28,0.9)';
    var REEF = '#A8D8FF', REEFH = '#06223F';
    var GREY = '#D5D9DE';
    var WC = { off: '#7CE29A', cross: '#FFC664', on: '#FF9A6B' };
    var cx = Wd / 2, cy = Hd * 0.5, R = Math.min(Hd * 0.47, Wd * 0.42);
    var pt = function (deg, r) { var th = deg * Math.PI / 180; return [cx + r * Math.sin(th), cy - r * Math.cos(th)]; };

    // Place names, lettered as a chart letters them.
    mk('text', { x: Math.max(12, Wd * 0.035), y: Math.max(Hd * 0.2, 62), class: 'pp-svg-place', 'font-size': Math.round(Math.max(12, Wd * 0.034)), fill: '#FFFFFF', stroke: HALO, 'stroke-width': 3.2 }).textContent = 'FISHERS ISLAND';
    mk('text', { x: Wd * 0.05, y: Hd - 14, class: 'pp-svg-water', 'font-size': Math.round(Math.max(14, Wd * 0.042)), fill: '#E8F2FA', stroke: HALO, 'stroke-width': 3.2 }).textContent = 'Block Island Sound';

    // Swell window cone in chart magenta, edges named for what frames it.
    var e1 = pt(CH.swellWindowMin, R), e2 = pt(CH.swellWindowMax, R);
    mk('path', { d: 'M' + cx + ' ' + cy + ' L' + e1[0] + ' ' + e1[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + e2[0] + ' ' + e2[1] + ' Z',
      fill: 'rgba(242,125,203,0.20)', stroke: 'none' });
    mk('path', { d: 'M' + e1[0] + ' ' + e1[1] + ' L' + cx + ' ' + cy + ' L' + e2[0] + ' ' + e2[1], fill: 'none', stroke: MAGH, 'stroke-width': 4.5, 'stroke-opacity': 0.7 });
    mk('path', { d: 'M' + e1[0] + ' ' + e1[1] + ' L' + cx + ' ' + cy + ' L' + e2[0] + ' ' + e2[1], fill: 'none', stroke: MAG, 'stroke-width': 2, 'stroke-dasharray': '7 5' });
    mk('path', { d: 'M' + e1[0] + ' ' + e1[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + e2[0] + ' ' + e2[1], fill: 'none', stroke: MAGH, 'stroke-width': 6, 'stroke-opacity': 0.6 });
    mk('path', { d: 'M' + e1[0] + ' ' + e1[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + e2[0] + ' ' + e2[1], fill: 'none', stroke: MAG, 'stroke-width': 3 });

    var placed = [];
    var collide = function (b) { for (var q = 0; q < placed.length; q++) { var o = placed[q]; if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) return true; } return false; };
    var block = function (x, y, w, hh) { placed.push({ x: x, y: y, w: w, h: hh }); };
    // Upright label (1–2 lines), haloed, nudged off anything already placed.
    var lab = function (lines, x, y, anchor, size, color, halo, cls, dir) {
      lines = [].concat(lines).filter(Boolean);
      var w = Math.max.apply(null, lines.map(function (l, k) { return l.length * (k ? size * 0.82 : size) * 0.53; })) + 6;
      var hh = size * 1.15 + (lines.length > 1 ? size * 1.0 : 0);
      var bx = function (xx, yy) { return { x: anchor === 'end' ? xx - w : anchor === 'start' ? xx : xx - w / 2, y: yy - size * 0.8, w: w, h: hh }; };
      var dx = dir ? dir[0] : 0, dy = dir ? dir[1] : 1;
      var fit = function (xx, yy) {
        xx = Math.max(anchor === 'end' ? w + 4 : anchor === 'start' ? 4 : w / 2 + 4, Math.min(anchor === 'end' ? Wd - 4 : anchor === 'start' ? Wd - w - 4 : Wd - w / 2 - 4, xx));
        yy = Math.max(size + 2, Math.min(Hd - hh + size * 0.5, yy));
        return [xx, yy];
      };
      var best = null;
      for (var step = 0; step < 16 && !best; step++) {
        var cands = [[x + dx * 6 * step, y + dy * 6 * step], [x - dy * 7 * step, y + dx * 7 * step], [x + dy * 7 * step, y - dx * 7 * step]];
        for (var c = 0; c < cands.length; c++) { var f = fit(cands[c][0], cands[c][1]); if (!collide(bx(f[0], f[1]))) { best = f; break; } }
      }
      if (!best) best = fit(x, y);
      placed.push(bx(best[0], best[1]));
      var tx = mk('text', { x: best[0], y: best[1], 'text-anchor': anchor || 'middle', class: cls || 'pp-svg-label',
        'font-size': size, fill: color, stroke: halo, 'stroke-width': Math.max(3, size * 0.26) });
      lines.forEach(function (l, k) {
        var ts = document.createElementNS(ns, 'tspan');
        ts.setAttribute('x', best[0]);
        if (k) { ts.setAttribute('dy', size * 1.0); ts.setAttribute('font-size', (size * 0.8).toFixed(1)); }
        ts.textContent = l;
        tx.appendChild(ts);
      });
      return tx;
    };
    block(cx - 16, cy - 16, 32, 32);
    // Reserve the place names so readings never land on them.
    block(0, Math.max(Hd * 0.2, 62) - 18, Wd * 0.62, 24);
    block(0, 0, Wd, 38);
    var wsz = Math.round(Math.max(14, Wd * 0.042));
    block(0, Hd - 14 - wsz, Wd * 0.05 + wsz * 0.62 * 18, wsz + 8);

    var scale = R / 40;
    var labels = [];
    // Arrow: converges on the lineup. o.kind: reef | blocked | wind.
    var arrow = function (fromDeg, len, w, o) {
      if (fromDeg == null) return;
      var head = pt(fromDeg, 12), tail = pt(fromDeg, 12 + len);
      var th = fromDeg * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th), px = Math.cos(th), py = Math.sin(th);
      var hl = 9 + w * 2.2, hw = 5 + w * 1.4;
      var hb = [head[0] + ux * hl, head[1] + uy * hl];
      var tri = head[0] + ',' + head[1] + ' ' + (hb[0] - px * hw) + ',' + (hb[1] - py * hw) + ' ' + (hb[0] + px * hw) + ',' + (hb[1] + py * hw);
      var g = mk('g', {});
      mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: o.halo, 'stroke-width': w + (o.ghost ? 6 : 4), 'stroke-linecap': 'round', 'stroke-opacity': 0.9 }, g);
      mk('polygon', { points: tri, fill: o.halo, stroke: o.halo, 'stroke-width': 4, 'stroke-linejoin': 'round', 'stroke-opacity': 0.9 }, g);
      if (o.ghost) {
        // Blocked swell: a hollow grey ghost shaft (outline only), so a
        // dash on this page only ever means wind.
        mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: o.color, 'stroke-width': w + 2.4, 'stroke-linecap': 'butt' }, g);
        mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: o.halo, 'stroke-width': Math.max(1.2, w - 0.6), 'stroke-linecap': 'butt' }, g);
      } else {
        if (o.casing) mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: o.casing, 'stroke-width': w + 3, 'stroke-linecap': 'round' }, g);
        mk('line', { x1: tail[0], y1: tail[1], x2: hb[0], y2: hb[1], stroke: o.color, 'stroke-width': w, 'stroke-linecap': o.dots ? 'round' : (o.dash ? 'butt' : 'round'), 'stroke-dasharray': o.dash || 'none' }, g);
      }
      mk('polygon', { points: tri, fill: o.hollow ? o.halo : o.color, stroke: o.casing || o.color, 'stroke-width': o.hollow ? 2 : (o.casing ? 1.6 : 0), 'stroke-linejoin': 'round' }, g);
      for (var k = 0.1; k <= 1.01; k += 0.12) { var q = pt(fromDeg, 12 + len * k); block(q[0] - 6, q[1] - 6, 12, 12); }
      if (o.label) labels.push({ lines: o.label, tail: tail, ux: ux, uy: uy, o: o, rank: o.rank || 1 });
    };
    var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
    var h1 = (hr.swell_wave_height || [])[i], p1 = (hr.swell_wave_period || [])[i], d1 = (hr.swell_wave_direction || [])[i];
    var h2 = (hr.secondary_swell_wave_height || [])[i], p2 = (hr.secondary_swell_wave_period || [])[i], d2 = (hr.secondary_swell_wave_direction || [])[i];
    var wH = wind && wind.hourly, ws = wH ? (wH.wind_speed_10m || [])[i] : null, wd = wH ? (wH.wind_direction_10m || [])[i] : null;
    var sl = function (hh, pp) { return ftStr(hh) + 'ft @ ' + (pp != null ? Math.round(pp) : '–') + 's'; };
    var word = function (c) { return c === 'dir-in' ? 'IN WINDOW' : c === 'dir-edge' ? 'EDGE' : 'BLOCKED'; };
    // Reaches the reef: solid pale sounding blue; EDGE: the same with an
    // amber casing (as on the hero arrow); blocked: a hollow grey ghost.
    var trainStyle = function (c, lead) {
      var out = c === 'dir-out';
      return { color: out ? GREY : REEF, halo: out ? HALO : REEFH, ghost: out, casing: c === 'dir-edge' ? '#FFC664' : null, hollow: out, rank: out ? 1 : (lead ? 3 : 2),
        labColor: out ? GREY : '#FFFFFF', labHalo: out ? HALO : REEFH, sub: c === 'dir-edge' ? '#FFC664' : null };
    };
    if (h2 != null && d2 != null && h2 >= 0.3) {
      var c2 = swellDirClass(d2), st2 = trainStyle(c2, false);
      st2.label = [sl(h2, p2), word(c2)];
      arrow(d2, clamp(Math.sqrt(h2 * h2 * (p2 || 1)) * 1.5, 13, 30) * scale, 3, st2);
    }
    if (h1 != null && d1 != null) {
      var c1 = swellDirClass(d1), st1 = trainStyle(c1, true);
      st1.label = [sl(h1, p1), word(c1)];
      arrow(d1, clamp(Math.sqrt(h1 * h1 * (p1 || 1)) * 1.5, 16, 32) * scale, 5.5, st1);
    }
    // Wind: the shaft carries its dial ring's pattern — solid offshore,
    // long dash cross-shore, dotted onshore.
    var WDASH = { off: null, cross: '10 5', on: '0.1 5.6' };
    var wc = wd != null ? (windClass(ws, wd) || 'cross') : null;
    if (wd != null) {
      arrow(wd, clamp((ws || 0) * 0.7, 13, 30) * scale, wc === 'on' ? 3.2 : 2.6, { color: WC[wc], halo: HALO, dash: WDASH[wc], dots: wc === 'on', rank: 1,
        label: [(ws != null ? Math.round(ws) : '–') + 'mph ' + directionLabel(wd), WIND_WORD[wc]], labColor: WC[wc], labHalo: HALO });
    }
    var b1 = pt(CH.swellWindowMin, R + 6), b2 = pt(CH.swellWindowMax, R + 6);
    // Window edges named OUTSIDE the cone: SW Pt above its 115° tip,
    // Montauk Pt beyond its 158° tip (Chart Room's placement).
    lab(['SW Pt (Block)', CH.swellWindowMin + '°'], Wd - 8, e1[1] - 30, 'end', 15, MAG, MAGH, 'pp-svg-mag', [0, -1]);
    lab('Montauk Pt ' + CH.swellWindowMax + '°', Math.min(e2[0] + 10, Wd - 120), Math.min(e2[1] + 20, Hd - 8), 'start', 15, MAG, MAGH, 'pp-svg-mag', [1, 0]);
    labels.sort(function (a, b) { return b.rank - a.rank; });
    labels.forEach(function (L) {
      var off = 20;
      var tx = lab(L.lines, L.tail[0] + L.ux * off, L.tail[1] + L.uy * off + 5, 'middle', L.rank >= 3 ? 17 : 15, L.o.labColor, L.o.labHalo, 'pp-svg-label', [L.ux, L.uy]);
      if (L.o.sub && tx && tx.lastChild) tx.lastChild.setAttribute('fill', L.o.sub);
    });
    var rf = pt(LINEUP_REEF_HEADING, R * 0.3);
    mk('line', { x1: cx, y1: cy, x2: rf[0], y2: rf[1], stroke: HALO, 'stroke-width': 3.5, 'stroke-opacity': 0.6 });
    mk('line', { x1: cx, y1: cy, x2: rf[0], y2: rf[1], stroke: '#FFFFFF', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' });
    var rl = pt(LINEUP_REEF_HEADING, R * 0.3 + 10);
    lab('reef ' + LINEUP_REEF_HEADING + '°', rl[0], rl[1], 'end', 14, '#FFFFFF', HALO, 'pp-svg-water', [-1, -0.2]);

    // Lineup mark (chart position symbol: circle + dot).
    mk('circle', { cx: cx, cy: cy, r: 8, fill: 'none', stroke: HALO, 'stroke-width': 5 });
    mk('circle', { cx: cx, cy: cy, r: 8, fill: 'none', stroke: '#FFFFFF', 'stroke-width': 2 });
    mk('circle', { cx: cx, cy: cy, r: 2.8, fill: '#FFFFFF' });

    // North: a chart's thin north arrow, top right but below the strip a
    // first screen can peek at (no half-cut chips over the photo).
    var nx0 = Wd - 22, ny0 = 52;
    mk('path', { d: 'M' + nx0 + ' ' + ny0 + ' l7 22 l-7 -5 l-7 5 Z', fill: '#FFFFFF', stroke: HALO, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' });
    mk('text', { x: nx0, y: ny0 + 40, 'text-anchor': 'middle', class: 'pp-svg-label', 'font-size': 14, fill: '#FFFFFF', stroke: HALO, 'stroke-width': 3.5 }).textContent = 'N';

    // Caption + legend under the photo: the light at this hour (by the
    // real minute when it is NOW), then what each mark means — the wind
    // swatch shows the class actually drawn.
    var leg = el('pp-chart-legend');
    if (leg) {
      var dl = sun(tLight), lt = lightAt(tLight);
      var light = lt === 'day' ? ICON_SUN + 'DAYLIGHT' : lt === 'dusk' ? ICON_SUN + 'TWILIGHT' : ICON_MOON + 'AFTER DARK';
      var sunTxt = '';
      if (dl.sunset) {
        if (lt === 'day') { var ss = clock(dl.sunset); sunTxt = 'sunset <b>' + ss.hm + ' ' + ss.ap + '</b>'; }
        else if (lt === 'dusk' && dl.lastLight && tLight < dl.lastLight.getTime()) { var lc = clock(dl.lastLight); sunTxt = 'last light <b>' + lc.hm + ' ' + lc.ap + '</b>'; }
        else { var fl = clock(tLight > dl.sunset.getTime() ? sun(tLight + 864e5).firstLight : dl.firstLight); sunTxt = 'first light <b>' + fl.hm + ' ' + fl.ap + '</b>'; }
      }
      leg.innerHTML = '<div class="pp-lcap"><span class="pp-chip">' + light + '</span>' + (sunTxt ? '<span class="pp-lsun">' + sunTxt + '</span>' : '') + '</div>' +
        '<span><i class="pp-lsw pp-lsw-reef"></i>reaches reef</span><span><i class="pp-lsw pp-lsw-ghost"></i>blocked</span>' +
        '<span><i class="pp-sw pp-sw-win"></i>window 115–158°</span>' +
        (wc ? '<span><i class="pp-lsw pp-lsw-wind is-' + wc + '"></i>wind ' + windWord(wc, true) + '</span>' : '');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Web: build the chart in its frame
  // ════════════════════════════════════════════════════════════════════
  // The frame's mark: a small chart rose with the swell window in magenta.
  var LOGO = '<svg class="pp-logo" viewBox="-12 -12 24 24" aria-hidden="true">' +
    '<circle r="10.6" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M0 0 L' + (Math.sin(115 * Math.PI / 180) * 10).toFixed(2) + ' ' + (-Math.cos(115 * Math.PI / 180) * 10).toFixed(2) +
    ' A10 10 0 0 1 ' + (Math.sin(158 * Math.PI / 180) * 10).toFixed(2) + ' ' + (-Math.cos(158 * Math.PI / 180) * 10).toFixed(2) + ' Z" fill="var(--pp-mag)"/>' +
    '<path d="M0 -10.6 L2.2 -2.2 L0 -3.4 L-2.2 -2.2 Z" fill="currentColor"/>' +
    '<circle r="1.6" fill="currentColor"/></svg>';
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
  // A NOAA-style rose for the gate's blank chart: the rose in neutral
  // ink, figures upright, and the one magenta thing on it is Choc's
  // 115–158° swell window (the code, echoed before the forecast loads).
  function roseSVG() {
    var R = 100, s = '<svg viewBox="-112 -112 224 224" aria-hidden="true"><circle class="rose-ring" r="' + R + '"/><circle class="rose-ring" r="' + (R * 0.86) + '"/><circle class="rose-ring" r="' + (R * 0.6) + '"/>';
    for (var a = 0; a < 360; a += 2) {
      var t = a * Math.PI / 180, r0 = a % 10 === 0 ? R * 0.86 : R * 0.93;
      s += '<line class="rose-t" x1="' + (Math.sin(t) * r0).toFixed(1) + '" y1="' + (-Math.cos(t) * r0).toFixed(1) + '" x2="' + (Math.sin(t) * R).toFixed(1) + '" y2="' + (-Math.cos(t) * R).toFixed(1) + '"/>';
    }
    for (var b = 0; b < 360; b += 30) {
      var u = b * Math.PI / 180, x = Math.sin(u) * R * 0.76, y = -Math.cos(u) * R * 0.76;
      s += '<text class="rose-fig" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '">' + ('00' + b).slice(-3) + '</text>';
    }
    var arc = function (r0, r1) {
      var p = function (deg, r) { var q = deg * Math.PI / 180; return (Math.sin(q) * r).toFixed(1) + ' ' + (-Math.cos(q) * r).toFixed(1); };
      return 'M' + p(115, r1) + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + p(158, r1) + ' L' + p(158, r0) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + p(115, r0) + ' Z';
    };
    s += '<path class="rose-win" d="' + arc(R * 0.86, R) + '"/>' +
      '<path class="rose-n" d="M0 -106 L5 -86 L0 -90 L-5 -86 Z"/><text class="rose-var" y="-4">VAR 14°15′W</text><text class="rose-var" y="8">(2026)</text></svg>';
    return s;
  }

  function bar(left, right, id) {
    var b = h('div', { class: 'pp-bar' }, '<span>' + left + '</span>' + (right ? '<span class="pp-bar-r">' + right + '</span>' : ''));
    if (id) b.id = id;
    return b;
  }
  function sw(cls) { return '<i class="pp-sw pp-sw-' + cls + '"></i>'; }

  var buildWeb = guard('buildWeb', function () {
    var body = document.body;
    // One skin: the three Win95 sheets step aside (the gate is restyled here).
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      if (/styles-(web1|web1-extensions|retro)\.css/.test(l.getAttribute('href') || '')) l.disabled = true;
    });
    body.classList.add('pp');

    var top = h('div', { id: 'pp-top' },
      LOGO + '<span class="pp-brand">LetsCheckChoc</span><span class="pp-model">Chocomount · Fishers I.</span>' +
      '<span class="pp-spacer"></span><span class="pp-ledwrap" id="pp-ledwrap" data-state="busy"><span id="pp-led-label">LOADING</span><span class="pp-led" id="pp-led" data-state="busy"></span></span>' +
      '<span class="pp-neat" aria-hidden="true"></span>');
    var keys = h('nav', { id: 'pp-keys', 'aria-label': 'Pages' }, '<span class="pp-neat" aria-hidden="true"></span>');
    [['fcst', 'FCST'], ['log', 'LOG'], ['model', 'MODEL'], ['set', 'SET']].forEach(function (k) {
      var b = h('button', { type: 'button', class: 'pp-key', 'data-key': k[0], 'aria-pressed': k[0] === 'fcst' ? 'true' : 'false' }, k[1]);
      b.addEventListener('click', function () { PP.softkey(k[0]); });
      keys.appendChild(b);
    });
    body.appendChild(h('div', { id: 'pp-selftest', 'aria-hidden': 'true' }, roseSVG()));
    body.appendChild(top);
    body.appendChild(keys);

    // Gate: the Win98 dialog (keep-list), title says who's asking.
    var gt = el('gate-titlebar-text'); if (gt) gt.textContent = 'LetsCheckChoc';
    var gi = document.querySelector('#gate-card .gate-icon'); if (gi) gi.innerHTML = anchorSVG();
    var gov = el('gate-overlay');
    var syncGate = function () { body.classList.toggle('pp-gate', !!gov && !gov.classList.contains('hidden')); };
    if (gov) { syncGate(); new MutationObserver(syncGate).observe(gov, { attributes: true, attributeFilter: ['class'] }); }

    // ── Forecast page ──
    var vf = el('view-forecast');
    var readout = h('section', { id: 'pp-readout', 'aria-live': 'polite' });
    var week = h('section', { id: 'pp-week' });
    week.appendChild(bar('This week at Choc', '<span id="pp-week-note">tap a day</span>'));
    week.appendChild(h('div', { class: 'pp-days', id: 'pp-days' }));
    var hb = h('div', { id: 'pp-hourbar' },
      '<button type="button" class="pp-hb-btn" data-j="pl" aria-label="Previous daylight low">' + CHEV_LL + 'LOW</button>' +
      '<button type="button" class="pp-hb-btn" data-j="ph" aria-label="Previous hour">' + CHEV_L + '1H</button>' +
      '<button type="button" class="pp-hb-mid" id="pp-hb-mid" aria-label="Selected hour (tap to return to now)"></button>' +
      '<button type="button" class="pp-hb-btn" data-j="nh" aria-label="Next hour">' + CHEV_R + '1H</button>' +
      '<button type="button" class="pp-hb-btn" data-j="nl" aria-label="Next daylight low">' + CHEV_RR + 'LOW</button>' +
      '<div class="pp-hb-echo" id="pp-hb-echo"></div>');
    hb.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'pp-hb-mid') { if (!(selIdx() === nowIdx())) resetScrubberToNow(); return; }
      PP.step(b.dataset.j);
    });
    var chart = h('section', { id: 'pp-right' });
    chart.appendChild(h('div', { class: 'pp-chart-head' }));
    var graph = h('section', { id: 'pp-graphcol' });
    graph.appendChild(bar('Seven days', 'tap a day · drag the hour'));
    var lineup = el('panel-lineup'), pf = el('panel-forecast');
    var left = h('div', { id: 'pp-left' }), main = h('div', { id: 'pp-main' });
    vf.insertBefore(left, vf.firstChild);
    left.after(main);
    left.appendChild(readout);
    left.appendChild(week);
    main.appendChild(hb);
    main.appendChild(chart);
    chart.appendChild(lineup);
    chart.appendChild(h('div', { class: 'pp-chart-legend', id: 'pp-chart-legend' }));
    main.appendChild(graph);
    graph.appendChild(pf);
    vf.classList.add('pp-grid');

    // Legends inside the stacked chart labels (first place each code shows).
    var lbl = function (sel, html) { var l = document.querySelector(sel + ' .forecast-section-label'); if (l) l.innerHTML = html; };
    lbl('.forecast-card-swell', '<span>Swell</span><span class="pp-legend"><span>' + sw('reef') + 'reaches reef</span><span>' + sw('blocked') + 'blocked</span><span>' + sw('period') + 'period</span><span>' + sw('win') + 'window</span></span>');
    lbl('.forecast-card-wind', '<span>Wind</span><span class="pp-legend"><span>' + sw('off') + 'offshore</span><span>' + sw('cross') + 'cross</span><span>' + sw('on') + 'onshore</span></span>');
    lbl('.forecast-card-tide', '<span>Tide</span><span class="pp-legend"><span>' + sw('tide') + 'incoming in daylight</span><span>' + sw('low') + 'low</span><span>' + sw('dark') + 'after dark</span></span>');
    var dayRow = el('forecast-day-header');
    if (dayRow) {
      dayRow.removeAttribute('aria-hidden');
      dayRow.addEventListener('click', function (e) {
        var s = e.target.closest('.forecast-day-label');
        if (s) PP.jumpDay(parseInt(s.dataset.off, 10));
      });
    }

    // More at Choc: what used to sit between the chart and the footer.
    var more = h('section', { id: 'pp-more' });
    more.appendChild(bar('More at Choc', ''));
    var menu = h('div', { class: 'pp-menu' });
    var row = function (title, right, nodes, onOpen) {
      var d = h('details', {}, '<summary>' + title + '<span class="pp-sum-r">' + (right || '') + '</span></summary>');
      var bd = h('div', { class: 'pp-menu-body' });
      nodes.forEach(function (n) { if (n) bd.appendChild(n); });
      d.appendChild(bd);
      d.addEventListener('toggle', function () { if (d.open && onOpen) setTimeout(onOpen, 30); });
      menu.appendChild(d);
      return d;
    };
    row('Buoy 44097 spectra', '<span id="pp-sum-buoy"></span>', [el('panel-spectral-row')], function () {
      if (STATE.lastSpectral) { invalidateCanvasDPR(el('compass-canvas')); drawCompassRose(STATE.lastSpectral, STATE.lastBuoyParsed); }
    });
    row('Tide table', '<span id="pp-sum-tide"></span>', [el('panel-tides')], function () {
      if (STATE._cachedTidePred) { invalidateCanvasDPR(el('tide-canvas')); drawTideChart(STATE._cachedTidePred); }
    });
    row('Water &amp; light', '<span id="pp-sum-water"></span>', [el('conditions-row')]);
    var setLink = h('div', { class: 'pp-setlink', role: 'button', tabindex: '0' }, 'SOURCES, SETTINGS &amp; COLOUR KEY<span class="pp-sum-r" style="margin-left:auto;font-weight:600;font-size:14px;color:var(--pp-ink-2)">SET</span>');
    setLink.addEventListener('click', function () { PP.softkey('set'); });
    menu.appendChild(setLink);
    more.appendChild(menu);
    main.appendChild(more);

    // ── Setup page (display light, the colour key, sources) ──
    var setup = h('div', { id: 'pp-view-setup' });
    setup.appendChild(bar('Settings', 'sources &amp; the colour key'));
    var setRow = function (cap, nodes, note) {
      var r = h('div', { class: 'pp-setrow' }, '<div class="pp-cap">' + cap + '</div>');
      nodes.forEach(function (n) { if (n) r.appendChild(n); });
      if (note) r.appendChild(h('div', { class: 'pp-note' }, note));
      setup.appendChild(r);
      return r;
    };
    var lightSeg = h('div', { class: 'pp-seg-toggle', id: 'pp-light-toggle' });
    [['auto', 'SUN'], ['system', 'SYSTEM'], ['day', 'DAY'], ['night', 'NIGHT']].forEach(function (o) {
      var b = h('button', { type: 'button', 'data-v': o[0] }, o[1]);
      b.addEventListener('click', function () { try { localStorage.setItem('lcc-paper-light', o[0]); } catch (_) { /* private mode */ } syncLightToggle(); applyLight(); });
      lightSeg.appendChild(b);
    });
    setRow('Display light', [lightSeg], '<b>SUN</b> follows Choc’s own sunrise and sunset: chart paper by day, the navy chart from sunset, one step deeper after last light.');
    setRow('<span class="pp-qmark">?</span> Colour key', [h('div', { class: 'pp-key-sheet' }, keySheetHTML())],
      'Every colour also has a word, a pattern or a shape, so the page still reads in glare or in black and white. Red means one thing: the data is dead.');
    setRow('Station &amp; account', [el('app-header')]);
    setRow('Forecast model', [el('forecast-controls-bar')]);
    setRow('Buoy map', [el('panel-map')]);
    setRow('Tide stations', [el('panel-tide-map')]);
    setRow('Sources', [el('page-footer')], 'Swell &amp; wind: Open-Meteo. Tides: NOAA CO-OPS 8510719 Silver Eel Pond. Buoy: NDBC 44097 via the repo pipeline.');
    el('app').appendChild(setup);

    // ── Surf Log ──
    buildLog();
    syncLightToggle();
  });

  function keySheetHTML() {
    var r = function (k, v) { return '<div class="pp-krow"><div class="pp-kk">' + k + '</div><div class="pp-kv">' + v + '</div></div>'; };
    var dial = function (c) { return '<span class="pp-kdial">' + dialSVG(c === 'off' ? 335 : c === 'cross' ? 250 : 160, c) + '</span>'; };
    return r('Window', '<span>' + tagHTML('dir-in') + '115–158°</span><span>' + tagHTML('dir-edge') + 'within 5°</span><span>' + tagHTML('dir-out', true) + 'blocked by Montauk / Block</span>') +
      r('Swell', '<span>' + sw('reef') + 'reaches the reef</span><span>' + sw('blocked') + 'blocked swell</span><span>' + sw('period') + 'period (dashed = out)</span>') +
      r('Wind', '<span>' + dial('off') + windWord('off') + '</span><span>' + dial('cross') + windWord('cross', true) + '</span><span>' + dial('on') + windWord('on') + '</span>' +
        '<span class="t">ring and chart: solid · dashed · dotted, never red</span>') +
      r('Tide', '<span style="color:var(--pp-tide);font-weight:700"><span class="pp-tri up"></span>&nbsp;RISING</span><span style="color:var(--pp-tide);font-weight:700"><span class="pp-tri down"></span>&nbsp;FALLING</span><span>' + sw('tide') + 'incoming in daylight</span><span>' + sw('low') + 'low</span>') +
      r('Your model', '<span class="pp-kbins">' + [[2.5, '&lt; 3'], [3.5, '3–4'], [4.5, '4–5'], [5.5, '5–6'], [7, '6 +']].map(function (b) { return '<span class="pp-kbin">' + scoreHTML(b[0]) + '<i>' + b[1] + '</i></span>'; }).join('') + '</span>' +
        '<span class="t">five steps of 0–10: <b class="pp-only-day">darker</b><b class="pp-only-navy">brighter</b> = your model likes it more. The number is always printed.</span>') +
      r('Data', '<span>' + sw('fresh') + 'fresh</span><span>' + sw('stale') + 'stale (2 h+)</span><span>' + sw('dead') + '<b style="color:var(--pp-dead)">dead / no data</b></span>') +
      r('Dark', '<span>' + darkTag() + '</span><span class="t">hours and lows after dark are dimmed</span>');
  }

  function syncLightToggle() {
    var pref = 'auto';
    try { pref = localStorage.getItem('lcc-paper-light') || 'auto'; } catch (_) { /* private mode */ }
    document.querySelectorAll('#pp-light-toggle button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === pref ? 'true' : 'false'); });
  }

  PP.softkey = guard('softkey', function (k) {
    var body = document.body;
    body.classList.toggle('pp-setup', k === 'set');
    if (k === 'fcst' || k === 'set') switchTab('forecast');
    else if (k === 'log') switchTab('surflog');
    else if (k === 'model') switchTab('regression');
    document.querySelectorAll('#pp-keys .pp-key').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.key === k ? 'true' : 'false'); });
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
  PP.jumpTo = function (ms) { var c = cs(); if (c) setIdx(findHourIndexForTime(ms, c)); };
  PP.step = guard('step', function (j) {
    var c = cs(); if (!c) return;
    var i = selIdx(), t = c.times[i].getTime();
    if (j === 'ph') return setIdx(i - 1);
    if (j === 'nh') return setIdx(i + 1);
    var lows = daylightLows();
    if (j === 'nl') { for (var k = 0; k < lows.length; k++) if (lows[k].t > t + 40 * 60e3) return PP.jumpTo(lows[k].t); }
    if (j === 'pl') { for (var m = lows.length - 1; m >= 0; m--) if (lows[m].t < t - 40 * 60e3) return PP.jumpTo(lows[m].t); }
  });
  PP.jumpDay = guard('jumpDay', function (off) {
    var d0 = startOfDay(Date.now(), off).getTime(), d1 = d0 + 864e5;
    var lows = daylightLows().filter(function (l) { return l.t >= d0 && l.t < d1; });
    if (lows.length) return PP.jumpTo(lows[0].t);
    var dl = sun(d0 + 12 * HOUR);
    PP.jumpTo(dl.sunrise ? dl.sunrise.getTime() + HOUR : d0 + 8 * HOUR);
  });

  // ── Readout ────────────────────────────────────────────────────────
  // The buoy's measured swell, with its TRUE age coded (fresh green,
  // stale amber, dead red): an old reading never passes for live.
  function buoyLine() {
    var bp = STATE.lastBuoyParsed;
    var txt = function (id) { var e = el(id); return e ? (e.textContent || '').trim() : ''; };
    var hgt = (txt('val-swell-height').match(/([\d.]+)\s*ft/) || [])[1];
    var det = txt('val-swell-detail');
    if (!hgt) return '';
    var per = (det.match(/(\d+(?:\.\d+)?)s/) || [])[1];
    var dir = (det.match(/·\s*([NESW]{1,3})\s*\(/) || [])[1] || '';
    var obsMs = bp && Number.isFinite(bp.obsMs) ? bp.obsMs : null;
    var age = obsMs != null && typeof buoyObsAge === 'function' ? buoyObsAge(obsMs) : null;
    var lvl = age ? (age.level === 'old' ? 'is-dead' : age.level === 'stale' ? 'is-stale' : '') : '';
    var reach = per && obsMs != null && typeof buoySwellArrivalText === 'function' ? (buoySwellArrivalText(+per, obsMs) || '') : '';
    var rm = reach.match(/(reach(?:es|ed)) Choc ~(.+)$/);
    var oc = obsMs != null ? clock(obsMs) : null;
    var chip = age ? ' <span class="pp-agechip ' + lvl + '">' + esc(age.label.replace(/ ago$/, ' old')) + '</span>' : '';
    // Once its swell has already passed the reef the reading is history:
    // one line, its age still coded. While it is on its way: two lines
    // with the arrival time.
    if (!rm || rm[1] !== 'reaches') {
      return '<div class="pp-buoy is-one"><span class="pp-k">Buoy 44097</span> <b>' + seg(hgt) + 'ft @ ' + seg(per || '–') + 's ' + esc(dir) + '</b>' +
        (oc ? '<span class="pp-sep"></span>' + oc.hm + ' ' + oc.ap + chip : '') + '</div>';
    }
    return '<div class="pp-buoy"><span class="pp-k">Buoy 44097 measured</span> <b>' + seg(hgt) + 'ft @ ' + seg(per || '–') + 's ' + esc(dir) + '</b>' +
      (oc ? '<br>at ' + oc.hm + ' ' + oc.ap + chip : '') +
      '<span class="pp-sep"></span>reaches the reef <b>' + esc(rm[2]) + '</b></div>';
  }

  function annAge() {
    var asOf = STATE.dataAsOf, now = Date.now();
    if (!STATE.lastLoadCompletedAt) return { text: 'FETCHING CHOC FORECAST…', state: 'busy', cls: '' };
    if (asOf == null || !isFinite(asOf)) return { text: 'NO FORECAST DATA', state: 'dead', cls: 'is-dead' };
    var age = now - asOf, mins = Math.round(age / 60e3);
    if (age < 75 * 60e3) { var c = clock(asOf); return { text: 'UPD ' + c.hm + ' ' + c.ap, state: 'live', cls: '' }; }
    var hrs = Math.floor(mins / 60);
    var dead = age > 6 * HOUR;
    return { text: 'DATA ' + (hrs ? hrs + 'H ' : '') + (mins % 60) + 'M OLD', state: dead ? 'dead' : 'stale', cls: dead ? 'is-dead' : 'is-stale' };
  }
  function syncLed() {
    var a = annAge(), led = el('pp-led'), lab = el('pp-led-label'), wrap = el('pp-ledwrap');
    if (led) led.setAttribute('data-state', a.state);
    if (wrap) wrap.setAttribute('data-state', a.state);
    if (lab) lab.textContent = a.state === 'live' ? 'LIVE' : a.state === 'busy' ? 'LOADING' : a.state === 'stale' ? 'STALE' : 'NO DATA';
    return a;
  }

  // After last light the useful answer is the next daylight window, so it
  // takes the hero's place and size (Chart Room graft): first light, what
  // reaches the reef on that low's incoming tide, the tide, the wind at
  // the low and your model's best hour. Tonight collapses to one quiet
  // line, dimmed like every after-dark reading.
  function nightReadout(d) {
    var now = Date.now(), lows = daylightLows().filter(function (l) { return l.t > now; });
    if (!lows.length) return null;
    var lo = lows[0], off = dayOffsetOf(lo.t), info = dayInfo(off);
    if (!info || !info.s) return null;
    var s = info.s, P = s.primary, S = s.secondary;
    var c2 = clock(lo.t), fl = clock(sun(lo.t).firstLight);
    var w = tvWindows(startOfDay(lo.t).getTime()).filter(function (x) { return x.low === lo.t; })[0];
    var until = w ? clock(w.daylight ? w.b : w.end) : null, untilWhat = w && w.hi && w.b >= w.hi.t - 60e3 ? ' high' : ' dark';
    var dname = off === 1 ? 'TOMORROW' : dayName(lo.t);
    var age = syncLed();
    var html = '<button type="button" class="pp-nextwin pp-nl-bar" data-t="' + lo.t + '"><span>NEXT LIGHT<span class="pp-sep"></span>' + dname + ' ' + fl.hm + ' ' + fl.ap + '</span><span class="pp-chev"></span></button>';
    if (P) {
      var out = P.cls === 'dir-out', range = P.min === P.max ? String(P.max) : P.min + '-' + P.max;
      html += '<div class="pp-hero pp-hero-next' + (out ? ' is-out' : '') + '">' +
        '<div class="pp-hero-cap pp-cap">' + (out ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + '<span class="pp-hero-cap-r">on the ' + c2.hm + ' ' + c2.ap + ' low</span></div>' +
        '<div class="pp-hero-row"><div class="pp-hero-num">' + seg(range, 'pp-seg-xl') + '<span class="pp-u pp-u-xl">ft</span>' +
        '<span class="pp-at">@</span>' + seg(P.period != null ? P.period : '–', 'pp-seg-l') + '<span class="pp-u pp-u-l">s</span></div>' +
        arrowHTML(P.dir, arrowCls(P.cls), directionLabel(P.dir), Math.round(P.dir) + '°') + '</div>' +
        '<div class="pp-hero-sub">' + tagHTML(P.cls) +
        (S ? '<span class="pp-also">+ <b>' + (S.min === S.max ? S.max : S.min + '–' + S.max) + 'ft @ ' + (S.period != null ? S.period : '–') + 's</b> ' + directionLabel(S.dir) +
          (S.cls === 'dir-out' ? '<span class="pp-blk">BLOCKED</span>' : tagHTML(S.cls, true)) + '</span>' : '') + '</div></div>';
    } else {
      html += '<div class="pp-hero"><div class="pp-hero-cap pp-cap">NO SWELL DATA FOR ' + dname + '</div></div>';
    }
    html += '<div class="pp-nl-tide"><span class="pp-tri up"></span>incoming from low <b>' + c2.hm + ' ' + c2.ap + '</b>' + (until ? ' until <b>' + until.hm + ' ' + until.ap + '</b>' + untilWhat : '') + '</div>';
    var lw = info.low && info.low.wind, lwc = lw ? windClass(lw.mph, lw.dir) : null;
    html += '<div class="pp-nl-row">' +
      (lw ? '<span class="pp-nl-wind">' + dialSVG(lw.dir, lwc) + '<span><b>' + Math.round(lw.mph) + '</b> mph ' + directionLabel(lw.dir) + '<br>' + windWord(lwc) + '</span></span>' : '<span class="pp-cell-sub dim">NO WIND DATA</span>') +
      (info.best ? '<span class="pp-nl-model"><span class="pp-cap">Your<br>model</span>' + scoreHTML(info.best.mean, true) + '<span class="at">@' + clock(info.best.t).hr + clock(info.best.t).ap.charAt(0).toLowerCase() + '</span></span>' : '') +
      '</div>';
    var ck = clock(now), L = d && d.lead;
    html += '<div class="pp-nowline"><span class="pp-mode is-off">NOW</span><span>' + ck.hm + ' ' + ck.ap + '</span>' +
      (L ? '<span class="pp-sep"></span><b>' + ftStr(L.h) + 'ft @ ' + (L.p != null ? Math.round(L.p) : '–') + 's</b>' : '') +
      '<span class="pp-sep"></span>' + darkTag('after dark') +
      '<span class="pp-age ' + age.cls + '">' + age.text + '</span></div>';
    return html;
  }

  function renderReadout(d) {
    var box = el('pp-readout');
    if (!box) return;
    if (!d) {
      box.innerHTML = '<div class="pp-ann"><span class="pp-mode">NOW</span><span class="pp-when">FETCHING CHOC FORECAST…</span></div>' +
        '<div class="pp-hero"><div class="pp-hero-cap pp-cap">REACHES THE REEF</div><div class="pp-hero-row"><div class="pp-hero-num">' + seg('—', 'pp-seg-xl') + '</div></div></div>';
      return;
    }
    var ck = clock(d.isNow ? Date.now() : d.t), age = syncLed();
    var off = Math.round((d.t - Date.now()) / HOUR);
    var dark = d.scene !== 'day';
    if (d.isNow && lightAt(Date.now()) === 'night') {
      var nr = nightReadout(d);
      if (nr) {
        box.innerHTML = nr + buoyLine();
        box.querySelectorAll('.pp-nextwin').forEach(function (nw) { nw.addEventListener('click', function () { PP.jumpTo(+nw.dataset.t); }); });
        return;
      }
    }
    var ann = '<div class="pp-ann"><span class="pp-mode' + (d.isNow ? '' : ' is-off') + '">' + (d.isNow ? 'NOW' : (off > 0 ? '+' : '−') + Math.abs(off) + ' H') + '</span>' +
      '<span class="pp-when">' + dow(d.t) + ' ' + (new Date(d.t).getMonth() + 1) + '/' + new Date(d.t).getDate() + '<span class="pp-sep"></span>' + ck.hm + ' ' + ck.ap + '</span>' +
      '<span class="pp-age ' + age.cls + '">' + age.text + '</span></div>';
    var L = d.lead, hero;
    if (L) {
      var out = L.cls === 'dir-out';
      hero = '<div class="pp-hero' + (out ? ' is-out' : '') + '">' +
        '<div class="pp-hero-cap pp-cap">' + (out ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + (d.isNow ? lightTag(Date.now()) : dark ? darkTag(d.scene === 'twilight' ? 'TWILIGHT' : 'AFTER DARK', d.scene === 'twilight' ? ICON_SUN : null) : '') + '</div>' +
        '<div class="pp-hero-row"><div class="pp-hero-num">' + seg(ftStr(L.h), 'pp-seg-xl') + '<span class="pp-u pp-u-xl">ft</span>' +
        '<span class="pp-at">@</span>' + seg(L.p != null ? Math.round(L.p) : '–', 'pp-seg-l') + '<span class="pp-u pp-u-l">s</span></div>' +
        arrowHTML(L.d, arrowCls(L.cls), directionLabel(L.d), Math.round(L.d) + '°') + '</div>' +
        '<div class="pp-hero-sub">' + tagHTML(L.cls) +
        (d.other ? '<span class="pp-also">+ <b>' + ftStr(d.other.h) + 'ft @ ' + (d.other.p != null ? Math.round(d.other.p) : '–') + 's</b> ' + directionLabel(d.other.d) +
          (d.other.cls === 'dir-out' ? '<span class="pp-blk">BLOCKED</span>' : tagHTML(d.other.cls, true)) + '</span>' : '') +
        '</div></div>';
    } else {
      hero = '<div class="pp-hero"><div class="pp-hero-cap pp-cap">NO SWELL DATA FOR THIS HOUR</div></div>';
    }
    var T = d.tide, tideCell = '<div class="pp-cell"><div class="pp-cap">Tide</div>';
    if (T) {
      tideCell += '<div class="pp-cell-val">' + seg((T.v >= 0 ? '' : '−') + fmt1(Math.abs(T.v))) + '<span class="pp-u">ft</span></div>' +
        '<div class="pp-cell-sub is-tide"><span class="pp-tri ' + (T.rising ? 'up' : 'down') + '"></span>' + (T.rising ? 'RISING' : 'FALLING') + '</div>';
    } else {
      tideCell += '<div class="pp-cell-val">' + seg('—') + '</div><div class="pp-cell-sub dim">NO TIDE DATA</div>';
    }
    if (d.next) { var nc = clock(d.next.t); tideCell += '<div class="pp-cell-sub dim" style="margin-top:4px">' + (d.next.type === 'H' ? 'high ' : 'low ') + '<b>' + nc.hm + ' ' + nc.ap + '</b></div>'; }
    tideCell += '</div>';
    var Wn = d.wind, windCell = '<div class="pp-cell pp-cell-wind"><div class="pp-cap">Wind</div>';
    if (Wn) {
      windCell += dialSVG(Wn.dir, Wn.cls) + '<div><div class="pp-cell-val">' + seg(Math.round(Wn.mph)) + '<span class="pp-u">mph ' + directionLabel(Wn.dir) + '</span></div>' +
        '<div class="pp-cell-sub">' + windWord(Wn.cls) + '</div>' +
        (Wn.gust != null ? '<div class="pp-cell-sub dim" style="margin-top:4px">gust <b>' + Math.round(Wn.gust) + '</b></div>' : '') + '</div>';
    } else {
      windCell += '<div class="pp-cell-sub dim">NO WIND DATA</div>';
    }
    windCell += '</div>';
    var M = d.model, modelCell = '<div class="pp-modelstrip"><span class="pp-cap">Your<br>model</span>';
    if (M) {
      modelCell += '<span class="pp-val">' + scoreHTML(M.mean, true) + '</span>' +
        '<span class="pp-mrow"><span>SIZE</span>' + meter(M.w) + '</span><span class="pp-mrow"><span>RIDE</span>' + meter(M.r) + '</span><span class="pp-mrow"><span>WIND</span>' + meter(M.c) + '</span>';
    } else {
      modelCell += '<span class="pp-cell-sub dim">LOG 3+ SESSIONS TO TRAIN IT</span>';
    }
    modelCell += '</div>';
    // At twilight the week strip already opens on the next window (its
    // card jumps there), so no duplicate bar here: the week's note names it.
    var extra = d.isNow ? buoyLine() : '';
    box.innerHTML = ann + hero + '<div class="pp-cells">' + tideCell + windCell + '</div>' + modelCell + extra;
  }

  function renderHourbar(d) {
    var mid = el('pp-hb-mid'), echo = el('pp-hb-echo');
    if (!mid || !d) return;
    var ck = clock(d.isNow ? Date.now() : d.t), L = d.lead, W2 = d.wind, T = d.tide, M = d.model;
    var off = Math.round((d.t - Date.now()) / HOUR);
    mid.innerHTML = '<span class="pp-hb-time"><span class="pp-dow">' + dow(d.t) + '</span>' + seg(ck.hm) + '<span class="pp-u">' + ck.ap + '</span></span>' +
      '<span class="pp-hb-now' + (d.isNow ? '' : ' is-off') + '">' + (d.isNow ? 'NOW' : (off > 0 ? '+' : '−') + Math.abs(off) + ' H<span class="pp-sep"></span>TAP FOR NOW') + '</span>';
    if (!echo) return;
    var f = [];
    f.push(L ? '<b>' + ftStr(L.h) + 'ft @ ' + (L.p != null ? Math.round(L.p) : '–') + 's</b> <span class="pp-k ' + (KEYW[L.cls] ? KEYW[L.cls][0] : '') + '">' + (KEYW[L.cls] ? KEYW[L.cls][1] : '') + '</span>' : '<b>—</b>');
    f.push(W2 ? '<b>' + Math.round(W2.mph) + 'mph</b> <span class="pp-k pp-ww pp-ww-' + W2.cls + '" style="gap:3px">' + WIND_SHORT[W2.cls] + '</span>' : '<b>—</b>');
    f.push(T ? '<b>' + fmt1(T.v) + 'ft</b> <span class="pp-tri ' + (T.rising ? 'up' : 'down') + '"></span>' : '<b>—</b>');
    f.push(M ? 'model ' + scoreHTML(M.mean) : 'model <b>—</b>');
    echo.innerHTML = f.map(function (x) { return '<span>' + x + '</span>'; }).join('');
  }

  // ── This week at Choc (day cards from kioskDaySummary) ─────────────
  function weekData() {
    var out = [];
    for (var k = 0; k < 7; k++) { var D = dayInfo(k); if (D) out.push(D); }
    return out;
  }
  function dayInfo(k) {
    var c = cs(), ev = tideEvents();
    if (!c || !fd() || typeof kioskDaySummary !== 'function') return null;
    {
      var s;
      try { s = kioskDaySummary(k); } catch (e) { return null; }
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
      return { k: k, s: s, low: low, best: best, d0: d0, dl: dl };
    }
  }

  function renderWeek() {
    var host = el('pp-days');
    if (!host) return;
    var days = weekData();
    if (!days.length) { host.innerHTML = ''; return; }
    var c = cs(), sel = selIdx();
    var selOff = c && sel >= 0 ? dayOffsetOf(c.times[sel].getTime()) : 0;
    var now = Date.now(), todayDone = days[0] && days[0].dl.sunset && now > days[0].dl.sunset.getTime();
    // After sunset the strip opens on tomorrow; today steps to the end, faded.
    if (todayDone) days = days.slice(1).concat([days[0]]);
    var note = el('pp-week-note');
    if (note) {
      var nl = todayDone ? daylightLows().filter(function (l) { return l.t > now; })[0] : null;
      note.innerHTML = nl ? 'next window <b>' + (dayOffsetOf(nl.t) === 1 ? 'Tmrw' : new Date(nl.t).toLocaleDateString('en-US', { weekday: 'short' })) + ' ' + clock(nl.t).hm + ' ' + clock(nl.t).ap + '</b>' : 'tap a day';
    }
    host.innerHTML = days.map(function (D) {
      var s = D.s, P = s.primary, low = D.low;
      var lbl = D.k === 0 ? 'TODAY' : D.k === 1 ? 'TMRW' : dow(D.d0);
      var date = (new Date(D.d0).getMonth() + 1) + '/' + new Date(D.d0).getDate();
      var body = '';
      if (P) {
        var range = P.min === P.max ? String(P.max) : P.min + '-' + P.max;
        body += '<div class="pp-day-sw">' + seg(range, 'pp-xb') + '<span class="pp-u">ft</span></div>' +
          '<div class="pp-day-p">@' + seg(P.period != null ? P.period : '–') + '<span class="pp-u">s</span>' +
          '<span class="pp-day-dir">' + directionLabel(P.dir) + '</span>' + tagHTML(P.cls, true) + '</div>';
      } else {
        body += '<div class="pp-day-sw"><span class="pp-cap">NO SWELL DATA</span></div>';
      }
      if (low) {
        var lc = clock(low.t), wc = low.wind ? windClass(low.wind.mph, low.wind.dir) : null;
        body += '<div class="pp-day-low"><div class="t"><span class="pp-cap">LOW</span>' + seg(lc.hm) + '<span class="pp-u">' + lc.ap + '</span></div>' +
          (low.wind ? '<div class="w">' + dialSVG(low.wind.dir, wc) + Math.round(low.wind.mph) + ' ' + directionLabel(low.wind.dir) + '</div><div class="ww">' + windWord(wc, true) + '</div>' : '') + '</div>';
      } else if (s.tidesDown) {
        body += '<div class="pp-day-low"><span class="pp-cap">NO TIDE DATA</span></div>';
      } else {
        body += '<div class="pp-day-low"><span class="pp-cap">NO DAYLIGHT LOW</span></div>';
      }
      if (D.best) { var bc = clock(D.best.t); body += '<div class="pp-day-model"><span class="k">MODEL</span>' + scoreHTML(D.best.mean) + '<span class="at">@' + bc.hr + bc.ap.charAt(0).toLowerCase() + '</span></div>'; }
      var past = D.k === 0 && todayDone;
      if (past) date = 'done';
      return '<button type="button" class="pp-day' + (D.k === selOff ? ' is-sel' : '') + (P && P.cls === 'dir-out' ? ' is-out' : '') + (past ? ' is-past' : '') + '" data-k="' + D.k + '">' +
        '<div class="pp-day-h"><span>' + lbl + '</span><span class="d">' + date + '</span></div><div class="pp-day-b">' + body + '</div></button>';
    }).join('');
    host.querySelectorAll('.pp-day').forEach(function (b) { b.addEventListener('click', function () { PP.jumpDay(+b.dataset.k); }); });
  }

  function syncWeekSel() {
    var c = cs(), sel = selIdx();
    if (!c || sel < 0) return;
    var off = dayOffsetOf(c.times[sel].getTime());
    var host = el('pp-days');
    var selPast = false;
    document.querySelectorAll('#pp-days .pp-day').forEach(function (b) {
      var on = +b.dataset.k === off;
      b.classList.toggle('is-sel', on);
      if (on && b.classList.contains('is-past')) { selPast = true; return; }
      if (on && host && host.scrollWidth > host.clientWidth + 4) {
        var l = b.offsetLeft - host.offsetLeft - 12, r = l + b.offsetWidth + 24;
        if (l < host.scrollLeft || r > host.scrollLeft + host.clientWidth) host.scrollLeft = Math.max(0, l - (b.dataset.k > 0 ? b.offsetWidth * 0.6 : 0));
      }
    });
    // After sunset today's card sits faded at the end: open on tomorrow.
    if (selPast && host) host.scrollLeft = 0;
    document.querySelectorAll('#forecast-day-header .forecast-day-label').forEach(function (s) { s.classList.toggle('is-sel', +s.dataset.off === off); });
  }

  function summaries() {
    var t = function (id) { var e = el(id); return e ? (e.textContent || '').trim() : ''; };
    var b = el('pp-sum-buoy'), tide = el('pp-sum-tide'), w = el('pp-sum-water');
    if (b) b.textContent = (t('val-swell-height').match(/[\d.]+ ft/) || [''])[0];
    if (tide) tide.textContent = t('val-tide');
    if (w) w.textContent = t('val-water-temp') + (t('val-daylight') ? '  ' + t('val-daylight').replace(/\s*→\s*/, '–') : '');
  }

  var onHour = guard('onHour', function (idx) {
    if (!el('pp-readout')) return;
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
  PP.refresh = function () { afterChart(); };

  // ════════════════════════════════════════════════════════════════════
  // Surf Log: one screen — when, three ratings, notes + photo, Save
  // ════════════════════════════════════════════════════════════════════
  function localISO(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function buildLog() {
    var dt = el('sl-datetime');
    if (dt) {
      var when = h('div', { class: 'pp-whenpick', id: 'pp-when' });
      dt.parentNode.insertBefore(when, dt);
      var lbl = dt.parentNode.querySelector('.sl-label'); if (lbl) { lbl.textContent = 'When'; dt.parentNode.insertBefore(lbl, when); }
      dt.addEventListener('change', function () { syncWhen(); autoLookup(); });
    }
    document.querySelectorAll('#panel-surflog-form .sl-slider-group').forEach(function (g) {
      var s = g.querySelector('.sl-range'), label = g.querySelector('.sl-label');
      if (!s || !label) return;
      var head = h('div', { class: 'pp-rate-head' });
      g.insertBefore(head, g.firstChild);
      head.appendChild(label);
      label.firstChild && label.firstChild.nodeType === 3 && (label.firstChild.textContent = label.firstChild.textContent.replace(' Quality', ''));
      head.appendChild(h('span', { class: 'pp-rate-desc' }));
      head.appendChild(h('span', { class: 'pp-rate-slot' }));
      var row = h('div', { class: 'pp-rate', role: 'group', 'aria-label': label.textContent.trim() + ' rating' });
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
    // Notes and the camera side by side; the paste-a-link field folds away.
    var notes = el('sl-notes'), up = document.querySelector('label.sl-btn-file');
    if (notes && up) {
      var wrap = h('div', { style: 'display:grid;grid-template-columns:1fr 84px;gap:6px' });
      notes.parentNode.insertBefore(wrap, notes);
      wrap.appendChild(notes);
      wrap.appendChild(up);
      if (up.firstChild && up.firstChild.nodeType === 3) up.firstChild.textContent = 'PHOTO';
      up.insertAdjacentHTML('afterbegin', '<svg class="pp-cam" viewBox="0 0 20 16" aria-hidden="true"><path d="M7 1h6l1.6 2.4H18a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1h3.4Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="9" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>');
      up.style.minHeight = '50px';
      notes.placeholder = 'Notes — how was the session?';
      var nl = wrap.parentNode.querySelector('.sl-label'); if (nl) nl.classList.add('pp-vh');
    }
    var url = el('sl-photo-url'), addUrl = el('sl-add-url');
    if (url && addUrl) {
      var rowEl = url.parentNode, field = rowEl.parentNode;
      var det = h('details', { class: 'pp-urlfold' }, '<summary class="pp-note" style="cursor:pointer;list-style:none">or paste an image link ›</summary>');
      det.appendChild(rowEl);
      field.appendChild(det);
      var pl = field.querySelector('.sl-label'); if (pl) pl.style.display = 'none';
      url.placeholder = 'https://…';
      field.style.borderBottom = '0'; field.style.padding = '0 0 4px';
    }
    var condF = el('sl-conditions-display');
    if (condF) {
      if (/Lookup/.test(condF.textContent)) condF.innerHTML = '<span class="sl-hint">Conditions fill in by themselves for the time above.</span>';
      var note = condF.parentNode.querySelector('.sl-note'); if (note) note.style.display = 'none';
      var cl = condF.parentNode.querySelector('.sl-label'); if (cl) cl.classList.add('pp-vh');
    }
    var entries = el('panel-surflog-entries');
    if (entries) {
      var wrapT = entries.querySelector('.surflog-table-wrap');
      var cards = h('div', { class: 'pp-sessions', id: 'pp-sessions' });
      if (wrapT) wrapT.parentNode.insertBefore(cards, wrapT);
      var fs = entries.querySelector('fieldset');
      if (fs) fs.insertBefore(bar('Past sessions', '<span id="pp-sess-count"></span>'), fs.firstChild);
    }
    var form = el('panel-surflog-form');
    if (form) { var ffs = form.querySelector('fieldset'); if (ffs) { var lb = bar('Log a session', 'at Choc'); lb.style.marginTop = '4px'; ffs.insertBefore(lb, ffs.firstChild); } }
    var origRender = window.renderSurfLogTable;
    if (typeof origRender === 'function') {
      window.renderSurfLogTable = function () { var r = origRender.apply(this, arguments); try { renderSessions(); } catch (e) { err('sessions', e); } return r; };
    }
    // Conditions, in words and in the colour code — never a raw float.
    window.renderConditionsDisplay = function (cond) {
      var display = el('sl-conditions-display');
      if (!display || !cond) return;
      try { display.innerHTML = condHTML(cond); }
      catch (e) { err('cond', e); display.textContent = 'Conditions found.'; }
    };
  }
  function condHTML(cond) {
    var s = cond.swell || {}, w = cond.wind || {}, t = cond.tide;
    var num = function (v) { if (v == null || v === '') return null; v = +v; return isFinite(v) ? v : null; };
    var hh = num(s.height), pp = num(s.period), dd = num(s.direction);
    var cls = dd != null ? swellDirClass(dd) : null;
    var line = hh != null ? '<b>' + ftStr(hh) + 'ft @ ' + (pp != null ? Math.round(pp) : '–') + 's ' + (dd != null ? directionLabel(dd) : '') + '</b> ' + tagHTML(cls, true) : '<b>swell —</b>';
    if (s.secondary && num(s.secondary.height) != null) {
      var sd = num(s.secondary.direction);
      line += ' + ' + ftStr(num(s.secondary.height)) + 'ft @ ' + (num(s.secondary.period) != null ? Math.round(num(s.secondary.period)) : '–') + 's ' + (sd != null ? directionLabel(sd) : '');
    }
    var ws = num(w.speed), wdd = num(w.direction);
    line += '<span class="pp-sep"></span>wind ' + (ws != null && wdd != null ? '<b>' + Math.round(ws) + ' mph ' + directionLabel(wdd) + '</b> ' + windWord(windClass(ws, wdd), true) : '—');
    line += '<span class="pp-sep"></span>tide ' + (t && num(t.height) != null ? '<b>' + fmt1(num(t.height)) + 'ft</b> ' + esc(t.stage || '') : '— <i>(NOAA had no prediction)</i>');
    var src = { 'openmeteo-archive': 'Open-Meteo archive', 'ndbc-stdmet+openmeteo-wind': 'buoy 44097 swell + Open-Meteo wind', 'ndbc-stdmet': 'buoy 44097 (measured)', 'ndbc': 'buoy 44097 (measured)' }[cond.source] || (cond.source ? 'Open-Meteo marine' : '');
    var lag = num(cond.swellLagHours != null ? cond.swellLagHours : s.lagHours);
    var note = [src, lag && lag > 0 ? 'swell read ~' + fmt1(lag) + ' h earlier at the buoy' : ''].filter(Boolean).join(' · ');
    return '<div>' + line + '</div>' + (note ? '<span class="pp-cond-src">' + esc(note) + '</span>' : '');
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
    if (lows.length) { var c = clock(lows[0].t); opts.push({ k: 'low', t: lows[0].t, html: 'Morning low' + seg(c.hm + ' ' + c.ap) }); }
    else opts.push({ k: 'low', t: null, html: 'Morning low' + seg('—') });
    var c2 = clock(now - 2 * HOUR); opts.push({ k: '2h', t: now - 2 * HOUR, html: '2 h ago' + seg(c2.hm + ' ' + c2.ap) });
    var c3 = clock(now); opts.push({ k: 'now', t: now, html: 'Now' + seg(c3.hm + ' ' + c3.ap) });
    opts.push({ k: 'other', t: null, other: true, html: 'Other' + seg('…') });
    return opts;
  }
  function syncWhen() {
    var host = el('pp-when'), dt = el('sl-datetime');
    if (!host || !dt) return;
    var opts = whenOptions();
    var matched = opts.some(function (o) { return o.t != null && dt.value === localISO(o.t); });
    // The full date-time field only shows for "Other…" or an edited entry.
    var showPicker = host.dataset.other === '1' || (dt.value && !matched);
    dt.style.display = showPicker ? '' : 'none';
    host.innerHTML = opts.map(function (o) {
      var on = o.other ? !!showPicker : (o.t != null && dt.value === localISO(o.t));
      return '<button type="button" data-t="' + (o.t || '') + '"' + (o.other ? ' data-other="1"' : '') + ' aria-pressed="' + on + '"' + (o.t == null && !o.other ? ' disabled' : '') + '>' + o.html + '</button>';
    }).join('');
    host.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.other) { host.dataset.other = '1'; syncWhen(); try { dt.focus(); } catch (_) { /* no focus */ } return; }
        host.dataset.other = '';
        if (!b.dataset.t) return;
        dt.value = localISO(+b.dataset.t);
        dt.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  // Ratings use the model's violet ramp: what you rate is what it learns.
  function syncRates() {
    document.querySelectorAll('#panel-surflog-form .sl-slider-group').forEach(function (g) {
      var s = g.querySelector('.sl-range'); if (!s) return;
      var untouched = s.classList.contains('w1-untouched'), v = +s.value;
      // One colour per row — the bin of the value you chose, as in the
      // readout's meters — so the row reads as a meter, not a rainbow.
      var rv = ramp(v);
      g.querySelectorAll('.pp-rate button').forEach(function (b) {
        var k = +b.dataset.v, on = !untouched && k <= v;
        b.classList.toggle('on', on);
        if (on) { b.style.background = rv.bg; b.style.color = rv.fg; b.classList.toggle('is-light', rv.light); }
        else { b.style.background = ''; b.style.color = ''; b.classList.remove('is-light'); }
      });
      var slot = g.querySelector('.pp-rate-slot');
      if (slot) slot.outerHTML = '<span class="pp-rate-slot ' + (untouched ? 'pp-untouched' : 'pp-rate-val') + '">' + (untouched ? 'TAP TO RATE' : seg(v, 'pp-b') + '<span class="pp-u">/10</span>') + '</span>';
      var desc = g.querySelector('.sl-slider-desc'), pd = g.querySelector('.pp-rate-desc');
      if (pd) pd.textContent = untouched || !desc ? '' : (desc.textContent || '').trim();
    });
  }
  function condLine(c) {
    if (!c || !c.swell) return '';
    var s = c.swell, w = c.wind || {}, t = c.tide || {};
    var bits = [];
    if (s.height != null) bits.push(ftStr(+s.height) + 'ft @ ' + Math.round(+s.period || 0) + 's ' + directionLabel(s.direction));
    if (w.speed != null) bits.push(Math.round(+w.speed) + 'mph ' + directionLabel(w.direction));
    if (t.height != null) bits.push('tide ' + fmt1(+t.height) + ' ' + esc(t.stage || ''));
    return bits.join('<span class="pp-sep"></span>');
  }
  function renderSessions() {
    var host = el('pp-sessions');
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
    var cnt = el('pp-sess-count'); if (cnt) cnt.textContent = entries.length + ' logged';
    host.innerHTML = entries.slice(0, 40).map(function (e) {
      var d = new Date(e.timestamp), own = e.userId === window._fbUserId, r = e.ratings || {};
      var avg = avgOf(e), ck = clock(d);
      var photo = (e.photos || []).map(function (p) { return safeUrl(photoUrl(p)); }).filter(Boolean)[0];
      var date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() + " '" + String(d.getFullYear()).slice(2);
      return '<div class="pp-sess' + (inc(e) ? ' is-inc' : '') + '">' +
        '<div class="pp-sess-when">' + seg(ck.hm) + '<span class="pp-u" style="font-size:13px">' + ck.ap + '</span><span class="pp-cap" style="color:var(--pp-ink)">' + date + '</span>' +
          '<span class="who">' + (own ? 'YOU' : esc(e.displayName || 'CREW')) + '</span>' + (inc(e) ? '<span class="pp-inc-pill">INCOMPLETE</span>' : '') + '</div>' +
        '<div class="pp-sess-avg">' + scoreHTML(isFinite(avg) ? avg : null) + '<span class="pp-cap">AVG /10</span></div>' +
        '<div class="pp-sess-r"><span>SIZE</span>' + meter(r.size) + '<b>' + (r.size != null ? r.size : '–') + '</b>' +
          '<span>WIND</span>' + meter(r.windQuality) + '<b>' + (r.windQuality != null ? r.windQuality : '–') + '</b>' +
          '<span>RIDE</span>' + meter(r.rideQuality) + '<b>' + (r.rideQuality != null ? r.rideQuality : '–') + '</b></div>' +
        '<div class="pp-sess-notes">' + (photo ? '<img src="' + photo + '" alt="">' : '') + '<div>' + esc(String(e.notes || '').slice(0, 70)) +
          '<span class="cond">' + (condLine(e.conditions) || (inc(e) ? 'Conditions missing — edit to repair' : '')) + '</span></div></div>' +
        (own ? '<div class="pp-sess-act"><button type="button" class="sl-btn" data-edit="' + esc(e.id) + '">EDIT</button><button type="button" class="sl-btn" data-del="' + esc(e.id) + '">DELETE</button></div>' : '') +
        '</div>';
    }).join('');
    host.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { editLogEntry(b.dataset.edit); }); });
    host.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('Delete this session?')) deleteLogEntry(b.dataset.del); }); });
  }

  // ════════════════════════════════════════════════════════════════════
  // CHOC TV: One Instrument's layout on Chart Room's navy plotter
  // ════════════════════════════════════════════════════════════════════
  function moonSVG(date) {
    var syn = 29.530588853 * 864e5, epoch = Date.UTC(2000, 0, 6, 18, 14);
    var frac = (((date.getTime() - epoch) % syn) + syn) % syn / syn;
    var k = (1 - Math.cos(2 * Math.PI * frac)) / 2, r = 10, waxing = frac < 0.5;
    var rx = Math.abs(1 - 2 * k) * r;
    var limb = waxing ? 1 : 0, term = (k > 0.5) === waxing ? 1 : 0;
    var d = 'M12 2 A' + r + ' ' + r + ' 0 0 ' + limb + ' 12 22 A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + term + ' 12 2Z';
    return { pct: Math.round(k * 100), svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/><path d="' + d + '" fill="currentColor"/></svg>' };
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

  // Ghost figures (the owner's Choc TV pick: ghost segments always, bloom
  // on lit ones only): every big reading sits on a faint "8" in the same
  // face and width, like an instrument's unlit digits. Tabular figures
  // keep each 8 exactly behind its digit.
  function ghost(text, cls) {
    var t = String(text).replace(/!/g, ' ').replace(/(\d)-(\d)/g, '$1–$2');
    return '<span class="pp-gh"><span class="pp-seg pp-ghost ' + (cls || '') + '" aria-hidden="true">' + esc(t.replace(/\d/g, '8')) + '</span>' + seg(text, cls) + '</span>';
  }
  function tvDial(wd, wc) {
    return '<span class="pp-tvdial">' + dialSVG(wd.dir, wc) + '<span class="n">' + seg(Math.round(wd.mph)) + '<i>' + directionLabel(wd.dir) + '</i></span></span>';
  }
  function tvCardHTML(k) {
    var s = kioskDaySummary(k), d0 = startOfDay(Date.now(), k).getTime(), dl = sun(d0 + 12 * HOUR);
    var title = k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : new Date(d0).toLocaleDateString('en-US', { weekday: 'long' });
    var date = new Date(d0).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    var P = s.primary, S = s.secondary, html = '<div class="pp-tvday' + (k === tvLeadOffset() ? ' is-lead' : '') + '">';
    html += '<div class="pp-tvday-title"><span>' + title + '</span><span class="d">' + date + '</span></div>';
    if (P) {
      var out = P.cls === 'dir-out', range = P.min === P.max ? String(P.max) : P.min + '-' + P.max;
      // The window tag rides the caption line; the hero line prints the
      // compass word big enough to read across the room (tv-far), and the
      // arrow carries the exact bearing inside its ink.
      html += '<div><div class="pp-tvday-cap pp-tvcap-row"><span>' + (out ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + '</span>' + tagHTML(P.cls) + '</div>' +
        '<div class="pp-tvhero' + (out ? ' is-out' : '') + '"><div class="pp-tvhero-num">' + ghost(range, 'pp-xb') + '<span class="pp-u">ft</span></div>' +
        '<div class="pp-tvhero-sub"><span class="pp-at">@</span>' + ghost(P.period != null ? P.period : '–', 'pp-b') + '<span class="pp-u">s</span>' +
        '<span class="pp-tvhero-dir">' + directionLabel(P.dir) + '</span>' + arrowHTML(P.dir, arrowCls(P.cls), Math.round(P.dir) + '°') + '</div></div></div>';
    } else {
      html += '<div><div class="pp-tvday-cap">NO SWELL DATA</div></div>';
    }
    html += S ? '<div class="pp-tvsec"><span class="k">ALSO</span>' + seg(S.min === S.max ? S.max : S.min + '-' + S.max) + 'ft @ ' + seg(S.period != null ? S.period : '–') + 's ' + directionLabel(S.dir) +
        (S.cls === 'dir-out' ? '<span class="pp-blk">BLOCKED</span>' : tagHTML(S.cls, true)) + '</div>'
      : '<div class="pp-tvsec" style="visibility:hidden">–</div>';
    var wins = tvWindows(d0), lowWind = {};
    (s.lows || []).forEach(function (lo) { lowWind[lo.t] = lo.wind; });
    var bestIdx = -1;
    wins.forEach(function (w, i) { if (bestIdx < 0 && w.daylight && !w.past) bestIdx = i; });
    html += '<div class="pp-tvwins">';
    if (s.tidesDown) html += '<div class="pp-tvwin"><div class="pp-tvday-cap">NOAA TIDES DOWN · SWELL IS ALL DAYLIGHT</div></div>';
    wins.slice(0, 2).forEach(function (w, i) {
      var c1 = clock(w.daylight ? Math.max(w.low, w.a) : w.low), c2 = clock(w.daylight ? w.b : w.end), wd = lowWind[w.low], wc = wd ? windClass(wd.mph, wd.dir) : null;
      if (!w.daylight) {
        // A low after dark: one quiet line, dimmed and labelled.
        html += '<div class="pp-tvwin is-night' + (w.past ? ' is-past' : '') + '"><span class="pp-tvday-cap">' + ICON_MOON + 'LOW AFTER DARK</span>' +
          '<span class="t">' + seg(c1.hm, 'pp-b') + '<span class="pp-u">' + c1.ap + '</span></span>' +
          (wd ? '<span class="w">' + dialSVG(wd.dir, wc) + '<b>' + Math.round(wd.mph) + ' ' + directionLabel(wd.dir) + '</b>' + windWord(wc, true) + '</span>' : '') + '</div>';
        return;
      }
      var cls = 'pp-tvwin' + (w.past ? ' is-past' : '') + (i === bestIdx ? ' is-best' : '');
      var cap = w.low < w.a - 10 * 60e3 ? 'INCOMING FROM FIRST LIGHT' : 'INCOMING FROM LOW';
      // Time, then "until", on the left; the wind dial and its word on the right.
      html += '<div class="' + cls + '"><div class="pp-tvday-cap"><span><span class="pp-tri up"></span>' + cap + '</span></div>' +
        '<div class="pp-tvwin-t">' + ghost(c1.hm, 'pp-b') + '<span class="pp-u">' + c1.ap + '</span>' +
          (w.live ? '<span class="pp-nowtick">NOW</span>' : w.past ? '<span class="pp-donetick">DONE</span>' : '') + '</div>' +
        '<div class="pp-tvwind">' + (wd ? tvDial(wd, wc) + windWord(wc, true) : '<span class="pp-tvday-cap">NO WIND DATA</span>') + '</div>' +
        '<div class="pp-tvwin-to">until ' + seg(c2.hm) + ' ' + c2.ap + (w.hi && w.b >= w.hi.t - 60e3 ? ' high' : ' dark') + '</div></div>';
    });
    html += '</div>';
    var m = moonSVG(new Date(d0 + 12 * HOUR));
    var fl = dl.firstLight ? clock(dl.firstLight) : null, ll = dl.lastLight ? clock(dl.lastLight) : null;
    html += '<div class="pp-tvfoot">' + (fl && ll ? 'first light ' + seg(fl.hm) + ' ' + fl.ap + '<span class="pp-sep"></span>last ' + seg(ll.hm) + ' ' + ll.ap : '') +
      '<span class="moon">' + m.svg + m.pct + '%</span></div>';
    return html + '</div>';
  }

  // After the day's last daylight window (or sunset) the TV leads with
  // tomorrow under a TONIGHT header.
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
      var nx = lows[0] ? clock(lows[0].t) : null, fl = clock(sun(now + 864e5).firstLight);
      left = '<b class="t">Tonight</b><span class="n">dark until <b>' + fl.hm + ' ' + fl.ap + '</b>' +
        (nx ? '<span class="pp-sep"></span>next window <b>' + dow(lows[0].t) + ' ' + nx.hm + ' ' + nx.ap + '</b>' : '') + '</span>';
    } else {
      left = '<b class="t">This week at Choc</b><span class="n">what reaches the reef on the incoming tide</span>';
    }
    return '<span class="l">' + left + '</span><span class="r">' + ghost(c.hm, 'pp-b pp-tvclock') + '<span class="pp-u">' + c.ap + '</span></span>';
  }

  function kioskPaper() {
    var body = document.body;
    body.classList.add('pp');

    var prevChrome = kioskBuildChrome;
    window.kioskBuildChrome = function () {
      var r = prevChrome.apply(this, arguments);
      try {
        var app = el('app'), d1 = el('kiosk-days-1');
        if (app && d1) app.insertBefore(h('div', { id: 'pp-tvhead', class: 'pp-tvhead' }), d1);
        body.appendChild(h('div', { id: 'pp-veil', 'aria-hidden': 'true' }));
        body.appendChild(h('div', { id: 'pp-progress', 'aria-hidden': 'true' }));
        // Two honest ages, side by side: the forecast's, then the buoy's
        // (the same thresholds and glyphs as the phone's buoy chip).
        var upd = el('kiosk-status-updated'), bEl = el('kiosk-status-buoy');
        if (upd && bEl) upd.after(bEl);
        if (bEl) bEl.after(h('span', { class: 'pp-pips', id: 'pp-pips', 'aria-hidden': 'true' }));
        var info = el('kiosk-info'); if (info) info.textContent = 'SOURCES';
        var nxt = el('kiosk-next'); if (nxt) nxt.innerHTML = 'NEXT ' + CHEV_R;
        var radar = el('kiosk-radar');
        if (radar) {
          radar.appendChild(h('div', { id: 'pp-sweep' }, '<div class="arm"></div>'));
          radar.appendChild(h('div', { id: 'pp-echoes' }));
          radar.appendChild(h('div', { id: 'pp-radar-time', class: 'pp-radar-time' }));
        }
        var sl = document.querySelector('.forecast-card-swell .forecast-section-label');
        if (sl) sl.innerHTML = '<span>Swell</span><span class="pp-legend"><span>' + sw('reef') + 'reaches reef</span><span>' + sw('blocked') + 'blocked</span><span>' + sw('period') + 'period</span><span>' + sw('win') + 'window</span></span>';
        readTokens();
      } catch (e) { err('tvchrome', e); }
      return r;
    };

    // TODAY is home: never more than ~30 s away; radar is an interlude.
    KIOSK.panels = ['days1', 'radar', 'days1', 'days2', 'days1', 'spectral'];
    function progress(ms) {
      var p = el('pp-progress'); if (!p) return;
      p.classList.remove('run'); void p.offsetWidth;
      p.style.animationDuration = ms + 'ms'; p.classList.add('run');
    }
    function pips() {
      var host = el('pp-pips'); if (!host) return;
      var cur = body.dataset.kioskPanel, idx = KIOSK.panels[KIOSK.idx] === cur ? KIOSK.idx : KIOSK.panels.indexOf(cur);
      var name = { days1: 'Next 3 days', days2: 'Days 4–6', radar: 'Radar', spectral: 'Buoy now' };
      host.innerHTML = KIOSK.panels.map(function (p, i) { return '<i class="' + (p === 'days1' ? 'home ' : '') + (i === idx ? 'on' : '') + '"></i>'; }).join('') +
        '<span class="l">' + (name[cur] || '') + '</span>';
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
      for (var k = 0; k < 16; k++) { i = (i + 1) % n; if (lightAt(c.times[i].getTime()) === 'day') break; }
      KIOSK_RADAR.idx = i; STATE.scrubberIdx = i; applyScrubberToHour(i);
    };
    // No rAF loop: the sweep is a compositor layer (audit M1).
    window.kioskRadarLoop = function () { KIOSK_RADAR.raf = null; };
    var prevStart = kioskRadarStart;
    window.kioskRadarStart = function () { restartSweep(); return prevStart.apply(this, arguments); };

    // Panel change: a short fade to the navy ground and back. Opacity only.
    var prevShow = kioskShowPanel;
    var shown = false;
    window.kioskShowPanel = function (name) {
      var veil = el('pp-veil');
      var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      var go = function () { prevShow(name); pips(); renderHead(); };
      if (!veil || reduce || !shown) { shown = true; go(); return; }
      veil.classList.remove('off'); veil.classList.add('on');
      setTimeout(function () {
        go();
        requestAnimationFrame(function () { requestAnimationFrame(function () { veil.classList.add('off'); veil.classList.remove('on'); }); });
      }, 190);
    };
    var renderHead = guard('tvhead', function () { var hd = el('pp-tvhead'); if (hd) hd.innerHTML = tvHeadHTML(tvLeadOffset()); });
    window.kioskRenderDays = guard('tvdays', function () {
      var p1 = el('kiosk-days-1'), p2 = el('kiosk-days-2');
      if (!p1 || !p2 || !STATE.forecastData) return;
      var lead = tvLeadOffset();
      var o1 = [0, 1, 2].map(function (x) { return x + lead; }), o2 = [3, 4, 5].map(function (x) { return x + lead; });
      p1.className = 'np-days pp-tvdays';
      p2.className = 'np-days pp-tvdays';
      p1.innerHTML = o1.map(tvCardHTML).join('');
      p2.innerHTML = o2.map(tvCardHTML).join('');
      KIOSK.lastDaysRender = STATE.lastLoadCompletedAt || 0;
      renderHead();
    });
    var prevFresh = kioskShowFreshness;
    window.kioskShowFreshness = function (f) {
      prevFresh(f);
      var upd = el('kiosk-status-updated');
      if (upd) upd.innerHTML = '<span class="k">FORECAST</span> ' + esc(f.level === 'nodata' ? 'no data' : f.text);
      body.classList.toggle('pp-stale', f.level === 'stale');
      body.classList.toggle('pp-dead', f.level === 'dead' || f.level === 'nodata');
    };
    ['kioskPause', 'kioskResume', 'kioskResumeInPlace'].forEach(function (n) {
      var prev = window[n];
      window[n] = function () { var r = prev.apply(this, arguments); body.classList.toggle('pp-paused', KIOSK.state === 'paused'); return r; };
    });
    // The strip clock in the data face (shown where the header clock is
    // not), and the buoy's own age where the station name used to sit.
    var prevTick = kioskStatusTick;
    window.kioskStatusTick = function () {
      var r = prevTick.apply(this, arguments);
      var ck = el('kiosk-status-clock');
      if (ck) { var c = clock(Date.now()); ck.innerHTML = '<span class="d">' + dow(Date.now()) + '</span> ' + seg(c.hm, 'pp-b') + '<span class="pp-u">' + c.ap + '</span>'; }
      try { renderBuoyAge(); } catch (e) { err('buoyage', e); }
      return r;
    };
    function renderBuoyAge() {
      var be = el('kiosk-status-buoy'); if (!be) return;
      var bp = STATE.lastBuoyParsed, b = STATE.selectedBuoy;
      var age = bp && Number.isFinite(bp.obsMs) && typeof buoyObsAge === 'function' ? buoyObsAge(bp.obsMs) : null;
      var lvl = age ? (age.level === 'old' ? 'is-dead' : age.level === 'stale' ? 'is-stale' : '') : 'is-dead';
      be.innerHTML = '<span class="k">BUOY ' + esc(b ? b.id : '44097') + '</span><span class="pp-agechip ' + lvl + '">' + (age ? esc(age.label.replace(/ ago$/, ' old')) : 'no reading') + '</span>';
    }
    // Buoy now: the measured swell as the spectral panel's one answer.
    var prevSwell = updateSwellCard;
    window.updateSwellCard = function (bp, marine, buoy, band) {
      var r = prevSwell.apply(this, arguments);
      try { renderBuoyNow(bp, band); } catch (e) { err('buoynow', e); }
      return r;
    };
    window.kioskRadarPaint = ppRadarPaint;
    setInterval(guard('tvminute', function () {
      var p = body.dataset.kioskPanel;
      applyLight();
      if (p === 'days1' || p === 'days2') kioskRenderDays();
      body.classList.toggle('pp-calm', lightAt(Date.now()) === 'night');
    }), 60e3);
    body.classList.toggle('pp-calm', lightAt(Date.now()) === 'night');
    setTimeout(function () { pips(); renderHead(); }, 0);
    PP.freezeSweep = function (deg) { var a = document.querySelector('#pp-sweep .arm'); if (a) { a.style.animation = 'none'; a.style.transform = 'rotate(' + deg + 'deg)'; } };
  }

  function renderBuoyNow(bp, band) {
    var host = el('panel-spectral-summary');
    if (!host) return;
    var box = el('pp-buoy-now');
    if (!box) { box = h('div', { id: 'pp-buoy-now', class: 'pp-buoy-now' }); host.insertBefore(box, host.firstChild); }
    if (!bp || bp.waveHeight == null) { box.innerHTML = '<span class="pp-tvday-cap">NO BUOY READING</span>'; return; }
    var b = band && Number.isFinite(band.hsM) ? band : null;
    var ft = b ? b.hsM * 3.28084 : bp.waveHeight, p = b ? b.peakPeriod : bp.dominantPeriod;
    var d = b && b.dir != null ? Math.round(b.dir) : bp.meanDirection;
    var age = buoyObsAge(bp.obsMs), arr = p ? buoySwellArrivalText(p, bp.obsMs) : '';
    var lvl = age ? (age.level === 'old' ? 'is-dead' : age.level === 'stale' ? 'is-stale' : '') : '';
    var oc = clock(bp.obsMs), cls = d != null ? swellDirClass(d) : null;
    box.innerHTML = '<div class="pp-tvday-cap">BUOY 44097 · MEASURED ' + oc.hm + ' ' + oc.ap + ' <span class="pp-agechip ' + lvl + '">' + (age ? esc(age.label.replace(/ ago$/, ' old')) : '') + '</span></div>' +
      '<div class="pp-bn-read">' + seg(ftStr(ft), 'pp-xb') + '<span class="pp-u">ft</span><span class="pp-at">@</span>' + seg(p ? Math.round(p) : '–', 'pp-b') + '<span class="pp-u">s</span>' +
      '<span class="pp-bn-d">' + directionLabel(d) + (d != null ? ' ' + d + '°' : '') + '</span>' + tagHTML(cls) + '</div>' +
      '<div class="pp-bn-arr">' + (b ? (b.minPeriod || 8) + ' s+ swell' : 'total sea') + (arr ? ' · ' + esc(arr.replace('Choc', 'the reef')) : '') + '</div>';
  }

  var SWEEP = { epoch: 0, period: 10 };
  function restartSweep() {
    var arm = document.querySelector('#pp-sweep .arm');
    SWEEP.period = document.body.classList.contains('pp-calm') ? 30 : 10;
    if (arm) { arm.style.animation = 'none'; void arm.offsetWidth; arm.style.animation = ''; arm.style.animationDuration = SWEEP.period + 's'; }
    SWEEP.epoch = performance.now();
  }

  // The radar on the chart: navy water, dim buff land, a neutral rose
  // whose one magenta thing is the 115–158° window, readings lettered
  // along the arrows. Repainted once per
  // forecast hour (1 Hz at most), never per frame.
  function ppRadarPaint() {
    var cv = el('kiosk-radar-canvas');
    if (!cv || !cv.clientWidth) return;
    var ctx = cv.getContext('2d');
    var dims = ensureCanvasCssDims(cv, ctx), w = dims.cssW, hgt = dims.cssH;
    if (!w || !hgt) return;
    var vh = (window.innerHeight || 820) / 100;
    var CROP = 0.15, fh = hgt / (1 - CROP), fw = fh * KIOSK_COAST.aspect, fx = (w - fw) / 2 - w * 0.13, fy = -CROP * fh;
    var lx = fx + KIOSK_COAST.lineup[0] * fw, ly = fy + KIOSK_COAST.lineup[1] * fh, rMax = hgt * 0.56;
    var P = function (p) { return [fx + p[0] * fw, fy + p[1] * fh]; };
    var trace = function (pts) { pts.forEach(function (p, k) { var q = P(p); if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); };
    var shore = KIOSK_COAST.shore, endY = fy + shore[shore.length - 1][1] * fh;
    var c = cs(), i = KIOSK_RADAR.idx;
    var d = c && i >= 0 && i < c.times.length ? hourData(i) : null;
    var t = d ? d.t : Date.now(), dark = lightAt(t) !== 'day';
    var LAND = PP.light === 'night' ? '#141A1C' : '#1F2420', SHOAL = PP.light === 'night' ? '#0A1A27' : '#0E2233';

    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, w, hgt);
    ctx.save(); ctx.lineJoin = 'round';
    ctx.beginPath(); trace(shore); ctx.lineTo(w, endY);
    ctx.strokeStyle = SHOAL; ctx.lineWidth = fh * 0.07; ctx.stroke();
    ctx.beginPath(); shore.forEach(function (p, k) { var q = P(p); var yy = q[1] + fh * 0.075; if (k) ctx.lineTo(q[0], yy); else ctx.moveTo(q[0], yy); }); ctx.lineTo(w, endY + fh * 0.075);
    ctx.strokeStyle = C.rule2; ctx.lineWidth = 1.2; ctx.setLineDash([7, 6]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); trace(shore); ctx.lineTo(w, endY); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.lineTo(0, hgt); ctx.closePath();
    ctx.fillStyle = LAND; ctx.fill();
    KIOSK_COAST.ponds.forEach(function (pond) { ctx.beginPath(); trace(pond); ctx.closePath(); ctx.fillStyle = SHOAL; ctx.fill(); });
    ctx.beginPath(); trace(shore); ctx.lineTo(w, endY); ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
    // Compass rose around the lineup in neutral ink (magenta is kept for
    // the window alone), range rings dotted.
    ctx.save();
    ctx.strokeStyle = C.ink3; ctx.fillStyle = C.ink2; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(lx, ly, rMax, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(lx, ly, rMax * 0.93, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.stroke();
    for (var a = 0; a < 360; a += 2) {
      var th = a * Math.PI / 180, r0 = a % 10 === 0 ? rMax * 0.93 : a % 10 === 5 ? rMax * 0.955 : rMax * 0.975;
      ctx.beginPath(); ctx.moveTo(lx + Math.sin(th) * r0, ly - Math.cos(th) * r0); ctx.lineTo(lx + Math.sin(th) * rMax, ly - Math.cos(th) * rMax);
      ctx.lineWidth = a % 10 === 0 ? 1.4 : 0.9; ctx.stroke();
    }
    ctx.font = '600 ' + Math.round(1.9 * vh) + 'px ' + DATA_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var b = 0; b < 360; b += 30) {
      var u = b * Math.PI / 180, rr = rMax * 0.85, x = lx + Math.sin(u) * rr, y = ly - Math.cos(u) * rr;
      if (y < 8 || y > hgt - 8) continue;
      // Figures stand level, read from the couch at any bearing.
      ctx.fillText(('00' + b).slice(-3), x, y);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.rule2; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
    [1, 2].forEach(function (k) { ctx.beginPath(); ctx.arc(lx, ly, rMax * 0.93 * k / 3, 0, Math.PI * 2); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.restore();
    // The window: brighter the more energy reaches the reef this hour.
    var e = 0;
    if (d && d.lead) [d.lead, d.other].forEach(function (s) { if (s && s.h != null) e += _alignmentScore(s.d) * s.h * s.h; });
    var winE = Math.min(1, Math.sqrt(e) / 2.5);
    var c1 = (CH.swellWindowMin - 90) * Math.PI / 180, c2 = (CH.swellWindowMax - 90) * Math.PI / 180, rw = rMax * 0.93;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, rw, c1, c2); ctx.closePath();
    ctx.fillStyle = rgba(C.mag, 0.08 + winE * 0.18); ctx.fill();
    ctx.strokeStyle = C.mag; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(c1) * rw, ly + Math.sin(c1) * rw); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(c2) * rw, ly + Math.sin(c2) * rw); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(lx, ly, rw, c1, c2); ctx.stroke();
    var edge = function (deg, r) { return [lx + Math.sin(deg * Math.PI / 180) * r, ly - Math.cos(deg * Math.PI / 180) * r]; };
    ctx.fillStyle = C.mag; ctx.font = 'italic 600 ' + Math.round(2.6 * vh) + 'px ' + CHART_FONT;
    ctx.lineWidth = 5; ctx.strokeStyle = C.sheet; ctx.lineJoin = 'round';
    var bp1 = edge(CH.swellWindowMin, rMax + 1.4 * vh);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.strokeText('SW Pt (Block) ' + CH.swellWindowMin + '°', bp1[0], bp1[1] + 1.2 * vh); ctx.fillText('SW Pt (Block) ' + CH.swellWindowMin + '°', bp1[0], bp1[1] + 1.2 * vh);
    var bp2 = edge(CH.swellWindowMax, rMax + 1.2 * vh);
    ctx.textBaseline = 'top';
    var my = Math.min(bp2[1], hgt - 3.8 * vh);
    ctx.strokeText('Montauk Pt ' + CH.swellWindowMax + '°', bp2[0] + 1.4 * vh, my); ctx.fillText('Montauk Pt ' + CH.swellWindowMax + '°', bp2[0] + 1.4 * vh, my);
    ctx.restore();
    // Chart lettering.
    ctx.save();
    ctx.fillStyle = C.ink3; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 ' + Math.round(2.3 * vh) + 'px ' + CHART_FONT;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = Math.round(0.9 * vh) + 'px';
    // Chart lettering masks the lines it crosses (a halo in the land tint).
    ctx.lineWidth = 6; ctx.strokeStyle = LAND; ctx.lineJoin = 'round';
    // Stacked, left of the rose's ring, so the ring never cuts the name.
    ctx.strokeText('FISHERS', 2.4 * vh, 5.4 * vh); ctx.fillText('FISHERS', 2.4 * vh, 5.4 * vh);
    ctx.strokeText('ISLAND', 2.4 * vh, 9.2 * vh); ctx.fillText('ISLAND', 2.4 * vh, 9.2 * vh);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = Math.round(0.35 * vh) + 'px';
    // The sound's name sits in open water, clear of the coast and the ring.
    ctx.font = 'italic 400 ' + Math.round(3 * vh) + 'px ' + CHART_FONT;
    ctx.textAlign = 'right'; ctx.lineWidth = 6; ctx.strokeStyle = C.sheet;
    ctx.strokeText('Block Island Sound', w - 3 * vh, hgt - 3 * vh); ctx.fillText('Block Island Sound', w - 3 * vh, hgt - 3 * vh);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.restore();
    // After dark the world recedes; the readings stay full strength.
    if (dark) { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(0, 0, w, hgt); }

    var echoes = [];
    var labelSide = function (deg, others) { var sum = 0; others.forEach(function (o) { if (o != null) sum += (((o - deg) % 360) + 540) % 360 - 180; }); return sum > 0 ? -1 : 1; };
    var arrow = function (deg, len, o) {
      var th = deg * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th), px = -uy, py = ux;
      var gap = 2.6 * vh, hl = o.w * 3.2, hw = o.w * 2.2;
      var tx = lx + ux * gap, ty = ly + uy * gap, bx2 = lx + ux * (gap + hl), by2 = ly + uy * (gap + hl), ex = lx + ux * (gap + len), ey = ly + uy * (gap + len);
      ctx.save();
      ctx.strokeStyle = o.c; ctx.fillStyle = o.c; ctx.lineWidth = o.w; ctx.lineCap = o.dots ? 'round' : o.dash ? 'butt' : 'round';
      if (o.ghost) {
        // Blocked swell: a hollow grey ghost shaft, so dashes mean wind only.
        ctx.lineCap = 'butt'; ctx.lineWidth = o.w + 2.4;
        ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = C.sheet; ctx.lineWidth = Math.max(1.5, o.w - 1.2);
        ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = o.c;
      } else {
        if (o.dash) ctx.setLineDash(o.dash);
        ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx2 + px * hw, by2 + py * hw); ctx.lineTo(bx2 - px * hw, by2 - py * hw); ctx.closePath();
      if (o.hollow) { ctx.lineWidth = 2; ctx.stroke(); } else ctx.fill();
      if (o.label) {
        ctx.font = '700 ' + Math.round(o.fs * vh) + 'px ' + DATA_FONT;
        var mpos = gap + hl + (len - hl) * (o.at || 0.55);
        var ang = Math.atan2(uy, ux);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        var sd = o.side || 1, off = (o.fs * 0.62 + o.w / vh * 0.6) * vh;
        ctx.translate(lx + ux * mpos + px * off * sd, ly + uy * mpos + py * off * sd);
        ctx.rotate(ang);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 6; ctx.strokeStyle = C.sheet; ctx.lineJoin = 'round';
        ctx.strokeText(o.label, 0, 0); ctx.fillStyle = o.lc || o.c; ctx.fillText(o.label, 0, 0);
      }
      ctx.restore();
      echoes.push({ deg: deg, x: lx + ux * (gap + len * 0.6), y: ly + uy * (gap + len * 0.6), big: !!o.big });
    };
    if (d) {
      var len = function (hh, pp) { return Math.max(9 * vh, Math.min(rMax * 0.72, Math.sqrt((hh || 0) * (hh || 0) * (pp || 1)) * 7.5 * vh)); };
      var L = d.lead, O = d.other, Wn = d.wind;
      var dirs = [L ? L.d : null, O ? O.d : null, Wn ? Wn.dir : null];
      var WCOL = { off: C.off, cross: C.cross, on: C.on };
      // Wind shafts carry the dial ring's pattern: solid · long dash · dotted.
      var WD = { off: null, cross: [1.6 * vh, 0.8 * vh], on: [0.01, 1.05 * vh] };
      if (Wn && Wn.dir != null) arrow(Wn.dir, Math.max(15 * vh, Math.min(rMax * 0.7, Wn.mph * 1.6 * vh)), { c: WCOL[Wn.cls] || C.ink2, w: (Wn.cls === 'on' ? 0.7 : 0.55) * vh, dash: WD[Wn.cls], dots: Wn.cls === 'on', label: Math.round(Wn.mph) + 'mph ' + (WIND_WORD[Wn.cls] || '').toLowerCase(), fs: 2.4, at: 0.62, side: labelSide(Wn.dir, [dirs[0], dirs[1]]) });
      if (O && O.d != null) arrow(O.d, Math.max(17 * vh, len(O.h, O.p) * 0.9), { c: O.cls === 'dir-out' ? C.grey : C.reefInk, lc: O.cls === 'dir-out' ? C.ink2 : C.reefInk, w: 0.6 * vh, ghost: O.cls === 'dir-out', hollow: O.cls === 'dir-out', label: ftStr(O.h) + 'ft @ ' + (O.p != null ? Math.round(O.p) : '–') + 's' + (O.cls === 'dir-out' ? ' · blocked' : ''), fs: 2.4, at: 0.66, side: labelSide(O.d, [dirs[0], dirs[2]]) });
      if (L && L.d != null) arrow(L.d, len(L.h, L.p), { c: L.cls === 'dir-out' ? C.grey : C.reefInk, lc: L.cls === 'dir-out' ? C.ink2 : '#FFFFFF', w: 1.1 * vh, ghost: L.cls === 'dir-out', hollow: L.cls === 'dir-out', big: L.cls !== 'dir-out', label: ftStr(L.h) + 'ft @ ' + (L.p != null ? Math.round(L.p) : '–') + 's', fs: 3.4, side: labelSide(L.d, [dirs[1], dirs[2]]) });
    } else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.round(2.4 * vh) + 'px ' + DATA_FONT; ctx.fillStyle = C.ink2;
      ctx.fillText('AWAITING FORECAST DATA', w / 2, hgt / 2 + rMax / 2);
    }
    ctx.beginPath(); ctx.arc(lx, ly, 1.1 * vh, 0, Math.PI * 2); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(lx, ly, 0.4 * vh, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();

    // Sweep + echoes: DOM layers on the compositor, synced to one epoch.
    var swp = el('pp-sweep');
    if (swp) { swp.style.left = lx + 'px'; swp.style.top = ly + 'px'; swp.style.setProperty('--r', (rMax * 0.93) + 'px'); }
    var host = el('pp-echoes');
    if (host) {
      if (!SWEEP.epoch) restartSweep();
      var Tn = ((performance.now() - SWEEP.epoch) / 1000) % SWEEP.period;
      host.innerHTML = echoes.map(function (ec) {
        var peak = ((ec.deg % 360) + 360) % 360 / 360 * SWEEP.period;
        var delay = -(((Tn - peak) % SWEEP.period) + SWEEP.period) % SWEEP.period;
        return '<span class="pp-echo" style="left:' + ec.x.toFixed(1) + 'px;top:' + ec.y.toFixed(1) + 'px"><i style="animation-duration:' + SWEEP.period + 's;animation-delay:' + delay.toFixed(2) + 's' + (ec.big ? '' : ';transform:scale(.7)') + '"></i></span>';
      }).join('');
    }
    renderRadarTime(d);
  }

  // Forecast position, not a clock: the hour shown, its offset, a 48 h
  // daylight timeline, and the one number to read from across the room.
  function renderRadarTime(d) {
    var host = el('pp-radar-time'), c = cs();
    if (!host || !c || !d) { if (host) host.innerHTML = ''; return; }
    var dh = Math.round((d.t - Date.now()) / HOUR);
    var t0 = c.times[Math.max(0, nowIdx())].getTime(), span = 48 * HOUR;
    var pos = Math.max(0, Math.min(1, (d.t - t0) / span));
    var bands = '';
    for (var k = 0; k < 3; k++) {
      var dl = sun(startOfDay(t0, k).getTime() + 12 * HOUR);
      if (!dl.sunrise) continue;
      var a = (dl.sunrise.getTime() - t0) / span, b = (dl.sunset.getTime() - t0) / span;
      if (b > 0 && a < 1) bands += '<i style="left:' + (Math.max(0, a) * 100).toFixed(2) + '%;width:' + ((Math.min(1, b) - Math.max(0, a)) * 100).toFixed(2) + '%"></i>';
    }
    var ck = clock(d.t), L = d.lead;
    host.innerHTML = '<div class="when"><span class="dw">' + dow(d.t) + '</span>' + seg(ck.hm, 'pp-b') + '<span class="pp-u">' + ck.ap + '</span></div>' +
      '<div class="off">' + (Math.abs(dh) < 1 ? '<span class="pp-nowtick">NOW</span>' : '<span class="plus">' + (dh > 0 ? '+' : '−') + Math.abs(dh) + ' h</span>') + (lightAt(d.t) !== 'day' ? darkTag() : '') + '</div>' +
      '<div class="line"><div class="days">' + bands + '</div><span class="head" style="left:' + (pos * 100).toFixed(2) + '%"></span></div>' +
      (L ? '<div class="pp-tvday-cap">' + (L.cls === 'dir-out' ? 'NOTHING IN THE WINDOW' : 'REACHES THE REEF') + '</div>' +
        '<div class="read">' + seg(ftStr(L.h), 'pp-xb') + '<span class="pp-u">ft</span><span class="pp-at">@</span>' + seg(L.p != null ? Math.round(L.p) : '–', 'pp-b') + '<span class="pp-u">s</span></div>' +
        '<div class="tagrow">' + tagHTML(L.cls) + (d.wind ? '<span class="wind">' + Math.round(d.wind.mph) + ' mph ' + windWord(d.wind.cls, true) + '</span>' : '') + '</div>' : '');
  }

  // ════════════════════════════════════════════════════════════════════
  // Install
  // ════════════════════════════════════════════════════════════════════
  function installShared() {
    FC_CHART_FONT = DATA_FONT;
    if (!KIOSK_ON && window.innerWidth < 600) { FC_PAD.left = 36; FC_PAD.right = 32; }
    window.drawSwellPanel = ppDrawSwellPanel;
    window.drawWindPanel = ppDrawWindPanel;
    window.drawTidePanel = ppDrawTidePanel;
    window.renderDayLabels = ppRenderDayLabels;
    window.startNowPulse = function () { placeNowDot(); };
    window.stopNowPulse = function () { var d = el('pp-nowdot'); if (d) d.style.display = 'none'; };
    var prevApply = applyScrubberToHour;
    window.applyScrubberToHour = function (idx) { prevApply(idx); onHour(idx); };
    var prevDraw = drawForecastChart;
    window.drawForecastChart = function () { var r = prevDraw.apply(this, arguments); afterChart(); return r; };
    setInterval(guard('minute', function () { placeNowDot(); syncLed(); applyLight(); }), 60e3);
  }

  function installWeb() {
    window.drawLineupMap = ppDrawLineupMap;
    // A load finished (good or failed): the status light and the readout's
    // age line follow STATE.dataAsOf, the same contract Choc TV reads.
    var prevHealth = recordDataHealth;
    window.recordDataHealth = function () { var r = prevHealth.apply(this, arguments); try { syncLed(); onHour(selIdx()); } catch (e) { err('health', e); } return r; };
    var prevSwellCard = updateSwellCard;
    window.updateSwellCard = function () { var r = prevSwellCard.apply(this, arguments); try { if (selIdx() === nowIdx()) onHour(selIdx()); summaries(); } catch (e) { err('swellcard', e); } return r; };
    var prevSwitch = switchTab;
    window.switchTab = function (tab) {
      var r = prevSwitch.apply(this, arguments);
      var key = tab === 'surflog' ? 'log' : tab === 'regression' ? 'model' : (document.body.classList.contains('pp-setup') ? 'set' : 'fcst');
      document.querySelectorAll('#pp-keys .pp-key').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.key === key ? 'true' : 'false'); });
      if (tab === 'surflog') { try { syncWhen(); syncRates(); renderSessions(); } catch (e) { err('logtab', e); } }
      return r;
    };
  }

  try {
    document.body.classList.add('pp');
    applyLight(true);
    installShared();
    if (KIOSK_ON) {
      kioskPaper();
    } else {
      buildWeb();
      installWeb();
      renderReadout(null);
    }
    PP.ready = true;
  } catch (e) {
    err('install', e);
    PP.ready = true;
  }
})();
