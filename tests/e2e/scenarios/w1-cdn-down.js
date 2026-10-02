// C03 / C04: third-party scripts failing must not cost the forecast. Here
// Leaflet fails to load (vendored copy 404s; the CDN is blocked too) and
// every Firebase script fails. The old boot threw "L is not defined" before
// any data request, and waited ~15 s on Firebase. Now the maps are skipped,
// the surf log degrades to local storage in the background, and both the
// main page and Choc TV load the forecast in seconds.
'use strict';

module.exports = {
  name: 'Leaflet and Firebase both down: forecast and Choc TV still load fast',
  options: {
    viewport: { width: 1280, height: 900 },
    net: { leaflet: 'abort', firebase: 'abort' }
  },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/vendor/leaflet/leaflet.js', null);
    ctx.serve('/vendor/leaflet/leaflet.css', null);
    // firebase-config.js can't run without the SDK (the security workstream
    // owns that file); its throw must not take the forecast down with it.
    ctx.allowPageError(/firebase is not defined/);

    await ctx.open('/');
    const chartMs = await ctx.waitForChart({ timeout: 20000 });
    ctx.metric('mainTimeToChartMs', chartMs);
    log(`main: chart ${chartMs} ms with no Leaflet and no Firebase`);
    assert.ok(chartMs < 5000, `chart took ${chartMs} ms`);
    const loadMs = await ctx.waitForLoad({ timeout: 20000 });
    assert.ok(loadMs < 5000, `load took ${loadMs} ms`);
    assert.equal(await ctx.state(() => typeof L), 'undefined');
    assert.match(await page.textContent('#header-update-time'), /^Updated /);
    assert.deepEqual(ctx.pageErrors.map(e => e.message).filter(m => !/firebase is not defined/.test(m)), []);

    await ctx.open('/?kiosk=1');
    const kioskMs = await ctx.waitForLoad({ timeout: 20000 });
    ctx.metric('kioskTimeToLoadMs', kioskMs);
    const status = await ctx.waitFor(() => {
      const t = document.getElementById('kiosk-status-updated');
      return t && /^updated/i.test(t.textContent) && t.textContent;
    }, { timeout: 10000, label: 'kiosk status updated' });
    log(`kiosk: load ${kioskMs} ms, status "${status.value}"`);
    assert.ok(kioskMs < 5000, `kiosk load took ${kioskMs} ms`);
    assert.equal(await ctx.state(() => _loadGen), 1, 'Choc TV loaded once');
    await ctx.screenshot('kiosk-no-cdn');
  }
};
