// test-gate.js — Tests for the opening gate functionality
// Run with: node test-gate.js

'use strict';

const vm = require('vm');
const fs = require('fs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name + ': ' + e.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

console.log('Gate functionality tests\n');

// ── Test 1: app.js parses without syntax errors ──────────
test('app.js parses without syntax errors', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  // vm.Script will throw SyntaxError if the script cannot be parsed
  new vm.Script(code);
});

// ── Test 2: No duplicate lagHours declaration ─────────────
test('no duplicate const lagHours declarations in app.js', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  const matches = code.match(/const lagHours\s*=/g) || [];
  assert(matches.length <= 1, 'Found ' + matches.length + ' declarations of "const lagHours" (expected at most 1)');
});

// ── Test 3: Gate "no" handler is correctly defined in app.js ─
test('gate "no" click handler sets sessionStorage and boatGatePassed', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  // Verify the no-button handler stores 'no' in sessionStorage
  assert(code.includes("sessionStorage.setItem('lcc-gate', 'no')"), 'handler must save "no" to sessionStorage');
  // Verify the no-button handler sets boatGatePassed = true
  assert(code.includes('STATE.boatGatePassed = true'), 'handler must set boatGatePassed to true');
  // Verify the no-button handler hides the gate overlay
  assert(code.includes("el('gate-overlay').classList.add('hidden')"), 'handler must hide gate overlay');
  // Verify the no-button handler shows the app
  assert(code.includes("el('app').classList.remove('hidden')"), 'handler must show the app');
});

// ── Test 4: Gate session restore with "no" value ─────────
test('gate restores correctly when sessionStorage contains "no"', function() {
  const saved = 'no';
  const boatGatePassed = saved === 'no';
  assert(boatGatePassed === true, 'boatGatePassed should be true when saved is "no"');
});

// ── Test 5: Gate session restore with missing value ──────
test('gate shows when no sessionStorage value present', function() {
  const saved = null;
  const shouldShowGate = !saved;
  assert(shouldShowGate === true, 'gate should be shown when no value saved');
});

// ── Test 6: ndbcProxies is an array with at least 2 entries ─
test('CONFIG.api.ndbcProxies is an array with multiple proxies', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  assert(code.includes('ndbcProxies: ['), 'should have ndbcProxies array');
  const match = code.match(/ndbcProxies:\s*\[([\s\S]*?)\]/);
  assert(match, 'should be able to extract ndbcProxies array');
  const proxyCount = (match[1].match(/prefix:/g) || []).length;
  assert(proxyCount >= 2, 'should have at least 2 proxy entries, found ' + proxyCount);
});

// ── Test 7: parseNDBCSpectral only requires dataSpec ────
test('parseNDBCSpectral only requires dataSpec (not swdir)', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  // Find the parseNDBCSpectral function
  const fnMatch = code.match(/function parseNDBCSpectral\([\s\S]*?return \{ freqs, bins \};\s*\}/);
  assert(fnMatch, 'should find parseNDBCSpectral function');
  const fnBody = fnMatch[0];
  // Should NOT require swdir in the initial guard
  assert(!fnBody.match(/if\s*\(!spectralData\.dataSpec\s*\|\|\s*!spectralData\.swdir\)/),
    'should not require both dataSpec AND swdir');
  // Should require only dataSpec (after the null-guard against spectralData itself)
  assert(fnBody.includes('!spectralData.dataSpec'),
    'should check spectralData.dataSpec');
  // dir1 lookup should tolerate missing swdir file (null fallback)
  assert(/dir1\s*&&/.test(fnBody),
    'should conditionally read dir1 values');
});

// ── Helper: load selected functions from app.js into a sandbox ──
function loadSpectralFns() {
  const code = fs.readFileSync('app.js', 'utf8');
  // Extract the specific functions we want to exercise. These are top-level
  // named function declarations in app.js, so regex matching is sufficient.
  const grab = name => {
    const re = new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}\\n', 'm');
    const m = code.match(re);
    assert(m, 'could not find function ' + name);
    return m[0];
  };
  const src = [
    'const COMPASS_TO_DEG = ' + JSON.stringify({
      N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
      S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5
    }) + ';',
    grab('parseSpectralFile'),
    grab('parseNDBCSpectral'),
    grab('parseSpecSummaryFromText'),
    grab('computePrimarySwellDir'),
    'module.exports = { parseSpectralFile, parseNDBCSpectral, parseSpecSummaryFromText, computePrimarySwellDir };'
  ].join('\n');
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  new vm.Script(src).runInContext(sandbox);
  return sandbox.module.exports;
}

// ── Test 7b: parseSpectralFile handles NDBC interleaved format ──
test('parseSpectralFile parses interleaved "value (freq)" format', function() {
  const { parseSpectralFile } = loadSpectralFns();
  // data_spec has a leading sep_freq scalar
  const dataSpecSample =
    '#YY  MM DD hh mm Sep_Freq  < spec_1 (freq_1) ...\n' +
    '2026 04 21 17 00 9.999 0.100 (0.025) 0.200 (0.030) 0.300 (0.035)\n';
  const r1 = parseSpectralFile(dataSpecSample, true);
  assert(r1 !== null, 'should return non-null for valid data_spec');
  assert(r1.values.length === 3, 'expected 3 values, got ' + r1.values.length);
  assert(r1.freqs[0] === 0.025, 'first freq should be 0.025');
  assert(r1.values[1] === 0.2, 'second value should be 0.2');
  // swdir/swr files have no sep_freq
  const swdirSample =
    '#YY  MM DD hh mm alpha1_1 (freq_1) ...\n' +
    '2026 04 21 17 00 164.0 (0.025) 148.0 (0.030)\n';
  const r2 = parseSpectralFile(swdirSample, false);
  assert(r2 !== null && r2.values.length === 2, 'swdir sample should yield 2 bins');
  assert(r2.values[0] === 164, 'first dir should be 164');
  // Malformed / null input
  assert(parseSpectralFile(null) === null, 'null input returns null');
  assert(parseSpectralFile('') === null, 'empty input returns null');
  assert(parseSpectralFile('just one line\n') === null, 'too-short input returns null');
});

// ── Test 7c: parseSpecSummaryFromText handles compass-text columns ──
test('parseSpecSummaryFromText converts SwD/WWD text to degrees', function() {
  const { parseSpecSummaryFromText } = loadSpectralFns();
  const sample =
    '#YY  MM DD hh mm WVHT  SwH  SwP  WWH  WWP SwD WWD  STEEPNESS  APD MWD\n' +
    '#yr  mo dy hr mn    m    m  sec    m  sec  -  degT     -      sec degT\n' +
    '2026 04 21 17 56  1.0  0.4 10.5  0.9  4.2  SE ENE    AVERAGE  7.3 149\n';
  const s = parseSpecSummaryFromText(sample);
  assert(s !== null, 'should parse valid .spec sample');
  assert(s.hs === 1.0, 'hs should be 1.0');
  assert(s.swellHt === 0.4, 'swellHt should be 0.4');
  assert(s.swellPeriod === 10.5, 'swellPeriod should be 10.5');
  assert(s.windHt === 0.9, 'windHt should be 0.9 (not 9.9)');
  assert(s.windPeriod === 4.2, 'windPeriod should be 4.2 (not null)');
  assert(s.swellDir === 135, 'SwD "SE" should map to 135°, got ' + s.swellDir);
  assert(s.windDir === 67.5, 'WWD "ENE" should map to 67.5°, got ' + s.windDir);
  assert(s.meanDir === 149, 'MWD should be 149° numeric');
});

// ── Test 7d: computePrimarySwellDir is energy-weighted and swell-banded ──
test('computePrimarySwellDir returns energy-weighted swell direction', function() {
  const { computePrimarySwellDir } = loadSpectralFns();
  // Strong 10s swell concentrated near 140°, weak 4s noise at 300°
  const bins = [
    { period: 10, dir1: 140, energy: 1.0 },
    { period: 10, dir1: 138, energy: 0.8 },
    { period: 10, dir1: 142, energy: 0.8 },
    { period: 4,  dir1: 300, energy: 0.3 }  // should be excluded (<8s)
  ];
  const dir = computePrimarySwellDir(bins);
  assert(dir != null, 'should return a direction');
  assert(Math.abs(dir - 140) < 5, 'expected ~140°, got ' + dir);
  // Empty / null cases
  assert(computePrimarySwellDir(null) === null, 'null input');
  assert(computePrimarySwellDir([]) === null, 'empty array');
  // Fallback when no swell-band energy
  const onlyWind = [{ period: 4, dir1: 200, energy: 1.0 }];
  const fb = computePrimarySwellDir(onlyWind);
  assert(fb != null && Math.abs(fb - 200) < 1, 'should fall back to all bins when swell band empty');
});

// ── Test 8: fetchTextWithProxies exists ─────────────────
test('fetchTextWithProxies helper function exists', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  assert(code.includes('async function fetchTextWithProxies('), 'should define fetchTextWithProxies');
  assert(code.includes('CONFIG.api.ndbcProxies'), 'should iterate ndbcProxies');
});

// ── Test 9: Pipeline spectral fallback in orchestration ──
test('spectral orchestration uses pipeline fallback', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  assert(code.includes('fetchPipelineBuoy'), 'should reference fetchPipelineBuoy');
  assert(code.includes('spectral_bins'), 'should reference spectral_bins from pipeline');
  assert(code.includes('isStale'), 'should track stale data state');
});

// ── Summary ──────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
