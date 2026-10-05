// ════════════════════════════════════════════════════════════════════
// CLEAN — tv.js (owner: TV part) · Choc TV under ?preview=clean
// ────────────────────────────────────────────────────────────────────
// The A2-TV boards over the real kiosk: three panels and one status
// strip inside #cl-tv (core's root, shown only when isKioskMode()).
//   • cl-days1  next three days (A2-TV); after sunset it leads with
//               Tomorrow under a "Dark until … · next window …" banner
//               (A2-TV-Night)
//   • cl-days2  days four to six (A2-TV-Days46)
//   • cl-radar  always-dark scope: the radar's coastline vectors
//               (kiosk.js KIOSK_COAST), range rings, the 115–158° cone,
//               swell and wind arrows converging on the reef, a sweep
//               once per 6 s, the hour playing forward 1 s per hour,
//               its readout and the 7-day swell strip (A2-TV-Radar)
// Day cards come from kiosk.js kioskDaySummary through CLEAN.data.week().
//
// The legacy kiosk keeps running underneath: its rotation timers, touch
// pause, 15-min refresh, code-signature check, nightly reload and boot
// watchdog are all kiosk.js's own. tv.js only renames KIOSK.panels to
// its three panels (so no legacy panel draws behind #cl-tv), sets the
// A2-Notes dwell times through kioskScheduleNext, and follows
// kioskShowPanel. Every wrapper calls through, and falls back to the
// legacy behaviour if the clean shell is ever taken down.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.CLEAN) return;            // core failed: the classic Choc TV is showing
  var C = window.CLEAN;
  if (!C.isTV) return;                  // phone: nothing to do (core never mounts 'tv' there)

  var D = C.data, F = C.fmt, U = C.util, I = C.icon;
  var esc = U.esc, isNum = U.isNum;
  var HOUR = 3600e3, MIN = 60e3, DAY = 864e5;
  var DASH = F.DASH, NB = F.NB;
  var CH = (typeof CONFIG !== 'undefined' && CONFIG.chocomount) || {};
  var WIN_MIN = isNum(CH.swellWindowMin) ? CH.swellWindowMin : 115;
  var WIN_MAX = isNum(CH.swellWindowMax) ? CH.swellWindowMax : 158;

  // Rotation (A2-Notes): next 3 days 10 s, days 4–6 6 s, radar 12 s —
  // a 28 s loop, so today is back inside 30 s. Cross-fades 600 ms.
  var PANELS = ['cl-days1', 'cl-days2', 'cl-radar'];
  var LEGACY = { days1: 'cl-days1', days2: 'cl-days2', radar: 'cl-radar', spectral: 'cl-days1' };
  var DWELL = { 'cl-days1': 10e3, 'cl-days2': 6e3, 'cl-radar': 12e3 };
  var FADE_MS = 600;

  var S = {
    mounted: false, restored: false,
    root: null, wrap: null, panels: {}, strip: {}, cur: null, prev: null, outTimer: null,
    u: 1, fitTimer: null, secTimer: null,
    play: { idx: -1, timer: null, stepMs: 1000 },
    radarKey: '', chart: null,
    orig: {}, legacyPanels: null
  };

  function err(where, e) { C.err('tv.' + where, e); }
  function guard(where, fn) { return C.guard('tv.' + where, fn); }
  function kiosk() { return typeof KIOSK !== 'undefined' ? KIOSK : null; }
  function paused() { var K = kiosk(); return !!(K && K.state === 'paused'); }
  function reduced() { return U.reducedMotion(); }
  function live() {
    return S.mounted && !S.restored && C.ready && document.documentElement.classList.contains('cl-tv');
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function param(name) {
    try { var v = parseFloat(new URLSearchParams(location.search).get(name)); return isFinite(v) && v > 0 ? v * 1000 : null; } catch (_) { return null; }
  }
  function nightTheme() { return C.theme() === 'night'; }
  function loading() { return D.freshness() === 'loading'; }

  // ════════════════════════════════════════════════════════════════════
  // SHELL — panels + status strip
  // ════════════════════════════════════════════════════════════════════
  function shellHTML() {
    return '' +
      '<div class="cl-tv-wrap">' +
        '<div class="cl-tv-panels">' +
          '<section class="cl-tv-panel cl-tv-days" data-panel="cl-days1" aria-label="The next three days">' +
            '<div class="cl-tv-banner" hidden></div>' +
            '<div class="cl-tv-cards"></div>' +
          '</section>' +
          '<section class="cl-tv-panel cl-tv-days" data-panel="cl-days2" aria-label="Days four to six">' +
            '<div class="cl-tv-cards"></div>' +
          '</section>' +
          '<section class="cl-tv-panel cl-tv-radar cl-tv-dark" data-panel="cl-radar" aria-label="Radar: the forecast playing forward">' +
            '<div class="cl-tv-rtop">' +
              '<div class="cl-tv-scope" role="img" aria-label="">' +
                '<div class="cl-tv-scope-base"></div>' +
                '<div class="cl-tv-sweep" aria-hidden="true">' + sweepSVG() + '</div>' +
                '<div class="cl-tv-scope-top"></div>' +
              '</div>' +
              '<div class="cl-tv-rt" aria-live="off"></div>' +
            '</div>' +
            '<div class="cl-tv-cht"></div>' +
          '</section>' +
        '</div>' +
        '<footer class="cl-tv-strip">' +
          '<span class="cl-tv-fc">Forecast loading</span>' +
          '<span class="cl-tv-by"></span>' +
          '<span class="cl-tv-ps" hidden>Paused</span>' +
          '<span class="cl-tv-sp"></span>' +
          '<span class="cl-tv-clk"></span>' +
          '<button type="button" class="cl-tv-btn" data-act="sources" aria-haspopup="dialog">Sources</button>' +
          '<button type="button" class="cl-tv-btn" data-act="next">Next</button>' +
        '</footer>' +
      '</div>';
  }

  function cache(root) {
    S.root = root;
    S.wrap = root.querySelector('.cl-tv-wrap');
    PANELS.forEach(function (p) { S.panels[p] = root.querySelector('[data-panel="' + p + '"]'); });
    var st = root.querySelector('.cl-tv-strip');
    S.strip = {
      el: st,
      fc: st.querySelector('.cl-tv-fc'),
      by: st.querySelector('.cl-tv-by'),
      ps: st.querySelector('.cl-tv-ps'),
      clk: st.querySelector('.cl-tv-clk'),
      sources: st.querySelector('[data-act="sources"]'),
      next: st.querySelector('[data-act="next"]')
    };
    var rd = S.panels['cl-radar'];
    S.radar = {
      scope: rd.querySelector('.cl-tv-scope'),
      base: rd.querySelector('.cl-tv-scope-base'),
      sweep: rd.querySelector('.cl-tv-sweep'),
      top: rd.querySelector('.cl-tv-scope-top'),
      rt: rd.querySelector('.cl-tv-rt'),
      cht: rd.querySelector('.cl-tv-cht')
    };
  }

  // Size unit: the boards are drawn at 1180 × 820 (iPad Air landscape).
  // One --u is one board pixel, a share of the screen height (A2-Tokens:
  // hero 152 px = 18.5vh), so 1366 × 1024 (iPad Pro) scales up. Only a
  // screen far narrower than the boards (portrait) is held by its width.
  // The fit pass below absorbs the slightly narrower cards of 4:3.
  // tv.css sets the same rule in CSS units; this pins it to the root's
  // real box (Safari's vh can include hidden toolbars).
  function measureUnit() {
    if (!S.root) return false;
    var w = S.root.clientWidth, h = S.root.clientHeight;
    if (!w || !h) return false;
    var u = Math.min(h / 820, w / 1180 * 1.1);
    u = Math.round(u * 10000) / 10000;
    if (u === S.u && S.wrap.style.getPropertyValue('--u')) return false;
    S.u = u;
    S.wrap.style.setProperty('--u', u + 'px');
    return true;
  }

  // ════════════════════════════════════════════════════════════════════
  // PANELS — show / cross-fade
  // ════════════════════════════════════════════════════════════════════
  function showPanel(name, instant) {
    if (PANELS.indexOf(name) < 0) name = LEGACY[name] || 'cl-days1';
    if (name === S.cur && !instant) return;
    var prev = S.cur;
    S.cur = name;
    var noFade = instant || reduced() || !prev;
    clearTimeout(S.outTimer);
    PANELS.forEach(function (p) {
      var el = S.panels[p];
      var on = p === name, out = p === prev && !noFade;
      el.classList.toggle('is-on', on);
      el.classList.toggle('is-out', out);
      el.classList.toggle('no-anim', noFade);
      if (on) { el.removeAttribute('aria-hidden'); el.removeAttribute('inert'); }
      else { el.setAttribute('aria-hidden', 'true'); el.setAttribute('inert', ''); }
    });
    if (!noFade) {
      S.outTimer = setTimeout(function () {
        PANELS.forEach(function (p) { if (p !== S.cur) S.panels[p].classList.remove('is-out'); });
      }, FADE_MS + 50);
    }
    // The radar is dark day and night; the strip goes dark with it.
    S.strip.el.classList.toggle('cl-tv-dark', name === 'cl-radar');
    S.root.setAttribute('data-panel', name);
    if (name === 'cl-radar') startPlay(); else stopPlay();
    renderStrip();
  }

  // ════════════════════════════════════════════════════════════════════
  // DAY CARDS (A2-TV, A2-TV-Night, A2-TV-Days46)
  // ════════════════════════════════════════════════════════════════════
  // After sunset the first panel leads with Tomorrow; before sunrise
  // today is still ahead, so it leads with Today.
  function leadOffset() {
    var s = D.sun(new Date());
    return s && s.sunset && Date.now() >= s.sunset.getTime() ? 1 : 0;
  }
  function darkAt(t) { return !!(t && D.isAfterDark(t)); }
  function timeB(t) {
    return '<b' + (darkAt(t) ? ' class="cl-tv-dim"' : '') + '>' + esc(F.time(t)) + '</b>';
  }
  function statusHTML(s) {
    if (!s) return '';
    var c = s === 'in' ? 'in' : s === 'edge' ? 'edge' : 'blk';
    return '<div class="cl-tv-strow"><span class="cl-tv-st cl-tv-st-' + c + '"><i class="cl-tv-dt" aria-hidden="true"></i>' +
      esc(F.status(s)) + '</span></div>';
  }
  function qualityHTML(q) {
    if (!q) return '';
    return '<span class="cl-tv-q ' + U.qualityClass(q) + '">' + esc(F.quality(q)) + '</span>';
  }
  function heroHTML(text, unit) {
    return '<div class="cl-tv-hero' + (text === DASH ? ' is-none' : '') + '"><span class="cl-tv-num">' + esc(text) + '</span>' +
      (unit ? '<span class="cl-tv-unit">' + esc(unit) + '</span>' : '') + '</div>';
  }
  function swLineHTML(period, compass, dir) {
    var t = '@ ' + F.period(period) + (compass ? ' ' + compass : '');
    return '<div class="cl-tv-sw"><span>' + esc(t) + '</span>' + I.swell(dir, 40) + '</div>';
  }
  // "Nothing reaches the reef" + "2 ft @ 6 s ESE · 105° · blocked"
  function blockedHTML(hgt, period, compass, dir) {
    return '<div class="cl-tv-blk">Nothing reaches the reef</div>' +
      '<div class="cl-tv-bl"><span class="cl-nowrap">' + esc(F.swell(hgt, period, compass)) + ' ·</span> <span class="cl-nowrap">' + esc(F.deg(dir) + ' · blocked') + '</span></div>';
  }
  function windHTML(w, prefix) {
    if (!w) return '<div class="cl-tv-wd cl-tv-mute"><span>' + (loading() ? DASH : 'No wind forecast') + '</span></div>';
    // Wraps like prose, but "At low", "15 mph" and "· onshore" never split.
    return '<div class="cl-tv-wd">' + I.wind(w.dir, 38) + '<span>' +
      (prefix ? esc(prefix.replace(/ /g, NB)) + ' ' : '') +
      esc(F.wind(w.mph, w.dir)) +
      (w.quality ? ' <span class="cl-nowrap">· ' + qualityHTML(w.quality) + '</span>' : '') +
      '</span></div>';
  }
  function noonWind(d) {
    try {
      if (typeof kioskWindAt !== 'function') return null;
      var w = kioskWindAt(d.date.getTime() + 12 * HOUR);
      if (!w || !isNum(w.mph)) return null;
      return { mph: w.mph, dir: isNum(w.dir) ? w.dir : null, quality: U.windQuality(w.mph, w.dir) };
    } catch (e) { err('noonWind', e); return null; }
  }

  function cardHTML(d, label) {
    var h = '<div class="cl-tv-day cl-serif">' + esc(label) + '</div>';
    if (!d) return '<article class="cl-tv-card">' + h + heroHTML(DASH) + '</article>';
    var sw = d.swell, st = d.status, blocked = st === 'blocked';
    if (!sw) {
      h += heroHTML(DASH) + '<div class="cl-tv-sw cl-tv-mute"><span>' + (loading() ? 'Waiting for the forecast' : 'No swell forecast') + '</span></div>';
    } else if (blocked) {
      h += blockedHTML([sw.min, sw.max], sw.period, sw.compass, sw.dir);
    } else {
      h += heroHTML(F.range(sw.min, sw.max), 'ft') + swLineHTML(sw.period, sw.compass, sw.dir);
    }
    h += statusHTML(st);
    // Tide leads with the time of the low.
    var lo = d.low;
    if (lo && lo.t) {
      var txt = !blocked && lo.until
        ? '<span class="cl-nowrap">Incoming ' + timeB(lo.t) + '</span> <span class="cl-nowrap">until ' + timeB(lo.until) + '</span>'
        : '<span class="cl-nowrap">Low ' + timeB(lo.t) + '</span>';
      h += '<div class="cl-tv-win">' + I.tide(38) + '<span>' + txt + '</span></div>';
      h += windHTML(lo.wind, 'At low');
    } else {
      h += '<div class="cl-tv-win cl-tv-mute">' + I.tide(38) + '<span>' + (loading() ? DASH : 'No tide times') + '</span></div>';
      h += windHTML(noonWind(d), 'At noon');
    }
    var sun = d.sun, moon = d.moon;
    if (sun || moon) {
      h += '<div class="cl-tv-sun">' +
        (sun ? '<span class="cl-nowrap">Sunrise ' + esc(F.time(sun.sunrise)) + ' ·</span> <span class="cl-nowrap">Sunset ' + esc(F.time(sun.sunset)) + '</span>' : '') +
        (moon && isNum(moon.pct) ? (sun ? '<br>' : '') + 'Moon ' + moon.pct + '%' : '') +
        '</div>';
    }
    return '<article class="cl-tv-card' + (blocked ? ' is-blk' : '') + '">' + h + '</article>';
  }

  function bannerHTML() {
    if (!nightTheme()) return '';
    var now = new Date(), s = D.sun(now), first;
    var du = D.darkUntil(now);
    if (du) first = 'Dark until <b>' + esc(F.time(du)) + '</b>';
    else if (s && s.sunset && now >= s.sunset && s.lastLight) first = 'Last light <b>' + esc(F.time(s.lastLight)) + '</b>';
    else if (s && s.sunrise) first = 'Sunrise <b>' + esc(F.time(s.sunrise)) + '</b>';
    else return '';
    var nw = D.nextWindow();
    var next = nw && nw.start ? ' <span class="cl-nowrap">· next window <b>' + esc(F.when(nw.start)) + '</b></span>' : '';
    return '<span class="cl-nowrap">' + first + '</span>' + next;
  }

  function renderDays() {
    var wk = D.week() || [];
    var lead = leadOffset();
    var p1 = S.panels['cl-days1'], p2 = S.panels['cl-days2'];
    var c1 = '', c2 = '';
    for (var i = 0; i < 3; i++) {
      var k = lead + i, d = wk[k] || null;
      var label = i === 0 ? (k === 0 ? 'Today' : 'Tomorrow') : (d ? F.day(new Date(d.date.getTime() + 12 * HOUR)) : DASH);
      c1 += cardHTML(d, label);
    }
    for (var j = 3; j < 6; j++) {
      var k2 = lead + j, d2 = wk[k2] || null;
      c2 += cardHTML(d2, d2 ? F.day(new Date(d2.date.getTime() + 12 * HOUR)) : DASH);
    }
    setHTML(p1.querySelector('.cl-tv-cards'), c1);
    setHTML(p2.querySelector('.cl-tv-cards'), c2);
    var b = p1.querySelector('.cl-tv-banner'), bh = bannerHTML();
    setHTML(b, bh);
    b.hidden = !bh;
    p1.classList.toggle('has-banner', !!bh);
  }
  function setHTML(el, html) {
    if (el.__html === html) return false;
    el.__html = html;
    el.innerHTML = html;
    return true;
  }

  // ════════════════════════════════════════════════════════════════════
  // RADAR (A2-TV-Radar) — always dark
  // ════════════════════════════════════════════════════════════════════
  // Scope viewBox 440 × 440, reef at the centre. The coastline is the
  // kiosk radar's trace (KIOSK_COAST, normalised over the lineup photo
  // frame, reef at its centre), scaled like the phone's lineup picture
  // (frame height ≈ 2.07 × the cone radius) so phone and TV share one
  // set of shapes.
  var SC = { cx: 220, cy: 220, ring: [210, 140, 70], cone: 190, gap: 12 };
  function at(deg, r) {
    var th = deg * Math.PI / 180;
    return [SC.cx + Math.sin(th) * r, SC.cy - Math.cos(th) * r];
  }
  function pt(p) { return r1(p[0]) + ' ' + r1(p[1]); }
  function coast() {
    try { return typeof KIOSK_COAST !== 'undefined' && KIOSK_COAST && KIOSK_COAST.shore ? KIOSK_COAST : null; } catch (_) { return null; }
  }
  function scopeBaseSVG() {
    var o = [];
    SC.ring.forEach(function (r, k) {
      o.push('<circle class="ring" cx="220" cy="220" r="' + r + '" stroke-width="' + (k ? 1.5 : 2) + '"/>');
    });
    var CO = coast();
    if (CO) {
      var fh = SC.cone * 2.07, fw = fh * (CO.aspect || 1992 / 949);
      var fx = SC.cx - CO.lineup[0] * fw, fy = SC.cy - CO.lineup[1] * fh;
      var P = function (p) { return [fx + p[0] * fw, fy + p[1] * fh]; };
      var shore = CO.shore.map(P);
      var endY = shore[shore.length - 1][1];
      var line = shore.map(pt).join('L') + 'L' + pt([460, endY]);
      // Land is everything above / left of the traced shore.
      // Clipped to the outer ring, like a scope.
      o.push('<clipPath id="cl-tv-ring"><circle cx="220" cy="220" r="' + SC.ring[0] + '"/></clipPath><g clip-path="url(#cl-tv-ring)">');
      o.push('<path class="land" d="M' + line + 'L460 -20L-20 -20L' + pt([-20, Math.max(460, shore[0][1])]) + 'Z"/>');
      (CO.ponds || []).forEach(function (pond) { o.push('<path class="pond" d="M' + pond.map(P).map(pt).join('L') + 'Z"/>'); });
      o.push('<path class="shore" d="M' + line + '"/></g>');
    }
    return '<svg viewBox="0 0 440 440" aria-hidden="true" focusable="false">' + o.join('') + '</svg>';
  }
  // The sweep: a line with a fading 36° trail, pointing north; the
  // whole layer turns (CSS, 6 s per turn, 20 steps a second).
  function sweepSVG() {
    var o = [], R = 200;
    for (var k = 5; k >= 0; k--) {
      var a1 = at(-(k + 1) * 6, R), a2 = at(-k * 6, R);
      o.push('<path d="M220 220L' + pt(a1) + 'A200 200 0 0 1 ' + pt(a2) + 'Z" opacity="' + (0.155 - k * 0.025).toFixed(3) + '"/>');
    }
    o.push('<line x1="220" y1="220" x2="220" y2="20" class="ln"/>');
    return '<svg viewBox="0 0 440 440" focusable="false">' + o.join('') + '</svg>';
  }
  // Arrow pointing at the reef from where it comes FROM: tip 12 out
  // from the marker, tail `len` further, two arms of the head.
  function arrowPath(fromDeg, len) {
    var u = at(fromDeg, 1), ux = u[0] - SC.cx, uy = u[1] - SC.cy;
    var tip = [SC.cx + ux * SC.gap, SC.cy + uy * SC.gap];
    var tail = [SC.cx + ux * (SC.gap + len), SC.cy + uy * (SC.gap + len)];
    var arm = function (deg) {
      var a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
      return [tip[0] + (ux * cs - uy * sn) * 12, tip[1] + (ux * sn + uy * cs) * 12];
    };
    return { d: 'M' + pt(tail) + 'L' + pt(tip) + 'M' + pt(arm(34)) + 'L' + pt(tip) + 'L' + pt(arm(-34)), tail: tail };
  }
  function nearBearing(dir, lo, hi) { return isNum(dir) && dir >= lo && dir <= hi; }
  function scopeTopSVG(sw, w) {
    var o = [];
    var e1 = at(WIN_MIN, SC.cone), e2 = at(WIN_MAX, SC.cone);
    o.push('<path class="cone" d="M220 220L' + pt(e1) + 'A' + SC.cone + ' ' + SC.cone + ' 0 0 1 ' + pt(e2) + 'Z"/>');
    if (sw && isNum(sw.dir)) {
      var len = U.clamp(60 + Math.sqrt(sw.h * sw.h * (sw.period || 1)) * 30, 80, 178);
      var cls = sw.status === 'in' ? 'in' : sw.status === 'edge' ? 'edge' : 'blk';
      o.push('<path class="arr sa-' + cls + '" d="' + arrowPath(sw.dir, len).d + '"/>');
    }
    if (w && isNum(w.dir) && isNum(w.mph)) {
      o.push('<path class="arr wa" d="' + arrowPath(w.dir, U.clamp(50 + w.mph * 9, 70, 175)).d + '"/>');
    }
    o.push('<circle class="mk" cx="220" cy="220" r="7"/>');
    o.push('<text class="n" x="220" y="30" text-anchor="middle">N</text>');
    // The cone's real-world ends. An arrow coming in near 115° would run
    // through the SW Pt label, so the label drops below the edge then.
    var low = nearBearing(sw && sw.dir, 92, 128) || nearBearing(w && w.dir, 92, 128);
    var ly = low ? 330 : 268;
    o.push('<text class="lab" x="436" y="' + ly + '" text-anchor="end">SW Pt Block</text>');
    o.push('<text class="lab" x="436" y="' + (ly + 19) + '" text-anchor="end">' + WIN_MIN + '°</text>');
    o.push('<text class="lab" x="' + r1(e2[0] + 9) + '" y="418" text-anchor="middle">Montauk Pt</text>');
    o.push('<text class="lab" x="' + r1(e2[0] + 9) + '" y="436" text-anchor="middle">' + WIN_MAX + '°</text>');
    return '<svg viewBox="0 0 440 440" aria-hidden="true" focusable="false">' + o.join('') + '</svg>';
  }

  // The biggest train that reaches the reef (in window or at the edge)
  // and the biggest blocked one, as the phone's chart splits them.
  function splitTrains(hr) {
    var reach = null, blocked = null;
    if (hr) [hr.swell].concat(hr.others || []).forEach(function (t) {
      if (!t || !isNum(t.h) || t.h <= 0) return;
      if (t.status === 'in' || t.status === 'edge') { if (!reach || t.h > reach.h) reach = t; }
      else if (t.status === 'blocked') { if (!blocked || t.h > blocked.h) blocked = t; }
    });
    return { reach: reach, blocked: blocked };
  }

  // ── 7-day swell strip (viewBox 1100 × 205) ─────────────────────────
  var CW = 1100, PLOT_TOP = 14, BASE = 154, BAND_Y = 174, BAND_H = 12, CUR_H = 190;
  function buildChart() {
    var t0 = U.startOfDay(new Date()).getTime(), span = 7 * DAY;
    var hrs = D.hours() || [];
    var X = function (t) { return (t - t0) / span * CW; };
    var rows = [], maxH = 2;
    hrs.forEach(function (hr) {
      if (!hr || !hr.at) return;
      var t = hr.at.getTime();
      if (t < t0 - HOUR || t > t0 + span + HOUR) return;
      var tr = splitTrains(hr);
      var g = tr.reach ? tr.reach.h : 0, b = tr.blocked ? tr.blocked.h : 0;
      maxH = Math.max(maxH, g, b);
      rows.push({ idx: hr.idx, t: t, x: X(t), g: g, b: b, st: tr.reach ? tr.reach.status : tr.blocked ? 'blocked' : null, dark: hr.dark });
    });
    var Y = function (h) { return BASE - h / (maxH * 1.08) * (BASE - PLOT_TOP); };
    var o = [];
    // Night: sunset → sunrise.
    var nt = '';
    for (var k = -1; k <= 7; k++) {
      var s = D.sun(new Date(t0 + k * DAY + 12 * HOUR)), s2 = D.sun(new Date(t0 + (k + 1) * DAY + 12 * HOUR));
      if (!s || !s.sunset || !s2 || !s2.sunrise) continue;
      var a = Math.max(0, X(s.sunset.getTime())), b2 = Math.min(CW, X(s2.sunrise.getTime()));
      if (b2 > a) nt += 'M' + r1(a) + ' 0h' + r1(b2 - a) + 'v' + CUR_H + 'h' + r1(a - b2) + 'z';
    }
    if (nt) o.push('<path class="nt" d="' + nt + '"/>');
    if (rows.length) {
      // Runs of positive values with square ends half an hour out, as the
      // phone chart draws them: the two trains often trade places hour to
      // hour, and a slope down to zero would read as a spike.
      var hs = HOUR / span * CW;
      var area = function (key) {
        var d = '', run = null;
        var flush = function () {
          if (!run) return;
          var first = run[0], last = run[run.length - 1];
          var x0 = Math.max(0, first[0] - hs / 2), x1 = Math.min(CW, last[0] + hs / 2);
          d += 'M' + r1(x0) + ' ' + BASE + 'L' + r1(x0) + ' ' + r1(first[1]) + 'L' +
            run.map(function (q) { return r1(q[0]) + ' ' + r1(q[1]); }).join('L') +
            'L' + r1(x1) + ' ' + r1(last[1]) + 'L' + r1(x1) + ' ' + BASE + 'Z';
          run = null;
        };
        rows.forEach(function (r) {
          if (r[key] > 0) (run = run || []).push([r.x, Y(r[key])]);
          else flush();
        });
        flush();
        return d;
      };
      var dg = area('b'), dsw = area('g');
      if (dg) o.push('<path class="gh" d="' + dg + '"/>');
      if (dsw) o.push('<path class="sw" d="' + dsw + '"/>');
      // Window band: in / edge / blocked per hour, merged into runs.
      var run = null, step = hs;
      var flush = function () { if (run && run.st) o.push('<rect class="b-' + run.st + '" x="' + r1(run.x1) + '" y="' + BAND_Y + '" width="' + r1(Math.max(0.5, run.x2 - run.x1)) + '" height="' + BAND_H + '"/>'); };
      rows.forEach(function (r) {
        var st = r.st === 'in' ? 'in' : r.st === 'edge' ? 'edge' : r.st === 'blocked' ? 'blk' : null;
        var x1 = Math.max(0, r.x - step / 2), x2 = Math.min(CW, r.x + step / 2);
        if (run && run.st === st && Math.abs(run.x2 - x1) < 0.01) { run.x2 = x2; return; }
        flush();
        run = { st: st, x1: x1, x2: x2 };
      });
      flush();
    }
    for (var d = 0; d < 7; d++) {
      o.push('<text x="' + r1(X(t0 + d * DAY) + 6) + '" y="203">' + esc(F.day(new Date(t0 + d * DAY + 12 * HOUR))) + '</text>');
    }
    o.push('<line class="cur" x1="-10" y1="0" x2="-10" y2="' + CUR_H + '"/>');
    return {
      t0: t0, X: X, rows: rows,
      svg: '<svg viewBox="0 0 ' + CW + ' 205" role="img" aria-label="Seven-day swell: green reaches the reef, grey is blocked, the line is the playing hour" focusable="false">' + o.join('') + '</svg>'
    };
  }

  function renderRadarStatic() {
    var key = D.generation() + '|' + U.dayKey(new Date()) + '|' + (D.loaded() ? 1 : 0);
    if (key === S.radarKey) return;
    S.radarKey = key;
    S.radar.base.innerHTML = scopeBaseSVG();
    S.chart = buildChart();
    S.radar.cht.innerHTML = S.chart.svg;
    S.chart.cur = S.radar.cht.querySelector('.cur');
    // The data changed under the playback: stay on the same clock hour.
    if (S.play.t != null) {
      var i = D.indexAt(new Date(S.play.t));
      S.play.idx = i >= 0 ? i : -1;
    }
  }

  // ── Playback: one forecast hour per step, daylight hours only ───────
  // A dark hour is nothing anyone can surf, so the scope plays the
  // daylight hours from now through the 7-day strip and loops. Each
  // radar visit carries on where the last one stopped, so the loop
  // walks through the week (12 s ≈ one day of light).
  function hrAt(i) { var a = D.hours() || []; return a[i] || null; }
  function playable(i, nowIdx) {
    var hr = hrAt(i);
    if (!hr || !hr.at) return false;
    if (i < nowIdx) return false;
    if (S.chart && hr.at.getTime() >= S.chart.t0 + 7 * DAY) return false;
    return !hr.dark;
  }
  function firstPlayable(from) {
    var n = (D.hours() || []).length, nowIdx = Math.max(0, D.nowIndex());
    for (var i = Math.max(from, nowIdx); i < n; i++) if (playable(i, nowIdx)) return i;
    return nowIdx < n ? nowIdx : -1;
  }
  function nextPlayable(i) {
    var n = (D.hours() || []).length, nowIdx = Math.max(0, D.nowIndex());
    for (var k = 0; k < n; k++) {
      i++;
      var hi = i < n ? hrAt(i) : null;
      if (i >= n || (S.chart && hi && hi.at && hi.at.getTime() >= S.chart.t0 + 7 * DAY)) i = nowIdx;
      if (playable(i, nowIdx)) return i;
    }
    return nowIdx;
  }
  function setPlay(i) {
    S.play.idx = i;
    var t = D.timeAt(i);
    S.play.t = t ? t.getTime() : null;
    renderRadarHour();
  }
  function startPlay() {
    stopPlay();
    if (!D.loaded()) { renderRadarHour(); return; }
    var nowIdx = Math.max(0, D.nowIndex());
    var i = S.play.idx;
    if (i < 0 || !playable(i, nowIdx)) i = firstPlayable(nowIdx);
    setPlay(i);
    var K = kiosk();
    S.play.stepMs = Math.max(250, (K && K.radarStepMs) || 1000);
    S.play.timer = setInterval(guard('play', function () {
      if (paused() || !D.loaded()) return;
      setPlay(nextPlayable(S.play.idx));
    }), S.play.stepMs);
  }
  function stopPlay() {
    if (S.play.timer) { clearInterval(S.play.timer); S.play.timer = null; }
  }

  // Readout for the playing hour, the swell and wind arrows, the cursor.
  function renderRadarHour() {
    var R = S.radar;
    var hr = S.play.idx >= 0 ? hrAt(S.play.idx) : null;
    var tr = splitTrains(hr), sw = tr.reach || (hr && hr.swell) || null;
    var w = hr && hr.wind;
    var html;
    if (!hr) {
      var waiting = D.freshness() === 'loading';
      html = '<div class="cl-tv-day cl-serif">' + esc(F.dayLabel(new Date(), { tomorrow: true }) + ' ' + F.time(new Date())) + '</div>' +
        heroHTML(DASH) +
        '<div class="cl-tv-hint">' + (waiting ? 'Waiting for the forecast' : 'No forecast to play') + '</div>';
    } else {
      html = '<div class="cl-tv-day cl-serif">' + esc(F.dayLabel(hr.at, { tomorrow: true }) + ' ' + F.time(hr.at)) + '</div>';
      if (!sw) html += heroHTML(DASH);
      else if (tr.reach) html += heroHTML(F.num(sw.h), 'ft') + swLineHTML(sw.period, sw.compass, sw.dir);
      else html += blockedHTML(sw.h, sw.period, sw.compass, sw.dir);
      html += statusHTML(sw ? sw.status : null);
      html += windHTML(w, '');
      html += '<div class="cl-tv-hint">' + (paused() ? 'Paused. Tap to play' : 'Playing forward, 1 hour per second') + '</div>';
    }
    setHTML(R.rt, html);
    setHTML(R.top, scopeTopSVG(sw, w));
    var label = 'Radar scope: the ' + WIN_MIN + '–' + WIN_MAX + '° swell window' +
      (sw ? ', swell ' + F.swell(sw.h, sw.period, sw.compass) + ' ' + F.status(sw.status).toLowerCase() : '') +
      (w ? ', wind ' + F.wind(w.mph, w.dir) : '');
    if (R.scope.getAttribute('aria-label') !== label) R.scope.setAttribute('aria-label', label);
    if (S.chart && S.chart.cur) {
      var x = hr && hr.at ? r1(S.chart.X(hr.at.getTime())) : -10;
      S.chart.cur.setAttribute('x1', x);
      S.chart.cur.setAttribute('x2', x);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // STATUS STRIP — forecast age, buoy age, clock, Sources, Next
  // ════════════════════════════════════════════════════════════════════
  function forecastLine() {
    var st = typeof STATE !== 'undefined' ? STATE : {};
    var lvl = D.freshness();
    if (lvl === 'loading') return { text: 'Forecast loading', lvl: '' };
    var asOf = null;
    try { asOf = typeof kioskDataAsOf === 'function' ? kioskDataAsOf() : st.dataAsOf; } catch (e) { err('asOf', e); asOf = st.dataAsOf; }
    if (!isNum(asOf)) return { text: 'No forecast data', lvl: 'dead' };
    return { text: 'Forecast updated ' + F.ago(new Date(asOf)), lvl: lvl === 'fresh' ? '' : lvl };
  }
  function buoyLine() {
    var b = D.buoy();
    if (!b || !b.obsAt) return { text: D.freshness() === 'loading' ? '' : 'Buoy ' + DASH, lvl: '' };
    var lvl = b.level;
    try {
      // Live age, not the one memoised with the data.
      if (typeof buoyObsAge === 'function') { var a = buoyObsAge(b.obsAt.getTime()); if (a) lvl = a.level === 'old' ? 'dead' : a.level; }
    } catch (e) { err('buoyAge', e); }
    return { text: 'Buoy ' + F.age(b.obsAt), lvl: lvl === 'stale' || lvl === 'dead' ? lvl : '' };
  }
  function setLine(el, line) {
    var changed = false;
    if (el.textContent !== line.text) { el.textContent = line.text; changed = true; }
    var c = line.lvl ? 'is-' + line.lvl : '';
    if ((el.__lvl || '') !== c) {
      el.classList.remove('is-stale', 'is-dead');
      if (c) el.classList.add(c);
      el.__lvl = c;
      changed = true;
    }
    if (el.hidden !== !line.text) { el.hidden = !line.text; changed = true; }
    return changed;
  }
  function renderStrip() {
    var s = S.strip;
    var changed = setLine(s.fc, forecastLine());
    changed = setLine(s.by, buoyLine()) || changed;
    var clk = F.time(new Date());
    if (s.clk.textContent !== clk) { s.clk.textContent = clk; changed = true; }
    var p = paused();
    if (s.ps.hidden === p) { s.ps.hidden = !p; changed = true; }
    S.wrap.classList.toggle('is-paused', p);
    // The ages grow ("3h 50m ago"): keep Next on screen.
    if (changed) fitStrip();
  }

  // Once a second: clock, ages, the paused cue (and the radar's hint).
  var wasPaused = null;
  function secTick() {
    if (!live()) return;
    renderStrip();
    var p = paused();
    if (p !== wasPaused) {
      wasPaused = p;
      if (S.cur === 'cl-radar') renderRadarHour();
    }
  }

  // ── Sources: the legacy card, restyled, with this TV's own content ──
  var TXT_DAYS = 'Each day shows the swell over the incoming tide in daylight (from a low to the next high), sampled one swell-travel hour earlier at the offshore forecast point. In window means it arrives from ' + WIN_MIN + '–' + WIN_MAX + '°, between Block Island’s Southwest Point and Montauk Point; blocked means land stops it before the reef. The wind is the forecast at the low. Times in the dark are dimmed.';
  var TXT_RADAR = 'The scope plays the forecast forward one daylight hour per second. The green cone is the ' + WIN_MIN + '–' + WIN_MAX + '° swell window; the swell and wind arrows point the way they travel, onto the reef. Below it, the week: green is swell that reaches the reef, grey is swell the land blocks, the band is the window, shaded columns are night. Tap to pause, tap again to play.';
  function sourcesHTML() {
    var rows = (D.sources() || []).map(function (s) {
      var c = s.level === 'stale' ? ' is-stale' : s.level === 'dead' ? ' is-dead' : s.level === 'none' ? ' is-none' : '';
      return '<div class="cl-tv-src-r"><span>' + esc(s.label) + '</span><span class="cl-tv-src-v' + c + '">' + esc(s.text) + '</span></div>';
    }).join('');
    var K = kiosk() || {};
    var build = K.codeSig ? String(K.codeSig).slice(0, 7) : DASH;
    var since = K.bootAt ? ' · running since ' + F.when(new Date(K.bootAt)) : '';
    return '<h3 class="cl-serif">Sources</h3>' +
      '<div class="cl-tv-src-rows">' + rows + '</div>' +
      '<p>' + esc(S.cur === 'cl-radar' ? TXT_RADAR : TXT_DAYS) + '</p>' +
      '<p>Swell and wind: Open-Meteo forecast. Tides: NOAA CO-OPS predictions, station 8510719. Buoy: NDBC 44097, Block Island, through the site’s two-hourly pipeline. Sunrise and sunset: computed solar position.</p>' +
      '<p class="cl-tv-src-fine">Build ' + esc(build) + esc(since) + ' · tap anywhere to close</p>';
  }
  function openSources() {
    var ov = document.getElementById('kiosk-info-overlay');
    var card = document.getElementById('kiosk-info-card');
    if (!ov || !card) return;
    // Adopt the legacy overlay: kioskInfoOpen() keeps reading it, so the
    // self-heal reload never fires under a reader, and kiosk.js still
    // closes it on a tap or a panel change.
    if (ov.parentNode !== S.root) S.root.appendChild(ov);
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Sources');
    ov.classList.toggle('cl-tv-dark', S.cur === 'cl-radar');
    card.innerHTML = sourcesHTML();
    ov.style.display = '';
  }
  function onNext() {
    if (paused() && typeof kioskResume === 'function') kioskResume();
    else if (typeof kioskAdvance === 'function') kioskAdvance();
  }

  // ════════════════════════════════════════════════════════════════════
  // FIT — the boards never wrap badly or spill under the strip
  // ════════════════════════════════════════════════════════════════════
  // One-line rows (hero, swell line, status) shrink to their card's
  // width; then the panel steps its spacing (and at last its type) down
  // until every card fits above the strip. Only runs after a render or
  // a resize; inactive panels are laid out (visibility: hidden).
  var DENSITY = [[1, 1], [0.66, 1], [0.5, 0.94], [0.4, 0.88], [0.3, 0.8]];
  // One factor per row kind across the panel's three cards, so the
  // cards keep one type size (as kiosk.js keeps one digit size). A
  // selector list is one group (the tide and wind lines share a size).
  function fitRows(cards, sel) {
    var rows = [], f = 1;
    Array.prototype.forEach.call(cards, function (c) {
      Array.prototype.forEach.call(c.querySelectorAll(sel), function (el) { el.style.removeProperty('--fk'); rows.push(el); });
    });
    rows.forEach(function (el) {
      if (el.scrollWidth > el.clientWidth + 1 && el.scrollWidth) f = Math.min(f, el.clientWidth / el.scrollWidth * 0.98);
    });
    if (f < 1) { f = Math.max(0.55, f).toFixed(3); rows.forEach(function (el) { el.style.setProperty('--fk', f); }); }
  }
  function overflowsY(els) {
    for (var i = 0; i < els.length; i++) if (els[i].scrollHeight > els[i].clientHeight + 1) return true;
    return false;
  }
  function fitDays(p) {
    var cards = p.querySelectorAll('.cl-tv-card');
    var lvl = 0;
    for (; lvl < DENSITY.length; lvl++) {
      p.style.setProperty('--gk', DENSITY[lvl][0]);
      p.style.setProperty('--tk', DENSITY[lvl][1]);
      // A no-break group ("Incoming 10:44 AM") wider than its card shrinks too.
      ['.cl-tv-hero', '.cl-tv-sw', '.cl-tv-strow', '.cl-tv-win, .cl-tv-wd', '.cl-tv-bl'].forEach(function (sel) { fitRows(cards, sel); });
      if (!overflowsY(cards)) break;
    }
    p.setAttribute('data-density', String(Math.min(lvl, DENSITY.length - 1)));
  }
  // The forecast age may shrink (ellipsis) as a last resort, so it
  // counts as overflowing too.
  function stripOver() {
    var s = S.strip.el, fc = S.strip.fc;
    return s.scrollWidth > s.clientWidth + 1 || fc.scrollWidth > fc.clientWidth + 1;
  }
  function fitStrip() {
    var s = S.strip.el;
    s.classList.remove('is-tight', 'is-tighter');
    if (stripOver()) s.classList.add('is-tight');
    if (stripOver()) s.classList.add('is-tighter');
  }
  function fitAll() {
    S.fitTimer = null;
    if (!live()) return;
    measureUnit();
    fitDays(S.panels['cl-days1']);
    fitDays(S.panels['cl-days2']);
    fitStrip();
  }
  function scheduleFit() {
    if (S.fitTimer) return;
    var fn = guard('fit', fitAll);
    S.fitTimer = window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(fn, 16);
  }

  // ════════════════════════════════════════════════════════════════════
  // KIOSK HOOKS — wrap, call through
  // ════════════════════════════════════════════════════════════════════
  function wrapGlobal(name, make) {
    var orig = window[name];
    if (typeof orig !== 'function') { err('hook', name + ' is not a function'); return false; }
    S.orig[name] = orig;
    window[name] = make(orig);
    window[name]._cleanTvOrig = orig;
    return true;
  }
  function installHooks() {
    var K = kiosk();
    if (!K || typeof kioskShowPanel !== 'function') throw new Error('kiosk.js not loaded');
    // Our three panels replace the legacy four, so no legacy panel (and
    // no legacy radar canvas loop) draws behind #cl-tv.
    S.legacyPanels = K.panels.slice();
    K.panels = PANELS.slice();
    K.idx = 0;
    // kiosk.js reloads the TV when its code changes (signature of
    // index.html, app.js, kiosk.js, styles-kiosk.css, polled every 15
    // min). Sign this look's own files too, so a change to Choc TV here
    // reaches the iPad the same way instead of waiting for 03:30.
    try {
      if (typeof KIOSK_CODE_FILES !== 'undefined' && Array.isArray(KIOSK_CODE_FILES)) {
        ['previews/clean/theme.css', 'previews/clean/base.css', 'previews/clean/tv.css',
          'previews/clean/theme.js', 'previews/clean/core.js', 'previews/clean/tv.js'].forEach(function (f) {
          if (KIOSK_CODE_FILES.indexOf(f) < 0) KIOSK_CODE_FILES.push(f);
        });
      }
    } catch (e) { err('codeFiles', e); }

    wrapGlobal('kioskShowPanel', function (orig) {
      return function (name) {
        var r = orig.apply(this, arguments);
        if (live()) { try { showPanel(name); } catch (e) { err('showPanel', e); } }
        else if (!S.restored && S.mounted) restoreLegacy('shell gone');
        return r;
      };
    });
    // Dwell per panel (A2-Notes). A ?kioskRotate= debug override keeps a
    // uniform dwell, as kiosk.js does.
    var override = param('kioskRotate');
    wrapGlobal('kioskScheduleNext', function (orig) {
      return function () {
        var KK = kiosk();
        if (!live() || !KK) return orig.apply(this, arguments);
        var keep = KK.rotateMs;
        KK.rotateMs = override || DWELL[KK.panels[KK.idx]] || keep;
        try { return orig.apply(this, arguments); } finally { KK.rotateMs = keep; }
      };
    });
    // Touch: Next skips without pausing; Sources and its card pause
    // without resuming (kiosk.js's rule for its own ⓘ card); on the radar
    // a tap pauses and the next tap plays on in place (kiosk.js's radar
    // rule); anywhere else a tap pauses until the 60 s backstop.
    wrapGlobal('kioskPause', function (orig) {
      return function (ev) {
        if (!live()) return orig.apply(this, arguments);
        var t = ev && ev.target && ev.target.closest ? ev.target : null;
        if (t && t.closest('#cl-tv .cl-tv-btn[data-act="next"]')) return undefined;
        var onInfo = t && (t.closest('#cl-tv .cl-tv-btn[data-act="sources"]') || t.closest('#kiosk-info-overlay'));
        var infoBtn = document.getElementById('kiosk-info');
        if (onInfo) { var ri = orig.call(this, { target: infoBtn || null }); secTick(); return ri; }
        var KK = kiosk();
        if (S.cur === 'cl-radar' && KK) {
          if (KK.state === 'paused' && typeof kioskResumeInPlace === 'function') { kioskResumeInPlace(); secTick(); return undefined; }
          var r = orig.apply(this, arguments);
          if (typeof kioskResumeInPlace === 'function') {
            clearTimeout(KK.resumeTimer);
            KK.resumeTimer = setTimeout(kioskResumeInPlace, KK.pauseMs);
          }
          secTick();
          return r;
        }
        var r2 = orig.apply(this, arguments);
        secTick();
        return r2;
      };
    });
  }
  // The clean shell went away (core unmounted): hand everything back.
  function restoreLegacy(why) {
    if (S.restored) return;
    S.restored = true;
    err('restore', why || 'restored');
    stopPlay();
    clearInterval(S.secTimer);
    Object.keys(S.orig).forEach(function (k) { if (window[k] && window[k]._cleanTvOrig === S.orig[k]) window[k] = S.orig[k]; });
    var K = kiosk();
    if (K && S.legacyPanels) {
      K.panels = S.legacyPanels;
      K.idx = 0;
      try { if (document.readyState !== 'loading' && typeof kioskShowPanel === 'function') { kioskShowPanel(K.panels[0]); kioskScheduleNext(); } } catch (e) { err('restore.show', e); }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PART
  // ════════════════════════════════════════════════════════════════════
  function renderAll() {
    if (!live()) return;
    try { renderDays(); } catch (e) { err('days', e); }
    try { renderRadarStatic(); } catch (e) { err('radarStatic', e); }
    try {
      // Data arrived while the radar is up: start (or carry on) playing.
      if (S.cur === 'cl-radar' && D.loaded() && (S.play.idx < 0 || !S.play.timer)) startPlay();
      else renderRadarHour();
    } catch (e) { err('radarHour', e); }
    try { renderStrip(); } catch (e) { err('strip', e); }
    scheduleFit();
  }

  C.register('tv', {
    mount: function (root) {
      root.innerHTML = shellHTML();
      cache(root);
      try {
        installHooks();
      } catch (e) {
        // Leave kiosk.js exactly as it was; core hands the screen back.
        restoreLegacy('mount: ' + (e && e.message));
        throw e;
      }
      S.mounted = true;
      measureUnit();
      // The legacy panel at boot is kiosk.js's first; ours is the same slot.
      showPanel(PANELS[0], true);
      S.strip.sources.addEventListener('click', guard('sources', openSources));
      S.strip.next.addEventListener('click', guard('next', onNext));
      window.addEventListener('resize', guard('resize', function () { measureUnit(); scheduleFit(); }));
      S.secTimer = setInterval(guard('sec', secTick), 1000);
      C.on('tick', function () { renderAll(); });
      // A reduced-motion change takes effect at once (the sweep and fades are CSS).
      try {
        var mq = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
        if (mq && mq.addEventListener) mq.addEventListener('change', guard('rm', function () { showPanel(S.cur, true); }));
      } catch (_) { /* fine */ }
    },
    render: function () { renderAll(); },
    onTheme: function () { renderAll(); }
  });

  // Screenshots and tests only: jump to a panel / an hour.
  window.CLEAN_TV = {
    show: function (name) { if (typeof kioskShowPanel === 'function') kioskShowPanel(name); },
    playAt: function (t) {
      var i = typeof t === 'number' && t < 1e6 ? t : D.indexAt(new Date(t));
      if (i >= 0) setPlay(i);
    },
    state: function () { return { cur: S.cur, playIdx: S.play.idx, u: S.u, playing: !!S.play.timer }; },
    fit: fitAll
  };
})();
