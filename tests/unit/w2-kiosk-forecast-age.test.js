// Choc TV's load path, run for real here (fixtures, 15-min refreshes on the
// fake clock). The TV and the look tell the age of what is on screen from
// what app.js publishes after every load: STATE.dataAsOf, the age of the
// swell + wind forecast, and STATE.dataHealth per source (core.js
// freshness() / sources(), tv.js Sources). Two holes this guards:
//  - a NOAA CO-OPS outage must not age the data by the SAVED tide
//    predictions (they are astronomical: a saved copy is right for days);
//  - once a marine outage passes the 24 h fallback cap, the age must keep
//    counting from the old forecast still on screen, not reset to the live
//    wind fetch; a boot with marine down and nothing saved has no age.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, FIXTURE_NOW_MS, ERRORS } = require('../helpers/load-app');
const { prepareScene, runLoad } = require('../helpers/w1-scene');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const MARINE = /marine-api\.open-meteo\.com/;
const COOPS = /tidesandcurrents.*product=predictions/;

// Kiosk functions loaded next to the real app; down.marine / down.coops =
// url => descriptor switch an API off between loads.
function kioskScene(opts = {}) {
  const down = {};
  const app = loadApp(Object.assign({
    kiosk: true,
    fetch: fixtureFetch({
      overrides: [
        [u => down.marine && MARINE.test(u), u => down.marine(u)],
        [u => down.coops && COOPS.test(u), u => down.coops(u)]
      ]
    })
  }, opts));
  const choc = prepareScene(app);
  const STATE = app.get('STATE');
  STATE.isChocomount = true;
  STATE.selectedBuoy = choc;
  const load = () => runLoad(app, 'loadAllData', choc);
  // A refresh at FIXTURE_NOW + ms (Choc TV's 15-min tick; the loads in
  // between change nothing while the same API stays down).
  const refreshAt = ms => {
    app.clock.set(FIXTURE_NOW_MS + ms);
    return load();
  };
  return { app, choc, down, STATE, load, refreshAt };
}

for (const [label, coopsDown] of [
  ['NOAA "No Predictions" (HTTP 200)', () => ERRORS.coopsNoPredictions()],
  ['503', () => ERRORS.serviceUnavailable()]
]) {
  test(`CO-OPS ${label} for 4 h while Open-Meteo answers: the data stays fresh over the saved tides`, async () => {
    const { app, down, STATE, load, refreshAt } = kioskScene();
    await load();
    down.coops = coopsDown;
    for (let h = 1; h <= 4; h++) {
      await refreshAt(h * HOUR);
      assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS + h * HOUR, `${h} h in: the forecast is as fresh as the refresh`);
    }
    assert.equal(STATE.dataHealth.marine.origin, 'live');
    assert.equal(STATE.dataHealth.wind.origin, 'live');
    assert.deepEqual(app.clone(STATE.dataHealth.tides), { asOf: FIXTURE_NOW_MS, origin: 'stale-cache' });
    assert.ok(STATE.forecastData.tideHiLo.length > 0, 'the day cards keep their lows');
    assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS + 4 * HOUR, 'forecast age, not the saved tides');
  });
}

test('marine down past the 24 h fallback cap: the age keeps climbing while the old forecast is on the cards', async () => {
  const { app, down, STATE, load, refreshAt } = kioskScene();
  await load();
  down.marine = () => ERRORS.serviceUnavailable();   // wind and CO-OPS keep answering
  await refreshAt(23 * HOUR + 45 * MIN);
  assert.equal(STATE.dataHealth.marine.origin, 'stale-cache');
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS, 'the saved 11:00 forecast');

  // 24 h 15 min: the saved copy is past the cap, marine settles 'failed',
  // but the cards still show the 11:00 forecast from memory.
  await refreshAt(24 * HOUR + 15 * MIN);
  assert.deepEqual(app.clone(STATE.dataHealth.marine), { asOf: null, origin: 'failed' });
  assert.equal(STATE.dataHealth.wind.origin, 'live');
  assert.ok(STATE.forecastData && STATE.forecastData.marine, 'old forecast still drawn');
  assert.ok(app.call('kioskDaySummary', 0), 'and the TODAY card is built from it');
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS, 'its real age, not the live wind fetch');

  await refreshAt(36 * HOUR + 15 * MIN);
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS);

  // Marine back: fresh again.
  delete down.marine;
  await refreshAt(36 * HOUR + 30 * MIN);
  assert.equal(STATE.dataHealth.marine.origin, 'live');
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS + 36 * HOUR + 30 * MIN);
});

test('boot (or the nightly reload) with marine down and no usable saved forecast: no forecast and no age', async () => {
  // Day 1: a good load, then the page is reopened 25 h later with the same
  // storage (the saved forecast is past its 24 h cap) and marine down.
  const first = kioskScene();
  await first.load();
  const { STATE, down, load } = kioskScene({
    now: FIXTURE_NOW_MS + 25 * HOUR,
    storage: { local: first.app.localStorage.dump() }
  });
  down.marine = () => ERRORS.serviceUnavailable();
  await load();
  assert.equal(STATE.dataHealth.marine.origin, 'failed');
  assert.equal(STATE.dataHealth.wind.origin, 'live');
  assert.ok(!(STATE.forecastData && STATE.forecastData.marine), 'no forecast on the cards');
  assert.equal(STATE.dataAsOf, null);
});
