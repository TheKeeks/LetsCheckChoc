// Sound Check (research/): the history bot adds a day to research/hist.js every day (scripts/history/update.py),
// so what the page says about the history comes from that file, not from when the page was built: the date
// picker reaches the history's last day, the years and the "Check any day" range follow it, the counts the text
// quotes (swell trains, Wilderness days) are counted from it, and the ten-year tiles' caption names the months
// short of buoy data from it.
// First with the history the tests pin (through 5 Oct 2026): what the page counts is what its markup says.
// Then with that history plus one more day (3 Jan 2027, a 3 ft+ day that a train other than the buoy's biggest
// made), five more Wilderness days and late readings filling 2017's gap: the page follows.
'use strict';

const zlib = require('zlib');

const read = () => {
  const one = (k) => { const n = document.querySelector(`[data-hist="${k}"]`); return n && n.textContent; };
  const all = (k) => [...document.querySelectorAll(`[data-hist="${k}"]`)].map((n) => n.textContent);
  return {
    year: all('year'), month: all('month'), max: document.getElementById('dcDate').max,
    trains: ['tr-multi', 'tr-med', 'tr-p10', 'tr-notmain'].map(one),
    wild: ['w-wild', 'w-choc', 'w-beats', 'w-days', 'w-year'].map(one),
    cap: document.getElementById('decCap').textContent
  };
};

module.exports = {
  name: 'Sound Check: the date range, quoted counts and data gaps follow the history file',
  options: { viewport: { width: 1180, height: 900 }, timeoutMs: 120000 },
  async run({ page, ctx, assert, log }) {
    const ready = () => ctx.waitFor(() => window.CHOC && window.CHOC.D && document.getElementById('decCap').textContent, { label: 'page' });

    // ── The pinned history: the page's counts are the ones in its markup ──
    await ctx.open('/research/index.html');
    await ready();
    let r = await page.evaluate(read);
    log('pinned', JSON.stringify(r));
    const built = await page.evaluate(async () => {            // the markup as built, before any script ran
      const doc = new DOMParser().parseFromString(await (await fetch('/research/index.html')).text(), 'text/html');
      const one = (k) => doc.querySelector(`[data-hist="${k}"]`).textContent;
      return { trains: ['tr-multi', 'tr-med', 'tr-p10', 'tr-notmain'].map(one), wild: ['w-wild', 'w-choc', 'w-beats', 'w-days', 'w-year'].map(one),
        year: one('year'), month: one('month') };
    });
    assert.deepEqual(r.trains, built.trains, 'trains: counted from the history = the markup');
    assert.deepEqual(r.wild, built.wild, 'Wilderness: counted from the history = the markup');
    assert.deepEqual(r.trains, ['30%', 'all', '98%', '20']);
    assert.deepEqual(r.wild, ['698', '1,012', '9', '300', '30']);
    assert.equal(r.max, '2026-10-05', 'the picker reaches the history\'s last day');
    assert.deepEqual(r.year, ['2026', '2026', '2026']);
    assert.deepEqual(r.month, ['Oct 2026']);
    assert.match(r.cap, /Hatched months have under 300 hours of buoy data \(gaps in Oct–Nov 2017 and Aug 2026; the latest month is still filling in\)\.$/);

    // ── One more day, five more Wilderness days, 2017's gap filled ──
    const more = `
DAYS2['2027-01-03'] = DAYS2['2026-10-05'].slice();
TRAINS['2027-01-03'] = [9, [[5.0, 6.1, 35, 1.0, 0.6], [4.2, 12.5, 150, 3.6, 2.2]], 9, [[5.0, 6.1, 35, 1.0, 0.6], [4.2, 12.5, 150, 3.6, 2.2]]];
WILDSTATS.wild_days_total += 5;
DATA.ym.all['2017-10'][2] = DATA.ym.day['2017-10'][2] = 740;
DATA.ym.all['2017-11'][2] = DATA.ym.day['2017-11'][2] = 720;
`;
    ctx.serve('/research/hist.js', zlib.gunzipSync(ctx.fixture('soundcheck/hist.js.gz', null)).toString() + more);
    await ctx.open('/research/index.html');
    await ready();
    r = await page.evaluate(read);
    log('one more day', JSON.stringify(r));
    assert.equal(r.max, '2027-01-03', 'the picker reaches the new day');
    assert.deepEqual(r.year, ['2027', '2027', '2027'], 'the years run to 2027');
    assert.deepEqual(r.month, ['Jan 2027'], '"Check any day, May 2016 – Jan 2027"');
    assert.equal(r.trains[3], '21', 'one more day another train made the surf');
    assert.deepEqual(r.wild.slice(3), ['305', '30'], 'Wilderness days counted from the file');
    assert.match(r.cap, /\(gaps in Aug 2026; the latest month is still filling in\)\.$/, '2017 is no longer a gap');
    await page.evaluate(() => { const i = document.getElementById('dcDate'); i.value = '2027-01-03'; i.dispatchEvent(new Event('change')); });
    await ctx.waitFor(() => / ft/.test(document.getElementById('dcOut').textContent), { label: 'the new day checked' });
    assert.doesNotMatch(await page.textContent('#dcOut'), /No buoy data/, 'Check a date shows the new day');
    await ctx.screenshot('check-a-date-new-day');
  }
};
