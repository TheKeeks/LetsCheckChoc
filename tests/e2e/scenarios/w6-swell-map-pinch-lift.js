// Sound Check (research/) on a touch screen: pinch to zoom, lift one finger, keep moving the other. The finger
// left on the map carried on as a drag that had no starting point, so the map's position became "not a number":
// the map went dark at any zoom, and zoomed in near Fishers (where the swell lines are drawn) every frame threw
// "TypeError: The provided value is non-finite", which the page's error note showed on an iPhone. The finger
// left on the map now pans from where it is, and a position that isn't a number never reaches the map.
'use strict';

module.exports = {
  name: 'Sound Check on a touch screen: lift one finger of a pinch and the map keeps its place',
  options: { viewport: { width: 393, height: 852 }, contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const cam = () => page.evaluate(() => { const c = window.CHOC.trip.state.cam; return { cx: c.cx, cy: c.cy, W: c.W }; });
    const c0 = await cam();
    const b = await (await page.$('#tripStage canvas')).boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.evaluate(() => { window.__ups = 0; document.querySelector('#tripStage canvas').addEventListener('pointerup', () => window.__ups++); });

    const cdp = await ctx.context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    // two fingers spread apart, zooming in about 5x from the whole region to near Fishers (swell lines on) ...
    await touch('touchStart', [{ x: x - 20, y, id: 1 }, { x: x + 20, y, id: 2 }]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: x - 20 - 9 * i, y, id: 1 }, { x: x + 20 + 9 * i, y, id: 2 }]); await page.waitForTimeout(16); }
    const c1 = await cam(), lx = x - 110;
    // ... then one lifts (Chromium's touch emulation ends just the points named) and the other keeps moving
    await touch('touchEnd', [{ x: x + 110, y, id: 2 }]);
    const ups = await page.evaluate(() => window.__ups);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: lx + 6 * i, y: y + 3 * i, id: 1 }]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(800);
    const c2 = await cam();
    log(`width across: ${c0.W.toFixed(1)} km, pinched ${c1.W.toFixed(1)} km, after one finger panned: ${JSON.stringify(c2)}`);
    if (errors.length) log('page errors: ' + [...new Set(errors)].join(' | '));
    assert.equal(ups, 1, 'one finger lifted, the other still down');
    assert.ok(c1.W < c0.W * 0.4 && c1.W < 320, 'the pinch zoomed in close enough for the swell lines');
    assert.ok([c2.cx, c2.cy, c2.W].every(Number.isFinite), 'the map keeps a real position after one finger lifts');
    assert.ok(Math.abs(c2.W - c1.W) < 1e-6, 'one finger pans, it does not zoom');
    // the finger moved 60 px right and 30 px down, so the map moved with it (about 60 and 30 px of map)
    const sc = Math.min(b.width, b.height) / c2.W;
    assert.ok(Math.abs((c1.cx - c2.cx) * sc - 60) < 8 && Math.abs((c1.cy - c2.cy) * sc - 30) < 8, `the map followed the finger (${((c1.cx - c2.cx) * sc).toFixed(0)}, ${((c1.cy - c2.cy) * sc).toFixed(0)} px)`);
    const lum = await page.evaluate(() => { const c = document.querySelector('#tripStage canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 64) { s += d[i] + d[i + 1] + d[i + 2]; n += 3; } return s / n; });
    assert.ok(lum > 40, `the map is still drawn (brightness ${lum.toFixed(0)}; the empty dark background reads about 22)`);
    assert.equal(await page.evaluate(() => { const n = document.getElementById('scErr'); return !!(n && !n.hidden); }), false, 'no error note on the page');
    await ctx.screenshot('swell-map-pinch-lift');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
