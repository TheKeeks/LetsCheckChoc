// Default look, Explore tab, a past day hour by hour, on the pinned history (tests/fixtures/soundcheck/hist.js.gz)
// and the buoy's hourly lane in research/ocean/day/2026.json, with one session logged at 7:30 am on Mon 28 Sep:
//   • a day you logged opens at the hour you logged (7am), not at Choc's biggest hour (4pm): the headline, the
//     hour strip under the month and the day's details in the column all say 7am, with that hour's swells and
//     Choc's height worked out from them (1.7 and 1.1 ft at Choc → 2.0 ft, as the energy adds);
//   • the arrow keys and a drag along the strip move through the hours, and everything follows;
//   • a day without a session opens at Choc's biggest hour (Sun 27 Sep, 5am), and the column says so;
//   • a phone gets the same strip under the month.
'use strict';

const cond = { swell: { height: 3, period: 9, direction: 140 }, wind: { speed: 6, direction: 330 }, tide: { height: 1, rate: 0.3, stage: 'rising', timeToNearest: 1 }, source: 'openmeteo-archive' };
const LOGS = [{ id: 'h1', userId: 'google-1', displayName: 'Test Surfer', timestamp: '2026-09-28T07:30', createdAt: '2026-09-28T09:00',
  ratings: { size: 6, windQuality: 7, rideQuality: 7 }, notes: 'Dawn patrol', photos: [], conditions: cond }];
const sp = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean Explore hours: a past day opens at the hour you logged, the hour strip moves through the day, the map and the column follow',
  options: { viewport: { width: 1180, height: 860 }, timeoutMs: 150000, firebase: { mode: 'google', logs: LOGS } },
  async run({ page, ctx, assert, log }) {
    const fr = () => page.frames().find((f) => /research\/index\.html\?view=map/.test(f.url()));
    const boot = async () => {
      await ctx.open('/');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && window._fbUserId === 'google-1' && STATE.surfLog.length === 1, { label: 'signed in, the session loaded' });
      await page.evaluate(() => CLEAN.show('map'));
      await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const w = f && f.contentWindow; const r = w && w.document.getElementById('explorerFrame');
        const c = r && r.contentWindow && r.contentWindow.CHOC; return !!(c && c.logHours && c.trip && c.trip.state.phase === 'past'); }, { timeout: 45000, label: 'Explore on past days' });
    };
    const go = (iso) => fr().evaluate((d) => window.CHOC.jump(window.CHOC.dayIndex(d)), iso);
    const read = () => fr().evaluate(() => {
      const s = document.getElementById('pastHours');
      return { hour: window.CHOC.st.hour, hud: document.getElementById('tripPhase').textContent, line: document.getElementById('tripLine').innerText,
        now: s.getAttribute('aria-valuenow'), text: s.getAttribute('aria-valuetext'), bars: s.querySelectorAll('rect').length,
        day: (document.getElementById('decDay') || {}).innerText || '' };
    });
    const hourIs = (h) => ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe').contentWindow.document.getElementById('explorerFrame').contentWindow;
      return f.CHOC.st.hour; }, { label: 'an hour' }).then(() => fr().waitForFunction((hh) => window.CHOC.st.hour === hh && /\d(am|pm) ·/.test(document.getElementById('tripPhase').textContent), h, { timeout: 15000 }));

    await boot();
    // ── a day you logged: it opens at 7am, the hour of your session ──
    await go('2026-09-28');
    await hourIs(7);
    await fr().waitForFunction(() => /Choc \d/.test(document.getElementById('tripPhase').textContent) && /when you logged/.test((document.getElementById('decDay') || {}).textContent || ''), null, { timeout: 15000 })
      .catch(async (e) => { log('waiting on', JSON.stringify(await read())); throw e; });
    let r = await read();
    log('logged day', JSON.stringify(r));
    assert.equal(sp(r.hud), 'Mon, Sep 28, 2026 · 7am · Choc 2.0 ft', 'the headline is 7am, with that hour at Choc');
    assert.match(sp(r.line), /^1° 3\.4 ft @ 6 s SE 132° → 70% of Choc/, 'the hour\'s primary swell (11Z in the lane), its share of Choc');
    assert.match(sp(r.line), /you logged this hour/);
    assert.equal(r.now, '7');
    assert.match(r.text, /^7am, Choc 2\.0 ft, you logged this hour/);
    assert.match(sp(r.day), /Swells at 7am, when you logged · Choc 2\.0 ft/i, 'the column\'s day follows the hour');
    await ctx.screenshot('hours-logged');

    // ── the keys move through the day; the column and headline follow ──
    await fr().focus('#pastHours');
    await page.keyboard.press('ArrowRight');
    await hourIs(8);
    r = await read();
    assert.equal(sp(r.hud), 'Mon, Sep 28, 2026 · 8am · Choc 1.8 ft', '8am (12Z): one swell, 1.8 ft at Choc');
    assert.match(sp(r.day), /Swells at 8am · Choc 1\.8 ft/i);
    await page.keyboard.press('End');
    await hourIs(23);
    assert.match(sp((await read()).hud), / · 11pm · Choc (\d\.\d ft|–)$/, '11pm EDT is 03Z the next day in the lane');

    // ── a drag along the strip ──
    const box = await (await fr().$('#pastHours')).boundingBox();
    await page.mouse.move(box.x + box.width * (16.5 / 24), box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.up();
    await hourIs(16);
    r = await read();
    assert.match(sp(r.hud), / · 4pm · Choc 2\.9 ft$/, '4pm (20Z): 2.9 ft, the day\'s peak');
    assert.match(sp(r.day), /Swells at 4pm, Choc's biggest hour/i, '4pm is Choc\'s biggest hour that day by the day file');

    // ── a day you didn't log opens at Choc's biggest hour ──
    await go('2026-09-27');
    await hourIs(5);
    r = await read();
    log('unlogged day', JSON.stringify(r));
    assert.match(sp(r.hud), /^Sun, Sep 27, 2026 · 5am · Choc \d/);
    assert.match(sp(r.day), /Swells at 5am, Choc's biggest hour/i);
    assert.equal(r.bars >= 24, true, 'a bar (or a night band) for the hours');

    // ── a phone: the strip sits under the month too ──
    await page.setViewportSize({ width: 390, height: 844 });
    await boot();                                            // as a phone opens it (the strips size themselves on load)
    await go('2026-09-28');
    await hourIs(7);
    const ph = await fr().evaluate(() => { const s = document.getElementById('pastHours').getBoundingClientRect(), t = document.getElementById('pastTl').getBoundingClientRect();
      return { below: s.top >= t.bottom - 1, w: Math.round(s.width), vw: innerWidth }; });
    log('phone', JSON.stringify(ph));
    assert.ok(ph.below && ph.w > 200 && ph.w <= ph.vw, 'under the month strip and inside the screen');
    await ctx.screenshot('hours-phone');
  }
};
