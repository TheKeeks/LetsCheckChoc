// C03: the forecast used to wait for Firebase (initApp awaited the surf log
// before selecting Choc: 2-15 s). Boot selects Choc as soon as the buoy list
// is in and loads the surf log in the background. The page starts the app
// itself on DOMContentLoaded (startApp); the old boat question is gone.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, fixtureFetch, REPO_ROOT } = require('../helpers/load-app');
const marineRequests = app => app.fetchLog.filter(r => r.url.includes('marine-api.open-meteo.com'));

function boot(opts) {
  return loadApp(Object.assign({ fetch: fixtureFetch() }, opts));
}
const hours = STATE => STATE.forecastData && STATE.forecastData.marine && STATE.forecastData.marine.hourly.time.length;

test('Choc is selected and its forecast drawn while Firebase auth is still pending', async () => {
  // First auth event only after 60 s: the old boot sat in loadSurfLog until then.
  const app = boot({ firebase: { firstAuthMs: 60000 } });
  app.fire('DOMContentLoaded');
  await app.clock.tick(500);
  const STATE = app.get('STATE');
  assert.equal(STATE.selectedBuoy && STATE.selectedBuoy.id, '44097');
  assert.equal(marineRequests(app).length, 1);
  assert.equal(hours(STATE), 168);
  // Auth still settles in the background.
  await app.clock.fastForward(60000);
  await app.clock.tick(5000);
  assert.equal(app.run('window._fbUserId'), 'anon-1');
});

test('Choc TV boot loads once (the watchdog and initApp no longer both select)', async () => {
  const app = boot({ kiosk: true, search: '?kiosk=1', firebase: true });
  app.fire('DOMContentLoaded');
  for (let i = 0; i < 10; i++) await app.clock.tick(500);
  assert.equal(app.get('_loadGen'), 1);
  assert.equal(marineRequests(app).length, 1);
  assert.ok(app.get('STATE').lastLoadCompletedAt);
});

// ── index.html: one look, nothing from another origin in <head> ──
const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));

test('index.html loads none of the old look: no Win95 sheets, Leaflet or Google Fonts', () => {
  assert.doesNotMatch(html, /leaflet|fonts\.googleapis|styles-web1|styles-retro|styles-kiosk|classic=1|LCC_CLASSIC/);
  assert.match(html, /<script src="kiosk\.js"><\/script>/, 'Choc TV\'s reload probe looks for kiosk.js in the page');
  // Nothing in <head> loads from another origin (a stalled CDN can't hold first paint).
  const tags = head.match(/<(link|script)[^>]*>/g) || [];
  assert.deepEqual(tags.filter(t => /(href|src)="https?:/.test(t)), []);
});

test('the start-up starts the app once, on DOMContentLoaded', async () => {
  const app = boot({ firebase: true });
  app.fire('DOMContentLoaded');
  app.call('startApp');
  for (let i = 0; i < 4; i++) await app.clock.tick(500);
  assert.equal(app.get('_loadGen'), 1);
  assert.equal(app.get('STATE').appStarted, true);
});
