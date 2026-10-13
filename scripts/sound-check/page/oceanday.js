// ── WHAT WAS THE OCEAN DOING (day panels) ───────────────────────────────────
// For the date picked in "Check a date": the swell trains measured hour by hour at
// Block Island (CDIP 154) and at Montauk (44017, to Feb 2023) or the Long Island buoy (44025),
// the Copernicus wave model's primary swell, secondary swell and wind sea offshore, what each
// source says reached Choc, and a map of the model's swell field at one time step.
(function () {
  const inp = document.getElementById('dcDate'), host = document.getElementById('odWrap');
  if (!host) return;
  // the day shown follows the page's day (map Past view, month calendar, "Check a day" picker)
  let day = window.CHOC.D[window.CHOC.st.idx] ? window.CHOC.D[window.CHOC.st.idx].iso : '2025-10-12'; if (inp) { inp.value = day; if (window.CHOC.dcShow) window.CHOC.dcShow(); }
  const { C, css, perColor } = window.CHOC;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (nm, a, p) => { const e = document.createElementNS(NS, nm); for (const k in a) e.setAttribute(k, a[k]); p && p.appendChild(e); return e; };
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (d) => COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  const json = (u) => fetch(u).then((r) => r.ok ? r.json() : null).catch(() => null);
  const cache = {}; const load = (u) => cache[u] || (cache[u] = json(u));
  const fmtH = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

  // local (New York) hours of a date -> UTC keys "YYYY-MM-DDTHH"
  const NYF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  function dayHours(iso) {
    const out = []; const t0 = Date.parse(iso + 'T00:00:00Z') - 2 * 3600e3;
    for (let k = 0; k < 32; k++) {
      const t = t0 + k * 3600e3, p = Object.fromEntries(NYF.formatToParts(new Date(t)).map((q) => [q.type, q.value]));
      if (`${p.year}-${p.month}-${p.day}` === iso) out.push({ utc: new Date(t).toISOString().slice(0, 13), h: +p.hour });
    }
    return out;
  }

  // ── lanes (SVG): one per source; arrows at (hour, period), pointing where the swell travels
  let W = 700, L = 128, R = 14, laneH = 92, gap = 14, TT = 0;                     // TT: title row above each lane (narrow)
  const PMIN = 4, PMAX = 18;
  const x = (h) => L + h / 24 * (W - L - R);
  function layout() { const w = document.getElementById('odLanes').clientWidth || 700; if (w < 560) { W = Math.max(320, w); L = 4; R = 4; TT = 34; laneH = 84; } else { W = 700; L = 128; R = 14; TT = 0; laneH = 92; } }
  function arrow(g, cx, cy, from, ft, col) {
    const len = Math.min(30, 7 + 4.2 * ft), a = (from + 180) * Math.PI / 180, ux = Math.sin(a), uy = -Math.cos(a);
    const x1 = cx - ux * len / 2, y1 = cy - uy * len / 2, x2 = cx + ux * len / 2, y2 = cy + uy * len / 2, w = Math.min(3.2, 1.2 + ft * 0.35);
    el('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': w, 'stroke-linecap': 'round' }, g);
    const hx = -uy, hy = ux, s = 3 + w;
    el('path', { d: `M${x2 + ux * 2},${y2 + uy * 2}L${x2 - ux * s + hx * s * 0.7},${y2 - uy * s + hy * s * 0.7}L${x2 - ux * s - hx * s * 0.7},${y2 - uy * s - hy * s * 0.7}Z`, fill: col }, g);
  }
  function lane(svg, top0, title, sub, rows, hours) {
    // rows: [{h: local hour, trains: [[ft, s, from], ...]}]
    const top = top0 + TT, g = el('g', {}, svg), y = (p) => top + 6 + (1 - (Math.min(PMAX, Math.max(PMIN, p)) - PMIN) / (PMAX - PMIN)) * (laneH - 12);
    el('rect', { x: L, y: top, width: W - L - R, height: laneH, fill: 'rgba(255,255,255,.025)', rx: 4 }, g);
    [6, 10, 14].forEach((p) => { el('line', { x1: L, x2: W - R, y1: y(p), y2: y(p), stroke: C.rule }, g); const t = el('text', { x: L + 4, y: y(p) - 3, fill: C.fg3, 'font-size': 9, 'font-family': css('--mono') }, g); t.textContent = p + ' s'; });
    const t1 = el('text', { x: 0, y: TT ? top0 + 14 : top + 16, fill: C.fg, 'font-size': 12, 'font-weight': 600, 'font-family': css('--body') }, g); t1.textContent = title;
    (TT ? [sub.replace('\n', ' · ')] : sub.split('\n')).forEach((s, i) => { const t = el('text', { x: 0, y: TT ? top0 + 28 : top + 31 + i * 13, fill: C.fg3, 'font-size': 10, 'font-family': css('--mono') }, g); t.textContent = s; });
    if (!rows.length) { const t = el('text', { x: (L + W - R) / 2, y: top + laneH / 2 + 4, fill: C.fg3, 'font-size': 12, 'text-anchor': 'middle', 'font-family': css('--body') }, g); t.textContent = 'no data this day'; return; }
    for (const r of rows) for (const tr of r.trains) if (tr[0] >= 0.3 && tr[2] != null && tr[1] != null) arrow(g, x(r.h + 0.5), y(tr[1]), tr[2], tr[0], perColor(tr[1], 0.95));
  }
  function chocLane(svg, top0, lines, best) {
    const top = top0 + TT, g = el('g', {}, svg); const vmax = Math.max(2, ...lines.flatMap((l) => l.pts.map((p) => p[1])));
    const top2 = Math.ceil(vmax), y = (v) => top + laneH - 4 - v / top2 * (laneH - 12);
    el('rect', { x: L, y: top, width: W - L - R, height: laneH, fill: 'rgba(255,255,255,.025)', rx: 4 }, g);
    [0, top2 / 2, top2].forEach((v) => { el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: C.rule }, g); if (v) { const t = el('text', { x: L + 4, y: y(v) - 3, fill: C.fg3, 'font-size': 9, 'font-family': css('--mono') }, g); t.textContent = (+v.toFixed(1)) + ' ft'; } });
    const t1 = el('text', { x: 0, y: TT ? top0 + 14 : top + 16, fill: C.fg, 'font-size': 12, 'font-weight': 600, 'font-family': css('--body') }, g); t1.textContent = 'At Choc, modeled';
    lines.forEach((l, i) => {
      const t = el('text', TT ? { x: i * 120, y: top0 + 28, fill: l.col, 'font-size': 10, 'font-family': css('--mono') } : { x: 0, y: top + 31 + i * 13, fill: l.col, 'font-size': 10, 'font-family': css('--mono') }, g); t.textContent = '— ' + l.name;
      if (l.pts.length > 1) el('path', { d: l.pts.map((p, j) => `${j ? 'L' : 'M'}${x(p[0] + 0.5).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''), fill: 'none', stroke: l.col, 'stroke-width': 2.2, 'stroke-dasharray': l.dash || '', 'stroke-linejoin': 'round' }, g);
    });
    if (best != null) el('rect', { x: x(best), y: top, width: Math.min(x(best + 3), W - R) - x(best), height: laneH, fill: 'rgba(240,138,75,.08)' }, g);
  }

  // ── map of the model's swell field
  const cv = document.getElementById('odMap'), slider = document.getElementById('odT'), tl = document.getElementById('odTl');
  const ctx = cv.getContext('2d');
  let FM = null, atl = null, fieldDay = null;
  const SCR = {};                                   // working canvases, reused on every redraw (Safari caps canvas memory)
  const img = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
  async function fieldFor(month) {
    const k = 'f' + month;                            // one PNG per year
    if (cache[k]) return cache[k];
    cache[k] = (async () => {
      FM = FM || await load('ocean/field/meta.json'); if (!FM || !FM.months[month]) return null;
      const im = await img(`ocean/field/${month}.png`); if (!im) return null;
      return { px: window.CHOC.pixels(im), w: im.width, start: Date.parse(FM.months[month][0] + ':00Z'), n: FM.months[month][1] };
    })();
    return cache[k];
  }
  const BOUNDS = [-75.2, -66.0, 37.8, 42.2];                      // lon0, lon1, lat0, lat1 drawn
  function drawField(step) {
    const b = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (!b.width) return;
    cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = b.width, ch = b.height, cl = Math.cos(40 * Math.PI / 180);
    const sx = cw / ((BOUNDS[1] - BOUNDS[0]) * cl), sy = ch / (BOUNDS[3] - BOUNDS[2]), s = Math.min(sx, sy);
    const ox = (cw - (BOUNDS[1] - BOUNDS[0]) * cl * s) / 2, oy = (ch - (BOUNDS[3] - BOUNDS[2]) * s) / 2;
    const X = (lon) => ox + (lon - BOUNDS[0]) * cl * s, Y = (lat) => oy + (BOUNDS[3] - lat) * s;
    ctx.fillStyle = '#0b1622'; ctx.fillRect(0, 0, cw, ch);
    if (atl) { const m = atl.meta.bounds, hx = 1 / 240; ctx.drawImage(atl.im, X(m[0] - hx), Y(m[3] + hx), X(m[1] + hx) - X(m[0] - hx), Y(m[2] - hx) - Y(m[3] + hx)); }
    if (!fieldDay || !FM) return;
    const f = fieldDay.months[step.m]; if (!f) return;
    const row = step.i, NLA = FM.lat.length, NLO = FM.lon.length, dLa = FM.lat[1] - FM.lat[0], dLo = FM.lon[1] - FM.lon[0];
    const val = (i, j, q) => f.px[(row * f.w + (i * NLO + j) * 3) * 4 + q];        // 3 RGB pixels per cell
    // color: primary swell height, one pixel per cell (land cells borrow a neighbor), scaled up
    // smoothly, then clipped to the sea with the ETOPO water mask
    const off = SCR.off || (SCR.off = document.createElement('canvas')); off.width = NLO; off.height = NLA;   // reused: see CHOC.pixels
    const og = off.getContext('2d'), id = og.createImageData(NLO, NLA);
    const hAt = (i, j) => { const h = val(i, j, 0); if (h !== 255) return h; let s = 0, n = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NLA || jj >= NLO) continue; const v = val(ii, jj, 0); if (v !== 255) { s += v; n++; } }
      return n ? s / n : 255; };
    for (let i = 0; i < NLA; i++) for (let j = 0; j < NLO; j++) {
      const h = hAt(i, j), p = 4 * ((NLA - 1 - i) * NLO + j); if (h === 255) continue;
      const ft = h / 10 * 3.28084, c = heightRGB(ft);
      id.data[p] = c[0]; id.data[p + 1] = c[1]; id.data[p + 2] = c[2]; id.data[p + 3] = Math.round(255 * Math.min(0.7, 0.2 + ft / 14));
    }
    og.putImageData(id, 0, 0);
    const lay = SCR.lay || (SCR.lay = document.createElement('canvas')); lay.width = cv.width; lay.height = cv.height;
    const lg = lay.getContext('2d'); lg.setTransform(dpr, 0, 0, dpr, 0, 0); lg.imageSmoothingEnabled = true; lg.imageSmoothingQuality = 'high';
    lg.drawImage(off, X(FM.lon[0] - dLo / 2), Y(FM.lat[NLA - 1] + dLa / 2), X(FM.lon[NLO - 1] + dLo / 2) - X(FM.lon[0] - dLo / 2), Y(FM.lat[0] - dLa / 2) - Y(FM.lat[NLA - 1] + dLa / 2));
    if (atl && atl.mask) { const m = atl.meta.bounds, hx = 1 / 240; lg.globalCompositeOperation = 'destination-in'; lg.drawImage(atl.mask, X(m[0] - hx), Y(m[3] + hx), X(m[1] + hx) - X(m[0] - hx), Y(m[2] - hx) - Y(m[3] + hx)); }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lay, 0, 0); ctx.restore();
    // arrows: primary swell direction (length by period), every other cell
    for (let i = 0; i < NLA; i += 1) for (let j = 0; j < NLO; j += 1) {
      if (cw < 560 ? (i % 2 || j % 2) : (i + j) % 2) continue;                // thinner on phones
      const h = val(i, j, 0), T = val(i, j, 1), d = val(i, j, 2); if (h === 255 || d === 255) continue;
      const per = T / 10, from = d * 2, len = Math.max(6, Math.min(22, per * 1.6)), a = (from + 180) * Math.PI / 180;
      const cx = X(FM.lon[j]), cy = Y(FM.lat[i]), ux = Math.sin(a), uy = -Math.cos(a);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx - ux * len / 2, cy - uy * len / 2); ctx.lineTo(cx + ux * len / 2, cy + uy * len / 2); ctx.stroke();
      const hx = -uy, hy = ux, ex = cx + ux * len / 2, ey = cy + uy * len / 2;
      ctx.beginPath(); ctx.moveTo(ex + ux * 2, ey + uy * 2); ctx.lineTo(ex - ux * 4 + hx * 3, ey - uy * 4 + hy * 3); ctx.lineTo(ex - ux * 4 - hx * 3, ey - uy * 4 - hy * 3); ctx.fill();
    }
    // places
    const pin = (lon, lat, t, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(lon), Y(lat), 3.5, 0, 7); ctx.fill(); ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = '#e7edf2'; ctx.textAlign = 'left'; ctx.fillText(t, X(lon) + 6, Y(lat) + 4); };
    const lgx = 10, lgy = ch - 22, lgw = Math.min(180, cw * 0.4);
    for (let k = 0; k < lgw; k++) { const c = heightRGB(k / lgw * 12); ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(lgx + k, lgy, 1, 8); }
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = '#e7edf2'; ctx.textAlign = 'left'; ctx.fillText('0', lgx, lgy - 3); ctx.textAlign = 'right'; ctx.fillText('12+ ft primary swell', lgx + lgw, lgy - 3);
    pin(-71.96, 41.276, 'Choc', '#f08a4b'); pin(-71.127, 40.969, '44097', '#ffffff'); pin(-71.6, 40.6, 'model', '#4fb6c9');
    if (step.ndbc === '44017') pin(-72.049, 40.694, '44017', '#ffffff'); else pin(-73.164, 40.251, '44025', '#ffffff');
  }
  function heightRGB(ft) {                          // 0 ft blue -> 12 ft+ red
    const stops = [[40, 90, 150], [79, 182, 201], [216, 209, 122], [240, 138, 75], [214, 69, 80]], t = Math.max(0, Math.min(1, ft / 12)) * 4, i = Math.min(3, Math.floor(t)), f = t - i;
    return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  }

  // ── render a day
  let token = 0;
  async function show() {
    const iso = day, my = ++token; if (!iso) return;
    const dl = document.getElementById('odDay'); if (dl) dl.textContent = new Date(iso + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const hours = dayHours(iso), yrs = [...new Set(hours.map((h) => h.utc.slice(0, 4)))];
    const ndbcSt = iso < '2023-02-10' ? '44017' : '44025';
    const files = (await Promise.all(yrs.map((y) => load(`ocean/day/${y}.json`)))).map((o) => o || {});
    const get = (key) => Object.assign({}, ...files.map((f) => f[key] || {}));
    const bi = get('44097'), nb = get(ndbcSt), wm = get('wm');
    if (my !== token) return;
    const rowsOf = (src) => hours.filter((h) => src[h.utc]).map((h) => ({ h: h.h, trains: src[h.utc] }));
    const wmRows = hours.filter((h) => wm[h.utc]).map((h) => { const v = wm[h.utc]; return { h: h.h, trains: [[v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]]].filter((q) => q[0] != null), choc: v[9] }; });
    const lanesHost = document.getElementById('odLanes'); lanesHost.innerHTML = ''; layout();
    const LH = laneH + gap + TT;
    const svg = el('svg', { viewBox: `0 0 ${W} ${4 * LH + 22}`, role: 'img', 'aria-label': 'Swell trains by hour at each source, and modeled Choc height' }, lanesHost);
    lane(svg, 0, 'Block Island buoy', '44097 · measured\nevery hour', rowsOf(bi), hours);
    lane(svg, LH, ndbcSt === '44017' ? 'Montauk buoy' : 'Long Island buoy', `${ndbcSt} · measured\n${ndbcSt === '44017' ? '23 nm SSE of Montauk' : '30 nm S of Islip'}`, rowsOf(nb), hours);
    lane(svg, 2 * LH, 'Copernicus model', '40.6 N 71.6 W\nevery 3 hours', wmRows, hours);
    const v = DAYS2[iso], best = v ? v[7] : null;
    const biChoc = rowsOf(bi).map((r) => [r.h, Math.sqrt(r.trains.reduce((s, q) => s + (q[3] || 0) ** 2, 0))]);
    chocLane(svg, 3 * LH, [{ name: 'from the buoy', col: C.swell, pts: biChoc }, { name: 'from the model', col: C.cool, dash: '5 4', pts: wmRows.map((r) => [r.h, r.choc]) }], best);
    [0, 6, 12, 18, 24].forEach((h) => { const t = el('text', { x: x(h), y: 4 * LH + 12, fill: C.fg3, 'font-size': 10, 'font-family': css('--mono'), 'text-anchor': h === 0 ? 'start' : 'middle' }, svg); t.textContent = h === 24 ? '' : h === 0 ? 'midnight' : h === 12 ? 'noon' : fmtH(h); });
    // map steps: the model's 3-hourly times during this day
    FM = FM || await load('ocean/field/meta.json');
    const steps = [];
    if (FM) for (const h of hours) {
      const m = h.utc.slice(0, 4), mm = FM.months[m]; if (!mm) continue;
      const i = Math.round((Date.parse(h.utc + ':00:00Z') - Date.parse(mm[0] + ':00Z')) / 3 / 3600e3);
      if (Date.parse(h.utc + ':00:00Z') === Date.parse(mm[0] + ':00Z') + i * 3 * 3600e3 && i >= 0 && i < mm[1]) steps.push({ m, i, h: h.h, ndbc: ndbcSt });
    }
    fieldDay = { months: {} };
    for (const m of new Set(steps.map((s) => s.m))) fieldDay.months[m] = await fieldFor(m);
    if (my !== token) return;
    slider.max = Math.max(0, steps.length - 1);
    let si = best != null ? steps.findIndex((s) => s.h >= best) : -1; if (si < 0) si = Math.floor(steps.length / 2);
    slider.value = si; slider.disabled = !steps.length;
    const paint = () => { const s = steps[+slider.value]; tl.textContent = s ? fmtH(s.h) : 'no model map for this day'; if (s) drawField(s); else drawField({ m: '', i: 0 }); };
    slider.oninput = paint; host._paint = paint; paint();
    // summary at Choc's best hour
    const pick = best != null ? hours.find((h) => h.h === best + 1) || hours.find((h) => h.h === best) : null;
    // each source's swells, biggest first, one line per source: "1° 8.1 ft @ 14 s SSE · 2° 7.0 ft @ 6 s NE"
    const desc = (trs) => trs.filter((q) => q[0] >= 0.5).slice().sort((a, b) => b[0] - a[0]).slice(0, 3).map((q, i) => `${i + 1}° ${(+q[0]).toFixed(1)} ft @ ${Math.round(q[1])} s ${compass(q[2])}`).join(' · ') || 'flat';
    const nearest3 = pick ? wmRows.reduce((a, r) => (!a || Math.abs(r.h - pick.h) < Math.abs(a.h - pick.h) ? r : a), null) : null;
    document.getElementById('odNote').innerHTML = pick ? window.CHOC.kv([[`Around ${fmtH(pick.h)}, Choc's best hours`, null],
      ['Block Island', bi[pick.utc] ? desc(bi[pick.utc]) : '—'], [ndbcSt === '44017' ? 'Montauk' : 'Long Island', nb[pick.utc] ? desc(nb[pick.utc]) : '—'],
      ['Model', nearest3 ? desc(nearest3.trains) : '—']]) : '';
  }
  load('ocean/atl_meta.json').then(async (m) => { const [im, mask] = await Promise.all([img('ocean/atlantic.jpg'), img('ocean/water_mask.png')]); if (m && im) { atl = { meta: m, im, mask }; host._paint && host._paint(); } });
  new ResizeObserver(() => host._paint && host._paint()).observe(cv);
  let narrow = null;                                    // redraw the lanes when the layout switches
  new ResizeObserver(() => { const n = (document.getElementById('odLanes').clientWidth || 700) < 560; if (narrow !== null && n !== narrow && started) show(); narrow = n; }).observe(document.getElementById('odLanes'));
  function setDay(iso) { if (!iso || iso === day) return; day = iso; if (started) show(); }
  if (inp) inp.addEventListener('change', () => {                // the picker makes that day the page's day (map, calendar, these panels)
    const i = window.CHOC.dayIndex(inp.value);
    if (i >= 0) { if (window.CHOC.pastStop) window.CHOC.pastStop(); window.CHOC.jump(i); } else setDay(inp.value);
  });
  // follow the page's day; while the map's Past view is playing, wait until it stops
  let pending = null;
  window.CHOC.onDay((i) => { const d = window.CHOC.D[i]; if (!d) return; if (inp && inp.value !== d.iso) { inp.value = d.iso; if (window.CHOC.dcShow) window.CHOC.dcShow(); } if (window.CHOC.st.playing) pending = d.iso; else setDay(d.iso); });
  setInterval(() => { if (pending && !window.CHOC.st.playing) { setDay(pending); pending = null; } }, 700);
  let started = false;
  new IntersectionObserver((es) => { if (!started && es.some((e) => e.isIntersecting)) { started = true; show(); } }, { rootMargin: '300px' }).observe(host);
  addEventListener('lcc-theme-change', () => { if (started) show(); });
})();
