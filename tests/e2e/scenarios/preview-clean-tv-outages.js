// Default look, Choc TV (?kiosk=1&preview=clean) when a source fails. The
// TV runs for weeks on the iPad at the house with nobody at the controls,
// so when NOAA, Open-Meteo or the forecast bot stops answering it has to
// keep showing what it has and say how old it is, never pass old readings
// off as new. Fixture day, Thu 1 Oct 2026; each part boots a fresh TV at
// 11:00 ET with nothing saved, on the pinned Sound Check run (made 10:30 AM)
// unless it says otherwise:
//   • Every 15 minutes the TV loads the wind, tides and buoy again
//     (kiosk.js's refresh tick, which the new TV runs on): one more wind
//     request and one more load on the tick, none in the 14 minutes before.
//   • NOAA's tide predictions down (CO-OPS answers "No Predictions", HTTP
//     200) through 3 h 15 min of refreshes: at every refresh each day card
//     keeps its incoming tide from the tides saved before the outage (not
//     "No tide times"), the strip stays fresh (it ages the Sound Check run),
//     and Sources says the tides are the saved copy without amber or red:
//     tide predictions are astronomical, so a saved copy stays right for days.
//   • The wind forecast down: Sources' wind line turns amber on the first
//     failed refresh (the cards fall back to the wind saved at 11:00), is
//     still amber at 45 min, red past 3 h, and plain again on the first
//     refresh after Open-Meteo answers.
//   • The Sound Check run's age, on the strip and in Sources: red at 2 days
//     old even while the run still reaches now; the TV asks for a newer run
//     every 30 min, and the strip follows each one that goes up: amber for a
//     run 13 h old, plain for a fresh one.
'use strict';

const HOUR = 36e5, MIN = 6e4;
const NOW = '2026-10-01T11:00:00-04:00';   // the fixtures' instant
const TV = '/?kiosk=1&preview=clean&kioskRotate=600000&kioskRadarStep=600000';
// times keep "10:30 AM" together with a no-break space
const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
// the run moved in time, its made time and every step (preview-clean-tv.js's helper)
const shift = (fc, ms) => {
  const o = JSON.parse(JSON.stringify(fc)), mv = t => new Date(Date.parse(t) + ms).toISOString().slice(0, 16) + 'Z';
  o.made = mv(o.made); o.gfs.forEach(r => { r.t = mv(r.t); }); o.ec.forEach(r => { r.t = mv(r.t); });
  return o;
};

module.exports = {
  name: 'clean Choc TV when a source fails: the 15-min refresh, CO-OPS down on saved tides, wind stale then dead, the run’s age',
  options: { viewport: { width: 1180, height: 820 }, timeoutMs: 150000 },
  async run({ page, ctx, assert, log }) {
    const FIX = JSON.parse(ctx.fixture('soundcheck/fc.json'));      // made 10:30 AM ET, Thu to next Thu
    const serveRun = d => ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
    const liveRun = d => () => ({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }, json: d });
    ctx.serve('/blank.html', '<!doctype html><meta charset="utf-8"><title>blank</title>');

    // Core repaints the TV on a 0 ms timer after a load (and at once on a
    // new run): one more 0 ms timer runs after that repaint.
    const settle = () => ctx.state(() => new Promise(r => setTimeout(r, 0)));
    // A fresh TV at 11:00 with nothing saved: a blank page of the site clears
    // the storage (the last TV can't write behind it), the clock goes back to
    // the fixtures' 11:00, then the TV boots.
    const boot = async (label) => {
      await page.goto(ctx.url('/blank.html'));
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.clock.setSystemTime(new Date(NOW));
      await ctx.open(TV);
      await ctx.waitFor(() => window.CLEAN && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted && window.CLEAN_TV && CLEAN_TV.state().model !== 'loading', { label: label + ': Choc TV and its forecast' });
      await ctx.waitForLoad();
      await ctx.waitFor(() => document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card').length === 3, { label: label + ': three day cards' });
      await settle();
    };
    // The iPad left alone for a while: jump ahead, wait for the refresh tick's load.
    const nextLoad = async (ff, label) => {
      await ctx.waitFor(() => !isDataLoadInFlight(), { label: 'no load in flight before ' + label });
      const before = await ctx.state(() => STATE.lastLoadCompletedAt);
      await page.clock.fastForward(ff);
      await ctx.waitFor(t => STATE.lastLoadCompletedAt !== t && !isDataLoadInFlight(), { arg: before, label });
      await settle();
    };
    const strip = async () => {
      const s = await ctx.state(() => { const e = document.querySelector('#cl-tv .cl-tv-fc'); return { text: e.textContent, cls: e.className }; });
      return { text: sp(s.text), cls: s.cls };
    };
    // Sources: the ⓘ button on the strip opens kiosk.js's card, adopted into #cl-tv.
    const openSources = async () => {
      await page.locator('#cl-tv .cl-tv-btn[data-act="sources"]').click();
      await ctx.waitFor(() => { const o = document.getElementById('kiosk-info-overlay'); return o && o.closest('#cl-tv') && getComputedStyle(o).display !== 'none'; }, { label: 'Sources open' });
      const s = await ctx.state(() => {
        const rows = {};
        document.querySelectorAll('#kiosk-info-card .cl-tv-src-r').forEach(r => {
          const v = r.querySelector('.cl-tv-src-v');
          rows[r.firstElementChild.textContent] = { text: v.textContent, cls: v.className, color: getComputedStyle(v).color };
        });
        return { rows, text: document.getElementById('kiosk-info-card').innerText };
      });
      Object.values(s.rows).forEach(r => { r.text = sp(r.text); });
      s.text = sp(s.text);
      return s;
    };
    const closeSources = async () => {
      await page.locator('#kiosk-info-overlay').click();
      await ctx.waitFor(() => getComputedStyle(document.getElementById('kiosk-info-overlay')).display === 'none', { label: 'Sources closed' });
    };
    const tideLines = async () => (await ctx.state(() => ['cl-days1', 'cl-days2']
      .flatMap(p => [...document.querySelectorAll('#cl-tv [data-panel="' + p + '"] .cl-tv-card')])
      .map(c => c.querySelector('.cl-tv-day').textContent + ': ' + (c.querySelector('.cl-tv-win') || {}).textContent))).map(sp);
    // The next three days on screen, once the 600 ms cross-fade is over (for screenshots).
    const showDays = async () => { await ctx.state(() => CLEAN_TV.show('cl-days1')); await page.waitForTimeout(700); };
    const windReqs = () => ctx.requestsTo('api.open-meteo.com/v1/forecast').length;
    const tideReqs = () => ctx.requestsTo('api.tidesandcurrents.noaa.gov').length;
    const noErrors = async (where) => assert.deepEqual(await ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message)), [], where + ': no CLEAN.errors');

    // ── Every 15 min: the wind, tides and buoy load again, on the tick and not before ──
    serveRun(FIX);
    await boot('fresh boot');
    const a0 = await ctx.state(() => ({ at: STATE.lastLoadCompletedAt, gen: _loadGen }));
    const w0 = windReqs(), c0 = tideReqs();
    let s = await strip();
    log('boot', JSON.stringify(a0), 'wind requests', w0, JSON.stringify(s));
    assert.equal(w0, 1, 'boot: one wind request');
    assert.equal(s.text, 'Forecast run 30 min ago');
    assert.doesNotMatch(s.cls, /is-(stale|dead)/);
    await page.clock.fastForward('14:00');
    await page.waitForTimeout(500);
    assert.equal(windReqs(), w0, 'nothing loads in the 14 minutes before the tick');
    assert.equal(await ctx.state(() => STATE.lastLoadCompletedAt), a0.at);
    await nextLoad('01:30', 'the 15-min refresh');
    const a1 = await ctx.state(() => ({ at: STATE.lastLoadCompletedAt, gen: _loadGen, wind: STATE.dataHealth.wind }));
    log('tick', JSON.stringify(a1), 'wind requests', windReqs(), 'CO-OPS', c0, '→', tideReqs());
    assert.equal(windReqs(), w0 + 1, 'the tick asks Open-Meteo for the wind again');
    assert.ok(tideReqs() > c0, 'and NOAA for the tides');
    assert.equal(a1.gen, a0.gen + 1, 'one load per tick');
    assert.ok(a1.at - a0.at >= 15 * MIN, 'STATE.lastLoadCompletedAt moves to the tick');
    assert.equal(a1.wind.origin, 'live');
    assert.ok(a1.wind.asOf - a0.at >= 15 * MIN, 'the wind on show is the new one');

    // ── NOAA's tides down through 3 h 15 min of refreshes: the saved tides carry the cards ──
    const lines = await tideLines();
    log('tide lines before the outage', JSON.stringify(lines));
    assert.equal(lines.length, 6);
    lines.forEach(t => assert.match(t, /: Incoming \d/, t));
    ctx.net.coops = 'error';
    const c1 = tideReqs();
    for (let k = 1; k <= 13; k++) {
      await nextLoad('15:00', `refresh ${k} of the CO-OPS outage`);
      assert.equal(await ctx.state(() => STATE.dataHealth.tides.origin), 'stale-cache', `refresh ${k}: the tides are the saved copy`);
      assert.deepEqual(await tideLines(), lines, `refresh ${k}: every card keeps its incoming tide`);
    }
    const b = await ctx.state(() => ({
      marine: STATE.dataHealth.marine.origin, wind: STATE.dataHealth.wind.origin, tides: STATE.dataHealth.tides.origin,
      tidesAgeMin: Math.round((Date.now() - STATE.dataHealth.tides.asOf) / 6e4),
      tidesDown: CLEAN.data.week().map(d => d.tidesDown),
      core: (({ origin, level }) => ({ origin, level }))(CLEAN.data.sources().find(r => r.key === 'tides'))
    }));
    s = await strip();
    log('3h15 into the outage', JSON.stringify(b), JSON.stringify(s), 'CO-OPS requests', c1, '→', tideReqs());
    assert.ok(tideReqs() >= c1 + 13, 'every refresh asked NOAA again');
    assert.deepEqual([b.marine, b.wind, b.tides], ['live', 'live', 'stale-cache'], 'Open-Meteo answered; the tides are the saved copy');
    assert.ok(b.tidesAgeMin > 3 * 60, 'saved before the outage, over 3 h ago');
    assert.deepEqual(b.tidesDown, [false, false, false, false, false, false, false], 'no day falls back to all daylight');
    assert.deepEqual(b.core, { origin: 'stale-cache', level: 'fresh' }, 'core: a saved copy of the tides is never stale');
    assert.match(s.text, /^Forecast run 4h( \d+m)? ago$/);
    assert.doesNotMatch(s.cls, /is-(stale|dead)/, 'the strip stays fresh: saved tides are no alarm');
    await showDays();
    await ctx.screenshot('tv-coops-outage');
    let src = await openSources();
    log('Sources', JSON.stringify(src.rows));
    assert.match(src.rows.Tides.text, /^11:1\d AM · saved$/, 'Sources: the tides saved at the 11:15 refresh, before the outage');
    assert.equal(src.rows.Tides.cls, 'cl-tv-src-v', 'without amber or red');
    assert.equal(src.rows['Wind forecast'].cls, 'cl-tv-src-v');
    assert.equal(src.rows.Tides.color, src.rows['Wind forecast'].color, 'the saved tides read like the fresh wind');
    assert.match(src.text, /Each day shows Choc’s biggest height over the incoming tide in daylight/);
    assert.doesNotMatch(src.text, /tide times didn’t load/, 'Sources doesn’t claim the tides are missing');
    await ctx.screenshot('tv-coops-outage-sources');
    await closeSources();
    await noErrors('CO-OPS outage');
    ctx.net.coops = 'ok';

    // ── The wind forecast down: amber at once, still at 45 min, red past 3 h, plain once it's back ──
    await boot('wind');
    ctx.net.wind = 'down';
    await nextLoad('15:00', 'the first refresh with the wind down');
    assert.equal(await ctx.state(() => STATE.dataHealth.wind.origin), 'stale-cache', 'the cards fall back to the wind saved at 11:00');
    src = await openSources();
    log('wind down 15 min', JSON.stringify(src.rows['Wind forecast']));
    assert.match(src.rows['Wind forecast'].text, /^11:00 AM · 1[56] min old$/);
    assert.equal(src.rows['Wind forecast'].cls, 'cl-tv-src-v is-stale', 'amber at once: a saved copy after a failed refresh');
    await closeSources();
    await nextLoad('30:00', 'the wind still down at 45 min');
    src = await openSources();
    log('wind down 45 min', JSON.stringify(src.rows['Wind forecast']));
    assert.match(src.rows['Wind forecast'].text, /^11:00 AM · 4[56] min old$/);
    assert.equal(src.rows['Wind forecast'].cls, 'cl-tv-src-v is-stale', 'still amber at 45 min (stale past 40)');
    await closeSources();
    await nextLoad('03:00:00', 'the wind down past 3 h');
    await showDays();
    src = await openSources();
    log('wind down 3h45', JSON.stringify(src.rows));
    assert.match(src.rows['Wind forecast'].text, /^11:00 AM · 3h 4\dm old$/);
    assert.equal(src.rows['Wind forecast'].cls, 'cl-tv-src-v is-dead', 'red past 3 h');
    assert.notEqual(src.rows['Wind forecast'].color, src.rows.Tides.color, 'and it reads red, unlike the fresh tides');
    await ctx.screenshot('tv-wind-dead');
    await closeSources();
    ctx.net.wind = 'ok';
    await nextLoad('15:00', 'the first refresh with the wind back');
    src = await openSources();
    log('wind back', JSON.stringify(src.rows['Wind forecast']));
    assert.match(src.rows['Wind forecast'].text, /^3:0\d PM$/, 'the new forecast’s time, no age');
    assert.equal(src.rows['Wind forecast'].cls, 'cl-tv-src-v', 'plain again');
    await closeSources();
    await noErrors('wind down');

    // ── The run's age: red at 2 days though it reaches now; each newer run clears it ──
    const run49 = shift(FIX, -48.5 * HOUR);   // made Tue 29 Sep 10:00 AM ET: 49 h old at 11:00
    const run13 = shift(FIX, -12.5 * HOUR);   // made Wed 30 Sep 10:00 PM ET: 13 h old at 11:00
    serveRun(run49);
    await boot('a 2-day-old run');
    s = await strip();
    log('2-day-old run', JSON.stringify(s));
    assert.equal(s.text, 'Forecast run 2d ago', 'the strip says how old the run is');
    assert.match(s.cls, /is-dead/, 'red past 2 days');
    assert.ok(await ctx.state(() => CLEAN.model.nowStep() >= 0), 'the run still reaches now: red for its age, not for ending');
    src = await openSources();
    assert.match(src.rows['Wave forecast'].text, /^run Tue 10:00 AM · 2d old$/);
    assert.equal(src.rows['Wave forecast'].cls, 'cl-tv-src-v is-dead');
    await closeSources();
    await showDays();
    await ctx.screenshot('tv-run-dead');

    ctx.net.fcLive = liveRun(run13);          // the bot publishes a newer run, 13 h old
    await ctx.waitFor(() => !isDataLoadInFlight(), { label: 'no load in flight' });
    await page.clock.fastForward('31:00');
    await ctx.waitFor(m => CLEAN_TV.state().made === m, { arg: run13.made, label: 'the 13-hour-old run is up', timeout: 15000 });
    await settle();
    s = await strip();
    log('13-hour-old run', JSON.stringify(s));
    assert.match(s.text, /^Forecast run 13h( \d+m)? ago$/);
    assert.match(s.cls, /is-stale/, 'amber past 12 h');
    assert.doesNotMatch(s.cls, /is-dead/);
    src = await openSources();
    assert.match(src.rows['Wave forecast'].text, /^run Wed 10:00 PM · 13h( \d+m)? old$/);
    assert.equal(src.rows['Wave forecast'].cls, 'cl-tv-src-v is-stale');
    await closeSources();
    await showDays();
    await ctx.screenshot('tv-run-stale');

    ctx.net.fcLive = liveRun(FIX);            // and then a fresh one
    await ctx.waitFor(() => !isDataLoadInFlight(), { label: 'no load in flight' });
    await page.clock.fastForward('31:00');
    await ctx.waitFor(m => CLEAN_TV.state().made === m, { arg: FIX.made, label: 'the fresh run is up', timeout: 15000 });
    await settle();
    s = await strip();
    log('fresh run', JSON.stringify(s));
    assert.match(s.text, /^Forecast run 1h( \d+m)? ago$/);
    assert.doesNotMatch(s.cls, /is-(stale|dead)/, 'a fresh run clears it');
    src = await openSources();
    assert.match(src.rows['Wave forecast'].text, /^run 10:30 AM · 1h( \d+m)? old$/);
    assert.equal(src.rows['Wave forecast'].cls, 'cl-tv-src-v');
    await closeSources();
    ctx.net.fcLive = 'none';
    await noErrors('the run’s age');
  }
};
