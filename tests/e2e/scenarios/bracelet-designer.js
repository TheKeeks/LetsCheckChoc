// Fishers Bracelet (bracelet/): the 3D designer opens on its own address, draws
// the gold wire on the ghost wrist, and the spec sheet follows the sliders.
// Screenshots (3/4, Map, Circle, Hook, mid-trace, phone) land in
// tests/e2e/artifacts/ so the owner can see the model from CI.
'use strict';

module.exports = {
  name: 'Bracelet: 3D wire on the wrist, spec follows the sliders',
  options: { viewport: { width: 1180, height: 820 }, timeoutMs: 180000 },   // software WebGL in CI is slow
  async run({ page, ctx, assert, log }) {
    await ctx.open('/bracelet/index.html');
    await page.waitForFunction(() => window.BRACELET && window.BRACELET.model && window.BRACELET.frames > 2, null, { timeout: 60000 });
    const gl = await page.evaluate(() => window.BRACELET.webgl);
    log(`WebGL: ${gl}`);
    assert.deepEqual([...new Set(ctx.unhandled)], [], 'everything it needs ships with the page (three.js is vendored)');

    // The default design is the one described: 6.25 in wrist, 3 mm wire, hooked at North Hill.
    const spec = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.spec .row')].map(r => [r.firstElementChild.textContent.trim(), r.lastElementChild.textContent.replace(/\s+/g, ' ').trim()])));
    let s = await spec();
    log(JSON.stringify(s));
    assert.match(s.Wrist, /^158\.8 mm \(6\.25 in\)/);
    assert.match(s.Wire, /^3\.00 mm round · 18k yellow gold/);
    assert.match(s.Hook, /North Hill/);
    assert.match(s['Gold weight'], /^\d\d\.\d g/);
    const g0 = parseFloat(s['Gold weight']);
    if (gl) {
      await page.waitForTimeout(500);
      await ctx.screenshot('quarter');
    }

    // Labels sit on the island.
    const names = await page.$$eval('#labels .tag span', els => els.map(e => e.textContent));
    for (const n of ['East End', 'North Hill', 'Silver Eel', 'Race Point', 'Chocomount']) assert.ok(names.includes(n), `label ${n}`);

    // Sliders drive the model: a longer island adds wire, a thinner wire weighs less.
    const builds0 = await page.evaluate(() => window.BRACELET.builds);
    async function slide(id, value) {
      await page.$eval('#' + id, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      await page.waitForFunction(b => window.BRACELET.builds > b, builds0, { timeout: 10000 });
    }
    await slide('islandLenMm', 85);
    s = await spec();
    assert.match(s.Island, /^85 ×/, 'island length follows the slider');
    assert.ok(parseFloat(s['Gold weight']) > g0, 'a longer island uses more gold');
    await slide('wireDiaMm', 2);
    s = await spec();
    assert.ok(parseFloat(s['Gold weight']) < g0 * 0.6, `2 mm wire is much lighter (${s['Gold weight']})`);

    // The Race Point stop moves the hook; the spec says where it catches.
    await page.click('#hookStops button:last-child');
    await page.waitForFunction(() => /Race Point/.test(document.getElementById('sHook').textContent), null, { timeout: 10000 });

    // Settings survive a reload (per-viewer convenience).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BRACELET && window.BRACELET.model, null, { timeout: 60000 });
    const kept = await page.evaluate(() => window.BRACELET.params);
    assert.equal(kept.islandLenMm, 85);
    assert.equal(kept.wireDiaMm, 2);

    // Reset brings back the described design.
    await page.click('#reset');
    await page.waitForFunction(() => window.BRACELET.params.islandLenMm === 65 && /North Hill/.test(document.getElementById('sHook').textContent), null, { timeout: 10000 });

    // Copy design always ends with something the viewer can paste.
    await page.click('#copy');
    await page.waitForFunction(() => document.getElementById('copyMsg').textContent.length > 0, null, { timeout: 5000 });
    const txt = await page.evaluate(() => window.BRACELET.text());
    assert.match(txt, /hooks on at North Hill/);
    assert.match(txt, /"wristCircMm":158\.75/);

    if (gl) {
      for (const v of ['top', 'end', 'hook']) {
        await page.evaluate(name => window.BRACELET.view(name, true), v);
        await page.waitForTimeout(400);
        await ctx.screenshot(v === 'top' ? 'map' : v === 'end' ? 'circle' : 'hook');
      }
      // Trace the wire: the caption walks the route in the described order.
      await page.click('#trace');
      const seen = [];
      for (let i = 0; i < 80 && seen.length < 9; i++) {
        await page.waitForTimeout(250);
        const c = await page.evaluate(() => document.getElementById('traceCap').textContent);
        if (c && seen[seen.length - 1] !== c) seen.push(c);
        if (i === 18) await ctx.screenshot('trace');
        if (!(await page.evaluate(() => window.BRACELET.tracing))) break;
      }
      log('trace: ' + seen.join(' → '));
      const want = ['Starts at the East End', 'North Hill', 'Silver Eel', 'Round Race Point', 'East along the south shore', 'Chocomount', 'Back to the East End', 'A perfect circle', 'The hook catches the outline at North Hill'];
      const idx = seen.map(c => want.findIndex(w => c.startsWith(w))).filter(i => i >= 0);
      assert.ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), `trace captions follow the route in order: ${seen.join(' → ')}`);
      assert.ok(idx.length >= want.length - 2, `most stops shown (${idx.length}/${want.length})`);
      assert.equal(idx[idx.length - 1], want.length - 1, 'ends at the hook');
    } else {
      assert.ok(await page.isVisible('#noGL'), 'says why the stage is empty');
    }
    assert.deepEqual(ctx.pageErrors.map(e => e.message), []);

    // Phone width: stage on top, panel below, nothing wider than the screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `no sideways scroll on a phone (${overflow}px)`);
    if (gl) await ctx.screenshot('phone');
  }
};
