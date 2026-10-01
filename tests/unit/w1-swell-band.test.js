// C14: the hero swell card showed NDBC's SwH, which at 44097 only counts
// energy at 10 s and longer (no separation frequency), so real 8-9 s swell
// was filed as wind waves. The card now reports the 8 s+ band of the
// spectrum (Hs = 4·sqrt(Σ E·df)) with its peak period and direction, and
// NDBC's split stays in the spectral table, labelled as such.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, readFixtureJSON } = require('../helpers/load-app');
const { prepareScene, runLoad } = require('../helpers/w1-scene');

const PIPE = readFixtureJSON('pipeline/buoy.json');
const M_TO_FT = 3.28084;

// 44097's real band layout with all the energy (2 m²/Hz) in the 0.115 Hz
// (8.7 s) bin.
function syntheticBins(energyAt) {
  return PIPE.spectral_bins.map(b => Object.assign({}, b, { energy: b.freq === energyAt ? 2.0 : 0, dir1: 135 }));
}

test('swellBandFromBins: 8.7 s swell counts as swell (NDBC\'s 10 s split calls it wind sea)', () => {
  const app = loadApp();
  const bins = syntheticBins(0.115);
  const band = app.clone(app.call('swellBandFromBins', bins, 8));
  // The 0.115 bin spans the midpoints to 0.110 / 0.120: df = 0.005 Hz, so
  // Hs = 4·sqrt(2 · 0.005) = 0.4 m.
  assert.ok(Math.abs(band.hsM - 0.4) < 1e-9, `hs ${band.hsM}`);
  assert.ok(Math.abs(band.peakPeriod - 8.7) < 0.05, `peak ${band.peakPeriod}`);
  assert.ok(Math.abs(band.dir - 135) < 1e-6);
  assert.equal(band.minPeriod, 8);
  const ndbcSplit = app.clone(app.call('swellBandFromBins', bins, 10));
  assert.equal(ndbcSplit.hsM, 0);
  assert.equal(ndbcSplit.peakPeriod, null);
  assert.equal(app.call('swellBandFromBins', [], 8), null);
});

test('swellBandFromBins on the 2026-10-01 12:30Z pipeline spectrum', () => {
  const app = loadApp();
  const band = app.clone(app.call('swellBandFromBins', PIPE.spectral_bins, 8));
  assert.equal(Math.round(band.hsM * M_TO_FT * 10) / 10, 1.3);   // NDBC SwH says 1.0 ft
  assert.ok(Math.abs(band.peakPeriod - 8.70) < 0.01);
  assert.ok(Math.abs(band.dir - 124.4) < 0.5);
  // The whole spectrum integrates to the buoy's own Hs (WVHT 0.6 m ≈ 1.97 ft).
  const all = app.clone(app.call('swellBandFromBins', PIPE.spectral_bins, 0));
  assert.ok(Math.abs(all.hsM * M_TO_FT - 1.97) < 0.1, `all-band Hs ${all.hsM * M_TO_FT} ft`);
});

test('pipelineSwellBand prefers the pipeline\'s own swell_band when it ships one', () => {
  const app = loadApp();
  const withBand = Object.assign({}, PIPE, { swell_band: { hs_m: 0.5, peak_period_s: 9.1, dir_deg: 140, min_period_s: 7 } });
  assert.deepEqual(app.clone(app.call('pipelineSwellBand', withBand, { id: '44097' })),
    { hsM: 0.5, peakPeriod: 9.1, dir: 140, minPeriod: 7 });
  assert.equal(app.call('pipelineSwellBand', withBand, { id: '44025' }), null);
  const computed = app.clone(app.call('pipelineSwellBand', PIPE, { id: '44097' }));
  assert.equal(computed.minPeriod, 8);
});

test('Choc swell card: 8 s+ band height, its period and direction; WVHT as the total', async () => {
  const app = loadApp({ fetch: fixtureFetch() });
  const choc = prepareScene(app);
  app.get('STATE').isChocomount = true;
  await runLoad(app, 'loadAllData', choc);
  assert.equal(app.dom.byId('val-swell-height').textContent, '1.3 ft swell');
  assert.equal(app.dom.byId('val-swell-detail').textContent, '9s · SE (124°) · 2.0 ft total');
  // Arrival uses the band's 8.7 s period (the old 10 s SwP said ~2 hr 52 min).
  assert.match(app.dom.byId('val-swell-arrival').textContent, /reaches Choc ~11:48 AM$/);
});

test('spectral table labels NDBC\'s split for what it is', async () => {
  const app = loadApp({ fetch: fixtureFetch() });
  const choc = prepareScene(app);
  await runLoad(app, 'loadAllData', choc);
  const table = app.dom.byId('spectral-summary-table').children.find(c => c.tagName === 'TABLE');
  assert.match(table.innerHTML, /<td>Swell \(NDBC 10 s split\)<\/td><td class="num-cell">1\.0/);
  assert.match(table.innerHTML, /<td>Wind Waves \(NDBC 10 s split\)<\/td>/);
});
