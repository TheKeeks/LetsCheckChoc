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
    // The page must not scroll sideways, and nothing in the forecast chart,
    // Wave Spectra or Model-vs-Buoy panels may poke past a parent that
    // clips it (the verification fieldset used to be 36 px wider than its
    // panel, cutting off the table and the chart axes). The page check
    // compares with clientWidth: under isMobile Chromium widens innerWidth
    // to the content, so `scrollWidth > innerWidth` never fired (a 417 px
    // Wave Spectra table slipped through at 390).
    const clipped = () => ctx.state(() => {
      const out = [];
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth) out.push(`page scrollWidth ${de.scrollWidth} > ${de.clientWidth}`);
      for (const e of document.querySelectorAll('#panel-forecast *, #panel-spectral-row *, #panel-verification *')) {
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

    // ── data-age cues (review ux#2) ──
    // The lines that say the numbers are old must be as readable as the
    // numbers. They used --orange / --red-m, 1.97 and 2.73 : 1 on silver,
    // which the grey-token audit above never looks at. The swell card is
    // stale for real at fixture time (obs 8:30, now 11:00); the other
    // states are forced by class so each colour is checked without
    // waiting hours or breaking a fetch.
    await ctx.state(() => switchTab('forecast'));
    await page.waitForTimeout(300);
    const cues = await ctx.state(() => {
      const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
        .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
      const bgOf = e => {
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c.length >= 3 && (c.length < 4 || c[3] === 1)) return c;
        }
        return [255, 255, 255];
      };
      const ratio = e => {
        const fg = getComputedStyle(e).color, bg = bgOf(e);
        const [hi, lo] = [lum(parse(fg)), lum(bg)].sort((a, b) => b - a);
        return { fg, bg: `rgb(${bg.join(',')})`, ratio: Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100 };
      };
      const card = document.getElementById('card-swell');
      const extra = card.querySelector('.condition-extra');
      const hdr = document.getElementById('header-update-time');
      const ind = document.getElementById('forecast-cache-indicator');
      const out = { cardIsStale: card.classList.contains('is-stale'), text: extra.textContent };
      out['swell card, obs > 2 h'] = ratio(extra);
      card.classList.replace('is-stale', 'is-old');
      out['swell card, obs > 6 h'] = ratio(extra);
      card.classList.replace('is-old', 'is-stale');
      hdr.classList.add('is-stale');
      out['header, refresh failed'] = ratio(hdr);
      hdr.classList.remove('is-stale');
      const display = ind.style.display;
      ind.style.display = '';
      ind.classList.add('is-stale');
      out['chart cache note, refresh failed'] = ratio(ind);
      ind.classList.remove('is-stale');
      ind.style.display = display;
      return out;
    });
    log('data-age cues', JSON.stringify(cues));
    assert.ok(cues.cardIsStale, `the fixture's 2h30m-old buoy obs marks the swell card stale ("${cues.text}")`);
    for (const [name, c] of Object.entries(cues)) {
      if (!c || typeof c !== 'object') continue;
      assert.ok(c.ratio >= 4.5, `${name}: ${c.fg} on ${c.bg} = ${c.ratio} : 1, under AA 4.5 : 1`);
    }

    // ── rating sliders are labelled ──
    const labels = await ctx.state(() => ['sl-size', 'sl-wind-quality', 'sl-ride-quality']
      .map(id => { const e = document.getElementById(id); return e.labels.length ? e.labels[0].textContent.trim().split(/\s+/)[0] : null; }));
    assert.deepEqual(labels, ['Size', 'Wind', 'Ride']);
  }
};
