// ════════════════════════════════════════════════════════════════════
// CLEAN — forecast.js (owner: Forecast part) · ?preview=clean
// ────────────────────────────────────────────────────────────────────
// The Forecast tab of the "A refined" boards (A2-Phone-Day, -Night,
// -Late, -Sat), drawn from the real app's data through CLEAN.data:
//   • Now block: the hero swell, its period and direction, the window
//     status, any blocked train, the wind (barb) and the tide (time of
//     the next low first), your model, the buoy and the data age. After
//     last light it leads with the next window instead ("Tomorrow, Fri").
//   • This week: one row per day (Choc TV's day summaries). Tapping a
//     row tints it, scrolls to the chart and slides the cursor to that
//     day's low.
//   • Forecast chart: a new SVG renderer of STATE.forecastData (the
//     legacy canvas chart stays hidden): swell that reaches the reef
//     solid, blocked swell as a faint ghost, the window band, wind bars
//     coloured by quality with direction arrows, the tide with the
//     day's low and its daylight incoming tide. One cursor, dragged
//     hour by hour or moved by the jump buttons; it is the app's own
//     scrubber hour (CLEAN.cursor), so other parts can read it.
//   • Lineup: the Choc TV radar's coastline vectors (kiosk.js
//     KIOSK_COAST), the 115–158° window cone and the cursor hour's swell
//     and wind arrows.
//   • Details: light and water, tide table, buoy waves, data sources.
// Every block renders inside try/catch: one failing block never blanks
// the tab. Missing data stays null and shows "—". Times are the spot's
// (America/New_York) through CLEAN.fmt.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.CLEAN || typeof CLEAN.register !== 'function') return;

  var C = window.CLEAN, D = C.data, F = C.fmt, U = C.util, I = C.icon;
  var NB = F.NB, DASH = F.DASH, esc = U.esc, isNum = U.isNum;
  var HOUR = 3600e3, MIN = 60e3, DAY = 864e5;
  var WIN_MIN = (typeof CONFIG !== 'undefined' && CONFIG.chocomount && CONFIG.chocomount.swellWindowMin) || 115;
  var WIN_MAX = (typeof CONFIG !== 'undefined' && CONFIG.chocomount && CONFIG.chocomount.swellWindowMax) || 158;

  // Chart geometry: the board's 232 px tall panel (A2-Phone-Day viewBox
  // 0 0 358 232). Width is the real column width, measured.
  var G = {
    H: 232,
    swTop: 6, swBase: 110, swPx: 30,     // swell panel: 30 px per foot, less when it would overflow
    bandY: 116, bandH: 8,                // window band
    windBase: 170, windMax: 30,          // wind bars
    winY: 178, winH: 52,                 // daylight incoming-tide bands
    tideTop: 186, tideBot: 228,          // tide line
    nightH: 228
  };
  var ARROW7 = (I.paths && I.paths.chartArrow) || 'M0 3.5V-3.5M-3 -0.5L0 -3.5L3 -0.5';

  var root = null, E = {};
  // The cursor: 'now' follows the clock; 'time' is a picked instant
  // (an hour from a drag, or a low's exact time from a jump or a day tap).
  var cur = { mode: 'now', t: 0, low: false };
  var selDay = -1;                       // week row the viewer tapped
  var openRows = { light: true, tides: false, buoy: false, sources: false };
  var chart = null, chartKey = '', lastW = 0;
  var slide = null, scrollAnim = null, drag = null, pendingChart = false;
  var pushTimer = null, lastHapticHour = null;

  function err(where, e) { C.err('forecast.' + where, e); }
  function run(where, fn) { try { fn(); } catch (e) { err(where, e); } }
  function r1(v) { return Math.round(v * 10) / 10; }
  function norm360(d) { return ((d % 360) + 360) % 360; }
  function reduced() { return U.reducedMotion(); }

  // Keep focus on the same control across an innerHTML refresh.
  function keepFocus(container, attr, fn) {
    var ae = document.activeElement, key = null;
    if (ae && container.contains(ae)) key = ae.getAttribute(attr);
    fn();
    if (key != null) {
      var f = container.querySelector('[' + attr + '="' + key + '"]');
      if (f) try { f.focus({ preventScroll: true }); } catch (_) { /* fine */ }
    }
  }
  function setHTML(el, html) { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } }

  // ════════════════════════════════════════════════════════════════════
  // MOUNT
  // ════════════════════════════════════════════════════════════════════
  function mount(el) {
    root = el;
    el.innerHTML =
      '<div class="cl-f">' +
        '<p class="cl-lead cl-f-lead" hidden></p>' +
        '<div class="cl-f-now"></div>' +
        '<h2 class="cl-h2">This week</h2>' +
        '<div class="cl-f-wk"></div>' +
        '<div class="cl-gap"></div>' +
        '<h2 class="cl-h2 cl-f-fch">Forecast</h2>' +
        '<div class="cl-f-ch">' +
          '<div class="cl-f-rd"><div class="cl-f-rdt"></div><div class="cl-f-rdv"><span></span><span></span><span></span></div></div>' +
          '<div class="cl-f-cxw" tabindex="0" role="slider" aria-label="Forecast hour. Drag, or use the arrow keys" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>' +
          '<div class="cl-f-dl" aria-hidden="true"></div>' +
          '<div class="cl-f-ctl">' +
            '<button type="button" class="cl-f-jb" data-j="pl" aria-label="Previous low">' + I.jumpsLeft(14) + '<span>low</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="ph" aria-label="Previous hour">' + I.jumpLeft(14) + '<span>hr</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="now" aria-label="Back to now"><span>Now</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="nh" aria-label="Next hour"><span>hr</span>' + I.jumpRight(14) + '</button>' +
            '<button type="button" class="cl-f-jb" data-j="nl" aria-label="Next low"><span>low</span>' + I.jumpsRight(14) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="cl-gap"></div>' +
        '<h2 class="cl-h2">Lineup</h2>' +
        '<div class="cl-f-ch cl-f-lu"></div>' +
        '<div class="cl-gap"></div>' +
        '<h2 class="cl-h2">Details</h2>' +
        '<div class="cl-f-ch cl-f-det"></div>' +
        '<div class="cl-gap"></div>' +
      '</div>';
    E.lead = el.querySelector('.cl-f-lead');
    E.now = el.querySelector('.cl-f-now');
    E.wk = el.querySelector('.cl-f-wk');
    E.fch = el.querySelector('.cl-f-fch');
    E.rdt = el.querySelector('.cl-f-rdt');
    E.rdv = el.querySelectorAll('.cl-f-rdv span');
    E.cxw = el.querySelector('.cl-f-cxw');
    E.dl = el.querySelector('.cl-f-dl');
    E.ctl = el.querySelector('.cl-f-ctl');
    E.lu = el.querySelector('.cl-f-lu');
    E.det = el.querySelector('.cl-f-det');

    E.wk.addEventListener('click', C.guard('forecast.week.click', onWeekClick));
    E.ctl.addEventListener('click', C.guard('forecast.jump', onJump));
    E.det.addEventListener('click', C.guard('forecast.details.click', onDetailsClick));
    E.cxw.addEventListener('pointerdown', C.guard('forecast.down', onDown));
    E.cxw.addEventListener('pointermove', C.guard('forecast.move', onMove));
    E.cxw.addEventListener('pointerup', C.guard('forecast.up', onUp));
    E.cxw.addEventListener('pointercancel', C.guard('forecast.cancel', onCancel));
    E.cxw.addEventListener('lostpointercapture', C.guard('forecast.lost', onCancel));
    E.cxw.addEventListener('keydown', C.guard('forecast.key', onKey));
    var rz = null;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(C.guard('forecast.resize', function () { if (measure()) { renderChart(); renderLineup(); } }), 120);
    });
    C.on('tick', function () { render('tick'); });
  }

  // Column width of the chart (the view may be hidden: keep the last one).
  function measure() {
    var w = E.cxw ? E.cxw.clientWidth : 0;
    if (!w && E.cxw && E.cxw.parentNode) w = E.cxw.parentNode.clientWidth;
    w = Math.round(w);
    if (w > 0 && w !== lastW) { lastW = w; return true; }
    if (!lastW) lastW = 358;
    return false;
  }

  var lastDayKey = '';
  function render(reason) {
    if (!root) return;
    measure();
    // Past midnight the week shifts by a day: drop a stale row selection.
    var dk = U.dayKey(new Date());
    if (lastDayKey && dk !== lastDayKey) selDay = -1;
    lastDayKey = dk;
    run('lead', renderLead);
    run('now', renderNow);
    run('week', renderWeek);
    if (drag && drag.active) pendingChart = true; else run('chart', renderChart);
    run('lineup', renderLineup);
    run('details', renderDetails);
  }

  // ════════════════════════════════════════════════════════════════════
  // NOW BLOCK
  // ════════════════════════════════════════════════════════════════════
  // After last light the board leads with the next window (A2-Phone-Late).
  function nextWindowDay() {
    if (!D.isAfterDark()) return null;
    var nw = D.nextWindow();
    if (!nw) return null;
    var wk = D.week();
    var day = nw.dayOffset >= 0 && nw.dayOffset < wk.length ? wk[nw.dayOffset] : null;
    if (!day || !day.swell) return null;
    return { nw: nw, day: day };
  }

  function renderLead() {
    var txt = '';
    if (D.isAfterDark()) {
      var du = D.darkUntil();
      var nw = D.nextWindow();
      var parts = [];
      if (du) parts.push('Dark until ' + F.time(du));
      if (nw) parts.push('next window ' + (nw.dayOffset === 0 ? 'today' : F.day(nw.t)) + ', low ' + F.time(nw.t));
      txt = parts.join(' · ');
      if (txt) txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    }
    E.lead.hidden = !txt;
    if (E.lead.textContent !== txt) E.lead.textContent = txt;
  }

  function metaHTML(period, dir, dirText) {
    var h = '<span>' + F.period(period) + '</span>';
    if (isNum(dir)) h += '<span class="cl-f-sep" aria-hidden="true">·</span>' + I.swell(dir, 22) + '<span>' + esc(dirText) + '</span>';
    return h;
  }

  function windCell(w, extra, gusts) {
    var ico = w ? I.barb(w.mph, w.dir, 44) : '';
    var big, sub = '';
    if (w) {
      big = Math.round(w.mph) + NB + '<small>mph</small>' + (w.compass ? ' ' + w.compass : '');
      var bits = [];
      if (w.quality) bits.push(C.html.quality(w.quality, 'caps'));
      if (gusts && isNum(w.gust)) bits.push('gusts ' + Math.round(w.gust));
      if (extra) bits.push(extra);
      sub = bits.join(' · ');
    } else {
      big = DASH;
      sub = 'Wind';
    }
    return '<div class="cl-f-cell"><span class="cl-f-ico">' + ico + '</span><div class="cl-f-cv"><div class="cl-f-big">' + big + '</div>' +
      '<div class="cl-f-sub">' + sub + '</div></div></div>';
  }

  function tideCell(big, sub) {
    return '<div class="cl-f-cell"><span class="cl-f-ico">' + I.tide(44) + '</span><div class="cl-f-cv"><div class="cl-f-big">' + big + '</div>' +
      '<div class="cl-f-sub">' + (sub || '') + '</div></div></div>';
  }

  function modelRow(label, v) {
    if (!isNum(v)) return '';
    return '<div class="cl-f-model"><span>' + esc(label) + '</span><b>' + F.score(v) + ' <small>/ 10</small></b></div>';
  }

  function updatedLine(n) {
    var cls = n.freshness === 'stale' ? ' cl-stale' : n.freshness === 'dead' ? ' cl-dead' : '';
    var txt;
    if (n.updatedAt) txt = 'Updated ' + F.when(n.updatedAt) + (n.freshness === 'stale' || n.freshness === 'dead' ? ' · ' + F.age(n.updatedAt) : '');
    else if (n.freshness === 'loading') { txt = 'Loading the forecast…'; cls = ''; }
    else txt = 'No forecast loaded';
    return '<p class="cl-fine cl-f-fine' + cls + '">' + esc(txt) + '</p>';
  }

  function buoyLine(n) {
    var b = n.buoy;
    if (!b || D.isNight()) return '';   // the buoy line sleeps after sunset (A2-Notes)
    var cls = b.level === 'stale' ? ' cl-stale' : b.level === 'dead' ? ' cl-dead' : '';
    var s = 'Buoy ' + F.swell(b.h, b.period, b.compass);
    if (b.obsAt) s += ' · ' + F.when(b.obsAt) + ' (' + F.age(b.obsAt) + ')';
    if (b.reachesAt) s += ' · ' + (b.reachesAt.getTime() >= Date.now() ? 'reaches' : 'reached') + ' the reef ~' + F.time(b.reachesAt);
    return '<p class="cl-fine cl-f-fine' + cls + '">' + esc(s) + '</p>';
  }

  function nowHTML(n) {
    var sw = n.swell, h;
    if (sw) {
      h = '<div class="cl-f-hero"><span class="cl-f-num">' + F.num(sw.h) + '</span><span class="cl-f-unit">ft</span></div>';
      h += '<div class="cl-f-meta">' + metaHTML(sw.period, sw.dir, (sw.compass || '') + ' ' + F.deg(sw.dir)) + '</div>';
      if (sw.status) h += '<div class="cl-f-st">' + C.html.status(sw.status, { pill: true }) + '</div>';
    } else {
      // No swell reading: say so plainly instead of a 104 px dash.
      h = '<p class="cl-f-nodata">' + (n.freshness === 'loading' ? 'Loading the forecast…' : 'No wave forecast right now') + '</p>';
    }
    var bl = (n.blocked || []).filter(function (t) { return t && t !== sw && isNum(t.h); })
      .map(function (t) { return F.swell(t.h, t.period, t.compass) + ' · blocked'; });
    if (bl.length) h += '<p class="cl-f-dim">' + esc(bl.join('; ')) + '</p>';

    var t = n.tide, tBig = DASH, tSub = '';
    if (t) {
      if (t.nextLow) tBig = 'Low ' + F.when(t.nextLow.t);
      var bits = [];
      if (isNum(t.h)) bits.push(F.tide(t.h, t.rising) + (t.rising === true ? ' rising' : t.rising === false ? ' falling' : ''));
      if (t.nextHigh && (!t.nextLow || t.nextHigh.t < t.nextLow.t)) bits.push('high ' + F.when(t.nextHigh.t));
      tSub = bits.join(' · ');
    }
    if (tBig === DASH && !tSub) tSub = 'Tide';
    h += '<div class="cl-f-two">' + windCell(n.wind, '', true) + tideCell(tBig, esc(tSub)) + '</div>';
    h += modelRow('Your model', n.model);
    h += '<div class="cl-f-fines">' + buoyLine(n) + updatedLine(n) + '</div>';
    return h;
  }

  function nextHTML(n, nw, day) {
    var b = day.swell;
    var noon = new Date(day.date.getTime() + 12 * HOUR);
    var label = nw.dayOffset === 0 ? 'Today, ' + F.day(noon) : nw.dayOffset === 1 ? 'Tomorrow, ' + F.day(noon) : F.dayLong(noon);
    var h = '<p class="cl-f-day cl-serif">' + esc(label) + '</p>';
    h += '<div class="cl-f-hero"><span class="cl-f-num">' + F.range(b.min, b.max) + '</span><span class="cl-f-unit">ft</span></div>';
    // A day band: compass letters only, as the week rows (A2-Phone-Late).
    h += '<div class="cl-f-meta">' + metaHTML(b.period, b.dir, b.compass || '') + '</div>';
    if (day.status) h += '<div class="cl-f-st">' + C.html.status(day.status, { pill: true }) + '</div>';
    var o = day.other;
    if (o && o.status === 'blocked') h += '<p class="cl-f-dim">' + esc(F.swell([o.min, o.max], o.period, o.compass) + ' · blocked') + '</p>';

    var w = day.low && day.low.t && Math.abs(day.low.t.getTime() - nw.t.getTime()) < 5 * MIN ? day.low.wind : null;
    if (!w) { var i = D.indexAt(nw.t); var hr = i >= 0 ? D.hour(i) : null; w = hr ? hr.wind : null; }
    h += '<div class="cl-f-two">' + windCell(w, 'at the low', false) +
      tideCell('Low ' + F.time(nw.t), nw.until ? 'Incoming until ' + F.time(nw.until) : '') + '</div>';
    h += modelRow('Your model, ' + F.day(noon), day.model);
    var t = n.tide, fines = '';
    if (t && isNum(t.h)) fines += '<p class="cl-fine cl-f-fine">Now ' + esc(F.tide(t.h, t.rising) + (t.rising === true ? ' rising' : t.rising === false ? ' falling' : '') + ' · ' + F.time(new Date())) + '</p>';
    h += '<div class="cl-f-fines">' + fines + updatedLine(n) + '</div>';
    return h;
  }

  function renderNow() {
    var n = D.now();
    var nx = nextWindowDay();
    setHTML(E.now, nx ? nextHTML(n, nx.nw, nx.day) : nowHTML(n));
  }

  // ════════════════════════════════════════════════════════════════════
  // THIS WEEK
  // ════════════════════════════════════════════════════════════════════
  function weekHTML() {
    var wk = D.week();
    var any = wk.some(function (d) { return d && (d.swell || d.low); });
    if (!any) return '<p class="cl-f-empty">' + (D.freshness() === 'loading' ? 'Loading the week…' : 'No days to show: the forecast and tides didn’t load.') + '</p>';
    var nowMs = Date.now();
    return wk.map(function (d, k) {
      var past = k === 0 && d.sun && d.sun.lastLight && nowMs >= d.sun.lastLight.getTime();
      var sw = d.swell
        ? (d.reaches ? '<span class="cl-f-s">' + F.swell([d.swell.min, d.swell.max], d.swell.period, d.swell.compass) + '</span>'
          : '<span class="cl-f-s cl-f-none">Nothing reaches the reef</span>')
        : '<span class="cl-f-s cl-f-none">' + DASH + '</span>';
      var low = '<span class="cl-f-g">' + I.tide(15) + '<span>' + (d.low ? F.time(d.low.t) : DASH) + '</span></span>';
      var w = d.low && d.low.wind;
      var wind = w ? '<span class="cl-f-g cl-f-wg">' + (isNum(w.dir) ? '<span class="cl-f-wa">' + I.wind(w.dir, 15) + '</span>' : '') +
        '<span>' + F.wind(w.mph, w.dir) + '</span>' + (w.quality ? ' ' + C.html.quality(w.quality) : '') + '</span>' : '';
      var right = '<span class="cl-f-r">' + (d.status ? C.html.status(d.status, { short: true, small: true }) : '') +
        (isNum(d.model) ? '<span class="cl-f-m">' + F.score(d.model) + '</span>' : '') + '</span>';
      var sel = k === selDay;
      // The grid lives on an inner span: older WebKit can't make a <button> a grid container.
      return '<button type="button" class="cl-f-row' + (sel ? ' sel' : '') + (past ? ' past' : '') + '" data-k="' + k + '" aria-pressed="' + sel + '">' +
        '<span class="cl-f-ri"><span class="cl-f-d">' + esc(d.label) + '</span>' +
        '<span class="cl-f-mid">' + sw + '<span class="cl-f-w">' + low + wind + '</span></span>' + right + '</span></button>';
    }).join('');
  }
  function renderWeek() {
    keepFocus(E.wk, 'data-k', function () { setHTML(E.wk, weekHTML()); });
  }
  function onWeekClick(e) {
    var b = e.target.closest ? e.target.closest('.cl-f-row') : null;
    if (!b) return;
    var k = +b.getAttribute('data-k');
    var d = D.week()[k];
    if (!d) return;
    selDay = k;
    // The tint lands at once; then the page glides to the chart.
    E.wk.querySelectorAll('.cl-f-row').forEach(function (r) {
      var on = +r.getAttribute('data-k') === k;
      r.classList.toggle('sel', on);
      r.setAttribute('aria-pressed', on);
    });
    E.wk.__html = null;
    scrollToChart();
    var target = d.low ? d.low.t.getTime() : d.window ? d.window.start.getTime() : d.date.getTime() + 9 * HOUR;
    if (chart) target = U.clamp(target, chart.t0, chart.tLast);
    setCursor({ mode: 'time', t: target, low: !!d.low }, { slide: 300, keepSel: true });
  }

  function scrollToChart() {
    if (!E.fch) return;
    var y = E.fch.getBoundingClientRect().top + (window.scrollY || 0) - 4;
    var maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    y = U.clamp(y, 0, maxY);
    if (scrollAnim) cancelAnimationFrame(scrollAnim);
    var y0 = window.scrollY || 0;
    if (reduced() || Math.abs(y - y0) < 2) { window.scrollTo(0, y); return; }
    var t0 = performance.now(), dur = 300;
    var step = function (now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo(0, y0 + (y - y0) * e);
      scrollAnim = p < 1 ? requestAnimationFrame(step) : null;
    };
    scrollAnim = requestAnimationFrame(step);
  }

  // ════════════════════════════════════════════════════════════════════
  // FORECAST CHART (SVG, from STATE.forecastData through CLEAN.data)
  // ════════════════════════════════════════════════════════════════════
  function buildChart(W) {
    var hrs = D.hours();
    if (!hrs.length || !hrs[0] || !hrs[0].at) return null;
    var n = hrs.length;
    var t0 = hrs[0].at.getTime(), tLast = hrs[n - 1].at.getTime();
    var days = Math.max(1, Math.ceil((tLast - t0 + HOUR) / DAY - 1e-6));
    var span = days * DAY;
    var X = function (t) { return (t - t0) / span * W; };
    var hs = W / (span / HOUR);                       // one hour in px
    var times = hrs.map(function (h) { return h && h.at ? h.at.getTime() : NaN; });
    var o = [];

    // Swell that reaches the reef (hero in window or at the edge), and
    // the blocked ghost (the biggest blocked train).
    // Per hour, the biggest train that reaches the reef (in window or at
    // the edge) is the solid fill and sets the band; the biggest blocked
    // train is the ghost. The forecast's two trains often trade places
    // hour to hour, so following one "hero" would chop the fill apart.
    var sw = [], gh = [], st = [], maxH = 0;
    hrs.forEach(function (hr, i) {
      var tr = splitTrains(hr);
      sw[i] = tr.reach ? tr.reach.h : null;
      gh[i] = tr.blocked ? tr.blocked.h : null;
      st[i] = tr.reach ? tr.reach.status : tr.blocked ? 'blocked' : null;
      if (isNum(sw[i])) maxH = Math.max(maxH, sw[i]);
      if (isNum(gh[i])) maxH = Math.max(maxH, gh[i]);
    });
    var ppf = Math.min(G.swPx, (G.swBase - G.swTop) / Math.max(1, maxH));
    var ySw = function (v) { return G.swBase - v * ppf; };

    // Night: sunset → sunrise, for every day on the chart.
    var night = '';
    var rect = function (a, b, y, h) {
      var x1 = Math.max(0, X(a)), x2 = Math.min(W, X(b));
      return x2 - x1 > 0.2 ? 'M' + r1(x1) + ' ' + y + 'h' + r1(x2 - x1) + 'v' + h + 'h' + r1(x1 - x2) + 'z' : '';
    };
    var dayStarts = [];
    for (var k = 0; k <= days; k++) dayStarts.push(U.startOfDay(t0, k).getTime());
    for (k = 0; k < days; k++) {
      var s = D.sun(new Date(dayStarts[k] + 12 * HOUR));
      if (!s) continue;
      if (s.alwaysNight) { night += rect(dayStarts[k], dayStarts[k + 1], 0, G.nightH); continue; }
      if (s.alwaysDay || !s.sunrise || !s.sunset) continue;
      night += rect(dayStarts[k], s.sunrise.getTime(), 0, G.nightH) + rect(s.sunset.getTime(), dayStarts[k + 1], 0, G.nightH);
    }
    if (night) o.push('<path class="nt" d="' + night + '"/>');

    // Grid: whole feet (the board: 1, 2, 3 ft with "2 ft" named).
    var stepFt = maxH <= 4 ? 1 : maxH <= 8 ? 2 : 5, grid = '', labY = null, labV = null;
    for (var v = stepFt; ySw(v) >= G.swTop - 0.5; v += stepFt) {
      var gy = r1(ySw(v)) + 0.5;
      grid += 'M0 ' + gy + 'H' + W;
      if (labY == null || Math.abs(gy - 50) < Math.abs(labY - 50)) { labY = gy; labV = v; }
    }
    if (grid) o.push('<path class="gl" d="' + grid + '"/>');
    if (labY != null) o.push('<text class="ax" x="2" y="' + r1(labY - 3.5) + '">' + labV + NB + 'ft</text>');

    // Areas
    var area = function (vals, cls) {
      var d = '', run = null;
      var flush = function () {
        if (!run) return;
        var x0 = Math.max(0, run[0][0] - hs / 2), x1 = run.last === n - 1 ? W : Math.min(W, run[run.length - 1][0] + hs / 2);
        d += 'M' + r1(x0) + ' ' + G.swBase + 'L' + run.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + 'L' + r1(x1) + ' ' + G.swBase + 'Z';
        run = null;
      };
      for (var i = 0; i < n; i++) {
        var val = vals[i];
        if (isNum(val) && val > 0 && isFinite(times[i])) {
          if (!run) run = [];
          run.push([X(times[i]), ySw(val)]);
          run.last = i;
        } else flush();
      }
      flush();
      return d ? '<path class="' + cls + '" d="' + d + '"/>' : '';
    };
    o.push(area(gh, 'gh'));
    o.push(area(sw, 'sw'));

    // Window band, by the hero's status.
    var band = '', segStart = 0;
    var bandCls = { 'in': 'bi', edge: 'be', blocked: 'bb' };
    for (var i = 1; i <= n; i++) {
      if (i < n && st[i] === st[segStart]) continue;
      var c = bandCls[st[segStart]];
      if (c && isFinite(times[segStart])) {
        var bx1 = segStart === 0 ? 0 : Math.max(0, X(times[segStart]) - hs / 2);
        var bx2 = i === n ? W : Math.min(W, X(times[i - 1]) + hs / 2);
        band += '<rect class="' + c + '" x="' + r1(bx1) + '" y="' + G.bandY + '" width="' + r1(Math.max(0, bx2 - bx1)) + '" height="' + G.bandH + '"/>';
      }
      segStart = i;
    }
    o.push(band);

    // Wind: one bar per 6 h (the board's 28 bars), mean speed, vector-mean
    // direction, coloured by quality; onshore hatched. A small arrow on
    // top points where the wind blows.
    var slots = Math.max(1, Math.round(span / (6 * HOUR)));
    var slotW = W / slots, barW = slotW * 0.76;
    var acc = [];
    hrs.forEach(function (hr, idx) {
      if (!hr || !hr.wind || !isNum(hr.wind.mph) || !isFinite(times[idx])) return;
      var sIdx = Math.floor((times[idx] - t0) / (6 * HOUR));
      if (sIdx < 0 || sIdx >= slots) return;
      var a = acc[sIdx] || (acc[sIdx] = { n: 0, mph: 0, sx: 0, sy: 0, nd: 0 });
      a.n++; a.mph += hr.wind.mph;
      if (isNum(hr.wind.dir)) {
        var rad = hr.wind.dir * Math.PI / 180, wgt = Math.max(0.5, hr.wind.mph);
        a.sx += Math.sin(rad) * wgt; a.sy += Math.cos(rad) * wgt; a.nd++;
      }
    });
    var bars = '', arrows = '';
    acc.forEach(function (a, sIdx) {
      if (!a || !a.n) return;
      var mph = a.mph / a.n;
      var dir = a.nd ? norm360(Math.atan2(a.sx, a.sy) * 180 / Math.PI) : null;
      var q = U.windQuality(mph, dir);
      var cls = q === 'offshore' ? 'off' : q === 'onshore' ? 'on' : 'crs';
      var bh = Math.min(G.windMax, 3 + mph * 1.35);
      var bx = sIdx * slotW + (slotW - barW) / 2, by = G.windBase - bh;
      bars += '<rect class="' + cls + '" x="' + r1(bx) + '" y="' + r1(by) + '" width="' + r1(barW) + '" height="' + r1(bh) + '"/>';
      if (dir != null) arrows += '<path d="' + ARROW7 + '" transform="translate(' + r1(bx + barW / 2) + ',' + r1(by - 6) + ') rotate(' + Math.round(norm360(dir + 180)) + ')"/>';
    });
    o.push(bars);
    if (arrows) o.push('<g class="ar">' + arrows + '</g>');

    // Daylight incoming tide (each day's low → high, inside daylight),
    // faint green; fainter on days nothing reaches the reef.
    var wk = D.week(), win = '', lows = [];
    wk.forEach(function (d) {
      if (!d || !d.low || !d.low.t) return;
      var lt = d.low.t.getTime();
      if (lt >= t0 && lt <= t0 + span) lows.push(lt);
      if (!d.low.until || !d.sun || !d.sun.sunrise) return;
      var a = Math.max(lt, d.sun.sunrise.getTime()), b = Math.min(d.low.until.getTime(), d.sun.sunset.getTime());
      if (b <= a) return;
      var x1 = Math.max(0, X(a)), x2 = Math.min(W, X(b));
      if (x2 - x1 > 0.5) win += '<rect class="win' + (d.reaches ? '' : ' dim') + '" x="' + r1(x1) + '" y="' + G.winY + '" width="' + r1(x2 - x1) + '" height="' + G.winH + '"/>';
    });
    o.push(win);

    // Tide line (6-min predictions), scaled to its own range.
    var curve = D.tideCurve().filter(function (p) { var ms = p.t.getTime(); return isNum(p.h) && ms >= t0 - HOUR && ms <= t0 + span + HOUR; });
    var tideY = null, tideMin = null, tideMax = null;
    if (curve.length > 1) {
      tideMin = Infinity; tideMax = -Infinity;
      curve.forEach(function (p) { if (p.h < tideMin) tideMin = p.h; if (p.h > tideMax) tideMax = p.h; });
      var rng = Math.max(0.1, tideMax - tideMin);
      tideY = function (h) { return G.tideBot - (h - tideMin) / rng * (G.tideBot - G.tideTop); };
      var every = Math.max(1, Math.floor(curve.length / (W * 0.8)));
      var pts = [];
      for (var j = 0; j < curve.length; j += every) pts.push(curve[j]);
      if (pts[pts.length - 1] !== curve[curve.length - 1]) pts.push(curve[curve.length - 1]);
      o.push('<path class="tl" d="M' + pts.map(function (p) { return r1(X(p.t.getTime())) + ' ' + r1(tideY(p.h)); }).join('L') + '"/>');
      lows.forEach(function (lt) {
        var td = D.tideAt(new Date(lt));
        if (td && isNum(td.h)) o.push('<circle class="lo" cx="' + r1(X(lt)) + '" cy="' + r1(tideY(td.h)) + '" r="2.5"/>');
      });
    }

    var labels = [];
    for (k = 0; k < days; k++) labels.push({ x: X(dayStarts[k]), text: F.day(new Date(dayStarts[k] + 12 * HOUR)) });

    return {
      W: W, n: n, t0: t0, tLast: tLast, span: span, days: days, X: X, tideY: tideY, times: times,
      labels: labels,
      svg: '<svg class="cl-f-cx" width="' + W + '" height="' + G.H + '" viewBox="0 0 ' + W + ' ' + G.H + '" aria-hidden="true" focusable="false">' +
        '<defs><pattern id="cl-f-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path class="hp" d="M0 0v5"/></pattern></defs>' +
        o.join('') +
        '<g class="cl-f-cur"><line class="cur" x1="0" y1="0" x2="0" y2="' + G.H + '"/><circle class="cd" cx="0" cy="0" r="3.5"/></g></svg>'
    };
  }

  function renderChart() {
    var W = lastW || 358;
    var key = D.generation() + '|' + W + '|' + U.dayKey(new Date()) + '|' + (D.loaded() ? 1 : 0);
    if (key !== chartKey || !chart) {
      chartKey = key;
      chart = buildChart(W);
      if (chart) {
        E.cxw.innerHTML = chart.svg;
        E.svg = E.cxw.querySelector('svg');
        E.curLine = E.svg.querySelector('.cur');
        E.curDot = E.svg.querySelector('.cd');
        E.dl.innerHTML = chart.labels.map(function (l) {
          return '<span style="left:' + r1(l.x / W * 100) + '%">' + esc(l.text) + '</span>';
        }).join('');
        E.cxw.setAttribute('aria-valuemax', String(chart.n - 1));
      } else {
        E.cxw.innerHTML = '<p class="cl-f-chempty">' + (D.freshness() === 'loading' ? 'Loading the forecast…' : 'No forecast to draw.') + '</p>';
        E.svg = E.curLine = E.curDot = null;
        E.dl.innerHTML = '';
      }
    }
    if (cur.mode === 'time' && chart) cur.t = U.clamp(cur.t, chart.t0, chart.tLast);
    if (!slide) placeCursor(curTime());
    updateReadout();
    updateButtons();
    pushCursor(true);
  }

  // An hour's trains → { reach: biggest in-window/edge train, blocked:
  // biggest blocked train, all } (either may be null).
  function splitTrains(hr) {
    var all = [], reach = null, blocked = null;
    if (hr) [hr.swell].concat(hr.others || []).forEach(function (t) {
      if (!t || !isNum(t.h) || t.h <= 0 || all.indexOf(t) >= 0) return;
      all.push(t);
      if (t.status === 'in' || t.status === 'edge') { if (!reach || t.h > reach.h) reach = t; }
      else if (t.status === 'blocked') { if (!blocked || t.h > blocked.h) blocked = t; }
    });
    return { reach: reach, blocked: blocked, all: all };
  }

  // ── Cursor ─────────────────────────────────────────────────────────
  function curTime() {
    var t = cur.mode === 'now' ? Date.now() : cur.t;
    return chart ? U.clamp(t, chart.t0, chart.tLast + HOUR - 1) : t;
  }
  function idxAt(T) {
    if (!chart) return D.indexAt(new Date(T));
    var i = U.clamp(Math.round((T - chart.t0) / HOUR), 0, chart.n - 1);
    if (isFinite(chart.times[i]) && Math.abs(chart.times[i] - T) <= 90 * MIN) return i;
    return D.indexAt(new Date(T));
  }
  // At "now" the hour is the app's current hour (marineNowIndex), as the
  // Now block reads it; elsewhere the nearest forecast hour.
  function idxAtCursor(T) { return cur.mode === 'now' ? D.nowIndex() : idxAt(T); }
  function tideYAt(T) {
    if (!chart || !chart.tideY) return null;
    var td = D.tideAt(new Date(T));
    return td && isNum(td.h) ? chart.tideY(td.h) : null;
  }
  function placeCursor(T) {
    if (!chart || !E.curLine) return;
    var x = r1(U.clamp(chart.X(T), 0.75, chart.W - 0.75));
    E.curLine.setAttribute('x1', x);
    E.curLine.setAttribute('x2', x);
    var y = tideYAt(T);
    if (y == null) E.curDot.setAttribute('visibility', 'hidden');
    else { E.curDot.removeAttribute('visibility'); E.curDot.setAttribute('cx', x); E.curDot.setAttribute('cy', r1(y)); }
  }
  function slideCursor(from, to, ms) {
    if (slide) cancelAnimationFrame(slide);
    slide = null;
    if (reduced() || !chart || Math.abs(chart.X(to) - chart.X(from)) < 1) { placeCursor(to); return; }
    var start = performance.now();
    var step = function (now) {
      var p = Math.min(1, (now - start) / ms);
      var e = 1 - Math.pow(1 - p, 3);
      placeCursor(from + (to - from) * e);
      slide = p < 1 ? requestAnimationFrame(step) : null;
      if (!slide) placeCursor(curTime());
    };
    slide = requestAnimationFrame(step);
  }

  function readout(T) {
    var i = idxAtCursor(T);
    var hr = i >= 0 ? D.hour(i) : null;
    var tr = splitTrains(hr);
    var sw = tr.reach || (hr && hr.swell);
    var td = D.tideAt(new Date(T));
    return {
      idx: i,
      time: F.day(new Date(T)) + ' ' + F.time(new Date(T)) + (cur.low ? ' · low' : ''),
      swell: sw ? F.swell(sw.h, sw.period) : DASH,
      blocked: !!(sw && sw.status === 'blocked'),
      wind: hr && hr.wind ? F.wind(hr.wind.mph, hr.wind.dir) : DASH,
      tide: td && isNum(td.h) ? F.tide(td.h, cur.low && cur.mode === 'time' ? true : td.rising) : DASH
    };
  }
  function updateReadout() {
    var T = curTime(), r = readout(T);
    E.rdt.parentNode.hidden = !chart;
    if (E.rdt.textContent !== r.time) E.rdt.textContent = r.time;
    var vals = [r.swell, r.wind, r.tide];
    for (var i = 0; i < 3; i++) if (E.rdv[i].textContent !== vals[i]) E.rdv[i].textContent = vals[i];
    E.rdv[0].classList.toggle('cl-f-blk', r.blocked);
    if (chart) {
      E.cxw.setAttribute('aria-valuenow', String(Math.max(0, r.idx)));
      E.cxw.setAttribute('aria-valuetext', r.time + ': swell ' + r.swell + (r.blocked ? ', blocked' : '') + ', wind ' + r.wind + ', tide ' + r.tide);
    }
  }

  // Jump targets from the cursor: lows (CO-OPS hi/lo) and whole hours.
  function lowsInRange() {
    if (!chart) return [];
    return D.tideEvents().filter(function (e) {
      var ms = e.t.getTime();
      return e.type === 'L' && ms >= chart.t0 && ms <= chart.tLast + HOUR - 1;
    }).map(function (e) { return e.t.getTime(); });
  }
  function targets() {
    if (!chart) return {};
    var T = curTime(), lows = lowsInRange(), out = {};
    for (var i = lows.length - 1; i >= 0; i--) if (lows[i] < T - MIN) { out.pl = lows[i]; break; }
    for (i = 0; i < lows.length; i++) if (lows[i] > T + MIN) { out.nl = lows[i]; break; }
    var fl = Math.floor(T / HOUR) * HOUR;
    var ph = T - fl > 30e3 ? fl : fl - HOUR;
    var nh = fl + HOUR;
    if (ph >= chart.t0) out.ph = ph;
    if (nh <= chart.tLast) out.nh = nh;
    return out;
  }
  function updateButtons() {
    var tg = targets(), atNow = cur.mode === 'now';
    E.ctl.querySelectorAll('[data-j]').forEach(function (b) {
      var j = b.getAttribute('data-j');
      var dis = !chart || (j === 'now' ? atNow : tg[j] == null);
      if (b.disabled !== dis) b.disabled = dis;
    });
  }
  function onJump(e) {
    var b = e.target.closest ? e.target.closest('[data-j]') : null;
    if (!b || b.disabled || !chart) return;
    var j = b.getAttribute('data-j');
    if (j === 'now') { setCursor({ mode: 'now', t: 0, low: false }, { slide: 250 }); return; }
    var t = targets()[j];
    if (t == null) return;
    setCursor({ mode: 'time', t: t, low: j === 'pl' || j === 'nl' }, { slide: 180 });
  }

  // One way in for every cursor move.
  function setCursor(next, opts) {
    opts = opts || {};
    var from = curTime();
    cur = next;
    var to = curTime();
    if (!opts.keepSel && selDay >= 0) {
      var d = D.week()[selDay];
      if (cur.mode === 'now' || !d || U.dayKey(new Date(to)) !== U.dayKey(d.date)) {
        selDay = -1;
        E.wk.querySelectorAll('.cl-f-row.sel').forEach(function (r) { r.classList.remove('sel'); r.setAttribute('aria-pressed', 'false'); });
        E.wk.__html = null;
      }
    }
    updateReadout();
    updateButtons();
    if (opts.slide) slideCursor(from, to, opts.slide);
    else { if (slide) { cancelAnimationFrame(slide); slide = null; } placeCursor(to); }
    run('lineup', renderLineup);
    if (opts.soon) schedulePush(); else pushCursor(false);
  }

  // The app's scrubber follows (CLEAN.cursor: Model and the app read it).
  function pushCursor(onlyIfDiff) {
    clearTimeout(pushTimer);
    pushTimer = null;
    if (!chart) return;
    var idx = cur.mode === 'now' ? D.nowIndex() : idxAt(cur.t);
    if (idx < 0) return;
    var have = typeof STATE !== 'undefined' ? STATE.scrubberIdx : -1;
    if (onlyIfDiff && have === idx) return;
    if (have === idx && C.cursor.get() === idx) return;
    try { C.cursor.set(idx); } catch (e) { err('cursor', e); }
  }
  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(function () { pushTimer = null; pushCursor(false); }, 120);
  }

  // ── Touch / mouse: the cursor snaps to whole hours as you drag ─────
  // touch-action: pan-y in CSS, so a vertical swipe still scrolls the
  // page (the browser cancels the pointer); a sideways one scrubs.
  function hourFromClientX(clientX) {
    var rect = E.svg ? E.svg.getBoundingClientRect() : E.cxw.getBoundingClientRect();
    var x = U.clamp(clientX - rect.left, 0, rect.width || chart.W);
    var T = chart.t0 + (x / (rect.width || chart.W)) * chart.span;
    var snapped = chart.t0 + Math.round((T - chart.t0) / HOUR) * HOUR;
    return U.clamp(snapped, chart.t0, chart.tLast);
  }
  function scrubTo(clientX) {
    if (!chart) return;
    var t = hourFromClientX(clientX);
    if (cur.mode === 'time' && cur.t === t && !cur.low) return;
    setCursor({ mode: 'time', t: t, low: false }, { soon: true });
    if (lastHapticHour !== t) {
      lastHapticHour = t;
      try { if (drag && drag.active && navigator.vibrate) navigator.vibrate(4); } catch (_) { /* no haptics */ }
    }
  }
  function onDown(e) {
    if (!chart || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
    lastHapticHour = null;
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      drag.active = true;
      try { E.cxw.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      if (slide) { cancelAnimationFrame(slide); slide = null; }
    }
    if (e.cancelable) e.preventDefault();
    scrubTo(e.clientX);
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.active && Math.abs(e.clientX - d.x0) < 10 && Math.abs(e.clientY - d.y0) < 10) scrubTo(e.clientX);   // a tap
    try { E.cxw.releasePointerCapture(e.pointerId); } catch (_) { /* fine */ }
    pushCursor(false);
    if (pendingChart) { pendingChart = false; run('chart', renderChart); }
  }
  function onCancel(e) {
    if (!drag || (e && e.pointerId != null && e.pointerId !== drag.id)) return;
    var was = drag.active;
    drag = null;
    if (was) pushCursor(false);
    if (pendingChart) { pendingChart = false; run('chart', renderChart); }
  }
  function onKey(e) {
    if (!chart) return;
    var T = curTime(), t = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = targets().ph;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = targets().nh;
    else if (e.key === 'PageUp') t = Math.max(chart.t0, Math.floor(T / HOUR) * HOUR - DAY);
    else if (e.key === 'PageDown') t = Math.min(chart.tLast, Math.floor(T / HOUR) * HOUR + DAY);
    else if (e.key === 'Home') t = chart.t0;
    else if (e.key === 'End') t = chart.tLast;
    else return;
    e.preventDefault();
    if (t != null) setCursor({ mode: 'time', t: t, low: false }, {});
  }

  // ════════════════════════════════════════════════════════════════════
  // LINEUP — the Choc TV radar's coastline, the window cone, the hour's
  // swell and wind (viewBox 358 × 220, the A2-Phone-Sat picture)
  // ════════════════════════════════════════════════════════════════════
  var LU = { W: 358, H: 220, crop: 0.15, lx: 140, R: 125 };
  function coast() { try { return typeof KIOSK_COAST !== 'undefined' && KIOSK_COAST && KIOSK_COAST.shore ? KIOSK_COAST : null; } catch (_) { return null; } }

  function lineupSVG(T) {
    var CO = coast();
    var W = LU.W, H = LU.H;
    var aspect = CO ? CO.aspect : 1992 / 949;
    var fh = H / (1 - LU.crop), fw = fh * aspect;
    var cxF = CO ? CO.lineup[0] : 0.5, cyF = CO ? CO.lineup[1] : 0.5;
    var fx = LU.lx - cxF * fw, fy = -LU.crop * fh;
    var lx = LU.lx, ly = fy + cyF * fh;
    var P = function (p) { return [fx + p[0] * fw, fy + p[1] * fh]; };
    var pt = function (x, y) { return r1(x) + ' ' + r1(y); };
    var o = [];
    if (CO) {
      // Land is everything above / left of the traced shore (kiosk.js).
      var shore = CO.shore.map(P);
      var endY = shore[shore.length - 1][1];
      var line = shore.map(function (p) { return pt(p[0], p[1]); }).join('L') + 'L' + pt(W + 2, endY);
      o.push('<path class="land" d="M' + line + 'L' + pt(W + 2, -2) + 'L-2 -2L' + pt(-2, H + 2) + 'Z"/>');
      (CO.ponds || []).forEach(function (pond) {
        o.push('<path class="pond" d="M' + pond.map(P).map(function (p) { return pt(p[0], p[1]); }).join('L') + 'Z"/>');
      });
      o.push('<path class="shore" d="M' + line + '"/>');
    } else {
      // No vectors for this spot: the satellite photo, same frame.
      o.push('<image href="project/assets/lineup.jpg" x="' + r1(fx) + '" y="' + r1(fy) + '" width="' + r1(fw) + '" height="' + r1(fh) + '" preserveAspectRatio="none"/>');
    }
    // Window cone (compass bearing θ: x = sin θ, y = −cos θ).
    var at = function (deg, r) { var th = deg * Math.PI / 180; return [lx + Math.sin(th) * r, ly - Math.cos(th) * r]; };
    var e1 = at(WIN_MIN, LU.R), e2 = at(WIN_MAX, LU.R);
    o.push('<path class="cone" d="M' + pt(lx, ly) + 'L' + pt(e1[0], e1[1]) + 'A' + LU.R + ' ' + LU.R + ' 0 0 1 ' + pt(e2[0], e2[1]) + 'Z"/>');

    var i = idxAtCursor(T), hr = i >= 0 ? D.hour(i) : null;
    var tr = splitTrains(hr);
    var sw = tr.reach || (hr && hr.swell);
    var w = hr && hr.wind;
    var mid = (WIN_MIN + WIN_MAX) / 2;
    var arrow = function (fromDeg, len, gap, cls) {
      var u = at(fromDeg, 1), ux = u[0] - lx, uy = u[1] - ly;
      var tip = [lx + ux * gap, ly + uy * gap], tail = [lx + ux * (gap + len), ly + uy * (gap + len)];
      var arm = function (deg) {
        var a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
        return [tip[0] + (ux * cs - uy * sn) * 9, tip[1] + (ux * sn + uy * cs) * 9];
      };
      var a1 = arm(38), a2 = arm(-38);
      o.push('<path class="' + cls + '" d="M' + pt(tail[0], tail[1]) + 'L' + pt(tip[0], tip[1]) + 'M' + pt(a1[0], a1[1]) + 'L' + pt(tip[0], tip[1]) + 'L' + pt(a2[0], a2[1]) + '"/>');
      return { tail: tail, ux: ux, uy: uy, from: fromDeg };
    };
    var labels = [];
    if (sw && isNum(sw.dir)) {
      var len = U.clamp(Math.sqrt(sw.h * sw.h * (sw.period || 1)) * 28, 56, 112);
      var a = arrow(sw.dir, len, 5, 'sa sa-' + (sw.status === 'blocked' ? 'blk' : sw.status === 'edge' ? 'edge' : 'in'));
      labels.push(readLabel(F.swell(sw.h, sw.period, sw.compass), a, mid, 'rd'));
    }
    if (w && isNum(w.dir) && isNum(w.mph)) {
      var wa = arrow(w.dir, U.clamp(w.mph * 5.5, 36, 100), 9, 'wa');
      labels.push(readLabel(F.wind(w.mph, w.dir), wa, mid, 'rd'));
    }
    o.push('<circle class="mk" cx="' + r1(lx) + '" cy="' + r1(ly) + '" r="4.5"/>');
    // The cone's real-world ends, two lines each, outside the arc.
    labels.push({ lines: ['SW Pt Block', WIN_MIN + '°'], x: W - 8, y: e1[1] + 22, anchor: 'end', cls: 'lab' });
    labels.push({ lines: ['Montauk Pt ' + WIN_MAX + '°'], x: e2[0] + 10, y: e2[1] + 1, anchor: 'start', cls: 'lab' });
    placeLabels(labels, W, H).forEach(function (l) {
      o.push('<text class="' + l.cls + '" x="' + r1(l.x) + '" y="' + r1(l.y) + '" text-anchor="' + l.anchor + '">' +
        l.lines.map(function (t, k) { return k ? '<tspan x="' + r1(l.x) + '" dy="13.5">' + esc(t) + '</tspan>' : esc(t); }).join('') + '</text>');
    });

    var aria = 'Lineup: swell window from ' + WIN_MIN + ' to ' + WIN_MAX + ' degrees' +
      (sw ? '; swell ' + F.swell(sw.h, sw.period, sw.compass) + (sw.status ? ', ' + F.status(sw.status).toLowerCase() : '') : '') +
      (w ? '; wind ' + F.wind(w.mph, w.dir) : '');
    return '<svg class="cl-f-scene" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(aria) + '">' + o.join('') + '</svg>';
  }
  // A reading sits just past its arrow's tail, pushed off the shaft to
  // the side away from the window's centre so it never sits on the cone.
  function readLabel(text, a, midDeg, cls) {
    var d = ((a.from - midDeg) % 360 + 540) % 360 - 180;          // signed bearing from the window centre
    var nx = d >= 0 ? -a.uy : a.uy, ny = d >= 0 ? a.ux : -a.ux;   // unit normal, away from the cone
    var px = a.tail[0] + a.ux * 6 + nx * 8, py = a.tail[1] + a.uy * 6 + ny * 8;
    var ex = a.ux + nx * 0.8;                                      // which way the text runs
    var anchor = ex > 0.3 ? 'start' : ex < -0.3 ? 'end' : 'middle';
    var y = ny < -0.3 ? py : ny > 0.3 ? py + 11 : py + 4;          // baseline: above, below or beside
    var x = px;
    return { lines: [text], x: x, y: y, anchor: anchor, cls: cls };
  }
  // Keep labels inside the picture and off each other (first placed wins).
  function placeLabels(labels, W, H) {
    var boxes = [];
    return labels.map(function (l) {
      var wpx = Math.max.apply(null, l.lines.map(function (t) { return t.length * 6.6; }));
      var hpx = 13.5 * (l.lines.length - 1);
      var x1 = l.anchor === 'end' ? l.x - wpx : l.anchor === 'middle' ? l.x - wpx / 2 : l.x;
      if (x1 < 6) { l.x += 6 - x1; x1 = 6; }
      if (x1 + wpx > W - 6) { l.x -= x1 + wpx - (W - 6); x1 = W - 6 - wpx; }
      l.y = U.clamp(l.y, 14, H - 6 - hpx);
      for (var g = 0; g < 6; g++) {
        var y1 = l.y - 11, y2 = l.y + hpx + 3;
        var hit = boxes.filter(function (b) { return x1 < b.x2 && x1 + wpx > b.x1 && y1 < b.y2 && y2 > b.y1; })[0];
        if (!hit) break;
        var down = hit.y2 + 12, up = hit.y1 - 4 - hpx;
        l.y = down + hpx <= H - 6 ? down : Math.max(14, up);
      }
      boxes.push({ x1: x1, x2: x1 + wpx, y1: l.y - 11, y2: l.y + hpx + 3 });
      return l;
    });
  }
  function renderLineup() {
    var T = curTime();
    var key = chartKey + '|' + idxAtCursor(T) + '|' + Math.floor(T / MIN) + '|' + (D.loaded() ? 1 : 0);
    if (E.lu.__key === key) return;
    E.lu.__key = key;
    E.lu.innerHTML = lineupSVG(T) +
      '<p class="cl-fine cl-f-cap">' + (D.loaded() ? esc(F.day(new Date(T)) + ' ' + F.time(new Date(T))) + ', swell and wind at the reef'
        : D.freshness() === 'loading' ? 'Waiting for the forecast' : 'No forecast for the swell and wind arrows') + '</p>';
  }

  // ════════════════════════════════════════════════════════════════════
  // DETAILS — expandable rows
  // ════════════════════════════════════════════════════════════════════
  var ROWS = [
    { key: 'light', title: 'Light and water, today', body: lightHTML },
    { key: 'tides', title: 'Tide table', body: tidesHTML },
    { key: 'buoy', title: 'Buoy waves', body: buoyHTML },
    { key: 'sources', title: 'Data sources', body: sourcesHTML }
  ];
  function detailsHTML() {
    return ROWS.map(function (r) {
      var on = !!openRows[r.key], body = '';
      if (on) { try { body = r.body(); } catch (e) { err('details.' + r.key, e); body = '<p class="cl-f-empty">' + DASH + '</p>'; } }
      return '<div class="cl-f-dd' + (on ? ' open' : '') + '">' +
        '<button type="button" class="cl-dr cl-f-dr" data-dd="' + r.key + '" aria-expanded="' + on + '"' + (on ? ' aria-controls="cl-f-dd-' + r.key + '"' : '') + '>' +
          '<span>' + esc(r.title) + '</span><span class="cl-f-chev">' + (on ? I.chevronDown(18) : I.chevronRight(18)) + '</span></button>' +
        (on ? '<div class="cl-f-ddb" id="cl-f-dd-' + r.key + '">' + body + '</div>' : '') + '</div>';
    }).join('');
  }
  function renderDetails() {
    keepFocus(E.det, 'data-dd', function () { setHTML(E.det, detailsHTML()); });
  }
  function onDetailsClick(e) {
    var b = e.target.closest ? e.target.closest('[data-dd]') : null;
    if (!b) return;
    var k = b.getAttribute('data-dd');
    openRows[k] = !openRows[k];
    renderDetails();
  }
  function kv(rows) {
    return '<div class="cl-kv cl-f-kv">' + rows.map(function (r) {
      return '<span>' + esc(r[0]) + '</span><span' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + esc(r[1]) + '</span>';
    }).join('') + '</div>';
  }
  // Water temperature: the app's own chain (CO-OPS Montauk, then the
  // buoy, then the model's sea surface), as its condition card shows it.
  function waterText() {
    var e = document.getElementById('val-water-temp');
    var t = e ? String(e.textContent || '').trim() : '';
    return /^-?\d+°F$/.test(t) ? t : DASH;
  }
  function lightHTML() {
    var s = D.sun(new Date());
    var tm = function (k) { return s && s[k] ? F.time(s[k]) : DASH; };
    return kv([['First light', tm('firstLight')], ['Sunrise', tm('sunrise')], ['Sunset', tm('sunset')], ['Last light', tm('lastLight')], ['Water', waterText()]]);
  }
  function tidesHTML() {
    var ev = D.tideEvents();
    if (!ev.length) return '<p class="cl-f-empty">No tide predictions loaded.</p>';
    var start = U.startOfDay(new Date(), 0).getTime(), end = U.startOfDay(new Date(), 4).getTime(), nowMs = Date.now();
    var byDay = [], last = '';
    ev.forEach(function (e) {
      var ms = e.t.getTime();
      if (ms < start || ms >= end) return;
      var k = U.dayKey(e.t);
      if (k !== last) { byDay.push({ t: e.t, rows: [] }); last = k; }
      byDay[byDay.length - 1].rows.push(e);
    });
    if (!byDay.length) return '<p class="cl-f-empty">No tide predictions for the next days.</p>';
    return '<div class="cl-f-tt">' + byDay.map(function (d) {
      return '<p class="cl-f-tth">' + esc(U.dayKey(d.t) === U.dayKey(new Date()) ? 'Today' : F.date(d.t)) + '</p>' +
        d.rows.map(function (e) {
          var past = e.t.getTime() < nowMs;
          return '<div class="cl-f-ttr' + (past ? ' past' : '') + '">' + (e.type === 'L' ? I.tide(18) : I.tideHigh(18)) +
            '<span>' + (e.type === 'L' ? 'Low' : 'High') + '</span><span>' + F.time(e.t) + '</span><span>' + F.tide(e.h) + '</span></div>';
        }).join('');
    }).join('') + '</div>';
  }
  function buoyHTML() {
    var b = D.buoy();
    if (!b) return '<p class="cl-f-empty">No buoy reading.</p>';
    var cls = b.level === 'stale' ? 'cl-stale' : b.level === 'dead' ? 'cl-dead' : '';
    var h = '<p class="cl-fine cl-f-obs' + (cls ? ' ' + cls : '') + '">' + esc('Wave buoy, observed ' + (b.obsAt ? F.when(b.obsAt) + ' · ' + F.age(b.obsAt) : DASH)) + '</p>';
    var rows = [];
    rows.push([b.band ? 'Swell 8 s and longer' : 'Waves', F.swell(b.h, b.period, b.compass)]);
    if (b.reachesAt) rows.push([b.reachesAt.getTime() >= Date.now() ? 'Reaches the reef' : 'Reached the reef', '~' + F.time(b.reachesAt)]);
    rows.push(['Total sea', F.ft(b.total)]);
    var sp = typeof STATE !== 'undefined' ? STATE.lastSpecSummary : null;
    var m2f = function (v) { return isNum(v) ? v * 3.28084 : null; };
    if (sp) {
      rows.push(['Swell 10 s and longer', F.swell(m2f(sp.swellHt), sp.swellPeriod, isNum(sp.swellDir) ? F.compass(sp.swellDir) : null)]);
      rows.push(['Wind waves under 10 s', F.swell(m2f(sp.windHt), sp.windPeriod, isNum(sp.windDir) ? F.compass(sp.windDir) : null)]);
    }
    h += kv(rows);
    h += roseSVG();
    return h;
  }
  // The app's directional spectrum (STATE.lastSpectral, the bins its
  // compass rose draws), restyled as 10° slices.
  function roseSVG() {
    var sp = typeof STATE !== 'undefined' ? STATE.lastSpectral : null;
    var bins = sp && Array.isArray(sp.bins) ? sp.bins : [];
    var measured = typeof binsHaveMeasuredDir === 'function' ? binsHaveMeasuredDir(bins) : bins.some(function (b) { return isNum(b.dir1) && b.dir1 > 0 && b.dir1 < 999; });
    if (!measured) return '';
    var S = 220, c = S / 2, R = 84, SEC = 10;
    // Energy per 10° sector (energy × bandwidth, as the app's m0), split
    // into 8 s and longer vs shorter; radius ∝ √energy so small seas show.
    var secs = {}, maxE = 0;
    bins.forEach(function (b, i) {
      if (!b || !(b.energy > 0) || !(b.period > 0) || !isNum(b.dir1) || b.dir1 >= 999) return;
      var nb = bins[i + 1] || bins[i - 1];
      var df = nb && isNum(nb.freq) && isNum(b.freq) ? Math.abs(nb.freq - b.freq) : 0.005;
      var k = Math.floor(norm360(b.dir1) / SEC);
      var sc = secs[k] || (secs[k] = { lng: 0, sht: 0 });
      if (b.period >= 8) sc.lng += b.energy * df; else sc.sht += b.energy * df;
    });
    Object.keys(secs).forEach(function (k) { maxE = Math.max(maxE, secs[k].lng + secs[k].sht); });
    if (!(maxE > 0)) return '';
    var at = function (deg, r) { var th = deg * Math.PI / 180; return r1(c + Math.sin(th) * r) + ' ' + r1(c - Math.cos(th) * r); };
    var wedge = function (k, r0, r, cls) {
      if (r - r0 < 0.6) return '';
      var a0 = k * SEC + 0.6, a1 = (k + 1) * SEC - 0.6;
      return '<path class="' + cls + '" d="M' + at(a0, r0) + 'L' + at(a0, r) + 'A' + r1(r) + ' ' + r1(r) + ' 0 0 1 ' + at(a1, r) +
        'L' + at(a1, r0) + (r0 > 0 ? 'A' + r1(r0) + ' ' + r1(r0) + ' 0 0 0 ' + at(a0, r0) : '') + 'Z"/>';
    };
    var o = [];
    [0.33, 0.66, 1].forEach(function (f) { o.push('<circle class="rg" cx="' + c + '" cy="' + c + '" r="' + r1(R * f) + '"/>'); });
    var cone = 'M' + c + ' ' + c + 'L' + at(WIN_MIN, R) + 'A' + R + ' ' + R + ' 0 0 1 ' + at(WIN_MAX, R) + 'Z';
    o.push('<path class="rc" d="' + cone + '"/>');
    Object.keys(secs).forEach(function (k) {
      var sc = secs[k];
      var rl = Math.sqrt(sc.lng / maxE) * R, rt = Math.sqrt((sc.lng + sc.sht) / maxE) * R;
      o.push(wedge(+k, 0, rl, 'wl'));
      o.push(wedge(+k, rl, rt, 'ws'));
    });
    o.push('<path class="rco" d="' + cone + '"/>');
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(function (p) {
      var xy = at(p[1], R + 14).split(' ');
      o.push('<text x="' + xy[0] + '" y="' + (+xy[1] + 4) + '" text-anchor="middle">' + p[0] + '</text>');
    });
    return '<figure class="cl-f-rose"><svg viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-label="Wave energy at the buoy by direction, with the swell window from ' + WIN_MIN + ' to ' + WIN_MAX + ' degrees">' + o.join('') + '</svg>' +
      '<figcaption class="cl-fine">Wave energy at the buoy by direction: the solid part of each slice is 8 s and longer, the pale part shorter. The green cone is the swell window, ' + WIN_MIN + '–' + WIN_MAX + '°.</figcaption></figure>';
  }
  function sourcesHTML() {
    var src = D.sources();
    if (!src.length) return '<p class="cl-f-empty">' + DASH + '</p>';
    return kv(src.map(function (s) {
      return [s.label, s.text, s.level === 'stale' ? 'cl-stale' : s.level === 'dead' ? 'cl-dead' : ''];
    }));
  }

  // ════════════════════════════════════════════════════════════════════
  C.register('forecast', {
    mount: mount,
    render: render,
    onShow: function () {
      if (measure()) { chartKey = ''; run('chart', renderChart); E.lu.__key = null; run('lineup', renderLineup); }
    }
  });
})();
