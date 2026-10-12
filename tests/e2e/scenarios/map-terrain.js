'use strict';
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  name: 'Map terrain: survey geometry, draped layers, tiled zoom, theme and compact embedding',
  options: { viewport: { width: 1100, height: 850 }, timeoutMs: 150000 },
  async run({ page, ctx, assert }) {
    const tile = fs.readFileSync(path.join(__dirname, '../../../research/fr_close.jpg'));
    await ctx.route(/gis\.ngdc\.noaa\.gov|services\.arcgisonline\.com|basemap\.nationalmap\.gov/, async route => {
      await new Promise(resolve => setTimeout(resolve, 120));
      await route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: tile });
    });
    await ctx.open('/map/index.html');
    await page.waitForFunction(() => window.ChocMap && window.ChocMap.getState().ready && window.ChocMap.getState().renderedTriangles > 1000, null, { timeout: 45000 });
    assert.equal(await page.isVisible('#fallback'), false);
    await ctx.screenshot('choc-terrain');
    await page.click('#bathymetryToggle');
    assert.equal(await page.evaluate(() => ChocMap.getState().threeD), false);
    await page.click('#bathymetryToggle');
    await page.click('[data-spot="race"]');
    assert.match(await page.textContent('#placeName'), /The Race/);
    await page.click('#layersToggle');
    await page.check('[data-layer="survey"]');
    // Updating the camera while the first batch is loading must not strand queued tiles.
    await page.click('#zoomIn');
    await page.waitForFunction(() => ChocMap.getState().loadedTiles > 0 && ChocMap.getState().pendingTiles === 0, null, { timeout: 45000 });
    await page.check('[data-layer="field"]');
    await page.waitForFunction(() => ChocMap.getState().fieldReady, null, { timeout: 15000 });
    await page.check('[data-layer="waves"]');
    await page.check('[data-layer="wind"]');
    await page.check('[data-layer="rays"]');
    await page.selectOption('#overlayPosition', 'surface');
    assert.equal(await page.evaluate(() => ChocMap.getState().overlayFollowsTerrain), false);
    await page.selectOption('#overlayPosition', 'floor');
    await page.click('#closeLayers');
    await page.evaluate(() => ChocMap.setTheme('dark'));
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await ctx.screenshot('race-layers-dark');
    const distance = await page.evaluate(() => ChocMap.getState().camera.distance);
    await page.evaluate(() => ChocMap.receive({ type: 'lcc-map', spot: 'race', theme: 'light', forecast: { waveHeight: 3, wavePeriod: 10, waveDirection: 135, windSpeed: 8, windDirection: 310, time: '2026-10-10T12:00:00Z' } }));
    assert.equal(await page.evaluate(() => ChocMap.getState().camera.distance), distance, 'hour changes preserve the camera');
    await page.evaluate(() => ChocMap.receive({ type: 'lcc-map', active: false }));
    assert.equal(await page.evaluate(() => ChocMap.getState().active), false);
    await ctx.open('/map/index.html?compact=1&spot=race&theme=dark');
    await page.waitForFunction(() => window.ChocMap && ChocMap.getState().ready, null, { timeout: 45000 });
    assert.equal(await page.isVisible('.spot-picker'), false, 'parent Forecast location selector is authoritative');
    assert.equal(await page.isVisible('#researchSection'), false);
    await ctx.screenshot('forecast-compact');
  }
};
