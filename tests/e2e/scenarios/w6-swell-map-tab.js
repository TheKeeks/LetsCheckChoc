// The Swell Map tab: the research page (research/) opens in a frame on first
// click only (it is large: sea-floor tiles and forecast fields), its map boots
// on the forecast with no errors, and the four tabs fit a 375 px phone.
'use strict';

module.exports = {
  name: 'Swell Map tab: research page loads on first open, tabs fit a phone',
  options: { viewport: { width: 375, height: 812 }, contextOptions: { isMobile: true, hasTouch: true } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitFor(() => STATE.selectedBuoy && STATE.selectedBuoy.id, { label: 'buoy selected' });

    // Nothing from research/ loads until the tab is opened.
    assert.equal(await page.getAttribute('#research-frame', 'src'), null, 'frame starts empty');
    assert.equal(ctx.requests.filter(r => r.url.includes('/research/')).length, 0, 'no research/ requests before the tab opens');

    // The tab bar fits the phone.
    const bar = await page.evaluate(() => { const b = document.getElementById('tab-bar'); return { sw: b.scrollWidth, cw: b.clientWidth, page: document.documentElement.scrollWidth, vw: innerWidth }; });
    assert.ok(bar.sw <= bar.cw + 1, `tab bar overflows (${bar.sw} > ${bar.cw})`);
    assert.ok(bar.page <= bar.vw, `page wider than the screen (${bar.page} > ${bar.vw})`);

    await page.click('#tab-btn-research');
    assert.ok(await page.isVisible('#view-research'), 'Swell Map view shown');
    assert.ok(!(await page.isVisible('#view-forecast')), 'forecast view hidden');
    assert.equal(await page.getAttribute('#research-frame', 'src'), 'research/index.html');

    const frame = page.frame({ url: /\/research\/index\.html$/ }) || (await (await page.$('#research-frame')).contentFrame());
    assert.ok(frame, 'research frame attached');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await frame.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });
    const st = await frame.evaluate(() => ({ phase: window.CHOC.trip.state.phase, hud: document.getElementById('tripPhase').textContent }));
    log(`swell map: ${st.phase} · ${st.hud}`);
    assert.equal(st.phase, 'week', 'opens on the forecast');
    assert.match(st.hud, /Choc \d/);
    const frameErrors = await frame.evaluate(() => window.__errs || []);
    assert.deepEqual(errors.concat(frameErrors), [], 'no page errors');

    // Switching back leaves the loaded frame alone (no reload on the next visit).
    await page.click('#tab-btn-forecast');
    await page.click('#tab-btn-research');
    assert.equal(await page.getAttribute('#research-frame', 'src'), 'research/index.html');
    await ctx.screenshot('swell-map-tab');
  }
};
