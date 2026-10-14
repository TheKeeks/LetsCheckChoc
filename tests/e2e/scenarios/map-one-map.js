'use strict';
// The Map page (the default look's Explore tab) is one map: it opens on the Sound Check map's Past view
// (research view=map, ui=explore: the forecast is the Forecast tab's) without loading MapLibre; the Sound Check
// map's "3D" button opens the sea floor around Fishers in 3D (Wilderness opens the Fishers view); "← Map" comes back;
// a day sent by the app opens the Sound Check map on that day; without WebGL the 3D map says so and the way back still
// works. Also the default look's Explore tab, which frames this page, and the Forecast tab's map, whose "3D" button
// opens the Explore tab's sea floor at the forecast's hour. The 3D map itself (tiles, terrain, layers) is
// map-terrain.js; the ten years beside the map are preview-clean-explore.js.

module.exports = {
  name: 'Explore: opens on past days, its 3D button opens the sea floor, ← Map, a past day; the Forecast map\'s 3D opens it at that hour; no WebGL',
  // Software WebGL (CI runners, cloud sessions) can take many seconds to build the 3D map; see map-terrain.js.
  options: { viewport: { width: 1100, height: 800 }, timeoutMs: 240000, contextOptions: { reducedMotion: 'reduce' } },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    const S = () => page.evaluate(() => ChocMap.getState());
    const sc = () => page.frame({ url: /research\/index\.html\?view=map/ });
    const open = async (path) => {
      await ctx.open(path);
      await ctx.waitFor(() => window.ChocMap && document.getElementById('explorerFrame').contentWindow.CHOC &&
        document.getElementById('explorerFrame').contentWindow.CHOC.trip && document.getElementById('explorerFrame').contentWindow.CHOC.trip.state.phase === 'past' &&
        document.getElementById('explorerFrame').contentDocument.getElementById('hub3d'), { timeout: 45000, label: 'Sound Check map on past days, with its 3D button' });
    };

    // ── Opens on the Sound Check map's past days; no forecast there; MapLibre isn't loaded ──
    await open('/map/index.html');
    let s = await S();
    log('opened', JSON.stringify(s));
    assert.equal(s.tab, 'explorer');
    assert.match(s.explorer, /^\.\.\/research\/index\.html\?view=map&fill=1&ui=explore&theme=light$/);
    assert.equal(s.seafloor, 'idle');
    assert.equal(await page.evaluate(() => typeof window.maplibregl), 'undefined', 'MapLibre not loaded');
    assert.equal(ctx.requestsTo('maplibre-gl').length, 0, 'not even requested');
    assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('seafloor')).visibility === 'hidden'), '3D pane hidden');
    const views = await sc().evaluate(() => [...document.querySelectorAll('#tripModeSeg button')].filter(b => b.offsetParent !== null).map(b => b.textContent));
    assert.deepEqual(views, ['Past', 'Drop a wave'], 'Past and Drop a wave; the forecast is the Forecast tab\'s');
    const day = await sc().evaluate(() => { const x = CHOC.D[CHOC.st.idx]; return { iso: x.iso, last: CHOC.D[CHOC.D.length - 1].iso }; });
    assert.equal(day.iso, day.last, 'it opens on the newest day of the history');
    const b3 = await sc().evaluate(() => { const b = document.getElementById('hub3d'); return { label: b.getAttribute('aria-label'), text: b.textContent, inColumn: b.parentElement.id }; });
    assert.deepEqual(b3, { label: 'Explore the sea floor around Fishers in 3D', text: '3D', inColumn: 'hubTr' });
    await ctx.screenshot('sound-check-map');

    // ── 3D from a past day: the sea floor at Choc, at the forecast's hour now ──
    await sc().click('#hub3d');
    await ctx.waitFor(() => ChocMap.getState().ready && ChocMap.getState().steps > 10, { timeout: 90000, label: '3D map built' });
    s = await S();
    log('3D', JSON.stringify({ tab: s.tab, view: s.view, time: s.time, step: s.step }));
    assert.equal(s.tab, 'seafloor');
    assert.equal(s.seafloor, 'ok');
    assert.equal(s.view, 'choc', 'Choc');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'back', 'focus on the way back');
    assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('explorer')).visibility === 'hidden'), 'Sound Check map hidden under it');
    await ctx.screenshot('sea-floor-3d');

    // ── ← Map: back to the Sound Check map, as it was ──
    await page.click('#back');
    s = await S();
    assert.equal(s.tab, 'explorer');
    assert.equal(await sc().evaluate(() => CHOC.trip.state.phase), 'past', 'the Sound Check map kept its view');
    assert.equal(await sc().evaluate(() => document.activeElement && document.activeElement.id), 'hub3d', 'focus back on the 3D button');
    assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('seafloor')).visibility === 'hidden'));

    // ── Wilderness on the Sound Check map → the Fishers view in 3D; the 3D map is reused ──
    if (await sc().isHidden('#hubPanel')) await sc().click('#hubLayers');   // open by default on a wide screen
    await sc().click('#fcSpot button[data-v="wild"]');
    await sc().click('#hub3d');
    await ctx.waitFor(() => ChocMap.getState().tab === 'seafloor' && ChocMap.getState().view === 'fishers', { timeout: 10000, label: 'Wilderness in 3D' });
    assert.equal(ctx.requestsTo('maplibre-gl.js').length, 1, 'MapLibre loaded once');
    await page.click('#back');

    // ── A day from the app (Past days) opens the Sound Check map on that day, even from 3D ──
    await sc().click('#hub3d');
    await ctx.waitFor(() => ChocMap.getState().tab === 'seafloor', { timeout: 10000 });
    await page.evaluate(() => ChocMap.receive({ type: 'lcc-map', date: '2023-08-29' }));
    s = await S();
    assert.equal(s.tab, 'explorer', 'the day shows on the Sound Check map');
    await ctx.waitFor(() => { const C = document.getElementById('explorerFrame').contentWindow.CHOC; return C.trip.state.phase === 'past' && C.D[C.st.idx].iso === '2023-08-29'; }, { timeout: 10000, label: 'past day shown' });

    // ── Theme from the app reaches both maps ──
    await page.evaluate(() => ChocMap.receive({ type: 'lcc-map', theme: 'dark' }));
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await ctx.waitFor(() => document.getElementById('explorerFrame').contentDocument.documentElement.dataset.researchTheme === 'dark', { timeout: 5000, label: 'Sound Check map dark' });
    assert.equal((await S()).theme, 'dark');

    // ── The default look's Explore tab frames this page ──
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean look' });
    const label = await page.evaluate(() => document.querySelector('.cl-tab[data-tab="map"]').textContent.trim());
    assert.equal(label, 'Explore', 'the tab is called Explore');
    await page.evaluate(() => CLEAN.show('map'));
    await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); return f && f.contentWindow && f.contentWindow.ChocMap; }, { timeout: 20000, label: 'Explore tab frame' });
    const tab = await page.evaluate(() => { const f = document.querySelector('#cl-view-map iframe'); return { src: f.getAttribute('src'), title: f.title, state: f.contentWindow.ChocMap.getState() }; });
    log('Explore tab', JSON.stringify(tab));
    assert.match(tab.src, /^map\/index\.html\?embed=1&theme=light$/);
    assert.equal(tab.state.tab, 'explorer');
    assert.match(tab.state.explorer, /view=map&fill=1&ui=explore/);
    assert.equal(tab.title, 'Explore: past days, ten years month by month, drop a wave, and the sea floor in 3D');

    // ── The Forecast tab's map: its "3D" button opens the Explore tab's sea floor at the forecast's hour ──
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().map.status === 'ready', { label: 'Forecast tab and its map' });
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowRight');
    const step = await page.evaluate(() => CLEAN.forecastInfo());
    const fm = () => page.frames().find(f => /research\/map\.html/.test(f.url()));
    await fm().waitForFunction(t => Date.parse(CHOC.trip.fc.d.gfs[CHOC.trip.fc.i].t) === t, step.t, { timeout: 10000 });
    await fm().click('#hub3d');
    await ctx.waitFor(() => CLEAN.tab() === 'map', { timeout: 5000, label: 'Explore tab' });
    await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const m = f && f.contentWindow && f.contentWindow.ChocMap; return m && m.getState().ready && m.getState().tab === 'seafloor' && m.getState().steps > 10; }, { timeout: 90000, label: '3D sea floor in Explore' });
    s = await page.evaluate(() => document.querySelector('#cl-view-map iframe').contentWindow.ChocMap.getState());
    log('forecast → 3D', JSON.stringify({ tab: s.tab, view: s.view, time: s.time, step: s.step, tabStep: step.step }));
    assert.equal(Date.parse(s.time), step.t, 'the Forecast tab\'s hour');
    assert.equal(s.step, step.step, 'the same forecast step');
    assert.equal(s.view, 'choc');
    assert.match(await page.evaluate(() => document.querySelector('#cl-view-map iframe').getAttribute('src')), /&show=3d&view=choc&time=/);

    // ── No WebGL: the 3D map says so, and the way back works ──
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, o) { return /webgl/i.test(type) ? null : get.call(this, type, o); };
    });
    await ctx.open('/map/index.html?show=3d');
    await ctx.waitFor(() => window.ChocMap && ChocMap.getState().seafloor === 'failed', { timeout: 10000, label: 'no WebGL' });
    s = await S();
    assert.equal(s.tab, 'seafloor');
    assert.equal(await page.textContent('#status'), 'This browser can’t draw the 3D map (WebGL is off). The Sound Check map still works.');
    assert.equal(await page.isVisible('#back'), true, 'the way back');
    assert.equal(await page.isVisible('#threeD'), false, 'no 3D controls');
    assert.equal(await page.evaluate(() => typeof window.maplibregl), 'undefined', 'MapLibre not even loaded');
    await ctx.screenshot('no-webgl');
    await page.click('#back');
    assert.equal((await S()).tab, 'explorer');
  }
};
