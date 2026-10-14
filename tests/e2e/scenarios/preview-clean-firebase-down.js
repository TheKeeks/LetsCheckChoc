// Default look with Firebase missing (ported from the Firebase half of the
// classic w1-cdn-down.js, and from w3-firebase-storage-blocked.js), against
// the fixtures (Thu 1 Oct 2026, 11:00 ET). The forecast never depends on the
// surf log's cloud, so a failing Firebase must cost nothing but the log:
//   • every Firebase script fails (an ad blocker, or gstatic down): the phone
//     still loads the forecast within 5 s with the Sound Check headline; the
//     Log tab's login page says "Google sign-in is unavailable. Check your
//     connection and reload the page." (log.js) and its button never hangs on
//     "Opening Google…"; Settings' Sign in with Google says the same
//     (firebase-config.js signInWithGoogle, 'auth/unavailable'). No uncaught
//     error is tolerated: firebase-config.js now catches the missing SDK
//     (the classic scenario had to allow "firebase is not defined");
//   • the same outage on Choc TV: one load (no retry storm) within 5 s, and
//     its three day cards with numbers;
//   • only the Storage script fails (photos are all Storage does): the
//     anonymous sign-in still happens (a throw at the top of
//     firebase-config.js used to kill auth for the visit), the forecast
//     loads, the Log and Settings open with sign-in available, Google sign-in
//     works, and a session with a photo still saves: the photo is marked for
//     a retry, its picture kept on this device, and the surfer is told.
// CLEAN.errors stays empty throughout.
'use strict';

const PHONE = { width: 390, height: 844 };
const UNAVAILABLE = 'Google sign-in is unavailable. Check your connection and reload the page.';
// an 8×8 PNG for the photo picker
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgYGD4z8DAwMDAAAAMAAH7ZSUfAAAAAElFTkSuQmCC', 'base64');

module.exports = {
  name: 'clean, Firebase down: forecast and Choc TV load fast, sign-in says unavailable; Storage down: auth and a photo session still save',
  options: {
    viewport: PHONE,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    net: { firebase: 'abort' },                   // every gstatic firebasejs script fails to load
    timeoutMs: 120000
  },
  async run({ page, ctx, assert, log }) {
    const cleanErrors = () => ctx.state(() => (window.CLEAN && CLEAN.errors || []).map(e => e.where + ': ' + e.message));
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });

    // ── 1. Phone, no Firebase at all: the forecast loads fast ──
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    const loadMs = await ctx.waitForLoad({ timeout: 20000 });
    const head = await ctx.waitFor(() => { const e = document.querySelector('#cl-view-forecast .cl-f-num'); return CLEAN.forecastInfo().fc === 'ok' && e && e.textContent; },
      { label: 'Sound Check headline', timeout: 20000 });
    ctx.metric('phoneTimeToLoadMs', loadMs);
    log(`phone: load ${loadMs} ms, headline ${head.ms} ms, with no Firebase`);
    assert.ok(loadMs < 5000, `the forecast load took ${loadMs} ms`);
    assert.ok(head.ms < 5000, `the headline took ${head.ms} ms`);
    assert.equal(head.value, '0.5');
    const fb = await ctx.state(() => ({ auth: CLEAN.authStatus(), signedIn: CLEAN.auth().signedIn, fbAuth, fbFirestore, loads: _loadGen }));
    log('firebase', JSON.stringify(fb));
    assert.deepEqual(fb.auth, { available: false, pending: false, error: '' }, 'core knows sign-in is unavailable');
    assert.equal(fb.fbAuth, null);
    assert.equal(fb.fbFirestore, null);
    assert.equal(fb.signedIn, false);
    assert.equal(fb.loads, 1, 'one load');

    // Settings first (nothing tried yet): Sign in with Google says it is unavailable when tapped.
    await page.locator('#cl-settings-btn').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-settings [data-act="signin"]'), { label: 'Settings: Sign in' });
    await page.locator('#cl-sub-settings [data-act="signin"]').click();
    const alert = await ctx.waitFor(() => { const a = document.querySelector('#cl-sub-settings .cl-set-acct [role="alert"]'); return a && a.textContent; }, { label: 'Settings says why', timeout: 5000 });
    assert.equal(alert.value, UNAVAILABLE);
    assert.equal(await ctx.state(() => CLEAN.authStatus().pending), false, 'no sign-in left pending');
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !document.querySelector('#cl-sub-settings'), { label: 'Settings closed' });

    // The Log tab: the login page, and why sign-in can't work.
    await page.locator('#cl-app .cl-tabs .cl-tab[data-tab="log"]').click();
    await ctx.waitFor(() => CLEAN.tab() === 'log' && !document.querySelector('#cl-view-log .cl-l-gate').hidden, { label: 'Log login page' });
    const gate = await ctx.state(() => {
      const q = s => document.querySelector('#cl-view-log ' + s);
      return { form: q('.cl-l-form').hidden, status: q('.cl-l-auth-status').hidden ? null : q('.cl-l-auth-status').textContent,
        button: q('.cl-l-signin').textContent, disabled: q('.cl-l-signin').disabled };
    });
    log('log', JSON.stringify(gate));
    assert.equal(gate.form, true, 'no log form without an account');
    assert.equal(gate.status, UNAVAILABLE);
    assert.deepEqual([gate.button, gate.disabled], ['Sign in with Google', false], 'the button is not stuck on "Opening Google…"');
    await ctx.screenshot('log-no-firebase');
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (phone, no Firebase)');

    // ── 2. Choc TV, no Firebase: one load within 5 s, its cards ──
    await page.setViewportSize({ width: 1180, height: 820 });
    await ctx.open('/?kiosk=1&preview=clean');
    const tvMs = await ctx.waitForLoad({ timeout: 20000 });
    ctx.metric('kioskTimeToLoadMs', tvMs);
    await ctx.waitFor(() => {
      const p = document.querySelector('#cl-tv [data-panel="cl-days1"]');
      return CLEAN.part('tv') && CLEAN.part('tv').mounted && p && p.querySelectorAll('.cl-tv-card').length === 3 && /\d/.test(p.querySelector('.cl-tv-card .cl-tv-num').textContent);
    }, { label: 'TV: three day cards with numbers', timeout: 15000 });
    await page.waitForTimeout(1000);   // room for a second load, if anything started one
    const tv = await ctx.state(() => ({ loads: _loadGen, days: [...document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-day')].map(e => e.textContent) }));
    log(`TV: load ${tvMs} ms`, JSON.stringify(tv));
    assert.ok(tvMs < 5000, `Choc TV load took ${tvMs} ms`);
    assert.equal(tv.loads, 1, 'Choc TV loaded once');
    assert.equal(tv.days[0], 'Today');
    await ctx.screenshot('tv-no-firebase');
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (TV, no Firebase)');

    // ── 3. Only the Storage script missing: auth, the forecast and the log still work ──
    ctx.net.firebase = 'stub';
    await ctx.context.addInitScript(() => { window.__FB_NO_STORAGE = true; });   // tests/fixtures/firebase-stub.js: no firebase.storage
    await page.setViewportSize(PHONE);
    await ctx.state(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* fine */ } });
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up (no Storage)' });
    const anon = await ctx.waitFor(() => window._fbUserId, { label: 'anonymous sign-in', timeout: 15000 });
    assert.equal(anon.value, 'anon-1', 'the anonymous sign-in still happens');
    await ctx.waitForLoad({ timeout: 20000 });
    await ctx.waitFor(() => CLEAN.forecastInfo().fc === 'ok' && document.querySelector('#cl-view-forecast .cl-f-num'), { label: 'headline (no Storage)' });
    const st = await ctx.state(() => ({ fbStorage, ready: typeof window._fbAuthReady.then, auth: CLEAN.authStatus() }));
    assert.equal(st.fbStorage, null, 'no photo storage');
    assert.equal(st.ready, 'function', 'auth-ready is still a promise');
    assert.equal(st.auth.available, true, 'sign-in is available');

    await page.locator('#cl-app .cl-tabs .cl-tab[data-tab="log"]').click();
    await ctx.waitFor(() => CLEAN.tab() === 'log' && !document.querySelector('#cl-view-log .cl-l-gate').hidden, { label: 'Log login page (no Storage)' });
    assert.equal(await ctx.state(() => document.querySelector('#cl-view-log .cl-l-auth-status').hidden), true, 'no "unavailable" note: sign-in works');
    await page.locator('#cl-settings-btn').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-settings [data-act="signin"]'), { label: 'Settings (no Storage)' });
    const set = await ctx.state(() => ({
      heads: [...document.querySelectorAll('#cl-sub-settings .cl-h2')].map(h => h.textContent),
      alert: !!document.querySelector('#cl-sub-settings [role="alert"]')
    }));
    assert.deepEqual(set, { heads: ['Account', 'Display', 'Forecast', 'Data sources', 'Spot'], alert: false });   // signed out, no sessions: no Surf log tools
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !document.querySelector('#cl-sub-settings'), { label: 'Settings closed (no Storage)' });

    // Google sign-in (the stub's popup links the anonymous account as google-1), then a session with a photo.
    await ctx.state(() => { window.__FB_LINK_ERROR = 'auth/credential-already-in-use'; window.__FB_POPUP_USER = { uid: 'google-1', displayName: 'Test Surfer' }; });
    await page.locator('#cl-view-log .cl-l-signin').click();
    await ctx.waitFor(() => CLEAN.auth().signedIn && !document.querySelector('#cl-view-log .cl-l-form').hidden, { label: 'signed in, Log form', timeout: 15000 });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#cl-view-log [data-act="photo"]').click()]);
    await chooser.setFiles({ name: 'wave.png', mimeType: 'image/png', buffer: PNG });
    await ctx.waitFor(() => document.querySelectorAll('#cl-view-log .cl-l-phs .cl-l-ph').length === 1, { label: 'photo added', timeout: 10000 });
    for (const [key, v] of [['size', 6], ['windQuality', 7], ['rideQuality', 5]]) {
      await page.locator(`#cl-view-log .cl-l-rt[data-r="${key}"] button[data-v="${v}"]`).click();
    }
    await ctx.waitFor(() => !document.querySelector('#cl-view-log .cl-l-save').disabled, { label: 'Save on', timeout: 20000 });
    const w0 = await ctx.state(() => {
      window.__toasts = [];
      new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); })))
        .observe(document.getElementById('toast-container'), { childList: true });
      return (window.__FB_WRITES || []).length;
    });
    await page.locator('#cl-view-log .cl-l-save').click();
    await ctx.waitFor(n => (window.__FB_WRITES || []).slice(n).some(w => w.op === 'set' && /surf_logs/.test(w.path)), { arg: w0, label: 'Firestore write', timeout: 20000 });
    await ctx.waitFor(() => document.querySelectorAll('#cl-view-log .cl-l-ss').length === 1, { label: 'the session is listed', timeout: 10000 });
    const saved = await ctx.state(n => {
      const w = window.__FB_WRITES.slice(n).filter(x => x.op === 'set' && /surf_logs/.test(x.path));
      const id = w[0] && w[0].data.id;
      const local = (JSON.parse(localStorage.getItem('lcc_surfLog')) || []).find(e => e.id === id);
      return {
        writes: w.map(x => ({ uid: x.uid, photos: x.data.photos, ratings: x.data.ratings })),
        localPhoto: local && local.photos && local.photos[0] && { failed: local.photos[0]._uploadFailed, kept: /^data:image\//.test(local.photos[0]._localDataURI || '') },
        toasts: window.__toasts
      };
    }, w0);
    log('saved without Storage', JSON.stringify(saved));
    assert.deepEqual(saved.writes, [{ uid: 'google-1', photos: [{ url: null, path: null, _uploadFailed: true }], ratings: { size: 6, windQuality: 7, rideQuality: 5 } }],
      'the session reaches Firestore, its photo marked for a retry');
    assert.deepEqual(saved.localPhoto, { failed: true, kept: true }, 'the picture stays on this device for the retry');
    assert.ok(saved.toasts.some(t => /A photo failed to upload — will retry/.test(t)), 'the surfer is told the photo will retry');
    await ctx.screenshot('log-no-storage-saved');
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (no Storage)');
  }
};
