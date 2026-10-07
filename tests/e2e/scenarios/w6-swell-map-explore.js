// The Swell Map (research/), exploring: wind text carries an arrow pointing
// where the wind blows to; a tap anywhere on the forecast's water traces that
// swell in (not only on the "headed our way" dots); the moving streaks stay on
// when zoomed in to Fishers; and the Past view has wave data across the whole
// North Atlantic, not just the box from New Jersey to Georges Bank.
'use strict';

module.exports = {
  name: 'Swell Map: wind arrows, tap-to-trace, streaks close in, ocean-wide past',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    const T = (fn, a) => page.evaluate(fn, a);

    // Wind in the headline: an arrow turned to where the wind is headed (from + 180).
    const w = await T(() => {
      const t = window.CHOC.trip, g = t.fc.d.gfs[t.fc.i], a = document.querySelector('#tripLine svg.warr');
      return { from: g.wind[1], rot: a ? a.style.transform : null, h: a ? a.getBoundingClientRect().height : 0 };
    });
    log(`headline wind from ${w.from}°: arrow ${w.rot}`);
    assert.equal(w.rot, `rotate(${Math.round((w.from + 180) % 360)}deg)`, 'arrow points where the wind blows to');
    assert.ok(w.h > 4 && w.h < 24, `arrow is text-sized (${w.h}px)`);

    // Zoomed in to Fishers the streaks keep moving.
    await page.click('#fcZoom button[data-v="fi"]');
    await page.waitForTimeout(2500);
    const streak = await T(() => {
      const c = document.querySelectorAll('#tripStage canvas')[1], d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n;
    });
    log(`streak pixels at Fishers zoom: ${streak}`);
    assert.ok(streak > 500, 'streaks drawn when zoomed in');

    // A tap on open water south of Montauk traces that swell (a fan of rays), dot or not.
    await page.click('#fcZoom button[data-v="reg"]');
    await page.waitForTimeout(800);
    const pt = await T(() => {
      const t = window.CHOC.trip, s = t.state.cam, cv = document.querySelector('#tripStage canvas'), b = cv.getBoundingClientRect();
      return { x: b.left + b.width * 0.42, y: b.top + b.height * 0.55, W: s.W };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(600);
    const fan = await T(() => { const f = window.CHOC.trip.fc; return { pick: !!f.pick, fan: !!f.fan, rays: f.fan ? f.fan.rays.length : 0 }; });
    log(`tap: ${JSON.stringify(fan)}`);
    assert.ok(fan.pick && fan.fan && fan.rays > 1, 'tapping water traces that swell in');
    await ctx.screenshot('swell-map-tap-trace');

    // Past: the whole North Atlantic has wave data, e.g. a tap mid-ocean.
    await T(() => window.CHOC.showPast('2022-10-14'));
    await page.click('#fcZoom button[data-v="ocean"]');
    await page.waitForFunction(() => window.CHOC.trip.fc && document.getElementById('tripPhase').textContent.includes('2022'), null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const mid = await T(() => { const b = document.querySelector('#tripStage canvas').getBoundingClientRect(); return { x: b.left + b.width * 0.5, y: b.top + b.height * 0.45 }; });
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(400);
    assert.ok(await T(() => !!window.CHOC.trip.fc.pick), 'mid-Atlantic has past wave data');
    await ctx.screenshot('swell-map-past-ocean');

    // The day card's wind lines carry small arrows too.
    const card = await T(() => { const a = [...document.querySelectorAll('#decDay svg.warr')]; return a.map(x => Math.round(x.getBoundingClientRect().height)); });
    log(`day card arrows: ${card}`);
    assert.ok(card.length >= 1 && card.every(h => h > 4 && h < 24), 'day card wind arrows are text-sized');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
