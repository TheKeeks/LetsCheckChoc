// Audit C26 (app side) + C03 (firebase-config.js part).
//
// STATE.surfLog holds the whole community log (up to 200 entries from every
// crew member), and saveLogEntryToFirebase stamps every payload with the
// CURRENT uid. Backfill, the anonymous→Google migration and JSON import all
// used to re-save other people's entries through it, silently moving them
// to whoever ran the action. These tests run the real code against the
// Firebase stub (every write is recorded on window.__FB_WRITES) and assert
// that only the signed-in user's own entries are ever written.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, fixtureFetch, REPO_ROOT } = require('../helpers/load-app');

const COND = {
  swell: { height: 3.1, direction: 141, period: 9.5, lagHours: 1.2 },
  wind: { speed: 7, direction: 300 },
  tide: { height: 1.7, rate: 0.55, stage: 'rising', timeToNearest: 2.1 },
  source: 'openmeteo-archive'
};
function doc(id, userId, extra) {
  return Object.assign({
    id, userId, displayName: userId === 'crewB' ? 'Bob' : 'Me',
    timestamp: '2026-10-01T08:00', photos: [], notes: 'n ' + id,
    ratings: { size: 6, windQuality: 7, rideQuality: 5 },
    conditions: JSON.parse(JSON.stringify(COND))
  }, extra || {});
}
const sets = app => app.clone('window.__FB_WRITES').filter(w => w.op === 'set');

// Wind archive (archive-api) has no recorded fixture: serve the forecast
// recording, which has the same hourly wind_* shape and covers the fixture day.
const ARCHIVE_WIND = ['archive-api.open-meteo.com', { status: 200, file: 'open-meteo/wind.json' }];

async function settle(app, promise, stepMs = 600, maxSteps = 60) {
  let done = false, err = null;
  promise.then(() => { done = true; }, e => { done = true; err = e; });
  for (let i = 0; i < maxSteps && !done; i++) await app.clock.tick(stepMs);
  assert.ok(done, 'operation did not finish');
  if (err) throw err;
}

// A Google user whose community log (own + crewB's entry) is loaded.
async function signedInWithCommunityLog(fetch) {
  const app = loadApp({
    firebase: { mode: 'google', logs: [doc('mine1', 'google-1'), doc('theirs1', 'crewB')] },
    fetch: fetch || fixtureFetch({ overrides: [ARCHIVE_WIND] })
  });
  await app.clock.tick(300);   // first auth event → loadLogsFromFirebase
  assert.equal(app.run('window._fbUserId'), 'google-1');
  assert.deepEqual(app.clone('STATE.surfLog.map(e => e.userId).sort()'), ['crewB', 'google-1']);
  return app;
}

test("saveLogEntryToFirebase refuses another user's entry and writes nothing", async () => {
  const app = await signedInWithCommunityLog();
  const theirs = app.run("STATE.surfLog.find(e => e.id === 'theirs1')");
  await assert.rejects(app.call('saveLogEntryToFirebase', theirs), /Not your entry/);
  assert.deepEqual(sets(app), []);
  assert.equal(theirs.userId, 'crewB');
});

test('saveLogEntryToFirebase claims an unowned entry (logged before sign-in) for the signed-in uid', async () => {
  const app = await signedInWithCommunityLog();
  const entry = app.run("({ id: 'local1', userId: '', timestamp: '2026-10-01T08:00', ratings: { size: 5, windQuality: 5, rideQuality: 5 }, photos: [], notes: '', conditions: null })");
  await app.call('saveLogEntryToFirebase', entry);
  assert.equal(sets(app)[0].data.userId, 'google-1');
  assert.equal(entry.userId, 'google-1', 'the local copy now counts as the user\'s own (Edit / training)');
});

test("Backfill re-saves only the signed-in user's sessions, never a crew member's", async () => {
  const app = await signedInWithCommunityLog();
  await settle(app, app.call('backfillAllSessionsFromArchive'));
  const written = sets(app);
  assert.deepEqual(written.map(w => w.path), ['surf_logs/mine1']);
  assert.equal(written[0].data.userId, 'google-1');
  // crewB's entry is untouched locally too (no new conditions, same owner).
  const theirs = app.clone("STATE.surfLog.find(e => e.id === 'theirs1')");
  assert.equal(theirs.userId, 'crewB');
  assert.deepEqual(theirs.conditions, COND);
  assert.match(app.dialogs.at(-1).message, /^1 sessions processed/);
});

test('photo-upload retry only re-saves the signed-in user\'s entries', async () => {
  const app = await signedInWithCommunityLog(url => (url.startsWith('data:') ? { status: 200, body: 'jpeg' } : null));
  const failed = { url: null, path: null, _uploadFailed: true, _localDataURI: 'data:image/jpeg;base64,AAAA' };
  // e.g. a local mirror left behind by another account on this device
  app.get('STATE').surfLog = app.run(`[
    ${JSON.stringify(doc('mine1', 'google-1', { photos: [failed] }))},
    ${JSON.stringify(doc('other-account', 'google-old', { photos: [failed] }))}
  ]`);
  await settle(app, app.call('retryFailedPhotoUploads'), 100);
  assert.deepEqual(sets(app).map(w => w.path), ['surf_logs/mine1']);
});

test('Backfill with no sessions of your own does nothing', async () => {
  const app = loadApp({ firebase: { mode: 'google', logs: [doc('theirs1', 'crewB')] }, fetch: fixtureFetch() });
  await app.clock.tick(300);
  await settle(app, app.call('backfillAllSessionsFromArchive'));
  assert.deepEqual(sets(app), []);
  assert.equal(app.dialogs.at(-1).message, 'No sessions of yours to backfill.');
  assert.equal(app.fetchLog.length, 0, 'no lookups were made');
});

test('anonymous → Google migration moves only the anonymous uid\'s (and unowned) entries', async () => {
  // Rules mode: Firestore holds anon1 under anon-1 (synced while anonymous)
  // and refuses a change of owner, as firestore.rules does. Without it this
  // test passed while the real rules left anon1 stranded under anon-1.
  const app = loadApp({ firebase: { mode: 'returning_anon', rules: true,
    logs: [doc('anon1', 'anon-1'), doc('theirs1', 'crewB'), doc('other-account', 'google-old')] } });
  await app.clock.tick(100);   // restored anonymous session anon-1
  assert.equal(app.run('window._fbUserId'), 'anon-1');
  // What an anonymous session can hold: its own sessions, one logged before
  // auth finished, and the community log mirrored from an earlier Google
  // session on this device (another account's own entry + crewB's).
  app.get('STATE').surfLog = app.run(`[
    ${JSON.stringify(doc('anon1', 'anon-1'))},
    ${JSON.stringify(doc('local1', ''))},
    ${JSON.stringify(doc('theirs1', 'crewB'))},
    ${JSON.stringify(doc('other-account', 'google-old'))}
  ]`);
  // Google account already exists → link fails → sign in with its credential.
  app.run("window.__FB_LINK_ERROR = 'auth/credential-already-in-use'; window.__FB_POPUP_USER = { uid: 'google-1', displayName: 'Me' };");
  app.call('signInWithGoogle');
  await app.clock.tick(500);
  assert.equal(app.run('window._fbUserId'), 'google-1');
  const written = sets(app);
  assert.deepEqual(written.map(w => w.path).sort(), ['surf_logs/anon1', 'surf_logs/local1']);
  assert.ok(written.every(w => w.data.userId === 'google-1' && w.uid === 'google-1'));
  // The only other write: anon-1 releasing its own synced doc first.
  const others = app.clone('window.__FB_WRITES').filter(w => w.op !== 'set').map(w => w.op + ' ' + w.path + ' as ' + w.uid);
  assert.deepEqual(others, ['delete surf_logs/anon1 as anon-1']);
});

test('migration that the rules refuse (anon entry already synced) keeps the entry with its owner', async () => {
  const app = loadApp({ firebase: { mode: 'google', fail: { set: true } } });
  await app.clock.tick(300);
  app.get('STATE').surfLog = app.run(`[${JSON.stringify(doc('anon1', 'anon-1'))}]`);
  const entry = app.run('STATE.surfLog[0]');
  await settle(app, app.call('migrateAnonDataToUser', 'anon-1'), 100);
  assert.equal(entry.userId, 'anon-1');
});

test("JSON import skips other accounts' entries and invalid ratings; one failed sync does not abort it", async () => {
  const app = await signedInWithCommunityLog();
  const data = [
    doc('imp-mine', 'google-1'),
    doc('imp-unowned', ''),
    doc('imp-theirs', 'crewC'),
    doc('imp-bad', 'google-1', { ratings: { size: '7', windQuality: 5, rideQuality: 5 } }),
    doc('imp-99', '', { ratings: { size: 99, windQuality: 5, rideQuality: 5 } }),
    doc('imp-blank', '', { ratings: { size: null, windQuality: 5, rideQuality: 5 } })
  ];
  app.context.FileReader = function () {
    const r = { readAsText(file) { Promise.resolve().then(() => r.onload({ target: { result: file.text } })); } };
    return r;
  };
  app.call('importJSON', { target: { files: [{ text: JSON.stringify(data) }], value: 'x' } });
  for (let i = 0; i < 20 && !app.dialogs.length; i++) await app.clock.flush();
  const paths = sets(app).map(w => w.path).sort();
  assert.deepEqual(paths, ['surf_logs/imp-blank', 'surf_logs/imp-mine', 'surf_logs/imp-unowned']);
  assert.ok(sets(app).every(w => w.data.userId === 'google-1'));
  assert.match(app.dialogs.at(-1).message, /^Imported 3 entries\. Skipped 3/);
  const ids = app.clone('STATE.surfLog.map(e => e.id)');
  assert.ok(!ids.includes('imp-theirs') && !ids.includes('imp-bad'));
});

test('JSON import keeps going when a save is refused, and says so', async () => {
  const app = loadApp({ firebase: { mode: 'google', fail: { set: true } } });
  await app.clock.tick(300);
  app.context.FileReader = function () {
    const r = { readAsText(file) { Promise.resolve().then(() => r.onload({ target: { result: file.text } })); } };
    return r;
  };
  app.call('importJSON', { target: { files: [{ text: JSON.stringify([doc('a', ''), doc('b', '')]) }], value: 'x' } });
  for (let i = 0; i < 20 && !app.dialogs.length; i++) await app.clock.flush();
  assert.match(app.dialogs.at(-1).message, /^Imported 2 entries\. 2 saved locally only/);
  assert.deepEqual(app.clone('STATE.surfLog.map(e => e.id).sort()'), ['a', 'b']);
});

// ── C03: firebase-config.js must not take auth down with it ─────────────

test('a missing Storage SDK no longer kills auth: anonymous sign-in still happens', async () => {
  const app = loadApp({ firebase: { mode: 'new_anon', noStorage: true } });
  assert.equal(app.run('fbStorage'), null);
  assert.equal(typeof app.run('window._fbAuthReady.then'), 'function');
  await app.clock.tick(2500);   // 2 s anon-sign-in delay + 250 ms stub latency
  assert.equal(app.run('window._fbUserId'), 'anon-1');
});

test('Firebase SDK not loaded at all: config script completes and auth-ready resolves', async () => {
  const app = loadApp();   // no firebase stub: `firebase` is undefined, as with a blocked gstatic
  const src = fs.readFileSync(path.join(REPO_ROOT, 'firebase-config.js'), 'utf8');
  app.run(src, 'firebase-config.js');
  assert.equal(app.run('fbAuth'), null);
  let resolved = false;
  app.run('window._fbAuthReady').then(() => { resolved = true; });
  await app.clock.flush();
  assert.equal(resolved, true, 'loadSurfLog would otherwise await a promise that never settles');
  app.call('signInWithGoogle');   // a tap on "Sign in" must not throw
  app.call('signOutUser');
});
