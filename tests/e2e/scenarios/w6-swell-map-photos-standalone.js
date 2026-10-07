// The Swell Map (research/) opened on its own address, outside the site's tab
// (a shared /research/ link): it connects to the site's Firebase project
// itself, signs in anonymously the way the site does, reads the surf log and
// puts the photos on the ten-year calendar. It only reads. If Firebase can't
// load (blocked, offline) the page carries on without photos and no errors.
'use strict';

const IMG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="9"><rect width="12" height="9" fill="#3a6"/></svg>';

module.exports = {
  name: 'Swell Map: surf-log photos load when the page is opened on its own',
  options: {
    viewport: { width: 1180, height: 820 },
    firebase: {
      logs: [
        { id: 'a', timestamp: '2022-10-14T17:40', photos: [{ url: 'https://firebasestorage.test/a.jpg', path: 'surf-photos/raw/u/a.jpg' }, 'https://firebasestorage.test/b.jpg'] },
        { id: 'b', timestamp: '2024-08-19T21:00', photos: [{ url: null, path: null, _uploadFailed: true }, { url: 'https://firebasestorage.test/c.jpg' }] },
        { id: 'c', timestamp: '2025-06-02T07:00' },
      ],
    },
  },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/firebasestorage\.test/, r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMG }));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.setPhotos, null, { timeout: 30000 });

    // Its own connection: anonymous sign-in, then the log's photos on the calendar.
    await page.waitForFunction(() => document.querySelectorAll('#decHeat .dec-cam').length > 0, null, { timeout: 15000 });
    const st = await page.evaluate(() => ({
      cams: document.querySelectorAll('#decHeat .dec-cam').length,
      anon: !!(window.firebase && window.firebase.auth().currentUser && window.firebase.auth().currentUser.isAnonymous),
      writes: (window.__FB_WRITES || []).length,
    }));
    log(JSON.stringify(st));
    assert.equal(st.cams, 2, 'a camera on each month with photos (failed upload skipped)');
    assert.ok(st.anon, 'signed in anonymously, as the site does');
    assert.equal(st.writes, 0, 'reads only');
    await page.evaluate(() => window.CHOC.showPast('2022-10-14'));
    await page.waitForTimeout(800);
    assert.equal(await page.$$eval('#decMonth .dec-ph img', n => n.length), 2, 'the month lists both photos');
    await page.locator('#decMonth').scrollIntoViewIfNeeded();
    await ctx.screenshot('swell-map-photos-standalone');

    // Firebase blocked: no photos, no errors, the rest of the page still works.
    await page.route(/www\.gstatic\.com\/firebasejs\//, r => r.abort('connectionfailed'));
    await page.reload();
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.$$eval('#decHeat .dec-cam', n => n.length), 0, 'no photos when Firebase is blocked');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
