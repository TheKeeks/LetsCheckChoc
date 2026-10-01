// C09: switching from Chocomount to another spectral buoy (44025 Long
// Island) used to show Block Island 44097's spectrum, swell table and
// compass rose under 44025's name. With no NDBC relay, 44025 now shows an
// honest empty state, and no 44097 number appears on its swell card.
'use strict';

module.exports = {
  name: 'non-Choc spectral buoy: honest empty state, no 44097 data',
  options: { viewport: { width: 1280, height: 900 } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitForLoad({ timeout: 15000 });
    const first = await ctx.state(() => STATE.lastLoadCompletedAt);
    assert.equal(await ctx.state(() => STATE.lastSpectral && STATE.lastSpectral.bins.length), 98, 'Choc spectrum first');

    await ctx.state(() => selectBuoy(STATE.buoys.find(b => b.id === '44025')));
    await ctx.waitFor(t => STATE.lastLoadCompletedAt !== t && STATE.selectedBuoy.id === '44025',
      { arg: first, timeout: 15000, label: '44025 load complete' });

    const s = await ctx.state(() => {
      const visible = node => !!node && getComputedStyle(node).display !== 'none' && node.offsetParent !== null;
      const msg = document.querySelector('#compass-canvas ~ .spectral-empty-msg, .chart-container-sq .spectral-empty-msg');
      return {
        header: document.getElementById('header-location').textContent,
        compassCanvasVisible: visible(document.getElementById('compass-canvas')),
        msg: msg && msg.textContent,
        msgVisible: visible(msg),
        summaryPanelVisible: visible(document.getElementById('panel-spectral-summary')),
        compassFooter: document.getElementById('footer-compass').textContent,
        swell: document.getElementById('val-swell-height').textContent,
        swellDetail: document.getElementById('val-swell-detail').textContent,
        swellFooter: document.getElementById('footer-swell').textContent,
        lastSpectral: STATE.lastSpectral,
        lastSpecSummary: STATE.lastSpecSummary,
        buoyHealth: STATE.dataHealth && STATE.dataHealth.buoy
      };
    });
    log(JSON.stringify(s));
    assert.match(s.header, /44025 Long Island, NY/);
    assert.equal(s.compassCanvasVisible, false, 'no rose drawn for 44025');
    assert.ok(s.msgVisible, 'empty-state message visible');
    assert.match(s.msg, /^No live spectrum for 44025: NDBC doesn't allow browser requests and no relay is set up\./);
    assert.equal(s.summaryPanelVisible, false, 'no 44097 swell table');
    assert.equal(s.compassFooter, 'ndbc 44025 · no spectral data currently available');
    assert.doesNotMatch(s.compassFooter, /pipeline fallback/);
    assert.equal(s.lastSpectral, null);
    assert.equal(s.lastSpecSummary, null);
    assert.notEqual(s.swell, '2.0 ft', 'no 44097 WVHT on the card');
    assert.doesNotMatch(s.swellFooter, /44097|ndbc/i, 'swell card says where its number is from');
    assert.deepEqual(s.buoyHealth, { obsMs: null, origin: 'failed' });
    assert.deepEqual([...new Set(ctx.unhandled)], []);
    await page.evaluate(() => document.getElementById('panel-spectral-row').scrollIntoView());
    await ctx.screenshot('44025-spectral');
  }
};
