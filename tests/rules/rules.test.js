// Firestore + Storage security rules, run against the local emulators.
//
//   npm i --no-save firebase-tools@15.32.1 @firebase/rules-unit-testing@5.0.2 firebase@12.19.0
//   npm run test:rules        # needs Java 21 for the emulators
//
// (= firebase emulators:exec --only firestore,storage --project demo-lcc
//    "node tests/rules/rules.test.js"; emulators:exec sets the emulator host
// env vars that initializeTestEnvironment discovers.) CI runs it in
// .github/workflows/rules.yml. Not part of `npm test`: it needs the
// emulators and three dev packages.
//
// The "app" payloads are not hand-copied: appWrites() runs the real
// saveLogEntryToFirebase() from app.js in the vm harness against the
// Firebase stub and replays exactly what it wrote, so a change to the app's
// payload that the rules would reject fails here.
'use strict';

const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const { loadApp, REPO_ROOT } = require('../helpers/load-app');

const PROJECT = 'demo-lcc';
// Every DENY case makes the SDK log a PERMISSION_DENIED stream error; the
// assertions already say what was denied.
firebase.firestore.setLogLevel('silent');
const SERVER_TS = () => firebase.firestore.FieldValue.serverTimestamp();
const TS = firebase.firestore.Timestamp;

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(REPO_ROOT, 'storage.rules'), 'utf8') }
  });
});
after(async () => { if (env) await env.cleanup(); });

// ── Principals ─────────────────────────────────────────
const anonCtx = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } });
const googleCtx = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const crewA = () => googleCtx('crewA', 'owner@example.com').firestore();
const victim = () => googleCtx('victim', 'friend@example.com').firestore();
const logs = db => db.collection('surf_logs');

// ── What app.js actually writes ────────────────────────
// Runs saveLogEntryToFirebase(entry) as `uid` and returns the recorded
// writes: { doc: {id, data}, puts: [storage paths] }. serverTimestamp()
// fields come back from the stub as Dates; swap the real sentinel back in.
async function appWrites(uid, entry, fbOpts) {
  const app = loadApp({
    firebase: fbOpts || true,
    // data: photos are fetched as a blob before upload
    fetch: url => (url.startsWith('data:') ? { status: 200, body: 'jpeg-bytes' } : null)
  });
  app.run(`window._fbUserId = ${JSON.stringify(uid)}; window._fbUserIsAnon = false; window._fbDisplayName = 'Crew Member';`);
  await app.call('saveLogEntryToFirebase', entry);
  const writes = app.clone('window.__FB_WRITES');
  const set = writes.filter(w => w.op === 'set').pop();
  assert.ok(set, 'saveLogEntryToFirebase wrote a doc');
  const data = set.data;
  for (const k of ['createdAt', 'repairedAt']) if (k in data) data[k] = SERVER_TS();
  return { doc: { id: set.path.split('/').pop(), data }, puts: writes.filter(w => w.op === 'put').map(w => w.path) };
}

// A session as the log form + "Lookup" build it (conditions shaped like
// lookupHistoricalConditions' result).
function formEntry(id, userId, extra) {
  return Object.assign({
    id, userId, displayName: 'Crew Member',
    timestamp: '2026-09-14T07:30',
    ratings: { size: 6, windQuality: 7, rideQuality: 5 },
    notes: 'Fun, a few sets <b>overhead</b>',
    photos: ['https://example.com/photo.jpg'],
    conditions: {
      swell: { height: 3.1, direction: 141, period: 9.5, lagHours: 1.2,
               secondary: { height: 1.0, direction: 120, period: 6 } },
      wind: { speed: 6, direction: 330 },
      tide: { height: 1.4, rate: 0.62, stage: 'rising', timeToNearest: 2.3 },
      source: 'openmeteo-archive',
      swellLagHours: 1.2,
      originalLoggedTime: '2026-09-14T07:30',
      calculatedFromBuoyTime: '2026-09-14T10:18:00.000Z'
    }
  }, extra || {});
}

async function seed(id, data) {
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().collection('surf_logs').doc(id).set(data));
}
async function exists(id) {
  let e;
  await env.withSecurityRulesDisabled(async ctx => { e = (await ctx.firestore().collection('surf_logs').doc(id).get()).exists; });
  return e;
}
async function victimDoc(id) {
  const { doc } = await appWrites('victim', formEntry(id, 'victim'));
  doc.data.createdAt = TS.fromDate(new Date('2026-09-14T12:00:00Z'));
  await seed(id, doc.data);
  return doc;
}

// ── Firestore: ownership (audit C26) ───────────────────

test('app create, update (with repair stamp) and delete of your own entry are allowed', async () => {
  await env.clearFirestore();
  const { doc } = await appWrites('crewA', formEntry('own1', 'crewA'));
  await assertSucceeds(logs(crewA()).doc(doc.id).set(doc.data));
  const upd = await appWrites('crewA', formEntry('own1', 'crewA', { notes: 'edited', repairedFields: ['size'] }));
  assert.ok('repairedAt' in upd.doc.data && Array.isArray(upd.doc.data.repairedFields), 'repair stamp is part of the payload');
  await assertSucceeds(logs(crewA()).doc('own1').set(upd.doc.data));
  await assertSucceeds(logs(crewA()).doc('own1').delete());
});

test('app payload variants are allowed: failed-photo marker, tide unavailable, no conditions, uploaded photo', async () => {
  await env.clearFirestore();
  // A photo whose upload failed is shipped as { url: null, path: null, _uploadFailed: true }.
  const marker = await appWrites('crewA', formEntry('v1', 'crewA', {
    photos: [{ url: null, path: null, _uploadFailed: true, _localDataURI: 'data:image/jpeg;base64,AAAA' }]
  }), { fail: { put: true } });
  assert.deepEqual(marker.doc.data.photos, [{ url: null, path: null, _uploadFailed: true }]);
  await assertSucceeds(logs(crewA()).doc('v1').set(marker.doc.data));
  // CO-OPS outage: tide is stored as null, not a made-up 0 ft (audit C11).
  const noTide = formEntry('v2', 'crewA');
  noTide.conditions.tide = null;
  const nt = await appWrites('crewA', noTide);
  await assertSucceeds(logs(crewA()).doc('v2').set(nt.doc.data));
  // Saved before Lookup: conditions null, no photos, empty notes.
  const bare = await appWrites('crewA', formEntry('v3', 'crewA', { conditions: null, photos: [], notes: '' }));
  await assertSucceeds(logs(crewA()).doc('v3').set(bare.doc.data));
  // A data: photo goes to Storage first and the doc keeps { url, path }.
  const up = await appWrites('crewA', formEntry('v4', 'crewA', { photos: ['data:image/jpeg;base64,AAAA'] }));
  assert.equal(up.puts.length, 1);
  assert.equal(up.doc.data.photos[0].path, up.puts[0]);
  await assertSucceeds(logs(crewA()).doc('v4').set(up.doc.data));
});

test("DENY: overwriting someone else's entry with your uid swapped in (the backfill/migrate/import takeover)", async () => {
  await env.clearFirestore();
  await victimDoc('victimDoc');
  // Exactly what the old backfill wrote for a community entry.
  const { doc } = await appWrites('crewA', formEntry('victimDoc', 'crewA'));
  await assertFails(logs(crewA()).doc('victimDoc').set(doc.data));
  // An anonymous session cannot do it either.
  const anon = await appWrites('anonX', formEntry('victimDoc', 'anonX'));
  await assertFails(logs(anonCtx('anonX').firestore()).doc('victimDoc').set(anon.doc.data));
  assert.equal(await exists('victimDoc'), true);
});

test("DENY: updating someone else's entry while keeping their uid", async () => {
  await env.clearFirestore();
  const doc = await victimDoc('victimDoc');
  const data = Object.assign({}, doc.data, { notes: 'vandalised', createdAt: SERVER_TS() });
  await assertFails(logs(crewA()).doc('victimDoc').set(data));
});

test('DENY: handing your own entry to another uid (ownership transfer / impersonation)', async () => {
  await env.clearFirestore();
  const { doc } = await appWrites('crewA', formEntry('own1', 'crewA'));
  await assertSucceeds(logs(crewA()).doc('own1').set(doc.data));
  const moved = Object.assign({}, doc.data, { userId: 'victim', createdAt: SERVER_TS() });
  await assertFails(logs(crewA()).doc('own1').set(moved));
  // ...and creating a new entry in someone else's name.
  await assertFails(logs(crewA()).doc('imp1').set(Object.assign({}, moved, { id: 'imp1' })));
});

test("DENY: deleting someone else's entry; ALLOW reading the community log while signed in", async () => {
  await env.clearFirestore();
  await victimDoc('victimDoc');
  await assertFails(logs(crewA()).doc('victimDoc').delete());
  await assertFails(logs(anonCtx('anonX').firestore()).doc('victimDoc').delete());
  assert.equal(await exists('victimDoc'), true);
  await assertSucceeds(logs(crewA()).get());
  await assertFails(logs(env.unauthenticatedContext().firestore()).get());
});

test('DENY: an anonymous uid cannot move its synced entry to the Google uid it signs into (documented limitation)', async () => {
  await env.clearFirestore();
  const { doc } = await appWrites('anonX', formEntry('anon1', 'anonX'));
  await assertSucceeds(logs(anonCtx('anonX').firestore()).doc('anon1').set(doc.data));
  const asGoogle = await appWrites('crewA', formEntry('anon1', 'crewA'));
  await assertFails(logs(crewA()).doc('anon1').set(asGoogle.doc.data));
});

// ── Firestore: validation (audit C29) ──────────────────

test('DENY: junk payloads (extra key, bad ratings, back/future-dated createdAt, oversize notes/photos, id mismatch)', async () => {
  await env.clearFirestore();
  const { doc } = await appWrites('crewA', formEntry('j1', 'crewA'));
  const base = () => Object.assign({}, doc.data, { createdAt: SERVER_TS() });
  const bad = {
    'extra key': Object.assign(base(), { isAdmin: true }),
    'rating 99': Object.assign(base(), { ratings: { size: 99, windQuality: 5, rideQuality: 5 } }),
    'rating -1': Object.assign(base(), { ratings: { size: -1, windQuality: 5, rideQuality: 5 } }),
    'rating string': Object.assign(base(), { ratings: { size: '7', windQuality: 5, rideQuality: 5 } }),
    'createdAt 2099': Object.assign(base(), { createdAt: TS.fromDate(new Date('2099-01-01')) }),
    'createdAt 2001': Object.assign(base(), { createdAt: TS.fromDate(new Date('2001-01-01')) }),
    'notes 10001 chars': Object.assign(base(), { notes: 'x'.repeat(10001) }),
    'displayName 201 chars': Object.assign(base(), { displayName: 'x'.repeat(201) }),
    '51 photos': Object.assign(base(), { photos: Array.from({ length: 51 }, () => ({ url: 'https://example.com/p.jpg', path: '' })) }),
    'photos not a list': Object.assign(base(), { photos: 'https://example.com/p.jpg' }),
    'conditions not a map': Object.assign(base(), { conditions: 'sunny' }),
    'timestamp not a string': Object.assign(base(), { timestamp: 12345 }),
    'id != doc id': Object.assign(base(), { id: 'other' })
  };
  for (const [label, data] of Object.entries(bad)) {
    await assertFails(logs(crewA()).doc('j1').set(data)).catch(e => { throw new Error(label + ': ' + e.message); });
  }
  // The same payload unmodified is fine (the denials above are the field, not the doc).
  await assertSucceeds(logs(crewA()).doc('j1').set(base()));
  // Generous caps: a long note and a 10-photo session still save.
  await assertSucceeds(logs(crewA()).doc('j1').set(Object.assign(base(), {
    notes: 'x'.repeat(10000),
    photos: Array.from({ length: 10 }, (_, i) => ({ url: 'https://example.com/' + i + '.jpg', path: '' }))
  })));
});

test('legacy docs stay repairable: a blank (null) rating, or a bad value left unchanged, can be re-saved', async () => {
  await env.clearFirestore();
  // A legacy row whose slider was never set, and one with a string rating
  // and an over-cap note from before validation existed.
  await seed('legacy1', { id: 'legacy1', userId: 'crewA', displayName: '', timestamp: '2025-08-10T09:00',
    photos: [], ratings: { size: null, windQuality: 6, rideQuality: 6 }, notes: '', conditions: null,
    createdAt: TS.fromDate(new Date('2025-08-10T13:00:00Z')) });
  await seed('legacy2', { id: 'legacy2', userId: 'crewA', displayName: '', timestamp: '2025-08-11T09:00',
    photos: [], ratings: { size: '7', windQuality: 6, rideQuality: 6 }, notes: 'y'.repeat(12000), conditions: null,
    createdAt: TS.fromDate(new Date('2025-08-11T13:00:00Z')) });
  // Backfill re-saves with new conditions; the stored ratings/notes ride along unchanged.
  const b1 = await appWrites('crewA', formEntry('legacy1', 'crewA', { timestamp: '2025-08-10T09:00', notes: '', photos: [],
    ratings: { size: null, windQuality: 6, rideQuality: 6 } }));
  await assertSucceeds(logs(crewA()).doc('legacy1').set(b1.doc.data));
  const b2 = await appWrites('crewA', formEntry('legacy2', 'crewA', { timestamp: '2025-08-11T09:00', notes: 'y'.repeat(12000), photos: [],
    ratings: { size: '7', windQuality: 6, rideQuality: 6 } }));
  await assertSucceeds(logs(crewA()).doc('legacy2').set(b2.doc.data));
  // Changing a field to a new bad value is still refused.
  const worse = Object.assign({}, b2.doc.data, { ratings: { size: '8', windQuality: 6, rideQuality: 6 }, createdAt: SERVER_TS() });
  await assertFails(logs(crewA()).doc('legacy2').set(worse));
});

// ── Storage (audit C29) ────────────────────────────────

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

test("storage: the app's own upload path is allowed (jpeg, png, heic); reads need sign-in", async () => {
  await env.clearStorage();
  const { puts } = await appWrites('crewA', formEntry('p1', 'crewA', { photos: ['data:image/jpeg;base64,AAAA'] }));
  assert.match(puts[0], /^surf-photos\/raw\/crewA\/2026\/09\/\d+_0\.jpg$/);
  const st = googleCtx('crewA', 'owner@example.com').storage();
  await assertSucceeds(st.ref(puts[0]).put(JPEG, { contentType: 'image/jpeg' }));
  await assertSucceeds(st.ref('surf-photos/raw/crewA/2026/09/1727769600001_1.jpg').put(JPEG, { contentType: 'image/png' }));
  await assertSucceeds(st.ref('surf-photos/raw/crewA/2026/09/1727769600002_2.jpg').put(JPEG, { contentType: 'image/heic' }));
  await assertSucceeds(anonCtx('anonX').storage().ref(puts[0]).getMetadata());
  await assertFails(env.unauthenticatedContext().storage().ref(puts[0]).getMetadata());
});

test("storage DENY: writing into another user's folder (anonymous or signed in)", async () => {
  await env.clearStorage();
  await assertFails(anonCtx('anonX').storage().ref('surf-photos/raw/crewA/2026/09/1727769600000_0.jpg').put(JPEG, { contentType: 'image/jpeg' }));
  await assertFails(googleCtx('victim', 'friend@example.com').storage().ref('surf-photos/raw/crewA/2026/09/1727769600000_0.jpg').put(JPEG, { contentType: 'image/jpeg' }));
});

test('storage DENY: non-image and SVG uploads, invented paths, 10 MB+', async () => {
  await env.clearStorage();
  const st = anonCtx('anonX').storage();
  const own = n => 'surf-photos/raw/anonX/2026/09/1727769600000_' + n + '.jpg';
  await assertFails(st.ref(own(0)).put(JPEG, { contentType: 'text/html' }));
  await assertFails(st.ref(own(1)).put(JPEG, { contentType: 'image/svg+xml' }));
  await assertFails(st.ref(own(2)).put(JPEG, { contentType: 'application/octet-stream' }));
  await assertFails(st.ref('surf-photos/raw/anonX/x/y/z.jpg').put(JPEG, { contentType: 'image/jpeg' }));
  await assertFails(st.ref('surf-photos/raw/anonX/2026/13/1_0.jpg').put(JPEG, { contentType: 'image/jpeg' }));
  await assertFails(st.ref('surf-photos/raw/anonX/2026/09/evil.html').put(JPEG, { contentType: 'image/jpeg' }));
  await assertFails(st.ref(own(3)).put(new Uint8Array(10 * 1024 * 1024), { contentType: 'image/jpeg' }));
  // Control: the same folder with a legal name and type works.
  await assertSucceeds(st.ref(own(4)).put(JPEG, { contentType: 'image/jpeg' }));
});
