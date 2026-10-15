// Default look, Forecast tab: the owner's layouts ("Phone C", "Laptop B") and the chart's Models | Swells switch,
// on the fixture day (Thu 1 Oct 2026, 11:00 ET) with the model run moved there (tests/fixtures/soundcheck/fc.json):
//   • phone: the usual column (headline and swells, map, week, wind and tide, buoy check). The map's own full-screen
//     button (⤢, inside the framed research/map.html) opens the tab's full screen: the map frame fills the window,
//     a small card top-left (hour, height, "GFS · ECMWF"), the map's buttons top-right with "Exit full screen", and a
//     dark dock along the bottom with the week, its buttons and the zoom. A sideways drag in the dock moves the hour
//     and the map follows; Back (the iPhone's back swipe) closes it at the same hour, and so does Escape inside the map;
//   • Swells: the same week as a stack of where the swell comes from (SE, E, S, other, in the swell rows' colours),
//     whose top at the cursor is Choc's mean height (the cursor's dot) within a pixel; remembered across a reload;
//   • wide (1280 px): the map spans the content width; the readout is a card over its top-left, the week is docked
//     inside its bottom edge; wind and tide, the buoy check and the source run below it. The map's colour key lifts
//     above the dock. Full screen there too, with a mouse drag in the dock and Back.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const FAM = { E: 'rgb(64, 190, 198)', SE: 'rgb(240, 138, 75)', S: 'rgb(170, 128, 236)', other: 'rgb(140, 154, 168)' };

module.exports = {
  name: 'clean forecast layout: phone full screen with the docked week, wide timeline on the map, Models | Swells chart',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, timeoutMs: 150000 },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    const boot = async () => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok', { label: 'model forecast' });
      await ctx.waitFor(() => CLEAN.forecastInfo().map.status === 'ready', { label: 'the map' });
    };
    await boot();
    await ctx.waitForLoad();
    await page.waitForTimeout(500);

    const info = () => ctx.state(() => CLEAN.forecastInfo());
    const mf = () => page.frames().find(f => /research\/map\.html/.test(f.url()));
    const mapAt = t => mf().waitForFunction(tt => {
      const f = window.CHOC && CHOC.trip && CHOC.trip.fc; return !!(f && f.d && Date.parse(f.d.gfs[f.i].t) === tt);
    }, t, { timeout: 20000 });
    const R = () => ctx.state(() => {
      const r = s => { const e = document.querySelector('#cl-view-forecast ' + s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      return { vw: innerWidth, vh: innerHeight, view: r(''), map: r('.cl-f-map'), frame: r('.cl-f-frame'), head: r('.cl-f-head'), wk: r('.cl-f-wk'), cx: r('.cl-f-cx'), side: r('.cl-f-side'),
        ctl: r('.cl-f-ctl'), dz: r('.cl-f-dz'), vseg: r('.cl-f-vseg'), mbar: r('.cl-f-mbar'),
        hist: history.state, card: sp(document.querySelector('#cl-view-forecast .cl-f-head').textContent), sw: document.documentElement.scrollWidth };
      function sp(s) { return (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim(); }
    });
    const frameFull = () => mf().evaluate(() => {
      const b = document.getElementById('hubFull'), st = getComputedStyle(document.documentElement), key = document.getElementById('fcKey');
      return { shown: !!(b && b.offsetWidth), label: b && b.getAttribute('aria-label'), pressed: b && b.getAttribute('aria-pressed'), max: document.getElementById('tripStage').classList.contains('hub-max'),
        bot: st.getPropertyValue('--lcc-fc-bot').trim(), top: st.getPropertyValue('--lcc-fc-top').trim(), keyBottom: key ? Math.round(innerHeight - key.getBoundingClientRect().bottom) : null };
    });
    const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`);

    // ── Phone, normal layout: as before, plus the chart's Models | Swells switch (Models by default) ──
    let i0 = await info();
    assert.equal(i0.layout, 'phone');
    assert.equal(i0.view, 'models', 'Models by default');
    assert.equal(i0.full, false);
    let L = await R();
    assert.ok(L.map.t > L.head.b - 1 && L.wk.t > L.map.b - 1 && L.side.t > L.wk.b - 1, 'one column: headline, map, week, then wind, tide and buoy');
    assert.ok(await ctx.state(() => document.querySelectorAll('#cl-view-forecast .cl-f-gfs').length > 0 && document.querySelectorAll('#cl-view-forecast .cl-f-sb').length === 0), 'Models: the model lines, no stack');
    assert.equal(sp(await page.innerText('#cl-view-forecast .cl-f-lgd')), 'GFS-Wave ECMWF mean');
    assert.match(await ctx.state(() => document.getElementById('cl-f-cxd').textContent), /GFS-Wave solid orange, ECMWF dashed blue/, 'the chart says what it draws');
    let F = await frameFull();
    assert.equal(F.shown, true, 'the map shows its full-screen button');
    assert.equal(F.label, 'Full screen');
    await ctx.screenshot('layout-phone', { fullPage: true });

    // ── Phone full screen: the map's ⤢ ──
    await mf().click('#hubFull');
    await ctx.waitFor(() => CLEAN.forecastInfo().full, { label: 'full screen', timeout: 5000 });
    await page.waitForTimeout(400);
    L = await R();
    log('phone full', JSON.stringify(L));
    near(L.frame.l, 0, 1, 'the map frame fills the window: left');
    near(L.frame.t, 0, 1, 'top');
    near(L.frame.w, L.vw, 1, 'width');
    near(L.frame.h, L.vh, 1, 'height');
    assert.ok(L.head.l < 40 && L.head.t < 40 && L.head.r < L.vw - 60 && L.head.h < 160, 'a small card at the top left');
    assert.match(L.card, /^Thu 11 AM ?now ?0\.5 ?ft at Choc ?GFS 0\.5 · ECMWF 0\.4$/, `the card: hour, height, models (${L.card})`);
    near(L.wk.b, L.vh, 1, 'the dock sits on the bottom edge');
    near(L.wk.l, 0, 1, 'and spans the width');
    near(L.wk.r, L.vw, 1, 'and spans the width');
    assert.ok(L.wk.t > L.vh / 2, 'the dock keeps to the bottom half');
    assert.ok(L.cx.t >= L.wk.t && L.ctl.t >= L.cx.b - 1 && L.dz.t >= L.ctl.b - 1 && L.dz.b <= L.wk.b, 'the week, then its buttons, then the zoom');
    assert.ok(L.dz.h > 0 && L.vseg.t >= L.ctl.b - 1, 'zoom and the chart switch at the bottom');
    assert.equal(L.hist && L.hist.clFull, 1, 'one history entry');
    F = await frameFull();
    assert.deepEqual([F.label, F.pressed, F.max], ['Exit full screen', 'true', false], 'the map\'s button says Exit full screen; the map does not maximize inside its frame');
    assert.ok(parseFloat(F.bot) > 100 && F.keyBottom > parseFloat(F.bot), `the colour key lifts above the dock (${F.bot}, key ${F.keyBottom} px up)`);
    assert.ok(L.sw <= L.vw, 'nothing sideways');
    await ctx.screenshot('layout-phone-full');

    // a sideways drag in the dock picks the hour under the finger, and the map follows
    const cdp = await ctx.context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const y = L.cx.t + 40, x0 = L.cx.l + L.cx.w * 0.3, x1 = L.cx.l + L.cx.w * 0.55;
    await touch('touchStart', [{ x: x0, y }]);
    for (let k = 1; k <= 12; k++) { await touch('touchMove', [{ x: x0 + (x1 - x0) * k / 12, y: y + 1 }]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    const i1 = await info();
    log('dragged in the dock', JSON.stringify(i1));
    assert.equal(i1.mode, 'pick');
    assert.ok(i1.step > i0.step + 5, `the drag moved the hour on (step ${i0.step} → ${i1.step})`);
    assert.equal(i1.full, true, 'still full screen');
    await mapAt(i1.t);
    const card1 = (await R()).card;
    assert.doesNotMatch(card1, /now/, 'the card follows the hour');

    // Back closes it at the same hour
    await ctx.state(() => history.back());
    await ctx.waitFor(() => !CLEAN.forecastInfo().full, { label: 'Back leaves full screen', timeout: 5000 });
    await page.waitForTimeout(300);
    let i2 = await info();
    assert.deepEqual([i2.layout, i2.step, i2.mode], ['phone', i1.step, 'pick'], 'the normal layout at the same hour');
    L = await R();
    assert.ok(L.frame.h < L.vh * 0.8 && L.map.t > L.head.b - 1, 'the map is back in the column');
    F = await frameFull();
    assert.deepEqual([F.label, F.pressed], ['Full screen', 'false']);
    assert.equal(await ctx.state(() => document.documentElement.classList.contains('cl-f-lock')), false, 'the page scrolls again');

    // Escape inside the map closes it too (through the history entry)
    await mf().click('#hubFull');
    await ctx.waitFor(() => CLEAN.forecastInfo().full, { label: 'full screen again', timeout: 5000 });
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !CLEAN.forecastInfo().full && !(history.state && history.state.clFull), { label: 'Escape leaves full screen', timeout: 5000 });
    assert.equal((await info()).step, i1.step, 'same hour');

    // a phone held sideways in full screen: the dock stays low, the map keeps most of the window
    await mf().click('#hubFull');
    await ctx.waitFor(() => CLEAN.forecastInfo().full, { label: 'full screen, sideways', timeout: 5000 });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);
    L = await R();
    log('sideways', JSON.stringify({ wk: L.wk, ctl: L.ctl, dz: L.dz, vseg: L.vseg }));
    assert.equal((await info()).layout, 'full');
    near(L.frame.h, L.vh, 1, 'the map fills the window');
    assert.ok(L.wk.h < L.vh * 0.5, `the dock takes under half the window (${L.wk.h} of ${L.vh})`);
    assert.ok(Math.abs(L.ctl.t - L.dz.t) < 4 && Math.abs(L.dz.t - L.vseg.t) < 4, 'buttons, zoom and switch on one row');
    assert.ok(L.sw <= L.vw, 'nothing sideways');
    await ctx.screenshot('layout-phone-sideways-full');
    await page.setViewportSize({ width: 390, height: 844 });
    await ctx.state(() => history.back());
    await ctx.waitFor(() => !CLEAN.forecastInfo().full, { label: 'out of full screen', timeout: 5000 });
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();

    // ── Swells: the week as a stack of where the swell comes from; its top is the mean ──
    const stack = () => ctx.state(() => {
      const cx = document.querySelector('#cl-view-forecast .cl-f-cx'), c = cx.querySelector('.cl-f-cur circle'), X = Number(cx.querySelector('.cl-f-cur line').getAttribute('x1'));
      const bands = [...cx.querySelectorAll('.cl-f-sb')].map(p => {
        const pts = p.getAttribute('d').replace(/[MZ]/g, '').split('L').map(q => q.split(',').map(Number));
        const at = pts.filter(q => Math.abs(q[0] - X) < 0.06).map(q => q[1]);
        return { fam: p.getAttribute('data-fam'), fill: p.style.fill, top: at.length ? Math.min(...at) : null, bottom: at.length ? Math.max(...at) : null };
      });
      return { X, cy: c ? Number(c.getAttribute('cy')) : null, bands, lines: cx.querySelectorAll('.cl-f-gfs, .cl-f-ec, .cl-f-band').length, mean: cx.querySelectorAll('.cl-f-mean').length,
        lgd: document.querySelector('#cl-view-forecast .cl-f-lgd').innerText, desc: document.getElementById('cl-f-cxd').textContent, info: CLEAN.forecastInfo() };
    });
    const checkStack = (s, where) => {
      assert.equal(s.lines, 0, `${where}: no model lines in Swells`);
      assert.equal(s.mean, 1, `${where}: the mean on top`);
      assert.ok(s.bands.length >= 2, `${where}: more than one family stacked (${s.bands.length})`);
      for (const b of s.bands) assert.equal(b.fill, FAM[b.fam], `${where}: the ${b.fam} band in its swell colour`);
      const tops = s.bands.map(b => b.top).filter(v => v != null);
      near(Math.min(...tops), s.cy, 1, `${where}: the stack's top at the cursor is the mean height (the cursor's dot)`);
      const order = ['SE', 'E', 'S', 'other'];
      assert.deepEqual(s.bands.map(b => b.fam), order.filter(f => s.bands.some(b => b.fam === f)), `${where}: SE at the bottom, then E, S, other`);
    };
    await page.locator('#cl-view-forecast .cl-f-vseg button[data-view="swells"]').click();
    let s = await stack();
    log('swells, phone', JSON.stringify(s.bands), 'cursor', s.X, s.cy);
    assert.equal(s.info.view, 'swells');
    checkStack(s, 'phone');
    assert.equal(sp(s.lgd), 'SE swell E swell S swell other mean');
    assert.match(s.desc, /split by where its swell comes from/);
    // a later hour, where the stack is taller
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    for (let k = 0; k < 9; k++) await page.keyboard.press('ArrowRight');
    checkStack(await stack(), 'phone, Sat');

    // ── Wide: the timeline on the map ──
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(500);
    await ctx.state(() => CLEAN.render('forecast'));
    await page.waitForTimeout(300);
    L = await R();
    log('wide', JSON.stringify(L));
    assert.equal((await info()).layout, 'wide');
    const content = L.view.w, gut = 16;
    near(L.map.l, L.view.l + gut, 1, 'the map spans the content width (left)');
    near(L.map.r, L.view.r - gut, 1, 'the map spans the content width (right)');
    assert.ok(L.map.h >= Math.min(0.78 * L.vh, 760) - 2, `most of the window (${L.map.h})`);
    assert.ok(content > 1100, 'the content is the wide column');
    assert.ok(L.head.l > L.map.l && L.head.l < L.map.l + 40 && L.head.t > L.map.t && L.head.t < L.map.t + 40 && L.head.r < L.map.l + L.map.w / 2 + 1, 'the readout is a card over the map\'s top left');
    assert.ok(L.mbar.r > L.map.r - 80 && L.mbar.t < L.map.t + 20 && L.mbar.l > L.head.r, 'zoom and spot over the map\'s top right');
    near(L.wk.b, L.map.b, 1, 'the week is docked inside the map\'s bottom edge');
    near(L.wk.l, L.map.l, 1, 'across the map (left)');
    near(L.wk.r, L.map.r, 1, 'across the map (right)');
    assert.ok(L.wk.t > L.head.b, 'under the card');
    assert.ok(L.ctl.r <= L.cx.l + 1 && L.ctl.t < L.cx.b, 'the buttons on the left, the chart on the right');
    assert.ok(L.side.t >= L.map.b, 'wind and tide, the buoy check and the source below the map');
    F = await frameFull();
    assert.ok(parseFloat(F.bot) > 150 && F.keyBottom > parseFloat(F.bot), `the colour key lifts above the docked week (${F.bot}, key ${F.keyBottom})`);
    assert.ok(parseFloat(F.top) > 40, `the layers panel opens under the zoom and spot (${F.top})`);
    checkStack(await stack(), 'wide');
    await ctx.state(() => scrollTo(0, 0));
    await ctx.screenshot('layout-wide-swells', { fullPage: true });
    // the card keeps its size through the week
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    await page.keyboard.press('Home');
    const sizes = new Set();
    for (let k = 0, n = await ctx.state(() => CLEAN.model.state.steps.length); k < n; k += 3) {
      sizes.add(Math.round((await R()).head.h));
      for (let j = 0; j < 3; j++) await page.keyboard.press('ArrowRight');
    }
    assert.equal(sizes.size, 1, `the card never changes height (${[...sizes]})`);
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();

    // the choice survives a reload
    await boot();
    await page.waitForTimeout(300);
    assert.equal((await info()).view, 'swells', 'Swells remembered');
    assert.equal(await page.getAttribute('#cl-view-forecast .cl-f-vseg button[data-view="swells"]', 'aria-pressed'), 'true');
    checkStack(await stack(), 'after a reload');
    await page.locator('#cl-view-forecast .cl-f-vseg button[data-view="models"]').click();
    assert.equal((await info()).view, 'models');
    assert.ok(await ctx.state(() => document.querySelectorAll('#cl-view-forecast .cl-f-gfs').length > 0));
    await page.waitForTimeout(300);
    await ctx.state(() => scrollTo(0, 0));
    await ctx.screenshot('layout-wide', { fullPage: true });

    // ── Wide full screen: same mode; a mouse drag in the dock, then Back ──
    i0 = await info();
    await mf().click('#hubFull');
    await ctx.waitFor(() => CLEAN.forecastInfo().full, { label: 'wide full screen', timeout: 5000 });
    await page.waitForTimeout(400);
    L = await R();
    log('wide full', JSON.stringify(L));
    near(L.frame.w, L.vw, 1, 'the frame fills the window');
    near(L.frame.h, L.vh, 1, 'the frame fills the window');
    near(L.wk.b, L.vh, 1, 'the dock on the bottom edge');
    assert.ok(L.head.l < 40 && L.head.t < 40 && L.head.h < 160, 'the card top left');
    assert.ok(L.dz.h > 0, 'the zoom in the dock');
    await ctx.screenshot('layout-wide-full');
    await page.mouse.move(L.cx.l + L.cx.w * 0.3, L.cx.t + 50);
    await page.mouse.down();
    await page.mouse.move(L.cx.l + L.cx.w * 0.6, L.cx.t + 50, { steps: 5 });
    await page.mouse.up();
    const i3 = await info();
    assert.ok(i3.mode === 'pick' && i3.step > i0.step + 5, `the drag moved the hour (${i0.step} → ${i3.step})`);
    await mapAt(i3.t);
    await ctx.state(() => history.back());
    await ctx.waitFor(() => !CLEAN.forecastInfo().full, { label: 'Back leaves wide full screen', timeout: 5000 });
    const i4 = await info();
    assert.deepEqual([i4.layout, i4.step], ['wide', i3.step], 'back to the timeline on the map, same hour');
    // the zoom in the dock is the same choice as the map's
    assert.equal(await ctx.state(() => CLEAN.errors.length), 0, 'CLEAN.errors: ' + JSON.stringify(await ctx.state(() => CLEAN.errors)));
  }
};
