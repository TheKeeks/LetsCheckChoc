// The Swell Map (research/): surf-log photos on the ten-year calendar (camera on months and days that have
// them, the month's photos listed, the day's in its card; only plain https links accepted), the
// "Show the ocean that day" button on Check a day, the ratings tile that states the miss instead of "Yes",
// and the Wilderness table without the shape column.
'use strict';

module.exports = {
  name: 'Swell Map: log photos on the calendar, ocean-that-day button, plainer tiles',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/photos\.example\.test/, r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="9"><rect width="12" height="9" fill="#3a6"/></svg>' }));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.setPhotos && window.CHOC.showPast, null, { timeout: 30000 });

    // The test log has no photos: no cameras until some are given.
    assert.equal(await page.$$eval('#decHeat .dec-cam', n => n.length), 0, 'no photos in an empty log');
    await page.evaluate(() => window.CHOC.setPhotos([
      { when: '2022-10-14T17:40', url: 'https://photos.example.test/a.jpg' },
      { when: '2022-10-14T18:10', url: 'https://photos.example.test/b.jpg' },
      { when: '2024-08-19T21:00', url: 'https://photos.example.test/c.jpg' },
      { when: '2024-08-19T21:00', url: 'javascript:alert(1)' },
    ]));
    assert.equal(await page.$$eval('#decHeat .dec-cam', n => n.length), 2, 'a camera on each month with photos (bad link ignored)');
    await page.evaluate(() => window.CHOC.showPast('2022-10-14'));
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({ month: document.querySelectorAll('#decMonth .dec-ph img').length, dayCam: document.querySelectorAll('#decMonth .dec-d.ph').length, day: document.querySelectorAll('#decDay .dec-ph-row img').length }));
    log(JSON.stringify(m));
    assert.deepEqual(m, { month: 2, dayCam: 1, day: 2 }, 'month lists its photos, the day is marked and shows its own');
    await page.locator('#decMonth').scrollIntoViewIfNeeded();
    await ctx.screenshot('swell-map-photos');

    // Check a day: "Show the ocean that day" opens the map's Past view on that date.
    await page.evaluate(() => { const i = document.getElementById('dcDate'); i.value = '2018-01-04'; i.dispatchEvent(new Event('change')); });
    await page.click('#dcOcean');
    await page.waitForTimeout(800);
    const past = await page.evaluate(() => ({ phase: window.CHOC.trip.state.phase, date: document.getElementById('pastDate').value }));
    assert.deepEqual(past, { phase: 'past', date: '2018-01-04' }, 'opens that day on the map');

    // Plainer wording: no bare "Yes" tile, no shape column.
    assert.ok(!(await page.$eval('#modelTiles', n => /\bYes\b|Not yet/.test(n.textContent))), 'ratings tile states the miss');
    assert.ok(!(await page.$eval('#wildTop', n => /Shape/.test(n.textContent))), 'no shape column');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
