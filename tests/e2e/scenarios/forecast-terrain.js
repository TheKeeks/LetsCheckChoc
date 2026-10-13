'use strict';

module.exports = {
  name: 'Forecast map window: collapsed above This week (no gestures), opens to a live map, follows the forecast hour and theme',
  options: { gate: null, viewport: { width: 1360, height: 950 }, firebase: { mode: 'returning_anon', logs: [] } },
  async run({ page, ctx, assert }) {
    // Isolate the parent/child contract from WebGL; the real map has its own scenario.
    ctx.serve('/map/index.html', '<!doctype html><html><body><p>Map</p><script>window.received=[];addEventListener("message",function(e){if(e.origin===location.origin)received.push(e.data)});parent.postMessage({type:"lcc-map-ready"},location.origin);</script></body></html>');
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready);
    await ctx.waitForChart();
    const last = () => { const f = document.querySelector('.cl-f-map iframe'); const m = (f.contentWindow.received || []).filter(x => x.type === 'lcc-map'); return m[m.length - 1] || {}; };

    // Right above This week, collapsed, loaded because it is on screen, and untouchable.
    const order = await ctx.state(() => { const m = document.querySelector('.cl-f-map'), h = [...document.querySelectorAll('#cl-view-forecast .cl-h2')].find(x => /This week/.test(x.textContent)); return m.nextElementSibling === h; });
    assert.ok(order, 'the map window sits right above This week');
    await ctx.waitFor(() => { const f = document.querySelector('.cl-f-map iframe'); return f.getAttribute('src') && f.contentWindow.received && f.contentWindow.received.length > 0; });
    assert.match(await page.getAttribute('.cl-f-map iframe', 'src'), /ui=peek/);
    const peek = await ctx.state(() => ({ h: document.querySelector('.cl-f-map-win').getBoundingClientRect().height, pe: getComputedStyle(document.querySelector('.cl-f-map iframe')).pointerEvents }));
    assert.ok(peek.h < 200, 'collapsed window is short');
    assert.equal(peek.pe, 'none', 'collapsed map takes no gestures');
    assert.equal((await ctx.state(last)).ui, 'peek');

    // Open: taller, live, told to show its controls.
    await page.locator('.cl-f-map-peek').click();
    await ctx.waitFor(`(${last})().ui === 'full'`, { timeout: 2000 });
    await page.waitForTimeout(300);
    const open = await ctx.state(() => ({ h: document.querySelector('.cl-f-map-win').getBoundingClientRect().height, pe: getComputedStyle(document.querySelector('.cl-f-map iframe')).pointerEvents, ex: document.querySelector('.cl-f-map-tg').getAttribute('aria-expanded') }));
    assert.ok(open.h > 300, 'open window is tall');
    assert.equal(open.pe, 'auto'); assert.equal(open.ex, 'true');

    // The map follows the chart's hour and the theme.
    const before = await ctx.state(() => CLEAN.cursor.get());
    await page.locator('#cl-view-forecast [data-j="nh"]').click();
    await ctx.waitFor(previous => CLEAN.cursor.get() > previous, { arg: before, timeout: 2000 });
    await ctx.waitFor(`(${last})().time === CLEAN.data.hour(CLEAN.cursor.get()).at.toISOString()`, { timeout: 3000, label: 'map follows the hour' });
    // Off screen it pauses (the chart's buttons scrolled it away); back on screen it runs.
    await page.evaluate(() => document.querySelector('.cl-f-map').scrollIntoView({ block: 'center' }));
    await ctx.waitFor(`(${last})().active === true`, { timeout: 3000, label: 'map resumes on screen' });
    await ctx.state(() => CLEAN.setThemeMode('dark'));
    await ctx.waitFor(`(${last})().theme === 'dark'`);
    assert.ok(await ctx.state(() => document.documentElement.scrollWidth <= innerWidth + 1), 'desktop fits');
    await ctx.screenshot('map-open-desktop');

    // Leaving the tab pauses the map; closing returns to the picture.
    await page.locator('.cl-tab[data-tab="log"]').click();
    await ctx.waitFor(`(${last})().active === false`);
    await page.locator('.cl-tab[data-tab="forecast"]').click();
    await page.locator('.cl-f-map-tg').click();
    await ctx.waitFor(`(${last})().ui === 'peek'`);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await ctx.state(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone fits');
    await ctx.screenshot('map-collapsed-phone');
    assert.deepEqual(await ctx.state(() => CLEAN.errors), []);
  }
};
