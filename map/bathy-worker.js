/* Sea-floor tile worker for the map page.
 *
 * The map asks for two kinds of 256/512 px Web Mercator tiles through the
 * lccbathy:// protocol: "dem" tiles that raise the 3D terrain, and "color"
 * tiles that paint it (depth colors with relief shading, contours and the
 * shoreline). Both are drawn here, off the main thread, from the Fishers
 * Island viewer's elevation, finest first:
 *
 *   0.8 m  NOAA 2023 topobathy lidar + multibeam detail chunks (LetsCheckChoc-data/detail,
 *          loaded only for tiles that need them, 16 kept at a time)
 *   4 m    the viewer's overview grid of the island and its water (LetsCheckChoc-data)
 *   16 m   the Sound Check survey grid around it (research/ocean/fine16)
 *   144 m  the refraction model's depth grid across the whole Sound
 *          (research/depth144), faded flat at its outer edge
 *
 * Heights are NAVD88 meters. Zoomed out, each pixel averages the cells under
 * it (a mip pyramid) instead of picking one, so relief never sparkles.
 */
'use strict';
importScripts('geometry.js');
const M = self.MapGeometry;
const ND = -32768;                  // int16 "no data"
const LAND_EX = 1.25;               // land is always drawn at 1.25x, like the viewer
const DETAIL_KEEP = 16;
const DETAIL_MAX_PX = 2.6;          // Mercator m per pixel below which detail chunks are used

// ── Loading
const gunzip = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + r.status);
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
};
/** int16 centimeters stored as differences along each row → int16 centimeters. */
async function loadCm(url, width) {
  const v = new Int16Array(await gunzip(url));
  for (let row = 0; row < v.length; row += width) {
    let cm = 0;
    for (let k = row; k < row + width; k++) { cm = (cm + v[k]) << 16 >> 16; v[k] = cm; }
  }
  return v;
}
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

// Coarse grids are plain Float32 meters (NaN = no data) on lon/lat rows.
const COARSE = { left: -72.4, top: 41.5, right: -70.85, bottom: 40.6, kmlon: 83.95050561668964, kmlat: 110.95, cellKm: 0.144 };
let fine = null, coarse = null, ov = null, detail = null;
const ready = {};

// The grids (about 120 MB) live in their own repo, TheKeeks/LetsCheckChoc-data, which GitHub Pages serves next to
// the site (thekeeks.github.io/LetsCheckChoc-data/), so they stay out of this repo's history.
const DATA = '/LetsCheckChoc-data/';
ready.meta = fetch(DATA + 'meta.json').then(r => r.json()).then(async meta => {
  const d = await fetch(DATA + 'detail.json').then(r => r.json());
  const [x0, y0, x1, y1] = meta.mercator;
  ov = { meta, w: meta.width, h: meta.height, mx0: x0, my0: y0, mx1: x1, my1: y1, cell: (x1 - x0) / (meta.width - 1), levels: null };
  const du = d.chunks[0].u1 - d.chunks[0].u0, df = d.chunks[0].f1 - d.chunks[0].f0;
  const grid = new Map(d.chunks.map(c => [c.i + ',' + c.j, c]));
  detail = { du, df, grid, lru: [], cols: Math.max(...d.chunks.map(c => c.i)) + 1, rows: Math.max(...d.chunks.map(c => c.j)) + 1 };
  return meta;
});
ready.coarse = Promise.all([pngPixels('../research/ocean/fine16.png'), fetch('../research/ocean/fine16.json').then(r => r.json()), pngPixels('../research/depth144.png')])
  .then(([f, fm, c]) => {
    const fh = new Float32Array(f.w * f.h);
    for (let i = 0; i < fh.length; i++) fh[i] = -(((f.px[i * 4] << 8) | f.px[i * 4 + 1]) / fm.scale - fm.off);   // the grid stores depth
    fine = { w: f.w, h: f.h, left: fm.left, top: fm.top, sx: fm.kmlon * 1000 / fm.dx, sy: fm.kmlat * 1000 / fm.dx, levels: pyramidF(fh, f.w, f.h) };
    const ch = new Float32Array(c.w * c.h);
    for (let i = 0; i < ch.length; i++) ch[i] = ((c.px[i * 4] << 8) | c.px[i * 4 + 1]) / 10 - 1000;
    coarse = { w: c.w, h: c.h, left: COARSE.left, top: COARSE.top, sx: COARSE.kmlon / COARSE.cellKm, sy: COARSE.kmlat / COARSE.cellKm, levels: pyramidF(ch, c.w, c.h) };
  });
ready.overview = ready.meta.then(() => loadCm(DATA + 'topobathy.i16.gz', ov.w)).then(v => { ov.levels = pyramidI(v, ov.w, ov.h); });
ready.source = ready.meta.then(() => gunzip(DATA + 'source.u8.gz')).then(b => { ov.source = new Uint8Array(b); });

// ── Mip pyramids: each level averages 2x2 cells of the one below, skipping no-data.
function pyramidI(v, w, h) {
  const out = [{ d: v, w, h, f: 1 }];
  while (w > 256) {
    const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2), d = new Int16Array(nw * nh);
    for (let r = 0; r < nh; r++) for (let c = 0; c < nw; c++) {
      let s = 0, n = 0;
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
        const rr = Math.min(h - 1, 2 * r + dr), cc = Math.min(w - 1, 2 * c + dc), x = v[rr * w + cc];
        if (x !== ND) { s += x; n++; }
      }
      d[r * nw + c] = n ? Math.round(s / n) : ND;
    }
    out.push({ d, w: nw, h: nh, f: out[out.length - 1].f * 2 }); v = d; w = nw; h = nh;
  }
  return out;
}
function pyramidF(v, w, h) {
  const out = [{ d: v, w, h, f: 1 }];
  while (w > 128) {
    const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2), d = new Float32Array(nw * nh);
    for (let r = 0; r < nh; r++) for (let c = 0; c < nw; c++) {
      let s = 0, n = 0;
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
        const x = v[Math.min(h - 1, 2 * r + dr) * w + Math.min(w - 1, 2 * c + dc)];
        if (x === x) { s += x; n++; }
      }
      d[r * nw + c] = n ? s / n : NaN;
    }
    out.push({ d, w: nw, h: nh, f: out[out.length - 1].f * 2 }); v = d; w = nw; h = nh;
  }
  return out;
}
const pickLevel = (levels, ratio) => levels[Math.max(0, Math.min(levels.length - 1, Math.floor(Math.log2(Math.max(1, ratio)))))];

// ── Bilinear sampling with no-data. (gx, gy) are cell-center coordinates.
function bilI(d, w, h, gx, gy) {
  if (!(gx >= -0.5 && gy >= -0.5 && gx <= w - 0.5 && gy <= h - 0.5)) return NaN;
  let x = Math.floor(gx), y = Math.floor(gy), fx = gx - x, fy = gy - y;
  if (x < 0) { x = 0; fx = 0; } else if (x > w - 2) { x = w - 2; fx = 1; }
  if (y < 0) { y = 0; fy = 0; } else if (y > h - 2) { y = h - 2; fy = 1; }
  const i = y * w + x, a = d[i], b = d[i + 1], c = d[i + w], e = d[i + w + 1];
  if (a !== ND && b !== ND && c !== ND && e !== ND) return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy) * 0.01;
  let s = 0, n = 0;
  if (a !== ND) { const k = (1 - fx) * (1 - fy); s += a * k; n += k; }
  if (b !== ND) { const k = fx * (1 - fy); s += b * k; n += k; }
  if (c !== ND) { const k = (1 - fx) * fy; s += c * k; n += k; }
  if (e !== ND) { const k = fx * fy; s += e * k; n += k; }
  return n > 0.3 ? s / n * 0.01 : NaN;
}
function bilF(d, w, h, gx, gy) {
  if (!(gx >= -0.5 && gy >= -0.5 && gx <= w - 0.5 && gy <= h - 0.5)) return NaN;
  let x = Math.floor(gx), y = Math.floor(gy), fx = gx - x, fy = gy - y;
  if (x < 0) { x = 0; fx = 0; } else if (x > w - 2) { x = w - 2; fx = 1; }
  if (y < 0) { y = 0; fy = 0; } else if (y > h - 2) { y = h - 2; fy = 1; }
  const i = y * w + x, a = d[i], b = d[i + 1], c = d[i + w], e = d[i + w + 1];
  if (a === a && b === b && c === c && e === e) return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  let s = 0, n = 0;
  if (a === a) { const k = (1 - fx) * (1 - fy); s += a * k; n += k; }
  if (b === b) { const k = fx * (1 - fy); s += b * k; n += k; }
  if (c === c) { const k = (1 - fx) * fy; s += c * k; n += k; }
  if (e === e) { const k = fx * fy; s += e * k; n += k; }
  return n > 0.3 ? s / n : NaN;
}
/** A lon/lat grid (fine16, depth144) at a point, from the level that matches pixel size p (Mercator m). */
function sampleLonLat(G, lon, lat, cellMerc, p) {
  const L = pickLevel(G.levels, p / cellMerc), gx0 = (lon - G.left) * G.sx - 0.5, gy0 = (G.top - lat) * G.sy - 0.5;
  return bilF(L.d, L.w, L.h, (gx0 - (L.f - 1) / 2) / L.f, (gy0 - (L.f - 1) / 2) / L.f);
}

// ── Detail chunks
function chunkAt(u, f) {
  if (!detail || u < 0 || f < 0 || u > 1 || f > 1) return null;
  const i = Math.min(detail.cols - 1, Math.floor(u / detail.du)), j = Math.min(detail.rows - 1, Math.floor(f / detail.df));
  return detail.grid.get(i + ',' + j) || null;
}
function loadChunk(c) {
  if (!c.load) {
    c.load = loadCm(DATA + c.file, c.width).then(v => {
      c.v = v; c.iw = c.width - 2 * c.pad; c.ih = c.height - 2 * c.pad;
      detail.lru.push(c); trimDetail();
    }).catch(e => { c.load = null; throw e; });
  }
  return c.load;
}
const pinned = new Map();           // chunk → tiles drawing from it right now
const pin = c => pinned.set(c, (pinned.get(c) || 0) + 1);
const unpin = c => { const k = (pinned.get(c) || 1) - 1; if (k) pinned.set(c, k); else pinned.delete(c); };
function trimDetail() {
  const l = detail.lru;
  for (let k = 0; l.length > DETAIL_KEEP && k < l.length;) {
    const c = l[k];
    if (pinned.has(c)) { k++; continue; }
    l.splice(k, 1); c.v = null; c.load = null;
  }
}
function touchChunk(c) { const l = detail.lru, k = l.indexOf(c); if (k >= 0) { l.splice(k, 1); l.push(c); } }
function sampleChunk(c, u, f) {
  const x = c.pad - 0.5 + (u - c.u0) / (c.u1 - c.u0) * c.iw, y = c.pad - 0.5 + (f - c.f0) / (c.f1 - c.f0) * c.ih;
  return bilI(c.v, c.width, c.height, x, y);
}

// ── Elevation at a Mercator point for pixel size p (Mercator m), NaN where nothing is known
const smooth = M.smoothstep;
function elevation(mx, my, lon, lat, p) {
  let e = NaN, w = 0;
  if (ov && ov.levels && mx >= ov.mx0 && mx <= ov.mx1 && my >= ov.my0 && my <= ov.my1) {
    const u = (mx - ov.mx0) / (ov.mx1 - ov.mx0), f = (ov.my1 - my) / (ov.my1 - ov.my0);
    if (p <= DETAIL_MAX_PX) {
      const c = chunkAt(u, f);
      if (c && c.v) {
        if (p > 1.4) {   // about two detail cells per pixel: average four taps
          const du = p * 0.25 / (ov.mx1 - ov.mx0), df = p * 0.25 / (ov.my1 - ov.my0);
          e = (sampleChunk(c, u - du, f - df) + sampleChunk(c, u + du, f - df) + sampleChunk(c, u - du, f + df) + sampleChunk(c, u + du, f + df)) / 4;
          if (e !== e) e = sampleChunk(c, u, f);
        } else e = sampleChunk(c, u, f);
      }
    }
    if (e !== e) {
      const L = pickLevel(ov.levels, p / ov.cell), gx0 = u * (ov.w - 1), gy0 = f * (ov.h - 1);
      e = bilI(L.d, L.w, L.h, (gx0 - (L.f - 1) / 2) / L.f, (gy0 - (L.f - 1) / 2) / L.f);
    }
    // Ease into the coarser grids over the last 400 m inside the survey's edge.
    w = smooth(0, 400, Math.min(mx - ov.mx0, ov.mx1 - mx, my - ov.my0, ov.my1 - my));
    if (e === e && w >= 1) return e;
  }
  let g = NaN;
  if (fine) {
    g = sampleLonLat(fine, lon, lat, 21.3, p);
    if (g === g) {
      const gx = (lon - fine.left) * fine.sx, gy = (fine.top - lat) * fine.sy;
      const wf = smooth(0, 60, Math.min(gx, fine.w - gx, gy, fine.h - gy));     // 60 cells ≈ 1 km
      if (wf < 1) { const c = coarseAt(lon, lat, p); if (c === c) g = g * wf + c * (1 - wf); }
    }
  }
  if (g !== g) g = coarseAt(lon, lat, p);
  if (e !== e) return g;
  return g === g ? e * w + g * (1 - w) : e;
}
function coarseAt(lon, lat, p) {
  if (!coarse) return NaN;
  const c = sampleLonLat(coarse, lon, lat, 191, p);
  if (c !== c) return NaN;
  // Flatten the outer 6 km of the Sound grid so its edge isn't a cliff.
  const km = Math.min((lon - COARSE.left) * COARSE.kmlon, (COARSE.right - lon) * COARSE.kmlon, (lat - COARSE.bottom) * COARSE.kmlat, (COARSE.top - lat) * COARSE.kmlat);
  return c * smooth(0, 6, km);
}

/** Elevations for an n x n tile plus a `pad` pixel border (pixel centers). */
function elevGrid(z, x, y, n, pad) {
  const [w0, , , n0] = M.tileMercator(z, x, y), p = (2 * M.HALF / 2 ** z) / n, m = n + 2 * pad;
  const out = new Float32Array(m * m), lat = new Float64Array(m), lon = new Float64Array(m);
  for (let c = 0; c < m; c++) lon[c] = M.lonOf(w0 + (c - pad + 0.5) * p);
  for (let r = 0; r < m; r++) {
    const my = n0 - (r - pad + 0.5) * p, la = M.latOf(my); lat[r] = la;
    for (let c = 0; c < m; c++) {
      const mx = w0 + (c - pad + 0.5) * p;
      out[r * m + c] = elevation(mx, my, lon[c], la, p);
    }
  }
  return { e: out, m, p, lat, lon };
}
/** Data a tile needs before it can be drawn: coarse grids, the overview if it overlaps, and its detail chunks. */
async function prepare(z, x, y, n) {
  await ready.coarse; await ready.meta;
  const [w0, s0, e0, n0] = M.tileMercator(z, x, y);
  if (e0 < ov.mx0 || w0 > ov.mx1 || n0 < ov.my0 || s0 > ov.my1) return [];
  await ready.overview;
  if ((e0 - w0) / n > DETAIL_MAX_PX) return [];
  // One pixel of margin each side: the shading reads its neighbors.
  const pad = (e0 - w0) / n, u0 = (w0 - pad - ov.mx0) / (ov.mx1 - ov.mx0), u1 = (e0 + pad - ov.mx0) / (ov.mx1 - ov.mx0);
  const f0 = (ov.my1 - n0 - pad) / (ov.my1 - ov.my0), f1 = (ov.my1 - s0 + pad) / (ov.my1 - ov.my0);
  const span = (a, b, d, count) => [Math.max(0, Math.floor(Math.max(0, a) / d)), Math.min(count - 1, Math.floor(Math.min(1, b) / d))];
  const [i0, i1] = span(u0, u1, detail.du, detail.cols), [j0, j1] = span(f0, f1, detail.df, detail.rows), list = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = detail.grid.get(i + ',' + j); if (c) list.push(c); }
  list.forEach(pin);
  await Promise.all(list.map(c => loadChunk(c).catch(() => null)));
  list.forEach(touchChunk);
  return list;
}

// ── Painting
const TABLES = { depth: M.rampTable(M.NAUTICAL_DEPTH), land: M.rampTable(M.NAUTICAL_LAND), spectral: M.rampTable(M.SPECTRAL) };
const DEEP = 110, HIGH = 45;
function paint(g, n, o) {
  const { e, m, p, lat, lon } = g, out = new Uint8ClampedArray(n * n * 4);
  const ex = o.ex, hill = o.hill, az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
  const Lx = Math.sin(az) * Math.cos(alt), Ly = Math.sin(alt), Lz = -Math.cos(az) * Math.cos(alt);
  const sc = h => (h >= 0 ? h * LAND_EX : h * ex);
  const spectral = o.mode === 'spectral', photoLand = o.land === 'photo';
  for (let r = 0; r < n; r++) {
    const pg = p * Math.cos(lat[r + 1] * Math.PI / 180);       // ground meters per pixel on this row
    for (let c = 0; c < n; c++) {
      const i = (r + 1) * m + c + 1, h = e[i], q = (r * n + c) * 4;
      if (h !== h) continue;
      let hw = e[i - 1], he = e[i + 1], hn = e[i - m], hs = e[i + m];
      if (hw !== hw) hw = h; if (he !== he) he = h; if (hn !== hn) hn = h; if (hs !== hs) hs = h;
      // Shading brings out relief a little more than the geometry shows (x2.5, as in the viewer).
      const nx = -(sc(he) - sc(hw)) / (2 * pg) * 2.5, nz = -(sc(hs) - sc(hn)) / (2 * pg) * 2.5, len = Math.hypot(nx, 1, nz);
      const relief = Math.min(1.8, Math.max(0.15, Math.max(0, (nx * Lx + Ly + nz * Lz) / len) / Ly));
      const shade = 1 + (relief - 1) * hill;
      let k, T;
      if (spectral) { T = TABLES.spectral; k = Math.round(Math.min(1, Math.max(0, (h + DEEP) / (HIGH + DEEP))) * 255); }
      else if (h < 0) { T = TABLES.depth; k = Math.round(Math.sqrt(Math.min(1, -h / DEEP)) * 255); }
      else { T = TABLES.land; k = Math.round(Math.min(1, h / HIGH) * 255); }
      let R = T[k * 3] * shade, Gc = T[k * 3 + 1] * shade, B = T[k * 3 + 2] * shade, A = 255;
      if (o.contours) {
        // A line wherever a 5 m step falls between this pixel and its east/south neighbor;
        // every fifth darker. Skipped where lines would crowd closer than ~2 px.
        const slope = Math.max(Math.abs(he - hw), Math.abs(hs - hn)) / 2;
        if (slope < 2.5) {
          const a = Math.floor(h / 5), major = Math.floor(h / 25) !== Math.floor(he / 25) || Math.floor(h / 25) !== Math.floor(hs / 25);
          if (a !== Math.floor(he / 5) || a !== Math.floor(hs / 5)) { const d = major ? 0.9 : 0.6; R *= 1 - 0.55 * d; Gc *= 1 - 0.55 * d; B *= 1 - 0.55 * d; }
        }
      }
      if (photoLand) {
        // Imagery shows through on land (lidar ground above 0.4 m); a soft edge at the waterline.
        A = Math.round(255 * (1 - smooth(0.15, 0.55, h)));
        if (!A) continue;
      } else if ((h < 0) !== (he < 0) || (h < 0) !== (hs < 0)) {
        R += (245 - R) * 0.6; Gc += (237 - Gc) * 0.6; B += (209 - B) * 0.6;   // the 0 m shoreline, pale
      }
      // The Sound grid's outer 6 km fades out (its terrain flattens there), so the ocean basemap shows through instead of a false shoal.
      const km = Math.min((lon[c + 1] - COARSE.left) * COARSE.kmlon, (COARSE.right - lon[c + 1]) * COARSE.kmlon, (lat[r + 1] - COARSE.bottom) * COARSE.kmlat, (COARSE.top - lat[r + 1]) * COARSE.kmlat);
      if (km < 6) { A = Math.round(A * smooth(0, 6, km)); if (!A) continue; }
      out[q] = R; out[q + 1] = Gc; out[q + 2] = B; out[q + 3] = A;
    }
  }
  return out;
}
function encodeDem(g, n, landScale) {
  const out = new Uint8ClampedArray(n * n * 4), { e } = g;
  for (let i = 0; i < n * n; i++) { let h = e[i]; if (h !== h) h = 0; else if (h > 0) h *= landScale; M.encodeHeight(h, out, i * 4); }
  return out;
}

async function toBitmap(px, n, raw) {
  const data = new ImageData(px, n, n);
  try { return await createImageBitmap(data, { premultiplyAlpha: raw ? 'none' : 'default', colorSpaceConversion: 'none' }); }
  catch (e) {
    const c = new OffscreenCanvas(n, n); c.getContext('2d').putImageData(data, 0, 0);
    return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
  }
}

// ── Messages
const cancelled = new Set();
async function tile(msg) {
  const { id, kind, z, x, y } = msg, o = msg.o || {}, n = kind === 'dem' ? 256 : (o.size || 256);
  let chunks = [];
  try {
    chunks = await prepare(z, x, y, n);
    if (cancelled.delete(id)) return;
    const g = elevGrid(z, x, y, n, kind === 'dem' ? 0 : 1);
    const px = kind === 'dem' ? encodeDem(g, n, LAND_EX / (o.ex || 3)) : paint(g, n, { ex: o.ex || 3, hill: o.hill == null ? 0.85 : o.hill, mode: o.mode, land: o.land, contours: !!o.contours });
    const bmp = await toBitmap(px, n, kind === 'dem');
    if (cancelled.delete(id)) { if (bmp.close) bmp.close(); return; }
    postMessage({ id, data: bmp }, [bmp]);
  } catch (e) {
    postMessage({ id, error: String(e && e.message || e) });
  } finally {
    chunks.forEach(unpin); if (detail) trimDetail();
  }
}
async function sample(msg) {
  const { id, lon, lat } = msg;
  try {
    await ready.coarse; await ready.meta;
    const mx = M.mercX(lon), my = M.mercY(lat);
    let source = null, h = NaN;
    if (mx >= ov.mx0 && mx <= ov.mx1 && my >= ov.my0 && my <= ov.my1) {
      await ready.overview;
      const u = (mx - ov.mx0) / (ov.mx1 - ov.mx0), f = (ov.my1 - my) / (ov.my1 - ov.my0), c = chunkAt(u, f);
      if (c && c.v) { h = sampleChunk(c, u, f); source = 'detail'; }
      if (!(h === h)) { h = bilI(ov.levels[0].d, ov.w, ov.h, u * (ov.w - 1), f * (ov.h - 1)); source = 'overview'; }
      if (ov.source) { const b = ov.source[Math.round(f * (ov.h - 1)) * ov.w + Math.round(u * (ov.w - 1))] & 127; source = { 1: 'NOAA CUDEM', 2: 'USGS 3DEP lidar', 3: 'NOAA multibeam survey', 4: 'NOAA 2023 topobathy lidar' }[b] || source; }
    }
    if (!(h === h)) { h = sampleLonLat(fine, lon, lat, 21.3, 1); source = 'NOAA survey grid, 16 m'; }
    if (!(h === h)) { h = coarseAt(lon, lat, 1); source = 'Sound depth grid, 144 m'; }
    postMessage({ id, h: h === h ? h : null, source: h === h ? source : null });
  } catch (e) { postMessage({ id, h: null, error: String(e) }); }
}
onmessage = ev => {
  const msg = ev.data;
  if (msg.type === 'tile') tile(msg);
  else if (msg.type === 'abort') cancelled.add(msg.id);
  else if (msg.type === 'sample') sample(msg);
  else if (msg.type === 'status') Promise.allSettled([ready.coarse, ready.overview]).then(r => postMessage({ id: msg.id, coarse: r[0].status, overview: r[1].status }));
};
ready.coarse.catch(e => postMessage({ type: 'error', where: 'coarse', error: String(e) }));
ready.overview.catch(e => postMessage({ type: 'error', where: 'overview', error: String(e) }));
