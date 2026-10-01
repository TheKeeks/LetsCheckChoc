// Choc TV (audit C32, boot watchdog): when a CDN script fails at boot
// (here Leaflet from unpkg), selectBuoy and every data load throw, no load
// ever completes, and the kiosk used to sit on "loading…" until someone
// exited Guided Access. After 10 min without a completed load it now
// probes the site and reloads once the probe answers.
'use strict';

module.exports = {
  name: 'kiosk: boot watchdog reloads a kiosk whose boot never produced a load',
  options: { device: 'iPad Pro 11 landscape', gate: null, net: { leaflet: 'abort' } },
  async run({ page, ctx, assert, log }) {
    // The failure being healed: Leaflet missing makes app.js throw.
    ctx.allowPageError(/L is not defined|reading 'setLatLng'|reading 'setView'/);

    await ctx.open('/?kiosk=1');
    await ctx.waitFor(() => typeof STATE === 'object' && STATE.buoys.length > 0 && !!document.getElementById('kiosk-status'),
      { label: 'kiosk booted (catalogs in, maps not)' });
    await page.evaluate(() => { window.__bootDocument = true; });
    await page.waitForTimeout(3000);
    assert.equal(await ctx.state(() => !STATE.lastLoadCompletedAt), true, 'no load can complete without Leaflet');
    assert.equal(await ctx.state(() => document.getElementById('kiosk-status-updated').textContent), 'loading…');

    // Nine minutes in: still waiting, no probe.
    await page.clock.fastForward('09:00');
    await page.waitForTimeout(1500);
    assert.equal(ctx.requestsTo('probe=').length, 0);

    // The CDN recovers; at the 10-min mark the watchdog probes and reloads.
    ctx.net.leaflet = 'ok';
    await page.clock.fastForward('01:30');
    await ctx.waitFor(() => !window.__bootDocument && typeof STATE === 'object' && !!STATE.lastLoadCompletedAt,
      { timeout: 45000, label: 'reloaded page completed a load' });
    assert.equal(ctx.requestsTo('probe=').length, 1, 'probed the site once before reloading');
    await ctx.waitFor(() => /LOW @/.test((document.getElementById('kiosk-days-1') || {}).innerText || ''),
      { label: 'day cards rendered after the reload' });
    log('recovered by reload after the boot watchdog');
  }
};
