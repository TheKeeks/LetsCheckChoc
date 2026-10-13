// The candidate front door (?preview=site): Sound Check split into Home (this week's forecast, tide, wind), Map
// (full height, every layer and the timeline) and Methods (how it works, what it found), with Log handing off to
// the app's surf log. Without ?site=1 the Sound Check page keeps its one long layout (the app's tab frames it so).
'use strict';

module.exports = {
  name: 'Site: Home, Map and Methods pages, with the tide and the wind on Home',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // ?preview=site on the main page lands on the site's Home
    await ctx.open('/index.html?preview=site');
    await page.waitForURL(/research\/index\.html\?site=1/, { timeout: 15000 });
    await page.waitForFunction(() => window.CHOC_SITE && window.CHOC_SITE.page && window.CHOC_SITE.tide && window.CHOC_SITE.wind, null, { timeout: 30000 });
    const st = await page.evaluate(() => ({
      page: window.CHOC_SITE.page(), tabs: [...document.querySelectorAll('.site-tab')].map(a => a.textContent + (a.getAttribute('aria-current') ? '*' : '')),
      visible: [...document.querySelectorAll('.site-page')].filter(p => !p.hidden).map(p => p.id),
      homeHas: ['week-h', 'fcDays', 'tide-h', 'wind-h'].filter(id => document.getElementById(id) && document.getElementById(id).closest('#pg-home')),
      tide: window.CHOC_SITE.tide, wind: window.CHOC_SITE.wind, now: document.getElementById('windNow').textContent,
      log: document.querySelector('.site-tab:not([data-p])').getAttribute('href')
    }));
    log(JSON.stringify(st));
    assert.equal(st.page, 'home');
    assert.deepEqual(st.tabs, ['Home*', 'Map', 'Methods', 'Log']);
    assert.deepEqual(st.visible, ['pg-home']);
    assert.deepEqual(st.homeHas, ['week-h', 'fcDays', 'tide-h', 'wind-h'], 'Home holds the forecast, the tide and the wind');
    assert.ok(st.tide.points > 100 && st.tide.events >= 4, 'three days of tide with highs and lows');
    assert.ok(st.wind.hours >= 24, 'wind hour by hour');
    assert.match(st.now, /^\d+ kn from the [NESW]{1,3} \(\d+°\)/);
    assert.equal(st.log, '../index.html#log');
    await page.waitForFunction(() => document.querySelector('#fcDays tr'), null, { timeout: 20000 });
    await ctx.screenshot('site-home');

    // Map: the map alone, as tall as the screen
    await page.click('.site-tab[data-p="map"]');
    const map = await page.evaluate(() => ({ page: window.CHOC_SITE.page(), hash: location.hash, h: document.getElementById('tripStage').getBoundingClientRect().height, layers: !!document.getElementById('hubLayers') }));
    log(JSON.stringify(map));
    assert.deepEqual([map.page, map.hash], ['map', '#map']);
    assert.ok(map.h > 600, `the map fills the screen (${map.h}px)`);
    await page.waitForTimeout(1500);
    await ctx.screenshot('site-map');

    // Methods: the findings; an in-page link to the map from there opens the Map page
    await page.click('.site-tab[data-p="methods"]');
    const m = await page.evaluate(() => ({ page: window.CHOC_SITE.page(), h1: document.querySelector('#pg-methods h1').textContent,
      has: ['how-h', 'q1-h', 'q2-h', 'dec-h', 'wild-h', 'skill-h', 'fcScore'].filter(id => document.getElementById(id) && document.getElementById(id).closest('#pg-methods')) }));
    assert.equal(m.page, 'methods'); assert.equal(m.h1, 'How it works');
    assert.deepEqual(m.has, ['how-h', 'q1-h', 'q2-h', 'dec-h', 'wild-h', 'skill-h', 'fcScore']);
    await ctx.screenshot('site-methods');
    await page.evaluate(() => window.CHOC.showPast && window.CHOC.showPast('2025-08-22'));
    await page.waitForTimeout(500);
    log('after Show the ocean that day: ' + await page.evaluate(() => window.CHOC_SITE.page()));
    assert.equal(await page.evaluate(() => window.CHOC_SITE.page()), 'map', 'a day picked in Methods opens on the Map page');

    // Back goes back to Methods; deep link to a section opens its page
    await page.goBack(); await page.waitForTimeout(300);
    await ctx.open('/research/index.html?site=1&classic=1#q2-h');   // classic=1 only so the runner leaves the hash alone
    await page.waitForFunction(() => window.CHOC_SITE && window.CHOC_SITE.page() === 'methods', null, { timeout: 15000 });

    // Without ?site=1: the old single page, no nav
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.site-nav') || document.body).display === 'none' || !document.querySelector('.site-nav')), true);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.site-page').length), 0);
    assert.deepEqual(errors, [], 'no page errors');
  }
};
