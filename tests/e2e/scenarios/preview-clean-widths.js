// Default look on the common iPhone widths (375, 390, 393 and 414 px), the port of w5-phone-widths.js: nothing pans
// sideways on any tab (Forecast, Explore, Methods, Log, My ratings), in My ratings' Details and session pages, or
// in Settings and its two pages, with a fresh load at each width (no zoom carried over). Measured against the layout
// width (clientWidth: under isMobile Chromium widens innerWidth to the content, which hides sideways scroll), on the
// page itself and on the framed pages a tab shows (the Forecast map, Explore's map page and its research page,
// Methods' research page), which pan inside the tab just the same.
'use strict';

const WIDTHS = [375, 390, 393, 414];
const cond = (h, p, d, ws, wd, th, tr) => ({
  swell: { height: h, period: p, direction: d },
  wind: { speed: ws, direction: wd },
  tide: { height: th, rate: tr, stage: tr >= 0 ? 'rising' : 'falling', timeToNearest: 1.2 },
  source: 'openmeteo-archive'
});
// Thirteen sessions of the signed-in surfer (google-1: My ratings is trained and has its Details) and Bob's.
const LOGS = [];
for (let i = 0; i < 13; i++) {
  const day = String(5 + i).padStart(2, '0');
  LOGS.push({ id: 'own-' + i, userId: 'google-1', displayName: 'Test Surfer', timestamp: `2026-09-${day}T0${6 + (i % 3)}:30`, createdAt: `2026-09-${day}T09:00`,
    ratings: { size: 2 + (i * 7) % 8, windQuality: 3 + (i * 5) % 7, rideQuality: 2 + (i * 3) % 8 },
    notes: 'Session ' + i + ': long period lines wrapping in on the push, a few sets overhead at the peak of the tide', photos: [],
    conditions: cond(1 + (i * 37 % 30) / 10, 6 + (i * 5) % 7, 115 + (i * 13) % 50, 2 + (i * 7) % 15, (i * 47) % 360, -0.4 + (i * 0.3) % 3, -0.6 + (i * 0.17) % 1.2) });
}
LOGS.push({ id: 'bob-1', userId: 'crewB', displayName: 'Bob Crew', timestamp: '2026-09-26T08:00', createdAt: '2026-09-26T08:00',
  ratings: { size: 4, windQuality: 6, rideQuality: 6 }, notes: 'Fun lefts on the push', photos: [], conditions: cond(1.8, 8, 130, 6, 330, 0.8, -0.4) });

// The frames each tab shows (by URL), measured while that tab is on screen.
const FRAMES = {
  forecast: /research\/map\.html\?view=map/,
  map: /map\/index\.html\?embed=1|research\/index\.html\?view=map&fill=1&ui=explore/,
  methods: /research\/index\.html\?view=methods/
};

module.exports = {
  name: 'clean phone widths 375–414 px: no sideways scroll on any tab, sub-page or Settings, nor inside the tabs\' frames',
  options: {
    viewport: { width: 390, height: 844 },
    timeoutMs: 180000,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
    firebase: { mode: 'google', logs: LOGS }
  },
  async run({ page, ctx, assert, log }) {
    // The Sound Check model run moved to the fixture day (tests/fixtures/README.md)
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    const problems = [], seen = {};
    const measure = async (w, where, frames) => {
      const m = await ctx.state(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      seen[w][where] = m.sw;
      if (m.cw !== w) problems.push(`${w} px ${where}: layout width ${m.cw}`);
      if (m.sw > m.cw) problems.push(`${w} px ${where}: the page is ${m.sw} px wide in ${m.cw}, it scrolls sideways`);
      if (!frames) return;
      const fr = page.frames().filter((f) => frames.test(f.url()));
      if (!fr.length) problems.push(`${w} px ${where}: its frame isn't up`);
      for (const f of fr) {
        const r = await f.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        const name = f.url().replace(/^https?:\/\/[^/]+\//, '').split('&theme')[0];
        if (r.cw < 1 || r.sw > r.cw) problems.push(`${w} px ${where}: frame ${name} is ${r.sw} px wide in ${r.cw}, it scrolls sideways`);
      }
    };
    // Sub-pages close through history.back(), one popstate each: close them one at a time.
    const closeSubs = async () => {
      for (let d = await ctx.state(() => CLEAN.sub.depth()); d > 0; d--) {
        await ctx.state(() => CLEAN.sub.close());
        await ctx.waitFor((n) => CLEAN.sub.depth() < n, { arg: d, label: 'sub-page closed' });
      }
    };
    const tab = async (t) => {
      await closeSubs();
      await page.locator(`#cl-app .cl-tabs .cl-tab[data-tab="${t}"]`).click();
      await ctx.waitFor((id) => CLEAN.tab() === id, { arg: t, label: 'tab ' + t });
    };

    for (const w of WIDTHS) {
      seen[w] = {};
      await page.setViewportSize({ width: w, height: 844 });
      await ctx.open('/?preview=clean');   // fresh load at this width
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean look' });
      await ctx.waitForLoad();
      await ctx.waitFor(() => window._fbUserId === 'google-1' && STATE._lastFitAt && STATE.surfLog.length === 14, { label: 'signed in, log loaded, model trained' });
      await ctx.waitFor(() => CLEAN.forecastInfo().fc === 'ok' && CLEAN.forecastInfo().map.status === 'ready', { timeout: 45000, label: 'Forecast and its map' });
      await page.waitForTimeout(400);
      await measure(w, 'Forecast', FRAMES.forecast);

      await tab('map');
      await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const x = f && f.contentWindow; const r = x && x.document.getElementById('explorerFrame'); const c = r && r.contentWindow && r.contentWindow.CHOC;
        return !!(c && c.trip && c.trip.state.phase === 'past' && r.contentDocument.querySelector('#exDock #decHeat svg')); }, { timeout: 45000, label: 'Explore on past days' });
      await page.waitForTimeout(500);
      await measure(w, 'Explore', FRAMES.map);
      if (w === 375) await ctx.screenshot('explore-375');

      await tab('methods');
      await ctx.waitFor(() => { const f = document.querySelector('#cl-view-methods iframe'); const c = f && f.contentWindow && f.contentWindow.CHOC; return !!(c && f.contentDocument.querySelector('#decHeat svg')); }, { timeout: 45000, label: 'Methods up' });
      await page.waitForTimeout(500);
      await measure(w, 'Methods', FRAMES.methods);

      await tab('log');
      await ctx.waitFor(() => !document.querySelector('#cl-view-log .cl-l-form').hidden && document.querySelectorAll('#cl-view-log .cl-l-ss').length === 14, { label: 'Log form and sessions' });
      await measure(w, 'Log');
      await page.locator('#cl-view-log [data-act="other"]').click();
      await page.locator('#cl-view-log [data-act="day"][data-k="older"]').click();
      await measure(w, 'Log › Other › Older');
      if (w === 375) await ctx.screenshot('log-375');
      await page.locator('#cl-view-log [data-act="now"]').click();

      await tab('model');
      await ctx.waitFor(() => document.querySelector('#cl-view-model [data-act="detail"]'), { label: 'My ratings, trained' });
      await measure(w, 'My ratings');
      await page.locator('#cl-view-model [data-act="detail"]').click();
      await ctx.waitFor(() => document.querySelector('#cl-sub-model-detail .reg-feature-mini-canvas'), { label: 'Details' });
      await page.waitForTimeout(300);
      await measure(w, 'My ratings › Details');
      // a session, as a tap on its dot opens it (the drill-down the charts call)
      await ctx.state(() => openRegressionDrilldown(STATE.surfLog.find((e) => e.id === 'bob-1'), 'wave'));
      await ctx.waitFor(() => document.querySelector('#cl-sub-model-session #reg-drilldown-inner'), { label: 'a session page' });
      await measure(w, 'My ratings › Details › session');

      await tab('forecast');
      await page.locator('#cl-settings-btn').click();
      await ctx.waitFor(() => document.querySelector('#cl-sub-settings [data-src]'), { label: 'Settings' });
      await measure(w, 'Settings');
      for (const [act, id] of [['model', 'model-picker'], ['spot', 'spot']]) {
        await page.locator(`#cl-sub-settings [data-act="${act}"]`).click();
        await ctx.waitFor((i) => document.querySelector('#cl-sub-' + i + ' .cl-sr'), { arg: id, label: 'Settings › ' + id });
        await measure(w, 'Settings › ' + id);
        await ctx.state(() => CLEAN.sub.close());
        await ctx.waitFor(() => CLEAN.sub.depth() === 1 && !document.querySelector('#cl-sub-settings').hidden, { label: 'back to Settings' });
      }
      await closeSubs();
      log(w, JSON.stringify(seen[w]));
    }
    ctx.metric('docScrollWidth', seen);
    log(problems.length ? 'PROBLEMS:\n      ' + problems.join('\n      ') : 'nothing pans sideways');
    assert.deepEqual(problems, [], `${problems.length} sideways scroll(s)`);
    assert.deepEqual(await ctx.state(() => CLEAN.errors.map((e) => e.where + ': ' + e.message)), [], 'CLEAN.errors');
  }
};
