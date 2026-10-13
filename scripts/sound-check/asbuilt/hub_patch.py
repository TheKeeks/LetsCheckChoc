import sys
p = 'ocean.js'; s = open(p).read()
def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count: sys.exit(f'expected {count} got {n}: {old[:90]!r}')
    s = s.replace(old, new)

rep("  const cv = $('tripCv'); if (!cv) return;\n", "  const cv = $('tripCv'); if (!cv) return;\n  const stage = cv.parentElement;\n")

# ── overlay-aware geometry
rep("""  function fitCam(pts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [lo, la] of pts) { const [x, y] = P(lo, la); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // leave the top ~90 px for the readout: fit into the area below it
    const top = 90, m = Math.min(cw, chh), availH = Math.max(1, chh - top - 20);
    const W = Math.min(1100, Math.max(30, Math.max((x1 - x0) * m / Math.max(1, cw - 40), (y1 - y0) * m / availH) * 1.1));
    const sc = m / W;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (top - 20) / 2 / sc, W };
  }""", """  // the part of the map the overlays leave clear (px): readout on top, buttons and the layers
  // panel on the right, timeline or play bar at the bottom
  function insets() {
    const H = stage.clientHeight, Wd = stage.clientWidth, hud = stage.querySelector('.trip-hud');
    const bot = [...stage.querySelectorAll('.hub-bot')].find((e) => !e.hidden), tr = $('hubTr'), pn = $('hubPanel');
    let right = tr ? Wd - tr.offsetLeft + 6 : 0;
    if (pn && !pn.hidden && stage.classList.contains('hub-wide')) right = Wd - pn.offsetLeft + 8;
    return { top: hud ? hud.offsetTop + hud.offsetHeight + 12 : 80, bottom: bot ? H - bot.offsetTop + 8 : 0, right };
  }
  let RECTS = [], INS = { top: 80, bottom: 0, right: 0 };
  function overlayRects() {                                  // boxes of the visible controls, in canvas px
    const sb = stage.getBoundingClientRect(), out = [];
    for (const el of stage.querySelectorAll('.hub-tr, .hub-panel, .hub-info, .hub-bar, .hub-chip, .hub-key, .trip-inset')) {
      if (el.hidden || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect(); out.push([r.left - sb.left - 4, r.top - sb.top - 4, r.right - sb.left + 4, r.bottom - sb.top + 4]);
    }
    return out;
  }
  const covered = (x0, y0, x1, y1) => RECTS.some((r) => x1 > r[0] && x0 < r[2] && y1 > r[1] && y0 < r[3]);
  function fitBox(p0, p1, pad, cap) {                        // camera that fits the km box p0-p1 into the clear area
    if (!cw || !chh) return { cx: (p0[0] + p1[0]) / 2, cy: (p0[1] + p1[1]) / 2, W: cap ? cap[1] : 1000 };
    const ins = insets(), m = Math.min(cw, chh), aw = Math.max(60, cw - ins.right - 16), ah = Math.max(60, chh - ins.top - ins.bottom - 8);
    let W = Math.max(Math.abs(p1[0] - p0[0]) * m / aw, Math.abs(p1[1] - p0[1]) * m / ah) * pad;
    if (cap) W = Math.min(cap[1], Math.max(cap[0], W));
    const sc = m / W, fx = 8 + aw / 2, fy = ins.top + ah / 2;
    return { cx: (p0[0] + p1[0]) / 2 - (fx - cw / 2) / sc, cy: (p0[1] + p1[1]) / 2 - (fy - chh / 2) / sc, W };
  }
  function fitCam(pts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [lo, la] of pts) { const [x, y] = P(lo, la); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return fitBox([x0, y0], [x1, y1], 1.1, [30, 1100]);
  }""")
rep("""    const k = rem / (rem + 3);
    return { cx: lerp(end[0], (hd[0] + end[0]) / 2, k), cy: lerp(end[1], (hd[1] + end[1]) / 2, k), W };""",
"""    const k = rem / (rem + 3), sc = Math.min(cw, chh) / W, ins = cw ? insets() : { top: 0, bottom: 0, right: 0 };
    // centred in the part of the map the overlays leave clear
    return { cx: lerp(end[0], (hd[0] + end[0]) / 2, k) + ins.right / 2 / sc, cy: lerp(end[1], (hd[1] + end[1]) / 2, k) - (ins.top - ins.bottom) / 2 / sc, W };""")
rep("""  const hudBottom = () => { const h = document.querySelector('.trip-hud'); return h ? h.offsetTop + h.offsetHeight + 14 : 80; };   // keep place names clear of the readout
""", """  const hudBottom = () => INS.top;
""")
rep("""  function draw() {
    if (!cw) return;
    INSET = false; render(cam());""", """  function draw() {
    if (!cw) return;
    INS = insets(); RECTS = overlayRects();
    INSET = false; render(cam());
    if (reduce && S.phase === 'week') fxStatic();""")
rep("""      if (lx - hw < 0 || lx + hw > cw || (!INSET && ly < hudBottom()) || ly > chh - 6) continue;
      if (WEEK && lx - hw < 175 && ly > chh - 48) continue;            // clear of the height key""",
"""      if (lx - hw < 0 || lx + hw > cw || ly > chh - 6) continue;
      if (!INSET && (ly < INS.top || covered(lx - hw, ly - 12, lx + hw, ly + 4))) continue;   // keep clear of the controls""")

# ── spots, layers
rep("""  const FC = { d: null, model: 'gfs', i: 0, px: {}, cv: {}, timer: 0, files: {}, cur: [], pick: null, zoom: 'reg', aim: {}, tf: new Map(), ecIx: [], arr: {} };""",
"""  const FC = { d: null, model: 'gfs', spot: 'choc', i: 0, px: {}, cv: {}, timer: 0, files: {}, cur: [], pick: null, zoom: 'reg', aim: {}, tf: new Map(), ecIx: [], arr: {}, cam: null,
    show: { field: true, flow: true, aim: true, rays: true } };
  try { Object.assign(FC.show, JSON.parse(localStorage.getItem('choc.fcLayers') || '{}')); } catch (e) { /* defaults */ }
  // the two spots: where swell is aimed, and the wind that grooms each (offshore direction, tolerance)
  const SPOT = { choc: { name: 'Choc', pt: PEAK, off: 335, tol: 60 }, wild: { name: 'Wilderness', pt: [(W1[0] + W2[0]) / 2, (W1[1] + W2[1]) / 2], off: 40, tol: 70 } };""")
rep("""  const ZOOMS = { ocean: [[-82, 12], [-14, 58]], reg: [[-77.5, 35], [-62, 45.5]], fi: [[-72.25, 40.95], [-71.45, 41.35]] };""",
"""  const ZOOMS = { ocean: [[-82, 12], [-14, 58]], reg: [[-76.5, 34.6], [-63.5, 42.8]], fi: [[-72.25, 40.95], [-71.45, 41.35]] };""")
rep("""  // Choc is clean in light wind or wind within 60 deg of 335 (straight offshore over the reef)
  function windKind(w) { if (!w) return null; if (w[0] < 6) return 'light'; const g = Math.abs(((w[1] - 335 + 540) % 360) - 180); return g <= 60 ? 'offshore' : g >= 120 ? 'onshore' : 'cross'; }""",
"""  // clean in light wind or wind near straight offshore: Choc 335 +-60, Wilderness 40 +-70 (as in Part 3)
  function windKind(w, spot) {
    if (!w) return null; if (w[0] < 6) return 'light';
    const q = SPOT[spot || FC.spot], g = Math.abs(((w[1] - q.off + 540) % 360) - 180);
    return g <= q.tol ? 'offshore' : g >= 180 - q.tol ? 'onshore' : 'cross';
  }""")
rep("""  function reefSees(T, from) {                               // share of a swell from `from` that reaches Choc (Part 2's kernel, as a height factor)
    const k = Math.round(T) + '_' + Math.round(from); if (FC.tf.has(k)) return FC.tf.get(k);
    const v = window.CHOC.lab ? window.CHOC.lab.trainFactor(Math.round(T), Math.round(from), 15, 'choc') : 0; FC.tf.set(k, v); return v;
  }
  function fcAimed(model, step) {
    const key = model + step; if (FC.aim[key]) return FC.aim[key];
    const out = [], R = ZOOMS.reg; let ok = true;""",
"""  function reefSees(T, from, spot) {                         // share of a swell from `from` that reaches the spot (Part 2's kernel, as a height factor)
    const k = spot + Math.round(T) + '_' + Math.round(from); if (FC.tf.has(k)) return FC.tf.get(k);
    const v = window.CHOC.lab ? window.CHOC.lab.trainFactor(Math.round(T), Math.round(from), 15, spot) : 0; FC.tf.set(k, v); return v;
  }
  function fcAimed(model, step, spot) {
    const key = model + spot + step; if (FC.aim[key]) return FC.aim[key];
    const out = [], Rg = FC.d.grids.reg, R = [[Rg.lon[0], Rg.lat[1]], [Rg.lon[1], Rg.lat[0]]], tgt = SPOT[spot].pt; let ok = true;""")
rep("""        const km = gcKm([lon, lat], PEAK); if (km < 150) continue;      // the near field is the edge model's job
        const off = Math.abs((((v[2] + 180) % 360) - gcBrg([lon, lat], PEAK) + 540) % 360 - 180); if (off > 10) continue;
        const tf = reefSees(v[1], gcBrg(PEAK, [lon, lat])); if (tf < 0.12 || v[0] * tf < 0.2) continue;""",
"""        const km = gcKm([lon, lat], tgt); if (km < 150) continue;       // the near field is the edge model's job
        const off = Math.abs((((v[2] + 180) % 360) - gcBrg([lon, lat], tgt) + 540) % 360 - 180); if (off > 10) continue;
        const tf = reefSees(v[1], gcBrg(tgt, [lon, lat]), spot); if (tf < 0.12 || v[0] * tf < 0.2) continue;""")
rep("""  function fcArrivals(model) {
    if (FC.arr[model]) return FC.arr[model];""", """  function fcArrivals(model, spot) {
    const ak = model + spot; if (FC.arr[ak]) return FC.arr[ak];""")
rep("""      const t0 = Date.parse(src[s].t), cells = fcAimed(model, s);
      if (!FC.aim[model + s]) return null;                   // fields still loading""",
"""      const t0 = Date.parse(src[s].t), cells = fcAimed(model, s, spot);
      if (!FC.aim[model + spot + s]) return null;            // fields still loading""")
rep("""    return (FC.arr[model] = a);""", """    return (FC.arr[ak] = a);""")
rep("""  const chocFt = (model, i) => (model === 'gfs' ? FC.d.gfs[i].choc : (ecRow(i) || {}).choc);""",
"""  const spotFt = (model, i, spot) => (model === 'gfs' ? FC.d.gfs[i][spot || FC.spot] : (ecRow(i) || {})[spot || FC.spot]);""")
rep("""  function weekHud() {
    const i = FC.i, g = FC.d.gfs[i], e = ecRow(i), t = Date.parse(g.t), c = chocFt(FC.model, i), wk = windKind(g.wind);
    $('tripPhase').textContent = `${fcWhen(t)} · Choc ${c == null ? '–' : c.toFixed(1) + ' ft'}`;
    const main = FC.model === 'gfs' ? [...g.trains].sort((a, b) => b.choc - a.choc)[0] : e;
    $('tripLine').textContent = `GFS ${g.choc.toFixed(1)} · ECMWF ${e ? e.choc.toFixed(1) : '–'} ft` + (main ? ` · ${Math.round(main.T)} s from ${compass(main.D)}` : '') +""",
"""  function weekHud() {
    const i = FC.i, g = FC.d.gfs[i], e = ecRow(i), t = Date.parse(g.t), sp = FC.spot, c = spotFt(FC.model, i), wk = windKind(g.wind);
    $('tripPhase').textContent = `${fcWhen(t)} · ${SPOT[sp].name} ${c == null ? '–' : c.toFixed(1) + ' ft'}`;
    const main = FC.model === 'gfs' ? [...g.trains].sort((a, b) => b[sp] - a[sp])[0] : e;
    $('tripLine').textContent = `GFS ${g[sp].toFixed(1)} · ECMWF ${e ? e[sp].toFixed(1) : '–'} ft` + (main ? ` · ${Math.round(main.T)} s from ${compass(main.D)}` : '') +""")

# ── field / streak / dots / rays toggles
rep("""    const fa = fieldAlpha(v.W); if (fa <= 0.01 || !FC.d) return;
    const rw = Math.round(cw * dpr)""", """    const fa = fieldAlpha(v.W); if (fa <= 0.01 || !FC.d || !FC.show.field) return;
    const rw = Math.round(cw * dpr)""")
rep("""    bx = Math.max(6, Math.min(cw - w - 6, bx)); if (by < hudBottom()) by = y + 12;""",
"""    bx = Math.max(6, Math.min(cw - w - 6 - INS.right, bx)); if (by < INS.top) by = y + 12; if (by + h > chh - INS.bottom) by = y - h - 10;""")
rep("""    // swell aimed at Choc: rings, bigger for bigger swell
    if (fa > 0.05) {
      ctx.save(); ctx.globalAlpha = fa / 0.72;
      for (const c of row == null ? [] : fcAimed(FC.model, row)) {""",
"""    // swell headed for the spot: dots, bigger for swell that would arrive bigger
    if (fa > 0.05 && FC.show.aim) {
      ctx.save(); ctx.globalAlpha = fa / 0.72;
      for (const c of row == null ? [] : fcAimed(FC.model, row, FC.spot)) {""")
rep("""    const ra = ramp(v.W, 320, 130);
    if (ra > 0) {""", """    const ra = FC.show.rays ? ramp(v.W, 320, 130) : 0;
    if (ra > 0) {""")
rep("""    // the spots
    const c = chocFt(FC.model, FC.i), w = FC.model === 'gfs' ? FC.d.gfs[FC.i].wild : (ecRow(FC.i) || {}).wild;
    ctx.fillStyle = '#f08a4b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(PEAK[0]), Y(...PEAK), 5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.font = '600 13px "Instrument Sans", system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 4;
    const ct = `Choc ${c == null ? '–' : c.toFixed(1)} ft`;
    if (v.W < 160) { ctx.textAlign = 'left'; ctx.fillText(ct, X(PEAK[0]) + 9, Y(...PEAK) - 8); } else { ctx.textAlign = 'right'; ctx.fillText(ct, X(PEAK[0]) - 9, Y(...PEAK) - 6); }
    if (v.W < 160 && w != null) {
      ctx.strokeStyle = '#4fb6c9'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(X(W1[0]), Y(...W1)); ctx.lineTo(X(W2[0]), Y(...W2)); ctx.stroke();
      const wt = `Wilderness ${w.toFixed(1)} ft`, wx = X(W2[0]) - 9;
      if (wx - ctx.measureText(wt).width < 6) { ctx.textAlign = 'left'; ctx.fillText(wt, X(W1[0]) + 4, Y(...W1) + 20); }
      else { ctx.textAlign = 'right'; ctx.fillText(wt, wx, Y(...W2) + 16); }
    }
    ctx.shadowBlur = 0;""",
"""    // the spots: the one picked is labelled at every zoom, both near Fishers
    const c = spotFt(FC.model, FC.i, 'choc'), w = spotFt(FC.model, FC.i, 'wild'), near = v.W < 160, f1 = (q) => (q == null ? '–' : q.toFixed(1));
    ctx.font = '600 13px "Instrument Sans", system-ui, sans-serif'; ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 4;
    if (near || FC.spot === 'choc') {
      ctx.fillStyle = '#f08a4b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(PEAK[0]), Y(...PEAK), 5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = FC.spot === 'choc' ? '#fff' : '#c9d3dc'; const ct = `Choc ${f1(c)} ft`;
      if (near) { ctx.textAlign = 'left'; ctx.fillText(ct, X(PEAK[0]) + 9, Y(...PEAK) - 8); } else { ctx.textAlign = 'right'; ctx.fillText(ct, X(PEAK[0]) - 9, Y(...PEAK) - 6); }
    }
    if (near || FC.spot === 'wild') {
      ctx.strokeStyle = '#4fb6c9'; ctx.lineWidth = near ? 4 : 3; ctx.beginPath(); ctx.moveTo(X(W1[0]), Y(...W1)); ctx.lineTo(X(W2[0]), Y(...W2)); ctx.stroke();
      if (!near) { ctx.fillStyle = '#4fb6c9'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(SPOT.wild.pt[0]), Y(...SPOT.wild.pt), 5, 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = FC.spot === 'wild' ? '#fff' : '#c9d3dc'; const wt = `Wilderness ${f1(w)} ft`, wx = X(W2[0]) - 9;
      if (!near) { ctx.textAlign = 'right'; ctx.fillText(wt, X(SPOT.wild.pt[0]) - 9, Y(...SPOT.wild.pt) - 6); }
      else if (wx - ctx.measureText(wt).width < 6) { ctx.textAlign = 'left'; ctx.fillText(wt, X(W1[0]) + 4, Y(...W1) + 20); }
      else { ctx.textAlign = 'right'; ctx.fillText(wt, wx, Y(...W2) + 16); }
    }
    ctx.shadowBlur = 0;""")
rep("""      if (!s) pill(x, y, ['No ' + MNAME[FC.model] + ' data here']);
      else {
        const toC = gcBrg([lon, lat], PEAK), off = Math.abs((((s[2] + 180) % 360) - toC + 540) % 360 - 180), km = gcKm([lon, lat], PEAK);
        const lines = [`${(s[0] * FTm).toFixed(1)} ft · ${Math.round(s[1])} s from ${compass(s[2])}`];
        if (km < 150) lines.push('Close in: the map edge model covers this');
        else if (off <= 10 && s[1] >= 7 && reefSees(s[1], gcBrg(PEAK, [lon, lat])) >= 0.12) lines.push(`Headed for Choc · arrives ~${fcWhen(t0 + km * 1000 / (G * s[1] / (4 * Math.PI)) * 1000)}`);
        else lines.push(off <= 10 ? 'Headed our way, but the reef is blind to that angle' : `Not headed for Choc (${Math.round(off)}° off)`);""",
"""      if (!s) pill(x, y, ['No ' + MNAME[FC.model] + ' data here']);
      else {
        const sp = FC.spot, tgt = SPOT[sp].pt, nm = SPOT[sp].name;
        const toC = gcBrg([lon, lat], tgt), off = Math.abs((((s[2] + 180) % 360) - toC + 540) % 360 - 180), km = gcKm([lon, lat], tgt);
        const lines = [`${(s[0] * FTm).toFixed(1)} ft · ${Math.round(s[1])} s from ${compass(s[2])}`];
        if (km < 150) lines.push('Close in: the map edge model covers this');
        else if (off <= 10 && s[1] >= 7 && reefSees(s[1], gcBrg(tgt, [lon, lat]), sp) >= 0.12) lines.push(`Headed for ${nm} · arrives ~${fcWhen(t0 + km * 1000 / (G * s[1] / (4 * Math.PI)) * 1000)}`);
        else lines.push(off <= 10 ? `Headed our way, but ${nm}'s reef is blind to that angle` : `Not headed for ${nm} (${Math.round(off)}° off)`);""")
# remove the canvas height key (it is an HTML overlay now)
a = s.index("    // height key, bottom left\n")
b = s.index("  }\n", s.index("      ctx.restore();\n    }\n", a)) 
s = s[:a] + s[b:]

# streaks: layer switch + still version for reduced motion
rep("""  function fxStart() { if (!PT.run && PT.vis && S.phase === 'week' && FC.d && !reduce) { PT.run = true; requestAnimationFrame(fxFrame); } }
  function fxFrame() {
    if (S.phase !== 'week' || !PT.vis || reduce) { PT.run = false; fxc.setTransform(1, 0, 0, 1, 0, 0); fxc.clearRect(0, 0, fx.width, fx.height); return; }""",
"""  function fxStart() { if (!PT.run && PT.vis && S.phase === 'week' && FC.d && !reduce && FC.show.flow) { PT.run = true; requestAnimationFrame(fxFrame); } }
  function fxClear() { fxc.setTransform(1, 0, 0, 1, 0, 0); fxc.clearRect(0, 0, fx.width, fx.height); }
  function fxFrame() {
    if (S.phase !== 'week' || !PT.vis || reduce || !FC.show.flow) { PT.run = false; fxClear(); return; }""")
rep("""    fxc.strokeStyle = `rgba(240,246,250,${0.6 * fa / 0.72})`; fxc.lineWidth = 1.1; fxc.stroke();
    landMask(fxc, x0, y0, sc);
  }""", """    fxc.strokeStyle = `rgba(240,246,250,${0.6 * fa / 0.72})`; fxc.lineWidth = 1.1; fxc.stroke();
    landMask(fxc, x0, y0, sc);
  }
  function fxStatic() {                                      // reduced motion: still streamlines in place of moving ones
    fxClear(); if (S.phase !== 'week' || !FC.d || !FC.show.flow) return;
    const v = S.cam, { sc, x0, y0 } = proj(v), fa = fieldAlpha(v.W), row = fRow(); if (fa < 0.05 || row == null) return;
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0); fxc.beginPath();
    for (let gy = 14, r = 0; gy < chh; gy += 24, r++) for (let gx = 12 + (r % 2) * 12; gx < cw; gx += 24) {
      let x = gx, y = gy; if (!fcFlow((x / sc + x0) / KX, -(y / sc + y0) / KY, FC.model, row)) continue; fxc.moveTo(x, y);
      for (let k = 0; k < 6; k++) { const q = fcFlow((x / sc + x0) / KX, -(y / sc + y0) / KY, FC.model, row); if (!q) break; const b = (q[1] + 180) * D2R, st = 0.25 * q[0]; x += Math.sin(b) * st; y -= Math.cos(b) * st; fxc.lineTo(x, y); }
    }
    fxc.strokeStyle = `rgba(240,246,250,${0.55 * fa / 0.72})`; fxc.lineWidth = 1; fxc.stroke(); landMask(fxc, x0, y0, sc);
  }""")

# ── timeline: compact, inside the bar at the bottom of the map
a = s.index("  function fcTimeline() {")
b = s.index("  function fcCursor() {")
s = s[:a] + r"""  function fcTimeline() {
    const host = $('fcTlSvg'); if (!host || !FC.d || host.offsetParent === null) return;
    const g = FC.d.gfs, n = g.length, ts = g.map((r) => Date.parse(r.t)), ta = ts[0], tb = ts[n - 1], sp = FC.spot;
    const W = Math.max(200, Math.round(host.clientWidth)), H = 70, L0 = 2, R0 = 2, T0 = 14, B0 = 46;
    const x = (t) => L0 + (t - ta) / (tb - ta) * (W - L0 - R0);
    const gv = g.map((r) => r[sp]), ev = ts.map((_, i) => (ecRow(i) ? ecRow(i)[sp] : null));
    const top = Math.max(2, Math.ceil(Math.max(...gv, ...ev.filter((v) => v != null)) + 0.3)), y = (v) => B0 - v / top * (B0 - T0);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${SPOT[sp].name} this week from both models">`;
    for (let d = ta - 864e5; d < tb + 864e5; d += 864e5) {                     // night shading
      const ss = sunWin(d)[1], sr = sunWin(d + 864e5)[0], a = Math.max(ta, ss), b = Math.min(tb, sr);
      if (b > a) s += `<rect x="${x(a).toFixed(1)}" y="${T0 - 2}" width="${(x(b) - x(a)).toFixed(1)}" height="${B0 - T0 + 12}" fill="rgba(0,0,0,.34)"/>`;
    }
    s += `<line x1="${L0}" x2="${W - R0}" y1="${y(top)}" y2="${y(top)}" stroke="#1f2b37"/><line x1="${L0}" x2="${W - R0}" y1="${y(0)}" y2="${y(0)}" stroke="#2c3b49"/>` +
      `<text x="${L0 + 2}" y="${T0 - 4}" class="tl-t">${top} ft</text>`;
    // which line is which, top right
    const kx = W - R0 - 98;
    s += `<line x1="${kx}" x2="${kx + 12}" y1="${T0 - 7}" y2="${T0 - 7}" stroke="#f08a4b" stroke-width="2.2"/><text x="${kx + 16}" y="${T0 - 4}" class="tl-k">GFS</text>` +
      `<line x1="${kx + 42}" x2="${kx + 54}" y1="${T0 - 7}" y2="${T0 - 7}" stroke="#f08a4b" stroke-width="2" stroke-dasharray="3 2"/><text x="${kx + 58}" y="${T0 - 4}" class="tl-k">ECMWF</text>`;
    for (let m = etMidnight(ta) + 864e5; m < tb; m = etMidnight(m + 30 * 36e5)) {   // day ticks at Eastern midnight
      const p = etParts(m + 12 * 36e5), lab = x(m + 864e5) - x(m) > 58 ? `${p.weekday} ${p.day}` : p.weekday;
      s += `<line x1="${x(m)}" x2="${x(m)}" y1="${T0 - 2}" y2="${B0 + 10}" stroke="#2c3b49"/>` + (x(m) + 7 * lab.length < W ? `<text x="${x(m) + 3}" y="${H - 2}" class="tl-t">${lab}</text>` : '');
    }
    const arr = FC.show.aim ? fcArrivals(FC.model, sp) : null, bw = (W - L0 - R0) / (n - 1);
    if (arr) for (let i = 0; i < n; i++) if (arr[i] > 0.02) s += `<rect x="${(x(ts[i]) - bw * 0.4).toFixed(1)}" y="${(B0 - arr[i] * 0.45 * (B0 - T0)).toFixed(1)}" width="${(bw * 0.8).toFixed(1)}" height="${(arr[i] * 0.45 * (B0 - T0)).toFixed(1)}" fill="rgba(255,236,214,.18)"/>`;
    const path = (vals) => vals.map((v, i) => (v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${x(ts[i]).toFixed(1)},${y(v).toFixed(1)}`)).join('');
    const on = (m) => (FC.model === m ? 'stroke-width="2.4"' : 'stroke-width="1.5" opacity=".7"');
    s += `<path d="${path(ev)}" fill="none" stroke="#f08a4b" stroke-dasharray="5 3" ${on('ec')}/><path d="${path(gv)}" fill="none" stroke="#f08a4b" ${on('gfs')}/>`;
    for (let i = 0; i < n; i++) { const k = windKind(g[i].wind); if (k) s += `<circle cx="${x(ts[i]).toFixed(1)}" cy="${B0 + 6}" r="2.2" fill="${WINDCOL[k]}"/>`; }
    s += `<line id="fcCur" y1="${T0 - 2}" y2="${B0 + 10}" stroke="#e7edf2" stroke-width="1.5"/><circle id="fcCurG" r="3.5" fill="#f08a4b" stroke="#fff"/><circle id="fcCurE" r="3.5" fill="#0b1622" stroke="#f08a4b" stroke-width="2"/></svg>`;
    host.innerHTML = s; FC.tl = { x, y, ts, ec: ev, gv };
    fcCursor();
  }
""" + s[b:]
rep("""    $('fcCurG').setAttribute('cx', X0); $('fcCurG').setAttribute('cy', t.y(FC.d.gfs[i].choc));""",
"""    $('fcCurG').setAttribute('cx', X0); $('fcCurG').setAttribute('cy', t.y(t.gv[i]));""")
rep("""  function fcBest() {                                        // biggest daylight hour that isn't onshore, by the two models' average
    let best = -1, bv = -1;
    FC.d.gfs.forEach((r, i) => { const t = Date.parse(r.t), e = ecRow(i), m = e ? (r.choc + e.choc) / 2 : r.choc;
      if (daylight(t) && windKind(r.wind) !== 'onshore' && m > bv) { bv = m; best = i; } });
    if (best < 0) return;
    const r = FC.d.gfs[best], e = ecRow(best), gap = e ? Math.abs(r.choc - e.choc) : 0;
    const b = $('fcBest'); b.dataset.i = best; b.hidden = false;
    b.innerHTML = `Best bet <b>${fcWhen(Date.parse(r.t))}</b> · ${bv.toFixed(1)} ft · ${windWord(windKind(r.wind))}` + (e ? (gap <= 0.5 ? ' · models agree' : ' · models differ') : '');
  }""", """  function fcBest() {                                        // biggest daylight hour that isn't onshore, by the two models' average
    let best = -1, bv = -1; const sp = FC.spot;
    FC.d.gfs.forEach((r, i) => { const t = Date.parse(r.t), e = ecRow(i), m = e ? (r[sp] + e[sp]) / 2 : r[sp];
      if (daylight(t) && windKind(r.wind) !== 'onshore' && m > bv) { bv = m; best = i; } });
    const b = $('fcBest'); if (best < 0) { b.hidden = true; return; }
    const r = FC.d.gfs[best], e = ecRow(best), gap = e ? Math.abs(r[sp] - e[sp]) : 0;
    b.dataset.i = best; b.hidden = false; b.setAttribute('aria-label', `Jump to the best bet for ${SPOT[sp].name}`);
    b.innerHTML = `<b>Best bet</b> ${fcWhen(Date.parse(r.t))} · ${bv.toFixed(1)} ft<span class="x"> · ${windWord(windKind(r.wind))}` + (e ? (gap <= 0.5 ? ' · models agree' : ' · models differ') : '') + '</span>';
  }""")
rep("""    $('fcAsOf').textContent = `Forecast as of ${p.weekday} ${p.month} ${p.day}, ${h12(p.h, p.minute)} ET` + (hrs >= 1 ? ` (${hrs < 48 ? hrs + ' h' : Math.round(hrs / 24) + ' days'} old)` : '') +
      (d.runs.gfs === d.runs.ec ? ` · GFS-Wave and ECMWF ${run(d.runs.gfs)} runs` : ` · GFS-Wave ${run(d.runs.gfs)} run · ECMWF ${run(d.runs.ec)} run`);""",
"""    const txt = `As of ${p.weekday} ${p.month} ${p.day}, ${h12(p.h, p.minute)} ET` + (hrs >= 1 ? ` (${hrs < 48 ? hrs + ' h' : Math.round(hrs / 24) + ' days'} old)` : '') +
      (d.runs.gfs === d.runs.ec ? ` · GFS-Wave and ECMWF ${run(d.runs.gfs)} runs` : ` · GFS-Wave ${run(d.runs.gfs)} run · ECMWF ${run(d.runs.ec)} run`);
    $('fcAsOf').textContent = txt; $('fcAsOf').title = txt;""")
rep("""    if (S.phase === 'week') setMode('week');
  });""", """    if (S.phase === 'week') setMode('week');
  });
  { const kb = $('fcKey').querySelector('i'), st = []; for (let f = 0; f <= 20; f += 2) st.push(`rgb(${hCol(f)}) ${f * 5}%`); kb.style.background = `linear-gradient(90deg, ${st.join(', ')})`; }""")
rep("""  function fcZoom(z) {
    FC.zoom = z; for (const b of document.querySelectorAll('#fcZoom button')) b.setAttribute('aria-pressed', String(b.dataset.v === z));
    const [a, b] = ZOOMS[z], p = P(...a), q = P(...b), top = hudBottom(), m = Math.min(cw, chh);
    const W = Math.max((q[0] - p[0]) * m / Math.max(1, cw - 20), (p[1] - q[1]) * m / Math.max(1, chh - top - 10)) * 1.02, sc = m / W;
    S.cam = { cx: (p[0] + q[0]) / 2, cy: (p[1] + q[1]) / 2 - (top - 10) / 2 / sc, W };
    draw();
  }""", """  function fcZoom(z) {
    FC.zoom = z; for (const b of document.querySelectorAll('#fcZoom button')) b.setAttribute('aria-pressed', String(b.dataset.v === z));
    const [a, b] = ZOOMS[z]; S.cam = fitBox(P(...a), P(...b), 1.02); S.moved = false;
    draw();
  }""")

# ── modes: forecast is the default view; the last one picked is remembered on this device
a = s.index("  function setMode(m) {")
b = s.index("  document.querySelectorAll('#fcModel button')")
s = s[:a] + r"""  let dropReady = false;
  function setMode(m) {
    try { localStorage.setItem('choc.hubView', m); } catch (e) { /* fine */ }
    const was = S.phase;
    for (const b of document.querySelectorAll('#tripModeSeg button')) b.setAttribute('aria-pressed', String(b.dataset.v === m));
    for (const el of stage.querySelectorAll('[data-mode]')) el.hidden = el.dataset.mode !== m;
    fcStop(); FC.pick = null; botSize();
    if (m === 'week') {
      if (was !== 'week') { S.dcam = S.cam; S.playing = false; }
      S.phase = 'week'; $('tripInsetBox').hidden = true; $('tripPow').hidden = true;
      if (!FC.d) { $('tripPhase').textContent = 'Loading the forecast…'; $('tripLine').textContent = ''; draw(); return; }
      if (FC.cam && was !== 'week') { S.cam = FC.cam; draw(); } else fcZoom(FC.zoom);
      fcTimeline(); setWeek(FC.i); fxStart();
    } else {
      if (was === 'week') { FC.cam = S.cam; S.cam = S.dcam || null; fxClear(); }
      $('tripPow').hidden = false; $('tripInsetBox').hidden = !insetPref;
      if (!dropReady) initDrop();
      if (S.phase === 'week') S.phase = 'setup';
      toSetup(!S.cam);
    }
    syncButtons(); infoSync();
  }
  function initDrop() {                                      // the wave tracer starts on first use: a 12 s wave from far out, aimed at Choc, played once
    dropReady = true; $('tripPhase').textContent = 'Loading the sea floor…';
    ready.then(() => {
      if (!GR.ok) { $('tripPhase').textContent = 'This browser can’t load the depth data for the wave tracer.'; return; }
      S.start = [-71.85, 38.91]; const b = aim('c', S.T, S.start); S.th = (b.th + 360) % 360; S.note = 'aimed at Choc';
      S.ray = makeRay(S.T, S.start, S.th);
      if (S.phase === 'week') { S.dcam = fitCam([S.start, PEAK]); return; }
      S.cam = fitCam([S.start, PEAK]); hudSetup(); draw(); syncButtons();
      let started = false;
      const io = new IntersectionObserver((es) => { if (started || !es.some((e) => e.isIntersecting)) return; started = true; io.disconnect(); if (S.phase === 'setup') play(); }, { threshold: 0.3 });
      io.observe(cv);
    });
  }
""" + s[b:]
rep("""  document.querySelectorAll('#fcModel button').forEach((b) => b.addEventListener('click', () => {
    FC.model = b.dataset.v; for (const q of document.querySelectorAll('#fcModel button')) q.setAttribute('aria-pressed', String(q === b));
    fcTimeline(); setWeek(FC.i);
  }));""", """  document.querySelectorAll('#fcModel button').forEach((b) => b.addEventListener('click', () => {
    FC.model = b.dataset.v; for (const q of document.querySelectorAll('#fcModel button')) q.setAttribute('aria-pressed', String(q === b));
    fcTimeline(); setWeek(FC.i);
  }));
  document.querySelectorAll('#fcSpot button').forEach((b) => b.addEventListener('click', () => {
    FC.spot = b.dataset.v; for (const q of document.querySelectorAll('#fcSpot button')) q.setAttribute('aria-pressed', String(q === b));
    FC.pick = null; fcBest(); fcTimeline(); setWeek(FC.i);
  }));
  document.querySelectorAll('#fcLayers .hub-tg').forEach((b) => {
    b.setAttribute('aria-pressed', String(FC.show[b.dataset.l]));
    b.addEventListener('click', () => {
      const l = b.dataset.l; FC.show[l] = !FC.show[l]; b.setAttribute('aria-pressed', String(FC.show[l]));
      try { localStorage.setItem('choc.fcLayers', JSON.stringify(FC.show)); } catch (e) { /* fine */ }
      if (l === 'flow') { if (FC.show.flow) fxStart(); else fxClear(); }
      if (l === 'aim') fcTimeline();
      draw();
    });
  });""")

# ── drop-a-wave: short notes in the bar, the long numbers in the info card
rep("""    const so = $('tripOut'); if (S.phase === 'setup' && so) so.textContent = S.detail;
  }""", """    infoSync();
  }""")
rep("""    S.phase = 'play'; S.dist = 0; S.hold = 1.2; S.last = 0; $('tripOut').textContent = ''; syncButtons(); cv.style.cursor = 'pointer';""",
"""    S.phase = 'play'; S.dist = 0; S.hold = 1.2; S.last = 0; syncButtons(); cv.style.cursor = 'pointer';""")
rep("""    $('tripOut').textContent = `Landed: ${r.land}, after ${fmtT(tot)} and ${r.km} km. It started out coming from ${Math.round(din)}°. ` + (S.detail ? S.detail + ' ' : '') +
      (r.res.fine ? `The sea floor turned it ${Math.abs(turn)}° on the way in, so it reached the shore coming from ${Math.round(dlast)}°. ` : '') +

      `Tap "Back to map" to move the start or change the aim.`;
    syncButtons();""", """    S.turnRay = r;
    S.turnTxt = `Landed: ${r.land}, after ${fmtT(tot)} and ${r.km} km. It started out coming from ${Math.round(din)}°.` +
      (r.res.fine ? ` The sea floor turned it ${Math.abs(turn)}° on the way in, so it reached the shore from ${Math.round(dlast)}°.` : '');
    S.turnShort = r.res.fine ? `The sea floor turned it ${Math.abs(turn)}°: it reached the shore from ${Math.round(dlast)}°.` : 'It never reached the survey map.';
    syncButtons(); infoSync();""")
rep("""  function syncButtons() {
    const setup = S.phase === 'setup';
    $('tripPlay').textContent = setup ? 'Play' : 'Back to map';
    $('tripPlay').disabled = setup && !S.ray;
    for (const id of ['tripAimC', 'tripAimW', 'tripRand']) $(id).disabled = !GR.ok;
  }""", """  function syncButtons() {
    const setup = S.phase === 'setup';
    $('tripPlay').textContent = setup ? 'Play' : 'Back to map';
    $('tripPlay').disabled = setup && !S.ray;
    for (const id of ['tripAimC', 'tripAimW', 'tripRand']) $(id).disabled = !GR.ok;
    $('tripOut').textContent = S.phase === 'play' ? 'Tap the map to pause.' : S.turnShort && S.turnRay === S.ray ? S.turnShort
      : S.start ? 'Tap the water to move the start. Drag the white ring to aim.' : 'Tap the ocean to drop a wave.';
  }
  function infoSync() {                                      // this wave's numbers, in the info card
    const el = $('hubWave'); if (!el) return;
    el.textContent = S.phase !== 'week' && S.ray && S.ray.pw && S.detail ? (S.turnTxt && S.turnRay === S.ray ? S.turnTxt + ' ' : '') + S.detail : '';
  }""")

# ── controls: arrival close-up is a layer toggle now
rep("""  // arrival close-up: collapsed to a small button by default; the choice is remembered on this device
  function setInset(open) {
    $('tripInsetBox').hidden = !open; $('tripInsetOpen').hidden = open;
    try { localStorage.setItem('choc.tripInset', open ? '1' : '0'); } catch (e) { /* storage blocked: fine */ }
    draw();
  }
  $('tripInsetOpen').addEventListener('click', () => setInset(true));
  $('tripInsetClose').addEventListener('click', () => setInset(false));
  let insetPref = false; try { insetPref = localStorage.getItem('choc.tripInset') === '1'; } catch (e) { /* default closed */ }
  setInset(insetPref);""", """  // arrival close-up: off by default; the choice is remembered on this device
  function setInset(open) {
    insetPref = open; $('tripInsetBox').hidden = !open || S.phase === 'week'; $('tripInsetTg').setAttribute('aria-pressed', String(open));
    try { localStorage.setItem('choc.tripInset', open ? '1' : '0'); } catch (e) { /* storage blocked: fine */ }
    draw();
  }
  $('tripInsetTg').addEventListener('click', () => setInset(!insetPref));
  $('tripInsetClose').addEventListener('click', () => setInset(false));
  let insetPref = false; try { insetPref = localStorage.getItem('choc.tripInset') === '1'; } catch (e) { /* default closed */ }
  $('tripInsetTg').setAttribute('aria-pressed', String(insetPref));""")

# ── map chrome: layers panel, info card, full screen; then the first view
a = s.index("  // first view: a 12 s wave from far out to the south-southeast, aimed at Choc, plays once on screen")
b = s.index("})();", a)
s = s[:a] + r"""  // ── map chrome. Wide maps keep the layers panel open (remembered); narrow ones open it on demand,
  // and a tap on the map closes it. The info card replaces long captions.
  let wide = null, pnPref = null, pnWas = false;
  try { pnPref = localStorage.getItem('choc.hubPanel'); } catch (e) { /* default by width */ }
  function setPanel(open, remember) {
    $('hubPanel').hidden = !open; $('hubLayers').setAttribute('aria-expanded', String(open)); stage.classList.toggle('hub-pn', open);
    if (open && !$('hubInfoCard').hidden) setInfo(false, true);
    if (remember && wide) { pnPref = open ? '1' : '0'; try { localStorage.setItem('choc.hubPanel', pnPref); } catch (e) { /* fine */ } }
    requestAnimationFrame(() => { draw(); if (S.phase === 'week') fcTimeline(); });
  }
  function setInfo(open, keepPanel) {
    $('hubInfoCard').hidden = !open; $('hubInfo').setAttribute('aria-expanded', String(open));
    if (open) { pnWas = !$('hubPanel').hidden; if (pnWas) setPanel(false); infoSync(); }
    else if (!keepPanel && pnWas && wide) { pnWas = false; setPanel(true); }
    requestAnimationFrame(draw);
  }
  function setMax(on) {
    stage.classList.toggle('hub-max', on); document.documentElement.classList.toggle('hub-lock', on);
    $('hubFull').setAttribute('aria-pressed', String(on)); $('hubFull').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); $('hubFull').title = on ? 'Exit full screen' : 'Full screen';
  }
  function botSize() { const b = [...stage.querySelectorAll('.hub-bot')].find((e) => !e.hidden); stage.style.setProperty('--botH', (b ? stage.clientHeight - b.offsetTop : 0) + 'px'); }
  $('hubLayers').addEventListener('click', () => setPanel($('hubPanel').hidden, true));
  $('hubInfo').addEventListener('click', () => setInfo($('hubInfoCard').hidden));
  $('hubInfoX').addEventListener('click', () => setInfo(false));
  $('hubFull').addEventListener('click', () => setMax(!stage.classList.contains('hub-max')));
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!$('hubInfoCard').hidden) setInfo(false); else if (stage.classList.contains('hub-max')) setMax(false); });
  // a tap on the map closes the info card, and the layers panel on narrow screens (and does nothing else)
  cv.addEventListener('pointerdown', (e) => {
    const pn = !wide && !$('hubPanel').hidden, inf = !$('hubInfoCard').hidden;
    if (!pn && !inf) return;
    if (pn) setPanel(false); if (inf) setInfo(false, true);
    e.stopImmediatePropagation();
  }, true);
  for (const b of stage.querySelectorAll('.hub-bot')) new ResizeObserver(botSize).observe(b);
  new ResizeObserver(() => {
    const w = stage.clientWidth >= 640; botSize();
    if (w !== wide) { wide = w; stage.classList.toggle('hub-wide', w); setPanel(w ? pnPref !== '0' : false); }
    if (S.phase === 'week' && !S.moved && FC.d) fcZoom(FC.zoom);
  }).observe(stage);

  window.CHOC = window.CHOC || {};
  window.CHOC.trip = { _raw: (T, lon, lat, th) => trace(T, lon, lat, th, false), state: S, aim: doAim, play, _miss: (T, lon, lat, th, spot) => miss(trace(T, lon, lat, th, false), spot), _aim: (spot, T, s) => aim(spot, T, s), trace: (T, lon, lat, th) => makeRay(T, [lon, lat], th),
    skip: () => { if (S.ray) { S.dist = S.ray.len; S.phase = 'done'; S.playing = false; draw(); finish(); } }, setMode, fc: FC };

  // first view: the forecast, unless this device last used Drop a wave
  let view = 'week'; try { view = localStorage.getItem('choc.hubView') === 'drop' ? 'drop' : 'week'; } catch (e) { /* default */ }
  setMode(view);
""" + s[b:]
# old test hook block (now inside the chrome block) and the old first-view code are replaced above
rep("""  $('tripPlay').addEventListener('click', () => { if (S.phase === 'setup') play(); else toSetup(true); });
  window.CHOC = window.CHOC || {};
  window.CHOC.trip = { _raw: (T, lon, lat, th) => trace(T, lon, lat, th, false), state: S, aim: doAim, play, _miss: (T, lon, lat, th, spot) => miss(trace(T, lon, lat, th, false), spot), _aim: (spot, T, s) => aim(spot, T, s), trace: (T, lon, lat, th) => makeRay(T, [lon, lat], th),
    skip: () => { if (S.ray) { S.dist = S.ray.len; S.phase = 'done'; S.playing = false; draw(); finish(); } } };
""", """  $('tripPlay').addEventListener('click', () => { if (S.phase === 'setup') play(); else toSetup(true); });
""")
# panning / zooming marks the view as moved (so a resize keeps it)
rep("""    v.cx = wx - (px - cw / 2) / s2; v.cy = wy - (py - chh / 2) / s2; draw();""", """    v.cx = wx - (px - cw / 2) / s2; v.cy = wy - (py - chh / 2) / s2; S.moved = true; draw();""")
rep("""    else { S.cam.cx = drag.cx - (px - drag.sx) / sc; S.cam.cy = drag.cy - (py - drag.sy) / sc; draw(); }""",
"""    else { S.cam.cx = drag.cx - (px - drag.sx) / sc; S.cam.cy = drag.cy - (py - drag.sy) / sc; S.moved = true; draw(); }""")
open(p, 'w').write(s)
print('ok')
