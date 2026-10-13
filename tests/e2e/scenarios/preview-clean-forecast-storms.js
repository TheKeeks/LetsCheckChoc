// Default look, Forecast tab, the map's Storms view, on the fixture day
// (Thu 1 Oct 2026, 11:00 ET) with the model run moved there
// (tests/fixtures/soundcheck/fc.json, its field pictures in research/fc/):
//   • "Storms" turns the ray map into the North Atlantic at the same hour:
//     GFS-Wave's wave height, GFS's sea-level pressure every 4 hPa, the lows
//     and highs, each storm's track over the run; the key replaces the spot
//     switch;
//   • 11 AM: the deepest low in view is the Gulf of Mexico's 985 hPa;
//   • the storms over the run: that Gulf low goes ashore (27°N to 33°N along
//     87°W in a day, 975 hPa at its deepest on the 1° grid), and the North
//     Atlantic low south of Greenland deepens to 952.5 hPa (59°N 34°W);
//     lows that last under a day are left off;
//   • Sat 8 PM (step 20): 954 hPa south of Greenland (58°N 36°W), its seas
//     about 20 ft (red-violet) while the Gulf has gone calm (blue);
//   • play steps through the run, any other move stops it, and it stops at
//     the end of the run;
//   • a run without the pressure map still shows the waves and says so;
//     pictures that don't load say so;
//   • "Swell at Choc" brings the rays and the spot switch back.
// Expected numbers come from the pressure and wave pictures read in Python
// (numpy over field_gfs_mslp.png and field_gfs_ocean.png), not from the page.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean forecast: Storms view (waves, pressure, lows and tracks), play, no pressure map, back to the rays',
  options: { gate: null, viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  async run({ page, ctx, assert, log }) {
    const FIX = ctx.fixture('soundcheck/fc.json');
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: FIX });
    const boot = async () => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok' && CLEAN.forecastInfo().rays > 0, { label: 'model forecast and rays' });
    };
    const read = () => ctx.state(() => {
      const q = s => document.querySelector('#cl-view-forecast ' + s);
      return {
        info: CLEAN.forecastInfo(),
        when: q('.cl-f-when') && q('.cl-f-when').textContent,
        keyHidden: q('.cl-f-key').hidden, spotHidden: q('.cl-f-sseg').hidden,
        key: q('.cl-f-key').innerText,
        pressed: [...document.querySelectorAll('#cl-view-forecast .cl-f-vseg button')].map(b => b.getAttribute('aria-pressed')),
        views: [...document.querySelectorAll('#cl-view-forecast .cl-f-vseg button')].map(b => b.textContent).join(' '),
        play: q('.cl-f-play').getAttribute('aria-pressed'),
        errors: CLEAN.errors.map(e => e.where + ': ' + e.message)
      };
    });
    // the median colour of a 9×9 patch of the map at a lat/lon (device pixels), clear of the 1 px isobars
    const colourAt = (lat, lon) => ctx.state(([la, lo]) => {
      const cv = document.querySelector('#cl-view-forecast .cl-f-map canvas'), f = CLEAN.forecastInfo().storm.drawn.frame;
      const w = cv.clientWidth, h = cv.clientHeight, k = cv.width / w;
      const x = Math.round((lo - f.L) / (f.R - f.L) * w * k), y = Math.round((f.T - la) / (f.T - f.B) * h * k);
      const d = cv.getContext('2d').getImageData(x - 4, y - 4, 9, 9).data, ch = [[], [], []];
      for (let p = 0; p < d.length; p += 4) for (let c = 0; c < 3; c++) ch[c].push(d[p + c]);
      return ch.map(a => a.sort((m, n) => m - n)[40]);
    }, [lat, lon]);

    await boot();

    // ── Storms at 11 AM ──
    await page.locator('#cl-view-forecast .cl-f-vseg button[data-view="storms"]').click();
    await ctx.waitFor(() => CLEAN.forecastInfo().storm.status === 'ok' && CLEAN.forecastInfo().storm.drawn, { label: 'storm maps' });
    let r = await read();
    log('11 AM', JSON.stringify(r.info.storm), r.key);
    assert.equal(r.info.view, 'storms');
    assert.deepEqual(r.pressed, ['false', 'true']);
    assert.equal(sp(r.views), 'Swell at Choc Storms');
    assert.equal(r.keyHidden, false, 'the key shows');
    assert.equal(r.spotHidden, true, 'the spot switch gives way');
    assert.match(sp(r.key), /^Wave height 0 5 10 20\+ ft Lines: sea-level pressure every 4 hPa · L low · H high/);
    assert.equal(sp(r.when), 'Thu 11 AMnow', 'the headline keeps the hour');
    assert.equal(r.info.storm.mslp, true);
    const tr = r.info.storm.tracks;
    log('tracks', JSON.stringify(tr));
    assert.ok(tr.every(t => t.hours >= 24 && t.min <= 1000), 'only lows that last a day and reach 1000 hPa');
    const gulf = tr.find(t => Math.abs(t.from[1] + 87.5) <= 1.5 && t.from[0] < 30);
    assert.ok(gulf, 'the Gulf low has a track');
    assert.equal(gulf.min, 975);
    assert.ok(Math.abs(gulf.from[0] - 27) <= 1 && Math.abs(gulf.to[0] - 33) <= 1 && gulf.hours === 24, `27°N to 33°N in a day (${JSON.stringify(gulf)})`);
    const green = tr.find(t => t.min === 953);
    assert.ok(green && green.hours >= 96, `the low south of Greenland, 952.5 hPa at its deepest, tracked for days (${JSON.stringify(green)})`);
    let dr = r.info.storm.drawn;
    assert.ok(dr.isobars > 300, `isobars drawn (${dr.isobars} segments)`);
    assert.ok(dr.highs >= 1, 'a high labelled');
    let deep = dr.lows.slice().sort((a, b) => a.p - b.p)[0];
    assert.equal(deep.p, 985, 'the deepest low in view: 985 hPa');
    assert.ok(Math.abs(deep.lat - 28) <= 1 && Math.abs(deep.lon + 87) <= 1, `in the Gulf of Mexico (${deep.lat}, ${deep.lon})`);
    assert.equal(r.info.note, '');
    assert.deepEqual(r.errors, []);
    await ctx.screenshot('storms-now');

    // ── Sat 8 PM: the deep low south of Greenland ──
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    await page.keyboard.press('Home');
    for (let k = 0; k < 20; k++) await page.keyboard.press('ArrowRight');
    r = await read();
    log('step 20', JSON.stringify(r.info.storm));
    assert.equal(r.info.step, 20);
    assert.equal(sp(r.when), 'Sat 8 PM');
    dr = r.info.storm.drawn;
    deep = dr.lows.slice().sort((a, b) => a.p - b.p)[0];
    assert.equal(deep.p, 954, 'the deepest low: 954 hPa');
    assert.ok(Math.abs(deep.lat - 58) <= 1 && Math.abs(deep.lon + 36) <= 1, `south of Greenland (${deep.lat}, ${deep.lon})`);
    const big = await colourAt(54, -36), calm = await colourAt(25, -85);
    log('colours', JSON.stringify({ big, calm }));
    assert.ok(big[0] > 110 && big[2] > 120 && big[1] < big[0] - 30, `about 20 ft under the low: red-violet (${big})`);
    assert.ok(calm[2] > calm[0] + 40 && calm[1] > calm[0] + 30, `1.6 ft in the Gulf: blue-green (${calm})`);
    await ctx.screenshot('storms-greenland');

    // ── Play: steps on; a key stops it; it stops itself at the end ──
    await page.locator('#cl-view-forecast .cl-f-play').click();
    await ctx.waitFor(() => CLEAN.forecastInfo().step >= 22, { label: 'play moves on', timeoutMs: 5000 });
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
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.locator('#cl-view-forecast .cl-f-play').click();
    await ctx.waitFor(() => !CLEAN.forecastInfo().playing, { label: 'play stops at the end', timeoutMs: 5000 });
    r = await read();
    assert.equal(r.info.step, 52, 'the run\'s last step');
    assert.deepEqual(r.errors, []);

    // ── Wide screen: the map left of the readout, its header and key full width of it ──
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(400);
    const lay = await ctx.state(() => {
      const R = s => document.querySelector('#cl-view-forecast ' + s).getBoundingClientRect();
      return { map: R('.cl-f-map'), cv: R('.cl-f-map canvas'), key: R('.cl-f-key'), head: R('.cl-f-head') };
    });
    log('wide', JSON.stringify(lay));
    assert.ok(lay.map.right <= lay.head.left, 'map left of the readout');
    assert.ok(lay.cv.width > 600 && Math.abs(lay.key.width - lay.cv.width) < 1 && lay.key.top >= lay.cv.bottom - 1, 'the key under the map');
    await ctx.screenshot('storms-wide');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // ── Back to the swell at Choc ──
    await page.locator('#cl-view-forecast .cl-f-vseg button[data-view="choc"]').click();
    r = await read();
    assert.equal(r.info.view, 'choc');
    assert.ok(r.info.rays > 50, `the rays return (${r.info.rays})`);
    assert.equal(r.keyHidden, true);
    assert.equal(r.spotHidden, false);

    // ── A run without the pressure map: the waves still show, and it says so ──
    const noP = JSON.parse(FIX); delete noP.mslp;
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(noP) });
    await boot();
    await page.locator('#cl-view-forecast .cl-f-vseg button[data-view="storms"]').click();
    await ctx.waitFor(() => CLEAN.forecastInfo().storm.status === 'ok' && CLEAN.forecastInfo().storm.drawn, { label: 'storm maps without pressure' });
    r = await read();
    log('no pressure', JSON.stringify(r.info.storm), r.info.note);
    assert.equal(r.info.storm.mslp, false);
    assert.equal(r.info.storm.drawn.isobars, 0);
    assert.equal(r.info.note, 'This forecast run has no pressure map yet');
    assert.ok((await colourAt(25, -85))[0] > 120, 'the Gulf\'s 10 ft seas still drawn (orange-yellow)');
    await ctx.screenshot('storms-no-pressure');

    // ── Pictures that don't load ──
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: FIX });
    ctx.serve('/research/fc/field_gfs_ocean.png', { status: 404, body: '' });
    ctx.serve('/research/fc/field_gfs_mslp.png', { status: 404, body: '' });
    await boot();
    await page.locator('#cl-view-forecast .cl-f-vseg button[data-view="storms"]').click();
    await ctx.waitFor(() => CLEAN.forecastInfo().storm.status === 'failed', { label: 'storm maps failed' });
    await page.waitForTimeout(100);
    r = await read();
    assert.equal(r.info.note, 'The storm maps didn’t load');
    assert.deepEqual(r.errors, []);
  }
};
