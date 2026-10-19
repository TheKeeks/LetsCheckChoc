// Default look, Forecast tab: "7 days | 10 days", on the fixture day (Thu 1 Oct 2026, 11:00 ET) with the model run
// moved there and its days 8-10 (tests/fixtures/soundcheck/fc-10d.json: the pinned run plus an `ext` from a real
// 240 h pull, retimed to follow it; its _x pictures in tests/fixtures/soundcheck/fc-x/):
//   • the switch shows when the run has days 8-10; 7 days is the default, and the map downloads nothing for days
//     8-10 until 10 days is picked;
//   • 10 days: the week runs on to 240 h (12 more steps, every 6 h, to Sun 11 Oct 8 AM ET), days 8-10 faded and
//     labelled "trend only", with the wind (GFS-Wave's, past the app's 7-day wind) and the tide (between the high and
//     low times) still under them; their headline says it's a trend and how far apart the models are; the map
//     follows to the last hour, with its days 8-10 pictures;
//   • back to 7 days from day 9: the hour becomes the week's last; the choice is remembered across a reload;
//   • Choc TV's run (core's state.steps) stays the week either way;
//   • wide: the switch is in the dock over the map with Models | Swells, and the chart labels every day;
//   • a run without days 8-10 hides the switch and shows the week, whatever was picked before.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean forecast 10 days: the switch, days 8-10 faded as a trend, the map follows, the week stays the default',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, timeoutMs: 150000 },
  async run({ page, ctx, assert, log }) {
    const FIX = JSON.parse(ctx.fixture('soundcheck/fc-10d.json'));
    let body = JSON.stringify(FIX);
    ctx.serve('/research/fc/fc.json', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body }));
    for (const n of ['field_gfs_reg', 'field_gfs_ocean', 'field_ec_reg', 'field_ec_ocean', 'field_gfs_reg_sw', 'field_gfs_ocean_sw', 'field_gfs_mslp']) {
      ctx.serve(`/research/fc/${n}_x.png`, { status: 200, headers: { 'content-type': 'image/png' }, file: `soundcheck/fc-x/${n}_x.png` });
    }
    const boot = async () => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok', { label: 'model forecast' });
      await ctx.waitFor(() => CLEAN.forecastInfo().map.status === 'ready', { label: 'the map' });
      await page.waitForTimeout(400);
    };
    const info = () => ctx.state(() => CLEAN.forecastInfo());
    const mf = () => page.frames().find(f => /research\/map\.html/.test(f.url()));
    const mapAt = t => mf().waitForFunction(tt => {
      const f = window.CHOC && CHOC.trip && CHOC.trip.fc; return !!(f && f.d && Date.parse(f.d.gfs[f.i].t) === tt);
    }, t, { timeout: 20000 });
    const seg = () => ctx.state(() => {
      const g = document.querySelector('#cl-view-forecast .cl-f-dseg');
      return { hidden: g.hidden, shown: !!g.offsetWidth, pressed: [...g.querySelectorAll('button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent) };
    });
    const xRequests = () => ctx.requestsTo('_x.png').length;
    const last = Date.parse(FIX.ext.gfs[FIX.ext.gfs.length - 1].t), week = Date.parse(FIX.gfs[FIX.gfs.length - 1].t);

    await boot();
    await ctx.waitForLoad();

    // ── 7 days by default; the switch is there; nothing of days 8-10 downloaded ──
    let i = await info();
    assert.equal(i.days, 7, 'the week by default');
    assert.equal(i.steps, FIX.gfs.length);
    assert.deepEqual(await seg(), { hidden: false, shown: true, pressed: ['7 days'] });
    assert.equal(await ctx.state(() => document.querySelectorAll('#cl-view-forecast .cl-f-xr').length), 0, 'no faded days');
    assert.equal(xRequests(), 0, 'no days 8-10 pictures until asked for');

    // ── 10 days ──
    await page.tap('#cl-view-forecast .cl-f-dseg button[data-days="10"]');
    await ctx.waitFor(() => CLEAN.forecastInfo().days === 10, { label: '10 days' });
    i = await info();
    assert.equal(i.steps, FIX.gfs.length + FIX.ext.gfs.length, 'the week and its days 8-10');
    assert.deepEqual((await seg()).pressed, ['10 days']);
    const ch = await ctx.state(() => {
      const svg = document.querySelector('#cl-view-forecast .cl-f-cx svg'), xr = svg.querySelector('.cl-f-xr'), xa = +xr.getAttribute('x');
      const arrows = [...svg.querySelectorAll('.cl-f-wa')].map(a => +/translate\(([\d.]+)/.exec(a.getAttribute('transform'))[1]);
      const tide = svg.querySelector('.cl-f-tide').getAttribute('d').split(/[ML]/).filter(Boolean).map(p => +p.split(',')[0]);
      return { xa, w: +xr.getAttribute('width'), W: +svg.getAttribute('width'), label: (svg.querySelector('.cl-f-xl') || {}).textContent,
        windPast: arrows.filter(x => x > xa).length, tideTo: Math.max(...tide), desc: document.getElementById('cl-f-cxd').textContent,
        days: [...svg.querySelectorAll('.cl-f-dl')].map(t => t.textContent) };
    });
    log('chart', JSON.stringify(ch));
    assert.equal(ch.label, 'trend only');
    assert.ok(ch.xa > ch.W * 0.6 && ch.xa < ch.W * 0.75, 'days 8-10 are the right part of the chart');
    assert.ok(ch.windPast >= 8, 'wind arrows under days 8-10 (GFS-Wave\'s wind)');
    assert.ok(ch.tideTo > ch.xa + 0.75 * ch.w, 'the tide runs on under days 8-10, as far as the high and low times reach');
    assert.match(ch.desc, /Days 8 to 10 are faded: a trend, not a forecast/);
    assert.equal(ch.days.join(' '), 'Thu Fri Sat Sun Mon Tue Wed Thu Fri Sat', 'every day labelled but the run\'s last morning (8 hours), which would crowd Saturday on a phone');
    await ctx.screenshot('10days-chart');

    // the last hour: its headline and the map
    await page.focus('#cl-view-forecast .cl-f-cx');
    await page.keyboard.press('End');
    i = await info();
    assert.equal(i.t, last, 'End: 240 h after the run');
    const head = sp(await page.innerText('#cl-view-forecast .cl-f-head'));
    log('day 10', head);
    assert.match(head, /^Sun 11 Oct, 8\s?AM/, 'the hour');
    assert.match(head, /Days 8–10: a trend, not a forecast · models (agree|\d+\.\d ft apart)/);
    await mapAt(last);
    const m = await mf().evaluate(() => ({ n: CHOC.trip.fc.d.gfs.length, long: !!CHOC.trip.fc.d._long, out: !!CHOC.trip.fc.out }));
    assert.deepEqual(m, { n: FIX.gfs.length + FIX.ext.gfs.length, long: true, out: false }, 'the map has days 8-10 and shows the hour');
    await mf().waitForFunction(() => CHOC.trip._at(-62, 30) !== undefined, null, { timeout: 15000 });
    assert.ok(xRequests() > 0, 'the map read the days 8-10 pictures');
    await ctx.screenshot('10days-last-hour');

    // ── back to 7 days from day 10: the week's last hour; the map goes back to the week ──
    await page.tap('#cl-view-forecast .cl-f-dseg button[data-days="7"]');
    await ctx.waitFor(() => CLEAN.forecastInfo().days === 7, { label: '7 days' });
    i = await info();
    assert.equal(i.steps, FIX.gfs.length);
    assert.equal(i.t, week, 'the week\'s last hour');
    await mapAt(week);
    assert.equal(await mf().evaluate(() => CHOC.trip.fc.d.gfs.length), FIX.gfs.length);

    // ── remembered; Choc TV's run is the week either way ──
    await page.tap('#cl-view-forecast .cl-f-dseg button[data-days="10"]');
    await boot();
    i = await info();
    assert.equal(i.days, 10, 'remembered across a reload');
    assert.equal(i.steps, FIX.gfs.length + FIX.ext.gfs.length);
    assert.equal(await ctx.state(() => CLEAN.model.state.steps.length), FIX.gfs.length, 'core\'s week (Choc TV\'s) is unchanged');
    assert.equal(await ctx.state(() => CLEAN.model.state.ext.length), FIX.ext.gfs.length);

    // ── wide: the switch sits with Models | Swells in the dock over the map ──
    await page.setViewportSize({ width: 1280, height: 860 });
    await boot();
    const wd = await ctx.state(() => {
      const r = s => document.querySelector('#cl-view-forecast ' + s).getBoundingClientRect();
      const wk = r('.cl-f-wk'), d = r('.cl-f-dseg'), v = r('.cl-f-vseg'), svg = document.querySelector('#cl-view-forecast .cl-f-cx svg');
      return { inDock: d.top >= wk.top - 1 && d.bottom <= wk.bottom + 1 && d.left >= wk.left - 1, apart: d.bottom <= v.top + 1 || d.right <= v.left + 1, days: [...svg.querySelectorAll('.cl-f-dl')].length,
        sw: document.documentElement.scrollWidth, vw: innerWidth };
    });
    log('wide', JSON.stringify(wd));
    await ctx.screenshot('10days-wide');
    assert.ok(wd.inDock && wd.apart, 'in the dock, with Models | Swells (beside or above it), not over it');
    assert.equal(wd.days, 11, 'a wide chart has room for the last morning\'s label');
    assert.ok(wd.sw <= wd.vw, 'nothing sideways');

    // ── a run without days 8-10: no switch, the week ──
    const noExt = Object.assign({}, FIX); delete noExt.ext;
    body = JSON.stringify(noExt);
    await boot();
    i = await info();
    assert.equal(i.days, 7, 'nothing to extend');
    assert.equal(i.steps, FIX.gfs.length);
    assert.equal((await seg()).hidden, true, 'no switch');
    assert.equal(await ctx.state(() => document.querySelectorAll('#cl-view-forecast .cl-f-xr').length), 0);
  }
};
