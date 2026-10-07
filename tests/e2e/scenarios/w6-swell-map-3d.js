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
      // Follow tracks the part of the front headed for Choc, not the middle of the whole front: as that part
      // lands, the view is over Choc (it used to drift off with the rest of the front)
      const fol = await page.evaluate(async () => {
        const w = window.CHOC.trip.w3, end = w.goal.t + 2;
        w.t = Math.max(0, end - 0.5); w.follow = true;
        for (let i = 0; i < 200; i++) await new Promise((ok) => requestAnimationFrame(ok));
        const v = w.view, r = { goal: w.goal.name, near: w.goal.km, off: Math.hypot(v.tx - w.goal.x, v.tz - w.goal.z), mid: Math.hypot(w.mid ? w.mid[0] - w.goal.x : 0, w.mid ? w.mid[1] - w.goal.z : 0) };
        w.follow = false; return r;
      });
      log(`follow: aimed at ${fol.goal}, closest ray ${fol.near.toFixed(2)} km; view ${fol.off.toFixed(2)} km from it (middle of front ${fol.mid.toFixed(1)} km)`);
      assert.equal(fol.goal, 'Choc', 'follows toward Choc');
      assert.ok(fol.off < 2, `follow view ends over Choc (${fol.off.toFixed(2)} km away)`);
      await ctx.screenshot('swell-map-3d-follow-choc');
      // Fishers jumps in close; a double-tap zooms in further on the spot tapped; one-finger drag moves the view
      await page.click('#w3Fishers');
      await page.waitForTimeout(800);
      const d0 = await page.evaluate(() => window.CHOC.trip.w3.view.dist);
      assert.ok(d0 < 10, `Fishers view is close in (${d0} km)`);
      const bb = await (await page.$('#w3Cv')).boundingBox();
      await page.mouse.dblclick(bb.x + bb.width * 0.5, bb.y + bb.height * 0.6);
      await page.waitForTimeout(800);
      const d1 = await page.evaluate(() => window.CHOC.trip.w3.view.dist);
      log(`double-tap zoom: ${d0} -> ${d1.toFixed(2)} km`);
      assert.ok(d1 < d0 * 0.6, 'double-tap zooms in');
      const t0 = await page.evaluate(() => [window.CHOC.trip.w3.view.tx, window.CHOC.trip.w3.view.tz]);
      await page.mouse.move(bb.x + 200, bb.y + 200); await page.mouse.down(); await page.mouse.move(bb.x + 320, bb.y + 220, { steps: 4 }); await page.mouse.up();
      const t1 = await page.evaluate(() => [window.CHOC.trip.w3.view.tx, window.CHOC.trip.w3.view.tz]);
      assert.ok(Math.hypot(t1[0] - t0[0], t1[1] - t0[1]) > 0.05, 'drag moves the view');
      assert.ok(await page.evaluate(() => window.CHOC.trip.w3.root.scale.y < 0.5), 'stretch eases off close in');
      // the compass: tap faces north
      const cb = await (await page.$('#w3Compass')).boundingBox();
      await page.evaluate(() => { window.CHOC.trip.w3.view.az = 1.2; });
      await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.CHOC.trip.w3.view.az), 0, 'compass tap faces north');
    }
    // back to the side view
    await page.click('#cutView button[data-v="side"]');
    assert.ok(await page.isVisible('#cutCv'), 'side view back');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
