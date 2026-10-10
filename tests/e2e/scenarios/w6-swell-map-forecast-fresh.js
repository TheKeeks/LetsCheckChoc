// Sound Check (research/): the 7-day forecast was a snapshot pulled by hand and committed with the page, so on
// Friday it still read "As of Wed Oct 7". .github/workflows/update-forecast.yml now pulls every model run and
// publishes it to the fc-data branch; the page reads that pull from raw.githubusercontent.com and shows the newer
// of it and the copy that ships with the page (research/fc/), taking the field images from the same place.
// ↻ Refresh (beside the as-of line) asks GitHub again without a reload: a newer pull replaces the one on show
// everywhere (map, timeline, 7-day table) and keeps the hour being looked at.
'use strict';

const LIVE = 'https://raw.githubusercontent.com/TheKeeks/LetsCheckChoc/fc-data/fc/';

module.exports = {
  name: 'Sound Check: the forecast comes from the latest pull, else the copy that ships with the page',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const shipped = JSON.parse(ctx.fixture('../../research/fc/fc.json'));
    const later = (iso, h) => new Date(Date.parse(iso.replace(/Z$/, ':00Z').replace(/(T\d\d)Z$/, '$1:00Z')) + h * 36e5).toISOString().slice(0, 16) + 'Z';
    // a pull made a day after the shipped copy (same numbers, so the page draws the same way)
    const fresh = Object.assign({}, shipped, { made: later(shipped.made, 24) });
    const pngs = [], asked = [];
    const serveLive = (live) => (url) => {
      asked.push(url.slice(LIVE.length));
      const name = url.slice(LIVE.length).split('?')[0];
      if (name === 'fc.json') return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }, json: live };
      if (/^field_[a-z_]+\.png$/.test(name)) { pngs.push(name); return { status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, file: '../../research/fc/' + name }; }
      return { status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' };
    };
    const asOf = () => page.$eval('#fcAsOf', n => n.textContent);
    const dayLabel = (iso) => new Date(Date.parse(iso.replace(/Z$/, ':00Z'))).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
    const loaded = () => page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.fc && window.CHOC.trip.fc.d, null, { timeout: 30000 });

    // 1. A newer pull is published: the page uses it, numbers and field images both.
    ctx.net.fcLive = serveLive(fresh);
    await ctx.open('/research/index.html');
    await loaded();
    const d1 = await page.evaluate(() => ({ made: window.CHOC.trip.fc.d.made, base: window.CHOC.trip.fc.d._base }));
    log(`shipped ${shipped.made}, published ${fresh.made} → page ${d1.made} from ${d1.base} · ${await asOf()}`);
    assert.deepEqual(d1, { made: fresh.made, base: LIVE }, 'the newer published pull wins');
    await page.waitForFunction(() => { const px = window.CHOC.trip.fc.px; return !!(px.gfs_reg && px.gfs_reg.w); }, null, { timeout: 15000 });
    assert.ok(pngs.includes('field_gfs_reg.png'), `field images come from the same pull (${pngs.join(', ')})`);
    const label = dayLabel(fresh.made);
    assert.ok((await asOf()).startsWith('As of ' + label), `the as-of line names the published pull (${label})`);
    await ctx.screenshot('forecast-fresh');

    // 2. The published pull is older than the shipped copy: the shipped copy wins.
    ctx.net.fcLive = serveLive(Object.assign({}, shipped, { made: later(shipped.made, -24) }));
    await ctx.open('/research/index.html');
    await loaded();
    assert.deepEqual(await page.evaluate(() => ({ made: window.CHOC.trip.fc.d.made, base: window.CHOC.trip.fc.d._base })), { made: shipped.made, base: 'fc/' }, 'an older pull does not replace a newer shipped copy');

    // 3. GitHub can't be reached: the shipped copy, with its real age.
    ctx.net.fcLive = 'abort';
    await ctx.open('/research/index.html');
    await loaded();
    assert.deepEqual(await page.evaluate(() => ({ made: window.CHOC.trip.fc.d.made, base: window.CHOC.trip.fc.d._base })), { made: shipped.made, base: 'fc/' }, 'falls back to the copy that ships with the page');

    // 4. ↻ Refresh, with a pull published since the page loaded (the 18Z runs a day and a half on, so its week starts
    //    30 h later): it goes up on the map, the timeline and the 7-day table, and the map stays on the hour on show.
    const next = Object.assign({}, shipped, { made: later(shipped.made, 30), runs: { gfs: '2026-10-10T18Z', ec: '2026-10-10T18Z' },
      gfs: shipped.gfs.slice(10), ec: shipped.ec.slice(10), steps: shipped.steps.slice(10) });
    const fcState = () => page.evaluate(() => { const F = window.CHOC.trip.fc; return { made: F.d.made, base: F.d._base, i: F.i, t: F.d.gfs[F.i].t }; });
    const refresh = async (re) => {
      await page.click('#fcRefresh');
      await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('fcAsOf').textContent), re.source, { timeout: 15000 });
      assert.equal(await page.$eval('#fcRefresh', b => b.disabled), false, 'the button is ready again');
    };
    ctx.net.fcLive = 'none';                                 // nothing published yet: the shipped copy
    await ctx.open('/research/index.html');
    await loaded();
    await page.evaluate(() => window.CHOC.trip._week(20));   // scrub to Sunday 8 pm
    const before = await fcState();
    const tableDay = () => page.$eval('#fcDays tbody td', n => n.textContent);
    const day0 = await tableDay();
    ctx.net.fcLive = serveLive(next); asked.length = 0; pngs.length = 0;
    await refresh(/^Just updated · As of /);
    const after = await fcState();
    log(`↻ ${before.made} (i ${before.i}, ${before.t}) → ${after.made} (i ${after.i}, ${after.t}) · ${await asOf()} · asked ${asked.join(', ')}`);
    assert.deepEqual({ made: after.made, base: after.base }, { made: next.made, base: LIVE }, 'the newer pull replaces the one on show');
    assert.equal(after.t, before.t, 'the map stays on the hour being looked at');
    assert.equal(after.i, before.i - 10, 'which is 10 steps into the newer pull');
    assert.ok((await asOf()).startsWith('Just updated · As of ' + dayLabel(next.made)), 'the as-of line names the new pull');
    assert.ok(asked.some(u => /^fc\.json\?t=\d+$/.test(u)), `asks past GitHub's cache (${asked.join(', ')})`);
    await page.waitForFunction(() => { const px = window.CHOC.trip.fc.px; return !!(px.gfs_reg && px.gfs_reg.w); }, null, { timeout: 15000 });
    assert.ok(asked.includes('field_gfs_reg.png?m=' + encodeURIComponent(next.made)), 'field images are fetched again, keyed to the new pull');
    await page.waitForFunction((lab) => (document.getElementById('fcAsOf2') || {}).textContent.startsWith('Forecast as of ' + lab), dayLabel(next.made), { timeout: 15000 });
    assert.notEqual(await tableDay(), day0, `the 7-day table starts on the new pull's first day (${day0} → ${await tableDay()})`);
    assert.equal(await page.$$eval('#fcChart svg', s => s.length), 1, 'the 7-day chart is redrawn, not stacked');
    await ctx.screenshot('forecast-refresh');

    // 5. ↻ again with nothing newer, with nothing published (before the bot's first run) and with GitHub out of
    //    reach: the forecast on show stays, and says why. The note then clears, so a phone's short line shows the date.
    await refresh(/^Up to date · As of /);
    assert.equal((await fcState()).made, next.made, 'nothing newer: the same pull stays');
    ctx.net.fcLive = 'none';
    await refresh(/^Nothing published on GitHub yet · As of /);
    assert.equal((await fcState()).made, next.made, 'nothing published: the pull on show stays');
    ctx.net.fcLive = 'abort';
    await refresh(/^Couldn’t reach GitHub · As of /);
    assert.equal((await fcState()).made, next.made, 'unreachable: the pull on show stays');
    await page.clock.fastForward(9000);                     // the page's clock runs slow under test: jump it past the note
    await page.waitForFunction(() => /^As of /.test(document.getElementById('fcAsOf').textContent), null, { timeout: 5000 });
    assert.deepEqual(errors, [], 'no page errors');
  }
};
