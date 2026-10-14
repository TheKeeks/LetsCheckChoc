// ════════════════════════════════════════════════════════════════════
// CLEAN — tv.js (owner: TV part) · Choc TV (?kiosk=1)
// ────────────────────────────────────────────────────────────────────
// The A2-TV boards over the real kiosk: three panels and one status
// strip inside #cl-tv (core's root, shown only when isKioskMode()).
//   • cl-days1  next three days (A2-TV); after sunset it leads with
//               Tomorrow under a "Dark until … · next window …" banner
//               (A2-TV-Night)
//   • cl-days2  days four to six (A2-TV-Days46)
//   • cl-radar  always-dark scope: the radar's coastline vectors
//               (kiosk.js KIOSK_COAST), range rings, the 115–158° cone,
//               each swell and the wind as arrows converging on the
//               reef, a sweep once per 6 s, the forecast playing forward
//               one step a second through daylight, its readout and the
//               week strip (A2-TV-Radar)
// The swell is the Sound Check model, the Forecast tab's: GFS-Wave and
// ECMWF carried over the sea floor to Choc, the two models' mean (core's
// CLEAN.model). Each day card shows its biggest over the day's incoming
// tide in daylight; the radar plays the run's steps with each swell's
// share of Choc. Tides, the low, wind, sun and moon come through
// CLEAN.data.week() as before.
//
// kiosk.js runs underneath: its rotation timers, touch pause, 15-min
// refresh, code-signature check, nightly reload and boot watchdog are all
// its own. tv.js sets KIOSK.panels to its three panels, sets the A2-Notes
// dwell times through kioskScheduleNext, and follows kioskShowPanel.
// Every wrapper calls through; if this screen can't mount, kiosk.js runs
// as it is and index.html's "didn't start" card covers the screen.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.CLEAN) return;            // core failed: index.html's "didn't start" card is up
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
  var DWELL = { 'cl-days1': 10e3, 'cl-days2': 6e3, 'cl-radar': 12e3 };
  var FADE_MS = 600;

  var S = {
    mounted: false, restored: false,
    root: null, wrap: null, panels: {}, strip: {}, cur: null, prev: null, outTimer: null,
    u: 1, fitTimer: null, secTimer: null, modelTimer: null,
    play: { idx: -1, timer: null, stepMs: 1000 },
    radarKey: '', chart: null,
    orig: {}
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

  // The Sound Check model (core's CLEAN.model, shared with the Forecast tab).
  var M = C.model, MS = M.state;
  var REFRESH_MS = 30 * MIN;              // the forecast bot pulls every 3 h; the TV runs for days
  function modelOk() { return MS.status === 'ok' && !!MS.steps && MS.steps.length > 0; }
  function steps() { return MS.steps || []; }
  function famRGB(d) { return 'rgb(' + M.FAM[M.fam(d)].rgb.join(',') + ')'; }
  function inDaylight(t) {
    var s = D.sun(new Date(t));
    return !!(s && s.sunrise && s.sunset && t >= s.sunrise.getTime() && t < s.sunset.getTime());
  }
  // Why a card or the radar has no number.
  function modelGap() { return MS.status === 'loading' ? 'Waiting for the forecast' : MS.status === 'failed' ? 'The forecast didn’t load' : 'No model forecast for this day'; }

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
    if (PANELS.indexOf(name) < 0) name = PANELS[0];
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

  // The day's Choc number: the model's biggest over the incoming tide in
  // daylight (the low to the next high, as the tide line says), straight
  // between the run's steps, so the peak is at a step or an end of the
  // window. Over all daylight when NOAA's tide times are missing, or when
  // that incoming tide is all in the dark. The swell line is the main
  // swell then (the biggest share of Choc at the nearest step).
  // → { h, at, main, allDay } | null (the run doesn't reach that day)
  function dayModel(d) {
    if (!modelOk() || !d || !d.sun || !d.sun.sunrise || !d.sun.sunset) return null;
    var a0 = d.sun.sunrise.getTime(), b0 = d.sun.sunset.getTime(), a = a0, b = b0, lo = d.low, allDay = true;
    if (lo && lo.t && lo.until && !d.tidesDown) {
      var a1 = Math.max(a0, lo.t.getTime()), b1 = Math.min(b0, lo.until.getTime());
      if (b1 > a1) { a = a1; b = b1; allDay = false; }
    }
    var ts = [a, b];
    steps().forEach(function (s) { if (s.t > a && s.t < b) ts.push(s.t); });
    var best = null;
    ts.forEach(function (t) {
      var v = M.at(t, 'choc');
      if (isNum(v) && (!best || v > best.h)) best = { h: v, at: t };
    });
    if (!best) return null;
    var k = M.stepAt(best.at), ps = k >= 0 ? M.parts(steps()[k], 'choc') : [];
    best.main = ps.length ? ps[0].t : null;
    best.allDay = allDay;
    return best;
  }

  function cardHTML(d, label) {
    var h = '<div class="cl-tv-day cl-serif">' + esc(label) + '</div>';
    if (!d) return '<article class="cl-tv-card">' + h + heroHTML(DASH) + '</article>';
    var m = dayModel(d);
    if (!m) {
      h += heroHTML(DASH) + '<div class="cl-tv-sw cl-tv-mute"><span>' + esc(modelGap()) + '</span></div>';
    } else {
      h += heroHTML(F.num(m.h), 'ft');
      if (m.main) h += swLineHTML(m.main.T, F.compass(m.main.D), m.main.D);
    }
    // NOAA's tide predictions down (CO-OPS answers "No Predictions"), or
    // the day's incoming tide all in the dark: the card reads the day's
    // swell over all daylight instead, and says so, as the classic Choc
    // TV's "NO TIDE DATA — ALL-DAY SWELL", so a call that changed with the
    // reading doesn't change silently.
    var allDay = !!(m && m.allDay);
    // Two no-break groups: as one, "swell over all daylight" is wider
    // than a card and the fit pass would shrink the tide and wind lines
    // by a fifth; a third line at full size reads better across the room.
    var ALL_DAY = '<span class="cl-nowrap">swell over</span> <span class="cl-nowrap">all daylight</span>';
    // Tide leads with the time of the low.
    var lo = d.low;
    if (lo && lo.t) {
      var txt = !allDay && lo.until
        ? '<span class="cl-nowrap">Incoming ' + timeB(lo.t) + '</span> <span class="cl-nowrap">until ' + timeB(lo.until) + '</span>'
        : '<span class="cl-nowrap">Low ' + timeB(lo.t) + (allDay ? ' ·' : '') + '</span>' + (allDay ? ' ' + ALL_DAY : '');
      h += '<div class="cl-tv-win">' + I.tide(38) + '<span>' + txt + '</span></div>';
      h += windHTML(lo.wind, 'At low');
    } else {
      var none = loading() ? DASH : allDay ? '<span class="cl-nowrap">No tide times ·</span> ' + ALL_DAY : 'No tide times';
      h += '<div class="cl-tv-win cl-tv-mute' + (allDay ? ' is-allday' : '') + '">' + I.tide(38) + '<span>' + none + '</span></div>';
      h += windHTML(noonWind(d), 'At noon');
    }
    var sun = d.sun, moon = d.moon;
    if (sun || moon) {
      h += '<div class="cl-tv-sun">' +
        (sun ? '<span class="cl-nowrap">Sunrise ' + esc(F.time(sun.sunrise)) + ' ·</span> <span class="cl-nowrap">Sunset ' + esc(F.time(sun.sunset)) + '</span>' : '') +
        (moon && isNum(moon.pct) ? (sun ? '<br>' : '') + 'Moon ' + moon.pct + '%' : '') +
        '</div>';
    }
    return '<article class="cl-tv-card">' + h + '</article>';
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
      var line = 'M' + shore.map(pt).join('L') + 'L' + pt([460, endY]);
      // Land is everything above / left of the traced shore, filled and
      // outlined as the board draws it (faint light fill, muted edge),
      // clipped to the outer ring like a scope. The traced "pond" is the
      // round knob of land on the shore (the phone's lineup fills it the
      // same way): land too, so it never reads as a stray outline.
      var landD = line + 'L460 -20L-20 -20L' + pt([-20, Math.max(460, shore[0][1])]) + 'Z';
      var knobs = (CO.ponds || []).map(function (pond) { return 'M' + pond.map(P).map(pt).join('L') + 'Z'; });
      var paths = function (list, attr) { return list.map(function (d) { return '<path d="' + d + '"' + (attr || '') + '/>'; }).join(''); };
      var cover = '<rect x="-40" y="-40" width="520" height="520" fill="#fff"/>';
      var maskBox = ' maskUnits="userSpaceOnUse" x="-40" y="-40" width="520" height="520"';
      o.push('<defs>' +
        '<clipPath id="cl-tv-ring"><circle cx="220" cy="220" r="' + SC.ring[0] + '"/></clipPath>' +
        '<clipPath id="cl-tv-land">' + paths([landD].concat(knobs)) + '</clipPath>' +
        // Each outline only where it is the edge of land and knob together.
        '<mask id="cl-tv-noland"' + maskBox + '>' + cover + paths([landD], ' fill="#000"') + '</mask>' +
        '<mask id="cl-tv-noknob"' + maskBox + '>' + cover + paths(knobs, ' fill="#000"') + '</mask>' +
        '</defs>');
      o.push('<g clip-path="url(#cl-tv-ring)">');
      // One group, one opacity: where the knob overlaps the land the fill
      // stays even instead of doubling.
      o.push('<g class="land">' + paths([landD].concat(knobs)) + '</g>');
      o.push('<path class="shore" d="' + line + '"' + (knobs.length ? ' mask="url(#cl-tv-noknob)"' : '') + '/>');
      o.push(paths(knobs, ' class="shore" mask="url(#cl-tv-noland)"'));
      o.push('</g>');
      // The land's edge along the outer ring closes the outline.
      o.push('<circle class="rim" cx="220" cy="220" r="' + SC.ring[0] + '" clip-path="url(#cl-tv-land)"/>');
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
  // Each swell at buoy 44097 points at the reef from where it comes,
  // in its colour (where it comes from: E, SE, S, the Forecast tab's),
  // longer and thicker for a bigger share of Choc's energy; the biggest
  // share on top. The wind arrow is the forecast at the beach.
  function scopeTopSVG(ps, w) {
    var o = [];
    var e1 = at(WIN_MIN, SC.cone), e2 = at(WIN_MAX, SC.cone);
    o.push('<path class="cone" d="M220 220L' + pt(e1) + 'A' + SC.cone + ' ' + SC.cone + ' 0 0 1 ' + pt(e2) + 'Z"/>');
    var shown = (ps || []).slice(0, 3);
    shown.slice().reverse().forEach(function (p) {
      var len = U.clamp(80 + p.share * 98, 80, 178);
      o.push('<path class="arr sa" style="stroke:' + famRGB(p.t.D) + ';stroke-width:' + r1(3 + 6 * p.share) + '" d="' + arrowPath(p.t.D, len).d + '"/>');
    });
    if (w && isNum(w.dir) && isNum(w.mph)) {
      o.push('<path class="arr wa" d="' + arrowPath(w.dir, U.clamp(50 + w.mph * 9, 70, 175)).d + '"/>');
    }
    o.push('<circle class="mk" cx="220" cy="220" r="7"/>');
    o.push('<text class="n" x="220" y="30" text-anchor="middle">N</text>');
    // The cone's real-world ends. An arrow coming in near 115° would run
    // through the SW Pt label, so the label drops below the edge then.
    var low = shown.some(function (p) { return nearBearing(p.t.D, 92, 128); }) || nearBearing(w && w.dir, 92, 128);
    var ly = low ? 330 : 268;
    o.push('<text class="lab" x="436" y="' + ly + '" text-anchor="end">SW Pt Block</text>');
    o.push('<text class="lab" x="436" y="' + (ly + 19) + '" text-anchor="end">' + WIN_MIN + '°</text>');
    o.push('<text class="lab" x="' + r1(e2[0] + 9) + '" y="418" text-anchor="middle">Montauk Pt</text>');
    o.push('<text class="lab" x="' + r1(e2[0] + 9) + '" y="436" text-anchor="middle">' + WIN_MAX + '°</text>');
    return '<svg viewBox="0 0 440 440" aria-hidden="true" focusable="false">' + o.join('') + '</svg>';
  }

  // ── The week strip (viewBox 1100 × 205) ────────────────────────────
  // Choc's height through the run, as the Forecast tab's week chart:
  // green is the two models' mean, the lighter band over it runs between
  // GFS-Wave and ECMWF. Straight lines between the run's steps (every
  // 3 h, 6 h after day 6); a step with no number breaks the shape, and
  // its ends slope to the baseline over half a step. Night is shaded.
  var CW = 1100, PLOT_TOP = 14, BASE = 174, CUR_H = 190, GAP_MS = 6.5 * HOUR;
  function buildChart() {
    var t0 = U.startOfDay(new Date()).getTime(), span = 7 * DAY;
    var X = function (t) { return (t - t0) / span * CW; };
    var rows = [], maxH = 2;
    steps().forEach(function (s) {
      if (s.t < t0 - 6 * HOUR || s.t > t0 + span + 6 * HOUR) return;
      var c = s.choc, lo = [c.g, c.e].filter(isNum), hi = lo.length ? Math.max.apply(null, lo) : null;
      if (isNum(hi)) maxH = Math.max(maxH, hi);
      rows.push({ t: s.t, x: X(s.t), m: isNum(c.m) ? c.m : null, lo: lo.length ? Math.min.apply(null, lo) : null, hi: hi });
    });
    var Y = function (h) { return BASE - h / (maxH * 1.08) * (BASE - PLOT_TOP); };
    var o = [];
    // Night: sunset → sunrise.
    var nt = '';
    for (var k = -1; k <= 7; k++) {
      var s1 = D.sun(new Date(t0 + k * DAY + 12 * HOUR)), s2 = D.sun(new Date(t0 + (k + 1) * DAY + 12 * HOUR));
      if (!s1 || !s1.sunset || !s2 || !s2.sunrise) continue;
      var a = Math.max(0, X(s1.sunset.getTime())), b2 = Math.min(CW, X(s2.sunrise.getTime()));
      if (b2 > a) nt += 'M' + r1(a) + ' 0h' + r1(b2 - a) + 'v' + CUR_H + 'h' + r1(a - b2) + 'z';
    }
    if (nt) o.push('<path class="nt" d="' + nt + '"/>');
    // runs of steps with a number, split where one is missing or steps are far apart
    var runs = function (ok) {
      var out = [], run = null, prevT = null;
      rows.forEach(function (r) {
        if (run && r.t - prevT > GAP_MS) run = null;
        prevT = r.t;
        if (ok(r)) { if (!run) out.push(run = []); run.push(r); } else run = null;
      });
      return out;
    };
    var half = function (run, k) {           // half a step out from a run's end
      var n = run.length;
      if (n < 2) return 1.5 * HOUR / span * CW;
      return k ? (run[n - 1].x - run[n - 2].x) / 2 : (run[1].x - run[0].x) / 2;
    };
    var dm = runs(function (r) { return isNum(r.m); }).map(function (run) {
      return 'M' + r1(run[0].x - half(run, 0)) + ' ' + BASE + 'L' +
        run.map(function (r) { return r1(r.x) + ' ' + r1(Y(Math.max(0, r.m))); }).join('L') +
        'L' + r1(run[run.length - 1].x + half(run, 1)) + ' ' + BASE + 'Z';
    }).join('');
    var db = runs(function (r) { return isNum(r.hi); }).map(function (run) {
      return 'M' + run.map(function (r) { return r1(r.x) + ' ' + r1(Y(Math.max(0, r.hi))); }).join('L') + 'L' +
        run.slice().reverse().map(function (r) { return r1(r.x) + ' ' + r1(Y(Math.max(0, r.lo))); }).join('L') + 'Z';
    }).join('');
    o.push('<clipPath id="cl-tv-cht-clip"><rect x="0" y="0" width="' + CW + '" height="' + CUR_H + '"/></clipPath>');
    if (db || dm) {
      o.push('<g clip-path="url(#cl-tv-cht-clip)">' +
        (dm ? '<path class="sw" d="' + dm + '"/>' : '') +
        (db ? '<path class="gh" d="' + db + '"/>' : '') + '</g>');
    }
    for (var d = 0; d < 7; d++) {
      o.push('<text x="' + r1(X(t0 + d * DAY) + 6) + '" y="203">' + esc(F.day(new Date(t0 + d * DAY + 12 * HOUR))) + '</text>');
    }
    o.push('<line class="cur" x1="-10" y1="0" x2="-10" y2="' + CUR_H + '"/>');
    return {
      t0: t0, X: X, Y: Y, rows: rows,
      svg: '<svg viewBox="0 0 ' + CW + ' 205" role="img" aria-label="The week at Choc: green is the height at Choc (the two models’ mean), the lighter band over it runs between the two models, the line is the playing hour" focusable="false">' + o.join('') + '</svg>'
    };
  }

  function renderRadarStatic() {
    var key = (MS.made || MS.status) + '|' + U.dayKey(new Date()) + '|' + D.generation();
    if (key === S.radarKey) return;
    S.radarKey = key;
    S.radar.base.innerHTML = scopeBaseSVG();
    S.chart = buildChart();
    S.radar.cht.innerHTML = S.chart.svg;
    S.chart.cur = S.radar.cht.querySelector('.cur');
    // A new run under the playback: stay on the same time.
    if (S.play.t != null) S.play.idx = M.stepAt(S.play.t);
  }

  // ── Playback: one step of the run a second, daylight only ───────────
  // A dark hour is nothing anyone can surf, so the scope plays the
  // run's daylight steps from now through the week strip and loops.
  // Each radar visit carries on where the last one stopped, so the loop
  // walks through the week (12 s ≈ three days of light).
  function stepI(i) { var a = steps(); return a[i] || null; }
  function nowI() { var n = M.nowStep(); return n >= 0 ? n : 0; }
  function playable(i, from) {
    var s = stepI(i);
    if (!s || i < from) return false;
    if (S.chart && s.t >= S.chart.t0 + 7 * DAY) return false;
    return inDaylight(s.t);
  }
  function firstPlayable(from) {
    var n = steps().length;
    for (var i = from; i < n; i++) if (playable(i, from)) return i;
    return from < n ? from : -1;
  }
  function nextPlayable(i) {
    var n = steps().length, from = nowI();
    for (var k = 0; k < n; k++) {
      i++;
      var si = i < n ? stepI(i) : null;
      if (i >= n || (S.chart && si && si.t >= S.chart.t0 + 7 * DAY)) i = from;
      if (playable(i, from)) return i;
    }
    return from;
  }
  // The run is in but ends before now: nothing to play as the week ahead.
  function runEnded() { var a = steps(); return !!a.length && Date.now() > a[a.length - 1].t + 90 * MIN; }
  function setPlay(i) {
    S.play.idx = i;
    var s = stepI(i);
    S.play.t = s ? s.t : null;
    renderRadarHour();
  }
  function startPlay() {
    stopPlay();
    if (!modelOk() || runEnded()) { S.play.idx = -1; renderRadarHour(); return; }
    var from = nowI();
    var i = S.play.idx;
    if (i < 0 || !playable(i, from)) i = firstPlayable(from);
    setPlay(i);
    var K = kiosk();
    S.play.stepMs = Math.max(250, (K && K.radarStepMs) || 1000);
    S.play.timer = setInterval(guard('play', function () {
      if (paused() || !modelOk()) return;
      setPlay(nextPlayable(S.play.idx));
    }), S.play.stepMs);
  }
  function stopPlay() {
    if (S.play.timer) { clearInterval(S.play.timer); S.play.timer = null; }
  }

  // Readout for the playing step: Choc's height (the two models' mean,
  // each model under it), each swell with its share of Choc as on the
  // Forecast tab, the wind then; the arrows; the cursor.
  function swellRowsHTML(ps) {
    return ps.slice(0, 3).map(function (p, n) {
      var x = p.t;
      return '<div class="cl-tv-swr"><i class="cl-tv-swd" style="background:' + famRGB(x.D) + '" aria-hidden="true"></i><span>' +
        '<b>' + (n + 1) + '°</b> ' + esc(F.swell(x.ft, x.T, F.compass(x.D))) + (x.k === 'ww' ? ' <small>wind sea</small>' : '') + ' → ' + Math.round(p.share * 100) + '%</span></div>';
    }).join('');
  }
  function renderRadarHour() {
    var R = S.radar;
    var s = S.play.idx >= 0 ? stepI(S.play.idx) : null;
    var html, ps = [], w = null;
    if (!s) {
      var why = modelOk() && runEnded() ? 'The forecast run ends before now' : modelGap();
      html = '<div class="cl-tv-day cl-serif">' + esc(F.dayLabel(new Date(), { tomorrow: true }) + ' ' + F.time(new Date())) + '</div>' +
        heroHTML(DASH) +
        '<div class="cl-tv-hint">' + esc(why) + '</div>';
    } else {
      var at = new Date(s.t), v = s.choc;
      ps = M.parts(s, 'choc');
      w = D.windAt(at);
      html = '<div class="cl-tv-day cl-serif">' + esc(F.dayLabel(at, { tomorrow: true }) + ' ' + F.time(at)) + '</div>';
      html += heroHTML(isNum(v.m) ? F.num(v.m) : DASH, 'ft');
      html += '<div class="cl-tv-mods">GFS-Wave ' + esc(F.num(v.g)) + ' · ECMWF ' + esc(F.num(v.e)) + NB + 'ft</div>';
      html += swellRowsHTML(ps) || '<div class="cl-tv-swr cl-tv-mute"><span>No swell reaches Choc</span></div>';
      html += windHTML(w, '');
      html += '<div class="cl-tv-hint">' + (paused() ? 'Paused. Tap to play' : 'Playing the week forward, 3 hours a second') + '</div>';
    }
    setHTML(R.rt, html);
    setHTML(R.top, scopeTopSVG(ps, w));
    var label = 'Radar scope: the ' + WIN_MIN + '–' + WIN_MAX + '° swell window' +
      (ps.length ? ', ' + ps.slice(0, 3).map(function (p) { return F.swell(p.t.ft, p.t.T, F.compass(p.t.D)) + ' ' + Math.round(p.share * 100) + '% of Choc'; }).join(', ') : '') +
      (w ? ', wind ' + F.wind(w.mph, w.dir) : '');
    if (R.scope.getAttribute('aria-label') !== label) R.scope.setAttribute('aria-label', label);
    if (S.chart && S.chart.cur) {
      var x = s ? r1(S.chart.X(s.t)) : -10;
      S.chart.cur.setAttribute('x1', x);
      S.chart.cur.setAttribute('x2', x);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // STATUS STRIP — forecast age, buoy age, clock, Sources, Next
  // ════════════════════════════════════════════════════════════════════
  // The Sound Check run on show and its age, as the Forecast tab's
  // source line: amber after 12 h (the bot pulls every 3 h), red after
  // 2 days, or when the run no longer reaches now.
  function forecastLine() {
    if (MS.status === 'loading') return { text: 'Forecast loading', lvl: '' };
    var made = Date.parse(MS.made);
    if (!modelOk() || !isNum(made)) return { text: 'No forecast data', lvl: 'dead' };
    var age = Date.now() - made;
    if (runEnded()) return { text: 'Forecast run ' + F.ago(new Date(made)) + ', ended', lvl: 'dead' };
    return { text: 'Forecast run ' + F.ago(new Date(made)), lvl: age > 2 * DAY ? 'dead' : age > 12 * HOUR ? 'stale' : '' };
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

  // ── Sources: kiosk.js's card, restyled, with this TV's own content ──
  var TXT_MODEL = 'Choc’s height is the Sound Check model, as on the Forecast tab: GFS-Wave and ECMWF read at buoy 44097 and carried over the sea floor to the reef, the two models’ mean.';
  var TXT_DAYS = 'Each day shows Choc’s biggest height over the incoming tide in daylight (from a low to the next high), and the main swell then. ' + TXT_MODEL + ' The wind is the forecast at the low. Times in the dark are dimmed.';
  // NOAA's tide times missing: every day, or only some (a saved copy
  // running out at the end of the week).
  var TXT_DAYS_NO_TIDES = 'NOAA’s tide times didn’t load, so each day shows Choc’s biggest height over all of its daylight (sunrise to sunset) instead of over the incoming tide. ' + TXT_MODEL + ' The wind is the forecast at noon.';
  var TXT_DAYS_SOME_NO_TIDES = ' A day that says “No tide times” shows its biggest over all of its daylight instead, and the wind at noon.';
  function daysText() {
    var wk = D.week() || [], lead = leadOffset(), shown = 0, down = 0;
    for (var k = lead; k < lead + 6; k++) {
      var d = wk[k];
      if (!d || !dayModel(d)) continue;
      shown++;
      if (d.tidesDown) down++;
    }
    if (!down) return TXT_DAYS;
    return down === shown ? TXT_DAYS_NO_TIDES : TXT_DAYS + TXT_DAYS_SOME_NO_TIDES;
  }
  var TXT_RADAR = 'The scope plays the forecast forward through daylight, one step of the model (3 hours) a second. Each arrow is a swell at buoy 44097, pointing at the reef from where it comes, longer and thicker for a bigger share of Choc’s energy; its colour is where it comes from (teal E, orange SE, purple S). The green cone is the ' + WIN_MIN + '–' + WIN_MAX + '° window between Block Island’s Southwest Point and Montauk Point; swell from outside it still reaches Choc by bending in. Below it, the week at Choc: green is the two models’ mean, the lighter band over it runs between them, shaded columns are night. Tap to pause, tap again to play.';
  // Core's rows, with the Sound Check run in place of Open-Meteo's wave
  // forecast (the TV doesn't show that one).
  function sourceRows() {
    var made = Date.parse(MS.made), rows = (D.sources() || []).filter(function (r) { return r.key !== 'marine'; });
    var m = MS.status === 'loading' ? { level: 'none', text: 'Loading' }
      : !modelOk() || !isNum(made) ? { level: 'none', text: 'Not loaded' }
      : { level: runEnded() || Date.now() - made > 2 * DAY ? 'dead' : Date.now() - made > 12 * HOUR ? 'stale' : 'fresh',
        text: 'run ' + F.when(new Date(made)) + ' · ' + F.age(new Date(made)) };
    return [{ key: 'model', label: 'Wave forecast', level: m.level, text: m.text }].concat(rows);
  }
  function sourcesHTML() {
    var rows = sourceRows().map(function (s) {
      var c = s.level === 'stale' ? ' is-stale' : s.level === 'dead' ? ' is-dead' : s.level === 'none' ? ' is-none' : '';
      return '<div class="cl-tv-src-r"><span>' + esc(s.label) + '</span><span class="cl-tv-src-v' + c + '">' + esc(s.text) + '</span></div>';
    }).join('');
    var K = kiosk() || {};
    var build = K.codeSig ? String(K.codeSig).slice(0, 7) : DASH;
    var since = K.bootAt ? ' · running since ' + F.when(new Date(K.bootAt)) : '';
    return '<h3 class="cl-serif">Sources</h3>' +
      '<div class="cl-tv-src-rows">' + rows + '</div>' +
      '<p>' + esc(S.cur === 'cl-radar' ? TXT_RADAR : daysText()) + '</p>' +
      '<p>Swell: the Sound Check model (GFS-Wave and ECMWF, pulled every 3 hours by the site’s forecast bot). Wind: Open-Meteo forecast. Tides: NOAA CO-OPS predictions, station 8510719. Buoy: NDBC 44097, Block Island, through the site’s two-hourly pipeline. Sunrise and sunset: computed solar position.</p>' +
      '<p class="cl-tv-src-fine">Build ' + esc(build) + esc(since) + ' · tap anywhere to close</p>';
  }
  function openSources() {
    var ov = document.getElementById('kiosk-info-overlay');
    var card = document.getElementById('kiosk-info-card');
    if (!ov || !card) return;
    // Adopt kiosk.js's overlay: kioskInfoOpen() keeps reading it, so the
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
      ['.cl-tv-hero', '.cl-tv-sw', '.cl-tv-win, .cl-tv-wd'].forEach(function (sel) { fitRows(cards, sel); });
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
    K.panels = PANELS.slice();
    K.idx = 0;

    wrapGlobal('kioskShowPanel', function (orig) {
      return function (name) {
        var r = orig.apply(this, arguments);
        if (live()) { try { showPanel(name); } catch (e) { err('showPanel', e); } }
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
        if (onInfo) { var ri = orig.call(this); secTick(); return ri; }
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
  // This screen couldn't mount: give kiosk.js its own functions back.
  function release(why) {
    if (S.restored) return;
    S.restored = true;
    err('release', why || 'released');
    stopPlay();
    clearInterval(S.secTimer);
    clearInterval(S.modelTimer);
    Object.keys(S.orig).forEach(function (k) { if (window[k] && window[k]._cleanTvOrig === S.orig[k]) window[k] = S.orig[k]; });
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
      if (S.cur === 'cl-radar' && modelOk() && (S.play.idx < 0 || !S.play.timer)) startPlay();
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
        // Leave kiosk.js exactly as it was; core puts up the "didn't start" card.
        release('mount: ' + (e && e.message));
        throw e;
      }
      S.mounted = true;
      measureUnit();
      // kiosk.js shows its first panel at boot; ours is the same slot.
      showPanel(PANELS[0], true);
      S.strip.sources.addEventListener('click', guard('sources', openSources));
      S.strip.next.addEventListener('click', guard('next', onNext));
      window.addEventListener('resize', guard('resize', function () { measureUnit(); scheduleFit(); }));
      S.secTimer = setInterval(guard('sec', secTick), 1000);
      C.on('tick', function () { renderAll(); });
      C.on('soundcheck', function () { renderAll(); });
      M.load();
      S.modelTimer = setInterval(guard('model', function () { if (live()) M.refresh(); }), REFRESH_MS);
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
    // a step of the run (its index), or the step nearest a time
    playAt: function (t) {
      var i = typeof t === 'number' && t < 1e6 ? t : M.stepAt(new Date(t).getTime());
      if (i >= 0) setPlay(i);
    },
    state: function () { return { cur: S.cur, playIdx: S.play.idx, playT: S.play.t, u: S.u, playing: !!S.play.timer, made: MS.made, model: MS.status }; },
    refresh: function () { return M.refresh(); },
    fit: fitAll
  };
})();
