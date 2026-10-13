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
//   • Ray map: those swells' rays bending over the bottom into the spot
//     (research/fr/land.json over research/fr_world.jpg), thicker for a
//     bigger share; the buoy and the spot pinned. "Storms" turns it into
//     the North Atlantic at the same hour: GFS-Wave's wave height, GFS's
//     sea-level pressure every 4 hPa, the lows and highs, and each storm's
//     track over the run (field_gfs_ocean.png, field_gfs_mslp.png).
//   • Week scrubber: the spot's height for the run's 7 days (both models'
//     mean, the GFS-to-ECMWF band, each model), nights shaded, the tide
//     and the wind (blue when offshore at Choc) underneath. Drag, arrow
//     keys, the jump buttons or play; "Now" follows the clock.
//   • Wind and tide at that hour, then the buoy check: buoy 44097's
//     latest reading against the forecasts made 1, 2 and 3 days before
//     for that hour (Open-Meteo's earlier runs at the buoy); tap for the
//     last two days.
// The model forecast is research/fc/fc.json or the bot's newer pull on
// the fc-data branch, whichever is newer. When neither covers the hour
// the tab says so instead of showing an old number as now. Missing data
// stays null and shows "—". Times are the spot's (America/New_York).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.CLEAN || typeof CLEAN.register !== 'function') return;

  var C = window.CLEAN, D = C.data, F = C.fmt, U = C.util, I = C.icon;
  var NB = F.NB, DASH = F.DASH, esc = U.esc, isNum = U.isNum;
  var HOUR = 3600e3, DAY = 864e5, M2FT = 3.28084;
  var FC_SHIP = 'research/fc/fc.json';
  var FC_LIVE = 'https://raw.githubusercontent.com/TheKeeks/LetsCheckChoc/fc-data/fc/fc.json';
  var LAND = 'research/fr/land.json', BACKDROP = 'research/fr_world.jpg';
  // The storm view: the Sound Check map's North Atlantic backdrop and land mask (lon/lat rasters, ocean_meta.json)
  var OCEAN_BG = 'research/ocean/ocean_bg.jpg', OCEAN_LAND = 'research/ocean/ocean_land.png', OCEAN_META = 'research/ocean/ocean_meta.json';
  var CHOC_LL = [41.27591, -71.96359];
  // wave-height colours (ft), the Sound Check map's (research HST): most of the change at surfable sizes
  var HST = [[0, [16, 42, 74]], [1, [30, 100, 160]], [2, [40, 170, 165]], [3.5, [120, 200, 100]], [5, [240, 210, 100]],
    [8, [240, 138, 75]], [13, [224, 71, 90]], [20, [176, 79, 201]], [28, [214, 128, 214]]];
  var VERIF = 'data/verification.json';
  var PREV = 'https://marine-api.open-meteo.com/v1/marine';
  var BUOY_LL = [40.969, -71.127];        // NDBC 44097 (fc.json carries it as fc.buoy)
  var PERIODS = [6, 8, 10, 12, 14, 16];   // the ray pictures' periods (s)
  var SPOTS = { choc: { k: 'choc', ray: 'c', name: 'Choc' }, wild: { k: 'wild', ray: 'w', name: 'Wilderness' } };
  // Where a swell comes from: one colour everywhere on the tab (rows, bars, rays).
  var FAM = [
    { name: 'E', rgb: [64, 190, 198] },      //  60-115°
    { name: 'SE', rgb: [240, 138, 75] },     // 115-160°
    { name: 'S', rgb: [170, 128, 236] },     // 160-205°
    { name: 'other', rgb: [140, 154, 168] }
  ];
  function fam(d) { return d >= 60 && d < 115 ? 0 : d >= 115 && d < 160 ? 1 : d >= 160 && d < 205 ? 2 : 3; }
  function rgb(c, a) { return a == null ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')'; }

  var root = null, E = {};
  var fc = { steps: null, made: null, runs: null, buoy: BUOY_LL, status: 'loading' };
  var land = { data: null, status: 'loading' };
  var backdrop = null;
  var spot = 'choc';
  var cur = { mode: 'now', i: -1 };       // 'now' follows the clock; 'pick' holds a picked step
  var geom = null, drag = null, rz = null;
  var prev = { status: 'idle', data: null, at: 0 };
  var verif = { status: 'idle', rows: null, at: 0 };
  var sheet = null;                       // the open buoy-check sub-page
  var drawn = { rays: 0, labels: [], note: '' };  // what the map last drew (CLEAN.forecastInfo, for tests)
  var view = 'choc';                      // the map: 'choc' (swell reaching the spot) | 'storms' (the North Atlantic)
  var storm = { status: 'idle', key: null, wave: null, hpa: null, bg: null, land: null, bounds: null, tracks: null, lows: null, drawn: null };
  var play = { timer: 0 };

  try { if (localStorage.getItem('lcc-f-spot') === 'wild') spot = 'wild'; } catch (_) { /* private mode */ }

  function err(where, e) { C.err('forecast.' + where, e); }
  function run(where, fn) { try { fn(); } catch (e) { err(where, e); } }
  function setHTML(el, html) { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } }
  function mean(a, b) { var v = [a, b].filter(isNum); return v.length ? v.reduce(function (x, y) { return x + y; }, 0) / v.length : null; }
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
  function useForecast(d, base) {
    if (!d || !d.gfs || !d.gfs.length) return false;
    if (fc.made && !(Date.parse(d.made) > Date.parse(fc.made))) return false;
    var ec = {};
    (d.ec || []).forEach(function (r) { ec[Math.round(Date.parse(r.t) / HOUR)] = r; });
    var steps = d.gfs.map(function (g) {
      var t = Date.parse(g.t), e = ec[Math.round(t / HOUR)] || null;
      return {
        t: t,
        choc: { g: isNum(g.choc) ? g.choc : null, e: e && isNum(e.choc) ? e.choc : null },
        wild: { g: isNum(g.wild) ? g.wild : null, e: e && isNum(e.wild) ? e.wild : null },
        trains: (g.trains || []).filter(function (x) { return isNum(x.ft) && isNum(x.T) && isNum(x.D); })
      };
    }).filter(function (s) { return isNum(s.t); });
    if (!steps.length) return false;
    steps.forEach(function (s) { s.choc.m = mean(s.choc.g, s.choc.e); s.wild.m = mean(s.wild.g, s.wild.e); });
    fc.steps = steps;
    fc.made = d.made || null;
    fc.runs = d.runs || null;
    fc.base = base;                       // its field images come from the same place
    fc.grid = d.grids && d.grids.ocean || null;
    fc.mslp = d.mslp && d.mslp.file ? d.mslp : null;
    if (d.buoy && isNum(d.buoy[0]) && isNum(d.buoy[1])) fc.buoy = d.buoy;
    fc.status = 'ok';
    return true;
  }
  function loadForecast() {
    var got = function (d, base) { if (!useForecast(d, base)) return; if (view === 'storms') loadStorms(); render('fc'); };
    getJSON(FC_SHIP).then(function (d) {
      got(d, FC_SHIP.replace(/fc\.json$/, ''));
      return getJSON(FC_LIVE);
    }).then(function (d) {
      got(d, FC_LIVE.replace(/fc\.json$/, ''));
      if (fc.status === 'loading') { fc.status = 'failed'; render('fc'); }
    });
  }
  // The step nearest the clock, when the run covers it; -1 when it doesn't.
  function nowStep() {
    var s = fc.steps; if (!s) return -1;
    var t = Date.now();
    if (t < s[0].t - 3 * HOUR || t > s[s.length - 1].t + 90 * 60e3) return -1;
    var b = 0;
    for (var i = 1; i < s.length; i++) if (Math.abs(s[i].t - t) < Math.abs(s[b].t - t)) b = i;
    return b;
  }
  function curStep() {
    if (!fc.steps) return -1;
    if (cur.mode === 'pick') return Math.max(0, Math.min(fc.steps.length - 1, cur.i));
    return nowStep();
  }
  // The swells at a step, each with its share of the energy reaching the spot.
  function parts(s, sp) {
    var k = SPOTS[sp].k;
    var tr = s.trains.filter(function (x) { return isNum(x[k]); });
    var e2 = tr.reduce(function (a, x) { return a + x[k] * x[k]; }, 0);
    return tr.map(function (x) { return { t: x, v: x[k], share: e2 > 0 ? x[k] * x[k] / e2 : 0 }; })
      .filter(function (p) { return p.share >= 0.005; })
      .sort(function (a, b) { return b.share - a.share; });
  }
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
            '<div class="cl-f-seg cl-f-vseg" role="group" aria-label="Map">' +
              '<button type="button" data-view="choc" aria-pressed="true">Swell at Choc</button><button type="button" data-view="storms" aria-pressed="false">Storms</button>' +
            '</div>' +
            '<div class="cl-f-seg cl-f-sseg" role="group" aria-label="Spot">' +
              '<button type="button" data-spot="choc">Choc</button><button type="button" data-spot="wild">Wilderness</button>' +
            '</div>' +
          '</div>' +
          '<div class="cl-f-stage">' +
            '<canvas aria-hidden="true"></canvas>' +
            '<p class="cl-f-mapnote" hidden></p>' +
          '</div>' +
          '<div class="cl-f-key" hidden>' +
            '<span class="cl-f-kh">Wave height</span>' +
            '<span class="cl-f-kb" aria-hidden="true"><i style="background:' + keyGradient() + '"></i><b style="left:0">0</b><b style="left:25%">5</b><b style="left:50%">10</b><b style="left:100%">20+' + NB + 'ft</b></span>' +
            '<span class="cl-f-kl">Lines: sea-level pressure every 4' + NB + 'hPa · <b class="cl-f-kL">L</b> low · <b class="cl-f-kH">H</b> high · white: each storm’s track, brighter ahead</span>' +
          '</div>' +
        '</div>' +
        '<div class="cl-f-wk">' +
          '<div class="cl-f-cx" tabindex="0" role="slider" aria-label="Forecast hour. Drag, or use the arrow keys" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>' +
          '<div class="cl-f-ctl">' +
            '<button type="button" class="cl-f-jb cl-f-play" data-j="play" aria-label="Play the week" aria-pressed="false"><span aria-hidden="true">▶</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="-day" aria-label="A day earlier">' + I.jumpsLeft(14) + '<span>day</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="-1" aria-label="Previous forecast step">' + I.jumpLeft(14) + '</button>' +
            '<button type="button" class="cl-f-jb" data-j="now" aria-label="Back to now"><span>Now</span></button>' +
            '<button type="button" class="cl-f-jb" data-j="1" aria-label="Next forecast step">' + I.jumpRight(14) + '</button>' +
            '<button type="button" class="cl-f-jb" data-j="day" aria-label="A day later"><span>day</span>' + I.jumpsRight(14) + '</button>' +
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
    E.cv = E.map.querySelector('canvas');
    E.seg = E.map.querySelector('.cl-f-sseg');
    E.vseg = E.map.querySelector('.cl-f-vseg');
    E.key = E.map.querySelector('.cl-f-key');
    E.play = el.querySelector('.cl-f-play');
    E.mapnote = E.map.querySelector('.cl-f-mapnote');
    E.wk = el.querySelector('.cl-f-wk');
    E.cx = el.querySelector('.cl-f-cx');
    E.ctl = el.querySelector('.cl-f-ctl');
    E.cond = el.querySelector('.cl-f-cond');
    E.bc = el.querySelector('.cl-f-bc');
    E.src = el.querySelector('.cl-f-src');

    E.seg.addEventListener('click', C.guard('forecast.spot', function (ev) {
      var b = ev.target.closest('button[data-spot]'); if (!b) return;
      spot = b.getAttribute('data-spot') === 'wild' ? 'wild' : 'choc';
      try { localStorage.setItem('lcc-f-spot', spot); } catch (_) { /* private mode */ }
      render('spot');
    }));
    E.vseg.addEventListener('click', C.guard('forecast.view', function (ev) {
      var b = ev.target.closest('button[data-view]'); if (!b) return;
      setView(b.getAttribute('data-view'));
    }));
    E.ctl.addEventListener('click', C.guard('forecast.jump', onJump));
    E.cx.addEventListener('pointerdown', C.guard('forecast.down', onDown));
    E.cx.addEventListener('pointermove', C.guard('forecast.move', onMove));
    E.cx.addEventListener('pointerup', C.guard('forecast.up', onUp));
    E.cx.addEventListener('pointercancel', C.guard('forecast.cancel', onUp));
    E.cx.addEventListener('keydown', C.guard('forecast.key', onKey));
    E.bc.addEventListener('click', C.guard('forecast.buoycheck', openBuoyCheck));
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(C.guard('forecast.resize', function () { renderChart(); drawMap(); }), 120);
    });
    C.on('tick', function () { render('tick'); });

    backdrop = new Image();
    backdrop.onload = function () { run('map', drawMap); };
    backdrop.src = BACKDROP;
    getJSON(LAND).then(function (d) {
      land.data = d && d.T && d.frame ? d : null;
      land.status = land.data ? 'ok' : 'failed';
      run('map', drawMap);
    });
    loadForecast();
    loadPrevRuns();
  }

  function render(reason) {
    if (!root) return;
    if (reason === 'tick' && Date.now() - prev.at > 3 * HOUR) loadPrevRuns();
    run('head', renderHead);
    run('chart', renderChart);
    run('map', drawMap);
    run('cond', renderCond);
    run('buoy', renderBuoyLine);
    run('src', renderSource);
    if (sheet) run('sheet', function () { renderSheet(sheet.body); });
  }

  // ════════════════════════════════════════════════════════════════════
  // HEADLINE AND SWELLS
  // ════════════════════════════════════════════════════════════════════
  function renderHead() {
    var sp = SPOTS[spot], i = curStep();
    if (i < 0) {
      var msg = fc.status === 'loading' ? 'Loading the Sound Check forecast…'
        : fc.status === 'failed' ? 'The Sound Check forecast didn’t load.'
        : 'The Sound Check forecast doesn’t reach now: its newest run is from ' + F.when(new Date(Date.parse(fc.made))) + '.';
      setHTML(E.head, '<p class="cl-f-msg">' + esc(msg) + '</p>');
      return;
    }
    var s = fc.steps[i], v = s[sp.k], at = new Date(s.t);
    var now = cur.mode === 'now' || i === nowStep();
    var h = '<p class="cl-f-when"><span class="cl-serif">' + esc(hourLabel(at)) + '</span>' + (now ? '<span class="cl-f-now">now</span>' : '') + '</p>';
    h += '<p class="cl-f-big"><span class="cl-f-num">' + (isNum(v.m) ? F.num(v.m) : DASH) + '</span><span class="cl-f-unit">ft at ' + esc(sp.name) + '</span></p>';
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
    h += '</ul>';
    setHTML(E.head, h);
    E.seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-spot') === spot)); });
    var vb = E.vseg.querySelector('[data-view="choc"]'), vt = 'Swell at ' + sp.name;
    if (vb.textContent !== vt) vb.textContent = vt;
  }

  // ════════════════════════════════════════════════════════════════════
  // RAY MAP
  // ════════════════════════════════════════════════════════════════════
  function spread(d0) {
    // the research page's directional spread (cos^2s, s = 15: about ±10°) over its 5° ray bins
    var out = [], c = Math.round(d0 / 5) * 5, tot = 0;
    for (var d = c - 10; d <= c + 10; d += 5) { var w = Math.pow(Math.cos((d - d0) * Math.PI / 360), 30); out.push([d, w]); tot += w; }
    return out.map(function (p) { return [p[0], p[1] / tot]; });
  }
  function nearestPeriod(T) { return PERIODS.reduce(function (b, v) { return Math.abs(v - T) < Math.abs(b - T) ? v : b; }, PERIODS[0]); }

  function drawMap() {
    if (!root || !E.cv) return;
    var w = E.map.clientWidth; if (!w) return;
    var fr = land.data && land.data.frame;
    var WKM = fr ? (fr.world[1] - fr.world[0]) * fr.kmlon : 130.1, HKM = fr ? (fr.world[3] - fr.world[2]) * fr.kmlat : 99.9;
    var h = Math.round(w * HKM / WKM), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (E.cv.width !== Math.round(w * dpr) || E.cv.height !== Math.round(h * dpr)) { E.cv.width = Math.round(w * dpr); E.cv.height = Math.round(h * dpr); }
    E.cv.style.height = h + 'px';
    var g = E.cv.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b1219'; g.fillRect(0, 0, w, h);
    if (view === 'storms') { drawStorms(g, w, h); return; }
    if (backdrop && backdrop.complete && backdrop.naturalWidth) g.drawImage(backdrop, 0, 0, w, h);
    g.fillStyle = 'rgba(8,13,19,0.28)'; g.fillRect(0, 0, w, h);
    var note = land.status === 'failed' ? 'The ray pictures didn’t load' : '';
    if (!fr) { setNote(note); return; }
    var s = w / WKM, unit = land.data.unit_km;
    var km = function (lon, lat) { return [(lon - fr.world[0]) * fr.kmlon * s, (fr.world[3] - lat) * fr.kmlat * s]; };
    var sp = SPOTS[spot], i = curStep(), labels = [], nrays = 0;
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (i >= 0) {
      var ps = parts(fc.steps[i], spot).slice().reverse();         // biggest share drawn last, on top
      ps.forEach(function (p) {
        var x = p.t, per = land.data.T[String(nearestPeriod(x.T))] || {}, col = FAM[fam(x.D)].rgb, best = null;
        spread(x.D).forEach(function (bw) {
          var rays = per[String(bw[0])] && per[String(bw[0])][sp.ray]; if (!rays) return;
          var a = (0.22 + 0.7 * p.share) * (0.45 + 0.55 * bw[1] / 0.3);
          g.strokeStyle = rgb(col, Math.min(0.95, a).toFixed(2));
          g.lineWidth = 0.7 + 2.6 * p.share;
          rays.forEach(function (r) {
            nrays++;
            g.beginPath();
            for (var k = 0; k < r.length; k += 2) { var X = r[k] * unit * s, Y = r[k + 1] * unit * s; if (k) g.lineTo(X, Y); else g.moveTo(X, Y); }
            g.stroke();
          });
          if (!best || bw[1] > best.w) best = { w: bw[1], r: rays[Math.floor(rays.length / 2)] };
        });
        if (best) labels.push({ x: best.r[0] * unit * s, y: best.r[1] * unit * s, col: col, txt: (ps.length - ps.indexOf(p)) + '° ' + F.swell(x.ft, x.T, F.compass(x.D)) });
      });
      if (!ps.length) note = 'No swell reaches ' + sp.name + ' this hour';
    } else if (fc.status !== 'loading') note = 'No model forecast for this hour';
    g.font = '600 11px ' + (getComputedStyle(root).getPropertyValue('--sans') || 'sans-serif');
    g.textBaseline = 'middle';
    var placed = [];
    function pill(txt, x, y, col, right) {
      var tw = g.measureText(txt).width, pw = tw + 14, x0 = right ? x - pw : x;
      x0 = Math.max(4, Math.min(w - pw - 4, x0)); y = Math.max(13, Math.min(h - 13, y));
      for (var n = 0; n < 6 && placed.some(function (b) { return x0 < b[0] + b[2] && x0 + pw > b[0] && Math.abs(y - b[1]) < 21; }); n++) y = y + (y > h / 2 ? -22 : 22);
      placed.push([x0, y, pw]);
      g.fillStyle = 'rgba(10,15,21,0.86)'; g.beginPath();
      if (g.roundRect) g.roundRect(x0, y - 10, pw, 20, 10); else g.rect(x0, y - 10, pw, 20);
      g.fill(); g.fillStyle = col; g.fillText(txt, x0 + 7, y);
    }
    // the spot
    var v = i >= 0 ? fc.steps[i][sp.k].m : null;
    if (spot === 'wild') {
      var a = [fr.w1[0] * s, fr.w1[1] * s], b = [fr.w2[0] * s, fr.w2[1] * s];
      g.strokeStyle = 'rgb(130,226,240)'; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      pill('Wilderness ' + (isNum(v) ? F.num(v) + NB + 'ft' : DASH), a[0] - 8, a[1] - 14, 'rgb(130,226,240)', true);
    } else {
      var cx = fr.choc[0] * s, cy = fr.choc[1] * s;
      g.fillStyle = 'rgb(255,196,140)'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
      g.strokeStyle = '#0a0f15'; g.lineWidth = 1.5; g.stroke();
      pill('Choc ' + (isNum(v) ? F.num(v) + NB + 'ft' : DASH), cx + 9, cy - 14, 'rgb(255,196,140)');
    }
    // the buoy
    var bp = km(fc.buoy[1], fc.buoy[0]);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(bp[0], bp[1], 3.5, 0, 7); g.fill();
    pill('Buoy 44097', bp[0] + 7, bp[1] + 2, '#e7edf2', bp[0] > w - 100);
    labels.forEach(function (L) { pill(L.txt, L.x + 4, L.y - 14, rgb(L.col)); });
    setNote(note);
    drawn = { rays: nrays, labels: labels.map(function (L) { return L.txt; }), note: note };
  }
  function setNote(t) { E.mapnote.hidden = !t; if (E.mapnote.textContent !== t) E.mapnote.textContent = t; }

  // ════════════════════════════════════════════════════════════════════
  // STORMS: the North Atlantic at the hour
  // ════════════════════════════════════════════════════════════════════
  // The frame: 98°W to 14°W (the whole Gulf of Mexico to Africa), as tall as the ray map's shape
  // allows, centred on 38°N (the Caribbean to the tip of Greenland), drawn in plain longitude and
  // latitude with longitude squeezed by cos 40°, as the Sound Check map does near Fishers.
  var SF = { L: -98, R: -14, latC: 38, cos: Math.cos(40 * Math.PI / 180) };
  function setView(v) {
    v = v === 'storms' ? 'storms' : 'choc';
    if (v === view) return;
    view = v;
    E.vseg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)); });
    E.seg.hidden = v === 'storms';
    E.key.hidden = v !== 'storms';
    if (v === 'storms') loadStorms();
    run('map', drawMap);
  }
  function loadImg(src) {
    return new Promise(function (ok) {
      var im = new Image();
      if (/^https?:/.test(src)) im.crossOrigin = 'anonymous';   // another site's image: its pixels stay readable (it sends CORS)
      im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src;
    });
  }
  function pixels(im) {
    var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, im.width, im.height).data;
  }
  // The run's images, loaded the first time Storms is opened (and again for a newer run).
  function loadStorms() {
    if (!fc.steps || !fc.grid || !fc.base) { storm.status = fc.status === 'loading' ? 'idle' : 'failed'; return; }
    var key = fc.base + '|' + fc.made;
    if (storm.key === key && storm.status !== 'failed') return;
    storm.key = key; storm.status = 'loading'; storm.wave = storm.hpa = storm.tracks = storm.lows = null;
    var tag = /^https?:/.test(fc.base) ? '?m=' + encodeURIComponent(fc.made) : '';   // a published pull's images are keyed to it
    var want = [loadImg(fc.base + 'field_gfs_ocean.png' + tag), fc.mslp ? loadImg(fc.base + fc.mslp.file + tag) : Promise.resolve(null)];
    if (!storm.bg) want.push(loadImg(OCEAN_BG), loadImg(OCEAN_LAND), getJSON(OCEAN_META));
    Promise.all(want).then(C.guard('forecast.storms', function (r) {
      if (storm.key !== key) return;                                // a newer run arrived meanwhile
      if (r.length > 2) { storm.bg = r[2]; storm.land = r[3]; storm.bounds = r[4] && r[4].bounds; }
      var n = fc.grid.lat[3] * fc.grid.lon[3];
      if (r[0] && r[0].width === n) storm.wave = { w: r[0].width, a: pixels(r[0]) };
      if (r[1] && r[1].width === n) {
        var a = pixels(r[1]), rows = r[1].height, hpa = [];
        for (var k = 0; k < rows; k++) {
          var row = new Float32Array(n);
          for (var q = 0; q < n; q++) { var o = 4 * (k * n + q), v = a[o] << 8 | a[o + 1]; row[q] = v === 65535 ? NaN : v / 10 + 800; }
          hpa.push(row);
        }
        storm.hpa = hpa;
        trackLows();
      }
      storm.status = storm.wave || storm.hpa ? 'ok' : 'failed';
      run('map', drawMap);
    }));
  }
  // Lows and highs at each step: a 1° cell lower (higher) than everything within 3° and at least 2 hPa below (above)
  // the ring 4° out, under 1008 hPa (over 1022), its centre refined between cells. Then each low is followed from step
  // to step (nearest low within what a storm can travel, 110 km/h) into tracks; a storm is a track that lasts a day or
  // more and gets to 1000 hPa or lower (shorter ones are mostly lows that form and fill again, and clutter the map).
  function trackLows() {
    var G = fc.grid, nla = G.lat[3], nlo = G.lon[3], d = G.lat[2];
    var lows = storm.hpa.map(function (P) {
      var out = [];
      for (var i = 4; i < nla - 4; i++) {
        var lat = G.lat[0] - i * d; if (lat < 8 || lat > 68) continue;
        for (var j = 4; j < nlo - 4; j++) {
          var lon = G.lon[0] + j * d; if (lon < -100 || lon > 5) continue;
          var p = P[i * nlo + j]; if (!(p <= 1008 || p >= 1022)) continue;
          var low = p <= 1008, ok = true;
          for (var a = -3; a <= 3 && ok; a++) for (var b = -3; b <= 3; b++) {
            if (!a && !b) continue;
            var v = P[(i + a) * nlo + j + b];
            if (v !== v || (low ? v < p || (v === p && (a < 0 || (a === 0 && b < 0))) : v > p || (v === p && (a < 0 || (a === 0 && b < 0))))) { ok = false; break; }
          }
          if (!ok) continue;
          var ring = 0, nr = 0;
          for (var t = 0; t < 16; t++) { var ai = Math.round(4 * Math.sin(t * Math.PI / 8)), bj = Math.round(4 * Math.cos(t * Math.PI / 8)), w = P[(i + ai) * nlo + j + bj]; if (w === w) { ring += w; nr++; } }
          if (!nr || (low ? ring / nr - p : p - ring / nr) < 2) continue;
          var pu = P[(i - 1) * nlo + j], pd = P[(i + 1) * nlo + j], pl = P[i * nlo + j - 1], pr = P[i * nlo + j + 1];
          var di = (pu - pd) / (2 * (pu - 2 * p + pd)) || 0, dj = (pl - pr) / (2 * (pl - 2 * p + pr)) || 0;
          di = Math.max(-0.5, Math.min(0.5, di)); dj = Math.max(-0.5, Math.min(0.5, dj));
          out.push({ lat: lat - di * d, lon: lon + dj * d, p: p, low: low });
        }
      }
      return out;
    });
    var tracks = [], open = [];
    lows.forEach(function (L, k) {
      var dt = k ? (fc.steps[k].t - fc.steps[k - 1].t) / HOUR : 3, reach = Math.max(300, 110 * dt), next = [], taken = {};
      var pairs = [];
      open.forEach(function (tr, ti) {
        var last = tr.pts[tr.pts.length - 1];
        L.forEach(function (x, xi) { if (x.low) { var km = dist(last, x); if (km <= reach) pairs.push([km, ti, xi]); } });
      });
      pairs.sort(function (a, b) { return a[0] - b[0]; });
      var used = {};
      pairs.forEach(function (q) { if (used[q[1]] || taken[q[2]]) return; used[q[1]] = taken[q[2]] = 1; var tr = open[q[1]]; tr.pts.push(Object.assign({ k: k }, L[q[2]])); next.push(tr); });
      L.forEach(function (x, xi) { if (x.low && !taken[xi]) { var tr = { pts: [Object.assign({ k: k }, x)] }; tracks.push(tr); next.push(tr); } });
      open = next;
    });
    storm.lows = lows;
    storm.tracks = tracks.filter(function (tr) {
      return fc.steps[tr.pts[tr.pts.length - 1].k].t - fc.steps[tr.pts[0].k].t >= DAY && tr.pts.some(function (x) { return x.p <= 1000; });
    });
  }
  function dist(a, b) {               // km, near enough for following a storm
    var R = 6371, f1 = a.lat * Math.PI / 180, f2 = b.lat * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
    return R * Math.acos(Math.max(-1, Math.min(1, Math.sin(f1) * Math.sin(f2) + Math.cos(f1) * Math.cos(f2) * Math.cos(dl))));
  }
  function keyGradient() {
    return 'linear-gradient(90deg,' + HST.filter(function (c) { return c[0] <= 20; }).map(function (c) { return rgb(c[1]) + ' ' + (c[0] / 20 * 100) + '%'; }).join(',') + ')';
  }
  function hcol(ft) {
    var k = 0; while (k < HST.length - 2 && ft > HST[k + 1][0]) k++;
    var a = HST[k], b = HST[k + 1], f = Math.max(0, Math.min(1, (ft - a[0]) / (b[0] - a[0])));
    return a[1].map(function (v, j) { return Math.round(v + (b[1][j] - v) * f); });
  }
  function drawStorms(g, w, h) {
    var s = w / ((SF.R - SF.L) * SF.cos), latSpan = h / s, T = SF.latC + latSpan / 2, B = SF.latC - latSpan / 2;
    var X = function (lon) { return (lon - SF.L) * SF.cos * s; }, Y = function (lat) { return (T - lat) * s; };
    var i = curStep(), note = '', info = { lows: [], highs: 0, tracks: 0, isobars: 0, frame: { L: SF.L, R: SF.R, T: T, B: B } };
    // the backdrop and its land mask are lon/lat rasters: a crop is just a scale
    var crop = function (im) {
      var bb = storm.bounds; if (!im || !bb) return null;
      var px = im.width / (bb[2] - bb[0]), py = im.height / (bb[3] - bb[1]);
      return [(SF.L - bb[0]) * px, (bb[3] - T) * py, (SF.R - SF.L) * px, (T - B) * py];
    };
    var cb = crop(storm.bg);
    if (cb) g.drawImage(storm.bg, cb[0], cb[1], cb[2], cb[3], 0, 0, w, h);
    var G = fc.grid, k = i >= 0 ? i : null;
    if (storm.status === 'loading' || storm.status === 'idle') note = 'Loading the storms…';
    else if (storm.status === 'failed') note = 'The storm maps didn\u2019t load';
    else if (k == null) note = 'No model forecast for this hour';
    if (G && k != null && storm.wave && k < storm.wave.a.length / (4 * storm.wave.w)) {
      // wave height: one pixel per 1° cell, smoothed as it is scaled up, then cut off the land
      var nla = G.lat[3], nlo = G.lon[3], d = G.lat[2];
      var sm = document.createElement('canvas'); sm.width = nlo; sm.height = nla;
      var sg = sm.getContext('2d'), id = sg.createImageData(nlo, nla), A = storm.wave.a, n = nla * nlo;
      for (var q = 0; q < n; q++) {
        var o = 4 * (k * n + q); if (A[o] === 255) continue;
        var c = hcol(A[o] / 10 * M2FT); id.data[4 * q] = c[0]; id.data[4 * q + 1] = c[1]; id.data[4 * q + 2] = c[2]; id.data[4 * q + 3] = 200;
      }
      sg.putImageData(id, 0, 0);
      var dpr = E.cv.width / w, off = document.createElement('canvas'); off.width = E.cv.width; off.height = E.cv.height;
      var og = off.getContext('2d'); og.setTransform(dpr, 0, 0, dpr, 0, 0); og.imageSmoothingEnabled = true;
      og.drawImage(sm, X(G.lon[0] - d / 2), Y(G.lat[0] + d / 2), nlo * d * SF.cos * s, nla * d * s);
      var cl = crop(storm.land);
      if (cl) { og.globalCompositeOperation = 'destination-out'; og.drawImage(storm.land, cl[0], cl[1], cl[2], cl[3], 0, 0, w, h); og.globalCompositeOperation = 'source-over'; }
      g.globalAlpha = 0.85; g.drawImage(off, 0, 0, w, h); g.globalAlpha = 1;
    }
    if (G && k != null && storm.hpa && storm.hpa[k]) {
      info.isobars = isobars(g, storm.hpa[k], G, X, Y, T, B);
      // tracks: the whole run faint, the hours still to come brighter, a dot every 6 h
      (storm.tracks || []).forEach(function (tr) {
        var pts = tr.pts; if (!pts.some(function (x) { return x.lon >= SF.L && x.lon <= SF.R && x.lat >= B && x.lat <= T; })) return;
        info.tracks++;
        g.lineWidth = 1.6; g.lineJoin = 'round';
        for (var a = 1; a < pts.length; a++) {
          g.strokeStyle = pts[a].k > k ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)';
          g.beginPath(); g.moveTo(X(pts[a - 1].lon), Y(pts[a - 1].lat)); g.lineTo(X(pts[a].lon), Y(pts[a].lat)); g.stroke();
        }
        pts.forEach(function (x) {
          if (fc.steps[x.k] && Math.round(fc.steps[x.k].t / HOUR) % 6) return;
          g.fillStyle = x.k > k ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(X(x.lon), Y(x.lat), 1.8, 0, 7); g.fill();
        });
      });
      g.font = '700 12px ' + (getComputedStyle(root).getPropertyValue('--sans') || 'sans-serif'); g.textBaseline = 'middle'; g.textAlign = 'center';
      (storm.lows && storm.lows[k] || []).forEach(function (x) {
        if (x.lon < SF.L || x.lon > SF.R || x.lat < B || x.lat > T) return;
        var px = X(x.lon), py = Y(x.lat), t = (x.low ? 'L ' : 'H ') + Math.round(x.p);
        if (x.low) info.lows.push({ p: Math.round(x.p), lat: Math.round(x.lat * 10) / 10, lon: Math.round(x.lon * 10) / 10 }); else info.highs++;
        var tw = g.measureText(t).width + 12;
        px = Math.max(tw / 2 + 2, Math.min(w - tw / 2 - 2, px)); py = Math.max(12, Math.min(h - 12, py));   // a label at the edge stays readable
        g.fillStyle = 'rgba(10,15,21,0.82)'; g.beginPath(); if (g.roundRect) g.roundRect(px - tw / 2, py - 10, tw, 20, 10); else g.rect(px - tw / 2, py - 10, tw, 20); g.fill();
        g.fillStyle = x.low ? '#ff8a8a' : '#8ac4ff'; g.fillText(t, px, py);
      });
      g.textAlign = 'start';
    } else if (storm.status === 'ok' && !storm.hpa && k != null) note = 'This forecast run has no pressure map yet';
    // Choc
    var cx = X(CHOC_LL[1]), cy = Y(CHOC_LL[0]);
    g.fillStyle = 'rgb(255,196,140)'; g.beginPath(); g.arc(cx, cy, 4.5, 0, 7); g.fill(); g.strokeStyle = '#0a0f15'; g.lineWidth = 1.5; g.stroke();
    g.font = '600 11px ' + (getComputedStyle(root).getPropertyValue('--sans') || 'sans-serif'); g.textBaseline = 'middle';
    g.fillStyle = 'rgba(10,15,21,0.86)'; g.beginPath(); if (g.roundRect) g.roundRect(cx - 50, cy - 10, 40, 20, 10); else g.rect(cx - 50, cy - 10, 40, 20); g.fill();
    g.fillStyle = 'rgb(255,196,140)'; g.fillText('Choc', cx - 43, cy);
    setNote(note);
    drawn = { rays: 0, labels: [], note: note };
    storm.drawn = info;
  }
  // Marching squares over the 1° pressure grid inside the frame: a segment per cell per 4 hPa level.
  function isobars(g, P, G, X, Y, T, B) {
    var nla = G.lat[3], nlo = G.lon[3], d = G.lat[2], n = 0;
    var i0 = Math.max(0, Math.floor((G.lat[0] - T) / d) - 1), i1 = Math.min(nla - 2, Math.ceil((G.lat[0] - B) / d) + 1);
    var j0 = Math.max(0, Math.floor((SF.L - G.lon[0]) / d) - 1), j1 = Math.min(nlo - 2, Math.ceil((SF.R - G.lon[0]) / d) + 1);
    var at = function (i, j, fi, fj) { return [X(G.lon[0] + (j + fj) * d), Y(G.lat[0] - (i + fi) * d)]; };
    var thin = new Path2D(), bold = new Path2D();
    for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) {
      var a = P[i * nlo + j], b = P[i * nlo + j + 1], c = P[(i + 1) * nlo + j + 1], e = P[(i + 1) * nlo + j];
      if (a !== a || b !== b || c !== c || e !== e) continue;
      var lo = Math.min(a, b, c, e), hi = Math.max(a, b, c, e);
      for (var lv = Math.ceil(lo / 4) * 4; lv <= hi; lv += 4) {
        var pts = [], f = function (u, v) { return (lv - u) / (v - u); }, path = lv % 20 ? thin : bold;
        if ((a < lv) !== (b < lv)) pts.push(at(i, j, 0, f(a, b)));
        if ((b < lv) !== (c < lv)) pts.push(at(i, j + 1, f(b, c), 0));
        if ((e < lv) !== (c < lv)) pts.push(at(i + 1, j, 0, f(e, c)));
        if ((a < lv) !== (e < lv)) pts.push(at(i, j, f(a, e), 0));
        for (var p = 0; p + 1 < pts.length; p += 2) { path.moveTo(pts[p][0], pts[p][1]); path.lineTo(pts[p + 1][0], pts[p + 1][1]); n++; }
      }
    }
    g.lineCap = 'round';
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.42)'; g.stroke(thin);
    g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,0.72)'; g.stroke(bold);
    return n;
  }

  // ════════════════════════════════════════════════════════════════════
  // WEEK SCRUBBER
  // ════════════════════════════════════════════════════════════════════
  function renderChart() {
    if (!fc.steps) { setHTML(E.cx, ''); E.wk.hidden = true; return; }
    E.wk.hidden = false;
    var S = fc.steps, W = E.cx.clientWidth || 358, wide = W >= 560, sp = SPOTS[spot];
    var PL = 30, PR = 8, PT = 10, CH = wide ? 170 : 140, LT = 20, LW = 16;
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
    for (var v = stepFt; v < ymax; v += stepFt) {
      o += '<line class="cl-f-grid" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="cl-f-ax" x="' + (PL - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }
    o += '<text class="cl-f-ax" x="' + (PL - 6) + '" y="' + (PT + 7) + '" text-anchor="end">ft</text>';
    // days
    for (d = U.startOfDay(new Date(t0)).getTime(); d <= t1; d += DAY) {
      if (d > t0) o += '<line class="cl-f-day" x1="' + x(d).toFixed(1) + '" x2="' + x(d).toFixed(1) + '" y1="' + PT + '" y2="' + (PT + CH) + '"/>';
      var mid = Math.max(t0, d) + (Math.min(t1, d + DAY) - Math.max(t0, d)) / 2;
      if (Math.min(t1, d + DAY) - Math.max(t0, d) >= 8 * HOUR) o += '<text class="cl-f-dl" x="' + x(mid).toFixed(1) + '" y="' + (PT + CH + 13) + '" text-anchor="middle">' + esc(F.day(new Date(mid))) + '</text>';
    }
    // the two models: band between them, their mean bold, each thin
    var both = S.filter(function (s) { return isNum(s[sp.k].g) && isNum(s[sp.k].e); });
    if (both.length > 1) {
      o += '<path class="cl-f-band" d="M' + both.map(function (s) { return x(s.t).toFixed(1) + ',' + y(Math.max(s[sp.k].g, s[sp.k].e)).toFixed(1); }).join('L') +
        'L' + both.slice().reverse().map(function (s) { return x(s.t).toFixed(1) + ',' + y(Math.min(s[sp.k].g, s[sp.k].e)).toFixed(1); }).join('L') + 'Z"/>';
    }
    o += line(S, function (s) { return s[sp.k].g; }, 'cl-f-gfs', x, y);
    o += line(S, function (s) { return s[sp.k].e; }, 'cl-f-ec', x, y);
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
    run('head', renderHead); run('cursor', drawCursor); run('map', drawMap); run('cond', renderCond);
  }
  function stepAtX(clientX) {
    var r = E.cx.getBoundingClientRect();
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
    var url = PREV + '?latitude=' + fc.buoy[0] + '&longitude=' + fc.buoy[1] +
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

  // Read-only state for tests and debugging.
  C.forecastInfo = function () {
    var i = curStep();
    return { fc: fc.status, made: fc.made, step: i, t: i >= 0 ? fc.steps[i].t : null, mode: cur.mode, spot: spot,
      rays: drawn.rays, labels: drawn.labels.slice(), note: drawn.note, land: land.status, prev: prev.status, verif: verif.status,
      view: view, playing: !!play.timer,
      storm: { status: storm.status, mslp: !!storm.hpa, drawn: storm.drawn ? JSON.parse(JSON.stringify(storm.drawn)) : null,
        tracks: storm.tracks ? storm.tracks.map(function (tr) {
          var a = tr.pts[0], b = tr.pts[tr.pts.length - 1], r1 = function (v) { return Math.round(v * 10) / 10; };
          return { min: Math.round(Math.min.apply(null, tr.pts.map(function (x) { return x.p; }))), hours: Math.round((fc.steps[b.k].t - fc.steps[a.k].t) / HOUR),
            from: [r1(a.lat), r1(a.lon)], to: [r1(b.lat), r1(b.lon)], k: [a.k, b.k] };
        }) : null } };
  };

  C.register('forecast', {
    mount: mount,
    render: function (reason) { render(reason); },
    onShow: function () { render('show'); }
  });
})();
