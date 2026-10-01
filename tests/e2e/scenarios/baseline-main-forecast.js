// Baseline: main page with the boat gate skipped (sessionStorage
// lcc-gate=no) auto-selects Chocomount and draws the forecast chart from
// the fixtures. Records time-to-chart; the bound is deliberately generous
// until the dead NDBC proxies leave the critical path (audit C01).
'use strict';

module.exports = {
  name: 'main page: Chocomount auto-selected, forecast chart drawn',
  options: { viewport: { width: 1280, height: 900 } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');

    const sel = await ctx.waitFor(() => STATE.selectedBuoy && STATE.selectedBuoy.home === 'chocomount' && STATE.selectedBuoy.id,
      { label: 'Chocomount auto-selected' });
    assert.equal(sel.value, '44097');
    ctx.metric('timeToSelectMs', sel.ms);

    const chartMs = await ctx.waitForChart();
    ctx.metric('timeToChartMs', chartMs);
    log(`time to chart ${chartMs} ms`);
    assert.ok(chartMs < 45000, `forecast chart took ${chartMs} ms`);

    // The swell panel canvas really has ink on it.
    const inked = await page.evaluate(() => {
      const c = document.getElementById('forecast-canvas-swell');
      if (!c || !c.width || !c.height) return 0;
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4 * 16) if (data[i]) n++;
      return n;
    });
    assert.ok(inked > 100, `swell canvas looks blank (${inked} sampled pixels)`);

    // Chart spans the 7-day fixture, starting on the fixture day.
    const span = await ctx.state(() => ({
      hours: STATE.forecastChart.times.length,
      first: STATE.forecastChart.times[0].toISOString()
    }));
    assert.equal(span.hours, 168);
    assert.equal(span.first, '2026-10-01T04:00:00.000Z');

    const loadMs = await ctx.waitForLoad();
    ctx.metric('timeToLoadCompleteMs', loadMs);
    const header = await page.textContent('#header-update-time');
    assert.match(header, /^Updated /);

    assert.ok(ctx.requestsTo('marine-api.open-meteo.com').length >= 1, 'marine forecast requested');
    assert.ok(ctx.requestsTo('api.tidesandcurrents.noaa.gov').length >= 1, 'tides requested');
    assert.deepEqual([...new Set(ctx.unhandled)], [], 'every external host is routed');
    await ctx.screenshot('forecast');
  }
};
