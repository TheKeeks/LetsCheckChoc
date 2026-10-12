'use strict';
// The Map page: Fishers Island's sea floor from the viewer's own grids (no tile
// service needed), 3D on and off, wave height and swell motion for the forecast
// hour, the parent page's messages, and the compact embed used beside the forecast.
// Esri / NOAA tile hosts are unrouted here (aborted), so this also proves the
// sea floor and forecast layers stand on their own.

module.exports = {
  name: 'Map: own sea-floor tiles, 3D toggle, wave height and swell motion, parent messages',
  options: { viewport: { width: 1100, height: 800 }, timeoutMs: 150000 },
  async run({ page, ctx, assert }) {
    await ctx.open('/map/index.html?3d=1');
    const S = () => page.evaluate(() => ChocMap.getState());
    await ctx.waitFor(() => window.ChocMap && ChocMap.getState().ready, { timeout: 45000, label: 'map ready' });
    await ctx.waitFor(() => ChocMap.getState().tilesServed > 10 && ChocMap.getState().wavesReady && ChocMap.getState().swellTrains > 0, { timeout: 60000, label: 'sea floor, waves and swell' });
    let s = await S();
    assert.equal(s.threeD, true); assert.equal(s.terrain, true);
    assert.ok(s.pitch > 40, '3D opens tilted');
    assert.equal(s.tileErrors, 0, 'every sea-floor tile drew');
    assert.ok(s.steps > 10, 'forecast steps loaded');
    await ctx.screenshot('choc-3d');

    // Depth probe at Choc reef comes from the 2023 lidar / multibeam grids, in the water.
    const probe = await page.evaluate(() => new Promise(resolve => {
      const w = new Worker('bathy-worker.js');
      w.onmessage = e => { if (e.data.id === 1 || e.data.type === 'error') resolve(e.data); };
      w.postMessage({ type: 'sample', id: 1, lon: -71.9634, lat: 41.2745 });
    }));
    assert.ok(probe.h < 0 && probe.h > -15, 'Choc reef is a few meters deep: ' + JSON.stringify(probe));
    assert.match(probe.source, /NOAA/);

    // 3D off: flat map, no terrain, no tilt.
    await page.click('#threeD');
    await ctx.waitFor(() => !ChocMap.getState().terrain && ChocMap.getState().pitch < 1, { timeout: 5000 });
    assert.equal(await page.getAttribute('#threeD', 'aria-checked'), 'false');
    await ctx.screenshot('choc-2d');
    await page.click('#threeD');
    await ctx.waitFor(() => ChocMap.getState().terrain && ChocMap.getState().pitch > 40, { timeout: 5000 });

    // The Race; layers; contours; depth stretch.
    await page.click('[data-view="race"]');
    assert.equal((await S()).view, 'race');
    if (await page.isHidden('#panel')) await page.click('#layersBtn');
    await page.check('[data-layer="rays"]');
    await page.check('[data-layer="contours"]');
    await page.fill('#ex', '6');
    await page.dispatchEvent('#ex', 'input');
    await ctx.waitFor(() => ChocMap.map.getTerrain() && ChocMap.map.getTerrain().exaggeration === 6, { timeout: 3000 });
    await page.uncheck('[data-layer="swell"]');
    assert.equal((await S()).layers.swell, false);
    await page.check('[data-layer="swell"]');
    await page.click('[data-model="ec"]');
    assert.equal((await S()).model, 'ec');
    await page.click('[data-model="gfs"]');

    // Parent messages: hour, theme, inactive.
    const before = (await S()).time;
    const later = await page.evaluate(() => { const st = ChocMap.getState(); return new Date(Date.parse(st.time) + 9 * 3600e3).toISOString(); });
    await page.evaluate(t => ChocMap.receive({ type: 'lcc-map', time: t, theme: 'dark', spot: 'choc' }), later);
    await ctx.waitFor(t => ChocMap.getState().time === t, { arg: later, timeout: 3000 });
    assert.notEqual(before, later);
    s = await S();
    assert.equal(s.theme, 'dark'); assert.equal(s.view, 'choc');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.evaluate(() => ChocMap.receive({ type: 'lcc-map', active: false }));
    assert.equal((await S()).active, false);
    await ctx.screenshot('choc-dark');

    // Compact embed: no time bar (the forecast drives the hour).
    await ctx.open('/map/index.html?embed=1&compact=1&spot=race&theme=light');
    await ctx.waitFor(() => window.ChocMap && ChocMap.getState().ready, { timeout: 45000 });
    assert.equal((await S()).view, 'race');
    assert.equal(await page.isVisible('#timebar'), false);
    await ctx.screenshot('compact-race');
  }
};
