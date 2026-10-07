// The Swell Map (research/) on a phone: Safari and every iPhone browser ignore CSS touch-action, so a pinch
// on the map zoomed the whole page (a blurry uniform-blue close-up) instead of the map. The map now cancels
// the browser's own pinch (touchmove with two fingers, WebKit gesture events) and double-tap zoom, but only
// over the map: panels and buttons on top still scroll and tap normally.
'use strict';

module.exports = {
  name: 'Swell Map on a phone: a pinch zooms the map, not the page',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    const r = await page.evaluate(() => {
      const cv = document.querySelector('#tripStage canvas'), b = cv.getBoundingClientRect();
      const T = (el, x, y, id) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });
      const two = [T(cv, b.left + 100, b.top + 100, 1), T(cv, b.left + 200, b.top + 150, 2)];
      const pinch = new TouchEvent('touchmove', { touches: two, targetTouches: two, changedTouches: two, bubbles: true, cancelable: true }); cv.dispatchEvent(pinch);
      const gest = new Event('gesturestart', { bubbles: true, cancelable: true }); cv.dispatchEvent(gest);
      const one = [T(cv, b.left + 50, b.top + 50, 3)], end = () => new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: one, bubbles: true, cancelable: true });
      const e1 = end(); cv.dispatchEvent(e1); const e2 = end(); cv.dispatchEvent(e2);   // a double-tap
      const btn = document.querySelector('#fcZoom button'), bt = [T(btn, 5, 5, 4)];
      const panel = new TouchEvent('touchmove', { touches: bt, targetTouches: bt, changedTouches: bt, bubbles: true, cancelable: true }); btn.dispatchEvent(panel);
      const tapA = new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: bt, bubbles: true, cancelable: true }); btn.dispatchEvent(tapA);
      const tapB = new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: bt, bubbles: true, cancelable: true }); btn.dispatchEvent(tapB);
      return { pinch: pinch.defaultPrevented, gesture: gest.defaultPrevented, dblTapSecond: e2.defaultPrevented, panelMove: panel.defaultPrevented, buttonTaps: tapA.defaultPrevented || tapB.defaultPrevented };
    });
    log(JSON.stringify(r));
    assert.deepEqual(r, { pinch: true, gesture: true, dblTapSecond: true, panelMove: false, buttonTaps: false }, 'page zoom blocked over the map only');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
