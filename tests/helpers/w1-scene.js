// Setup shared by the w1 (load path) unit tests. The vm DOM has no layout,
// so the tide / compass / spectrum canvases get parent containers to
// measure, and STATE gets the static catalogs initApp would fetch.
//
//   const { prepareScene, runLoad, LEAFLET_STUB } = require('../helpers/w1-scene');
//   const app = loadApp({ fetch: fixtureFetch() });
//   const choc = prepareScene(app);           // → the Chocomount buoy
//   await runLoad(app, 'loadAllData', choc);  // whole load on the fake clock
'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./fixtures');

const readRepoJSON = rel => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
const BUOYS = readRepoJSON('data/buoys-east-coast.json');
const TIDE_STATIONS = readRepoJSON('data/tide-stations.json');

// Canvases whose drawers measure canvas.parentElement.
const MEASURED_CANVASES = ['tide-canvas', 'compass-canvas', 'spectrum-canvas'];

function wireCanvasParents(app) {
  for (const id of MEASURED_CANVASES) {
    const canvas = app.dom.byId(id);
    if (!canvas.parentElement) app.dom.byId(id + '-wrap').appendChild(canvas);
  }
}

// Wires the DOM, seeds STATE.buoys / STATE.tideStations, returns Choc.
function prepareScene(app) {
  wireCanvasParents(app);
  const STATE = app.get('STATE');
  STATE.buoys = BUOYS.map(b => Object.assign({}, b));
  STATE.tideStations = TIDE_STATIONS.slice();
  return STATE.buoys.find(b => b.home === 'chocomount');
}

const buoyById = (app, id) => app.get('STATE').buoys.find(b => b.id === id);

// Starts fn(...args) (loadAllData / loadPinData) and drives the fake clock
// in 50 ms steps until that load settles (at most maxMs of fake time).
// Returns the fake ms it took.
async function runLoad(app, fn, ...args) {
  return runLoadFor(30000, app, fn, ...args);
}
async function runLoadFor(maxMs, app, fn, ...args) {
  return settle(app, app.call(fn, ...args), maxMs, fn);
}

// Drives the fake clock in 50 ms steps until `promise` settles (at most
// maxMs of fake time). Returns the fake ms it took.
async function settle(app, promise, maxMs = 30000, label = 'load') {
  const t0 = app.clock.now();
  let done = false;
  const p = Promise.resolve(promise).finally(() => { done = true; });
  while (!done && app.clock.now() - t0 < maxMs) await app.clock.tick(50);
  await app.clock.flush();
  if (!done) throw new Error(`${label} did not settle within ${maxMs} ms of fake time`);
  await p;
  return app.clock.now() - t0;
}

// Minimal chainable Leaflet stand-in: every call returns another chain, so
// initBuoyMap / initTideMap run as if the CDN script had loaded.
const LEAFLET_STUB = `globalThis.L = (function () {
  function chain() {
    return new Proxy(function () {}, {
      get: function (t, p) {
        if (p === 'getLatLng') return function () { return { lat: 0, lng: 0 }; };
        if (p === 'then' || typeof p === 'symbol') return undefined;
        return function () { return chain(); };
      },
      apply: function () { return chain(); }
    });
  }
  return { map: chain, tileLayer: chain, marker: chain, divIcon: function () { return {}; } };
})();`;

module.exports = { prepareScene, wireCanvasParents, buoyById, runLoad, runLoadFor, settle, LEAFLET_STUB, BUOYS, TIDE_STATIONS };
