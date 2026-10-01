// Review ux#1 / live#1: on Choc TV the Wave Spectra table grew past its
// panel (612 px in a 554 px panel at 1180x820) once the row labels became
// "Swell (NDBC 10 s split)". The panel clips (overflow: hidden), so the
// wall screen showed "Direct", "SE  (" and "ESE": the swell direction, the
// reading that matters most at Choc, was the part cut off. The table, its
// Direction header and every direction cell must sit inside
// #panel-spectral-summary on the iPad Air (1180x820) and the older
// 1024x768 iPads.
'use strict';

const SIZES = [[1180, 820], [1024, 768]];

module.exports = {
  name: 'kiosk spectral panel: the whole table, Direction column included, fits its panel',
  options: {
    viewport: { width: 1180, height: 820 },
    gate: null,   // kiosk.js seeds the gate itself
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
  },
  async run({ page, ctx, assert, log }) {
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await ctx.open('/?kiosk=1&kioskRotate=100000');
      await ctx.waitFor(() => document.body.classList.contains('kiosk'), { label: 'body.kiosk' });
      await ctx.waitForLoad();
      await ctx.waitFor(() => document.querySelector('#spectral-summary-table table'), { label: 'Wave Spectra table' });
      await ctx.state(() => kioskShowPanel('spectral'));
      await page.waitForTimeout(600);

      const m = await ctx.state(() => {
        const panel = document.getElementById('panel-spectral-summary');
        const pr = panel.getBoundingClientRect();
        const inner = Math.round(pr.right - parseFloat(getComputedStyle(panel).borderRightWidth));
        const right = e => Math.round(e.getBoundingClientRect().right);
        return {
          overflow: getComputedStyle(panel).overflowX,
          panelRight: inner,
          table: right(document.querySelector('#spectral-summary-table table')),
          dirTh: right(document.querySelector('#spectral-summary-table th:last-child')),
          dirCells: [...document.querySelectorAll('#spectral-summary-table td:last-child')].map(right),
          dirText: [...document.querySelectorAll('#spectral-summary-table td:last-child')].map(td => td.textContent)
        };
      });
      log(`${w}x${h}`, JSON.stringify(m));
      assert.ok(m.table <= m.panelRight, `${w}x${h}: table ends at ${m.table}, panel clips at ${m.panelRight}`);
      assert.ok(m.dirTh <= m.panelRight, `${w}x${h}: Direction header ends at ${m.dirTh}, panel clips at ${m.panelRight}`);
      for (const r of m.dirCells) assert.ok(r <= m.panelRight, `${w}x${h}: a direction cell ends at ${r}, panel clips at ${m.panelRight}`);
      assert.match(m.dirText[0], /\(\d+°\)$/, 'the swell row shows its direction in degrees');
      await ctx.screenshot(`spectral-${w}`);
    }
  }
};
