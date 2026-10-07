// The Swell Map (research/): Drop a wave's 3D view. The whole wave front (a line of rays 30 km wide)
// crossing the sea floor, standing up as tall as the wave is, loaded only when 3D is opened
// (vendor/three.min.js). Where the browser has no WebGL it says so instead of erroring.
'use strict';

module.exports = {
  name: 'Swell Map: 3D wave front over the sea floor in Drop a wave',
  options: { viewport: { width: 1180, height: 820 }, timeoutMs: 240000 },   // software WebGL in CI is slow
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    assert.equal(ctx.requests.filter(r => r.url.includes('three.min.js')).length, 0, '3D library not loaded up front');
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    await page.click('#tripModeSeg button[data-v="drop"]');
    await page.waitForFunction(() => window.CHOC.trip.state.ray && !document.getElementById('cutBox').hidden, null, { timeout: 30000 });
    await page.locator('#cutBox').scrollIntoViewIfNeeded();
    await page.click('#cutView button[data-v="3d"]');
    assert.ok(await page.isVisible('#w3Box'), '3D panel shown');
    assert.ok(!(await page.isVisible('#cutCv')), 'side view hidden');
    await page.waitForFunction(() => window.CHOC.trip.w3.scene || /can.t show/.test(document.getElementById('w3Note').textContent), null, { timeout: 90000 });
    const gl = await page.evaluate(() => { const w = window.CHOC.trip.w3; if (w.scene) { w.play = false; w.follow = false; } return !!w.scene; });   // paused: software WebGL only redraws on change
    log(`WebGL: ${gl}`);
    if (gl) {
      const f = await page.evaluate(() => ({ rays: window.CHOC.trip.w3.front.rays.length, tmax: window.CHOC.trip.w3.front.tmax }));
      assert.ok(f.rays > 150 && f.tmax > 10, `front traced (${f.rays} rays, ${Math.round(f.tmax)} min)`);
      // part-way: the readout reports time and the energy still moving
      await page.evaluate(() => { const w = window.CHOC.trip.w3; w.play = false; w.t = w.front.tmax * 0.5; });
      await page.waitForTimeout(1500);
      const rd = await page.$eval('#w3Read', n => n.textContent);
      log(rd);
      assert.match(rd, /after leaving · energy still moving \d+% of the start · tallest part [\d.]+ ft/);
      await ctx.screenshot('swell-map-3d');
    }
    // back to the side view
    await page.click('#cutView button[data-v="side"]');
    assert.ok(await page.isVisible('#cutCv'), 'side view back');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
