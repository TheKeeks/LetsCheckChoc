// ?preview=clean — the "A refined" redesign (previews/clean/) layered over
// the real app. preview-looks.js only checks that each look loads; this
// drives the clean look the way the crew will, on a phone and on Choc TV,
// against the fixtures (2026-10-01 11:00 ET):
//   • it skips the boat question by itself without remembering the answer
//     (the plain address still asks), and none of its own code logs an error;
//   • the three tabs switch; the Now block leads with the fixture's in-window
//     swell (1.6 ft @ 8 s ESE at 11:00); the week has 7 rows; tapping a day
//     slides the chart cursor to that day's low (the readout names it);
//   • Settings opens and its Display choice survives a reload;
//   • the Log's Save stays off until size, wind and ride are all rated, then
//     saves the session under the signed-in surfer;
//   • Choc TV shows three day cards and Next moves to the next panel without
//     pausing the rotation; reduced motion stops the radar sweep;
//   • nothing pans sideways at 375 px, on any tab or in Settings.
'use strict';

const PHONE = { width: 390, height: 844 };

// Layout width vs content width (clientWidth: under isMobile Chromium grows
// innerWidth to the content, which hides sideways scroll; see w5-phone-widths).
const sideways = () => {
  const de = document.documentElement;
  return { scrollW: de.scrollWidth, clientW: de.clientWidth };
};

module.exports = {
  name: 'clean preview: tabs, Now block, week → chart low, Settings, Log save gate, Choc TV panels, no sideways scroll',
  options: {
    gate: null,                                   // the preview must skip the boat question itself
    viewport: PHONE,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    firebase: { mode: 'google', logs: [] }        // signed in as google-1 ("Test Surfer"), empty log
  },
  async run({ page, ctx, assert, log }) {
    const cleanErrors = () => ctx.state(() => (window.CLEAN && CLEAN.errors || []).map(e => e.where + ': ' + e.message));
    const noCleanErrors = async (where) => assert.deepEqual(await cleanErrors(), [], where + ': CLEAN.errors');
    // The spot name stays off screen (A2-Notes): it lives in config only.
    const SPOT = /Chocomount|Fishers Island|\bChoc\b/i;
    const noSpotName = async (where) => {
      const hit = await ctx.state(rx => (document.body.innerText.match(new RegExp(rx, 'i')) || [])[0] || null, SPOT.source);
      assert.equal(hit, null, where + ': the spot name is on screen');
    };
    const boot = async (path) => {
      await ctx.open(path);
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
      await ctx.waitForChart();
      await ctx.waitForLoad();
    };

    // ── Phone: boot, boat question skipped, plain address untouched ──
    await boot('/?preview=clean');
    const boot0 = await ctx.state(() => ({
      on: document.documentElement.classList.contains('cl-on'),
      theme: document.documentElement.getAttribute('data-clean-theme'),
      gateShown: (() => { const g = document.getElementById('gate-overlay'); return !!g && getComputedStyle(g).display !== 'none'; })(),
      gateKey: sessionStorage.getItem('lcc-gate'),
      passed: STATE.boatGatePassed,
      title: document.getElementById('cl-title').textContent,
      parts: ['forecast', 'log', 'model'].map(p => CLEAN.part(p))
    }));
    log('boot', JSON.stringify(boot0));
    assert.ok(boot0.on, 'html.cl-on: the clean shell mounted');
    assert.equal(boot0.theme, 'day', '11:00 is daytime at the spot');
    assert.equal(boot0.gateShown, false, 'the boat question is not on screen');
    assert.equal(boot0.passed, true);
    assert.equal(boot0.gateKey, null, 'the preview does not remember a boat answer (the plain address still asks)');
    assert.equal(boot0.title, 'Today');
    for (const p of boot0.parts) assert.deepEqual(p, { mounted: true, failed: false });

    // ── Now block: the fixture's 11:00 hour ──
    await ctx.waitFor(() => document.querySelector('#cl-view-forecast .cl-f-now .cl-f-num'), { label: 'Now block hero' });
    const now = await ctx.state(() => {
      const q = s => { const e = document.querySelector('#cl-view-forecast ' + s); return e ? e.textContent.replace(/ /g, ' ').trim() : null; };
      // The same hour read straight from the app's own forecast, for comparison.
      const m = STATE.forecastData.marine.hourly, i = marineNowIndex(STATE.forecastData.marine);
      return {
        num: q('.cl-f-now .cl-f-num'), unit: q('.cl-f-now .cl-f-unit'), meta: q('.cl-f-now .cl-f-meta'),
        status: q('.cl-f-now .cl-st'),
        raw: { h: m.swell_wave_height[i], p: m.swell_wave_period[i], d: m.swell_wave_direction[i], t: m.time[i] }
      };
    });
    log('now', JSON.stringify(now));
    assert.equal(now.num, '1.6', 'hero swell height');
    assert.equal(now.unit, 'ft');
    assert.equal(now.num, (Math.round(now.raw.h * 10) / 10).toFixed(1), 'hero = the app\'s forecast for this hour');
    assert.match(now.meta, /^8 s\s*·\s*ESE 118°$/, 'period and direction');
    assert.equal(now.status, 'IN WINDOW');
    await ctx.screenshot('clean-forecast');

    // ── This week: 7 rows ──
    const week = await ctx.state(() => [...document.querySelectorAll('#cl-view-forecast .cl-f-wk .cl-f-row')].map(r => r.querySelector('.cl-f-d').textContent));
    log('week', week.join(' '));
    assert.equal(week.length, 7, 'seven day rows');
    assert.equal(week[0], 'Today');

    // ── Tap a week row: the chart cursor slides to that day's low ──
    const K = 2;   // Sat: two days out, its low is a morning low in daylight
    const want = await ctx.state(k => {
      const d = CLEAN.data.week()[k];
      return { label: d.label, low: d.low && d.low.t.getTime(), text: d.low ? CLEAN.fmt.day(d.low.t) + ' ' + CLEAN.fmt.time(d.low.t) + ' · low' : null, idx: d.low ? CLEAN.data.indexAt(d.low.t) : -1 };
    }, K);
    log('tap week row', K, JSON.stringify(want));
    assert.ok(want.low, 'the tapped day has a low to jump to');
    const x0 = await ctx.state(() => +document.querySelector('#cl-view-forecast .cl-f-cx .cur').getAttribute('x1'));
    await page.locator(`#cl-view-forecast .cl-f-wk .cl-f-row[data-k="${K}"]`).click();
    await ctx.waitFor(t => (document.querySelector('#cl-view-forecast .cl-f-rdt').textContent || '').replace(/ /g, ' ') === t.replace(/ /g, ' '),
      { arg: want.text, label: 'readout names the low', timeout: 5000 });
    // Where the cursor must land: the low's place inside its day column
    // (day labels sit at each local midnight).
    const where = await ctx.state(({ low, label }) => {
      const svg = document.querySelector('#cl-view-forecast .cl-f-cx');
      const W = +svg.getAttribute('width');
      const spans = [...document.querySelectorAll('#cl-view-forecast .cl-f-dl span')];
      const k = spans.findIndex(s => s.textContent === label);
      const a = parseFloat(spans[k].style.left) / 100 * W;
      const b = k + 1 < spans.length ? parseFloat(spans[k + 1].style.left) / 100 * W : W;
      const day0 = new Date(low); day0.setHours(0, 0, 0, 0);
      return { W, expect: a + (low - day0.getTime()) / 864e5 * (b - a), dayW: b - a };
    }, want);
    await ctx.waitFor(x => Math.abs(+document.querySelector('#cl-view-forecast .cl-f-cx .cur').getAttribute('x1') - x) < 2,
      { arg: where.expect, label: 'cursor line at the low', timeout: 5000 });
    const after = await ctx.state(k => ({
      x: +document.querySelector('#cl-view-forecast .cl-f-cx .cur').getAttribute('x1'),
      sel: document.querySelector(`#cl-view-forecast .cl-f-row[data-k="${k}"]`).getAttribute('aria-pressed'),
      scrub: STATE.scrubberIdx,
      chartTop: Math.round(document.querySelector('#cl-view-forecast .cl-f-fch').getBoundingClientRect().top)
    }), K);
    log('cursor', JSON.stringify(Object.assign({ from: x0 }, where, after)));
    assert.notEqual(Math.round(after.x), Math.round(x0), 'the cursor moved');
    assert.equal(after.sel, 'true', 'the tapped row stays selected');
    await ctx.waitFor(i => STATE.scrubberIdx === i, { arg: want.idx, label: 'the app\'s scrubber follows to the low\'s hour', timeout: 3000 });
    // A repaint of the app's chart (live data landing after the saved copy,
    // which CI's slower runner hits) puts the app's scrubber back to now;
    // it has to come back to the cursor on screen.
    await ctx.state(() => { const d = STATE.forecastData; drawForecastChart(d.marine, d.wind, d.daylight, d.tideHiLo, d.tidePred, d.buoyParsed); });
    await ctx.waitFor(i => STATE.scrubberIdx === i, { arg: want.idx, label: 'the app\'s scrubber returns to the cursor after a repaint', timeout: 3000 });
    await ctx.waitFor(() => Math.abs(document.querySelector('#cl-view-forecast .cl-f-fch').getBoundingClientRect().top) < 12,
      { label: 'page scrolled to the chart', timeout: 3000 });
    await ctx.screenshot('clean-week-tap');
    // Back to now.
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();
    await ctx.waitFor(() => !document.querySelector('#cl-view-forecast .cl-f-row.sel'), { label: 'Now clears the day', timeout: 3000 });

    // ── The three tabs ──
    const tabState = () => ctx.state(() => ({
      tab: CLEAN.tab(),
      visible: ['forecast', 'log', 'model'].filter(t => !document.getElementById('cl-view-' + t).hidden),
      current: [...document.querySelectorAll('#cl-app .cl-tabs .cl-tab[aria-current="page"]')].map(b => b.dataset.tab),
      legacy: STATE.activeTab,
      title: document.getElementById('cl-title').textContent
    }));
    const LEGACY = { forecast: 'forecast', log: 'surflog', model: 'regression' };
    const TITLE = { forecast: 'Today', log: 'Log', model: 'Your model' };
    for (const t of ['log', 'model', 'forecast']) {
      await page.locator(`#cl-app .cl-tabs .cl-tab[data-tab="${t}"]`).click();
      await ctx.waitFor(id => CLEAN.tab() === id, { arg: t, label: 'tab ' + t });
      const s = await tabState();
      log('tab', JSON.stringify(s));
      assert.deepEqual(s.visible, [t], t + ': only its view is shown');
      assert.deepEqual(s.current, [t], t + ': its tab button is current');
      assert.equal(s.legacy, LEGACY[t], t + ': the app\'s own tab follows');
      assert.equal(s.title, TITLE[t]);
      if (t !== 'forecast') await ctx.screenshot('clean-tab-' + t);
      await noSpotName(t);
    }
    await noCleanErrors('phone tabs');

    // ── Settings: opens, Display mode persists across a reload ──
    await page.locator('#cl-settings-btn').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-settings') && document.querySelector('#cl-app').hidden, { label: 'Settings open' });
    const set0 = await ctx.state(() => ({
      title: document.querySelector('#cl-sub-settings h1').textContent,
      account: document.querySelector('#cl-sub-settings .cl-set-acct').innerText.replace(/\s+/g, ' ').trim(),
      heads: [...document.querySelectorAll('#cl-sub-settings .cl-h2')].map(h => h.textContent),
      checked: document.querySelector('#cl-sub-settings [role=radio][aria-checked="true"]').dataset.mode
    }));
    log('settings', JSON.stringify(set0));
    assert.equal(set0.title, 'Settings');
    assert.deepEqual(set0.heads, ['Account', 'Display', 'Forecast', 'Data sources', 'Spot']);
    assert.equal(set0.checked, 'sunset', 'Display defaults to Automatic at sunset');
    assert.equal(set0.account, 'Signed in as Test Surfer Sign out');
    await noSpotName('Settings');
    await page.locator('#cl-sub-settings [data-mode="dark"]').click();
    await ctx.waitFor(() => document.documentElement.getAttribute('data-clean-theme') === 'night', { label: 'Always dark applies' });
    assert.equal(await ctx.state(() => localStorage.getItem('lcc-clean-display')), 'dark');
    await page.waitForTimeout(500);   // the 400 ms colour fade
    await ctx.screenshot('clean-settings-dark');
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !document.querySelector('#cl-sub-settings') && !document.querySelector('#cl-app').hidden, { label: 'Settings closed' });

    await boot('/?preview=clean');   // a real reload (a #hash change alone would not reload)
    assert.equal(await ctx.state(() => document.documentElement.getAttribute('data-clean-theme')), 'night', 'dark from the first paint after a reload');
    await page.locator('#cl-settings-btn').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-settings [role=radio][aria-checked="true"]'), { label: 'Settings after reload' });
    const set1 = await ctx.state(() => ({
      theme: document.documentElement.getAttribute('data-clean-theme'),
      checked: document.querySelector('#cl-sub-settings [role=radio][aria-checked="true"]').dataset.mode
    }));
    assert.deepEqual(set1, { theme: 'night', checked: 'dark' }, 'Always dark survives a reload');
    await page.locator('#cl-sub-settings [data-mode="sunset"]').click();
    await ctx.waitFor(() => document.documentElement.getAttribute('data-clean-theme') === 'day', { label: 'back to the sun' });
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !document.querySelector('#cl-sub-settings'), { label: 'Settings closed' });

    // ── Log: Save waits for all three ratings ──
    await page.locator('#cl-app .cl-tabs .cl-tab[data-tab="log"]').click();
    await ctx.waitFor(() => window._fbUserId === 'google-1' && !document.querySelector('#cl-view-log .cl-l-form').hidden, { label: 'Log form (signed in)' });
    const save = () => ctx.state(() => {
      const b = document.querySelector('#cl-view-log .cl-l-save');
      const why = document.querySelector('#cl-view-log .cl-l-why');
      return { disabled: b.disabled, label: b.textContent, why: why.hidden ? '' : why.textContent };
    });
    let s = await save();
    log('save, unrated', JSON.stringify(s));
    assert.equal(s.disabled, true, 'Save is off with nothing rated');
    const RATE = [['size', 6], ['windQuality', 7], ['rideQuality', 5]];
    for (let i = 0; i < RATE.length; i++) {
      const [key, v] = RATE[i];
      await page.locator(`#cl-view-log .cl-l-rt[data-r="${key}"] button[data-v="${v}"]`).click();
      await ctx.waitFor(k => /\/\s*10/.test(document.querySelector(`#cl-view-log .cl-l-rt[data-r="${k}"] .cl-l-rv`).textContent), { arg: key, label: key + ' rated' });
      s = await save();
      log('save after', key, JSON.stringify(s));
      if (i < RATE.length - 1) {
        assert.equal(s.disabled, true, `Save is still off with ${i + 1} of 3 rated`);
        assert.match(s.why, /^Rate .+ to save$/, 'and says what is missing');
      }
    }
    await ctx.waitFor(() => !document.querySelector('#cl-view-log .cl-l-save').disabled, { label: 'Save on with three ratings', timeout: 15000 });
    s = await save();
    assert.equal(s.label, 'Save');
    assert.doesNotMatch(s.why, /^Rate /);
    await ctx.screenshot('clean-log-ready');
    // Saving goes through the app's own save: one new entry, owned by the
    // signed-in surfer, with the three ratings.
    const writes0 = await ctx.state(() => (window.__FB_WRITES || []).length);
    await page.locator('#cl-view-log .cl-l-save').click();
    await ctx.waitFor(n => (window.__FB_WRITES || []).slice(n).some(w => w.op === 'set' && /surf_logs/.test(w.path)), { arg: writes0, label: 'Firestore write', timeout: 20000 });
    const w = await ctx.state(n => window.__FB_WRITES.slice(n).filter(x => x.op === 'set' && /surf_logs/.test(x.path)).map(x => ({ uid: x.uid, userId: x.data.userId, ratings: x.data.ratings })), writes0);
    log('saved', JSON.stringify(w));
    assert.equal(w.length, 1, 'one session saved');
    assert.equal(w[0].uid, 'google-1');
    assert.equal(w[0].userId, 'google-1');
    assert.deepEqual(w[0].ratings, { size: 6, windQuality: 7, rideQuality: 5 });
    await ctx.waitFor(() => document.querySelectorAll('#cl-view-log .cl-l-ss').length === 1, { label: 'the new session is listed' });
    await noCleanErrors('log');

    // ── Nothing pans sideways at 375 px ──
    await page.setViewportSize({ width: 375, height: 667 });
    await boot('/?preview=clean');
    const widths = {};
    for (const t of ['forecast', 'log', 'model']) {
      await page.locator(`#cl-app .cl-tabs .cl-tab[data-tab="${t}"]`).click();
      await ctx.waitFor(id => CLEAN.tab() === id, { arg: t, label: 'tab ' + t + ' at 375' });
      await page.waitForTimeout(300);
      const m = await ctx.state(sideways);
      widths[t] = m;
      assert.equal(m.clientW, 375);
      assert.ok(m.scrollW <= m.clientW, `${t} at 375 px: page is ${m.scrollW} px wide, scrolls sideways`);
    }
    await page.locator('#cl-settings-btn').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-settings'), { label: 'Settings at 375' });
    const ms = await ctx.state(sideways);
    widths.settings = ms;
    assert.ok(ms.scrollW <= ms.clientW, `Settings at 375 px: page is ${ms.scrollW} px wide`);
    ctx.metric('clean375', widths);
    await noCleanErrors('375 px');

    // ── Choc TV: three day cards, Next moves on without pausing ──
    await page.setViewportSize({ width: 1180, height: 820 });
    // kioskRotate holds every panel for 10 min, so only Next moves it.
    await ctx.open('/?kiosk=1&preview=clean&kioskRotate=600000');
    await ctx.waitFor(() => window.CLEAN && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted, { label: 'clean Choc TV mounted' });
    await ctx.waitForLoad();
    await ctx.waitFor(() => {
      const p = document.querySelector('#cl-tv .cl-tv-panel.is-on[data-panel="cl-days1"]');
      return p && p.querySelectorAll('.cl-tv-card').length === 3 && /\d/.test(p.querySelector('.cl-tv-card .cl-tv-num').textContent);
    }, { label: '3 day cards with numbers' });
    const tv0 = await ctx.state(() => ({
      panel: document.getElementById('cl-tv').getAttribute('data-panel'),
      days: [...document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card .cl-tv-day')].map(e => e.textContent),
      hero: [...document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card .cl-tv-num')].map(e => e.textContent),
      legacyShown: ['kiosk-days-1', 'kiosk-status'].filter(id => { const e = document.getElementById(id); return e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden'; }),
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
    }));
    log('tv', JSON.stringify(tv0));
    assert.equal(tv0.panel, 'cl-days1');
    assert.equal(tv0.days.length, 3);
    assert.equal(tv0.days[0], 'Today');
    assert.deepEqual(tv0.legacyShown, [], 'the classic Choc TV panels stay hidden under the clean one');
    assert.ok(tv0.scrollW <= tv0.clientW, 'Choc TV fits the screen');
    await ctx.screenshot('clean-tv-days1');
    await noSpotName('Choc TV');
    // Sources (kiosk.js's own card, restyled) opens over the panel and pauses.
    await page.locator('#cl-tv .cl-tv-btn[data-act="sources"]').click();
    await ctx.waitFor(() => { const o = document.getElementById('kiosk-info-overlay'); return o && o.closest('#cl-tv') && getComputedStyle(o).display !== 'none'; }, { label: 'Sources card open' });
    await noSpotName('Choc TV Sources');
    assert.deepEqual(await ctx.state(() => ({ kiosk: KIOSK.state, cue: !document.querySelector('#cl-tv .cl-tv-ps').hidden })),
      { kiosk: 'paused', cue: true }, 'Sources pauses the rotation and says so');
    await page.locator('#kiosk-info-overlay').click();
    await ctx.waitFor(() => getComputedStyle(document.getElementById('kiosk-info-overlay')).display === 'none', { label: 'Sources card closed' });
    // Still paused (kiosk.js's rule for its Sources card); Next resumes and moves on.
    await page.locator('#cl-tv .cl-tv-btn[data-act="next"]').click();
    await ctx.waitFor(() => document.getElementById('cl-tv').getAttribute('data-panel') === 'cl-days2' &&
      document.querySelector('#cl-tv .cl-tv-panel.is-on').getAttribute('data-panel') === 'cl-days2', { label: 'Next → days 4–6', timeout: 5000 });
    const tv1 = await ctx.state(() => ({
      cards: document.querySelectorAll('#cl-tv [data-panel="cl-days2"] .cl-tv-card').length,
      paused: !document.querySelector('#cl-tv .cl-tv-ps').hidden,
      kiosk: KIOSK.state
    }));
    log('tv next', JSON.stringify(tv1));
    assert.equal(tv1.cards, 3, 'days 4–6: three cards');
    assert.equal(tv1.paused, false, 'Next resumes the rotation');
    assert.equal(tv1.kiosk, 'rotating');
    await ctx.screenshot('clean-tv-days2');
    await page.locator('#cl-tv .cl-tv-btn[data-act="next"]').click();
    await ctx.waitFor(() => document.getElementById('cl-tv').getAttribute('data-panel') === 'cl-radar', { label: 'Next → radar', timeout: 5000 });
    assert.deepEqual(await ctx.state(() => ({ kiosk: KIOSK.state, cue: !document.querySelector('#cl-tv .cl-tv-ps').hidden })),
      { kiosk: 'rotating', cue: false }, 'Next skips ahead without pausing');
    await page.waitForTimeout(500);
    await ctx.screenshot('clean-tv-radar');
    // The sweep is the TV's one continuous motion; reduced motion stops it.
    const sweep = () => ctx.state(() => { const s = getComputedStyle(document.querySelector('#cl-tv .cl-tv-sweep')); return s.display === 'none' ? 'none' : s.animationPlayState; });
    assert.equal(await sweep(), 'running', 'the radar sweep turns');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await sweep(), 'none', 'reduced motion: no sweep');
    await page.emulateMedia({ reducedMotion: null });
    await noCleanErrors('Choc TV');

    const own = ctx.consoleErrors.filter(t => /CLEAN|previews\/clean/.test(t));
    assert.deepEqual(own, [], 'no console errors from the clean preview');
  }
};
