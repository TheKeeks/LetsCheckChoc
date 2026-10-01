// C01: the dead NDBC CORS relays sat on the forecast's critical path (the
// chart waited ~15 s and the spectra ~34 s on every load). The relay list
// is now empty, Choc reads the pipeline's data/buoy.json, and live NDBC (if
// a working relay is ever re-added) never gates the chart.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, readFixture } = require('../helpers/load-app');
const { prepareScene, buoyById, settle } = require('../helpers/w1-scene');

const RELAY = /corsproxy\.io|allorigins\.win|codetabs\.com|ndbc\.noaa\.gov|relay\.test/;
const hang = () => new Promise(() => {});
const relayRequests = app => app.fetchLog.filter(r => RELAY.test(r.url));
// fixtureFetch, with every data API answering after 50 ms of fake time.
const slowFixtures = overrides => {
  const base = fixtureFetch({ overrides });
  return async (url, init) => {
    const d = await base(url, init);
    return d && typeof d === 'object' && !d.delayMs ? Object.assign({ delayMs: 50 }, d) : d;
  };
};
const chartHours = app => {
  const c = app.get('STATE').forecastChart;
  return c && c.times ? c.times.length : 0;
};

test('no NDBC relay is configured, so the NDBC fetchers answer null at once', async () => {
  const app = loadApp({ fetch: () => hang() });
  assert.equal(app.run('CONFIG.api.ndbcProxies.length'), 0);
  const stdmet = app.call('fetchNDBCStdmet', '44097');
  const spectral = app.call('fetchNDBCSpectral', '44097');
  await app.clock.flush();   // no timer needs to fire
  assert.equal(await stdmet, null);
  assert.deepEqual(app.clone(await spectral), { spec: null, dataSpec: null, swdir: null, swdir2: null, swr1: null, swr2: null });
  assert.equal(app.fetchLog.length, 0);
});

test('Choc: chart and spectra come up without one relay request while every relay hangs', async () => {
  const app = loadApp({ fetch: slowFixtures([[RELAY, hang]]) });
  const choc = prepareScene(app);
  const load = app.call('loadAllData', choc);
  await app.clock.tick(100);
  assert.equal(chartHours(app), 168, 'chart drawn ~100 ms after selection');
  const ms = await settle(app, load);
  assert.ok(ms < 1000, `whole load took ${ms + 100} ms of fake time`);
  assert.equal(app.get('STATE').lastSpectral.bins.length, 98, 'spectra from the pipeline');
  assert.deepEqual(relayRequests(app).map(r => r.url), []);
});

test('non-Choc buoy: a hanging relay never holds the chart back', async () => {
  const app = loadApp({ fetch: slowFixtures([[RELAY, hang]]) });
  prepareScene(app);
  app.run("CONFIG.api.ndbcProxies.push({ name: 'hung', wrap: u => 'https://relay.test/?url=' + encodeURIComponent(u) })");
  app.call('loadAllData', buoyById(app, '44025'));
  await app.clock.tick(200);
  assert.equal(chartHours(app), 168,
    'chart drawn while the relay still hangs (it used to wait out a 15 s timeout per relay)');
  assert.ok(relayRequests(app).length >= 1, 'the relay was tried, in parallel');
});

test('non-Choc buoy: a working relay patches the buoy reading in when it lands', async () => {
  const stdmet = readFixture('ndbc/44097.txt');
  const app = loadApp({
    fetch: slowFixtures([
      [/relay\.test.*\.txt$/, { status: 200, body: stdmet, delayMs: 3000 }],
      [/relay\.test/, { status: 404, body: '' }]
    ])
  });
  prepareScene(app);
  app.run("CONFIG.api.ndbcProxies.push({ name: 'relay', wrap: u => 'https://relay.test/?url=' + encodeURIComponent(u) })");
  const load = app.call('loadAllData', buoyById(app, '44025'));
  await app.clock.tick(200);
  const footer = () => app.dom.byId('footer-swell').innerHTML;
  assert.equal(chartHours(app), 168, 'chart first');
  assert.match(footer(), /^Open-Meteo Marine/, 'model nowcast until the buoy text arrives');
  await settle(app, load);
  assert.match(footer(), /^ndbc 44025 · Long Island, NY · obs 10:00 AM/, 'then the live reading, with its obs time');
  assert.equal(app.dom.byId('val-swell-height').textContent, '2.0 ft');
  assert.equal(app.get('STATE').dataHealth.buoy.origin, 'live');
});
