// Default look, Choc TV (?kiosk=1&preview=clean) on the iPads it may hang
// on, as an iPad browser with touch (Playwright's iPad Pro 11, resized):
// 1024 × 768 (the older 4:3 iPads), 1180 × 820 (iPad Air, the boards' own
// size) and 1366 × 1024 (iPad Pro 12.9), on the fixture day (Thu 1 Oct
// 2026, 11:00 ET, the pinned Sound Check run). The TV is on a wall with
// nobody to scroll it, and plugged in for weeks:
//   • On each panel (the next three days, days four to six, the radar) and
//     on the night version of the first (after sunset it leads with
//     Tomorrow under a "Dark until …" line), nothing runs off the screen
//     sideways or downwards: the page doesn't scroll, no day card cuts a
//     line off, the big numbers sit inside their cards, the radar's readout
//     stays above the week strip at every step of the run, and Next and
//     Sources stay on screen where a finger can tap them.
//   • It doesn't burn the battery: on a day panel nothing moves (no radar
//     playback, the sweep paused, no animation-frame loop, and the old
//     chart's "now" pulse never starts); on the radar the sweep turns and
//     the forecast plays; back on the days it all stops again. Next is
//     tapped, as on the iPad.
// Also records how long the TV takes to load its data (tvTimeToLoadCompleteMs).
'use strict';

const TV = '/?kiosk=1&preview=clean&kioskRotate=600000&kioskRadarStep=600000';
const SIZES = [{ width: 1024, height: 768 }, { width: 1180, height: 820 }, { width: 1366, height: 1024 }];
const PANELS = ['cl-days1', 'cl-days2', 'cl-radar'];
// tv.js measureUnit: one board pixel, held by the screen's height (by its width only when much narrower)
const unit = ({ width, height }) => Math.round(Math.min(height / 820, width / 1180 * 1.1) * 1e4) / 1e4;

// In the page: everything on the panel on show and on the strip that could
// spill, as plain-words problems ([] when it all fits).
function spills({ width: W, height: H }) {
  const out = [], px = Math.round, box = el => el.getBoundingClientRect();
  const say = el => '“' + el.textContent.replace(/\s+/g, ' ').trim() + '”';
  const onScreen = (el, what) => {
    const b = box(el);
    if (b.left < -0.5 || b.top < -0.5 || b.right > W + 0.5 || b.bottom > H + 0.5) out.push(`${what} runs off the screen: [${px(b.left)}, ${px(b.top)}] to [${px(b.right)}, ${px(b.bottom)}]`);
  };
  const fits = (el, what) => {
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push(`${what} spills: ${el.scrollWidth} × ${el.scrollHeight} of content in ${el.clientWidth} × ${el.clientHeight}`);
  };
  const de = document.documentElement, tv = document.getElementById('cl-tv');
  // (an iPad browser lays a wider page out wider and zooms out, which would hide a sideways spill)
  if (de.clientWidth !== W || de.clientHeight !== H) out.push(`the page is laid out ${de.clientWidth} × ${de.clientHeight}, not ${W} × ${H}`);
  fits(de, 'the page');
  onScreen(tv, 'the TV');
  fits(tv, 'the TV');
  const panel = tv.querySelector('.cl-tv-panel.is-on');
  fits(panel, 'the panel');
  if (panel.getAttribute('data-panel') !== 'cl-radar') {
    const banner = panel.querySelector('.cl-tv-banner');
    if (banner && !banner.hidden && banner.scrollWidth > banner.clientWidth + 1) out.push(`the night line is cut: ${say(banner)}`);
    panel.querySelectorAll('.cl-tv-card').forEach(c => {
      const day = c.querySelector('.cl-tv-day').textContent;
      fits(c, day + '’s card');
      onScreen(c, day + '’s card');
      // Each line ends inside its card (a few px into the card's own padding
      // is fine: the fit pass shrinks the text, not the icons beside it).
      const cb = box(c);
      c.querySelectorAll('.cl-tv-day, .cl-tv-hero, .cl-tv-sw, .cl-tv-win, .cl-tv-wd, .cl-tv-sun').forEach(r => {
        const end = box(r).left + r.scrollWidth;
        if (end > cb.right + 0.5) out.push(`${day}: ${say(r)} runs ${px(end - cb.right)} px out of its card`);
      });
      const n = c.querySelector('.cl-tv-num'), nb = n && box(n);
      if (nb && (nb.left < cb.left - 0.5 || nb.right > cb.right + 0.5 || nb.top < cb.top - 0.5 || nb.bottom > cb.bottom + 0.5)) out.push(`${day}: the big number ${say(n)} sticks out of its card`);
    });
  } else {
    const rt = panel.querySelector('.cl-tv-rt'), week = panel.querySelector('.cl-tv-cht svg');
    onScreen(panel.querySelector('.cl-tv-scope'), 'the scope');
    onScreen(week, 'the week strip');
    // The readout at every step of the run (the playback shows them in turn).
    const keep = CLEAN_TV.state().playIdx, n = CLEAN.model.state.steps.length;
    let into = 0, worst = null;
    for (let i = 0; i < n; i++) {
      CLEAN_TV.playAt(i);
      const when = rt.querySelector('.cl-tv-day').textContent.replace(/\s+/g, ' ');
      const over = box(rt).top + rt.scrollHeight - box(week).top;
      if (over > 0.5) { into++; if (!worst || over > worst.over) worst = { over, when }; }
      [...rt.children].forEach(r => { if (box(r).left + r.scrollWidth > W + 0.5) out.push(`the radar readout at ${when}: ${say(r)} runs off the screen`); });
    }
    if (into) out.push(`the radar readout runs ${px(worst.over)} px into the week strip at ${into} of ${n} steps (${worst.when} among them)`);
    if (keep >= 0) CLEAN_TV.playAt(keep);
  }
  const strip = tv.querySelector('.cl-tv-strip');
  fits(strip, 'the status strip');
  const fc = strip.querySelector('.cl-tv-fc');
  if (fc.scrollWidth > fc.clientWidth + 1) out.push(`the forecast age is cut: ${say(fc)}`);
  strip.querySelectorAll('.cl-tv-fc, .cl-tv-by, .cl-tv-ps, .cl-tv-clk, .cl-tv-btn').forEach(el => { if (!el.hidden) onScreen(el, say(el) + ' on the strip'); });
  strip.querySelectorAll('.cl-tv-btn').forEach(b => {
    const r = box(b), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    if (!hit || !b.contains(hit)) out.push(`${say(b)} can’t be tapped: ${hit ? hit.className || hit.tagName : 'nothing'} is on top`);
  });
  return out;
}

module.exports = {
  name: 'clean Choc TV fits 1024×768, 1180×820 and 1366×1024 (day and night) and moves only on the radar',
  options: { device: 'iPad Pro 11 landscape', timeoutMs: 120000 },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    await ctx.open(TV);
    await ctx.waitFor(() => window.CLEAN && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted && window.CLEAN_TV && CLEAN_TV.state().model !== 'loading', { label: 'Choc TV and its forecast' });
    ctx.metric('tvTimeToLoadCompleteMs', await ctx.waitForLoad());
    await ctx.waitFor(() => document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card .cl-tv-win').length === 3, { label: 'three day cards with their tides' });
    assert.equal(await ctx.state(() => CLEAN_TV.state().model), 'ok', 'the Sound Check run is in');

    const problems = [];
    const check = async (vp, label, shoot) => {
      await page.setViewportSize(vp);
      await ctx.waitFor(u => CLEAN_TV.state().u === u, { arg: unit(vp), label: `${label}: the TV takes the new size` });
      for (const p of PANELS) {
        const pr = await ctx.state(name => { CLEAN_TV.show(name); CLEAN_TV.fit(); }, p).then(() => ctx.state(spills, vp));
        const density = await ctx.state(() => document.querySelector('#cl-tv .cl-tv-panel.is-on').getAttribute('data-density'));
        log(label, p, 'density', density, pr.length ? JSON.stringify(pr) : 'fits');
        pr.forEach(x => problems.push(`${label} ${p}: ${x}`));
        if (shoot.includes(p)) { await page.waitForTimeout(700); await ctx.screenshot(`tv-${label}-${p}`); }   // after the cross-fade
      }
    };

    // ── Day: each panel at each size ──
    for (const vp of SIZES) await check(vp, `${vp.width}x${vp.height}`, ['cl-days1', 'cl-radar']);

    // ── Motion: on the day panels nothing moves; on the radar the sweep and the playback ──
    await page.setViewportSize({ width: 1180, height: 820 });
    await ctx.state(() => CLEAN_TV.show('cl-days1'));      // the rotation's own first panel (KIOSK.idx 0)
    // Over one second: animation frames asked for (a loop asks ~60), the CSS
    // animations still running (after the 600 ms cross-fade), the sweep, the playback.
    const motion = () => ctx.state(async () => {
      const raf = window.requestAnimationFrame;
      let asks = 0;
      window.requestAnimationFrame = function (cb) { asks++; return raf.call(window, cb); };
      try { await new Promise(r => setTimeout(r, 1000)); } finally { window.requestAnimationFrame = raf; }
      const sweep = getComputedStyle(document.querySelector('#cl-tv .cl-tv-sweep'));
      return {
        panel: document.getElementById('cl-tv').getAttribute('data-panel'),
        playing: CLEAN_TV.state().playing,
        sweep: sweep.display === 'none' ? 'none' : sweep.animationPlayState,
        running: document.getAnimations().filter(a => a.playState === 'running')
          .map(a => (a.animationName || a.transitionProperty || 'animation') + ' on .' + String(a.effect && a.effect.target && a.effect.target.getAttribute('class')).split(' ')[0]),
        nowPulse: typeof _nowPulseRAF === 'undefined' ? null : _nowPulseRAF,
        frames: asks
      };
    });
    const still = async (want) => {
      const m = await motion();
      log('motion', JSON.stringify(m));
      assert.ok(m.frames < 10, `${want}: no animation-frame loop (${m.frames} frames asked for in a second)`);
      delete m.frames;
      assert.deepEqual(m, { panel: want, playing: false, sweep: 'paused', running: [], nowPulse: null }, `${want}: nothing moves`);
    };
    const next = async (want) => {
      await page.locator('#cl-tv .cl-tv-btn[data-act="next"]').tap();
      await ctx.waitFor(p => document.getElementById('cl-tv').getAttribute('data-panel') === p, { arg: want, label: 'Next → ' + want, timeout: 5000 });
    };
    await still('cl-days1');
    await next('cl-days2');
    await still('cl-days2');
    await next('cl-radar');
    const m = await motion();
    log('motion', JSON.stringify(m));
    assert.ok(m.frames < 10, `the radar: no animation-frame loop either, the sweep is CSS (${m.frames} frames asked for)`);
    delete m.frames;
    assert.deepEqual(m, { panel: 'cl-radar', playing: true, sweep: 'running', running: ['cl-tv-spin on .cl-tv-sweep'], nowPulse: null }, 'the radar: the sweep turns and the forecast plays');
    await next('cl-days1');
    await still('cl-days1');

    // ── Night: after sunset the first panel leads with Tomorrow under the "Dark until …" line ──
    await ctx.waitFor(() => !isDataLoadInFlight(), { label: 'no load in flight' });
    await page.clock.fastForward('09:00:00');                // 8 PM
    await ctx.waitFor(() => !isDataLoadInFlight() && CLEAN.theme() === 'night' &&
      !document.querySelector('#cl-tv [data-panel="cl-days1"] .cl-tv-banner').hidden, { label: 'night: the Dark until line' });
    for (const vp of SIZES) {
      await page.setViewportSize(vp);
      await ctx.waitFor(u => CLEAN_TV.state().u === u, { arg: unit(vp), label: `night ${vp.width}: the TV takes the new size` });
      const pr = await ctx.state(() => { CLEAN_TV.show('cl-days1'); CLEAN_TV.fit(); }).then(() => ctx.state(spills, vp));
      log(`night ${vp.width}x${vp.height}`, pr.length ? JSON.stringify(pr) : 'fits');
      pr.forEach(x => problems.push(`night ${vp.width}x${vp.height} cl-days1: ${x}`));
    }
    await page.waitForTimeout(700);
    await ctx.screenshot('tv-night-1366x1024-cl-days1');

    assert.deepEqual(await ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message)), [], 'no CLEAN.errors');
    // Last, so every other check above has run: everything fits.
    assert.deepEqual(problems, [], 'nothing on Choc TV spills or runs off the screen');
  }
};
