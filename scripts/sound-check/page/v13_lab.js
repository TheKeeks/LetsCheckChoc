(function () {
  'use strict';
  const { C, css, D, st, MON } = window.CHOC;
  const FT = 3.28084, rad = Math.PI / 180;
  const SPOTNAME = { choc: 'Choc', wild: 'Wilderness' };
  const SPREAD = { swell: 15, secondary: 10, wind: 3, manual: 15, ground: 15, mid: 10 };
  let SPOT = 'choc';

  // ── model core: response kernels from backward ray tracing (per spot, per period, per offshore degree)
  function kernel(T, spot) {
    const BK = BACKK[spot || SPOT], P = BK.periods, t = Math.max(P[0], Math.min(P[P.length - 1], T));
    let j = 0; while (j < P.length - 2 && t > P[j + 1]) j++;
    const w = (t - P[j]) / (P[j + 1] - P[j]), a = BK.R[j], b = BK.R[j + 1];
    return a.map((v, i) => v * (1 - w) + b[i] * w);
  }
  function spreadD(dir, s) {
    const d = new Float64Array(360); let sum = 0;
    for (let i = 0; i < 360; i++) { d[i] = Math.pow(Math.cos(((i + 0.5) - dir) * rad / 2) ** 2, s); sum += d[i]; }
    for (let i = 0; i < 360; i++) d[i] /= sum;
    return d;
  }
  function trainFactor(T, dir, s, spot) { const K = kernel(T, spot), Dd = spreadD(dir, s); let f = 0; for (let i = 0; i < 360; i++) f += Dd[i] * K[i]; return Math.sqrt(f / rad); }
  function spotFromTrains(trains, spot) {
    let e = 0; const parts = trains.map(t => { const k = trainFactor(t.T, t.dir, SPREAD[t.kind], spot), h = t.h * k; e += h * h; return { ...t, k, reef: h }; });
    return { h: Math.sqrt(e), parts };
  }

  window.CHOC.lab = { kernel, spreadD, trainFactor };

  // ── how fast a swell travels at a given depth: the exact linear dispersion relation w^2 = g k tanh(k h), by Newton's
  //    method from the Fenton-McKee estimate (within 1.7 %), as in the repo's scripts/rays/raycore.py, which makes
  //    the tables. That estimate bent rays up to 0.9 deg wrong (checked against Snell's law in scripts/test_raycore.py).
  const waveL = (T, h) => {                            // wavelength, m
    const g = 9.81, w = 2 * Math.PI / T;
    let k = 2 * Math.PI / (g * T * T / (2 * Math.PI) * Math.pow(Math.tanh(Math.pow(w * Math.sqrt(h / g), 1.5)), 2 / 3));
    for (let i = 0; i < 6; i++) { const t = Math.tanh(k * h); k -= (g * k * t - w * w) / (g * t + g * k * h * (1 - t * t)); }
    return 2 * Math.PI / k;
  };
  // crest speed for the tracers' inner loops: per period, a table even in sqrt(depth) from 0.5 m to 8 km, filled once
  // exactly; read by linear interpolation (within 1e-6 of exact)
  const SPD = new Map(), SQ0 = Math.sqrt(0.5), SQ1 = Math.sqrt(8000), NS = 16384;
  const crestSpeed = (T, h) => {
    let tab = SPD.get(T);
    if (!tab) {
      if (SPD.size > 64) SPD.clear();
      tab = new Float64Array(NS + 1);
      for (let i = 0; i <= NS; i++) { const s = SQ0 + (SQ1 - SQ0) * i / NS; tab[i] = waveL(T, s * s) / T; }
      SPD.set(T, tab);
    }
    const f = (Math.min(SQ1, Math.max(SQ0, Math.sqrt(h))) - SQ0) / (SQ1 - SQ0) * NS, i = Math.min(NS - 1, Math.floor(f)), a = f - i;
    return tab[i] * (1 - a) + tab[i + 1] * a;
  };
  window.CHOC.waveL = waveL; window.CHOC.crestSpeed = crestSpeed;

  // ── where a spot's swell comes from. The buoy's height is all of its swells combined, so on a mixed day one
  //    height, period and direction describes no swell that was really there (22 Aug 2025: 13.7 ft "18 s from S"
  //    was a 9 ft south swell, a 7 ft ESE swell and NNE chop). Each swell's share of the energy that reaches the
  //    spot is its height there squared over the sum (swells add as energy). Used by the calendar, the map's
  //    headline and Check a date, so all three read the same.
  const COMP16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const comp = (d) => COMP16[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  function shares(list) {                                    // [{at, ...}] -> adds .share (0-1) and .pct (whole numbers adding to 100)
    const tot = list.reduce((s, q) => s + q.at * q.at, 0);
    list.forEach((q) => { q.share = tot > 0 ? q.at * q.at / tot : 0; });
    const fl = list.map((q) => Math.floor(q.share * 100)), left = (tot > 0 ? 100 : 0) - fl.reduce((s, v) => s + v, 0);
    list.map((q, i) => [q.share * 100 - fl[i], i]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => { fl[i]++; });
    list.forEach((q, i) => { q.pct = fl[i]; });
    return list.sort((a, b) => b.share - a.share);
  }
  window.CHOC.swell = {
    comp, shares,
    // the buoy's swells at the spot's biggest hour that day, with each one's share there; bent = share of Choc's
    // energy that came from outside the 115-158 deg window (no straight path in: it bent around Montauk or Block)
    day(iso, spot) {
      const t = TRAINS[iso], w = spot === 'wild'; if (!t) return null;
      const list = (t[w ? 3 : 1] || []).map((x) => ({ ft: x[0], T: x[1], D: x[2], at: w ? x[4] : x[3] }));
      if (!list.length) return null;
      return { hr: t[w ? 2 : 0], trains: shares(list), bent: !w && BENT[iso] != null ? BENT[iso] : null };
    },
    // The readouts are short lines, one swell each, the way a surf report writes them: "1° 9.1 ft @ 17 s SSE 167°".
    // 1° is the primary swell (the biggest share of the spot's energy), 2° the secondary, and so on.
    sw: (q) => `${(+q.ft).toFixed(1)} ft @ ${Math.round(q.T)} s ${comp(q.D)} ${Math.round(q.D)}°`,
    // [[tag, text]] for a kv list: "9.1 ft @ 17 s SSE 167° → 58% of Choc", then "→ 38%" on the rest
    rows(trains, max, name) {
      return trains.filter((q) => q.pct > 0).slice(0, max || 3).map((q, i) => [`${i + 1}°`,
        `${window.CHOC.swell.sw(q)} → ${q.pct >= 100 ? 'all' : q.pct + '%'}${i === 0 && name ? ' of ' + name : ''}`]);
    },
    bentRow: (b) => ['Bent in', `${b}% from outside the 115–158° window`],   // around Montauk or Block Island: no straight path in
  };
  // a list of short "label value" lines; a row with no value is a small heading over the lines below it
  window.CHOC.kv = (rows, cls) => `<dl class="kv${cls ? ' ' + cls : ''}">${rows.filter(Boolean).map(([k, v]) => (v == null ? `<dt class="kv-h">${k}</dt>` : `<dt>${k}</dt><dd>${v}</dd>`)).join('')}</dl>`;
  // a swell picked elsewhere on the page (a day in Check a date) is shown in Part 1's
  // forward-ray figure: its strongest train
  const state = { trains: null, label: '' };
  function compute() {
    const tr = state.trains; if (!tr || !tr.length || !window.CHOC.frSet) return;
    const m = tr.reduce((x, y) => (y.h > x.h ? y : x));
    window.CHOC.frSet(m.dir, m.T, state.label);
  }

  // ── this week for both spots: GFS-Wave and ECMWF (scripts/forecast/fcpull.py), each run through the
  // ray model, read at buoy 44097 like the history. Times are Eastern whatever the viewer's device says.
  // The latest pull lives on the fc-data branch, refreshed every few hours by .github/workflows/update-forecast.yml;
  // fc/ is the copy that ships with the page. The newer of the two wins (a pull that can't be reached in 6 s
  // doesn't count), and its field images are read from the same place (d._base).
  const FC_LIVE = 'https://raw.githubusercontent.com/TheKeeks/LetsCheckChoc/fc-data/fc/';
  // the pull; false when the server answers without one (nothing published yet), null when it doesn't answer.
  // fresh: past GitHub's 5-minute cache too
  const fcGet = (base, ms, fresh) => {
    const ac = typeof AbortController === 'function' ? new AbortController() : null, t = ac && ms ? setTimeout(() => ac.abort(), ms) : 0;
    return fetch(base + 'fc.json' + (fresh ? '?t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'no-cache', signal: ac ? ac.signal : undefined }).then(r => (r.ok ? r.json() : false))
      .then(d => (d && d.made ? Object.assign(d, { _base: base }) : false)).catch(() => null).finally(() => clearTimeout(t));
  };
  window.CHOC.fcData = Promise.all([fcGet(FC_LIVE, 6000), fcGet('fc/')]).then(([live, here]) => (live && (!here || live.made > here.made) ? live : here || null));
  // ↻ under the map's timeline: ask GitHub again for the latest pull and, when it is newer than the forecast on show,
  // put it up on the map. 'new' | 'same' | 'none' | 'unreachable'
  const fcSubs = [];
  window.CHOC.onForecast = (fn) => { fcSubs.push(fn); };
  window.CHOC.fcRefresh = async () => {
    const [live, cur] = await Promise.all([fcGet(FC_LIVE, 8000, true), window.CHOC.fcData]);
    if (live === null) return 'unreachable';
    if (!live) return 'none';
    if (cur && live.made <= cur.made) return 'same';
    window.CHOC.fcData = Promise.resolve(live); fcSubs.forEach((f) => f(live));
    return 'new';
  };
  // how far ahead to trust it: archived GFS-Wave forecasts for each logged session (fcscore.py)
  // (the history bot fits it again whenever a session is logged: research/fc/score.json)
  if (document.getElementById('fcScore')) fetch('fc/score.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then(s => {
    const tb = document.getElementById('fcScore'); if (!tb || !s || !s.summary) return; const m = s.summary;
    const sg = v => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} ft`), f2 = v => (v == null ? '—' : v.toFixed(2));
    tb.innerHTML = '<thead><tr><th>Looking</th><th class="num">Orders your sessions by size</th><th class="num">Off from what arrived</th><th class="num">Typical miss</th></tr></thead><tbody>' +
      `<tr><td>The buoy, that hour</td><td class="num">${f2((m.buoy_model || {}).rho_size)}</td><td class="num">—</td><td class="num">—</td></tr>` +
      [1, 2, 3].map(k => { const r = m['d' + k] || {}; return `<tr><td>${k} day${k > 1 ? 's' : ''} ahead</td><td class="num">${f2(r.rho_size)}</td><td class="num">${sg(r.median_vs_arrived_ft)}</td><td class="num">${r.typical_miss_ft == null ? '—' : r.typical_miss_ft.toFixed(1) + ' ft'}</td></tr>`; }).join('') + '</tbody>';
    // the caption's numbers, from the same file: the sessions scored, how close on average, the typical miss
    const leads = ['d1', 'd2', 'd3'].map(k => m[k]).filter(r => r && r.median_vs_arrived_ft != null && r.typical_miss_ft != null);
    if (!leads.length) return;
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    document.querySelectorAll('[data-log="score"]').forEach(n => { n.textContent = Math.max(...leads.map(r => r.n)); });
    const w = Math.max(...leads.map(r => Math.abs(r.median_vs_arrived_ft))), lo = Math.min(...leads.map(r => r.typical_miss_ft)), hi = Math.max(...leads.map(r => r.typical_miss_ft));
    set('fcsWithin', w <= 0.05 ? 'a twentieth of a foot' : w <= 0.1 ? 'a tenth of a foot' : w.toFixed(1) + ' ft');
    set('fcsMiss', lo.toFixed(1) === hi.toFixed(1) ? lo.toFixed(1) + ' ft' : `${lo.toFixed(1)}–${hi.toFixed(1)} ft`);
  });

  // ── check any day (history)
  function compass(d) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16]; }
  function dayCheck() {
    const inp = document.getElementById('dcDate'), out = document.getElementById('dcOut'); if (!inp) return;
    const show = () => {
      const k = inp.value, v = DAYS2[k];
      if (!v) { out.innerHTML = `<p>No buoy data for ${k}.</p>`; return; }
      const [bpk, bdir, bper, ch, wi, chw, wiw, chh, wih] = v;
      const hr = h => h == null ? '' : ` from ${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
      const wind = (wd, nm) => wd ? `${window.CHOC.windArrow(wd[0])}${wd[1]} kn from ${wd[0]}° · <span style="color:${wd[2] ? 'var(--offshore)' : 'var(--fg-2)'}">${wd[2] ? 'clean' : 'not clean'} for ${nm}</span>` : '—';
      // the buoy's spectrum at Choc's biggest hour, split into trains: 1° (primary) is the biggest share of Choc's
      // energy, 2° the next, each with what reaches Choc and Wilderness
      const tr = TRAINS[k], list = tr && tr[1].length ? tr[1] : null, hh = tr ? tr[0] : null, kindOf = T => T >= 11 ? 'ground' : T >= 8 ? 'mid' : 'wind';
      const am = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
      const ft1 = (v) => (v == null ? '–' : v.toFixed(1));   // heights to one decimal, like the other readouts (5.0 printed as "5")
      let trs = '';
      if (list) {
        const mx = Math.max(...list.map(x => x[0]));
        const sh = window.CHOC.swell.shares(list.map((x, i) => ({ ft: x[0], T: x[1], D: x[2], at: x[3], i })));
        trs = `<div class="trs"><div class="trs-h">Swells at ${am(hh)}, Choc's biggest hour</div>` +
          sh.map((q, n) => { const x = list[q.i];
            return `<div class="tr"><div class="tr-l"><b>${n + 1}°</b> ${window.CHOC.swell.sw(q)}</div>
              <div class="tr-bar"><i style="width:${(x[0] / mx * 100).toFixed(0)}%"></i><i class="r" style="width:${(x[3] / mx * 100).toFixed(0)}%"></i></div>
              <div class="tr-r">→ Choc <b>${ft1(x[3])} ft</b> (<b>${q.pct}%</b>) · Wilderness ${ft1(x[4])} ft</div></div>`; }).join('') +
          `<div class="tr-k"><span><i></i> at the buoy</span><span><i class="r"></i> what reaches Choc</span></div></div>`;
      }
      out.innerHTML = `<table class="dct"><thead><tr><th>Spot</th><th class="num">Modeled best 3 h</th><th>Wind then</th></tr></thead><tbody>
        <tr><td>Choc</td><td class="num"><b>${ft1(ch)} ft</b>${hr(chh)}</td><td>${wind(chw, 'Choc')}</td></tr>
        <tr><td>Wilderness</td><td class="num"><b>${ft1(wi)} ft</b>${hr(wih)}</td><td>${wind(wiw, 'Wilderness')}</td></tr></tbody></table>` + trs +
        window.CHOC.kv([list && BENT[k] != null ? window.CHOC.swell.bentRow(BENT[k]) : null,
          ['Buoy', `${ft1(bpk)} ft at its peak, all swells${bper != null && bdir != null ? ` (${Math.round(bper)} s, ${bdir}°)` : ''}`]]) +
        `<p class="dc-go">${bdir != null ? `<button type="button" id="dcLoad">${list && list.length > 1 ? 'See these swells\' rays' : 'See this swell\'s rays'}</button> ` : ''}<button type="button" id="dcOcean">Show the ocean that day</button></p>`;
      const oc = document.getElementById('dcOcean'); if (oc) oc.addEventListener('click', () => { if (window.CHOC.showPast) window.CHOC.showPast(k); });   // the map's Past view: the whole Atlantic that day
      const b = document.getElementById('dcLoad'); if (!b) return;
      if (list) b.addEventListener('click', () => { state.trains = list.map(x => ({ kind: kindOf(x[1]), h: x[0] / FT, T: x[1], dir: x[2] })); state.label = `${k} ${am(hh)} (buoy)`; compute(); document.getElementById('how-h').scrollIntoView({ behavior: 'smooth' }); });
      else b.addEventListener('click', () => { state.trains = [{ kind: 'manual', h: bpk / FT, T: bper || 9, dir: bdir }]; state.label = `${k} (buoy peak)`; compute(); document.getElementById('how-h').scrollIntoView({ behavior: 'smooth' }); });
    };
    inp.addEventListener('change', show); show(); window.CHOC.dcShow = show;
  }


  // response chart (behind the numbers), follows the spot switch
  function kresp(spot) {
    const host = document.getElementById('kresp'); if (!host) return; host.innerHTML = '';
    const ttl = document.getElementById('krespTitle'); if (ttl) ttl.textContent = `How much of the buoy's swell reaches ${SPOTNAME[spot]}, by direction and period`;
    const NS = 'http://www.w3.org/2000/svg', el = (nm, a, p) => { const e = document.createElementNS(NS, nm); for (const k in a) e.setAttribute(k, a[k]); p && p.appendChild(e); return e; };
    const txt = (p, x, y, s, o = {}) => { const t = el('text', Object.assign({ x, y, fill: C.fg3, 'font-size': 11, 'font-family': css('--mono') }, o), p); t.textContent = s; };
    const dirs = []; for (let d = 60; d <= 220; d += 2) dirs.push(d);
    // a phone gets a narrower drawing (same data), so its text stays readable instead of shrinking to fit
    const narrow = host.clientWidth > 0 && host.clientWidth < 560;
    const w = narrow ? 420 : 700, h = narrow ? 270 : 230, L = 40, B = 28, T = 22, R2 = 46, top = 0.8, x = d => L + (d - 60) / 160 * (w - L - R2), y = v => h - B - v / top * (h - B - T);
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Response by direction and period' }, host);
    el('rect', { x: x(115), y: T, width: x(158) - x(115), height: h - B - T, fill: C.swell, opacity: 0.09 }, svg);   // the 115–158° window
    txt(svg, (x(115) + x(158)) / 2, T - 8, 'the window', { 'text-anchor': 'middle', fill: C.fg2 });
    [0, 0.2, 0.4, 0.6, 0.8].forEach(v => { el('line', { x1: L, x2: w - R2, y1: y(v), y2: y(v), stroke: C.rule }, svg); txt(svg, L - 6, y(v) + 4, Math.round(v * 100) + '%', { 'text-anchor': 'end' }); });
    (narrow ? [60, 100, 140, 180, 220] : [60, 90, 120, 150, 180, 210]).forEach(d => txt(svg, x(d), h - 8, d + '°', { 'text-anchor': 'middle' }));
    [6, 9, 12, 15].forEach(p => { const v = dirs.map(d => trainFactor(p, d, 15, spot)), c = window.CHOC.perColor(p + 1, 1);
      el('path', { d: v.map((q, i) => `${i ? 'L' : 'M'}${x(dirs[i]).toFixed(1)},${y(q).toFixed(1)}`).join(''), fill: 'none', stroke: c, 'stroke-width': 2.2 }, svg); txt(svg, w - R2 + 6, y(v[v.length - 1]) + 4, p + ' s', { fill: C.fg }); });
  }
  window.CHOC.krespRedraw = kresp;

  function wildSection() {
    const host = document.getElementById('wildMonths'); if (!host) return;
    const s = WILDSTATS;
    const NS = 'http://www.w3.org/2000/svg', el = (nm, a, p) => { const e = document.createElementNS(NS, nm); for (const k in a) e.setAttribute(k, a[k]); p && p.appendChild(e); return e; };
    const w = 700, h = 230, L = 34, B = 24, T = 10, top = 40, y = v => h - B - v / top * (h - B - T), bw = (w - L) / 12;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Share of days each month for Choc and Wilderness' }, host);
    const txt = (x, yy, t, o = {}) => { const e = el('text', Object.assign({ x, y: yy, fill: C.fg3, 'font-size': 11, 'font-family': css('--mono') }, o), svg); e.textContent = t; };
    [0, 10, 20, 30, 40].forEach(v => { el('line', { x1: L, x2: w, y1: y(v), y2: y(v), stroke: C.rule }, svg); txt(L - 6, y(v) + 4, v + '%', { 'text-anchor': 'end' }); });
    s.months.forEach((m, i) => { const x0 = L + i * bw + bw * 0.12, sw = bw * 0.25;
      [[m.choc, C.swell], [m.wild, '#4fb6c9'], [m.wild_day, '#9be3ee']].forEach(([v, col], k) => el('rect', { x: x0 + k * (sw + 1), y: y(v), width: sw, height: y(0) - y(v), fill: col, rx: 1.5 }, svg));
      txt(x0 + bw * 0.38, h - 6, m.month, { 'text-anchor': 'middle', fill: C.fg2 });
      const hit = el('rect', { x: L + i * bw, y: T, width: bw, height: h - B - T, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', e => window.CHOC.showTip(e, `<b>${m.month}</b><br>Choc 2.5 ft+: ${m.choc}%<br>Wilderness 2.5 ft+: ${m.wild}%<br>Wilderness works, Choc's wind doesn't: ${m.wild_day}%`)); hit.addEventListener('mouseleave', () => window.CHOC.hideTip()); });
    const tb = document.getElementById('wildTop');
    if (tb) tb.innerHTML = '<thead><tr><th>Day</th><th class="num">Wilderness</th><th class="num">Choc</th><th class="num">Buoy</th><th>Wind at Wilderness</th></tr></thead><tbody>' + s.top.map(t => `<tr><td class="mono">${t.date}</td><td class="num">${t.wild} ft</td><td class="num">${t.choc} ft</td><td class="num">${t.buoy} ft</td><td>${t.wind_ok ? '<span style="color:var(--offshore)">clean</span>' : 'not clean'}${t.wdir != null ? ' · ' + window.CHOC.windArrow(t.wdir) + 'from ' + t.wdir + '°' : ''}</td></tr>`).join('') + '</tbody>';
  }

  kresp('choc'); wildSection(); dayCheck();
  addEventListener('lcc-theme-change', () => { kresp('choc'); wildSection(); });
})();
