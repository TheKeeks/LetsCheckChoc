// Smoke harness for the regression redesign. Loads app.js into a stubbed
// node context, runs the new feature extractors on a synthetic 28-session
// dataset (modeled after the spot owner's distribution from
// INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md), trains all three sub-models,
// and prints the metrics report. Used to produce the smoke-test numbers
// in the regression-redesign commit message.
//
// Run: node scripts/smoke_regression.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Synthetic 28-session dataset ────────────────────────────────────
// Realistic Chocomount distribution: 2 SEC IN (small primary out, secondary
// in window), 14 PRI IN (primary in window, secondary mostly absent),
// 12 BOTH OUT (primary out, secondary mostly absent). Ratings vary with
// in-window energy + period + tide so the redesigned features have signal
// to fit. NOT calibrated against the spot owner's real ratings; this exists
// to verify the pipeline runs and produces finite metrics.
const SYNTHETIC_SESSIONS = [
  // SEC IN
  { swell: { height: 2.0, direction: 99,  period: 4.3, secondary: { height: 1.4, direction: 142, period: 9.0 } }, wind: { speed: 6,  direction: 67  }, tide: { height: 1.8, rate:  0.5, stage: 'rising' }, ratings: { size: 2, windQuality: 7, rideQuality: 3 } },
  { swell: { height: 2.3, direction: 109, period: 5.0, secondary: { height: 1.2, direction: 146, period: 8.3 } }, wind: { speed: 7,  direction: 112 }, tide: { height: 2.1, rate:  0.3, stage: 'rising' }, ratings: { size: 2, windQuality: 6, rideQuality: 3 } },
  // PRI IN — small
  { swell: { height: 1.3, direction: 137, period: 8.4, secondary: { height: 0.5, direction: 90,  period: 4.0 } }, wind: { speed: 12, direction: 180 }, tide: { height: 3.0, rate: -0.2, stage: 'falling' }, ratings: { size: 1, windQuality: 3, rideQuality: 0 } },
  { swell: { height: 2.4, direction: 128, period: 8.6, secondary: { height: 0.4, direction: 80,  period: 4.0 } }, wind: { speed: 11, direction: 292 }, tide: { height: 2.2, rate:  0.4, stage: 'rising' }, ratings: { size: 3, windQuality: 5, rideQuality: 4 } },
  { swell: { height: 2.5, direction: 136, period: 6.6, secondary: { height: 0.6, direction: 100, period: 4.5 } }, wind: { speed: 5,  direction: 157 }, tide: { height: 1.7, rate:  0.6, stage: 'rising' }, ratings: { size: 3, windQuality: 7, rideQuality: 5 } },
  { swell: { height: 2.5, direction: 146, period: 6.9, secondary: { height: 0.5, direction: 100, period: 4.0 } }, wind: { speed: 3,  direction: 247 }, tide: { height: 1.5, rate:  0.5, stage: 'rising' }, ratings: { size: 4, windQuality: 9, rideQuality: 6 } },
  { swell: { height: 2.8, direction: 136, period: 6.5, secondary: { height: 0.4, direction: 100, period: 4.0 } }, wind: { speed: 8,  direction: 67  }, tide: { height: 2.6, rate:  0.3, stage: 'rising' }, ratings: { size: 3, windQuality: 5, rideQuality: 4 } },
  { swell: { height: 2.8, direction: 119, period: 8.5, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 8,  direction: 247 }, tide: { height: 1.9, rate:  0.5, stage: 'rising' }, ratings: { size: 5, windQuality: 7, rideQuality: 6 } },
  { swell: { height: 3.3, direction: 125, period: 7.5, secondary: { height: 0.5, direction: 95,  period: 4.0 } }, wind: { speed: 2,  direction: 337 }, tide: { height: 1.4, rate:  0.6, stage: 'rising' }, ratings: { size: 6, windQuality: 9, rideQuality: 6 } },
  { swell: { height: 3.7, direction: 123, period: 7.0, secondary: { height: 0.7, direction: 95,  period: 4.5 } }, wind: { speed: 6,  direction: 202 }, tide: { height: 2.8, rate: -0.3, stage: 'falling' }, ratings: { size: 5, windQuality: 6, rideQuality: 4 } },
  { swell: { height: 3.9, direction: 147, period: 9.1, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 10, direction: 337 }, tide: { height: 1.6, rate:  0.7, stage: 'rising' }, ratings: { size: 7, windQuality: 9, rideQuality: 9 } },
  { swell: { height: 4.2, direction: 117, period: 6.6, secondary: { height: 0.5, direction: 100, period: 4.0 } }, wind: { speed: 5,  direction: 0   }, tide: { height: 1.9, rate:  0.6, stage: 'rising' }, ratings: { size: 7, windQuality: 9, rideQuality: 7 } },
  { swell: { height: 4.4, direction: 127, period: 7.7, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 8,  direction: 225 }, tide: { height: 2.0, rate:  0.5, stage: 'rising' }, ratings: { size: 8, windQuality: 7, rideQuality: 6 } },
  { swell: { height: 4.7, direction: 140, period: 9.5, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 10, direction: 112 }, tide: { height: 2.3, rate:  0.3, stage: 'rising' }, ratings: { size: 5, windQuality: 5, rideQuality: 6 } },
  { swell: { height: 6.4, direction: 145, period: 15.4, secondary: { height: 0.7, direction: 95, period: 4.5 } }, wind: { speed: 0,  direction: 0   }, tide: { height: 1.2, rate:  0.8, stage: 'rising' }, ratings: { size: 9, windQuality: 10, rideQuality: 10 } },
  { swell: { height: 8.8, direction: 150, period: 8.1, secondary: { height: 0.8, direction: 95,  period: 4.5 } }, wind: { speed: 7,  direction: 270 }, tide: { height: 1.5, rate:  0.7, stage: 'rising' }, ratings: { size: 9, windQuality: 9, rideQuality: 10 } },
  // BOTH OUT
  { swell: { height: 2.9, direction: 107, period: 9.9, secondary: { height: 0.4, direction: 95,  period: 4.0 } }, wind: { speed: 2,  direction: 135 }, tide: { height: 2.7, rate: -0.4, stage: 'falling' }, ratings: { size: 1, windQuality: 6, rideQuality: 0 } },
  { swell: { height: 4.3, direction: 113, period: 7.1, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 2,  direction: 337 }, tide: { height: 2.4, rate:  0.2, stage: 'rising' }, ratings: { size: 4, windQuality: 8, rideQuality: 5 } },
  { swell: { height: 2.6, direction: 185, period: 4.7, secondary: { height: 0.3, direction: 95,  period: 4.0 } }, wind: { speed: 3,  direction: 90  }, tide: { height: 2.1, rate:  0.4, stage: 'rising' }, ratings: { size: 4, windQuality: 7, rideQuality: 4 } },
  { swell: { height: 3.5, direction: 181, period: 5.6, secondary: { height: 0.4, direction: 95,  period: 4.0 } }, wind: { speed: 10, direction: 225 }, tide: { height: 2.5, rate: -0.3, stage: 'falling' }, ratings: { size: 4, windQuality: 5, rideQuality: 4 } },
  { swell: { height: 3.0, direction: 159, period: 8.7, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 7,  direction: 112 }, tide: { height: 1.8, rate:  0.5, stage: 'rising' }, ratings: { size: 6, windQuality: 6, rideQuality: 6 } },
  { swell: { height: 3.0, direction: 159, period: 8.7, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 7,  direction: 112 }, tide: { height: 1.7, rate:  0.4, stage: 'rising' }, ratings: { size: 6, windQuality: 6, rideQuality: 7 } },
  { swell: { height: 1.4, direction: 181, period: 5.3, secondary: { height: 0.4, direction: 95,  period: 4.0 } }, wind: { speed: 4,  direction: 247 }, tide: { height: 2.3, rate:  0.3, stage: 'rising' }, ratings: { size: 2, windQuality: 8, rideQuality: 5 } },
  { swell: { height: 3.2, direction: 110, period: 7.8, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 5,  direction: 202 }, tide: { height: 1.6, rate:  0.6, stage: 'rising' }, ratings: { size: 5, windQuality: 7, rideQuality: 9 } },
  { swell: { height: 3.8, direction: 192, period: 5.5, secondary: { height: 0.9, direction: 103, period: 7.0 } }, wind: { speed: 16, direction: 292 }, tide: { height: 2.9, rate: -0.4, stage: 'falling' }, ratings: { size: 3, windQuality: 4, rideQuality: 1 } },
  { swell: { height: 2.7, direction: 196, period: 4.8, secondary: { height: 0.7, direction: 104, period: 9.1 } }, wind: { speed: 6,  direction: 180 }, tide: { height: 2.0, rate:  0.4, stage: 'rising' }, ratings: { size: 3, windQuality: 7, rideQuality: 2 } },
  { swell: { height: 2.4, direction: 94,  period: 9.2, secondary: { height: 0.5, direction: 53,  period: 2.4 } }, wind: { speed: 6,  direction: 247 }, tide: { height: 1.9, rate:  0.5, stage: 'rising' }, ratings: { size: 4, windQuality: 7, rideQuality: 4 } },
  { swell: { height: 2.4, direction: 94,  period: 9.1, secondary: { height: 0.3, direction: 91,  period: 3.9 } }, wind: { speed: 4,  direction: 270 }, tide: { height: 1.6, rate:  0.6, stage: 'rising' }, ratings: { size: 5, windQuality: 8, rideQuality: 5 } }
];

// ── Stub a browser-ish environment so app.js loads cleanly ──────────
const sandbox = {
  console,
  Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Array, Object, String, Number, Boolean, Set, Map, Promise, Error, RegExp, Symbol,
  setTimeout, clearTimeout, setInterval, clearInterval,
  globalThis: null,
  window: {},
  document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.resolve({ ok: false, json: () => ({}), text: () => '' }),
  navigator: { userAgent: 'node' },
  location: { hostname: 'node' },
  ResizeObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
  IntersectionObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
  Image: function () { return {}; },
  XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {} }; }
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.location = sandbox.location;
vm.createContext(sandbox);

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
try {
  new vm.Script(src).runInContext(sandbox);
} catch (e) {
  console.error('[smoke] app.js failed to load in stub context:', e.message);
  process.exit(1);
}

// STATE is a top-level const inside app.js so it's not on the sandbox
// object. Inject the synthetic dataset, stub DOM-touching renderers, and
// retrain — all through vm.runInContext.
sandbox.__SYNTHETIC = SYNTHETIC_SESSIONS;
vm.runInContext(`
  window._fbUserId = 'smoke-user';
  STATE.surfLog = __SYNTHETIC.map((s, i) => ({
    id: 'syn-' + i,
    userId: 'smoke-user',
    timestamp: new Date(2025, 0, 1 + i).toISOString(),
    ratings: s.ratings,
    conditions: { swell: s.swell, wind: s.wind, tide: s.tide },
    notes: '',
    photos: []
  }));
  renderWeightsPanel = () => {};
  renderRegressionTab = () => {};
  slRetrain();
  globalThis.__REPORT = _llcRegressionMetricsReport();
`, sandbox);

console.log('\n──────── REGRESSION METRICS REPORT (synthetic 28-session smoke) ────────\n');
console.log(sandbox.__REPORT);
