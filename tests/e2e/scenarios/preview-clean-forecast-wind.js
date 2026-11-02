// Default look, Forecast tab: the map's Wind layer, on the fixture day (Thu 1 Oct 2026, 11:00 ET) with the model run
// moved there (tests/fixtures/soundcheck/fc.json; its wind pictures, research/fc/field_gfs_wind_{reg,ocean}.png, are the
// shipped run's, GFS-Wave 2026-10-09 12Z from NOAA's archive):
//   • the map's layers panel has Wind beside Swell motion, on by default; at Region zoom the map is covered in wind
//     arrows (GFS's 10 m wind, one every 50 px or so over the water, none over land);
//   • scrubbing the week moves the wind: the wind read at a point in the open ocean changes between hours;
//   • the switch turns the arrows off, and the choice is remembered (choc.fcLayers);
//   • a pull from before the wind pictures were added (no `wind` in fc.json) has no Wind switch in the week and draws no
//     arrows, with no error.
'use strict';

module.exports = {
  name: 'clean forecast wind: the map\'s Wind layer beside the swell layers, arrows that follow the hour, off and remembered, none for an old pull',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, timeoutMs: 150000 },
  async run({ page, ctx, assert, log }) {
    const FIX = JSON.parse(ctx.fixture('soundcheck/fc.json'));
    let body = JSON.stringify(FIX);
    ctx.serve('/research/fc/fc.json', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body }));
    const boot = async () => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok', { label: 'model forecast' });
      await ctx.waitFor(() => CLEAN.forecastInfo().map.status === 'ready', { label: 'the map' });
      await page.waitForTimeout(400);
    };
    const mf = () => page.frames().find(f => /research\/map\.html/.test(f.url()));
    const layers = () => mf().evaluate(() => [...document.querySelectorAll('#fcLayers .hub-tg')].filter(b => !b.hidden).map(b => b.textContent.trim() + ':' + b.getAttribute('aria-pressed')));
    const OPEN = [-66.5, 38.5];                              // open water south-east of the buoy, inside the regional grid
    const windAt = () => mf().evaluate(([lon, lat]) => CHOC.trip._wind(lon, lat), OPEN);
    const drawn = () => mf().evaluate(() => CHOC.trip._windDrawn());

    await boot();
    // ── the layer: beside the swell layers, on by default; arrows over the water at Region zoom ──
    const L = await layers();
    log('layers', JSON.stringify(L));
    assert.deepEqual(L.slice(0, 4), ['Wave height:true', 'Swell motion:true', 'Wind:true', 'Swell headed our way:true'], 'Wind right after Swell motion, on');
    await mf().waitForFunction(() => CHOC.trip._windDrawn() >= 20, null, { timeout: 20000 }).catch(async (e) => { log('drawn', await drawn()); throw e; });
    const n0 = await drawn();
    let w0 = await windAt();
    log('arrows', n0, 'wind at open water', JSON.stringify(w0));
    assert.ok(n0 >= 20 && n0 <= 400, `arrows over the water (${n0})`);
    assert.ok(w0 && w0[0] >= 0 && w0[0] < 100 && w0[1] >= 0 && w0[1] < 360, 'a wind (knots, from) at open water');
    assert.equal(await mf().evaluate(() => CHOC.trip._wind(-74.0, 40.8)), null, 'none over New Jersey');
    await ctx.screenshot('wind-region');

    // ── the hour moves the wind ──
    await page.focus('#cl-view-forecast .cl-f-cx');
    for (let k = 0; k < 8; k++) await page.keyboard.press('ArrowRight');
    await mf().waitForFunction(([lon, lat, a, b]) => { const w = CHOC.trip._wind(lon, lat); return !!w && (w[0] !== a || w[1] !== b); }, [OPEN[0], OPEN[1], w0[0], w0[1]], { timeout: 15000 });
    const w1 = await windAt();
    log('a day on', JSON.stringify(w1));

    // ── off (the layers panel, ☰): no arrows; remembered across a reload ──
    await mf().evaluate(() => document.getElementById('hubLayers').click());
    await ctx.screenshot('wind-layers');
    await mf().click('#fcLayers button[data-l="wnd"]');
    await mf().waitForFunction(() => CHOC.trip._windDrawn() === 0, null, { timeout: 5000 });
    assert.equal((await layers())[2], 'Wind:false');
    await boot();
    assert.equal((await layers())[2], 'Wind:false', 'remembered');
    assert.equal(await drawn(), 0);
    await mf().evaluate(() => { document.getElementById('hubLayers').click(); document.querySelector('#fcLayers .hub-tg[data-l="wnd"]').click(); document.getElementById('hubLayers').click(); });
    await mf().waitForFunction(() => CHOC.trip._windDrawn() >= 20, null, { timeout: 20000 });

    // ── a pull without wind pictures: no switch in the week, nothing drawn ──
    const old = Object.assign({}, FIX); delete old.wind;
    body = JSON.stringify(old);
    const asked = ctx.requestsTo('field_gfs_wind_').length;
    await boot();
    const L2 = await layers();
    log('old pull', JSON.stringify(L2));
    assert.ok(!L2.some(x => /^Wind:/.test(x)), 'no Wind switch for a pull without wind pictures');
    assert.equal(await drawn(), 0);
    assert.equal(await windAt(), null);
    assert.equal(ctx.requestsTo('field_gfs_wind_').length, asked, 'and it never asks for pictures the pull doesn\'t have');
  }
};
