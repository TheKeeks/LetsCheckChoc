// C14: the hero swell card showed NDBC's SwH, which at 44097 only counts
// energy at 10 s and longer (no separation frequency), so real 8-9 s swell
// was filed as wind waves. The buoy's swell is now the 8 s+ band of the
// spectrum (Hs = 4·sqrt(Σ E·df)) with its peak period and direction.
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

// ── Review: the band must be as new as the obs it is shown under ──
// When data_spec fails but 44097.txt answers, the pipeline carries the
// previous spectrum over (stale_sections, spectral_obs_time) and still
// computes swell_band from it. The swell is shown under buoy.time, so an old
// band would read as the current swell: pipelineSwellBand gives none, and the
// look falls back to the fresh WVHT / DPD / MWD. Without the swdir file every
// bin's dir1 is 0: no band direction, never swell from due north.

const FRESH_BAND = { hs_m: 0.4, peak_period_s: 8.7, dir_deg: 124.4, min_period_s: 8 };
const withPipe = extra => Object.assign(JSON.parse(JSON.stringify(PIPE)), extra);

test('pipelineSwellBand: none from a carried-over or lagging spectrum; older pipeline files still work', () => {
  const app = loadApp();
  const band = p => app.clone(app.call('pipelineSwellBand', p, { id: '44097' }));
  // Healthy run: spectrum half an hour behind the 12:30 stdmet row.
  assert.deepEqual(band(withPipe({ spectral_obs_time: '2026-10-01 12:00 UTC', stale_sections: [], swell_band: FRESH_BAND })),
    { hsM: 0.4, peakPeriod: 8.7, dir: 124.4, minPeriod: 8 });
  // data_spec failed: the bins (and the band computed from them) are an
  // earlier run's.
  assert.equal(band(withPipe({
    spectral_obs_time: '2026-09-29 12:00 UTC', stale_sections: ['spectral_summary', 'spectral_bins'], swell_band: FRESH_BAND
  })), null);
  assert.equal(band(withPipe({ stale_sections: ['spectral_bins'] })), null, 'no client-side integration of carried bins either');
  // Not marked stale, but more than 2 h older than buoy.time.
  assert.equal(band(withPipe({ spectral_obs_time: '2026-10-01 10:00 UTC', stale_sections: [], swell_band: FRESH_BAND })), null);
  assert.ok(band(withPipe({ spectral_obs_time: '2026-10-01 10:30 UTC', stale_sections: [], swell_band: FRESH_BAND })), '2 h exactly is fine');
  // Only the stdmet row carried over (older than the spectrum): keep the band.
  assert.ok(band(withPipe({ spectral_obs_time: '2026-10-01 14:00 UTC', stale_sections: ['buoy'], swell_band: FRESH_BAND })));
});

test('pipelineSwellBand: bins without a measured direction (dir1 all 0) give no band direction', () => {
  const app = loadApp();
  const noSwdir = withPipe({
    spectral_bins: PIPE.spectral_bins.map(b => Object.assign({}, b, { dir1: 0 })),
    swell_band: Object.assign({}, FRESH_BAND, { dir_deg: 0 })
  });
  const band = app.clone(app.call('pipelineSwellBand', noSwdir, { id: '44097' }));
  assert.equal(band.dir, null);
  assert.equal(band.hsM, 0.4, 'the height still stands');
  delete noSwdir.swell_band;   // integrated here from the same bins
  assert.equal(app.clone(app.call('pipelineSwellBand', noSwdir, { id: '44097' })).dir, null);
});
