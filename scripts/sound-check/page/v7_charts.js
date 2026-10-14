(function () {
  'use strict';
  const { st, D, MON, C, css, perColor } = window.CHOC;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); p && p.appendChild(e); return e; };
  const txt = (p, x, y, s, o = {}) => { const t = el('text', Object.assign({ x, y, fill: C.fg3, 'font-size': 11, 'font-family': css('--mono') }, o), p); t.textContent = s; return t; };
  const clear = id => { const n = document.getElementById(id); n.innerHTML = ''; return n; };

  // ── tooltip
  const tip = document.getElementById('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.min(e.clientX + 12, innerWidth - w - 8) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.hidden = true; }
  window.CHOC.showTip = showTip; window.CHOC.hideTip = hideTip;
  addEventListener('scroll', hideTip, { passive: true });          // on touch screens a tapped tooltip would otherwise stay
  const hover = (node, html) => { node.addEventListener('mousemove', e => showTip(e, html)); node.addEventListener('mouseleave', hideTip); };
  const dlKey = () => st.daylight ? 'day' : 'all';

  // ── takeaways
  function takeaways() {
    const c = DATA.clim[dlKey()], hrs = c.map(x => x.big * x.hours), tot = hrs.reduce((a, b) => a + b, 0);
    const share = ms => Math.round(100 * ms.reduce((a, m) => a + hrs[m], 0) / tot);
    const good = Math.round(100 * c.reduce((a, x) => a + x.good * x.hours, 0) / tot);
    const clean = Math.round(100 * c.reduce((a, x) => a + x.clean * x.hours, 0) / tot);
    const so = (c[8].big + c[9].big) / 2;
    const hrsWord = st.daylight ? 'daylight hours' : 'hours';
    const cs = ms => Math.round(100 * ms.reduce((a, m) => a + c[m].clean * c[m].hours, 0) / ms.reduce((a, m) => a + c[m].big * c[m].hours, 0));
    const mar = c[2].good, sep = c[8].good;
    const vs = Math.abs(mar - sep) < 0.3 ? 'as many' : mar > sep ? 'slightly more' : 'slightly fewer';
    document.getElementById('takeaways').innerHTML = `
      <div class="take"><b class="mono">Sep–Oct</b><span>The most swell: about ${Math.round(so)}% of ${hrsWord} are 4 ft+ through the window. September gets the most from the 140–158° sweet spot of any month.</span></div>
      <div class="take"><b class="mono">Feb–Mar</b><span>A bit less swell but cleaner wind: ${cs([1, 2])}% of big hours are clean, against ${cs([8, 9])}% in September–October. March ends up with ${vs} clean, incoming-tide ${hrsWord} as September (${mar}% vs ${sep}%).</span></div>
      <div class="take"><b class="mono">Jun–Aug</b><span>Only ${share([5, 6, 7])}% of big hours. July is nearly dead: about ${c[6].big.toFixed(0)} in 100 ${hrsWord}.</span></div>
      <div class="take"><b class="mono">${good}%</b><span>of big hours also have clean wind and an incoming tide. ${100 - clean}% of big hours are blown out.</span></div>`;
  }

  // ── month bars
  function months() {
    const c = DATA.clim[dlKey()], host = clear('months');
    const w = 700, h = 260, L = 34, B = 24, T = 10, top = 28;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Share of hours that are big and in window, by month' }, host);
    const y = v => h - B - (v / top) * (h - B - T);
    [0, 5, 10, 15, 20, 25].forEach(v => { el('line', { x1: L, x2: w, y1: y(v), y2: y(v), stroke: C.rule }, svg); txt(svg, L - 6, y(v) + 4, v + '%', { 'text-anchor': 'end' }); });
    const bw = (w - L) / 12;
    c.forEach((m, i) => {
      const segs = [[m.good, C.swell], [m.clean - m.good, C.soft], [m.big - m.clean, C.blown]];
      let acc = 0; const x = L + i * bw + bw * 0.18, bwid = bw * 0.64;
      segs.forEach(([v, col], k) => { const y0 = y(acc), y1 = y(acc + v); el('rect', { x, y: y1 + (k ? 1 : 0), width: bwid, height: Math.max(0, y0 - y1 - (k ? 2 : 1)), fill: col, rx: k === 2 ? 3 : 1 }, svg); acc += v; });
      txt(svg, x + bwid / 2, h - 6, m.month, { 'text-anchor': 'middle', fill: C.fg2 });
      if (m.big > 15) txt(svg, x + bwid / 2, y(m.big) - 5, Math.round(m.big) + '%', { 'text-anchor': 'middle', fill: C.fg });
      hover(el('rect', { x: L + i * bw, y: T, width: bw, height: h - B - T, fill: 'transparent' }, svg),
        `<b>${m.month}</b> · ${m.hours.toLocaleString()} ${st.daylight ? 'daylight ' : ''}hrs<br>big + in window: ${m.big}%<br>clean + incoming: ${m.good}%<br>clean, outgoing: ${(m.clean - m.good).toFixed(1)}%<br>blown out: ${(m.big - m.clean).toFixed(1)}%<br>6 ft+: ${m.big6}%`);
    });
    document.getElementById('monthsLead').textContent = `Share of ${st.daylight ? 'daylight ' : ''}hours, by month, when the buoy reads 4 ft+ from inside the window.`;
  }

  // ── period histogram (all hours)
  function period() {
    const host = clear('period'), w = 700, h = 200, L = 46, B = 24, T = 10;
    const map = new Map(DATA.per.map(([k, v]) => [+k, v])), ks = []; for (let k = 4; k <= 18; k++) ks.push(k);
    const max = Math.max(...map.values()), top = Math.ceil(max / 500) * 500;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Dominant period of big in-window hours' }, host);
    const y = v => h - B - (v / top) * (h - B - T);
    for (let v = 0; v <= top; v += 500) { el('line', { x1: L, x2: w, y1: y(v), y2: y(v), stroke: C.rule }, svg); txt(svg, L - 6, y(v) + 4, v, { 'text-anchor': 'end' }); }
    const bw = (w - L) / ks.length;
    ks.forEach((k, i) => {
      const v = map.get(k) || 0, x = L + i * bw + bw * 0.15;
      if (v) el('rect', { x, y: y(v), width: bw * 0.7, height: y(0) - y(v), fill: perColor(k, 1), rx: 2 }, svg);
      txt(svg, x + bw * 0.35, h - 6, k + 's', { 'text-anchor': 'middle', fill: C.fg2 });
      hover(el('rect', { x: L + i * bw, y: T, width: bw, height: h - B - T, fill: 'transparent' }, svg), `<b>${k}–${k + 1} s</b><br>${v.toLocaleString()} big in-window hours`);
    });
    txt(svg, L + 4, T + 4, 'hours');
  }

  // ── events table
  function events() {
    const t = document.getElementById('events');
    t.innerHTML = `<thead><tr><th>Start</th><th class="num">Hours</th><th class="num">Peak</th><th class="num">Period</th><th class="num">Dir</th><th class="num">Energy</th><th class="num">Clean hrs</th><th class="num">Good hrs</th></tr></thead>`;
    const tb = document.createElement('tbody'); t.appendChild(tb);
    DATA.events.forEach(e => {
      const [yy, mm, dd] = e.start.slice(0, 10).split('-').map(Number);
      const tr = document.createElement('tr'); tr.className = 'clickable'; tr.tabIndex = 0;
      tr.innerHTML = `<td class="mono">${dd} ${MON[mm - 1]} ${yy}</td><td class="num">${e.hours}</td><td class="num">${e.peak_ft} ft</td><td class="num">${e.peak_period.toFixed(1)} s</td><td class="num">${Math.round(e.peak_dir)}°</td><td class="num">${e.energy.toLocaleString()}</td><td class="num">${e.clean}</td><td class="num">${st.daylight ? e.good_day : e.good}</td>`;
      const go = () => {                                    // open the swell's first day on the map's Past view
        const x = D.find(q => q.y === yy && q.m === mm && q.d >= dd);
        if (x && window.CHOC.showPast) window.CHOC.showPast(x.iso);
      };
      tr.addEventListener('click', go); tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
      tb.appendChild(tr);
    });
  }

  // ── peak vs sustained (session test, all hours)
  function sessChart() {
    const short = { L: 'App-logged swell (forecast pin)', B: 'Day peak height, in window', A: 'Day peak height, any direction',
      C: 'Day peak power, in window', 'D*': 'Best 3 h power, soft edge', 'E*': 'Best 6 h power, soft edge', H: 'Height at session hour',
      D: 'Best 3 h power, hard edge', K: '6 h power around session', E: 'Best 6 h power, hard edge', J: '3 h power around session',
      F: 'All-day average power', I: 'Power at session hour', G: 'Best 6 h height, in window' };
    const rows = DATA.sess.map(([k, rho, lo, hi]) => ({ key: k.split(' ')[0], rho, lo, hi }));
    const w = 700, rowH = 26, L = 230, R = 20, T = 24, h = T + rows.length * rowH + 10;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Rank correlation of each measure with logged size' }, clear('sesschart'));
    const x = v => L + v * (w - L - R);
    [0, 0.25, 0.5, 0.75, 1].forEach(v => { el('line', { x1: x(v), x2: x(v), y1: T - 6, y2: h - 6, stroke: C.rule }, svg); txt(svg, x(v), 12, v.toFixed(2), { 'text-anchor': 'middle' }); });
    rows.forEach((r, i) => {
      const y = T + i * rowH + rowH / 2, rec = r.key === 'D*', ref = r.key === 'L';
      txt(svg, L - 10, y + 4, short[r.key] || r.key, { 'text-anchor': 'end', fill: rec ? C.fg : C.fg2, 'font-size': 12, 'font-weight': rec ? 600 : 400, 'font-family': css('--body') });
      el('line', { x1: x(Math.max(0, r.lo)), x2: x(r.hi), y1: y, y2: y, stroke: rec ? C.swell : C.fg3, 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
      el('circle', { cx: x(r.rho), cy: y, r: 5, fill: rec ? C.swell : ref ? C.cool : C.fg2, stroke: C.panel, 'stroke-width': 2 }, svg);
      hover(el('rect', { x: 0, y: y - rowH / 2, width: w, height: rowH, fill: 'transparent' }, svg), `<b>${short[r.key] || r.key}</b><br>ρ = ${r.rho.toFixed(2)} (95%: ${r.lo.toFixed(2)} to ${r.hi.toFixed(2)})`);
    });
  }

  // ══ MODEL SECTION ══════════════════════════════════════════════════════
  const MODEL = DATA.model;
  // the comparison caption quotes the size model's share explained: read it from the same results as the panel
  { const s = document.getElementById('sizeR2'); if (s) s.textContent = Math.round(MODEL.targets.size.loo_r2 * 100) + '%'; }
  const TNAME = { avg: 'overall rating', size: 'size rating', ride: 'ride rating', wind_q: 'wind rating' };
  let target = 'avg';
  document.querySelectorAll('#targetSeg [data-t]').forEach(b => b.addEventListener('click', () => {
    target = b.dataset.t;
    document.querySelectorAll('#targetSeg [data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    modelAll();
  }));

  function modelTiles() {
    const m = MODEL.targets[target];
    const order = MODEL.feats.map((f, j) => [f, m.coef[j]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const p = m.preq, half = Math.floor(p.length / 2);
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const lateM = mean(p.slice(half).map(q => Math.abs(q.actual - q.model))), lateB = mean(p.slice(half).map(q => Math.abs(q.actual - q.base)));
    document.getElementById('modelTiles').innerHTML = `
      <div class="take"><b class="mono">${m.loo_r2.toFixed(2)}</b><span>Share of the spread in your ${TNAME[target]} it explains on sessions it hasn't seen (leave-one-out R²). 0 is no better than a guess, 1 is perfect.</span></div>
      <div class="take"><b class="mono">±${m.mae.toFixed(1)}</b><span>Typical miss in rating points, against ±${m.mae_base.toFixed(1)} for always guessing your average rating.</span></div>
      <div class="take"><b class="mono">±${lateM.toFixed(1)}</b><span>Typical miss on your latest ${p.length - half} sessions, each predicted using only the sessions logged before it. Always guessing your average rating misses by ±${lateB.toFixed(1)}.</span></div>
      <div class="take"><b class="mono" style="font-size:1.3rem">${MODEL.labels[order[0][0]].replace(/ \(.*\)/, '')}</b><span>is the input that matters most, then ${MODEL.labels[order[1][0]].replace(/ \(.*\)/, '').toLowerCase()}.</span></div>`;
  }

  function learn() {
    const m = MODEL.targets[target], p = m.preq, host = clear('learn');
    const w = 700, h = 230, L = 40, B = 34, T = 14, R = 14, K = 6;
    const roll = key => p.map((_, i) => { const a = p.slice(Math.max(0, i - K + 1), i + 1); return a.reduce((s, q) => s + Math.abs(q.actual - q[key]), 0) / a.length; });
    const em = roll('model'), eb = roll('base');
    const top = Math.ceil(Math.max(...em, ...eb) + 0.3);
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Rolling prediction error of the model against a plain guess, session by session' }, host);
    const x = i => L + (i / (p.length - 1)) * (w - L - R), y = v => h - B - (v / top) * (h - B - T);
    for (let v = 0; v <= top; v++) { el('line', { x1: L, x2: w - R, y1: y(v), y2: y(v), stroke: C.rule }, svg); txt(svg, L - 6, y(v) + 4, v, { 'text-anchor': 'end' }); }
    txt(svg, L, h - 4, `session ${p[0].i}`, {}); txt(svg, w - R, h - 4, `session ${p[p.length - 1].i}`, { 'text-anchor': 'end' });
    txt(svg, (L + w) / 2, h - 4, 'oldest → newest', { 'text-anchor': 'middle' });
    txt(svg, L + 4, T + 2, 'points off (last 6)', {});
    const line = (arr, col, wdt) => el('path', { d: arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), fill: 'none', stroke: col, 'stroke-width': wdt, 'stroke-linejoin': 'round' }, svg);
    line(eb, C.fg3, 2); line(em, C.swell, 2.5);
    [[em, C.swell], [eb, C.fg3]].forEach(([a, col]) => el('circle', { cx: x(a.length - 1), cy: y(a[a.length - 1]), r: 4, fill: col, stroke: C.panel, 'stroke-width': 2 }, svg));
    p.forEach((q, i) => hover(el('rect', { x: x(i) - (w - L - R) / p.length / 2, y: T, width: (w - L - R) / p.length, height: h - B - T, fill: 'transparent' }, svg),
      `<b>Session ${q.i} · ${q.date}</b><br>you rated ${q.actual.toFixed(1)}<br>model guessed ${q.model.toFixed(1)} (from ${q.i - 1} earlier logs)<br>plain guess ${q.base.toFixed(1)}`));
  }

  function coefs() {
    const m = MODEL.targets[target], host = clear('coefs');
    const w = 700, rowH = 44, L = 250, R = 24, T = 18, h = T + MODEL.feats.length * rowH + 8;
    const lim = Math.max(1, ...m.coef_hi.map(Math.abs), ...m.coef_lo.map(Math.abs));
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Model weights with bootstrap ranges' }, host);
    const x = v => L + ((v + lim) / (2 * lim)) * (w - L - R);
    el('line', { x1: x(0), x2: x(0), y1: T - 8, y2: h - 4, stroke: C.fg3 }, svg);
    [-lim, -lim / 2, lim / 2, lim].forEach(v => txt(svg, x(v), 10, (v > 0 ? '+' : '') + v.toFixed(1), { 'text-anchor': 'middle' }));
    MODEL.feats.forEach((f, j) => {
      const y = T + j * rowH + rowH / 2, c = m.coef[j], col = c >= 0 ? C.swell : C.cool;
      txt(svg, L - 12, y - 2, MODEL.labels[f], { 'text-anchor': 'end', fill: C.fg, 'font-size': 12.5, 'font-family': css('--body') });
      txt(svg, L - 12, y + 14, `positive in ${Math.round(m.sign_pos[j] * 100)}% of resamples`, { 'text-anchor': 'end', 'font-size': 10 });
      el('rect', { x: Math.min(x(0), x(c)), y: y - 7, width: Math.abs(x(c) - x(0)), height: 14, fill: col, rx: 2, opacity: 0.9 }, svg);
      el('line', { x1: x(m.coef_lo[j]), x2: x(m.coef_hi[j]), y1: y, y2: y, stroke: C.fg, 'stroke-width': 1.5 }, svg);
      [m.coef_lo[j], m.coef_hi[j]].forEach(v => el('line', { x1: x(v), x2: x(v), y1: y - 5, y2: y + 5, stroke: C.fg, 'stroke-width': 1.5 }, svg));
      txt(svg, x(c) + (c >= 0 ? 6 : -6), y - 10, (c >= 0 ? '+' : '') + c.toFixed(2), { 'text-anchor': c >= 0 ? 'start' : 'end', fill: C.fg });
    });
  }

  function scatters() {
    const host = clear('scatters'), m = MODEL.targets[target], ss = MODEL.sessions;
    MODEL.scat.forEach((f, j) => {
      const box = document.createElement('div'); host.appendChild(box);
      const inModel = MODEL.feats.includes(f);
      box.innerHTML = `<div class="mlabel"><span>${MODEL.labels[f]}</span><b>ρ ${m.uni[f] >= 0 ? '+' : ''}${m.uni[f].toFixed(2)}</b></div>`;
      const w = 240, h = 170, L = 26, B = 20, T = 8, R = 8;
      const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': `${MODEL.labels[f]} against ${TNAME[target]}` }, box);
      el('rect', { x: 0.5, y: 0.5, width: w - 1, height: h - 1, fill: 'none', stroke: inModel ? C.swell : C.rule, rx: 4 }, svg);
      const xs = ss.map(s => s.x[j]), lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.06 || 1;
      const X = v => L + ((v - lo + pad) / (hi - lo + 2 * pad)) * (w - L - R), Y = v => h - B - (v / 10) * (h - B - T);
      [0, 5, 10].forEach(v => { el('line', { x1: L, x2: w - R, y1: Y(v), y2: Y(v), stroke: C.rule }, svg); txt(svg, L - 4, Y(v) + 4, v, { 'text-anchor': 'end', 'font-size': 10 }); });
      const ticks = f === 'swell' ? [0, 3, 10, 30].map(v => [Math.log1p(v), v]) : [[lo, lo], [(lo + hi) / 2, (lo + hi) / 2], [hi, hi]];
      ticks.forEach(([v, lab]) => { if (v < lo - pad || v > hi + pad) return; txt(svg, X(v), h - 5, Math.abs(lab) >= 10 || f === 'swell' ? Math.round(lab) : (+lab).toFixed(1), { 'text-anchor': 'middle', 'font-size': 10 }); });
      ss.forEach(s => {
        const c = el('circle', { cx: X(s.x[j]), cy: Y(s[target]), r: 4, fill: inModel ? C.swell : C.fg2, 'fill-opacity': 0.85, stroke: C.panel, 'stroke-width': 1.5 }, svg);
        hover(c, `<b>${s.date}</b><br>${TNAME[target]}: ${s[target]}<br>${MODEL.labels[f]}: ${f === 'swell' ? Math.expm1(s.x[j]).toFixed(1) + ' kW/m' : s.x[j].toFixed(1)}<br><span style="color:${C.fg2}">${String(s.notes || '').replace(/[&<>"']/g, (ch) => '&#' + ch.charCodeAt(0) + ';')}</span>`);
      });
    });
  }

  function goodMonths() {
    const host = clear('goodMonths'), v = DATA.good[dlKey()];
    const seen = new Set(MODEL.sessions.map(s => +s.date.slice(5, 7)));
    const w = 700, h = 220, L = 34, B = 24, T = 10, top = Math.ceil(Math.max(...v) / 10) * 10;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Share of days the model predicts 7 or better, by month' }, host);
    const pat = el('pattern', { id: 'hatch2', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('defs', {}, svg));
    el('rect', { width: 6, height: 6, fill: 'rgba(240,138,75,0.18)' }, pat);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'rgba(240,138,75,0.75)', 'stroke-width': 2 }, pat);
    const y = q => h - B - (q / top) * (h - B - T);
    for (let q = 0; q <= top; q += 10) { el('line', { x1: L, x2: w, y1: y(q), y2: y(q), stroke: C.rule }, svg); txt(svg, L - 6, y(q) + 4, q + '%', { 'text-anchor': 'end' }); }
    const bw = (w - L) / 12;
    v.forEach((q, i) => {
      const x = L + i * bw + bw * 0.18, bwid = bw * 0.64, known = seen.has(i + 1);
      el('rect', { x, y: y(q), width: bwid, height: Math.max(0, y(0) - y(q)), fill: known ? C.swell : 'url(#hatch2)', stroke: known ? 'none' : 'rgba(240,138,75,0.6)', rx: 2 }, svg);
      txt(svg, x + bwid / 2, h - 6, MON[i], { 'text-anchor': 'middle', fill: known ? C.fg : C.fg3 });
      if (q >= 1) txt(svg, x + bwid / 2, y(q) - 5, Math.round(q) + '%', { 'text-anchor': 'middle', fill: known ? C.fg : C.fg3 });
      hover(el('rect', { x: L + i * bw, y: T, width: bw, height: h - B - T, fill: 'transparent' }, svg),
        `<b>${MON[i]}</b><br>${q}% of days predicted 7+${known ? '' : '<br><i>no logged sessions this month: extrapolation</i>'}`);
    });
  }

  function modelAll() { modelTiles(); learn(); coefs(); scatters(); }


  // ══ THE TWO QUESTIONS ══════════════════════════════════════════════════
  // Both charts, and the answers in the page header, are computed here from the same data, so the numbers
  // quoted at the top can't drift from the charts.
  const setTxt = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  const fmtDay = iso => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

  // Question 1: your size ratings against the best 3 hours of the day at the buoy and modeled at Choc.
  // "Picks the bigger": of the pairs of sessions rated differently, the share where the higher reading
  // went with the higher rating (a tie in the reading counts as a miss; a coin flip gets 50%).
  function pickBigger(ix) {
    let c = 0, n = 0;
    for (let i = 0; i < SESSPAIRS.length; i++) for (let j = i + 1; j < SESSPAIRS.length; j++) {
      const a = SESSPAIRS[i], b = SESSPAIRS[j]; if (a[1] === b[1]) continue;
      n++; if (Math.sign(a[ix] - b[ix]) * Math.sign(a[1] - b[1]) > 0) c++;
    }
    return { c, n, pct: Math.round(100 * c / n) };
  }
  function q1Pair() {
    const host = document.getElementById('q1Pair'); if (!host || typeof SESSPAIRS === 'undefined') return; host.innerHTML = '';
    const res = {};
    for (const [ix, title, xl, xmax] of [[2, 'Raw buoy height', 'Block Island buoy, best 3 hours (ft)', 14], [3, 'Modeled height at Choc', 'Choc, modeled, best 3 hours (ft)', 8]]) {
      const r = res[ix] = pickBigger(ix), box = document.createElement('div'); host.appendChild(box);
      const w = 340, h = 300, L = 46, R = 12, T = 48, B = 42;
      const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': `${title}: picks the bigger of two sessions ${r.pct}% of the time (${r.c} of ${r.n} pairs)` }, box);
      txt(svg, L, 16, title, { fill: C.fg, 'font-size': 14, 'font-weight': 600, 'font-family': css('--body') });
      const t2 = txt(svg, L, 36, 'Picks the bigger of two sessions: ', { fill: C.fg2, 'font-size': 12, 'font-family': css('--body') });
      const tb = el('tspan', { fill: C.fg, 'font-size': 14, 'font-weight': 700 }, t2); tb.textContent = r.pct + '%';
      const x = v => L + (v / xmax) * (w - L - R), y = v => h - B - (v / 10) * (h - B - T);
      for (let v = 0; v <= 10; v += 2) { el('line', { x1: L, x2: w - R, y1: y(v), y2: y(v), stroke: C.rule }, svg); txt(svg, L - 6, y(v) + 4, v, { 'text-anchor': 'end' }); }
      for (let v = 0; v <= xmax; v += 2) txt(svg, x(v), h - B + 16, v, { 'text-anchor': 'middle' });
      txt(svg, (L + w - R) / 2, h - 6, xl, { 'text-anchor': 'middle', fill: C.fg2, 'font-family': css('--body') });
      txt(svg, 0, 0, 'Your size rating', { 'text-anchor': 'middle', fill: C.fg2, 'font-family': css('--body'), transform: `translate(12 ${(T + h - B) / 2}) rotate(-90)` });
      for (const s of SESSPAIRS) {
        const hi = s[1] <= 3 && s[2] > 4, cx = x(Math.min(s[ix], xmax)), cy = y(s[1]);
        el('circle', { cx, cy, r: 5, fill: hi ? C.cool : C.fg2, stroke: C.panel, 'stroke-width': 2, class: hi ? 'q1-hi' : 'q1-dot' }, svg);
        hover(el('circle', { cx, cy, r: 11, fill: 'transparent' }, svg), `<b>${fmtDay(s[0])}</b> · you rated size ${s[1]}/10<br>buoy ${s[2].toFixed(1)} ft · Choc ${s[3].toFixed(1)} ft (best 3 h)`);
      }
    }
    setTxt('qa1B', res[2].pct + '%'); setTxt('qa1M', res[3].pct + '%');
    // how closely each ranks the sessions by size (Spearman's ρ), and how the model compares with the buoy
    const size = SESSPAIRS.map(s => s[1]), rM = rankCorr(SESSPAIRS.map(s => s[3]), size), rB = rankCorr(SESSPAIRS.map(s => s[2]), size);
    if (rM != null && rB != null) {
      setTxt('q1RhoM', rM.toFixed(2)); setTxt('q1RhoB', rB.toFixed(2));
      const d = rM - rB;
      setTxt('q1Better', d >= 0.1 ? 'much better than' : d >= 0.03 ? 'better than' : d > -0.03 ? 'about as well as' : 'worse than');
    }
  }
  // Spearman's rank correlation, tied values sharing their average rank (so the order the sessions are listed in
  // doesn't matter); null with fewer than 3 pairs or nothing to rank
  function rankCorr(x, y) {
    const n = x.length; if (n < 3) return null;
    const rank = (a) => {
      const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(n);
      for (let i = 0; i < n;) { let j = i; while (j + 1 < n && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; }
      return r;
    };
    const rx = rank(x), ry = rank(y), mx = (n - 1) / 2;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - mx; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }

  // Question 2: on every day the model has Choc at 3 ft+ (at its biggest hour, all swells together), where
  // the swell bringing Choc the most energy came from: through the 115–158° window, south of it or east of it.
  function q2Share() {
    const host = document.getElementById('q2Share'); if (!host || typeof TRAINS === 'undefined') return;
    const n = { east: 0, in: 0, south: 0 };
    for (const k in TRAINS) {
      const tr = TRAINS[k][1]; if (!tr || !tr.length) continue;
      if (Math.sqrt(tr.reduce((a, t) => a + t[3] * t[3], 0)) < 3) continue;
      const top = tr.reduce((a, t) => (t[3] > a[3] ? t : a)), d = top[2];
      n[d < 115 ? 'east' : d <= 158 ? 'in' : 'south']++;
    }
    const N = n.east + n.in + n.south, pct = v => Math.round(100 * v / N), most = Math.max(n.east, n.in, n.south);
    host.innerHTML = [['east', 'East of the window', 'under 115°, bends in around Block Island'], ['in', 'Inside the window', '115–158°, a straight path to the reef'], ['south', 'South of the window', 'over 158°, bends in around Montauk']]
      .map(([k, lab, sub]) => `<div class="share-row${k === 'in' ? ' in' : ''}" data-k="${k}"><div class="share-lab"><b>${lab}</b><span>${sub}</span></div>` +
        `<div class="share-bar"><i style="width:calc((100% - 132px) * ${(n[k] / most).toFixed(3)})"></i><span class="share-val"><b>${pct(n[k])}%</b> · ${n[k]} days</span></div></div>`).join('');
    host.querySelectorAll('.share-row').forEach(r => { const k = r.dataset.k; hover(r, `<b>${r.querySelector('b').textContent}</b><br>${n[k]} of the ${N} days with 3 ft+ at Choc`); });
    setTxt('q2cIn', pct(n.in) + '%'); setTxt('q2cS', pct(n.south) + '%'); setTxt('q2cE', pct(n.east) + '%'); setTxt('q2cN', N);
    setTxt('qa2In', pct(n.in) + '%'); setTxt('qa2S', pct(n.south) + '%');
  }

  // Numbers the text quotes from the history, which the history bot extends every day (data/history/ →
  // research/hist.js): counted here from the same data, so the text keeps up with it. The markup carries the
  // values as of the page's build, for a browser without script.
  function histText() {
    const set = (k, v) => document.querySelectorAll(`[data-hist="${k}"]`).forEach((n) => { n.textContent = v; });
    const days = Object.keys(DAYS2).sort(), last = days[days.length - 1];
    if (last) {
      set('year', last.slice(0, 4));
      set('month', new Date(last + 'T12:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
      const inp = document.getElementById('dcDate'); if (inp) inp.max = last;
    }
    // swell trains at Choc's biggest hour each day: days with 2+ trains of 1 ft+ at the buoy; on Choc's 3 ft+
    // days, the biggest buoy train's share of Choc's energy, and the days another train made the surf
    let n = 0, multi = 0, notMain = 0; const share = [];
    for (const k in TRAINS) {
      const tr = TRAINS[k][1]; if (!tr) continue;
      n++; if (tr.filter((t) => t[0] >= 1).length >= 2) multi++;
      const tot = tr.reduce((a, t) => a + t[3] * t[3], 0);
      if (!tr.length || Math.sqrt(tot) < 3) continue;
      share.push(tr[0][3] * tr[0][3] / tot);
      if (tr.reduce((b, t, i) => (t[3] > tr[b][3] ? i : b), 0) !== 0) notMain++;
    }
    share.sort((a, b) => a - b);
    const pc = (v) => Math.round(100 * v) + '%', at = (q) => share[Math.floor(share.length * q)];
    if (n) set('tr-multi', pc(multi / n));
    if (share.length) { set('tr-med', at(0.5) >= 0.995 ? 'all' : pc(at(0.5))); set('tr-p10', pc(at(0.1))); set('tr-notmain', notMain); }
    // Wilderness vs Choc: days 2.5 ft+ (the monthly shares are of whole days, so they give back the counts)
    const W = WILDSTATS.months, count = (f) => W.reduce((a, m) => a + Math.round(m.days * m[f] / 100), 0), nd = W.reduce((a, m) => a + m.days, 0);
    set('w-wild', count('wild').toLocaleString('en-US')); set('w-choc', count('choc').toLocaleString('en-US')); set('w-beats', count('wild_beats').toLocaleString('en-US'));
    set('w-days', WILDSTATS.wild_days_total.toLocaleString('en-US'));
    if (nd) set('w-year', Math.round(WILDSTATS.wild_days_total / (nd / 365.25)));
  }

  // Numbers the text quotes from the surf log, which the history bot fits again whenever a session is logged
  // (results4.json's model, sess_pairs.json → research/hist.js): the counts, the months the sessions cover, the
  // flat ones, the order the model ranks its inputs in. The markup carries them as of the page's build.
  function logText() {
    const set = (k, v) => document.querySelectorAll(`[data-log="${k}"]`).forEach((n) => { n.textContent = v; });
    const ss = MODEL.sessions, n = ss.length, ms = ss.map(s => +s.date.slice(5, 7));
    set('pairs', SESSPAIRS.length);                 // sessions whose day the history covers (Question 1, the measures)
    set('model', n);                                // sessions with conditions at their hour (the ratings model)
    const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const span = (list) => {                         // [6..10, 12] → "June–October and December"
      const runs = [];
      [...new Set(list)].sort((a, b) => a - b).forEach((m) => { const r = runs[runs.length - 1]; if (r && m === r[1] + 1) r[1] = m; else runs.push([m, m]); });
      const parts = runs.map(([a, b]) => (a === b ? FULL[a - 1] : FULL[a - 1] + '–' + FULL[b - 1]));
      return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || '';
    };
    const winter = ms.filter(m => m >= 11 || m <= 5).length, hatched = 12 - new Set(ms).size;
    setTxt('goodMonthsNote', !hatched ? 'Every month has logged sessions.'
      : !winter ? `Hatched months have no logged sessions (all ${n} are ${span(ms)}), so the model has never seen winter water, winter wind or winter crowds, and those bars are extrapolation.`
      : `Hatched months have no logged sessions (the ${n} logged are from ${span(ms)}), so those bars are extrapolation.`);
    const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'], word = (k) => NUM[k] || String(k);
    const flat = ss.filter(s => s.size <= 1).length;
    setTxt('logAdvice', `The ratings model has ${n} Choc sessions, ${winter ? word(winter) + ' from November to May' : 'none from November to May'}, ` +
      `${flat ? (flat <= 3 ? 'only ' : '') + word(flat) + ' flat one' + (flat === 1 ? '' : 's') : 'no flat ones'}, and no logged Wilderness sessions.`);
    // the overall rating's inputs, biggest effect first
    const NAME = { swell: 'size', offshore: 'offshore wind', tide_rate: 'the tide' }, c = MODEL.targets.avg.coef;
    const o = MODEL.feats.map((f, j) => [f, Math.abs(c[j])]).sort((a, b) => b[1] - a[1]);
    if (o.length === 3 && o.every(([f]) => NAME[f])) {
      setTxt('qa1Order', o[0][0] === 'swell'
        ? `After size comes ${NAME[o[1][0]]}; ${NAME[o[2][0]]} ${o[2][1] < 0.25 * o[0][1] ? 'barely matters' : 'matters least'}.`
        : `${NAME[o[0][0]][0].toUpperCase() + NAME[o[0][0]].slice(1)} matters most, then ${NAME[o[1][0]]}, then ${NAME[o[2][0]]}.`);
    }
  }

  function byDaylight() { takeaways(); months(); events(); goodMonths(); }
  window.CHOC.onChange(byDaylight);
  byDaylight(); period(); sessChart(); modelAll(); q1Pair(); q2Share(); histText(); logText();
  addEventListener('lcc-theme-change', () => { byDaylight(); period(); sessChart(); modelAll(); q1Pair(); q2Share(); });
})();
