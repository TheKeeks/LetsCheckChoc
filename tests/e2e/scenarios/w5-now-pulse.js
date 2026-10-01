// Audit C36 (web part): the forecast chart's "now" pulse ran a 60 fps
// rAF loop forever, including while the chart was hidden on another tab
// or on a Choc TV panel without the chart. It now draws ~10 frames a
// second, ends while hidden, and comes back on the forecast tab and on
// the kiosk radar panel (whose redraw goes through drawForecastChart).
// Frames are counted with a wrapper, not CPU timings, so CI stays stable.
'use strict';

async function countFrames(page, ctx, ms) {
  await ctx.state(() => { window.__pulseFrames = 0; });
  await page.waitForTimeout(ms);
  return ctx.state(() => window.__pulseFrames);
}

async function wrapPulse(ctx) {
  await ctx.state(() => {
    window.__pulseFrames = 0;
    const draw = _drawNowPulseFrame;
    window._drawNowPulseFrame = function () { window.__pulseFrames++; return draw.apply(this, arguments); };
  });
}

module.exports = {
  name: 'now pulse: ~10 fps, stops while hidden, returns on the forecast tab and kiosk radar',
  options: { device: 'iPad Pro 11 landscape', gate: null },   // kiosk.js seeds the gate itself
  async run({ page, ctx, assert, log }) {
    // ── Choc TV ──
    await ctx.open('/?kiosk=1&kioskRotate=100000');
    await ctx.waitFor(() => document.body.classList.contains('kiosk'), { label: 'body.kiosk' });
    await ctx.waitForChart();
    await ctx.waitForLoad();
    await wrapPulse(ctx);

    await ctx.state(() => kioskShowPanel('days1'));
    await ctx.waitFor(() => _nowPulseRAF === null, { timeout: 3000, label: 'pulse stops on a day panel' });
    assert.equal(await countFrames(page, ctx, 1000), 0, 'no pulse frames behind the day cards');

    await ctx.state(() => kioskShowPanel('radar'));
    await ctx.waitFor(() => _nowPulseRAF !== null, { timeout: 3000, label: 'radar redraw restarts the pulse' });
    const radarFps = (await countFrames(page, ctx, 2000)) / 2;
    ctx.metric('kioskRadarPulseFps', radarFps);
    assert.ok(radarFps >= 2 && radarFps <= 12, `radar pulse ${radarFps} fps`);   // low bound loose: a busy CI box drops frames

    await ctx.state(() => kioskShowPanel('days2'));
    await ctx.waitFor(() => _nowPulseRAF === null, { timeout: 3000, label: 'pulse stops again on days2' });

    // ── Main page (same tab, so the boat gate stays skipped) ──
    await ctx.state(() => sessionStorage.setItem('lcc-gate', 'no'));
    await ctx.open('/');
    await ctx.waitForChart();
    await ctx.waitForLoad();
    await wrapPulse(ctx);
    const fps = (await countFrames(page, ctx, 2000)) / 2;
    ctx.metric('mainPulseFps', fps);
    assert.ok(fps >= 2 && fps <= 12, `main page pulse ${fps} fps`);

    await ctx.state(() => switchTab('surflog'));
    await ctx.waitFor(() => _nowPulseRAF === null, { timeout: 3000, label: 'pulse stops on the Surf Log tab' });
    assert.equal(await countFrames(page, ctx, 1000), 0);

    await ctx.state(() => switchTab('forecast'));
    await ctx.waitFor(() => _nowPulseRAF !== null, { timeout: 3000, label: 'pulse back on the forecast tab' });
    assert.ok((await countFrames(page, ctx, 1000)) >= 2, 'and animating');
  }
};
