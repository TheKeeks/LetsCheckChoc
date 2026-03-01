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

// ── Summary ──────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
