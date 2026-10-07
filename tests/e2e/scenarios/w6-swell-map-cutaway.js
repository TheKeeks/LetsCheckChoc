// The Swell Map (research/): Drop a wave shows a cutaway of the wave side-on
// over the sea floor under its last stretch (wavelength shortening, breaking),
// and the forecast's "headed our way" dots read every GFS-Wave swell train
// (field_gfs_<grid>_sw.png), not just each cell's biggest.
'use strict';

module.exports = {
  name: 'Swell Map: wave cutaway in Drop a wave, dots from every swell train',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    await page.locator('#tripStage').scrollIntoViewIfNeeded();

    // Every swell train is loaded for the dots.
    await page.waitForFunction(() => { const px = window.CHOC.trip.fc.px; return !!(px.gfs_reg_sw && px.gfs_ocean_sw); }, null, { timeout: 15000 });
    const sw = await page.evaluate(() => { const px = window.CHOC.trip.fc.px, g = window.CHOC.trip.fc.d.grids.reg; return { w: px.gfs_reg_sw.w, cells: g.lat[3] * g.lon[3] }; });
    assert.equal(sw.w, sw.cells * 3, 'three swell trains per cell');

    // Tapping a dot shows that dot's own swell train, even where a bigger sea from another direction sits on top
    // (it used to show the biggest sea, e.g. a 5 s NNW wind sea on a dot for a 7 s SE swell).
    await page.click('#fcZoom button[data-v="reg"]');
    const pick = await page.evaluate(async () => {
      const t = window.CHOC.trip, n = t.fc.d.gfs.length, ang = (a, b) => Math.abs(((a - b) + 540) % 360 - 180);
      for (let i = 0; i < n; i++) {
        await t._week(i);
        for (const c of t._aimed()) { const a = t._at(c.lon, c.lat); if (a && ang(a[2], c.D) > 40) return { i, lon: c.lon, lat: c.lat, h: c.h, T: c.T, D: c.D, sea: a }; }
      }
      return null;
    });
    if (pick) {
      await page.evaluate((q) => window.CHOC.trip._tapAt(q.lon, q.lat), pick);
      await page.waitForTimeout(300);
      const lines = await page.evaluate(() => window.CHOC.trip.fc.pillLines);
      log(`dot ${(pick.h * 3.28084).toFixed(1)} ft ${Math.round(pick.T)} s from ${Math.round(pick.D)}°, sea ${Math.round(pick.sea[2])}°: ${lines.join(' | ')}`);
      assert.ok(lines[0].startsWith(`${(pick.h * 3.28084).toFixed(1)} ft · ${Math.round(pick.T)} s from`), 'card shows the dot\'s own swell');
      assert.ok(lines.some((l) => /^One of the swells here/.test(l)), 'card notes the bigger sea there');
    } else log('no hour with a dot under a different sea in this forecast');

    // No cutaway on the forecast.
    assert.ok(await page.evaluate(() => document.getElementById('cutBox').hidden), 'cutaway hidden on the forecast');

    // Drop a wave: the cutaway appears once its wave is traced.
    await page.click('#tripModeSeg button[data-v="drop"]');
    await page.waitForFunction(() => window.CHOC.trip.state.ray && !document.getElementById('cutBox').hidden, null, { timeout: 30000 });
    await page.locator('#cutBox').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => /wavelength goes from \d+ m to \d+ m/.test(document.getElementById('cutCap').textContent), null, { timeout: 15000 });
    const cap = await page.$eval('#cutCap', n => n.textContent);
    log(cap.slice(0, 160));
    const m = cap.match(/wavelength goes from (\d+) m to (\d+) m/);
    assert.ok(+m[2] < +m[1], 'waves get shorter as they reach shallow water');

    // Last 300 m: the wave is drawn (canvas has a bright surface line) and the caption follows.
    await page.click('#cutLen button[data-v="0.3"]');
    await page.waitForTimeout(800);
    assert.match(await page.$eval('#cutCap', n => n.textContent), /last 300 m/);
    const lit = await page.evaluate(() => {
      const c = document.getElementById('cutCv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; return n;
    });
    assert.ok(lit > 200, `wave surface drawn (${lit} bright pixels)`);
    await ctx.screenshot('swell-map-cutaway');

    // Back to the forecast hides it again.
    await page.click('#tripModeSeg button[data-v="week"]');
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(() => document.getElementById('cutBox').hidden), 'cutaway hidden again');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
