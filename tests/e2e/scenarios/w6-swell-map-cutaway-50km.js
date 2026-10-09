// Sound Check (research/): Drop a wave's side view goes out to 50 km, to compare the approach to Montauk with the
// approach to Fishers. "At Montauk" aims the swell at Ditch Plains; "Keep to compare" leaves that wave's sea floor and
// energy drawn dashed (and its path on the map) under the next wave's, lined up at the shore, and the caption compares
// the two. The break is looked for every 5 m whatever the view: the 5 km view used to put the same wave's break in
// shallower water than the close-ups did (2.3 ft against 3.5 ft at Choc), and the 50 km view's points are further apart.
'use strict';

module.exports = {
  name: 'Sound Check: 50 km side view compares the approach to Montauk with Fishers',
  options: { viewport: { width: 1180, height: 820 }, timeoutMs: 240000 },   // two aims and two energy counts; CI is slow
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip, null, { timeout: 30000 });
    await page.click('#tripModeSeg button[data-v="drop"]');
    await page.waitForFunction(() => window.CHOC.trip.state.ray && !document.getElementById('cutBox').hidden, null, { timeout: 60000 });
    const S = 'window.CHOC.trip.state';
    const cap = () => page.$eval('#cutCap', n => n.textContent);
    const brk = (t) => { const m = t.match(/breaks in ([\d.]+) m of water at about ([\d.]+) ft/); return m && m[2]; };

    // Aim the swell at Montauk (Ditch Plains).
    let t0 = Date.now();
    await page.click('#tripAimM');
    await page.waitForFunction(`${S}.note === 'aimed at Montauk'`, null, { timeout: 60000 });
    const mtk = await page.evaluate(`({ land: ${S}.ray.land, km: ${S}.ray.km })`);
    log(`aimed at Montauk in ${Date.now() - t0} ms: lands ${mtk.land}, ${mtk.km} km`);
    assert.match(mtk.land, /Ditch Plains, Montauk/);
    assert.ok(mtk.km > 50, 'the default start is far enough out for a 50 km section');

    // 50 km: the whole section, a depth scale for the deep water, the wave as a band.
    await page.locator('#cutBox').scrollIntoViewIfNeeded();
    await page.click('#cutLen button[data-v="50"]');
    t0 = Date.now();
    await page.waitForFunction(`!!${S}.ray.pw`, null, { timeout: 120000 });
    await page.waitForTimeout(1300);
    log(`energy count ${Date.now() - t0} ms`);
    let c = await cap();
    assert.match(c, /Over the last 50 km its wavelength goes from \d+ m to \d+ m/);
    assert.match(c, /drawn as a band from trough to crest/);
    assert.ok(!/still counting that/.test(c), 'the energy count is in');
    const mtkFt = brk(c);
    assert.ok(mtkFt, 'it says where the Montauk wave breaks');
    await ctx.screenshot('swell-map-cutaway-50km-montauk');

    // Keep it, then aim the same swell at Choc.
    await page.click('#cutKeep');
    assert.equal(await page.$eval('#cutKeep', n => n.textContent), 'Clear kept wave');
    assert.match(await page.$eval('#cutKey', n => n.hidden ? '' : n.textContent), /Kept: this wave \(12 s to Ditch Plains, Montauk\)/);
    await page.click('#tripAimC');
    await page.waitForFunction(`${S}.note === 'aimed at Choc' && !!${S}.ray.pw && !!${S}.keep.pw`, null, { timeout: 120000 });
    await page.waitForTimeout(1300);
    assert.deepEqual(await page.$$eval('#cutKey span', s => s.map(x => x.textContent)), ['Your wave: 12 s to Choc', 'Kept: 12 s to Ditch Plains, Montauk']);
    c = await cap();
    log(c.slice(c.indexOf('Dashed')));
    const m = c.match(/Dashed: the wave you kept \(12 s to Ditch Plains, Montauk\)\. Over the same 50 km it crosses water (\d+) m deep on average \(yours: (\d+) m\), ends with (\d+)% of the energy it started with \(yours: (\d+)%\) and breaks at about ([\d.]+) ft \(yours: ([\d.]+) ft\)\./);
    assert.ok(m, 'the caption compares the two waves');
    assert.equal(m[5], mtkFt, 'the kept wave breaks where it did on its own');
    assert.equal(m[6], brk(c), 'and yours where the caption says');
    // the kept sea floor (and energy) is drawn, dashed, in its own color
    const kept = await page.evaluate(() => {
      const cv = document.getElementById('cutCv'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 159) < 30 && Math.abs(d[i + 1] - 227) < 30 && Math.abs(d[i + 2] - 240) < 30) n++; return n;
    });
    assert.ok(kept > 300, `kept wave drawn (${kept} pixels)`);
    await ctx.screenshot('swell-map-cutaway-50km-compare');
    await page.locator('#tripStage').scrollIntoViewIfNeeded();
    await ctx.screenshot('swell-map-cutaway-50km-map');

    // Every view puts the break in the same place for the same wave (5 km used to say 2.3 ft where 1 km said 3.5).
    await page.locator('#cutBox').scrollIntoViewIfNeeded();
    const views = {};
    for (const v of ['0.3', '1', '5', '50']) {
      await page.click(`#cutLen button[data-v="${v}"]`);
      await page.waitForTimeout(400);
      const t = await cap(), k = t.match(/and breaks at about ([\d.]+) ft \(yours/);
      views[v] = [brk(t), k && k[1]];
    }
    log(JSON.stringify(views));
    for (const v of ['0.3', '1', '5']) assert.deepEqual(views[v], views['50'], `the ${v} km view agrees with the 50 km view`);

    // Clearing it takes the dashes away.
    await page.click('#cutKeep');
    assert.equal(await page.$eval('#cutKeep', n => n.textContent), 'Keep to compare');
    assert.ok(await page.$eval('#cutKey', n => n.hidden), 'legend hidden');
    assert.ok(!/Dashed/.test(await cap()), 'no comparison in the caption');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
