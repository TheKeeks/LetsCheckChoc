// Audit C36 (web part): the "now" pulse on the forecast chart ran a 60 fps
// rAF loop forever, even with the chart hidden on another tab or on a
// kiosk panel, re-compositing a full-size overlay canvas every frame.
// It now animates at ~10 fps, ends itself while the chart is hidden or
// scrolled away, and switchTab / the viewport observer bring it back.
// The fake clock fires rAF every 16 ms, like a 60 Hz display.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/load-app');

// Loads the app with a counting wrapper around _drawNowPulseFrame and a
// truthy STATE.forecastChart (switchTab only restarts a drawn chart).
function setup(opts) {
  const app = loadApp(opts);
  app.run('window.__pulseFrames = 0');
  app.run('{ const draw = _drawNowPulseFrame; _drawNowPulseFrame = function () { window.__pulseFrames++; return draw.apply(this, arguments); }; }');
  app.get('STATE').forecastChart = { times: [] };
  const frames = () => app.run('window.__pulseFrames');
  const running = () => app.run('_nowPulseRAF') != null;
  const container = app.dom.byId('forecast-chart-container');
  return { app, frames, running, container };
}

test('the pulse animates at about 10 fps, not 60', async () => {
  const { app, frames } = setup();
  app.call('startNowPulse');
  await app.clock.tick(2000);
  const fps = frames() / 2;
  assert.ok(fps >= 8 && fps <= 12, `${fps} pulse frames per second`);
});

test('the loop ends while the chart is hidden and switchTab brings it back', async () => {
  const { app, frames, running, container } = setup();
  app.call('startNowPulse');
  await app.clock.tick(500);
  assert.ok(running());

  // Another tab: #view-forecast is display:none, so the container has no width.
  app.call('switchTab', 'surflog');
  container.offsetWidth = 0;
  await app.clock.tick(100);
  assert.equal(running(), false, 'no rAF loop while hidden');
  const n = frames();
  await app.clock.tick(1000);
  assert.equal(frames(), n, 'no frames drawn while hidden');

  container.offsetWidth = 800;
  app.call('switchTab', 'forecast');
  assert.ok(running(), 'switchTab restarts the pulse');
  await app.clock.tick(1000);
  assert.ok(frames() - n >= 8, 'and it animates again');
});

test('scrolled off-screen pauses the pulse; scrolling back resumes it', async () => {
  const { app, frames, running } = setup();
  // A controllable IntersectionObserver in place of the stub's no-op one.
  app.run(`window.__io = null;
    IntersectionObserver = function (cb) { window.__io = { cb, observed: [] }; this.observe = el => window.__io.observed.push(el); this.disconnect = () => {}; };`);
  app.call('startNowPulse');
  await app.clock.tick(300);
  assert.equal(app.run('window.__io.observed[0] && window.__io.observed[0].id'), 'forecast-chart-container');

  app.run('window.__io.cb([{ isIntersecting: false }])');
  await app.clock.tick(100);
  assert.equal(running(), false);
  const n = frames();
  await app.clock.tick(1000);
  assert.equal(frames(), n);

  app.run('window.__io.cb([{ isIntersecting: true }])');
  assert.ok(running());
  await app.clock.tick(1000);
  assert.ok(frames() - n >= 8);
});

test('a full chart draw restarts a stopped pulse (kiosk radar redraw path)', async () => {
  const { app, running, container } = setup();
  app.call('startNowPulse');
  container.offsetWidth = 0;                 // kiosk days panel: #panel-forecast hidden
  await app.clock.tick(100);
  assert.equal(running(), false);
  container.offsetWidth = 800;               // radar panel shows the chart again
  app.call('startNowPulse');                 // what _drawForecastChartFull ends with
  assert.ok(running());
});
