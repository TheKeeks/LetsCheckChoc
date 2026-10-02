// Choc TV (audit C32): a Wi-Fi blip while the iPad relaunches the web app
// made initApp's one fetch of data/buoys-east-coast.json fail, and the
// kiosk sat on "loading…" forever. It now re-fetches the catalog and
// boots into Chocomount as soon as the network is back.
'use strict';

module.exports = {
  name: 'kiosk: buoy catalog failing at boot recovers once it loads',
  options: { device: 'iPad Pro 11 landscape', gate: null },
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

    await ctx.open('/?kiosk=1');
    await ctx.waitFor(() => typeof STATE === 'object' && STATE.tideStations.length > 0 && STATE.buoys.length === 0 &&
      !!document.getElementById('kiosk-status'), { label: 'initApp finished without the buoy catalog' });
    assert.equal(hits, 1);
    assert.equal(await ctx.state(() => document.getElementById('kiosk-status-updated').textContent), 'loading…');

    // Still down for the kiosk's first retry, 12 s after boot.
    await page.clock.fastForward('00:13');
    await nodeWait(() => hits >= 2, 'first kiosk retry of the catalog');
    assert.equal(await ctx.state(() => STATE.selectedBuoy), null);

    // Network back: the next retry (15 s later) gets the list and boots Choc.
    blocked = false;
    await page.clock.fastForward('00:20');
    const sel = await ctx.waitFor(() => STATE.selectedBuoy && STATE.selectedBuoy.id, { timeout: 15000, label: 'Chocomount selected' });
    assert.equal(sel.value, '44097');
    await ctx.waitForLoad();
    const cards = await ctx.waitFor(() => {
      const p = document.getElementById('kiosk-days-1');
      return p && p.querySelectorAll('.np-day').length === 3 && /LOW @/.test(p.innerText) && p.innerText;
    }, { label: 'day cards with tide lows' });
    assert.doesNotMatch(cards.value, /NO SWELL DATA/);
    await ctx.waitFor(() => document.getElementById('kiosk-status-updated').textContent === 'updated just now',
      { timeout: 5000, label: 'status strip updated' });
    log(`recovered after ${hits} catalog requests`);
    await ctx.screenshot('recovered');
  }
};
