// Default look, Forecast tab, when the Sound Check model can't say what's
// happening now (fixture day, Thu 1 Oct 2026 11:00 ET):
//   • the run that ships with research/ doesn't reach now (its steps are from
//     the 9th): the tab says so and names the run instead of showing an old
//     number as now; the week still draws, the wind and tide still show; the
//     map says it has no model forecast for this hour (no colours, no rays);
//   • the model doesn't load at all: the tab says so, no week; the map says
//     the forecast didn't load;
//   • the bot's live pull on the fc-data branch is newer than the shipped
//     copy: the tab uses it;
//   • Open-Meteo's earlier runs don't load: the buoy check still shows the
//     reading and says the earlier forecasts didn't load.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean forecast fallbacks: run that misses now, no run, newer live pull, earlier forecasts down',
  options: { gate: null, viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  async run({ page, ctx, assert, log }) {
    const boot = async (until, frameNote) => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(until, { label: 'forecast state' });
      await ctx.waitForLoad();
      await page.waitForTimeout(300);
      if (frameNote) await page.frames().find(f => /research\/map\.html/.test(f.url())).waitForFunction(n => window.CHOC && CHOC.trip && CHOC.trip.fc.note === n, frameNote, { timeout: 20000 });
      return ctx.state(() => ({
        info: CLEAN.forecastInfo(),
        head: document.querySelector('#cl-view-forecast .cl-f-head').innerText,
        wkHidden: document.querySelector('#cl-view-forecast .cl-f-wk').hidden,
        cond: document.querySelector('#cl-view-forecast .cl-f-cond').innerText,
        bc: document.querySelector('#cl-view-forecast .cl-f-bc').innerText,
        num: document.querySelector('#cl-view-forecast .cl-f-num') && document.querySelector('#cl-view-forecast .cl-f-num').textContent,
        errors: CLEAN.errors.map(e => e.where + ': ' + e.message)
      }));
    };

    // ── The shipped run (9 Oct) doesn't reach the fixture's now ──
    let r = await boot(() => window.CLEAN && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok' && CLEAN.forecastInfo().map.status === 'ready', 'No model forecast for this hour');
    log('misses now', JSON.stringify(r));
    assert.equal(r.info.step, -1, 'no step for now');
    assert.equal(sp(r.head), 'The Sound Check forecast doesn’t reach now: its newest run is from Fri 3:55 PM.');
    assert.equal(r.num, null, 'no height shown as now');
    assert.equal(r.wkHidden, false, 'the run\'s week still draws');
    const out = await page.frames().find(f => /research\/map\.html/.test(f.url())).evaluate(() => ({ out: CHOC.trip.fc.out, rays: CHOC.trip.fc.rayCount, tags: CHOC.trip.fc.rayTags }));
    assert.deepEqual(out, { out: true, rays: 0, tags: [] }, 'the map says so and draws no forecast');
    assert.match(sp(r.cond), /^Wind 7 mph SW/, 'the wind still shows');
    assert.match(sp(r.cond), /Tide 2\.3 ft ▲/, 'the tide still shows');
    assert.deepEqual(r.errors, []);
    await ctx.screenshot('forecast-misses-now');

    // ── No run at all ──
    ctx.serve('/research/fc/fc.json', null);
    r = await boot(() => window.CLEAN && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'failed' && CLEAN.forecastInfo().map.status === 'failed', 'The forecast didn’t load');
    log('no run', JSON.stringify(r));
    assert.equal(sp(r.head), 'The Sound Check forecast didn’t load.');
    assert.equal(r.wkHidden, true, 'no week without a run');
    assert.match(sp(r.cond), /^Wind 7 mph SW/);
    assert.deepEqual(r.errors, []);

    // ── The live pull is newer than the shipped copy: it wins ──
    const ship = JSON.parse(ctx.fixture('soundcheck/fc.json'));
    const live = JSON.parse(JSON.stringify(ship));
    live.made = '2026-10-01T14:50Z';
    live.gfs.forEach(g => { g.choc = Math.round((g.choc + 2) * 10) / 10; });
    live.ec.forEach(e => { e.choc = Math.round((e.choc + 2) * 10) / 10; });
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(ship) });
    ctx.net.fcLive = () => ({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(live) });
    r = await boot(() => window.CLEAN && CLEAN.forecastInfo && CLEAN.forecastInfo().made === '2026-10-01T14:50Z');
    log('live wins', JSON.stringify(r.info), r.num);
    assert.equal(r.num, '2.5', 'the live pull\'s 2.5 ft, not the shipped 0.5');
    ctx.net.fcLive = 'none';

    // ── Earlier forecasts at the buoy down ──
    ctx.route(/marine-api\.open-meteo\.com\/v1\/marine\?.*previous_day/, route => route.fulfill({ status: 503, body: '', headers: { 'access-control-allow-origin': '*' } }));
    r = await boot(() => window.CLEAN && CLEAN.forecastInfo && CLEAN.forecastInfo().prev === 'failed');
    log('earlier down', r.bc);
    assert.equal(sp(r.bc), 'Buoy 44097 2 ft all waves · 8:30 AM The earlier forecasts didn’t load', 'the reading still shows, and why there is no verdict');
    assert.deepEqual(r.errors, []);
  }
};
