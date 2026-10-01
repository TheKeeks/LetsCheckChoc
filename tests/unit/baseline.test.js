// Characterization tests: current behaviour that should stay true through
// the audit fixes. Assertions are deliberately loose where an open audit
// cluster is expected to change the exact numbers (daylight refraction,
// swell lag, headline swell selection).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixture, readFixtureJSON, FIXTURE_NOW } = require('../helpers/load-app');

const app = loadApp({ kiosk: true });
const hhmm = d => new Date(d).toTimeString().slice(0, 5);   // local (America/New_York) clock

test('parseNDBCStdmet reads the newest 44097 .txt row', () => {
  const r = app.clone(app.call('parseNDBCStdmet', readFixture('ndbc/44097.txt')));
  assert.equal(r.time, '2026-10-01 14:00 UTC');
  assert.ok(Math.abs(r.waveHeight - 0.6 * 3.28084) < 1e-9, 'WVHT 0.6 m → ft');
  assert.equal(r.dominantPeriod, 9);
  assert.equal(r.avgPeriod, 5.2);
  assert.equal(r.meanDirection, 132);
  assert.equal(r.windSpeed, null, '"MM" → null');
  assert.ok(Math.abs(r.waterTemp - (17.0 * 9 / 5 + 32)) < 1e-9);
  assert.equal(app.call('parseNDBCStdmet', ''), null);
});

test('parseSpecRows reads .spec history newest-first with compass text → degrees', () => {
  const rows = app.clone(app.call('parseSpecRows', readFixture('ndbc/44097.spec'), 30));
  assert.equal(rows.length, 30);
  assert.equal(rows[0].time.toISOString(), '2026-10-01T13:30:00.000Z');
  assert.ok(rows[0].time > rows[1].time);
  assert.deepEqual(
    { hs: rows[0].hs, swellHt: rows[0].swellHt, swellPeriod: rows[0].swellPeriod, swellDir: rows[0].swellDir, windDir: rows[0].windDir, meanDir: rows[0].meanDir },
    { hs: 0.6, swellHt: 0.3, swellPeriod: 10.5, swellDir: 135, windDir: 112.5, meanDir: 125 });
});

test('parseNDBCSpectral builds per-frequency bins from the five realtime2 files', () => {
  const raw = {
    dataSpec: readFixture('ndbc/44097.data_spec'),
    swdir: readFixture('ndbc/44097.swdir'),
    swdir2: readFixture('ndbc/44097.swdir2'),
    swr1: readFixture('ndbc/44097.swr1'),
    swr2: readFixture('ndbc/44097.swr2')
  };
  const parsed = app.clone(app.call('parseNDBCSpectral', raw));
  assert.equal(parsed.bins.length, parsed.freqs.length);
  assert.equal(parsed.bins.length, 98, '44097 publishes 98 bands, 0.025–0.96 Hz');
  assert.equal(parsed.freqs[0], 0.025);
  assert.ok(parsed.freqs.every((f, i) => i === 0 || f > parsed.freqs[i - 1]), 'freqs ascend');
  const b = parsed.bins[0];
  assert.deepEqual(Object.keys(b).sort(), ['dir1', 'dir2', 'energy', 'freq', 'period', 'r1', 'r2']);
  assert.equal(b.dir1, 232);
  const total = parsed.bins.reduce((s, x) => s + x.energy, 0);
  assert.ok(total > 0);
  const dir = app.call('computePrimarySwellDir', parsed.bins);
  assert.ok(dir > 90 && dir < 180, 'swell-band energy comes from the SE quadrant today, got ' + dir);
  // dataSpec is the only required file.
  assert.ok(app.call('parseNDBCSpectral', { dataSpec: raw.dataSpec }).bins.length > 0);
  assert.equal(app.call('parseNDBCSpectral', { swdir: raw.swdir }), null);
});

test('calcDaylight returns sane sunrise/sunset for Chocomount on the fixture day', () => {
  const c = app.get('CONFIG').chocomount;
  const dl = app.call('calcDaylight', c.lat, c.lon, app.run(`new Date(${JSON.stringify(FIXTURE_NOW)})`));
  // USNO for 2026-10-01: sunrise 06:45, sunset 18:30 EDT. Allow ±15 min so
  // the refraction fix (audit C22) does not have to touch this test.
  const mins = d => d.getHours() * 60 + d.getMinutes();
  assert.ok(Math.abs(mins(dl.sunrise) - (6 * 60 + 45)) <= 15, 'sunrise ' + hhmm(dl.sunrise));
  assert.ok(Math.abs(mins(dl.sunset) - (18 * 60 + 30)) <= 15, 'sunset ' + hhmm(dl.sunset));
  assert.ok(dl.firstLight < dl.sunrise && dl.sunset < dl.lastLight);
  assert.ok(dl.daylightHours > 11.2 && dl.daylightHours < 12.2, 'daylightHours ' + dl.daylightHours);
});

test('kioskDaySummary builds TODAY/TOMORROW/… cards from the fixtures', () => {
  app.get('STATE').forecastData = {
    marine: readFixtureJSON('open-meteo/marine.json'),
    wind: readFixtureJSON('open-meteo/wind.json'),
    tideHiLo: readFixtureJSON('coops/hilo-240h.json').predictions
  };
  const days = app.clone('[0, 1, 2, 3, 4, 5].map(kioskDaySummary)');
  assert.deepEqual(days.map(d => d.label), ['TODAY', 'TOMORROW', 'SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY']);
  // Incoming-tide windows start at each local low (Silver Eel predictions).
  assert.deepEqual(days[0].lows.map(l => hhmm(l.t)), ['07:28', '20:33']);
  assert.deepEqual(days[1].lows.map(l => hhmm(l.t)), ['08:29', '21:33']);
  for (const d of days) {
    assert.equal(d.tidesDown, false);
    assert.ok(d.primary, d.label + ' has a primary swell band');
    assert.ok(d.primary.min <= d.primary.max && d.primary.min >= 0);
    assert.ok(Number.isInteger(d.primary.period) && d.primary.period > 0);
    assert.ok(d.primary.dir >= 0 && d.primary.dir < 360);
    assert.ok(d.sun.sunrise && d.sun.sunset);
  }
  assert.equal(days[0].moon.pct, 74);
  // Wind at the first low comes from the wind fixture.
  assert.ok(days[0].lows[0].wind && days[0].lows[0].wind.mph >= 0);
});

test('kioskDaySummary degrades to all-daylight sampling when tides are missing', () => {
  const fd = app.get('STATE').forecastData;
  app.get('STATE').forecastData = { marine: fd.marine, wind: fd.wind, tideHiLo: null };
  const today = app.clone('kioskDaySummary(0)');
  assert.equal(today.tidesDown, true);
  assert.deepEqual(today.lows, []);
  assert.ok(today.primary, 'swell still summarised over daylight');
  app.get('STATE').forecastData = fd;
});

test('forecast cache: writeCache/readCache honour the TTL on the fake clock', async () => {
  const a = loadApp();
  a.call('writeCache', 'lcc-cache-test', { v: 1 });
  assert.deepEqual(a.clone(a.call('readCache', 'lcc-cache-test', 60000)), { v: 1 });
  await a.clock.tick(60001);
  assert.equal(a.call('readCache', 'lcc-cache-test', 60000), null);
  assert.equal(a.call('readCacheTs', 'lcc-cache-test'), Date.parse(FIXTURE_NOW));
});

test('swell window constants match the domain spec (115–158°)', () => {
  const c = app.get('CONFIG').chocomount;
  assert.equal(c.swellWindowMin, 115);
  assert.equal(c.swellWindowMax, 158);
  assert.equal(c.buoyId, '44097');
  assert.equal(c.tideStation, '8510719');
});
