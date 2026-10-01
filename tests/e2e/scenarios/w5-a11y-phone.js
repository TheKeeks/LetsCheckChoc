// Audit C48, browser half: on a phone, every bit of text drawn in the grey
// ink tokens (--ink2/3/4) or the rose readout must reach WCAG AA 4.5:1
// against the surface it actually sits on, the ⓘ / ? badges must be at
// least 24 × 24 px tap targets without overlapping each other, and the
// three surf-log rating sliders must have labels. Checked on all three
// tabs. (axe-core showed 19-21 contrast failures per tab before, at
// 1.19-4.03:1, plus six 18 px targets and three unlabeled sliders.)
'use strict';

module.exports = {
  name: 'phone a11y: grey text contrast, 24 px info badges, slider labels, nothing clipped sideways',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitForChart();
    await ctx.waitForLoad();
    await page.waitForTimeout(800);

    // ── tap targets (forecast tab) ──
    const badges = await ctx.state(() => {
      const out = [];
      for (const panel of document.querySelectorAll('#view-forecast .panel, #view-forecast .panel-half')) {
        const els = [...panel.querySelectorAll(':scope > .panel-info-toggle, :scope > .widget-help > summary')]
          .filter(e => e.offsetWidth && getComputedStyle(e).visibility !== 'hidden');
        const rects = els.map(e => e.getBoundingClientRect());
        const overlap = rects.length === 2 &&
          rects[0].left < rects[1].right && rects[1].left < rects[0].right &&
          rects[0].top < rects[1].bottom && rects[1].top < rects[0].bottom;
        els.forEach((e, i) => out.push({ panel: panel.id, cls: e.className || e.tagName, w: rects[i].width, h: rects[i].height, overlap }));
      }
      return out;
    });
    assert.ok(badges.length >= 4, `found ${badges.length} info/help badges`);
    for (const b of badges) {
      assert.ok(b.w >= 24 && b.h >= 24, `${b.panel} ${b.cls} is ${b.w}x${b.h}`);
      assert.equal(b.overlap, false, `${b.panel}: ⓘ and ? overlap`);
    }

    // ── grey-token text contrast, per tab ──
    const audit = () => ctx.state(() => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const tokenRGB = ['--ink2', '--ink3', '--ink4'].map(t => { probe.style.color = `var(${t})`; return getComputedStyle(probe).color; });
      probe.remove();
      const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
        .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
      const bgOf = e => {
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;   // can't judge over images/gradients
          const c = parse(cs.backgroundColor);
          if (c.length >= 3 && (c.length < 4 || c[3] === 1)) return c;
        }
        return [255, 255, 255];
      };
      const fails = [];
      let checked = 0;
      for (const e of document.querySelectorAll('body *')) {
        if (!e.offsetWidth || !e.offsetHeight) continue;
        if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || Number(cs.opacity) < 1) continue;
        if (!tokenRGB.includes(cs.color) && e.id !== 'rose-readout') continue;
        const bg = bgOf(e);
        if (!bg) continue;
        const [hi, lo] = [lum(parse(cs.color)), lum(bg)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        checked++;
        if (ratio < 4.5) fails.push(`${e.id ? '#' + e.id : e.className || e.tagName}: ${cs.color} on rgb(${bg.join(',')}) = ${ratio.toFixed(2)}`);
      }
      return { checked, fails, tokenRGB };
    });

    // ── nothing pushed sideways out of view at 390 px ──
    // The page must not scroll sideways, and nothing in the forecast chart
    // or Model-vs-Buoy panels may poke past a parent that clips it (the
    // verification fieldset used to be 36 px wider than its panel,
    // cutting off the table and the chart axes).
    const clipped = () => ctx.state(() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth) out.push(`page scrollWidth ${document.documentElement.scrollWidth}`);
      for (const e of document.querySelectorAll('#panel-forecast *, #panel-verification *')) {
        const p = e.parentElement;
        if (!e.offsetWidth || !p) continue;
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'hidden' || ox === 'clip') && e.getBoundingClientRect().right > p.getBoundingClientRect().right + 1 &&
            getComputedStyle(e).position !== 'absolute') {
          out.push(`${e.tagName}${e.id ? '#' + e.id : ''}.${e.className} ${Math.round(e.getBoundingClientRect().width)}px in ${p.id || p.className} ${p.clientWidth}px`);
        }
      }
      return out;
    });

    const totals = {};
    for (const tab of ['forecast', 'regression', 'surflog']) {
      await ctx.state(t => switchTab(t), tab);
      await page.waitForTimeout(600);
      const r = await audit();
      totals[tab] = r.checked;
      log(tab, `checked ${r.checked} grey-token text elements`, r.fails.length ? r.fails.slice(0, 5) : 'all ≥ 4.5:1');
      assert.deepEqual(r.fails, [], `${tab}: grey text under 4.5:1`);
      assert.deepEqual(await clipped(), [], `${tab}: content cut off sideways at 390 px`);
    }
    assert.ok(totals.forecast + totals.regression + totals.surflog > 10, 'the audit actually found grey-token text to check');
    ctx.metric('greyTextChecked', totals);

    // ── rating sliders are labelled ──
    const labels = await ctx.state(() => ['sl-size', 'sl-wind-quality', 'sl-ride-quality']
      .map(id => { const e = document.getElementById(id); return e.labels.length ? e.labels[0].textContent.trim().split(/\s+/)[0] : null; }));
    assert.deepEqual(labels, ['Size', 'Wind', 'Ride']);
  }
};
