// Loads the real app.js (and optionally firebase-config.js + kiosk.js) into
// a node:vm context with browser stubs, so node:test files can call app
// functions and read STATE without a browser or npm install.
//
//   const { loadApp, fixtureFetch, FIXTURE_NOW } = require('../helpers/load-app');
//   const app = loadApp({ kiosk: true });
//   app.get('CONFIG').chocomount.swellWindowMin        // → 115
//   app.call('calcDaylight', 41.27, -71.96, new Date()) // sandbox-realm object
//   app.clone('STATE.surfLog')                          // outer-realm deep copy
//
// Options (all optional):
//   kiosk     true → also run kiosk.js after app.js (default false).
//   search    location.search, e.g. '?kiosk=1' to take kiosk.js's boot
//             branch (default ''; with kiosk: true the kiosk functions are
//             defined but Choc TV does not boot).
//   firebase  true or { mode, logs, fail, firstAuthMs, anonMs, fsMs,
//             noStorage, rules } → run tests/fixtures/firebase-stub.js and
//             the real firebase-config.js before app.js (default: not
//             loaded; the globals firebase/fbAuth/fbFirestore are then
//             undefined).
//   fetch     async (url, init) => Response | descriptor | null, where a
//             descriptor is { status = 200, body | json | file, headers,
//             delayMs } (`file` is a path under tests/fixtures; delayMs runs
//             on the fake clock, so an AbortController timeout can win).
//             Throwing/rejecting/null = network error. Default: every request
//             rejects (unit tests stay offline). fixtureFetch() serves the
//             recordings; a never-settling promise emulates a hung host.
//   now       start instant (ISO string, ms or Date). Default FIXTURE_NOW
//             (2026-10-01T11:00:00-04:00), the instant the fixtures match.
//   timers    'fake' (default): Date, setTimeout/setInterval, rAF and
//             performance.now run on app.clock — time stands still until
//             you call app.clock.tick(ms). 'real': Date starts at `now` and
//             flows; timers are real (call app.dispose() when done).
//   storage   { local: {k: v}, session: {k: v}, quotaBytes } seeds
//             localStorage / sessionStorage (values stringified).
//   dom       'auto' (default): getElementById auto-creates a stable fake
//             element per id. 'null': unknown ids return null.
//   console   'capture' (default; read app.logs) | 'pass' (print) | object.
//   tz        sets process.env.TZ for the WHOLE test process (Node applies
//             it immediately). Default: TZ from the environment, falling
//             back to America/New_York (npm test sets it explicitly).
//
// Returned object:
//   run(code)          evaluate JS source in the app's global scope; returns
//                      the raw (sandbox-realm) value. Top-level const/let
//                      bindings (STATE, CONFIG, ...) are reachable here.
//   get(name)          value of a global binding (const/let/function/var).
//   set(name, value)   assign a let/var/function binding or global property
//                      (consts cannot be reassigned; mutate them instead,
//                      e.g. app.get('STATE').surfLog = [...]).
//   call(name, ...args) call a global function with outer-realm args.
//   clone(codeOrValue) structuredClone into THIS realm — use before
//                      assert.deepStrictEqual (sandbox objects have
//                      different Array/Object prototypes). Functions are
//                      not cloneable.
//   context            the vm context (window === globalThis === context).
//   window, document, localStorage, sessionStorage   the stubs.
//   dom.byId(id)       the fake element for id (textContent, classList,
//                      style, dataset, getContext('2d').__calls ...).
//   fire(type, init, target='document')  dispatch an event to document or
//                      window listeners ('DOMContentLoaded', 'visibilitychange').
//   clock.now()        current fake time (ms).
//   clock.set(t)       jump to t without firing timers.
//   await clock.tick(ms)  advance, firing due timers in order (flushing
//                      promise jobs after each); rethrows a timer's error.
//   await clock.fastForward(ms)  jump ahead; each due timer fires once
//                      (use for long jumps — tick replays every rAF frame).
//   await clock.flush()   let pending promise jobs / fetch replies settle.
//   clock.pending()    number of scheduled fake timers.
//   fetchLog           [{ url, method, t }] for every fetch() the app made.
//   logs               [{ level, args }] captured console output.
//   dialogs            [{ type, message }] alert/confirm/prompt calls
//                      (confirm returns true, prompt returns null).
//   reloads            clock times at which location.reload() was called.
//   location           the location stub (search, href, reload()).
//   dispose()          clear all timers (needed only with timers: 'real').
//
// Also exported: fixtureFetch({ overrides: [[match, responder], ...] })
// (match = substring | RegExp | url => bool; responder = descriptor |
// (url, init) => descriptor | 'network-error'), FIXTURE_NOW(_MS),
// readFixture(rel), readFixtureJSON(rel), fixturePath(rel), ERRORS (canned
// CO-OPS / Open-Meteo error descriptors), REPO_ROOT.
'use strict';

if (!process.env.TZ) process.env.TZ = 'America/New_York';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO_ROOT, FIXTURE_NOW, FIXTURE_NOW_MS, apiFixtureFor, descriptorBody, fixturePath, readFixture, readFixtureJSON, ERRORS } = require('./fixtures');
const { FakeEvent, FakeEventTarget, FakeDocument, createStorage } = require('./dom-stub');

// Bindings defined near the END of each script. If one is missing after
// the load, the script threw part-way (e.g. a stub gap) and every later
// top-level const would be stuck in its temporal dead zone.
const APP_SENTINELS = [
  "typeof STATE === 'object' && typeof CONFIG === 'object'",
  "typeof REG_THRESHOLD_KEYS === 'object'",            // Tab 2 §5, near the end of app.js
  "document.listeners('DOMContentLoaded').some(f => f === initGate)"  // app.js's last statement
];
const KIOSK_SENTINELS = [
  "typeof KIOSK === 'object' && typeof kioskDaySummary === 'function'",
  "typeof kioskInit === 'function'"
];

function toMs(t) {
  if (t == null) return FIXTURE_NOW_MS;
  if (typeof t === 'number') return t;
  if (t && typeof t.getTime === 'function') return t.getTime();   // Date from either realm
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) throw new Error('loadApp: bad `now` value ' + t);
  return ms;
}

// ── Fake clock + timers ─────────────────────────────────
function createClock(startMs, mode) {
  const realStart = Date.now();
  let now = startMs;
  let seq = 0;
  const timers = new Map();
  const realHandles = new Set();
  const flush = () => new Promise(resolve => setImmediate(resolve));

  const clock = {
    mode,
    now: () => (mode === 'real' ? startMs + (Date.now() - realStart) : now),
    set(t) {
      if (mode === 'real') throw new Error('clock.set needs timers: "fake"');
      now = toMs(t);
    },
    pending: () => (mode === 'real' ? realHandles.size : timers.size),
    flush: async () => { for (let i = 0; i < 3; i++) await flush(); },
    async tick(ms) {
      if (mode === 'real') throw new Error('clock.tick needs timers: "fake"');
      const target = now + Math.max(0, Number(ms) || 0);
      await clock.flush();
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.due <= target && (!next || t.due < next.due || (t.due === next.due && t.seq < next.seq))) next = t;
        }
        if (!next) break;
        now = Math.max(now, next.due);
        if (next.interval != null) { next.due += next.interval; next.seq = ++seq; } else timers.delete(next.id);
        if (typeof next.fn === 'function') next.fn(...next.args);
        await clock.flush();
      }
      now = target;
      await clock.flush();
    },
    // Jump ahead like Playwright's clock.fastForward: every timer that came
    // due fires ONCE (intervals resume from the new time). Use this for
    // long jumps (e.g. a 15-min kiosk refresh) — tick() would replay every
    // 16 ms animation frame in between.
    async fastForward(ms) {
      if (mode === 'real') throw new Error('clock.fastForward needs timers: "fake"');
      now += Math.max(0, Number(ms) || 0);
      const due = [...timers.values()].filter(t => t.due <= now).sort((a, b) => a.due - b.due || a.seq - b.seq);
      for (const t of due) {
        if (!timers.has(t.id)) continue;   // cleared by an earlier callback
        if (t.interval != null) { t.due = now + t.interval; t.seq = ++seq; } else timers.delete(t.id);
        if (typeof t.fn === 'function') t.fn(...t.args);
        await clock.flush();
      }
      await clock.flush();
    },
    dispose() {
      timers.clear();
      for (const h of realHandles) { clearTimeout(h); clearInterval(h); }
      realHandles.clear();
    }
  };

  let api;
  if (mode === 'real') {
    const track = (h) => { realHandles.add(h); return h; };
    api = {
      setTimeout: (fn, ms, ...a) => { const h = setTimeout(() => { realHandles.delete(h); fn(...a); }, ms); return track(h); },
      clearTimeout: h => { realHandles.delete(h); clearTimeout(h); },
      setInterval: (fn, ms, ...a) => track(setInterval(fn, ms, ...a)),
      clearInterval: h => { realHandles.delete(h); clearInterval(h); }
    };
  } else {
    const add = (fn, ms, args, interval) => {
      const id = ++seq;
      timers.set(id, { id, seq: id, fn, args, due: now + Math.max(0, Number(ms) || 0), interval });
      return id;
    };
    api = {
      setTimeout: (fn, ms, ...a) => add(fn, ms, a, null),
      clearTimeout: id => { timers.delete(id); },
      setInterval: (fn, ms, ...a) => add(fn, ms, a, Math.max(1, Number(ms) || 0)),
      clearInterval: id => { timers.delete(id); }
    };
  }
  api.requestAnimationFrame = fn => api.setTimeout(() => fn(clock.now() - startMs), 16);
  api.cancelAnimationFrame = id => api.clearTimeout(id);
  api.requestIdleCallback = fn => api.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 1);
  api.cancelIdleCallback = id => api.clearTimeout(id);
  clock.api = api;
  return clock;
}

// Runs inside the sandbox so `Date` stays a sandbox-realm Date (instanceof
// Date and Date.prototype methods behave natively) while reading the clock.
const DATE_SHIM = `(function (clockNow) {
  'use strict';
  const RealDate = globalThis.Date;
  function LccDate(...args) {
    if (!new.target) return new RealDate(clockNow()).toString();
    const d = args.length ? new RealDate(...args) : new RealDate(clockNow());
    if (new.target !== LccDate) Object.setPrototypeOf(d, new.target.prototype);
    return d;
  }
  LccDate.prototype = RealDate.prototype;
  LccDate.now = () => clockNow();
  LccDate.parse = RealDate.parse;
  LccDate.UTC = RealDate.UTC;
  Object.defineProperty(LccDate, 'name', { value: 'Date' });
  globalThis.Date = LccDate;
})`;

// Sandbox-side Response so resp.json() yields sandbox-realm objects.
const RESPONSE_SHIM = `(function (status, statusText, headers, text, url) {
  return {
    ok: status >= 200 && status < 300, status, statusText, url, redirected: false, type: 'basic',
    headers: { get: k => headers[String(k).toLowerCase()] ?? null, has: k => String(k).toLowerCase() in headers },
    text: async () => text,
    json: async () => JSON.parse(text),
    blob: async () => ({ size: text.length, type: headers['content-type'] || '', text: async () => text }),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    clone() { return this; }
  };
})`;

function abortError() {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

// A fetch for loadApp({ fetch }) answering every recorded API from
// tests/fixtures (see helpers/fixtures.js). `overrides` is
// [[matcher, responder], ...] checked first: matcher is a substring, RegExp
// or (url) => bool; responder is a descriptor, a function (url, init) =>
// descriptor, or the string 'network-error'. Unmatched URLs reject.
function fixtureFetch({ overrides = [], repoFiles = true } = {}) {
  return async function (url, init) {
    for (const [match, responder] of overrides) {
      const hit = typeof match === 'string' ? url.includes(match)
        : match instanceof RegExp ? match.test(url) : match(url);
      if (!hit) continue;
      if (responder === 'network-error') throw new TypeError('Failed to fetch');
      return typeof responder === 'function' ? responder(url, init) : responder;
    }
    const fx = apiFixtureFor(url);
    if (fx) return fx;
    // Same-origin relative paths (data/buoy.json, ...) come from the repo,
    // except the bot-owned pipeline files, which use frozen snapshots.
    if (repoFiles && !/^[a-z]+:/i.test(url)) {
      const rel = url.replace(/^\.?\//, '').split(/[?#]/)[0];
      const pinned = { 'data/buoy.json': 'pipeline/buoy.json', 'data/verification.json': 'pipeline/verification.json' }[rel];
      if (pinned) return { status: 200, file: pinned, headers: { 'content-type': 'application/json' } };
      const p = path.join(REPO_ROOT, rel);
      if (p.startsWith(REPO_ROOT) && fs.existsSync(p) && fs.statSync(p).isFile()) {
        return { status: 200, body: fs.readFileSync(p, 'utf8') };
      }
      return { status: 404, body: '' };
    }
    throw new TypeError('Failed to fetch (no fixture for ' + url + ')');
  };
}

function loadApp(opts = {}) {
  const {
    kiosk = false,
    search = '',
    firebase = false,
    fetch: userFetch = null,
    now,
    timers = 'fake',
    storage = {},
    dom = 'auto',
    console: consoleOpt = 'capture',
    tz
  } = opts;
  if (tz) process.env.TZ = tz;
  if (timers !== 'fake' && timers !== 'real') throw new Error('loadApp: timers must be "fake" or "real"');

  const startMs = toMs(now);
  const clock = createClock(startMs, timers);
  const logs = [];
  const dialogs = [];
  const fetchLog = [];
  const reloads = [];

  const document = new FakeDocument({ autoCreate: dom !== 'null' });
  const windowEvents = new FakeEventTarget();
  const localStorage = createStorage(storage.local, { quotaBytes: storage.quotaBytes || 0 });
  const sessionStorage = createStorage(storage.session);
  const loc = new URL('http://lcc.test/' + (search && !search.startsWith('?') ? '?' + search : search));

  const capture = level => (...args) => logs.push({ level, args });
  const sandboxConsole = consoleOpt === 'pass' ? console
    : (consoleOpt && typeof consoleOpt === 'object') ? consoleOpt
    : { log: capture('log'), info: capture('info'), warn: capture('warn'), error: capture('error'), debug: capture('debug'), group() {}, groupEnd() {}, groupCollapsed() {}, table: capture('table'), time() {}, timeEnd() {} };

  const noopObserver = function () { return { observe() {}, unobserve() {}, disconnect() {}, takeRecords: () => [] }; };

  const sandbox = {
    console: sandboxConsole,
    // timers (fake or tracked-real)
    ...clock.api,
    queueMicrotask,
    structuredClone,
    // web platform bits Node already has
    AbortController, AbortSignal, URL, URLSearchParams, TextEncoder, TextDecoder, Blob, atob, btoa,
    crypto: globalThis.crypto,
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    // browser objects
    document,
    location: {
      href: loc.href, origin: loc.origin, protocol: loc.protocol, host: loc.host, hostname: loc.hostname,
      port: loc.port, pathname: loc.pathname, search: loc.search, hash: loc.hash,
      reload() { reloads.push(clock.now()); },
      assign() {}, replace() {}, toString() { return loc.href; }
    },
    history: { pushState() {}, replaceState() {}, back() {}, state: null },
    navigator: { userAgent: 'node-vm (LetsCheckChoc tests)', language: 'en-US', languages: ['en-US'], onLine: true, maxTouchPoints: 0, platform: 'node' },
    screen: { width: 1280, height: 900, orientation: { type: 'landscape-primary', angle: 0 } },
    localStorage,
    sessionStorage,
    performance: { now: () => clock.now() - startMs, mark() {}, measure() {}, getEntriesByName: () => [] },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 900,
    scrollX: 0,
    scrollY: 0,
    matchMedia: query => ({ matches: false, media: String(query), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: elm => new Proxy(Object.assign({}, elm && elm.style), {
      get: (t, p) => (p === 'getPropertyValue' ? (k => t[k] || '') : (p in t ? t[p] : ''))
    }),
    scrollTo() {},
    scrollBy() {},
    alert: message => { dialogs.push({ type: 'alert', message: String(message) }); },
    confirm: message => { dialogs.push({ type: 'confirm', message: String(message) }); return true; },
    prompt: message => { dialogs.push({ type: 'prompt', message: String(message) }); return null; },
    ResizeObserver: noopObserver,
    IntersectionObserver: noopObserver,
    MutationObserver: noopObserver,
    Image: function Image() { return { width: 0, height: 0, complete: true, naturalWidth: 0, naturalHeight: 0, addEventListener() {}, removeEventListener() {}, decode: () => Promise.resolve() }; },
    FileReader: function FileReader() { return { readAsDataURL() {}, readAsText() {}, addEventListener() {}, result: null }; },
    XMLHttpRequest: function XMLHttpRequest() { return { open() {}, send() {}, setRequestHeader() {}, addEventListener() {} }; },
    addEventListener: (t, f) => windowEvents.addEventListener(t, f),
    removeEventListener: (t, f) => windowEvents.removeEventListener(t, f),
    dispatchEvent: ev => windowEvents.dispatchEvent(ev)
  };

  // window === self === globalThis, as in a browser.
  const context = vm.createContext(sandbox, { name: 'LetsCheckChoc app.js' });
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis; globalThis.top = globalThis; globalThis.parent = globalThis;', context);
  vm.runInContext(DATE_SHIM, context)(() => clock.now());
  const makeResponse = vm.runInContext(RESPONSE_SHIM, context);

  // fetch: logs every call, honours AbortSignal, normalises the injected
  // implementation's answer into a sandbox-realm Response.
  context.fetch = function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    fetchLog.push({ url, method: (init.method || 'GET').toUpperCase(), t: clock.now() });
    const signal = init.signal;
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      let settled = false;
      const onAbort = () => { if (!settled) { settled = true; reject(abortError()); } };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => (userFetch ? userFetch(url, init) : Promise.reject(new TypeError('fetch blocked in unit test (pass loadApp({ fetch })): ' + url))))
        .then(async res => {
          if (res == null) throw new TypeError('Failed to fetch ' + url);
          const proto = Object.getPrototypeOf(res);
          const isDescriptor = proto === Object.prototype || proto === null;
          if (!isDescriptor && typeof res.text === 'function') {
            // A WHATWG Response (or look-alike) from the injected fetch.
            const headers = {};
            if (res.headers && typeof res.headers.forEach === 'function') res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
            return makeResponse(res.status, res.statusText || '', headers, await res.text(), url);
          }
          // Descriptor { status, body | json | file, headers, delayMs }.
          if (res.delayMs > 0) await new Promise(r => clock.api.setTimeout(r, res.delayMs));
          const headers = {};
          for (const [k, v] of Object.entries(res.headers || {})) headers[k.toLowerCase()] = v;
          const body = descriptorBody(res);
          return makeResponse(res.status == null ? 200 : res.status, '', headers, Buffer.isBuffer(body) ? body.toString('utf8') : String(body), url);
        })
        .then(r => { if (!settled) { settled = true; resolve(r); } },
              e => { if (!settled) { settled = true; reject(e instanceof Error ? e : new TypeError(String(e))); } });
    });
  };

  const run = (code, filename) => vm.runInContext(code, context, { filename: filename || 'test-eval.js' });

  function runFile(rel) {
    const file = path.join(REPO_ROOT, rel);
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    } catch (e) {
      e.message = `loadApp: ${rel} threw during load: ${e.message}`;
      throw e;
    }
  }
  function assertSentinels(list, rel) {
    for (const expr of list) {
      let ok = false;
      try { ok = !!run(expr); } catch (_) { ok = false; }
      if (!ok) throw new Error(`loadApp: ${rel} did not run to completion (sentinel failed: ${expr})`);
    }
  }

  if (firebase) {
    const fb = firebase === true ? {} : firebase;
    if (fb.mode) context.__FB_MODE = fb.mode;
    if (fb.logs) context.__FB_LOGS = fb.logs;
    if (fb.fail) context.__FB_FAIL = fb.fail;
    if (fb.firstAuthMs != null) context.__FB_FIRST_AUTH_MS = fb.firstAuthMs;
    if (fb.anonMs != null) context.__FB_ANON_MS = fb.anonMs;
    if (fb.fsMs != null) context.__FB_FS_MS = fb.fsMs;
    if (fb.noStorage) context.__FB_NO_STORAGE = true;
    if (fb.rules) context.__FB_RULES = true;
    runFile('tests/fixtures/firebase-stub.js');
    runFile('firebase-config.js');
  }
  runFile('app.js');
  assertSentinels(APP_SENTINELS, 'app.js');
  if (kiosk) {
    runFile('kiosk.js');
    assertSentinels(KIOSK_SENTINELS, 'kiosk.js');
  }

  const IDENT = /^[A-Za-z_$][\w$]*$/;
  const app = {
    context,
    window: context,
    document,
    localStorage,
    sessionStorage,
    clock,
    logs,
    dialogs,
    fetchLog,
    reloads,
    location: context.location,
    run,
    get(name) {
      if (!IDENT.test(name)) throw new Error('app.get expects an identifier, got ' + name);
      return run(name);
    },
    set(name, value) {
      if (!IDENT.test(name)) throw new Error('app.set expects an identifier, got ' + name);
      context.__lccValue = value;
      try { run(`${name} = globalThis.__lccValue`); } finally { delete context.__lccValue; }
    },
    call(name, ...args) {
      if (!IDENT.test(name)) throw new Error('app.call expects a function name, got ' + name);
      context.__lccArgs = args;
      try { return run(`${name}(...globalThis.__lccArgs)`); } finally { delete context.__lccArgs; }
    },
    clone(codeOrValue) {
      return structuredClone(typeof codeOrValue === 'string' ? run(codeOrValue) : codeOrValue);
    },
    dom: {
      byId: id => document.getElementById(id)
    },
    fire(type, init = {}, target = 'document') {
      const ev = new FakeEvent(type, init);
      if (type === 'DOMContentLoaded') document.readyState = 'interactive';
      return target === 'window' ? windowEvents.dispatchEvent(ev) : document.dispatchEvent(ev);
    },
    dispose() { clock.dispose(); }
  };
  return app;
}

module.exports = {
  loadApp,
  fixtureFetch,
  FIXTURE_NOW,
  FIXTURE_NOW_MS,
  fixturePath,
  readFixture,
  readFixtureJSON,
  ERRORS,
  REPO_ROOT
};
