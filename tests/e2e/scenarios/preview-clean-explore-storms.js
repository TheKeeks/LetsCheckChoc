// Default look, Explore tab, a past day's weather from the history bot's files (fixtures, real data):
// research/ocean/day/2026.json with its hourly wind and tide lanes (tests/fixtures/soundcheck/ocean-day-2026.json)
// and the pressure maps research/ocean/pressure/<YYYY-MM>.png + meta.json (pressure-2026-09/10.png, GFS analyses):
//   • the hour's wind is the hourly one (7am Mon 28 Sep: 16 kn NE), not the day's best hours' (11 kn NNE), and the
//     tide at that hour is worked out between the day's low and high (0.24 ft at 4:55am, 3.14 ft at 11am → 1.0 ft,
//     rising);
//   • zoomed out to the ocean with Pressure & storms on, the past day draws isobars, its lows and highs and the
//     storms' tracks at the 6-hour step nearest the hour, and moves with the hour strip;
//   • the layer switch turns them off; a day with no pressure map yet draws none and says nothing is wrong.
'use strict';

const cond = { swell: { height: 3, period: 9, direction: 140 }, wind: { speed: 6, direction: 330 }, tide: { height: 1, rate: 0.3, stage: 'rising', timeToNearest: 1 }, source: 'openmeteo-archive' };
const LOGS = [{ id: 's1', userId: 'google-1', displayName: 'Test Surfer', timestamp: '2026-09-28T07:30', createdAt: '2026-09-28T09:00',
  ratings: { size: 6, windQuality: 7, rideQuality: 7 }, notes: '', photos: [], conditions: cond }];
const sp = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean Explore storms: a past day\'s hourly wind and tide, and its isobars, lows and storm tracks at the hour',
  options: { viewport: { width: 1180, height: 860 }, timeoutMs: 150000, firebase: { mode: 'google', logs: LOGS } },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/research/ocean/day/2026.json', { file: 'soundcheck/ocean-day-2026.json', headers: { 'content-type': 'application/json' } });
    ctx.serve('/research/ocean/pressure/meta.json', { file: 'soundcheck/pressure-meta.json', headers: { 'content-type': 'application/json' } });
    for (const m of ['2026-09', '2026-10']) ctx.serve(`/research/ocean/pressure/${m}.png`, { file: `soundcheck/pressure-${m}.png`, headers: { 'content-type': 'image/png' } });
    const fr = () => page.frames().find((f) => /research\/index\.html\?view=map/.test(f.url()));
    await ctx.open('/');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && window._fbUserId === 'google-1' && STATE.surfLog.length === 1, { label: 'signed in, the session loaded' });
    await page.evaluate(() => CLEAN.show('map'));
    await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const w = f && f.contentWindow; const r = w && w.document.getElementById('explorerFrame');
      const c = r && r.contentWindow && r.contentWindow.CHOC; return !!(c && c.logHours && c.trip && c.trip.state.phase === 'past'); }, { timeout: 45000, label: 'Explore on past days' });
    const go = (iso) => fr().evaluate((d) => window.CHOC.jump(window.CHOC.dayIndex(d)), iso);

    // ── the hour's wind and tide ──
    await go('2026-09-28');
    await fr().waitForFunction(() => window.CHOC.st.hour === 7 && /Tide/.test(document.getElementById('tripLine').textContent), null, { timeout: 15000 });
    const line = sp(await fr().evaluate(() => document.getElementById('tripLine').innerText));
    log('7am', line);
    assert.match(line, /Wind 16 kn NE, cross-shore · you logged this hour/, 'the hourly wind (16 kn from 40°), not the best hours\' 11 kn NNE');
    assert.match(line, /Tide 1\.0 ft ▲ rising$/, 'between the 4:55am low and the 11am high');

    // ── the ocean, with Pressure & storms on ──
    await fr().click('#fcZoom button[data-v="ocean"]');
    const storm = () => fr().evaluate(() => window.CHOC.trip._pastStorm());
    await fr().waitForFunction(() => { const s = window.CHOC.trip._pastStorm(); return s.drawn && s.drawn.isobars > 50; }, null, { timeout: 20000 });
    let s = await storm();
    log('7am storms', JSON.stringify(s.drawn), 'tracks', JSON.stringify(s.tracks));
    assert.equal(s.drawn.t, '2026-09-28T12Z', '7am EDT (11Z) is nearest the 12Z step');
    assert.ok(s.drawn.lows.length + s.drawn.highs >= 1, 'lows or highs labelled');
    assert.ok(s.meta && s.meta.cols === 5856 && s.meta.months === 2, 'the meta and its months');
    await ctx.screenshot('storms-ocean');

    // the hour strip moves the pressure on: 3 hours later is the 18Z step
    await fr().focus('#pastHours');
    for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowRight');
    await fr().waitForFunction(() => window.CHOC.st.hour === 13 && (window.CHOC.trip._pastStorm().drawn || {}).t === '2026-09-28T18Z', null, { timeout: 15000 });

    // the layer switch turns them off
    await fr().click('#fcLayers button[data-l="storm"]');
    await fr().waitForFunction(() => !window.CHOC.trip._pastStorm().drawn, null, { timeout: 5000 });
    await fr().click('#fcLayers button[data-l="storm"]');
    await fr().waitForFunction(() => !!window.CHOC.trip._pastStorm().drawn, null, { timeout: 5000 });

    // a day with no pressure map (August isn't in the fixture's months): nothing drawn, no error note
    await go('2026-08-15');
    await page.waitForTimeout(600);
    s = await storm();
    assert.equal(s.drawn, null, 'no map for August');
    assert.equal(await fr().evaluate(() => { const n = document.getElementById('scErr'); return !!n && !n.hidden; }), false);
  }
};
