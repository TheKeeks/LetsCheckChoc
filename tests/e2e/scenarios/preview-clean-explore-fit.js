// Default look, Explore tab, with a crew session logged in the month on show (photos and a long link in its notes),
// on the pinned history (tests/fixtures/soundcheck/hist.js.gz):
//   • the ten years column fits its width, beside the map on a computer (420 px) and under it on a phone: the month's
//     photo strip scrolls inside it and the link wraps, instead of widening the grid, the month and the calendar past
//     the screen behind a sideways scroll bar (the owner saw it on a computer with one session in October);
//   • the map's corner buttons run Layers, Full screen, 3D and then "How to read this map" (i), last.
'use strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const cond = { swell: { height: 3, period: 9, direction: 140 }, wind: { speed: 6, direction: 330 }, tide: { height: 1, rate: 0.3, stage: 'rising', timeToNearest: 1 }, source: 'openmeteo-archive' };
const LOGS = [{ id: 'a1', userId: 'google-1', displayName: 'Test Surfer', timestamp: '2026-10-04T07:30', createdAt: '2026-10-04T09:00',
  ratings: { size: 6, windQuality: 7, rideQuality: 7 }, notes: 'Fun https://www.instagram.com/p/averyveryverylongpostidentifierthatdoesnotbreak/ ok',
  photos: [1, 2, 3, 4].map(i => ({ url: 'https://firebasestorage.test/p' + i + '.jpg', path: '' })), conditions: cond }];

module.exports = {
  name: 'clean Explore fit: the ten years column fits a phone and a computer with a session\'s photos and notes; the map\'s (i) button comes last',
  options: { viewport: { width: 1180, height: 860 }, timeoutMs: 150000, firebase: { mode: 'google', logs: LOGS } },
  async run({ page, ctx, assert, log }) {
    await ctx.route(/firebasestorage\.test/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    const fr = () => page.frames().find(f => /research\/index\.html\?view=map/.test(f.url()));
    for (const width of [1180, 390]) {
      await page.setViewportSize({ width, height: 860 });
      await ctx.open('/');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && window._fbUserId === 'google-1' && STATE.surfLog.length === 1, { label: 'signed in, the session loaded' });
      await page.evaluate(() => CLEAN.show('map'));
      await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const w = f && f.contentWindow; const r = w && w.document.getElementById('explorerFrame');
        return !!(r && r.contentDocument && r.contentDocument.querySelector('.dec-cal')); }, { timeout: 45000, label: 'Explore with the ten years' });
      // the month's photos are in (the strip appears with the log), then the logged day: its notes and photos too
      await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe').contentWindow.document.getElementById('explorerFrame').contentDocument;
        return f.querySelectorAll('.dec-ph-a').length >= 4; }, { label: 'the month\'s photo strip', timeout: 20000 });
      await fr().evaluate(() => [...document.querySelectorAll('.dec-d[data-i]')].find(d => d.querySelector('i') && d.querySelector('i').textContent.trim() === '4').click());
      await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe').contentWindow.document.getElementById('explorerFrame').contentDocument;
        return /Logged by Test/.test((f.getElementById('decDay') || {}).textContent || ''); }, { label: 'the logged day' });
      const r = await fr().evaluate(() => {
        const d = document.getElementById('exDock'), db = d.getBoundingClientRect();
        return {
          dock: Math.round(db.width), client: d.clientWidth, scroll: d.scrollWidth, page: document.documentElement.scrollWidth, inner: innerWidth,
          past: [...d.querySelectorAll('.dec-heat svg, .dec-cal, .dec-tiles, .dec-log-n')].filter(e => e.getBoundingClientRect().right > db.right + 1).map(e => e.className.baseVal != null ? 'svg' : e.className),
          buttons: [...document.querySelectorAll('#hubTr > button')].map(b => b.id)
        };
      });
      log(width, JSON.stringify(r));
      assert.ok(r.scroll <= r.client, `${width}: the column is ${r.client} px wide but its content ${r.scroll} px`);
      assert.ok(r.page <= r.inner, `${width}: the page scrolls sideways (${r.page} > ${r.inner})`);
      assert.deepEqual(r.past, [], `${width}: the grid, calendar, tiles and notes end inside the column`);
      if (width > 900) assert.equal(r.dock, 420, 'beside the map at its full 420 px');
      assert.deepEqual(r.buttons, ['hubLayers', 'hubFull', 'hub3d', 'hubInfo'], '(i) is the last button');
      await ctx.screenshot('ten-years-' + width);
    }
  }
};
