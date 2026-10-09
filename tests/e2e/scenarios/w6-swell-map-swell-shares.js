// Sound Check (research/): the buoy's height is all of its swells combined, so wherever the page shows a day's
// swell it now says what share of the spot's energy each swell brought, instead of one height, period and
// direction that described no single swell (22 Aug 2025 read "13.7 ft, 18 s from S" for a 9 ft south swell,
// a 7 ft ESE swell and NNE chop). Also how much of Choc's energy came from outside the 115-158 deg window.
// Covers the calendar day card, the map's past-day and forecast headlines, Check a date, and the corrected text.
'use strict';

module.exports = {
  name: 'Sound Check: each swell\'s share of the energy at the spot, everywhere a day\'s swell is shown',
  options: { viewport: { width: 1180, height: 900 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    const txt = (sel) => page.$eval(sel, n => n.textContent.replace(/\s+/g, ' ').trim());
    const lines = (sel) => page.$eval(sel, n => n.innerText.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
    const kv = (sel) => page.$$eval(sel + ' dl.kv dt:not(.kv-h)', dts => dts.map(d => d.textContent + ': ' + d.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()));

    // The forecast headline names each swell's share of Choc, not one period and direction: 1° (primary) first.
    await page.waitForFunction(() => /^1° /.test(document.getElementById('tripLine').textContent), null, { timeout: 15000 });
    const fc = await lines('#tripLine');
    log('forecast: ' + fc.join(' | '));
    assert.match(fc[0], /^1° \d+\.\d ft @ \d+ s [A-Z]+ \d+° → (\d+%|all) of Choc$/);

    // A mixed day: 22 Aug 2025 (Erin's swell, an ESE swell and NNE chop).
    await page.evaluate(() => window.CHOC.showPast('2025-08-22'));
    await page.waitForTimeout(800);
    const card = await kv('#decDay');
    log('calendar: ' + card.join(' | '));
    assert.ok(card.includes('Buoy: 13.6 ft at its peak, all swells') || card.includes('Buoy: 13.7 ft at its peak, all swells'), 'the buoy height is named as all swells combined');
    assert.deepEqual(card.slice(0, 3), ['1°: 9.1 ft @ 17 s SSE 167° → 58% of Choc', '2°: 7.3 ft @ 8 s ESE 109° → 38%', '3°: 6.4 ft @ 5 s NNE 33° → 4%'], 'each swell\'s share of Choc');
    assert.ok(card.includes('Bent in: 44% from outside the 115–158° window'), 'how much bent in');
    const hud = await lines('#tripLine');
    log('map: ' + hud.join(' | '));
    assert.deepEqual(hud.slice(0, 2), ['1° 9.1 ft @ 17 s SSE 167° → 58% of Choc', '2° 7.3 ft @ 8 s ESE 109° → 38%'], 'map headline');
    assert.match(hud[2], /^Wind \d+ kn N, clean · best ~3am · Buoy 13\.[67] ft, all swells$/);

    // Check a date, same day: shares on each swell and the bent-in share.
    await page.evaluate(() => { const i = document.getElementById('dcDate'); i.value = '2025-08-22'; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(400);
    const dc = await page.$$eval('#dcOut .tr', ts => ts.map(t => t.querySelector('.tr-l').textContent.trim() + ' ' + t.querySelector('.tr-r').textContent.trim()));
    log('check a date: ' + dc.join(' | '));
    assert.deepEqual(dc, ['1° 9.1 ft @ 17 s SSE 167° → Choc 4.3 ft (58%) · Wilderness 2.7 ft', '2° 7.3 ft @ 8 s ESE 109° → Choc 3.5 ft (38%) · Wilderness 3.7 ft',
      '3° 6.4 ft @ 5 s NNE 33° → Choc 1.1 ft (4%) · Wilderness 1.2 ft']);
    const dk = await kv('#dcOut');
    assert.ok(dk.includes('Buoy: 13.7 ft at its peak, all swells (18 s, 169°)'), dk.join(' | '));
    assert.ok(dk.includes('Bent in: 44% from outside the 115–158° window'));
    await page.locator('#dcOut').scrollIntoViewIfNeeded();
    await ctx.screenshot('swell-shares-check-a-date');

    // A single-swell day past Montauk: 29 Aug 2023.
    await page.evaluate(() => window.CHOC.showPast('2023-08-29'));
    await page.waitForTimeout(800);
    const one = await kv('#decDay');
    log('29 Aug 2023: ' + one.join(' | '));
    assert.equal(one[0], '1°: 5.8 ft @ 12 s S 170° → 97% of Choc');
    assert.ok(one.includes('Bent in: 63% from outside the 115–158° window'));
    await page.locator('#decDay').scrollIntoViewIfNeeded();
    await ctx.screenshot('swell-shares-calendar');

    // Corrected text: the 14 Oct 2022 tile quoted the noon swell (172°), not the session; the period caption
    // overstated how hard Montauk cuts off short swell; the ten-year source of Choc's 3 ft+ days is stated.
    const how = await txt('#q2Takes');
    assert.ok(!/172°/.test(how) && /29 Aug 2023/.test(how), 'Question 2 tile uses a session the swell really came from outside the window');
    assert.match(await page.evaluate(() => document.body.textContent), /only long-period swell gets in/);
    assert.match(await page.evaluate(() => document.body.textContent), /40%of the 784 days|40% ?of the 784 days/);
    assert.deepEqual(errors, [], 'no page errors');
  }
};
