// Default look, Forecast tab: the headline is the Sound Check model's height
// at Choc (GFS-Wave and ECMWF averaged, carried over the sea floor), with
// Open-Meteo's offshore swell under it labeled "Offshore". Each This-week row
// leads with Choc's best daylight height. Without the model forecast (the copy
// that ships with research/ is a week old here) the tab falls back to the
// offshore swell, as before.
'use strict';

const fs = require('fs');
const path = require('path');

// research/fc/fc.json moved so its first step is 2026-10-01 00:00 ET, and every
// Choc reading pinned: GFS 1.0 ft, ECMWF 2.0 ft → 1.5 ft, except a 3.4 ft
// spike on Fri 2 Oct midday (GFS 3.0, ECMWF 3.8).
function shiftedFC() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../research/fc/fc.json'), 'utf8'));
  const t0 = Date.parse(d.gfs[0].t), to = Date.parse('2026-10-01T04:00:00Z');
  const mv = t => new Date(Date.parse(t) - t0 + to).toISOString().replace(':00.000Z', 'Z');
  const spike = Date.parse('2026-10-02T16:00:00Z');
  d.made = '2026-10-01T06:00Z';
  d.gfs.forEach(r => { r.t = mv(r.t); r.choc = Date.parse(r.t) === spike ? 3.0 : 1.0; });
  (d.ec || []).forEach(r => { r.t = mv(r.t); r.choc = Date.parse(r.t) === spike ? 3.8 : 2.0; });
  return JSON.stringify(d);
}

module.exports = {
  name: 'clean forecast: Sound Check height at Choc leads, offshore swell labeled; falls back without it',
  options: { gate: null, viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  async run({ page, ctx, assert, log }) {
    const read = () => ctx.state(() => {
      const v = document.querySelector('#cl-view-forecast');
      return {
        hero: (v.querySelector('.cl-f-hero .cl-f-num') || {}).textContent || null,
        sc: !!v.querySelector('.cl-f-sc'),
        label: (v.querySelector('.cl-f-scl') || {}).textContent || null,
        off: (v.querySelector('.cl-f-meta .cl-f-off') || {}).textContent || null,
        rows: [...v.querySelectorAll('.cl-f-row')].map(r => ((r.querySelector('.cl-f-sc-d') || {}).textContent || null))
      };
    });

    // ── Without a current model forecast: the offshore swell, as before ──
    await ctx.open('/?classic=0');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    await ctx.waitForLoad();
    await ctx.waitFor(() => document.querySelectorAll('#cl-view-forecast .cl-f-row').length === 7, { label: 'week rows' });
    await page.waitForTimeout(500);
    const old = await read();
    log('fallback', JSON.stringify(old));
    assert.ok(!old.sc, 'no Sound Check hero without a forecast covering now');
    assert.ok(old.hero, 'the offshore swell still heads the tab');
    assert.ok(old.rows.every(r => r === null), 'week rows unchanged');

    // ── With one: Choc leads ──
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: shiftedFC() });
    await ctx.open('/?classic=0');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
    await ctx.waitForLoad();
    await ctx.waitFor(() => !!document.querySelector('#cl-view-forecast .cl-f-sc'), { label: 'Sound Check hero' });
    const now = await read();
    log('soundcheck', JSON.stringify(now));
    assert.equal(now.hero, '1.5', 'Thu 11 AM: GFS 1.0 and ECMWF 2.0 at Choc average to 1.5 ft');
    assert.match(now.label, /at Choc now · Sound Check model/);
    assert.match(now.off || '', /^Offshore /, 'the open-ocean swell is labeled offshore');
    assert.equal(now.rows[0], 'Choc 1.5 ft', 'today: 1.5 ft all daylight');
    assert.equal(now.rows[1], 'Choc 3.4 ft', 'Friday: the midday 3.4 ft is the day\'s best');
    await ctx.screenshot('forecast-soundcheck');
  }
};
