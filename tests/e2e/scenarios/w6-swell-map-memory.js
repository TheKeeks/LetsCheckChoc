// Sound Check (research/) memory and failure reporting. iPad Safari kills a tab that uses too much memory, which
// showed up as the page dying when you zoomed in. The page now:
// - starts the sea-floor model only once you zoom in (it fetched all 68 of its images on the first draw), and then
//   fetches only the images the swells on show need;
// - fetches the two 2016 aerial photos only when zoomed in close, at 2048 px;
// - keeps a dozen map tiles (1024 px, about 4 MB decoded each) instead of 90, never dropping one still on screen;
// - zooms the map with a Safari trackpad pinch (gesture events, which it blocks so the page itself doesn't zoom);
// - says on the page when a script fails, or when the browser killed the page and reloaded it.
'use strict';

module.exports = {
  name: 'Sound Check: lighter on memory, Safari trackpad pinch, and a visible note when something breaks',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // seed a "page was killed" heartbeat for the first load only, as if the browser had killed the last one
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); sessionStorage.setItem('sc-alive', JSON.stringify({ t: Date.now(), W: 4.2 })); } } catch (e) {} });
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    const reqs = (re) => ctx.requests.filter(r => re.test(r.url)).length;

    // The note after a killed page, then gone after an ordinary reload.
    const note = await page.$eval('#scErr', n => !n.hidden && n.textContent).catch(() => null);
    log('after a killed page: ' + note);
    assert.match(note || '', /This page stopped and was reloaded while the map was zoomed in to about 4\.2 km across/);
    await page.click('#scErr button');
    assert.ok(await page.$eval('#scErr', n => n.hidden), 'the note can be dismissed');
    await page.reload();
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => { const n = document.getElementById('scErr'); return !!(n && !n.hidden); }), false, 'no note after an ordinary reload');

    // A script error is shown on the page (a synthetic error event: the runner fails on real uncaught errors).
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'test boom', filename: location.href, lineno: 7 })));
    assert.match(await page.$eval('#scErr', n => n.textContent), /Something went wrong on this page: test boom \(index\.html line 7\)/);
    await page.click('#scErr button');

    // At load: no sea-floor model, no aerial photos.
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    assert.equal(reqs(/\/kfull\/|kgrid\.png/), 0, 'the sea-floor model waits until you zoom in');
    assert.equal(reqs(/\/ocean\/photo\//), 0, 'the aerial photos wait until you zoom in close');
    assert.equal(await page.evaluate(() => window.CHOC.model.ready()), false);

    // A Safari trackpad pinch (gesture events, no touch screen) zooms the map.
    const W0 = await page.evaluate(() => window.CHOC.trip.state.cam.W);
    await page.evaluate(() => {
      const st = document.getElementById('tripStage'), ev = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); e.scale = scale; return e; };
      st.dispatchEvent(ev('gesturestart', 1)); st.dispatchEvent(ev('gesturechange', 1.5)); st.dispatchEvent(ev('gesturechange', 2)); st.dispatchEvent(ev('gestureend', 2));
    });
    const W1 = await page.evaluate(() => window.CHOC.trip.state.cam.W);
    log(`trackpad pinch x2: ${W0.toFixed(0)} -> ${W1.toFixed(0)} km across`);
    assert.ok(Math.abs(W1 - W0 / 2) < W0 * 0.05, 'a pinch of 2 halves the width on show');

    // Zoom in close at Choc: the model starts, fetching only what the swells on show need; the photos arrive at 2048 px.
    await page.evaluate(() => { const s = window.CHOC.trip.state.cam; s.cx = -71.96 * 83.9; s.cy = -41.27 * 110.95; });
    const b = await (await page.$('#tripStage canvas')).boundingBox();
    for (let i = 0; i < 26; i++) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, -300); await page.waitForTimeout(150); }
    await page.waitForFunction(() => window.CHOC.model.ready(), null, { timeout: 30000 });
    await page.waitForTimeout(6000);
    const k = reqs(/\/kfull\//), photos = ctx.requests.filter(r => /\/ocean\/photo\//.test(r.url)).map(r => r.url.split('/').pop());
    log(`zoomed in: ${k} sea-floor images, photos ${photos.join(', ')}, ${await page.evaluate(() => window.CHOC.trip._tiles())} tiles held`);
    assert.ok(k > 0 && k <= 24, `only the sea-floor images the swells on show need (${k} of 68)`);
    assert.deepEqual(photos.sort(), ['choc_2016_2k.webp', 'wild_2016_2k.webp']);
    assert.ok(await page.evaluate(() => window.CHOC.trip._tiles()) <= 30, 'a few dozen tiles at most');
    const t0 = reqs(/\/tiles\//); await page.waitForTimeout(4000);
    assert.equal(reqs(/\/tiles\//), t0, 'no tile fetched again while the map sits still');
    const lum = await page.evaluate(() => { const c = document.querySelector('#tripStage canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 64) { s += d[i] + d[i + 1] + d[i + 2]; n += 3; } return s / n; });
    assert.ok(lum > 40, `the map is drawn zoomed in (brightness ${lum.toFixed(0)}; the empty dark background reads about 22)`);
    await ctx.screenshot('swell-map-zoomed-at-choc');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
