// Choc TV, the new look's (?kiosk=1&preview=clean: previews/clean/tv.js on
// kiosk.js's machinery): a Wi-Fi blip while the iPad at the house relaunches
// the web app makes initApp's one fetch of the buoy list
// (data/buoys-east-coast.json) fail. With no list nothing is ever selected,
// so the TV would sit on cards with no tides until someone climbed past
// Guided Access to reload it. kiosk.js re-fetches the list (first 12 s after
// boot, then every 15 s); once it answers, Choc (44097) is selected and the
// forecast loads in place: no reload, nobody has to touch the iPad, and each
// day card shows its incoming tide and the wind at the low again. The phone
// has its own retry in core.js (preview-clean-core.js §5); the TV relies on
// kiosk.js's kioskEnsureStatic / kioskEnsureSelected, run from its 1 Hz
// status tick. Port of w2-kiosk-boot-blip.js (the classic TV) to the new TV.
'use strict';

module.exports = {
  name: 'clean preview Choc TV: buoy list failing at boot recovers in place once it loads',
  options: { device: 'iPad Pro 11 landscape' },
  async run({ page, ctx, assert, log }) {
    let blocked = true;
    let hits = 0;
    await ctx.route('**/data/buoys-east-coast.json', route => {
      hits++;
      return blocked ? route.abort('connectionfailed') : route.continue();
    });
    const nodeWait = async (fn, label, timeout = 15000) => {
      const t0 = Date.now();
      while (!fn()) {
        if (Date.now() - t0 > timeout) throw new Error('timed out: ' + label);
        await new Promise(r => setTimeout(r, 50));
      }
    };
    // What the TV shows: the panel on screen, the first panel's cards, the
    // strip's buoy line, and core's freshness (the classic strip's "loading…"
    // / "updated just now").
    const readTV = () => ctx.state(() => {
      const sp = s => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
      const q = (c, sel) => { const e = c.querySelector(sel); return e ? sp(e.textContent) : null; };
      const p = CLEAN.part('tv'), by = document.querySelector('#cl-tv .cl-tv-by');
      return {
        mounted: !!(p && p.mounted && !p.failed),
        cur: window.CLEAN_TV ? CLEAN_TV.state().cur : null,
        sel: STATE.selectedBuoy ? STATE.selectedBuoy.id : null,
        loaded: !!STATE.lastLoadCompletedAt,
        fresh: CLEAN.data.freshness(),
        by: by ? { text: sp(by.textContent), hidden: by.hidden } : null,
        cards: [...document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card')].map(c => ({
          day: q(c, '.cl-tv-day'), num: q(c, '.cl-tv-num'), sw: q(c, '.cl-tv-sw'), win: q(c, '.cl-tv-win'), wd: q(c, '.cl-tv-wd')
        }))
      };
    });
    const noIncoming = cards => cards.every(c => !/Incoming/.test(c.win || ''));

    // The pinned Sound Check run (made Thu 1 Oct 2026, 10:30 AM), so the cards' numbers don't
    // depend on the copy the bot last shipped. kioskRotate keeps the first panel (the next three
    // days) on screen for the screenshot.
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    await ctx.open('/?kiosk=1&preview=clean&kioskRotate=600000');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted &&
      typeof KIOSK === 'object' && KIOSK.bootAt > 0 && STATE.tideStations.length > 0 && STATE.buoys.length === 0,
    { label: 'the new TV is up and initApp finished without the buoy list' });
    await page.evaluate(() => { window.__bootDocument = true; });
    assert.equal(hits, 1, 'initApp asked for the buoy list once');
    let tv = await readTV();
    log('blocked', JSON.stringify(tv));
    assert.equal(tv.mounted, true, 'the new TV is mounted while the list is down');
    assert.equal(tv.sel, null, 'nothing selected without the list');
    assert.equal(tv.loaded, false);
    assert.equal(tv.fresh, 'loading', 'the TV is still loading');
    assert.equal(tv.by && tv.by.hidden, true, 'no buoy reading on the strip yet');
    assert.equal(tv.cards.length, 3);
    assert.ok(noIncoming(tv.cards), 'no incoming-tide windows before a load');

    // Still down for the TV's first retry, 12 s after boot.
    await page.clock.fastForward('00:13');
    await nodeWait(() => hits >= 2, 'the TV’s first retry of the buoy list');
    tv = await readTV();
    assert.equal(tv.sel, null, 'the first retry failed too: still nothing selected');
    assert.equal(tv.loaded, false);
    assert.ok(noIncoming(tv.cards));

    // Network back: the next retry (15 s later) gets the list and boots Choc.
    blocked = false;
    await page.clock.fastForward('00:20');
    const sel = await ctx.waitFor(() => STATE.selectedBuoy && STATE.selectedBuoy.id, { timeout: 15000, label: 'Chocomount selected' });
    assert.equal(sel.value, '44097');
    await ctx.waitForLoad();
    await ctx.waitFor(() => [...document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card .cl-tv-win')].filter(e => /Incoming/.test(e.textContent)).length === 3,
      { label: 'three day cards with incoming-tide windows', timeout: 10000 });
    tv = await readTV();
    log('recovered', JSON.stringify(tv));
    assert.equal(tv.mounted, true);
    assert.equal(tv.cur, 'cl-days1', 'the next three days on screen');
    assert.equal(tv.cards.length, 3);
    tv.cards.forEach(c => {
      assert.match(c.num, /^\d+(\.\d)?$/, c.day + ': a height, not a dash (the classic NO SWELL DATA)');
      assert.match(c.sw, /^@ \d+ s\b/, c.day + ': the main swell then');
      assert.match(c.win, /^Incoming \d/, c.day + ': the incoming tide it is read over');
      assert.match(c.wd, /^At low \d+ mph /, c.day + ': the wind at the low');
    });
    assert.deepEqual(tv.cards.map(c => c.win.match(/^Incoming (\d+:\d\d [AP]M)/)[1]), ['7:28 AM', '8:29 AM', '9:34 AM'],
      'Silver Eel’s lows from the load that followed the list');
    assert.equal(tv.fresh, 'fresh', 'the forecast is fresh (the classic strip’s “updated just now”)');
    assert.equal(tv.by.hidden, false, 'the strip shows the buoy reading');
    assert.match(tv.by.text, /^Buoy \d.* old$/);

    // In place: no reload, no probe for one, and one load (kiosk.js selected Choc once).
    assert.equal(await ctx.state(() => window.__bootDocument === true), true, 'recovered without a reload');
    assert.equal(ctx.requestsTo('probe=').length, 0, 'no reload probe');
    assert.equal(await ctx.state(() => _loadGen), 1, 'one load');
    assert.deepEqual(await ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message)), [], 'no CLEAN.errors');
    log(`recovered after ${hits} buoy-list requests`);
    await page.waitForTimeout(300);
    await ctx.screenshot('tv-recovered');
  }
};
