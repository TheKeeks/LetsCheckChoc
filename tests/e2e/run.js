#!/usr/bin/env node
// Dependency-light Playwright runner for LetsCheckChoc browser scenarios.
//
//   npm run test:e2e                     # every tests/e2e/scenarios/*.js
//   node tests/e2e/run.js kiosk          # only scenarios whose file or name matches
//   node tests/e2e/run.js path/to/x.js   # run a scenario file from anywhere
//   node tests/e2e/run.js --list
//
// Serves the repo from an in-process static server (http://localhost:<port>,
// a secure context) and routes EVERY other host to fixtures or emulations,
// so runs are offline and deterministic. Time starts at the fixtures'
// instant (FIXTURE_NOW) in America/New_York. Screenshots and results.json
// land in tests/e2e/artifacts/ (gitignored, uploaded by CI).
//
// Scenario contract — tests/e2e/scenarios/<prefix>-<what>.js:
//   module.exports = {
//     name: 'human readable',
//     options: { ... },                       // optional, see DEFAULT_OPTIONS
//     run: async ({ page, ctx, assert, log }) => { ... }
//   };
// A scenario fails if run() throws/rejects, exceeds its timeout, or the page
// raises an uncaught error (pageerror) not allowed via ctx.allowPageError().
// Each scenario gets a fresh browser context (timezone America/New_York,
// locale en-US, service workers blocked unless contextOptions says
// otherwise); init scripts seed the gate/storage/Firebase knobs before any
// page script runs. Nothing navigates until run() calls ctx.open().
//
// ctx API:
//   ctx.open(path = '/', gotoOpts)   navigate (waitUntil 'domcontentloaded');
//                                    resets ctx.t0, the zero for every ms below.
//                                    The new look (previews/clean) is the
//                                    site's default, so a path that names no
//                                    look (no preview= / classic=) opens with
//                                    ?classic=1: those scenarios test the app
//                                    underneath. To open the default look as
//                                    a visitor does, name it (?preview=clean)
//                                    or page.goto(ctx.url('/')).
//   ctx.waitFor(fnOrExpr, { arg, timeout = 30000, interval = 50, label })
//                                    poll in the page from Node until truthy →
//                                    { ms, value }. Works with a paused clock.
//   ctx.waitForChart({ timeout })    → ms until STATE.forecastChart has hours
//   ctx.waitForLoad({ timeout })     → ms until STATE.lastLoadCompletedAt is set
//   ctx.state(fnOrExpr, arg)         page.evaluate (top-level consts like STATE
//                                    are reachable by name)
//   ctx.net                          live, mutable per-host modes (DEFAULT_NET);
//                                    change mid-scenario, e.g. ctx.net.marine = 'down'
//   ctx.serve(path, content)         override a same-origin file: string/Buffer,
//                                    descriptor, (req) => …, or null → 404
//   ctx.route(...)                   = page.route (wins over the runner's routes)
//   ctx.requests                     [{ t, method, url, type }] every request;
//   ctx.requestsTo(substrOrRegExp)   … filtered
//   ctx.unhandled                    external URLs nobody routed (aborted)
//   ctx.pageErrors, ctx.consoleErrors  collected Error objects / console.error text
//   ctx.allowPageError(regexp)       expected uncaught errors don't fail the run
//   ctx.metric(name, value)          printed and saved to artifacts/results.json
//   ctx.screenshot(name, opts)       artifacts/<file>--<name>.png (auto on failure)
//   ctx.fixture(relPath)             read tests/fixtures/<relPath>
//   ctx.url(path), ctx.baseURL, ctx.context, ctx.page, ctx.options
// Clock: options.clock 'install' (default) starts fake timers at options.now
// and lets time flow; use page.clock.fastForward('15:00') for long jumps
// (runFor replays every animation frame and is slow), pauseAt/resume to stop
// time. assert is node:assert/strict; log prefixes output with the file name.
//
// Env: E2E_ALLORIGINS_DELAY_MS (default 2000; production is ~20000, which
//      the app's 15 s proxy timeout cuts off), E2E_TIMEOUT_MS (per scenario,
//      default 90000), E2E_HEADED=1, PLAYWRIGHT_BROWSERS_PATH.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('node:assert/strict');
const { REPO_ROOT, FIXTURE_NOW, apiFixtureFor, descriptorBody, fixturePath, readFixture, ERRORS } = require('../helpers/fixtures');

const SCENARIO_DIR = path.join(__dirname, 'scenarios');
const ARTIFACT_DIR = path.join(__dirname, 'artifacts');

// ── Playwright resolution (CI: npm i --no-save; web session: global) ──
function loadPlaywright() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  }
  const candidates = [
    'playwright',
    '@playwright/test',
    '/opt/node22/lib/node_modules/playwright',
    '/usr/local/lib/node_modules_global/playwright'
  ];
  for (const c of candidates) {
    try { return require(c); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  console.error('Playwright not found. Install it without saving: npm i --no-save playwright@1.56.1 && npx playwright install --with-deps chromium');
  process.exit(2);
}

// ── Defaults ───────────────────────────────────────────
const DEFAULT_OPTIONS = {
  gate: 'no',              // seed sessionStorage lcc-gate (null = show the boat gate)
  now: FIXTURE_NOW,        // clock start
  clock: 'install',        // 'install' (fake timers, time flows from `now`;
                           //  page.clock.runFor/fastForward/pauseAt work),
                           // 'fixed' (Date frozen at `now`, real timers), 'none'
  device: null,            // Playwright device name, e.g. 'iPad Pro 11 landscape'
  viewport: { width: 1280, height: 900 },
  contextOptions: {},      // merged last into browser.newContext()
  net: {},                 // overrides for DEFAULT_NET (see below)
  firebase: {},            // window.__FB_* knobs for tests/fixtures/firebase-stub.js:
                           // { mode, logs, fail, firstAuthMs, anonMs, fsMs, noStorage }
  storage: null,           // { local: {k: v}, session: {k: v} } seeded before scripts run
  timeoutMs: Number(process.env.E2E_TIMEOUT_MS || 90000)
};

// Per-host behaviour. Data APIs take 'ok' | 'down' (503) | 'error' (the
// API's recorded error body) | 'abort' (connection failure) | 'hang' (no
// answer) | (url, request) => descriptor | 'abort' | 'hang' | null (null
// falls back to 'ok'). A descriptor is { status, headers, body | json |
// file (under tests/fixtures), delayMs }.
const DEFAULT_NET = {
  latencyMs: 50,           // delay before each data-API fixture reply
  marine: 'ok',            // marine-api.open-meteo.com
  wind: 'ok',              // api.open-meteo.com/v1/forecast
  archive: 'down',         // archive-api.open-meteo.com (no fixture recorded)
  coops: 'ok',             // api.tidesandcurrents.noaa.gov ('error' = NOAA "No Predictions" JSON, HTTP 200)
  ndbc: 'cors-blocked',    // direct www.ndbc.noaa.gov: 200 without ACAO, as in production
  proxies: 'dead',         // corsproxy.io 403, allorigins 522 after alloriginsDelayMs, codetabs 503;
                           // 'ok' = proxies work and serve the NDBC fixtures
  alloriginsDelayMs: Number(process.env.E2E_ALLORIGINS_DELAY_MS || 2000),
  leaflet: 'ok',           // unpkg / jsdelivr leaflet@1.9.4 → tests/fixtures/vendor
  firebase: 'stub',        // gstatic firebasejs → firebase-stub.js | 'abort' | 'hang'
  fonts: 'ok',             // Google Fonts → empty CSS
  tiles: 'ok',             // map tiles → 1×1 PNG
  windy: 'ok'              // Windy embeds → blank page
};

// Same-origin files pinned to fixtures: the bot rewrites data/buoy.json and
// data/verification.json every 2 h, so live copies would drift from FIXTURE_NOW.
const PINNED_FILES = {
  '/data/buoy.json': 'pipeline/buoy.json',
  '/data/verification.json': 'pipeline/verification.json'
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// ── Cancellable sleeps so a closing scenario never leaves Node timers behind ──
const sleepers = new Set();
function sleep(ms) {
  return new Promise(resolve => {
    const s = { resolve, timer: setTimeout(() => { sleepers.delete(s); resolve(); }, ms) };
    sleepers.add(s);
  });
}
function hang() { return new Promise(resolve => { sleepers.add({ resolve, timer: null }); }); }
function wakeAll() {
  for (const s of sleepers) { if (s.timer) clearTimeout(s.timer); s.resolve(); }
  sleepers.clear();
}

// ── Static server (per-scenario overrides via ctx.serve) ──
let serveOverrides = new Map();
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (status, body, type) => {
      res.writeHead(status, { 'content-type': type || 'text/plain', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const ov = serveOverrides.get(urlPath);
    if (ov !== undefined) {
      if (ov === null) return send(404, '');
      const v = typeof ov === 'function' ? ov(req) : ov;
      if (v === null) return send(404, '');
      if (Buffer.isBuffer(v) || typeof v === 'string') return send(200, v, CONTENT_TYPES[path.extname(urlPath)]);
      return send(v.status || 200, descriptorBody(v), (v.headers && v.headers['content-type']) || CONTENT_TYPES[path.extname(urlPath)]);
    }
    if (PINNED_FILES[urlPath]) return send(200, fs.readFileSync(fixturePath(PINNED_FILES[urlPath])), CONTENT_TYPES['.json']);
    const file = path.join(REPO_ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(REPO_ROOT + path.sep) && file !== REPO_ROOT) return send(403, '');
    fs.readFile(file, (err, data) => {
      if (err) return send(404, '');
      send(200, data, CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ── External routing ────────────────────────────────────
async function fulfill(route, d) {
  if (d.delayMs > 0) await sleep(d.delayMs);
  const headers = Object.assign({}, d.headers || {});
  const body = descriptorBody(d);
  await route.fulfill({ status: d.status == null ? 200 : d.status, headers, body });
}

const API_ERRORS = {
  marine: ERRORS.openMeteoInvalidModel,
  wind: () => ({ status: 400, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, json: { error: true, reason: 'stubbed error' } }),
  archive: ERRORS.serviceUnavailable,
  coops: ERRORS.coopsNoPredictions
};

// Applies one mode for a data API; returns when the route is handled.
async function applyMode(route, mode, key, net, url, okDescriptor) {
  const request = route.request();
  if (typeof mode === 'function') {
    const out = await mode(url, request);
    if (out === 'abort') return route.abort('connectionfailed');
    if (out === 'hang') { await hang(); return route.abort('timedout'); }
    if (out && typeof out === 'object') return fulfill(route, out);
    mode = 'ok';
  }
  switch (mode) {
    case 'ok':
      if (!okDescriptor) return fulfill(route, Object.assign(ERRORS.serviceUnavailable(), { delayMs: net.latencyMs }));
      return fulfill(route, Object.assign({}, okDescriptor, { delayMs: net.latencyMs }));
    case 'down': return fulfill(route, Object.assign(ERRORS.serviceUnavailable(), { delayMs: net.latencyMs }));
    case 'error': return fulfill(route, Object.assign(API_ERRORS[key] ? API_ERRORS[key]() : ERRORS.serviceUnavailable(), { delayMs: net.latencyMs }));
    case 'abort': return route.abort('connectionfailed');
    case 'hang': await hang(); return route.abort('timedout');
    default: throw new Error(`net.${key}: unknown mode ${mode}`);
  }
}

function ndbcFixtureFromProxy(u) {
  // The proxied NDBC URL travels URL-encoded in the query string.
  const target = u.searchParams.get('url') || u.searchParams.get('quest') || decodeURIComponent(u.search.slice(1));
  return target ? apiFixtureFor(target) : null;
}

function makeExternalRouter(ctx) {
  return async route => {
    const request = route.request();
    const url = request.url();
    const u = new URL(url);
    const host = u.hostname;
    const net = ctx.net;
    try {
      if (host === 'marine-api.open-meteo.com') return await applyMode(route, net.marine, 'marine', net, url, apiFixtureFor(url));
      if (host === 'api.open-meteo.com') return await applyMode(route, net.wind, 'wind', net, url, apiFixtureFor(url));
      if (host === 'archive-api.open-meteo.com') return await applyMode(route, net.archive, 'archive', net, url, null);
      if (host === 'api.tidesandcurrents.noaa.gov') return await applyMode(route, net.coops, 'coops', net, url, apiFixtureFor(url));

      if (host === 'www.ndbc.noaa.gov') {
        if (typeof net.ndbc === 'function') return await applyMode(route, net.ndbc, 'ndbc', net, url, apiFixtureFor(url));
        if (net.ndbc === 'abort') return await route.abort('connectionfailed');
        const fx = apiFixtureFor(url) || { status: 404, body: '' };
        // No access-control-allow-origin unless a scenario opts in: the
        // browser then fails the fetch exactly like production.
        const d = Object.assign({}, fx, { delayMs: net.latencyMs });
        if (net.ndbc === 'ok') d.headers = Object.assign({}, fx.headers, { 'access-control-allow-origin': '*' });
        return await fulfill(route, d);
      }

      if (host === 'corsproxy.io' || host === 'api.allorigins.win' || host === 'api.codetabs.com') {
        const mode = net.proxies;
        if (typeof mode === 'function') return await applyMode(route, mode, 'proxies', net, url, null);
        if (mode === 'abort') return await route.abort('connectionfailed');
        if (mode === 'hang') { await hang(); return await route.abort('timedout'); }
        if (mode === 'ok') {
          const fx = ndbcFixtureFromProxy(u);
          return await fulfill(route, fx
            ? Object.assign({}, fx, { delayMs: net.latencyMs, headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' } })
            : { status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
        }
        if (mode !== 'dead') throw new Error('net.proxies: unknown mode ' + mode);
        // Live behaviour recorded 2026-10-01.
        if (host === 'corsproxy.io') {
          return await fulfill(route, { status: 403, delayMs: 150, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, json: { error: 'keyless_legacy_url', message: 'corsproxy.io requires an API key for this URL format' } });
        }
        if (host === 'api.allorigins.win') {
          return await fulfill(route, { status: 522, delayMs: net.alloriginsDelayMs, headers: { 'content-type': 'text/plain' }, body: 'error code: 522' });
        }
        return await fulfill(route, { status: 503, delayMs: 200, headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }, body: 'error code: 1200' });
      }

      if ((host === 'unpkg.com' || host === 'cdn.jsdelivr.net') && /leaflet@1\.9\.4\/dist\/leaflet\.(js|css)$/.test(u.pathname)) {
        if (net.leaflet === 'abort') return await route.abort('connectionfailed');
        if (net.leaflet === 'hang') { await hang(); return await route.abort('timedout'); }
        const css = u.pathname.endsWith('.css');
        return await fulfill(route, { status: 200, headers: { 'content-type': css ? 'text/css' : 'text/javascript', 'access-control-allow-origin': '*' }, file: css ? 'vendor/leaflet-1.9.4.css' : 'vendor/leaflet-1.9.4.js' });
      }

      if (host === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) {
        if (net.firebase === 'abort') return await route.abort('connectionfailed');
        if (net.firebase === 'hang') { await hang(); return await route.abort('timedout'); }
        const isApp = /firebase-app-compat\.js$/.test(u.pathname);
        return await fulfill(route, { status: 200, headers: { 'content-type': 'text/javascript' }, body: isApp ? readFixture('firebase-stub.js') : '/* firebase compat module stubbed: see firebase-stub.js */' });
      }

      if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
        if (net.fonts === 'abort') return await route.abort('connectionfailed');
        return await fulfill(route, { status: host === 'fonts.googleapis.com' ? 200 : 404, headers: { 'content-type': 'text/css', 'access-control-allow-origin': '*' }, body: '' });
      }

      if (/(^|\.)basemaps\.cartocdn\.com$|(^|\.)tile\.openstreetmap\.org$/.test(host)) {
        if (net.tiles === 'abort') return await route.abort('connectionfailed');
        return await fulfill(route, { status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: PNG_1PX });
      }

      if (/(^|\.)windy\.com$/.test(host)) {
        return await fulfill(route, { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>windy stub</title>' });
      }

      ctx.unhandled.push(url);
      return await route.abort('blockedbyclient');
    } catch (e) {
      // Page/context already gone, or the app aborted the request: ignore.
      if (!/closed|Target|Route is already handled|has been closed/i.test(String(e && e.message))) {
        ctx.routeErrors.push(String(e && e.stack || e));
      }
    }
  };
}

// ── Scenario context ────────────────────────────────────
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function createCtx({ page, context, baseURL, slug, options }) {
  const ctx = {
    page, context, baseURL, options,
    net: Object.assign({}, DEFAULT_NET, options.net || {}),
    t0: Date.now(),
    requests: [],
    unhandled: [],
    routeErrors: [],
    pageErrors: [],
    consoleErrors: [],
    metrics: {},
    screenshots: [],
    _allowedPageErrors: [],
    url: (p = '/') => new URL(p, baseURL).href,
    async open(p = '/', opts = {}) {
      ctx.t0 = Date.now();
      if (!/[?&](preview|classic)=/.test(p)) p += (p.includes('?') ? '&' : '?') + 'classic=1';
      return page.goto(ctx.url(p), Object.assign({ waitUntil: 'domcontentloaded' }, opts));
    },
    // Poll fn/expression in the page (Node-side polling, so it works with a
    // paused page clock) until truthy. Resolves { ms (since ctx.open), value }.
    async waitFor(fnOrExpr, { arg, timeout = 30000, interval = 50, label } = {}) {
      const start = Date.now();
      let last, lastErr = null;
      for (;;) {
        try {
          last = await (typeof fnOrExpr === 'function' ? page.evaluate(fnOrExpr, arg) : page.evaluate(fnOrExpr));
          lastErr = null;
          if (last) return { ms: Date.now() - ctx.t0, value: last };
        } catch (e) {
          // Retry while the page is (re)loading or app globals are not defined yet.
          if (!/Execution context was destroyed|navigation|Cannot find context|ReferenceError|TypeError/i.test(String(e.message))) throw e;
          lastErr = e;
        }
        if (Date.now() - start > timeout) {
          throw new Error(`waitFor timed out after ${timeout} ms: ${label || String(fnOrExpr).slice(0, 120)} ` +
            (lastErr ? `(last error: ${String(lastErr.message).split('\n')[0]})` : `(last value: ${JSON.stringify(last)})`));
        }
        await sleep(interval);
      }
    },
    // ms from ctx.open() until the forecast chart has been laid out.
    async waitForChart({ timeout = 60000 } = {}) {
      const r = await ctx.waitFor('!!(STATE.forecastChart && STATE.forecastChart.times && STATE.forecastChart.times.length)', { timeout, label: 'forecast chart drawn' });
      return r.ms;
    },
    // ms from ctx.open() until _loadAllDataImpl finished (STATE.lastLoadCompletedAt).
    async waitForLoad({ timeout = 60000 } = {}) {
      const r = await ctx.waitFor('!!STATE.lastLoadCompletedAt', { timeout, label: 'STATE.lastLoadCompletedAt' });
      return r.ms;
    },
    // Evaluate an expression/function in the page.
    state: (fnOrExpr, arg) => page.evaluate(fnOrExpr, arg),
    requestsTo: (re) => ctx.requests.filter(r => (re instanceof RegExp ? re.test(r.url) : r.url.includes(re))),
    // Override a same-origin path: string/Buffer body, descriptor, (req) => …, or null (404).
    serve(p, content) { serveOverrides.set(p.startsWith('/') ? p : '/' + p, content); },
    route: (...a) => page.route(...a),
    fixture: readFixture,
    allowPageError(re) { ctx._allowedPageErrors.push(re); },
    metric(name, value) { ctx.metrics[name] = value; },
    async screenshot(name, opts = {}) {
      const file = path.join(ARTIFACT_DIR, `${slug}--${slugify(name)}.png`);
      await page.screenshot(Object.assign({ path: file }, opts));
      ctx.screenshots.push(path.relative(REPO_ROOT, file));
      return file;
    }
  };
  return ctx;
}

async function runScenario(browser, devices, baseURL, file) {
  const mod = require(file);
  const slug = path.basename(file, '.js');
  const scenarioName = mod.name || slug;
  if (typeof mod.run !== 'function') throw new Error(`${slug}: scenario must export run()`);
  const options = Object.assign({}, DEFAULT_OPTIONS, mod.options || {});
  serveOverrides = new Map();

  const contextOptions = Object.assign(
    { timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: 'block' },
    options.device ? devices[options.device] : { viewport: options.viewport },
    options.contextOptions
  );
  if (options.device && !devices[options.device]) throw new Error(`${slug}: unknown Playwright device ${options.device}`);
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const ctx = createCtx({ page, context, baseURL, slug, options });

  const host = new URL(baseURL).host;
  await context.route(u => u.host !== host, makeExternalRouter(ctx));
  context.on('request', req => {
    ctx.requests.push({ t: Date.now() - ctx.t0, method: req.method(), url: req.url(), type: req.resourceType() });
  });
  page.on('pageerror', err => ctx.pageErrors.push(err));
  page.on('console', msg => { if (msg.type() === 'error') ctx.consoleErrors.push(msg.text()); });

  // Init scripts run before any page script on every navigation.
  const fb = options.firebase || {};
  await context.addInitScript(({ gate, storage, fb }) => {
    try { if (gate) sessionStorage.setItem('lcc-gate', gate); } catch (_) { /* opaque origin */ }
    if (storage) {
      try { for (const [k, v] of Object.entries(storage.local || {})) localStorage.setItem(k, v); } catch (_) {}
      try { for (const [k, v] of Object.entries(storage.session || {})) sessionStorage.setItem(k, v); } catch (_) {}
    }
    if (fb.mode) window.__FB_MODE = fb.mode;
    if (fb.logs) window.__FB_LOGS = fb.logs;
    if (fb.fail) window.__FB_FAIL = fb.fail;
    if (fb.firstAuthMs != null) window.__FB_FIRST_AUTH_MS = fb.firstAuthMs;
    if (fb.anonMs != null) window.__FB_ANON_MS = fb.anonMs;
    if (fb.fsMs != null) window.__FB_FS_MS = fb.fsMs;
    if (fb.noStorage) window.__FB_NO_STORAGE = true;
  }, { gate: options.gate, storage: options.storage, fb });

  if (options.clock === 'install') await context.clock.install({ time: new Date(options.now) });
  else if (options.clock === 'fixed') await context.clock.setFixedTime(new Date(options.now));
  else if (options.clock !== 'none') throw new Error(`${slug}: options.clock must be install | fixed | none`);

  const log = (...args) => console.log(`    [${slug}]`, ...args);
  const started = Date.now();
  let error = null;
  let timer;
  try {
    await Promise.race([
      mod.run({ page, ctx, assert, log }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`scenario timed out after ${options.timeoutMs} ms`)), options.timeoutMs); })
    ]);
    const fatal = ctx.pageErrors.filter(e => !ctx._allowedPageErrors.some(re => re.test(String(e && e.message))));
    if (fatal.length) throw new Error(`${fatal.length} uncaught page error(s):\n      ` + fatal.map(e => String(e && e.stack || e).split('\n').slice(0, 3).join('\n      ')).join('\n      '));
    if (ctx.routeErrors.length) throw new Error('route handler error(s):\n' + ctx.routeErrors.join('\n'));
  } catch (e) {
    error = e;
    try { await ctx.screenshot('failure'); } catch (_) { /* page may be gone */ }
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - started;
  await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  wakeAll();
  await context.close().catch(() => {});
  wakeAll();
  return { file: path.relative(REPO_ROOT, file), name: scenarioName, ok: !error, ms, error, ctx };
}

async function main() {
  const args = process.argv.slice(2);
  const list = args.includes('--list');
  const filters = args.filter(a => !a.startsWith('--'));
  // Arguments that are existing .js files run directly (scratch scenarios).
  const explicit = filters.filter(a => a.endsWith('.js') && fs.existsSync(a)).map(a => path.resolve(a));
  const files = explicit.length ? explicit
    : fs.readdirSync(SCENARIO_DIR).filter(f => f.endsWith('.js')).sort().map(f => path.join(SCENARIO_DIR, f));
  const selected = explicit.length ? files : files.filter(f => {
    if (!filters.length) return true;
    const name = (() => { try { return require(f).name || ''; } catch (_) { return ''; } })();
    return filters.some(q => path.basename(f).includes(q) || name.toLowerCase().includes(q.toLowerCase()));
  });
  if (list) { selected.forEach(f => console.log(path.relative(REPO_ROOT, f) + '  —  ' + (require(f).name || ''))); return; }
  if (!selected.length) { console.error('No scenarios matched', filters); process.exit(1); }

  fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const { chromium, devices } = loadPlaywright();
  const server = await startServer();
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ headless: !process.env.E2E_HEADED });
  console.log(`e2e: ${selected.length} scenario(s) against ${baseURL} (allorigins delay ${DEFAULT_NET.alloriginsDelayMs} ms)\n`);

  const results = [];
  for (const file of selected) {
    process.stdout.write(`  … ${path.basename(file)}\n`);
    let r;
    try {
      r = await runScenario(browser, devices, baseURL, file);
    } catch (e) {
      r = { file: path.relative(REPO_ROOT, file), name: path.basename(file), ok: false, ms: 0, error: e, ctx: null };
    }
    results.push(r);
    const mark = r.ok ? '✔' : '✖';
    const metrics = r.ctx && Object.keys(r.ctx.metrics).length ? '  ' + JSON.stringify(r.ctx.metrics) : '';
    console.log(`  ${mark} ${r.name} (${(r.ms / 1000).toFixed(1)} s)${metrics}`);
    if (r.ctx && r.ctx.unhandled.length) console.log(`    ! unrouted external requests (aborted): ${[...new Set(r.ctx.unhandled)].join(', ')}`);
    if (!r.ok) {
      console.log('    ' + String(r.error && r.error.stack || r.error).split('\n').slice(0, 8).join('\n    '));
      if (r.ctx && r.ctx.consoleErrors.length) console.log('    console errors:\n      ' + r.ctx.consoleErrors.slice(0, 10).join('\n      '));
    }
  }

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'results.json'), JSON.stringify(results.map(r => ({
    file: r.file, name: r.name, ok: r.ok, ms: r.ms, error: r.error ? String(r.error.message || r.error) : null,
    metrics: r.ctx ? r.ctx.metrics : {}, screenshots: r.ctx ? r.ctx.screenshots : [],
    pageErrors: r.ctx ? r.ctx.pageErrors.map(e => String(e && e.message || e)) : [],
    consoleErrors: r.ctx ? r.ctx.consoleErrors : [], unhandled: r.ctx ? [...new Set(r.ctx.unhandled)] : [],
    requestsByHost: r.ctx ? r.ctx.requests.reduce((acc, q) => { const h = new URL(q.url).host; acc[h] = (acc[h] || 0) + 1; return acc; }, {}) : {}
  })), null, 2));
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed — artifacts in ${path.relative(REPO_ROOT, ARTIFACT_DIR)}/`);
  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { DEFAULT_OPTIONS, DEFAULT_NET, PINNED_FILES };
