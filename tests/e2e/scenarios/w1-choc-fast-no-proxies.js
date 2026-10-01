// C01 / C03 / C08 / C14 / C30: with the three NDBC relays dead exactly as in
// production (allorigins hanging ~20 s), Chocomount's chart is up within
// 5 s and the page never asks a relay or NDBC for anything. The swell card
// shows the 8 s+ band with the buoy obs time and age, and the header says
// when the data is really from.
'use strict';

module.exports = {
  name: 'Choc: chart within 5 s, zero relay requests, honest swell card',
  options: {
    viewport: { width: 1280, height: 900 },
    net: { alloriginsDelayMs: 20000 }
  },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    const chartMs = await ctx.waitForChart({ timeout: 15000 });
    ctx.metric('timeToChartMs', chartMs);
    log(`time to chart ${chartMs} ms`);
    assert.ok(chartMs < 5000, `forecast chart took ${chartMs} ms`);

    const loadMs = await ctx.waitForLoad({ timeout: 15000 });
    ctx.metric('timeToLoadCompleteMs', loadMs);
    assert.ok(loadMs < 5000, `load took ${loadMs} ms`);

    const relays = ctx.requestsTo(/corsproxy\.io|api\.allorigins\.win|api\.codetabs\.com|www\.ndbc\.noaa\.gov/);
    assert.deepEqual(relays.map(r => r.url), [], 'no NDBC relay / NDBC request');

    const s = await ctx.state(() => ({
      header: document.getElementById('header-update-time').textContent,
      label: document.querySelector('#card-swell .condition-label').textContent,
      height: document.getElementById('val-swell-height').textContent,
      detail: document.getElementById('val-swell-detail').textContent,
      extra: document.getElementById('val-swell-arrival').textContent,
      stale: document.getElementById('card-swell').classList.contains('is-stale'),
      extraColor: getComputedStyle(document.getElementById('val-swell-arrival')).color,
      health: STATE.dataHealth,
      dataAsOf: STATE.dataAsOf,
      spectralBins: STATE.lastSpectral && STATE.lastSpectral.bins.length
    }));
    log(JSON.stringify(s));
    assert.match(s.header, /^Updated 11:00 AM$/);
    assert.equal(s.label, 'Swell 8+ sec: Buoy');   // obs is 2h 30m old
    assert.equal(s.height, '1.3 ft swell');
    assert.equal(s.detail, '9s · SE (124°) · 2.0 ft total');
    assert.match(s.extra, /^Buoy obs 8:30 AM \(2h 30m ago\) · reaches Choc ~11:48 AM$/);
    assert.ok(s.stale, 'amber: obs older than 2 h');
    assert.equal(s.extraColor, 'rgb(184, 122, 46)', 'obs line rendered amber');
    assert.equal(s.health.buoy.origin, 'pipeline');
    assert.equal(s.health.marine.origin, 'live');
    assert.ok(Math.abs(s.dataAsOf - Date.parse('2026-10-01T11:00:00-04:00')) < 60000);
    assert.equal(s.spectralBins, 98);
    assert.deepEqual([...new Set(ctx.unhandled)], [], 'every external host is routed');

    await page.evaluate(() => document.getElementById('conditions-row').scrollIntoView());
    await ctx.screenshot('swell-card');
  }
};
