/* Wave-height worker for the map page: the Sound Check refraction model, off the main thread.
 *
 * Same model and numbers as research/index.html ("the ray model across the
 * sound"): for each swell train given at buoy 44097 (height, period, from), the
 * height anywhere in the Sound is the train's height times K, the refraction
 * coefficient for that period and direction (research/kfull/<T>_<D>.png at
 * 144 m, interpolated between the four nearest; research/kgrid.png's
 * directionally spread K at 288 m while those load). Trains add as energy, and
 * no wave is taller than 0.78 x the depth. Land borrows its nearest water
 * cell's height so the color runs cleanly under the coastline (the map masks it).
 *
 * Replies with the field as two images (the Sound at 144 m, Fishers at 16 m)
 * and the heights in feet for the hover readout.
 */
'use strict';
importScripts('geometry.js');
const M = self.MapGeometry;
// RAY2 and the survey world from research/index.html
const RG = { R: 693, C: 903, R2: 346, C2: 451, cell: 0.144, dirs: [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220], pers: [6, 9, 12, 15] };
const WM = { left: -72.4, right: -70.85, bottom: 40.6, top: 41.5 };
const RF = RG.R, CF = RG.C, NF = RF * CF, R2 = RG.R2, C2 = RG.C2, NC = R2 * C2;

async function pixels(url, gray) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + r.status);
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data, w = bmp.width;
  bmp.close(); c.width = c.height = 1;
  if (!gray) return { w, d };
  const out = new Uint8Array(d.length / 4); for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return { w, d: out };
}

let KG = null, DEPTH = null, NEAREST = null;
const ready = (async () => {
  const [k, dp] = await Promise.all([pixels('../research/kgrid.png', true), pixels('../research/depth144.png')]);
  KG = RG.pers.map((_, ti) => RG.dirs.map((_, di) => {
    const t = new Uint8Array(NC);
    for (let r = 0; r < R2; r++) { const row = (ti * R2 + r) * k.w + di * C2; for (let c = 0; c < C2; c++) t[r * C2 + c] = k.d[row + c]; }
    return t;
  }));
  DEPTH = new Float32Array(NF);
  for (let i = 0; i < NF; i++) DEPTH[i] = -(((dp.d[i * 4] << 8) | dp.d[i * 4 + 1]) / 10 - 1000);
  NEAREST = new Int32Array(NF).fill(-1); const q = new Int32Array(NF); let qh = 0, qt = 0;
  for (let i = 0; i < NF; i++) if (DEPTH[i] > 0.4) { NEAREST[i] = i; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++], r = (i / CF) | 0, c = i - r * CF;
    if (c > 0 && NEAREST[i - 1] < 0) { NEAREST[i - 1] = NEAREST[i]; q[qt++] = i - 1; }
    if (c < CF - 1 && NEAREST[i + 1] < 0) { NEAREST[i + 1] = NEAREST[i]; q[qt++] = i + 1; }
    if (r > 0 && NEAREST[i - CF] < 0) { NEAREST[i - CF] = NEAREST[i]; q[qt++] = i - CF; }
    if (r < RF - 1 && NEAREST[i + CF] < 0) { NEAREST[i + CF] = NEAREST[i]; q[qt++] = i + CF; }
  }
})();

// Full-resolution K on demand, the 24 used most recently kept.
const KF = new Map(), KF_KEEP = 24, waiting = [];
function kfGet(T, D) {
  const key = T + '_' + D, v = KF.get(key);
  if (v instanceof Uint8Array) { KF.delete(key); KF.set(key, v); return v; }
  if (v === undefined) {
    const p = pixels('../research/kfull/' + key + '.png', true).then(({ d }) => {
      KF.set(key, d);
      const have = [...KF].filter(([, x]) => x instanceof Uint8Array);
      for (const [kk] of have.slice(0, Math.max(0, have.length - KF_KEEP))) KF.delete(kk);
    }).catch(() => KF.set(key, 'fail'));
    KF.set(key, p); waiting.push(p);
  }
  return null;
}
const SPREAD_S = 10, kcache = new Map();
function keff(dir, per) {
  const dq = Math.round(dir), pq = Math.round(per * 4) / 4, key = dq + '|' + pq;
  if (kcache.has(key)) return kcache.get(key);
  const P = RG.pers; let ti = 0; const pc = Math.max(P[0], Math.min(P[P.length - 1], pq));
  while (ti < P.length - 2 && pc > P[ti + 1]) ti++;
  const ft = (pc - P[ti]) / (P[ti + 1] - P[ti]);
  let norm = 0; for (let d = 0; d < 360; d += 10) norm += Math.pow(Math.cos((d - dq) * Math.PI / 360), 2 * SPREAD_S);
  const out = new Float32Array(NC);
  RG.dirs.forEach((Dd, di) => {
    const w = Math.pow(Math.abs(Math.cos((Dd - dq) * Math.PI / 360)), 2 * SPREAD_S) / norm;
    if (w < 0.004) return;
    const a = KG[ti][di], b = KG[ti + 1][di], wa = w * (1 - ft) / 1e4, wb = w * ft / 1e4;
    for (let i = 0; i < NC; i++) out[i] += wa * a[i] * a[i] + wb * b[i] * b[i];
  });
  for (let i = 0; i < NC; i++) out[i] = Math.sqrt(out[i]);
  if (kcache.size > 24) kcache.delete(kcache.keys().next().value);
  kcache.set(key, out); return out;
}
const E2 = new Float32Array(NF);
function addTrain(hs, dir, per) {
  const P = RG.pers, Ds = RG.dirs;
  // swell from outside the modeled directions (60-220°) fades out instead of being clamped
  const dIn = Math.max(Ds[0], Math.min(Ds[Ds.length - 1], dir)), fade = Math.max(0, 1 - Math.abs(dir - dIn) / 25);
  const H = hs * fade; if (H <= 0.01) return true;
  let di = 0; while (di < Ds.length - 2 && dIn > Ds[di + 1]) di++;
  const fd = (dIn - Ds[di]) / (Ds[di + 1] - Ds[di]);
  const pc = Math.max(P[0], Math.min(P[P.length - 1], per)); let ti = 0; while (ti < P.length - 2 && pc > P[ti + 1]) ti++;
  const ft = (pc - P[ti]) / (P[ti + 1] - P[ti]);
  const corners = [[ti, di, (1 - ft) * (1 - fd)], [ti, di + 1, (1 - ft) * fd], [ti + 1, di, ft * (1 - fd)], [ti + 1, di + 1, ft * fd]]
    .map(([a, b, w]) => ({ k: kfGet(P[a], Ds[b]), w })).filter(o => o.w > 1e-4);
  const have = corners.filter(o => o.k), wsum = have.reduce((a, o) => a + o.w, 0);
  if (wsum < 0.5) {
    const K2 = keff(dir, per);
    for (let i = 0; i < NF; i++) { const j = NEAREST[i] < 0 ? i : NEAREST[i], r = (j / CF) | 0, c = j - r * CF, h = H * K2[Math.min(R2 - 1, r >> 1) * C2 + Math.min(C2 - 1, c >> 1)]; E2[i] += h * h; }
  } else {
    const ks = have.map(o => o.k), ws = have.map(o => o.w / wsum / 100), n = ks.length;
    for (let i = 0; i < NF; i++) { const j = NEAREST[i] < 0 ? i : NEAREST[i]; let k = 0; for (let m = 0; m < n; m++) k += ks[m][j] * ws[m]; const h = H * k; E2[i] += h * h; }
  }
  return wsum >= 0.999;
}

// Two images, each on rows evenly spaced in Web Mercator so they line up with the map exactly:
// the whole Sound at 144 m, and Fishers at 16 m with the survey's own water mask, so the color
// stops at the beach. The Sound image fades out where the Fishers one takes over.
let FINE = null;
const fineReady = Promise.all([pixels('../research/ocean/fine16.png'), fetch('../research/ocean/fine16.json').then(r => r.json())]).then(([p, m]) => {
  const w = p.w, h = p.d.length / 4 / w, wet = new Uint8Array(w * h);
  for (let i = 0; i < wet.length; i++) wet[i] = p.d[i * 4 + 2] > 127 && ((p.d[i * 4] << 8) | p.d[i * 4 + 1]) / m.scale - m.off > 0.3 ? 1 : 0;   // the grid stores depth
  const right = m.left + w * m.dx / 1000 / m.kmlon, bottom = m.top - h * m.dx / 1000 / m.kmlat;
  FINE = { w, h, wet, left: m.left, top: m.top, right, bottom, sx: m.kmlon * 1000 / m.dx, sy: m.kmlat * 1000 / m.dx };
});
const rowLats = (top, bottom, n) => { const a = M.mercY(top), b = M.mercY(bottom), out = new Float64Array(n); for (let r = 0; r < n; r++) out[r] = M.latOf(a + (b - a) * (r + 0.5) / n); return out; };
const SOUND_LAT = rowLats(WM.top, WM.bottom, RF);
const LUT = new Uint32Array(512);
for (let i = 0; i < 512; i++) { const c = M.hCol(i / 511 * 20); LUT[i] = (c[2] << 16) | (c[1] << 8) | c[0]; }
const color = (ft, a) => ((a & 255) << 24 | LUT[Math.min(511, Math.max(0, (ft / 20 * 511) | 0))]) >>> 0;
const FEATHER = 0.012;                       // degrees (~1 km) over which the two images cross-fade
function insideFine(lon, lat) {               // 1 well inside the Fishers image, 0 outside it
  if (!FINE) return 0;
  const d = Math.min(lon - FINE.left, FINE.right - lon, (lat - FINE.bottom) * 1.33, (FINE.top - lat) * 1.33);
  return M.smoothstep(0, FEATHER, d);
}
function hAt(hAll, lon, lat) {               // bilinear height (ft) on the 144 m grid
  const x = (lon - WM.left) * 83.95050561668964 / RG.cell - 0.5, y = (WM.top - lat) * 110.95 / RG.cell - 0.5;
  const x0 = Math.max(0, Math.min(CF - 2, Math.floor(x))), y0 = Math.max(0, Math.min(RF - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0)), i = y0 * CF + x0;
  return (hAll[i] * (1 - fx) + hAll[i + 1] * fx) * (1 - fy) + (hAll[i + CF] * (1 - fx) + hAll[i + CF + 1] * fx) * fy;
}

function field(trains) {
  E2.fill(0); let done = true;
  for (const t of trains) if (t.ft > 0.05) done = addTrain(Math.round(t.ft * 8) / 8, Math.round(t.D / 2) * 2, Math.round(t.T * 4) / 4) && done;
  const hAll = new Float32Array(NF);
  for (let i = 0; i < NF; i++) { const j = NEAREST[i] < 0 ? i : NEAREST[i]; hAll[i] = Math.min(Math.sqrt(E2[i]), 2.56 * Math.max(0, DEPTH[j])); }
  const sound = new Uint32Array(NF);
  for (let r = 0; r < RF; r++) {
    const lat = SOUND_LAT[r], src = Math.min(RF - 1, Math.max(0, Math.floor((WM.top - lat) * 110.95 / RG.cell)));
    for (let c = 0; c < CF; c++) {
      const j = src * CF + c; if (DEPTH[j] <= 0.4) continue;
      const lon = WM.left + (c + 0.5) * RG.cell / 83.95050561668964, a = 255 * (1 - insideFine(lon, lat));
      if (a > 0) sound[r * CF + c] = color(hAll[j], a);
    }
  }
  let fine = null;
  if (FINE) {
    const { w, h, wet } = FINE, lats = rowLats(FINE.top, FINE.bottom, h); fine = new Uint32Array(w * h);
    for (let r = 0; r < h; r++) {
      const lat = lats[r], src = Math.min(h - 1, Math.max(0, Math.floor((FINE.top - lat) * FINE.sy)));
      for (let c = 0; c < w; c++) {
        if (!wet[src * w + c]) continue;
        const lon = FINE.left + (c + 0.5) / FINE.sx, a = 255 * insideFine(lon, lat);
        if (a > 0) fine[r * w + c] = color(hAt(hAll, lon, lat), a);
      }
    }
  }
  return { hAll, sound, fine, done };
}

let latest = 0;
onmessage = async ev => {
  const { id, trains } = ev.data; latest = id;
  try {
    await ready; await fineReady.catch(() => null);
    let f = field(trains);
    // Full-resolution K arriving: redraw with it (only if no newer request came in).
    while (!f.done && waiting.length && id === latest) {
      send(id, f, false);
      await Promise.all(waiting.splice(0));
      if (id !== latest) return;
      f = field(trains);
    }
    if (id === latest) send(id, f, true);
  } catch (e) { postMessage({ id, error: String(e && e.message || e) }); }
};
function send(id, f, final) {
  const list = [f.hAll.buffer, f.sound.buffer];
  if (f.fine) list.push(f.fine.buffer);
  postMessage({
    id, final, hAll: f.hAll,
    grid: { left: WM.left, top: WM.top, sx: 83.95050561668964 / RG.cell, sy: 110.95 / RG.cell, w: CF, h: RF },
    sound: { img: f.sound, w: CF, h: RF, bounds: [WM.left, WM.bottom, WM.right, WM.top] },
    fine: f.fine ? { img: f.fine, w: FINE.w, h: FINE.h, bounds: [FINE.left, FINE.bottom, FINE.right, FINE.top] } : null
  }, list);
}
