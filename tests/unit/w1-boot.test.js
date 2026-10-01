// C03 + C04: the forecast used to wait for Firebase (initApp awaited the
// surf log before selecting Choc: 2-15 s), and a Leaflet CDN failure threw
// inside initApp so no forecast request was ever made. Boot now selects
// Choc as soon as the buoy list is in, loads the surf log in the
// background, and treats the maps as optional.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, fixtureFetch, REPO_ROOT, fixturePath } = require('../helpers/load-app');
const { wireCanvasParents, LEAFLET_STUB } = require('../helpers/w1-scene');

const GATE_NO = { session: { 'lcc-gate': 'no' } };
const marineRequests = app => app.fetchLog.filter(r => r.url.includes('marine-api.open-meteo.com'));

function boot(opts) {
  const app = loadApp(Object.assign({ fetch: fixtureFetch(), storage: GATE_NO }, opts));
  wireCanvasParents(app);
  return app;
}

test('Choc is selected and its forecast drawn while Firebase auth is still pending', async () => {
  // First auth event only after 60 s: the old boot sat in loadSurfLog until then.
  const app = boot({ firebase: { firstAuthMs: 60000 } });
  app.run(LEAFLET_STUB);   // maps load fine; only Firebase is slow
  app.fire('DOMContentLoaded');
  await app.clock.tick(500);
  const STATE = app.get('STATE');
  assert.equal(STATE.selectedBuoy && STATE.selectedBuoy.id, '44097');
  assert.equal(marineRequests(app).length, 1);
  assert.equal(STATE.forecastChart && STATE.forecastChart.times.length, 168);
  // Auth still settles in the background.
  await app.clock.fastForward(60000);
  await app.clock.tick(5000);
  assert.equal(app.run('window._fbUserId'), 'anon-1');
});

test('Choc TV boot loads once (the watchdog and initApp no longer both select)', async () => {
  const app = boot({ kiosk: true, search: '?kiosk=1', firebase: true });
  app.run(LEAFLET_STUB);
  app.fire('DOMContentLoaded');
  for (let i = 0; i < 10; i++) await app.clock.tick(500);
  assert.equal(app.get('_loadGen'), 1);
  assert.equal(marineRequests(app).length, 1);
  assert.ok(app.get('STATE').lastLoadCompletedAt);
});

test('no Leaflet (CDN or vendor file failed): the forecast still loads', async () => {
  const app = boot({ firebase: true });
  assert.equal(app.run('typeof L'), 'undefined');
  app.fire('DOMContentLoaded');
  await app.clock.tick(500);
  const STATE = app.get('STATE');
  assert.equal(STATE.selectedBuoy && STATE.selectedBuoy.id, '44097');
  assert.equal(STATE.forecastChart && STATE.forecastChart.times.length, 168);
  for (let i = 0; i < 4; i++) await app.clock.tick(500);
  assert.ok(STATE.lastLoadCompletedAt, 'load completes (tide-map recentre is skipped)');
  assert.ok(app.logs.some(l => /Leaflet unavailable/.test(String(l.args[0]))));
});

test('a map init that throws part-way does not stop the forecast', async () => {
  const app = boot({ firebase: true });
  app.run(LEAFLET_STUB + " L.map = function () { throw new Error('tiles exploded'); };");
  app.fire('DOMContentLoaded');
  await app.clock.tick(500);
  assert.equal(app.get('STATE').forecastChart.times.length, 168);
});

// ── index.html: no render-blocking / single-point-of-failure CDNs ──
const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const md5 = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

test('Leaflet is served from vendor/leaflet, never unpkg', () => {
  assert.doesNotMatch(html, /unpkg\.com/);
  assert.match(head, /<link rel="stylesheet" href="vendor\/leaflet\/leaflet\.css"/);
  assert.match(html, /<script src="vendor\/leaflet\/leaflet\.js"><\/script>\s*<script src="firebase-config\.js">/);
});

test('the vendored Leaflet is the genuine 1.9.4 build', () => {
  const dir = path.join(REPO_ROOT, 'vendor/leaflet');
  // tests/fixtures/vendor holds unpkg's bytes (see tests/fixtures/README.md).
  assert.equal(md5(path.join(dir, 'leaflet.js')), md5(fixturePath('vendor/leaflet-1.9.4.js')));
  assert.equal(md5(path.join(dir, 'leaflet.css')), md5(fixturePath('vendor/leaflet-1.9.4.css')));
  assert.equal(md5(path.join(dir, 'leaflet.js')), '35b48eb991f383702f153452506e07b2');
  assert.match(fs.readFileSync(path.join(dir, 'leaflet.js'), 'utf8').slice(0, 120), /Leaflet 1\.9\.4,/);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /BSD 2-Clause/);
});

test('Google Fonts cannot block first paint', () => {
  const links = head.match(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/g) || [];
  assert.equal(links.length, 2, 'one async link + one <noscript> fallback');
  assert.match(links[0], /media="print" onload="this\.media='all'"/);
  assert.match(head, /<noscript><link[^>]*fonts\.googleapis\.com\/css2[^>]*><\/noscript>/);
  // Every other stylesheet in <head> is same-origin.
  const sheets = (head.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').match(/<link[^>]*rel="stylesheet"[^>]*>/g) || [])
    .filter(l => !/media="print"/.test(l));
  assert.deepEqual(sheets.filter(l => /href="https?:/.test(l)), []);
});
