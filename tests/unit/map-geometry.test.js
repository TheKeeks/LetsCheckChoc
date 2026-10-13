'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../map/geometry.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

test('map Mercator: Choc round-trips, and adjacent tiles share exact edges', () => {
  near(G.lonOf(G.mercX(-71.96339)), -71.96339, 1e-10);
  near(G.latOf(G.mercY(41.27557)), 41.27557, 1e-10);
  for (const z of [9, 15, 18]) {
    const [x, y] = G.tilePoint(-71.96339, 41.27557, z).map(Math.floor);
    const a = G.tileMercator(z, x, y), right = G.tileMercator(z, x + 1, y), below = G.tileMercator(z, x, y + 1);
    assert.equal(a[2], right[0]); assert.equal(a[1], below[3]);
    const [lon, lat] = G.tileLocation(x, y, z);
    near(G.mercX(lon), a[0], 1e-6); near(G.mercY(lat), a[3], 1e-6);
  }
  // 512 CSS px span the world at zoom 0 in MapLibre
  near(G.metersPerPixel(0) * 512, 2 * G.HALF, 1e-6);
});

test('map dispersion: deep and shallow limits, and swell slows as it shoals', () => {
  const T = 12;
  near(G.phaseSpeed(4000, T), G.G * T / (2 * Math.PI), 1e-3, 'deep water phase speed');
  near(G.groupSpeed(4000, T), G.deepGroupSpeed(T), 1e-3, 'deep water group speed');
  near(G.phaseSpeed(0.5, T), Math.sqrt(G.G * 0.5), 0.01 * Math.sqrt(G.G * 0.5), 'shallow water phase speed');
  near(G.groupSpeed(0.5, T), Math.sqrt(G.G * 0.5), 0.02 * Math.sqrt(G.G * 0.5), 'shallow water group speed');
  // Against the exact relation at an intermediate depth (Guo 2002 is within about 1%).
  const h = 10, w = 2 * Math.PI / T;
  let k = w * w / G.G;                                     // exact k by Newton on w² = g k tanh(kh)
  for (let i = 0; i < 50; i++) { const t = Math.tanh(k * h), f = G.G * k * t - w * w; k -= f / (G.G * (t + k * h * (1 - t * t))); }
  near(G.waveNumber(h, T), k, 0.01 * k, 'wavenumber');
  let prev = Infinity;
  for (const d of [60, 30, 15, 8, 4, 2, 1]) { const c = G.phaseSpeed(d, T); assert.ok(c < prev, 'slower in shallower water'); prev = c; }
  assert.equal(G.phaseSpeed(0, T), 0);
});

test('map travel vector: a south swell travels north, an east swell travels west', () => {
  const [e, n] = G.travelVector(180); near(e, 0, 1e-12); near(n, 1, 1e-12);
  const [e2, n2] = G.travelVector(90); near(e2, -1, 1e-12); near(n2, 0, 1e-12);
  assert.equal(G.compass(136.5), 'SE'); assert.equal(G.compass(359), 'N');
});

test('map terrain encoding keeps 10 cm across the Race and Fishers heights', () => {
  const px = new Uint8ClampedArray(4);
  for (const h of [-105.2, -18.4, -0.05, 0, 0.4, 43.9]) {
    G.encodeHeight(h, px, 0);
    near(G.decodeHeight(px[0], px[1], px[2]), h, 0.05, 'height ' + h);
    assert.equal(px[3], 255);
  }
});

test('map colors match the Sound Check scales', () => {
  assert.deepEqual(G.hCol(0), [16, 42, 74]);
  assert.deepEqual(G.hCol(5), [240, 210, 100]);
  assert.deepEqual(G.hCol(40), [214, 128, 214]);
  assert.deepEqual(G.perRGB(5), [79, 182, 201]);
  assert.deepEqual(G.perRGB(16), [240, 138, 75]);
  const t = G.rampTable(G.NAUTICAL_DEPTH);
  assert.deepEqual([...t.slice(0, 3)], [0xc4, 0xee, 0xf5]);
  assert.deepEqual([...t.slice(255 * 3)], [0x0b, 0x1a, 0x4c]);
});
