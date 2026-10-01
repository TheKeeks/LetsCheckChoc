// Choc TV (audit C32, boot watchdog): a boot that never produces a load
// used to leave the kiosk on "loading…" until someone exited Guided Access.
// After 10 min without a completed load it now probes the site and reloads
// once the probe answers. The original trigger (Leaflet missing from the
// CDN) can no longer stall a load — Leaflet is vendored and map init is
// guarded — so the stall here is a buoy catalog that stays down until the
// watchdog's probe arrives: the 15 s catalog retry keeps failing, and only
// the watchdog's reload heals it.
'use strict';

module.exports = {
  name: 'kiosk: boot watchdog reloads a kiosk whose boot never produced a load',
  options: { device: 'iPad Pro 11 landscape', gate: null },
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

    await ctx.open('/?kiosk=1');
    await ctx.waitFor(() => typeof STATE === 'object' && STATE.tideStations.length > 0 && STATE.buoys.length === 0 &&
      !!document.getElementById('kiosk-status'), { label: 'kiosk booted without the buoy catalog' });
    await page.evaluate(() => { window.__bootDocument = true; });
    assert.equal(await ctx.state(() => !STATE.lastLoadCompletedAt), true, 'no load without the catalog');
    assert.equal(await ctx.state(() => document.getElementById('kiosk-status-updated').textContent), 'loading…');

    // Nine minutes in: the catalog retries keep failing, still no probe.
    await page.clock.fastForward('09:00');
    await page.waitForTimeout(1500);
    assert.equal(probes, 0, 'no probe before the 10-min mark');
    assert.equal(await ctx.state(() => !STATE.lastLoadCompletedAt), true, 'still no load at 9 min');

    // At the 10-min mark the watchdog probes and reloads.
    await page.clock.fastForward('01:30');
    await ctx.waitFor(() => !window.__bootDocument && typeof STATE === 'object' && !!STATE.lastLoadCompletedAt,
      { timeout: 45000, label: 'reloaded page completed a load' });
    assert.equal(probes, 1, 'probed the site once before reloading');
    await ctx.waitFor(() => /LOW @/.test((document.getElementById('kiosk-days-1') || {}).innerText || ''),
      { label: 'day cards rendered after the reload' });
    log('recovered by reload after the boot watchdog');
  }
};
