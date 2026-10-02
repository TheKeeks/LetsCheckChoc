// C19: the "Secondary swell" card (a right-now snapshot) read hourly[0],
// which is local midnight, so it showed or hid itself on midnight's sea. It
// now reads the current hour, found from the response's utc_offset_seconds
// so the device's time zone doesn't matter.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadApp, readFixtureJSON } = require('../helpers/load-app');

const MARINE = readFixtureJSON('open-meteo/marine.json');   // hourly from 2026-10-01T00:00 EDT
const at = iso => Date.parse(iso);

test('marineNowIndex finds the current local hour and clamps at the ends', () => {
  const app = loadApp();
  const idx = iso => app.call('marineNowIndex', MARINE, at(iso));
  assert.equal(idx('2026-10-01T08:10:00-04:00'), 8);
  assert.equal(idx('2026-10-01T23:59:00-04:00'), 23);
  assert.equal(idx('2026-10-02T00:30:00-04:00'), 24);
  assert.equal(idx('2026-09-30T22:00:00-04:00'), 0);
  assert.equal(idx('2026-10-09T12:00:00-04:00'), 167);
  assert.equal(app.call('marineNowIndex', null, at('2026-10-01T08:10:00-04:00')), -1);
});

test('the card shows the 08:00 secondary swell at 08:10, not midnight\'s', () => {
  // Slot 0 (midnight) is 0.2 ft, so the card used to hide; at 08:00 it is
  // 1.1 ft @ 9 s from 136° (SE), in the window.
  const app = loadApp({ now: '2026-10-01T08:10:00-04:00' });
  app.call('updateSecondarySwellCard', MARINE, true, 41.089152, -71.72105);
  assert.equal(app.dom.byId('card-secondary-swell').style.display, '');
  assert.equal(app.dom.byId('val-sec-swell-height').textContent, '1.1 ft');
  assert.equal(app.dom.byId('val-sec-swell-detail').textContent, '9s · SE (136°)');
});

test('the current hour does not depend on the device time zone', () => {
  const script = `
    const { loadApp, readFixtureJSON } = require(${JSON.stringify(path.join(__dirname, '../helpers/load-app'))});
    const app = loadApp();
    process.stdout.write(String(app.call('marineNowIndex', readFixtureJSON('open-meteo/marine.json'), Date.parse('2026-10-01T08:10:00-04:00'))));
  `;
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const out = execFileSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TZ: tz }) }).toString();
    assert.equal(out, '8', tz);
  }
});
