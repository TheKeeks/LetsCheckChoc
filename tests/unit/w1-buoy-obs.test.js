// C08: the pipeline's buoy reading (every 2-8 h) was shown as "Swell:
// Current" with no time, drawn on the chart's now line, and its arrival
// line read as an ETA from now. The obs time is now parsed once, shown with
// its age (amber > 2 h, red > 6 h), placed on the chart at its own time,
// and the arrival is a clock time counted from the observation.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, FIXTURE_NOW_MS } = require('../helpers/load-app');
const { prepareScene, runLoad } = require('../helpers/w1-scene');

const HOUR = 3600e3;
const OBS_MS = Date.UTC(2026, 9, 1, 12, 30);   // pipeline buoy.time "2026-10-01 12:30 UTC" = 8:30 AM EDT

async function chocAt(nowMs) {
  const app = loadApp({ fetch: fixtureFetch(), now: nowMs });
  const choc = prepareScene(app);
  app.get('STATE').isChocomount = true;
  await runLoad(app, 'loadAllData', choc);
  return app;
}

test('buoyObsAge: fresh / stale past 2 h / old past 6 h, with a readable age', () => {
  const app = loadApp();
  const age = ms => app.clone(app.call('buoyObsAge', FIXTURE_NOW_MS - ms, FIXTURE_NOW_MS));
  assert.deepEqual(age(30 * 60e3), { ageMs: 30 * 60e3, label: '30 min ago', level: 'fresh' });
  assert.deepEqual(age(2 * HOUR), { ageMs: 2 * HOUR, label: '2h ago', level: 'fresh' });
  assert.deepEqual(age(5 * HOUR), { ageMs: 5 * HOUR, label: '5h ago', level: 'stale' });
  assert.deepEqual(age(7 * HOUR), { ageMs: 7 * HOUR, label: '7h ago', level: 'old' });
  assert.equal(app.call('buoyObsAge', null, FIXTURE_NOW_MS), null);
});

test('obs time is parsed once and tagged with its buoy and source', async () => {
  const app = loadApp();
  assert.equal(app.call('parseBuoyObsTime', '2026-10-01 12:30 UTC'), OBS_MS);
  assert.equal(app.call('parseBuoyObsTime', 'pipeline data'), null);
  const loaded = await chocAt(FIXTURE_NOW_MS);
  const parsed = loaded.clone('STATE._cachedBuoyParsed');
  assert.equal(parsed.obsMs, OBS_MS);
  assert.equal(parsed.buoyId, '44097');
  assert.equal(parsed.src, 'pipeline');
});

test('swell card at 11:00 (obs 2h 30m old): amber, obs time + age, arrival from the obs', async () => {
  const app = await chocAt(FIXTURE_NOW_MS);
  const card = app.dom.byId('card-swell');
  assert.ok(card.classList.contains('is-stale'));
  assert.ok(!card.classList.contains('is-old'));
  const extra = app.dom.byId('val-swell-arrival');
  assert.equal(extra.style.display, '');
  // 8.7 s band peak → ~3 hr 18 min from 50 mi out, counted from 8:30.
  assert.equal(extra.textContent, 'Buoy obs 8:30 AM (2h 30m ago) · reaches Choc ~11:48 AM');
  assert.match(app.dom.byId('footer-swell').innerHTML, /^ndbc 44097 · Block Island, RI · obs 8:30 AM · /);
});

test('swell card at 4:00 PM (obs 7h 30m old): red, and the swell has already "reached" Choc', async () => {
  const app = await chocAt(FIXTURE_NOW_MS + 5 * HOUR);
  assert.ok(app.dom.byId('card-swell').classList.contains('is-old'));
  assert.equal(app.dom.byId('val-swell-arrival').textContent, 'Buoy obs 8:30 AM (7h 30m ago) · reached Choc ~11:48 AM');
});

test('chart: the obs diamond sits at the observation time, not on the now line', async () => {
  const app = await chocAt(FIXTURE_NOW_MS);
  const { common } = app.get('STATE')._forecastPanelPayloads;
  const plotW = 800 - 44 - 40;   // vm canvas clientWidth − FC_PAD.left − FC_PAD.right
  const xAt = ms => 44 + ((ms - common.t0) / common.tRange) * plotW;
  const obsLabel = app.dom.byId('forecast-canvas-swell').getContext('2d').__calls
    .filter(c => c.fn === 'fillText' && c.args[0] === 'obs').pop();
  assert.ok(obsLabel, 'obs marker drawn');
  assert.ok(Math.abs(obsLabel.args[1] - (xAt(OBS_MS) + 7)) < 0.5, `obs at x=${obsLabel.args[1]}, want ${xAt(OBS_MS) + 7}`);
  assert.ok(Math.abs(obsLabel.args[1] - (xAt(FIXTURE_NOW_MS) + 7)) > 5, 'not on the now line');
});

test('chart: an obs older than 6 h is not drawn at all', async () => {
  const app = await chocAt(FIXTURE_NOW_MS + 5 * HOUR);
  const calls = app.dom.byId('forecast-canvas-swell').getContext('2d').__calls;
  assert.deepEqual(calls.filter(c => c.fn === 'fillText' && c.args[0] === 'obs'), []);
});
