// Review follow-up (pipeline#2 / load-path#5): without the swdir file the
// spectrum has no measured direction. The pipeline now writes dir1 = null
// (older runs wrote 0 in every bin), and the browser parser used to default
// to 0 as well. Either way computePrimarySwellDir read it as swell from due
// north, which the spectral table then showed as "N" for Choc.
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixtureJSON } = require('../helpers/load-app');

const PIPE = readFixtureJSON('pipeline/buoy.json');
const withDir = dir => PIPE.spectral_bins.map(b => Object.assign({}, b, { dir1: dir }));

test('computePrimarySwellDir: no measured direction (null, or the legacy all-0 placeholder) gives null, not 0°', () => {
  const app = loadApp();
  assert.equal(app.call('computePrimarySwellDir', withDir(null)), null);
  assert.equal(app.call('computePrimarySwellDir', withDir(0)), null);
  assert.equal(app.call('computePrimarySwellDir', withDir(999)), null);
});

test('computePrimarySwellDir: bins missing a direction are left out of the mean', () => {
  const app = loadApp();
  const bins = [
    { period: 10, dir1: 140, energy: 1.0 },
    { period: 10, dir1: null, energy: 5.0 },   // would drag the mean to 0° if read as 0
    { period: 9, dir1: 999, energy: 5.0 }      // NDBC's missing-value sentinel
  ];
  const dir = app.call('computePrimarySwellDir', bins);
  assert.ok(Math.abs(dir - 140) < 1e-6, `got ${dir}`);
});

test('parseNDBCSpectral without swdir: bins carry dir1 = null', () => {
  const app = loadApp();
  const dataSpec = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ndbc', '44097.data_spec'), 'utf8');
  const spec = app.clone(app.call('parseNDBCSpectral', { dataSpec }));
  assert.ok(spec && spec.bins.length > 40, 'parsed the recorded spectrum');
  for (const b of spec.bins) assert.equal(b.dir1, null);
  assert.equal(app.call('computePrimarySwellDir', spec.bins), null);
});
