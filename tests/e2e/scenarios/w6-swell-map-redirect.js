// The Sound Check pages (research/index.html, research/map.html) live inside the site: the Forecast tab's map, Explore
// and Methods frame them. Opened on their own (a shared link, a bookmark, a search result), they send the visitor to
// the site instead. Inside the site's tabs they stay put.
// Browser tests drive the research pages on their own (navigator.webdriver), so this scenario hides that flag to
// see what a visitor sees.
'use strict';

const sp = (s) => String(s).replace(/ /g, ' ');

module.exports = {
  name: 'Sound Check: opened on its own, it sends the visitor to the site; framed in the tabs, it stays',
  options: { viewport: { width: 1180, height: 900 }, gate: null, timeoutMs: 120000 },
  async run({ page, ctx, assert, log }) {
    await ctx.context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    });
    const atSite = () => page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });

    // ── On their own: both research pages go to the site ──
    for (const p of ['/research/index.html', '/research/index.html?view=methods&theme=light', '/research/map.html?view=map&fill=1&ui=forecast']) {
      await ctx.open(p);
      await atSite();
      await ctx.waitFor(() => window.CLEAN && window.CLEAN.ready, { label: 'the site' });
      log('opened', p, '→', sp(page.url()));
      assert.equal(new URL(page.url()).pathname, '/', p + ' sends the visitor to the site');
    }
    await ctx.screenshot('redirected-to-site');

    // ── Inside the site: Methods and the Forecast tab's map stay on the research pages ──
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && window.CLEAN.ready, { label: 'the site' });
    await page.evaluate(() => window.CLEAN.show('methods'));
    await ctx.waitFor(() => {
      const f = document.querySelector('#cl-view-methods iframe');
      try { return f && f.contentWindow && f.contentWindow.CHOC && f.contentWindow.CHOC.D; } catch (_) { return false; }
    }, { label: 'Methods frame ready', timeout: 60000 });
    await page.waitForTimeout(1500);   // a redirect would have fired by now
    const framed = await page.evaluate(() => [...document.querySelectorAll('iframe')]
      .map((f) => { try { return f.contentWindow.location.pathname; } catch (_) { return null; } }));
    log('framed', JSON.stringify(framed));
    assert.equal(new URL(page.url()).pathname, '/', 'the site itself stays');
    assert.ok(framed.includes('/research/index.html'), 'Methods still shows the research page');
    assert.ok(framed.includes('/research/map.html'), "the Forecast tab's map still shows research/map.html");
    await ctx.screenshot('methods-framed');
  }
};
