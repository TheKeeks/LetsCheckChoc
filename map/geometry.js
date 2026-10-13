/* Map maths shared by the map page, its two workers and the node tests.
 * Pure functions only: Web Mercator and tile coordinates, linear wave
 * dispersion, the elevation encoding the terrain reads, and the color scales
 * the Sound Check page uses (so a height means the same color everywhere). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const HALF = 20037508.342789244;          // half the Web Mercator world, m
  const G = 9.81;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ── Web Mercator
  const mercX = lon => lon * HALF / 180;
  const mercY = lat => Math.log(Math.tan((90 + clamp(lat, -85.05112878, 85.05112878)) * Math.PI / 360)) * HALF / Math.PI;
  const lonOf = mx => mx * 180 / HALF;
  const latOf = my => Math.atan(Math.exp(my / HALF * Math.PI)) * 360 / Math.PI - 90;
  /** [west, south, east, north] of tile z/x/y in Mercator meters. */
  function tileMercator(z, x, y) {
    const s = 2 * HALF / 2 ** z;
    return [-HALF + x * s, HALF - (y + 1) * s, -HALF + (x + 1) * s, HALF - y * s];
  }
  /** Fractional tile coordinates of a point. */
  function tilePoint(lon, lat, z) {
    const n = 2 ** z;
    return [(mercX(lon) + HALF) / (2 * HALF) * n, (HALF - mercY(lat)) / (2 * HALF) * n];
  }
  function tileLocation(x, y, z) {
    const n = 2 ** z, s = 2 * HALF / n;
    return [lonOf(-HALF + x * s), latOf(HALF - y * s)];
  }
  /** Mercator meters per CSS pixel at a MapLibre zoom (512 px world at zoom 0). */
  const metersPerPixel = zoom => 2 * HALF / (512 * 2 ** zoom);

  // ── Linear wave theory. kh from depth h (m) and period T (s) by Guo (2002),
  // within about 1% of the exact dispersion relation at every depth.
  function kh(h, T) { const w = 2 * Math.PI / T, y = w * w / G * h; return y > 20 ? y : y * Math.pow(1 - Math.exp(-Math.pow(y, 1.25)), -0.4); }
  const waveNumber = (h, T) => (h > 0 ? kh(h, T) / h : Infinity);
  function phaseSpeed(h, T) {
    if (!(h > 0)) return 0;
    const x = kh(h, T);
    return (2 * Math.PI / T) / (x / h);
  }
  function groupSpeed(h, T) {
    if (!(h > 0)) return 0;
    const x = kh(h, T), c = (2 * Math.PI / T) / (x / h);
    return x > 20 ? c / 2 : c / 2 * (1 + 2 * x / Math.sinh(2 * x));
  }
  const deepGroupSpeed = T => G * T / (4 * Math.PI);

  // Compass "from" direction (degrees clockwise from north) to the travel
  // direction as a unit vector [east, north].
  function travelVector(fromDeg) {
    const t = (fromDeg + 180) * Math.PI / 180;
    return [Math.sin(t), Math.cos(t)];
  }

  // ── Elevation encoding read by the terrain (MapLibre "mapbox" encoding):
  // height = -10000 + (R * 65536 + G * 256 + B) * 0.1
  function encodeHeight(h, out, i) {
    const v = clamp(Math.round((h + 10000) * 10), 0, 16777215);
    out[i] = v >> 16; out[i + 1] = (v >> 8) & 255; out[i + 2] = v & 255; out[i + 3] = 255;
  }
  const decodeHeight = (r, g, b) => -10000 + (r * 65536 + g * 256 + b) * 0.1;

  // ── Color scales
  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  /** A 256-entry RGB lookup table from [[t, '#rrggbb'], …] stops. */
  function rampTable(stops) {
    const out = new Uint8Array(256 * 3), s = stops.map(([t, c]) => [t, hex(c)]);
    for (let i = 0; i < 256; i++) {
      const t = i / 255; let k = 1;
      while (k < s.length - 1 && s[k][0] < t) k++;
      const [t0, a] = s[k - 1], [t1, b] = s[k], f = t1 === t0 ? 0 : clamp((t - t0) / (t1 - t0), 0, 1);
      for (let j = 0; j < 3; j++) out[i * 3 + j] = Math.round(a[j] + (b[j] - a[j]) * f);
    }
    return out;
  }
  // The Fishers Island viewer's palettes: blue depths on a square-root stretch,
  // tan-to-green land; or one spectral ramp from deepest to highest.
  const NAUTICAL_DEPTH = [[0, '#c4eef5'], [0.12, '#86d0e6'], [0.28, '#48a6d3'], [0.48, '#2a74b7'], [0.72, '#1a4790'], [1, '#0b1a4c']];
  const NAUTICAL_LAND = [[0, '#d9c78f'], [0.08, '#a8bf72'], [0.3, '#6c9f55'], [0.55, '#9e9a5a'], [0.78, '#b08a5c'], [1, '#efe8dc']];
  const SPECTRAL = [[0, '#26338f'], [0.16, '#1f6fc4'], [0.34, '#2fbfd6'], [0.5, '#a5e3a0'], [0.64, '#f3e75a'], [0.8, '#f39a2e'], [1, '#d42a3a']];
  // Wave-height colors (ft), identical to the Sound Check maps.
  const HST = [[0, [16, 42, 74]], [1, [30, 100, 160]], [2, [40, 170, 165]], [3.5, [120, 200, 100]], [5, [240, 210, 100]],
    [8, [240, 138, 75]], [13, [224, 71, 90]], [20, [176, 79, 201]], [28, [214, 128, 214]]];
  function hCol(ft) {
    let k = 0; while (k < HST.length - 2 && ft > HST[k + 1][0]) k++;
    const [a, ca] = HST[k], [b, cb] = HST[k + 1], f = clamp((ft - a) / (b - a), 0, 1);
    return ca.map((v, j) => Math.round(v + (cb[j] - v) * f));
  }
  // Swell period colors: short period cool, long period warm (Sound Check).
  const PER = [[79, 182, 201], [216, 209, 122], [240, 138, 75]];
  function perRGB(p) {
    const t = clamp((p - 5) / 11, 0, 1) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
    return PER[i].map((v, k) => Math.round(v + (PER[i + 1][k] - v) * f));
  }
  const compass = d => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

  return { HALF, G, clamp, smoothstep, mercX, mercY, lonOf, latOf, tileMercator, tilePoint, tileLocation, metersPerPixel,
    waveNumber, kh, phaseSpeed, groupSpeed, deepGroupSpeed, travelVector, encodeHeight, decodeHeight,
    rampTable, NAUTICAL_DEPTH, NAUTICAL_LAND, SPECTRAL, hCol, perRGB, compass };
});
