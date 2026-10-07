// The Swell Map (research/): zooming far in on the forecast stops at a few km
// across, where the map still has detail, instead of diving to a blank sea;
// and leaving "Drop a wave" before its wave starts never plays that wave over
// the forecast (its start-up used to finish after the switch and take over).
'use strict';

module.exports = {
  name: 'Swell Map: deep zoom holds detail, Drop a wave never plays over the forecast',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    const T = (fn) => page.evaluate(fn);

    // Wheel far in over the map (a pinch takes the same path).
    for (let i = 0; i < 40; i++) {
      await T(() => {
        const cv = document.querySelector('#tripStage canvas'), b = cv.getBoundingClientRect();
        cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: b.left + b.width * 0.4, clientY: b.top + b.height * 0.4, bubbles: true, cancelable: true }));
      });
    }
    const W = await T(() => window.CHOC.trip.state.cam.W);
    log(`closest forecast zoom: ${W.toFixed(2)} km across`);
    assert.ok(W >= 3 - 1e-9, `forecast zoom stops at 3 km across (got ${W})`);
    await ctx.screenshot('swell-map-deep-zoom');

    // Double-tap on the flat map zooms in there.
    await page.click('#fcZoom button[data-v="reg"]');
    await page.waitForTimeout(500);
    const Wb = await T(() => window.CHOC.trip.state.cam.W), cb = await (await page.$('#tripStage canvas')).boundingBox();
    await page.mouse.dblclick(cb.x + cb.width * 0.4, cb.y + cb.height * 0.5);
    await page.waitForTimeout(400);
    const Wa = await T(() => window.CHOC.trip.state.cam.W);
    log(`double-tap: ${Wb.toFixed(0)} -> ${Wa.toFixed(0)} km across`);
    assert.ok(Wa < Wb * 0.6, 'double-tap zooms the map in');

    // Zoomed in over open water the wave-height color stays (it used to fade out everywhere, leaving the map dark).
    for (let k = 0; k < 3; k++) { await page.mouse.dblclick(cb.x + cb.width * 0.3, cb.y + cb.height * 0.6); await page.waitForTimeout(400); }
    await page.waitForTimeout(600);
    const lum = await T(() => { const c = document.querySelector('#tripStage canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 64) { s += d[i] + d[i + 1] + d[i + 2]; n += 3; } return s / n; });
    log(`zoomed in to ${(await T(() => window.CHOC.trip.state.cam.W)).toFixed(0)} km over open water: mean brightness ${lum.toFixed(0)}`);
    assert.ok(lum > 60, `map keeps its color zoomed in (brightness ${lum.toFixed(0)})`);

    // Drop a wave, then straight back to the forecast while its wave is still starting up.
    await T(() => window.CHOC.trip.setMode('drop'));
    await page.waitForTimeout(4000);
    await page.click('#tripModeSeg button[data-v="week"]');
    await page.waitForTimeout(3000);
    const st = await T(() => ({ phase: window.CHOC.trip.state.phase, playing: !!window.CHOC.trip.state.playing, hud: document.getElementById('tripPhase').textContent }));
    log(`after Drop a wave → Forecast: ${st.phase} · ${st.hud}`);
    assert.equal(st.phase, 'week', 'stays on the forecast');
    assert.equal(st.playing, false, 'no wave animation running');
    assert.match(st.hud, /Choc \d/, 'forecast headline, not the wave tracer');

    // Same for Past.
    await page.click('#tripModeSeg button[data-v="drop"]');
    await page.waitForTimeout(300);
    await page.click('#tripModeSeg button[data-v="past"]');
    await page.waitForTimeout(3000);
    assert.equal(await T(() => window.CHOC.trip.state.phase), 'past', 'stays on Past');
    await ctx.screenshot('swell-map-back-from-drop');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
