// C05 / C31 / C30 (main site): a failed Open-Meteo or CO-OPS refresh used to
// blank the chart (or its tides) under a header that still said "Updated
// <now>", and a network blip erased the chosen forecast model. Now a failed
// source falls back to its last good saved copy (forecast ≤ 24 h, tides
// ≤ 4 days) with its ORIGINAL time, the header and STATE.dataAsOf /
// STATE.dataHealth (the shared contract with kiosk.js) say how old the data
// really is, and only a model that answered with no data is forgotten.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, readFixtureJSON, FIXTURE_NOW_MS, ERRORS } = require('../helpers/load-app');
const { prepareScene, runLoad } = require('../helpers/w1-scene');

const HOUR = 3600e3;
const OBS_MS = Date.UTC(2026, 9, 1, 12, 30);   // pipeline buoy.time 12:30 UTC
const MARINE = /marine-api\.open-meteo\.com/;
const WIND = /api\.open-meteo\.com\/v1\/forecast/;
const COOPS = /tidesandcurrents.*product=predictions/;

// A loaded app whose data APIs can be switched off between loads:
// down.marine / down.wind / down.coops = url => descriptor (null = no answer).
function scene(opts = {}) {
  const down = {};
  const app = loadApp(Object.assign({
    fetch: fixtureFetch({
      overrides: [
        [u => down.marine && MARINE.test(u), u => down.marine(u)],
        [u => down.wind && WIND.test(u), u => down.wind(u)],
        [u => down.coops && COOPS.test(u), u => down.coops(u)]
      ]
    })
  }, opts));
  const choc = prepareScene(app);
  return { app, choc, down, STATE: app.get('STATE'), text: id => app.dom.byId(id).textContent };
}
const unavailable = () => ERRORS.serviceUnavailable();
const noAnswer = () => null;

test('readCache: fresh within the TTL; { allowStale } returns any copy with its time', () => {
  const app = loadApp();
  app.call('writeCache', 'lcc-cache-x', { hourly: {} });
  app.clock.set(FIXTURE_NOW_MS + 2 * HOUR);
  assert.equal(app.call('readCache', 'lcc-cache-x', 30 * 60e3), null);
  const hit = app.clone(app.call('readCache', 'lcc-cache-x', 30 * 60e3, { allowStale: true }));
  assert.deepEqual(hit, { data: { hourly: {} }, ts: FIXTURE_NOW_MS, stale: true });
  assert.equal(app.call('readCache', 'lcc-cache-missing', 1, { allowStale: true }), null);
});

test('all live: header "Updated", dataAsOf = fetch time, dataHealth per the shared contract', async () => {
  const { app, choc, STATE, text } = scene();
  await runLoad(app, 'loadAllData', choc);
  assert.equal(text('header-update-time'), 'Updated 11:00 AM');
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS);
  assert.deepEqual(app.clone(STATE.dataHealth), {
    marine: { asOf: FIXTURE_NOW_MS, origin: 'live' },
    wind: { asOf: FIXTURE_NOW_MS, origin: 'live' },
    tides: { asOf: FIXTURE_NOW_MS, origin: 'live' },
    buoy: { obsMs: OBS_MS, origin: 'pipeline' }
  });
  assert.ok(STATE.lastLoadCompletedAt);
});

test('marine/wind/tides all fail 2 h later: the saved copies are drawn and flagged stale', async () => {
  const { app, choc, down, STATE, text } = scene();
  await runLoad(app, 'loadAllData', choc);
  app.clock.set(FIXTURE_NOW_MS + 2 * HOUR);   // past every 30-min forecast TTL
  down.marine = unavailable;
  down.wind = unavailable;
  down.coops = noAnswer;
  STATE.forecastData = null;
  STATE.forecastChart = null;
  await runLoad(app, 'loadAllData', choc);

  assert.equal(STATE.forecastChart && STATE.forecastChart.times.length, 168, 'chart redrawn from the saved forecast');
  assert.ok(STATE.forecastData.wind && STATE.forecastData.wind.hourly, 'saved wind');
  assert.ok(STATE.forecastData.tideHiLo.length > 0 && STATE.forecastData.tidePred.length > 0, 'saved tides');
  for (const k of ['marine', 'wind', 'tides']) {
    assert.deepEqual(app.clone(STATE.dataHealth[k]), { asOf: FIXTURE_NOW_MS, origin: 'stale-cache' }, k);
  }
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS, 'as-of keeps the original fetch time');
  assert.ok(STATE.lastLoadCompletedAt >= FIXTURE_NOW_MS + 2 * HOUR, 'the load itself did finish');
  assert.equal(text('header-update-time'), 'Refresh failed · data from 11:00 AM');
  assert.ok(app.dom.byId('header-update-time').classList.contains('is-stale'));
  const ind = app.dom.byId('forecast-cache-indicator');
  assert.equal(ind.style.display, '');
  assert.equal(ind.textContent, 'Saved forecast from 11:00 AM · refresh failed');
  assert.match(app.dom.byId('footer-forecast').innerHTML, /updated 11:00 AM \(2h ago\)/);
});

test('CO-OPS "No Predictions" (HTTP 200) neither overwrites the saved tides nor blanks them', async () => {
  const { app, choc, down, STATE, text } = scene();
  await runLoad(app, 'loadAllData', choc);
  app.clock.set(FIXTURE_NOW_MS + 7 * HOUR);   // past the 6 h tide TTL
  down.coops = () => ERRORS.coopsNoPredictions();
  await runLoad(app, 'loadAllData', choc);
  const saved = JSON.parse(app.localStorage.getItem('lcc-cache-hilo-8510719-d10'));
  assert.ok(saved.data.predictions.length > 0, 'the error body did not replace the good copy');
  assert.equal(saved.ts, FIXTURE_NOW_MS);
  assert.ok(STATE.forecastData.tideHiLo.length > 0, 'lows still on the chart');
  assert.deepEqual(app.clone(STATE.dataHealth.tides), { asOf: FIXTURE_NOW_MS, origin: 'stale-cache' });
  assert.equal(STATE.dataHealth.marine.origin, 'live');
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS, 'oldest rendered input');
  assert.equal(text('header-update-time'), 'Refresh failed · data from 11:00 AM');
});

test('saved copies past the cap are not used; a cold marine failure says so plainly', async () => {
  const { app, choc, down, STATE, text } = scene();
  await runLoad(app, 'loadAllData', choc);
  app.clock.set(FIXTURE_NOW_MS + 25 * HOUR);   // forecast cap is 24 h
  down.marine = unavailable;
  STATE.forecastData = null;
  await runLoad(app, 'loadAllData', choc);
  assert.equal(STATE.forecastData, null, 'no day-old forecast passed off as usable');
  assert.deepEqual(app.clone(STATE.dataHealth.marine), { asOf: null, origin: 'failed' });
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS + 25 * HOUR, 'wind + tides are live');
  assert.equal(text('header-update-time'), 'Forecast unavailable');
  const note = app.dom.byId('forecast-unavailable-msg');
  assert.match(note.textContent, /^Forecast unavailable: Open-Meteo didn't respond/);
  assert.equal(note.style.display, '');
  assert.ok(app.dom.byId('forecast-chart-container').classList.contains('is-unavailable'));

  // Next good refresh clears the message.
  delete down.marine;
  await runLoad(app, 'loadAllData', choc);
  assert.equal(note.style.display, 'none');
  assert.equal(text('header-update-time'), 'Updated 12:00 PM');
});

test('Open-Meteo unreachable with a chosen model: the choice survives the blip', async () => {
  const { app, choc, down } = scene({ storage: { local: { 'lcc-forecast-model': 'dwd_gwam' } } });
  down.marine = noAnswer;   // the model call and the best_match retry both fail
  await runLoad(app, 'loadAllData', choc);
  assert.equal(app.localStorage.getItem('lcc-forecast-model'), 'dwd_gwam');
  assert.equal(app.get('STATE').dataHealth.marine.origin, 'failed');
});

test('blip on the chosen model, best_match answers: choice kept, footer names best_match', async () => {
  const marine = readFixtureJSON('open-meteo/marine.json');
  const app = loadApp({
    storage: { local: { 'lcc-forecast-model': 'dwd_gwam' } },
    fetch: fixtureFetch({ overrides: [[/marine-api.*models=dwd_gwam/, 'network-error'], [MARINE, { status: 200, json: marine }]] })
  });
  const choc = prepareScene(app);
  await runLoad(app, 'loadAllData', choc);
  assert.equal(app.localStorage.getItem('lcc-forecast-model'), 'dwd_gwam', 'choice kept');
  assert.match(app.dom.byId('footer-forecast').innerHTML, /^Open-Meteo Marine · Auto \(Open-Meteo best_match/);
  assert.equal(app.get('STATE').dataHealth.marine.origin, 'live');
});

test('a model that answers with no data for the spot is forgotten', async () => {
  const marine = readFixtureJSON('open-meteo/marine.json');
  const empty = JSON.parse(JSON.stringify(marine));
  for (const k of Object.keys(empty.hourly)) if (k !== 'time') empty.hourly[k] = empty.hourly[k].map(() => null);
  const app = loadApp({
    storage: { local: { 'lcc-forecast-model': 'dwd_gwam' } },
    fetch: fixtureFetch({ overrides: [[/marine-api.*models=dwd_gwam/, { status: 200, json: empty }], [MARINE, { status: 200, json: marine }]] })
  });
  const choc = prepareScene(app);
  await runLoad(app, 'loadAllData', choc);
  assert.equal(app.localStorage.getItem('lcc-forecast-model'), null);
  assert.equal(app.localStorage.getItem(app.call('marineCacheKey', 41.089152, -71.72105, 'dwd_gwam')), null,
    'the empty answer is not saved as a fallback copy');
  assert.equal(app.get('STATE').forecastChart.times.length, 168);
});

test('pin loads fall back the same way and set the contract (no buoy)', async () => {
  const { app, down, STATE, text } = scene();
  await runLoad(app, 'loadPinData', 41.2757, -71.9633);
  assert.equal(text('header-update-time'), 'Updated 11:00 AM');
  assert.deepEqual(app.clone(STATE.dataHealth.buoy), { obsMs: null, origin: 'failed' });
  app.clock.set(FIXTURE_NOW_MS + 3 * HOUR);
  down.marine = unavailable;
  STATE.forecastChart = null;
  await runLoad(app, 'loadPinData', 41.2757, -71.9633);
  assert.equal(STATE.forecastChart.times.length, 168);
  assert.deepEqual(app.clone(STATE.dataHealth.marine), { asOf: FIXTURE_NOW_MS, origin: 'stale-cache' });
  assert.equal(text('header-update-time'), 'Refresh failed · data from 11:00 AM');
});
