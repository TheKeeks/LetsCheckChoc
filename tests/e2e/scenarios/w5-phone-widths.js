// Review ux#1 / live#1: the Wave Spectra row labels grew to "Swell (NDBC
// 10 s split)" in nowrap cells, so on 375-414 px iPhones the table pushed
// #panel-spectral-summary to 416 px and the whole Forecast tab panned
// sideways (the ⓘ badge sat past the screen edge). The w5 guards missed it
// because they compared scrollWidth with innerWidth, which Chromium grows
// to the content under isMobile. This checks the common iPhone widths
// against the layout width (clientWidth) on a fresh load at each size.
'use strict';

const WIDTHS = [375, 390, 393, 414];

module.exports = {
  name: 'phone 375-414 px: Forecast tab never scrolls sideways; Wave Spectra fits its panel',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } },
  async run({ page, ctx, assert, log }) {
    const seen = {};
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 844 });
      await ctx.open('/');   // fresh load at this width (no page zoom carried over)
      await ctx.waitForChart();
      await ctx.waitForLoad();
      await ctx.waitFor(() => document.querySelector('#spectral-summary-table table'), { label: 'Wave Spectra table' });
      await page.waitForTimeout(400);

      const m = await ctx.state(() => {
        const box = q => { const r = document.querySelector(q).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; };
        const de = document.documentElement;
        return {
          scrollW: de.scrollWidth, clientW: de.clientWidth,
          row: box('#panel-spectral-row'), panel: box('#panel-spectral-summary'),
          table: box('#spectral-summary-table table'), dirTh: box('#spectral-summary-table th:last-child'),
          badge: box('#panel-spectral-summary > .panel-info-toggle, #panel-spectral-summary > .widget-help > summary')
        };
      });
      log(w, JSON.stringify(m));
      seen[w] = m.scrollW;
      assert.equal(m.clientW, w, `layout width at ${w} px`);
      assert.ok(m.scrollW <= m.clientW, `${w} px: page is ${m.scrollW} px wide, scrolls sideways`);
      // (At 375 the panel's min-content runs 4 px into the row's gutter, as
      // on main; it stays on screen, which is what matters.)
      assert.ok(m.panel.right <= w, `${w} px: Wave Spectra panel ends at ${m.panel.right} (row ${m.row.right})`);
      assert.ok(m.table.right <= m.panel.right && m.dirTh.right <= m.panel.right, `${w} px: table ends at ${m.table.right}, panel at ${m.panel.right}`);
      assert.ok(m.badge.right <= w, `${w} px: help badge ends at ${m.badge.right}, past the screen`);
      if (w === 390) {
        await ctx.state(() => document.getElementById('panel-spectral-summary').scrollIntoView());
        await ctx.screenshot('spectral-390');
      }
    }
    ctx.metric('docScrollWidth', seen);
  }
};
