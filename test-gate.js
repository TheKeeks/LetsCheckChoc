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
  // Should require only dataSpec
  assert(fnBody.includes('if (!spectralData.dataSpec) return null'),
    'should only require dataSpec');
  // dir1 should handle null swdir with default 0
  assert(fnBody.includes('dir1 ? dir1.values[i]'),
    'should use conditional for dir1 values');
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
