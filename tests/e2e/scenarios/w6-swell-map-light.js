// The Sound Check map (research/) loads what it shows, not everything it could show. On the forecast at region
// zoom it used to pull about 10 MB: the wave tracer's depth grids (ocean/atl_depth.png and world_depth.png, about
// 4 MB, used only to trace a wave) and Part 1's ray files (fr/<period>.json, 0.4-0.7 MB each, drawn only zoomed in
// near Fishers) came with the page and with every hour scrubbed. Now:
//   • at region zoom neither is fetched, while the forecast, its colors and its dots are drawn;
//   • zooming in to Fishers fetches the ray files for the hour's swells, and their rays are drawn;
//   • the first tap on the water fetches the depth grids, says "Tracing it into Choc…", then traces the swell in;
//   • scrubbing hours at region zoom fetches no ray files.
// And the map alone (research/map.html, the Forecast tab's map, ?ui=forecast) loads no history (hist.js, 1.4 MB):
// its forecast draws without it, with the tab's controls (no headline, timeline, view, spot or go-to rows, layers
// panel shut) and no page errors.
'use strict';

module.exports = {
  name: 'Sound Check map: depth grids and ray files load only when used',
  options: { viewport: { width: 1180, height: 820 }, contextOptions: { reducedMotion: 'reduce' } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/research/index.html?view=map&fill=1');
    await ctx.waitFor(() => window.CHOC && CHOC.trip && CHOC.trip.fc && CHOC.trip.fc.d && CHOC.trip.state.phase === 'week', { label: 'forecast on the map' });
    await page.click('#fcZoom button[data-v="reg"]');
    await ctx.waitFor(() => { const px = CHOC.trip.fc.px; return !!(px.gfs_reg && px.gfs_ocean && px.gfs_reg_sw && px.gfs_ocean_sw); }, { label: 'forecast fields' });
    await page.waitForTimeout(800);
    const depth = () => ctx.requestsTo(/ocean\/(atl|world)_depth\.png/).length;
    const rays = () => ctx.requestsTo(/\/fr\/\d+\.json/).length;
    log(`region: depth grids ${depth()}, ray files ${rays()}`);
    assert.equal(depth(), 0, 'no depth grids for the forecast at region zoom');
    assert.equal(rays(), 0, 'no ray files at region zoom');
    assert.ok(await ctx.state(() => CHOC.trip._aimed().length >= 0), 'the dots are computed');

    // scrubbing at region zoom: still no ray files
    await ctx.state(() => { for (let i = 0; i < 12; i++) CHOC.trip._week(i); });
    await page.waitForTimeout(600);
    assert.equal(rays(), 0, 'scrubbing at region zoom fetches no ray files');

    // Fishers: the hour's ray files, and the rays drawn
    await page.click('#fcZoom button[data-v="fi"]');
    await ctx.waitFor(() => CHOC.trip.fc.cur.length && CHOC.trip.fc.cur.every((q) => q.rays !== undefined), { label: 'rays for the hour' });
    const got = await ctx.state(() => CHOC.trip.fc.cur.map((q) => (q.rays ? q.rays.length : 0)));
    log(`Fishers: ray files ${rays()}, rays per swell ${JSON.stringify(got)}`);
    assert.ok(rays() >= 1, 'zoomed in, the ray files are fetched');
    assert.ok(got.some((n) => n > 0), 'and the rays are there to draw');
    assert.equal(depth(), 0, 'still no depth grids');

    // a tap on the water: the depth grids load, then the swell is traced in
    await page.click('#fcZoom button[data-v="reg"]');
    await page.waitForTimeout(500);
    const pt = await ctx.state(() => { const b = document.querySelector('#tripStage canvas').getBoundingClientRect(); return { x: b.left + b.width * 0.42, y: b.top + b.height * 0.55 }; });
    await page.mouse.click(pt.x, pt.y);
    const first = await ctx.state(() => { const f = CHOC.trip.fc; return { fan: !!f.fan, searching: !!(f.fan && f.fan.searching), lines: f.pillLines || [] }; });
    log(`right after the tap: ${JSON.stringify(first)}`);
    await ctx.waitFor(() => { const f = CHOC.trip.fc; return f.fan && f.fan.rays.length > 1; }, { label: 'swell traced in', timeout: 20000 });
    assert.ok(depth() >= 2, 'the tap fetched the depth grids');
    const fan = await ctx.state(() => ({ rays: CHOC.trip.fc.fan.rays.length, lines: CHOC.trip.fc.pillLines }));
    log(`traced: ${JSON.stringify(fan)}`);
    assert.ok(fan.rays === 21, 'the swell\'s spread: 21 rays');
    await ctx.screenshot('map-light-traced');

    // ── the map alone: no history, the Forecast tab's controls ──
    const hist0 = ctx.requestsTo('hist.js').length;            // (the full page above loaded it)
    await ctx.open('/research/map.html?view=map&fill=1&ui=forecast');
    await ctx.waitFor(() => window.CHOC && CHOC.trip && CHOC.trip.fc && CHOC.trip.fc.d && CHOC.trip.state.phase === 'week', { label: 'the map alone, on the forecast' });
    await ctx.waitFor(() => CHOC.trip.fc.px.gfs_ocean && CHOC.trip.fc.px.gfs_reg, { label: 'its fields' });
    await page.waitForTimeout(500);
    const alone = await ctx.state(() => {
      const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };   // (and none of its parents hidden)
      return { ui: document.documentElement.dataset.researchUi, title: document.title, days: CHOC.D.length,
        hud: shown('.trip-hud'), view: shown('.hub-view'), spot: shown('.hub-spot'), goto: shown('.hub-goto'), bar: shown('#fcBox .hub-bar'), panel: shown('#hubPanel'),
        key: shown('#fcKey'), layers: shown('#hubLayers'), threeD: shown('#hub3d'), storm: shown('#fcLayers .hub-tg[data-l="storm"]') };
    });
    log('map alone', JSON.stringify(alone), 'hist.js requests', ctx.requestsTo('hist.js').length - hist0);
    assert.equal(ctx.requestsTo('hist.js').length - hist0, 0, 'no history');
    assert.deepEqual(alone, { ui: 'forecast', title: 'Forecast map · LetsCheckChoc', days: 0, hud: false, view: false, spot: false, goto: false, bar: false, panel: false,
      key: true, layers: true, threeD: true, storm: false }, 'the map with the tab\'s controls: layers shut, the key, Layers and 3D buttons');
    await page.click('#hubLayers');
    assert.ok(await ctx.state(() => document.querySelector('#fcLayers .hub-tg[data-l="storm"]').getClientRects().length > 0), 'Layers opens with Pressure & storms in it');
    assert.deepEqual(ctx.pageErrors.map(String), [], 'no page errors');
  }
};
