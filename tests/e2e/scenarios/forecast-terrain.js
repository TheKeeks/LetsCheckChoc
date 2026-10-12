'use strict';

module.exports = {
  name: 'Forecast + 3D map: in-page split, the map follows the forecast hour and theme, remembered, fits phone and desktop',
  options: { gate: null, viewport: { width: 1360, height: 950 }, firebase: { mode: 'returning_anon', logs: [] } },
  async run({ page, ctx, assert }) {
    // Isolate the parent/child contract from WebGL; the real map has its own scenario.
    ctx.serve('/map/index.html', '<!doctype html><html><body><p>Map</p><script>window.received=[];addEventListener("message",function(e){if(e.origin===location.origin)received.push(e.data)});parent.postMessage({type:"lcc-map-ready"},location.origin);</script></body></html>');
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready);
    await ctx.waitForChart();
    assert.equal(await page.isVisible('.cl-f-map'), false, 'plain forecast by default');
    await page.locator('[data-fmode="split"]').click();
    await ctx.waitFor(() => { const f = document.querySelector('.cl-f-map iframe'); return f && f.contentWindow && f.contentWindow.received && f.contentWindow.received.length > 0; });
    assert.equal(await page.locator('#cl-view-forecast .cl-f-cx').count(), 1, 'the forecast chart stays in place');
    assert.equal(await page.getAttribute('[data-fmode="split"]', 'aria-pressed'), 'true');
    const box = await page.evaluate(() => ({ f: document.querySelector('.cl-f').getBoundingClientRect().toJSON(), m: document.querySelector('.cl-f-map').getBoundingClientRect().toJSON() }));
    assert.ok(box.m.left >= box.f.right - 1, 'map beside the forecast on a wide screen');

    const before = await ctx.state(() => CLEAN.cursor.get());
    await page.locator('#cl-view-forecast [data-j="nh"]').click();
    await ctx.waitFor(previous => CLEAN.cursor.get() > previous, { arg: before, timeout: 2000 });
    const last = () => { const f = document.querySelector('.cl-f-map iframe'), m = f.contentWindow.received.filter(x => x.type === 'lcc-map').pop(); return { time: m.time, expected: CLEAN.data.hour(CLEAN.cursor.get()).at.toISOString(), active: m.active }; };
    await ctx.waitFor(`(${last})().time === (${last})().expected`, { timeout: 3000, label: 'map follows the hour' }).catch(() => null);
    const synced = await ctx.state(last);
    assert.equal(synced.time, synced.expected, 'the map gets the forecast hour');
    assert.equal(synced.active, true);
    await ctx.state(() => CLEAN.setThemeMode('dark'));
    await ctx.waitFor(() => document.querySelector('.cl-f-map iframe').contentWindow.received.some(m => m.theme === 'dark'));
    assert.ok(await ctx.state(() => document.documentElement.scrollWidth <= innerWidth + 1), 'desktop split fits');
    await ctx.screenshot('split-desktop');

    // Leaving the tab pauses the map.
    await page.locator('.cl-tab[data-tab="log"]').click();
    await ctx.waitFor(() => document.querySelector('.cl-f-map iframe').contentWindow.received.slice(-1)[0].active === false);
    await page.locator('.cl-tab[data-tab="forecast"]').click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    const phone = await ctx.state(() => ({ w: document.documentElement.scrollWidth, v: innerWidth, map: document.querySelector('.cl-f-map').getBoundingClientRect().top, f: document.querySelector('.cl-f').getBoundingClientRect().top }));
    assert.ok(phone.w <= phone.v + 1, 'phone split fits');
    assert.ok(phone.map < phone.f, 'map above the forecast on a phone');
    await ctx.screenshot('split-phone');

    // Remembered on the next visit; one click back to the plain forecast.
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready);
    assert.equal(await page.isVisible('.cl-f-map'), true, 'split remembered');
    await page.locator('[data-fmode="list"]').click();
    assert.equal(await page.isVisible('.cl-f-map'), false);
    assert.deepEqual(await ctx.state(() => CLEAN.errors), []);
  }
};
