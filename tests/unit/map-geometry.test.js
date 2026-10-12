'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geometry = require('../../map/geometry.js');

test('map Mercator tile coordinates round-trip at Choc and share exact adjacent edges', () => {
  for (const z of [11, 15, 19]) {
    const p = geometry.tilePoint(-71.96339, 41.27557, z);
    const q = geometry.tileLocation(p[0], p[1], z);
    assert.ok(Math.abs(q[0] + 71.96339) < 1e-9);
    assert.ok(Math.abs(q[1] - 41.27557) < 1e-9);
    const edge = geometry.tileLocation(Math.floor(p[0]) + 1, Math.floor(p[1]), z);
    assert.equal(geometry.tilePoint(edge[0], edge[1], z)[0], Math.floor(p[0]) + 1);
  }
});

test('map elevation sampling respects half-cell registration, signed land, interpolation and footprint', () => {
  const meta = { left: 0, top: 1, kmlon: 1, kmlat: 1, dx: 100, cols: 2, rows: 2 };
  const values = new Float32Array([-8, 12, 20, 40]), wet = new Uint8Array([0, 1, 1, 1]);
  const land = geometry.sample(meta, values, wet, 0.05, 0.95);
  assert.ok(Math.abs(land.depth + 8) < 1e-9);
  assert.equal(land.wet, false);
  assert.ok(Math.abs(geometry.sample(meta, values, wet, 0.1, 0.9).depth - 16) < 1e-9);
  assert.equal(geometry.sample(meta, values, wet, -0.1, 0.9), null);
  assert.equal(geometry.sample(meta, values, wet, 0.2, 0.9), null);
});

test('map zoom selection bounds tile requests while retaining complete geographic coverage', () => {
  const box = [-72.05, 41.24, -71.94, 41.30];
  const tiles = geometry.tilesFor(box, 19, 28);
  assert.ok(tiles.length <= 28);
  const z = tiles[0].z, a = geometry.tilePoint(box[0], box[3], z), b = geometry.tilePoint(box[2], box[1], z);
  const keys = new Set(tiles.map(t => `${t.x}/${t.y}`));
  for (let x = Math.floor(a[0]); x <= Math.floor(b[0]); x++) for (let y = Math.floor(a[1]); y <= Math.floor(b[1]); y++) assert.ok(keys.has(`${x}/${y}`));
});
