// Review fixes on the surf log's sync path (security#1, load-path#4).
//
// security#1: firestore.rules refuse an update that changes a doc's owner.
// A crew member who logs a session anonymously (new device, home-screen
// app, after Sign out) and then signs in to their existing Google account
// used to keep that session stranded under the anonymous uid: the
// migration's re-save as the Google uid was refused. The client now
// releases (deletes) the anonymous uid's docs while it is still that uid,
// signs in with the credential the failed link returned (no second popup,
// which iOS Safari blocks), and lets migrateAnonDataToUser re-create them
// as the Google uid. The stub runs in rules mode (__FB_RULES) so every
// write is checked against the stored owner, as firestore.rules does; the
// emulator test in tests/rules/rules.test.js replays the same flow against
// the real rules.
//
// load-path#4: the Surf Log form is usable before the first Firestore load
// lands. A session saved meanwhile (photo still uploading) used to vanish
// when that load replaced STATE.surfLog and the local mirror.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/load-app');

function doc(id, userId, extra) {
  return Object.assign({
    id, userId, displayName: userId === 'crewB' ? 'Bob' : 'Me',
    timestamp: '2026-10-01T08:00', photos: [], notes: 'n ' + id,
    ratings: { size: 6, windQuality: 7, rideQuality: 5 },
    conditions: null
  }, extra || {});
}
function formEntry(notes, extra) {
  return Object.assign({
    timestamp: '2026-10-01T07:00', ratings: { size: 6, windQuality: 7, rideQuality: 5 },
    notes, photos: [], conditions: null
  }, extra || {});
}
const writes = app => app.clone('window.__FB_WRITES').map(w => w.op + ' ' + w.path + ' as ' + w.uid);
// What Firestore holds for a doc (the stub's store in rules mode).
async function stored(app, id) {
  const snap = await app.run(`fbFirestore.collection('surf_logs').doc(${JSON.stringify(id)}).get()`);
  return snap.exists ? app.clone(snap.data()) : null;
}
// Record toasts and second popups; both are what the crew would see.
function watch(app) {
  app.run(`
    var __toasts = [], __popups = 0;
    (function (orig) { showToast = function (m, t) { __toasts.push(m); return orig(m, t); }; })(showToast);
    (function (orig) { fbAuth.signInWithPopup = function () { __popups++; return orig.apply(this, arguments); }; })(fbAuth.signInWithPopup);
  `);
}
async function settle(app, promise, stepMs = 100, maxSteps = 200) {
  let done = false, err = null;
  promise.then(() => { done = true; }, e => { done = true; err = e; });
  for (let i = 0; i < maxSteps && !done; i++) await app.clock.tick(stepMs);
  assert.ok(done, 'operation did not finish');
  if (err) throw err;
}

// An anonymous session (anon-1) that has logged one session, synced to
// Firestore under anon-1, and holds one more that never synced (logged
// before auth finished). crewB's community entry is in Firestore too.
async function anonWithSessions(fbExtra) {
  const app = loadApp({ firebase: Object.assign({ mode: 'returning_anon', rules: true, logs: [doc('theirs1', 'crewB')] }, fbExtra) });
  await app.clock.tick(100);
  assert.equal(app.run('window._fbUserId'), 'anon-1');
  watch(app);
  await settle(app, app.call('addLogEntry', formEntry('dawn patrol')));
  const id = app.run('STATE.surfLog[0].id');
  assert.equal((await stored(app, id)).userId, 'anon-1', 'the anonymous session is synced under anon-1');
  app.get('STATE').surfLog.push(app.run(`(${JSON.stringify(doc('local1', ''))})`));
  // The Google account already exists: linking fails with the popup's
  // credential attached.
  app.run("window.__FB_LINK_ERROR = 'auth/credential-already-in-use'; window.__FB_POPUP_USER = { uid: 'google-1', displayName: 'Me' };");
  return { app, id };
}

test('signing in to an existing Google account moves the anonymous synced session to it (security#1)', async () => {
  const { app, id } = await anonWithSessions();
  app.call('signInWithGoogle');
  await app.clock.tick(1000);
  assert.equal(app.run('window._fbUserId'), 'google-1');
  // Firestore: the session now belongs to the Google account, the never-
  // synced one was created for it, crewB's entry is untouched.
  assert.equal((await stored(app, id)).userId, 'google-1');
  assert.equal((await stored(app, 'local1')).userId, 'google-1');
  assert.equal((await stored(app, 'theirs1')).userId, 'crewB');
  // Released as the anonymous owner first, then re-created as the Google uid.
  const w = writes(app).slice(1);   // [0] is the anonymous addLogEntry save
  assert.deepEqual(w.filter(x => x.includes(id)), ['delete surf_logs/' + id + ' as anon-1', 'set surf_logs/' + id + ' as google-1']);
  // On this device both rows are the user's own again (Edit/Del, personal models).
  const own = app.clone("STATE.surfLog.filter(e => e.userId === window._fbUserId).map(e => e.id).sort()");
  assert.deepEqual(own, [id, 'local1'].sort());
  assert.ok(app.run('__toasts').includes('2 sessions synced to your account'));
  assert.equal(app.run('__popups'), 0, 'finished with the link error\'s credential, not a second popup');
  assert.equal(app.run('_signingIn'), false);
});

test('if the Google sign-in then fails, the released session is put back under the anonymous uid', async () => {
  const { app, id } = await anonWithSessions();
  app.run("window.__FB_CREDENTIAL_ERROR = 'auth/network-request-failed';");
  app.call('signInWithGoogle');
  await app.clock.tick(1000);
  assert.equal(app.run('window._fbUserId'), 'anon-1', 'still anonymous');
  assert.equal(app.run('__popups'), 0);
  assert.equal((await stored(app, id)).userId, 'anon-1', 'the session is back in Firestore');
  const entry = app.clone(`STATE.surfLog.find(e => e.id === ${JSON.stringify(id)})`);
  assert.equal(entry.userId, 'anon-1');
  assert.equal(entry.notes, 'dawn patrol');
  assert.deepEqual(writes(app).slice(1).filter(x => x.includes(id)),
    ['delete surf_logs/' + id + ' as anon-1', 'set surf_logs/' + id + ' as anon-1']);
  assert.equal(app.run('_signingIn'), false, 'the Sign in button works again');
});

test('a migration write that fails says so, and the session stays on the device', async () => {
  // anon1: the release could not delete it (still owned by anon-1 in
  // Firestore), so the Google uid's re-save is refused. released1: released,
  // but its re-create fails too (e.g. the connection dropped).
  const app = loadApp({ firebase: { mode: 'google', rules: true, fail: { set: true }, logs: [doc('anon1', 'anon-1')] } });
  await app.clock.tick(300);
  watch(app);
  app.get('STATE').surfLog = app.run(`[${JSON.stringify(doc('anon1', 'anon-1'))}, ${JSON.stringify(doc('released1', ''))}]`);
  await settle(app, app.call('migrateAnonDataToUser', 'anon-1'));
  assert.ok(app.run('__toasts').some(m => /^\u26a0 2 sessions .*could not be moved to your account/.test(m)), app.run('JSON.stringify(__toasts)'));
  assert.deepEqual(app.clone('STATE.surfLog.map(e => e.id).sort()'), ['anon1', 'released1'], 'neither session vanished from the log');
  const mirror = JSON.parse(app.localStorage.getItem('lcc_surfLog')).map(e => e.id).sort();
  assert.deepEqual(mirror, ['anon1', 'released1']);
});

// ── load-path#4: a session logged while the first load is in flight ──────

// A Google user on a slow connection: the first Firestore load takes 8 s,
// and a photo takes 6 s to upload.
function slowGoogle(fbExtra) {
  return loadApp({
    firebase: Object.assign({ mode: 'google', rules: true, fsMs: 8000, logs: [doc('old', 'crewB')] }, fbExtra),
    fetch: url => (url.startsWith('data:') ? { status: 200, body: 'jpeg', delayMs: 6000 } : null)
  });
}
const notes = (app, expr) => app.clone(expr).map(e => e.notes).sort();
const mirrorNotes = app => JSON.parse(app.localStorage.getItem('lcc_surfLog') || '[]').map(e => e.notes).sort();

test('a session saved while the first log load is in flight survives that load (load-path#4)', async () => {
  const app = slowGoogle();
  await app.clock.tick(3000);                 // first auth event at 30 ms; its load lands at ~8 s
  assert.equal(app.run('STATE.surfLog.length'), 0);
  const done = app.call('addLogEntry', formEntry('dawn patrol', { photos: ['data:image/jpeg;base64,AAAA'] }));
  await app.clock.tick(5500);                 // t = 8.5 s: the load has landed, the photo is still uploading
  assert.deepEqual(notes(app, 'STATE.surfLog'), ['dawn patrol', 'n old']);
  assert.deepEqual(mirrorNotes(app), ['dawn patrol', 'n old']);
  await settle(app, done);
  assert.deepEqual(notes(app, 'STATE.surfLog'), ['dawn patrol', 'n old']);
  assert.deepEqual(mirrorNotes(app), ['dawn patrol', 'n old']);
  const entry = app.clone("STATE.surfLog.find(e => e.notes === 'dawn patrol')");
  assert.equal(entry.userId, 'google-1');
  assert.match(entry.photos[0].url, /^https:\/\/firebasestorage\.test\//);
  assert.equal((await stored(app, entry.id)).notes, 'dawn patrol');
});

test('...and when its sync then fails, it stays in the log and the local mirror, also across a reload of the log', async () => {
  const app = slowGoogle({ fail: { set: true } });
  await app.clock.tick(3000);
  const done = app.call('addLogEntry', formEntry('dawn patrol', { photos: ['data:image/jpeg;base64,AAAA'] }));
  await settle(app, done);
  assert.deepEqual(notes(app, 'STATE.surfLog'), ['dawn patrol', 'n old']);
  assert.deepEqual(mirrorNotes(app), ['dawn patrol', 'n old']);
  await settle(app, app.call('loadLogsFromFirebase'));
  assert.deepEqual(notes(app, 'STATE.surfLog'), ['dawn patrol', 'n old'], 'a later load does not drop the unsynced session');
});

test('an edit still uploading its photo is not overwritten by a log load that lands meanwhile', async () => {
  const app = slowGoogle({ fsMs: 100, logs: [doc('mine1', 'google-1')] });
  await app.clock.tick(300);
  assert.deepEqual(notes(app, 'STATE.surfLog'), ['n mine1']);
  const done = app.call('updateLogEntry', 'mine1', { notes: 'edited', photos: ['data:image/jpeg;base64,AAAA'] });
  await settle(app, app.call('loadLogsFromFirebase'));   // e.g. the reload after an auth change
  assert.deepEqual(notes(app, 'STATE.surfLog'), ['edited']);
  await settle(app, done);
  assert.deepEqual(notes(app, 'STATE.surfLog'), ['edited']);
  assert.deepEqual(mirrorNotes(app), ['edited']);
  assert.equal((await stored(app, 'mine1')).notes, 'edited');
});

// Restoring a Google session, the auth handler (firebase-config.js) and
// initApp's loadSurfLog both load the log. Two queries meant a second copy
// landed a moment later and re-rendered the table, closing a row the user
// had just opened (this made tests/e2e/scenarios/w3-xss-surflog.js flaky).
test('a restored Google session runs the log query once, though the auth handler and loadSurfLog both ask', async () => {
  const app = loadApp({ firebase: { mode: 'google', fsMs: 100, logs: [doc('old', 'crewB')] } });
  app.run(`var __gets = 0, __renders = [];
    (function (col) {
      fbFirestore.collection = function (n) {
        var q = col.call(this, n), g = q.get;
        q.get = function () { __gets++; return g.apply(this, arguments); };
        return q;
      };
    })(fbFirestore.collection);
    (function (orig) { renderSurfLogTable = function () { __renders.push(Date.now()); return orig.apply(this, arguments); }; })(renderSurfLogTable);`);
  await app.clock.tick(50);                  // first auth event (30 ms): the handler's query is in flight
  assert.equal(app.run('__gets'), 1);
  await settle(app, app.call('loadSurfLog'), 10);   // what initApp does once the forecast is under way
  assert.equal(app.run('__gets'), 1, 'one Firestore query, not two');
  const renders = app.clone('__renders');
  assert.ok(renders.length && renders.every(t => t === renders[0]), 'no later re-render: ' + renders);
  assert.deepEqual(app.clone('STATE.surfLog.map(e => e.id)'), ['old']);
  // A later reload (e.g. after the anonymous → Google migration) still queries.
  await settle(app, app.call('loadLogsFromFirebase'), 10);
  assert.equal(app.run('__gets'), 2);
});
