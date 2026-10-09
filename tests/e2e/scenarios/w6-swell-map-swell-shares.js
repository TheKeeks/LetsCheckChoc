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

    // The forecast headline names each swell's share of Choc, not one period and direction.
    await page.waitForFunction(() => /Choc's swell:/.test(document.getElementById('tripLine').textContent), null, { timeout: 15000 });
    const fc = await txt('#tripLine');
    log('forecast: ' + fc);
    assert.match(fc, /Choc's swell: (all from one swell, \d+ s from [A-Z]+ \(\d+°\)|\d+% \d+ s [A-Z]+ \(\d+°\))/);

    // A mixed day: 22 Aug 2025 (Erin's swell, an ESE swell and NNE chop).
    await page.evaluate(() => window.CHOC.showPast('2025-08-22'));
    await page.waitForTimeout(800);
    const card = await txt('#decDay');
    log('calendar: ' + card.slice(0, 420));
    assert.match(card, /buoy 13\.[67] ft at its peak, all swells combined/, 'the buoy height is named as all swells combined');
    assert.match(card, /58% from groundswell of 9\.1 ft at 17 s from SSE \(167°\) · 38% from swell of 7\.3 ft at 8 s from ESE \(109°\) · 4% from wind waves of 6\.4 ft at 5 s from NNE \(33°\)/, 'each swell\'s share of Choc');
    assert.match(card, /44% of it came from outside the 115–158° window/, 'how much bent in');
    const hud = await txt('#tripLine');
    log('map: ' + hud);
    assert.match(hud, /^Buoy 13\.[67] ft, all swells · Choc's swell: 58% 17 s SSE \(167°\), 38% 8 s ESE \(109°\), 4% the rest/, 'map headline');

    // Check a date, same day: shares on each swell and the bent-in share.
    await page.evaluate(() => { const i = document.getElementById('dcDate'); i.value = '2025-08-22'; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(400);
    const dc = await txt('#dcOut');
    assert.match(dc, /4\.3 ft at Choc, 58% of its energy/); assert.match(dc, /3\.5 ft at Choc, 38% of its energy/); assert.match(dc, /1\.1 ft at Choc, 4% of its energy/);
    assert.match(dc, /Buoy at its peak, all swells combined: 13\.7 ft \(most energetic period 18\.2 s, from 169°\)/);
    assert.match(dc, /44% of it came from outside the 115–158° window/);
    await page.locator('#dcOut').scrollIntoViewIfNeeded();
    await ctx.screenshot('swell-shares-check-a-date');

    // A single-swell day past Montauk: 29 Aug 2023.
    await page.evaluate(() => window.CHOC.showPast('2023-08-29'));
    await page.waitForTimeout(800);
    const one = await txt('#decDay .dec-mix');
    log('29 Aug 2023: ' + one);
    assert.match(one, /97% from groundswell of 5\.8 ft at 12 s from S \(170°\)/);
    assert.match(one, /63% of it came from outside the 115–158° window/);
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
