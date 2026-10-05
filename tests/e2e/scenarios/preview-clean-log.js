// ?preview=clean — the Log part (previews/clean/log.js), checked the way the
// crew uses it, against the fixtures (2026-10-01 11:00 ET):
//   • an edit ends with the account that opened it: edit your own session,
//     sign out in Settings and back in as another crew member, and the Log
//     is a fresh form again (no "Editing …" bar, Save reads "Save", not
//     "Save changes"), with the first surfer's session untouched on this
//     device (STATE and the lcc_surfLog copy) and in the cloud;
//   • an edit of someone else's session left open in the app's own form
//     (a stale handler) keeps Save off and says why, and a tap on Save ends
//     the edit instead of writing over that session.
'use strict';

const PHONE = { width: 390, height: 844 };
const cond = (h, p, d) => ({
  swell: { height: h, period: p, direction: d },
  wind: { speed: 6, direction: 330 },
  tide: { height: 0.8, rate: -0.4, stage: 'falling', timeToNearest: 1.2 },
  source: 'openmeteo-archive'
});
// One session of the owner's (google-1), one of Bob's.
const LOGS = [
  { id: 'own-1', userId: 'google-1', displayName: 'Test Surfer', timestamp: '2026-09-27T07:30', createdAt: '2026-09-27T07:30',
    ratings: { size: 6, windQuality: 7, rideQuality: 5 }, notes: 'Glassy early, crowd by 8', photos: [], conditions: cond(2.4, 9, 140) },
  { id: 'bob-1', userId: 'crewB', displayName: 'Bob', timestamp: '2026-09-26T08:00', createdAt: '2026-09-26T08:00',
    ratings: { size: 4, windQuality: 6, rideQuality: 6 }, notes: 'Fun lefts on the push', photos: [], conditions: cond(1.8, 8, 130) }
];

module.exports = {
  name: 'clean preview log: an open edit ends when the account changes; Save never writes over another surfer\'s session',
  options: {
    gate: null,                                   // the preview skips the boat question itself
    viewport: PHONE,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    firebase: { mode: 'google', logs: LOGS }      // signed in as google-1 ("Test Surfer")
  },
  async run({ page, ctx, assert, log }) {
    // Firestore keeps its docs and checks each write's owner (firestore.rules).
    await ctx.context.addInitScript(() => { window.__FB_RULES = 1; });
    const cleanErrors = () => ctx.state(() => (window.CLEAN && CLEAN.errors || []).map(e => e.where + ': ' + e.message));
    const face = () => ctx.state(() => {
      const q = s => document.querySelector('#cl-view-log ' + s);
      const own = STATE.surfLog.find(e => e.id === 'own-1') || null;
      let local = null;
      try { local = (JSON.parse(localStorage.getItem('lcc_surfLog')) || []).find(e => e.id === 'own-1') || null; } catch (_) { /* none */ }
      return {
        uid: window._fbUserId, anon: window._fbUserIsAnon,
        editId: STATE.surfLogEditId,
        editBar: q('.cl-l-edit').hidden ? null : q('.cl-l-edit').textContent.replace(/\s+/g, ' ').trim(),
        save: q('.cl-l-save').textContent, saveOff: q('.cl-l-save').disabled,
        why: q('.cl-l-why').hidden ? '' : q('.cl-l-why').textContent,
        notes: q('.cl-l-notes').value,
        editBtn: !!q('[data-act="edit"][data-id="own-1"]'),
        own: own && { userId: own.userId, notes: own.notes, ratings: own.ratings, timestamp: own.timestamp },
        local: local && { userId: local.userId, notes: local.notes },
        writes: (window.__FB_WRITES || []).filter(w => /own-1/.test(w.path)).map(w => w.op + ' ' + w.path + ' uid=' + w.uid)
      };
    });
    const UNTOUCHED = { userId: 'google-1', notes: LOGS[0].notes, ratings: LOGS[0].ratings, timestamp: LOGS[0].timestamp };

    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    await ctx.waitForChart();
    await ctx.waitForLoad();
    await ctx.waitFor(() => window._fbUserId === 'google-1' && STATE.surfLog.some(e => e.id === 'own-1'), { label: 'seeded log (google-1)' });

    // ── Edit your own session ──
    await page.locator('#cl-app .cl-tabs .cl-tab[data-tab="log"]').click();
    await ctx.waitFor(() => !document.querySelector('#cl-view-log .cl-l-form').hidden &&
      document.querySelector('#cl-view-log [data-act="edit"][data-id="own-1"]'), { label: 'Log form with your session' });
    await page.locator('#cl-view-log [data-act="edit"][data-id="own-1"]').click();
    // A conditions lookup in flight holds the edit until it lands.
    await ctx.waitFor(() => STATE.surfLogEditId === 'own-1' && !document.querySelector('#cl-view-log .cl-l-edit').hidden, { label: 'editing own-1', timeout: 20000 });
    const s0 = await face();
    log('editing', JSON.stringify(s0));
    assert.match(s0.editBar, /^Editing Sun 27 Sep/);
    assert.equal(s0.save, 'Save changes');
    assert.equal(s0.notes, LOGS[0].notes);

    // ── Sign out in Settings ──
    await page.locator('#cl-settings-btn').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-settings [data-act="signout"]'), { label: 'Settings: Sign out' });
    await page.locator('#cl-sub-settings [data-act="signout"]').click();
    await ctx.waitFor(() => window._fbUserId === 'anon-1', { label: 'signed out (anonymous)', timeout: 10000 });
    assert.equal(await ctx.state(() => STATE.surfLogEditId), null, 'signing out ends the edit');

    // ── Sign in as another crew member (a Google account with its own uid) ──
    await ctx.state(() => { window.__FB_LINK_ERROR = 'auth/credential-already-in-use'; window.__FB_POPUP_USER = { uid: 'google-2', displayName: 'Kai Two' }; });
    await ctx.waitFor(() => document.querySelector('#cl-sub-settings [data-act="signin"]'), { label: 'Settings: Sign in' });
    await page.locator('#cl-sub-settings [data-act="signin"]').click();
    await ctx.waitFor(() => window._fbUserId === 'google-2' && window._fbUserIsAnon === false, { label: 'signed in as google-2', timeout: 10000 });
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !document.querySelector('#cl-sub-settings') && !document.querySelector('#cl-app').hidden, { label: 'Settings closed' });
    await ctx.waitFor(() => CLEAN.tab() === 'log' && !document.querySelector('#cl-view-log .cl-l-form').hidden, { label: 'Log form (google-2)' });
    await page.waitForTimeout(500);
    const s1 = await face();
    log('after switch', JSON.stringify(s1));
    await ctx.screenshot('clean-log-account-switch');
    assert.equal(s1.editId, null, 'no edit carries over to the new account');
    assert.equal(s1.editBar, null, 'no "Editing …" bar');
    assert.equal(s1.save, 'Save', 'a fresh form: Save, not Save changes');
    assert.equal(s1.saveOff, true);
    assert.match(s1.why, /^Rate .+ to save$/);
    assert.equal(s1.notes, '', 'the last surfer\'s notes are gone from the form');
    assert.equal(s1.editBtn, false, 'no Edit on another surfer\'s session');
    assert.deepEqual(s1.own, UNTOUCHED);
    assert.deepEqual(s1.local, { userId: 'google-1', notes: LOGS[0].notes });
    assert.deepEqual(s1.writes, []);

    // ── The app's own form left editing another surfer's session ──
    await ctx.state(() => { editLogEntry('own-1'); CLEAN.emit('log'); });
    await ctx.waitFor(() => STATE.surfLogEditId === 'own-1', { label: 'stale legacy edit' });
    const s2 = await face();
    log('stale edit', JSON.stringify(s2));
    assert.equal(s2.saveOff, true, 'Save stays off on another surfer\'s session');
    assert.equal(s2.why, 'This is another surfer’s session. Cancel the edit');
    // A tap that gets through anyway (a stale handler) ends the edit.
    await page.locator('#cl-view-log .cl-l-notes').fill('edited by the other account');
    await ctx.state(() => { const b = document.querySelector('#cl-view-log .cl-l-save'); b.disabled = false; b.click(); });
    await ctx.waitFor(() => STATE.surfLogEditId === null, { label: 'Save ends the stale edit' });
    await page.waitForTimeout(1500);
    const s3 = await face();
    log('after stale save', JSON.stringify(s3));
    assert.equal(s3.editBar, null);
    assert.equal(s3.save, 'Save');
    assert.deepEqual(s3.own, UNTOUCHED, 'the other surfer\'s session is unchanged on this device');
    assert.deepEqual(s3.local, { userId: 'google-1', notes: LOGS[0].notes }, '… and in its saved copy');
    assert.deepEqual(s3.writes, [], '… and nothing went to Firestore');
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors');
  }
};
