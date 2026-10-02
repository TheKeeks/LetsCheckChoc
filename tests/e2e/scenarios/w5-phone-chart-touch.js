// Audit C45: on a phone, a vertical swipe over the forecast chart must
// scroll the page and leave the scrubbed hour alone; only a horizontal
// drag scrubs. Before the fix, touchstart jumped the scrubber to the
// finger and touchmove blocked scrolling unconditionally, so the page
// barely moved and a random future hour stuck for the session. The first
// scrub reveals "Reset to now", re-wrapping the detail bar; that and the
// hour's own text re-wrapping resize the chart container, so a
// ResizeObserver redraw re-wires the listeners mid-drag and the gesture
// state has to survive it. At rest the button takes no space (review
// ux#3): reserving it kept the sticky bar at three lines on every visit.
//
// Real touch input goes through CDP Input.dispatchTouchEvent, so the
// browser's own touch-action / scroll handling is exercised.
'use strict';

module.exports = {
  name: 'phone 390x844: vertical swipe over the chart scrolls; horizontal drag scrubs',
  options: {
    viewport: { width: 390, height: 844 },
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
  },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitForChart();
    await ctx.waitForLoad();
    await page.waitForTimeout(800);   // let post-load redraws settle

    // No sideways page scroll at phone width. Compare with the layout
    // width (clientWidth), not innerWidth: under isMobile Chromium grows
    // innerWidth to the content, so `scrollWidth <= innerWidth` always held.
    const widths = await ctx.state(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: document.documentElement.clientWidth }));
    assert.ok(widths.doc <= widths.vw && widths.body <= widths.vw, `horizontal overflow at 390 px: ${JSON.stringify(widths)}`);

    // At rest the readout gets the bar's whole width (no hidden button
    // holding ~60 px at the right edge).
    const rest = await ctx.state(() => {
      const bar = document.getElementById('forecast-detail-bar');
      const row = document.getElementById('forecast-detail-row');
      return { barH: bar.offsetHeight, rowW: row.offsetWidth, barW: bar.clientWidth, resetW: document.getElementById('forecast-reset-now').offsetWidth };
    });
    log('detail bar at rest', JSON.stringify(rest));
    assert.equal(rest.resetW, 0, `Reset to now holds ${rest.resetW} px of the bar at rest`);
    ctx.metric('detailBarRestH', rest.barH);

    const touchAction = await ctx.state(() => getComputedStyle(document.getElementById('forecast-canvas-swell')).touchAction);
    assert.equal(touchAction, 'pan-y pinch-zoom');

    // Count listener re-wires (a ResizeObserver redraw re-runs setupForecastInteraction).
    await ctx.state(() => {
      window.__rewires = 0;
      const orig = setupForecastInteraction;
      window.setupForecastInteraction = function () { window.__rewires++; return orig.apply(this, arguments); };
    });

    const cdp = await ctx.context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    async function swipe(x0, y0, x1, y1, steps = 25, midway) {
      await touch('touchStart', [{ x: x0, y: y0 }]);
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }]);
        if (midway && i === Math.floor(steps / 2)) await midway();
        await page.waitForTimeout(16);
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(700);
    }
    // Puts the swell canvas top at viewport y=100 (canvas is ~294 px tall here).
    async function parkSwellCanvas() {
      await ctx.state(() => {
        resetScrubberToNow();
        const r = document.getElementById('forecast-canvas-swell').getBoundingClientRect();
        window.scrollTo(0, Math.round(r.top + scrollY - 100));
      });
      await page.waitForTimeout(400);
    }
    const snap = () => ctx.state(() => ({
      y: Math.round(scrollY),
      // Viewport top of the swell canvas: what the finger is over. scrollY
      // alone isn't enough, because scroll anchoring shifts it when the
      // detail bar re-wraps above the canvas while the canvas stays put.
      canvasTop: Math.round(document.getElementById('forecast-canvas-swell').getBoundingClientRect().top),
      idx: STATE.scrubberIdx,
      stored: sessionStorage.getItem('lcc-scrubber-hour'),
      reset: getComputedStyle(document.getElementById('forecast-reset-now')).visibility,
      resetW: document.getElementById('forecast-reset-now').offsetWidth,
      rewires: window.__rewires,
      containerH: document.getElementById('forecast-chart-container').offsetHeight
    }));

    // ── (a) vertical swipe on the swell canvas: page scrolls, hour unchanged ──
    await parkSwellCanvas();
    const nowIdx = await ctx.state(() => findHourIndexForTime(Date.now(), STATE.forecastChart));
    const b = await snap();
    assert.equal(b.idx, nowIdx, 'starts at now');
    await swipe(250, 350, 250, 70);
    const a = await snap();
    log('vertical swipe', JSON.stringify(b), '->', JSON.stringify(a));
    assert.ok(a.y - b.y > 150, `page scrolled only ${a.y - b.y} px`);
    assert.equal(a.idx, b.idx, 'scrubbed hour unchanged by a scroll');
    assert.equal(a.stored, null, 'nothing persisted to sessionStorage');
    assert.equal(a.reset, 'hidden');
    assert.equal(a.resetW, 0, 'the hidden Reset to now takes no space at rest (the bar keeps its width for the readout)');

    // ── (b) horizontal drag: scrubs to the finger, page stays put, no re-wire ──
    await parkSwellCanvas();
    const b2 = await snap();
    await swipe(100, 250, 300, 252);
    const a2 = await snap();
    const expectIdx = await ctx.state(x => {
      const cv = document.getElementById('forecast-canvas-swell');
      const cs = STATE.forecastChart, r = cv.getBoundingClientRect();
      const plotW = cv.clientWidth - FC_PAD.left - FC_PAD.right;
      const f = Math.max(0, Math.min(1, (x - r.left - FC_PAD.left) / plotW));
      return findHourIndexForTime(cs.t0 + f * cs.tRange, cs);
    }, 300);
    log('horizontal drag', JSON.stringify(b2), '->', JSON.stringify(a2), 'expect idx', expectIdx);
    assert.ok(Math.abs(a2.idx - expectIdx) <= 1, `scrubbed to ${a2.idx}, finger at ${expectIdx}`);
    assert.ok(a2.idx > b2.idx + 24, 'the drag moved the scrubber forward');
    assert.ok(Math.abs(a2.canvasTop - b2.canvasTop) < 20, `chart moved ${a2.canvasTop - b2.canvasTop} px under the finger during a horizontal drag`);
    assert.ok(a2.stored, 'an intentional scrub persists');
    assert.equal(a2.reset, 'visible', 'Reset to now is shown off-now');
    assert.ok(a2.resetW > 0, 'and laid out once off-now');
    ctx.metric('rewiresDuringDrag', a2.rewires - b2.rewires);
    await ctx.screenshot('after-horizontal-drag');

    // ── (c) a re-wire in the middle of a drag (data refresh, resize) must not lose it ──
    await parkSwellCanvas();
    await swipe(100, 250, 320, 250, 30, () => ctx.state(() => setupForecastInteraction(document.getElementById('forecast-chart-container'))));
    const a3 = await snap();
    const expect3 = await ctx.state(x => {
      const cv = document.getElementById('forecast-canvas-swell');
      const cs = STATE.forecastChart, r = cv.getBoundingClientRect();
      const plotW = cv.clientWidth - FC_PAD.left - FC_PAD.right;
      const f = Math.max(0, Math.min(1, (x - r.left - FC_PAD.left) / plotW));
      return findHourIndexForTime(cs.t0 + f * cs.tRange, cs);
    }, 320);
    assert.ok(a3.rewires > a2.rewires, 'the forced re-wire happened');
    assert.ok(Math.abs(a3.idx - expect3) <= 1, `drag survived the re-wire: idx ${a3.idx}, finger at ${expect3}`);

    // ── (d) a vertical swipe on the short wind canvas scrolls too ──
    await ctx.state(() => resetScrubberToNow());
    const wind = await ctx.state(() => {
      const r = document.getElementById('forecast-canvas-wind').getBoundingClientRect();
      window.scrollTo(0, Math.round(r.top + scrollY - 300));
      return true;
    });
    assert.ok(wind);
    await page.waitForTimeout(400);
    const b4 = await snap();
    await swipe(250, 360, 250, 120);
    const a4 = await snap();
    assert.ok(a4.y - b4.y > 150, `wind canvas swipe scrolled only ${a4.y - b4.y} px`);
    assert.equal(a4.idx, b4.idx);

    // ── (e) a deliberate tap still picks that hour (via the tap's mousedown) ──
    const tapY = await ctx.state(() => {
      const r = document.getElementById('forecast-canvas-wind').getBoundingClientRect();
      return Math.round(r.top + r.height / 2);
    });
    await touch('touchStart', [{ x: 300, y: tapY }]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
    await page.waitForTimeout(500);
    const a5 = await snap();
    const expect5 = await ctx.state(x => {
      const cv = document.getElementById('forecast-canvas-wind');
      const cs = STATE.forecastChart, r = cv.getBoundingClientRect();
      const plotW = cv.clientWidth - FC_PAD.left - FC_PAD.right;
      const f = Math.max(0, Math.min(1, (x - r.left - FC_PAD.left) / plotW));
      return findHourIndexForTime(cs.t0 + f * cs.tRange, cs);
    }, 300);
    assert.ok(Math.abs(a5.idx - expect5) <= 1, `tap scrubbed to ${a5.idx}, expected ${expect5}`);
  }
};
