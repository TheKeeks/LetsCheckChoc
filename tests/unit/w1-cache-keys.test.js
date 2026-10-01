// C02: the 6-min tide cache was written under "...-d3-h168" but read under
// "...-d-h168", so the cache-first paint never ran for Choc. Every key the
// cache-first paint reads must be one the previous load wrote.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch } = require('../helpers/load-app');
const { prepareScene, runLoad } = require('../helpers/w1-scene');

const hang = () => new Promise(() => {});

// Records every readCache key while fn runs (synchronously).
function readsDuring(app, fn) {
  app.run('globalThis.__reads = []; { const orig = readCache; readCache = function (k, t, o) { __reads.push(k); return orig(k, t, o); }; }');
  fn();
  return app.clone('__reads');
}

test('tidePredCacheKey depends only on the span fetched', () => {
  const app = loadApp();
  const key = (...a) => app.call('tidePredCacheKey', ...a);
  assert.equal(key('8510719', undefined, 168), key('8510719', 3, 168));
  assert.equal(key('8510719', 3), key('8510719', undefined, 72));
  assert.notEqual(key('8510719', 3), key('8510719', undefined, 168));
});

test('fetchTidePredictions writes the key the loads read', async () => {
  const app = loadApp({ fetch: fixtureFetch() });
  // The chart's call and the cache-first read, as _loadAllDataImpl makes them.
  await app.call('fetchTidePredictions', '8510719', undefined, 168);
  const readKey = app.call('tidePredCacheKey', '8510719', undefined, 168);
  assert.ok(app.localStorage.getItem(readKey), `${readKey} missing; have ${Object.keys(app.localStorage)}`);
});

for (const [label, start] of [
  ['buoy (Choc)', (app, choc) => ['loadAllData', choc]],
  ['pin', () => ['loadPinData', 41.2757, -71.9633]]
]) {
  test(`${label} load: every cache key the cache-first paint reads was written by the last load`, async () => {
    let offline = false;
    const app = loadApp({ fetch: fixtureFetch({ overrides: [[() => offline, hang]] }) });
    const choc = prepareScene(app);
    const [fn, ...args] = start(app, choc);
    await runLoad(app, fn, ...args);
    const written = new Set(Object.keys(app.localStorage));

    // Second load with the network hung: only the cache can paint.
    offline = true;
    const STATE = app.get('STATE');
    STATE.forecastChart = null;
    const reads = readsDuring(app, () => app.call(fn, ...args)).filter(k => k.startsWith('lcc-cache-'));
    assert.ok(reads.length >= 4, `cache-first reads: ${reads}`);
    assert.deepEqual(reads.filter(k => !written.has(k)), [], 'read keys nobody wrote');
    assert.equal(STATE.forecastChart && STATE.forecastChart.times.length, 168, 'chart painted from cache before any reply');
    assert.equal(app.dom.byId('forecast-cache-indicator').style.display, '', '"Cached · refreshing…" shown');
  });
}

test('legacy "-d3-h168" tide copies are dropped at startup', () => {
  const app = loadApp({
    storage: {
      local: {
        'lcc-cache-tide-8510719-d3-h168': '{"ts":1,"data":{}}',
        'lcc-cache-tide-8510719-d3-h': '{"ts":1,"data":{}}',
        'lcc-cache-tide-8510719-h168': '{"ts":1,"data":{}}',
        'lcc-cache-hilo-8510719-d10': '{"ts":1,"data":{}}'
      }
    }
  });
  app.call('dropLegacyTideCacheKeys');
  assert.deepEqual(Object.keys(app.localStorage).sort(), ['lcc-cache-hilo-8510719-d10', 'lcc-cache-tide-8510719-h168']);
});
