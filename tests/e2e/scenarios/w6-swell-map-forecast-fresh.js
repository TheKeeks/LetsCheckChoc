// Sound Check (research/): the 7-day forecast was a snapshot pulled by hand and committed with the page, so on
// Friday it still read "As of Wed Oct 7". .github/workflows/update-forecast.yml now pulls every model run and
// publishes it to the fc-data branch; the page reads that pull from raw.githubusercontent.com and shows the newer
// of it and the copy that ships with the page (research/fc/), taking the field images from the same place.
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
    const pngs = [];
    const serveLive = (live) => (url) => {
      const name = url.slice(LIVE.length).split('?')[0];
      if (name === 'fc.json') return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }, json: live };
      if (/^field_[a-z_]+\.png$/.test(name)) { pngs.push(name); return { status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, file: '../../research/fc/' + name }; }
      return { status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' };
    };
    const asOf = () => page.$eval('#fcAsOf', n => n.textContent);
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
    const p = new Date(Date.parse(fresh.made.replace(/Z$/, ':00Z')));
    const label = p.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
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
    assert.deepEqual(errors, [], 'no page errors');
  }
};
