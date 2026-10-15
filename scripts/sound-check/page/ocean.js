// ── THE MAP (top of the page): forecast, past days, and one wave's trip ──────────────────────────────────────
// Drop a wave anywhere in the Atlantic, aim it, and follow it to landfall. The ray is
// traced live in the browser: on ETOPO 2022 (30", ~0.9 km) in open water, with the ray
// equations on the sphere, then handed to the 8 m survey mosaic (averaged to 64 m and
// smoothed over ~150 m, like Part 1's 48 m model) once it reaches the survey map.
// "Aim at Choc / Wilderness" searches for the starting heading whose ray gets closest.
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $('tripCv'); if (!cv) return;
  // The Forecast tab's map (research/map.html?ui=forecast): the forecast alone, with no headline, timeline or view,
  // spot and zoom rows of its own; the tab sets the hour, the spot and the zoom (message lcc-fc, below).
  const FCUI = document.documentElement.dataset.researchUi === 'forecast';
  // The Explore tab's map (?ui=explore): past days and Drop a wave; the forecast is the Forecast tab's.
  const EXUI = document.documentElement.dataset.researchUi === 'explore';
  const stage = cv.parentElement;
  let ctx = cv.getContext('2d');
  const inCv = $('tripInset'), inCtx = inCv ? inCv.getContext('2d') : null; let inW = 0, inH = 0, INSET = false;
  const KX = FRMETA.kmlon, KY = FRMETA.kmlat;          // km per degree: the survey map's own scale, so its tiles line up
  const P = (lon, lat) => [lon * KX, -lat * KY];
  const PEAK = [-71.96339, 41.27557];                        // Choc takeoff peak (owner's reef map)
  const CHOC = [-71.96359, 41.27591], W1 = [-72.00573, 41.25286], W2 = [-72.01117, 41.25551];
  const MTK = [-71.92, 41.038];                              // Ditch Plains, Montauk's main break: "At Montauk", to compare the approach with Fishers
  const BUOY = [-71.127, 40.969];
  const LABELS = [['Long Island', -72.75, 40.93, 600, 60], ['Montauk', -71.86, 41.05, 200, 14], ['Block Island', -71.58, 41.19, 260, 14],
    ['Fishers Island', -71.99, 41.29, 90, 6], ['Martha\'s Vineyard', -70.62, 41.42, 600, 40], ['Nantucket', -70.07, 41.32, 600, 40],
    ['New Jersey', -74.55, 40.1, 1200, 120], ['Cape Hatteras', -75.9, 35.25, 9000, 700], ['Bermuda', -64.75, 32.1, 9000, 700], ['Nova Scotia', -63.6, 45.2, 9000, 700],
    ['Cape Cod', -69.7, 42.05, 3000, 500], ['Gulf of Maine', -68.6, 43.0, 9000, 900], ['Florida', -81.4, 28.2, 9000, 1500], ['Bahamas', -77.0, 24.6, 9000, 1500], ['Newfoundland', -56.5, 48.6, 9000, 1500], ['Rhode Island', -71.6, 41.55, 400, 40], ['edge of the continental shelf', -70.2, 39.88, 1200, 160]];
  const PLACES = [['Montauk Point', 41.071, -71.857], ['Ditch Plains, Montauk', 41.038, -71.92], ['Amagansett', 40.97, -72.13], ['Southampton', 40.86, -72.40],
    ['Shinnecock', 40.84, -72.48], ['Westhampton', 40.80, -72.64], ['Fire Island', 40.65, -73.10], ['Long Beach, NY', 40.58, -73.66], ['New Jersey', 40.10, -74.03],
    ['Block Island', 41.17, -71.58], ['Watch Hill', 41.31, -71.86], ['Napatree Point', 41.305, -71.885], ['Misquamicut', 41.32, -71.80], ['Charlestown, RI', 41.36, -71.65],
    ['Point Judith', 41.36, -71.48], ['Narragansett', 41.43, -71.45], ['Newport', 41.46, -71.33], ['Sakonnet Point', 41.46, -71.19], ['Cuttyhunk', 41.42, -70.93],
    ['Martha\'s Vineyard', 41.35, -70.70], ['Nomans Land', 41.25, -70.81], ['Nantucket', 41.25, -70.05], ['Cape Cod', 41.65, -69.95], ['Plum Island', 41.18, -72.19],
    ['Great Gull Island', 41.20, -72.12], ['Gardiners Island', 41.10, -72.10], ['Orient Point', 41.16, -72.24], ['Stonington', 41.33, -71.90],
    ['Delaware', 38.7, -75.08], ['Maryland', 38.3, -75.1], ['Virginia', 37.5, -75.6]];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const G = 9.81, RE = 6371000, D2R = Math.PI / 180;
  function cp(T, h) {                                 // crest (phase) speed: what refraction runs on (exact, see v13_lab)
    return window.CHOC.crestSpeed(T, Math.max(h, 0.5));
  }
  function cg(T, h) {                                 // group speed: how fast the energy arrives
    const c = cp(T, h), k = 2 * Math.PI / (c * T), kh = Math.min(k * Math.max(h, 0.5), 20);
    return 0.5 * (1 + 2 * kh / Math.sinh(2 * kh)) * c;
  }
  function rEff(T, r0) {                              // landing-zone radius, as in Part 1
    return Math.max(r0, 0.5 * Math.sqrt(window.CHOC.waveL(T, 20) * 15000));
  }
  const img = (src) => new Promise((r) => { const i = new Image(); if (/^https?:/.test(src)) i.crossOrigin = 'anonymous';   // another site's image: its pixels stay readable (it sends CORS)
    i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
  const json = (u) => fetch(u).then((r) => r.ok ? r.json() : null).catch(() => null);
  async function png16(u) {                          // depth PNG: red = high byte, green = low byte
    const im = await img(u); if (!im) throw new Error(u);
    const px = window.CHOC.pixels(im), out = new Uint16Array(im.width * im.height);   // the shared scratch canvas: see CHOC.pixels
    for (let i = 0; i < out.length; i++) out[i] = px[4 * i] << 8 | px[4 * i + 1];
    return out;
  }

  // ── layers + depth grids
  const L = { atl: null, world: null, close: null, meta: null };
  const WB = FRMETA.world;                                   // [left, right, bottom, top]
  const CB = (() => { const c = FRMETA.close; return [WB[0] + c.x0 / FRMETA.kmlon, WB[0] + c.x1 / FRMETA.kmlon, WB[3] - c.y1 / FRMETA.kmlat, WB[3] - c.y0 / FRMETA.kmlat]; })();
  const GR = {};
  function blur(a, rows, cols, r, passes) {          // repeated box blur (about Gaussian)
    const cur = Float32Array.from(a), tmp = new Float32Array(a.length), n = 2 * r + 1;
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < rows; i++) {
        const o = i * cols; let s = 0;
        for (let j = -r; j <= r; j++) s += cur[o + Math.min(cols - 1, Math.max(0, j))];
        for (let j = 0; j < cols; j++) { tmp[o + j] = s / n; s += cur[o + Math.min(cols - 1, j + r + 1)] - cur[o + Math.max(0, j - r)]; }
      }
      for (let j = 0; j < cols; j++) {
        let s = 0;
        for (let i = -r; i <= r; i++) s += tmp[Math.min(rows - 1, Math.max(0, i)) * cols + j];
        for (let i = 0; i < rows; i++) { cur[i * cols + j] = s / n; s += tmp[Math.min(rows - 1, i + r + 1) * cols + j] - tmp[Math.max(0, i - r) * cols + j]; }
      }
    }
    return cur;
  }
  function decode(u16, scale, rows, cols, r, passes) {
    const raw = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) raw[i] = u16[i] ? u16[i] / scale : 0.5;
    return { wet: u16, hb: blur(raw, rows, cols, r, passes), raw };
  }
  img('ocean/atlantic15.webp').then((im) => { L.shelf = im; }); json('ocean/atl15_meta.json').then((m) => { L.shelfB = m && m.bounds; });
  Promise.all([img('ocean/atlantic.jpg'), img('ocean/world_feather.webp'), img('fr_close.jpg'), json('ocean/atl_meta.json')])
    .then(([a, w, c, m]) => { L.atl = a; L.world = w; L.close = c; L.meta = m; requestAnimationFrame(() => draw()); });
  // The depth grids for the wave tracer (about 4 MB): loaded the first time a wave is traced (Drop a wave, or a tap
  // on the forecast's water), not with the page, which only shows them as the pictures above.
  let depthJob = null;
  function depthReady() {
    return depthJob || (depthJob = Promise.all([json('ocean/depth_meta.json'), png16('ocean/atl_depth.png'), png16('ocean/world_depth.png')])
      .then(([dm, ab, wb]) => {
        GR.a = Object.assign({}, dm.atl, decode(ab, dm.atl.scale, dm.atl.rows, dm.atl.cols, 1, 3));
        GR.w = Object.assign({}, dm.world, decode(wb, dm.world.scale, dm.world.rows, dm.world.cols, 2, 3));
        GR.ok = true;
      }).catch(() => { GR.ok = false; }));
  }

  // ── sharp sea floor when zoomed in: the page's 8 m relief tiles (same pyramid as the main map)
  const TW = TILEMAN.world, TSZ = TILEMAN.tile, TLV = TILEMAN.levels.map((l) => Object.assign({}, l, { ws: new Set(l.water), ls: new Set(l.land) }));
  const tileCache = new Map();
  let redrawSoon = false;
  // Each tile is 1024 px square, about 4 MB once decoded, and the browser keeps scaled copies on top: about 10 MB a
  // tile in all. Up to 90 used to stay in memory as you zoomed in (most of the 0.9 GB the page reached), enough for
  // iPad Safari to kill the tab. Keep the 12 used most recently, but never drop one drawn in the current frame: a big
  // screen can show more than 12 at once, and dropping a tile still on screen would fetch it again on every frame.
  const TILE_KEEP = 12;
  let tileFrame = 0;                                         // bumped once per draw()
  function tileImg(kind, Lv, tx, ty) {
    const key = kind + Lv + '_' + tx + '_' + ty; let t = tileCache.get(key);
    if (t) { tileCache.delete(key); tileCache.set(key, t); }   // most recently used goes to the back of the line
    else {
      t = { im: null }; tileCache.set(key, t);
      img(`tiles/${kind}/${Lv}/${tx}_${ty}.${kind === 'w' ? 'jpg' : 'webp'}`).then((im) => { t.im = im; if (!busy() && !redrawSoon) { redrawSoon = true; requestAnimationFrame(() => { redrawSoon = false; draw(); }); } });
    }
    t.f = tileFrame;
    for (const [k, v] of tileCache) { if (tileCache.size <= TILE_KEEP || v.f === tileFrame) break; tileCache.delete(k); }   // oldest first, stop at one on screen now
    return t.im;
  }
  // drawImage only the part of an image that lands on screen: zoomed in close, a whole-ocean image would
  // otherwise be stretched to millions of pixels, which iPad Safari draws blank or very slowly
  function blit(g, im, dx, dy, dw, dh, W, H) {
    if (!im || !(dw > 0) || !(dh > 0)) return;
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; if (!iw || !ih) return;
    W = W || cw; H = H || chh;
    const l = Math.max(0, dx), t = Math.max(0, dy), r = Math.min(W, dx + dw), b = Math.min(H, dy + dh);
    if (r <= l || b <= t) return;
    if (l === dx && t === dy && r === dx + dw && b === dy + dh) { g.drawImage(im, dx, dy, dw, dh); return; }
    const kx = iw / dw, ky = ih / dh, sx = (l - dx) * kx, sy = (t - dy) * ky, sw = (r - l) * kx, sh = (b - t) * ky;
    // pad the source by a pixel so smoothing doesn't leave a hard edge, then map that pad back to screen
    const px0 = Math.max(0, Math.floor(sx) - 1), py0 = Math.max(0, Math.floor(sy) - 1);
    const px1 = Math.min(iw, Math.ceil(sx + sw) + 1), py1 = Math.min(ih, Math.ceil(sy + sh) + 1);
    g.drawImage(im, px0, py0, px1 - px0, py1 - py0, dx + px0 / kx, dy + py0 / ky, (px1 - px0) / kx, (py1 - py0) / ky);
  }
  const reliefCv = document.createElement('canvas'), reliefCtx = reliefCv.getContext('2d');
  function drawTiles(x0, y0, sc, alpha, under) {
    if (alpha <= 0) return;
    // world km box -> tile level by screen resolution
    const need = sc * dpr;                                     // screen px per km
    let Lv = 0; while (Lv < TLV.length - 1 && 1 / TLV[Lv].px_km < need * 0.9) Lv++;
    const lv = TLV[Lv], tk = lv.px_km * TSZ;
    const wx0 = (x0 - TW.left * KX), wy0 = (y0 + TW.top * KY);   // view top-left in world km
    const ox = -wx0 * sc, oy = -wy0 * sc;                          // screen position of the world's top-left
    const tx0 = Math.max(0, Math.floor(wx0 / tk)), tx1 = Math.min(lv.nx - 1, Math.floor((wx0 + cw / sc) / tk));
    const ty0 = Math.max(0, Math.floor(wy0 / tk)), ty1 = Math.min(lv.ny - 1, Math.floor((wy0 + chh / sc) / tk));
    if (tx1 < tx0 || ty1 < ty0) return;
    const rw = Math.round(cw * dpr), rh = Math.round(chh * dpr);
    if (reliefCv.width !== rw || reliefCv.height !== rh) { reliefCv.width = rw; reliefCv.height = rh; }
    const rg = reliefCtx; rg.setTransform(dpr, 0, 0, dpr, 0, 0); rg.globalCompositeOperation = 'source-over'; rg.globalAlpha = 1;
    rg.clearRect(0, 0, cw, chh);
    // color under the relief: the same sea blue as the overview map, only inside the survey map
    const wl = ox, wt = oy, ww = TW.W * TW.px_km * sc, wh = TW.H * TW.px_km * sc;
    if (under) { rg.imageSmoothingEnabled = true; rg.imageSmoothingQuality = 'high'; blit(rg, under, wl, wt, ww, wh); }
    else { rg.fillStyle = 'rgb(62,104,150)'; rg.fillRect(wl, wt, ww, wh); }
    rg.globalCompositeOperation = 'multiply'; rg.imageSmoothingEnabled = true; rg.imageSmoothingQuality = 'high';
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!lv.ws.has(ty * lv.nx + tx)) continue;
      let im = tileImg('w', Lv, tx, ty), a = Lv, sx = 0, sy = 0, sw = TSZ, sh = TSZ;
      while (!im && a > 0) { a--; const k = Lv - a; im = tileCache.get('w' + a + '_' + (tx >> k) + '_' + (ty >> k))?.im; const f = 1 << k; sw = TSZ / f; sh = TSZ / f; sx = (tx % f) * sw; sy = (ty % f) * sh; }
      if (!im) continue;
      const wpx = Math.min(TSZ, lv.W - tx * TSZ), hpx = Math.min(TSZ, lv.H - ty * TSZ);
      const dx0 = Math.round(ox + tx * tk * sc), dy0 = Math.round(oy + ty * tk * sc);       // butt tiles on whole pixels: no gap, no double multiply
      rg.drawImage(im, sx, sy, sw * wpx / TSZ, sh * hpx / TSZ, dx0, dy0, Math.round(ox + tx * tk * sc + wpx * lv.px_km * sc) - dx0, Math.round(oy + ty * tk * sc + hpx * lv.px_km * sc) - dy0);
    }
    rg.globalCompositeOperation = 'source-over';
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!lv.ls.has(ty * lv.nx + tx)) continue;
      const im = tileImg('l', Lv, tx, ty); if (!im) continue;
      const wpx = Math.min(TSZ, lv.W - tx * TSZ), hpx = Math.min(TSZ, lv.H - ty * TSZ);
      const dx0 = Math.round(ox + tx * tk * sc), dy0 = Math.round(oy + ty * tk * sc);
      rg.drawImage(im, 0, 0, wpx, hpx, dx0, dy0, Math.round(ox + tx * tk * sc + wpx * lv.px_km * sc) - dx0, Math.round(oy + ty * tk * sc + hpx * lv.px_km * sc) - dy0);
    }
    if (L.world) {                                             // fade the survey map into the ocean image at its edges
      rg.globalCompositeOperation = 'destination-in'; blit(rg, L.world, wl, wt, ww, wh);
      rg.globalCompositeOperation = 'source-over';
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(reliefCv, 0, 0); ctx.restore();
  }
  function busy() { try { return S.playing; } catch (e) { return true; } }   // S is declared further down
  // the 2016 aerial photos of the two reefs: fetched only the first time they are drawn (zoomed in under 6 km, or
  // the arrival close-up), not with the page, and at 2048 px (still sharper than the screen at the closest zoom)
  const REEF = { photos: {}, shapes: [], src: null, asked: false };
  json('ocean/reef.json').then((d) => { if (!d) return; REEF.shapes = d.shapes; REEF.src = d.photos; });
  function reefPhotos() {
    if (!REEF.asked && REEF.src) {
      REEF.asked = true;
      for (const [k, p] of Object.entries(REEF.src)) img(p.src).then((im) => { if (im) REEF.photos[k] = { im, b: p.b }; if (!S.playing) draw(); });
    }
    return REEF.photos;
  }
  const SHAPECOL = { reef: '#ff6b4a', sand: '#f2d36b', point: '#ffffff', peak: '#f08a4b', peel: '#5fd08a', channel: '#4fb6c9', note: '#c9b6ff' };
  function drawReef(X, Y, alpha) {
    if (alpha <= 0) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const sh of REEF.shapes) {
      const p = sh.pts, col = SHAPECOL[sh.kind] || '#fff';
      if (p.length === 2) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(p[1]), Y(p[1], p[0]), 4, 0, 7); ctx.fill(); continue; }
      ctx.beginPath(); for (let i = 0; i < p.length; i += 2) i ? ctx.lineTo(X(p[i + 1]), Y(p[i + 1], p[i])) : ctx.moveTo(X(p[i + 1]), Y(p[i + 1], p[i]));
      if (sh.kind === 'reef' || sh.kind === 'sand') { ctx.closePath(); ctx.fillStyle = col + '33'; ctx.fill(); }
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(sh.kind === 'channel' ? [5, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // ── tracer
  function bil(g, a, fi, fj) {
    const i = Math.floor(fi), j = Math.floor(fj), di = fi - i, dj = fj - j, c = g.cols;
    const i0 = Math.max(0, Math.min(g.rows - 1, i)), i1 = Math.max(0, Math.min(g.rows - 1, i + 1));
    const j0 = Math.max(0, Math.min(c - 1, j)), j1 = Math.max(0, Math.min(c - 1, j + 1));
    return a[i0 * c + j0] * (1 - di) * (1 - dj) + a[i1 * c + j0] * di * (1 - dj) + a[i0 * c + j1] * (1 - di) * dj + a[i1 * c + j1] * di * dj;
  }
  const inWorld = (lat, lon, inset) => lat > WB[2] + inset && lat < WB[3] - inset && lon > WB[0] + inset && lon < WB[1] - inset;
  function worldXY(lon, lat) { const g = GR.w; return [(lon - g.left) * g.kmlon * 1000, (g.top - lat) * g.kmlat * 1000]; }
  function worldLL(x, y) { const g = GR.w; return [g.left + x / 1000 / g.kmlon, g.top - y / 1000 / g.kmlat]; }
  function wetW(x, y) { const g = GR.w, i = Math.floor(y / g.dx), j = Math.floor(x / g.dx); return i >= 0 && i < g.rows && j >= 0 && j < g.cols && g.wet[i * g.cols + j] > 0; }
  function segDist(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
  }
  function depthAt(lon, lat) {
    if (GR.w && inWorld(lat, lon, 0)) { const [x, y] = worldXY(lon, lat); return bil(GR.w, GR.w.raw, y / GR.w.dx - 0.5, x / GR.w.dx - 0.5); }
    const g = GR.a; if (!g) return 0;
    const fi = (g.north - lat) / g.dlat, fj = (lon - g.west) / g.dlon;
    if (fi < 0 || fj < 0 || fi > g.rows - 1 || fj > g.cols - 1) return null;
    return g.wet[Math.round(fi) * g.cols + Math.round(fj)] ? bil(g, g.raw, fi, fj) : 0;
  }
  // Trace from (lon, lat) heading `th` degrees (travel bearing). record: keep the path.
  function trace(T, lon0, lat0, thDeg, record, targets) {
    const ga = GR.a, gw = GR.w, nT = targets ? targets.length : 0, minT = new Float64Array(nT).fill(1e12);
    const pts = record ? [] : null; let t = 0, lastLL = [lon0, lat0];
    const tC = [...worldXY(...PEAK)], tW1 = worldXY(...W1), tW2 = worldXY(...W2);
    let minC = 1e12, minW = 1e12, how = 'max';
    const push = (lon, lat, h) => { if (record) { t += Math.hypot((lon - lastLL[0]) * 111320 * Math.cos(lat * D2R), (lat - lastLL[1]) * 110950) / cg(T, h) / 60; lastLL = [lon, lat]; pts.push(lon, lat, h, t); } };
    let lat = lat0, lon = lon0, th = thDeg * D2R; const ds = 400;
    const cAt = (fi, fj) => cp(T, bil(ga, ga.hb, fi, fj));
    let fine = false, x = 0, y = 0, phi = 0;
    push(lon, lat, depthAt(lon, lat) || 0);
    for (let s = 0; s < 3200; s++) {
      const fi = (ga.north - lat) / ga.dlat, fj = (lon - ga.west) / ga.dlon;
      if (fi < 1 || fj < 1 || fi > ga.rows - 2 || fj > ga.cols - 2) { how = 'edge'; break; }
      if (!ga.wet[Math.round(fi) * ga.cols + Math.round(fj)]) { how = 'land'; break; }
      if (inWorld(lat, lon, 0.004)) { [x, y] = worldXY(lon, lat); if (wetW(x, y)) { fine = true; phi = Math.atan2(-Math.cos(th), Math.sin(th)); break; } }
      for (let q = 0; q < nT; q++) { const d = Math.hypot((lon - targets[q][0]) * 111320 * Math.cos(lat * D2R), (lat - targets[q][1]) * 110950); if (d < minT[q]) minT[q] = d; }
      const c = cAt(fi, fj), phiR = lat * D2R;
      const ce = (cAt(fi, fj + 1) - cAt(fi, fj - 1)) / (2 * ga.dlon * D2R * RE * Math.cos(phiR));
      const cn = (cAt(fi - 1, fj) - cAt(fi + 1, fj)) / (2 * ga.dlat * D2R * RE);
      const st = Math.sin(th), ct = Math.cos(th);
      th += ds * (-(ce * ct - cn * st) / c + st * Math.tan(phiR) / RE);
      lat += ds * Math.cos(th) / RE / D2R; lon += ds * Math.sin(th) / (RE * Math.cos(phiR)) / D2R;
      if (record && s % 5 === 4) push(lon, lat, bil(ga, ga.raw, fi, fj));
    }
    if (fine) {
      const dx = gw.dx, dsf = 0.5 * dx;
      const cAtW = (fi, fj) => cp(T, bil(gw, gw.hb, fi, fj));
      const tXY = targets ? targets.map((q) => worldXY(q[0], q[1])) : [];
      for (let s = 0; s < 9000; s++) {
        const fi = y / dx - 0.5, fj = x / dx - 0.5;
        if (x < 0 || y < 0 || x >= gw.cols * dx || y >= gw.rows * dx) { how = 'edge'; break; }
        const dC = Math.hypot(x - tC[0], y - tC[1]); if (dC < minC) minC = dC;
        const dW = segDist(x, y, tW1, tW2); if (dW < minW) minW = dW;
        for (let q = 0; q < nT; q++) { const d = Math.hypot(x - tXY[q][0], y - tXY[q][1]); if (d < minT[q]) minT[q] = d; }
        if (!wetW(x, y)) { how = 'land'; break; }
        const c = cAtW(fi, fj), gx = (cAtW(fi, fj + 1) - cAtW(fi, fj - 1)) / (2 * dx), gy = (cAtW(fi + 1, fj) - cAtW(fi - 1, fj)) / (2 * dx);
        phi -= dsf * (gx * -Math.sin(phi) + gy * Math.cos(phi)) / c;
        x += dsf * Math.cos(phi); y += dsf * Math.sin(phi);
        if (record && s % 4 === 3) { const [lo, la] = worldLL(x, y); push(lo, la, bil(gw, gw.raw, fi, fj)); }
      }
      [lon, lat] = worldLL(x, y);
    }
    if (record) push(lon, lat, 0);
    return { how, end: [lon, lat], minC, minW, pts, fine, minT };
  }
  function place(res, T) {
    const [lon, lat] = res.end;
    if (res.minC < rEff(T, 250)) return 'Choc';
    if (res.minW < rEff(T, 150)) return 'Wilderness';
    if (lat > 41.235 && lat < 41.305 && lon > -72.07 && lon < -71.90) return 'Fishers Island, ' + (dist([lon, lat], PEAK) / 1000).toFixed(1) + ' km from Choc';
    if (res.how === 'edge' && lon < -72.3 && lat > 40.95) return 'on up Long Island Sound';
    let best = null, bd = 1e12;
    for (const p of PLACES) { const d = dist([lon, lat], [p[2], p[1]]); if (d < bd) { bd = d; best = p[0]; } }
    if (res.how === 'edge') return 'on past ' + best;           // it leaves the detailed sea floor: say which way it went
    return bd < 6000 ? best : 'near ' + best;
  }
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * D2R), (a[1] - b[1]) * 110950);
  const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * D2R), b[1] - a[1]) / D2R + 360) % 360;
  function miss(res, spot) {
    if (spot === 'm') return res.minT[0];                     // Montauk: the tracer measures its closest pass on both maps
    if (res.fine) return spot === 'c' ? res.minC : res.minW;
    return 1e6 + dist(res.end, spot === 'c' ? PEAK : W1);     // never reached the survey map
  }
  const aimTg = (spot) => (spot === 'm' ? [MTK] : null);
  function aim(spot, T, start) {
    // The miss distance is jagged in the heading (shoals split neighboring rays), so refine
    // the ten best headings at each level instead of only the single best.
    const b0 = bearing(start, spot === 'c' ? PEAK : spot === 'm' ? MTK : W1), tg = aimTg(spot);
    const seen = new Map(); const m = (th) => { const k = th.toFixed(4); if (!seen.has(k)) seen.set(k, miss(trace(T, start[0], start[1], th, false, tg), spot)); return seen.get(k); };
    let cand = [];
    for (let th = b0 - 50; th <= b0 + 50; th += 1) cand.push({ th, m: m(th) });
    for (const [half, step] of [[1, 0.05], [0.05, 0.0025]]) {
      cand.sort((a, b) => a.m - b.m); const top = cand.slice(0, 10); cand = top.slice();
      for (const c of top) for (let th = c.th - half; th <= c.th + half + 1e-9; th += step) cand.push({ th, m: m(th) });
    }
    cand.sort((a, b) => a.m - b.m);
    return cand[0];
  }
  function makeRay(T, start, th) {
    const res = trace(T, start[0], start[1], th, true); const p = res.pts, n = p.length / 4;
    const lon = new Float64Array(n), lat = new Float64Array(n), h = new Float32Array(n), t = new Float32Array(n), d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      lon[i] = p[4 * i]; lat[i] = p[4 * i + 1]; h[i] = p[4 * i + 2]; t[i] = p[4 * i + 3];
      if (i) d[i] = d[i - 1] + Math.hypot((lon[i] - lon[i - 1]) * KX, (lat[i] - lat[i - 1]) * KY);
    }
    const ray = { T, th, start, res, land: place(res, T), n, lon, lat, h, t, d, len: d[n - 1], km: Math.round(d[n - 1]) };
    ray.pw = null; schedulePw(ray);
    return ray;
  }
  // Power per meter of wave crest, relative to the start (100% = as it started). This is Part 1's
  // landing-zone count, run from your start point: a crest of rays 24 km wide (100 m apart, centered
  // on yours) leaves with your heading and with headings out to +-10 deg, weighted like the main
  // model's directional spread (real swell is never a single direction). At checkpoints along your ray we count how many of them pass within a
  // wavelength-wide window of it. Fewer than started there = the bottom spread the power out; more =
  // it focused it. The window widens with wavelength (as in Part 1) because real waves smear out over
  // about that width and can't focus into anything narrower. Friction and breaking aren't modeled.
  async function spreading(r, alive) {
    const RR = rEff(r.T, 250), SP = 100, HALF = 12000; let sinceYield = 0;
    const tick = async () => { if (++sinceYield >= 25) { sinceYield = 0; await new Promise((ok) => setTimeout(ok, 0)); if (alive && !alive()) throw new Error('stale'); } };
    const marks = [...new Set([0.4, 0.7].map((f) => f * r.len).concat([30, 10, 3, 0].map((k) => r.len - k)).filter((d) => d > 0.5 && d <= r.len).map((d) => +d.toFixed(3)))].sort((a, b) => a - b);
    const tg = marks.map((d) => { const p = sample(r, d); return [p.lon, p.lat]; }), last = tg.length - 1;
    const crestPt = (th, k) => { const rad = (th + 90) * D2R; return [r.start[0] + k / 1000 * Math.sin(rad) / KX, r.start[1] + k / 1000 * Math.cos(rad) / KY]; };
    async function crest(th, center, targets) {                 // rays every 100 m over +-12 km around `center`: hits per target
      const h = new Float64Array(targets.length);
      for (let k = center - HALF; k <= center + HALF; k += SP) {
        const o = crestPt(th, k); if (!((depthAt(o[0], o[1]) || 0) > 1)) continue;
        await tick(); const res = trace(r.T, o[0], o[1], th, false, targets);
        for (let q = 0; q < targets.length; q++) if (res.minT[q] <= RR) h[q]++;
      }
      return h;
    }
    try {
      // along the way: your own heading, crest centered on your start
      const along = await crest(r.th, 0, tg);
      // at the shore: a real swell covers the whole ocean, so for each direction in the spread (+-10 deg,
      // weighted like the main model) center that direction's crest on the part of the swell that heads
      // for the landing point, wherever along the crest that is
      const DTH = [-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10], WT = DTH.map((d) => Math.pow(Math.cos(d * D2R / 2), 30)), WS = WT.reduce((a, b) => a + b, 0);
      const end = [tg[last]]; let endHits = 0, endRaw = 0; const half = [[0, 0], [0, 0]];   // every-other-direction halves: how much the answer moves with direction
      for (let hd = 0; hd < DTH.length; hd++) {
        const th = r.th + DTH[hd];
        let best = 0, bm = Infinity;
        const scan = async (lo, hi, st) => { for (let k = lo; k <= hi; k += st) { const o = crestPt(th, k); if (!((depthAt(o[0], o[1]) || 0) > 1)) continue;
          await tick(); const m = trace(r.T, o[0], o[1], th, false, end).minT[0]; if (m < bm) { bm = m; best = k; } } };
        await scan(-90000, 90000, 3000); await scan(best - 3000, best + 3000, 500);
        if (bm > 15000) continue;                                 // no swell from this direction gets near the spot
        const h = DTH[hd] === 0 && Math.abs(best) <= 3000 ? [along[last]] : await crest(th, best, end);
        endHits += h[0] * WT[hd] / WS; endRaw += h[0]; half[hd % 2][0] += h[0] * WT[hd]; half[hd % 2][1] += WT[hd];
      }
      const ratio = Array.from(along, (h) => h * SP / (2 * RR)); ratio[last] = endHits * SP / (2 * RR);
      const xs = [0].concat(marks), ys = [1].concat(ratio);
      const pw = new Float32Array(r.n);
      for (let i = 0; i < r.n; i++) { let k = 1; while (k < xs.length - 1 && xs[k] < r.d[i]) k++;
        const f = Math.max(0, Math.min(1, (r.d[i] - xs[k - 1]) / Math.max(1e-9, xs[k] - xs[k - 1]))); pw[i] = ys[k - 1] + (ys[k] - ys[k - 1]) * f; }
      pw[r.n - 1] = ys[ys.length - 1];
      // margin from the number of rays counted at the shore (all directions): Poisson, about 1/sqrt(n)
      // likely range: ray-counting noise (about 1/sqrt(n)) or the gap between the two halves of the
      // direction spread, whichever is wider
      const R0 = ratio[last], cnt = R0 / Math.sqrt(Math.max(1, endRaw)) + (endRaw ? 0 : 0.02);
      const hv = half.map(([a, w]) => w ? a / w * SP / (2 * RR) : R0), dirGap = Math.abs(hv[0] - hv[1]) / 2;
      const m = Math.max(cnt, dirGap);
      pw.info = { window: Math.round(2 * RR), started: Math.round(2 * RR / SP), arrived: +endHits.toFixed(1), raw: endRaw, lo: Math.max(0, R0 - m), hi: R0 + m };
      return pw;
    } catch (e) { if (e.message === 'stale') return null; throw e; }
  }

  let pwTimer = 0;
  function pwJob(r) { if (!r.pwJob) r.pwJob = spreading(r, () => S.ray === r || S.keep === r).then((pw) => { if (pw) { r.pw = pw; if (S.phase === 'setup') hudSetup(); } else r.pwJob = null; return pw; }); return r.pwJob; }
  function schedulePw(r) { clearTimeout(pwTimer); pwTimer = setTimeout(() => { if (S.ray === r) pwJob(r); }, 300); }
  function ensurePw(r) { return r ? (r.pw ? Promise.resolve(r.pw) : (clearTimeout(pwTimer), pwJob(r))) : Promise.resolve(null); }
  const pwAt = (r, dd) => { const { i, f } = at(r, dd); return r.pw[i] + (r.pw[Math.min(r.n - 1, i + 1)] - r.pw[i]) * f; };
  // height change from start to the end: spreading/focusing x shoaling, read at 4 m of water
  const heightFactor = (r, p) => Math.sqrt(p * cg(r.T, Math.max(r.h[0], 1)) / cg(r.T, 4));

  // ── ray sampling
  function at(r, dd) {
    let lo = 0, hi = r.n - 1;
    if (dd <= 0) return { i: 0, f: 0 };
    if (dd >= r.len) return { i: r.n - 2, f: 1 };
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.d[m] <= dd) lo = m; else hi = m; }
    return { i: lo, f: (dd - r.d[lo]) / Math.max(1e-9, r.d[lo + 1] - r.d[lo]) };
  }
  const lerp = (a, b, f) => a + (b - a) * f;
  function sample(r, dd) {
    const { i, f } = at(r, dd);
    return { i, lon: lerp(r.lon[i], r.lon[i + 1], f), lat: lerp(r.lat[i], r.lat[i + 1], f), h: lerp(r.h[i], r.h[i + 1], f), t: lerp(r.t[i], r.t[i + 1], f) };
  }
  function headingAt(r, dd, back) {
    const a = sample(r, Math.max(0, dd - back)), b = sample(r, dd);
    return (Math.atan2((b.lon - a.lon) * KX, (b.lat - a.lat) * KY) / D2R + 360) % 360;
  }
  const fromDeg = (trav) => (trav + 180) % 360;

  // ── canvas
  let cw = 0, chh = 0, dpr = 1;
  function size() {
    const b = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    cw = b.width; chh = b.height; cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr);
    draw();
  }
  new ResizeObserver(size).observe(cv);
  if (inCv) new ResizeObserver(() => { const b = inCv.getBoundingClientRect(); inW = b.width; inH = b.height; inCv.width = Math.round(inW * dpr); inCv.height = Math.round(inH * dpr); draw(); }).observe(inCv);

  // ── state
  const S = { phase: 'setup', T: 12, start: [-71.85, 38.91], th: null, ray: null, keep: null, dist: 0, playing: false, hold: 0, last: 0, cam: null, target: null, note: '' };
  const MINW = 3;
  function playView(r, dd) {
    const end = P(r.lon[r.n - 1], r.lat[r.n - 1]); const s = sample(r, dd); const hd = P(s.lon, s.lat);
    const rem = Math.max(0, r.len - dd);
    const W = Math.min(900, 1.5 * rem + MINW);
    const k = rem / (rem + 3), sc = Math.min(cw, chh) / W, ins = cw ? insets() : { top: 0, bottom: 0, right: 0 };
    // centered in the part of the map the overlays leave clear
    return { cx: lerp(end[0], (hd[0] + end[0]) / 2, k) + ins.right / 2 / sc, cy: lerp(end[1], (hd[1] + end[1]) / 2, k) - (ins.top - ins.bottom) / 2 / sc, W };
  }
  // the part of the map the overlays leave clear (px): readout on top, buttons and the layers
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
  }
  const MAPV = () => S.phase === 'week' || S.phase === 'past';      // the forecast and past views: same camera, colors and layers
  function cam() { return S.phase === 'setup' || MAPV() ? S.cam : playView(S.ray, S.dist); }
  function proj(v) { const sc = Math.min(cw, chh) / v.W; return { sc, x0: v.cx - cw / 2 / sc, y0: v.cy - chh / 2 / sc }; }
  function unproject(px, py) { const v = cam(), { sc, x0, y0 } = proj(v); return [(px / sc + x0) / KX, -(py / sc + y0) / KY]; }
  function drawImg(im, b, x0, y0, sc, alpha) {
    if (!im || alpha <= 0) return;
    const p0 = P(b[0], b[3]), p1 = P(b[1], b[2]);
    ctx.globalAlpha = alpha;
    blit(ctx, im, (p0[0] - x0) * sc, (p0[1] - y0) * sc, (p1[0] - p0[0]) * sc, (p1[1] - p0[1]) * sc);
    ctx.globalAlpha = 1;
  }
  const hudBottom = () => INS.top;
  const ramp = (W, hi, lo) => Math.max(0, Math.min(1, (hi - W) / (hi - lo)));
  function draw() {
    if (!cw || !chh) return;
    tileFrame++;                                             // one pass (the map and its inset) is one frame for the tile cache
    INS = insets(); RECTS = overlayRects();
    INSET = false; render(cam());
    if (reduce && MAPV()) fxStatic();
    if (inCv && !inCv.parentElement.hidden && S.ray && inW && !MAPV()) {
      const mc = [ctx, cw, chh]; ctx = inCtx; cw = inW; chh = inH; INSET = true;
      const e = P(S.ray.lon[S.ray.n - 1], S.ray.lat[S.ray.n - 1]);
      render({ cx: e[0], cy: e[1], W: 1.6 });
      [ctx, cw, chh] = mc; INSET = false;
    }
  }
  function render(v) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1622'; ctx.fillRect(0, 0, cw, chh);
    if (!v) return;
    const { sc, x0, y0 } = proj(v);
    const X = (lon) => (lon * KX - x0) * sc, Y = (lon, lat) => (-lat * KY - y0) * sc;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const WEEK = MAPV() && !INSET;
    if (WEEK) fcBackdrop(x0, y0, sc);
    // in the forecast, the detailed sea-floor images fade in only as you zoom toward the coast, so their
    // edges don't show against the ocean-wide backdrop
    const da = WEEK ? ramp(v.W, 700, 400) : 1;
    if (L.meta) { const b = L.meta.bounds, hx = 1 / 240; drawImg(L.atl, [b[0] - hx, b[1] + hx, b[2] - hx, b[3] + hx], x0, y0, sc, da); }
    if (L.shelf && L.shelfB) { const b = L.shelfB, hx = 1 / 480; drawImg(L.shelf, [b[0] - hx, b[1] + hx, b[2] - hx, b[3] + hx], x0, y0, sc, da); }
    drawTiles(x0, y0, sc, da, WEEK && FC.show.field && da > 0 ? soundField() : null);   // da > 0 first: the model loads only once you zoom in
    if (INSET || v.W < 6) for (const p of Object.values(reefPhotos())) drawImg(p.im, p.b, x0, y0, sc, INSET ? 1 : ramp(v.W, 6, 3));
    const NOFC = FCUI && S.phase === 'week' && (FC.out || FC.failed);   // the Forecast tab's map with no forecast for its hour
    if (WEEK && !NOFC) fcField(x0, y0, sc, v);
    if (WEEK && S.phase === 'week' && !NOFC) drawStorms(X, Y, v);
    else if (WEEK && S.phase === 'past') drawPastStorms(X, Y, v);
    const ca = 0.55 * (1 - ramp(v.W, 120, 40)) * (WEEK ? 1 - Math.min(1, fieldAlpha(v.W) * 2) : 1);
    if (L.meta && ca > 0.01) {
      ctx.lineWidth = 1;
      for (const [lev, lines] of Object.entries(L.meta.contours)) {
        ctx.strokeStyle = +lev >= 1000 ? `rgba(150,190,230,${ca * 0.55})` : `rgba(180,215,240,${ca})`;
        ctx.setLineDash(+lev >= 1000 ? [3, 4] : []);
        for (const a of lines) {
          ctx.beginPath();
          for (let i = 0; i < a.length; i += 2) { const lon = a[i] / 1000, lat = a[i + 1] / 1000; i ? ctx.lineTo(X(lon), Y(lon, lat)) : ctx.moveTo(X(lon), Y(lon, lat)); }
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    const spotBoxes = WEEK ? fcLabelBoxes(X, Y, v) : [];
    ctx.font = '500 12px "Instrument Sans", system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const [t, lon, lat, wmax, wmin] of LABELS) {
      if (WEEK && (t === 'Fishers Island' || t === 'edge of the continental shelf')) continue;
      const a = Math.min(ramp(v.W, wmax * 1.4, wmax), 1 - ramp(v.W, wmin, wmin * 0.6));
      if (a <= 0.02) continue;
      const lx = X(lon), ly = Y(lon, lat), hw = ctx.measureText(t).width / 2 + 4;
      if (lx - hw < 0 || lx + hw > cw || ly > chh - 6) continue;
      if (!INSET && (ly < INS.top || covered(lx - hw, ly - 12, lx + hw, ly + 4))) continue;   // keep clear of the controls
      if (WEEK && spotBoxes.some((r) => lx + hw > r[0] && lx - hw < r[2] && ly + 4 > r[1] && ly - 12 < r[3])) continue;
      ctx.fillStyle = `rgba(231,237,242,${0.75 * a})`; ctx.fillText(t, lx, ly);
    }
    drawReef(X, Y, INSET ? 0.9 : ramp(v.W, 8, 4) * 0.9);
    const sa = INSET || WEEK ? 0 : ramp(v.W, 80, 30) * (1 - ramp(v.W, 4, 2));
    if (sa > 0) {
      ctx.globalAlpha = sa;
      ctx.strokeStyle = '#4fb6c9'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X(W1[0]), Y(...W1)); ctx.lineTo(X(W2[0]), Y(...W2)); ctx.stroke();
      ctx.fillStyle = '#f08a4b'; ctx.beginPath(); ctx.arc(X(PEAK[0]), Y(...PEAK), 5, 0, 7); ctx.fill();
      ctx.font = '600 12px "Instrument Sans", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#e7edf2';
      ctx.fillText('Choc', X(PEAK[0]) + 8, Y(...PEAK) - 6);
      ctx.textAlign = 'right'; ctx.fillText('Wilderness', X(W2[0]) - 8, Y(...W2) - 6);
      ctx.globalAlpha = 1;
    }
    const ba = WEEK ? 0 : 1 - ramp(v.W, 40, 15);
    if (ba > 0) {
      ctx.globalAlpha = ba * 0.8; ctx.strokeStyle = '#e7edf2'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(BUOY[0]), Y(...BUOY), 4, 0, 7); ctx.stroke();
      ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#e7edf2'; ctx.fillText('buoy', X(BUOY[0]) + 7, Y(...BUOY) + 4);
      ctx.globalAlpha = 1;
    }
    const r = S.ray, k = S.keep;
    if (!MAPV() && k && k !== r) {                           // the wave kept to compare (side view), dashed, its landing marked
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      linePath(X, Y, k); ctx.strokeStyle = 'rgba(159,227,240,.8)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#9fe3f0'; ctx.beginPath(); ctx.arc(X(k.lon[k.n - 1]), Y(k.lon[k.n - 1], k.lat[k.n - 1]), 3.5, 0, 7); ctx.fill();
    }
    if (MAPV()) drawWeek(X, Y, v);
    else if (S.phase === 'setup') drawSetup(X, Y, r); else drawPlay(X, Y, r, v);
    if (INSET) { ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(231,237,242,.9)'; ctx.textAlign = 'left'; ctx.fillText('Arrival · 1.6 km', 8, 16); }
  }
  function linePath(X, Y, r, upto) {
    ctx.beginPath(); ctx.moveTo(X(r.lon[0]), Y(r.lon[0], r.lat[0]));
    const n = upto ? upto.i : r.n - 1;
    for (let i = 1; i <= n; i++) ctx.lineTo(X(r.lon[i]), Y(r.lon[i], r.lat[i]));
    if (upto) ctx.lineTo(X(upto.lon), Y(upto.lon, upto.lat));
  }
  function startLabel(X, Y, txt, o) {
    ctx.font = '500 12px "Instrument Sans", system-ui, sans-serif'; ctx.fillStyle = '#e7edf2';
    const ox = X(o[0]), oy = Y(...o), tw = ctx.measureText(txt).width;
    if (ox + 16 + tw < cw - 8) { ctx.textAlign = 'left'; ctx.fillText(txt, ox + 16, oy + 4); }
    else if (ox - 16 - tw > 8) { ctx.textAlign = 'right'; ctx.fillText(txt, ox - 16, oy + 4); }
    else { ctx.textAlign = 'center'; ctx.fillText(txt, Math.max(tw / 2 + 8, Math.min(cw - tw / 2 - 8, ox)), oy + 28); }
  }
  const KNOB = 64;
  function knobXY(X, Y) { const o = S.start, th = S.th * D2R; return [X(o[0]) + Math.sin(th) * KNOB, Y(...o) - Math.cos(th) * KNOB]; }
  function drawSetup(X, Y, r) {
    if (r) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      linePath(X, Y, r); ctx.strokeStyle = 'rgba(240,138,75,.3)'; ctx.lineWidth = 6; ctx.stroke();
      linePath(X, Y, r); ctx.strokeStyle = '#f08a4b'; ctx.lineWidth = 1.8; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      const e = [r.lon[r.n - 1], r.lat[r.n - 1]], ex = X(e[0]), ey = Y(...e);
      ctx.strokeStyle = '#fff3e6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ex - 5, ey - 5); ctx.lineTo(ex + 5, ey + 5); ctx.moveTo(ex + 5, ey - 5); ctx.lineTo(ex - 5, ey + 5); ctx.stroke();
    }
    if (!S.start || INSET) return;
    const o = S.start, ox = X(o[0]), oy = Y(...o);
    if (S.th != null) {
      const [kx, ky] = knobXY(X, Y);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(kx, ky, 15, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(kx, ky, 11, 0, 7); ctx.stroke();
      const th = S.th * D2R, ux = Math.sin(th), uy = -Math.cos(th);           // arrowhead inside the knob
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(kx + ux * 6, ky + uy * 6); ctx.lineTo(kx - ux * 4 - uy * 5, ky - uy * 4 + ux * 5); ctx.lineTo(kx - ux * 4 + uy * 5, ky - uy * 4 - ux * 5); ctx.fill();
    }
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ox, oy, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ox, oy, 12, 0, 7); ctx.stroke();
    const h = depthAt(o[0], o[1]);
    startLabel(X, Y, h ? 'Start, ' + Math.round(h).toLocaleString() + ' m deep' : 'Start', o);
  }
  function drawPlay(X, Y, r, v) {
    const o = [r.lon[0], r.lat[0]];
    ctx.fillStyle = '#e7edf2'; ctx.beginPath(); ctx.arc(X(o[0]), Y(...o), 4, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(231,237,242,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(o[0]), Y(...o), 9, 0, 7); ctx.stroke();
    if (S.dist < 25 && !INSET) startLabel(X, Y, 'Starts here, ' + Math.round(r.h[0]).toLocaleString() + ' m deep', o);
    const hd = sample(r, S.dist);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    linePath(X, Y, r, hd); ctx.strokeStyle = 'rgba(240,138,75,.28)'; ctx.lineWidth = 7; ctx.stroke();
    linePath(X, Y, r, hd); ctx.strokeStyle = '#f08a4b'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(231,237,242,.75)'; ctx.lineWidth = 1.5;
    for (let m = 30, j = 0; m < hd.t; m += 30) {                      // half-hour marks
      while (j < r.n - 2 && r.t[j + 1] < m) j++;
      const f = (m - r.t[j]) / Math.max(1e-6, r.t[j + 1] - r.t[j]);
      const lon = lerp(r.lon[j], r.lon[j + 1], f), lat = lerp(r.lat[j], r.lat[j + 1], f);
      const dx = (r.lon[j + 1] - r.lon[j]) * KX, dy = -(r.lat[j + 1] - r.lat[j]) * KY, n = Math.hypot(dx, dy) || 1;
      const px = X(lon), py = Y(lon, lat), ux = -dy / n * 5, uy = dx / n * 5;
      ctx.beginPath(); ctx.moveTo(px - ux, py - uy); ctx.lineTo(px + ux, py + uy); ctx.stroke();
    }
    const tr = headingAt(r, S.dist, Math.max(0.15, v.W / 200)) * D2R;
    const ex = Math.cos(tr), ey = Math.sin(tr), hx = X(hd.lon), hy = Y(hd.lon, hd.lat);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 18); g.addColorStop(0, 'rgba(255,214,170,.9)'); g.addColorStop(1, 'rgba(240,138,75,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 18, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff3e6'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(hx - ex * 14, hy - ey * 14); ctx.lineTo(hx + ex * 14, hy + ey * 14); ctx.stroke();
    if (!INSET) hudPlay(r, hd);
  }
  function fmtT(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h + ' h ' + String(m).padStart(2, '0') + ' min'; }
  function hudPlay(r, hd) {
    const L0 = G * r.T * r.T / (2 * Math.PI); let phase;
    if (S.phase === 'done') { const size = +$('tripSize').value || 0; phase = 'Landed: ' + r.land + (r.pw && size ? ` · ${size} ft → ${(size * heightFactor(r, pwAt(r, r.len))).toFixed(1)} ft` : ''); }
    else if (hd.h > L0 / 2) phase = 'Deep water: too deep to feel the bottom, so it runs straight';
    else if (hd.h > 25) phase = 'Over the shelf: feeling the bottom, slowing and bending';
    else phase = 'Shoaling: slowing fast, turning toward the shallows';
    $('tripPhase').textContent = phase;
    if (S.phase === 'done') energy(r, r.len); else $('tripPow').hidden = true;
    $('tripLine').textContent = S.phase === 'done'
      ? fmtT(r.t[r.n - 1]) + ' · ' + r.km + ' km · ' + r.T + ' s'
      : fmtT(hd.t) + ' · ' + Math.round(hd.h).toLocaleString() + ' m deep · ' + Math.round(cp(r.T, hd.h) * 3.6) + ' km/h';
  }
  function energy(r, dd) {
    const box = $('tripPow'); if (!box) return;
    if (!r) { box.hidden = true; return; }
    if (!r.pw) { box.hidden = false; $('tripPowFill').style.width = '0'; $('tripPowV').textContent = 'working it out…'; $('tripPowH').textContent = ''; return; }
    const p = pwAt(r, dd), hf = heightFactor(r, pwAt(r, r.len)), size = +$('tripSize').value || 0;
    box.hidden = false;
    $('tripPowFill').style.width = Math.min(100, p * 100 / 2) + '%';            // the bar runs to 200 %; the tick marks 100 %
    $('tripPowFill').style.background = p >= 1 ? 'var(--swell)' : 'var(--cool)';
    const atEnd = S.phase !== 'play' || dd >= r.len - 1e-6, inf = r.pw.info;
    $('tripPowV').textContent = `${Math.round(p * 100)}% of where it started` + (atEnd ? ` · ${inf.hi < 0.9 ? 'the bottom spread it out' : inf.lo > 1.1 ? 'the bottom focused it' : 'about the same as it started'}` : '');
    $('tripPowH').textContent = '';
    S.detail = [['Energy', `${Math.round(pwAt(r, r.len) * 100)}% of the start per meter of crest (likely ${Math.round(inf.lo * 100)}–${Math.round(inf.hi * 100)}%)`],
      ['Height', `×${hf.toFixed(2)} in 4 m of water, with shallowing${size ? ` · ${size} ft → ${(size * hf).toFixed(1)} ft` : ''}`],
      ['Rays', `${inf.started} per ${inf.window} m of crest at the start, ${inf.arrived} at the shore (±10° spread)`]];
    infoSync();
  }
  function hudSetup() {
    const r = S.ray;
    energy(r, r ? r.len : 0);
    const size = +$('tripSize').value || 0, arr = r && r.pw && size ? ` · ${size} ft → ${(size * heightFactor(r, pwAt(r, r.len))).toFixed(1)} ft` : '';
    $('tripPhase').textContent = S.start ? (r ? 'Lands: ' + r.land + arr : 'Drag the arrow to aim') : 'Tap the ocean to drop a wave';
    $('tripLine').textContent = S.start && r
      ? `${r.T} s from ${Math.round(fromDeg(S.th))}° · ${r.km} km · ${fmtT(r.t[r.n - 1])}` + (S.note ? ' · ' + S.note : '')
      : 'Drag the dot to move it, the arrow to aim it.';
  }

  // ── setup: retrace on every change (throttled to one per frame)
  let pend = false;
  function retrace() {
    if (pend) return; pend = true;
    requestAnimationFrame(() => {
      pend = false;
      if (GR.ok && S.start && S.th != null) S.ray = makeRay(S.T, S.start, S.th); else S.ray = null;
      hudSetup(); draw(); syncButtons();
    });
  }
  function toSetup(fit) {
    S.phase = 'setup'; S.playing = false;
    if (fit && S.ray) { const pts = []; for (let i = 0; i < S.ray.n; i += Math.max(1, S.ray.n >> 6)) pts.push([S.ray.lon[i], S.ray.lat[i]]); pts.push([S.ray.lon[S.ray.n - 1], S.ray.lat[S.ray.n - 1]], PEAK); S.cam = fitCam(pts); }
    if (!S.cam) S.cam = fitCam([S.start || [-71.5, 39], PEAK]);
    hudSetup(); draw(); syncButtons();
  }
  function syncButtons() {
    const setup = S.phase === 'setup';
    $('tripPlay').textContent = setup ? 'Play' : 'Back to map';
    $('tripPlay').disabled = setup && !S.ray;
    for (const id of ['tripAimC', 'tripAimW', 'tripAimM', 'tripRand']) $(id).disabled = !GR.ok;
    $('tripOut').textContent = S.phase === 'play' ? 'Tap the map to pause.' : S.turnShort && S.turnRay === S.ray ? S.turnShort
      : S.start ? 'Tap the water to move the start. Drag the white ring to aim.' : 'Tap the ocean to drop a wave.';
  }
  function infoSync() {                                      // this wave's numbers, in the info card
    const el = $('hubWave'); if (!el) return;
    el.innerHTML = !MAPV() && S.ray && S.ray.pw && S.detail ? window.CHOC.kv((S.turnTxt && S.turnRay === S.ray ? S.turnTxt : []).concat(S.detail)) : '';
  }
  function doAim(spot) {
    if (!GR.ok) return;
    if (!S.start) S.start = [-71.85, 38.91];
    if (S.phase !== 'setup') toSetup(false);
    $('tripPhase').textContent = 'Aiming…';
    setTimeout(() => {
      const b = aim(spot, S.T, S.start); S.th = (b.th + 360) % 360;
      const name = { c: 'Choc', w: 'Wilderness', m: 'Montauk' }[spot], r0 = spot === 'w' ? 150 : 250;
      S.note = b.m < rEff(S.T, r0) ? `aimed at ${name}` : b.m < 1e6 ? `best it can do: ${Math.round(b.m).toLocaleString()} m from ${name}` : `can't reach the survey map from here`;
      S.ray = makeRay(S.T, S.start, S.th);
      const pts = [S.start, [S.ray.lon[S.ray.n - 1], S.ray.lat[S.ray.n - 1]]]; S.cam = fitCam(pts);
      hudSetup(); draw(); syncButtons();
    }, 30);
  }
  function randomStart() {
    for (let k = 0; k < 60; k++) {
      const b = (95 + Math.random() * 120) * D2R, dkm = 250 + Math.random() * 350;
      const lat = 41.27 + dkm / 111 * Math.cos(b), lon = -71.96 + dkm / (111 * Math.cos(41 * D2R)) * Math.sin(b);
      const h = depthAt(lon, lat);
      if (h && h > 2000) { S.start = [lon, lat]; S.th = (bearing(S.start, PEAK) + (Math.random() * 20 - 10) + 360) % 360; S.note = 'random start'; return; }
    }
  }

  // ── pointer: tap = drop, drag dot = move, drag arrow = aim, drag elsewhere = pan, pinch / wheel = zoom
  const ptrs = new Map(); let drag = null;
  function localXY(e) { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
  // a map position that isn't a number draws nothing (and makes some canvas calls throw), so none is ever kept
  const finite = (...a) => a.every(Number.isFinite);
  function zoomAt(px, py, f) {
    const v = S.cam, { sc, x0, y0 } = proj(v); const wx = px / sc + x0, wy = py / sc + y0;
    const W = Math.max(MAPV() ? MAPMIN : 0.6, Math.min(MAPV() ? 9000 : 1400, v.W * f)), s2 = Math.min(cw, chh) / W;
    const cx = wx - (px - cw / 2) / s2, cy = wy - (py - chh / 2) / s2; if (!finite(W, cx, cy)) return;
    v.W = W; v.cx = cx; v.cy = cy; S.moved = true; draw();
  }
  const MAPMIN = 3;                                          // km across: the forecast grid and survey tiles hold no more detail than this
  const panMode = () => S.phase === 'setup' || MAPV();
  // iPhone and iPad Safari ignore CSS touch-action: none, so a pinch on the map zoomed the whole page (a
  // blurry, uniform close-up of the ocean) and a double-tap did the same. Block the browser's own pinch and
  // double-tap zoom over the maps; the map's pointer handlers still get every touch.
  function noPageZoom(el, always) {
    if (!el) return; let lastEnd = 0;
    const onMap = (e) => e.target && e.target.tagName === 'CANVAS';   // the map itself, not the panels and buttons over it
    el.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (onMap(e) && always())) e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { if (!onMap(e)) return; const t = e.timeStamp; if (t - lastEnd < 350 && e.changedTouches.length === 1) e.preventDefault(); lastEnd = t; }, { passive: false });
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(g, (e) => e.preventDefault(), { passive: false });
  }
  // On the Forecast tab the map sits in a page that scrolls: there one finger scrolls the page and two move the map
  // (and a mouse wheel scrolls; ctrl + wheel or a trackpad pinch zooms), as embedded maps do. In the tab's full
  // screen (methods-theme.js sets data-lcc-full) nothing scrolls, so one finger and the wheel move the map again.
  const pageScrolls = () => FCUI && !document.documentElement.dataset.lccFull;
  noPageZoom(stage, () => panMode() && !pageScrolls());
  let hintT = 0;
  function twoFingers() {
    let h = $('fcHint');
    if (!h) { h = document.createElement('div'); h.id = 'fcHint'; h.className = 'fc-hint'; h.setAttribute('aria-hidden', 'true'); h.textContent = 'Use two fingers to move the map'; stage.appendChild(h); }
    h.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => { h.hidden = true; }, 1600);
  }
  // Safari on a Mac sends a trackpad pinch as gesture events (not as ctrl+wheel like Chrome), and noPageZoom
  // blocks them so the page itself doesn't zoom: zoom the map with them instead. A touch screen (iPad) pinches
  // through the pointer handlers below, so this is for trackpads only.
  let gz = null;
  stage.addEventListener('gesturestart', (e) => { if (navigator.maxTouchPoints > 0 || !panMode()) return; gz = { W: S.cam.W }; });
  stage.addEventListener('gesturechange', (e) => {
    if (!gz || !(e.scale > 0)) return;
    const b = cv.getBoundingClientRect(), px = e.clientX != null ? e.clientX - b.left : b.width / 2, py = e.clientY != null ? e.clientY - b.top : b.height / 2;
    zoomAt(px, py, gz.W / e.scale / S.cam.W);
  });
  stage.addEventListener('gestureend', () => { gz = null; });
  cv.addEventListener('pointerdown', (e) => {
    if (!panMode()) return;
    cv.setPointerCapture(e.pointerId); const [px, py] = localXY(e); ptrs.set(e.pointerId, [px, py]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), W0: S.cam.W, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return; }
    const v = cam(), { sc, x0, y0 } = proj(v); const X = (lon) => (lon * KX - x0) * sc, Y = (lon, lat) => (-lat * KY - y0) * sc;
    let kind = 'pan';
    if (S.phase === 'setup' && S.start && S.th != null) { const [kx, ky] = knobXY(X, Y); if (Math.hypot(px - kx, py - ky) < 24) kind = 'aim'; }
    if (S.phase === 'setup' && kind === 'pan' && S.start && Math.hypot(px - X(S.start[0]), py - Y(...S.start)) < 22) kind = 'move';
    drag = { kind, x: px, y: py, sx: px, sy: py, t: performance.now(), cx: S.cam.cx, cy: S.cam.cy };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!panMode() || !ptrs.has(e.pointerId) || !drag) return;
    const [px, py] = localXY(e); ptrs.set(e.pointerId, [px, py]);
    if (drag.kind === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const f = (drag.W0 * drag.d0 / Math.max(10, d)) / S.cam.W; zoomAt(drag.mid[0], drag.mid[1], f); return;
    }
    const v = cam(), { sc, x0, y0 } = proj(v); const X = (lon) => (lon * KX - x0) * sc, Y = (lon, lat) => (-lat * KY - y0) * sc;
    if (drag.kind === 'aim') { S.th = (Math.atan2(px - X(S.start[0]), -(py - Y(...S.start))) / D2R + 360) % 360; S.note = ''; retrace(); }
    else if (drag.kind === 'move') { const ll = unproject(px, py); if ((depthAt(...ll) || 0) > 1) { S.start = ll; S.note = ''; retrace(); } }
    else if (pageScrolls() && e.pointerType === 'touch') { if (Math.hypot(px - drag.sx, py - drag.sy) > 12) twoFingers(); }
    else { const cx = drag.cx - (px - drag.sx) / sc, cy = drag.cy - (py - drag.sy) / sc; if (finite(cx, cy)) { S.cam.cx = cx; S.cam.cy = cy; S.moved = true; draw(); } }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    // one finger of a pinch lifted: the other pans on from where it is now. It used to carry on with the pinch's
    // drag, which has no starting point for a pan, and that left the map's position NaN and the map blank.
    if (drag && drag.kind === 'pinch' && ptrs.size === 1) { const [px, py] = [...ptrs.values()][0]; drag = { kind: 'pan', x: px, y: py, sx: px, sy: py, t: -Infinity, cx: S.cam.cx, cy: S.cam.cy }; }   // t: the end of a pinch is never a tap
    if (drag && drag.kind === 'pan' && ptrs.size === 0 && S.phase === 'setup') {
      const [px, py] = localXY(e);
      if (Math.hypot(px - drag.sx, py - drag.sy) < 6 && performance.now() - drag.t < 500) {      // a tap: drop the wave here
        const ll = unproject(px, py);
        if ((depthAt(...ll) || 0) > 1) { S.start = ll; if (S.th == null) S.th = bearing(ll, PEAK); S.note = ''; retrace(); }
        else { $('tripPhase').textContent = 'That’s land. Tap the water.'; }
      }
    }
    if (drag && drag.kind === 'pan' && ptrs.size === 0 && MAPV()) {
      const [px, py] = localXY(e);
      if (Math.hypot(px - drag.sx, py - drag.sy) < 6 && performance.now() - drag.t < 500) {
        const now = performance.now(), lt = S.lastTap;
        if (lt && now - lt.t < 350 && Math.hypot(px - lt.x, py - lt.y) < 30) { S.lastTap = null; FC.pick = null; FC.fan = null; FC.dot = null; zoomAt(px, py, 0.4); }   // double-tap: zoom in there
        else { S.lastTap = { t: now, x: px, y: py }; fcTap(px, py); }
      }
    }
    if (ptrs.size === 0) drag = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  // (a Safari trackpad pinch already zooming the map through the gesture events is not zoomed twice)
  cv.addEventListener('wheel', (e) => { if (!panMode() || (pageScrolls() && !e.ctrlKey)) return; e.preventDefault(); if (gz && e.ctrlKey) return; const [px, py] = localXY(e); zoomAt(px, py, Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  cv.addEventListener('click', () => { if (S.phase !== 'play') return; S.playing = !S.playing; S.last = 0; if (S.playing) requestAnimationFrame(frame); });

  // ── animation
  function frame(ts) {
    if (!S.playing) return;
    const dt = Math.min(0.05, (ts - (S.last || ts)) / 1000); S.last = ts;
    const r = S.ray;
    if (S.hold > 0) S.hold -= dt;
    else {
      const v = playView(r, S.dist);
      S.dist += dt * Math.max(0.3, 0.3 * v.W);
      if (S.dist >= r.len) { S.dist = r.len; S.phase = 'done'; S.playing = false; draw(); finish(); return; }
    }
    draw();
    if (S.playing) requestAnimationFrame(frame);
  }
  async function play() {
    if (!S.ray) return;
    if (S.phase !== 'setup') return;                         // only from the drop view's setup step, never over the forecast or past maps
    const r0 = S.ray;
    if (!r0.pw) { $('tripPhase').textContent = 'Working out how much energy arrives…'; await ensurePw(r0); if (S.phase !== 'setup' || S.ray !== r0 || !r0.pw) return; }
    S.phase = 'play'; S.dist = 0; S.hold = 1.2; S.last = 0; syncButtons(); cv.style.cursor = 'pointer';
    if (reduce) { S.dist = S.ray.len; S.phase = 'done'; draw(); finish(); return; }
    S.playing = true; requestAnimationFrame(frame);
  }
  function finish() {
    const r = S.ray; const tot = r.t[r.n - 1];
    const din = fromDeg(headingAt(r, Math.min(r.len, 25), 25)), dlast = fromDeg(headingAt(r, r.len, Math.min(0.6, r.len)));
    const turn = Math.round(((dlast - din + 540) % 360) - 180);
    S.turnRay = r;
    S.turnTxt = [['Landed', `${r.land} · ${fmtT(tot)} · ${r.km} km`],
      ['From', r.res.fine ? `${Math.round(din)}° at the start → ${Math.round(dlast)}° at the shore (the sea floor turned it ${Math.abs(turn)}°)` : `${Math.round(din)}° · never reached the survey map`]];
    S.turnShort = r.res.fine ? `Turned ${Math.abs(turn)}° by the sea floor · reaches the shore from ${Math.round(dlast)}°` : 'Never reached the survey map';
    syncButtons(); infoSync();
    setTimeout(() => { if (S.phase === 'done') toSetup(true); }, 2500);
  }

  // ── FORECAST: this week from GFS-Wave and ECMWF, ocean-wide down to the reef. fc/fc.json and the
  // field images come from fcpull.py (one pull per model run). The map shows each model's swell field
  // (color = height, moving streaks = direction, faster = longer period), rings the open-ocean swell
  // that is traveling straight at Choc from a direction the reef can see (tap one: when it gets
  // here), and at Fishers zoom draws Part 1's rays for each train. Heights at the spots are fcpull's
  // read of each model at buoy 44097 (where the history reads the swell), run through Part 1's rays.
  const FC = { d: null, model: 'gfs', spot: 'choc', i: 0, px: {}, cv: {}, timer: 0, files: {}, cur: [], pick: null, zoom: 'reg', aim: {}, tf: new Map(), ecIx: [], arr: {}, cam: null,
    show: { field: true, flow: true, aim: true, rays: true, wnd: false, storm: true } };
  try { Object.assign(FC.show, JSON.parse(localStorage.getItem('choc.fcLayers') || '{}')); } catch (e) { /* defaults */ }
  // the two spots: where swell is aimed, and the wind that grooms each (offshore direction, tolerance)
  const SPOT = { choc: { name: 'Choc', pt: PEAK, off: 335, tol: 60 }, wild: { name: 'Wilderness', pt: [(W1[0] + W2[0]) / 2, (W1[1] + W2[1]) / 2], off: 40, tol: 70 } };
  const FTm = 3.28084, perCol = (T, a) => (window.CHOC.perColor ? window.CHOC.perColor(T, a) : `rgba(240,138,75,${a})`);
  const MNAME = { gfs: 'GFS-Wave', ec: 'ECMWF' };
  const BUOY44097 = [-71.127, 40.969];                       // CDIP 154: the forecast and the history both read the swell here
  // the three "Go to" views: a center and an amount of map (degrees), shown at whatever shape the screen is
  const ZOOMS = { ocean: { c: [-55, 36], span: [70, 46] }, reg: { c: [-70, 39.1], span: [13, 8.2] }, fi: { c: [-71.86, 41.17], span: [0.8, 0.4] } };
  const fcData = (window.CHOC && window.CHOC.fcData) || json('fc/fc.json');
  // ocean-wide backdrop and land masks (ETOPO 2022: 6' for the ocean, 30" for the coast)
  img('ocean/ocean_bg.jpg').then((im) => { L.obg = im; if (MAPV()) draw(); });
  img('ocean/ocean_land.png').then((im) => { L.oland = im; });
  img('ocean/atl_land.png').then((im) => { L.aland = im; });
  json('ocean/ocean_meta.json').then((m) => { L.obgB = m && m.bounds; });
  function frFile(T) { if (!FC.files[T]) FC.files[T] = json(`fr/${T}.json`); return FC.files[T]; }

  // ── Eastern-time labels (the crew's clock, whatever the viewer's device says)
  const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23', year: 'numeric' });
  function etParts(ms) { const o = {}; for (const p of ETF.formatToParts(new Date(ms))) o[p.type] = p.value; o.h = +o.hour % 24; return o; }
  const h12 = (h, m) => `${h % 12 || 12}${m && m !== '00' ? ':' + m : ''}${h < 12 ? 'am' : 'pm'}`;
  const fcWhen = (ms) => { const p = etParts(ms); return `${p.weekday} ${p.day}, ${h12(p.h)}`; };
  function etMidnight(ms) {                                  // start of that Eastern calendar day
    const p = etParts(ms), wall = Date.UTC(+p.year, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(p.month), +p.day, p.h, +p.minute);
    return ms - (wall - Date.UTC(+p.year, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(p.month), +p.day));
  }
  const { sunWin, daylight } = window.CHOC;                 // sunrise and sunset at Choc (v13_map.js)
  const COMP = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (d) => COMP[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  // clean in light wind or wind near straight offshore: Choc 335 +-60, Wilderness 40 +-70 (as in Part 3)
  function windKind(w, spot) {
    if (!w) return null; if (w[0] < 6) return 'light';
    const q = SPOT[spot || FC.spot], g = Math.abs(((w[1] - q.off + 540) % 360) - 180);
    return g <= q.tol ? 'offshore' : g >= 180 - q.tol ? 'onshore' : 'cross';
  }
  const WINDCOL = { light: '#5fd08a', offshore: '#5fd08a', cross: '#d9b54a', onshore: '#e0475a' };
  const windWord = (k) => (k === 'light' || k === 'offshore' ? 'clean' : k === 'cross' ? 'cross-shore' : 'onshore');

  // ── field images: row = forecast step, one pixel per grid cell = (height dm, period 0.1 s, from/2 deg); 255 = no data
  function fcPx(model, g) {
    const k = model + '_' + g; if (k in FC.px) return FC.px[k];
    FC.px[k] = null;
    const d = FC.d, base = (d && d._base) || 'fc/';         // from the same place as the forecast's numbers; a published
    img(`${base}field_${k}.png${/^https?:/.test(base) ? '?m=' + encodeURIComponent(d.made) : ''}`).then((im) => {   // pull's images are keyed to it, so a cached older one never pairs with newer numbers
      if (!im || FC.d !== d) return;                         // ↻ brought a newer pull while this one loaded
      FC.px[k] = { w: im.width, a: window.CHOC.pixels(im) };
      FC.aim = {}; FC.arr = {};
      if (S.phase === 'week') { draw(); fcTimeline(); }
    });
    return null;
  }
  function cellAt(F, step, q) { const p = 4 * (step * F.w + q); return F.a[p] === 255 || F.a[p + 1] === 255 ? null : [F.a[p] / 10, F.a[p + 1] / 10, F.a[p + 2] * 2]; }
  function fcAt(lon, lat, model, step) {                     // [height m, period s, from deg] or null (land / outside)
    for (const g of ['reg', 'ocean']) {
      const F = fcPx(model, g), Gd = FC.d.grids[g]; if (!F) continue;
      const ia = Math.round((Gd.lat[0] - lat) / Gd.lat[2]), ja = Math.round((lon - Gd.lon[0]) / Gd.lon[2]);
      if (ia < 0 || ja < 0 || ia >= Gd.lat[3] || ja >= Gd.lon[3]) continue;
      const v = cellAt(F, step, ia * Gd.lon[3] + ja);
      if (v || g === 'reg') return v;
    }
    return null;
  }
  function fcFlow(lon, lat, model, step) {                   // smooth [period, from] for the streaks: bilinear over 4 cells, directions as vectors
    for (const g of ['reg', 'ocean']) {
      const F = fcPx(model, g), Gd = FC.d.grids[g]; if (!F) continue;
      const fi = (Gd.lat[0] - lat) / Gd.lat[2], fj = (lon - Gd.lon[0]) / Gd.lon[2];
      if (fi < 0 || fj < 0 || fi > Gd.lat[3] - 1 || fj > Gd.lon[3] - 1) continue;
      const i0 = Math.min(Gd.lat[3] - 2, Math.floor(fi)), j0 = Math.min(Gd.lon[3] - 2, Math.floor(fj)), a = fi - i0, b = fj - j0;
      let w = 0, T = 0, sx = 0, sy = 0;
      for (const [di, dj, ww] of [[0, 0, (1 - a) * (1 - b)], [0, 1, (1 - a) * b], [1, 0, a * (1 - b)], [1, 1, a * b]]) {
        const v = ww > 0 ? cellAt(F, step, (i0 + di) * Gd.lon[3] + j0 + dj) : null; if (!v) continue;
        w += ww; T += ww * v[1]; sx += ww * Math.sin(v[2] * D2R); sy += ww * Math.cos(v[2] * D2R);
      }
      if (w > 0.4) return [T / w, Math.atan2(sx, sy) / D2R];
      if (g === 'reg') return null;                          // coast or land inside the regional grid
    }
    return null;
  }
  const hCol = window.CHOC.hCol;                          // height colors (ft), shared with every map on the page
  function fcImage(model, g, step) {
    const k = model + g + step; if (FC.cv[k]) return FC.cv[k];
    const F = fcPx(model, g); if (!F) return null;
    const Gd = FC.d.grids[g], nla = Gd.lat[3], nlo = Gd.lon[3], c = document.createElement('canvas'); c.width = nlo; c.height = nla;
    const gx = c.getContext('2d'); if (!gx) return null;    // a phone out of canvas memory: skip the color, keep drawing the rest
    const id = gx.createImageData(nlo, nla);
    for (let q = 0; q < nla * nlo; q++) { const p = 4 * (step * F.w + q); if (F.a[p] === 255) continue;
      const la = Gd.lat[0] - Math.floor(q / nlo) * Gd.lat[2], lo = Gd.lon[0] + (q % nlo) * Gd.lon[2]; if (lo < -74.5 && la > 41.6) continue;   /* inland lakes: not our ocean */ const col = hCol(F.a[p] / 10 * FTm); id.data[4 * q] = col[0]; id.data[4 * q + 1] = col[1]; id.data[4 * q + 2] = col[2]; id.data[4 * q + 3] = 255; }
    gx.putImageData(id, 0, 0);
    if (Object.keys(FC.cv).length > 220) FC.cv = {};
    return (FC.cv[k] = c);
  }
  const gridB = (Gd) => [Gd.lon[0] - Gd.lon[2] / 2, Gd.lon[1] + Gd.lon[2] / 2, Gd.lat[1] - Gd.lat[2] / 2, Gd.lat[0] + Gd.lat[2] / 2];
  const fieldAlpha = (W) => 0.72 * (1 - ramp(W, 220, 90));       // the field gives way to the rays near Fishers
  const streakAlpha = (W) => Math.max(0.42, fieldAlpha(W));      // the streaks stay at every zoom, a little fainter close in

  // ── swell traveling at Choc: great-circle course from each open-ocean cell, and whether the reef sees that direction
  function gcKm(a, b) { const p1 = a[1] * D2R, p2 = b[1] * D2R, dl = (b[0] - a[0]) * D2R; return 6371 * Math.acos(Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl))); }
  function gcBrg(a, b) { const p1 = a[1] * D2R, p2 = b[1] * D2R, dl = (b[0] - a[0]) * D2R; return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D2R + 360) % 360; }
  function reefSees(T, from, spot) {                         // share of a swell from `from` that reaches the spot (the forward-ray kernels, as a height factor)
    const k = spot + Math.round(T) + '_' + Math.round(from); if (FC.tf.has(k)) return FC.tf.get(k);
    const v = window.CHOC.lab ? window.CHOC.lab.trainFactor(Math.round(T), Math.round(from), 15, spot) : 0; FC.tf.set(k, v); return v;
  }
  function fcAimed(model, step, spot) {
    const key = model + spot + step; if (FC.aim[key]) return FC.aim[key];
    const out = [], Rg = FC.d.grids.reg, R = [[Rg.lon[0], Rg.lat[1]], [Rg.lon[1], Rg.lat[0]]], tgt = SPOT[spot].pt; let ok = true;
    for (const g of ['ocean', 'reg']) {
      // GFS-Wave: every swell train in the cell (field_gfs_<grid>_sw.png, 3 pixels per cell), so a secondary swell
      // aimed at the spot shows too; ECMWF has no per-train directions, so its total sea stands in
      const SW = model === 'gfs' ? fcPx(model, g + '_sw') : null, F = SW || fcPx(model, g), np = SW ? 3 : 1, Gd = FC.d.grids[g];
      if (!F || (model === 'gfs' && !SW)) { ok = false; if (!F) continue; }
      const stp = g === 'reg' ? 2 : 1;                       // regional cells thinned to 0.5 deg
      for (let ia = 0; ia < Gd.lat[3]; ia += stp) for (let ja = 0; ja < Gd.lon[3]; ja += stp) {
        const lat = Gd.lat[0] - ia * Gd.lat[2], lon = Gd.lon[0] + ja * Gd.lon[2];
        if (g === 'ocean' && lat >= R[0][1] && lat <= R[1][1] && lon >= R[0][0] && lon <= R[1][0]) continue;
        const km = gcKm([lon, lat], tgt); if (km < 150) continue;       // the near field is the buoy-point model's job
        let best = null;
        for (let k = 0; k < np; k++) {
          const v = cellAt(F, step, (ia * Gd.lon[3] + ja) * np + k); if (!v || v[1] < 7 || v[0] < 0.3) continue;
          const off = Math.abs((((v[2] + 180) % 360) - gcBrg([lon, lat], tgt) + 540) % 360 - 180); if (off > 10) continue;
          const tf = reefSees(v[1], gcBrg(tgt, [lon, lat]), spot); if (tf < 0.12 || v[0] * tf < 0.2) continue;
          if (!best || v[0] * tf > best.h * best.tf) best = { lon, lat, h: v[0], T: v[1], D: v[2], km, tf, hrs: km * 1000 / (G * v[1] / (4 * Math.PI)) / 3600, a: g === 'ocean' ? 4 : 1 };
        }
        if (best) out.push(best);
      }
    }
    if (ok) FC.aim[key] = out;
    return out;
  }
  // when that aimed swell would reach Choc, summed over every forecast step (a shape, not a height)
  function fcArrivals(model, spot) {
    const ak = model + spot; if (FC.arr[ak]) return FC.arr[ak];
    const ts = FC.d.gfs.map((r) => Date.parse(r.t)), n = ts.length, a = new Float64Array(n), src = FC.d[model];
    for (let s = 0; s < src.length; s++) {
      const t0 = Date.parse(src[s].t), cells = fcAimed(model, s, spot);
      if (!FC.aim[model + spot + s]) return null;            // fields still loading
      for (const c of cells) { const t = t0 + c.hrs * 36e5; if (t > ts[n - 1] + 54e5) continue; let k = 0; while (k < n - 1 && ts[k + 1] <= t) k++; if (k < n - 1 && t - ts[k] > (ts[k + 1] - ts[k]) / 2) k++; a[k] += c.h * c.h * c.tf * c.tf * c.a; }
    }
    const m = Math.max(...a); if (m > 0) for (let k = 0; k < n; k++) a[k] /= m;
    return (FC.arr[ak] = a);
  }

  // ── the current step
  const fRow = () => (FC.model === 'gfs' ? FC.i : FC.ecIx[FC.i]);
  const ecRow = (i) => (FC.ecIx[i] == null ? null : FC.d.ec[FC.ecIx[i]]);
  const spotFt = (model, i, spot) => (model === 'gfs' ? FC.d.gfs[i][spot || FC.spot] : (ecRow(i) || {})[spot || FC.spot]);
  function setWeek(i) {
    if (FC.i !== i) { FC.fan = null; FC.dot = null; }        // a new hour: the dot picked belongs to the old one
    FC.i = i; const g = FC.d.gfs[i], e = ecRow(i);
    if (S.phase !== 'week') return;
    // the hour's swell trains (with what each brings to the spots); their rays are fetched once they show (raysFor)
    FC.cur = FC.model === 'gfs' ? g.trains.filter((t) => t.T >= 5).map((t) => ({ ft: t.ft, T: t.T, D: t.D, k: t.k, choc: t.choc, wild: t.wild }))
      : e ? [{ ft: e.hs, T: e.T, D: e.D }] : [];
    weekHud(); draw(); fcCursor();
  }
  // Part 1's rays for the trains on show (fr/<period>.json, 0.4-0.7 MB each): fetched the first time they are drawn,
  // zoomed in near Fishers, not for every hour scrubbed past at ocean or region zoom
  function raysFor(cur) {
    if (!cur.job) cur.job = Promise.all(cur.map(async (q) => {
      const f = await frFile(Math.max(6, Math.min(16, Math.round(q.T / 2) * 2))), De = Math.round(q.D / 5) * 5;
      q.rays = f && f[De] ? f[De].rays : null;
    })).then(() => { if (FC.cur === cur && MAPV()) draw(); });
    return cur.job;
  }
  function weekHud() {
    const i = FC.i, g = FC.d.gfs[i], e = ecRow(i), t = Date.parse(g.t), sp = FC.spot, c = spotFt(FC.model, i), wk = windKind(g.wind);
    $('tripPhase').textContent = `${fcWhen(t)} · ${SPOT[sp].name} ${c == null ? '–' : c.toFixed(1) + ' ft'}`;
    // GFS splits the sea into swells: say what share of the spot's energy each brings. ECMWF gives only the total sea.
    const mix = FC.model === 'gfs' ? window.CHOC.swell.shares(g.trains.map((t) => ({ ft: t.ft, T: t.T, D: t.D, at: t[sp] || 0 }))) : null;
    const nar = cw < 560, sw = mix && mix.length ? window.CHOC.swell.rows(mix, nar ? 1 : 2, nar ? null : SPOT[sp].name).map(([t, v]) => `${t} ${v}`)
      : e && e.hs != null ? [`Total sea ${window.CHOC.swell.sw({ ft: e.hs, T: e.T, D: e.D })}`] : [];
    const wl = `Wind ${window.CHOC.windArrow(g.wind[1])}${g.wind[0]} kn ${compass(g.wind[1])}, ${windWord(wk)}`;
    $('tripLine').innerHTML = sw.concat([wl + (nar ? '' : ` · GFS ${g[sp].toFixed(1)} · ECMWF ${e && e[sp] != null ? e[sp].toFixed(1) : '–'} ft`)]).join('<br>');
    $('tripPow').hidden = true;
  }

  // The Forecast tab's swell colours (previews/clean/forecast.js): by where a swell comes from, the same on its rows,
  // bars and these rays
  const FAM = [{ name: 'E', rgb: [64, 190, 198] }, { name: 'SE', rgb: [240, 138, 75] }, { name: 'S', rgb: [170, 128, 236] }, { name: 'other', rgb: [140, 154, 168] }];
  const famOf = (d) => (d >= 60 && d < 115 ? 0 : d >= 115 && d < 160 ? 1 : d >= 160 && d < 205 ? 2 : 3);
  // heights as the Forecast tab writes them (previews/clean/core.js heightNum): to 0.1 ft without a trailing .0, whole
  // feet from 10
  const ftTab = (v) => { if (v == null || !Number.isFinite(v)) return '–'; if (Math.abs(v) >= 9.95) return String(Math.round(v)); const r = Math.round(v * 10) / 10; return r === 0 ? '0' : r.toFixed(1).replace(/\.0$/, ''); };
  // the Forecast tab's headline number for a spot: the mean of GFS-Wave and ECMWF there (whichever it has)
  function fcMean(i, sp) { const v = [FC.d.gfs[i] && FC.d.gfs[i][sp], ecRow(i) && ecRow(i)[sp]].filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
  // The hour's GFS-Wave swells as the Forecast tab's rows list them: every train with a height at the spot, its share
  // of the spot's energy (height there squared over the sum), biggest first, under 0.5% left out. ECMWF: its total sea.
  function fcRanked() {
    const g = FC.d && FC.d.gfs[FC.i], e = ecRow(FC.i), sp = FC.spot; if (!g) return [];
    if (FC.model !== 'gfs') return e && Number.isFinite(e.hs) ? [{ t: { ft: e.hs, T: e.T, D: e.D }, share: 1 }] : [];
    const all = g.trains.filter((t) => Number.isFinite(t[sp]) && Number.isFinite(t.T) && Number.isFinite(t.D) && Number.isFinite(t.ft));
    const e2 = all.reduce((x, t) => x + t[sp] * t[sp], 0);
    return all.map((t) => ({ t, share: e2 > 0 ? t[sp] * t[sp] / e2 : 0 })).filter((x) => x.share >= 0.005).sort((x, y) => y.share - x.share);
  }
  // The Forecast tab's rays near Fishers, as its own map drew them: fr/land.json holds only the rays that land at Choc
  // or Wilderness, per period (6-16 s) and 5° of direction. Each swell is drawn over its spread (about ±10°, the
  // research page's cos^2s with s = 15), in its row's colour, as thick as its share of the spot's energy, and labelled
  // like its row where its rays come in.
  const LAND = { d: null, job: null };
  const landPer = (T) => [6, 8, 10, 12, 14, 16].reduce((b, x) => (Math.abs(x - T) < Math.abs(b - T) ? x : b), 6);
  function landSpread(d0) {
    const out = [], c = Math.round(d0 / 5) * 5; let tot = 0;
    for (let d = c - 10; d <= c + 10; d += 5) { const w = Math.pow(Math.cos((d - d0) * Math.PI / 360), 30); out.push([d, w]); tot += w; }
    return out.map(([d, w]) => [d, w / tot]);
  }
  function landRays(X, Y, alpha) {
    if (!LAND.job) LAND.job = json('fr/land.json').then((d) => { LAND.d = d && d.T && d.frame ? d : null; if (S.phase === 'week') draw(); });
    const Ld = LAND.d; if (!Ld) return;
    const fr = Ld.frame, u = Ld.unit_km, sp = FC.spot === 'wild' ? 'w' : 'c', ranked = fcRanked(), tags = []; let nr = 0;
    const XL = (xu) => X(fr.world[0] + xu * u / fr.kmlon), YL = (yu) => Y(0, fr.world[3] - yu * u / fr.kmlat);
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let n = ranked.length - 1; n >= 0; n--) {                // the biggest share drawn last, on top
      const { t, share } = ranked[n], per = Ld.T[String(landPer(t.T))] || {}, col = FAM[famOf(t.D)].rgb; let best = null;
      for (const [d, w] of landSpread(t.D)) {
        const rays = per[String(d)] && per[String(d)][sp]; if (!rays) continue;
        ctx.strokeStyle = `rgba(${col.join(',')},${Math.min(0.95, (0.22 + 0.7 * share) * (0.45 + 0.55 * w / 0.3)).toFixed(2)})`;
        ctx.lineWidth = 0.7 + 2.6 * share;
        for (const r of rays) { nr++; ctx.beginPath(); for (let k = 0; k < r.length; k += 2) k ? ctx.lineTo(XL(r[k]), YL(r[k + 1])) : ctx.moveTo(XL(r[k]), YL(r[k + 1])); ctx.stroke(); }
        if (!best || w > best.w) best = { w, r: rays[Math.floor(rays.length / 2)] };
      }
      if (best) tags.push({ x: XL(best.r[0]), y: YL(best.r[1]), col: `rgb(${col.join(',')})`, txt: `${n + 1}° ${ftTab(t.ft)} ft @ ${Math.round(t.T)} s ${compass(t.D)} · ${Math.round(share * 100)}%` });
    }
    ctx.restore();
    FC.rayTags = tags.map((q) => q.txt); FC.rayCount = nr;
    rayTags(tags, alpha);
  }
  function mapNote(t) {                                      // one short line over the map, low in the middle
    ctx.save(); ctx.font = '600 13px "Instrument Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(t).width + 24, x = cw / 2, y = Math.max(INS.top + 20, chh - INS.bottom - 26);
    ctx.fillStyle = 'rgba(10,15,21,.86)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 14, w, 28, 14) : ctx.rect(x - w / 2, y - 14, w, 28); ctx.fill();
    ctx.fillStyle = '#e7edf2'; ctx.fillText(t, x, y); ctx.restore();
    FC.note = t;
  }
  function rayTags(tags, alpha) {                            // each swell's label where its rays come in, kept apart
    ctx.save(); ctx.globalAlpha = alpha; ctx.font = '600 12px "Instrument Sans", system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const placed = [];
    for (const t of tags) {
      const w = ctx.measureText(t.txt).width + 14; let x = Math.max(6, Math.min(cw - w - 6 - INS.right, t.x + 6)), y = Math.max(INS.top + 10, Math.min(chh - INS.bottom - 12, t.y - 14));
      for (let n = 0; n < 8 && placed.some((b) => x < b[0] + b[2] && x + w > b[0] && Math.abs(y - b[1]) < 22); n++) y += y > chh / 2 ? -23 : 23;
      placed.push([x, y, w]);
      ctx.fillStyle = 'rgba(10,15,21,0.86)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - 10, w, 20, 10) : ctx.rect(x, y - 10, w, 20); ctx.fill();
      ctx.fillStyle = t.col; ctx.fillText(t.txt, x + 7, y);
    }
    ctx.restore();
  }

  // ── drawing (called from render)
  function fcLabelBoxes(X, Y, v) {                           // where drawWeek will put the spot labels, so place names stay clear
    if (S.phase === 'week' && !FC.d) return [];
    const out = [], near = v.W < 160; ctx.save(); ctx.font = '600 13px "Instrument Sans", system-ui, sans-serif';
    const box = (x, y, w, right) => out.push(right ? [x - w - 4, y - 16, x + 12, y + 6] : [x - 12, y - 16, x + w + 4, y + 6]);
    const cwid = ctx.measureText('Choc 00.0 ft').width, wwid = ctx.measureText('Wilderness 00.0 ft').width, cx = X(PEAK[0]), wx = X(SPOT.wild.pt[0]);
    if (near || FC.spot === 'choc') { const r = !near && cx - 9 - cwid >= 6; box(r ? cx - 9 : cx + 9, Y(...PEAK) - 6, cwid, r); }
    if (near || FC.spot === 'wild') { const r = near || wx - 9 - wwid >= 6; box(r ? wx - 9 : wx + 9, Y(...SPOT.wild.pt) + (near ? 12 : -6), wwid, r); }
    ctx.restore(); return out;
  }
  function fcBackdrop(x0, y0, sc) { if (L.obg && L.obgB) drawImg(L.obg, L.obgB, x0, y0, sc, 1); }
  function landMask(g, x0, y0, sc) {                         // cut land out of whatever is on `g`
    const put = (im, b) => { if (!im || !b) return; const p0 = P(b[0], b[3]), p1 = P(b[1], b[2]); blit(g, im, (p0[0] - x0) * sc, (p0[1] - y0) * sc, (p1[0] - p0[0]) * sc, (p1[1] - p0[1]) * sc); };
    g.globalCompositeOperation = 'destination-out'; put(L.oland, L.obgB); put(L.aland, L.meta && L.meta.bounds); g.globalCompositeOperation = 'source-over';
  }
  const layer = document.createElement('canvas'), lctx = layer.getContext('2d');
  function fcField(x0, y0, sc, v) {
    // the color stays at full strength over open water at every zoom; only over the survey map (where the sea
    // floor and Part 1's rays take over close in) does it fade as you zoom in. Fading it everywhere left open
    // water off New Jersey or south of Block Island dark and empty when zoomed in.
    const fa = fieldAlpha(v.W), full = fieldAlpha(1e9); if (!FC.show.field || (S.phase === 'week' && !FC.d)) return;
    const rw = Math.round(cw * dpr), rh = Math.round(chh * dpr); if (layer.width !== rw || layer.height !== rh) { layer.width = rw; layer.height = rh; }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, cw, chh); lctx.imageSmoothingEnabled = true; lctx.imageSmoothingQuality = 'high';
    for (const [im, b] of fieldImages()) {
      const p0 = P(b[0], b[3]), p1 = P(b[1], b[2]);
      blit(lctx, im, (p0[0] - x0) * sc, (p0[1] - y0) * sc, (p1[0] - p0[0]) * sc, (p1[1] - p0[1]) * sc);
    }
    landMask(lctx, x0, y0, sc);
    if (fa < full - 1e-3 && L.world) {                      // thin it out over the survey map only (its feathered mask)
      const wl = -(x0 - TW.left * KX) * sc, wt = -(y0 + TW.top * KY) * sc;
      lctx.globalCompositeOperation = 'destination-out'; lctx.globalAlpha = 1 - Math.max(0.4, fa / full);   // keep 40% of the color there too
      blit(lctx, L.world, wl, wt, TW.W * TW.px_km * sc, TW.H * TW.px_km * sc);
      lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1;
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = full; ctx.drawImage(layer, 0, 0); ctx.restore();
  }
  function pill(x, y, lines, anchor) {                       // a small dark callout; anchor 'l' = box to the right of x
    FC.pillLines = lines;
    ctx.font = '600 12px "Instrument Sans", system-ui, sans-serif';
    const w = Math.max(...lines.map((s) => ctx.measureText(s).width)) + 16, h = 8 + 16 * lines.length;
    let bx = anchor === 'l' ? x + 10 : x - w / 2, by = y - h - 10;
    bx = Math.max(6, Math.min(cw - w - 6 - INS.right, bx)); if (by < INS.top) by = y + 12; if (by + h > chh - INS.bottom) by = y - h - 10;
    ctx.fillStyle = 'rgba(7,11,16,.86)'; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 6) : ctx.rect(bx, by, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e7edf2'; ctx.textAlign = 'left';
    lines.forEach((s, k) => { if (k) ctx.font = '12px "Instrument Sans", system-ui, sans-serif'; ctx.fillText(s, bx + 8, by + 17 + 16 * k); });
  }
  function drawWeek(X, Y, v) {
    const PAST = S.phase === 'past';
    FC.note = '';
    if (!PAST && FCUI && (FC.failed || (FC.d && FC.out))) { mapNote(FC.failed ? 'The forecast didn’t load' : 'No model forecast for this hour'); return; }
    if (!PAST && !FC.d) return;
    const fa = fieldAlpha(v.W), row = PAST ? null : fRow(), t0 = row == null ? 0 : Date.parse(FC.d[FC.model][row].t);
    if (PAST) drawWind(X, Y, v);
    // swell headed for the spot: dots, bigger for swell that would arrive bigger
    if (!PAST && fa > 0.05 && FC.show.aim) {
      ctx.save(); ctx.globalAlpha = fa / 0.72;
      for (const c of row == null ? [] : fcAimed(FC.model, row, FC.spot)) {
        const x = X(c.lon), y = Y(c.lon, c.lat); if (x < -10 || y < -10 || x > cw + 10 || y > chh + 10) continue;
        ctx.fillStyle = `rgba(255,240,224,${0.3 + 0.5 * Math.min(1, c.tf * 2)})`; ctx.strokeStyle = 'rgba(20,20,20,.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, Math.min(7, 2 + c.h * c.tf * FTm * 0.5), 0, 7); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // Part 1's rays for each train, near Fishers
    const ra = FC.show.rays ? ramp(v.W, 320, 130) : 0;
    FC.rayTags = []; FC.rayCount = 0;
    if (ra > 0 && FCUI && !PAST) landRays(X, Y, ra);
    else if (ra > 0) {
      raysFor(FC.cur);
      const XW = (xk) => X(WB[0] + xk / KX), YW = (xk, yk) => Y(0, WB[3] - yk / KY);
      ctx.save(); ctx.globalAlpha = ra; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const tag = FC.spot === 'wild' ? 'w' : 'c';               // only the rays that reach the spot picked
      for (const q of [...FC.cur].sort((a, b) => a.ft - b.ft)) {
        if (!q.rays) continue;
        const wdt = Math.max(1, Math.min(5, 0.6 + q.ft * 0.45));
        for (const ray of q.rays) {
          if (!ray.h.includes(tag)) continue; const p = ray.p; if (p.length < 4) continue;
          // the traced part starts where the detailed sea floor begins; before that the swell came straight
          // in from open water, so a fading lead-in along its starting heading shows where it came from
          const k2 = Math.min(p.length - 2, 8), dx = p[k2] - p[0], dy = p[k2 + 1] - p[1], dl = Math.hypot(dx, dy) || 1;
          const sx = p[0] / 100, sy = p[1] / 100, bx = sx - dx / dl * 70, by = sy - dy / dl * 70;
          const gx0 = XW(bx), gy0 = YW(bx, by), gx1 = XW(sx), gy1 = YW(sx, sy), gr = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
          gr.addColorStop(0, perCol(q.T, 0)); gr.addColorStop(1, perCol(q.T, 0.9));
          ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy1); ctx.strokeStyle = gr; ctx.lineWidth = wdt; ctx.stroke();
          ctx.beginPath();
          for (let k = 0; k < p.length; k += 2) { const xk = p[k] / 100, yk = p[k + 1] / 100; k ? ctx.lineTo(XW(xk), YW(xk, yk)) : ctx.moveTo(XW(xk), YW(xk, yk)); }
          ctx.strokeStyle = perCol(q.T, 0.9); ctx.lineWidth = wdt; ctx.stroke();
        }
      }
      ctx.restore();
    }
    // buoy 44097: where both the forecast and the history read the swell before the rays carry it in
    if (v.W < 420 && !covered(X(BUOY44097[0]) - 8, Y(...BUOY44097) - 8, X(BUOY44097[0]) + 90, Y(...BUOY44097) + 8)) {
      const bx = X(BUOY44097[0]), by = Y(...BUOY44097), al = Math.min(1, ramp(v.W, 420, 300));
      ctx.save(); ctx.globalAlpha = al; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(10,16,22,.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx, by - 5.5); ctx.lineTo(bx + 5.5, by); ctx.lineTo(bx, by + 5.5); ctx.lineTo(bx - 5.5, by); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 4; ctx.fillStyle = 'rgba(240,244,248,.92)';
      ctx.fillText('buoy 44097', bx + 9, by + 4); ctx.restore();
    }
    // the spots: the one picked is labeled at every zoom, both near Fishers
    // (on the Forecast tab the spots carry its headline's number: the two models' mean, written as it writes heights)
    const spotNow = (sp) => (PAST ? pastFt(sp) : FCUI ? fcMean(FC.i, sp) : spotFt(FC.model, FC.i, sp));
    const c = spotNow('choc'), w = spotNow('wild'), near = v.W < 160, f1 = (q) => (q == null ? '–' : FCUI ? ftTab(q) : q.toFixed(1));
    FC.spotLabel = FC.spot === 'wild' ? `Wilderness ${f1(w)} ft` : `Choc ${f1(c)} ft`;   // (what the spot picked says, for tests)
    ctx.font = '600 13px "Instrument Sans", system-ui, sans-serif'; ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 4;
    if (near || FC.spot === 'choc') {
      ctx.fillStyle = '#f08a4b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(PEAK[0]), Y(...PEAK), 5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = FC.spot === 'choc' ? '#fff' : '#c9d3dc'; const ct = `Choc ${f1(c)} ft`, cx = X(PEAK[0]);
      if (near || cx - 9 - ctx.measureText(ct).width < 6) { ctx.textAlign = 'left'; ctx.fillText(ct, cx + 9, Y(...PEAK) - 8); } else { ctx.textAlign = 'right'; ctx.fillText(ct, cx - 9, Y(...PEAK) - 6); }
    }
    if (near || FC.spot === 'wild') {
      ctx.strokeStyle = '#4fb6c9'; ctx.lineWidth = near ? 4 : 3; ctx.beginPath(); ctx.moveTo(X(W1[0]), Y(...W1)); ctx.lineTo(X(W2[0]), Y(...W2)); ctx.stroke();
      if (!near) { ctx.fillStyle = '#4fb6c9'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(SPOT.wild.pt[0]), Y(...SPOT.wild.pt), 5, 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = FC.spot === 'wild' ? '#fff' : '#c9d3dc'; const wt = `Wilderness ${f1(w)} ft`, wx = X(W2[0]) - 9;
      if (!near) { const wx0 = X(SPOT.wild.pt[0]), lft = wx0 - 9 - ctx.measureText(wt).width < 6; ctx.textAlign = lft ? 'left' : 'right'; ctx.fillText(wt, lft ? wx0 + 9 : wx0 - 9, Y(...SPOT.wild.pt) - 6); }
      else if (wx - ctx.measureText(wt).width < 6) { ctx.textAlign = 'left'; ctx.fillText(wt, X(W1[0]) + 4, Y(...W1) + 20); }
      else { ctx.textAlign = 'right'; ctx.fillText(wt, wx, Y(...W2) + 16); }
    }
    ctx.shadowBlur = 0;
    // a tapped point: what the model has there, and when it would reach Choc if it is headed there
    if (!PAST && FC.fan && FC.pick) {
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const nm = SPOT[FC.spot].name, all = FC.fan.hit ? [...FC.fan.rays, { pts: FC.fan.hit.pts, land: nm }] : FC.fan.rays;
      for (const r of [...all].sort((a, b) => (a.land === nm) - (b.land === nm))) {   // the ones that reach the spot on top
        const hit = r.land === nm, main = hit, p = r.pts;
        ctx.beginPath(); for (let k = 0; k < p.length; k += 2) k ? ctx.lineTo(X(p[k]), Y(p[k], p[k + 1])) : ctx.moveTo(X(p[k]), Y(p[k], p[k + 1]));
        if (main) { ctx.strokeStyle = 'rgba(7,11,16,.55)'; ctx.lineWidth = 6; ctx.stroke(); }
        ctx.strokeStyle = hit ? '#f08a4b' : 'rgba(231,237,242,.45)'; ctx.lineWidth = hit ? 2.6 : 1.1; ctx.stroke();
        const ex = X(p[p.length - 2]), ey = Y(p[p.length - 2], p[p.length - 1]);
        ctx.fillStyle = hit ? '#f08a4b' : 'rgba(231,237,242,.7)'; ctx.beginPath(); ctx.arc(ex, ey, hit ? 3.5 : 2, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
    if (FC.pick && PAST) pastPick(X, Y);
    else if (FC.pick) {
      const [lon, lat] = FC.pick, all = row == null ? null : fcAt(lon, lat, FC.model, row), x = X(lon), y = Y(lon, lat);
      // a dot is one swell train aimed at the spot, often not the biggest one there: show that train
      const s = FC.dot ? [FC.dot.h, FC.dot.T, FC.dot.D] : all;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      if (!s) pill(x, y, ['No ' + MNAME[FC.model] + ' data here']);
      else {
        const sp = FC.spot, tgt = SPOT[sp].pt, nm = SPOT[sp].name;
        const toC = gcBrg([lon, lat], tgt), off = Math.abs((((s[2] + 180) % 360) - toC + 540) % 360 - 180), km = gcKm([lon, lat], tgt);
        // short lines, a surf report's way: the swell, then whether (and when) it reaches the spot
        const sw = (q) => `${(q[0] * FTm).toFixed(1)} ft @ ${Math.round(q[1])} s ${compass(q[2])}`, lines = [sw(s)];
        if (FC.dot && all && (Math.abs(((all[2] - s[2]) + 540) % 360 - 180) > 20 || Math.abs(all[1] - s[1]) > 1.5)) lines.push(`Biggest sea here: ${sw(all)}`);
        if (FC.fan) {                                   // the traced rays: where they land, and when
          const F = FC.fan, m = F.rays.find((r) => r.off === 0);
          if (F.searching) lines.push(`Tracing it into ${nm}…`);
          else if (F.hit) { lines.push(`Reaches ${nm} ~${fcWhen(F.t0 + F.hit.mins * 6e4)} (orange)`); lines.push('Gray: its spread, 1° apart'); }
          else lines.push(`Misses ${nm}: ${m.land === 'out to sea' ? 'runs out to sea' : `bends ${/^(near|on|off)/.test(m.land) ? '' : 'to '}${m.land}`}`);
        }
        else if (off <= 10 && s[1] >= 7 && reefSees(s[1], gcBrg(tgt, [lon, lat]), sp) >= 0.12) lines.push(`Headed for ${nm} · arrives ~${fcWhen(t0 + km * 1000 / (G * s[1] / (4 * Math.PI)) * 1000)}`);
        else lines.push(off <= 10 ? `Headed our way · ${nm}'s reef can't see that angle` : `Not headed for ${nm} (${Math.round(off)}° off)`);
        pill(x, y, lines);
      }
    }
    // zoomed out with Pressure & storms on, a run that has no pressure map (or whose map didn't load) says so
    if (!PAST && FC.d && stormAlpha(v.W) > 0.5 && (ST.status === 'none' || ST.status === 'failed')) mapNote(ST.status === 'none' ? 'This forecast run has no pressure map yet' : 'The pressure map didn’t load');
  }

  // ── PRESSURE AND STORMS (zoomed out): GFS's sea-level pressure at the hour every 4 hPa (bold every 20), the lows (L)
  // and highs (H), and each storm's track over the run, brighter for the hours still to come. From fcpull.py's
  // field_gfs_mslp.png: one row per GFS step, one pixel per cell of the ocean grid, tenths of a hPa above 800 in red
  // (high byte) and green (low byte), 65535 where there is none. Fades in from region zoom and is gone near Fishers.
  const ST = { key: null, status: 'idle', hpa: null, g: null, lows: null, tracks: null, drawn: null };
  const stormAlpha = (W) => (FC.show.storm ? ramp(W, 400, 1200) : 0);
  function stormLoad() {
    const d = FC.d, G = d && d.grids && d.grids.ocean;
    if (!d || !G || !d.mslp || !d.mslp.file) { ST.status = d ? 'none' : 'idle'; return; }
    const base = d._base || 'fc/', key = base + '|' + d.made;
    if (ST.key === key) return;
    ST.key = key; ST.status = 'loading'; ST.hpa = ST.g = ST.lows = ST.tracks = null;
    img(`${base}${d.mslp.file}${/^https?:/.test(base) ? '?m=' + encodeURIComponent(d.made) : ''}`).then((im) => {
      if (ST.key !== key) return;                            // a newer pull arrived meanwhile
      const n = G.lat[3] * G.lon[3];
      if (!im || im.width !== n) { ST.status = 'failed'; draw(); return; }
      const a = window.CHOC.pixels(im), hpa = [];
      for (let k = 0; k < im.height; k++) {
        const row = new Float32Array(n);
        for (let q = 0; q < n; q++) { const o = 4 * (k * n + q), v = a[o] << 8 | a[o + 1]; row[q] = v === 65535 ? NaN : v / 10 + 800; }
        hpa.push(row);
      }
      ST.hpa = hpa; ST.g = { hpa, ts: d.gfs.map((r) => Date.parse(r.t)), nla: G.lat[3], nlo: G.lon[3], lat0: G.lat[0], lon0: G.lon[0], dg: G.lat[2] };
      Object.assign(ST, trackLows(ST.g)); ST.status = 'ok';
      if (S.phase === 'week') draw();
    });
  }
  // Lows and highs at each step: a 1° cell lower (higher) than everything within 3° and at least 2 hPa below (above)
  // the ring 4° out, under 1008 hPa (over 1022), its centre refined between cells. Then each low is followed from step
  // to step (nearest low within what a storm can travel, 110 km/h) into tracks; a storm is a track that lasts a day or
  // more and gets to 1000 hPa or lower (shorter ones are mostly lows that form and fill again, and clutter the map).
  function trackLows(g) {                                    // g: {hpa: [rows], ts: [ms], nla, nlo, lat0 (north edge), lon0 (west edge), dg}
    const { nla, nlo, dg, ts } = g;
    const lows = g.hpa.map((P) => {
      const out = [];
      if (!P) return out;
      for (let i = 4; i < nla - 4; i++) {
        const lat = g.lat0 - i * dg; if (lat < 8 || lat > 68) continue;
        for (let j = 4; j < nlo - 4; j++) {
          const lon = g.lon0 + j * dg; if (lon < -100 || lon > 5) continue;
          const p = P[i * nlo + j]; if (!(p <= 1008 || p >= 1022)) continue;
          const low = p <= 1008; let ok = true;
          for (let a = -3; a <= 3 && ok; a++) for (let b = -3; b <= 3; b++) {
            if (!a && !b) continue;
            const v = P[(i + a) * nlo + j + b];
            if (v !== v || (low ? v < p || (v === p && (a < 0 || (a === 0 && b < 0))) : v > p || (v === p && (a < 0 || (a === 0 && b < 0))))) { ok = false; break; }
          }
          if (!ok) continue;
          let ring = 0, nr = 0;
          for (let t = 0; t < 16; t++) { const w = P[(i + Math.round(4 * Math.sin(t * Math.PI / 8))) * nlo + j + Math.round(4 * Math.cos(t * Math.PI / 8))]; if (w === w) { ring += w; nr++; } }
          if (!nr || (low ? ring / nr - p : p - ring / nr) < 2) continue;
          const pu = P[(i - 1) * nlo + j], pd = P[(i + 1) * nlo + j], pl = P[i * nlo + j - 1], pr = P[i * nlo + j + 1];
          const di = Math.max(-0.5, Math.min(0.5, (pu - pd) / (2 * (pu - 2 * p + pd)) || 0)), dj = Math.max(-0.5, Math.min(0.5, (pl - pr) / (2 * (pl - 2 * p + pr)) || 0));
          out.push({ lat: lat - di * dg, lon: lon + dj * dg, p, low });
        }
      }
      return out;
    });
    const tracks = []; let open = [];
    lows.forEach((Lk, k) => {
      const dt = k ? (ts[k] - ts[k - 1]) / 36e5 : 3, reach = Math.max(300, 110 * dt), next = [], taken = {}, used = {}, pairs = [];
      open.forEach((tr, ti) => { const last = tr.pts[tr.pts.length - 1]; Lk.forEach((x, xi) => { if (x.low) { const km = gcKm([last.lon, last.lat], [x.lon, x.lat]); if (km <= reach) pairs.push([km, ti, xi]); } }); });
      pairs.sort((a, b) => a[0] - b[0]);
      pairs.forEach(([, ti, xi]) => { if (used[ti] || taken[xi]) return; used[ti] = taken[xi] = 1; open[ti].pts.push(Object.assign({ k }, Lk[xi])); next.push(open[ti]); });
      Lk.forEach((x, xi) => { if (x.low && !taken[xi]) { const tr = { pts: [Object.assign({ k }, x)] }; tracks.push(tr); next.push(tr); } });
      open = next;
    });
    return { lows, tracks: tracks.filter((tr) => ts[tr.pts[tr.pts.length - 1].k] - ts[tr.pts[0].k] >= 864e5 && tr.pts.some((x) => x.p <= 1000)) };
  }
  function drawStorms(X, Y, v) {
    const al = stormAlpha(v.W); ST.drawn = null;
    if (al <= 0.02 || !FC.d) return;
    stormLoad();
    if (ST.g && ST.g.hpa[FC.i]) ST.drawn = drawPressure(X, Y, al, ST.g, FC.i, ST.lows, ST.tracks);
  }
  // isobars, tracks and the lows and highs of one step k of a pressure grid (the forecast's or a past day's)
  function drawPressure(X, Y, al, g, k, lowsAll, tracksAll) {
    const P = g.hpa[k], nla = g.nla, nlo = g.nlo, dg = g.dg, ts = g.ts, G = { lat: [g.lat0], lon: [g.lon0] };
    const a = unproject(0, 0), b = unproject(cw, chh), Lw = Math.min(a[0], b[0]), Rw = Math.max(a[0], b[0]), Bw = Math.min(a[1], b[1]), Tw = Math.max(a[1], b[1]);
    const info = { lows: [], highs: 0, tracks: 0, isobars: 0 };
    ctx.save(); ctx.globalAlpha = al; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // isobars: marching squares over the 1° cells on screen, a segment per cell per 4 hPa level
    const i0 = Math.max(0, Math.floor((G.lat[0] - Tw) / dg) - 1), i1 = Math.min(nla - 2, Math.ceil((G.lat[0] - Bw) / dg) + 1);
    const j0 = Math.max(0, Math.floor((Lw - G.lon[0]) / dg) - 1), j1 = Math.min(nlo - 2, Math.ceil((Rw - G.lon[0]) / dg) + 1);
    const at = (i, j, fi, fj) => { const lon = G.lon[0] + (j + fj) * dg; return [X(lon), Y(lon, G.lat[0] - (i + fi) * dg)]; };
    const thin = new Path2D(), bold = new Path2D();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const p1 = P[i * nlo + j], p2 = P[i * nlo + j + 1], p3 = P[(i + 1) * nlo + j + 1], p4 = P[(i + 1) * nlo + j];
      if (p1 !== p1 || p2 !== p2 || p3 !== p3 || p4 !== p4) continue;
      const lo = Math.min(p1, p2, p3, p4), hi = Math.max(p1, p2, p3, p4);
      for (let lv = Math.ceil(lo / 4) * 4; lv <= hi; lv += 4) {
        const pts = [], f = (u, w) => (lv - u) / (w - u), path = lv % 20 ? thin : bold;
        if ((p1 < lv) !== (p2 < lv)) pts.push(at(i, j, 0, f(p1, p2)));
        if ((p2 < lv) !== (p3 < lv)) pts.push(at(i, j + 1, f(p2, p3), 0));
        if ((p4 < lv) !== (p3 < lv)) pts.push(at(i + 1, j, 0, f(p4, p3)));
        if ((p1 < lv) !== (p4 < lv)) pts.push(at(i, j, f(p1, p4), 0));
        for (let q = 0; q + 1 < pts.length; q += 2) { path.moveTo(pts[q][0], pts[q][1]); path.lineTo(pts[q + 1][0], pts[q + 1][1]); info.isobars++; }
      }
    }
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.42)'; ctx.stroke(thin);
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.72)'; ctx.stroke(bold);
    // tracks: the whole run faint, the hours still to come brighter, a dot every 6 h
    const inView = (x) => x.lon >= Lw && x.lon <= Rw && x.lat >= Bw && x.lat <= Tw;
    for (const tr of tracksAll || []) {
      const pts = tr.pts; if (!pts.some(inView)) continue;
      info.tracks++; ctx.lineWidth = 1.6;
      for (let q = 1; q < pts.length; q++) {
        ctx.strokeStyle = pts[q].k > k ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.moveTo(X(pts[q - 1].lon), Y(pts[q - 1].lon, pts[q - 1].lat)); ctx.lineTo(X(pts[q].lon), Y(pts[q].lon, pts[q].lat)); ctx.stroke();
      }
      for (const x of pts) {
        if (Math.round(ts[x.k] / 36e5) % 6) continue;
        ctx.fillStyle = x.k > k ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(X(x.lon), Y(x.lon, x.lat), 1.8, 0, 7); ctx.fill();
      }
    }
    // the lows and highs at the hour, labelled with their pressure
    ctx.font = '700 12px "Instrument Sans", system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const x of (lowsAll && lowsAll[k]) || []) {
      if (!inView(x)) continue;
      const t = (x.low ? 'L ' : 'H ') + Math.round(x.p), tw = ctx.measureText(t).width + 12;
      const px = Math.max(tw / 2 + 2, Math.min(cw - tw / 2 - 2, X(x.lon))), py = Math.max(12, Math.min(chh - 12, Y(x.lon, x.lat)));
      if (x.low) info.lows.push({ p: Math.round(x.p), lat: Math.round(x.lat * 10) / 10, lon: Math.round(x.lon * 10) / 10 }); else info.highs++;
      ctx.fillStyle = 'rgba(10,15,21,0.82)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px - tw / 2, py - 10, tw, 20, 10) : ctx.rect(px - tw / 2, py - 10, tw, 20); ctx.fill();
      ctx.fillStyle = x.low ? '#ff8a8a' : '#8ac4ff'; ctx.fillText(t, px, py);
    }
    ctx.restore();
    return info;
  }

  // ── PRESSURE ON PAST DAYS: the same map from the history bot's ten years of sea-level pressure (ERA5, then GFS
  // analyses), every 6 hours at 1°: ocean/pressure/<year>.png, one row per step from Jan 1 00Z, one gray pixel per
  // cell (north to south, west to east), hPa = base + scale·v, 255 where there is none; ocean/pressure/meta.json says
  // the grid. The step nearest the hour on show is drawn; lows are followed over three days either side of it.
  const PP = { meta: undefined, years: {}, win: null };
  function pastPressure() {
    if (PP.meta === undefined) { PP.meta = null; json('ocean/pressure/meta.json').then((m) => { PP.meta = m || false; if (S.phase === 'past') draw(); }); }
    const m = PP.meta, x = DAYS[CST.idx]; if (!m || !x || CST.hour == null) return null;
    const t = hourAt(x.iso, CST.hour) + 18e5, y = new Date(t).getUTCFullYear(), Y0 = Date.UTC(y, 0, 1), info = m.years && m.years[y];
    if (!info) return null;
    if (PP.years[y] === undefined) {
      PP.years[y] = null;
      for (const k of Object.keys(PP.years)) if (+k !== y && Math.abs(+k - y) > 1) delete PP.years[k];   // memory: a year or two at a time
      img(`ocean/pressure/${y}.png`).then((im) => { PP.years[y] = im && im.width === m.cols ? { a: window.CHOC.pixels(im), n: im.height } : false; if (S.phase === 'past') draw(); });
    }
    const Yr = PP.years[y]; if (!Yr) return null;
    const step = m.hours * 36e5, k = Math.round((t - Y0) / step); if (k < 0 || k >= Yr.n) return null;
    const k0 = Math.max(0, k - 12), k1 = Math.min(Yr.n - 1, k + 12), key = y + '|' + k0 + '|' + k1;
    if (!PP.win || PP.win.key !== key) {
      const nla = Math.round((m.lat1 - m.lat0) / m.deg) + 1, nlo = Math.round((m.lon1 - m.lon0) / m.deg) + 1, hpa = [], ts = [];
      for (let r = k0; r <= k1; r++) {
        const row = new Float32Array(m.cols);
        for (let q = 0; q < m.cols; q++) { const v = Yr.a[4 * (r * m.cols + q)]; row[q] = v === m.missing ? NaN : m.base + m.scale * v; }
        hpa.push(row.some((v) => v === v) ? row : null); ts.push(Y0 + r * step);
      }
      const g = { hpa, ts, nla, nlo, lat0: m.lat1, lon0: m.lon0, dg: m.deg };
      PP.win = Object.assign({ key, g, k0 }, trackLows(g));
    }
    return PP.win.g.hpa[k - k0] ? { w: PP.win, k: k - k0, t: Y0 + k * step } : null;
  }
  function drawPastStorms(X, Y, v) {
    const al = stormAlpha(v.W); PP.drawn = null;
    if (al <= 0.02) return;
    const q = pastPressure(); if (!q) return;
    PP.drawn = Object.assign(drawPressure(X, Y, al, q.w.g, q.k, q.w.lows, q.w.tracks), { t: new Date(q.t).toISOString().slice(0, 13) + 'Z' });
  }

  // ── moving streaks over the field (Windy-style): drift along the travel direction, faster for longer period
  const fx = document.createElement('canvas'); fx.setAttribute('aria-hidden', 'true'); fx.style.pointerEvents = 'none'; cv.after(fx);
  const fxc = fx.getContext('2d'), PT = { list: [], key: '', run: false, vis: false };
  new ResizeObserver(() => { fx.width = Math.round(cw * dpr); fx.height = Math.round(chh * dpr); PT.key = ''; }).observe(cv);
  new IntersectionObserver((es) => { PT.vis = es.some((e) => e.isIntersecting); fxStart(); }).observe(cv);
  function fxStart() { if (!PT.run && PT.vis && MAPV() && !reduce && FC.show.flow) { PT.run = true; requestAnimationFrame(fxFrame); } }
  function fxClear() { fxc.setTransform(1, 0, 0, 1, 0, 0); fxc.clearRect(0, 0, fx.width, fx.height); }
  function fxFrame() {
    if (!MAPV() || !PT.vis || reduce || !FC.show.flow) { PT.run = false; fxClear(); return; }
    requestAnimationFrame(fxFrame);
    const v = S.cam, { sc, x0, y0 } = proj(v), fa = streakAlpha(v.W), key = [v.cx, v.cy, v.W, cw, chh, FC.model, S.phase].join();
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (key !== PT.key) { PT.key = key; fxc.clearRect(0, 0, cw, chh); for (const p of PT.list) p.age = 1e9; }
    if (fa < 0.05) { fxc.clearRect(0, 0, cw, chh); return; }
    fxc.globalCompositeOperation = 'destination-out'; fxc.fillStyle = 'rgba(0,0,0,0.045)'; fxc.fillRect(0, 0, cw, chh); fxc.globalCompositeOperation = 'source-over';
    const flow = flowFn(), N = Math.min(2200, Math.round(cw * chh / 240)); while (PT.list.length < N) PT.list.push({ x: 0, y: 0, age: 1e9, life: 0 }); PT.list.length = N;
    fxc.beginPath();
    for (const p of PT.list) {
      if (p.age > p.life) { p.x = Math.random() * cw; p.y = Math.random() * chh; p.age = 0; p.life = 60 + Math.random() * 120; /* slow streaks live longer so their trails still show */ }
      const s = flow ? flow((p.x / sc + x0) / KX, -(p.y / sc + y0) / KY) : null;
      if (!s) { p.age = 1e9; continue; }
      const b = (s[1] + 180) * D2R, sp = 0.0125 * s[0] + 0.025, nx = p.x + Math.sin(b) * sp, ny = p.y - Math.cos(b) * sp;
      if (p.age > 0 && Math.cos(b - p.b) < 0.6) { p.age = 1e9; continue; }   // turned more than ~53 deg in one step
      p.b = b; fxc.moveTo(p.x, p.y); fxc.lineTo(nx, ny); p.x = nx; p.y = ny; p.age++;
    }
    fxc.strokeStyle = `rgba(240,246,250,${0.6 * fa / 0.72})`; fxc.lineWidth = 1.1; fxc.stroke();
    landMask(fxc, x0, y0, sc);
  }
  function fxStatic() {                                      // reduced motion: still streamlines in place of moving ones
    fxClear(); if (!MAPV() || !FC.show.flow) return;
    const v = S.cam, { sc, x0, y0 } = proj(v), fa = streakAlpha(v.W), flow = flowFn(); if (fa < 0.05 || !flow) return;
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0); fxc.beginPath();
    for (let gy = 14, r = 0; gy < chh; gy += 24, r++) for (let gx = 12 + (r % 2) * 12; gx < cw; gx += 24) {
      let x = gx, y = gy; if (!flow((x / sc + x0) / KX, -(y / sc + y0) / KY)) continue; fxc.moveTo(x, y);
      for (let k = 0; k < 6; k++) { const q = flow((x / sc + x0) / KX, -(y / sc + y0) / KY); if (!q) break; const b = (q[1] + 180) * D2R, st = 0.25 * q[0]; x += Math.sin(b) * st; y -= Math.cos(b) * st; fxc.lineTo(x, y); }
    }
    fxc.strokeStyle = `rgba(240,246,250,${0.55 * fa / 0.72})`; fxc.lineWidth = 1; fxc.stroke(); landMask(fxc, x0, y0, sc);
  }

  // ── timeline under the map: Choc from both models, night shading, wind, and when aimed swell arrives
  function fcTimeline() {
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
  function fcCursor() {
    const t = FC.tl; if (!t || !$('fcCur')) return; const i = FC.i, X0 = t.x(t.ts[i]).toFixed(1);
    $('fcCur').setAttribute('x1', X0); $('fcCur').setAttribute('x2', X0);
    $('fcCurG').setAttribute('cx', X0); $('fcCurG').setAttribute('cy', t.y(t.gv[i]));
    const e = t.ec[i]; $('fcCurE').setAttribute('cx', X0); $('fcCurE').setAttribute('cy', e == null ? -20 : t.y(e));
  }
  function fcBest() {                                        // biggest daylight hour that isn't onshore, by the two models' average
    let best = -1, bv = -1; const sp = FC.spot;
    FC.d.gfs.forEach((r, i) => { const t = Date.parse(r.t), e = ecRow(i), m = e ? (r[sp] + e[sp]) / 2 : r[sp];
      if (daylight(t) && windKind(r.wind) !== 'onshore' && m > bv) { bv = m; best = i; } });
    const b = $('fcBest'); if (best < 0) { b.hidden = true; return; }
    const r = FC.d.gfs[best], e = ecRow(best), gap = e ? Math.abs(r[sp] - e[sp]) : 0;
    b.dataset.i = best; b.hidden = false; b.setAttribute('aria-label', `Jump to the best bet for ${SPOT[sp].name}`);
    b.innerHTML = `<b>Best bet</b> ${fcWhen(Date.parse(r.t))} · ${bv.toFixed(1)} ft<span class="x"> · ${windWord(windKind(r.wind))}` + (e ? (gap <= 0.5 ? ' · models agree' : ' · models differ') : '') + '</span>';
  }
  function fcAsOf(note) {
    const d = FC.d, made = Date.parse(d.made), p = etParts(made), hrs = Math.max(0, Math.round((Date.now() - made) / 36e5));
    const run = (r) => { const q = etParts(Date.parse(r.replace(/Z$/, ':00Z'))); return h12(q.h); };
    const txt = `As of ${p.weekday} ${p.month} ${p.day}, ${h12(p.h, p.minute)} ET` + (hrs >= 1 ? ` (${hrs < 48 ? hrs + ' h' : Math.round(hrs / 24) + ' days'} old)` : '') +
      (d.runs.gfs === d.runs.ec ? ` · GFS-Wave and ECMWF ${run(d.runs.gfs)} runs` : ` · GFS-Wave ${run(d.runs.gfs)} run · ECMWF ${run(d.runs.ec)} run`);
    $('fcAsOf').textContent = (note ? note[0].toUpperCase() + note.slice(1) + ' · ' : '') + txt; $('fcAsOf').title = txt;
  }
  function fcLoad(d) {                                       // the forecast's numbers, on load and when ↻ brings a newer pull
    if (!d) {
      $('fcAsOf').textContent = 'The forecast file didn’t load.';
      if (FCUI) { FC.failed = true; draw(); if (window.parent !== window) window.parent.postMessage({ type: 'lcc-fc-failed' }, location.origin); }
      return;
    }
    FC.failed = false;
    const at = FC.d ? Date.parse(FC.d.gfs[FC.i].t) : Date.now();   // first load: now; a newer pull keeps the hour on show
    FC.d = d; FC.px = {}; FC.cv = {}; FC.aim = {}; FC.arr = {};   // field images, colors and dots belong to the pull they came with
    FC.ecIx = d.gfs.map((r) => { const t = Date.parse(r.t); let b = null, bd = 3 * 36e5 + 1; d.ec.forEach((q, k) => { const x = Math.abs(Date.parse(q.t) - t); if (x < bd) { bd = x; b = k; } }); return b; });
    FC.i = 0; d.gfs.forEach((r, i) => { if (Date.parse(r.t) <= at) FC.i = i; });
    if (FCUI && FC.want != null) { FC.i = nearestStep(FC.want); FC.out = outOfRun(FC.want); }
    fcAsOf(); fcBest();
    if (S.phase === 'week') setMode('week');
    if (FCUI && window.parent !== window) window.parent.postMessage({ type: 'lcc-fc-ready', made: d.made }, location.origin);
  }
  function nearestStep(ms) { let b = 0, bd = Infinity; FC.d.gfs.forEach((r, i) => { const x = Math.abs(Date.parse(r.t) - ms); if (x < bd) { bd = x; b = i; } }); return b; }
  // The Forecast tab drives its map: {type: 'lcc-fc', time (ms or ISO), spot: 'choc' | 'wild', zoom: 'ocean' | 'reg' | 'fi'}.
  // A time shows the forecast step nearest it; a zoom (sent when the tab's Ocean, Region or Fishers is picked) moves the view.
  if (FCUI) addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent || window.parent === window) return;
    const m = e.data; if (!m) return;
    if (m.type === 'lcc-fc-refresh') { fcRefreshNow(); return; }   // the tab's ↻ (its bar's own is hidden there)
    if (m.type !== 'lcc-fc') return;
    if ((m.spot === 'choc' || m.spot === 'wild') && m.spot !== FC.spot) setSpot(m.spot);
    if (m.zoom && ZOOMS[m.zoom]) fcZoom(m.zoom);
    const t = typeof m.time === 'number' ? m.time : Date.parse(m.time || '');
    if (Number.isFinite(t)) {
      FC.want = t; if (!FC.d) return;
      const out = outOfRun(t), i = nearestStep(t);
      if (out !== FC.out) { FC.out = out; FC.pick = null; FC.fan = null; }
      if (S.phase === 'week') { if (i !== FC.i) setWeek(i); else draw(); }
    }
  });
  // an hour the run doesn't cover (as the tab decides: more than 3 h before its first step or 90 min after its last):
  // the map says so instead of showing the nearest step as that hour
  function outOfRun(t) { const g = FC.d.gfs; return t < Date.parse(g[0].t) - 3 * 36e5 || t > Date.parse(g[g.length - 1].t) + 90 * 6e4; }
  fcData.then(fcLoad);
  if (window.CHOC.onForecast) window.CHOC.onForecast(fcLoad);
  // ↻: the latest pull now, without waiting for a reload (a new one is published every 3 hours). On the Forecast tab
  // the site's header has the ↻ and sends lcc-fc-refresh (above).
  let noteT = 0;
  async function fcRefreshNow() {
    const b = $('fcRefresh'); if (b.disabled || !window.CHOC.fcRefresh) return;
    clearTimeout(noteT); b.disabled = true; b.classList.add('spin'); $('fcAsOf').textContent = 'Checking for a newer forecast…';
    const r = await window.CHOC.fcRefresh().catch(() => 'unreachable');
    b.disabled = false; b.classList.remove('spin');
    if (!FC.d) { $('fcAsOf').textContent = 'The forecast file didn’t load.'; return; }
    fcAsOf({ new: 'just updated', same: 'up to date', none: 'nothing published on GitHub yet' }[r] || 'couldn’t reach GitHub');
    noteT = setTimeout(() => fcAsOf(), 8000);               // then the date alone again: a phone's line is too short for both
  }
  $('fcRefresh').addEventListener('click', fcRefreshNow);
  { const st = []; for (let f = 0; f <= 20; f += 1) st.push(`rgb(${hCol(f)}) ${(Math.sqrt(f / 20) * 100).toFixed(1)}%`);   // keys use a square-root scale, like the colors
    for (const kb of document.querySelectorAll('.hub-key i')) kb.style.background = `linear-gradient(90deg, ${st.join(', ')})`; }

  function fcZoom(z) {
    FC.zoom = z; for (const b of document.querySelectorAll('#fcZoom button')) b.setAttribute('aria-pressed', String(b.dataset.v === z));
    const Z = ZOOMS[z], p = P(...Z.c); S.moved = false;       // the past covers the same ocean as the forecast, so both use the same views
    if (cw && chh) {
      // the same area of map on any screen: a wide iPad sees further east and west, a phone further north and south
      const ins = insets(), aw = Math.max(60, cw - ins.right - 16), ah = Math.max(60, chh - ins.top - ins.bottom - 8), m = Math.min(cw, chh);
      const wv = Math.sqrt(Z.span[0] * KX * Z.span[1] * KY * aw / ah), W = wv * m / aw, sc = m / W;
      S.cam = { cx: p[0] - (8 + aw / 2 - cw / 2) / sc, cy: p[1] - (ins.top + ah / 2 - chh / 2) / sc, W };
    } else S.cam = { cx: p[0], cy: p[1], W: Z.span[0] * KX };
    draw();
  }
  function fcTap(px, py) {                                   // tap a point: what's there (tap it again, or land, to clear)
    let ll = unproject(px, py); const v = cam(), { sc, x0, y0 } = proj(v);
    const same = FC.pick && Math.hypot((FC.pick[0] * KX - x0) * sc - px, (-FC.pick[1] * KY - y0) * sc - py) < 16;
    // a tap on (or next to) a "headed our way" dot picks that dot, and traces its swell in to the coast
    let dot = null;
    if (!same && S.phase === 'week' && FC.d && FC.show.aim && fRow() != null) {
      let bd = 18; for (const c of fcAimed(FC.model, fRow(), FC.spot)) { const d = Math.hypot((c.lon * KX - x0) * sc - px, (-c.lat * KY - y0) * sc - py); if (d < bd) { bd = d; dot = c; } }
      if (dot) ll = [dot.lon, dot.lat];
    }
    const at = atFn(), here = !same && at ? at(ll[0], ll[1]) : null; FC.pick = here ? ll : null;
    // any tap on the water traces that spot's swell in, not just the dots
    const sw = dot || (S.phase === 'week' && Array.isArray(here) && here[1] >= 5 ? { lon: ll[0], lat: ll[1], h: here[0], T: here[1], D: here[2] } : null);
    FC.fan = FC.pick && sw ? dotRays(sw) : null; FC.dot = FC.pick && dot ? dot : null; draw();
  }
  // the swell at a dot, traced in: 21 rays across +-10 deg of its travel direction, 1 deg apart (real swell
  // spreads), straight on great circles over the deep ocean, then over the sea floor with the same tracer as
  // Drop a wave. Each ray carries its travel time at group speed.
  function dotRays(c) {
    if (!GR.ok) {                                            // the depth grids load on the first trace: say so, then trace
      if (GR.ok === false) return null;
      const wait = { c, rays: [], searching: true };
      depthReady().then(() => { if (FC.fan === wait) { FC.fan = GR.ok ? dotRays(c) : null; draw(); } });
      return wait;
    }
    const ga = GR.a, inside = (lon, lat) => { const fi = (ga.north - lat) / ga.dlat, fj = (lon - ga.west) / ga.dlon; return fi > 2 && fj > 2 && fi < ga.rows - 3 && fj < ga.cols - 3; };
    const cgD = G * c.T / (4 * Math.PI), out = []; let entry = null;
    for (let off = -10; off <= 10; off++) {
      let lon = c.lon, lat = c.lat, brg = ((c.D + 180) % 360 + off + 360) % 360, km = 0; const pts = [lon, lat];
      while (!inside(lon, lat) && km < 9000) {                // deep water: a great circle, 25 km at a time
        const d = 25 / 6371, p1 = lat * D2R, l1 = lon * D2R, t = brg * D2R;
        const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
        const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
        const nl = [l2 / D2R, p2 / D2R]; brg = (gcBrg(nl, [lon, lat]) + 180) % 360; [lon, lat] = nl; km += 25; pts.push(lon, lat);
        if (lat > 70 || lat < -5) break;
      }
      let mins = km * 1000 / cgD / 60, land = 'out to sea';
      if (off === 0) entry = { lon, lat, brg, mins, ok: inside(lon, lat) && (depthAt(lon, lat) || 0) > 1 };
      if (inside(lon, lat) && (depthAt(lon, lat) || 0) > 1) {
        const r = trace(c.T, lon, lat, brg, true); const q = r.pts;
        for (let k = 0; k < q.length; k += 4) pts.push(q[k], q[k + 1]);
        mins += q.length ? q[q.length - 1] : 0; land = place(r, c.T);
      }
      out.push({ off, pts, mins, land });
    }
    const fan = { c, rays: out, t0: Date.parse(FC.d[FC.model][fRow()].t), hit: null, searching: !!(entry && entry.ok) };
    // the fan's rays land kilometers apart; the exact ray into the spot comes from the same search as
    // "Aim at Choc", limited to headings inside this swell's spread
    if (fan.searching) setTimeout(() => {
      if (FC.fan !== fan) return;
      const sp = FC.spot === 'wild' ? 'w' : 'c', b = aim(sp, c.T, [entry.lon, entry.lat]), dth = Math.abs(((b.th - entry.brg + 540) % 360) - 180);
      if (b.m < rEff(c.T, sp === 'c' ? 250 : 150) && dth <= 12) {
        const r = trace(c.T, entry.lon, entry.lat, b.th, true), q = r.pts, center = out.find((x) => x.off === 0), pts = center.pts.slice(0, center.pts.length - 0);
        // the great-circle part is shared with the center ray; then this ray's own path over the sea floor
        const pre = []; for (let k = 0; k < center.pts.length; k += 2) { pre.push(center.pts[k], center.pts[k + 1]); if (center.pts[k] === entry.lon && center.pts[k + 1] === entry.lat) break; }
        for (let k = 0; k < q.length; k += 4) pre.push(q[k], q[k + 1]);
        fan.hit = { pts: pre, mins: entry.mins + (q.length ? q[q.length - 1] : 0) };
      }
      fan.searching = false; draw();
    }, 30);
    return fan;
  }
  function fcStop() { clearInterval(FC.timer); FC.timer = 0; $('fcPlay').textContent = '▶'; $('fcPlay').setAttribute('aria-label', 'Play the week'); }
  let dropReady = false;
  function setMode(m) {
    if (EXUI && m === 'week') m = 'past';
    document.documentElement.dataset.hubMode = m;               // (Explore shows the ten years beside Past only)
    if (!FCUI) try { localStorage.setItem('choc.hubView', m); } catch (e) { /* fine */ }
    const was = S.phase, wasMap = was === 'week' || was === 'past';
    for (const b of document.querySelectorAll('#tripModeSeg button')) b.setAttribute('aria-pressed', String(b.dataset.v === m));
    for (const el of stage.querySelectorAll('[data-mode]')) el.hidden = !el.dataset.mode.split(' ').includes(m);
    fcStop(); pastStop(); FC.pick = null; FC.fan = null; FC.dot = null; FC.cur = []; botSize();
    if ((m === 'week' || m === 'past') && $('cutBox')) $('cutBox').hidden = true;   // the wave panel belongs to Drop a wave: hide it straight away
    if (m === 'week' || m === 'past') {
      if (!wasMap) { S.dcam = S.cam; S.playing = false; }
      S.phase = m; $('tripInsetBox').hidden = true; $('tripPow').hidden = true;
      // forecast and past share one camera: switching between them keeps the view exactly where it is
      if (!wasMap || !S.cam) { if (FC.cam) S.cam = FC.cam; else fcZoom(FC.zoom); }
      if (m === 'week') {
        if (!FC.d) { $('tripPhase').textContent = 'Loading the forecast…'; $('tripLine').textContent = ''; draw(); return; }
        fcTimeline(); setWeek(FC.i);
      } else { setPast(CST.idx); requestAnimationFrame(pastStrip); }
      fxStart();
    } else {
      if (wasMap) { FC.cam = S.cam; S.cam = S.dcam || null; fxClear(); }
      $('tripPow').hidden = false; $('tripInsetBox').hidden = !insetPref;
      if (!dropReady) initDrop();
      if (MAPV()) S.phase = 'setup';
      toSetup(!S.cam);
    }
    syncButtons(); infoSync();
  }
  function initDrop() {                                      // the wave tracer starts on first use: a 12 s wave from far out, aimed at Choc, played once
    dropReady = true; $('tripPhase').textContent = 'Loading the sea floor…';
    depthReady().then(() => {
      if (!GR.ok) { $('tripPhase').textContent = 'This browser can’t load the depth data for the wave tracer.'; return; }
      S.start = [-71.85, 38.91]; const b = aim('c', S.T, S.start); S.th = (b.th + 360) % 360; S.note = 'aimed at Choc';
      S.ray = makeRay(S.T, S.start, S.th);
      if (MAPV()) { S.dcam = fitCam([S.start, PEAK]); return; }
      S.cam = fitCam([S.start, PEAK]); hudSetup(); draw(); syncButtons();
      let started = false;
      const io = new IntersectionObserver((es) => { if (started || !es.some((e) => e.isIntersecting)) return; started = true; io.disconnect(); if (S.phase === 'setup') play(); }, { threshold: 0.3 });
      io.observe(cv);
    });
  }
  document.querySelectorAll('#fcModel button').forEach((b) => b.addEventListener('click', () => {
    FC.model = b.dataset.v; FC.pick = null; FC.fan = null; for (const q of document.querySelectorAll('#fcModel button')) q.setAttribute('aria-pressed', String(q === b));
    if (FC.d && S.phase === 'week') { fcTimeline(); setWeek(FC.i); }
  }));
  function setSpot(v) {
    FC.spot = v; for (const q of document.querySelectorAll('#fcSpot button')) q.setAttribute('aria-pressed', String(q.dataset.v === v));
    FC.pick = null; FC.fan = null; if (FC.d) fcBest();
    if (S.phase === 'past') setPast(CST.idx); else if (FC.d) { fcTimeline(); setWeek(FC.i); }
  }
  document.querySelectorAll('#fcSpot button').forEach((b) => b.addEventListener('click', () => setSpot(b.dataset.v)));
  document.querySelectorAll('#fcLayers .hub-tg').forEach((b) => {
    b.setAttribute('aria-pressed', String(FC.show[b.dataset.l]));
    b.addEventListener('click', () => {
      const l = b.dataset.l; FC.show[l] = !FC.show[l]; b.setAttribute('aria-pressed', String(FC.show[l]));
      try { localStorage.setItem('choc.fcLayers', JSON.stringify(FC.show)); } catch (e) { /* fine */ }
      if (l === 'flow') { if (FC.show.flow) fxStart(); else fxClear(); }
      if (l === 'aim' && S.phase === 'week') fcTimeline();
      draw();
    });
  });
  document.querySelectorAll('#fcZoom button').forEach((b) => b.addEventListener('click', () => fcZoom(b.dataset.v)));
  $('fcPlay').addEventListener('click', () => {
    if (!FC.d) return;
    if (FC.timer) { fcStop(); return; }
    $('fcPlay').textContent = '❚❚'; $('fcPlay').setAttribute('aria-label', 'Pause');
    FC.timer = setInterval(() => setWeek((FC.i + 1) % FC.d.gfs.length), reduce ? 1200 : 450);
  });
  $('fcBest').addEventListener('click', () => { fcStop(); setWeek(+$('fcBest').dataset.i); });
  {
    const host = $('fcTlSvg'); let down = false;
    const pick = (e) => { if (!FC.tl) return; const r = host.getBoundingClientRect(), px = (e.clientX - r.left) * (host.querySelector('svg').viewBox.baseVal.width / r.width);
      let bi = 0, bd = Infinity; FC.tl.ts.forEach((t, i) => { const d = Math.abs(FC.tl.x(t) - px); if (d < bd) { bd = d; bi = i; } }); if (bi !== FC.i) setWeek(bi); };
    host.addEventListener('pointerdown', (e) => { if (!FC.tl) return; down = true; fcStop(); host.setPointerCapture(e.pointerId); pick(e); });
    host.addEventListener('pointermove', (e) => { if (down) pick(e); });
    const end = () => { down = false; }; host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    new ResizeObserver(() => { if (S.phase === 'week') fcTimeline(); }).observe(host);
  }
  document.querySelectorAll('#tripModeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.v)));

  // ── controls
  $('tripPer').addEventListener('change', () => { S.T = +$('tripPer').value; if (S.phase !== 'setup') toSetup(false); S.note = ''; retrace(); });
  $('tripAimC').addEventListener('click', () => doAim('c'));
  $('tripAimW').addEventListener('click', () => doAim('w'));
  $('tripAimM').addEventListener('click', () => doAim('m'));
  $('tripRand').addEventListener('click', () => { if (S.phase !== 'setup') toSetup(false); randomStart(); S.ray = makeRay(S.T, S.start, S.th); S.cam = fitCam([S.start, [S.ray.lon[S.ray.n - 1], S.ray.lat[S.ray.n - 1]]]); hudSetup(); draw(); });
  $('tripSize').addEventListener('input', () => energy(S.ray, S.phase === 'setup' || S.phase === 'done' ? (S.ray ? S.ray.len : 0) : S.dist));
  // arrival close-up: off by default; the choice is remembered on this device
  function setInset(open) {
    insetPref = open; $('tripInsetBox').hidden = !open || MAPV(); $('tripInsetTg').setAttribute('aria-pressed', String(open));
    try { localStorage.setItem('choc.tripInset', open ? '1' : '0'); } catch (e) { /* storage blocked: fine */ }
    draw();
  }
  $('tripInsetTg').addEventListener('click', () => setInset(!insetPref));
  $('tripInsetClose').addEventListener('click', () => setInset(false));
  let insetPref = false; try { insetPref = localStorage.getItem('choc.tripInset') === '1'; } catch (e) { /* default closed */ }
  $('tripInsetTg').setAttribute('aria-pressed', String(insetPref));
  $('tripPlay').addEventListener('click', () => { if (S.phase === 'setup') play(); else toSetup(true); });

  // ── PAST: any day of the last ten years on the same map, with the same camera, colors and layers as
  // the forecast, so switching between the two keeps everything lined up. Offshore, the color is the
  // Copernicus wave reanalysis (primary swell, every 3 hours) at the spot's best hours that day; on the
  // survey map it is the page's ray model run on the buoy's swell trains (the same model the forecast
  // uses there); the rays near Fishers are those trains; arrows are the day's wind at 17 points.
  const DAYS = window.CHOC.D, CST = window.CHOC.st, MODEL = window.CHOC.model, MON = window.CHOC.MON;
  const PS = { trains: [], f: null, fm: null, years: {}, o: null, om: null, oyears: {}, oimg: null, oimgKey: '', iso: '', bestH: null, timer: 0, img: null, imgKey: '', asked: false };
  MODEL.onUpdate(() => { if (MAPV() && !redrawSoon) { redrawSoon = true; requestAnimationFrame(() => { redrawSoon = false; draw(); }); } });
  function soundTrains() {
    if (S.phase === 'past') return PS.trains;
    if (!FC.d) return [];
    const g = FC.d.gfs[FC.i], e = ecRow(FC.i);
    return FC.model === 'gfs' ? g.trains.filter((t) => t.T >= 4).map((t) => ({ ft: t.ft, T: t.T, D: t.D })) : e ? [{ ft: e.hs, T: e.T, D: e.D }] : [];
  }
  function soundField() {                                    // the ray model's heights across the survey map, for the trains on show
    if (!MODEL.ready()) { if (!PS.asked) { PS.asked = true; MODEL.init().then(() => draw()).catch(() => { PS.asked = false; }); } return null; }
    const tr = soundTrains(); if (!tr.length) return null;
    const f = MODEL.field(tr); return f ? f.cv : null;
  }
  function fieldImages() {                                   // [image, bounds] pairs for the offshore color
    if (S.phase === 'past') return [pastOceanImage(), pastImage()].filter(Boolean);   // ocean-wide underneath, the detailed box on top
    const row = fRow(); if (row == null || !FC.d) return [];
    return ['ocean', 'reg'].map((g) => [fcImage(FC.model, g, row), gridB(FC.d.grids[g])]).filter((q) => q[0]);
  }
  function flowFn() {
    if (S.phase === 'past') return PS.f || PS.o ? pastFlow : null;
    if (FCUI && (FC.out || FC.failed)) return null;
    const row = fRow(); return row == null || !FC.d ? null : (lon, lat) => fcFlow(lon, lat, FC.model, row);
  }
  function atFn() {
    if (S.phase === 'past') return (lon, lat) => pastAt(lon, lat) || ((MODEL.heightAt(lon, lat) || { h: -1 }).h >= 0);
    if (FCUI && (FC.out || FC.failed)) return null;
    const row = fRow(); return row == null || !FC.d ? null : (lon, lat) => fcAt(lon, lat, FC.model, row);
  }
  // the Copernicus field for one year: one row per 3-hour step, 3 pixels per cell (primary swell,
  // secondary swell, wind sea), each (height dm, period 0.1 s, from/2 deg); 255 = land
  function pastYear(y) {
    if (PS.years[y] !== undefined) return PS.years[y];
    PS.years[y] = null;
    for (const k of Object.keys(PS.years)) if (k !== y && Math.abs(+k - +y) > 1) delete PS.years[k];   // keep memory in check
    (async () => {
      PS.fm = PS.fm || await json('ocean/field/meta.json'); const mm = PS.fm && PS.fm.months[y]; if (!mm) return;
      const im = await img(`ocean/field/${y}.png`); if (!im) return;
      PS.years[y] = { a: window.CHOC.pixels(im), w: im.width, start: Date.parse(mm[0] + ':00Z'), n: mm[1] };
      if (S.phase === 'past') setPast(CST.idx);
    })();
    return null;
  }
  // the ocean-wide layer: every 2 degrees over the North Atlantic, every 6 hours, primary swell only
  // (one pixel per cell: height dm, period 0.1 s, from/2 deg; 255 = land)
  function pastOceanYear(y) {
    if (PS.oyears[y] !== undefined) return PS.oyears[y];
    PS.oyears[y] = null;
    for (const k of Object.keys(PS.oyears)) if (k !== y && Math.abs(+k - +y) > 1) delete PS.oyears[k];
    (async () => {
      PS.om = PS.om || await json('ocean/field/ocean_meta.json'); const mm = PS.om && PS.om.months[y]; if (!mm) return;
      const im = await img(`ocean/field/ocean/${y}.png`); if (!im) return;
      PS.oyears[y] = { a: window.CHOC.pixels(im), w: im.width, start: Date.parse(mm[0] + ':00Z'), n: mm[1] };
      if (S.phase === 'past') setPast(CST.idx);
    })();
    return null;
  }
  function oceanVal(i, j, q) { const f = PS.o, NLO = PS.om.lon.length; return f.F.a[(f.row * f.F.w + i * NLO + j) * 4 + q]; }
  function pastOceanImage() {
    const f = PS.o; if (!f) return null;
    const key = f.F.start + '_' + f.row; if (PS.oimgKey === key) return PS.oimg;
    const fm = PS.om, NLA = fm.lat.length, NLO = fm.lon.length;
    const c = PS.ocv || (PS.ocv = document.createElement('canvas')); c.width = NLO; c.height = NLA;   // one canvas, redrawn each step
    const g = c.getContext('2d'), id = g.createImageData(NLO, NLA);
    for (let i = 0; i < NLA; i++) for (let j = 0; j < NLO; j++) {
      let h = oceanVal(i, j, 0);
      if (h === 255) {                                      // coastal cells borrow their neighbors, so color reaches the shore
        let sum = 0, n = 0;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NLA || jj >= NLO) continue; const q = oceanVal(ii, jj, 0); if (q !== 255) { sum += q; n++; } }
        if (!n) continue; h = sum / n;
      }
      const col = hCol(h / 10 * FTm), p = 4 * ((NLA - 1 - i) * NLO + j);
      id.data[p] = col[0]; id.data[p + 1] = col[1]; id.data[p + 2] = col[2]; id.data[p + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const dLa = fm.lat[1] - fm.lat[0], dLo = fm.lon[1] - fm.lon[0];
    PS.oimg = [c, [fm.lon[0] - dLo / 2, fm.lon[NLO - 1] + dLo / 2, fm.lat[0] - dLa / 2, fm.lat[NLA - 1] + dLa / 2]]; PS.oimgKey = key;
    return PS.oimg;
  }
  function oceanAt(lon, lat) {
    if (!PS.o) return null;
    const fm = PS.om, dLa = fm.lat[1] - fm.lat[0], dLo = fm.lon[1] - fm.lon[0];
    const i = Math.round((lat - fm.lat[0]) / dLa), j = Math.round((lon - fm.lon[0]) / dLo);
    if (i < 0 || j < 0 || i >= fm.lat.length || j >= fm.lon.length) return null;
    const h = oceanVal(i, j, 0), T = oceanVal(i, j, 1), d = oceanVal(i, j, 2);
    return h === 255 || T === 255 || d === 255 ? null : [h / 10, T / 10, d * 2];
  }
  function oceanFlow(lon, lat) {
    if (!PS.o) return null;
    const fm = PS.om, dLa = fm.lat[1] - fm.lat[0], dLo = fm.lon[1] - fm.lon[0], NLA = fm.lat.length, NLO = fm.lon.length;
    const fi = (lat - fm.lat[0]) / dLa, fj = (lon - fm.lon[0]) / dLo;
    if (fi < 0 || fj < 0 || fi > NLA - 1 || fj > NLO - 1) return null;
    const i0 = Math.min(NLA - 2, Math.floor(fi)), j0 = Math.min(NLO - 2, Math.floor(fj)), a = fi - i0, b = fj - j0;
    let w = 0, T = 0, sx = 0, sy = 0;
    for (const [di, dj, ww] of [[0, 0, (1 - a) * (1 - b)], [0, 1, (1 - a) * b], [1, 0, a * (1 - b)], [1, 1, a * b]]) {
      if (ww <= 0) continue; const t = oceanVal(i0 + di, j0 + dj, 1), d = oceanVal(i0 + di, j0 + dj, 2); if (t === 255 || d === 255) continue;
      w += ww; T += ww * t / 10; sx += ww * Math.sin(d * 2 * D2R); sy += ww * Math.cos(d * 2 * D2R);
    }
    return w > 0.4 ? [T / w, Math.atan2(sx, sy) / D2R] : null;
  }
  function pastVal(i, j, q) { const f = PS.f, NLO = PS.fm.lon.length; return f.F.a[(f.row * f.F.w + (i * NLO + j) * 3) * 4 + q]; }
  function pastImage() {
    const f = PS.f; if (!f) return null;
    const key = f.F.start + '_' + f.row + (PS.o ? 'o' : ''); if (PS.imgKey === key) return PS.img;
    const fm = PS.fm, NLA = fm.lat.length, NLO = fm.lon.length;
    const c = PS.fcv || (PS.fcv = document.createElement('canvas')); c.width = NLO; c.height = NLA;
    const g = c.getContext('2d'), id = g.createImageData(NLO, NLA);
    for (let i = 0; i < NLA; i++) for (let j = 0; j < NLO; j++) {
      let h = pastVal(i, j, 0);
      if (h === 255) {                                      // coastal cells borrow their neighbors, so color reaches the shore
        let sum = 0, n = 0;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NLA || jj >= NLO) continue; const q = pastVal(ii, jj, 0); if (q !== 255) { sum += q; n++; } }
        if (!n) continue; h = sum / n;
      }
      const col = hCol(h / 10 * FTm), p = 4 * ((NLA - 1 - i) * NLO + j);
      id.data[p] = col[0]; id.data[p + 1] = col[1]; id.data[p + 2] = col[2];
      const ring = Math.min(i, j, NLA - 1 - i, NLO - 1 - j); id.data[p + 3] = PS.o ? [40, 120, 200][ring] || 255 : ring ? 255 : 70;   // soft outer edge: blends into the ocean-wide layer underneath
    }
    g.putImageData(id, 0, 0);
    const dLa = fm.lat[1] - fm.lat[0], dLo = fm.lon[1] - fm.lon[0];
    PS.img = [c, [fm.lon[0] - dLo / 2, fm.lon[NLO - 1] + dLo / 2, fm.lat[0] - dLa / 2, fm.lat[NLA - 1] + dLa / 2]]; PS.imgKey = key;
    return PS.img;
  }
  function pastAt(lon, lat) {                                // [height m, period s, from deg] of the primary swell, or null
    return pastAtBox(lon, lat) || oceanAt(lon, lat);
  }
  function pastAtBox(lon, lat) {
    if (!PS.f) return null;
    const fm = PS.fm, dLa = fm.lat[1] - fm.lat[0], dLo = fm.lon[1] - fm.lon[0];
    const i = Math.round((lat - fm.lat[0]) / dLa), j = Math.round((lon - fm.lon[0]) / dLo);
    if (i < 0 || j < 0 || i >= fm.lat.length || j >= fm.lon.length) return null;
    const h = pastVal(i, j, 0), T = pastVal(i, j, 1), d = pastVal(i, j, 2);
    return h === 255 || T === 255 || d === 255 ? null : [h / 10, T / 10, d * 2];
  }
  function pastFlow(lon, lat) { return pastFlowBox(lon, lat) || oceanFlow(lon, lat); }
  function pastFlowBox(lon, lat) {                           // smooth [period, from] for the streaks
    if (!PS.f) return null;
    const fm = PS.fm, dLa = fm.lat[1] - fm.lat[0], dLo = fm.lon[1] - fm.lon[0], NLA = fm.lat.length, NLO = fm.lon.length;
    const fi = (lat - fm.lat[0]) / dLa, fj = (lon - fm.lon[0]) / dLo;
    if (fi < 0 || fj < 0 || fi > NLA - 1 || fj > NLO - 1) return null;
    const i0 = Math.min(NLA - 2, Math.floor(fi)), j0 = Math.min(NLO - 2, Math.floor(fj)), a = fi - i0, b = fj - j0;
    let w = 0, T = 0, sx = 0, sy = 0;
    for (const [di, dj, ww] of [[0, 0, (1 - a) * (1 - b)], [0, 1, (1 - a) * b], [1, 0, a * (1 - b)], [1, 1, a * b]]) {
      if (ww <= 0) continue; const t = pastVal(i0 + di, j0 + dj, 1), d = pastVal(i0 + di, j0 + dj, 2); if (t === 255 || d === 255) continue;
      w += ww; T += ww * t / 10; sx += ww * Math.sin(d * 2 * D2R); sy += ww * Math.cos(d * 2 * D2R);
    }
    return w > 0.4 ? [T / w, Math.atan2(sx, sy) / D2R] : null;
  }
  function pastFt(spot) {                                    // Choc at the hour on show; else the spot's best 3 hours that day (the ray model on the buoy)
    const x = DAYS[CST.idx]; if (!x) return null;
    if (spot === 'choc') return PS.hs !== undefined && PS.iso === x.iso ? (PS.hs ? PS.hs.ft : null) : x.mh[CST.daylight];
    const v = DAYS2[x.iso]; return v && v[4] != null ? v[4] : null;
  }
  function pastWind(i, spot) {                               // [kn, from] at the spot's best hours (Part 3's rule decides clean)
    const x = DAYS[i], v = x && DAYS2[x.iso], w = v && v[spot === 'wild' ? 6 : 5];
    if (w && w[1] != null) return [w[1], w[0]];
    return x && x.wspd != null ? [x.wspd, x.wdir] : null;
  }
  // ── the hour of a past day. A day opens at the hour you logged (your first session that day), else at
  // Choc's biggest hour; the hour strip under the month moves through the other hours, and the map (the
  // offshore color, the swells' rays near Fishers), the headline and the day's details follow. The hour's
  // swells are the buoy's, hour by hour, from ocean/day/<year>.json (loaded a year at a time); until that
  // file is in, the day's biggest hour stands in. Wind and tide come from the same file when it has them.
  const LANE = {};
  function laneYear(y) {
    if (!(y in LANE)) { LANE[y] = null; json(`ocean/day/${y}.json`).then((d) => { LANE[y] = d || false; if (S.phase === 'past') setPast(CST.idx); }); }
    return LANE[y] || null;
  }
  const hourAt = (iso, h) => etMidnight(Date.parse(iso + 'T16:00:00Z')) + h * 36e5;
  const utcKey = (ms) => new Date(ms).toISOString().slice(0, 13);
  function laneAt(iso, h, lane) {                            // that hour's row of a lane, undefined while the year loads
    const k = utcKey(hourAt(iso, h)), L = laneYear(k.slice(0, 4));
    return L ? ((L[lane] || {})[k] || null) : undefined;
  }
  function hourSwell(iso, h) {                               // {ft at Choc, trains with their shares} that hour; null: no reading
    const r = laneAt(iso, h, '44097'); if (r === undefined) return undefined; if (!r || !r.length) return null;
    const list = r.map((q) => ({ ft: q[0], T: q[1], D: q[2], at: q[3] }));
    return { hr: h, ft: Math.sqrt(list.reduce((a, q) => a + q.at * q.at, 0)), trains: window.CHOC.swell.shares(list) };
  }
  function defaultHour(iso) {
    const lg = window.CHOC.logHours ? window.CHOC.logHours(iso) : []; if (lg.length) return lg[0];
    const t = TRAINS[iso]; if (t && t[0] != null) return t[0];
    return PS.bestH != null ? (PS.bestH + 1) % 24 : 12;
  }
  window.CHOC.hourOf = (iso) => (CST.hourIso === iso && CST.hour != null ? CST.hour : defaultHour(iso));
  window.CHOC.swell.hour = (iso, h) => hourSwell(iso, h) || null;
  window.CHOC.logChanged = () => {                           // the log came in after the day opened: go to the hour you logged
    if (CST.hourPicked || !CST.hourIso) return;
    const h = defaultHour(CST.hourIso); if (h === CST.hour) return;
    CST.hour = h; if (S.phase === 'past') setPast(CST.idx); window.CHOC.hourChanged();
  };
  function setHour(h, picked) {
    h = Math.max(0, Math.min(23, h)); if (h === CST.hour) return;
    CST.hour = h; if (picked) CST.hourPicked = true;
    setPast(CST.idx); window.CHOC.hourChanged();
  }
  function setPast(i) {
    const x = DAYS[i]; if (!x) return;
    PS.iso = x.iso; const v2 = DAYS2[x.iso];
    PS.bestH = v2 ? v2[FC.spot === 'wild' ? 8 : 7] : null;
    if (CST.hourIso !== x.iso) { CST.hourIso = x.iso; CST.hourPicked = false; CST.hour = defaultHour(x.iso); }
    const h = CST.hour;
    // the offshore field at the hour on show
    const t = hourAt(x.iso, h) + 18e5;
    const F = pastYear(String(x.y)); PS.f = null;
    if (F) { const k = Math.round((t - F.start) / 108e5); if (k >= 0 && k < F.n) PS.f = { F, row: k }; }
    const O = pastOceanYear(String(x.y)); PS.o = null;
    if (O) { const k = Math.round((t - O.start) / 216e5); if (k >= 0 && k < O.n) PS.o = { F: O, row: k }; }
    // the buoy's swell trains that hour; until the hourly file is in, those at Choc's biggest hour (or the day's peak)
    const hs = hourSwell(x.iso, h), tr = TRAINS[x.iso];
    PS.hs = hs;
    PS.trains = hs ? hs.trains.map((q) => ({ ft: q.ft, T: q.T, D: q.D }))
      : hs === null ? []
      : tr && tr[1].length ? tr[1].map((q) => ({ ft: q[0], T: q[1], D: q[2] })) : x.hs ? [{ ft: x.hs, T: x.per, D: x.dir }] : [];
    if (S.phase !== 'past') return;
    FC.cur = PS.trains.filter((q) => q.T >= 5 && q.ft >= 0.3).map((q) => Object.assign({}, q));   // their rays: raysFor, once they show
    $('pastDate').value = x.iso;
    pastHud(); pastStrip(); pastHours(); pastBest(); draw();
  }
  const dateLong = (x) => new Date(Date.UTC(x.y, x.m - 1, x.d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  function pastHud() {
    const x = DAYS[CST.idx], sp = FC.spot, h = CST.hour, hs = PS.hs, SW = window.CHOC.swell, nar = cw < 560;
    // Choc that hour (the buoy's swells carried in); Wilderness keeps its best 3 hours (the hourly file has Choc only)
    const ft = pastFt(sp);
    $('tripPhase').textContent = `${dateLong(x)} · ${h12(h)} · ${SPOT[sp].name} ${ft == null ? '–' : ft.toFixed(1) + ' ft'}${sp === 'wild' ? ' best 3 h' : ''}`;
    const mx = sp === 'choc' ? hs || (hs === undefined && SW && SW.day(x.iso, sp)) : SW && SW.day(x.iso, sp);
    const buoy = x.hs != null ? `Buoy ${x.hs.toFixed(1)} ft, all swells` : 'No buoy reading';
    const lines = mx ? SW.rows(mx.trains, nar ? 1 : 2, nar ? null : SPOT[sp].name).map(([tg, v]) => `${tg} ${v}`) : [hs === null ? 'No buoy reading this hour' : buoy];
    const wr = laneAt(x.iso, h, 'wind'), w = wr ? [wr[0], wr[1]] : pastWind(CST.idx, sp);
    const lg = window.CHOC.logHours ? window.CHOC.logHours(x.iso) : [];
    lines.push([w ? `Wind ${window.CHOC.windArrow(w[1])}${Math.round(w[0])} kn ${compass(w[1])}, ${windWord(windKind(w, sp))}` : '',
      lg.includes(h) ? 'you logged this hour' : '', PS.bestH != null ? `best ~${h12((PS.bestH + 1) % 24)}` : '', mx && !nar ? buoy : ''].filter(Boolean).join(' · '));
    $('tripLine').innerHTML = lines.filter(Boolean).join('<br>');
    $('tripPow').hidden = true;
  }
  // the day hour by hour under the month: Choc's height each hour, night shaded, your sessions marked, the hour
  // on show lit; tap or drag to move through the day, or the arrow keys
  function pastHours() {
    const host = $('pastHours'); if (!host || host.offsetParent === null) return;
    const x = DAYS[CST.idx], W = Math.max(200, Math.round(host.clientWidth)), H = 46, T0 = 10, B0 = 32, cell = (W - 4) / 24;
    const hs = []; for (let h = 0; h < 24; h++) hs.push(hourSwell(x.iso, h));
    const vals = hs.map((q) => (q ? q.ft : null)), loading = hs.every((q) => q === undefined);
    const top = Math.max(2, Math.ceil(Math.max(0, ...vals.filter((v) => v != null)) + 0.3)), yy = (v) => B0 - v / top * (B0 - T0);
    const [rise, set] = sunWin(hourAt(x.iso, 12)), lg = window.CHOC.logHours ? window.CHOC.logHours(x.iso) : [], peak = TRAINS[x.iso] && TRAINS[x.iso][0];
    let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" aria-hidden="true">`;   // follows the bar's width as the screen turns
    for (let h = 0; h < 24; h++) {
      const cx = 2 + h * cell, t = hourAt(x.iso, h) + 18e5, v = vals[h];
      if (t < rise || t > set) s += `<rect x="${cx.toFixed(1)}" y="${T0 - 4}" width="${cell.toFixed(1)}" height="${B0 - T0 + 6}" fill="rgba(0,0,0,.28)"/>`;
      if (h === CST.hour) s += `<rect x="${cx.toFixed(1)}" y="${T0 - 6}" width="${cell.toFixed(1)}" height="${B0 - T0 + 8}" rx="3" fill="rgba(231,237,242,.16)" stroke="rgba(231,237,242,.7)"/>`;
      if (v != null && v > 0) s += `<rect x="${(cx + cell * 0.18).toFixed(1)}" y="${yy(v).toFixed(1)}" width="${(cell * 0.64).toFixed(1)}" height="${(yy(0) - yy(v)).toFixed(1)}" rx="1.2" fill="${h === CST.hour ? '#f08a4b' : 'rgba(231,237,242,.42)'}"/>`;
      if (lg.includes(h)) s += `<path d="M${(cx + cell / 2 - 3.5).toFixed(1)},${T0 - 8} h7 l-3.5,4.5z" fill="#f08a4b"/>`;
      if (h % 6 === 0) s += `<text x="${(cx + 1).toFixed(1)}" y="${H - 2}" class="tl-t">${h12(h)}</text>`;
    }
    if (loading) s += `<text x="${W / 2}" y="${(B0 + T0) / 2 + 3}" text-anchor="middle" class="tl-k">Loading the hours…</text>`;
    s += '</svg>'; host.innerHTML = s; PS.hstrip = { cell };
    const v = vals[CST.hour];
    host.setAttribute('aria-valuenow', String(CST.hour));
    host.setAttribute('aria-valuetext', `${h12(CST.hour)}${v != null ? `, Choc ${v.toFixed(1)} ft` : ''}${lg.includes(CST.hour) ? ', you logged this hour' : ''}${CST.hour === peak ? ", Choc's biggest hour" : ''}`);
  }
  // a good day: Choc's ratings model at 7/10 or better (your log's scale); Wilderness has no ratings,
  // so there it means 3 ft or more with clean wind
  function goodDay(i, spot) {
    const x = DAYS[i]; if (!x) return false;
    if (spot === 'choc') return (x.s[CST.daylight] || 0) >= 7;
    const ft = DAYS2[x.iso] && DAYS2[x.iso][4], w = pastWind(i, 'wild'); return ft >= 3 && w && windKind(w, 'wild') !== 'onshore' && windKind(w, 'wild') !== 'cross';
  }
  function monthDays(y, m) {                                 // day indexes of one calendar month (null where there is no row)
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
    for (let d = 1; d <= n; d++) { const i = window.CHOC.dayIndex(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`); out.push(i >= 0 ? i : null); }
    return out;
  }
  function spotVal(i, sp) { const x = DAYS[i]; if (!x) return null; if (sp === 'choc') return x.mh[CST.daylight]; const v = DAYS2[x.iso]; return v && v[4] != null ? v[4] : null; }
  function pastStrip() {                                     // the month around the chosen day: one bar per day at the spot
    const host = $('pastTl'); if (!host || host.offsetParent === null) return;
    const x = DAYS[CST.idx], sp = FC.spot, days = monthDays(x.y, x.m), n = days.length;
    $('pastMonth').textContent = `${MON[x.m - 1]} ${x.y}`;
    const W = Math.max(200, Math.round(host.clientWidth)), H = 70, T0 = 14, B0 = 46, cell = (W - 4) / n;
    const vals = days.map((i) => (i == null ? null : spotVal(i, sp)));
    const top = Math.max(2, Math.ceil(Math.max(0, ...vals.filter((v) => v != null)) + 0.3)), yy = (v) => B0 - v / top * (B0 - T0);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${SPOT[sp].name}, each day of the month">`;
    s += `<line x1="2" x2="${W - 2}" y1="${yy(top)}" y2="${yy(top)}" stroke="#1f2b37"/><line x1="2" x2="${W - 2}" y1="${yy(0)}" y2="${yy(0)}" stroke="#2c3b49"/><text x="4" y="${T0 - 4}" class="tl-t">${top} ft</text>`;
    s += `<rect x="${W - 116}" y="${T0 - 11}" width="8" height="8" rx="1.5" fill="#f08a4b"/><text x="${W - 104}" y="${T0 - 4}" class="tl-k">${sp === 'choc' ? 'good day (7/10+)' : '3 ft+ and clean'}</text>`;
    days.forEach((i, k) => {
      const cx = 2 + k * cell, v = vals[k], sel = i === CST.idx;
      if (sel) s += `<rect x="${cx.toFixed(1)}" y="${T0 - 2}" width="${cell.toFixed(1)}" height="${B0 - T0 + 12}" rx="3" fill="rgba(231,237,242,.12)"/>`;
      if (v != null && v > 0) s += `<rect x="${(cx + cell * 0.14).toFixed(1)}" y="${yy(v).toFixed(1)}" width="${(cell * 0.72).toFixed(1)}" height="${(yy(0) - yy(v)).toFixed(1)}" rx="1.5" fill="${goodDay(i, sp) ? '#f08a4b' : 'rgba(231,237,242,.38)'}"/>`;
      const w = i == null ? null : pastWind(i, sp), wk = w ? windKind(w, sp) : null;
      if (wk) s += `<circle cx="${(cx + cell / 2).toFixed(1)}" cy="${B0 + 6}" r="${Math.min(2.4, cell * 0.3).toFixed(1)}" fill="${WINDCOL[wk]}"/>`;
      if (k === 0 || (k + 1) % 5 === 0) s += `<text x="${(cx + cell / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" class="tl-t">${k + 1}</text>`;
    });
    s += '</svg>'; host.innerHTML = s; PS.strip = { cell, days };
  }
  function pastBest() {                                      // the month's biggest good day (or just its biggest day)
    const x = DAYS[CST.idx], sp = FC.spot, days = monthDays(x.y, x.m).filter((i) => i != null), b = $('pastBest');
    let bi = null; for (const i of days) { const v = spotVal(i, sp); if (v == null) continue; const g = goodDay(i, sp); if (bi == null || (g && !goodDay(bi, sp)) || (g === goodDay(bi, sp) && v > spotVal(bi, sp))) bi = i; }
    if (bi == null) { b.hidden = true; return; }
    const y = DAYS[bi], g = goodDay(bi, sp), n = days.filter((i) => goodDay(i, sp)).length;
    b.hidden = false; b.dataset.i = bi;
    b.innerHTML = `<b>${g ? 'Best day' : 'Biggest day'}</b> ${MON[y.m - 1]} ${y.d} · ${spotVal(bi, sp).toFixed(1)} ft<span class="x"> · ${n} good day${n === 1 ? '' : 's'} this month</span>`;
  }
  function pastStop() { clearInterval(PS.timer); PS.timer = 0; CST.playing = false; $('pastPlay').textContent = '▶'; $('pastPlay').setAttribute('aria-label', 'Play day by day'); }
  function drawWind(X, Y, v) {                               // the day's wind at the 17 over-water points: arrows blow downwind
    if (!FC.show.wnd) return;
    const near = v.W < 120;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of MODEL.windPts(CST.idx)) {
      const x = X(p.lon), y = Y(p.lon, p.lat); if (x < -20 || y < -20 || x > cw + 20 || y > chh + 20) continue;
      // a small, quiet arrow blowing downwind: longer for stronger wind, no heavier
      const a = (p.from + 180) * D2R, ux = Math.sin(a), uy = -Math.cos(a), len = Math.min(18, 7 + p.kn * 0.4);
      const x1 = x - ux * len / 2, y1 = y - uy * len / 2, x2 = x + ux * len / 2, y2 = y + uy * len / 2;
      ctx.strokeStyle = 'rgba(240,246,250,.8)'; ctx.fillStyle = 'rgba(240,246,250,.8)'; ctx.lineWidth = 1.3;
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2 + ux * 1.5, y2 + uy * 1.5); ctx.lineTo(x2 - ux * 3.5 - uy * 2.6, y2 - uy * 3.5 + ux * 2.6); ctx.lineTo(x2 - ux * 3.5 + uy * 2.6, y2 - uy * 3.5 - ux * 2.6); ctx.closePath(); ctx.fill();
      if (near) { ctx.font = '9.5px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(231,237,242,.85)'; ctx.textAlign = 'center'; ctx.fillText(Math.round(p.kn) + ' kn', x, y + len / 2 + 10); }
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
  function pastPick(X, Y) {                                  // a tapped point on a past day
    const [lon, lat] = FC.pick, x = X(lon), y = Y(lon, lat), m = MODEL.heightAt(lon, lat), s = pastAt(lon, lat);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    if (m && m.h >= 0) pill(x, y, [`${m.h.toFixed(1)} ft modeled`, `${Math.round(m.depth)} m deep · from buoy 44097`]);
    else if (s) pill(x, y, [`1° ${(s[0] * FTm).toFixed(1)} ft @ ${Math.round(s[1])} s ${compass(s[2])}`, 'Copernicus model']);
    else pill(x, y, ['No data here']);
  }
  window.CHOC.onDay((i) => { if (S.phase === 'past') setPast(i); });
  window.CHOC.onChange(() => { if (S.phase === 'past') setPast(CST.idx); });
  window.CHOC.pastStop = () => pastStop();
  window.CHOC.showPast = (iso) => {                          // from the calendar and tables further down the page
    const i = window.CHOC.dayIndex(iso); if (i < 0) return;
    setMode('past'); window.CHOC.jump(i);
    stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  };
  $('pastPlay').addEventListener('click', () => {
    if (PS.timer) { pastStop(); return; }
    CST.playing = true; $('pastPlay').textContent = '❚❚'; $('pastPlay').setAttribute('aria-label', 'Pause');
    PS.timer = setInterval(() => { if (CST.idx >= DAYS.length - 1) { pastStop(); return; } window.CHOC.jump(CST.idx + 1); }, reduce ? 1400 : 700);
  });
  $('pastBest').addEventListener('click', () => { pastStop(); window.CHOC.jump(+$('pastBest').dataset.i); });
  const shiftMonth = (k) => {
    const x = DAYS[CST.idx]; let y = x.y, m = x.m + k; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    const all = monthDays(y, m); if (!all.some((i) => i != null)) return;
    // same day of the month (or the nearest day with data)
    const d0 = Math.min(all.length - 1, x.d - 1); let best = null;
    for (let dd = 0; dd < all.length && best == null; dd++) best = all[d0 - dd] ?? all[d0 + dd] ?? null;
    pastStop(); window.CHOC.jump(best);
  };
  $('pastPrev').addEventListener('click', () => shiftMonth(-1));
  $('pastNext').addEventListener('click', () => shiftMonth(1));
  if (DAYS.length) { const inp = $('pastDate'); inp.min = DAYS[0].iso; inp.max = DAYS[DAYS.length - 1].iso;   // (the map alone has no history)
    inp.addEventListener('change', () => { const i = window.CHOC.dayIndex(inp.value); if (i >= 0) { pastStop(); window.CHOC.jump(i); } });
    window.CHOC.onDay((i) => { inp.value = DAYS[i].iso; }); inp.value = DAYS[CST.idx].iso; }
  {
    const host = $('pastTl'); let down = false;
    const pick = (e) => { if (!PS.strip) return; const r = host.getBoundingClientRect(), k = Math.floor((e.clientX - r.left - 2) / (r.width - 4) * PS.strip.days.length);
      const i = PS.strip.days[Math.max(0, Math.min(PS.strip.days.length - 1, k))]; if (i != null && i !== CST.idx) window.CHOC.jump(i); };
    host.addEventListener('pointerdown', (e) => { down = true; pastStop(); host.setPointerCapture(e.pointerId); pick(e); });
    host.addEventListener('pointermove', (e) => { if (down) pick(e); });
    const end = () => { down = false; }; host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    new ResizeObserver(() => { if (S.phase === 'past') pastStrip(); }).observe(host);
  }
  {
    const host = $('pastHours'); let down = false;
    if (host) {
      const pick = (e) => { const r = host.getBoundingClientRect(); setHour(Math.floor((e.clientX - r.left - 2) / (r.width - 4) * 24), true); };
      host.addEventListener('pointerdown', (e) => { down = true; pastStop(); host.setPointerCapture(e.pointerId); pick(e); });
      host.addEventListener('pointermove', (e) => { if (down) pick(e); });
      const end = () => { down = false; }; host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
      host.addEventListener('keydown', (e) => {
        const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
        if (k) { e.preventDefault(); setHour(CST.hour + k, true); }
        else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setHour(e.key === 'Home' ? 0 : 23, true); }
      });
      new ResizeObserver(() => { if (S.phase === 'past') pastHours(); }).observe(host);
    }
  }
  // first day shown in the past view: your October 2025 Wilderness day; on the Explore tab, the newest day there is
  if (EXUI && DAYS.length) CST.idx = DAYS.length - 1;
  else { const i0 = window.CHOC.dayIndex('2025-10-12'); if (i0 >= 0) CST.idx = i0; }

  // ── map chrome. Wide maps keep the layers panel open (remembered); narrow ones open it on demand,
  // and a tap on the map closes it. The info card replaces long captions.
  let wide = null, pnPref = null, pnWas = false;
  try { pnPref = localStorage.getItem('choc.hubPanel'); } catch (e) { /* default by width */ }
  function setPanel(open, remember) {
    $('hubPanel').hidden = !open; $('hubLayers').setAttribute('aria-expanded', String(open)); stage.classList.toggle('hub-pn', open);
    if (open && !$('hubInfoCard').hidden) setInfo(false, true);
    if (remember && wide && !FCUI) { pnPref = open ? '1' : '0'; try { localStorage.setItem('choc.hubPanel', pnPref); } catch (e) { /* fine */ } }
    requestAnimationFrame(() => { if (MAPV() && !S.moved) fcZoom(FC.zoom); else draw(); });
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
    if (w !== wide) { wide = w; stage.classList.toggle('hub-wide', w); setPanel(w && !FCUI ? pnPref !== '0' : false); }   // the Forecast tab's map starts with the layers shut
    if (MAPV() && !S.moved) fcZoom(FC.zoom);
  }).observe(stage);

  window.CHOC = window.CHOC || {};
  // ── CUTAWAY: the dropped wave side-on, a flat cross-section along the ray over the survey's sea floor
  // under its last stretch. The wave on top is linear theory along the ray: its length from the depth
  // (dispersion), its height growing with shoaling (group speed) and with how much the bottom focused or
  // spread it (the ray's power count), and it breaks once it is about 0.78 times as tall as the water is deep.
  // The 50 km view is for comparing the approach to two places (Montauk and Fishers, say). At that scale the crests are
  // a few pixels apart (a 12 s wave is about 200 m long), too close to draw one by one, so the wave is a band as tall as
  // the wave there. "Keep to compare" leaves one wave's section drawn dashed under the next one's, lined up at the shore.
  const CUT = { len: 1, ft: 6, key: '', prof: null, kprof: null, bed: null, t: 0, run: false, vis: false };
  const cutCv = $('cutCv'), cutCtx = cutCv ? cutCv.getContext('2d') : null;
  function cutProfile(r) {
    // 150 points up to 12 km, then one every ~80 m so the 50 km section still shows shoals a few hundred meters across
    const Lkm = Math.min(CUT.len, r.len), NA = Math.max(150, Math.min(700, Math.round(Lkm * 12))), JM = 0;
    const out = { Lkm, NA, JM, h: [], bed: [], H: [], k: [], ph: [], c: [], pw: [], ib: -1, coarse: 0 };
    const across = 0;                                        // flat section: just the line under the ray
    for (let a = 0; a < NA; a++) {
      const dd = r.len - Lkm + Lkm * a / (NA - 1), p = sample(r, dd), hd = headingAt(r, Math.max(dd, 0.06), 0.06) * D2R;
      const row = [];
      for (let j = -JM; j <= JM; j++) {
        const off = j * across, lon = p.lon + off * Math.cos(hd) / 1000 / KX, lat = p.lat - off * Math.sin(hd) / 1000 / KY;
        const dep = depthAt(lon, lat); row.push(dep == null ? 0 : Math.max(-4, dep));
      }
      out.bed.push(row); if (!inWorld(p.lat, p.lon, 0)) out.coarse++;    // past the survey map's edge: ETOPO (about 1 km)
      const h = Math.max(0, row[JM]); out.h.push(h);
    }
    const H0 = CUT.ft / FTm, cg0 = G * r.T / (4 * Math.PI); let ph = 0;
    const Hat = (dd, h) => H0 * Math.sqrt(cg0 / cg(r.T, h)) * Math.sqrt(r.pw ? Math.max(0.05, pwAt(r, dd)) : 1);
    // Where it breaks: the first spot where it's 0.78 x as tall as the water is deep, looked for every 5 m whatever the
    // view and placed between the last two looks. The 50 km view's own points are 83 m apart: on its own it found the
    // break in shallower water, so a smaller wave, than the close-ups did for the same wave.
    const nF = Math.max(1, Math.round(Lkm * 200)); let bdd = -1, prev = null;
    for (let q = 0; q <= nF; q++) {
      const dd = r.len - Lkm + Lkm * q / nF, p = sample(r, dd), dep = depthAt(p.lon, p.lat), h = Math.max(dep == null ? 0 : dep, 0.3);
      const x = Hat(dd, h) / (0.78 * h) - 1;
      if (x >= 0) { const f = prev ? prev.x / (prev.x - x) : 0; bdd = prev ? prev.dd + (dd - prev.dd) * f : dd; out.bh = prev ? prev.h + (h - prev.h) * f : h; break; }
      prev = { dd, h, x };
    }
    for (let a = 0; a < NA; a++) {
      const h = Math.max(out.h[a], 0.3), c = cp(r.T, h), k = 2 * Math.PI / (c * r.T), dd = r.len - Lkm + Lkm * a / (NA - 1);
      let H = Hat(dd, h);
      if (out.ib < 0 && bdd >= 0 && dd >= bdd - 1e-9) out.ib = a;
      if (out.ib >= 0) H = Math.min(H, 0.78 * h);            // broken: the surf zone keeps it about 0.78 x depth
      if (a) ph += k * Lkm * 1000 / (NA - 1);
      out.H.push(H); out.k.push(k); out.ph.push(ph); out.c.push(c); out.pw.push(r.pw ? pwAt(r, dd) : null);
    }
    return out;
  }
  // Depth scale: down to the deepest water on the section (and on the kept one). The short views stop at 60 m so the
  // wave stays big enough to see; 50 km out the sea floor itself is the point, so it is never cut off there.
  function cutZmax(P, K) {
    let deep = 0; for (const x of P.h) deep = Math.max(deep, x); if (K) for (const x of K.h) deep = Math.max(deep, x);
    return Math.max(4, Math.min(P.Lkm > 10 ? 400 : 60, deep * 1.05));
  }
  function cutSize() {
    const w = Math.max(280, Math.round(cutCv.clientWidth)), h = Math.round(Math.min(340, Math.max(220, w * 0.42)));
    if (cutCv.width !== w * dpr || cutCv.height !== h * dpr) { cutCv.width = w * dpr; cutCv.height = h * dpr; cutCv.style.height = h + 'px'; CUT.key = ''; }
    return [w, h];
  }
  function cutDraw(ts) {
    if (!cutCtx || $('cutBox').hidden) { CUT.run = false; return; }
    const r = S.ray; if (!r) { CUT.run = false; return; }
    const kr = S.keep && S.keep !== r ? S.keep : null;
    const [w, h] = cutSize(), key = [r.start, r.th, r.T, r.len, !!r.pw, CUT.len, CUT.ft, w, h, kr ? [kr.start, kr.th, kr.T, !!kr.pw].join('/') : ''].join();
    if (key !== CUT.key) { CUT.key = key; CUT.prof = cutProfile(r); CUT.kprof = kr ? cutProfile(kr) : null; CUT.bed = null; cutCaption(w, h); }
    const P = CUT.prof, K = CUT.kprof, g = cutCtx, NA = P.NA, JM = P.JM, band = P.Lkm > 10;
    const padL = 44, padR = 16 + JM * 2 * 9, top = 84, bot = 30, ox = 9, oy = 6;
    const zmax = cutZmax(P, K), V = (h - top - bot - JM * 2 * oy) / (zmax + 3);
    const sx = (a) => padL + (w - padL - padR) * a / (NA - 1);
    const XY = (a, j, z) => [sx(a) + (j + JM) * ox, top + 3 * V + JM * 2 * oy - (j + JM) * oy - z * V];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!CUT.bed) {                                          // the sea floor doesn't move: draw it once
      const c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr; const b = c.getContext('2d'); if (!b) return; b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.fillStyle = '#0b1622'; b.fillRect(0, 0, w, h);
      for (let j = JM; j > -JM; j--) for (let a = 0; a < NA - 1; a++) {      // back to front
        const z1 = -P.bed[a][j + JM], z2 = -P.bed[a + 1][j + JM], z3 = -P.bed[a + 1][j - 1 + JM], z4 = -P.bed[a][j - 1 + JM];
        const q = [XY(a, j, z1), XY(a + 1, j, z2), XY(a + 1, j - 1, z3), XY(a, j - 1, z4)];
        const slope = (z2 - z1) * 0.9 + (z1 - z4) * 0.6, dep = -(z1 + z2 + z3 + z4) / 4;
        const land = dep <= 0.2, lit = Math.max(0.55, Math.min(1.35, 1 + slope * 0.08));
        const base = land ? [96, 90, 78] : [Math.min(200, 70 + 120 * Math.exp(-dep / 6)), Math.min(185, 72 + 95 * Math.exp(-dep / 6)), Math.min(160, 78 + 55 * Math.exp(-dep / 8))];
        b.fillStyle = `rgb(${base.map((v) => Math.round(v * lit)).join(',')})`;
        b.beginPath(); b.moveTo(...q[0]); for (const p of q.slice(1)) b.lineTo(...p); b.closePath(); b.fill();
      }
      // the ground under the section line, sand at the top fading down
      b.beginPath(); for (let a = 0; a < NA; a++) { const p = XY(a, 0, -P.bed[a][0]); a ? b.lineTo(...p) : b.moveTo(...p); }
      b.lineTo(XY(NA - 1, 0, -zmax - 3)[0], h - bot + 6); b.lineTo(XY(0, 0, -zmax - 3)[0], h - bot + 6); b.closePath();
      const sg = b.createLinearGradient(0, XY(0, 0, 0)[1], 0, h - bot); sg.addColorStop(0, '#8a7a5c'); sg.addColorStop(1, '#2a2620'); b.fillStyle = sg; b.fill();
      CUT.bed = c;
    }
    g.drawImage(CUT.bed, 0, 0, w, h);
    // the wave: surface height along the ray, the same across the strip (a long crest)
    if (ts != null && !reduce && !band) { const dt = CUT.last ? Math.min(0.1, (ts - CUT.last) / 1000) : 0; CUT.t += dt * 3; CUT.last = ts; }   // 3x real time
    const om = 2 * Math.PI / r.T, eta = (a) => {
      const A = P.H[a] / 2, th = P.ph[a] - om * CUT.t, st = Math.min(0.45, P.H[a] / Math.max(0.3, P.h[a]) * 0.6);
      return A * (Math.cos(th) + st * Math.cos(2 * th)) / (1 + st);         // crests sharpen as it shoals
    };
    const E = Array.from({ length: NA }, (_, a) => (P.h[a] > 0.05 || a <= P.ib ? (band ? 0 : eta(a)) : null));
    const last = E.findIndex((e, a) => e == null && a > 0), end = last < 0 ? NA - 1 : last - 1;
    // the cut face: water column between the surface and the floor along the near edge
    g.beginPath();
    for (let a = 0; a <= end; a++) { const p = XY(a, -JM, E[a]); a ? g.lineTo(...p) : g.moveTo(...p); }
    for (let a = end; a >= 0; a--) g.lineTo(...XY(a, -JM, -P.bed[a][0]));
    g.closePath(); const gr = g.createLinearGradient(0, XY(0, -JM, 0)[1], 0, XY(0, -JM, -zmax)[1]);
    gr.addColorStop(0, 'rgba(70,150,205,.55)'); gr.addColorStop(1, 'rgba(20,55,95,.75)'); g.fillStyle = gr; g.fill();
    g.beginPath(); for (let a = 0; a < NA; a++) { const p = XY(a, -JM, -P.bed[a][0]); a ? g.lineTo(...p) : g.moveTo(...p); }
    g.strokeStyle = '#d9c7a0'; g.lineWidth = 2; g.stroke();
    // the kept wave's sea floor, dashed, by distance to go (both sections end at their shore)
    const kx = K ? (b) => padL + (w - padL - padR) * (1 - K.Lkm * (1 - b / (K.NA - 1)) / P.Lkm) : null;
    if (K) {
      g.beginPath(); let on = false;
      for (let b = 0; b < K.NA; b++) { const x = kx(b); if (x < padL - 0.5) continue; const y = XY(0, -JM, -K.bed[b][0])[1]; if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; } }
      g.setLineDash([6, 4]); g.strokeStyle = '#9fe3f0'; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
    }
    if (band) {                                              // crests too close to draw: trough to crest, as tall as the wave there
      g.beginPath();
      for (let a = 0; a <= end; a++) { const p = XY(a, -JM, P.H[a] / 2); a ? g.lineTo(...p) : g.moveTo(...p); }
      for (let a = end; a >= 0; a--) g.lineTo(...XY(a, -JM, -P.H[a] / 2));
      g.closePath(); g.fillStyle = 'rgba(240,248,252,.5)'; g.fill();
      g.beginPath(); for (let a = 0; a <= end; a++) { const p = XY(a, -JM, P.H[a] / 2); a ? g.lineTo(...p) : g.moveTo(...p); }
      g.strokeStyle = 'rgba(240,248,252,.95)'; g.lineWidth = 1.4; g.stroke();
    } else {
      g.beginPath(); for (let a = 0; a <= end; a++) { const p = XY(a, -JM, E[a]); a ? g.lineTo(...p) : g.moveTo(...p); }
      g.strokeStyle = 'rgba(240,248,252,.95)'; g.lineWidth = 1.6; g.stroke();
      for (let a = 1; a < end; a++) {                        // whitewater spilling down the front of each broken crest
        if (!(P.ib >= 0 && a >= P.ib && E[a] > E[a - 1] && E[a] >= E[a + 1] && E[a] > 0)) continue;
        const [x, y] = XY(a, 0, E[a]); g.fillStyle = 'rgba(255,255,255,.55)';
        for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + 3 + k * 4, y + 2 + k * 2.5, 6 - k, 3, 0, 0, 7); g.fill(); }
      }
    }
    // energy along the crest, % of where the wave started (the same count as Drop a wave's bar): a strip on top
    if (P.pw[0] != null) {
      const top100 = Math.max(1.2, Math.min(2, Math.max(...P.pw, ...(K && K.pw[0] != null ? K.pw : [])) * 1.1)), y0 = 22, y1 = 66, py = (v) => y1 - Math.min(top100, Math.max(0, v)) / top100 * (y1 - y0);
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(sx(0), py(1)); g.lineTo(sx(NA - 1), py(1)); g.stroke(); g.setLineDash([]);
      g.beginPath(); for (let a = 0; a < NA; a++) { const p = [sx(a), py(P.pw[a])]; a ? g.lineTo(...p) : g.moveTo(...p); }
      g.strokeStyle = '#f0b25a'; g.lineWidth = 2; g.stroke();
      if (K && K.pw[0] != null) {
        g.beginPath(); let on = false;
        for (let b = 0; b < K.NA; b++) { const x = kx(b); if (x < padL - 0.5) continue; const y = py(K.pw[b]); if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; } }
        g.setLineDash([6, 4]); g.strokeStyle = '#9fe3f0'; g.lineWidth = 1.6; g.stroke(); g.setLineDash([]);
      }
      g.font = '12px "Instrument Sans", system-ui, sans-serif'; g.fillStyle = 'rgba(231,237,242,.85)'; g.textAlign = 'left';
      const et = `Energy along the crest: ${Math.round(P.pw[0] * 100)}% → ${Math.round(P.pw[NA - 1] * 100)}% of where it started`;
      g.fillText(g.measureText(et).width > w - sx(0) - 8 ? `Energy: ${Math.round(P.pw[0] * 100)}% → ${Math.round(P.pw[NA - 1] * 100)}% of the start` : et, sx(0), 13);   // phones
      g.textAlign = 'right'; g.fillStyle = 'rgba(231,237,242,.55)'; g.font = '11px "IBM Plex Mono", monospace'; g.fillText('100%', sx(0) - 6, py(1) + 4); g.fillText('0', sx(0) - 6, py(0) + 4);
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(sx(0), py(0)); g.lineTo(sx(NA - 1), py(0)); g.stroke();
    }
    // breaking point
    g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = 'rgba(231,237,242,.9)'; g.textAlign = 'center';
    if (P.ib >= 0) { const [bx, by] = XY(P.ib, -JM, P.H[P.ib] * 0.6); g.fillStyle = '#f08a4b'; g.textAlign = bx > w - 50 ? 'right' : 'center'; g.fillText('breaks here', bx > w - 50 ? bx + 6 : bx, by - 14); g.beginPath(); g.moveTo(bx, by - 10); g.lineTo(bx, by); g.strokeStyle = '#f08a4b'; g.lineWidth = 1.5; g.stroke(); }
    // depth scale on the left, distance under the cut face
    g.textAlign = 'right'; g.fillStyle = 'rgba(231,237,242,.7)';
    const zst = zmax > 150 ? 50 : zmax > 70 ? 20 : zmax > 25 ? 10 : zmax > 10 ? 5 : 2;
    for (let z = 0; z <= zmax; z += zst) { const [x, y] = XY(0, -JM, -z); g.fillText(z ? z + ' m' : '0', x - 6, y + 4); }
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {                           // distance to go, at round numbers
      const togo = P.Lkm * (1 - k / 4), a = Math.round((NA - 1) * k / 4), [x, y] = XY(a, -JM, -zmax);
      const txt = togo < 0.005 ? 'end' : togo >= 1 ? (+togo.toFixed(1)) + ' km' : Math.round(togo * 1000 / 5) * 5 + ' m';
      g.fillText(txt, x, Math.min(h - 8, y + 18));
    }
    if (CUT.run) requestAnimationFrame(cutDraw);
  }
  const toLand = (r) => (/^(near|on|off)/.test(r.land) ? '' : 'to ') + r.land;
  function cutCaption(w, h) {
    const P = CUT.prof, K = CUT.kprof, r = S.ray, kr = S.keep, i0 = 0, i1 = P.ib >= 0 ? P.ib : P.h.findIndex((x, a) => a > 0 && x <= 0.05) - 1;
    const e = i1 > 0 ? i1 : P.NA - 1, L = (a) => 2 * Math.PI / P.k[a], kmh = (a) => P.c[a] * 3.6;
    const km = (x) => (x < 1 ? Math.round(x * 1000) + ' m' : +x.toFixed(1) + ' km'), ft = (Q) => (0.78 * Q.bh * FTm).toFixed(1);
    // the same scales cutDraw uses: meters of depth per pixel against meters of distance per pixel
    const zmax = cutZmax(P, K), st = ((h - 114) / (zmax + 3)) / ((w - 60) / (P.Lkm * 1000));
    const V = `Wave height and depth share one scale, stretched about ${Math.max(2, Math.round(st))} times against distance. ` +
      (P.coarse ? 'The sea floor is the survey right under your ray, and NOAA\u2019s coarser ocean-wide map (about 1 km) where the ray is still beyond the survey\u2019s edge.' : 'The sea floor is the survey right under your ray.');
    const avg = (Q) => { let t = 0, n = 0; for (const x of Q.h) if (x > 0.05) { t += x; n++; } return n ? Math.round(t / n) : 0; };
    const cmp = K ? ` Dashed: the wave you kept (${kr.T} s ${toLand(kr)}). Over ${Math.abs(K.Lkm - P.Lkm) < 0.05 ? 'the same ' + km(P.Lkm) : 'its last ' + km(K.Lkm)} it crosses water ${avg(K)} m deep on average (yours: ${avg(P)} m)` +
      (K.pw[0] != null && P.pw[0] != null ? `, ends with ${Math.round(K.pw[K.NA - 1] * 100)}% of the energy it started with (yours: ${Math.round(P.pw[P.NA - 1] * 100)}%)` : '') +
      (K.ib >= 0 ? ` and breaks at about ${ft(K)} ft${P.ib >= 0 ? ` (yours: ${ft(P)} ft)` : ''}` : ' and doesn\u2019t break before its ray stops') + '.' : '';
    $('cutCap').textContent = `A ${CUT.ft} ft, ${r.T} s swell on your ray. Over the last ${km(P.Lkm)} its wavelength goes from ${Math.round(L(i0))} m to ${Math.round(L(e))} m and it slows from ${Math.round(kmh(i0))} to ${Math.round(kmh(e))} km/h, ` +
      (P.ib >= 0 ? `then breaks in ${P.bh.toFixed(1)} m of water at about ${ft(P)} ft (it breaks once it's about 0.78 times as tall as the water is deep). ` : `and it doesn't break before the ray stops. `) +
      `Height comes from shoaling plus how much the bottom focused or spread it along the way${r.pw ? '' : ' (still counting that; shoaling only for now)'}. ` +
      (P.Lkm > 10 ? 'At this scale the crests are only a few pixels apart, so the wave is drawn as a band from trough to crest. ' : '') + V + cmp;
    cutKeyNote();
  }
  function cutKeyNote() {                                    // the legend under the side view, and the keep button
    const b = $('cutKeep'), n = $('cutKey'), kr = S.keep, r = S.ray; if (!b || !n) return;
    b.textContent = kr ? 'Clear kept wave' : 'Keep to compare';
    n.hidden = !kr || !r || $('cutCv').hidden; n.textContent = '';
    if (n.hidden) return;
    const item = (cls, text) => { const sp = document.createElement('span'), i = document.createElement('i'); i.className = cls; sp.append(i, text); n.append(sp); };
    if (kr === r) { item('kept', `Kept: this wave (${r.T} s ${toLand(r)}). Aim or drop another wave to compare.`); return; }
    item('now', `Your wave: ${r.T} s ${toLand(r)}`);
    item('kept', `Kept: ${kr.T} s ${toLand(kr)}`);
  }
  function cutStart() { if (!cutCtx || CUT.run || $('cutBox').hidden) return; CUT.run = true; CUT.last = 0; requestAnimationFrame(cutDraw); }
  function cutSync() {                                       // shown in Drop a wave once there's a ray
    const box = $('cutBox'); if (!box) return;
    box.hidden = MAPV() || !S.ray; if (!box.hidden && CUT.vis) cutStart(); else if (!box.hidden) cutDraw();
  }
  if (cutCv) {
    new IntersectionObserver((es) => { CUT.vis = es.some((e) => e.isIntersecting); if (CUT.vis) cutStart(); else CUT.run = false; }).observe(cutCv);
    for (const [id, k] of [['cutFt', 'ft'], ['cutLen', 'len']]) {
      $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; CUT[k] = +b.dataset.v; for (const x of $(id).querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b)); CUT.key = ''; cutDraw(); });
    }
    // keep this wave's section to compare with the next one (Montauk against Fishers, say); its energy count keeps going
    $('cutKeep').addEventListener('click', () => { S.keep = S.keep ? null : S.ray; if (S.keep) ensurePw(S.keep); CUT.key = ''; cutKeyNote(); cutDraw(); draw(); });
    setInterval(cutSync, 600);
  }

  // ── 3D: the whole wave front over the sea floor. A line of rays square to your wave (one every 150 m,
  // 15 km either side of yours) is traced with the same tracer; at each moment the front is where those
  // rays have got to, standing up off the water as a band whose height is the wave's height there:
  // shoaling (group speed) times how far its neighbors have spread apart or bunched together (energy
  // between two rays stays between them). Where it gets taller than 0.78 x the depth it breaks and that
  // part of the front stops; rays that reach land stop too. Heights and depths are stretched to be seen.
  const W3 = { on: false, lib: null, built: '', t: 0, play: true, follow: true, last: 0, view: { az: -0.5, el: 0.62, dist: 1, tx: 0, tz: 0 }, front: null };
  function w3Lib() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (W3.lib) return W3.lib;
    W3.lib = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/three.min.js'; s.onload = () => ok(window.THREE); s.onerror = no; document.head.appendChild(s); });
    return W3.lib;
  }
  async function w3Front(r) {                                // trace the front: [{t[], x[], z[], h[]}] per ray, km about the start
    const HALF = 15, SP = 0.15, out = [], rad = (r.th + 90) * D2R, lon0 = r.start[0], lat0 = r.start[1];
    for (let k = -HALF; k <= HALF + 1e-9; k += SP) {
      const lon = lon0 + k * Math.sin(rad) / KX, lat = lat0 + k * Math.cos(rad) / KY;
      const res = (depthAt(lon, lat) || 0) > 1 ? trace(r.T, lon, lat, r.th, true) : null, p = res ? res.pts : [];
      const n = p.length / 4, ray = { t: new Float32Array(n), x: new Float32Array(n), z: new Float32Array(n), h: new Float32Array(n), k };
      for (let i = 0; i < n; i++) { ray.x[i] = (p[4 * i] - lon0) * KX; ray.z[i] = -(p[4 * i + 1] - lat0) * KY; ray.h[i] = p[4 * i + 2]; ray.t[i] = p[4 * i + 3]; }
      out.push(ray);
      if (out.length % 12 === 0) { $('w3Note').textContent = `Tracing the wave front… ${Math.round(100 * (k + HALF) / (2 * HALF))}%`; await new Promise((ok) => setTimeout(ok, 0)); if (S.ray !== r || !W3.on) throw new Error('stale'); }
    }
    return { rays: out, SP, tmax: Math.max(...out.map((q) => (q.t.length ? q.t[q.t.length - 1] : 0))) };
  }
  // one vertical scale for water and wave, stretched 70x: in proportion down to 60 m, then squeezed (log) so
  // the deep ocean doesn't swallow the view. The wave above the water uses the same scale x 4.
  const VZA = 0.07, WAVEX = 4;
  const vz = (depth) => (depth <= 0 ? 0.12 : -VZA * (depth <= 60 ? depth : 60 * (1 + Math.log(depth / 60))));
  // sharper sea floor (16 m) around Fishers, the Race and the mouth of the sound, loaded with the 3D view
  const FINE = { m: null, a: null };
  async function w3FineLoad() {
    if (FINE.a || FINE.m === false) return;
    const [m, im] = await Promise.all([json('ocean/fine16.json'), img('ocean/fine16.png')]);
    if (!m || !im) { FINE.m = false; return; }
    const px = window.CHOC.pixels(im), a = new Float32Array(m.rows * m.cols), wet = new Uint8Array(m.rows * m.cols);
    for (let i = 0; i < a.length; i++) { a[i] = ((px[4 * i] << 8) | px[4 * i + 1]) / m.scale - m.off; wet[i] = px[4 * i + 2] > 127; }
    FINE.m = m; FINE.a = a; FINE.wet = wet;
  }
  function fineDepth(lon, lat) {                             // [depth m, wet] from the 16 m tile, or null outside it
    const m = FINE.m; if (!m || !FINE.a) return null;
    const fx = (lon - m.left) * m.kmlon * 1000 / m.dx - 0.5, fy = (m.top - lat) * m.kmlat * 1000 / m.dx - 0.5;
    if (fx < 0 || fy < 0 || fx > m.cols - 2 || fy > m.rows - 2) return null;
    const j = Math.floor(fx), i = Math.floor(fy), u = fx - j, v = fy - i, A = FINE.a, C = m.cols;
    const d = (A[i * C + j] * (1 - u) + A[i * C + j + 1] * u) * (1 - v) + (A[(i + 1) * C + j] * (1 - u) + A[(i + 1) * C + j + 1] * u) * v;
    return [d, FINE.wet[Math.round(fy) * C + Math.round(fx)] > 0];
  }
  function depth3(lon, lat) {                                // [depth m, land?] from the sharpest data there
    const f = fineDepth(lon, lat); if (f) return [f[0], !f[1]];
    const d = depthAt(lon, lat), dep = d == null ? 0 : d, inW = GR.w && inWorld(lat, lon, 0);
    return [dep, inW ? !wetW(...worldXY(lon, lat)) : dep <= 0.3];
  }
  // sea floor color by depth: sand in the shallows, through teal and blue, to navy offshore
  const FLOOR = [[0, [0.80, 0.74, 0.58]], [3, [0.55, 0.72, 0.68]], [8, [0.35, 0.60, 0.68]], [20, [0.24, 0.45, 0.62]], [45, [0.18, 0.32, 0.52]], [150, [0.12, 0.20, 0.38]], [3000, [0.07, 0.11, 0.24]]];
  function floorCol(d) {
    let k = 0; while (k < FLOOR.length - 2 && d > FLOOR[k + 1][0]) k++;
    const [d0, c0] = FLOOR[k], [d1, c1] = FLOOR[k + 1], f = Math.max(0, Math.min(1, (d - d0) / (d1 - d0)));
    return c0.map((v, i) => v + (c1[i] - v) * f);
  }
  function w3Terrain(T3, box, n, inner) {
    const [x0, x1, z0, z1] = box, nx = n, nz = Math.max(8, Math.round(n * (z1 - z0) / (x1 - x0))), g = new T3.PlaneGeometry(x1 - x0, z1 - z0, nx - 1, nz - 1);
    g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), lon0 = S.ray.start[0], lat0 = S.ray.start[1];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), lon = lon0 + x / KX, lat = lat0 - z / KY, [dep, land] = depth3(lon, lat);
      const hole = inner && inner.some((q) => x > q[0] && x < q[1] && z > q[2] && z < q[3]);   // a sharper patch covers this: sink it out of the way
      pos.setY(i, (land ? 0.12 : vz(dep)) - (hole ? 0.3 : 0));
      const c = land ? [0.42, 0.39, 0.33] : floorCol(dep);
      col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
    }
    g.setAttribute('color', new T3.BufferAttribute(col, 3)); g.computeVertexNormals();
    return new T3.Mesh(g, new T3.MeshLambertMaterial({ vertexColors: true }));
  }
  function w3Build() {                                       // one build at a time (the panel and the watcher can both ask)
    if (!W3.building) W3.building = w3BuildNow().finally(() => { W3.building = null; });
    return W3.building;
  }
  async function w3BuildNow() {
    const r = S.ray; if (!r) return;
    const key = [r.start, r.th, r.T].join(); if (W3.built === key && W3.scene) return;
    $('w3Note').textContent = 'Loading 3D…';
    const T3 = await w3Lib(); await w3FineLoad(); let F;
    try { F = await w3Front(r); } catch (e) { return; }
    W3.front = F; W3.built = key; W3.t = 0; W3.drawn = '';
    // the part of the front the camera follows: the ray that gets closest to the spot it was aimed at
    // (Choc unless it was aimed at Wilderness), not the middle of the whole 30 km front
    { const g = /Wilderness/.test(S.note || '') ? SPOT.wild : SPOT.choc, gx = (g.pt[0] - r.start[0]) * KX, gz = -(g.pt[1] - r.start[1]) * KY;
      let best = Infinity, bj = Math.floor(F.rays.length / 2), bi = 0;
      F.rays.forEach((q, j) => { for (let i = 0; i < q.x.length; i++) { const d = Math.hypot(q.x[i] - gx, q.z[i] - gz); if (d < best) { best = d; bj = j; bi = i; } } });
      const q = F.rays[bj];   // once it gets there the view stays put, even if that ray runs on along the shore
      W3.lead = bj; W3.aimPt = null; W3.goal = { name: g.name, x: gx, z: gz, km: best, t: q.t.length ? q.t[bi] : 0, at: q.t.length ? [q.x[bi], q.z[bi], Math.max(0, q.h[bi])] : null }; }
    // scene box: everything the rays cover, plus a margin
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const q of F.rays) for (let i = 0; i < q.x.length; i++) { x0 = Math.min(x0, q.x[i]); x1 = Math.max(x1, q.x[i]); z0 = Math.min(z0, q.z[i]); z1 = Math.max(z1, q.z[i]); }
    const m = 0.08 * Math.max(x1 - x0, z1 - z0) + 3; x0 -= m; x1 += m; z0 -= m; z1 += m;
    const cv3 = $('w3Cv'), w = cv3.clientWidth, h = cv3.clientHeight;
    if (!W3.rd) { W3.rd = new T3.WebGLRenderer({ canvas: cv3, antialias: true }); W3.rd.setPixelRatio(dpr); }
    W3.rd.setSize(w, h, false);
    const sc0 = new T3.Scene(); sc0.background = new T3.Color(0x0b1622);
    const sc = new T3.Group(); sc0.add(sc); W3.root = sc;   // everything that gets the vertical stretch
    sc0.add(new T3.HemisphereLight(0xcfe3f5, 0x2a2018, 0.85)); const sun = new T3.DirectionalLight(0xffffff, 0.6); sun.position.set(-1, 2, 1.2); sc0.add(sun);
    // sea floor: the whole box, plus a sharper patch where the rays meet the shallows (the last 35 km)
    let fx0 = 1e9, fx1 = -1e9, fz0 = 1e9, fz1 = -1e9;
    for (const q of F.rays) for (let i = 0; i < q.x.length; i++) if (q.h[i] < 40) { fx0 = Math.min(fx0, q.x[i]); fx1 = Math.max(fx1, q.x[i]); fz0 = Math.min(fz0, q.z[i]); fz1 = Math.max(fz1, q.z[i]); }
    let inner = null;
    if (fx1 > fx0) { const pad = 3; inner = [Math.max(x0, fx0 - pad), Math.min(x1, fx1 + pad), Math.max(z0, fz0 - pad), Math.min(z1, fz1 + pad)]; if (inner[1] - inner[0] > 45) inner[0] = inner[1] - 45; if (inner[3] - inner[2] > 45) inner[2] = inner[3] - 45; }
    // the 16 m tile, where it overlaps the scene
    let fine = null;
    if (FINE.m) {
      const m = FINE.m, lon0 = r.start[0], lat0 = r.start[1], bx0 = (m.left - lon0) * KX, bx1 = (m.left + m.cols * m.dx / 1000 / m.kmlon - lon0) * KX;
      const bz0 = -(m.top - lat0) * KY, bz1 = -(m.top - m.rows * m.dx / 1000 / m.kmlat - lat0) * KY;
      const fb = [Math.max(x0, bx0 + 0.05), Math.min(x1, bx1 - 0.05), Math.max(z0, bz0 + 0.05), Math.min(z1, bz1 - 0.05)];
      if (fb[1] - fb[0] > 1 && fb[3] - fb[2] > 1) fine = fb;
    }
    const shrink = (q) => [q[0] + 0.3, q[1] - 0.3, q[2] + 0.3, q[3] - 0.3];
    W3.ground = [w3Terrain(T3, [x0, x1, z0, z1], 220, [inner, fine].filter(Boolean).map(shrink))];
    if (inner) W3.ground.push(w3Terrain(T3, inner, 320, fine ? [shrink(fine)] : null));
    if (fine) W3.ground.push(w3Terrain(T3, fine, Math.min(600, Math.round((fine[1] - fine[0]) / 0.03)), null));   // about 30-40 m between points
    for (const g of W3.ground) sc.add(g);
    const water = new T3.Mesh(new T3.PlaneGeometry(x1 - x0, z1 - z0), new T3.MeshBasicMaterial({ color: 0x3a7cb8, transparent: true, opacity: 0.22, depthWrite: false }));
    water.rotateX(-Math.PI / 2); water.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2); sc.add(water);
    // the rays' tracks on the water, faint: where each bit of the front went
    const tr = [];
    F.rays.forEach((q, j) => { if (j % 4) return; for (let i = 1; i < q.x.length; i++) tr.push(q.x[i - 1], 0.05, q.z[i - 1], q.x[i], 0.05, q.z[i]); });
    const tg = new T3.BufferGeometry(); tg.setAttribute('position', new T3.Float32BufferAttribute(tr, 3));
    sc.add(new T3.LineSegments(tg, new T3.LineBasicMaterial({ color: 0xbfd6e8, transparent: true, opacity: 0.18 })));
    // the front: a band of quads, rebuilt every frame
    const NR = F.rays.length, band = new T3.BufferGeometry();     // two triangles per pair of neighbors still together
    band.setAttribute('position', new T3.BufferAttribute(new Float32Array((NR - 1) * 6 * 3), 3));
    band.setAttribute('color', new T3.BufferAttribute(new Float32Array((NR - 1) * 6 * 3), 3));
    W3.band = new T3.Mesh(band, new T3.MeshBasicMaterial({ vertexColors: true, side: T3.DoubleSide, transparent: true, opacity: 0.92 }));
    sc.add(W3.band);
    // under it, the water column down to the sea floor beneath each part of the front
    const colG = new T3.BufferGeometry(); colG.setAttribute('position', new T3.BufferAttribute(new Float32Array((NR - 1) * 6 * 3), 3));
    W3.column = new T3.Mesh(colG, new T3.MeshBasicMaterial({ color: 0x7fb8e0, side: T3.DoubleSide, transparent: true, opacity: 0.38, depthWrite: false }));
    sc.add(W3.column);
    const cam = new T3.PerspectiveCamera(45, w / h, 0.05, 5000);
    const size = Math.max(x1 - x0, z1 - z0);
    W3.view = { az: -0.5 + (r.th * D2R), el: 0.6, dist: size * 0.9, tx: (x0 + x1) / 2, tz: (z0 + z1) / 2 };
    W3.scene = sc0; W3.cam = cam; W3.size = size; W3.box = [x0, x1, z0, z1];
    W3.WZ = VZA * WAVEX;                                     // km of band per meter of wave
    $('w3Time').max = String(Math.round(F.tmax));
    $('w3Note').textContent = '';
    w3Loop();
  }
  function w3Place() {
    const v = W3.view, c = W3.cam;
    c.position.set(v.tx + v.dist * Math.cos(v.el) * Math.sin(v.az), v.dist * Math.sin(v.el), v.tz + v.dist * Math.cos(v.el) * Math.cos(v.az));
    c.lookAt(v.tx, 0, v.tz);
  }
  function w3Frame() {                                       // the front at time W3.t (minutes since it left)
    const F = W3.front, r = S.ray, t = W3.t, H0 = CUT.ft / FTm, cg0 = G * r.T / (4 * Math.PI), NR = F.rays.length;
    const P = new Float32Array(NR * 3).fill(NaN);
    for (let j = 0; j < NR; j++) {
      const q = F.rays[j], n = q.t.length; if (n < 2 || t > q.t[n - 1]) continue;
      let lo = 0, hi = n - 1; while (hi - lo > 1) { const mI = (lo + hi) >> 1; if (q.t[mI] <= t) lo = mI; else hi = mI; }
      const f = Math.min(1, Math.max(0, (t - q.t[lo]) / Math.max(1e-6, q.t[hi] - q.t[lo])));
      P[3 * j] = q.x[lo] + (q.x[hi] - q.x[lo]) * f; P[3 * j + 1] = q.z[lo] + (q.z[hi] - q.z[lo]) * f; P[3 * j + 2] = q.h[lo] + (q.h[hi] - q.h[lo]) * f;
    }
    const pos = W3.band.geometry.attributes.position, col = W3.band.geometry.attributes.color, H = new Float32Array(NR);
    let e0 = 0, e1 = 0, broke = 0;
    for (let j = 0; j < NR; j++) {
      if (isNaN(P[3 * j])) { H[j] = NaN; continue; }
      // spacing to the neighbors still going: energy between two rays stays between them
      // over two neighbors each side, so crossing rays don't make spikes
      const nb = []; for (const d of [-3, -2, -1, 1, 2, 3]) { const k = j + d; if (k >= 0 && k < NR && !isNaN(P[3 * k])) nb.push(Math.hypot(P[3 * k] - P[3 * j], P[3 * k + 1] - P[3 * j + 1]) / Math.abs(d)); }
      const b = nb.length ? nb.reduce((s, v) => s + v, 0) / nb.length : F.SP, dep = Math.max(0.3, P[3 * j + 2]);
      let h = H0 * Math.sqrt(cg0 / cg(r.T, dep)) * Math.sqrt(Math.min(6, Math.max(0.02, F.SP / Math.max(0.01, b))));
      if (h > 0.78 * dep) { h = 0.78 * dep; broke++; }
      H[j] = nb.length ? h : 0;
      e1 += H[j] * H[j] * cg(r.T, dep) * Math.min(b, 3 * F.SP);
    }
    for (let j = 0; j < NR; j++) e0 += H0 * H0 * cg0 * F.SP * (F.rays[j].t.length > 1 ? 1 : 0);
    { const Hs = Float32Array.from(H);                       // a light running mean along the front
      for (let j = 0; j < NR; j++) { if (isNaN(Hs[j])) continue; let s2 = 0, w2 = 0; for (let d = -4; d <= 4; d++) { const k = j + d; if (k < 0 || k >= NR || isNaN(Hs[k])) continue; const ww = 5 - Math.abs(d); s2 += ww * Hs[k]; w2 += ww; } H[j] = Math.min(s2 / w2, 0.78 * Math.max(0.3, P[3 * j + 2])); } }
    { let cx = 0, cz = 0, cd = 0, n = 0; for (let j = 0; j < NR; j++) if (!isNaN(H[j])) { cx += P[3 * j]; cz += P[3 * j + 1]; cd += P[3 * j + 2]; n++; }
      W3.mid = n ? [cx / n, cz / n, cd / n] : null; }
    if (W3.goal && W3.goal.at && t >= W3.goal.t) W3.aimPt = W3.goal.at;
    else { const L = W3.lead; let cx = 0, cz = 0, cd = 0, n = 0;   // the stretch of front headed for the spot (a few rays either side of the closest)
      for (let j = Math.max(0, L - 3); j <= Math.min(NR - 1, L + 3); j++) if (!isNaN(P[3 * j])) { cx += P[3 * j]; cz += P[3 * j + 1]; cd += P[3 * j + 2]; n++; }
      if (n) W3.aimPt = [cx / n, cz / n, cd / n];
      else { const q = F.rays[L], k = q.t.length - 1; W3.aimPt = k >= 0 ? (t >= q.t[k] ? [q.x[k], q.z[k], Math.max(0, q.h[k])] : [q.x[0], q.z[0], q.h[0]]) : W3.mid; } }
    let nv = 0, nc = 0; const cpos = W3.column.geometry.attributes.position, bed = new Float32Array(NR);
    for (let j = 0; j < NR; j++) if (!isNaN(H[j])) { const [dd, land] = depth3(r.start[0] + P[3 * j] / KX, r.start[1] - P[3 * j + 1] / KY); bed[j] = land ? 0 : vz(dd); }
    const colOf = (j) => { const brk = H[j] >= 0.78 * Math.max(0.3, P[3 * j + 2]) - 1e-6, c = brk ? [255, 255, 255] : hCol(H[j] * FTm); return [c[0] / 255, c[1] / 255, c[2] / 255]; };
    const put = (j, top) => { pos.setXYZ(nv, P[3 * j], 0.03 + (top ? H[j] * W3.WZ : 0), P[3 * j + 1]); col.setXYZ(nv, ...colOf(j)); nv++; };
    for (let j = 0; j < NR - 1; j++) {
      // a gap where neighbors have stopped or split far apart
      if (isNaN(H[j]) || isNaN(H[j + 1]) || Math.hypot(P[3 * j + 3] - P[3 * j], P[3 * j + 4] - P[3 * j + 1]) > 8) continue;   // more than 8 km apart: the front has torn
      put(j, 0); put(j, 1); put(j + 1, 0); put(j, 1); put(j + 1, 1); put(j + 1, 0);
      const cq = (k, top) => { cpos.setXYZ(nc++, P[3 * k], top ? 0.02 : bed[k], P[3 * k + 1]); };
      cq(j, 0); cq(j, 1); cq(j + 1, 0); cq(j, 1); cq(j + 1, 1); cq(j + 1, 0);
    }
    W3.column.geometry.setDrawRange(0, nc); cpos.needsUpdate = true; W3.column.geometry.computeBoundingSphere();
    W3.band.geometry.setDrawRange(0, nv); pos.needsUpdate = true; col.needsUpdate = true; W3.band.geometry.computeBoundingSphere();
    const live = H.filter((v) => !isNaN(v) && v > 0), hi = live.length ? Math.max(...live) : 0;
    $('w3Read').textContent = `${fmtT(t)} after leaving · energy still moving ${e0 ? Math.round(100 * e1 / e0) : 0}% of the start · tallest part ${(hi * FTm).toFixed(1)} ft` + (broke ? ' · breaking' : '');
    $('w3Time').value = String(Math.round(t));
  }
  function w3Loop(ts) {
    if (!W3.on || !W3.scene) return;
    if (ts != null && W3.play && !reduce) {                  // deep water goes by fast; over the shelf, slow down
      const dt = W3.last ? Math.min(0.1, (ts - W3.last) / 1000) : 0, lp = W3.aimPt || W3.mid, slow = lp && lp[2] < 80 ? 0.3 : 1;
      W3.t += dt * slow * W3.front.tmax / 25; if (W3.t > W3.front.tmax) W3.t = 0;
    }
    const fp = W3.aimPt || W3.mid;
    if (W3.follow && fp) {                                   // keep the part of the wave headed for the spot in view
      const v = W3.view, k = W3.t < 1 ? 1 : 0.06, want = Math.max(6, Math.min(W3.size * 0.5, fp[2] < 30 ? 10 : fp[2] < 80 ? 25 : 70));
      const dx = fp[0] - v.tx, dz = fp[1] - v.tz, dd = want - v.dist;
      if (Math.hypot(dx, dz) > 0.02 * v.dist) { v.tx += dx * k; v.tz += dz * k; }   // caught up: stop nudging, so a paused view sits still
      if (Math.abs(dd) > 0.02 * v.dist) v.dist += dd * 0.03;
    }
    W3.last = ts || 0;
    // the vertical stretch eases off as you zoom in: 70x from afar, down to about 9x right over the reef
    const vs = Math.max(0.13, Math.min(1, W3.view.dist / 40)); if (W3.root.scale.y !== vs) W3.root.scale.y = vs;
    const key = [W3.t, W3.view.az, W3.view.el, W3.view.dist, W3.view.tx, W3.view.tz, W3.rd.domElement.width, W3.rd.domElement.height].join();
    if (key !== W3.drawn) { W3.drawn = key; w3Frame(); w3Place(); W3.rd.render(W3.scene, W3.cam); const nd = $('w3Needle'); if (nd) nd.style.transform = `rotate(${(W3.view.az * 180 / Math.PI).toFixed(1)}deg)`; }   // paused and still: nothing to draw
    requestAnimationFrame(w3Loop);
  }
  function w3Show(on) {
    W3.on = on; $('w3Box').hidden = !on; $('cutCv').hidden = on; $('cutLen').hidden = on; $('cutKeep').hidden = on; cutKeyNote();
    for (const b of document.querySelectorAll('#cutView button')) b.setAttribute('aria-pressed', String((b.dataset.v === '3d') === on));
    if (on) { w3Build().then(() => { if (W3.scene) { W3.last = 0; requestAnimationFrame(w3Loop); } }).catch(() => { $('w3Note').textContent = 'This browser can’t show the 3D view.'; }); }
  }
  if ($('w3Cv')) {
    $('cutView').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) w3Show(b.dataset.v === '3d'); });
    $('w3Play').addEventListener('click', () => { W3.play = !W3.play; $('w3Play').textContent = W3.play ? 'Pause' : 'Play'; });
    $('w3Time').addEventListener('input', () => { W3.t = +$('w3Time').value; W3.play = false; $('w3Play').textContent = 'Play'; });
    $('w3Reset').addEventListener('click', () => { W3.built = ''; W3.scene = null; W3.follow = true; $('w3Follow').setAttribute('aria-pressed', 'true'); w3Show(true); });
    $('w3Follow').addEventListener('click', () => { W3.follow = !W3.follow; $('w3Follow').setAttribute('aria-pressed', String(W3.follow)); });
    // like a map: one finger (or mouse) drags the sea floor; two fingers pinch to zoom, twist to turn and slide
    // up or down to tilt (mouse: right- or shift-drag turns and tilts); double-tap zooms in on the spot tapped
    const cv3 = $('w3Cv'), tp = new Map(); let g0 = null, lastTap = null, moved = 0;
    noPageZoom(cv3, () => true);
    const rect = () => cv3.getBoundingClientRect();
    const manual = () => { W3.follow = false; $('w3Follow').setAttribute('aria-pressed', 'false'); };
    const pan = (dx, dy) => { const v = W3.view, k = v.dist / rect().height * 1.1; v.tx -= (dx * Math.cos(v.az) + dy * Math.sin(v.az)) * k; v.tz -= (-dx * Math.sin(v.az) + dy * Math.cos(v.az)) * k; };
    const turn = (dx, dy) => { const v = W3.view; v.az -= dx * 0.006; v.el = Math.max(0.08, Math.min(1.45, v.el + dy * 0.005)); };
    function zoomTo(cx, cy, f) {                             // zoom toward the sea floor under a screen point
      const v = W3.view, b = rect(), T3 = window.THREE; let hit = null;
      if (T3 && W3.cam) {
        const rc = new T3.Raycaster(); rc.setFromCamera({ x: (cx - b.left) / b.width * 2 - 1, y: -((cy - b.top) / b.height * 2 - 1) }, W3.cam);
        const h = rc.intersectObjects(W3.ground || [], false)[0]; if (h) hit = h.point;
      }
      if (hit) { v.tx += (hit.x - v.tx) * (1 - f); v.tz += (hit.z - v.tz) * (1 - f); }
      v.dist = Math.max(0.4, Math.min(W3.size * 3, v.dist * f));
    }
    cv3.addEventListener('contextmenu', (e) => e.preventDefault());
    cv3.addEventListener('pointerdown', (e) => { cv3.setPointerCapture(e.pointerId); tp.set(e.pointerId, [e.clientX, e.clientY, e.button]); g0 = null; moved = 0; });
    cv3.addEventListener('pointermove', (e) => {
      if (!tp.has(e.pointerId) || !W3.scene) return; const [px, py, btn] = tp.get(e.pointerId); tp.set(e.pointerId, [e.clientX, e.clientY, btn]);
      const dx = e.clientX - px, dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy);
      if (tp.size === 1) { if (btn === 2 || e.shiftKey) turn(dx, dy); else { manual(); pan(dx, dy); } return; }
      if (tp.size !== 2) return;
      // two fingers, as in Google Earth: each gesture locks into one mode once it's clear what it is.
      // Pinch and twist go together (zoom about the fingers, turn with them); both fingers sliding the
      // same way up or down tilts. Each step applies only the change since the last one, so nothing jumps.
      const [a, b] = [...tp.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (!g0) { g0 = { d, ang, mx, my, d0: d, ang0: ang, my0: my, mode: null }; return; }
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      if (!g0.mode) {
        const zoomed = Math.abs(Math.log(d / g0.d0)) > 0.06, twisted = Math.abs(wrap(ang - g0.ang0)) > 0.12, slid = Math.abs(my - g0.my0) > 14;
        if (slid && !zoomed && !twisted) g0.mode = 'tilt'; else if (zoomed || twisted) g0.mode = 'zr';
      }
      manual(); const v = W3.view;
      if (g0.mode === 'tilt') v.el = Math.max(0.08, Math.min(1.45, v.el + (my - g0.my) * 0.006));
      else if (g0.mode === 'zr') {
        zoomTo(mx, my, g0.d / Math.max(10, d));
        if (Math.abs(wrap(ang - g0.ang0)) > 0.12) v.az += wrap(ang - g0.ang);        // turn with the fingers once the twist is clear
      }
      g0.d = d; g0.ang = ang; g0.mx = mx; g0.my = my;
    });
    const up = (e) => {
      if (tp.size === 1 && tp.has(e.pointerId) && moved < 8) {                             // a tap: double-tap zooms in
        const now = performance.now();
        if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { manual(); zoomTo(e.clientX, e.clientY, 0.4); lastTap = null; }
        else lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
      tp.delete(e.pointerId); g0 = null;
    };
    cv3.addEventListener('pointerup', up); cv3.addEventListener('pointercancel', up);
    // compass: the needle shows north; drag it sideways to turn, up or down to tilt; tap it to face north
    const cmp = $('w3Compass'); let cg = null;
    if (cmp) {
      cmp.addEventListener('pointerdown', (e) => { e.stopPropagation(); cmp.setPointerCapture(e.pointerId); cg = { x: e.clientX, y: e.clientY, n: 0 }; });
      cmp.addEventListener('pointermove', (e) => { if (!cg || !W3.scene) return; const dx = e.clientX - cg.x, dy = e.clientY - cg.y; cg.x = e.clientX; cg.y = e.clientY; cg.n += Math.abs(dx) + Math.abs(dy); manual(); turn(-dx * 1.2, dy); });
      cmp.addEventListener('pointerup', () => { if (cg && cg.n < 6 && W3.scene) { manual(); W3.view.az = 0; W3.view.el = Math.max(W3.view.el, 0.5); } cg = null; });
      cmp.addEventListener('pointercancel', () => { cg = null; });
    }
    $('w3Fishers').addEventListener('click', () => {      // close in on the west end of Fishers: Choc, Wilderness, the Race
      if (!W3.scene || !S.ray) return; manual(); const v = W3.view, r = S.ray;
      v.tx = (-71.985 - r.start[0]) * KX; v.tz = -(41.262 - r.start[1]) * KY; v.dist = 6; v.el = 0.55; v.az = 0.15;                // from the south, looking at the reef
    });
    cv3.addEventListener('wheel', (e) => { if (!W3.scene) return; e.preventDefault(); manual(); zoomTo(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    new ResizeObserver(() => { if (W3.rd && W3.cam) { const w = cv3.clientWidth, h = cv3.clientHeight; W3.rd.setSize(w, h, false); W3.cam.aspect = w / h; W3.cam.updateProjectionMatrix(); } }).observe(cv3);
    setInterval(() => { if (W3.on && S.ray && W3.built !== [S.ray.start, S.ray.th, S.ray.T].join() && !W3.busy) { W3.busy = true; W3.scene = null; w3Build().catch(() => { $('w3Note').textContent = 'This browser can\u2019t show the 3D view.'; }).finally(() => { W3.busy = false; }); } if (W3.on && (MAPV() || !S.ray)) W3.on = false; else if (!W3.on && !MAPV() && S.ray && !$('w3Box').hidden) w3Show(true); }, 800);
  }

  window.CHOC.trip = { w3: W3, _aimed: () => (FC.d && fRow() != null ? fcAimed(FC.model, fRow(), FC.spot) : []), _at: (lon, lat) => fcAt(lon, lat, FC.model, fRow()),
    _week: (i) => setWeek(i), _tapAt: (lon, lat) => { const { sc, x0, y0 } = proj(cam()); fcTap((lon * KX - x0) * sc, (-lat * KY - y0) * sc); }, _raw: (T, lon, lat, th) => trace(T, lon, lat, th, false), state: S, aim: doAim, play, _miss: (T, lon, lat, th, spot) => miss(trace(T, lon, lat, th, false, aimTg(spot)), spot), _aim: (spot, T, s) => aim(spot, T, s), trace: (T, lon, lat, th) => makeRay(T, [lon, lat], th),
    _tiles: () => tileCache.size, _reefAsked: () => REEF.asked, _speeds: (T, h) => [cp(T, h), cg(T, h), rEff(T, 250)],
    skip: () => { if (S.ray) { S.dist = S.ray.len; S.phase = 'done'; S.playing = false; draw(); finish(); } }, setMode, fc: FC,
    // the storm layer: what it last drew (lows in view, highs, tracks, isobar segments) and each storm's track over the run
    _storm: () => ({ status: ST.status, drawn: ST.drawn ? JSON.parse(JSON.stringify(ST.drawn)) : null, tracks: ST.tracks ? ST.tracks.map((tr) => {
      const a = tr.pts[0], b = tr.pts[tr.pts.length - 1], r1 = (x) => Math.round(x * 10) / 10, ts = (k) => Date.parse(FC.d.gfs[k].t);
      return { min: Math.round(Math.min(...tr.pts.map((x) => x.p))), hours: Math.round((ts(b.k) - ts(a.k)) / 36e5), from: [r1(a.lat), r1(a.lon)], to: [r1(b.lat), r1(b.lon)], k: [a.k, b.k] };
    }) : null }),
    // the same on a past day: the pressure step drawn (its UTC time) and the storms followed around it
    _pastStorm: () => ({ meta: PP.meta ? { cols: PP.meta.cols, years: Object.keys(PP.meta.years || {}) } : PP.meta, drawn: PP.drawn ? JSON.parse(JSON.stringify(PP.drawn)) : null,
      tracks: PP.win ? PP.win.tracks.map((tr) => ({ min: Math.round(Math.min(...tr.pts.map((x) => x.p))), hours: Math.round((PP.win.g.ts[tr.pts[tr.pts.length - 1].k] - PP.win.g.ts[tr.pts[0].k]) / 36e5) })) : null }),
    _screen: (lon, lat) => { const { sc, x0, y0 } = proj(cam()); return [(lon * KX - x0) * sc, (-lat * KY - y0) * sc]; } };

  // first view: the forecast, unless this device last used Drop a wave
  let view = EXUI ? 'past' : 'week'; if (!FCUI) try { const v = localStorage.getItem('choc.hubView'); if (v === 'drop' || v === 'past') view = v; } catch (e) { /* default */ }
  setMode(view);
})();
