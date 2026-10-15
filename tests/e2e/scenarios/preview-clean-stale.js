// Default look, the wave forecast down on a later visit (ported from the
// classic w1-marine-down-warm-cache.js), against the fixtures (Thu 1 Oct
// 2026, 11:00 ET). A crew member opens the app at 11:00, then opens it again
// at 1:00 PM while Open-Meteo's wave forecast answers 503:
//   • the app falls back to the forecast it saved at 11:00 (stale-while-
//     revalidate) and keeps its true age: STATE.dataHealth.marine is the
//     saved copy ('stale-cache') with the 11:00 time, the data stays "as of
//     11:00", and the week's hours and the now reading are all there;
//   • the new look says so: CLEAN.data.freshness() is 'stale', and Settings ›
//     Data sources shows the Wave forecast row as "11:00 AM · 2h old" in
//     amber, while the wind and tides, which did load, read 1:00 PM unmarked.
//     (The Forecast tab's headline is the Sound Check model, so this is where
//     Open-Meteo's wave forecast shows its age.);
//   • with no saved copy at all (storage cleared) and the wave forecast still
//     down: the row reads "Not loaded" and freshness is 'dead', never an old
//     forecast passed off as current; the wind and tides still show.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean, wave forecast down on a later visit: the saved forecast with its true age, stale in Data sources; none saved: not loaded',
  options: {
    viewport: { width: 390, height: 844 },
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
  },
  async run({ page, ctx, assert, log }) {
    const cleanErrors = () => ctx.state(() => (window.CLEAN && CLEAN.errors || []).map(e => e.where + ': ' + e.message));
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    const reload = async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      ctx.t0 = Date.now();
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
      await ctx.waitForLoad({ timeout: 15000 });
    };
    // Settings › Data sources, row by row: its text, its level class, and whether it is drawn in the theme's amber
    const sources = async () => {
      await ctx.state(() => CLEAN.openSettings('sources'));
      await ctx.waitFor(() => document.querySelectorAll('#cl-sub-settings [data-src]').length === 4, { label: 'Data sources' });
      await page.waitForTimeout(300);   // the sub-page's fade-in, for the screenshot
      return ctx.state(() => {
        const out = {};
        document.querySelectorAll('#cl-sub-settings [data-src]').forEach(r => {
          const v = r.querySelector('.cl-v'), probe = document.createElement('span');
          probe.style.color = 'var(--amber)';
          r.appendChild(probe);
          out[r.getAttribute('data-src')] = {
            text: v.textContent,
            level: v.classList.contains('cl-stale') ? 'stale' : v.classList.contains('cl-dead') ? 'dead' : '',
            amber: getComputedStyle(v).color === getComputedStyle(probe).color
          };
          probe.remove();
        });
        return out;
      });
    };
    const closeSettings = async () => {
      await page.keyboard.press('Escape');
      await ctx.waitFor(() => !document.querySelector('#cl-sub-settings'), { label: 'Settings closed' });
    };

    // ── 11:00: everything live ──
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    await ctx.waitForLoad({ timeout: 15000 });
    const firstAsOf = await ctx.state(() => STATE.dataHealth.marine.asOf);
    assert.ok(Math.abs(firstAsOf - Date.parse('2026-10-01T11:00:00-04:00')) < 60000, 'the first forecast is as of 11:00 AM');
    assert.equal(await ctx.state(() => CLEAN.data.freshness()), 'fresh');
    let src = await sources();
    log('11:00 sources', JSON.stringify(src));
    assert.deepEqual([sp(src.marine.text), src.marine.level], ['11:00 AM', ''], 'Wave forecast: fresh at 11:00');
    await closeSettings();

    // ── 1:00 PM: the wave forecast answers 503; the page is opened again ──
    ctx.net.marine = 'down';
    const asked = ctx.requestsTo('marine-api.open-meteo.com').length;
    await page.clock.fastForward('02:00:00');      // past every 30-min forecast cache lifetime
    await reload();
    const s = await ctx.state(() => ({
      now: Date.now(),
      health: STATE.dataHealth,
      dataAsOf: STATE.dataAsOf,
      fresh: CLEAN.data.freshness(),
      loaded: CLEAN.data.loaded(),
      hours: CLEAN.data.hours().length,
      swell: !!CLEAN.data.now().swell
    }));
    log('1:00 PM', JSON.stringify(s));
    assert.ok(ctx.requestsTo('marine-api.open-meteo.com').length > asked, 'the wave forecast was asked again');
    assert.ok(s.now - firstAsOf >= 2 * 3600e3, 'two hours on');
    assert.deepEqual(s.health.marine, { asOf: firstAsOf, origin: 'stale-cache' }, 'the saved 11:00 forecast, with its own time');
    assert.equal(s.health.wind.origin, 'live', 'the wind loaded');
    assert.equal(s.dataAsOf, firstAsOf, 'the data on screen is as of 11:00, not 1:00 PM');
    assert.deepEqual([s.loaded, s.hours, s.swell], [true, 168, true], 'the saved week and the now reading are there');
    assert.equal(s.fresh, 'stale', 'CLEAN.data.freshness()');
    src = await sources();
    log('1:00 PM sources', JSON.stringify(src));
    assert.match(sp(src.marine.text), /^11:00 AM · 2h( \d+m)? old$/, 'Wave forecast: its time and age');
    assert.equal(src.marine.level, 'stale', 'Wave forecast: marked stale');
    assert.equal(src.marine.amber, true, 'Wave forecast: in amber');
    assert.deepEqual(src.wind, { text: src.wind.text, level: '', amber: false }, 'Wind forecast: fresh');
    assert.equal(sp(src.wind.text), '1:00 PM');
    assert.deepEqual([sp(src.tides.text), src.tides.level], ['1:00 PM', ''], 'Tides: fresh');
    await ctx.screenshot('settings-sources-stale');
    await closeSettings();
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (saved forecast)');

    // ── Nothing saved and the wave forecast still down ──
    await ctx.state(() => localStorage.clear());
    await reload();
    const c = await ctx.state(() => ({ marine: STATE.dataHealth.marine.origin, dataAsOf: STATE.dataAsOf, fresh: CLEAN.data.freshness(), loaded: CLEAN.data.loaded() }));
    log('cold', JSON.stringify(c));
    assert.deepEqual(c, { marine: 'failed', dataAsOf: null, fresh: 'dead', loaded: false }, 'no forecast, said plainly');
    src = await sources();
    log('cold sources', JSON.stringify(src));
    assert.equal(sp(src.marine.text), 'Not loaded');
    assert.equal(sp(src.wind.text), '1:00 PM', 'the wind that loaded still shows');
    assert.equal(sp(src.tides.text), '1:00 PM', 'the tides that loaded still show');
    await ctx.screenshot('settings-sources-not-loaded');
    await closeSettings();
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (no forecast)');
  }
};
