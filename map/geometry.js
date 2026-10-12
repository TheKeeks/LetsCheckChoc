/* Geographic helpers shared by the terrain viewer and node tests. */
(function (root) {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function tilePoint(lon, lat, z) {
    const n = 2 ** z, p = clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180;
    return [(lon + 180) / 360 * n, (1 - Math.asinh(Math.tan(p)) / Math.PI) / 2 * n];
  }
  function tileLocation(x, y, z) {
    const n = 2 ** z;
    return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI];
  }
  function sample(m, values, wet, lon, lat) {
    const fx = (lon - m.left) * m.kmlon * 1000 / m.dx - 0.5;
    const fy = (m.top - lat) * m.kmlat * 1000 / m.dx - 0.5;
    if (fx < 0 || fy < 0 || fx > m.cols - 1 || fy > m.rows - 1) return null;
    const x = Math.min(m.cols - 2, Math.floor(fx)), y = Math.min(m.rows - 2, Math.floor(fy));
    const u = fx - x, v = fy - y, p = y * m.cols + x;
    const d = (values[p] * (1 - u) + values[p + 1] * u) * (1 - v) +
      (values[p + m.cols] * (1 - u) + values[p + m.cols + 1] * u) * v;
    return { depth: d, wet: Boolean(wet[Math.round(fy) * m.cols + Math.round(fx)]) };
  }
  function tilesFor(bounds, zoom, limit) {
    let z = zoom, tiles;
    do {
      const a = tilePoint(bounds[0], bounds[3], z), b = tilePoint(bounds[2], bounds[1], z);
      tiles = [];
      for (let y = Math.floor(a[1]); y <= Math.floor(b[1]); y++) {
        for (let x = Math.floor(a[0]); x <= Math.floor(b[0]); x++) tiles.push({ x, y, z });
      }
      if (tiles.length <= limit || z <= 9) return tiles;
      z--;
    } while (true);
  }
  const api = { clamp, tilePoint, tileLocation, sample, tilesFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MapGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);
