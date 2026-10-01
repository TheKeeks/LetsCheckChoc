// Choc TV (audit C30): when the Open-Meteo marine fetch fails on the
// 15-min refresh, the cards keep the last good forecast, so the status
// strip must show how old it is (not "updated just now"), go stale, and
// raise the red banner once it is over 3 h old.
'use strict';

module.exports = {
  name: 'kiosk: marine failing on refresh shows the true data age, then stale, then dead',
  options: { device: 'iPad Pro 11 landscape', gate: null },
  async run({ page, ctx, assert, log }) {
    const strip = () => ctx.state(() => {
      const s = document.getElementById('kiosk-status');
      const b = document.getElementById('kiosk-stale-banner');
      return {
        text: document.getElementById('kiosk-status-updated').textContent,
        stale: s.classList.contains('np-stale'),
        dead: s.classList.contains('np-dead'),
        banner: b && getComputedStyle(b).display !== 'none' ? b.textContent : '',
        pilot: getComputedStyle(document.getElementById('kiosk-pilot')).backgroundColor
      };
    });
    // Waits for the next completed refresh load and the 1 s status tick after it.
    const nextLoad = async (label) => {
      const before = await ctx.state(() => STATE.lastLoadCompletedAt);
      await ctx.waitFor(t => STATE.lastLoadCompletedAt !== t && !isDataLoadInFlight(), { arg: before, label });
      await page.waitForTimeout(1300);
    };

    await ctx.open('/?kiosk=1');
    await ctx.waitForLoad();
    await ctx.waitFor(() => document.getElementById('kiosk-status-updated').textContent === 'updated just now',
      { timeout: 5000, label: 'fresh boot: updated just now' });
    const fresh = await strip();
    assert.equal(fresh.stale || fresh.dead, false);
    assert.equal(fresh.banner, '');

    // Open-Meteo marine goes down; wind and CO-OPS keep answering.
    ctx.net.marine = 'down';
    const marineBefore = ctx.requestsTo('marine-api.open-meteo.com').length;
    await page.clock.fastForward('45:00');
    await nextLoad('refresh with marine down');
    assert.ok(ctx.requestsTo('marine-api.open-meteo.com').length > marineBefore, 'the refresh asked for the forecast');
    const stale = await strip();
    log('after 45 min:', JSON.stringify(stale));
    assert.notEqual(stale.text, 'updated just now');
    assert.match(stale.text, /^updated 4[5-6] min ago$/);
    assert.equal(stale.stale, true);
    assert.equal(stale.dead, false);
    assert.equal(stale.banner, '');
    // The cards still show the boot forecast (tide lows from the fixtures).
    assert.match(await ctx.state(() => document.getElementById('kiosk-days-1').innerText), /LOW @/);
    await ctx.screenshot('stale');

    await page.clock.fastForward('03:00:00');
    await nextLoad('refresh 3 h later, marine still down');
    const dead = await strip();
    log('after 3h45m:', JSON.stringify(dead));
    assert.match(dead.text, /^updated 3h 4\dm ago$/);
    assert.equal(dead.dead, true);
    assert.match(dead.banner, /^FORECAST 3 H OLD/);
    assert.equal(dead.pilot, 'rgb(255, 82, 82)', 'red pilot light = the alert colour');
    await ctx.screenshot('dead');

    // Forecast back: the next refresh clears the alarm.
    ctx.net.marine = 'ok';
    await page.clock.fastForward('15:00');
    await nextLoad('refresh with marine back');
    const back = await strip();
    assert.equal(back.text, 'updated just now');
    assert.equal(back.stale || back.dead, false);
    assert.equal(back.banner, '');
  }
};
