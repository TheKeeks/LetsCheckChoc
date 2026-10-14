// Default look, the Forecast tab's week scrubber (.cl-f-cx) under a finger on
// a 390×844 phone (ported from the classic w5-phone-chart-touch.js, audit
// C45), against the fixtures (Thu 1 Oct 2026, 11:00 ET; the Sound Check run
// tests/fixtures/soundcheck/fc.json, a step every 3 h for six days, then 6 h):
//   • the scrubber lets the browser pan vertically (touch-action: pan-y), so
//     a vertical swipe over it scrolls the page and leaves the hour on show
//     alone, whether that is now or an hour picked earlier;
//   • a sideways drag picks the hour under the finger: lifted on a step's
//     place on the curve, that step is on show;
//   • the chart stays under the finger during that drag (the classic chart's
//     guarantee: it may not move more than 20 px on screen), even while the
//     swell list above it changes length from hour to hour;
//   • a tap picks the hour at the tap;
//   • nothing pans sideways.
// Where a step sits on screen is read off the drawing itself (the cursor at
// the run's first and last steps; x is linear in time), not from forecast.js.
// Real touch input goes through CDP Input.dispatchTouchEvent, so the
// browser's own touch-action and scrolling are exercised.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const DRAG_FROM = 9, DRAG_TO = 33, TAP_AT = 17;   // Fri 11 AM → Mon 11 AM; Sat 11 AM (3-hour steps)

module.exports = {
  name: 'clean forecast touch: vertical swipe over the week scrolls, sideways drag and tap pick the hour under the finger',
  options: {
    viewport: { width: 390, height: 844 },
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
  },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok', { label: 'model forecast' });
    await ctx.waitForLoad();
    await page.waitForTimeout(800);   // let the post-load paints settle
    const problems = [];              // the hour under the finger and a steady chart: reported together at the end

    const cx = '#cl-view-forecast .cl-f-cx';
    const snap = () => ctx.state(sel => {
      const el = document.querySelector(sel), svg = el.querySelector('svg'), cur = el.querySelector('.cl-f-cur line');
      const i = CLEAN.forecastInfo(), tab = document.querySelector('#cl-app .cl-tabs').getBoundingClientRect();
      return { y: Math.round(scrollY), top: Math.round(el.getBoundingClientRect().top), tabTop: Math.round(tab.top), room: document.documentElement.scrollHeight - innerHeight - scrollY,
        step: i.step, mode: i.mode, curX: cur ? svg.getBoundingClientRect().left + Number(cur.getAttribute('x1')) : null };
    }, cx);
    const label = k => ctx.state(i => { const t = new Date(CLEAN.model.state.steps[i].t); return CLEAN.fmt.day(t) + ' ' + CLEAN.fmt.time(t); }, k).then(sp);

    // ── Static: pan-y, nothing sideways ──
    const statics = await ctx.state(sel => ({ touch: getComputedStyle(document.querySelector(sel)).touchAction, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }), cx);
    assert.equal(statics.touch, 'pan-y', 'the scrubber leaves vertical panning to the browser');
    assert.ok(statics.sw <= statics.vw, `the page scrolls sideways at 390 px (${statics.sw} > ${statics.vw})`);

    // ── Where each step is drawn: the cursor at the first and the last step ──
    await page.locator(cx).focus();
    await page.keyboard.press('Home');
    const s0 = await snap();
    await page.keyboard.press('End');
    const sN = await snap();
    const T = await ctx.state(() => CLEAN.model.state.steps.map(s => s.t));
    assert.deepEqual([s0.step, sN.step], [0, T.length - 1], 'Home and End reach the run\'s ends');
    const xOf = k => s0.curX + (T[k] - T[0]) / (T[T.length - 1] - T[0]) * (sN.curX - s0.curX);
    log(`steps drawn from x=${s0.curX.toFixed(1)} to x=${sN.curX.toFixed(1)}; ${T.length} steps`);
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();
    await ctx.waitFor(() => CLEAN.forecastInfo().mode === 'now', { label: 'back to now' });

    const cdp = await ctx.context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    // Scrubber about 300 px above the page's end, so a swipe has room to scroll it.
    const park = async () => {
      await ctx.state(() => { window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - innerHeight - 300)); });
      await page.waitForTimeout(400);
      const s = await snap();
      assert.ok(s.room >= 200 && s.top + 150 < s.tabTop, `layout changed: no room to swipe (${JSON.stringify(s)})`);
      return s;
    };
    // A finger going from (x0, y0) to (x1, y1) in `steps` moves; `each` runs after every move.
    const swipe = async (x0, y0, x1, y1, each, steps = 25) => {
      await touch('touchStart', [{ x: x0, y: y0 }]);
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }]);
        await page.waitForTimeout(16);
        if (each) await each();
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(700);
    };

    // ── (a) A vertical swipe at now: the page scrolls, the hour stays now ──
    let b = await park();
    await swipe(200, b.top + 120, 200, b.top + 120 - 280);
    let a = await snap();
    log('vertical swipe at now', JSON.stringify(b), '->', JSON.stringify(a));
    ctx.metric('swipeScrollPx', a.y - b.y);
    assert.ok(a.y - b.y > 150, `a vertical swipe over the scrubber scrolled the page only ${a.y - b.y} px`);
    assert.deepEqual([a.step, a.mode], [b.step, 'now'], 'the swipe left the hour on now');

    // ── (b) A sideways drag: lifted on Mon 11 AM's place, Mon 11 AM is on show; the chart stays under the finger ──
    b = await park();
    const fy = b.top + 70, tops = [];
    await swipe(xOf(DRAG_FROM), fy, xOf(DRAG_TO), fy + 2, async () => { tops.push((await snap()).top); });
    a = await snap();
    const shift = Math.max(...tops.map(t => Math.abs(t - b.top)));
    ctx.metric('dragChartShiftPx', shift);
    log('sideways drag', JSON.stringify(b), '->', JSON.stringify(a), '| scrubber top during the drag', Math.min(...tops), '–', Math.max(...tops));
    assert.equal(a.mode, 'pick', 'the drag picked an hour');
    assert.ok(Math.abs(a.step - DRAG_TO) <= 1, `the drag ended on step ${a.step}, nowhere near the finger (step ${DRAG_TO})`);
    if (a.step !== DRAG_TO) {
      problems.push(`drag lifted on ${await label(DRAG_TO)} (finger x=${xOf(DRAG_TO).toFixed(1)}): ${await label(a.step)} is on show, its cursor drawn at x=${a.curX.toFixed(1)}`);
    }
    if (shift >= 20) {
      problems.push(`the chart moved up to ${shift} px under the finger during the drag (its top went ${Math.min(...tops)}–${Math.max(...tops)} px, from ${b.top}; page scroll ${b.y} → ${a.y})`);
    }
    await ctx.screenshot('forecast-after-touch-drag');

    // ── (c) A tap on Sat 11 AM's place picks Sat 11 AM ──
    b = await park();
    await touch('touchStart', [{ x: xOf(TAP_AT), y: b.top + 70 }]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
    await page.waitForTimeout(500);
    a = await snap();
    log('tap', JSON.stringify(a));
    assert.equal(a.mode, 'pick', 'the tap picked an hour');
    assert.ok(Math.abs(a.step - TAP_AT) <= 1, `the tap picked step ${a.step}, nowhere near the finger (step ${TAP_AT})`);
    if (a.step !== TAP_AT) {
      problems.push(`tap on ${await label(TAP_AT)} (finger x=${xOf(TAP_AT).toFixed(1)}): ${await label(a.step)} is on show, its cursor drawn at x=${a.curX.toFixed(1)}`);
    }

    // ── (d) A vertical swipe with an hour picked: the page scrolls, the pick stays ──
    b = await park();
    await swipe(200, b.top + 120, 200, b.top + 120 - 280);
    a = await snap();
    log('vertical swipe with a pick', JSON.stringify(b), '->', JSON.stringify(a));
    assert.ok(a.y - b.y > 150, `a vertical swipe over the scrubber scrolled the page only ${a.y - b.y} px`);
    assert.deepEqual([a.step, a.mode], [b.step, 'pick'], 'the swipe left the picked hour alone');

    assert.deepEqual(await ctx.state(() => CLEAN.errors.map(e => e.where + ': ' + e.message)), [], 'CLEAN.errors');
    assert.deepEqual(problems, [], 'the hour under the finger, on a chart that stays put');
  }
};
