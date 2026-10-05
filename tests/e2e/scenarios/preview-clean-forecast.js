// ?preview=clean, Forecast tab: the readings that must not mislead, on the
// morning after the last buoy report (Fri 2 Oct 2026, 8:00 AM ET) with
// NOAA's tide predictions down (CO-OPS answers "No Predictions", HTTP 200).
//   • This week: without tide times each day's swell is read over all
//     daylight (kioskDaySummary tidesDown), not its incoming tide. The list
//     says so once, and every row reads "all day" where its low would be,
//     so a verdict that changed with the reading doesn't change silently.
//   • The buoy line: yesterday's 8:30 AM reading "reached the reef ~Thu
//     11:48 AM", with its day; "~11:48 AM" on Friday morning read as a time
//     still to come.
//   • The chart's swell is one continuous shape (no gaps or slivers when
//     every hour has a reading) and Now is a live ink button at rest, as on
//     every board.
//   • The lineup is flat colour blocks: water, sand, filled land (the traced
//     round knob on the shore included), readings in dark pills.
'use strict';

module.exports = {
  name: 'clean preview forecast: tides down → "all day" week, buoy arrival with its day, continuous swell, live Now, filled lineup',
  options: {
    gate: null,
    now: '2026-10-02T08:00:00-04:00',
    viewport: { width: 390, height: 844 },
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    firebase: { mode: 'google', logs: [] },
    net: { coops: 'error' }
  },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    await ctx.waitForChart();
    await ctx.waitForLoad();
    await ctx.waitFor(() => document.querySelectorAll('#cl-view-forecast .cl-f-row').length === 7, { label: 'seven week rows' });

    // ── This week without tide times ──
    const wk = await ctx.state(() => {
      const box = document.querySelector('#cl-view-forecast .cl-f-wk');
      const note = box.querySelector('.cl-f-wkn');
      return {
        tidesDown: CLEAN.data.week().map(d => !!d.tidesDown),
        note: note ? note.textContent : null,
        noteFirst: !!note && box.firstElementChild === note,
        rows: [...box.querySelectorAll('.cl-f-row')].map(r => ({
          day: r.querySelector('.cl-f-d').textContent,
          swell: r.querySelector('.cl-f-s').textContent,
          slot: r.querySelector('.cl-f-w .cl-f-g').textContent.trim()
        }))
      };
    });
    log('week', JSON.stringify(wk));
    assert.deepEqual(wk.tidesDown, [true, true, true, true, true, true, true], 'CO-OPS down: every day falls back to all daylight');
    assert.equal(wk.note, 'No tide times: each day shows the swell over all daylight');
    assert.ok(wk.noteFirst, 'the note sits above the rows');
    for (const r of wk.rows) {
      if (r.swell === '—') continue;                  // no swell either: nothing to qualify
      assert.equal(r.slot, 'all day', r.day + ': "all day" where the low would be');
    }
    await ctx.screenshot('week-tides-down');

    // ── Buoy line: an arrival from yesterday names its day ──
    // Times and units are joined by no-break spaces; compare them as spaces.
    const sp = t => t == null ? t : t.replace(/[\u00a0\u202f]/g, ' ');
    const buoy = sp(await ctx.state(() => [...document.querySelectorAll('#cl-view-forecast .cl-f-now .cl-f-fine')].map(p => p.textContent).find(t => /^Buoy /.test(t)) || null));
    log('buoy', buoy);
    assert.ok(buoy, 'the buoy line shows by day');
    assert.match(buoy, / · Thu 8:30 AM \(/, 'the reading is Thursday 8:30 AM');
    assert.match(buoy, /reached the reef ~Thu \d{1,2}:\d\d [AP]M$/, 'its arrival on the reef carries the day');
    await page.locator('#cl-view-forecast .cl-f-dr[data-dd="buoy"]').click();
    const det = await ctx.state(() => {
      const kv = [...document.querySelectorAll('#cl-view-forecast .cl-f-ddb .cl-f-kv span')].map(s => s.textContent);
      const i = kv.indexOf('Reached the reef');
      return i >= 0 ? kv[i + 1] : null;
    });
    assert.match(sp(det) || '', /^~Thu \d{1,2}:\d\d [AP]M$/, 'Details › Buoy waves: the arrival carries the day');

    // ── Chart: one continuous swell shape, Now live at rest ──
    const ch = await ctx.state(() => {
      const sw = document.querySelector('#cl-view-forecast .cl-f-cx path.sw');
      const d = sw ? sw.getAttribute('d') : '';
      const pts = d.replace(/[MZ]/g, '').split('L').map(p => p.trim().split(/\s+/).map(Number));
      let vertical = 0;
      for (let k = 1; k < pts.length; k++) if (Math.abs(pts[k][0] - pts[k - 1][0]) < 0.05 && Math.abs(pts[k][1] - pts[k - 1][1]) > 0.5) vertical++;
      const now = document.querySelector('#cl-view-forecast .cl-f-jb[data-j="now"]');
      const nh = document.querySelector('#cl-view-forecast .cl-f-jb[data-j="nh"]');
      const ax = document.querySelector('#cl-view-forecast .cl-f-cx .ax');
      return {
        subpaths: (d.match(/M/g) || []).length, vertical, points: pts.length, hours: CLEAN.data.hours().length,
        nowDisabled: now.disabled, nowColor: getComputedStyle(now).color, nowOpacity: getComputedStyle(now).opacity,
        inkColor: getComputedStyle(nh).color, axWeight: ax ? getComputedStyle(ax).fontWeight : null
      };
    });
    log('chart', JSON.stringify(ch));
    assert.equal(ch.subpaths, 1, 'the in-window swell is one shape across the week');
    assert.ok(ch.points >= ch.hours, 'a point for every forecast hour');
    assert.ok(ch.vertical <= 2, 'vertical edges only at the chart\'s two ends');
    assert.equal(ch.nowDisabled, false, 'Now is a live button at rest');
    assert.equal(ch.nowOpacity, '1');
    assert.equal(ch.nowColor, ch.inkColor, 'Now is ink, like the hour buttons');
    assert.equal(ch.axWeight, '400', 'the chart\'s "2 ft" label is regular weight');
    const before = await ctx.state(() => STATE.scrubberIdx);
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();
    assert.equal(await ctx.state(() => STATE.scrubberIdx), before, 'Now at now changes nothing');

    // "Tomorrow, Fri" after dark is a label, not a heading (A2-Phone-Late: 400).
    const dayWeight = await ctx.state(() => {
      const p = document.createElement('p');
      p.className = 'cl-f-day cl-serif';
      p.textContent = 'Tomorrow, Sat';
      document.querySelector('#cl-view-forecast .cl-f-now').appendChild(p);
      const w = getComputedStyle(p).fontWeight;
      p.remove();
      return w;
    });
    assert.equal(dayWeight, '400');

    // ── Lineup: flat colour blocks ──
    await page.locator('#cl-view-forecast .cl-f-lu').scrollIntoViewIfNeeded();
    const lu = await ctx.state(() => {
      const svg = document.querySelector('#cl-view-forecast .cl-f-lu svg');
      const fill = e => e ? getComputedStyle(e).fill : null;
      return {
        water: fill(svg.querySelector('.wt')),
        shallows: fill(svg.querySelector('.shl')),
        land: [...svg.querySelectorAll('.land')].map(fill),
        sand: svg.querySelector('.sand') ? getComputedStyle(svg.querySelector('.sand')).stroke : null,
        ponds: KIOSK_COAST.ponds.length,
        outlines: svg.querySelectorAll('.pond, .shore').length,
        pills: [...svg.querySelectorAll('g.pill')].map(g => {
          const t = g.querySelector('text'), r = g.querySelector('rect');
          return { text: t.textContent, fits: +r.getAttribute('width') >= t.getComputedTextLength(), x: +r.getAttribute('x'), w: +r.getAttribute('width') };
        })
      };
    });
    log('lineup', JSON.stringify(lu));
    assert.equal(lu.water, 'rgb(18, 63, 95)', 'water');
    assert.equal(lu.shallows, 'rgb(38, 111, 143)', 'reef shallows');
    assert.equal(lu.sand, 'rgb(205, 187, 138)', 'sand edge along the coast');
    assert.equal(lu.land.length, 1 + lu.ponds, 'the land and the traced knob are both filled land');
    for (const f of lu.land) assert.equal(f, 'rgb(94, 122, 74)', 'land fill');
    assert.equal(lu.outlines, 0, 'no stray outlines');
    assert.ok(lu.pills.some(p => /^SW Pt Block 115°$/.test(p.text)) && lu.pills.some(p => /^Montauk Pt 158°$/.test(p.text)), 'cone labels in pills');
    for (const p of lu.pills) {
      assert.ok(p.fits, p.text + ': the pill holds its text');
      assert.ok(p.x >= 0 && p.x + p.w <= 358, p.text + ': the pill stays inside the picture');
    }
    await ctx.screenshot('lineup');

    assert.deepEqual(await ctx.state(() => CLEAN.errors.map(e => e.where + ': ' + e.message)), [], 'CLEAN.errors');
  }
};
