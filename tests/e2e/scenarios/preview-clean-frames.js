// Default look, the two heavy tabs on a phone (ported from the classic
// w6-swell-map-tab.js), against the fixtures (Thu 1 Oct 2026, 11:00 ET),
// signed in with Google so all five tabs show:
//   • Explore (map/index.html, which frames the Sound Check map's ten years)
//     and Methods (research/index.html) are big pages: their frames start
//     empty and nothing of theirs is fetched until their tab is first opened,
//     so a visit for the forecast never pays for them (the Forecast tab's own
//     map, research/map.html, does load at boot);
//   • opening a tab gives its frame its page; leaving the tab and coming back
//     keeps the page as it was (same address, no second load);
//   • the five tabs (Forecast, Explore, Methods, Log, My ratings) fit a
//     375 px phone side by side, each a full touch target, with no sideways
//     scroll.
'use strict';

const path = r => new URL(r.url).pathname;

module.exports = {
  name: 'clean frames: Explore and Methods load on first open only and stay loaded; five tabs fit 375 px',
  options: {
    viewport: { width: 375, height: 812 },
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    firebase: { mode: 'google', logs: [] },       // signed in as google-1: My ratings shows too
    timeoutMs: 120000
  },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    // A frame's src and the document in it; `mark` is a value this test leaves on the page's window: a reload loses it.
    const frame = tab => ctx.state(t => {
      const f = document.querySelector('#cl-view-' + t + ' iframe'), w = f && f.contentWindow;
      return { src: f ? f.getAttribute('src') : 'no frame', url: w ? w.location.pathname + w.location.search : null, mark: w ? w.__lccMark || null : null };
    }, tab);
    const loaded = (tab, re) => ctx.waitFor(([t, s]) => {
      const f = document.querySelector('#cl-view-' + t + ' iframe'), w = f && f.contentWindow;
      return !!(w && new RegExp(s).test(w.location.pathname) && f.contentDocument.readyState === 'complete');
    }, { arg: [tab, re], label: tab + ' frame loaded', timeout: 45000 });
    const mark = tab => ctx.state(t => { document.querySelector('#cl-view-' + t + ' iframe').contentWindow.__lccMark = 'first visit'; }, tab);
    const open = async tab => {
      await page.locator(`#cl-app .cl-tabs .cl-tab[data-tab="${tab}"]`).click();
      await ctx.waitFor(t => CLEAN.tab() === t, { arg: tab, label: 'tab ' + tab });
    };
    const explorePages = () => ctx.requests.filter(r => path(r).startsWith('/map/') || path(r) === '/research/index.html');
    const docs = () => ctx.requests.filter(r => r.type === 'document' && /^\/(map|research)\/index\.html$/.test(path(r))).map(r => path(r) + new URL(r.url).search);

    // ── Boot on Forecast: the heavy frames stay empty ──
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    await ctx.waitForLoad();
    await ctx.waitFor(() => CLEAN.forecastInfo().map.status === 'ready' && window._fbUserId === 'google-1', { label: 'Forecast map up, signed in', timeout: 30000 });
    await page.waitForTimeout(1500);   // idle: nothing should start loading the other tabs
    assert.equal((await frame('map')).src, null, 'Explore\'s frame starts empty');
    assert.equal((await frame('methods')).src, null, 'Methods\' frame starts empty');
    assert.deepEqual(explorePages().map(r => r.url), [], 'nothing from map/ or research/index.html before their tabs open');
    assert.ok(ctx.requestsTo(/\/research\/map\.html\?/).length >= 1, 'the Forecast tab\'s own map (research/map.html) loads');

    // ── Five tabs on a 375 px phone ──
    const bar = await ctx.state(() => {
      const nav = document.querySelector('#cl-app .cl-tabs'), de = document.documentElement;
      return {
        sw: nav.scrollWidth, cw: nav.clientWidth, page: de.scrollWidth, vw: de.clientWidth,
        tabs: [...nav.querySelectorAll('.cl-tab')].filter(b => !b.hidden).map(b => {
          const r = b.getBoundingClientRect();
          return { tab: b.textContent.trim(), left: r.left, right: r.right, w: Math.round(r.width), h: Math.round(r.height), clipped: b.scrollWidth > b.clientWidth };
        })
      };
    });
    log('tab bar', JSON.stringify(bar));
    assert.deepEqual(bar.tabs.map(t => t.tab), ['Forecast', 'Explore', 'Methods', 'Log', 'My ratings'], 'signed in: five tabs');
    assert.equal(bar.vw, 375);
    assert.ok(bar.sw <= bar.cw, `the tab bar scrolls sideways (${bar.sw} > ${bar.cw})`);
    assert.ok(bar.page <= bar.vw, `the page scrolls sideways (${bar.page} > ${bar.vw})`);
    for (const t of bar.tabs) {
      assert.ok(t.left >= 0 && t.right <= bar.vw, `${t.tab} is off the screen (${t.left}–${t.right})`);
      assert.ok(t.w >= 44 && t.h >= 44, `${t.tab} is ${t.w}×${t.h}, under a 44 px touch target`);
      assert.equal(t.clipped, false, `${t.tab}: its label is cut off`);
    }
    await ctx.screenshot('tabs-375');

    // ── First open: each frame gets its page, and only its own ──
    await open('map');
    assert.equal((await frame('map')).src, 'map/index.html?embed=1&theme=light');
    await loaded('map', '^/map/index\\.html$');
    // Explore's page frames the Sound Check map's past days (research/index.html?view=map) itself: let that start too
    await ctx.waitFor(() => {
      const r = document.querySelector('#cl-view-map iframe').contentDocument.getElementById('explorerFrame');
      return !!(r && r.contentWindow && r.contentWindow.location.pathname === '/research/index.html');
    }, { label: 'Explore\'s own research frame', timeout: 45000 });
    await mark('map');
    assert.equal((await frame('methods')).src, null, 'opening Explore leaves Methods empty');
    await open('methods');
    assert.equal((await frame('methods')).src, 'research/index.html?view=methods&theme=light');
    await loaded('methods', '^/research/index\\.html$');
    await mark('methods');
    const first = docs();
    log('pages after first opens', JSON.stringify(first));
    assert.equal(first.filter(p => p.startsWith('/map/index.html')).length, 1, 'Explore\'s page loaded once');
    assert.equal(first.filter(p => /view=methods/.test(p)).length, 1, 'Methods\' page loaded once');

    // ── Leave and come back: no reload ──
    const before = { map: await frame('map'), methods: await frame('methods') };
    for (const tab of ['forecast', 'map', 'forecast', 'methods']) {
      await open(tab);
      await page.waitForTimeout(600);
    }
    const after = { map: await frame('map'), methods: await frame('methods') };
    log('frames before', JSON.stringify(before), 'after', JSON.stringify(after));
    assert.deepEqual(after, before, 'the same pages, still on their first visit');
    assert.equal(after.map.mark, 'first visit');
    assert.equal(after.methods.mark, 'first visit');
    assert.deepEqual(docs(), first, 'no page was fetched again');
    await ctx.screenshot('methods-revisited');
    assert.deepEqual(await ctx.state(() => CLEAN.errors.map(e => e.where + ': ' + e.message)), [], 'CLEAN.errors');
  }
};
