// Choc TV self-heal and deploy pickup (audit C32, C34). The kiosk runs for
// weeks under Guided Access, so it must mend a boot that hit a Wi-Fi blip,
// and pick up new code, without anyone touching it. Every reload goes
// through the same guards: a successful probe of the site first, at most
// once per 30 min (persisted), never while someone is using the screen.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, REPO_ROOT, FIXTURE_NOW_MS } = require('../helpers/load-app');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const readRepo = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const BUOYS_TEXT = readRepo('data/buoys-east-coast.json');
const TIDES_TEXT = readRepo('data/tide-stations.json');
const RELOAD_KEY = 'lcc-kiosk-last-reload';
// The kiosk page's own URL in the vm (location.pathname + search). Choc TV
// loads as ./?kiosk=1, so that, not 'index.html', is where its HTML lives.
const DOC_URL = '/?kiosk=1';

// A switchable network: the kiosk page probe, the four code files (the
// page's HTML at DOC_URL only) and the two static catalogs. Everything
// else is offline.
function makeNet() {
  const net = {
    calls: [],
    probe: 'ok',                       // 'ok' | 'down' | 'wrong-page'
    files: { 'index.html': '<script src="kiosk.js"></script>', 'app.js': 'A1', 'kiosk.js': 'K1', 'styles-kiosk.css': 'C1' },
    failFiles: new Set(),
    buoys: 'ok',                       // 'ok' | 'down'
    tides: 'ok'
  };
  net.fetch = (url, init = {}) => {
    net.calls.push({ url, cache: init.cache });
    if (url.includes('probe=')) {
      if (net.probe === 'down') throw new TypeError('Failed to fetch');
      return { status: 200, body: net.probe === 'ok' ? net.files['index.html'] : '<h1>Sign in to Wi-Fi</h1>' };
    }
    const file = url === DOC_URL ? 'index.html' : url === 'index.html' ? null : url;
    if (file && Object.prototype.hasOwnProperty.call(net.files, file)) {
      return net.failFiles.has(file) ? { status: 503, body: '' } : { status: 200, body: net.files[file] };
    }
    if (url === 'data/buoys-east-coast.json' && net.buoys === 'ok') return { status: 200, body: BUOYS_TEXT };
    if (url === 'data/tide-stations.json' && net.tides === 'ok') return { status: 200, body: TIDES_TEXT };
    throw new TypeError('Failed to fetch ' + url);
  };
  net.count = re => net.calls.filter(c => re.test(c.url)).length;
  return net;
}

// Choc TV booted in the vm with the app's data path stubbed (selectBuoy,
// loadAllData and the in-flight flag are recorded instead).
function boot(net, { now, storage, state = {} } = {}) {
  const app = loadApp({ kiosk: true, search: '?kiosk=1', fetch: net.fetch, now, storage });
  const rec = { selects: [], loads: 0, inFlight: false };
  app.set('selectBuoy', function (b) { rec.selects.push(b.home); app.get('STATE').selectedBuoy = b; });
  app.set('loadAllData', function () { rec.loads++; });
  app.set('isDataLoadInFlight', function () { return rec.inFlight; });
  Object.assign(app.get('STATE'), state);
  app.call('kioskInit');
  return { app, rec };
}

const probes = net => net.count(/probe=/);

test('pure helpers: kioskShouldReload guards, kioskNextLocalTime (DST-safe), kioskHashText', () => {
  const app = loadApp({ kiosk: true });
  const now = FIXTURE_NOW_MS;
  const ok = o => app.call('kioskShouldReload', Object.assign({ now, lastReloadAt: null, paused: false, infoOpen: false }, o));
  assert.equal(ok({}), true);
  assert.equal(ok({ lastReloadAt: now - 29 * MIN }), false, 'never twice within 30 min');
  assert.equal(ok({ lastReloadAt: now - 30 * MIN }), true);
  assert.equal(ok({ lastReloadAt: now + 5 * MIN }), true, 'a stamp from the future (clock change) is ignored');
  assert.equal(ok({ paused: true }), false, 'never while rotation is paused under a hand');
  assert.equal(ok({ infoOpen: true }), false, 'never while the SOURCES card is open');

  const next = (iso) => app.call('kioskNextLocalTime', 3, 30, Date.parse(iso)) - Date.parse(iso);
  assert.equal(next('2026-10-01T23:00:00-04:00'), 4.5 * HOUR);
  assert.equal(next('2026-10-02T03:29:00-04:00'), 1 * MIN);
  assert.equal(next('2026-10-02T03:30:00-04:00'), 24 * HOUR, 'strictly after');
  // Fall back (2026-11-01) and spring forward (2027-03-14): wall-clock 03:30.
  assert.equal(app.call('kioskNextLocalTime', 3, 30, Date.parse('2026-11-01T00:00:00-04:00')), Date.parse('2026-11-01T03:30:00-05:00'));
  assert.equal(app.call('kioskNextLocalTime', 3, 30, Date.parse('2027-03-14T00:00:00-05:00')), Date.parse('2027-03-14T03:30:00-04:00'));

  const h = s => app.call('kioskHashText', s);
  assert.match(h('abc'), /^[0-9a-f]{8}-3$/);
  assert.equal(h('abc'), h('abc'));
  assert.notEqual(h('abc'), h('abd'));
});

test('boot blip: a buoy catalog that failed at boot is re-fetched until it arrives, then Chocomount is selected', async () => {
  const net = makeNet();
  net.buoys = 'down';
  const { app, rec } = boot(net, { state: { tideStations: JSON.parse(TIDES_TEXT) } });
  const buoyCalls = () => net.count(/buoys-east-coast/);

  await app.clock.tick(11000);
  assert.equal(buoyCalls(), 0, 'initApp gets its own 10 s attempt first');
  await app.clock.tick(2000);
  assert.equal(buoyCalls(), 1);
  assert.deepEqual(rec.selects, []);
  await app.clock.tick(10000);
  assert.equal(buoyCalls(), 1, 'retries every 15 s, not every tick');

  net.buoys = 'ok';                    // Wi-Fi back
  await app.clock.tick(6000);
  assert.equal(buoyCalls(), 2);
  assert.equal(app.get('STATE').buoys.length, JSON.parse(BUOYS_TEXT).length);
  assert.deepEqual(rec.selects, ['chocomount']);
  await app.clock.tick(30000);
  assert.equal(buoyCalls(), 2, 'stops once the list is in');
  assert.equal(net.count(/tide-stations/), 0, 'only the missing list is fetched');
});

test('boot blip: a tide-station catalog that arrives late re-runs the data load once, after any load in flight', async () => {
  const net = makeNet();
  net.tides = 'down';
  const buoys = JSON.parse(BUOYS_TEXT);
  const { app, rec } = boot(net, { state: { buoys, selectedBuoy: buoys.find(b => b.home === 'chocomount') } });

  await app.clock.tick(13000);
  assert.equal(net.count(/tide-stations/), 1);
  assert.equal(rec.loads, 0);

  net.tides = 'ok';
  rec.inFlight = true;                 // a refresh is mid-flight when the list lands
  await app.clock.tick(15000);
  assert.ok(app.get('STATE').tideStations.length > 0);
  assert.equal(rec.loads, 0, 'waits for the running load');
  rec.inFlight = false;
  await app.clock.tick(1000);
  assert.equal(rec.loads, 1, 'reloads so the cards get their tide windows');
  await app.clock.tick(60000);
  assert.equal(rec.loads, 1);
  assert.equal(net.count(/tide-stations/), 2);
  assert.equal(net.count(/buoys-east-coast/), 0);
});

test('boot watchdog: no load in 10 min → probe, and reload only when the probe gets the real page', async () => {
  const net = makeNet();
  net.probe = 'down';
  const { app } = boot(net);

  await app.clock.fastForward(10 * MIN - 2000);
  await app.clock.tick(1000);
  assert.equal(probes(net), 0);
  await app.clock.tick(2000);
  assert.equal(probes(net), 1);
  assert.deepEqual(app.reloads, [], 'offline: stay on screen rather than reload into an error page');
  const probe = net.calls.find(c => /probe=/.test(c.url));
  assert.equal(probe.cache, 'no-store');
  assert.match(probe.url, /^\.\/\?kiosk=1&probe=\d+$/);

  await app.clock.tick(30000);
  assert.equal(probes(net), 1, 'probes back off to once a minute');
  net.probe = 'wrong-page';            // a captive portal answers 200
  await app.clock.tick(31000);
  assert.equal(probes(net), 2);
  assert.deepEqual(app.reloads, []);

  net.probe = 'ok';
  await app.clock.tick(61000);
  assert.equal(app.reloads.length, 1);
  assert.equal(app.localStorage.getItem(RELOAD_KEY), String(app.reloads[0]));
  assert.ok(app.logs.some(l => /reloading/.test(String(l.args[0])) && /boot watchdog/.test(String(l.args[1]))));
});

test('boot watchdog: quiet once a load has completed', async () => {
  const net = makeNet();
  const { app } = boot(net, { state: { lastLoadCompletedAt: FIXTURE_NOW_MS + 5000 } });
  await app.clock.fastForward(20 * MIN);
  await app.clock.tick(2000);
  assert.equal(probes(net), 0);
  assert.deepEqual(app.reloads, []);
});

test('reload guards: a reload stamped before this boot blocks the next for 30 min; paused / SOURCES open block it', async () => {
  const net = makeNet();
  const { app } = boot(net, { storage: { local: { [RELOAD_KEY]: String(FIXTURE_NOW_MS - 5 * MIN) } } });
  await app.clock.fastForward(10 * MIN + 1000);
  await app.clock.tick(1000);
  assert.equal(probes(net), 0, 'blocked before the probe');
  assert.deepEqual(app.reloads, []);
  await app.clock.fastForward(15 * MIN);   // 25 min after boot = 30 min after the last reload
  await app.clock.tick(1000);
  assert.equal(app.reloads.length, 1);

  const net2 = makeNet();
  const b2 = boot(net2);
  b2.app.run("KIOSK.state = 'paused'");
  await b2.app.clock.fastForward(10 * MIN + 1000);
  await b2.app.clock.tick(1000);
  b2.app.run("KIOSK.state = 'rotating'");
  b2.app.call('kioskToggleInfo', true);
  await b2.app.clock.tick(61000);
  assert.equal(probes(net2), 0);
  assert.deepEqual(b2.app.reloads, []);
  b2.app.call('kioskToggleInfo', false);
  await b2.app.clock.tick(61000);
  assert.equal(b2.app.reloads.length, 1);
});

test('nightly reload: 03:30 local, at least 1 h after boot, retried every 15 min until the probe answers', async () => {
  const net = makeNet();
  net.probe = 'down';
  const { app } = boot(net, { state: { lastLoadCompletedAt: FIXTURE_NOW_MS } });
  const at = Date.parse('2026-10-02T03:30:00-04:00');
  assert.equal(app.run('KIOSK.nightlyAt'), at);

  await app.clock.fastForward(at - FIXTURE_NOW_MS - 2000);
  await app.clock.tick(1000);
  assert.equal(probes(net), 0);
  await app.clock.tick(2000);
  assert.equal(probes(net), 1);
  assert.deepEqual(app.reloads, []);
  await app.clock.tick(14 * MIN);
  assert.equal(probes(net), 1);
  net.probe = 'ok';
  await app.clock.tick(61000);
  assert.equal(probes(net), 2);
  assert.equal(app.reloads.length, 1);

  const early = boot(makeNet(), { now: '2026-10-02T03:00:00-04:00' });
  assert.equal(early.app.run('KIOSK.nightlyAt'), Date.parse('2026-10-03T03:30:00-04:00'),
    'a kiosk booted at 03:00 is not restarted half an hour later');
});

test('code signature: force-cache baseline, no-cache polls, reload only on a real change behind the guards', async () => {
  const net = makeNet();
  const { app } = boot(net);
  await app.clock.flush();
  const sig0 = app.run('KIOSK.codeSig');
  assert.match(sig0, /^[0-9a-f]{8}-[0-9a-z]+$/);
  const codeCalls = mode => net.calls.filter(c => c.cache === mode && (c.url === DOC_URL || /\.(html|js|css)$/.test(c.url))).map(c => c.url).sort();
  // The page's own URL, not 'index.html': nothing ever loads index.html by
  // name, so force-cache there returned whatever copy an old poll stored.
  assert.deepEqual(codeCalls('force-cache'), [DOC_URL, 'app.js', 'kiosk.js', 'styles-kiosk.css'],
    'the baseline reads the bytes this page ran, not a deploy that landed after it loaded');

  // Unchanged code (a data-only bot deploy): no reload.
  app.call('kioskRefreshTick');
  await app.clock.flush();
  assert.deepEqual(codeCalls('no-cache'), [DOC_URL, 'app.js', 'kiosk.js', 'styles-kiosk.css']);
  assert.equal(probes(net), 0);

  // A failed poll never counts as a change.
  net.files['kiosk.js'] = 'K2';
  net.failFiles.add('app.js');
  app.call('kioskRefreshTick');
  await app.clock.flush();
  assert.deepEqual(app.reloads, []);

  // Paused under a hand: wait for the next tick.
  net.failFiles.clear();
  app.run("KIOSK.state = 'paused'");
  app.call('kioskRefreshTick');
  await app.clock.flush();
  assert.deepEqual(app.reloads, []);
  app.run("KIOSK.state = 'rotating'");

  app.call('kioskRefreshTick');
  await app.clock.flush();
  assert.equal(app.reloads.length, 1);
  assert.equal(app.run('KIOSK.codeSig'), sig0, 'the running page keeps its boot signature');
  assert.ok(app.logs.some(l => /code changed/.test(String(l.args[1]))));

  // Another deploy 10 min later: the 30-min guard holds it.
  net.files['app.js'] = 'A2';
  await app.clock.tick(10 * MIN);
  app.call('kioskRefreshTick');
  await app.clock.flush();
  assert.equal(app.reloads.length, 1);
  await app.clock.fastForward(21 * MIN);  // the 15-min refresh interval fires
  await app.clock.flush();
  assert.equal(app.reloads.length, 2);
});

test('code signature: shown in the SOURCES card; no baseline (offline boot) means no deploy reloads', async () => {
  const net = makeNet();
  net.failFiles.add('kiosk.js');
  const { app } = boot(net);
  await app.clock.flush();
  assert.equal(app.run('KIOSK.codeSig'), null);
  assert.match(app.call('kioskInfoStatusHTML'), /Choc TV build — · running since 11:00 AM/);
  net.failFiles.clear();
  app.call('kioskRefreshTick');          // takes the baseline now
  await app.clock.flush();
  const sig = app.run('KIOSK.codeSig');
  assert.ok(sig);
  assert.match(app.call('kioskInfoStatusHTML'), new RegExp('Choc TV build ' + sig.slice(0, 7)));
  assert.deepEqual(app.reloads, []);
});
