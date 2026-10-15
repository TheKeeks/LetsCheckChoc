// ════════════════════════════════════════════════════════════════════
// CLEAN — forecast.js (owner: Forecast part)
// ────────────────────────────────────────────────────────────────────
// The Forecast tab, built on the Sound Check model: GFS-Wave and ECMWF
// read at buoy 44097 and carried over the sea floor to Choc (research/,
// scripts/forecast/fcpull.py). One hour at a time, picked on the week
// scrubber:
//   • Headline: the height at the spot (Choc, or Wilderness), the mean of
//     the two models, each model under it.
//   • Swells: each GFS-Wave swell at the buoy and its share of the
//     energy that reaches the spot ("1° 2.9 ft @ 8 s S 178° → 66% of
//     Choc"), with a bar. Colour = where it comes from (E, SE, S, other),
//     the same on the rows, the map and the bars.
//   • The map: the Sound Check map at the same hour (research/map.html, the
//     map alone, in a frame), with its layers. Ocean shows the North
//     Atlantic's wave height with GFS's sea-level pressure, the lows and
//     highs and each storm's track; Region, the swell headed for the spot;
//     Fishers, those swells' rays bending over the bottom into the spot,
//     coloured like their rows, thicker for a bigger share. The tab sets its
//     hour, spot and zoom (message lcc-fc); its "3D" button opens the sea
//     floor in 3D on the Explore tab at the same hour.
//   • Week scrubber: the spot's height for the run's 7 days (both models'
//     mean, the GFS-to-ECMWF band, each model), nights shaded, the tide
//     and the wind (blue when offshore at Choc) underneath. Drag, arrow
//     keys, the jump buttons or play; "Now" follows the clock.
//     The chart has two views (Models | Swells, remembered per device in
//     lcc-f-chart): the two models as lines, or the same week as a stack
//     of where the swell comes from (each family's share of the energy
//     times the mean height, coloured like the swell rows).
//   • Layout: one column on a phone. From 900 px the map takes the full
//     width with the readout as a card over its top-left, the zoom and
//     spot top-right and the week docked in a dark band along its bottom
//     ("timeline on the map"). The map's full-screen button (inside the
//     frame, message lcc-fc-full) opens the tab's own full screen on any
//     width: the map fills the window, a small card with the hour and
//     height top-left, the week, its buttons and the zoom in a dock along
//     the bottom. Back, Escape or the map's button closes it, at the same
//     hour (one history entry, like CLEAN.sub).
//   • Wind and tide at that hour, then the buoy check: buoy 44097's
//     latest reading against the forecasts made 1, 2 and 3 days before
//     for that hour (Open-Meteo's earlier runs at the buoy); tap for the
//     last two days.
// The model forecast is core's CLEAN.model (research/fc/fc.json or the
// bot's newer pull on the fc-data branch, whichever is newer; Choc TV
// shows the same one). When neither covers the hour
// the tab says so instead of showing an old number as now. Missing data
// stays null and shows "—". Times are the spot's (America/New_York).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.CLEAN || typeof CLEAN.register !== 'function') return;

  var C = window.CLEAN, D = C.data, F = C.fmt, U = C.util, I = C.icon;
  var NB = F.NB, DASH = F.DASH, esc = U.esc, isNum = U.isNum;
  var HOUR = 3600e3, DAY = 864e5, M2FT = 3.28084;
  // the Sound Check map alone (no history), in the Forecast tab's profile
  var MAP_PAGE = 'research/map.html?view=map&fill=1&ui=forecast';
  var ZOOMS = { ocean: 'Ocean', reg: 'Region', fi: 'Fishers' };
  var VERIF = 'data/verification.json';
  var PREV = 'https://marine-api.open-meteo.com/v1/marine';
  var BUOY_LL = [40.969, -71.127];        // NDBC 44097 (fc.json carries it as fc.buoy)
  var SPOTS = { choc: { k: 'choc', name: 'Choc' }, wild: { k: 'wild', name: 'Wilderness' } };
  // Where a swell comes from: one colour everywhere (rows, bars, Choc TV, and the map's rays near Fishers,
  // research/map.html's FAM): core's.
  var FAM = C.model.FAM, fam = C.model.fam;
  function rgb(c, a) { return a == null ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')'; }

  var root = null, E = {};
  var fc = C.model.state;                 // { steps, made, runs, buoy, status }: core's, read only
  var spot = 'choc';
  var cur = { mode: 'now', i: -1 };       // 'now' follows the clock; 'pick' holds a picked step
  var geom = null, drag = null, rz = null;
  var prev = { status: 'idle', data: null, at: 0 };
  var verif = { status: 'idle', rows: null, at: 0 };
  var sheet = null;                       // the open buoy-check sub-page
  // the map in its frame: 'idle' until the tab is first shown, 'loading', then 'ready' once its forecast is in
  // ('failed' when it couldn't load one)
  var map = { status: 'idle', zoom: 'reg', sent: null, raf: 0, inset: null };
  var play = { timer: 0 };
  // the chart's view: 'models' (each model as a line) or 'swells' (the mean split by where the swell comes from)
  var VIEWS = { models: 'Models', swells: 'Swells' };
  var view = 'models';
  // the tab's own full screen (the map's ⤢ button): { on, pushed (a history entry is ours), scroll (to go back to) }
  var full = { on: false, pushed: false, scroll: 0 };
  var wideMQ = window.matchMedia ? window.matchMedia('(min-width: 900px)') : null;
  // Swell families bottom to top in the Swells view: SE (Choc's own swell window) at the bottom, then E, S, other,
  // in the same order every step so each band runs on unbroken.
  var STACK = [1, 0, 2, 3];
  var STACK_NAME = ['E swell', 'SE swell', 'S swell', 'other'];

  try { if (localStorage.getItem('lcc-f-spot') === 'wild') spot = 'wild'; } catch (_) { /* private mode */ }
  try { var z0 = localStorage.getItem('lcc-f-zoom'); if (ZOOMS[z0]) map.zoom = z0; } catch (_) { /* private mode */ }
  try { if (localStorage.getItem('lcc-f-chart') === 'swells') view = 'swells'; } catch (_) { /* private mode */ }

  function err(where, e) { C.err('forecast.' + where, e); }
  function run(where, fn) { try { fn(); } catch (e) { err(where, e); } }
  function setHTML(el, html) { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } }
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  // "Thu 2 PM"; a week out the weekday repeats, so the date comes along: "Thu 8 Oct, 2 PM".
  function hourLabel(t) {
    var hm = F.time(t).replace(':00' + NB, NB);
    return Math.abs(t.getTime() - Date.now()) >= 6 * DAY ? F.date(t) + ', ' + hm : F.day(t) + ' ' + hm;
  }

  // ════════════════════════════════════════════════════════════════════
  // THE MODEL FORECAST
  // ════════════════════════════════════════════════════════════════════
  // The step nearest the clock, when the run covers it; -1 when it doesn't.
  function nowStep() { return C.model.nowStep(); }
  function curStep() {
    if (!fc.steps) return -1;
    if (cur.mode === 'pick') return Math.max(0, Math.min(fc.steps.length - 1, cur.i));
    return nowStep();
  }
  // The swells at a step, each with its share of the energy reaching the spot.
  function parts(s, sp) { return C.model.parts(s, SPOTS[sp].k); }
  function madeAge() {
    var m = Date.parse(fc.made);
    return isNum(m) ? Date.now() - m : null;
  }

  // ════════════════════════════════════════════════════════════════════
  // MOUNT
  // ════════════════════════════════════════════════════════════════════
  function mount(el) {
    root = el;
    el.innerHTML =
      '<div class="cl-f">' +
        '<div class="cl-f-head" aria-live="polite"></div>' +
        '<div class="cl-f-map">' +
          '<div class="cl-f-mbar">' +
            '<div class="cl-f-seg cl-f-zseg" role="group" aria-label="Map view">' +
              Object.keys(ZOOMS).map(function (z) { return '<button type="button" data-zoom="' + z + '" aria-pressed="false">' + ZOOMS[z] + '</button>'; }).join('') +
            '</div>' +
            '<div class="cl-f-seg cl-f-sseg" role="group" aria-label="Spot">' +
              '<button type="button" data-spot="choc">Choc</button><button type="button" data-spot="wild">Wilderness</button>' +
            '</div>' +
          '</div>' +
          '<div class="cl-f-stage">' +
            '<iframe class="cl-f-frame" title="Forecast map: wave height, pressure and storms, swell headed for the spot, and its rays near Fishers" allow="fullscreen"></iframe>' +
          '</div>' +
        '</div>' +
        '<div class="cl-f-wk">' +
          '<div class="cl-f-wkh">' +
            '<div class="cl-f-vseg" role="group" aria-label="Chart">' +
              Object.keys(VIEWS).map(function (v) { return '<button type="button" data-view="' + v + '" aria-pressed="false">' + VIEWS[v] + '</button>'; }).join('') +
            '</div>' +
          '</div>' +
          '<div class="cl-f-cx" tabindex="0" role="slider" aria-label="Forecast hour. Drag, or use the arrow keys" aria-describedby="cl-f-cxd" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>' +
          '<p class="cl-sr-only" id="cl-f-cxd"></p>' +
          '<div class="cl-f-lgd" aria-hidden="true"></div>' +
          '<div class="cl-f-ctl">' +
            '<button type="button" class="cl-f-jb cl-f-play" data-j="play" aria-label="Play the week" aria-pressed="false"><span aria-hidden="true">▶</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="-day" aria-label="A day earlier">' + I.jumpsLeft(14) + '<span>day</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="-1" aria-label="Previous forecast step">' + I.jumpLeft(14) + '</button>' +
            '<button type="button" class="cl-f-jb" data-j="now" aria-label="Back to now"><span>Now</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="1" aria-label="Next forecast step">' + I.jumpRight(14) + '</button>' +
            '<button type="button" class="cl-f-jb" data-j="day" aria-label="A day later"><span>day</span>' + I.jumpsRight(14) + '</button>' +
          '</div>' +
          // full screen: the map's zoom moves down here, by the week
          '<div class="cl-f-dz" hidden>' +
            '<div class="cl-f-seg cl-f-dzseg" role="group" aria-label="Map view">' +
              Object.keys(ZOOMS).map(function (z) { return '<button type="button" data-zoom="' + z + '" aria-pressed="false">' + ZOOMS[z] + '</button>'; }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cl-f-side">' +
          '<div class="cl-f-cond"></div>' +
          '<button type="button" class="cl-f-bc" aria-label="Buoy check: open the last two days"></button>' +
          '<p class="cl-fine cl-f-src"></p>' +
        '</div>' +
      '</div>';
    E.head = el.querySelector('.cl-f-head');
    E.map = el.querySelector('.cl-f-map');
    E.frame = E.map.querySelector('iframe');
    E.seg = E.map.querySelector('.cl-f-sseg');
    E.zseg = E.map.querySelector('.cl-f-zseg');
    E.play = el.querySelector('.cl-f-play');
    E.wk = el.querySelector('.cl-f-wk');
    E.cx = el.querySelector('.cl-f-cx');
    E.ctl = el.querySelector('.cl-f-ctl');
    E.cond = el.querySelector('.cl-f-cond');
    E.bc = el.querySelector('.cl-f-bc');
    E.src = el.querySelector('.cl-f-src');
    E.f = el.querySelector('.cl-f');
    E.mbar = el.querySelector('.cl-f-mbar');
    E.vseg = el.querySelector('.cl-f-vseg');
    E.cxd = el.querySelector('#cl-f-cxd');
    E.lgd = el.querySelector('.cl-f-lgd');
    E.dz = el.querySelector('.cl-f-dz');

    E.seg.addEventListener('click', C.guard('forecast.spot', function (ev) {
      var b = ev.target.closest('button[data-spot]'); if (!b) return;
      spot = b.getAttribute('data-spot') === 'wild' ? 'wild' : 'choc';
      try { localStorage.setItem('lcc-f-spot', spot); } catch (_) { /* private mode */ }
      render('spot');
    }));
    var onZoom = C.guard('forecast.zoom', function (ev) {
      var b = ev.target.closest('button[data-zoom]'); if (!b) return;
      setZoom(b.getAttribute('data-zoom'));
    });
    E.zseg.addEventListener('click', onZoom);
    E.dz.addEventListener('click', onZoom);
    E.vseg.addEventListener('click', C.guard('forecast.view', function (ev) {
      var b = ev.target.closest('button[data-view]'); if (!b) return;
      setView(b.getAttribute('data-view'));
    }));
    // full screen: Back (the iPhone's back swipe) and Escape close it
    window.addEventListener('popstate', C.guard('forecast.fullpop', function (ev) {
      if (full.on && !(ev.state && ev.state.clFull)) { full.pushed = false; setFull(false); }
    }));
    document.addEventListener('keydown', C.guard('forecast.fullkey', function (ev) {
      if (ev.key === 'Escape' && full.on && !C.sub.depth()) exitFull();
    }));
    C.on('tab', function (t) { if (full.on && t !== 'forecast') { full.pushed = false; setFull(false); } });
    if (wideMQ) {
      var onMQ = C.guard('forecast.layout', function () { headMin.key = ''; render('layout'); });
      if (wideMQ.addEventListener) wideMQ.addEventListener('change', onMQ); else if (wideMQ.addListener) wideMQ.addListener(onMQ);
    }
    // a reload while full screen was open lands on its history entry: the tab opens in its normal layout
    try { if (history.state && history.state.clFull) history.replaceState(null, ''); } catch (_) { /* fine */ }
    window.addEventListener('message', C.guard('forecast.frame', onFrameMessage));
    E.ctl.addEventListener('click', C.guard('forecast.jump', onJump));
    E.cx.addEventListener('pointerdown', C.guard('forecast.down', onDown));
    E.cx.addEventListener('pointermove', C.guard('forecast.move', onMove));
    E.cx.addEventListener('pointerup', C.guard('forecast.up', onUp));
    E.cx.addEventListener('pointercancel', C.guard('forecast.cancel', onUp));
    E.cx.addEventListener('keydown', C.guard('forecast.key', onKey));
    E.bc.addEventListener('click', C.guard('forecast.buoycheck', openBuoyCheck));
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(C.guard('forecast.resize', function () { run('head', renderHead); run('chart', renderChart); run('inset', sendInset); }), 120);
    });
    C.on('tick', function () { render('tick'); });
    renderZoom();
    renderView();
    C.on('soundcheck', function () { render('fc'); });
    // ↻ in the header (core's CLEAN.refresh fetches the run, the wind, tides and buoy): the map's own copy of the
    // run, and the buoy check's earlier forecasts and readings, too
    C.on('refresh', function () {
      if (map.status !== 'idle') post({ type: 'lcc-fc-refresh' });
      prev.at = 0; loadPrevRuns();
      verif.at = 0; if (sheet) loadVerif();
    });
    C.model.load();
    loadPrevRuns();
  }

  function render(reason) {
    if (!root) return;
    if (C.tab() === 'forecast') loadMap();   // the first time the tab is on screen (at boot it gets no onShow)
    if (reason === 'tick' && Date.now() - prev.at > 3 * HOUR) loadPrevRuns();
    run('head', renderHead);
    run('chart', renderChart);
    run('map', syncMap);
    run('cond', renderCond);
    run('buoy', renderBuoyLine);
    run('src', renderSource);
    if (sheet) run('sheet', function () { renderSheet(sheet.body); });
    run('inset', sendInset);
  }

  // ════════════════════════════════════════════════════════════════════
  // HEADLINE AND SWELLS
  // ════════════════════════════════════════════════════════════════════
  // compact: full screen's small card (the hour, the height, one line for the models; the swells are the map's labels)
  function headHTML(i, now, compact) {
    var sp = SPOTS[spot], s = fc.steps[i], v = s[sp.k], at = new Date(s.t);
    var h = '<p class="cl-f-when"><span class="cl-serif">' + esc(hourLabel(at)) + '</span>' + (now ? '<span class="cl-f-now">now</span>' : '') + '</p>';
    h += '<p class="cl-f-big"><span class="cl-f-num">' + (isNum(v.m) ? F.num(v.m) : DASH) + '</span><span class="cl-f-unit">ft at ' + esc(sp.name) + '</span></p>';
    if (compact) return h + '<p class="cl-f-models">GFS ' + (isNum(v.g) ? F.num(v.g) : DASH) + ' · ECMWF ' + (isNum(v.e) ? F.num(v.e) : DASH) + '</p>';
    h += '<p class="cl-f-models">GFS-Wave ' + (isNum(v.g) ? F.num(v.g) : DASH) + ' · ECMWF ' + (isNum(v.e) ? F.num(v.e) : DASH) + NB + 'ft</p>';
    var ps = parts(s, spot);
    h += '<ul class="cl-f-tr" aria-label="Swells at buoy 44097 and their share of ' + esc(sp.name) + '">';
    ps.forEach(function (p, n) {
      var x = p.t, c = FAM[fam(x.D)].rgb, pct = Math.round(p.share * 100);
      h += '<li><i class="cl-f-dot" style="background:' + rgb(c) + '"></i>' +
        '<span class="cl-f-trt"><b>' + (n + 1) + '°</b> ' + esc(F.swell(x.ft, x.T, F.compass(x.D))) + ' ' + esc(F.deg(x.D)) +
        (x.k === 'ww' ? ' <small>wind sea</small>' : '') + ' → ' + pct + '% of ' + esc(sp.name) + '</span>' +
        '<span class="cl-f-bar" aria-hidden="true"><i style="width:' + Math.max(2, pct) + '%;background:' + rgb(c) + '"></i></span></li>';
    });
    if (!ps.length) h += '<li class="cl-f-none">No swell reaches ' + esc(sp.name) + ' this hour</li>';
    return h + '</ul>';
  }
  // The headline is as tall as the run's tallest hour (more swells, longer
  // lines), so the week chart below doesn't jump under a finger dragging
  // through the hours (and on a wide screen the card over the map keeps its
  // size). Measured once per run, spot and width, off screen.
  var headMin = { key: '', px: 0 };
  function holdHeadHeight() {
    // the border box's width (the wide screen's card has a border; the probe is border-box too)
    var w = Math.round(E.head.getBoundingClientRect().width * 100) / 100, key = fc.made + '|' + spot + '|' + w + '|' + layout();
    if (!w || headMin.key === key) return;
    var probe = document.createElement('div');
    probe.className = E.head.className;
    probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;min-height:0;width:' + w + 'px';
    E.head.parentNode.appendChild(probe);
    var px = 0;
    for (var i = 0; i < fc.steps.length; i++) {
      probe.innerHTML = headHTML(i, i === nowStep());
      px = Math.max(px, Math.ceil(probe.getBoundingClientRect().height));   // offsetHeight rounds a 326.6 px headline down
    }
    probe.parentNode.removeChild(probe);
    headMin = { key: key, px: px };
    E.head.style.minHeight = px ? px + 'px' : '';
  }
  function renderHead() {
    var i = curStep();
    if (i < 0) {
      var msg = fc.status === 'loading' ? 'Loading the Sound Check forecast…'
        : fc.status === 'failed' ? 'The Sound Check forecast didn’t load.'
        : 'The Sound Check forecast doesn’t reach now: its newest run is from ' + F.when(new Date(Date.parse(fc.made))) + '.';
      E.head.style.minHeight = '';
      headMin.key = '';
      setHTML(E.head, '<p class="cl-f-msg">' + esc(msg) + '</p>');
      return;
    }
    if (full.on) {
      E.head.style.minHeight = '';
      headMin.key = '';
      setHTML(E.head, headHTML(i, cur.mode === 'now' || i === nowStep(), true));
    } else {
      setHTML(E.head, headHTML(i, cur.mode === 'now' || i === nowStep()));
      holdHeadHeight();
    }
    E.seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-spot') === spot)); });
  }

  // ════════════════════════════════════════════════════════════════════
  // THE MAP: the Sound Check map at the same hour, in a frame
  // ════════════════════════════════════════════════════════════════════
  // research/map.html is the Sound Check map alone (its code without the
  // history or the charts). Loaded the first time the tab shows; it says
  // lcc-fc-ready once its forecast is in, and from then on the tab sends it
  // the hour on show, the spot, and the zoom when one is picked here.
  function theme() { return C.theme() === 'night' ? 'dark' : 'light'; }
  function loadMap() {
    if (!E.frame || map.status !== 'idle') return;
    map.status = 'loading';
    E.frame.src = MAP_PAGE + '&theme=' + theme();
  }
  function post(msg) {
    var w = E.frame && E.frame.contentWindow;
    if (w) w.postMessage(msg, location.origin);
  }
  // the hour and spot, at most once a frame (a drag along the week sends one per step it crosses)
  function syncMap() {
    if (map.status !== 'ready' || map.raf) return;
    map.raf = requestAnimationFrame(function () {
      map.raf = 0;
      var i = curStep(), t = i >= 0 ? fc.steps[i].t : Date.now(), key = t + spot;
      if (map.sent === key) return;
      map.sent = key;
      post({ type: 'lcc-fc', time: t, spot: spot });
    });
  }
  function setZoom(z) {
    if (!ZOOMS[z]) return;
    map.zoom = z;
    try { localStorage.setItem('lcc-f-zoom', z); } catch (_) { /* private mode */ }
    renderZoom();
    if (map.status === 'ready') post({ type: 'lcc-fc', zoom: z });
  }
  function renderZoom() {
    [E.zseg, E.dz].forEach(function (el) {
      el.querySelectorAll('button[data-zoom]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-zoom') === map.zoom)); });
    });
  }
  function onFrameMessage(ev) {
    if (ev.origin !== location.origin || !E.frame || ev.source !== E.frame.contentWindow || !ev.data) return;
    var d = ev.data;
    if (d.type === 'lcc-fc-ready') {
      map.status = 'ready'; map.sent = null; map.inset = null;
      post({ type: 'lcc-fc', zoom: map.zoom });
      post({ type: 'lcc-fc-fullstate', on: full.on });
      syncMap();
      run('inset', sendInset);
    } else if (d.type === 'lcc-fc-full') {
      // the map's full-screen button (or Escape inside the map, on: false): the tab's own full screen
      if (full.on || d.on === false) exitFull(); else setFull(true);
    } else if (d.type === 'lcc-fc-failed') {
      map.status = 'failed';
    } else if (d.type === 'lcc-open-3d') {
      // the map's "3D" button: the sea floor in 3D, on the Explore tab, at this spot and hour
      C.emit('x-open-3d', { spot: d.spot === 'wild' ? 'wild' : 'choc', time: d.time || null });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // LAYOUT: phone, wide (timeline on the map), full screen
  // ════════════════════════════════════════════════════════════════════
  function layout() { return full.on ? 'full' : wideMQ && wideMQ.matches ? 'wide' : 'phone'; }
  // The map's ⤢ button opens the tab's own full screen: the map fills the window, the hour's card over its top-left,
  // the week docked along the bottom. One history entry, so Back and the iPhone's back swipe close it, as a sub-page.
  function setFull(on) {
    on = !!on;
    if (on === full.on || !E.f) return;
    full.on = on;
    if (on) {
      full.scroll = window.scrollY || 0;
      try { history.pushState({ clFull: 1 }, ''); full.pushed = true; } catch (_) { full.pushed = false; }
    }
    E.f.classList.toggle('cl-f-full', on);
    document.documentElement.classList.toggle('cl-f-lock', on);
    E.dz.hidden = !on;
    headMin.key = '';
    if (!on) window.scrollTo(0, full.scroll);
    post({ type: 'lcc-fc-fullstate', on: on });
    render('full');
  }
  function exitFull() {
    if (!full.on) return;
    var st = null;
    try { st = history.state; } catch (_) { st = null; }
    if (full.pushed && st && st.clFull) { try { history.back(); return; } catch (_) { /* fall through */ } }
    full.pushed = false;
    setFull(false);
  }
  // What covers the map's edges (the zoom and spot over its top on a wide screen, the week docked along its
  // bottom): the map lifts its colour key and drops its layers panel clear of them (research/methods-theme.js).
  function sendInset() {
    if (map.status !== 'ready') return;
    var lay = layout(), top = 0, bot = 0;
    if (lay !== 'phone') {
      var fr = E.frame.getBoundingClientRect();
      if (!fr.height) return;                // the tab isn't on screen: sent when it shows
      if (lay === 'wide') top = Math.max(0, Math.round(E.mbar.getBoundingClientRect().bottom - fr.top));
      var wb = E.wk.getBoundingClientRect();
      if (!E.wk.hidden && wb.height) bot = Math.max(0, Math.round(fr.bottom - wb.top));
    }
    var key = top + '|' + bot;
    if (map.inset === key) return;
    map.inset = key;
    post({ type: 'lcc-fc-inset', top: top, bottom: bot });
  }

  // ════════════════════════════════════════════════════════════════════
  // WEEK SCRUBBER
  // ════════════════════════════════════════════════════════════════════
  function setView(v) {
    if (!VIEWS[v] || v === view) return;
    view = v;
    try { localStorage.setItem('lcc-f-chart', v); } catch (_) { /* private mode */ }
    renderView();
    run('chart', renderChart);
    run('inset', sendInset);
  }
  function renderView() {
    E.vseg.querySelectorAll('button[data-view]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === view)); });
  }
  // The Swells view at one step: the spot's height (the models' mean) split by where its swell comes from, each
  // family's share of the energy reaching the spot times the mean, so the stack's top is the mean. An hour whose
  // swells reach nothing (or that has none) is all "other"; no mean, no stack (null).
  function stackAt(s) {
    var m = s[SPOTS[spot].k].m;
    if (!isNum(m)) return null;
    var v = [0, 0, 0, 0], ps = parts(s, spot), tot = ps.reduce(function (a, p) { return a + p.share; }, 0);
    if (!ps.length || !(tot > 0)) v[3] = m;
    else ps.forEach(function (p) { v[fam(p.t.D)] += p.share / tot * m; });
    return v;
  }
  function stackPaths(S, x, y) {
    var o = '', segs = [], seg = [];
    S.forEach(function (s) { var v = stackAt(s); if (v) seg.push({ t: s.t, v: v }); else if (seg.length) { segs.push(seg); seg = []; } });
    if (seg.length) segs.push(seg);
    segs.forEach(function (q) {
      if (q.length < 2) return;
      var below = q.map(function () { return 0; });
      STACK.forEach(function (f) {
        var top = q.map(function (p, k) { return below[k] + p.v[f]; });
        if (q.some(function (p) { return p.v[f] > 0; })) {
          var lo = below;
          o += '<path class="cl-f-sb" data-fam="' + FAM[f].name + '" style="fill:' + rgb(FAM[f].rgb) + '" d="M' +
            q.map(function (p, k) { return x(p.t).toFixed(1) + ',' + y(top[k]).toFixed(1); }).join('L') + 'L' +
            q.map(function (p, k) { return x(p.t).toFixed(1) + ',' + y(lo[k]).toFixed(1); }).reverse().join('L') + 'Z"/>';
        }
        below = top;
      });
    });
    return o;
  }
  function legendHTML() {
    var sw = function (cls, style) { return '<i class="cl-f-sw ' + cls + '"' + (style ? ' style="' + style + '"' : '') + '></i>'; };
    if (view === 'swells') {
      return STACK.map(function (f) { return '<span>' + sw('cl-f-sw-a', 'background:' + rgb(FAM[f].rgb)) + esc(STACK_NAME[f]) + '</span>'; }).join('') +
        '<span>' + sw('cl-f-sw-m') + 'mean</span>';
    }
    return '<span>' + sw('cl-f-sw-g') + 'GFS-Wave</span><span>' + sw('cl-f-sw-e') + 'ECMWF</span><span>' + sw('cl-f-sw-m') + 'mean</span>';
  }
  function renderChart() {
    if (!fc.steps) { setHTML(E.cx, ''); E.wk.hidden = true; return; }
    E.wk.hidden = false;
    // The chart's own width: inside the box's side padding, where the finger is read too.
    var cs = getComputedStyle(E.cx), lay = layout();
    // (a hidden tab measures 0, less its padding: a phone's width until it shows)
    var S = fc.steps, W = E.cx.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), sp = SPOTS[spot];
    if (!(W > 0)) W = 358;
    var wide = W >= 560;
    // On the phone the week has room; docked over the map (wide) and in full screen it stays low over the map.
    var wideScr = !!(wideMQ && wideMQ.matches);
    var PL = 30, PR = 8, PT = 10;
    // (a phone held sideways in full screen: lower still, so the map keeps most of the window)
    var CH = lay === 'phone' ? (wide ? 170 : 140) : lay === 'wide' ? 104 : wideScr ? 112 : window.innerHeight < 500 ? 46 : 70;
    var LT = lay === 'phone' ? 20 : wideScr ? 14 : 12, LW = lay === 'phone' ? 16 : 13;
    var t0 = S[0].t, t1 = S[S.length - 1].t;
    var yT = PT + CH + 18, yW = yT + LT + 12, HH = yW + LW / 2 + 6;
    var x = function (t) { return PL + (t - t0) / (t1 - t0) * (W - PL - PR); };
    var vmax = 0;
    S.forEach(function (s) { [s[sp.k].g, s[sp.k].e].forEach(function (v) { if (isNum(v) && v > vmax) vmax = v; }); });
    var stepFt = vmax > 6 ? 2 : 1, ymax = Math.max(2, Math.ceil((vmax + 0.3) / stepFt) * stepFt);
    var y = function (v) { return PT + CH - v / ymax * CH; };
    var o = '<svg width="' + W + '" height="' + HH + '" viewBox="0 0 ' + W + ' ' + HH + '" aria-hidden="true">';
    // nights and the past
    for (var d = U.startOfDay(new Date(t0)).getTime() - DAY; d < t1 + DAY; d += DAY) {
      var sa = D.sun(new Date(d + 12 * HOUR)), sb = D.sun(new Date(d + 36 * HOUR));
      if (!sa || !sb || !sa.sunset || !sb.sunrise) continue;
      var a = Math.max(t0, sa.sunset.getTime()), b = Math.min(t1, sb.sunrise.getTime());
      if (b > a) o += '<rect class="cl-f-night" x="' + x(a).toFixed(1) + '" y="' + PT + '" width="' + (x(b) - x(a)).toFixed(1) + '" height="' + CH + '"/>';
    }
    var nowT = Date.now();
    if (nowT > t0) o += '<rect class="cl-f-past" x="' + PL + '" y="' + PT + '" width="' + (Math.min(x(nowT), W - PR) - PL).toFixed(1) + '" height="' + CH + '"/>';
    // a low chart (full screen, sideways) labels every other line, and "ft" only where it has room
    var labEvery = Math.max(1, Math.ceil(13 / (CH * stepFt / ymax)));
    for (var v = stepFt, n = 1; v < ymax; v += stepFt, n++) {
      o += '<line class="cl-f-grid" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        (n % labEvery ? '' : '<text class="cl-f-ax" x="' + (PL - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + '</text>');
    }
    if (CH >= 60) o += '<text class="cl-f-ax" x="' + (PL - 6) + '" y="' + (PT + 7) + '" text-anchor="end">ft</text>';
    // days
    for (d = U.startOfDay(new Date(t0)).getTime(); d <= t1; d += DAY) {
      if (d > t0) o += '<line class="cl-f-day" x1="' + x(d).toFixed(1) + '" x2="' + x(d).toFixed(1) + '" y1="' + PT + '" y2="' + (PT + CH) + '"/>';
      var mid = Math.max(t0, d) + (Math.min(t1, d + DAY) - Math.max(t0, d)) / 2;
      if (Math.min(t1, d + DAY) - Math.max(t0, d) >= 8 * HOUR) o += '<text class="cl-f-dl" x="' + x(mid).toFixed(1) + '" y="' + (PT + CH + 13) + '" text-anchor="middle">' + esc(F.day(new Date(mid))) + '</text>';
    }
    if (view === 'swells') {
      // where the swell comes from, stacked; the mean on top
      o += stackPaths(S, x, y);
    } else {
      // the two models: band between them, their mean bold, each thin
      var both = S.filter(function (s) { return isNum(s[sp.k].g) && isNum(s[sp.k].e); });
      if (both.length > 1) {
        o += '<path class="cl-f-band" d="M' + both.map(function (s) { return x(s.t).toFixed(1) + ',' + y(Math.max(s[sp.k].g, s[sp.k].e)).toFixed(1); }).join('L') +
          'L' + both.slice().reverse().map(function (s) { return x(s.t).toFixed(1) + ',' + y(Math.min(s[sp.k].g, s[sp.k].e)).toFixed(1); }).join('L') + 'Z"/>';
      }
      o += line(S, function (s) { return s[sp.k].g; }, 'cl-f-gfs', x, y);
      o += line(S, function (s) { return s[sp.k].e; }, 'cl-f-ec', x, y);
    }
    o += line(S, function (s) { return s[sp.k].m; }, 'cl-f-mean', x, y);
    if (nowT >= t0 && nowT <= t1) o += '<line class="cl-f-nowl" x1="' + x(nowT).toFixed(1) + '" x2="' + x(nowT).toFixed(1) + '" y1="' + PT + '" y2="' + (PT + CH) + '"/>';
    // tide lane
    var tc = D.tideCurve().filter(function (p, k) { return k % 3 === 0 && p.t.getTime() >= t0 && p.t.getTime() <= t1 && isNum(p.h); });
    if (tc.length > 1) {
      var hs = tc.map(function (p) { return p.h; }), lo = Math.min.apply(null, hs), hi = Math.max.apply(null, hs);
      var ty = function (hh) { return yT + LT - (hh - lo) / ((hi - lo) || 1) * LT; };
      o += '<path class="cl-f-tide" d="M' + tc.map(function (p) { return x(p.t.getTime()).toFixed(1) + ',' + ty(p.h).toFixed(1); }).join('L') + '"/>';
      D.tideEvents().forEach(function (e) {
        var te = e.t.getTime(); if (e.type !== 'L' || te < tc[0].t.getTime() || te > tc[tc.length - 1].t.getTime() || !isNum(e.h)) return;
        o += '<circle class="cl-f-low" cx="' + x(te).toFixed(1) + '" cy="' + ty(Math.max(lo, e.h)).toFixed(1) + '" r="2.2"/>';
      });
    }
    o += '<text class="cl-f-ax" x="' + (PL - 6) + '" y="' + (yT + LT / 2 + 3) + '" text-anchor="end">tide</text>';
    // wind lane: arrows where the wind blows to, coloured by what it does at Choc
    var every = wide ? 3 * HOUR : 6 * HOUR, arrow = (I.paths && I.paths.chartArrow) || 'M0 3.5V-3.5M-3 -0.5L0 -3.5L3 -0.5';
    for (var t = Math.ceil(t0 / every) * every; t <= t1; t += every) {
      var wd = D.windAt(new Date(t)); if (!wd || !isNum(wd.dir)) continue;
      o += '<path class="cl-f-wa ' + U.qualityClass(wd.quality) + '" d="' + arrow + '" transform="translate(' + x(t).toFixed(1) + ',' + yW + ') rotate(' + Math.round(wd.dir + 180) + ') scale(1.15)"/>';
    }
    o += '<text class="cl-f-ax" x="' + (PL - 6) + '" y="' + (yW + 3) + '" text-anchor="end">wind</text>';
    o += '<g class="cl-f-cur"></g></svg>';
    geom = { x: x, y: y, t0: t0, t1: t1, PL: PL, PR: PR, W: W, PT: PT, HH: HH };
    var key = o;
    if (E.cx.__key !== key) { E.cx.innerHTML = o; E.cx.__key = key; }
    E.cx.setAttribute('aria-valuemax', String(S.length - 1));
    setHTML(E.lgd, legendHTML());
    E.cxd.textContent = view === 'swells'
      ? 'Chart: ' + sp.name + '’s height over the week (the two models’ mean), split by where its swell comes from: southeast, east, south and other, stacked, each as thick as its share of the energy. Tide and wind underneath.'
      : 'Chart: ' + sp.name + '’s height over the week, GFS-Wave solid orange, ECMWF dashed blue, the band between them, their mean in bold. Tide and wind underneath.';
    E.wk.setAttribute('data-view', view);
    drawCursor();
  }
  function line(S, f, cls, x, y) {
    var segs = [], seg = [];
    S.forEach(function (s) { var v = f(s); if (isNum(v)) seg.push(x(s.t).toFixed(1) + ',' + y(v).toFixed(1)); else if (seg.length) { segs.push(seg); seg = []; } });
    if (seg.length) segs.push(seg);
    return segs.filter(function (q) { return q.length > 1; }).map(function (q) { return '<path class="' + cls + '" d="M' + q.join('L') + '"/>'; }).join('');
  }
  function drawCursor() {
    var g = E.cx.querySelector('.cl-f-cur'); if (!g || !geom) return;
    var i = curStep();
    if (i < 0) { g.innerHTML = ''; E.cx.setAttribute('aria-valuetext', 'No forecast for now'); return; }
    var s = fc.steps[i], v = s[SPOTS[spot].k].m, X = geom.x(s.t).toFixed(1);
    g.innerHTML = '<line x1="' + X + '" x2="' + X + '" y1="' + (geom.PT - 4) + '" y2="' + (geom.HH - 2) + '"/>' +
      (isNum(v) ? '<circle cx="' + X + '" cy="' + geom.y(v).toFixed(1) + '" r="4.5"/>' : '');
    E.cx.setAttribute('aria-valuenow', String(i));
    E.cx.setAttribute('aria-valuetext', hourLabel(new Date(s.t)) + ', ' + (isNum(v) ? F.ft(v) : 'no height') + ' at ' + SPOTS[spot].name);
  }
  function setStep(i, now) {
    if (!fc.steps) return;
    var n = nowStep();
    if (now || i === n && n >= 0) cur = { mode: 'now', i: -1 };
    else cur = { mode: 'pick', i: Math.max(0, Math.min(fc.steps.length - 1, i)) };
    run('head', renderHead); run('cursor', drawCursor); run('map', syncMap); run('cond', renderCond);
  }
  function stepAtX(clientX) {
    // Measured from the chart itself, not its padded box.
    var r = (E.cx.querySelector('svg') || E.cx).getBoundingClientRect();
    var t = geom.t0 + (clientX - r.left - geom.PL) / (geom.W - geom.PL - geom.PR) * (geom.t1 - geom.t0), b = 0;
    fc.steps.forEach(function (s, k) { if (Math.abs(s.t - t) < Math.abs(fc.steps[b].t - t)) b = k; });
    return b;
  }
  function onDown(ev) {
    if (!fc.steps || !geom) return;
    stopPlay();
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, horiz: ev.pointerType === 'mouse' };
    if (drag.horiz) { try { E.cx.setPointerCapture(ev.pointerId); } catch (_) { /* fine */ } setStep(stepAtX(ev.clientX)); }
  }
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.horiz) {
      // touch: a mostly sideways start scrubs; a vertical one scrolls the page
      var dx = Math.abs(ev.clientX - drag.x), dy = Math.abs(ev.clientY - drag.y);
      if (dx < 6 && dy < 6) return;
      if (dy > dx) { drag = null; return; }
      drag.horiz = true; try { E.cx.setPointerCapture(ev.pointerId); } catch (_) { /* fine */ }
    }
    drag.moved = true;
    setStep(stepAtX(ev.clientX));
  }
  function onUp(ev) {
    if (drag && ev.type === 'pointerup' && !drag.moved && ev.pointerType !== 'mouse') setStep(stepAtX(ev.clientX));
    drag = null;
  }
  function onKey(ev) {
    if (!fc.steps) return;
    var i = curStep(); if (i < 0) i = 0;
    var k = ev.key, n = fc.steps.length - 1, j = null;
    if (k === 'ArrowLeft' || k === 'ArrowDown') j = i - 1;
    else if (k === 'ArrowRight' || k === 'ArrowUp') j = i + 1;
    else if (k === 'PageDown') j = dayFrom(i, -1);
    else if (k === 'PageUp') j = dayFrom(i, 1);
    else if (k === 'Home') j = 0;
    else if (k === 'End') j = n;
    if (j == null) return;
    ev.preventDefault();
    stopPlay();
    setStep(Math.max(0, Math.min(n, j)));
  }
  // The step nearest a day later (or earlier): runs step every 3 h early on and every 6 h later.
  function dayFrom(i, dir) {
    var t = fc.steps[i].t + dir * DAY, b = i;
    fc.steps.forEach(function (s, k) { if (Math.abs(s.t - t) < Math.abs(fc.steps[b].t - t)) b = k; });
    return b;
  }
  function stopPlay() {
    if (!play.timer) return;
    clearInterval(play.timer); play.timer = 0;
    E.play.setAttribute('aria-pressed', 'false'); E.play.setAttribute('aria-label', 'Play the week'); E.play.firstChild.textContent = '▶';
  }
  function startPlay() {
    if (!fc.steps) return;
    var i = curStep(); if (i < 0 || i >= fc.steps.length - 1) i = 0;
    setStep(i);
    E.play.setAttribute('aria-pressed', 'true'); E.play.setAttribute('aria-label', 'Pause'); E.play.firstChild.textContent = '❚❚';
    play.timer = setInterval(C.guard('forecast.play', function () {
      if (document.hidden || !E.map.clientWidth) { stopPlay(); return; }   // the tab or the page was put away
      var k = curStep();
      if (k < 0 || k >= fc.steps.length - 1) { stopPlay(); return; }
      setStep(k + 1);
    }), U.reducedMotion() ? 1400 : 700);
  }
  function onJump(ev) {
    var b = ev.target.closest('button[data-j]'); if (!b || !fc.steps) return;
    var j = b.getAttribute('data-j');
    if (j === 'play') { if (play.timer) stopPlay(); else startPlay(); return; }
    stopPlay();
    if (j === 'now') { setStep(-1, true); return; }
    var i = curStep(); if (i < 0) i = 0;
    var k = j === 'day' ? dayFrom(i, 1) : j === '-day' ? dayFrom(i, -1) : i + Number(j);
    setStep(Math.max(0, Math.min(fc.steps.length - 1, k)));
  }

  // ════════════════════════════════════════════════════════════════════
  // WIND AND TIDE AT THE HOUR
  // ════════════════════════════════════════════════════════════════════
  function renderCond() {
    var i = curStep(), t = i >= 0 ? new Date(fc.steps[i].t) : new Date();
    var w = D.windAt(t), td = D.tideAt(t), h = '';
    h += '<p><span class="cl-lab">Wind</span> ' + (w && isNum(w.mph)
      ? esc(F.wind(w.mph, w.dir)) + (w.quality ? ', ' + C.html.quality(w.quality, 'long') : '') + (isNum(w.gust) ? ' · gusts ' + Math.round(w.gust) : '')
      : DASH) + '</p>';
    var next = D.tideEvents().filter(function (e) { return e.t.getTime() > t.getTime(); })[0];
    h += '<p><span class="cl-lab">Tide</span> ' + (td && isNum(td.h) ? esc(F.tide(td.h, td.rising)) : DASH) +
      (next ? ' · ' + (next.type === 'L' ? 'low ' : 'high ') + esc(F.time(next.t)) + (U.dayKey(next.t) !== U.dayKey(t) ? ' ' + esc(F.day(next.t)) : '') : '') + '</p>';
    setHTML(E.cond, h);
  }

  // ════════════════════════════════════════════════════════════════════
  // BUOY CHECK: the latest reading against the forecasts made before
  // ════════════════════════════════════════════════════════════════════
  function loadPrevRuns() {
    if (prev.status === 'loading') return;
    prev.status = 'loading'; prev.at = Date.now();
    var b = fc.buoy || BUOY_LL;
    var url = PREV + '?latitude=' + b[0] + '&longitude=' + b[1] +
      '&hourly=wave_height,wave_height_previous_day1,wave_height_previous_day2,wave_height_previous_day3&past_days=3&forecast_days=1&timezone=GMT';
    getJSON(url).then(function (d) {
      var hr = d && d.hourly;
      if (!hr || !Array.isArray(hr.time)) { prev.status = 'failed'; prev.data = null; render('prev'); return; }
      var rows = {};
      hr.time.forEach(function (ts, k) {
        var t = Date.parse(ts + 'Z'); if (!isNum(t)) return;
        var f = function (n) { var v = hr['wave_height_previous_day' + n] && hr['wave_height_previous_day' + n][k]; return isNum(v) ? v * M2FT : null; };
        rows[t] = { t: t, d1: f(1), d2: f(2), d3: f(3) };
      });
      prev.data = rows; prev.status = 'ok';
      render('prev');
    });
  }
  function prevAt(t) { if (!prev.data || !isNum(t)) return null; return prev.data[Math.round(t / HOUR) * HOUR] || null; }
  // How the earlier forecasts did against a reading: within max(0.5 ft, 15 %) is on track.
  function verdict(b, fs) {
    var v = fs.filter(isNum); if (!isNum(b) || !v.length) return null;
    var tol = Math.max(0.5, 0.15 * b), d = v.map(function (f) { return f - b; });
    if (d.every(function (x) { return Math.abs(x) <= tol; })) return { cls: 'ok', txt: 'forecasts on track' };
    if (d.every(function (x) { return x > tol; })) return { cls: 'off', txt: 'forecasts ran high' };
    if (d.every(function (x) { return x < -tol; })) return { cls: 'off', txt: 'forecasts ran low' };
    return { cls: 'off', txt: 'forecasts mixed' };
  }
  function renderBuoyLine() {
    var b = D.buoy(), h;
    if (!b || !isNum(b.total)) {
      h = '<span class="cl-f-bc1"><b>Buoy 44097</b> no reading</span>';
    } else {
      var at = b.obsAt ? b.obsAt.getTime() : null, p = prevAt(at), v = p ? verdict(b.total, [p.d1, p.d2, p.d3]) : null;
      var age = b.level === 'stale' ? ' cl-stale' : b.level === 'dead' ? ' cl-dead' : '';
      h = '<span class="cl-f-bc1"><b>Buoy 44097</b> ' + esc(F.ft(b.total)) + ' <span class="cl-muted">all waves</span> · <span class="' + age.trim() + '">' + (b.obsAt ? esc(F.when(b.obsAt)) : DASH) + '</span>' +
        (v ? '<span class="cl-f-chip cl-f-chip-' + v.cls + '">' + esc(v.txt) + '</span>' : '') + '</span>';
      h += '<span class="cl-fine cl-f-bc2">' + (p
        ? 'Forecast for ' + esc(F.time(new Date(Math.round(at / HOUR) * HOUR)).replace(':00' + NB, NB)) + ', made 1 · 2 · 3 days before: ' + [p.d1, p.d2, p.d3].map(function (x) { return isNum(x) ? F.num(x) : DASH; }).join(' · ') + NB + 'ft'
        : prev.status === 'loading' || prev.status === 'idle' ? 'Loading the earlier forecasts…' : 'The earlier forecasts didn’t load') + '</span>';
    }
    setHTML(E.bc, h + '<span class="cl-f-bcc" aria-hidden="true">' + I.chevronRight(18) + '</span>');
  }
  function loadVerif() {
    if (verif.status === 'loading' || verif.status === 'ok' && Date.now() - verif.at < HOUR) return;
    verif.status = 'loading'; verif.at = Date.now();
    getJSON(VERIF).then(function (d) {
      verif.rows = d && Array.isArray(d.rows) ? d.rows.map(function (r) { return { t: Date.parse(r.t), hs: r.buoy && isNum(r.buoy.hs) ? r.buoy.hs : null }; }).filter(function (r) { return isNum(r.t) && isNum(r.hs); }) : null;
      verif.status = verif.rows ? 'ok' : 'failed';
      if (sheet) run('sheet', function () { renderSheet(sheet.body); });
    });
  }
  function openBuoyCheck() {
    loadVerif();
    if (prev.status === 'failed') loadPrevRuns();
    sheet = C.sub.open({
      id: 'buoycheck',
      title: 'Buoy vs earlier forecasts',
      mount: function (body) { body.classList.add('cl-f-sheet'); renderSheet(body); },
      onClose: function () { sheet = null; }
    });
  }
  function renderSheet(body) {
    var now = Date.now(), t0 = now - 48 * HOUR, t1 = now + HOUR;
    var obs = (verif.rows || []).filter(function (r) { return r.t >= t0 && r.t <= t1; });
    var b = D.buoy();
    if (b && isNum(b.total) && b.obsAt && (!obs.length || b.obsAt.getTime() > obs[obs.length - 1].t + 30 * 60e3)) obs.push({ t: b.obsAt.getTime(), hs: b.total });
    var fs = prev.data ? Object.keys(prev.data).map(function (k) { return prev.data[k]; }).filter(function (r) { return r.t >= t0 && r.t <= t1; }).sort(function (a, c) { return a.t - c.t; }) : [];
    var W = Math.min(640, (body.clientWidth || 358)) - 32, H = 190, PL = 28, PR = 6, PT = 8, CH = H - 30;
    var vals = obs.map(function (r) { return r.hs; });
    fs.forEach(function (r) { [r.d1, r.d2, r.d3].forEach(function (v) { if (isNum(v)) vals.push(v); }); });
    var vmax = vals.length ? Math.max.apply(null, vals) : 4, stp = vmax > 8 ? 2 : 1, ymax = Math.ceil((vmax + 0.4) / stp) * stp;
    var x = function (t) { return PL + (t - t0) / (t1 - t0) * (W - PL - PR); }, y = function (v) { return PT + CH - v / ymax * CH; };
    var o = '<svg class="cl-f-bcx" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Buoy readings and the forecasts made 1, 2 and 3 days before, last two days">';
    for (var v = stp; v < ymax; v += stp) o += '<line class="cl-f-grid" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="cl-f-ax" x="' + (PL - 5) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    for (var d = U.startOfDay(new Date(t0)).getTime(); d <= t1; d += DAY) {
      if (d > t0) o += '<line class="cl-f-day" x1="' + x(d).toFixed(1) + '" x2="' + x(d).toFixed(1) + '" y1="' + PT + '" y2="' + (PT + CH) + '"/>';
      var mid = Math.max(t0, d) + (Math.min(t1, d + DAY) - Math.max(t0, d)) / 2;
      if (Math.min(t1, d + DAY) - Math.max(t0, d) > 6 * HOUR) o += '<text class="cl-f-dl" x="' + x(mid).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(F.day(new Date(mid))) + '</text>';
    }
    [['d3', 'cl-f-l3'], ['d2', 'cl-f-l2'], ['d1', 'cl-f-l1']].forEach(function (q) { o += line(fs, function (r) { return r[q[0]]; }, q[1], function (t) { return x(t); }, y); });
    obs.forEach(function (r) { o += '<circle class="cl-f-obs" cx="' + x(r.t).toFixed(1) + '" cy="' + y(r.hs).toFixed(1) + '" r="2.4"/>'; });
    o += '</svg>';
    // how each lead did over the two days, hour by hour where both exist
    var stats = [1, 2, 3].map(function (n) {
      var e = [], rel = [];
      obs.forEach(function (r) { var p = prevAt(r.t); var f = p && p['d' + n]; if (isNum(f)) { e.push(f - r.hs); if (r.hs > 0.3) rel.push((f - r.hs) / r.hs); } });
      if (!e.length) return null;
      var m = e.reduce(function (a, c) { return a + c; }, 0) / e.length, mr = rel.length ? rel.reduce(function (a, c) { return a + c; }, 0) / rel.length : null;
      return { n: n, m: m, mr: mr, k: e.length };
    });
    var h = '<p class="cl-pad cl-f-sl">What buoy 44097 measured (dots: all waves, swell and wind chop) against the wave forecast for the same spot, made 1, 2 and 3 days before each hour (lines). When the lines have been tracking the dots, trust this week’s forecast more.</p>';
    h += '<div class="cl-pad">' + (obs.length || fs.length ? o : '<p class="cl-muted">' + (verif.status === 'loading' || prev.status === 'loading' ? 'Loading…' : 'No buoy readings or earlier forecasts for the last two days') + '</p>') + '</div>';
    h += '<p class="cl-pad cl-f-lg"><span class="cl-f-k cl-f-k-obs">● buoy</span><span class="cl-f-k cl-f-k1">— 1 day before</span><span class="cl-f-k cl-f-k2">- - 2 days</span><span class="cl-f-k cl-f-k3">··· 3 days</span></p>';
    h += '<div class="cl-list">' + stats.map(function (st, k) {
      var lab = (k + 1) + ' day' + (k ? 's' : '') + ' before';
      if (!st) return '<div class="cl-sr"><span>' + lab + '</span><span class="cl-v">' + DASH + '</span></div>';
      var sgn = st.m >= 0 ? '+' : '−', pct = isNum(st.mr) ? ' (' + Math.abs(Math.round(st.mr * 100)) + '%' + NB + (st.mr >= 0 ? 'high' : 'low') + ')' : '';
      return '<div class="cl-sr"><span>' + lab + '<small>' + st.k + ' hours compared</small></span><span class="cl-v">' + sgn + F.num(Math.abs(st.m)) + NB + 'ft' + pct + '</span></div>';
    }).join('') + '</div>';
    h += '<p class="cl-pad cl-fine cl-f-sn">Forecasts: Open-Meteo’s wave model at the buoy, as it stood 1, 2 and 3 days earlier. The Sound Check’s own GFS-Wave and ECMWF runs aren’t archived yet. The buoy reports heights in 0.3' + NB + 'ft steps.' +
      (b && b.reachesAt ? ' The latest reading’s swell reaches Choc about ' + esc(F.time(b.reachesAt)) + '.' : '') + '</p>';
    setHTML(body, h);
  }

  // ════════════════════════════════════════════════════════════════════
  // SOURCE LINE
  // ════════════════════════════════════════════════════════════════════
  function renderSource() {
    var h = 'Sound Check model: GFS-Wave and ECMWF read at buoy 44097 and carried over the sea floor';
    if (fc.made) {
      var age = madeAge(), cls = age > 2 * DAY ? 'cl-dead' : age > 12 * HOUR ? 'cl-stale' : '';
      h += ' · <span class="' + cls + '">run ' + esc(F.when(new Date(Date.parse(fc.made)))) + ' (' + esc(F.age(new Date(Date.parse(fc.made)))) + ')</span>';
    }
    h += ' · <a href="#methods">How it works</a>';
    setHTML(E.src, h);
  }

  // Read-only state for tests and debugging. The map's own state is its page's (window.CHOC.trip in the frame).
  C.forecastInfo = function () {
    var i = curStep();
    return { fc: fc.status, made: fc.made, step: i, t: i >= 0 ? fc.steps[i].t : null, mode: cur.mode, spot: spot,
      prev: prev.status, verif: verif.status, playing: !!play.timer, map: { status: map.status, zoom: map.zoom },
      view: view, full: full.on, layout: layout() };
  };

  C.register('forecast', {
    mount: mount,
    render: function (reason) { render(reason); },
    onShow: function () { loadMap(); render('show'); },
    onTheme: function () { if (map.status !== 'idle') post({ type: 'lcc-theme', theme: theme() }); }
  });
})();
