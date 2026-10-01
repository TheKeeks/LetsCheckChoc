// Guards the shared vm loader (tests/helpers/load-app.js) itself: if these
// fail, every other unit test's results are suspect.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, FIXTURE_NOW_MS, ERRORS } = require('../helpers/load-app');

test('app.js and kiosk.js load to completion in the vm sandbox', () => {
  const app = loadApp({ kiosk: true });
  // A late top-level const proves the whole script ran (a throw part-way
  // leaves later consts in the temporal dead zone).
  assert.equal(app.run('typeof _regLOOCache'), 'object');
  assert.equal(typeof app.get('kioskDaySummary'), 'function');
  // kiosk.js without ?kiosk=1 defines functions but must not boot.
  assert.equal(app.document.body.classList.contains('kiosk'), false);
});

test('?kiosk=1 takes kiosk.js boot branch (gate seeded, body flagged)', () => {
  const app = loadApp({ kiosk: true, search: '?kiosk=1' });
  assert.equal(app.document.body.classList.contains('kiosk'), true);
  assert.equal(app.document.body.dataset.kioskPanel, 'days1');
  assert.equal(app.sessionStorage.getItem('lcc-gate'), 'no');
  assert.ok(app.document.listeners('DOMContentLoaded').some(f => f === app.get('kioskInit')));
});

test('fake clock: Date starts at FIXTURE_NOW, stands still, tick fires timers in order', async () => {
  const app = loadApp();
  assert.equal(app.run('Date.now()'), FIXTURE_NOW_MS);
  assert.equal(app.run('new Date().getTime()'), FIXTURE_NOW_MS);
  assert.equal(app.run('new Date() instanceof Date'), true);
  app.run('globalThis.__seen = []; setTimeout(() => __seen.push("b"), 200); setTimeout(() => __seen.push("a"), 100); setInterval(() => __seen.push("i"), 150);');
  await app.clock.tick(99);
  assert.deepEqual(app.clone('__seen'), []);
  await app.clock.tick(201);
  assert.deepEqual(app.clone('__seen'), ['a', 'i', 'b', 'i']);
  assert.equal(app.run('Date.now()'), FIXTURE_NOW_MS + 300);
});

test('fake clock: fastForward fires each due timer once', async () => {
  const app = loadApp();
  app.run('globalThis.__n = 0; globalThis.__t = 0; setInterval(() => __n++, 1000); setTimeout(() => __t++, 60000);');
  await app.clock.fastForward(15 * 60 * 1000);
  assert.equal(app.run('__n'), 1);
  assert.equal(app.run('__t'), 1);
  await app.clock.tick(1000);
  assert.equal(app.run('__n'), 2, 'interval resumes from the new time');
});

test('fetch is offline by default; injected fetch is logged and honoured', async () => {
  const offline = loadApp();
  assert.equal(await offline.call('fetchJSON', 'https://example.test/x.json'), null);
  assert.equal(offline.fetchLog.length, 1);

  const app = loadApp({ fetch: fixtureFetch() });
  const marine = await app.call('fetchMarineForecast', 41.089152, -71.72105, '');
  assert.equal(marine.hourly.time.length, 168);
  assert.match(app.fetchLog[0].url, /^https:\/\/marine-api\.open-meteo\.com\/v1\/marine\?/);
  assert.equal(app.fetchLog[0].t, FIXTURE_NOW_MS);
  // The fetcher cached the response in the stubbed localStorage.
  assert.ok(Object.keys(app.localStorage).some(k => k.startsWith('lcc-cache-marine-')));
});

test('an aborted fetch rejects with AbortError (fetchJSON timeout path)', async () => {
  const app = loadApp({ fetch: () => new Promise(() => {}) });   // never answers
  const p = app.call('fetchJSON', 'https://marine-api.open-meteo.com/v1/marine', 5000);
  await app.clock.tick(5000);
  assert.equal(await p, null);
  assert.ok(app.logs.some(l => l.level === 'warn' && /aborted/i.test(String(l.args[2]))));
});

test('fixtureFetch overrides: canned NOAA error body, slow replies lose to the abort timer', async () => {
  const app = loadApp({
    fetch: fixtureFetch({
      overrides: [
        ['interval=hilo', ERRORS.coopsNoPredictions()],
        [/open-meteo\.com\/v1\/forecast/, { status: 200, json: { hourly: {} }, delayMs: 20000 }],
        ['codetabs', 'network-error']
      ]
    })
  });
  const hilo = await app.call('fetchJSON', 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=hilo');
  assert.match(hilo.error.message, /^No Predictions data was found/);
  const slow = app.call('fetchJSON', 'https://api.open-meteo.com/v1/forecast?x=1', 10000);
  await app.clock.tick(10000);
  assert.equal(await slow, null);
  assert.equal(await app.call('fetchText', 'https://api.codetabs.com/v1/proxy?quest=x'), null);
  // Pinned pipeline snapshot, not the bot-updated data/buoy.json.
  const pipe = await app.call('fetchJSON', 'data/buoy.json');
  assert.equal(pipe.fetch_time, '2026-10-01T13:15:38.173974+00:00');
});

test('storage seeds and DOM writes are readable', () => {
  const app = loadApp({ storage: { local: { 'lcc-forecast-model': 'ecmwf_wam' }, session: { 'lcc-gate': 'no' } } });
  assert.equal(app.call('getForecastModel'), 'ecmwf_wam');
  app.call('setFooter', 'footer-forecast', 'plain text');
  assert.equal(app.dom.byId('footer-forecast').textContent, 'plain text');
});

test('firebase stub + real firebase-config.js: anonymous sign-in after the delay', async () => {
  const app = loadApp({ firebase: true });
  assert.equal(app.run('window._fbUserId'), null);
  await app.clock.tick(3000);
  assert.equal(app.run('window._fbUserId'), 'anon-1');
  assert.equal(app.run('window._fbUserIsAnon'), true);
});
