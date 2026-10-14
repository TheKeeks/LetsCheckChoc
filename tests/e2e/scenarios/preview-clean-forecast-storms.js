// Default look, Forecast tab, the map's Ocean view: the storms, on the
// fixture day (Thu 1 Oct 2026, 11:00 ET) with the model run moved there
// (tests/fixtures/soundcheck/fc.json, its field pictures in research/fc/).
// The storm checker is a layer of the Sound Check map (research/map.html,
// "Pressure & storms", on by default), shown zoomed out:
//   • Ocean: the North Atlantic at the tab's hour: GFS-Wave's wave height,
//     GFS's sea-level pressure every 4 hPa, the lows and highs, and each
//     storm's track over the run;
//   • 11 AM: the deepest low in view is the Gulf of Mexico's 985 hPa;
//   • the storms over the run: that Gulf low goes ashore (27°N to 33°N along
//     87°W in a day, 975 hPa at its deepest on the 1° grid), and the North
//     Atlantic low south of Greenland deepens to 952.5 hPa (59°N 34°W);
//     lows that last under a day are left off;
//   • Sat 8 PM (step 20): 954 hPa south of Greenland (58°N 36°W), its seas
//     about 20 ft (red-violet) while the Gulf has gone calm (blue-green);
//   • play steps the tab (and the map with it) through the run, any other
//     move stops it, and it stops at the end of the run;
//   • the layer can be turned off, and is gone near Fishers;
//   • a run without the pressure map still shows the waves and says so; a
//     pressure map that doesn't load says so.
// Expected numbers come from the pressure and wave pictures read in Python
// (numpy over field_gfs_mslp.png and field_gfs_ocean.png), not from the page.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean forecast: the map\'s storms at Ocean zoom (waves, pressure, lows and tracks), play, layer off, no pressure map',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    storage: { local: { 'lcc-f-zoom': 'ocean' } } },   // (seeded before every load: each boot opens on the Ocean view)
  async run({ page, ctx, assert, log }) {
    const FIX = ctx.fixture('soundcheck/fc.json');
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: FIX });
    const mf = () => page.frames().find(f => /research\/map\.html/.test(f.url()));
    const boot = async () => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok' && CLEAN.forecastInfo().map.status === 'ready', { label: 'forecast and its map' });
    };
    // the map at the tab's hour, its storm layer drawn
    const storms = async () => {
      const t = await ctx.state(() => CLEAN.forecastInfo().t);
      await mf().waitForFunction(tt => {
        const f = window.CHOC && CHOC.trip && CHOC.trip.fc; if (!f || !f.d || Date.parse(f.d.gfs[f.i].t) !== tt) return false;
        const s = CHOC.trip._storm(); return s.status !== 'loading' && s.status !== 'idle' && (s.drawn || s.status !== 'ok');
      }, t, { timeout: 20000 });
      return mf().evaluate(() => Object.assign(CHOC.trip._storm(), { note: CHOC.trip.fc.note, W: CHOC.trip.state.cam.W }));
    };
    const read = () => ctx.state(() => ({
      info: CLEAN.forecastInfo(),
      when: document.querySelector('#cl-view-forecast .cl-f-when') && document.querySelector('#cl-view-forecast .cl-f-when').textContent,
      play: document.querySelector('#cl-view-forecast .cl-f-play').getAttribute('aria-pressed'),
      errors: CLEAN.errors.map(e => e.where + ': ' + e.message)
    }));
    // the median colour of a 9×9 patch of the map at a lat/lon (device pixels), clear of the 1 px isobars
    const colourAt = (lat, lon) => mf().evaluate(([la, lo]) => {
      const cv = document.getElementById('tripCv'), p = CHOC.trip._screen(lo, la), k = cv.width / cv.clientWidth;
      const d = cv.getContext('2d').getImageData(Math.round(p[0] * k) - 4, Math.round(p[1] * k) - 4, 9, 9).data, ch = [[], [], []];
      for (let q = 0; q < d.length; q += 4) for (let c = 0; c < 3; c++) ch[c].push(d[q + c]);
      return ch.map(a => a.sort((m, n) => m - n)[40]);
    }, [lat, lon]);

    await boot();

    // ── Ocean at 11 AM ──
    let r = await read(), st = await storms();
    log('11 AM', JSON.stringify(st.drawn), st.status);
    assert.equal(r.info.map.zoom, 'ocean', 'the zoom picked last time');
    assert.equal(await page.getAttribute('#cl-view-forecast .cl-f-zseg button[data-zoom="ocean"]', 'aria-pressed'), 'true');
    assert.ok(st.W > 3000, `the North Atlantic in view (${Math.round(st.W)} km across)`);
    assert.equal(sp(r.when), 'Thu 11 AMnow', 'the headline keeps the hour');
    assert.equal(st.status, 'ok');
    const tr = st.tracks;
    log('tracks', JSON.stringify(tr));
    assert.ok(tr.every(t => t.hours >= 24 && t.min <= 1000), 'only lows that last a day and reach 1000 hPa');
    const gulf = tr.find(t => Math.abs(t.from[1] + 87.5) <= 1.5 && t.from[0] < 30);
    assert.ok(gulf, 'the Gulf low has a track');
    assert.equal(gulf.min, 975);
    assert.ok(Math.abs(gulf.from[0] - 27) <= 1 && Math.abs(gulf.to[0] - 33) <= 1 && gulf.hours === 24, `27°N to 33°N in a day (${JSON.stringify(gulf)})`);
    const green = tr.find(t => t.min === 953);
    assert.ok(green && green.hours >= 96, `the low south of Greenland, 952.5 hPa at its deepest, tracked for days (${JSON.stringify(green)})`);
    let dr = st.drawn;
    assert.ok(dr.isobars > 300, `isobars drawn (${dr.isobars} segments)`);
    assert.ok(dr.highs >= 1, 'a high labelled');
    assert.ok(dr.tracks >= 2, 'the storms\' tracks drawn');
    let deep = dr.lows.slice().sort((a, b) => a.p - b.p)[0];
    assert.equal(deep.p, 985, 'the deepest low in view: 985 hPa');
    assert.ok(Math.abs(deep.lat - 28) <= 1 && Math.abs(deep.lon + 87) <= 1, `in the Gulf of Mexico (${deep.lat}, ${deep.lon})`);
    assert.equal(st.note, '');
    assert.deepEqual(r.errors, []);
    await ctx.screenshot('storms-now');

    // ── Sat 8 PM: the deep low south of Greenland ──
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    await page.keyboard.press('Home');
    for (let k = 0; k < 20; k++) await page.keyboard.press('ArrowRight');
    r = await read();
    assert.equal(r.info.step, 20);
    assert.equal(sp(r.when), 'Sat 8 PM');
    st = await storms();
    log('step 20', JSON.stringify(st.drawn));
    dr = st.drawn;
    deep = dr.lows.slice().sort((a, b) => a.p - b.p)[0];
    assert.equal(deep.p, 954, 'the deepest low: 954 hPa');
    assert.ok(Math.abs(deep.lat - 58) <= 1 && Math.abs(deep.lon + 36) <= 1, `south of Greenland (${deep.lat}, ${deep.lon})`);
    const big = await colourAt(54, -36), calm = await colourAt(25, -85);
    log('colours', JSON.stringify({ big, calm }));
    assert.ok(big[0] > 110 && big[2] > 100 && big[1] < big[0] - 30, `about 20 ft under the low: red-violet (${big})`);
    assert.ok(calm[2] > calm[0] + 30 && calm[1] > calm[0] + 30, `1.6 ft in the Gulf: blue-green (${calm})`);
    await ctx.screenshot('storms-greenland');

    // ── Play: steps on (the map with it); a key stops it; it stops itself at the end ──
    await page.locator('#cl-view-forecast .cl-f-play').click();
    await ctx.waitFor(() => CLEAN.forecastInfo().step >= 22, { label: 'play moves on', timeout: 5000 });
    r = await read();
    assert.equal(r.play, 'true');
    assert.equal(r.info.playing, true);
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    await page.keyboard.press('ArrowLeft');
    r = await read();
    assert.equal(r.info.playing, false, 'a key stops play');
    assert.equal(r.play, 'false');
    const held = r.info.step;
    await page.waitForTimeout(900);
    assert.equal((await read()).info.step, held, 'and the hour stays put');
    st = await storms();
    assert.ok(st.drawn && st.drawn.isobars > 0, 'the map shows the hour play stopped on');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.locator('#cl-view-forecast .cl-f-play').click();
    await ctx.waitFor(() => !CLEAN.forecastInfo().playing, { label: 'play stops at the end', timeout: 5000 });
    r = await read();
    assert.equal(r.info.step, 52, 'the run\'s last step');
    assert.deepEqual(r.errors, []);

    // ── The layer off: no isobars; near Fishers it is gone anyway ──
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();
    await mf().evaluate(() => { document.getElementById('hubLayers').click(); document.querySelector('#fcLayers .hub-tg[data-l="storm"]').click(); });
    await page.waitForTimeout(300);
    st = await mf().evaluate(() => Object.assign(CHOC.trip._storm(), { on: CHOC.trip.fc.show.storm }));
    assert.equal(st.on, false);
    assert.equal(st.drawn, null, 'nothing drawn with the layer off');
    await mf().evaluate(() => { document.querySelector('#fcLayers .hub-tg[data-l="storm"]').click(); document.getElementById('hubLayers').click(); });
    await page.locator('#cl-view-forecast .cl-f-zseg button[data-zoom="fi"]').click();
    await mf().waitForFunction(() => CHOC.trip.state.cam.W < 160, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    assert.equal(await mf().evaluate(() => CHOC.trip._storm().drawn), null, 'near Fishers the storms give way to the rays');
    await page.locator('#cl-view-forecast .cl-f-zseg button[data-zoom="ocean"]').click();

    // ── A run without the pressure map: the waves still show, and it says so ──
    const noP = JSON.parse(FIX); delete noP.mslp;
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(noP) });
    await boot();
    await mf().waitForFunction(() => CHOC.trip.fc.note === 'This forecast run has no pressure map yet', null, { timeout: 20000 });
    st = await mf().evaluate(() => CHOC.trip._storm());
    log('no pressure', JSON.stringify(st));
    assert.equal(st.status, 'none');
    await mf().waitForFunction(() => CHOC.trip.fc.px.gfs_ocean, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    assert.ok((await colourAt(25, -85))[0] > 120, 'the Gulf\'s 10 ft seas still drawn (orange-yellow)');
    await ctx.screenshot('storms-no-pressure');

    // ── A pressure map that doesn't load ──
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: FIX });
    ctx.serve('/research/fc/field_gfs_mslp.png', { status: 404, body: '' });
    await boot();
    await mf().waitForFunction(() => CHOC.trip.fc.note === 'The pressure map didn’t load', null, { timeout: 20000 });
    assert.equal(await mf().evaluate(() => CHOC.trip._storm().status), 'failed');
    assert.deepEqual((await read()).errors, []);
  }
};
