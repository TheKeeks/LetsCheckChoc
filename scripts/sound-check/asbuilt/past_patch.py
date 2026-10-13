import sys
p = 'ocean.js'; s = open(p).read()
def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count: sys.exit(f'expected {count} got {n}: {old[:100]!r}')
    s = s.replace(old, new)

# ── one test for "the map views" (forecast and past share camera, colors and layers)
rep("  function cam() { return S.phase === 'setup' || S.phase === 'week' ? S.cam : playView(S.ray, S.dist); }",
    "  const MAPV = () => S.phase === 'week' || S.phase === 'past';      // the forecast and past views: same camera, colors and layers\n  function cam() { return S.phase === 'setup' || MAPV() ? S.cam : playView(S.ray, S.dist); }")
rep("    if (reduce && S.phase === 'week') fxStatic();\n    if (inCv && !inCv.parentElement.hidden && S.ray && inW && S.phase !== 'week') {",
    "    if (reduce && MAPV()) fxStatic();\n    if (inCv && !inCv.parentElement.hidden && S.ray && inW && !MAPV()) {")
rep("    const WEEK = S.phase === 'week' && !INSET;", "    const WEEK = MAPV() && !INSET;")
rep("    drawTiles(x0, y0, sc, da);", "    drawTiles(x0, y0, sc, da, WEEK && FC.show.field ? soundField() : null);")
rep("      if (S.phase === 'week' && (t === 'Fishers Island' || t === 'edge of the continental shelf')) continue;",
    "      if (WEEK && (t === 'Fishers Island' || t === 'edge of the continental shelf')) continue;")
rep("    const sa = INSET || S.phase === 'week' ? 0 :", "    const sa = INSET || WEEK ? 0 :")
rep("    const ba = S.phase === 'week' ? 0 : 1 - ramp(v.W, 40, 15);", "    const ba = WEEK ? 0 : 1 - ramp(v.W, 40, 15);")
rep("    if (S.phase === 'week') drawWeek(X, Y, v);\n", "    if (MAPV()) drawWeek(X, Y, v);\n")
rep("    el.textContent = S.phase !== 'week' && S.ray", "    el.textContent = !MAPV() && S.ray")
rep("Math.min(S.phase === 'week' ? 9000 : 1400, v.W * f)", "Math.min(MAPV() ? 9000 : 1400, v.W * f)")
rep("  const panMode = () => S.phase === 'setup' || S.phase === 'week';", "  const panMode = () => S.phase === 'setup' || MAPV();")
rep("    if (drag && drag.kind === 'pan' && ptrs.size === 0 && S.phase === 'week') {", "    if (drag && drag.kind === 'pan' && ptrs.size === 0 && MAPV()) {")
rep("img('ocean/ocean_bg.jpg').then((im) => { L.obg = im; if (S.phase === 'week') draw(); });", "img('ocean/ocean_bg.jpg').then((im) => { L.obg = im; if (MAPV()) draw(); });")

# ── sea floor under the model colors: the survey map gets the ray model's heights instead of flat blue
rep("  function drawTiles(x0, y0, sc, alpha) {", "  function drawTiles(x0, y0, sc, alpha, under) {")
rep("    rg.fillStyle = 'rgb(62,104,150)'; rg.fillRect(wl, wt, ww, wh);",
    "    if (under) { rg.imageSmoothingEnabled = true; rg.imageSmoothingQuality = 'high'; rg.drawImage(under, wl, wt, ww, wh); }\n    else { rg.fillStyle = 'rgb(62,104,150)'; rg.fillRect(wl, wt, ww, wh); }")

# ── the offshore field, streaks and taps work from whichever view is on
rep("""    for (const g of ['ocean', 'reg']) {
      const im = fRow() == null ? null : fcImage(FC.model, g, fRow()); if (!im) continue;
      const b = gridB(FC.d.grids[g]), p0 = P(b[0], b[3]), p1 = P(b[1], b[2]);
      lctx.drawImage(im, (p0[0] - x0) * sc, (p0[1] - y0) * sc, (p1[0] - p0[0]) * sc, (p1[1] - p0[1]) * sc);
    }""", """    for (const [im, b] of fieldImages()) {
      const p0 = P(b[0], b[3]), p1 = P(b[1], b[2]);
      lctx.drawImage(im, (p0[0] - x0) * sc, (p0[1] - y0) * sc, (p1[0] - p0[0]) * sc, (p1[1] - p0[1]) * sc);
    }""")
rep("    const fa = fieldAlpha(v.W); if (fa <= 0.01 || !FC.d || !FC.show.field) return;",
    "    const fa = fieldAlpha(v.W); if (fa <= 0.01 || !FC.show.field || (S.phase === 'week' && !FC.d)) return;")
rep("""  function fxStart() { if (!PT.run && PT.vis && S.phase === 'week' && FC.d && !reduce && FC.show.flow) { PT.run = true; requestAnimationFrame(fxFrame); } }""",
    """  function fxStart() { if (!PT.run && PT.vis && MAPV() && !reduce && FC.show.flow) { PT.run = true; requestAnimationFrame(fxFrame); } }""")
rep("""    if (S.phase !== 'week' || !PT.vis || reduce || !FC.show.flow) { PT.run = false; fxClear(); return; }""",
    """    if (!MAPV() || !PT.vis || reduce || !FC.show.flow) { PT.run = false; fxClear(); return; }""")
rep("""    const v = S.cam, { sc, x0, y0 } = proj(v), fa = fieldAlpha(v.W), key = [v.cx, v.cy, v.W, cw, chh, FC.model].join();""",
    """    const v = S.cam, { sc, x0, y0 } = proj(v), fa = fieldAlpha(v.W), key = [v.cx, v.cy, v.W, cw, chh, FC.model, S.phase].join();""")
rep("""    const row = fRow(), N = Math.min(2200""", """    const flow = flowFn(), N = Math.min(2200""")
rep("""      const s = row == null ? null : fcFlow((p.x / sc + x0) / KX, -(p.y / sc + y0) / KY, FC.model, row);""",
    """      const s = flow ? flow((p.x / sc + x0) / KX, -(p.y / sc + y0) / KY) : null;""")
rep("""    fxClear(); if (S.phase !== 'week' || !FC.d || !FC.show.flow) return;
    const v = S.cam, { sc, x0, y0 } = proj(v), fa = fieldAlpha(v.W), row = fRow(); if (fa < 0.05 || row == null) return;""",
    """    fxClear(); if (!MAPV() || !FC.show.flow) return;
    const v = S.cam, { sc, x0, y0 } = proj(v), fa = fieldAlpha(v.W), flow = flowFn(); if (fa < 0.05 || !flow) return;""")
rep("""      let x = gx, y = gy; if (!fcFlow((x / sc + x0) / KX, -(y / sc + y0) / KY, FC.model, row)) continue; fxc.moveTo(x, y);
      for (let k = 0; k < 6; k++) { const q = fcFlow((x / sc + x0) / KX, -(y / sc + y0) / KY, FC.model, row); if (!q) break;""",
    """      let x = gx, y = gy; if (!flow((x / sc + x0) / KX, -(y / sc + y0) / KY)) continue; fxc.moveTo(x, y);
      for (let k = 0; k < 6; k++) { const q = flow((x / sc + x0) / KX, -(y / sc + y0) / KY); if (!q) break;""")

# ── drawWeek handles both views
rep("""  function drawWeek(X, Y, v) {
    if (!FC.d) return;
    const fa = fieldAlpha(v.W), row = fRow(), t0 = row == null ? 0 : Date.parse(FC.d[FC.model][row].t);
    // swell headed for the spot: dots, bigger for swell that would arrive bigger
    if (fa > 0.05 && FC.show.aim) {""", """  function drawWeek(X, Y, v) {
    const PAST = S.phase === 'past';
    if (!PAST && !FC.d) return;
    const fa = fieldAlpha(v.W), row = PAST ? null : fRow(), t0 = row == null ? 0 : Date.parse(FC.d[FC.model][row].t);
    if (PAST) drawWind(X, Y, v);
    // swell headed for the spot: dots, bigger for swell that would arrive bigger
    if (!PAST && fa > 0.05 && FC.show.aim) {""")
rep("""    const c = spotFt(FC.model, FC.i, 'choc'), w = spotFt(FC.model, FC.i, 'wild'), near = v.W < 160, f1 = (q) => (q == null ? '–' : q.toFixed(1));""",
    """    const c = PAST ? pastFt('choc') : spotFt(FC.model, FC.i, 'choc'), w = PAST ? pastFt('wild') : spotFt(FC.model, FC.i, 'wild'), near = v.W < 160, f1 = (q) => (q == null ? '–' : q.toFixed(1));""")
rep("""    if (FC.pick) {
      const [lon, lat] = FC.pick, s = row == null ? null : fcAt(lon, lat, FC.model, row), x = X(lon), y = Y(lon, lat);""",
    """    if (FC.pick && PAST) pastPick(X, Y);
    else if (FC.pick) {
      const [lon, lat] = FC.pick, s = row == null ? null : fcAt(lon, lat, FC.model, row), x = X(lon), y = Y(lon, lat);""")
rep("""    const row = fRow(); FC.pick = !same && FC.d && row != null && fcAt(ll[0], ll[1], FC.model, row) ? ll : null; draw();""",
    """    const at = atFn(); FC.pick = !same && at && at(ll[0], ll[1]) ? ll : null; draw();""")
open(p, 'w').write(s)
print('ok')
