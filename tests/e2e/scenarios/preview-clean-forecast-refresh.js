// Default look, Forecast tab: ↻ in the header, next to Settings, fetches
// everything the tab shows again, now (fixture day, Thu 1 Oct 2026 11:00 ET):
//   • the Sound Check run, past GitHub's 5-minute cache: a newer one goes up
//     on the tab and on its map (the map frame keeps its own copy; the tab
//     tells it to ask too);
//   • the wind, tides and buoy (the app's load), and the buoy check's
//     earlier forecasts at the buoy.
// For 8 s the header says what came of it, in place of the date: "New
// forecast: run …", "Up to date: run …", none published, or GitHub
// unreachable. A second tap while it asks asks nothing more. The button is
// on the Forecast tab only, on a phone and on the iPad.
'use strict';

const LIVE = 'https://raw.githubusercontent.com/TheKeeks/LetsCheckChoc/fc-data/fc/';
// GitHub's copy: this run, and the field images that ship with research/ (the map draws them)
const serveLive = (run, delayMs) => (url) => {
  const name = url.slice(LIVE.length).split('?')[0];
  if (name === 'fc.json') return { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, json: run, delayMs: delayMs || 0 };
  if (/^field_[a-z_]+\.png$/.test(name)) return { status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, file: '../../research/fc/' + name };
  return { status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' };
};

module.exports = {
  name: 'clean forecast ↻: the header refresh brings a newer run to the tab and its map, reloads the data, and says what it found',
  options: { viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  async run({ page, ctx, assert, log }) {
    const ship = JSON.parse(ctx.fixture('soundcheck/fc.json'));          // made 10:30 AM, covers now
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(ship) });
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok' && CLEAN.forecastInfo().map.status === 'ready', { label: 'the forecast and its map' });
    await ctx.waitForLoad();
    const mapFrame = () => page.frames().find(f => /research\/map\.html/.test(f.url()));
    await mapFrame().waitForFunction(m => window.CHOC && CHOC.trip && CHOC.trip.fc.d && CHOC.trip.fc.d.made === m, ship.made, { timeout: 20000 });
    const hd = () => ctx.state(() => {
      const b = document.getElementById('cl-refresh-btn');
      return {
        shown: !!b && !b.hidden && b.offsetParent !== null,
        inHeader: !!b && !!b.closest('#cl-hd'),
        label: b && b.getAttribute('aria-label'),
        busy: b && b.getAttribute('aria-busy'),
        sub: document.getElementById('cl-subtitle').textContent.replace(/\u00a0/g, ' '),   // times keep "10:50 AM" together
        num: (document.querySelector('#cl-view-forecast .cl-f-num') || {}).textContent || null,
        made: CLEAN.forecastInfo().made
      };
    });
    const tap = () => page.locator('#cl-refresh-btn').click();
    const said = (re, label) => ctx.waitFor(s => new RegExp(s).test(document.getElementById('cl-subtitle').textContent.replace(/\u00a0/g, ' ')), { arg: re.source, label });

    let h = await hd();
    log('before', JSON.stringify(h));
    const date = h.sub;
    assert.equal(h.shown, true, '↻ shows on the Forecast tab');
    assert.equal(h.inHeader, true, 'in the header');
    assert.equal(h.label, 'Refresh the forecast');
    assert.equal(h.made, ship.made);
    assert.equal(h.num, '0.5', 'the shipped run: 0.5 ft at Choc now');
    assert.equal(date, 'Thu 1 Oct', 'the header shows the date');

    // ── A newer run on GitHub: it goes up on the tab and on its map; the data loads again ──
    const live = JSON.parse(JSON.stringify(ship));
    live.made = '2026-10-01T14:50Z';
    live.gfs.forEach(g => { g.choc = Math.round((g.choc + 2) * 10) / 10; });
    live.ec.forEach(e => { e.choc = Math.round((e.choc + 2) * 10) / 10; });
    ctx.net.fcLive = serveLive(live, 1500);                 // slow enough to see it ask, and to tap again meanwhile
    const n0 = {
      live: ctx.requestsTo(/fc-data\/fc\/fc\.json/).length,
      tides: ctx.requestsTo('api.tidesandcurrents.noaa.gov').length,
      prev: ctx.requestsTo('previous_day').length,
      load: await ctx.state(() => STATE.lastLoadCompletedAt)
    };
    await tap();
    await said(/^Checking for a newer forecast…$/, 'checking');
    h = await hd();
    assert.equal(h.busy, 'true', 'busy while it asks');
    await tap();                                             // a second tap while it asks
    await said(/^New forecast/, 'new run');
    h = await hd();
    log('new', JSON.stringify(h));
    assert.equal(h.sub, 'New forecast: run 10:50 AM');
    assert.equal(h.busy, 'false');
    assert.equal(h.made, live.made, 'the newer run is the tab\'s');
    assert.equal(h.num, '2.5', 'and its number: 2.5 ft at Choc now');
    await mapFrame().waitForFunction(m => CHOC.trip.fc.d && CHOC.trip.fc.d.made === m, live.made, { timeout: 10000 });
    const asks = ctx.requestsTo(/fc-data\/fc\/fc\.json/).slice(n0.live);
    log('asks', JSON.stringify(asks.map(r => r.url)));
    assert.equal(asks.length, 2, 'one ask from the tab and one from its map, however many taps');
    assert.ok(asks.every(r => /fc\.json\?t=\d+$/.test(r.url)), 'past GitHub\'s cache');
    assert.ok(ctx.requestsTo('field_gfs_reg.png?m=' + encodeURIComponent(live.made)).length, 'the map drew the new run\'s fields');
    await ctx.waitFor(l0 => STATE.lastLoadCompletedAt > l0, { arg: n0.load, label: 'the wind, tides and buoy loaded again' });
    assert.ok(ctx.requestsTo('api.tidesandcurrents.noaa.gov').length > n0.tides, 'the tides asked again');
    await ctx.waitFor(p => CLEAN.forecastInfo().prev === 'ok', { label: 'earlier forecasts back' });
    assert.ok(ctx.requestsTo('previous_day').length > n0.prev, 'the buoy check\'s earlier forecasts asked again');
    assert.deepEqual(await ctx.state(() => CLEAN.errors.map(e => e.where + ': ' + e.message)), []);
    await ctx.screenshot('refresh-new');

    // ── The same run again ──
    ctx.net.fcLive = serveLive(live);
    await tap();
    await said(/^Up to date/, 'up to date');
    assert.equal((await hd()).sub, 'Up to date: run 10:50 AM');

    // ── GitHub doesn't answer; has nothing published ──
    ctx.net.fcLive = 'abort';
    await tap();
    await said(/^Couldn’t reach GitHub$/, 'unreachable');
    ctx.net.fcLive = 'none';
    await tap();
    await said(/^No forecast published on GitHub yet$/, 'none published');
    h = await hd();
    assert.equal(h.made, live.made, 'the run on show stays');
    ctx.net.fcLive = serveLive(live);

    // ── 8 s later the date is back ──
    await page.clock.fastForward(9000);
    await said(new RegExp('^' + date + '$'), 'the date again');

    // ── Forecast tab only ──
    await ctx.state(() => CLEAN.show('log'));
    assert.equal((await hd()).shown, false, 'no ↻ on Log');
    await ctx.state(() => CLEAN.show('map'));
    assert.equal((await hd()).shown, false, 'nor on Explore');
    await ctx.state(() => CLEAN.show('forecast'));
    assert.equal((await hd()).shown, true, 'back on Forecast');

    // ── The iPad: the same place ──
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForTimeout(200);
    h = await hd();
    assert.equal(h.shown && h.inHeader, true, '↻ in the header on the iPad');
    const box = await page.locator('#cl-refresh-btn').boundingBox(), gear = await page.locator('#cl-settings-btn').boundingBox();
    assert.ok(box && gear && Math.abs(box.y - gear.y) < 2 && box.x < gear.x, 'beside Settings, to its left');
    await ctx.screenshot('refresh-ipad');
  }
};
