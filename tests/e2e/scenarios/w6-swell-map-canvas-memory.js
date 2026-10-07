// The Swell Map (research/) on iPhone and iPad: Safari caps the memory all of a page's canvases may use
// together (about 224 MB on an iPhone) and, past that, gives new canvases no drawing context. Chrome has no
// such cap, which is why zooming in turned the map dark on the phone and iPad only: the first zoom starts
// the sea-floor model, which unpacked each of its ~70 images through a new, never-freed canvas, and the
// map's next canvas then failed. This emulates Safari's cap (counting every canvas still sized, as Safari
// does until it frees them) and zooms in on an iPhone-sized screen.
'use strict';

module.exports = {
  name: 'Swell Map: zooming in on an iPhone stays within Safari\'s canvas memory cap',
  options: { device: 'iPhone 13', timeoutMs: 120000 },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const CAP = 224 * 1024 * 1024, size = new Map(), P = HTMLCanvasElement.prototype;
      const W = Object.getOwnPropertyDescriptor(P, 'width'), H = Object.getOwnPropertyDescriptor(P, 'height'), gc = P.getContext;
      const total = () => { let s = 0; for (const v of size.values()) s += v; return s; };
      const track = (c) => { size.set(c, 4 * W.get.call(c) * H.get.call(c)); window.__canvasPeak = Math.max(window.__canvasPeak || 0, total()); };
      Object.defineProperty(P, 'width', { get() { return W.get.call(this); }, set(v) { W.set.call(this, v); track(this); }, configurable: true });
      Object.defineProperty(P, 'height', { get() { return H.get.call(this); }, set(v) { H.set.call(this, v); track(this); }, configurable: true });
      window.__ctx2d = (c) => gc.call(c, '2d');
      window.__canvasList = () => [...size.entries()].filter(([, v]) => v > 1e6).map(([c, v]) => `${W.get.call(c)}x${H.get.call(c)}${c.isConnected ? ' (on page)' : ''}`);              // the test's own read-back, outside the cap
      P.getContext = function (...a) {
        if (!size.has(this)) track(this);
        if (total() > CAP) { window.__canvasRefused = (window.__canvasRefused || 0) + 1; return null; }   // Safari: "Total canvas memory use exceeds the maximum limit"
        return gc.apply(this, a);
      };
    });
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const look = () => page.evaluate(() => {
      const c = document.querySelector('#tripStage canvas'), d = window.__ctx2d(c).getImageData(0, 0, c.width, c.height).data;
      let s = 0, n = 0; for (let i = 0; i < d.length; i += 64) { s += d[i] + d[i + 1] + d[i + 2]; n += 3; }
      return { lum: Math.round(s / n), W: Math.round(window.CHOC.trip.state.cam.W), peakMB: Math.round((window.__canvasPeak || 0) / 1048576), refused: window.__canvasRefused || 0 };
    });
    log('start ' + JSON.stringify(await look()));

    // Pinch in toward Fishers (a two-finger spread), then let the sea-floor model and its images finish loading.
    const b = await (await page.$('#tripStage canvas')).boundingBox(), cdp = await page.context().newCDPSession(page);
    const cx = b.x + b.width * 0.5, cy = b.y + b.height * 0.45, tp = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    for (let k = 0; k < 2; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(20) });
      for (let d = 24; d <= 90; d += 6) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(d) }); await page.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(800);
    }
    await page.waitForFunction(() => window.CHOC.model.ready(), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(12000);                        // the background sea-floor images
    await page.evaluate(() => window.CHOC.trip.state && document.querySelector('#tripStage canvas') && window.dispatchEvent(new Event('resize')));
    await page.mouse.wheel(0, -1);                           // one more redraw
    await page.waitForTimeout(800);
    const z = await look();
    log('zoomed ' + JSON.stringify(z));
    log('canvases over 1 MB: ' + (await page.evaluate(() => window.__canvasList())).join(', '));
    await ctx.screenshot('swell-map-iphone-zoomed');
    assert.ok(z.W < 400, `pinched in (${z.W} km across)`);
    assert.ok(z.peakMB < 150, `canvases stay well under Safari's cap (peak ${z.peakMB} MB)`);
    assert.equal(z.refused, 0, 'no canvas refused');
    assert.ok(z.lum > 60, `map keeps its color zoomed in (brightness ${z.lum})`);
    assert.deepEqual(errors, [], 'no page errors');
  }
};
