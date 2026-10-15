// test-gate.js — legacy tests (the app.js load path and the forecast-vs-buoy maths)
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

// Async tests run after the sync ones, in order, before the summary.
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push({ name, fn }); }

console.log('Legacy app.js tests\n');

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

// ── Test 6: NDBC never blocks the Chocomount forecast ──
// Behavioural (replaces a check that the source listed >= 2 proxies, which
// locked the dead proxies in place): with every NDBC relay hanging, Choc's
// load has its forecast from Open-Meteo + CO-OPS without one proxy request.
testAsync('Choc forecast renders with no NDBC proxy request, even if relays hang', async function() {
  const { loadApp, fixtureFetch } = require('./tests/helpers/load-app');
  const hang = () => new Promise(function() {});
  const app = loadApp({ fetch: fixtureFetch({ overrides: [
    [/corsproxy\.io|allorigins\.win|codetabs\.com|ndbc\.noaa\.gov/, hang]
  ] }) });
  app.get('STATE').tideStations = JSON.parse(fs.readFileSync('data/tide-stations.json', 'utf8'));
  const choc = JSON.parse(fs.readFileSync('data/buoys-east-coast.json', 'utf8')).find(b => b.home === 'chocomount');
  app.call('loadAllData', choc);
  await app.clock.tick(1000);
  const fd = app.get('STATE').forecastData;
  assert(fd && fd.marine && fd.marine.hourly.time.length === 168, 'the forecast should be in within 1 s');
  assert(app.get('STATE').lastLoadCompletedAt, 'load should complete within 1 s');
  const proxied = app.fetchLog.filter(r => /corsproxy|allorigins|codetabs|ndbc\.noaa\.gov/.test(r.url));
  assert(proxied.length === 0, 'expected no NDBC/proxy requests, got ' + proxied.map(r => r.url).join(', '));
});

// ── Summary ──────────────────────────────────────────────


// ── Test 15: verifAngDiff — signed shortest angular difference ──
test('verifAngDiff wraps correctly across north', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  const m = code.match(/function verifAngDiff\([\s\S]*?\n\}/);
  assert(m, 'verifAngDiff must exist in app.js');
  const verifAngDiff = eval('(' + m[0].replace(/^function verifAngDiff/, 'function') + ')');
  assert(verifAngDiff(10, 350) === 20, '350→10 should be +20, got ' + verifAngDiff(10, 350));
  assert(verifAngDiff(350, 10) === -20, '10→350 should be −20, got ' + verifAngDiff(350, 10));
  assert(verifAngDiff(180, 0) === 180, '0→180 should be 180');
  assert(verifAngDiff(90, 90) === 0, 'same angle should be 0');
});

// ── Test 16: verifStats — bias/MAE incl. circular + null handling ──
test('verifStats computes bias/MAE and skips null pairs', function() {
  const code = fs.readFileSync('app.js', 'utf8');
  const ang = code.match(/function verifAngDiff\([\s\S]*?\n\}/);
  const st = code.match(/function verifStats\([\s\S]*?\n\}/);
  assert(st, 'verifStats must exist in app.js');
  const verifAngDiff = eval('(' + ang[0].replace(/^function verifAngDiff/, 'function') + ')');
  const verifStats = eval('(' + st[0].replace(/^function verifStats/, 'function') + ')');
  const rows = [
    { o: 2, m: 3 },      // err +1
    { o: 4, m: 3 },      // err −1
    { o: 5, m: null },   // skipped
    { o: null, m: 2 }    // skipped
  ];
  const s = verifStats(rows, r => r.o, r => r.m, false);
  assert(s.n === 2, 'n should be 2, got ' + s.n);
  assert(Math.abs(s.bias) < 1e-9, 'bias should be 0, got ' + s.bias);
  assert(Math.abs(s.mae - 1) < 1e-9, 'MAE should be 1, got ' + s.mae);
  const circ = verifStats([{ o: 350, m: 10 }], r => r.o, r => r.m, true);
  assert(Math.abs(circ.bias - 20) < 1e-9, 'circular bias should be +20, got ' + circ.bias);
  const empty = verifStats([], r => r.o, r => r.m, false);
  assert(empty.n === 0 && empty.bias === null, 'empty rows should give n=0, null bias');
});

(async function() {
  for (const t of asyncTests) {
    try {
      await t.fn();
      console.log('  ✓ ' + t.name);
      passed++;
    } catch (e) {
      console.error('  ✗ ' + t.name + ': ' + e.message);
      failed++;
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
})();
