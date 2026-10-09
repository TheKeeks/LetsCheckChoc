// Sound Check (research/): the owner wants readouts as short lines, not boxes of explanation. Each swell is one line
// the way a surf report writes it, 1° for the primary swell and 2° for the secondary ("1° 9.1 ft @ 17 s SSE 167°"),
// with label/value lines for the rest (Bent in, Wind, Buoy, Landed, Energy…). Covers the calendar day card, Check a
// date, the map's headline (past and forecast), a tapped dot, Drop a wave's numbers, the ocean-that-day readout, the
// rays cards and the map's help cards.
'use strict';

module.exports = {
  name: 'Sound Check: readouts are short 1°/2° swell lines, not paragraphs',
  options: { viewport: { width: 1180, height: 900 }, timeoutMs: 180000 },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    const SWELL = /^\d+\.\d ft @ \d+ s [NESW]{1,3} \d+°/;                 // "9.1 ft @ 17 s SSE 167°"
    const kv = (sel) => page.$$eval(sel + ' dl.kv dt:not(.kv-h)', dts => dts.map(d => [d.textContent, d.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()]));
    // the longest line of text in a block: a readout made of short lines has none longer than this
    const longest = (sel) => page.$eval(sel, n => Math.max(0, ...n.innerText.split('\n').map(l => l.trim().length)));

    // Calendar day card: 1°, 2°, 3° swells at Choc's biggest hour, then Bent in, Wind, Buoy.
    await page.evaluate(() => window.CHOC.showPast('2025-08-22'));
    await page.waitForTimeout(800);
    const card = await kv('#decDay');
    log('calendar: ' + card.map(r => r.join(' ')).join(' | '));
    assert.deepEqual(card.map(r => r[0]), ['1°', '2°', '3°', 'Bent in', 'Wind', 'Buoy']);
    assert.ok(card.slice(0, 3).every(r => SWELL.test(r[1])), 'each swell in surf-report form');
    assert.ok(await longest('#decDay') <= 100, `no paragraph in the day card (${await longest('#decDay')} characters)`);

    // The map's headline: one line per swell, then the wind.
    const hud = await page.$eval('#tripLine', n => n.innerText.split('\n'));
    log('past headline: ' + hud.join(' | '));
    assert.equal(hud.length, 3);
    assert.ok(/^1° /.test(hud[0]) && SWELL.test(hud[0].slice(3)) && /^2° /.test(hud[1]) && /^Wind /.test(hud[2]), 'headline lines: 1°, 2°, wind');

    // Check a date: swell cards tagged 1°/2°/3°, then short Bent in and Buoy lines.
    await page.evaluate(() => { const i = document.getElementById('dcDate'); i.value = '2025-08-22'; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(400);
    const tags = await page.$$eval('#dcOut .tr-l', ls => ls.map(l => l.textContent.trim()));
    assert.deepEqual(tags.map(t => t.slice(0, 2)), ['1°', '2°', '3°']);
    assert.ok(tags.every(t => SWELL.test(t.slice(3))), tags.join(' | '));
    assert.deepEqual((await kv('#dcOut')).map(r => r[0]), ['Bent in', 'Buoy']);
    assert.ok(await longest('#dcOut') <= 100, 'no paragraph in Check a date');
    await page.locator('#dcOut').scrollIntoViewIfNeeded();
    await ctx.screenshot('readouts-check-a-date');

    // What the ocean was doing: one line per source, its swells biggest first.
    await page.locator('#odWrap').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#odNote dl.kv'), null, { timeout: 20000 });
    const od = await kv('#odWrap #odNote');
    log('ocean that day: ' + od.map(r => r.join(' ')).join(' | '));
    assert.deepEqual(od.map(r => r[0]), ['Block Island', 'Long Island', 'Model']);
    assert.ok(od.every(r => /^1° \d+\.\d ft @ \d+ s [NESW]{1,3}( · 2° |$)/.test(r[1])), 'each source: 1° first, then 2°');
    assert.equal(await page.$$eval('#odWrap > p', ps => ps.filter(p => p.textContent.length > 120).length), 0, 'no long paragraphs left in the panel');

    // The rays cards: label/value lines.
    await page.locator('#frOut').scrollIntoViewIfNeeded();
    const fr = await kv('#frOut');
    assert.deepEqual(fr.map(r => r[0]), ['Rays', 'Height', 'Example', 'Shape', 'Rays', 'Height', 'Example', 'Shape'], 'Choc and Wilderness cards');

    // A tapped forecast dot: short lines only.
    await page.click('#tripModeSeg button[data-v="week"]');
    await page.waitForFunction(() => /^1° /.test(document.getElementById('tripLine').textContent), null, { timeout: 15000 });
    const fh = await page.$eval('#tripLine', n => n.innerText.split('\n'));
    log('forecast headline: ' + fh.join(' | '));
    assert.ok(SWELL.test(fh[0].slice(3)) && /^Wind /.test(fh[fh.length - 1]), 'forecast headline: 1° swell first, wind last');
    const dot = await page.evaluate(async () => { const t = window.CHOC.trip, c = t._aimed()[0]; if (!c) return null; t._tapAt(c.lon, c.lat); await new Promise(r => setTimeout(r, 400)); return t.fc.pillLines; });
    if (dot) { log('dot: ' + dot.join(' | ')); assert.ok(/^\d+\.\d ft @ \d+ s [NESW]{1,3}$/.test(dot[0]) && dot.every(l => l.length <= 48), 'dot card: short lines'); }

    // Drop a wave: its numbers as lines at the top of the info card, and short help bullets.
    await page.click('#tripModeSeg button[data-v="drop"]');
    await page.waitForFunction(() => window.CHOC.trip.state.ray && window.CHOC.trip.state.ray.pw, null, { timeout: 90000 });
    await page.evaluate(() => window.CHOC.trip.skip());
    await page.waitForTimeout(600);
    await page.click('#hubInfo');
    await page.waitForFunction(() => document.querySelector('#hubWave dl.kv'), null, { timeout: 10000 });
    const wave = await kv('#hubWave');
    log('drop a wave: ' + wave.map(r => r.join(' ')).join(' | '));
    assert.deepEqual(wave.map(r => r[0]), ['Landed', 'From', 'Energy', 'Height', 'Rays']);
    const help = await page.$$eval('#hubInfoCard .hub-ic li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim().length));
    assert.ok(help.length >= 15 && help.every(n => n <= 200), `help bullets stay short (longest ${Math.max(...help)})`);
    assert.equal(await page.$$eval('#hubInfoCard .hub-ic > p', ps => ps.length), 0, 'no paragraphs in the help cards');
    await ctx.screenshot('readouts-drop-a-wave');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
