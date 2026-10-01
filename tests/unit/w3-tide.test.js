// Audit C11: a CO-OPS outage must leave tide MISSING, never a made-up
// 0 ft "rising". NOAA answers an outage with HTTP 200 and
// {"error":{"message":"No Predictions data was found..."}}; the old
// parseTideAtTime turned that (and any 503 / network failure) into
// { height: 0, rate: 0, stage: 'rising', timeToNearest: 0 }, which looks
// exactly like Choc's favourite low incoming tide. The Ride model trained
// on it, the forecast-time Ride prediction rated it, and Backfill wrote it
// over sessions that had real tides.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, readFixtureJSON, ERRORS } = require('../helpers/load-app');

const ARCHIVE_WIND_OK = ['archive-api.open-meteo.com', { status: 200, file: 'open-meteo/wind.json' }];
const COOPS = 'api.tidesandcurrents.noaa.gov';
const SESSION = '2026-10-01T09:00';   // inside the recorded fixture week
const FABRICATED = { height: 0, rate: 0, stage: 'rising', timeToNearest: 0 };

async function lookup(app) {
  const c = app.get('CONFIG').chocomount;
  return app.clone(await app.call('lookupHistoricalConditions', c.forecastLat, c.forecastLon, SESSION));
}

test('parseTideAtTime returns null for NOAA\'s outage body, null and empty input', () => {
  const app = loadApp();
  assert.equal(app.call('parseTideAtTime', readFixtureJSON('coops/error-no-predictions.json'), SESSION), null);
  assert.equal(app.call('parseTideAtTime', null, SESSION), null);
  assert.equal(app.call('parseTideAtTime', { predictions: [] }, SESSION), null);
});

for (const [label, responder] of [
  ['NOAA "No Predictions" (HTTP 200 error JSON)', ERRORS.coopsNoPredictions()],
  ['HTTP 503', ERRORS.serviceUnavailable()],
  ['network failure', 'network-error']
]) {
  test(`Lookup during a CO-OPS outage (${label}) stores tide: null and the Ride model skips the session`, async () => {
    const app = loadApp({ fetch: fixtureFetch({ overrides: [ARCHIVE_WIND_OK, [COOPS, responder]] }) });
    const cond = await lookup(app);
    assert.equal(cond.source, 'openmeteo-archive');
    assert.equal(typeof cond.swell.height, 'number', 'swell still looked up');
    assert.equal(cond.tide, null);
    assert.equal(app.call('extractRideFeatures', app.run(`(${JSON.stringify(cond)})`)), null);
  });
}

test('Lookup with CO-OPS up still stores the interpolated tide', async () => {
  const app = loadApp({ fetch: fixtureFetch({ overrides: [ARCHIVE_WIND_OK] }) });
  const cond = await lookup(app);
  assert.equal(typeof cond.tide.height, 'number');
  assert.equal(typeof cond.tide.rate, 'number');
  assert.notDeepEqual(cond.tide, FABRICATED);
});

test('forecast-time conditions: no tide data gives tide: null, not a fabricated 0 ft', () => {
  const app = loadApp();
  const marine = readFixtureJSON('open-meteo/marine.json');
  const wind = readFixtureJSON('open-meteo/wind.json');
  const fc = app.clone(app.call('buildForecastConditions', marine, wind, [], [], 9));
  assert.equal(fc.tide, null);
  assert.equal(app.call('extractRideFeatures', app.run(`(${JSON.stringify(fc)})`)), null, 'no Ride prediction on fictional water');
  // Healthy series: tide from the 6-min predictions, time-to-next from hi/lo.
  const pred = readFixtureJSON('coops/predictions-6min-72h.json').predictions;
  const hilo = readFixtureJSON('coops/hilo-72h.json').predictions;
  const ok = app.clone(app.call('buildForecastConditions', marine, wind, hilo, pred, 9));
  assert.equal(typeof ok.tide.height, 'number');
  // A hi/lo list with nothing parseable no longer crashes the hour (hi2 guard).
  const junk = app.clone(app.call('buildForecastConditions', marine, wind, [{ t: 'n/a', v: 'x', type: 'H' }], pred, 9));
  assert.equal(junk.tide.height, ok.tide.height);
  // Only hi/lo available: still used.
  const hiloOnly = app.clone(app.call('buildForecastConditions', marine, wind, hilo, [], 9));
  assert.equal(typeof hiloOnly.tide.height, 'number');
});

// ── Backfill keeps good data when a source is down ─────────────────────

const GOOD_TIDE = { height: 1.7, rate: 0.55, stage: 'rising', timeToNearest: 2.1 };
const GOOD_WIND = { speed: 7, direction: 300 };
function ownDoc(cond) {
  return {
    id: 'mine1', userId: 'google-1', displayName: 'Me', timestamp: SESSION, photos: [], notes: '',
    ratings: { size: 6, windQuality: 7, rideQuality: 5 },
    conditions: Object.assign({ swell: { height: 3.1, direction: 141, period: 9.5 }, source: 'openmeteo-archive' }, cond)
  };
}
async function backfill(overrides, cond) {
  const app = loadApp({ firebase: { mode: 'google', logs: [ownDoc(cond)] }, fetch: fixtureFetch({ overrides }) });
  await app.clock.tick(300);
  let done = false;
  app.call('backfillAllSessionsFromArchive').then(() => { done = true; });
  for (let i = 0; i < 40 && !done; i++) await app.clock.tick(600);
  assert.ok(done, 'backfill finished');
  const set = app.clone('window.__FB_WRITES').filter(w => w.op === 'set');
  assert.equal(set.length, 1);
  return { app, written: set[0].data.conditions, local: app.clone('STATE.surfLog[0].conditions') };
}

test('Backfill during a CO-OPS + wind-archive outage keeps the stored tide and wind', async () => {
  const { written, local } = await backfill(
    [[COOPS, ERRORS.coopsNoPredictions()], ['archive-api.open-meteo.com', ERRORS.serviceUnavailable()]],
    { tide: GOOD_TIDE, wind: GOOD_WIND });
  assert.deepEqual(written.tide, GOOD_TIDE);
  assert.deepEqual(written.wind, GOOD_WIND);
  assert.deepEqual(local.tide, GOOD_TIDE);
  assert.equal(typeof written.swell.height, 'number', 'swell was still refreshed from the archive');
});

test('Backfill with CO-OPS up replaces the tide; an earlier fabricated tide/wind becomes null when the source is down', async () => {
  const up = await backfill([ARCHIVE_WIND_OK], { tide: GOOD_TIDE, wind: GOOD_WIND });
  assert.notDeepEqual(up.written.tide, GOOD_TIDE);
  assert.equal(typeof up.written.tide.rate, 'number');
  const down = await backfill(
    [[COOPS, ERRORS.coopsNoPredictions()], ['archive-api.open-meteo.com', ERRORS.serviceUnavailable()]],
    { tide: FABRICATED, wind: { speed: 0, direction: 0 } });
  assert.equal(down.written.tide, null);
  assert.deepEqual(down.written.wind, { speed: null, direction: null });
});

// ── Rows already saved during the outage ───────────────────────────────

test('sessions saved during an outage load with tide: null (exact signature: rising at 0 ft/hr)', async () => {
  const docs = [
    ownDoc({ tide: FABRICATED, wind: GOOD_WIND }),
    Object.assign(ownDoc({ tide: GOOD_TIDE, wind: GOOD_WIND }), { id: 'real' }),
    Object.assign(ownDoc({ tide: { height: 0.4, rate: 0, stage: 'slack-low', timeToNearest: 0 }, wind: GOOD_WIND }), { id: 'slack' })
  ];
  const app = loadApp({ firebase: { mode: 'google', logs: docs } });
  await app.clock.tick(300);
  const tides = app.clone('Object.fromEntries(STATE.surfLog.map(e => [e.id, e.conditions.tide]))');
  assert.equal(tides.mine1, null);
  assert.deepEqual(tides.real, GOOD_TIDE);
  assert.equal(tides.slack.stage, 'slack-low', 'a real slack tide is untouched');
});

test('the log form says "Tide unavailable" instead of a number', () => {
  const app = loadApp();
  app.call('renderConditionsDisplay', app.run(`(${JSON.stringify(ownDoc({ tide: null, wind: GOOD_WIND }).conditions)})`));
  const html = app.dom.byId('sl-conditions-display').innerHTML;
  assert.match(html, /Tide unavailable \(NOAA CO-OPS down\)/);
});
