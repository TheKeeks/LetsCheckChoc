// Design previews: ?preview=<name> layers a candidate redesign
// (previews/<name>/theme.css + theme.js) over today's app so the owner can
// try it on a real phone and on Choc TV. Each preview must load, draw the
// forecast and the kiosk day cards without a page error, and the plain URL
// must never fetch anything from previews/.
'use strict';

const PREVIEWS = (process.env.E2E_PREVIEWS || 'shader-pack,one-instrument,chart-room,draft-paper,draft-navy').split(',');

module.exports = {
  name: 'design previews: each ?preview= look loads on the phone and Choc TV; the plain URL loads none',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitForChart();
    assert.equal(ctx.requestsTo('/previews/').length, 0, 'the plain URL loads no preview files');

    for (const name of PREVIEWS) {
      const before = ctx.requests.length;
      await ctx.open('/?preview=' + name);
      await ctx.waitForChart();
      const got = ctx.requests.slice(before).map(r => r.url);
      assert.ok(got.some(u => u.includes('/previews/' + name + '/theme.css')), name + ': theme.css requested');
      assert.ok(got.some(u => u.includes('/previews/' + name + '/theme.js')), name + ': theme.js requested');
      assert.equal(await ctx.state(() => LCC_PREVIEW), name);
      await ctx.screenshot('phone-' + name);

      const k0 = ctx.requests.length;
      await page.setViewportSize({ width: 1180, height: 820 });
      await ctx.open('/?kiosk=1&preview=' + name);
      await ctx.waitFor(() => /LOW|low/.test((document.getElementById('kiosk-days-1') || {}).innerText || ''),
        { label: name + ' kiosk day cards' });
      assert.ok(ctx.requests.slice(k0).some(r => r.url.includes('/previews/' + name + '/theme.js')), name + ': kiosk loads the preview');
      await ctx.screenshot('kiosk-' + name);
      await page.setViewportSize({ width: 390, height: 844 });
      log(name + ' ok');
    }

    // An unknown name is ignored rather than fetched.
    const u0 = ctx.requests.length;
    await ctx.open('/?preview=../../secrets');
    await ctx.waitForChart();
    assert.equal(ctx.requests.slice(u0).filter(r => r.url.includes('/previews/')).length, 0);
    assert.equal(await ctx.state(() => LCC_PREVIEW), null);
  }
};
