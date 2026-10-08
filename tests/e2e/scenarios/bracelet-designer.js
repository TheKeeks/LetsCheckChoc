// Fishers Bracelet (bracelet/): the 3D designer opens on its own address, draws
// the gold wire on the ghost wrist, and the spec sheet follows the sliders.
// Total wire length and the gold cost at today's spot price head the spec;
// the live price (gold-api.com) is emulated here, then cut off to check the
// page falls back to the price saved with it. The island closes at the East
// End and the circle ends in a small ball on North Hill; place names start
// off and there are no touch-point markers. Trace the wire runs on the Flat
// view; the jeweller's plans download as PDF and SVG, and open on their own
// page in Spanish. Screenshots (3/4, Map, Circle, Clasp, Flat, mid-trace,
// phone, plans) land in tests/e2e/artifacts/ so the owner can see them from CI.
'use strict';

module.exports = {
  name: 'Bracelet: 3D wire on the wrist, spec follows the sliders',
  options: { viewport: { width: 1180, height: 820 }, timeoutMs: 180000 },   // software WebGL in CI is slow
  async run({ page, ctx, assert, log }) {
    const LIVE = { XAU: 4000, XAG: 50 };
    let priceMode = 'ok';
    await ctx.route(/api\.gold-api\.com\/price\/(XAU|XAG)/, route => {
      if (priceMode === 'abort') return route.abort();
      const sym = route.request().url().match(/(XAU|XAG)/)[1];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ currency: 'USD', price: LIVE[sym], symbol: sym, updatedAt: '2026-10-01T15:00:00Z' }) });
    });
    // Downloads are blob: URLs, which have no host: the runner's external
    // router would abort them, so let them through here.
    await ctx.route(u => u.protocol === 'blob:', route => route.continue());
    await ctx.open('/bracelet/index.html');
    await page.waitForFunction(() => window.BRACELET && window.BRACELET.model && window.BRACELET.frames > 2, null, { timeout: 60000 });
    const gl = await page.evaluate(() => window.BRACELET.webgl);
    log(`WebGL: ${gl}`);
    assert.deepEqual([...new Set(ctx.unhandled)], [], 'everything it needs ships with the page (three.js is vendored)');

    // The default design is the one described: 6.25 in wrist, 3 mm wire, the ball on North Hill.
    const spec = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.spec .row')].map(r => [r.firstElementChild.textContent.trim(), r.lastElementChild.textContent.replace(/\s+/g, ' ').trim()])));
    let s = await spec();
    log(JSON.stringify(s));
    assert.match(s.Wrist, /^158\.8 mm \(6\.25 in\)/);
    assert.match(s.Wire, /^3\.00 mm round · 18k yellow gold/);
    assert.match(s.Clasp, /^4\.2 mm ball, comes up from under the wrist and sits on North Hill$/);
    assert.match(s['Solder points'], /^the East End joint/);
    const head = () => page.evaluate(() => ({
      total: document.getElementById('sTotal').textContent, totalIn: document.getElementById('sTotalIn').textContent,
      weight: document.getElementById('sWeight').textContent, cost: document.getElementById('sCost').textContent,
      costNote: document.getElementById('sCostNote').textContent, note: document.getElementById('priceNote').textContent,
      input: document.getElementById('price').value, stage: document.getElementById('stageSum').textContent
    }));
    const usd = t => Number(t.replace(/[^0-9.]/g, ''));

    // Total wire length and gold cost, priced at the live spot price.
    await page.waitForFunction(() => window.BRACELET.price().source === 'live', null, { timeout: 15000 });
    let h = await head();
    log(JSON.stringify(h));
    assert.match(h.total, /^\d{3} mm$/, 'total wire in mm');
    assert.match(h.totalIn, /^\d+\.\d in · \d+\.\d cm$/, 'and in inches and cm');
    assert.equal(Math.round(parseFloat(h.total)), Math.round(await page.evaluate(() => window.BRACELET.model.lengths.totalMm)));
    assert.match(h.weight, /^\d\d\.\d g$/);
    const c0 = await page.evaluate(() => window.BRACELET.cost());
    assert.equal(Math.round(c0.usd), Math.round(c0.fineGrams / 31.1035 * 4000), '18k: 75% gold at $4,000/oz');
    assert.equal(usd(h.cost), Math.round(c0.usd), 'cost shown in whole dollars');
    assert.match(h.costNote, /g pure at \$4,000\/oz/);
    assert.match(h.note, /^Live spot price, Oct 1, 11:00 AM Eastern\.$/, 'live price, timed in Eastern');
    assert.equal(h.input, '4000.00');
    assert.match(h.stage, /^\d{3} mm wire · \d\d\.\d g · \$[\d,]+$/, 'running total on the 3D view');
    const g0 = parseFloat(h.weight);

    // Typing a price (say a jeweller's quote) reprices it; Today's price goes back.
    await page.fill('#price', '5000');
    await page.waitForFunction(() => window.BRACELET.price().source === 'manual', null, { timeout: 5000 });
    h = await head();
    assert.equal(usd(h.cost), Math.round(c0.fineGrams / 31.1035 * 5000), 'priced at the typed $5,000/oz');
    assert.match(h.note, /^Your price/);
    await page.click('#priceLive');
    await page.waitForFunction(() => window.BRACELET.price().source === 'live' && window.BRACELET.price().usdPerOzt === 4000, null, { timeout: 15000 });

    // Sterling is priced off silver.
    await page.click('#metal button[data-v="silver"]');
    await page.waitForFunction(() => /^Silver cost/.test(document.getElementById('sCostLbl').textContent), null, { timeout: 5000 });
    h = await head();
    assert.equal(h.input, '50.00', 'silver spot price');
    assert.ok(usd(h.cost) < 100, `a sterling test piece is cheap (${h.cost})`);
    await page.click('#metal button[data-v="18k"]');
    await page.waitForFunction(() => /^Gold cost/.test(document.getElementById('sCostLbl').textContent), null, { timeout: 5000 });
    if (gl) {
      await page.waitForTimeout(500);
      await ctx.screenshot('quarter');
    }

    // Place names start off; turned on, only the four that matter; no touch-point markers at all.
    assert.equal(await page.isChecked('#showNames'), false, 'place names off by default');
    assert.equal(await page.evaluate(() => document.getElementById('labels').hidden), true);
    assert.equal(await page.$('#showSpots'), null, 'no touch-point toggle');
    await page.check('#showNames');
    const names = await page.$$eval('#labels .tag span', els => els.map(e => e.textContent));
    assert.deepEqual(names.filter(n => n !== 'hand' && n !== 'elbow'), ['East End', 'North Hill', 'Silver Eel', 'Race Point']);
    await page.uncheck('#showNames');

    // Sliders drive the model: a longer island adds wire, a thinner wire weighs less.
    const builds0 = await page.evaluate(() => window.BRACELET.builds);
    async function slide(id, value) {
      await page.$eval('#' + id, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      await page.waitForFunction(b => window.BRACELET.builds > b, builds0, { timeout: 10000 });
    }
    await slide('islandLenMm', 85);
    s = await spec();
    assert.match(s.Island, /^85 ×/, 'island length follows the slider');
    h = await head();
    assert.ok(parseFloat(h.weight) > g0 && usd(h.cost) > Math.round(c0.usd), 'a longer island uses more gold and costs more');
    await slide('wireDiaMm', 2);
    h = await head();
    assert.ok(parseFloat(h.weight) < g0 * 0.6, `2 mm wire is much lighter (${h.weight})`);

    // The Race Point stop moves the ball; the spec says where it sits.
    await page.click('#hookStops button:last-child');
    await page.waitForFunction(() => /Race Point/.test(document.getElementById('sHook').textContent), null, { timeout: 10000 });

    // Settings survive a reload (per-viewer convenience). This time the live
    // price can't load (as in a published artifact): the page uses the price
    // saved with it, newer than the stored Oct 1 quote, and says so.
    priceMode = 'abort';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BRACELET && window.BRACELET.model && window.BRACELET.priceLoading === false, null, { timeout: 60000 });
    const saved = await page.evaluate(() => ({ p: window.BRACELET.price(), note: document.getElementById('priceNote').textContent }));
    log(JSON.stringify(saved));
    assert.equal(saved.p.source, 'saved');
    assert.ok(saved.p.usdPerOzt > 1000, 'a real saved gold price');
    assert.match(saved.note, /^Spot price on Oct 7, 8:50 PM Eastern\. The live price can.t load here/);
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
    assert.match(txt, /Island closed at the East End \(start soldered end-on\)/);
    assert.match(txt, /4\.2 mm ball clasp sits on North Hill/);
    assert.match(txt, /"wristCircMm":158\.75/);
    assert.match(txt, /Total wire \d{3} mm \(\d+\.\d in\)/);
    assert.match(txt, /Gold cost \$[\d,]+: \d+\.\d g pure at \$4,116\.40\/oz \(spot Oct 7, 8:50 PM ET\), metal only/);

    if (gl) {
      for (const v of ['top', 'end', 'clasp']) {
        await page.evaluate(name => window.BRACELET.view(name, true), v);
        await page.waitForTimeout(400);
        await ctx.screenshot(v === 'top' ? 'map' : v === 'end' ? 'circle' : 'clasp');
      }
    } else {
      assert.ok(await page.isVisible('#noGL'), 'says why the stage is empty');
    }

    // Flat view: the piece laid flat before the tail wraps, on the stage.
    await page.click('[data-view="flat"]');
    assert.equal(await page.evaluate(() => window.BRACELET.stageMode), 'flat');
    assert.ok(await page.isVisible('#flatStage'), 'flat drawing shown on the stage');
    await page.waitForTimeout(300);
    await ctx.screenshot('flat');
    // Trace the wire on the flat view: the caption walks the route in the described order.
    await page.click('#trace');
    assert.equal(await page.evaluate(() => window.BRACELET.stageMode), 'flat', 'tracing keeps the flat view');
    const seen = [];
    for (let i = 0; i < 80 && seen.length < 8; i++) {
      await page.waitForTimeout(250);
      const c = await page.evaluate(() => document.getElementById('traceCap').textContent);
      if (c && seen[seen.length - 1] !== c) seen.push(c);
      if (i === 22) await ctx.screenshot('trace-flat');
      if (!(await page.evaluate(() => window.BRACELET.tracing))) break;
    }
    log('trace: ' + seen.join(' → '));
    const want = ['Starts at the East End', 'North Hill', 'Silver Eel', 'Round Race Point', 'East along the south shore', 'Back at the East End', 'On into a perfect circle', 'Up from under the wrist: the ball sits on North Hill'];
    const idx = seen.map(c => want.findIndex(w => c.startsWith(w))).filter(i => i >= 0);
    assert.ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), `trace captions follow the route in order: ${seen.join(' → ')}`);
    assert.ok(idx.length >= want.length - 2, `most stops shown (${idx.length}/${want.length})`);
    assert.equal(idx[idx.length - 1], want.length - 1, 'ends with the ball on North Hill');
    assert.doesNotMatch(seen.join(' '), /Chocomount|Wilderness/);
    await page.click('[data-view="quarter"]');
    assert.equal(await page.evaluate(() => window.BRACELET.stageMode), '3d');

    // For the jeweller: the PDF and the drawing download, built from this design.
    async function download(selector) {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(selector)]);
      return { name: dl.suggestedFilename(), bytes: require('fs').readFileSync(await dl.path()) };
    }
    const pdf = await download('#dlPdf');
    assert.equal(pdf.name, 'plano-pulsera-fishers.pdf');
    assert.equal(pdf.bytes.slice(0, 5).toString(), '%PDF-');
    assert.ok(pdf.bytes.toString('latin1').includes('Recueza el alambre'), 'the Spanish instructions are in it');
    const svgFile = await download('#dlSvg');
    assert.equal(svgFile.name, 'plano-pulsera-fishers.svg');
    assert.match(svgFile.bytes.toString('utf8'), /^<svg [^>]*width="279.4mm"/);
    assert.deepEqual(ctx.pageErrors.map(e => e.message), []);

    // Phone width: stage on top, panel below, nothing wider than the screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `no sideways scroll on a phone (${overflow}px)`);
    if (gl) await ctx.screenshot('phone');

    // The plans page, a separate file, opened from the designer with this design.
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.evaluate(() => window.BRACELET.set({ islandLenMm: 72 }));
    const href = await page.getAttribute('#openPlans', 'href');
    assert.match(href, /^jeweler\.html#d=/);
    await page.goto(ctx.url('/bracelet/' + href));
    await page.waitForFunction(() => window.JEWELER && document.querySelector('#sheet svg'), null, { timeout: 30000 });
    const plans = await page.evaluate(() => ({
      island: window.JEWELER.params.islandLenMm, lang: document.documentElement.lang,
      steps: [...document.querySelectorAll('#steps li')].map(li => li.textContent),
      msg: document.getElementById('message').value, svg: document.querySelector('#sheet svg').outerHTML.length
    }));
    assert.equal(plans.island, 72, 'the plans show the design from the designer');
    assert.equal(plans.lang, 'es');
    assert.ok(plans.steps.length >= 10 && plans.steps.some(t => /unión en T/.test(t)) && plans.steps.some(t => /tribulete/.test(t)), 'Spanish how-to');
    assert.match(plans.msg, /¿Podría cotizar/);
    await ctx.screenshot('plans');
    const jp = await download('#pdf');
    assert.equal(jp.name, 'plano-pulsera-fishers.pdf');
    assert.equal(jp.bytes.slice(0, 5).toString(), '%PDF-');
    await page.click('[data-lang="en"]');
    assert.match(await page.textContent('#steps li:nth-child(6)'), /T joint/);
    const en = await download('#pdf');
    assert.equal(en.name, 'fishers-bracelet-plans.pdf');
    assert.deepEqual(ctx.pageErrors.map(e => e.message), []);
  }
};
