// Shared fixture catalogue for the unit (vm) and e2e (Playwright) harnesses.
// One place maps an outbound URL the app builds to a recorded response in
// tests/fixtures/, so both harnesses answer the same request the same way.
// See tests/fixtures/README.md for provenance and how to re-record.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures');

// The instant the fixtures were recorded around (Open-Meteo "current" hour,
// CO-OPS water temp, pipeline buoy.json). Freeze clocks here so "today",
// "now" and every age label line up with the recorded data.
const FIXTURE_NOW = '2026-10-01T11:00:00-04:00';
const FIXTURE_NOW_MS = Date.parse(FIXTURE_NOW);

function fixturePath(name) {
  return path.join(FIXTURE_DIR, name);
}

function readFixture(name, encoding = 'utf8') {
  return fs.readFileSync(fixturePath(name), encoding);
}

function readFixtureJSON(name) {
  return JSON.parse(readFixture(name));
}

// Real Open-Meteo and CO-OPS responses carry ACAO *; NDBC's do not (that
// is why the app needs proxies), so NDBC fixtures are served without it.
const JSON_CORS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };

// Maps an absolute URL to { status, headers, file } (or { status, headers,
// body }) for the data APIs, or null when the URL is not a known data API.
// Every lat/lon/model is answered with the Chocomount recording; callers
// that need something else override per test.
function apiFixtureFor(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { return null; }
  const q = u.searchParams;

  if (u.hostname === 'marine-api.open-meteo.com' && u.pathname === '/v1/marine') {
    return { status: 200, headers: JSON_CORS, file: 'open-meteo/marine.json' };
  }
  if (u.hostname === 'api.open-meteo.com' && u.pathname === '/v1/forecast') {
    return { status: 200, headers: JSON_CORS, file: 'open-meteo/wind.json' };
  }
  if (u.hostname === 'api.tidesandcurrents.noaa.gov') {
    const product = q.get('product');
    const range = Number(q.get('range')) || 0;
    if (product === 'water_temperature') {
      return { status: 200, headers: JSON_CORS, file: 'coops/water-temp-8510560.json' };
    }
    if (product === 'predictions' && q.get('interval') === 'hilo') {
      return { status: 200, headers: JSON_CORS, file: range && range <= 72 ? 'coops/hilo-72h.json' : 'coops/hilo-240h.json' };
    }
    if (product === 'predictions') {
      return { status: 200, headers: JSON_CORS, file: range && range <= 72 ? 'coops/predictions-6min-72h.json' : 'coops/predictions-6min-168h.json' };
    }
    return null;
  }
  // NDBC realtime2 files (only 44097 is recorded).
  const m = u.hostname === 'www.ndbc.noaa.gov' && u.pathname.match(/^\/data\/realtime2\/(44097)\.(txt|spec|data_spec|swdir|swdir2|swr1|swr2)$/);
  if (m) {
    return { status: 200, headers: { 'content-type': 'text/plain' }, file: `ndbc/${m[1]}.${m[2]}` };
  }
  return null;
}

// Canned failure bodies, recorded live on 2026-10-01.
const ERRORS = {
  // CO-OPS answers HTTP 200 with this body for a station/product it has no
  // predictions for (the "tide outage" shape the app must not misread).
  coopsNoPredictions: () => ({ status: 200, headers: JSON_CORS, file: 'coops/error-no-predictions.json' }),
  // Open-Meteo answers HTTP 400 for an unknown `models` value.
  openMeteoInvalidModel: () => ({ status: 400, headers: JSON_CORS, file: 'open-meteo/error-invalid-model.json' }),
  serviceUnavailable: () => ({ status: 503, headers: JSON_CORS, body: '' })
};

// Resolve a descriptor's body to a Buffer/string.
function descriptorBody(d) {
  if (d.file) return fs.readFileSync(fixturePath(d.file));
  if (d.json !== undefined) return JSON.stringify(d.json);
  return d.body == null ? '' : d.body;
}

module.exports = {
  REPO_ROOT,
  FIXTURE_DIR,
  FIXTURE_NOW,
  FIXTURE_NOW_MS,
  fixturePath,
  readFixture,
  readFixtureJSON,
  apiFixtureFor,
  descriptorBody,
  ERRORS
};
