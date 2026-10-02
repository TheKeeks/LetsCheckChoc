// Choc TV status strip (audit C30): "updated X ago" must be the age of the
// data on screen, not of the last load attempt. fetchJSON swallows errors,
// so a refresh where the forecast fetch failed still finished a load, and
// the strip used to read "updated just now" over hours-old cards.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, REPO_ROOT, FIXTURE_NOW_MS } = require('../helpers/load-app');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const REFRESH = 15 * MIN;
const CHOC = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/buoys-east-coast.json'), 'utf8'))
  .find(b => b.home === 'chocomount');

// Choc TV booted in the vm with the data load stubbed out: tests drive
// STATE and the forecast caches by hand, as a finished load would.
function bootKiosk() {
  const app = loadApp({ kiosk: true, search: '?kiosk=1' });
  app.set('loadAllData', function () {});
  app.call('kioskInit');
  return app;
}

function strip(app) {
  const banner = app.dom.byId('kiosk-stale-banner');
  return {
    text: app.dom.byId('kiosk-status-updated').textContent,
    stale: app.dom.byId('kiosk-status').classList.contains('np-stale'),
    dead: app.dom.byId('kiosk-status').classList.contains('np-dead'),
    banner: banner.style.display === 'none' ? '' : banner.textContent
  };
}

// What a load that fetched `which` sources writes: the real cache keys
// _loadAllDataImpl uses for Chocomount.
function writeCaches(app, which) {
  const keys = {
    marine: 'marineCacheKey(CONFIG.chocomount.forecastLat, CONFIG.chocomount.forecastLon, getForecastModel())',
    wind: 'windCacheKey(CONFIG.chocomount.lat, CONFIG.chocomount.lon)',
    tides: "tideHiLoCacheKey('8510719', 10)"
  };
  for (const w of which) app.run(`writeCache(${keys[w]}, { ok: true })`);
}

function finishLoad(app) {
  app.get('STATE').lastLoadCompletedAt = app.clock.now();
}

test('kioskFreshness: loading → fresh → stale → dead, and NO DATA', () => {
  const app = loadApp({ kiosk: true });
  const now = FIXTURE_NOW_MS;
  const f = (done, asOf) => app.clone(app.call('kioskFreshness', now, done, asOf, REFRESH));

  assert.equal(f(null, null).level, 'loading');
  assert.equal(f(null, null).text, 'loading…');
  assert.equal(f(null, now - 5 * HOUR).level, 'loading', 'no finished load yet → still loading');

  const none = f(now, null);
  assert.equal(none.level, 'nodata');
  assert.equal(none.text, 'NO DATA');
  assert.match(none.banner, /NO FORECAST DATA/);

  assert.deepEqual(f(now, now - 5 * MIN), { level: 'fresh', ageMs: 5 * MIN, text: 'updated 5 min ago', banner: '' });
  // Stale = two missed 15-min refreshes plus 10 min of slack (40 min).
  assert.equal(f(now, now - 40 * MIN).level, 'fresh');
  assert.equal(f(now, now - 41 * MIN).level, 'stale');
  assert.equal(f(now, now - 41 * MIN).banner, '');
  assert.equal(f(now, now - 3 * HOUR).level, 'stale');
  // Dead = over 3 h: the banner says how old, readable across the room.
  const dead = f(now, now - 3 * HOUR - MIN);
  assert.equal(dead.level, 'dead');
  assert.equal(dead.text, 'updated 3h 1m ago');
  assert.equal(dead.banner, 'FORECAST 3 H OLD — NOT UPDATING');
  assert.equal(f(now, now - 50 * HOUR).banner, 'FORECAST 2 DAYS OLD — NOT UPDATING');
  // The stale bound follows the refresh cadence (?kioskRefresh=…).
  assert.equal(app.clone(app.call('kioskFreshness', now, now, now - 13 * MIN, 60 * 1000)).level, 'stale');
});

test('status strip: a refresh whose forecast fetch failed shows the true age, then stale, then dead', async () => {
  const app = bootKiosk();
  const S = app.get('STATE');
  assert.equal(strip(app).text, 'loading…');

  S.selectedBuoy = CHOC;
  S.isChocomount = true;
  S.nearestTideStation = { id: '8510719' };
  S.forecastData = { marine: { hourly: {} }, wind: { hourly: {} }, tideHiLo: [] };
  writeCaches(app, ['marine', 'wind', 'tides']);
  finishLoad(app);
  await app.clock.tick(1000);
  assert.deepEqual(strip(app), { text: 'updated just now', stale: false, dead: false, banner: '' });

  // 45 min on, the Open-Meteo marine fetch fails; wind and tides refresh.
  // The cards still show the 11:00 forecast, so the strip must say so.
  await app.clock.fastForward(45 * MIN);
  writeCaches(app, ['wind', 'tides']);
  finishLoad(app);
  await app.clock.tick(1000);
  assert.deepEqual(strip(app), { text: 'updated 45 min ago', stale: true, dead: false, banner: '' });

  // Three hours later still no forecast: red pilot + banner.
  await app.clock.fastForward(3 * HOUR);
  writeCaches(app, ['wind', 'tides']);
  finishLoad(app);
  await app.clock.tick(1000);
  const s = strip(app);
  assert.equal(s.text, 'updated 3h 45m ago');
  assert.equal(s.stale, false);
  assert.equal(s.dead, true);
  assert.equal(s.banner, 'FORECAST 3 H OLD — NOT UPDATING');

  // The forecast comes back: everything clears.
  writeCaches(app, ['marine', 'wind', 'tides']);
  finishLoad(app);
  await app.clock.tick(1000);
  assert.deepEqual(strip(app), { text: 'updated just now', stale: false, dead: false, banner: '' });
});

test('status strip: saved tide predictions never age a fresh forecast (cache-derived age agrees with app.js)', async () => {
  const app = bootKiosk();
  const S = app.get('STATE');
  S.selectedBuoy = CHOC;
  S.isChocomount = true;
  S.nearestTideStation = { id: '8510719' };
  S.forecastData = { marine: { hourly: {} }, wind: { hourly: {} }, tideHiLo: [{ t: '2026-10-01 14:00', v: '0.1', type: 'L' }] };
  writeCaches(app, ['tides']);             // CO-OPS answered once, at 11:00…
  await app.clock.fastForward(4 * HOUR);
  writeCaches(app, ['marine', 'wind']);    // …then only Open-Meteo, for 4 h
  finishLoad(app);
  await app.clock.tick(1000);
  assert.deepEqual(strip(app), { text: 'updated just now', stale: false, dead: false, banner: '' });
});

test('status strip: a finished load with nothing to show reads NO DATA (not "updated just now")', async () => {
  const app = bootKiosk();
  const S = app.get('STATE');
  S.selectedBuoy = CHOC;
  finishLoad(app);                    // every fetch failed: no STATE.forecastData
  await app.clock.tick(1000);
  const s = strip(app);
  assert.equal(s.text, 'NO DATA');
  assert.equal(s.dead, true);
  assert.match(s.banner, /NO FORECAST DATA/);
});

test('status strip: STATE.dataAsOf from app.js wins when present (shared load-path contract)', async () => {
  const app = bootKiosk();
  const S = app.get('STATE');
  // A load-path build may initialise dataAsOf to null: still "loading…"
  // until a load has finished.
  S.dataAsOf = null;
  await app.clock.tick(1000);
  assert.equal(strip(app).text, 'loading…');
  assert.equal(strip(app).dead, false);

  S.selectedBuoy = CHOC;
  S.forecastData = { marine: { hourly: {} } };
  writeCaches(app, ['marine']);       // the cache says "just now"…
  S.dataAsOf = app.clock.now() - 50 * MIN; // …but app.js knows it served a stale copy
  finishLoad(app);
  await app.clock.tick(1000);
  assert.deepEqual(strip(app), { text: 'updated 50 min ago', stale: true, dead: false, banner: '' });

  S.dataAsOf = null;                  // load finished, nothing rendered
  finishLoad(app);
  await app.clock.tick(1000);
  assert.equal(strip(app).text, 'NO DATA');
  assert.equal(strip(app).dead, true);
});

test('SOURCES card footer: per-source data health and the boot code signature', () => {
  const app = bootKiosk();
  const S = app.get('STATE');
  app.run("KIOSK.codeSig = '0123abcd-9xz'");
  let html = app.call('kioskInfoStatusHTML');
  assert.match(html, /Choc TV build 0123abc · running since 11:00 AM/);
  assert.doesNotMatch(html, /Data:/, 'no health line until app.js publishes STATE.dataHealth');

  const now = app.clock.now();
  S.dataHealth = {
    marine: { asOf: now - 2 * HOUR, origin: 'stale-cache' },
    wind: { asOf: now, origin: 'live' },
    tides: { asOf: null, origin: 'failed' },
    buoy: { obsMs: now - 90 * MIN, origin: 'pipeline' }
  };
  html = app.call('kioskInfoStatusHTML');
  assert.match(html, /Swell: stale-cache \(2h ago\) · Wind: live \(just now\) · Tides: failed · Buoy: pipeline \(1h 30m ago\)/);

  // The card shows it on every panel.
  app.call('kioskToggleInfo', true);
  assert.match(app.dom.byId('kiosk-info-card').innerHTML, /Choc TV build 0123abc/);
});
