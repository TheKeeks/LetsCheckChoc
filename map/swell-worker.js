/* Swell-motion worker for the map page: where a swell train travels, and how fast.
 *
 * For one train (period T, from direction D) it traces wave rays across the
 * Sound with Snell's law: each ray bends toward slower (shallower) water at a
 * rate set by the phase speed's gradient (linear dispersion, Guo 2002). Rays
 * start at the open-water edges facing the swell and stop on the shore. Twice:
 *
 *   coarse  the refraction model's 144 m depth grid across the whole Sound
 *           (research/depth144: Montauk, Block Island, the Race), rays every cell
 *   fine    the 16 m survey grid around Fishers (research/ocean/fine16), averaged
 *           to 32 m and smoothed to about a wavelength, rays every 32 m, each
 *           starting in the direction the coarse rays arrive with
 *
 * Every grid cell gets the mean travel direction of the rays that cross it
 * (unlit cells borrow their nearest lit neighbor's), how many crossed it
 * (bunched rays = focused energy, spread rays = a shadow), and group speed as
 * a share of deep-water speed, so the streaks slow down as they shoal.
 * Packed as bytes: ux, uy (x127), speed (x255, 0 = land) and density (x50).
 */
'use strict';
importScripts('geometry.js');
const M = self.MapGeometry;
const KM = { lon: 83.95050561668964, lat: 110.95 };

async function pngPixels(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + r.status);
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const out = { w: bmp.width, h: bmp.height, px: g.getImageData(0, 0, bmp.width, bmp.height).data };
  bmp.close();
  return out;
}
function blur(a, w, h, passes, mask) {
  let cur = Float32Array.from(a); const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (mask && !mask[i]) { tmp[i] = cur[i]; continue; }
      let s = 0, n = 0;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = i + dx; if (mask && !mask[j]) continue; s += cur[j]; n++; }
      tmp[i] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (mask && !mask[i]) { cur[i] = tmp[i]; continue; }
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; const j = i + dy * w; if (mask && !mask[j]) continue; s += tmp[j]; n++; }
      cur[i] = s / n;
    }
  }
  return cur;
}

// Domains: depth (m, positive down; <= 0 land) on lon/lat rows from (left, top).
const domains = {};
const ready = Promise.all([pngPixels('../research/depth144.png'), pngPixels('../research/ocean/fine16.png'), fetch('../research/ocean/fine16.json').then(r => r.json())])
  .then(([c, f, fm]) => {
    const cd = new Float32Array(c.w * c.h);
    for (let i = 0; i < cd.length; i++) cd[i] = 1000 - ((c.px[i * 4] << 8) | c.px[i * 4 + 1]) / 10;
    domains.coarse = { w: c.w, h: c.h, left: -72.4, top: 41.5, sx: KM.lon / 0.144, sy: KM.lat / 0.144, raw: cd, depth: blur(cd.map(v => Math.max(0, v)), c.w, c.h, 1) };
    // fine16: 16 m depths (positive down), averaged 2x2 to 32 m.
    const w = Math.floor(f.w / 2), h = Math.floor(f.h / 2), fd = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = (2 * y + dy) * f.w + 2 * x + dx; s += ((f.px[i * 4] << 8) | f.px[i * 4 + 1]) / fm.scale - fm.off; }
      fd[y * w + x] = s / 4;
    }
    const sx = KM.lon * 1000 / (fm.dx * 2), sy = KM.lat * 1000 / (fm.dx * 2);
    domains.fine = { w, h, left: fm.left, top: fm.top, sx, sy, raw: fd, depth: blur(fd.map(v => Math.max(0, v)), w, h, 2) };
  });

/** Phase speed and its gradient (per cell) on a domain, for period T. */
function speedGrids(D, T) {
  const { w, h, depth } = D, c = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let i = 0; i < c.length; i++) c[i] = M.phaseSpeed(Math.max(0.3, depth[i]), T);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    gx[i] = (c[y * w + Math.min(w - 1, x + 1)] - c[y * w + Math.max(0, x - 1)]) / 2;
    gy[i] = (c[Math.min(h - 1, y + 1) * w + x] - c[Math.max(0, y - 1) * w + x]) / 2;   // per row, rows run south
  }
  return { c, gx, gy };
}
function bil(a, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0)), i = y0 * w + x0;
  return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + w] * (1 - fx) + a[i + w + 1] * fx) * fy;
}

/**
 * Trace rays across domain D from launch points [[x, y, angle], …] (cell
 * coordinates, x east, y south; angle counter-clockwise from east). Returns the
 * summed unit directions and counts per cell.
 */
function trace(D, S, launches, step, maxSteps) {
  const { w, h, raw } = D, n = w * h, se = new Float32Array(n), sn = new Float32Array(n), cnt = new Float32Array(n);
  const turn = (x, y, a) => {
    const c = bil(S.c, w, h, x, y), cx = bil(S.gx, w, h, x, y), cn = -bil(S.gy, w, h, x, y);
    return (Math.sin(a) * cx - Math.cos(a) * cn) / Math.max(0.1, c);
  };
  for (const [x0, y0, a0] of launches) {
    let x = x0, y = y0, a = a0;
    for (let k = 0; k < maxSteps; k++) {
      const ix = Math.round(x - 0.5), iy = Math.round(y - 0.5);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) break;
      const i = iy * w + ix;
      if (raw[i] < 0.5) break;                                  // reached the shore
      se[i] += Math.cos(a); sn[i] += Math.sin(a); cnt[i]++;
      // midpoint step: x east, y south
      const k1 = turn(x - 0.5, y - 0.5, a), am = a + k1 * step / 2;
      const xm = x + Math.cos(a) * step / 2, ym = y - Math.sin(a) * step / 2;
      const k2 = turn(xm - 0.5, ym - 0.5, am);
      x += Math.cos(am) * step; y -= Math.sin(am) * step; a += k2 * step;
    }
  }
  return { se, sn, cnt };
}
/** Launch points every `gap` cells along the edges a swell traveling in angle a enters through. */
function edgeLaunches(D, angleAt, gap) {
  const { w, h, raw } = D, out = [], e = 1e-3;
  const add = (x, y, nx, ny) => {
    const ix = Math.min(w - 1, Math.max(0, Math.floor(x))), iy = Math.min(h - 1, Math.max(0, Math.floor(y)));
    if (raw[iy * w + ix] < 0.5) return;
    const a = angleAt(x, y); if (a == null) return;
    if (Math.cos(a) * nx + Math.sin(a) * ny > 0.05) out.push([x, y, a]);
  };
  for (let x = gap / 2; x < w; x += gap) { add(x, e, 0, -1); add(x, h - e, 0, 1); }   // north edge faces south (−north), south edge north
  for (let y = gap / 2; y < h; y += gap) { add(e, y, 1, 0); add(w - e, y, -1, 0); }
  return out;
}
/** Per-cell direction, speed share and density, packed as bytes. */
function pack(D, T, rays, fallback) {
  const { w, h, raw, depth } = D, n = w * h;
  let ue = new Float32Array(n), un = new Float32Array(n), dens = new Float32Array(n);
  const water = new Uint8Array(n), lit = new Uint8Array(n);
  const counts = [];
  for (let i = 0; i < n; i++) {
    water[i] = raw[i] >= 0.5 ? 1 : 0;
    if (water[i] && rays.cnt[i] > 0) { const l = Math.hypot(rays.se[i], rays.sn[i]) || 1; ue[i] = rays.se[i] / l; un[i] = rays.sn[i] / l; lit[i] = 1; counts.push(rays.cnt[i]); }
  }
  counts.sort((a, b) => a - b);
  const median = counts.length ? counts[counts.length >> 1] : 1;
  for (let i = 0; i < n; i++) dens[i] = lit[i] ? rays.cnt[i] / median : 0;
  // Unlit water: the caller's fallback (fine grid: what the coarse rays say there), else the nearest lit cell.
  const q = new Int32Array(n); let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) {
    if (!water[i] || lit[i]) { if (lit[i]) q[qt++] = i; continue; }
    if (fallback) { const f = fallback(i % w, (i / w) | 0); if (f) { ue[i] = f[0]; un[i] = f[1]; dens[i] = f[2] * 0.5; lit[i] = 2; q[qt++] = i; } }
  }
  while (qh < qt) {
    const i = q[qh++], x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= n || !water[j] || lit[j]) continue;
      ue[j] = ue[i]; un[j] = un[i]; lit[j] = 3; q[qt++] = j;
    }
  }
  ue = blur(ue, w, h, 1, water); un = blur(un, w, h, 1, water); dens = blur(dens, w, h, 1, water);
  const out = { w, h, left: D.left, top: D.top, sx: D.sx, sy: D.sy, ux: new Int8Array(n), uy: new Int8Array(n), sp: new Uint8Array(n), dn: new Uint8Array(n) };
  const cg0 = M.deepGroupSpeed(T);
  for (let i = 0; i < n; i++) {
    if (!water[i]) continue;
    const l = Math.hypot(ue[i], un[i]) || 1;
    out.ux[i] = Math.round(ue[i] / l * 127); out.uy[i] = Math.round(un[i] / l * 127);
    out.sp[i] = Math.max(1, Math.min(255, Math.round(M.groupSpeed(Math.max(0.3, depth[i]), T) / cg0 * 255)));
    out.dn[i] = Math.min(255, Math.round(dens[i] * 50));
  }
  return out;
}

function field(T, from) {
  const C = domains.coarse, F = domains.fine;
  const v = M.travelVector(from), a0 = Math.atan2(v[1], v[0]);
  const SC = speedGrids(C, T);
  const coarse = pack(C, T, trace(C, SC, edgeLaunches(C, () => a0, 1), 0.5, 4000));
  // Fine rays start the way the coarse rays arrive at the fine grid's edge.
  const coarseAt = (lon, lat) => {
    const x = (lon - C.left) * C.sx - 0.5, y = (C.top - lat) * C.sy - 0.5;
    if (x < 0 || y < 0 || x > C.w - 1 || y > C.h - 1) return null;
    const i = Math.round(y) * C.w + Math.round(x); if (!coarse.sp[i]) return null;
    const ux = bil(coarse.ux, C.w, C.h, x, y), uy = bil(coarse.uy, C.w, C.h, x, y), l = Math.hypot(ux, uy);
    return l > 20 ? [ux / l, uy / l, coarse.dn[i] / 50] : null;
  };
  const lonF = x => F.left + x / F.sx, latF = y => F.top - y / F.sy;
  const SF = speedGrids(F, T);
  const launches = edgeLaunches(F, (x, y) => { const c = coarseAt(lonF(x), latF(y)); return c && c[2] > 0.05 ? Math.atan2(c[1], c[0]) : null; }, 1);
  const fine = pack(F, T, trace(F, SF, launches, 0.5, 5000), (x, y) => coarseAt(lonF(x + 0.5), latF(y + 0.5)));
  return { T, from, coarse, fine };
}

onmessage = async ev => {
  const { id, T, from } = ev.data;
  try {
    await ready;
    const f = field(T, from), list = [];
    for (const g of [f.coarse, f.fine]) list.push(g.ux.buffer, g.uy.buffer, g.sp.buffer, g.dn.buffer);
    postMessage({ id, field: f }, list);
  } catch (e) { postMessage({ id, error: String(e && e.message || e) }); }
};
