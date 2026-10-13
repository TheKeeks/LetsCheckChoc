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
  // a swell picked elsewhere on the page (a forecast hour, a remembered day) is shown in Part 1's
  // forward-ray figure: its strongest train
  const state = { trains: null, label: '' };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  // put it up everywhere the page shows the forecast (the map and the 7-day table). 'new' | 'same' | 'none' | 'unreachable'
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
  const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
  const etp = ms => { const o = {}; for (const p of ETF.formatToParts(new Date(ms))) o[p.type] = p.value; o.h = +o.hour % 24; return o; };
  const hr12 = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  const fcLabel = ms => { const p = etp(ms); return `${p.weekday} ${p.month} ${p.day}, ${hr12(p.h)}`; };
  const KIND = { w1: 'swell', w2: 'secondary', w3: 'secondary', ww: 'wind' };
  function showHour(r) {
    state.trains = r.trains.filter(t => t.T >= 3).map(t => ({ kind: KIND[t.k], h: t.ft / FT, T: t.T, dir: t.D })); state.label = fcLabel(Date.parse(r.t)) + ' (GFS-Wave)';
    compute(); document.getElementById('how-h').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }
  const gapD = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const windOk = (wd, spot) => wd[0] < 6 || gapD(wd[1], spot === 'choc' ? 335 : 40) <= (spot === 'choc' ? 60 : 70);
  async function thisWeek() {
    const f = await window.CHOC.fcData, host = document.getElementById('fcChart'); if (!host) return;
    if (!f) { host.textContent = 'The forecast file didn’t load.'; return; }
    const g = f.gfs, n = g.length, ts = g.map(r => Date.parse(r.t));
    const ec = ts.map(t => { let b = null, bd = 3 * 36e5 + 1; f.ec.forEach(q => { const d = Math.abs(Date.parse(q.t) - t); if (d < bd) { bd = d; b = q; } }); return b; });
    const S = { cg: g.map(r => r.choc), ce: ec.map(q => (q ? q.choc : null)), wg: g.map(r => r.wild), we: ec.map(q => (q ? q.wild : null)), off: g.map(r => r.hs) };
    const mean = (a, b) => (b == null ? a : (a + b) / 2), cm = S.cg.map((v, i) => mean(v, S.ce[i])), wm = S.wg.map((v, i) => mean(v, S.we[i]));
    host.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg', el = (nm, a, p) => { const e = document.createElementNS(NS, nm); for (const k in a) e.setAttribute(k, a[k]); p && p.appendChild(e); return e; };
    const w = 700, h = 220, L = 34, B = 30, T = 12, Rr = 10, all = [...S.off, ...S.cg, ...S.ce, ...S.wg, ...S.we].filter(v => v != null), top = Math.max(3, Math.ceil(Math.max(...all) + 0.5));
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Forecast for Choc and Wilderness from GFS-Wave and ECMWF, next 7 days' }, host);
    const x = t => L + (t - ts[0]) / (ts[n - 1] - ts[0]) * (w - L - Rr), y = v => h - B - v / top * (h - B - T);
    for (let v = 0; v <= top; v += top > 8 ? 2 : 1) { el('line', { x1: L, x2: w - Rr, y1: y(v), y2: y(v), stroke: C.rule }, svg); const t = el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', fill: C.fg3, 'font-size': 11, 'font-family': css('--mono') }, svg); t.textContent = v + (v === top ? ' ft' : ''); }
    let lastDay = etp(ts[0]).day;
    for (let t = ts[0]; t <= ts[n - 1]; t += 36e5) { const p = etp(t); if (p.day !== lastDay && p.h === 0) { lastDay = p.day; el('line', { x1: x(t), x2: x(t), y1: T, y2: h - B, stroke: C.rule, 'stroke-dasharray': '2 4' }, svg); const tx = el('text', { x: x(t) + 4, y: h - 10, fill: C.fg2, 'font-size': 11, 'font-family': css('--mono') }, svg); tx.textContent = `${p.weekday} ${p.day}`; } }
    const line = (arr, col, wd, dash) => { const d = arr.map((v, i) => (v == null ? '' : `${i && arr[i - 1] != null ? 'L' : 'M'}${x(ts[i]).toFixed(1)},${y(v).toFixed(1)}`)).join(''); el('path', Object.assign({ d, fill: 'none', stroke: col, 'stroke-width': wd, 'stroke-linejoin': 'round' }, dash ? { 'stroke-dasharray': dash } : {}), svg); };
    line(S.off, C.fg3, 1.3); line(S.we, '#9be3ee', 1.6, '5 3'); line(S.wg, '#9be3ee', 1.8); line(S.ce, C.swell, 2, '5 3'); line(S.cg, C.swell, 2.5);
    const hl = el('line', { y1: T, y2: h - B, stroke: C.fg, opacity: 0 }, svg), hit = el('rect', { x: L, y: T, width: w - L - Rr, height: h - B - T, fill: 'transparent', style: 'cursor:pointer' }, svg);
    const idxAt = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * w; let bi = 0; ts.forEach((t, i) => { if (Math.abs(x(t) - px) < Math.abs(x(ts[bi]) - px)) bi = i; }); return bi; };
    const f1 = v => (v == null ? '–' : v.toFixed(1));
    hit.addEventListener('mousemove', e => { const i = idxAt(e); hl.setAttribute('x1', x(ts[i])); hl.setAttribute('x2', x(ts[i])); hl.setAttribute('opacity', 0.6);
      window.CHOC.showTip(e, `<b>${fcLabel(ts[i])}</b><br>Choc <b>${f1(S.cg[i])}</b> GFS · <b>${f1(S.ce[i])}</b> ECMWF<br>Wilderness ${f1(S.wg[i])} · ${f1(S.we[i])} ft<br>offshore ${f1(S.off[i])} ft · wind ${window.CHOC.windArrow(g[i].wind[1])}${g[i].wind[0]} kn from ${g[i].wind[1]}°<br><i>tap to see the swell rays</i>`); });
    hit.addEventListener('mouseleave', () => { hl.setAttribute('opacity', 0); window.CHOC.hideTip(); });
    hit.addEventListener('click', e => showHour(g[idxAt(e)]));
    // best daylight hour per Eastern day per spot (sunrise + 30 min to sunset - 30 min at Choc), by the two models' average
    const days = {};
    ts.forEach((t, i) => { if (!window.CHOC.daylight(t)) return; const p = etp(t); const k = `${p.weekday} ${p.month} ${p.day}`; (days[k] = days[k] || []).push(i); });
    const cell = (idxs, spot, vals, a, b) => {
      let bi = idxs[0]; for (const i of idxs) if (vals[i] > vals[bi]) bi = i;
      const ok = windOk(g[bi].wind, spot);
      return `<button type="button" class="fcpick" data-i="${bi}"><b>${vals[bi].toFixed(1)} ft</b> ${hr12(etp(ts[bi]).h)} · <span style="color:${ok ? 'var(--offshore)' : 'var(--fg-3)'}">${ok ? 'clean' : 'wind'}</span><span class="fc-m">GFS ${f1(a[bi])} · EC ${f1(b[bi])}</span></button>`;
    };
    const tb = document.getElementById('fcDays');
    tb.innerHTML = '<thead><tr><th>Day</th><th>Choc, best daylight hour</th><th>Wilderness, best daylight hour</th></tr></thead><tbody>' +
      Object.entries(days).map(([d, idxs]) => `<tr><td class="mono">${d}</td><td>${cell(idxs, 'choc', cm, S.cg, S.ce)}</td><td>${cell(idxs, 'wild', wm, S.wg, S.we)}</td></tr>`).join('') + '</tbody>';
    tb.querySelectorAll('.fcpick').forEach(b => b.addEventListener('click', () => showHour(g[+b.dataset.i])));
    const p = etp(Date.parse(f.made)), ao = document.getElementById('fcAsOf2');
    if (ao) ao.textContent = `Forecast as of ${p.weekday} ${p.month} ${p.day}, ${hr12(p.h)} ET · GFS-Wave and ECMWF ${hr12(etp(Date.parse(f.runs.gfs.replace(/Z$/, ':00Z'))).h)} runs`;
  }
  // how far ahead to trust it: archived GFS-Wave forecasts for each logged session (fcscore.py)
  fetch('fc/score.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then(s => {
    const tb = document.getElementById('fcScore'); if (!tb || !s) return; const m = s.summary;
    const sg = v => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} ft`);
    tb.innerHTML = '<thead><tr><th>Looking</th><th class="num">Orders your sessions by size</th><th class="num">Off from what arrived</th><th class="num">Typical miss</th></tr></thead><tbody>' +
      `<tr><td>The buoy, that hour</td><td class="num">${m.buoy_model.rho_size.toFixed(2)}</td><td class="num">—</td><td class="num">—</td></tr>` +
      [1, 2, 3].map(k => { const r = m['d' + k]; return `<tr><td>${k} day${k > 1 ? 's' : ''} ahead</td><td class="num">${r.rho_size.toFixed(2)}</td><td class="num">${sg(r.median_vs_arrived_ft)}</td><td class="num">${r.typical_miss_ft.toFixed(1)} ft</td></tr>`; }).join('') + '</tbody>';
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
    const s = WILDSTATS, host = document.getElementById('wildMonths'); if (!host) return;
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

  kresp('choc'); thisWeek(); window.CHOC.onForecast(thisWeek); wildSection(); dayCheck();
  addEventListener('lcc-theme-change', () => { kresp('choc'); thisWeek(); wildSection(); });
})();
