// C09: every non-Choc spectral buoy showed Block Island 44097's spectrum
// and swell table (the pipeline file) under its own name, and a cached 44097
// reading could paint under another buoy. Pipeline data is now used only
// for the buoy it belongs to; other buoys get an honest empty state.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, readFixtureJSON } = require('../helpers/load-app');
const { prepareScene, buoyById, runLoad } = require('../helpers/w1-scene');

const PIPE = readFixtureJSON('pipeline/buoy.json');
const hang = () => new Promise(() => {});

test('pipelineSpectralFor only returns bins for the pipeline\'s own buoy', () => {
  const app = loadApp();
  assert.equal(app.call('pipelineSpectralFor', { id: '41009' }, PIPE), null);
  assert.equal(app.call('pipelineSpectralFor', { id: '44097', home: 'chocomount' }, null), null);
  assert.equal(app.call('pipelineSpectralFor', { id: '44097' }, Object.assign({}, PIPE, { spectral_bins: [] })), null);
  const own = app.call('pipelineSpectralFor', { id: '44097', home: 'chocomount' }, PIPE);
  assert.equal(own.bins.length, 98);
  assert.equal(own.freqs[0], 0.025);
  assert.equal(app.call('buoyParsedFromPipeline', PIPE, { id: '44025' }), null);
});

test('a non-Choc spectral buoy shows an honest empty state, not 44097\'s spectrum', async () => {
  const app = loadApp({ fetch: fixtureFetch() });
  const choc = prepareScene(app);
  await runLoad(app, 'loadAllData', choc);   // Choc first: its spectrum is on screen
  const STATE = app.get('STATE');
  assert.equal(STATE.lastSpectral.bins.length, 98);

  await runLoad(app, 'loadAllData', buoyById(app, '44025'));
  assert.equal(STATE.lastSpectral, null, '44097 bins dropped');
  assert.equal(STATE.lastSpecSummary, null);
  assert.equal(app.dom.byId('compass-canvas').style.display, 'none');
  assert.equal(app.dom.byId('panel-spectral-summary').style.display, 'none');
  const msgs = app.dom.byId('compass-canvas-wrap').children.filter(c => c.className === 'spectral-empty-msg');
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].textContent, /^No live spectrum for 44025: NDBC doesn't allow browser requests/);
  const footer = app.dom.byId('footer-compass').textContent;
  assert.equal(footer, 'ndbc 44025 · no spectral data currently available');
  assert.equal(STATE.dataHealth.buoy.origin, 'failed');
});

test('a cached 44097 reading never paints under another buoy\'s name', async () => {
  let offline = false;
  const app = loadApp({ fetch: fixtureFetch({ overrides: [[() => offline, hang]] }) });
  const choc = prepareScene(app);
  // 41001 sits far offshore (no tide station), so its cache-first paint
  // needs only marine + wind.
  const other = buoyById(app, '41001');
  await runLoad(app, 'loadAllData', other);   // warms 41001's forecast caches
  await runLoad(app, 'loadAllData', choc);    // STATE._cachedBuoyParsed = 44097's obs
  offline = true;
  app.call('loadAllData', other);             // cache-first paint only
  const height = app.dom.byId('val-swell-height').textContent;
  const detail = app.dom.byId('val-swell-detail').textContent;
  assert.notEqual(height, '2.0 ft', '44097 WVHT leaked');
  assert.doesNotMatch(detail, /ESE \(120°\)|SE \(124°\)/, '44097 direction leaked');
  assert.match(app.dom.byId('footer-swell').innerHTML, /^Open-Meteo Marine/);
});

test('a cold switch blanks the whole swell card while the new buoy loads', async () => {
  const app = loadApp({ fetch: fixtureFetch() });
  const choc = prepareScene(app);
  await runLoad(app, 'loadAllData', choc);
  assert.match(app.dom.byId('val-swell-detail').textContent, /ft total$/);
  app.call('loadAllData', buoyById(app, '41009'));   // no cache for Canaveral
  assert.equal(app.dom.byId('val-swell-height').textContent, '···');
  assert.equal(app.dom.byId('val-swell-detail').textContent, '···');
  assert.equal(app.dom.byId('footer-swell').textContent, '');
  assert.equal(app.dom.byId('val-swell-arrival').style.display, 'none');
});
