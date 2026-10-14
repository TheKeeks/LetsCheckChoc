// Default look, Explore tab (the Map tab before; part 'map', #map): the Sound Check map's past days with the ten years
// out in the open, on the pinned history (tests/fixtures/soundcheck/hist.js.gz):
//   • it opens on Past at the newest day of the history; its View has Past and Drop a wave (the forecast is the
//     Forecast tab's);
//   • on a wide screen the ten years, month by month, sit in a column beside the map: the grid, the month on show
//     as a calendar, the day's details, and the ocean that day under them; on a phone they sit under the map;
//   • a month picked in the grid shows its days; a day picked there shows on the map straight away (and its details
//     in the column), with no "Open this day on the map" step; a day picked on the map moves the column to it;
//   • the Past bar's month button brings the month into view (no overlay over the map);
//   • Drop a wave hides the column and gives the map the width;
//   • the Forecast tab's map, up in the same browser tab, doesn't make Explore's map say it crashed (each page kind
//     keeps its own heartbeat).
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean Explore: past days with the ten years beside the map (wide) or under it (phone), days in step both ways',
  options: { gate: null, viewport: { width: 1180, height: 820 }, timeoutMs: 120000, contextOptions: { reducedMotion: 'reduce' } },
  async run({ page, ctx, assert, log }) {
    const fr = () => page.frames().find(f => /research\/index\.html\?view=map/.test(f.url()));
    const boot = async () => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean look' });
      await page.evaluate(() => CLEAN.show('map'));
      await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const w = f && f.contentWindow; const r = w && w.document.getElementById('explorerFrame'); const c = r && r.contentWindow && r.contentWindow.CHOC;
        return !!(c && c.trip && c.trip.state.phase === 'past' && r.contentDocument.getElementById('exDock')); }, { timeout: 45000, label: 'Explore on past days' });
      await page.waitForTimeout(600);
    };
    const state = () => fr().evaluate(() => {
      const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      const dock = document.getElementById('exDock'), stage = document.getElementById('tripStage');
      return {
        phase: CHOC.trip.state.phase, iso: CHOC.D[CHOC.st.idx].iso, last: CHOC.D[CHOC.D.length - 1].iso,
        views: [...document.querySelectorAll('#tripModeSeg button')].filter(b => b.offsetParent !== null).map(b => b.textContent),
        stage: R(stage), dock: R(dock), dockShown: !!dock && getComputedStyle(dock).display !== 'none',
        grid: !!dock && !!dock.querySelector('#decHeat svg'), month: dock && dock.querySelector('.dec-mh h3') && dock.querySelector('.dec-mh h3').textContent,
        day: dock && dock.querySelector('#decDay') && dock.querySelector('#decDay').innerText, ocean: !!(dock && dock.querySelector('#odWrap')),
        overlay: !document.getElementById('decOv').hidden, show: !!document.getElementById('decShow') && document.getElementById('decShow').offsetParent !== null,
        hud: document.getElementById('tripPhase').textContent
      };
    });

    // ── iPad landscape: the ten years beside the map ──
    await boot();
    // the Forecast tab's map runs alongside in the same tab: neither takes the other's heartbeat for a crash
    const notes = await Promise.all(page.frames().filter(f => /research\/(index|map)\.html/.test(f.url())).map(f => f.evaluate(() => { const n = document.getElementById('scErr'); return n && !n.hidden ? n.textContent : ''; })));
    log('frames with a note', JSON.stringify(notes));
    assert.ok(notes.length >= 2, 'the Forecast map and the Explore map are both up');
    assert.deepEqual(notes.filter(Boolean), [], 'no "This page stopped and was reloaded" note');
    let s = await state();
    log('wide', JSON.stringify(s));
    assert.equal(s.phase, 'past');
    assert.equal(s.iso, s.last, 'the newest day of the history');
    assert.deepEqual(s.views, ['Past', 'Drop a wave']);
    assert.ok(s.dockShown && s.grid, 'the ten-year grid is out in the open');
    assert.ok(s.dock.l >= s.stage.l + s.stage.w - 1 && s.dock.w >= 330, `beside the map (map ${JSON.stringify(s.stage)}, column ${JSON.stringify(s.dock)})`);
    assert.ok(s.stage.w > 550, 'the map keeps most of the width');
    assert.ok(s.ocean, 'the ocean that day under them');
    const lastMonth = new Date(s.last + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    assert.equal(s.month, lastMonth, 'the month on show is the newest');
    assert.equal(s.overlay, false);
    await ctx.screenshot('explore-wide');

    // ── a month in the grid, then a day in it: the map shows it at once ──
    await fr().evaluate(() => {
      const g = [...document.querySelectorAll('#decHeat .dec-cell')].find(c => /^September 2021:/.test(c.getAttribute('aria-label')));
      g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    s = await state();
    assert.equal(s.month, 'September 2021', 'the month picked in the grid');
    await fr().evaluate(() => {
      const b = [...document.querySelectorAll('#decMonth .dec-d[data-i]')].find(x => /^September 10:/.test(x.getAttribute('aria-label'))); b.click();
    });
    await fr().waitForFunction(() => CHOC.D[CHOC.st.idx].iso === '2021-09-10' && /Sep 10, 2021/.test(document.getElementById('tripPhase').textContent), null, { timeout: 5000 });
    s = await state();
    log('day picked', s.hud, '|', sp(s.day).slice(0, 120));
    assert.match(sp(s.day), /^Friday, September 10, 2021 Choc 3\.8 ft · Wilderness 2\.7 ft/, 'its details in the column');
    assert.equal(s.show, false, 'no "Open this day on the map": it is already there');

    // ── a day picked on the map (the Past bar) moves the column to it ──
    await fr().evaluate(() => { CHOC.jump(CHOC.dayIndex('2023-08-29')); });
    await page.waitForTimeout(200);
    s = await state();
    assert.equal(s.month, 'August 2023');
    assert.match(sp(s.day), /^Tuesday, August 29, 2023/);

    // ── Drop a wave: the column steps aside ──
    await fr().evaluate(() => { if (document.getElementById('hubPanel').hidden) document.getElementById('hubLayers').click(); document.querySelector('#tripModeSeg button[data-v="drop"]').click(); });
    await page.waitForTimeout(400);
    s = await state();
    assert.equal(s.phase, 'setup');
    assert.equal(s.dockShown, false, 'no ten years beside Drop a wave');
    await fr().evaluate(() => document.querySelector('#tripModeSeg button[data-v="past"]').click());
    await page.waitForTimeout(300);
    assert.equal((await state()).dockShown, true, 'back with Past');

    // ── Phone: the ten years under the map; the month button brings them into view ──
    await page.setViewportSize({ width: 390, height: 844 });
    await boot();
    s = await state();
    log('phone', JSON.stringify({ stage: s.stage, dock: s.dock }));
    assert.ok(s.dock.t >= s.stage.t + s.stage.h - 1 && s.dock.w >= 360, 'under the map, full width');
    assert.ok(s.stage.h >= 420, 'the map keeps a good height');
    const before = await fr().evaluate(() => document.getElementById('decMonth').getBoundingClientRect().top);
    await fr().click('#pastDec');
    await page.waitForTimeout(500);
    const after = await fr().evaluate(() => ({ top: document.getElementById('decMonth').getBoundingClientRect().top, h: innerHeight, overlay: !document.getElementById('decOv').hidden }));
    log('month button', before, JSON.stringify(after));
    assert.equal(after.overlay, false, 'no overlay over the map');
    assert.ok(after.top < before && after.top < after.h, 'the month comes into view');
    await ctx.screenshot('explore-phone-month');
    assert.deepEqual(await page.evaluate(() => CLEAN.errors.map(e => e.where + ': ' + e.message)), []);
  }
};
