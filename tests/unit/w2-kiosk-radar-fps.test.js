// Choc TV radar (audit C36a): kioskRadarPaint redraws the whole full-screen
// scope, and the radar panel is up ~74% of the time. The sweep loop used
// to paint on every animation frame (60 fps); it is capped at ~20 fps
// without slowing the sweep.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/load-app');

test('radar sweep paints at most ~20 times a second and still turns 36°/s', async () => {
  const app = loadApp({ kiosk: true, search: '?kiosk=1' });   // fake rAF: one frame per 16 ms
  app.document.body.dataset.kioskPanel = 'radar';
  app.run('globalThis.__paints = 0; kioskRadarPaint = function () { __paints++; };');
  app.run('KIOSK_RADAR.lastT = 0; KIOSK_RADAR.sweep = 0; KIOSK_RADAR.raf = requestAnimationFrame(kioskRadarLoop);');

  await app.clock.tick(1000);
  const paints = app.run('__paints');
  assert.ok(paints >= 18 && paints <= 22, `paints in 1 s: ${paints}`);
  const sweep = app.run('KIOSK_RADAR.sweep');
  assert.ok(Math.abs(sweep - 36) < 2, `sweep after 1 s: ${sweep.toFixed(1)}°`);

  // Leaving the panel stops the loop.
  app.document.body.dataset.kioskPanel = 'days1';
  await app.clock.tick(100);
  const after = app.run('__paints');
  await app.clock.tick(1000);
  assert.equal(app.run('__paints'), after);
  assert.equal(app.run('KIOSK_RADAR.raf'), null);
});
