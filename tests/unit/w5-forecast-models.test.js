// Audit C21: the forecast-model dropdown must only offer Open-Meteo
// models that return a usable swell partition at the Choc forecast point,
// and the "Auto" footer must name the model it really is.
//
// Live probe, 2026-10-01, marine-api.open-meteo.com with
// fetchMarineForecast's exact query at 41.089152,-71.72105 (168 hours):
//   (auto) = best_match        swell 168/168, secondary 168/168, grid 41.125,-71.708
//   meteofrance_wave           identical to best_match in every wave variable
//   ncep_gfswave025            swell 168/168, secondary 168/168
//   ncep_gfswave016            swell 168/168, secondary 168/168
//   dwd_gwam                   swell 168/168, secondary   0/168
//   gfs_wave025, gfs_wave016   HTTP 400 "Invalid value ... MultiDomains"
//   dwd_ewam                   HTTP 400 "No data is available for this location"
//   ecmwf_wam, ecmwf_wam025    wave_* only, swell_* 0/168
//   era5_ocean                 everything 0/168
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch } = require('../helpers/load-app');

const USABLE_AT_CHOC = ['meteofrance_wave', 'ncep_gfswave025', 'ncep_gfswave016', 'dwd_gwam'];
const UNUSABLE_AT_CHOC = ['gfs_wave025', 'gfs_wave016', 'dwd_ewam', 'ecmwf_wam', 'ecmwf_wam025', 'era5_ocean'];

test('FORECAST_MODELS lists only models that return swell at Choc', () => {
  const values = app => app.clone('FORECAST_MODELS.map(m => m.value)');
  const got = values(loadApp());
  assert.ok(got.length > 0);
  for (const v of got) assert.ok(USABLE_AT_CHOC.includes(v), `${v} is not usable at Choc`);
  for (const v of UNUSABLE_AT_CHOC) assert.ok(!got.includes(v), `${v} must not be offered`);
  assert.ok(got.includes('ncep_gfswave025'), 'NOAA GFS-Wave is offered under its real id');
});

test('the Auto description names MFWAM, not GFS', () => {
  const app = loadApp();
  const auto = app.call('describeForecastModel', '');
  assert.match(auto, /MFWAM/);
  assert.doesNotMatch(auto, /GFS/);
  assert.match(app.call('describeForecastModel', 'dwd_gwam'), /no secondary swell/);
});

test('a stale stored model id self-heals to Auto and is never requested', async () => {
  const app = loadApp({ storage: { local: { 'lcc-forecast-model': 'gfs_wave025' } }, fetch: fixtureFetch() });
  assert.equal(app.call('getForecastModel'), '');
  await app.run('fetchMarineForecast(41.089152, -71.72105, getForecastModel() || null)');
  const marine = app.fetchLog.filter(f => f.url.includes('marine-api.open-meteo.com'));
  assert.equal(marine.length, 1);
  assert.doesNotMatch(marine[0].url, /models=/);
});

test('a valid stored id is kept and sent as models=', async () => {
  const app = loadApp({ storage: { local: { 'lcc-forecast-model': 'ncep_gfswave025' } }, fetch: fixtureFetch() });
  assert.equal(app.call('getForecastModel'), 'ncep_gfswave025');
  await app.run('fetchMarineForecast(41.089152, -71.72105, getForecastModel())');
  assert.match(app.fetchLog.at(-1).url, /models=ncep_gfswave025/);
});

test('the dropdown is populated from FORECAST_MODELS behind Auto', () => {
  const app = loadApp();
  app.call('initForecastModelDropdown');
  const opts = app.dom.byId('forecast-model-select').children.map(o => o.value);
  assert.deepEqual([...opts], USABLE_AT_CHOC);
});
