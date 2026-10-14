// Default look, first visit on a phone (ported from the classic
// baseline-main-forecast.js and w1-choc-fast-no-proxies.js), against the
// fixtures (Thu 1 Oct 2026, 11:00 ET):
//   • Chocomount (buoy 44097) is picked by itself, the forecast load is done
//     within 3 s and the Sound Check headline (0.5 ft at Choc for 11 AM,
//     tests/fixtures/soundcheck/fc.json) is up within 5 s, with the free NDBC
//     relays dead exactly as in production (allorigins hangs 20 s): Choc's
//     buoy comes from the pipeline's data/buoy.json, so the page never asks a
//     relay or NDBC itself, and a hung relay can't hold the forecast up;
//   • the app's wave forecast under the readings spans the fixture's 168 hours
//     from 4 AM UTC on the fixture day; the page asked Open-Meteo marine and
//     CO-OPS for its data, and every outside address it asked is routed;
//   • the buoy reading is honest about its age: the 8 s+ swell band of the
//     8:30 AM spectrum (1.3 ft @ 9 s SE 124°, 2 ft all waves), marked stale
//     at 2 h 30 min old, and the buoy check says its swell reaches Choc about
//     11:48 AM (buoy obs time + the 50-mile swell travel, not now + travel);
//   • one load at boot, and none of the new look's own code logs an error.
// Load times are saved as metrics (timeToShellMs, timeToSelectMs,
// timeToLoadCompleteMs, timeToHeadlineMs).
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const RELAYS_AND_NDBC = /corsproxy\.io|api\.allorigins\.win|api\.codetabs\.com|www\.ndbc\.noaa\.gov/;

module.exports = {
  name: 'clean boot: Choc picked, forecast and Sound Check headline fast, no NDBC relay, honest buoy reading',
  options: {
    viewport: { width: 390, height: 844 },
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    net: { alloriginsDelayMs: 20000 }             // tripwire: a relay request would hang as in production
  },
  async run({ page, ctx, assert, log }) {
    // The Sound Check model run moved to the fixture day (tests/fixtures/README.md)
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    await ctx.open('/?preview=clean');

    // ── Boot: Choc picked, the load done, the headline up ──
    const shell = await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    const sel = await ctx.waitFor(() => STATE.selectedBuoy && STATE.selectedBuoy.home === 'chocomount' && STATE.selectedBuoy.id,
      { label: 'Chocomount picked', timeout: 15000 });
    const loadMs = await ctx.waitForLoad({ timeout: 15000 });
    const head = await ctx.waitFor(() => {
      const e = document.querySelector('#cl-view-forecast .cl-f-num');
      return CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok' && e && e.textContent;
    }, { label: 'Sound Check headline', timeout: 15000 });
    ctx.metric('timeToShellMs', shell.ms);
    ctx.metric('timeToSelectMs', sel.ms);
    ctx.metric('timeToLoadCompleteMs', loadMs);
    ctx.metric('timeToHeadlineMs', head.ms);
    log(`shell ${shell.ms} ms, Choc picked ${sel.ms} ms, load done ${loadMs} ms, headline ${head.ms} ms`);
    assert.equal(sel.value, '44097', 'Chocomount is buoy 44097');
    assert.ok(loadMs < 3000, `the forecast load took ${loadMs} ms`);
    assert.ok(head.ms < 5000, `the Sound Check headline took ${head.ms} ms`);
    assert.equal(head.value, '0.5', 'the headline: GFS-Wave 0.5 and ECMWF 0.4 ft at Choc for 11 AM');
    assert.equal(sp(await page.textContent('#cl-view-forecast .cl-f-unit')), 'ft at Choc');

    // ── The app's wave forecast under the readings: the fixture's week ──
    const span = await ctx.state(() => ({
      loaded: CLEAN.data.loaded(),
      hours: CLEAN.data.hours().length,
      first: CLEAN.data.timeAt(0) && CLEAN.data.timeAt(0).toISOString(),
      health: STATE.dataHealth,
      dataAsOf: STATE.dataAsOf,
      loads: _loadGen
    }));
    log('span', JSON.stringify(span));
    assert.ok(span.loaded, 'the wave forecast is in');
    assert.equal(span.hours, 168, 'seven days of hours');
    assert.equal(span.first, '2026-10-01T04:00:00.000Z', 'from midnight ET on the fixture day');
    assert.equal(span.health.marine.origin, 'live');
    assert.equal(span.health.buoy.origin, 'pipeline', 'Choc\'s buoy reading comes from data/buoy.json');
    assert.ok(Math.abs(span.dataAsOf - Date.parse('2026-10-01T11:00:00-04:00')) < 60000, 'the data is as of 11:00 AM');
    assert.equal(span.loads, 1, 'one load at boot');

    // ── What the page asked for, and what it never asks ──
    assert.ok(ctx.requestsTo('marine-api.open-meteo.com').length >= 1, 'Open-Meteo marine asked');
    assert.ok(ctx.requestsTo('api.tidesandcurrents.noaa.gov').length >= 1, 'CO-OPS tides asked');
    assert.ok(ctx.requestsTo(/\/data\/buoy\.json$/).length >= 1, 'the pipeline\'s buoy file read');
    assert.deepEqual(ctx.requestsTo(RELAYS_AND_NDBC).map(r => r.url), [], 'no NDBC relay or NDBC request');
    assert.deepEqual([...new Set(ctx.unhandled)], [], 'every outside address is routed');

    // ── The buoy reading: the 8 s+ band, its age and when its swell reaches Choc ──
    const b = await ctx.state(() => {
      const r = CLEAN.data.buoy(), F = CLEAN.fmt;
      return r && { h: r.h, period: Math.round(r.period), dir: Math.round(r.dir), compass: r.compass, band: r.band, total: F.ft(r.total),
        obs: F.time(r.obsAt), ageMin: r.ageMin, level: r.level, reaches: F.time(r.reachesAt) };
    });
    log('buoy', JSON.stringify(b));
    assert.ok(b, 'a buoy reading');
    assert.deepEqual(Object.assign({}, b, { total: sp(b.total), obs: sp(b.obs), reaches: sp(b.reaches) }), {
      h: 1.3, period: 9, dir: 124, compass: 'SE', band: true, total: '2 ft',
      obs: '8:30 AM', ageMin: 150, level: 'stale', reaches: '11:48 AM'
    }, 'the 8 s+ band of the 8:30 AM spectrum, 2 h 30 min old (stale), its swell at Choc about 11:48 AM');
    await ctx.waitFor(() => /ft/.test(document.querySelector('#cl-view-forecast .cl-f-bc').textContent), { label: 'buoy line painted' });
    const line = await ctx.state(() => {
      const st = document.querySelector('#cl-view-forecast .cl-f-bc .cl-stale');
      return { text: document.querySelector('#cl-view-forecast .cl-f-bc .cl-f-bc1').innerText, stale: st && st.textContent };
    });
    log('buoy line', JSON.stringify(line));
    assert.match(sp(line.text), /^Buoy 44097 2 ft all waves · 8:30 AM/);
    assert.equal(sp(line.stale), '8:30 AM', 'the reading\'s time is marked stale');
    await ctx.screenshot('forecast', { fullPage: true });

    await page.locator('#cl-view-forecast .cl-f-bc').click();
    const note = await ctx.waitFor(() => { const e = document.querySelector('#cl-sub-buoycheck .cl-f-sn'); return e && e.textContent; }, { label: 'buoy check sub-page' });
    log('buoy check note', sp(note.value));
    assert.match(sp(note.value), /The latest reading’s swell reaches Choc about 11:48 AM\.$/);
    await page.waitForTimeout(400);   // the sub-page's fade-in
    await ctx.screenshot('buoy-check');
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !document.querySelector('#cl-sub-buoycheck'), { label: 'buoy check closed' });

    assert.deepEqual(await ctx.state(() => CLEAN.errors.map(e => e.where + ': ' + e.message)), [], 'CLEAN.errors');
  }
};
