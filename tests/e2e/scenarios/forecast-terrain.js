'use strict';

module.exports = {
  name: 'forecast terrain: shared live forecast, Choc/Race terrain switch, cursor sync and restoration',
  options: { gate: null, viewport: { width: 1360, height: 950 }, firebase: { mode: 'returning_anon', logs: [] } },
  async run({ page, ctx, assert }) {
    // Isolate the parent/child contract from external map APIs and WebGL.
    // The real terrain renderer has its own scenario.
    ctx.serve('/map/index.html', '<!doctype html><html><body><p>Terrain viewer</p><script>window.received=[];addEventListener("message",function(e){if(e.origin===location.origin)received.push(e.data)});parent.postMessage({type:"lcc-map-ready"},location.origin);</script></body></html>');
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready);
    await ctx.waitForChart();
    await page.locator('.cl-f-compare-open').click();
    await ctx.waitFor(() => !!document.querySelector('#cl-sub-forecast-terrain iframe').contentWindow.received);
    assert.equal(await page.locator('#cl-sub-forecast-terrain .cl-f-cx').count(), 1, 'the existing forecast chart is in the comparison');
    assert.equal(await page.locator('#cl-view-forecast .cl-f').count(), 0, 'no duplicated forecast');
    await page.locator('.cl-compare-spot').selectOption('race');
    await ctx.waitFor(() => document.querySelector('.cl-compare-terrain iframe').contentWindow.received.some(m => m.spot === 'race'));
    assert.match(await page.locator('.cl-compare-note').innerText(), /not a calibrated Race/);
    const before = await ctx.state(() => CLEAN.cursor.get());
    await page.locator('#cl-sub-forecast-terrain [data-j="nh"]').click();
    await ctx.waitFor(previous => CLEAN.cursor.get() > previous, { arg: before, timeout: 2000 });
    assert.ok(await ctx.state(() => CLEAN.cursor.get()) > before, 'comparison controls move the shared cursor');
    await ctx.state(() => CLEAN.setThemeMode('dark'));
    await ctx.waitFor(() => document.querySelector('.cl-compare-terrain iframe').contentWindow.received.some(m => m.theme === 'dark'));
    const state = await ctx.state(() => {
      const iframe = document.querySelector('.cl-compare-terrain iframe');
      const message = iframe.contentWindow.received.filter(m => m.forecast).pop();
      const hr = CLEAN.data.hour(CLEAN.cursor.get());
      return { time: message.forecast.time, expected: hr.at.toISOString(), width: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert.equal(state.time, state.expected, 'terrain reads the shared forecast hour');
    assert.ok(state.width <= state.viewport + 1, 'desktop split view fits viewport');
    await ctx.screenshot('split-desktop');
    await page.locator('#cl-sub-forecast-terrain button[aria-label="Back"]').click();
    await ctx.waitFor(() => CLEAN.sub.depth() === 0);
    assert.equal(await page.locator('#cl-view-forecast .cl-f-cx').count(), 1, 'closing restores the original forecast chart');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.cl-f-compare-open').click();
    const mobile = await ctx.state(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobile.width <= mobile.viewport + 1, 'mobile comparison fits viewport');
    await ctx.screenshot('split-phone');
    assert.deepEqual(await ctx.state(() => CLEAN.errors), []);
  }
};
