// C05 / C31 / C30: a crew member opens the app, then reopens it two hours
// later while Open-Meteo Marine is down (503). The chart used to come up
// blank under "Updated <now>". It now redraws the saved 11:00 forecast,
// says the refresh failed, and STATE.dataAsOf keeps the true 11:00 time.
'use strict';

module.exports = {
  name: 'marine down on a reload with a warm cache: saved chart, marked stale',
  options: { viewport: { width: 1280, height: 900 } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitForLoad({ timeout: 15000 });
    const firstAsOf = await ctx.state(() => STATE.dataHealth && STATE.dataHealth.marine.asOf);
    assert.match(await page.textContent('#header-update-time'), /^Updated 11:00 AM$/);

    // Two hours on (past every 30-min forecast TTL), marine-api answers 503.
    ctx.net.marine = 'down';
    await page.clock.fastForward('02:00:00');
    await page.reload({ waitUntil: 'domcontentloaded' });
    ctx.t0 = Date.now();
    await ctx.waitForLoad({ timeout: 15000 });

    const s = await ctx.state(() => ({
      now: Date.now(),
      chartHours: STATE.forecastChart && STATE.forecastChart.times.length,
      header: document.getElementById('header-update-time').textContent,
      headerColor: getComputedStyle(document.getElementById('header-update-time')).color,
      indicator: document.getElementById('forecast-cache-indicator').textContent,
      indicatorShown: getComputedStyle(document.getElementById('forecast-cache-indicator')).display !== 'none',
      unavailable: !!document.querySelector('#forecast-unavailable-msg:not([style*="none"])'),
      health: STATE.dataHealth || {},
      dataAsOf: STATE.dataAsOf
    }));
    log(JSON.stringify(s));
    assert.ok(ctx.requestsTo('marine-api.open-meteo.com').length >= 2, 'marine was asked again');
    assert.equal(s.chartHours, 168, 'chart drawn from the saved forecast');
    assert.equal(s.header, 'Refresh failed · data from 11:00 AM');
    assert.ok(s.now - firstAsOf >= 2 * 3600e3, 'clock moved on two hours');
    assert.equal(s.health.marine.origin, 'stale-cache');
    assert.equal(s.health.marine.asOf, firstAsOf, 'saved copy keeps its original time');
    assert.equal(s.health.wind.origin, 'live');
    assert.equal(s.dataAsOf, firstAsOf, 'as-of = oldest input on screen');
    assert.equal(s.headerColor, 'rgb(168, 90, 74)', 'header in red');
    assert.ok(s.indicatorShown);
    assert.equal(s.indicator, 'Saved forecast from 11:00 AM · refresh failed');
    assert.equal(s.unavailable, false, 'no "forecast unavailable" note: there is a forecast');

    const inked = await page.evaluate(() => {
      const c = document.getElementById('forecast-canvas-swell');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4 * 16) if (data[i]) n++;
      return n;
    });
    assert.ok(inked > 100, `swell canvas looks blank (${inked})`);
    await ctx.screenshot('stale-chart');

    // No saved copy at all (cleared storage) and marine still down: the
    // chart area says so instead of sitting blank under "Updated".
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ctx.waitForLoad({ timeout: 15000 });
    const cold = await ctx.state(() => {
      const note = document.getElementById('forecast-unavailable-msg');
      return {
        header: document.getElementById('header-update-time').textContent,
        note: note && getComputedStyle(note).display !== 'none' ? note.textContent : null,
        origin: STATE.dataHealth.marine.origin
      };
    });
    log(JSON.stringify(cold));
    assert.equal(cold.header, 'Forecast unavailable');
    assert.match(cold.note || '', /^Forecast unavailable: Open-Meteo didn't respond/);
    assert.equal(cold.origin, 'failed');
    await page.evaluate(() => document.getElementById('forecast-unavailable-msg').scrollIntoView({ block: 'center' }));
    await ctx.screenshot('no-forecast');
  }
};
