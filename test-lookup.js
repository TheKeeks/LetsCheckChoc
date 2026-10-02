// test-lookup.js — Historical-conditions lookup tests (surf log)
// Run with: node test-lookup.js
//
// Loads the lookup functions out of app.js into a sandbox and replays real
// API responses captured for the 2025-10-18 17:43 ET Chocomount session
// (test-fixtures/). Network calls are stubbed; nothing leaves the machine.

'use strict';

const vm = require('vm');
const fs = require('fs');

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { console.log('  ✓ ' + name); passed++; },
    e => { console.error('  ✗ ' + name + ': ' + e.message); failed++; }
  ));
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function near(a, b, tol, msg) {
  assert(a != null && Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + '±' + tol + ', got ' + a);
}

const code = fs.readFileSync('app.js', 'utf8');
const grabFn = name => {
  const re = new RegExp('^(async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(code);
  if (!m) throw new Error('could not find function ' + name);
  const firstLine = code.slice(m.index, code.indexOf('\n', m.index));
  if (/\}\s*$/.test(firstLine)) return firstLine + '\n';   // one-liner
  return code.slice(m.index, code.indexOf('\n}\n', m.index) + 3);
};
const grabLine = prefix => {
  const line = code.split('\n').find(l => l.startsWith(prefix));
  if (!line) throw new Error('could not find ' + prefix);
  return line;
};

const FNS = [
  '_parseNDBCHistoricalText', '_findNearestNDBCRow', '_ndbcRowsCover', '_fetchNDBCRowsCached',
  'fetchNDBCRowsForTime', 'fetchBuoyReading', 'fmtDate', '_tzOffsetMs', 'sessionTimeMs',
  '_sessionLocalYMD', '_gcDistanceNmi', '_gcBearingDeg', 'swellGroupVelocityKts', 'swellPathNmi',
  'swellTravelHours', '_swellLagHoursFromSamples', '_omTimeMs', '_nearestHourIdx', '_omDateRange',
  'fetchHistoricalWind', 'fetchHistoricalTide', '_normalizeTidePredictions', 'tideHeightAt',
  'tideRateAt', '_detectTideExtrema', '_timeToNearestExtremum', '_tideStageFromRate',
  'parseTideAtTime', 'lookupOpenMeteoArchive', 'isChocomountSpot', 'lookupHistoricalConditions',
  '_windAtHour', '_buoyCondView', 'condForRegSource'
];
const CONSTS = [
  'const NDBC_MAX_GAP_MS', 'const NDBC_MONTH_ABBR', 'const OM_MAX_GAP_MS', 'const EARTH_RADIUS_NMI',
  'const SESSION_TZ', 'let _sessionTzFmt'
];

const fixtures = {
  ndbc: fs.readFileSync('test-fixtures/ndbc-44097-2025-10-17to19.txt', 'utf8'),
  marine: JSON.parse(fs.readFileSync('test-fixtures/om-marine-2025-10-18.json', 'utf8')),
  wind: JSON.parse(fs.readFileSync('test-fixtures/om-wind-2025-10-18.json', 'utf8')),
  tide: JSON.parse(fs.readFileSync('test-fixtures/coops-8510719-2025-10-18.json', 'utf8'))
};

function makeSandbox(opts) {
  opts = opts || {};
  const calls = { ndbc: [], json: [] };
  const sandbox = {
    console: { log() {}, warn() {} },
    Intl, Date, Math, JSON, URLSearchParams, Number, isFinite, isNaN, parseFloat, parseInt, Promise, Object,
    STATE: { isChocomount: true },
    CHOC_WIND_LAT: 41.276083,
    CHOC_WIND_LON: -71.963725,
    CONFIG: {
      chocomount: {
        lat: 41.275693, lon: -71.963310, forecastLat: 41.089152, forecastLon: -71.721050,
        buoyId: '44097', tideStation: '8510719', buoyLat: 40.969, buoyLon: -71.124
      },
      api: {
        openMeteoArchive: 'https://archive-api.open-meteo.com/v1/archive',
        openMeteoMarineArchive: 'https://marine-api.open-meteo.com/v1/marine',
        coops: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
        ndbcBase: 'https://www.ndbc.noaa.gov/data/realtime2/'
      }
    },
    _ndbcYearCache: {},
    _calls: calls,
    fetchWithProxies: async url => {
      calls.ndbc.push(url);
      if (opts.ndbcFails) return null;
      return /44097h2025/.test(url) ? fixtures.ndbc : null;
    },
    fetchJSON: async url => {
      calls.json.push(url);
      if (url.includes('marine-api')) return opts.noMarine ? { hourly: { time: [] } } : fixtures.marine;
      if (url.includes('archive-api')) return opts.noWind ? null : fixtures.wind;
      if (url.includes('tidesandcurrents')) return opts.noTide ? { error: 'down' } : fixtures.tide;
      throw new Error('unexpected url ' + url);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(CONSTS.map(grabLine).join('\n') + '\n' + FNS.map(grabFn).join('\n') +
    '\nthis.api = {' + FNS.join(',') + '};', sandbox);
  return sandbox;
}

const SESSION = '2025-10-18T17:43';
const SESSION_UTC = Date.UTC(2025, 9, 18, 21, 43);

console.log('Historical lookup tests\n');

test('session wall time is read as Eastern regardless of device zone', () => {
  const { api } = makeSandbox();
  assert(api.sessionTimeMs(SESSION) === SESSION_UTC, 'EDT session → 21:43Z');
  assert(api.sessionTimeMs('2025-12-18T17:43') === Date.UTC(2025, 11, 18, 22, 43), 'EST session → 22:43Z');
  assert(api.sessionTimeMs('2025-10-18T21:43:00.000Z') === SESSION_UTC, 'explicit Z kept');
  // 2025-11-02 01:30 happens twice; either reading is a valid instant 1h apart from the other.
  const amb = api.sessionTimeMs('2025-11-02T01:30');
  assert(amb === Date.UTC(2025, 10, 2, 5, 30) || amb === Date.UTC(2025, 10, 2, 6, 30), 'DST fall-back resolves');
});

test('group velocity is deep-water g·T/4π in knots', () => {
  const { api } = makeSandbox();
  near(api.swellGroupVelocityKts(10), 15.17, 0.02, 'Cg(10 s)');
});

test('geometry: buoy 42.2 nmi, Open-Meteo cell 14.7 nmi, path shortens off-axis', () => {
  const { api } = makeSandbox();
  near(api._gcDistanceNmi(40.969, -71.124, 41.275693, -71.963310), 42.2, 0.1, 'distance');
  near(api.swellPathNmi(40.969, -71.124, 116), 42.2, 0.1, 'path, swell from 116°');
  near(api.swellPathNmi(40.969, -71.124, 180), 18.6, 0.3, 'path, swell from 180°');
  near(api._gcDistanceNmi(41.125, -71.70833, 41.275693, -71.963310), 14.65, 0.05, 'Open-Meteo cell distance');
  near(api.swellPathNmi(41.125, -71.70833, 94), 12.11, 0.05, 'path from Open-Meteo cell, swell from 94°');
});

test('buoy reading for 2025-10-18 17:43 ET: ~2.4 h lag, row 19:26Z, total height not swell', async () => {
  const { api } = makeSandbox();
  const r = await api.fetchBuoyReading(SESSION_UTC);
  assert(r, 'reading returned');
  near(r.lagHours, 2.4, 0.05, 'lag');
  assert(r.observedAt === '2025-10-18T19:26:00.000Z', 'observedAt ' + r.observedAt);
  near(r.height, 4.9, 0.05, 'WVHT 1.48 m');
  near(r.period, 11.8, 0.05, 'DPD');
  near(r.avgPeriod, 8.6, 0.05, 'APD');
  assert(r.direction === 113, 'MWD');
  assert(!('wind' in r), 'no wind from a buoy with no anemometer');
});

test('buoy reading refuses a row more than 90 min from the wanted time', async () => {
  const { api } = makeSandbox();
  const rows = api._parseNDBCHistoricalText(fixtures.ndbc);
  assert(api._findNearestNDBCRow(rows, Date.UTC(2025, 9, 25), true, 90 * 60000) === null, 'week-away row rejected');
});

test('Open-Meteo lag is measured from the grid cell (< 1.5 h), not 50 mi', async () => {
  const { api } = makeSandbox();
  const r = await api.lookupOpenMeteoArchive(41.089152, -71.721050, SESSION_UTC);
  assert(r && r.swell, 'swell returned');
  assert(r._lagHours > 0.3 && r._lagHours < 1.5, 'lag ' + r._lagHours);
  assert(r.swell.height > 0, 'height');
  const lagged = Date.parse(r._laggedDateStr);
  assert(SESSION_UTC - lagged < 1.5 * 3600000, 'source hour within 1.5 h of session');
});

test('full lookup stores both swell sets side by side, wind at the beach, real tide level', async () => {
  const { api } = makeSandbox();
  const c = await api.lookupHistoricalConditions(41.089152, -71.721050, SESSION);
  assert(c, 'conditions returned');
  assert(c.swell && c.buoy, 'both sets present');
  assert(c.swell.height !== c.buoy.height, 'sets not merged');
  assert(c.source === 'openmeteo-archive', 'source ' + c.source);
  assert(c.wind.speed != null && c.wind.direction != null, 'wind from Open-Meteo land point');
  near(c.tide.height, 1.5, 0.1, 'tide at 17:43, not the 20:09 high');
  assert(c.tide.stage === 'rising', 'stage');
});

test('archive missing → buoy-only, swell stays null (no mixing)', async () => {
  const { api } = makeSandbox({ noMarine: true });
  const c = await api.lookupHistoricalConditions(41.089152, -71.721050, SESSION);
  assert(c && c.swell === null && c.buoy, 'buoy only');
  assert(c.source === 'ndbc-only', 'source ' + c.source);
});

test('failed wind/tide fetches store nulls, not 0', async () => {
  const { api } = makeSandbox({ noWind: true, noTide: true });
  const c = await api.lookupHistoricalConditions(41.089152, -71.721050, SESSION);
  assert(c.wind.speed === null && c.wind.direction === null, 'wind null');
  assert(c.tide === null, 'tide null');
});

test('buoy outage → buoy null, Open-Meteo set still returned', async () => {
  const { api } = makeSandbox({ ndbcFails: true });
  const c = await api.lookupHistoricalConditions(41.089152, -71.721050, SESSION);
  assert(c && c.swell && c.buoy === null, 'Open-Meteo only');
});

test('non-Chocomount spots never fetch the 44097 buoy', async () => {
  const sb = makeSandbox();
  const c = await sb.api.lookupHistoricalConditions(36.0, -75.5, SESSION);
  assert(c && c.buoy === null, 'no buoy');
  assert(sb._calls.ndbc.length === 0, 'no NDBC request');
});

test('current-year sessions fall through to monthly and realtime NDBC files', async () => {
  const sb = makeSandbox({ ndbcFails: true });
  await sb.api.fetchNDBCRowsForTime('44097', Date.UTC(2026, 9, 1, 12));
  const urls = sb._calls.ndbc.join('\n');
  assert(/44097h2026\.txt\.gz/.test(urls), 'yearly tried');
  assert(/44097a2026\.txt\.gz&dir=data\/stdmet\/Oct\//.test(urls), 'gzipped monthly uses month code a');
  assert(/data\/stdmet\/Oct\/44097\.txt/.test(urls), 'plain monthly tried');
  assert(/realtime2\/44097\.txt/.test(urls), 'realtime tried');
});

test('regression source view maps cond.buoy onto the swell shape', () => {
  const { api } = makeSandbox();
  const cond = { swell: { height: 2.4, period: 9.1, direction: 94, secondary: { height: 0.3, period: 3.9, direction: 91 } },
    buoy: { height: 4.9, period: 11.8, avgPeriod: 8.6, direction: 113 }, wind: { speed: 5, direction: 250 }, tide: { height: 1.5 } };
  assert(api.condForRegSource(cond, 'openmeteo') === cond, 'Open-Meteo view is the stored cond');
  const v = api.condForRegSource(cond, 'buoy');
  assert(v.swell.height === 4.9 && v.swell.period === 11.8 && v.swell.direction === 113, 'buoy mapped');
  assert(!v.swell.secondary, 'buoy has no secondary partition');
  assert(v.wind === cond.wind && v.tide === cond.tide, 'wind/tide shared');
  assert(api.condForRegSource({ swell: cond.swell }, 'buoy') === null, 'no buoy → excluded');
});

// ── Regression swell-set toggle ──────────────────────────
function makeModelSandbox() {
  const block = (start, end) => {
    const a = code.indexOf(start);
    if (a < 0) throw new Error('could not find ' + start);
    return code.slice(a, code.indexOf(end, a) + end.length);
  };
  const sb = { console: { log() {}, warn() {} }, Math, Object, Array, isFinite, STATE: {},
    CONFIG: { chocomount: { swellWindowMin: 115, swellWindowMax: 158 } } };
  vm.createContext(sb);
  const src = [
    block('const WAVE_FEATURE_NAMES = [', '];'), block('const RIDE_FEATURE_NAMES = [', '];'),
    block('const COND_FEATURE_NAMES = [', '];'), grabLine('const REEF_OFFSHORE_BEARING'),
    "let _regSwellSource = 'openmeteo';",
    ...['windOffshoreness', '_alignmentScore', '_effectiveInWindowSwell', '_buoyCondView', 'condForRegSource',
      '_regExtractor', 'extractWaveFeatures', 'extractRideFeatures', 'extractCondFeatures', 'matTranspose',
      'matMul', 'matInvert', 'normalEquation', '_trainOnArrays', 'trainModel', '_predict', 'predictWaveRating',
      'predictRideRating', 'predictCondRating', '_regKeySuffix', '_regWithOpenMeteo'].map(grabFn),
    block('const REG_SUBMODELS = {', '\n};\n'),
    'this.api = { REG_SUBMODELS, trainModel, _regExtractor, extractWaveFeatures, _regWithOpenMeteo,' +
      ' setSource: s => { _regSwellSource = s; }, getSource: () => _regSwellSource };'
  ].join('\n');
  vm.runInContext(src, sb);
  return sb;
}

test('toggle swaps Wave/Ride weight keys and extractors; Conditions is shared', () => {
  const { api } = makeModelSandbox();
  const R = api.REG_SUBMODELS;
  assert(R.wave.weightsKey === 'surfLogWaveWeights' && R.ride.statsKey === 'surfLogRideStats', 'Open-Meteo keys');
  api.setSource('buoy');
  assert(R.wave.weightsKey === 'surfLogWaveWeightsBuoy' && R.ride.rmseKey === 'surfLogRideValidationBuoy', 'buoy keys');
  assert(R.cond.weightsKey === 'surfLogCondWeights', 'cond unchanged');
  const omOnly = { swell: { height: 3, period: 9, direction: 130 }, tide: { height: 1, rate: 0.2 } };
  assert(R.wave.extractor(omOnly) === null, 'session without buoy drops out of the buoy set');
  const both = Object.assign({ buoy: { height: 5, period: 12, direction: 130 } }, omOnly);
  assert(R.wave.extractor(both)[0] === 5, 'buoy height used');
  api._regWithOpenMeteo(() => assert(R.wave.extractor(both)[0] === 3, 'forecast surfaces see Open-Meteo'));
  assert(api.getSource() === 'buoy', 'toggle restored after forecast scoring');
});

test('old-format entries (buoy reading stored in cond.swell) stay out of the Open-Meteo set', () => {
  const { api } = makeModelSandbox();
  const legacy = { source: 'ndbc-stdmet', swell: { height: 4.8, period: 11.8, direction: 118 } };
  assert(api.REG_SUBMODELS.wave.extractor(legacy) === null, 'excluded');
});

test('each set trains on its own sessions and yields different weights', () => {
  const { api } = makeModelSandbox();
  const entries = [];
  for (let i = 0; i < 20; i++) {
    const om = 1 + (i % 5) * 0.5, bu = 2 + ((i * 3) % 7) * 0.6;
    entries.push({ ratings: { size: 2 + (i % 5) }, conditions: {
      swell: { height: om, period: 8 + (i % 3), direction: 130 },
      buoy: i < 16 ? { height: bu, period: 10 + (i % 4), direction: 125 } : null } });
  }
  const om = api.trainModel(entries, api._regExtractor(api.extractWaveFeatures, 'openmeteo'), e => e.ratings.size);
  const bu = api.trainModel(entries, api._regExtractor(api.extractWaveFeatures, 'buoy'), e => e.ratings.size);
  assert(om && bu, 'both trained');
  assert(JSON.stringify(om.weights) !== JSON.stringify(bu.weights), 'weights differ');
});

// ── Backfill merge safeguards ──────────────────────────
function makeMergeSandbox() {
  const sb = { Object };
  vm.createContext(sb);
  vm.runInContext(grabFn('_backfillMerge') + '\nthis.merge = _backfillMerge;', sb);
  return sb.merge;
}

test('backfill keeps old conditions under previous (one level deep)', () => {
  const merge = makeMergeSandbox();
  const old = { swell: { height: 2.4 }, source: 'openmeteo-archive', previous: { swell: { height: 9 } } };
  const r = merge(old, { swell: { height: 2.6 }, buoy: null, wind: { speed: 5, direction: 200 }, tide: { height: 1 } });
  assert(r.cond.previous.swell.height === 2.4, 'previous holds replaced block');
  assert(!r.cond.previous.previous, 'no nested history');
});

test('backfill skips a session when the archive drops Open-Meteo swell it already had', () => {
  const merge = makeMergeSandbox();
  assert(merge({ swell: { height: 2.4 }, source: 'openmeteo-archive' }, { swell: null, buoy: { height: 4 } }) === null, 'skipped');
  assert(merge({ swell: { height: 4.8 }, source: 'ndbc-stdmet' }, { swell: null, buoy: { height: 4.8 } }) !== null,
    'old-format buoy-in-swell entries can still move to the buoy block');
});

test('backfill keeps saved wind/tide when their fetch fails', () => {
  const merge = makeMergeSandbox();
  const r = merge({ swell: { height: 2 }, wind: { speed: 8, direction: 300 }, tide: { height: 2 } },
    { swell: { height: 2.1 }, wind: { speed: null, direction: null }, tide: null });
  assert(r.cond.wind.speed === 8 && r.cond.tide.height === 2, 'kept');
  assert(r.kept.join() === 'wind,tide', 'reported');
});

Promise.all(pending).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
});
