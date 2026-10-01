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

// The labels name NDBC's 10 s cut in a few characters: the longer
// "(NDBC 10 s split)" labels pushed the table off phones and Choc TV
// (review ux#1); the panel's help text carries the explanation.
test('spectral table labels NDBC\'s split for what it is', async () => {
  const app = loadApp({ fetch: fixtureFetch() });
  const choc = prepareScene(app);
  await runLoad(app, 'loadAllData', choc);
  const table = app.dom.byId('spectral-summary-table').children.find(c => c.tagName === 'TABLE');
  assert.match(table.innerHTML, /<td>Swell 10 s\+<\/td><td class="num-cell">1\.0/);
  assert.match(table.innerHTML, /<td>Wind waves &lt;10 s<\/td>/);
});

// ── Review: the band must be as new as the obs it is shown under ──
// When data_spec fails but 44097.txt answers, the pipeline carries the
// previous spectrum over (stale_sections, spectral_obs_time) and still
// computes swell_band from it. The card labels the hero with buoy.time, so
// an old band read as the current swell; it now falls back to the fresh
// WVHT / DPD / MWD. Without the swdir file every bin's dir1 is 0, which the
// card showed as swell from due north (out of window): MWD stands in.

// Choc loaded with data/buoy.json replaced by `pipe`.
async function chocWith(pipe) {
  const app = loadApp({ fetch: fixtureFetch({ overrides: [['data/buoy.json', { status: 200, json: pipe }]] }) });
  const choc = prepareScene(app);
  app.get('STATE').isChocomount = true;
  // The stub DOM has no selectors: hand the card its label element.
  const label = app.document.createElement('span');
  app.dom.byId('card-swell').querySelector = sel => (sel === '.condition-label' ? label : null);
  await runLoad(app, 'loadAllData', choc);
  const txt = id => app.dom.byId(id).textContent;
  return {
    hero: txt('val-swell-height'),
    heroClass: app.dom.byId('val-swell-height').className,
    detail: txt('val-swell-detail'),
    label: label.textContent,
    extra: txt('val-swell-arrival')
  };
}
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

test('Choc swell card: a carried-over spectrum does not headline under the fresh obs time', async () => {
  const card = await chocWith(withPipe({
    spectral_obs_time: '2026-09-29 12:00 UTC',
    stale_sections: ['spectral_summary', 'spectral_bins'],
    swell_band: { hs_m: 3.53, peak_period_s: 10.5, dir_deg: 105, min_period_s: 8 }
  }));
  assert.equal(card.hero, '2.0 ft', 'the fresh total WVHT, not a days-old 11.6 ft band');
  assert.equal(card.detail, '9s · ESE (120°)');
  assert.equal(card.label, 'Swell: Buoy');
  assert.match(card.extra, /^Buoy obs 8:30 AM \(2h 30m ago\) · reaches Choc ~/);
});

test('Choc swell card: no band direction → the buoy\'s mean wave direction, never "N (0°)"', async () => {
  const allZero = await chocWith(withPipe({
    spectral_bins: PIPE.spectral_bins.map(b => Object.assign({}, b, { dir1: 0 })),
    swell_band: Object.assign({}, FRESH_BAND, { dir_deg: 0 })
  }));
  assert.equal(allZero.hero, '1.3 ft swell');
  assert.equal(allZero.detail, '9s · ESE (120°) · 2.0 ft total');
  assert.equal(allZero.heroClass, 'condition-value dir-in');
  // A pipeline that writes the missing direction as null.
  const nullDir = await chocWith(withPipe({ swell_band: Object.assign({}, FRESH_BAND, { dir_deg: null }) }));
  assert.equal(nullDir.detail, '9s · ESE (120°) · 2.0 ft total');
});
