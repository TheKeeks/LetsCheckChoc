// Sound Check map, Past view: one tap from a past day to the ten years, month by month, and
// one tap back. The Past bar's month ("Aug 2023") opens the month tiles over the map, on the
// month the map shows; a month tile opens its calendar, a day its details (and the map behind
// follows it), and "Open this day on the map" closes the tiles on that day. Escape and "Back to
// the map" close too. The tiles take the page's theme; the figure goes back to its section.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'Sound Check: the Past bar\'s month opens the ten years over the map, a day opens back on the map',
  options: { gate: null, viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/research/index.html?view=map&fill=1&theme=light');
    await ctx.waitFor(() => window.CHOC && CHOC.trip && CHOC.tenYears && CHOC.trip.fc.d, { label: 'map' });
    await page.evaluate(() => CHOC.showPast('2023-08-29'));
    await ctx.waitFor(() => CHOC.trip.state.phase === 'past' && document.getElementById('pastMonth').textContent === 'Aug 2023', { label: 'past day' });
    const btn = await page.evaluate(() => {
      const b = document.getElementById('pastDec');
      return { name: b.textContent, icon: !!b.querySelector('svg'), label: getComputedStyle(b.querySelector('.hub-dec-t')).position, popup: b.getAttribute('aria-haspopup') };
    });
    log('month button', JSON.stringify(btn));
    assert.deepEqual(btn, { name: 'Aug 2023Ten years', icon: true, label: 'absolute', popup: 'dialog' }, 'the month is the button; "Ten years" is read out, shown on wide screens');

    const read = () => page.evaluate(() => {
      const ov = document.getElementById('decOv'), mh = document.querySelector('#decMonth h3');
      return {
        open: !ov.hidden, inOverlay: !!document.querySelector('#decOvBody #decHeat svg'), month: mh && mh.textContent,
        home: document.getElementById('decHeat').closest('section').getAttribute('aria-labelledby'),
        focus: document.activeElement && document.activeElement.id, inert: document.querySelector('.hub').inert,
        day: document.getElementById('decDay') && document.getElementById('decDay').innerText,
        idx: CHOC.st.idx, phase: CHOC.trip.state.phase, pastDate: document.getElementById('pastDate').value,
        pastMonth: document.getElementById('pastMonth').textContent, bg: getComputedStyle(ov).backgroundColor
      };
    });

    // ── The tiles, on the map's month ──
    await page.locator('#pastDec').click();
    let r = await read();
    log('open', JSON.stringify(r));
    assert.equal(r.open, true);
    assert.equal(r.inOverlay, true, 'the month tiles are in the overlay');
    assert.equal(r.month, 'August 2023', 'on the month the map shows');
    assert.equal(r.focus, 'decOvX', 'focus on the way back');
    assert.equal(r.inert, true, 'the map behind is inert');
    assert.equal(r.bg, 'rgb(247, 246, 242)', 'the page\'s light theme');
    assert.equal(await page.textContent('#decOvH'), 'Ten years, month by month');
    await ctx.screenshot('ten-years-phone');

    // ── A month tile, then a day: the map behind follows ──
    await page.locator('#decOvBody .dec-cell[aria-label^="September 2021:"]').click();
    r = await read();
    assert.equal(r.month, 'September 2021');
    const inView = await page.evaluate(() => { const b = document.getElementById('decOvBody').getBoundingClientRect(), m = document.getElementById('decMonth').getBoundingClientRect(); return m.top < b.bottom - 100; });
    assert.ok(inView, 'the calendar scrolled into view');
    await page.locator('#decMonth .dec-d[aria-label^="September 10:"]').click();
    r = await read();
    log('day', JSON.stringify(r));
    assert.match(sp(r.day), /^Friday, September 10, 2021 Choc \d+\.\d ft/);
    assert.equal(r.idx, await page.evaluate(() => CHOC.dayIndex('2021-09-10')), 'the page\'s day');
    assert.equal(r.pastDate, '2021-09-10', 'the map\'s Past view follows behind');
    assert.equal(r.open, true, 'the tiles stay until asked to close');

    // ── Open this day on the map: the tiles close on it ──
    await page.locator('#decShow').click();
    r = await read();
    log('back on the map', JSON.stringify(r));
    assert.equal(r.open, false);
    assert.equal(r.home, 'dec-h', 'the figure is back in its section');
    assert.equal(r.inert, false);
    assert.equal(r.phase, 'past');
    assert.equal(r.pastMonth, 'Sep 2021');
    assert.equal(r.pastDate, '2021-09-10');
    assert.equal(r.focus, 'pastDec', 'focus back on the month');
    const fits = await page.evaluate(() => { const b = document.getElementById('pastMonth'); return b.scrollWidth <= b.clientWidth; });
    assert.ok(fits, 'the whole month shows on a phone, not "Sep …"');
    await ctx.screenshot('ten-years-back');

    // ── Escape, and Back to the map, close it too ──
    await page.locator('#pastDec').click();
    assert.equal((await read()).month, 'September 2021', 'reopens on the map\'s month');
    await page.keyboard.press('Escape');
    assert.equal((await read()).open, false, 'Escape');
    await page.locator('#pastDec').click();
    await page.locator('#decOvX').click();
    r = await read();
    assert.equal(r.open, false, 'Back to the map');
    assert.equal(r.home, 'dec-h');

    // ── Wide, dark: "Ten years" shows on the month button; the tiles take the dark theme ──
    await page.setViewportSize({ width: 1100, height: 800 });
    await ctx.open('/research/index.html?view=map&fill=1&theme=dark');
    await ctx.waitFor(() => window.CHOC && CHOC.trip && CHOC.tenYears && CHOC.trip.fc.d, { label: 'map, dark' });
    await page.evaluate(() => CHOC.showPast('2023-08-29'));
    await ctx.waitFor(() => CHOC.trip.state.phase === 'past', { label: 'past day, dark' });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#pastDec .hub-dec-t')).position), 'static', '"Ten years" shown');
    await page.locator('#pastDec').click();
    r = await read();
    assert.equal(r.bg, 'rgb(7, 11, 16)', 'the page\'s dark theme');
    await ctx.screenshot('ten-years-wide');
    await page.keyboard.press('Escape');
  }
};
