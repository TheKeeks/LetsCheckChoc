// Choc TV's status strip runs the REAL load path here (fixtures, 15-min
// refreshes on the fake clock). Its age is the age of the swell + wind
// forecast on the cards, the one definition app.js publishes as
// STATE.dataAsOf. Review of the audit branch found two holes:
//  - a NOAA CO-OPS outage aged the strip by the SAVED tide predictions, so
//    "FORECAST 3 H OLD — NOT UPDATING" went up over a forecast refreshed
//    minutes earlier (tide predictions are astronomical: a saved copy is
//    right for days, and the SOURCES card still lists it);
//  - once a marine outage passed the 24 h fallback cap the strip flipped
//    back to "updated just now" (from the live wind / tide fetch) while
//    the cards kept the day-old forecast, and a boot with marine down said
//    the same over empty cards instead of NO DATA.
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
  app.call('kioskBuildChrome');
  const load = () => runLoad(app, 'loadAllData', choc);
  // A refresh at FIXTURE_NOW + ms (Choc TV's 15-min tick; the loads in
  // between change nothing while the same API stays down).
  const refreshAt = ms => {
    app.clock.set(FIXTURE_NOW_MS + ms);
    return load();
  };
  // What the status tick paints: level, strip text and the banner.
  const strip = () => {
    app.call('kioskShowFreshness', app.call('kioskFreshness', app.clock.now(), STATE.lastLoadCompletedAt,
      app.call('kioskDataAsOf'), app.run('KIOSK.refreshMs')));
    const s = app.dom.byId('kiosk-status');
    const banner = app.dom.byId('kiosk-stale-banner');
    return {
      text: app.dom.byId('kiosk-status-updated').textContent,
      stale: s.classList.contains('np-stale'),
      dead: s.classList.contains('np-dead'),
      banner: banner.style.display === 'none' ? '' : banner.textContent
    };
  };
  return { app, choc, down, STATE, load, refreshAt, strip };
}

for (const [label, coopsDown] of [
  ['NOAA "No Predictions" (HTTP 200)', () => ERRORS.coopsNoPredictions()],
  ['503', () => ERRORS.serviceUnavailable()]
]) {
  test(`CO-OPS ${label} for 4 h while Open-Meteo answers: the strip stays fresh over the saved tides`, async () => {
    const { app, down, STATE, load, refreshAt, strip } = kioskScene();
    await load();
    down.coops = coopsDown;
    for (let h = 1; h <= 4; h++) {
      await refreshAt(h * HOUR);
      assert.deepEqual(strip(), { text: 'updated just now', stale: false, dead: false, banner: '' }, `${h} h in`);
    }
    assert.equal(STATE.dataHealth.marine.origin, 'live');
    assert.equal(STATE.dataHealth.wind.origin, 'live');
    assert.deepEqual(app.clone(STATE.dataHealth.tides), { asOf: FIXTURE_NOW_MS, origin: 'stale-cache' });
    assert.ok(STATE.forecastData.tideHiLo.length > 0, 'the day cards keep their lows');
    assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS + 4 * HOUR, 'forecast age, not the saved tides');
    // The SOURCES card still says where the tides came from.
    assert.match(app.call('kioskInfoStatusHTML'), /Tides: stale-cache \(4h ago\)/);
    // The web header: a fresh forecast, quietly noting the saved tides.
    assert.equal(app.dom.byId('header-update-time').textContent, 'Updated 3:00 PM · saved tides');
    assert.equal(app.dom.byId('header-update-time').classList.contains('is-stale'), false);
  });
}

test('marine down past the 24 h fallback cap: the alarm keeps climbing while the old forecast is on the cards', async () => {
  const { app, down, STATE, load, refreshAt, strip } = kioskScene();
  await load();
  down.marine = () => ERRORS.serviceUnavailable();   // wind and CO-OPS keep answering
  await refreshAt(23 * HOUR + 45 * MIN);
  assert.equal(STATE.dataHealth.marine.origin, 'stale-cache');
  assert.deepEqual(strip(), {
    text: 'updated 23h 45m ago', stale: false, dead: true, banner: 'FORECAST 23 H OLD — NOT UPDATING'
  });

  // 24 h 15 min: the saved copy is past the cap, marine settles 'failed',
  // but the cards still show the 11:00 forecast from memory.
  await refreshAt(24 * HOUR + 15 * MIN);
  assert.deepEqual(app.clone(STATE.dataHealth.marine), { asOf: null, origin: 'failed' });
  assert.equal(STATE.dataHealth.wind.origin, 'live');
  assert.ok(STATE.forecastData && STATE.forecastData.marine, 'old forecast still drawn');
  assert.ok(app.call('kioskDaySummary', 0), 'and the TODAY card is built from it');
  assert.equal(STATE.dataAsOf, FIXTURE_NOW_MS, 'its real age, not the live wind fetch');
  assert.deepEqual(strip(), {
    text: 'updated 24h 15m ago', stale: false, dead: true, banner: 'FORECAST 24 H OLD — NOT UPDATING'
  });

  await refreshAt(36 * HOUR + 15 * MIN);
  assert.equal(strip().banner, 'FORECAST 36 H OLD — NOT UPDATING');

  // Marine back: everything clears.
  delete down.marine;
  await refreshAt(36 * HOUR + 30 * MIN);
  assert.deepEqual(strip(), { text: 'updated just now', stale: false, dead: false, banner: '' });
});

test('boot (or the nightly reload) with marine down and no usable saved forecast: NO DATA, not "updated just now"', async () => {
  // Day 1: a good load, then the page is reopened 25 h later with the same
  // storage (the saved forecast is past its 24 h cap) and marine down.
  const first = kioskScene();
  await first.load();
  const { STATE, down, load, strip } = kioskScene({
    now: FIXTURE_NOW_MS + 25 * HOUR,
    storage: { local: first.app.localStorage.dump() }
  });
  down.marine = () => ERRORS.serviceUnavailable();
  await load();
  assert.equal(STATE.dataHealth.marine.origin, 'failed');
  assert.equal(STATE.dataHealth.wind.origin, 'live');
  assert.ok(!(STATE.forecastData && STATE.forecastData.marine), 'no forecast on the cards');
  assert.equal(STATE.dataAsOf, null);
  assert.deepEqual(strip(), { text: 'NO DATA', stale: false, dead: true, banner: 'NO FORECAST DATA — RETRYING' });
});
