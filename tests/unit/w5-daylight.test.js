// Audit C22: calcDaylight against the US Naval Observatory for the
// Chocomount beach (CONFIG.chocomount 41.275693 N, 71.96331 W).
//
// Reference times come from the USNO "Complete Sun and Moon Data for One
// Day" API, fetched 2026-10-01:
//   https://aa.usno.navy.mil/api/rstt/oneday?date=<d>&coords=41.275693,-71.96331&tz=-5&dst=false
// and converted from fixed EST to UTC by hand. They are independent of
// app.js's own equations. The pre-fix geometric-horizon formula was 5-9 min
// late at sunrise and early at sunset; the NOAA equations land within 1 min.
//
// The viewer's timezone must not matter (calcDaylight returns instants),
// so the same checks re-run in child processes under UTC and Los Angeles.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const USNO = {
  //            civil begin          sunrise              sunset               civil end
  '2026-10-01': ['2026-10-01T10:17Z', '2026-10-01T10:45Z', '2026-10-01T22:30Z', '2026-10-01T22:57Z'],
  '2026-12-21': ['2026-12-21T11:39Z', '2026-12-21T12:10Z', '2026-12-21T21:22Z', '2026-12-21T21:53Z'],
  '2026-06-21': ['2026-06-21T08:41Z', '2026-06-21T09:15Z', '2026-06-22T00:24Z', '2026-06-22T00:58Z'],
  '2026-03-20': ['2026-03-20T10:24Z', '2026-03-20T10:51Z', '2026-03-20T23:00Z', '2026-03-20T23:28Z'],
  '2026-11-01': ['2026-11-01T10:51Z', '2026-11-01T11:19Z', '2026-11-01T21:43Z', '2026-11-01T22:12Z'],  // DST ends
  '2026-03-08': ['2026-03-08T10:44Z', '2026-03-08T11:11Z', '2026-03-08T22:47Z', '2026-03-08T23:14Z'],  // DST starts
  '2027-01-15': ['2027-01-15T11:41Z', '2027-01-15T12:11Z', '2027-01-15T21:43Z', '2027-01-15T22:14Z'],
  '2026-08-15': ['2026-08-15T09:28Z', '2026-08-15T09:57Z', '2026-08-15T23:47Z', '2026-08-16T00:16Z']
};
const TOL_MIN = 2;          // USNO prints whole minutes; NOAA vs USNO is ≤ 1 min
const FIELDS = ['firstLight', 'sunrise', 'sunset', 'lastLight'];

// Runs every reference date through the real calcDaylight in a vm load of
// app.js under the CURRENT process TZ. Returns human-readable misses.
function checkAgainstUSNO() {
  const { loadApp } = require('../helpers/load-app');
  const app = loadApp();
  const { lat, lon } = app.get('CONFIG').chocomount;
  const misses = [];
  for (const [day, ref] of Object.entries(USNO)) {
    const [y, m, d] = day.split('-').map(Number);
    // Local noon on that calendar day in the viewer's zone, as the cards pass it.
    const dl = app.clone(app.call('calcDaylight', lat, lon, new Date(y, m - 1, d, 12)));
    FIELDS.forEach((f, i) => {
      const got = dl[f] instanceof Date ? dl[f].getTime() : NaN;
      const diff = (got - Date.parse(ref[i])) / 60000;
      if (!(Math.abs(diff) <= TOL_MIN)) misses.push(`${day} ${f}: got ${new Date(got).toISOString().slice(0, 16)}Z, USNO ${ref[i]} (${diff.toFixed(1)} min)`);
    });
    const trueLen = (Date.parse(ref[2]) - Date.parse(ref[1])) / 3600e3;
    if (!(Math.abs(dl.daylightHours - trueLen) * 60 <= TOL_MIN + 1)) {
      misses.push(`${day} daylightHours ${dl.daylightHours.toFixed(3)} vs USNO ${trueLen.toFixed(3)}`);
    }
  }
  return misses;
}

if (process.env.W5_DAYLIGHT_CHILD) {
  // Child mode: print the misses for the parent and exit (no node:test).
  process.stdout.write(JSON.stringify(checkAgainstUSNO()));
  return;
}

test(`calcDaylight matches USNO within ±${TOL_MIN} min (TZ=${process.env.TZ})`, () => {
  assert.deepEqual(checkAgainstUSNO(), []);
});

for (const tz of ['UTC', 'America/Los_Angeles']) {
  test(`calcDaylight matches USNO within ±${TOL_MIN} min for a viewer in ${tz}`, () => {
    const out = execFileSync(process.execPath, [__filename], {
      env: { ...process.env, TZ: tz, W5_DAYLIGHT_CHILD: '1' },
      encoding: 'utf8'
    });
    assert.deepEqual(JSON.parse(out), []);
  });
}

test('the fixture day reads 06:45 / 18:30 EDT and 11h45m of daylight', () => {
  const { loadApp, FIXTURE_NOW } = require('../helpers/load-app');
  const app = loadApp({ tz: 'America/New_York' });
  const { lat, lon } = app.get('CONFIG').chocomount;
  const dl = app.call('calcDaylight', lat, lon, new Date(FIXTURE_NOW));
  const hhmm = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
  assert.equal(hhmm(dl.sunrise), '06:45');
  assert.equal(hhmm(dl.sunset), '18:30');
  // The Daylight card prints Xh Ym from daylightHours.
  const h = Math.floor(dl.daylightHours), m = Math.round((dl.daylightHours - h) * 60);
  assert.equal(`${h}h ${m}m`, '11h 45m');
});

test('the unused isNighttime helper is gone', () => {
  const { loadApp } = require('../helpers/load-app');
  assert.equal(loadApp().run('typeof isNighttime'), 'undefined');
});
