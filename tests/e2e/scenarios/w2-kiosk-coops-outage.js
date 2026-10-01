// Choc TV during a NOAA CO-OPS outage (review of the audit branch). The
// tide predictions fall back to the saved copy (astronomical, so it stays
// right for days) while Open-Meteo keeps refreshing the swell and wind.
// The status strip used to take the SAVED TIDES' age and raise the red
// "FORECAST 3 H OLD — NOT UPDATING" banner over a forecast fetched minutes
// earlier. Its age is now the forecast's; the SOURCES card still names the
// saved tides.
'use strict';

module.exports = {
  name: 'kiosk: a CO-OPS outage with Open-Meteo up keeps the strip fresh over the saved tides',
  options: { device: 'iPad Pro 11 landscape', gate: null },
  async run({ page, ctx, assert, log }) {
    const strip = () => ctx.state(() => {
      const s = document.getElementById('kiosk-status');
      const b = document.getElementById('kiosk-stale-banner');
      return {
        text: document.getElementById('kiosk-status-updated').textContent,
        stale: s.classList.contains('np-stale'),
        dead: s.classList.contains('np-dead'),
        banner: b && getComputedStyle(b).display !== 'none' ? b.textContent : ''
      };
    });

    await ctx.open('/?kiosk=1');
    await ctx.waitForLoad();
    await ctx.waitFor(() => document.getElementById('kiosk-status-updated').textContent === 'updated just now',
      { timeout: 5000, label: 'fresh boot: updated just now' });

    // NOAA answers "No Predictions" (HTTP 200) for every request; Open-Meteo is fine.
    ctx.net.coops = 'error';
    const before = await ctx.state(() => STATE.lastLoadCompletedAt);
    await page.clock.fastForward('03:15:00');
    await ctx.waitFor(t => STATE.lastLoadCompletedAt !== t && !isDataLoadInFlight(),
      { arg: before, label: 'refresh 3 h 15 min into the CO-OPS outage' });
    await page.waitForTimeout(1300);   // the 1 s status tick after the load

    const health = await ctx.state(() => ({
      marine: STATE.dataHealth.marine.origin,
      wind: STATE.dataHealth.wind.origin,
      tides: STATE.dataHealth.tides.origin,
      tidesAgeH: (Date.now() - STATE.dataHealth.tides.asOf) / 3600e3
    }));
    const s = await strip();
    log('3h15m into the outage:', JSON.stringify(s), JSON.stringify(health));
    assert.equal(health.marine, 'live');
    assert.equal(health.wind, 'live');
    assert.equal(health.tides, 'stale-cache');
    assert.ok(health.tidesAgeH > 3, 'the tides on the cards are the 11:00 saved copy');
    assert.deepEqual(s, { text: 'updated just now', stale: false, dead: false, banner: '' });
    // The day cards keep their tide lows from the saved predictions.
    assert.match(await ctx.state(() => document.getElementById('kiosk-days-1').innerText), /LOW @/);
    await ctx.screenshot('coops-outage');

    // SOURCES still says where the tides came from.
    const sources = await ctx.state(() => kioskInfoStatusHTML());
    assert.match(sources, /Tides: stale-cache \(3h 1\dm ago\)/);
  }
};
