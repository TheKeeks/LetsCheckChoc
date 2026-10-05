// ════════════════════════════════════════════════════════════════════
// CLEAN — core (owner: Core) · ?preview=clean
// ────────────────────────────────────────────────────────────────────
// The "A refined" design (Claude Design boards) over the REAL app. This
// file owns window.CLEAN, the shared API the four parts build on
// (forecast.js, log.js, model.js, tv.js); previews/clean/CONTRACT.md
// documents every call. It:
//   • mounts the shell: phone = header, three tab views, tab bar and
//     the Settings sub-page; Choc TV (?kiosk=1) = one empty root that
//     tv.js owns. Legacy nodes stay in the DOM (parts drive them), the
//     legacy chrome is hidden by theme.css under html.cl-on;
//   • skips the boat gate (the app's own "No, continue" path, minus the
//     sessionStorage write, so the plain URL keeps asking);
//   • runs day/night: night from sunset to sunrise at the spot (the
//     app's NOAA calcDaylight), or the viewer's pick in Settings;
//   • adapts the app's data into small null-safe readings (now, week,
//     hour, sources), with formatting and the boards' icons;
//   • wraps a few app.js globals (function declarations are writable
//     globals; kiosk.js does the same) to raise 'data', 'auth', 'log',
//     'model' and 'hour' events. app.js, kiosk.js and firebase-config.js
//     are never edited.
// Every render and every hook runs inside try/catch: a failing part
// never blanks the app, and a failing core leaves the classic app.
// Times are America/New_York, the spot's (and the crew's) time zone.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.CLEAN) return;

  var CLEAN = window.CLEAN = {
    version: 1,
    ready: false,      // true once the shell is mounted
    isTV: false,
    errors: []         // [{ where, message, at }] — check in tests / shots
  };

  var HOUR = 3600e3, MIN = 60e3, DAY = 864e5;
  var TZ = 'America/New_York';
  var NB = ' ';   // between a number and its unit, so "8 s" never wraps
  var DASH = '—'; // missing data
  var CH = (typeof CONFIG !== 'undefined' && CONFIG.chocomount) || {
    lat: 41.275693, lon: -71.963310, forecastLat: 41.089152, forecastLon: -71.72105,
    buoyId: '44097', tideStation: '8510719', waterTempStation: '8510560',
    swellWindowMin: 115, swellWindowMax: 158, swellWindowEdge: 5,
    buoyLat: 40.969, buoyLon: -71.124, buoyDistanceMiles: 50
  };
  var IS_TV = false;
  try { IS_TV = typeof isKioskMode === 'function' && isKioskMode(); } catch (_) { IS_TV = false; }
  CLEAN.isTV = IS_TV;

  // ── Errors ─────────────────────────────────────────────────────────
  function err(where, e) {
    var msg = e && e.message ? e.message : String(e);
    CLEAN.errors.push({ where: where, message: msg, at: Date.now() });
    if (CLEAN.errors.length > 200) CLEAN.errors.shift();
    try { console.warn('[CLEAN] ' + where + ': ' + msg, e && e.stack ? e.stack : ''); } catch (_) { /* no console */ }
  }
  function guard(where, fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { err(where, e); return undefined; }
    };
  }
  CLEAN.err = err;
  CLEAN.guard = guard;

  // ── Events ─────────────────────────────────────────────────────────
  var handlers = {};
  function on(evt, fn) {
    if (typeof fn !== 'function') return function () {};
    (handlers[evt] = handlers[evt] || []).push(fn);
    return function () { off(evt, fn); };
  }
  function off(evt, fn) {
    var a = handlers[evt];
    if (!a) return;
    var i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  function emit(evt, arg) {
    (handlers[evt] || []).slice().forEach(function (fn) {
      try { fn(arg); } catch (e) { err('on:' + evt, e); }
    });
  }
  // Coalesce bursts (renderSurfLogTable runs several times per action).
  var soonTimers = {};
  function emitSoon(evt, arg) {
    if (soonTimers[evt]) return;
    soonTimers[evt] = setTimeout(function () { soonTimers[evt] = null; emit(evt, arg); }, 0);
  }
  CLEAN.on = on;
  CLEAN.off = off;
  CLEAN.emit = emit;

  // ── Small utilities ────────────────────────────────────────────────
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function norm360(d) { return ((d % 360) + 360) % 360; }
  function toDate(t) {
    if (t == null) return null;
    var d = t instanceof Date ? t : new Date(t);
    return isFinite(d.getTime()) ? d : null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // h('div', { class: 'x', 'aria-label': 'y', onclick: fn }, '<b>html</b>' | [nodes])
  function h(tag, attrs, content) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    if (content != null) {
      if (Array.isArray(content)) content.forEach(function (c) { if (c) e.appendChild(c); });
      else if (content.nodeType) e.appendChild(content);
      else e.innerHTML = content;
    }
    return e;
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }

  // ── Time zone helpers (America/New_York) ───────────────────────────
  var dtfCache = {};
  function dtf(key, opts) {
    if (dtfCache[key]) return dtfCache[key];
    try {
      dtfCache[key] = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, opts));
    } catch (_) {
      dtfCache[key] = new Intl.DateTimeFormat('en-US', opts); // no tz support: device time
    }
    return dtfCache[key];
  }
  function partsOf(d, key, opts) {
    var out = {};
    dtf(key, opts).formatToParts(d).forEach(function (p) { out[p.type] = p.value; });
    return out;
  }
  // "2026-10-01" in spot time
  function dayKey(t) {
    var d = toDate(t);
    if (!d) return '';
    var p = partsOf(d, 'ymd', { year: 'numeric', month: '2-digit', day: '2-digit' });
    return p.year + '-' + p.month + '-' + p.day;
  }
  // Local midnight of t's calendar day, offset by `days` (the app and
  // kiosk.js count days from device-local midnight; the crew is on ET).
  function startOfDay(t, days) {
    var d = new Date(toDate(t) || Date.now());
    d.setHours(0, 0, 0, 0);
    if (days) d.setDate(d.getDate() + days);
    return d;
  }

  // ════════════════════════════════════════════════════════════════════
  // FORMATTING — one number style everywhere: "1.6 ft @ 8 s"
  // ════════════════════════════════════════════════════════════════════
  var COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(deg) {
    if (!isNum(deg)) return DASH;
    return COMPASS16[Math.round(norm360(deg) / 22.5) % 16];
  }
  function heightNum(v) {
    if (!isNum(v)) return null;
    return Math.abs(v) >= 9.95 ? String(Math.round(v)) : round1(v).toFixed(1);
  }
  function rangeNum(min, max) {
    var a = isNum(min) ? Math.round(min) : null, b = isNum(max) ? Math.round(max) : null;
    if (a == null && b == null) return null;
    if (a == null || b == null || a === b) return String(a == null ? b : a);
    return Math.min(a, b) + '–' + Math.max(a, b);
  }
  function timeStr(t) {
    var d = toDate(t);
    if (!d) return DASH;
    return dtf('time', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/\s+/g, NB);
  }
  function isTodayET(t) { return dayKey(t) === dayKey(new Date()); }

  var fmt = {
    NB: NB,
    DASH: DASH,
    // "1.6" (one decimal, whole numbers from 10 ft), or "—"
    num: function (v) { var s = heightNum(v); return s == null ? DASH : s; },
    // "1.6 ft"
    ft: function (v) { var s = heightNum(v); return s == null ? DASH : s + NB + 'ft'; },
    // "1–2" (whole feet, en dash), "1" when equal
    range: function (min, max) { var s = rangeNum(min, max); return s == null ? DASH : s; },
    // "8 s"
    period: function (p) { return isNum(p) ? Math.round(p) + NB + 's' : DASH; },
    // swell(1.6, 8) → "1.6 ft @ 8 s"; swell([1, 2], 8, 112) → "1–2 ft @ 8 s ESE";
    // dir may be degrees or a compass string. Missing height → "—",
    // missing period → "1.6 ft @ —".
    swell: function (hgt, period, dir) {
      var hs = Array.isArray(hgt) ? rangeNum(hgt[0], hgt[1]) : heightNum(hgt);
      if (hs == null) return DASH;
      var s = hs + NB + 'ft @ ' + (isNum(period) ? Math.round(period) + NB + 's' : DASH);
      if (dir != null && dir !== '') s += ' ' + (typeof dir === 'string' ? dir : compass(dir));
      return s;
    },
    compass: compass,
    // "118°"
    deg: function (d) { return isNum(d) ? Math.round(norm360(d)) + '°' : DASH; },
    // "7 mph SW" ("7 mph" without a direction)
    wind: function (mph, dir) {
      if (!isNum(mph)) return DASH;
      return Math.round(mph) + NB + 'mph' + (isNum(dir) ? ' ' + compass(dir) : '');
    },
    // "2.3 ft ▲" (▼ falling; no arrow when unknown)
    tide: function (hgt, rising) {
      if (!isNum(hgt)) return DASH;
      var v = round1(hgt);
      var s = (v < 0 ? '−' + Math.abs(v).toFixed(1) : v.toFixed(1)) + NB + 'ft';
      return rising === true ? s + ' ▲' : rising === false ? s + ' ▼' : s;
    },
    arrow: function (rising) { return rising === true ? '▲' : rising === false ? '▼' : ''; },
    // "7:28 AM" (no-break space before AM/PM), spot time
    time: timeStr,
    // "Thu"
    day: function (t) { var d = toDate(t); return d ? dtf('wd', { weekday: 'short' }).format(d) : DASH; },
    // "Thursday"
    dayLong: function (t) { var d = toDate(t); return d ? dtf('wdl', { weekday: 'long' }).format(d) : DASH; },
    // "Thu 1 Oct"
    date: function (t) {
      var d = toDate(t);
      if (!d) return DASH;
      var p = partsOf(d, 'date', { weekday: 'short', day: 'numeric', month: 'short' });
      return p.weekday + ' ' + p.day + ' ' + p.month;
    },
    // "Today" / "Tomorrow" (opts.tomorrow) / "Fri"
    dayLabel: function (t, opts) {
      var d = toDate(t);
      if (!d) return DASH;
      if (isTodayET(d)) return 'Today';
      if (opts && opts.tomorrow && dayKey(d) === dayKey(new Date(Date.now() + DAY))) return 'Tomorrow';
      return fmt.day(d);
    },
    // "11:00 AM" today, "Wed 6:12 PM" on any other day
    when: function (t) {
      var d = toDate(t);
      if (!d) return DASH;
      return isTodayET(d) ? timeStr(d) : fmt.day(d) + ' ' + timeStr(d);
    },
    // "just now", "14 min ago", "2h 30m ago" (the app's formatAgo)
    ago: function (t) {
      var d = toDate(t);
      if (!d) return DASH;
      if (typeof formatAgo === 'function') return formatAgo(d);
      var m = Math.round((Date.now() - d.getTime()) / MIN);
      return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago';
    },
    // "2h 30m old" / "14 min old" / "just now"
    age: function (t) { var s = fmt.ago(t); return s.replace(/ ago$/, ' old'); },
    // quality('cross') → "cross"; quality('cross', 'long') → "cross-shore";
    // quality('cross', 'caps') → "CROSS-SHORE"
    quality: function (q, style) {
      if (!q) return '';
      var w = q === 'cross' && style ? 'cross-shore' : q;
      return style === 'caps' ? w.toUpperCase() : w;
    },
    // status('in') → "IN WINDOW"; status('in', true) → "IN"
    status: function (s, short) {
      return s === 'in' ? (short ? 'IN' : 'IN WINDOW') : s === 'edge' ? 'EDGE' : s === 'blocked' ? 'BLOCKED' : '';
    },
    // model score "3.8"
    score: function (v) { return isNum(v) ? round1(v).toFixed(1) : DASH; }
  };
  CLEAN.fmt = fmt;

  // ════════════════════════════════════════════════════════════════════
  // DOMAIN RULES
  // ════════════════════════════════════════════════════════════════════
  // Window status of a swell direction: in 115–158°, edge within 5°,
  // else blocked (Montauk or Block Island stops it). Same rule as
  // app.js swellDirClass, without its isChocomount gate.
  function statusFor(dir) {
    if (!isNum(dir)) return null;
    var d = norm360(dir), lo = CH.swellWindowMin, hi = CH.swellWindowMax, ed = CH.swellWindowEdge;
    if (d >= lo && d <= hi) return 'in';
    if ((d >= lo - ed && d < lo) || (d > hi && d <= hi + ed)) return 'edge';
    return 'blocked';
  }
  // 1 inside the window, fading to 0 over 30° outside (app.js
  // _alignmentScore, the model's own rule).
  function alignment(dir) {
    if (!isNum(dir)) return 0;
    if (typeof _alignmentScore === 'function') return _alignmentScore(norm360(dir));
    var d = norm360(dir), lo = CH.swellWindowMin, hi = CH.swellWindowMax;
    if (d >= lo && d <= hi) return 1;
    var out = d < lo ? lo - d : d - hi;
    return out >= 30 ? 0 : 1 - out / 30;
  }
  // The chart's wind rule: offshore centre 335° (the reef faces 335°),
  // < 60° off it offshore, < 120° cross, else onshore; under 5 mph
  // upgrades one tier so calm hours don't read as bad wind.
  function windQuality(mph, dir) {
    if (!isNum(dir)) return null;
    var C = 335;
    var gap = Math.min(norm360(dir - C), norm360(C - dir));
    var q = gap < 60 ? 'offshore' : gap < 120 ? 'cross' : 'onshore';
    if (isNum(mph) && mph < 5) q = q === 'cross' ? 'offshore' : q === 'onshore' ? 'cross' : q;
    return q;
  }
  function qualityClass(q) { return q === 'offshore' ? 'cl-q-off' : q === 'cross' ? 'cl-q-crs' : q === 'onshore' ? 'cl-q-on' : ''; }
  function statusClass(s) { return s === 'in' ? 'cl-st-in' : s === 'edge' ? 'cl-st-edge' : s === 'blocked' ? 'cl-st-blk' : ''; }

  CLEAN.util = {
    esc: esc, h: h, isNum: isNum, round1: round1, clamp: clamp, toDate: toDate,
    dayKey: dayKey, startOfDay: startOfDay, reducedMotion: reducedMotion,
    statusFor: statusFor, alignment: alignment, windQuality: windQuality,
    qualityClass: qualityClass, statusClass: statusClass
  };
  // Ready-made HTML for the two coded words.
  CLEAN.html = {
    // <span class="cl-st cl-st-in"><i class="cl-dt"></i>IN WINDOW</span>
    // opts: { short: true → "IN", small: true → week-row size, pill: true → night pill }
    status: function (s, opts) {
      if (!s) return '';
      opts = opts || {};
      return '<span class="cl-st ' + statusClass(s) + (opts.small ? ' cl-st-sm' : '') + (opts.pill ? ' cl-st-pill' : '') +
        '"><i class="cl-dt" aria-hidden="true"></i>' + fmt.status(s, opts.short) + '</span>';
    },
    // <span class="cl-q-crs">cross</span>; style as fmt.quality
    quality: function (q, style) {
      if (!q) return '';
      return '<span class="' + qualityClass(q) + '">' + esc(fmt.quality(q, style)) + '</span>';
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // ICONS — inline SVG strings, paths copied from the boards (A-Icons,
  // A-Wind-Barb, A2-*). All take currentColor; size in CSS px.
  // ════════════════════════════════════════════════════════════════════
  var P = {
    forecast: 'M3 9c3-3 6 3 9 0s6-3 9 0M3 15c3-3 6 3 9 0s6-3 9 0',
    log: 'M4 20l1-4.5L16 4.5 19.5 8 8.5 19zM14 6.5l3.5 3.5',
    model: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    back: 'M15 5l-7 7 7 7',
    chevronRight: 'M9 6l6 6-6 6',
    chevronLeft: 'M15 6l-6 6 6 6',
    chevronDown: 'M6 9l6 6 6-6',
    chevronsLeft: 'M13 6l-6 6 6 6M20 6l-6 6 6 6',
    chevronsRight: 'M4 6l6 6-6 6M11 6l6 6-6 6',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
    swell: 'M12 3l6.5 15.5L12 15l-6.5 3.5z',
    windArrow: 'M12 18V4M6 10l6-6 6 6M12 18l-3.5 3.5M12 18l3.5 3.5',
    tide: '<path d="M2 6c4 0 5 12 10 12s6-12 10-12"/><path class="th dash" d="M12 2.5v12"/><circle class="f" cx="12" cy="18" r="2.4"/>',
    tideHigh: '<path d="M2 18c4 0 5-12 10-12s6 12 10 12"/><path class="th dash" d="M12 21.5v-12"/><circle class="f" cx="12" cy="6" r="2.4"/>',
    // 7×7 arrow for wind bars inside a chart SVG, centred on 0,0, pointing up
    chartArrow: 'M0 3.5V-3.5M-3 -0.5L0 -3.5L3 -0.5'
  };
  function inner(p) { return p.charAt(0) === '<' ? p : '<path d="' + p + '"/>'; }
  function svgIcon(path, size, opts) {
    opts = opts || {};
    var s = size || 24;
    var rot = isNum(opts.rotate) ? '<g transform="rotate(' + Math.round(norm360(opts.rotate)) + ' 12 12)">' + inner(path) + '</g>' : inner(path);
    return '<svg class="cl-ic' + (opts.cls ? ' ' + opts.cls : '') + '" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' +
      (opts.stroke ? ' style="stroke-width:' + opts.stroke + '"' : '') + '>' + rot + '</svg>';
  }
  // Wind barb (A-Wind-Barb): the ring end is where the wind is headed,
  // staff and ticks trail back to where it came from. Short tick 5 mph,
  // long tick 10, solid flag 50, rounded to the nearest 5; under 3 mph a
  // calm double ring. Ink only: quality colour stays on the word.
  function barbInner(mph) {
    if (!isNum(mph)) return null;
    if (mph < 3) return '<circle cx="16" cy="16" r="2.5"/><circle cx="16" cy="16" r="5.5"/>';
    var n5 = Math.max(1, Math.round(mph / 5));
    var flags = Math.floor(n5 / 10); n5 -= flags * 10;
    var longs = Math.floor(n5 / 2), shorts = n5 % 2;
    var slots = flags * 2 + longs + shorts;
    var step = 3.5, maxY = 11;
    if (slots > 1 && 4 + (slots - 1) * step > maxY) step = (maxY - 4) / (slots - 1);
    var y = (flags || longs) ? 4 : 7.5; // a lone 5 mph tick sits in from the tip
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var d = 'M16 13.5V4', fills = '';
    for (var i = 0; i < flags; i++) { fills += '<path d="M16 ' + r2(y) + 'l7 0-7 4.5z" fill="currentColor"/>'; y += 2 * step; }
    for (var j = 0; j < longs; j++) { d += 'M16 ' + r2(y) + 'l7-3'; y += step; }
    if (shorts) d += 'M16 ' + r2(y) + 'l3.5-1.5';
    return '<circle cx="16" cy="16" r="2.5"/><path d="' + d + '"/>' + fills;
  }
  var icon = {
    paths: P,
    forecast: function (s) { return svgIcon(P.forecast, s || 24); },
    log: function (s) { return svgIcon(P.log, s || 24); },
    model: function (s) { return svgIcon(P.model, s || 24); },
    settings: function (s) { return svgIcon(P.settings, s || 22); },
    back: function (s) { return svgIcon(P.back, s || 22); },
    chevronRight: function (s) { return svgIcon(P.chevronRight, s || 18); },
    chevronLeft: function (s) { return svgIcon(P.chevronLeft, s || 18); },
    chevronDown: function (s) { return svgIcon(P.chevronDown, s || 18); },
    // the chart's jump buttons: 14 px, 2.5 stroke
    jumpLeft: function (s) { return svgIcon(P.chevronLeft, s || 14, { cls: 'cl-ic-bold' }); },
    jumpRight: function (s) { return svgIcon(P.chevronRight, s || 14, { cls: 'cl-ic-bold' }); },
    jumpsLeft: function (s) { return svgIcon(P.chevronsLeft, s || 14, { cls: 'cl-ic-bold' }); },
    jumpsRight: function (s) { return svgIcon(P.chevronsRight, s || 14, { cls: 'cl-ic-bold' }); },
    check: function (s) { return svgIcon(P.check, s || 22, { stroke: 2.4 }); },
    up: function (s) { return svgIcon(P.up, s || 16, { stroke: 2.2 }); },
    down: function (s) { return svgIcon(P.down, s || 16, { stroke: 2.2 }); },
    edit: function (s) { return svgIcon(P.log, s || 19); },
    trash: function (s) { return svgIcon(P.trash, s || 19); },
    camera: function (s) { return svgIcon(P.camera, s || 20); },
    // Solid wedge pointing where the swell TRAVELS (from + 180°). '' without a direction.
    swell: function (fromDeg, s) { return isNum(fromDeg) ? svgIcon('<path class="f" d="' + P.swell + '"/>', s || 22, { rotate: fromDeg + 180 }) : ''; },
    // Line arrow with a feathered tail (chart bars, week rows), pointing
    // where the wind blows TO, the same way as the barb's ring.
    wind: function (fromDeg, s) { return isNum(fromDeg) ? svgIcon(P.windArrow, s || 15, { rotate: fromDeg + 180 }) : ''; },
    // Tide T2 "dashed drop": sine, dashed line falling onto the low's dot.
    tide: function (s) { return svgIcon(P.tide, s || 44, { cls: 'cl-ic-tide' }); },
    tideHigh: function (s) { return svgIcon(P.tideHigh, s || 44, { cls: 'cl-ic-tide' }); },
    // Wind barb, rotated so the ring points where the wind goes. '' without data.
    barb: function (mph, fromDeg, s) {
      var b = barbInner(mph);
      if (b == null) return '';
      var size = s || 44, sw = size <= 20 ? 2.2 : 1.9;
      var calm = mph < 3;
      return '<svg class="cl-barb" width="' + size + '" height="' + size + '" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="' + sw +
        '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        (calm || !isNum(fromDeg) ? b : '<g transform="rotate(' + Math.round(norm360(fromDeg)) + ' 16 16)">' + b + '</g>') + '</svg>';
    }
  };
  CLEAN.icon = icon;

  // ════════════════════════════════════════════════════════════════════
  // DATA ADAPTERS — null-safe readings from the app's own state
  // ════════════════════════════════════════════════════════════════════
  // now() and hour(idx) read the forecast hour itself, exactly as the
  // app's chart and cards do (marineNowIndex: the current local hour).
  // week() days come from Choc TV's kioskDaySummary, which samples the
  // daylight incoming-tide windows one swell-travel lag earlier
  // (kioskSwellLagMs: 1 h, 2 h with the buoy-coords setting); the model
  // scores use buildForecastConditions' own lag. The hero train is the one
  // carrying more in-window energy (alignment × H²), as Choc TV's C20 hero.
  var gen = 0;               // bumped whenever the data under the readings changes
  var memo = { gen: -1 };
  function memoize(key, fn) {
    if (memo.gen !== gen) memo = { gen: gen };
    if (!Object.prototype.hasOwnProperty.call(memo, key)) {
      try { memo[key] = fn(); } catch (e) { err('data.' + key, e); memo[key] = null; }
    }
    return memo[key];
  }
  function bump() { gen++; }

  function FD() { return (typeof STATE !== 'undefined' && STATE.forecastData) || null; }
  function M() { var d = FD(); return d && d.marine && d.marine.hourly && d.marine.hourly.time ? d.marine : null; }
  function W() { var d = FD(); return d && d.wind && d.wind.hourly && d.wind.hourly.time ? d.wind : null; }
  function lagHours() {
    try { if (typeof kioskSwellLagMs === 'function') return Math.round(kioskSwellLagMs() / HOUR); } catch (_) { /* fall through */ }
    try { return typeof getForecastUseBuoyCoords === 'function' && getForecastUseBuoyCoords() ? 2 : 1; } catch (_) { return 1; }
  }
  function timeAt(idx) {
    var m = M();
    if (!m || !isNum(idx) || idx < 0 || idx >= m.hourly.time.length) return null;
    // Parsed exactly as the app parses it (STATE.forecastChart.times).
    return toDate(m.hourly.time[idx]);
  }
  function nowIndex() {
    var m = M();
    if (!m) return -1;
    try { if (typeof marineNowIndex === 'function') return marineNowIndex(m); } catch (e) { err('nowIndex', e); }
    var best = -1, bd = Infinity, now = Date.now();
    m.hourly.time.forEach(function (t, i) { var d = Math.abs(new Date(t).getTime() - now); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  // Marine index nearest an instant (within 90 min), or -1.
  function indexAt(t) {
    var d = toDate(t), m = M();
    if (!d || !m) return -1;
    var ms = d.getTime(), best = -1, bd = 90 * MIN;
    for (var i = 0; i < m.hourly.time.length; i++) {
      var dd = Math.abs(new Date(m.hourly.time[i]).getTime() - ms);
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  }
  function windIndexMap() {
    return memoize('wmap', function () {
      var w = W(), map = {};
      if (w) w.hourly.time.forEach(function (t, j) { map[String(t).slice(0, 13)] = j; });
      return map;
    });
  }
  function windAtIdx(idx) {
    var m = M(), w = W();
    if (!m || !w || idx < 0 || idx >= m.hourly.time.length) return null;
    var j = windIndexMap()[String(m.hourly.time[idx]).slice(0, 13)];
    if (j == null) return null;
    return windFrom(w.hourly.wind_speed_10m, w.hourly.wind_direction_10m, w.hourly.wind_gusts_10m, j);
  }
  function windFrom(spd, dirs, gusts, j) {
    var mph = spd ? spd[j] : null, dir = dirs ? dirs[j] : null, gust = gusts ? gusts[j] : null;
    if (!isNum(mph)) return null;
    return {
      mph: mph,
      gust: isNum(gust) ? gust : null,
      dir: isNum(dir) ? dir : null,
      compass: isNum(dir) ? compass(dir) : null,
      quality: windQuality(mph, dir)
    };
  }
  function windObj(w) {
    if (!w || !isNum(w.mph)) return null;
    return { mph: w.mph, gust: isNum(w.gust) ? w.gust : null, dir: isNum(w.dir) ? w.dir : null, compass: isNum(w.dir) ? compass(w.dir) : null, quality: windQuality(w.mph, w.dir) };
  }
  function train(hgt, per, dir, which) {
    if (!isNum(hgt)) return null;
    var d = isNum(dir) ? norm360(dir) : null;
    return {
      h: hgt,
      period: isNum(per) ? per : null,
      dir: d,
      compass: d == null ? null : compass(d),
      status: statusFor(d),
      energy: alignment(d) * hgt * hgt,
      train: which
    };
  }
  // Both trains at marine index si (no lag applied here).
  function trainsAtRaw(si) {
    var m = M();
    if (!m || si < 0 || si >= m.hourly.time.length) return [];
    var hh = m.hourly;
    var H = hh.swell_wave_height || hh.wave_height || [];
    var Pp = hh.swell_wave_period || hh.wave_period || [];
    var D = hh.swell_wave_direction || hh.wave_direction || [];
    var out = [];
    var a = train(H[si], Pp[si], D[si], 'primary');
    if (a) out.push(a);
    var b = train((hh.secondary_swell_wave_height || [])[si], (hh.secondary_swell_wave_period || [])[si], (hh.secondary_swell_wave_direction || [])[si], 'secondary');
    if (b && b.h > 0) out.push(b);
    return out;
  }
  // → { swell (hero) | null, others: [...], blocked: [...] }
  function heroOf(trains) {
    if (!trains.length) return { swell: null, others: [], blocked: [] };
    var hero = trains[0];
    for (var i = 1; i < trains.length; i++) if (trains[i].energy > hero.energy) hero = trains[i];
    var others = trains.filter(function (t) { return t !== hero; });
    return { swell: hero, others: others, blocked: others.filter(function (t) { return t.status === 'blocked'; }) };
  }

  // Tides: the 6-min curve and the hi/lo events, normalised once per data.
  function normTide(raw) {
    if (!raw) return [];
    if (typeof _normalizeTidePredictions === 'function') return _normalizeTidePredictions(raw);
    var arr = Array.isArray(raw) ? raw : (raw.predictions || []);
    return arr.map(function (p) { return { t: new Date(p.t), v: parseFloat(p.v), type: p.type }; })
      .filter(function (p) { return isFinite(p.t.getTime()) && isFinite(p.v); })
      .sort(function (a, b) { return a.t - b.t; });
  }
  function tidePreds() { return memoize('tp', function () { var d = FD(); return d ? normTide(d.tidePred) : []; }); }
  function tideEvents() { return memoize('te', function () { var d = FD(); return d ? normTide(d.tideHiLo).filter(function (p) { return p.type === 'H' || p.type === 'L'; }) : []; }); }
  // Water level at t, or null outside the series (never a made-up value).
  function levelAt(preds, ms) {
    var n = preds.length;
    if (!n || ms < preds[0].t.getTime() || ms > preds[n - 1].t.getTime()) return null;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (preds[mid].t.getTime() <= ms) lo = mid; else hi = mid; }
    var a = preds[lo], b = preds[hi], ta = a.t.getTime(), tb = b.t.getTime();
    if (tb <= ta) return a.v;
    return a.v + (b.v - a.v) * ((ms - ta) / (tb - ta));
  }
  function nextEvent(type, ms) {
    var ev = tideEvents();
    for (var i = 0; i < ev.length; i++) if (ev[i].t.getTime() > ms && (!type || ev[i].type === type)) return ev[i];
    return null;
  }
  function prevEvent(type, ms) {
    var ev = tideEvents(), r = null;
    for (var i = 0; i < ev.length; i++) { if (ev[i].t.getTime() > ms) break; if (!type || ev[i].type === type) r = ev[i]; }
    return r;
  }
  function ev(e) { return e ? { t: new Date(e.t.getTime()), h: isNum(e.v) ? e.v : null } : null; }
  // → { h, rising } | null
  function tideAt(t) {
    var d = toDate(t);
    if (!d) return null;
    var ms = d.getTime(), preds = tidePreds();
    var v = levelAt(preds, ms);
    var rising = null;
    var a = levelAt(preds, ms + 30 * MIN), b = levelAt(preds, ms - 30 * MIN);
    if (a != null && b != null && a !== b) rising = a > b;
    if (rising == null) { var nx = nextEvent(null, ms); if (nx) rising = nx.type === 'H'; }
    if (v == null && rising == null) return null;
    return { h: v, rising: rising };
  }

  function sunOf(t) {
    var d = toDate(t) || new Date();
    var key = 'sun' + dayKey(d) + '|' + startOfDay(d).getTime();
    return memoize(key, function () {
      if (typeof calcDaylight !== 'function') return null;
      var dl = calcDaylight(CH.lat, CH.lon, d);
      if (!dl) return null;
      if (dl.alwaysDay || dl.alwaysNight) return { alwaysDay: !!dl.alwaysDay, alwaysNight: !!dl.alwaysNight };
      return { firstLight: dl.firstLight, sunrise: dl.sunrise, sunset: dl.sunset, lastLight: dl.lastLight };
    });
  }
  // Night: after sunset or before sunrise at the spot. The phone and
  // Choc TV turn dark here ("Dark from 6:30 PM at the spot").
  function isNight(at) {
    var d = toDate(at) || new Date();
    var s = sunOf(d);
    if (!s) return false;
    if (s.alwaysDay) return false;
    if (s.alwaysNight) return true;
    return d < s.sunrise || d >= s.sunset;
  }
  // After dark: past last light (civil dusk) or before first light. The
  // boards switch "Today" to "Tonight" here (6:40 PM is still Today, in
  // the dusk; 9:30 PM is Tonight, "Dark until 6:18 AM").
  function isAfterDark(at) {
    var d = toDate(at) || new Date();
    var s = sunOf(d);
    if (!s) return false;
    if (s.alwaysDay) return false;
    if (s.alwaysNight) return true;
    return d < s.firstLight || d >= s.lastLight;
  }
  // Next first light after `at` while dark (the "Dark until 6:18 AM").
  function darkUntil(at) {
    var d = toDate(at) || new Date();
    if (!isAfterDark(d)) return null;
    var s = sunOf(d);
    if (s && s.firstLight && d < s.firstLight) return new Date(s.firstLight.getTime());
    var s2 = sunOf(startOfDay(d, 1).getTime() + 12 * HOUR);
    return s2 && s2.firstLight ? new Date(s2.firstLight.getTime()) : null;
  }

  // ── One hour ────────────────────────────────────────────────────────
  function hourAt(idx) {
    var m = M();
    if (!m || !isNum(idx) || idx < 0 || idx >= m.hourly.time.length) return null;
    var at = timeAt(idx);
    var tr = heroOf(trainsAtRaw(idx));
    var td = tideAt(at);
    var nowMs = Date.now();
    return {
      idx: idx,
      at: at,
      swell: tr.swell,
      others: tr.others,
      blocked: tr.blocked,
      status: tr.swell ? tr.swell.status : null,
      wind: windAtIdx(idx),
      tide: td,
      night: isNight(at),
      dark: isAfterDark(at),
      past: at ? at.getTime() + HOUR <= nowMs : false
    };
  }
  function hours() {
    return memoize('hours', function () {
      var m = M();
      if (!m) return [];
      var out = [];
      for (var i = 0; i < m.hourly.time.length; i++) out.push(hourAt(i));
      return out;
    });
  }

  // ── Your model ─────────────────────────────────────────────────────
  // The app's three surf-log models at forecast hour idx (the same
  // buildForecastConditions + predict*Rating the Regression tab uses).
  // → { size, wind, ride, avg } or null when untrained / no data.
  function ratingsAt(idx) {
    return memoize('r' + idx, function () {
      var d = FD();
      if (!M() || !W() || !isNum(idx) || idx < 0) return null;
      if (!STATE.surfLogWaveWeights && !STATE.surfLogRideWeights && !STATE.surfLogCondWeights) return null;
      if (typeof buildForecastConditions !== 'function') return null;
      var cond = buildForecastConditions(d.marine, d.wind, d.tideHiLo, d.tidePred, idx);
      if (!cond) return null;
      var wf = extractWaveFeatures(cond), rf = extractRideFeatures(cond), cf = extractCondFeatures(cond);
      var size = wf ? predictWaveRating(wf) : null;
      var ride = rf ? predictRideRating(rf) : null;
      var wind = cf ? predictCondRating(cf) : null;
      var vals = [size, ride, wind].filter(isNum);
      return {
        size: isNum(size) ? size : null,
        ride: isNum(ride) ? ride : null,
        wind: isNum(wind) ? wind : null,
        avg: vals.length ? round1(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null
      };
    });
  }
  function modelAt(idx) { var r = ratingsAt(idx); return r ? r.avg : null; }

  // ── Buoy ───────────────────────────────────────────────────────────
  function buoyNow() {
    var d = FD();
    var bp = (d && d.buoyParsed) || (typeof STATE !== 'undefined' && STATE._cachedBuoyParsed) || null;
    if (!bp || !isNum(bp.waveHeight)) return null;
    var band = null, ctx = CLEAN._ctx;
    try { if (ctx && typeof pipelineSwellBand === 'function') band = pipelineSwellBand(ctx.pipelineData, ctx.buoy); } catch (e) { err('buoy.band', e); }
    var hasBand = band && isNum(band.hsM);
    var hgt = hasBand ? round1(band.hsM * 3.28084) : bp.waveHeight;
    var per = hasBand ? band.peakPeriod : bp.dominantPeriod;
    var dir = hasBand && isNum(band.dir) ? band.dir : bp.meanDirection;
    var obs = isNum(bp.obsMs) ? bp.obsMs : null;
    var age = null;
    try { if (obs != null && typeof buoyObsAge === 'function') age = buoyObsAge(obs); } catch (_) { age = null; }
    var reaches = null;
    try {
      if (obs != null && isNum(per) && typeof swellArrivalTime === 'function') {
        var arr = swellArrivalTime(per, CH.buoyDistanceMiles);
        if (arr) reaches = new Date(obs + arr.minutes * MIN);
      }
    } catch (_) { reaches = null; }
    return {
      h: hgt,
      period: isNum(per) ? per : null,
      dir: isNum(dir) ? norm360(dir) : null,
      compass: isNum(dir) ? compass(dir) : null,
      total: bp.waveHeight,               // total sea (WVHT), swell + wind waves
      band: hasBand,                      // true: the 8 s+ swell band of the spectrum
      obsAt: obs != null ? new Date(obs) : null,
      ageMin: age ? Math.round(age.ageMs / MIN) : null,
      level: !age ? null : age.level === 'old' ? 'dead' : age.level,  // fresh | stale (>2 h) | dead (>6 h)
      reachesAt: reaches
    };
  }

  // ── Freshness ──────────────────────────────────────────────────────
  // Choc TV's own thresholds (kiosk.js kioskFreshness): stale past two
  // missed 15-min refreshes + 10 min, dead past 3 h or no forecast. A
  // forecast drawn from a saved copy after a failed refresh is stale.
  var REFRESH_MS = 15 * MIN, DEAD_MS = 3 * HOUR;
  function levelForAge(ageMs) {
    if (!isNum(ageMs)) return 'dead';
    return ageMs > DEAD_MS ? 'dead' : ageMs > 2 * REFRESH_MS + 10 * MIN ? 'stale' : 'fresh';
  }
  function freshness() {
    if (typeof STATE === 'undefined' || !STATE.lastLoadCompletedAt) return 'loading';
    var asOf = STATE.dataAsOf;
    if (!isNum(asOf)) return 'dead';
    var lvl = levelForAge(Date.now() - asOf);
    var hh = STATE.dataHealth || {};
    if (lvl === 'fresh' && ((hh.marine && hh.marine.origin === 'stale-cache') || (hh.wind && hh.wind.origin === 'stale-cache'))) lvl = 'stale';
    return lvl;
  }
  // Per source, for Settings › Data sources and the TV's Sources card.
  // → [{ key, label, at: Date|null, origin, level: fresh|stale|dead|none, text }]
  function sources() {
    var hh = (typeof STATE !== 'undefined' && STATE.dataHealth) || {};
    var out = [];
    function fc(key, label) {
      var s = hh[key];
      if (!s) { out.push({ key: key, label: label, at: null, origin: null, level: 'none', text: STATE.lastLoadCompletedAt ? 'Not loaded' : 'Loading' }); return; }
      if (s.origin === 'failed' || !isNum(s.asOf)) { out.push({ key: key, label: label, at: null, origin: s.origin, level: 'none', text: 'Not loaded' }); return; }
      var lvl = levelForAge(Date.now() - s.asOf);
      if (lvl === 'fresh' && s.origin === 'stale-cache') lvl = 'stale';
      var text = fmt.when(s.asOf) + (lvl === 'fresh' ? '' : ' · ' + fmt.age(s.asOf));
      out.push({ key: key, label: label, at: new Date(s.asOf), origin: s.origin, level: lvl, text: text });
    }
    fc('marine', 'Wave forecast');
    fc('wind', 'Wind forecast');
    // Tide predictions are astronomical: a saved copy stays right for days
    // (the app keeps them 4 days), so it is never shown as stale.
    var t = hh.tides;
    if (!t || t.origin === 'failed' || !isNum(t.asOf)) out.push({ key: 'tides', label: 'Tides', at: null, origin: t ? t.origin : null, level: 'none', text: STATE.lastLoadCompletedAt ? 'Not loaded' : 'Loading' });
    else out.push({ key: 'tides', label: 'Tides', at: new Date(t.asOf), origin: t.origin, level: 'fresh', text: fmt.when(t.asOf) + (t.origin === 'stale-cache' ? ' · saved' : '') });
    var b = buoyNow();
    if (!b || !b.obsAt) out.push({ key: 'buoy', label: 'Buoy', at: null, origin: hh.buoy ? hh.buoy.origin : null, level: 'none', text: STATE.lastLoadCompletedAt ? 'No reading' : 'Loading' });
    else out.push({ key: 'buoy', label: 'Buoy', at: b.obsAt, origin: hh.buoy ? hh.buoy.origin : 'pipeline', level: b.level || 'fresh', text: fmt.when(b.obsAt) + ' · ' + fmt.age(b.obsAt) });
    return out;
  }

  // ── Now ────────────────────────────────────────────────────────────
  function tideNow() {
    var ms = Date.now();
    var at = tideAt(new Date(ms));
    var nl = ev(nextEvent('L', ms)), nh = ev(nextEvent('H', ms));
    if (!at && !nl && !nh) return null;
    return {
      h: at ? at.h : null,
      rising: at ? at.rising : null,
      nextLow: nl,
      nextHigh: nh,
      prevLow: ev(prevEvent('L', ms)),
      prevHigh: ev(prevEvent('H', ms))
    };
  }
  function now() {
    var idx = nowIndex();
    var hr = idx >= 0 ? hourAt(idx) : null;
    var wind = hr ? hr.wind : null;
    if (!wind) {
      var w = FD() && FD().wind;
      if (w && w.current) wind = windObj({ mph: w.current.wind_speed_10m, dir: w.current.wind_direction_10m, gust: w.current.wind_gusts_10m });
    }
    var asOf = typeof STATE !== 'undefined' && isNum(STATE.dataAsOf) ? new Date(STATE.dataAsOf) : null;
    return {
      at: new Date(),
      idx: idx,
      swell: hr ? hr.swell : null,
      others: hr ? hr.others : [],
      blocked: hr ? hr.blocked : [],
      status: hr ? hr.status : null,
      wind: wind,
      tide: tideNow(),
      model: idx >= 0 ? modelAt(idx) : null,
      buoy: buoyNow(),
      updatedAt: asOf,
      freshness: freshness(),
      night: isNight(),
      afterDark: isAfterDark(),
      loaded: !!M()
    };
  }

  // ── Week ───────────────────────────────────────────────────────────
  // Seven days from Choc TV's kioskDaySummary (swell over the daylight
  // incoming-tide windows, the in-window hero train), plus the day's
  // daylight low, the wind there and your model score at it.
  function bandObj(b) {
    if (!b) return null;
    var dir = isNum(b.dir) ? norm360(b.dir) : null;
    return { min: b.min, max: b.max, period: isNum(b.period) ? b.period : null, dir: dir, compass: dir == null ? null : compass(dir), status: statusFor(dir) };
  }
  function lowsOfDay(day0) {
    var a = day0.getTime(), b = startOfDay(day0, 1).getTime();
    return tideEvents().filter(function (e) { return e.type === 'L' && e.t.getTime() >= a && e.t.getTime() < b; });
  }
  function lowObj(e, s) {
    if (!e) return null;
    var hi = nextEvent('H', e.t.getTime());
    var w = null;
    try { if (typeof kioskWindAt === 'function') w = windObj(kioskWindAt(e.t.getTime())); } catch (_) { w = null; }
    if (!w) { var i = indexAt(e.t); w = i >= 0 ? windAtIdx(i) : null; }
    var daylight = !!(s && s.sunrise && e.t >= s.sunrise && e.t < s.sunset);
    return {
      t: new Date(e.t.getTime()),
      h: isNum(e.v) ? e.v : null,
      until: hi ? new Date(hi.t.getTime()) : null,
      untilH: hi && isNum(hi.v) ? hi.v : null,
      wind: w,
      idx: indexAt(e.t),
      daylight: daylight
    };
  }
  // The low a surfer plays: the first low in daylight; else the first
  // whose incoming tide (low → next high) reaches into daylight; else the
  // first low of the day.
  function pickLow(lows, s) {
    if (!lows.length) return null;
    if (s && s.sunrise) {
      for (var i = 0; i < lows.length; i++) if (lows[i].t >= s.sunrise && lows[i].t < s.sunset) return lows[i];
      for (var j = 0; j < lows.length; j++) {
        var hi = nextEvent('H', lows[j].t.getTime());
        var end = hi ? hi.t : new Date(lows[j].t.getTime() + 6.2 * HOUR);
        if (end > s.sunrise && lows[j].t < s.sunset) return lows[j];
      }
    }
    return lows[0];
  }
  function dayAt(k) {
    var day0 = startOfDay(new Date(), k);
    var noon = new Date(day0.getTime() + 12 * HOUR);
    var sum = null;
    try { if (typeof kioskDaySummary === 'function' && FD()) sum = kioskDaySummary(k); } catch (e) { err('week.' + k, e); }
    var s = sunOf(noon);
    var lowsRaw = lowsOfDay(day0);
    var low = lowObj(pickLow(lowsRaw, s), s);
    var swell = sum ? bandObj(sum.primary) : null;
    var moon = sum && sum.moon ? sum.moon : (typeof kioskMoonPhase === 'function' ? kioskMoonPhase(noon) : null);
    return {
      offset: k,
      date: day0,
      label: k === 0 ? 'Today' : fmt.day(noon),
      longLabel: k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : fmt.dayLong(noon),
      swell: swell,
      other: sum ? bandObj(sum.secondary) : null,
      status: swell ? swell.status : null,
      reaches: !!(swell && swell.status !== 'blocked'),
      low: low,
      lows: lowsRaw.map(function (e) { return lowObj(e, s); }),
      window: low ? { start: low.t, end: low.until } : null,
      sun: s && s.sunrise ? s : null,
      moon: moon ? { pct: moon.pct, icon: moon.icon } : null,
      model: low && low.idx >= 0 ? modelAt(low.idx) : null,
      tidesDown: sum ? !!sum.tidesDown : !tideEvents().length
    };
  }
  function week() {
    return memoize('week' + dayKey(new Date()), function () {
      var out = [];
      for (var k = 0; k < 7; k++) out.push(dayAt(k));
      return out;
    });
  }
  // The next incoming tide that reaches into daylight and hasn't ended:
  // → { t: low, until: next high, h, dayOffset, label: 'Today'|'Tomorrow'|'Fri', start: daylight start } | null
  function nextWindow() {
    var nowMs = Date.now();
    for (var k = 0; k < 8; k++) {
      var day0 = startOfDay(new Date(), k);
      var s = sunOf(new Date(day0.getTime() + 12 * HOUR));
      if (!s || !s.sunrise) continue;
      var lows = lowsOfDay(day0);
      for (var i = 0; i < lows.length; i++) {
        var lo = lows[i], hi = nextEvent('H', lo.t.getTime());
        var end = hi ? hi.t.getTime() : lo.t.getTime() + 6.2 * HOUR;
        var a = Math.max(lo.t.getTime(), s.sunrise.getTime()), b = Math.min(end, s.sunset.getTime());
        if (b <= a || b <= nowMs) continue;
        return {
          t: new Date(lo.t.getTime()),
          until: hi ? new Date(hi.t.getTime()) : null,
          h: isNum(lo.v) ? lo.v : null,
          start: new Date(a),
          dayOffset: k,
          label: k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : fmt.day(new Date(day0.getTime() + 12 * HOUR))
        };
      }
    }
    return null;
  }

  CLEAN.data = {
    now: guardData('now', now, function () {
      return { at: new Date(), idx: -1, swell: null, others: [], blocked: [], status: null, wind: null, tide: null, model: null, buoy: null, updatedAt: null, freshness: 'loading', night: false, afterDark: false, loaded: false };
    }),
    week: guardData('week', week, function () { return []; }),
    hour: guardData('hour', hourAt, function () { return null; }),
    hours: guardData('hours', hours, function () { return []; }),
    nowIndex: guardData('nowIndex', nowIndex, function () { return -1; }),
    indexAt: guardData('indexAt', indexAt, function () { return -1; }),
    timeAt: guardData('timeAt', timeAt, function () { return null; }),
    modelAt: guardData('modelAt', modelAt, function () { return null; }),
    ratingsAt: guardData('ratingsAt', ratingsAt, function () { return null; }),
    tideAt: guardData('tideAt', tideAt, function () { return null; }),
    tideEvents: guardData('tideEvents', function () {
      return tideEvents().map(function (e) { return { t: new Date(e.t.getTime()), h: e.v, type: e.type }; });
    }, function () { return []; }),
    tideCurve: guardData('tideCurve', function () {
      return tidePreds().map(function (e) { return { t: new Date(e.t.getTime()), h: e.v }; });
    }, function () { return []; }),
    buoy: guardData('buoy', buoyNow, function () { return null; }),
    sun: guardData('sun', sunOf, function () { return null; }),
    isNight: guardData('isNight', isNight, function () { return false; }),
    isAfterDark: guardData('isAfterDark', isAfterDark, function () { return false; }),
    darkUntil: guardData('darkUntil', darkUntil, function () { return null; }),
    nextWindow: guardData('nextWindow', nextWindow, function () { return null; }),
    freshness: guardData('freshness', freshness, function () { return 'loading'; }),
    sources: guardData('sources', sources, function () { return []; }),
    lagHours: guardData('lagHours', lagHours, function () { return 1; }),
    loaded: function () { return !!M(); },
    generation: function () { return gen; }
  };
  function guardData(name, fn, fallback) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { err('data.' + name, e); return fallback(); }
    };
  }

  // The shared forecast cursor (the app's scrubber hour). forecast.js
  // moves it; Model and TV may read it. Setting it repaints the app's own
  // (hidden) chart and raises 'hour'.
  CLEAN.cursor = {
    get: function () {
      var i = typeof STATE !== 'undefined' ? STATE.scrubberIdx : -1;
      return isNum(i) && i >= 0 ? i : nowIndex();
    },
    set: function (idx) {
      var m = M();
      if (!m || !isNum(idx)) return;
      idx = clamp(Math.round(idx), 0, m.hourly.time.length - 1);
      STATE.scrubberIdx = idx;
      try { if (typeof applyScrubberToHour === 'function' && STATE.forecastChart) applyScrubberToHour(idx); else emit('hour', idx); }
      catch (e) { err('cursor.set', e); emit('hour', idx); }
    },
    reset: function () { CLEAN.cursor.set(nowIndex()); },
    atNow: function () { return CLEAN.cursor.get() === nowIndex(); }
  };

  // ════════════════════════════════════════════════════════════════════
  // THEME — day / night
  // ════════════════════════════════════════════════════════════════════
  // Modes: 'sunset' (default; night from sunset to sunrise at the spot),
  // 'system' (the phone's light/dark), 'light', 'dark'. Kept in
  // localStorage lcc-clean-display. Choc TV always follows the sun.
  var THEME_KEY = 'lcc-clean-display';
  var MODES = ['sunset', 'system', 'light', 'dark'];
  var mode = 'sunset', curTheme = null, fadeTimer = null, mqDark = null;
  function readMode() {
    try { var v = localStorage.getItem(THEME_KEY); return MODES.indexOf(v) >= 0 ? v : 'sunset'; } catch (_) { return 'sunset'; }
  }
  function themeMode() { return IS_TV ? 'sunset' : mode; }
  function computeTheme() {
    var md = themeMode();
    if (md === 'light') return 'day';
    if (md === 'dark') return 'night';
    if (md === 'system') return mqDark && mqDark.matches ? 'night' : 'day';
    return isNight() ? 'night' : 'day';
  }
  function applyTheme(initial) {
    var t;
    try { t = computeTheme(); } catch (e) { err('theme', e); t = 'day'; }
    if (t === curTheme) return;
    var root = document.documentElement;
    if (!initial && !reducedMotion()) {
      root.classList.add('cl-fade');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(function () { root.classList.remove('cl-fade'); }, 450);
    }
    curTheme = t;
    root.setAttribute('data-clean-theme', t);
    themeColor();
    if (!initial) {
      emit('theme', t);
      eachPart(function (p) { if (p.mounted && typeof p.def.onTheme === 'function') { try { p.def.onTheme(t); } catch (e) { err(p.name + '.onTheme', e); } } });
    }
  }
  // The browser chrome (iOS status bar, Android toolbar) matches --bg.
  function themeColor() {
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta && document.documentElement.classList.contains('cl-on')) meta.setAttribute('content', curTheme === 'night' ? '#0D1A16' : '#FFFFFF');
    } catch (_) { /* cosmetic */ }
  }
  CLEAN.theme = function () { return curTheme || 'day'; };
  CLEAN.themeMode = themeMode;
  CLEAN.setThemeMode = function (m) {
    if (MODES.indexOf(m) < 0 || IS_TV) return;
    mode = m;
    try { localStorage.setItem(THEME_KEY, m); } catch (_) { /* private mode: this visit only */ }
    applyTheme(false);
    emit('themeMode', m);
    refreshSettings();
  };

  // ════════════════════════════════════════════════════════════════════
  // SHELL
  // ════════════════════════════════════════════════════════════════════
  var TABS = [
    { id: 'forecast', label: 'Forecast', legacy: 'forecast' },
    { id: 'log', label: 'Log', legacy: 'surflog' },
    { id: 'model', label: 'Model', legacy: 'regression' }
  ];
  var appEl = null, tvEl = null, titleEl = null, subtitleEl = null, tabBtns = {}, views = {};
  var curTab = 'forecast', scrollMem = {}, titleOverride = {};
  var shellReady = false, savedEra = null;

  function buildPhone() {
    appEl = h('div', { id: 'cl-app', class: 'cl', 'data-tab': curTab });
    var hd = h('header', { class: 'cl-hd', id: 'cl-hd' });
    var t = h('h1', { class: 'cl-hd-t' });
    titleEl = h('b', { class: 'cl-serif', id: 'cl-title' }, 'Today');
    subtitleEl = h('span', { id: 'cl-subtitle' });
    t.appendChild(titleEl);
    t.appendChild(subtitleEl);
    hd.appendChild(t);
    hd.appendChild(h('button', { type: 'button', class: 'cl-ib', id: 'cl-settings-btn', 'aria-label': 'Settings', onclick: function () { CLEAN.openSettings(); } }, icon.settings()));
    appEl.appendChild(hd);
    var main = h('main', { id: 'cl-main' });
    TABS.forEach(function (tb) {
      var v = h('section', { class: 'cl-view', id: 'cl-view-' + tb.id, 'data-tab': tb.id, 'aria-label': tb.label });
      if (tb.id !== curTab) v.hidden = true;
      views[tb.id] = v;
      main.appendChild(v);
    });
    appEl.appendChild(main);
    var nav = h('nav', { class: 'cl-tabs', 'aria-label': 'Main' });
    TABS.forEach(function (tb) {
      var b = h('button', { type: 'button', class: 'cl-tab', 'data-tab': tb.id, onclick: function () { showTab(tb.id); } },
        icon[tb.id](24) + '<span>' + tb.label + '</span>');
      if (tb.id === curTab) b.setAttribute('aria-current', 'page');
      tabBtns[tb.id] = b;
      nav.appendChild(b);
    });
    appEl.appendChild(nav);
    document.body.appendChild(appEl);
    updateHeader();
  }
  function buildTV() {
    tvEl = h('div', { id: 'cl-tv', class: 'cl', role: 'main', 'aria-label': 'Choc TV' });
    document.body.appendChild(tvEl);
  }

  function updateHeader() {
    if (IS_TV || !titleEl) return;
    var o = titleOverride[curTab], t, s;
    if (o) { t = o.title; s = o.sub; }
    else if (curTab === 'forecast') { t = isAfterDark() ? 'Tonight' : 'Today'; s = fmt.date(new Date()); }
    else if (curTab === 'log') { t = 'Log'; s = ''; }
    else { t = 'Your model'; s = ''; }
    if (titleEl.textContent !== t) titleEl.textContent = t;
    if (subtitleEl.textContent !== (s || '')) subtitleEl.textContent = s || '';
    subtitleEl.hidden = !s;
  }
  CLEAN.setTitle = function (tab, title, sub) {
    if (!title) delete titleOverride[tab];
    else titleOverride[tab] = { title: String(title), sub: sub ? String(sub) : '' };
    updateHeader();
  };

  function showTab(id, opts) {
    opts = opts || {};
    if (IS_TV || !views[id]) return;
    while (subStack.length) closeTop();
    if (id === curTab && !opts.force) {
      // Tapping the active tab: back to the top.
      try { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
      return;
    }
    var prev = curTab;
    scrollMem[prev] = window.scrollY || 0;
    if (views[prev]) views[prev].hidden = true;
    var v = views[id];
    v.hidden = false;
    v.classList.remove('cl-enter');
    if (!reducedMotion()) { void v.offsetWidth; v.classList.add('cl-enter'); }
    curTab = id;
    appEl.setAttribute('data-tab', id);
    Object.keys(tabBtns).forEach(function (k) {
      if (k === id) tabBtns[k].setAttribute('aria-current', 'page');
      else tabBtns[k].removeAttribute('aria-current');
    });
    updateHeader();
    window.scrollTo(0, scrollMem[id] || 0);
    // Keep the app's own tab state in step: Tab 2 / Tab 3 renderers and
    // STATE.activeTab checks run as they would on the classic page.
    var legacy = TABS.filter(function (t) { return t.id === id; })[0].legacy;
    try { if (typeof switchTab === 'function') switchTab(legacy); } catch (e) { err('switchTab', e); }
    var p = parts[id];
    if (p && p.mounted) {
      if (typeof p.def.onShow === 'function') { try { p.def.onShow(); } catch (e) { err(id + '.onShow', e); } }
      callRender(p, 'show');
    }
    emit('tab', id);
  }
  CLEAN.show = function (id) { showTab(id); };
  CLEAN.tab = function () { return IS_TV ? 'tv' : curTab; };
  CLEAN.root = function (name) { return name === 'tv' ? tvEl : (views[name] || null); };

  // ── Sub-pages ──────────────────────────────────────────────────────
  // Full-screen pages over the shell with a back chevron (Settings, and
  // any part's drill-down). One history entry each, so the iPhone's back
  // swipe and the browser's Back close them.
  var subStack = [];
  function openSub(opts) {
    opts = opts || {};
    if (IS_TV || !appEl) return null;
    var under = subStack.length ? subStack[subStack.length - 1].el : appEl;
    var page = h('div', { class: 'cl cl-sub', id: opts.id ? 'cl-sub-' + opts.id : null, role: 'region', 'aria-label': opts.title || '' });
    var hb = h('div', { class: 'cl-hb' });
    var back = h('button', { type: 'button', class: 'cl-ib', 'aria-label': 'Back', onclick: function () { CLEAN.sub.close(); } }, icon.back());
    hb.appendChild(back);
    var title = h('h1', { class: 'cl-serif' }, '<b>' + esc(opts.title || '') + '</b>');
    hb.appendChild(title);
    var body = h('div', { class: 'cl-sub-body' });
    page.appendChild(hb);
    page.appendChild(body);
    var entry = { id: opts.id || null, el: page, opts: opts, under: under, underScroll: window.scrollY || 0, body: body };
    var handle = {
      el: page,
      body: body,
      close: function () { if (subStack.indexOf(entry) >= 0) CLEAN.sub.close(); },
      setTitle: function (t) { title.innerHTML = '<b>' + esc(t) + '</b>'; page.setAttribute('aria-label', t); }
    };
    entry.handle = handle;
    under.hidden = true;
    document.body.appendChild(page);
    if (!reducedMotion()) page.classList.add('cl-enter');
    subStack.push(entry);
    window.scrollTo(0, 0);
    try { history.pushState({ clSub: subStack.length }, ''); entry.pushed = true; } catch (_) { entry.pushed = false; }
    try { if (typeof opts.mount === 'function') opts.mount(body, handle); } catch (e) { err('sub.' + (opts.id || '?') + '.mount', e); }
    try { back.focus({ preventScroll: true }); } catch (_) { /* fine */ }
    emit('sub', { id: entry.id, open: true });
    return handle;
  }
  function closeTop() {
    var e = subStack.pop();
    if (!e) return;
    if (e.el.parentNode) e.el.parentNode.removeChild(e.el);
    e.under.hidden = false;
    window.scrollTo(0, e.underScroll);
    if (e.id === 'settings') settingsBody = null;
    try { if (typeof e.opts.onClose === 'function') e.opts.onClose(); } catch (er) { err('sub.' + (e.id || '?') + '.onClose', er); }
    emit('sub', { id: e.id, open: false });
  }
  CLEAN.sub = {
    open: openSub,
    close: function () {
      var top = subStack[subStack.length - 1];
      if (!top) return;
      var st = null;
      try { st = history.state; } catch (_) { st = null; }
      if (top.pushed && st && st.clSub === subStack.length) { try { history.back(); return; } catch (_) { /* fall through */ } }
      closeTop();
    },
    depth: function () { return subStack.length; },
    top: function () { var t = subStack[subStack.length - 1]; return t ? t.handle : null; }
  };
  window.addEventListener('popstate', function (ev2) {
    var depth = ev2.state && isNum(ev2.state.clSub) ? ev2.state.clSub : 0;
    while (subStack.length > depth) closeTop();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && subStack.length) CLEAN.sub.close();
  });

  // ── Settings ───────────────────────────────────────────────────────
  var settingsBody = null;
  function authInfo() {
    var signedIn = !!(window._fbUserId && window._fbUserIsAnon === false);
    return { signedIn: signedIn, uid: window._fbUserId || null, name: signedIn ? (window._fbDisplayName || '') : '' };
  }
  CLEAN.auth = authInfo;
  CLEAN.signIn = function () { try { if (typeof signInWithGoogle === 'function') signInWithGoogle(); } catch (e) { err('signIn', e); } };
  CLEAN.signOut = function () { try { if (typeof signOutUser === 'function') signOutUser(); } catch (e) { err('signOut', e); } };

  function modelLabel(v) {
    if (!v) return 'Auto';
    var m = (typeof FORECAST_MODELS !== 'undefined' ? FORECAST_MODELS : []).filter(function (x) { return x.value === v; })[0];
    return m ? m.label : v;
  }
  function currentModel() { try { return typeof getForecastModel === 'function' ? getForecastModel() : ''; } catch (_) { return ''; } }
  function reload() {
    try {
      if (typeof STATE !== 'undefined' && STATE.selectedBuoy && typeof loadAllData === 'function') loadAllData(STATE.selectedBuoy);
    } catch (e) { err('reload', e); }
  }

  function settingsHTML() {
    var a = authInfo();
    var md = themeMode();
    var sun = sunOf(new Date());
    var dark = isNight();
    var sunNote = '';
    if (sun && sun.sunset) {
      var nextSun = new Date() >= sun.sunset ? sunOf(startOfDay(new Date(), 1).getTime() + 12 * HOUR) : sun;
      sunNote = dark && nextSun && nextSun.sunrise
        ? 'Dark until ' + fmt.time(nextSun.sunrise) + ' at the spot'
        : 'Dark from ' + fmt.time(sun.sunset) + ' at the spot';
    }
    var row = function (m, label, sub) {
      var on = md === m;
      return '<button type="button" class="cl-sr" role="radio" aria-checked="' + on + '" data-mode="' + m + '"><span>' + label +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="cl-ck">' + (on ? icon.check() : '') + '</span></button>';
    };
    var src = sources().map(function (s) {
      var cls = s.level === 'stale' ? ' cl-stale' : s.level === 'dead' ? ' cl-dead' : '';
      return '<div class="cl-sr" data-src="' + s.key + '"><span>' + esc(s.label) + '</span><span class="cl-v' + cls + '">' + esc(s.text) + '</span></div>';
    }).join('');
    var classic = location.pathname + (IS_TV ? '?kiosk=1' : '');
    return '' +
      '<h2 class="cl-h2" id="cl-set-account">Account</h2>' +
      '<div class="cl-set-acct">' +
        (a.signedIn
          ? '<p class="cl-set-who">Signed in as <b>' + esc(a.name || 'you') + '</b></p>' +
            '<button type="button" class="cl-btn cl-btn-block" data-act="signout">Sign out</button>'
          : '<button type="button" class="cl-btn cl-btn-block" data-act="signin">Sign in with Google</button>' +
            '<p class="cl-fine">Sign in to log sessions and train your model.</p>') +
      '</div>' +
      '<div class="cl-gap"></div>' +
      '<h2 class="cl-h2" id="cl-set-display">Display</h2>' +
      '<div class="cl-list" role="radiogroup" aria-label="Display">' +
        row('sunset', 'Automatic at sunset', sunNote) +
        row('system', 'Follow phone') +
        row('light', 'Always light') +
        row('dark', 'Always dark') +
      '</div>' +
      '<div class="cl-gap"></div>' +
      '<h2 class="cl-h2" id="cl-set-forecast">Forecast</h2>' +
      '<div class="cl-list">' +
        '<button type="button" class="cl-sr" data-act="model"><span>Forecast model</span><span class="cl-v">' + esc(modelLabel(currentModel())) + ' ' + icon.chevronRight() + '</span></button>' +
      '</div>' +
      '<div class="cl-gap"></div>' +
      '<h2 class="cl-h2" id="cl-set-sources">Data sources</h2>' +
      '<div class="cl-list">' + src + '</div>' +
      '<div class="cl-gap"></div>' +
      '<h2 class="cl-h2" id="cl-set-spot">Spot</h2>' +
      '<div class="cl-list">' +
        '<button type="button" class="cl-sr" data-act="spot"><span>Spot and buoy</span><span class="cl-v">' + icon.chevronRight() + '</span></button>' +
      '</div>' +
      '<p class="cl-fine cl-set-note">This is the new look on trial. <a href="' + esc(classic) + '">Back to the classic view</a></p>';
  }
  function renderSettings(body) {
    var focusKey = null, ae = document.activeElement;
    if (ae && body.contains(ae)) focusKey = ae.getAttribute('data-mode') ? '[data-mode="' + ae.getAttribute('data-mode') + '"]' : ae.getAttribute('data-act') ? '[data-act="' + ae.getAttribute('data-act') + '"]' : null;
    body.innerHTML = settingsHTML();
    if (focusKey) { var f = body.querySelector(focusKey); if (f) try { f.focus({ preventScroll: true }); } catch (_) { /* fine */ } }
  }
  function onSettingsClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    var m = b.getAttribute('data-mode');
    if (m) { CLEAN.setThemeMode(m); return; }
    var act = b.getAttribute('data-act');
    if (act === 'signin') CLEAN.signIn();
    else if (act === 'signout') CLEAN.signOut();
    else if (act === 'model') openModelPicker();
    else if (act === 'spot') openSpot();
  }
  function refreshSettings() {
    if (settingsBody && settingsBody.isConnected) { try { renderSettings(settingsBody); } catch (e) { err('settings.render', e); } }
  }
  CLEAN.openSettings = function (section) {
    if (IS_TV) return null;
    var top = subStack[subStack.length - 1];
    if (top && top.id === 'settings') return top.handle;
    return openSub({
      id: 'settings',
      title: 'Settings',
      mount: function (body) {
        settingsBody = body;
        body.addEventListener('click', onSettingsClick);
        renderSettings(body);
        if (section) {
          var target = body.querySelector('#cl-set-' + section);
          if (target) try { target.scrollIntoView({ block: 'start' }); } catch (_) { /* fine */ }
        }
      },
      onClose: function () { settingsBody = null; }
    });
  };

  function openModelPicker() {
    openSub({
      id: 'model-picker',
      title: 'Forecast model',
      mount: function (body, handle) {
        var models = typeof FORECAST_MODELS !== 'undefined' ? FORECAST_MODELS : [];
        var cur = currentModel();
        var rows = [{ value: '', label: 'Auto', sub: 'Open-Meteo picks the best model for the spot (MeteoFrance MFWAM)' }]
          .concat(models.map(function (m) {
            // "NOAA GFS-Wave (0.25°)" → label "NOAA GFS-Wave", small "0.25°"
            var mm = /^(.*?)\s*\((.*)\)\s*$/.exec(m.label);
            return { value: m.value, label: mm ? mm[1] : m.label, sub: mm ? mm[2] : '' };
          }));
        body.innerHTML = '<div class="cl-list" role="radiogroup" aria-label="Forecast model">' + rows.map(function (r) {
          var on = r.value === cur;
          return '<button type="button" class="cl-sr" role="radio" aria-checked="' + on + '" data-model="' + esc(r.value) + '"><span>' + esc(r.label) +
            (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span><span class="cl-ck">' + (on ? icon.check() : '') + '</span></button>';
        }).join('') + '</div>' +
          '<p class="cl-fine cl-set-note">The swell and period on every screen come from this model. A model that has no data for the spot falls back to Auto.</p>';
        body.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('[data-model]') : null;
          if (!b) return;
          var v = b.getAttribute('data-model') || '';
          if (v !== currentModel()) {
            try { if (typeof setForecastModel === 'function') setForecastModel(v); } catch (er) { err('setForecastModel', er); }
            reload();
          }
          handle.close();
        });
      },
      onClose: refreshSettings
    });
  }

  function openSpot() {
    openSub({
      id: 'spot',
      title: 'Spot and buoy',
      mount: function (body) {
        var draw = function () {
          var useBuoy = false;
          try { useBuoy = typeof getForecastUseBuoyCoords === 'function' && getForecastUseBuoyCoords(); } catch (_) { useBuoy = false; }
          var lat = useBuoy ? CH.buoyLat : CH.forecastLat, lon = useBuoy ? CH.buoyLon : CH.forecastLon;
          var tide = (typeof STATE !== 'undefined' && STATE.nearestTideStation && STATE.nearestTideStation.id) || CH.tideStation;
          body.innerHTML = '<div class="cl-list">' +
            '<div class="cl-sr"><span>Forecast point<small>' + (useBuoy ? 'At the buoy. Swell takes about 2 h to reach the reef' : 'Open water off the reef. Swell takes about 1 h to reach it') + '</small></span><span class="cl-v">' +
              Math.abs(lat).toFixed(2) + '°N ' + Math.abs(lon).toFixed(2) + '°W</span></div>' +
            '<button type="button" class="cl-sr" role="switch" aria-checked="' + useBuoy + '" data-act="buoy"><span>Read the forecast at the buoy<small>Moves the forecast point out to the wave buoy, about ' +
              CH.buoyDistanceMiles + ' miles offshore</small></span><span class="cl-switch" aria-hidden="true"></span></button>' +
            '<div class="cl-sr"><span>Wave buoy</span><span class="cl-v">NDBC ' + esc(CH.buoyId) + '</span></div>' +
            '<div class="cl-sr"><span>Tide station</span><span class="cl-v">CO-OPS ' + esc(tide) + '</span></div>' +
            '<div class="cl-sr"><span>Water temperature</span><span class="cl-v">CO-OPS ' + esc(CH.waterTempStation) + '</span></div>' +
            '<div class="cl-sr"><span>Swell window</span><span class="cl-v">' + CH.swellWindowMin + '–' + CH.swellWindowMax + '°</span></div>' +
            '</div>';
        };
        draw();
        body.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('[data-act="buoy"]') : null;
          if (!b) return;
          var next = b.getAttribute('aria-checked') !== 'true';
          try { localStorage.setItem('lcc-forecast-use-buoy-coords', next ? '1' : '0'); } catch (_) { /* private mode */ }
          var cb = document.getElementById('forecast-coord-toggle');
          if (cb) cb.checked = next;
          draw();
          reload();
        });
      },
      onClose: refreshSettings
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // PARTS
  // ════════════════════════════════════════════════════════════════════
  var parts = {};
  var PART_NAMES = ['forecast', 'log', 'model', 'tv'];
  function eachPart(fn) { Object.keys(parts).forEach(function (k) { fn(parts[k]); }); }
  function onThisDevice(name) { return name === 'tv' ? IS_TV : !IS_TV; }

  CLEAN.register = function (name, def) {
    if (PART_NAMES.indexOf(name) < 0) { err('register', 'unknown part "' + name + '"'); return false; }
    if (!def || typeof def !== 'object') { err('register', 'part "' + name + '" needs { mount, render }'); return false; }
    if (parts[name]) { err('register', 'part "' + name + '" registered twice'); return false; }
    parts[name] = { name: name, def: def, mounted: false, failed: false };
    if (onThisDevice(name) && shellReady) mountPart(parts[name]);
    return true;
  };
  CLEAN.part = function (name) { var p = parts[name]; return p ? { mounted: p.mounted, failed: p.failed } : null; };

  function mountPart(p) {
    var root = p.name === 'tv' ? tvEl : views[p.name];
    if (!root || p.mounted) return;
    root.innerHTML = '';
    try {
      if (typeof p.def.mount === 'function') p.def.mount(root);
      p.mounted = true;
    } catch (e) {
      p.failed = true;
      err(p.name + '.mount', e);
      if (p.name !== 'tv') showFallback(root);
      return;
    }
    callRender(p, 'mount');
  }
  function callRender(p, reason) {
    if (!p.mounted || p.failed || typeof p.def.render !== 'function') return;
    try { p.def.render(reason); } catch (e) { err(p.name + '.render', e); }
  }
  function renderAll(reason) {
    eachPart(function (p) { if (onThisDevice(p.name)) callRender(p, reason); });
  }
  CLEAN.render = function (name, reason) {
    if (name) { if (parts[name]) callRender(parts[name], reason || 'request'); }
    else renderAll(reason || 'request');
  };
  function showFallback(root) {
    root.innerHTML = '<div class="cl-empty">This screen didn’t load.<br><a href="' + esc(location.pathname) + '">Open the classic view</a></div>';
  }

  // Data arrived (cache paint, fresh load, failed refresh): one render pass.
  var dataTimer = null;
  function scheduleData(reason) {
    if (dataTimer) return;
    dataTimer = setTimeout(function () {
      dataTimer = null;
      bump();
      updateHeader();
      renderAll('data');
      emit('data', { reason: reason });
      refreshSettings();
    }, 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // APP HOOKS (wrap, never edit)
  // ════════════════════════════════════════════════════════════════════
  var origNowPulse = null;
  function after(name, fn) {
    var orig = window[name];
    if (typeof orig !== 'function') { err('hook', name + ' is not a function'); return false; }
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { fn.apply(this, [r].concat(Array.prototype.slice.call(arguments))); } catch (e) { err('hook.' + name, e); }
      return r;
    };
    wrapped._cleanOrig = orig;
    window[name] = wrapped;
    return true;
  }
  function installHooks() {
    // Every forecast paint (cached pre-paint and the post-fetch refresh)
    // passes through renderForecastSet with the full context; keep it for
    // the buoy's spectral band.
    after('renderForecastSet', function (r, ctx) { CLEAN._ctx = ctx || null; scheduleData('forecast'); });
    after('renderPinForecastSet', function () { CLEAN._ctx = null; scheduleData('forecast'); });
    // End of every load: STATE.dataAsOf / dataHealth are now true.
    after('recordDataHealth', function () { scheduleData('health'); });
    after('updateAuthUI', function () { emit('auth', authInfo()); refreshSettings(); });
    after('renderSurfLogTable', function () { emitSoon('log'); });
    after('slRetrain', function () { bump(); renderAll('model'); emitSoon('model'); });
    after('applyScrubberToHour', function (r, idx) { emit('hour', idx); });
    // The legacy chart is hidden: its 10 fps "now" pulse has nothing to draw.
    if (typeof startNowPulse === 'function') {
      origNowPulse = { start: window.startNowPulse };
      window.startNowPulse = function () { /* clean preview: legacy chart hidden */ };
    }
  }

  // ── Boat gate: skip it, as its "continue" (No) branch does ─────────
  // initGate runs on DOMContentLoaded (registered first); this listener
  // runs right after it. kiosk.js already seeds the gate for Choc TV.
  function passGate() {
    if (typeof STATE === 'undefined' || STATE.boatGatePassed) return;
    STATE.boatGatePassed = true;
    var ov = document.getElementById('gate-overlay');
    if (ov) ov.classList.add('hidden');
    var app = document.getElementById('app');
    if (app) app.classList.remove('hidden');
    var win = document.getElementById('app-window');
    if (win) win.classList.remove('hidden');
    if (typeof initApp === 'function') {
      var p = initApp();
      if (p && typeof p.catch === 'function') p.catch(function (e) { err('initApp', e); });
    }
  }

  // ── Unmount: give the page back to the classic app ─────────────────
  function unmount(why) {
    err('unmount', why || 'core failed');
    var root = document.documentElement;
    root.classList.remove('cl-on', 'cl-tv', 'cl-fade');
    root.removeAttribute('data-clean-theme');
    if (savedEra != null && document.body) document.body.setAttribute('data-era', savedEra);
    if (appEl && appEl.parentNode) appEl.parentNode.removeChild(appEl);
    if (tvEl && tvEl.parentNode) tvEl.parentNode.removeChild(tvEl);
    subStack.forEach(function (e) { if (e.el.parentNode) e.el.parentNode.removeChild(e.el); });
    subStack = [];
    if (origNowPulse) window.startNowPulse = origNowPulse.start;
    CLEAN.ready = false;
  }

  // ── Timers ─────────────────────────────────────────────────────────
  // Phone: refresh in the background once the forecast is 15 min old
  // (Choc TV refreshes itself), so the stale/dead cues stay rare and true.
  function refreshIfOld() {
    if (IS_TV || document.hidden || typeof STATE === 'undefined') return;
    try {
      if (typeof isDataLoadInFlight === 'function' && isDataLoadInFlight()) return;
      var done = STATE.lastLoadCompletedAt;
      if (!done || !STATE.selectedBuoy || Date.now() - done < REFRESH_MS) return;
      loadAllData(STATE.selectedBuoy);
    } catch (e) { err('refresh', e); }
  }
  var lastDay = '';
  function tick() {
    var dk = dayKey(new Date());
    if (dk !== lastDay) { if (lastDay) bump(); lastDay = dk; }
    applyTheme(false);
    updateHeader();
    refreshIfOld();
    emit('tick');
    refreshSettings();
  }

  // ════════════════════════════════════════════════════════════════════
  // BOOT
  // ════════════════════════════════════════════════════════════════════
  function onReady() {
    try { passGate(); } catch (e) { err('gate', e); }
    if (!CLEAN.ready) return;
    if (!IS_TV) {
      TABS.forEach(function (tb) { if (!parts[tb.id] || parts[tb.id].failed) showFallback(views[tb.id]); });
      var want = null;
      var hash = (location.hash || '').replace('#', '');
      if (/^(forecast|log|model)$/.test(hash)) want = hash;
      if (want && want !== curTab) showTab(want, { force: true });
      if (hash === 'settings') CLEAN.openSettings();
    }
  }
  function onLoad() {
    // Choc TV must never sit blank: without a working tv.js, give the
    // screen back to the classic Choc TV.
    if (IS_TV && CLEAN.ready) {
      setTimeout(function () {
        var p = parts.tv;
        if (!p || !p.mounted || p.failed) unmount('tv.js did not mount');
      }, 1500);
    }
  }
  function boot() {
    var root = document.documentElement, body = document.body;
    if (!body) throw new Error('no <body> at boot');
    mode = readMode();
    try {
      mqDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
      if (mqDark) {
        var onMq = function () { if (themeMode() === 'system') applyTheme(false); };
        if (mqDark.addEventListener) mqDark.addEventListener('change', onMq);
        else if (mqDark.addListener) mqDark.addListener(onMq);
      }
    } catch (_) { mqDark = null; }
    applyTheme(true);
    try { if (history.state && history.state.clSub) history.replaceState(null, ''); } catch (_) { /* fine */ }
    savedEra = body.getAttribute('data-era');
    body.removeAttribute('data-era');   // the Win95 era styles hang off it
    if (IS_TV) buildTV(); else buildPhone();
    root.classList.add('cl-on');
    if (IS_TV) root.classList.add('cl-tv');
    shellReady = true;
    themeColor();
    CLEAN.ready = true;
    installHooks();
    lastDay = dayKey(new Date());
    setInterval(guard('tick', tick), MIN);
    document.addEventListener('visibilitychange', guard('visible', function () { if (!document.hidden) tick(); }));
    document.addEventListener('DOMContentLoaded', onReady);
    window.addEventListener('load', onLoad);
    // Parts registered before the shell existed (none today) mount now.
    eachPart(function (p) { if (onThisDevice(p.name)) mountPart(p); });
  }

  try {
    boot();
  } catch (e) {
    err('boot', e);
    // The classic page, exactly as without ?preview (boat gate included).
    try { unmount('boot failed: ' + (e && e.message)); } catch (_) { /* nothing left to do */ }
  }
})();
