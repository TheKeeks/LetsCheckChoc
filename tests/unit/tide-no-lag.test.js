// Owner's rule (2026-10-05): "for tide purposes, there should be no lag vs
// Silver Eel in the model". Silver Eel Pond (CO-OPS 8510719) is ~1.4 mi from
// the beach, so its predicted times ARE Choc's tide times. Only swell gets a
// travel lag (forecast point or buoy → reef).
//
// The tide was already read at the right time everywhere; the first three
// tests lock that in. What broke the rule was the swell the model paired
// with that tide: training read it 50 mi/(1.5 kt × period) before the
// session (the buoy's distance, 4–7 h) from the forecast point ~16 nmi out,
// while prediction read it at the forecast hour itself. A forecast hour past
// the end of a saved tide series also got a frozen 0 ft/hr tide.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixtureFetch, readFixtureJSON } = require('../helpers/load-app');

const ARCHIVE_WIND_OK = ['archive-api.open-meteo.com', { status: 200, file: 'open-meteo/wind.json' }];
const MARINE = readFixtureJSON('open-meteo/marine.json');
const WIND = readFixtureJSON('open-meteo/wind.json');
const PRED = readFixtureJSON('coops/predictions-6min-168h.json').predictions;
const PRED_72H = readFixtureJSON('coops/predictions-6min-72h.json').predictions;
const HILO = readFixtureJSON('coops/hilo-240h.json').predictions;
const HILO_72H = readFixtureJSON('coops/hilo-72h.json').predictions;

// Silver Eel's own water level at an instant: straight-line between the two
// raw 6-min predictions either side (CO-OPS times are Eastern wall clock).
const RAW = PRED.map(p => ({ t: new Date(p.t).getTime(), v: parseFloat(p.v) }));
function silverEel(ms) {
  for (let i = 0; i < RAW.length - 1; i++) {
    if (ms >= RAW[i].t && ms <= RAW[i + 1].t) {
      return RAW[i].v + (ms - RAW[i].t) / (RAW[i + 1].t - RAW[i].t) * (RAW[i + 1].v - RAW[i].v);
    }
  }
  throw new Error('outside the recorded week: ' + new Date(ms).toISOString());
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const hourIndex = label => {
  const i = MARINE.hourly.time.indexOf(label);
  assert.ok(i >= 0, 'fixture hour ' + label);
  return i;
};

async function lookup(app, dateStr) {
  const c = app.get('CONFIG').chocomount;
  return app.clone(await app.call('lookupHistoricalConditions', c.forecastLat, c.forecastLon, dateStr));
}

test('training: a logged session\'s tide is Silver Eel at the session time, whatever the swell lag', async () => {
  const app = loadApp({ fetch: fixtureFetch({ overrides: [ARCHIVE_WIND_OK] }) });
  for (const when of ['2026-10-01T09:00', '2026-10-02T09:30', '2026-10-03T15:12']) {
    const cond = await lookup(app, when);
    const T = new Date(when).getTime();
    assert.ok(cond.swellLagHours > 0, when + ': swell is lagged');
    assert.equal(cond.tide.height, round(silverEel(T), 1), when + ': tide height at the session time');
    assert.equal(cond.tide.rate, round(silverEel(T + 30 * 60e3) - silverEel(T - 30 * 60e3), 2), when + ': tide rate at the session time');
  }
});

test('prediction: every forecast hour\'s tide is Silver Eel at that hour', () => {
  const app = loadApp();
  for (let hi = 0; hi < MARINE.hourly.time.length; hi++) {
    const fc = app.clone(app.call('buildForecastConditions', MARINE, WIND, HILO, PRED, hi));
    const T = new Date(MARINE.hourly.time[hi]).getTime();
    assert.ok(Math.abs(fc.tide.height - silverEel(T)) < 1e-9, MARINE.hourly.time[hi]);
  }
});

test('Choc TV: each day\'s lows are Silver Eel\'s low times to the minute', () => {
  const app = loadApp({ kiosk: true });
  const S = app.get('STATE');
  S.isChocomount = true;
  S.forecastData = { marine: MARINE, wind: WIND, tideHiLo: HILO };
  const lowsByDay = new Map();
  for (const p of HILO.filter(p => p.type === 'L')) {
    const day = p.t.slice(0, 10);
    if (!lowsByDay.has(day)) lowsByDay.set(day, []);
    lowsByDay.get(day).push(new Date(p.t).getTime());
  }
  const days = app.clone('[0, 1, 2, 3, 4, 5, 6].map(kioskDaySummary)');
  let n = 0;
  days.forEach((d, i) => {
    const key = `2026-10-0${1 + i}`;   // TODAY = 2026-10-01
    assert.deepEqual(d.lows.map(l => l.t), (lowsByDay.get(key) || []).slice(0, 2), key);
    n += d.lows.length;
  });
  assert.ok(n >= 10, 'checked the week\'s lows');
});

test('the model pairs a tide with the same swell in training and in prediction', async () => {
  const app = loadApp({ fetch: fixtureFetch({ overrides: [ARCHIVE_WIND_OK] }) });
  for (const when of ['2026-10-01T09:00', '2026-10-02T09:00', '2026-10-03T15:00']) {
    const trained = await lookup(app, when);
    const fc = app.clone(app.call('buildForecastConditions', MARINE, WIND, HILO, PRED, hourIndex(when)));
    assert.equal(fc.tide.height != null && round(fc.tide.height, 1), trained.tide.height, when + ': same tide');
    assert.deepEqual(
      { height: round(fc.swell.height, 1), period: round(fc.swell.period, 1), direction: Math.round(fc.swell.direction) },
      { height: trained.swell.height, period: trained.swell.period, direction: trained.swell.direction },
      when + ': same swell next to that tide');
  }
});

test('swell lag is the travel time from where the swell is read (forecast point ~16 nmi, buoy ~42 nmi), not 50 mi', async () => {
  const app = loadApp({ fetch: fixtureFetch({ overrides: [ARCHIVE_WIND_OK] }) });
  const c = app.get('CONFIG').chocomount;
  // Great-circle nmi from the forecast point to the beach, worked out here
  // rather than taken from the app.
  const rad = d => d * Math.PI / 180;
  const a = Math.sin(rad(c.lat - c.forecastLat) / 2) ** 2 +
    Math.cos(rad(c.forecastLat)) * Math.cos(rad(c.lat)) * Math.sin(rad(c.lon - c.forecastLon) / 2) ** 2;
  const fp = 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  assert.ok(Math.abs(fp - 15.65) < 0.2, 'forecast point ' + fp.toFixed(2) + ' nmi');

  for (const when of ['2026-10-01T09:00', '2026-10-02T09:30', '2026-10-03T15:12']) {
    const T = new Date(when).getTime();
    const periods = MARINE.hourly.time
      .map((t, i) => [new Date(t).getTime(), MARINE.hourly.swell_wave_period[i]])
      .filter(([t, p]) => t >= T - 2 * 3600e3 && t <= T && p > 0)
      .map(([, p]) => p);
    const mean = periods.reduce((a, b) => a + b, 0) / periods.length;
    const cond = await lookup(app, when);
    assert.equal(cond.swellLagHours, round(fp / (1.5 * mean), 1), when + ': lag from the forecast point');
    assert.ok(cond.swellLagHours < 3, when + ': ' + cond.swellLagHours + ' h, not the buoy\'s 4–7 h');
  }
  assert.ok(Math.abs(app.call('swellLagDistanceNmi', c.forecastLat, c.forecastLon) - fp) < 0.05);
  assert.ok(Math.abs(app.call('swellLagDistanceNmi', c.buoyLat, c.buoyLon) - 42.2) < 1, 'buoy 44097 ~42 nmi out');

  // "Use buoy coordinates" moves the live forecast out to 44097, so the
  // prediction's swell then comes from further back.
  const toggled = loadApp({ storage: { local: { 'lcc-forecast-use-buoy-coords': '1' } } });
  assert.deepEqual(toggled.clone('forecastSwellPoint()'), { lat: c.buoyLat, lon: c.buoyLon });
  assert.deepEqual(app.clone('forecastSwellPoint()'), { lat: c.forecastLat, lon: c.forecastLon });
});

test('a forecast hour past the end of the saved tide series has no tide, not a frozen slack one', () => {
  const app = loadApp();
  const hi = hourIndex('2026-10-05T04:00');   // the 72 h copies end 2026-10-03 23:54
  const stale = app.clone(app.call('buildForecastConditions', MARINE, WIND, HILO_72H, PRED_72H, hi));
  assert.equal(stale.tide, null);
  assert.equal(app.call('extractRideFeatures', app.run(`(${JSON.stringify(stale)})`)), null, 'no Ride prediction on a frozen tide');
  // Inside the series, and with a full-length series, the hour keeps its tide.
  assert.equal(typeof app.clone(app.call('buildForecastConditions', MARINE, WIND, HILO_72H, PRED_72H, hourIndex('2026-10-03T09:00'))).tide.height, 'number');
  assert.equal(typeof app.clone(app.call('buildForecastConditions', MARINE, WIND, HILO, PRED, hi)).tide.height, 'number');
});
