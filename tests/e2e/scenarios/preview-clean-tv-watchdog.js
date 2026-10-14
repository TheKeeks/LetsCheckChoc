// Choc TV, the new look's (?kiosk=1&preview=clean: previews/clean/tv.js on
// kiosk.js's machinery): a boot that never produces a load used to leave the
// TV at the house without a forecast until someone exited Guided Access to
// reload it. kiosk.js's boot watchdog mends that: ten minutes after boot with
// no completed load, it probes the site (./?kiosk=1&probe=…, so a reload
// never strands the iPad on Safari's offline page) and reloads once the probe
// answers. Nothing happens before the 10-min mark, and it probes once, not in
// a loop. The stall here is a buoy list that stays down until the watchdog's
// probe goes out: the TV's 15 s retries of the list keep failing, and only
// the reload heals it. After the reload it is the new TV again (not the
// classic one), with its day cards and incoming tides.
// Port of w2-kiosk-boot-watchdog.js (the classic TV) to the new TV.
'use strict';

module.exports = {
  name: 'clean preview Choc TV: the boot watchdog reloads a TV whose boot never produced a load',
  options: { device: 'iPad Pro 11 landscape' },
  async run({ page, ctx, assert, log }) {
    let blocked = true;
    let probes = 0;
    await ctx.route('**/data/buoys-east-coast.json', route =>
      blocked ? route.abort('connectionfailed') : route.continue());
    await ctx.route(/[?&]probe=\d+/, route => {
      probes++;
      blocked = false;           // the network "comes back" as the watchdog checks
      return route.continue();
    });
    // The pinned Sound Check run (made Thu 1 Oct 2026, 10:30 AM), not the copy the bot last shipped.
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    const readTV = () => ctx.state(() => {
      const sp = s => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
      const p = CLEAN.part('tv');
      return {
        mounted: !!(p && p.mounted && !p.failed) && document.documentElement.classList.contains('cl-tv'),
        boot: window.__bootDocument === true,
        loaded: !!STATE.lastLoadCompletedAt,
        fresh: CLEAN.data.freshness(),
        wins: [...document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card .cl-tv-win')].map(e => sp(e.textContent))
      };
    });

    await ctx.open('/?kiosk=1&preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted &&
      typeof KIOSK === 'object' && KIOSK.bootAt > 0 && STATE.tideStations.length > 0 && STATE.buoys.length === 0,
    { label: 'the new TV booted without the buoy list' });
    await page.evaluate(() => { window.__bootDocument = true; });
    let tv = await readTV();
    log('boot', JSON.stringify(tv));
    assert.equal(tv.mounted, true, 'the new TV is up');
    assert.equal(tv.loaded, false, 'no load without the buoy list');
    assert.equal(tv.fresh, 'loading', 'the TV is still loading');

    // Nine minutes in: the buoy-list retries keep failing, still no probe.
    await page.clock.fastForward('09:00');
    await page.waitForTimeout(1500);
    tv = await readTV();
    log('9 min', JSON.stringify(tv), 'probes', probes);
    assert.equal(probes, 0, 'no probe before the 10-min mark');
    assert.equal(tv.loaded, false, 'still no load at 9 min');
    assert.equal(tv.boot, true, 'no reload yet');
    assert.equal(tv.mounted, true, 'still the new TV (it never gave the screen back)');

    // At the 10-min mark the watchdog probes and reloads.
    await page.clock.fastForward('01:30');
    await ctx.waitFor(() => !window.__bootDocument && typeof STATE === 'object' && !!STATE.lastLoadCompletedAt &&
      window.CLEAN && CLEAN.part('tv') && CLEAN.part('tv').mounted, { timeout: 45000, label: 'the reloaded TV completed a load' });
    await ctx.waitForLoad();
    assert.equal(probes, 1, 'probed the site once before reloading');
    const stamp = await ctx.state(() => Number(localStorage.getItem('lcc-kiosk-last-reload')));
    assert.ok(stamp > 0, 'reload stamped for the 30-min guard');
    await ctx.waitFor(() => [...document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card .cl-tv-win')].filter(e => /^\s*Incoming \d/.test(e.textContent)).length === 3,
      { label: 'day cards with incoming tides after the reload', timeout: 10000 });
    tv = await readTV();
    log('after reload', JSON.stringify(tv));
    assert.equal(tv.mounted, true, 'the new TV after the reload, not the classic one');
    assert.equal(tv.fresh, 'fresh');
    assert.equal(tv.wins.length, 3);
    tv.wins.forEach(w => assert.match(w, /^Incoming \d/));
    assert.deepEqual(await ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message)), [], 'no CLEAN.errors');
    log('recovered by reload after the boot watchdog');
    await page.waitForTimeout(300);
    await ctx.screenshot('tv-after-reload');
  }
};
