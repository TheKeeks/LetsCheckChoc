// Default look, Choc TV (?kiosk=1&preview=clean) on the Sound Check model,
// the Forecast tab's (core's CLEAN.model), on the pinned run
// (tests/fixtures/soundcheck/fc.json: made Thu 1 Oct 2026, 10:30 AM ET):
//   • Each day card's number is Choc's biggest over the day's incoming
//     tide in daylight (the low to the next high), the two models' mean
//     in a straight line between the run's steps, worked out here from
//     the run itself; the line under it is the main swell then (the
//     biggest share of Choc).
//   • The radar plays the run's steps: Choc's number, each model's, and
//     each swell with its share of Choc are the Forecast tab's for the
//     same step; each swell is an arrow in its colour (where it comes
//     from), thicker for a bigger share.
//   • The week strip is Choc's height: the green rises with the two
//     models' mean at every step.
//   • The status strip and Sources name the run and its age; a newer pull
//     published later goes up without a reload (the TV asks again every
//     30 min); a run that ends before now says so instead of showing old
//     numbers as the week ahead.
//   • NOAA's tide predictions down (CO-OPS answers "No Predictions", HTTP
//     200): each card reads all daylight and says so ("No tide times ·
//     swell over all daylight", the classic Choc TV's "NO TIDE DATA —
//     ALL-DAY SWELL"), and Sources too.
//   • The radar's land, and big numbers with no trailing ".0".
'use strict';

const HOUR = 36e5, DAY = 864e5;
const isNum = v => typeof v === 'number' && isFinite(v);
const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = d => COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
// the boards' number style: one decimal, a trailing .0 dropped, whole feet from 10 ft
const num = v => { if (!isNum(v)) return '—'; if (Math.abs(v) >= 9.95) return String(Math.round(v)); const r = Math.round(v * 10) / 10; return r === 0 ? '0' : Math.abs(r).toFixed(1).replace(/\.0$/, ''); };
// the run's steps at Choc, as the site reads them: GFS-Wave, ECMWF at the same hour, their mean
function stepsOf(fc) {
  const ec = {};
  fc.ec.forEach(r => { ec[Math.round(Date.parse(r.t) / HOUR)] = r; });
  return fc.gfs.map(g => {
    const t = Date.parse(g.t), e = ec[Math.round(t / HOUR)], v = [g.choc, e && e.choc].filter(isNum);
    return { t, g: g.choc, e: e ? e.choc : null, m: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, trains: g.trains };
  });
}
function at(S, t) {
  if (t < S[0].t || t > S[S.length - 1].t) return null;
  let i = 1;
  while (i < S.length - 1 && S[i].t < t) i++;
  const a = S[i - 1], b = S[i];
  if (!isNum(a.m) || !isNum(b.m)) return null;
  return b.t === a.t ? a.m : a.m + (b.m - a.m) * (t - a.t) / (b.t - a.t);
}
// a day's card: the biggest over the daylight incoming tide (all daylight without tide times), and the main swell then
function dayWant(S, d) {
  let a = d.sunrise, b = d.sunset;
  if (d.low && d.until && !d.tidesDown) { const a1 = Math.max(a, d.low), b1 = Math.min(b, d.until); if (b1 > a1) { a = a1; b = b1; } }
  let best = null;
  [a, b].concat(S.map(s => s.t).filter(t => t > a && t < b)).forEach(t => { const v = at(S, t); if (isNum(v) && (!best || v > best.v)) best = { v, t }; });
  if (!best) return null;
  let k = 0;
  S.forEach((s, i) => { if (Math.abs(s.t - best.t) < Math.abs(S[k].t - best.t)) k = i; });
  const tr = S[k].trains.filter(x => isNum(x.choc) && isNum(x.T) && isNum(x.D) && isNum(x.ft));
  const main = tr.slice().sort((x, y) => y.choc * y.choc - x.choc * x.choc)[0];
  return { num: num(best.v), sw: main ? `@ ${Math.round(main.T)} s ${compass(main.D)}` : null };
}
const shift = (fc, ms) => {
  const o = JSON.parse(JSON.stringify(fc)), mv = t => new Date(Date.parse(t) + ms).toISOString().slice(0, 16) + 'Z';
  o.made = mv(o.made); o.gfs.forEach(r => { r.t = mv(r.t); }); o.ec.forEach(r => { r.t = mv(r.t); });
  return o;
};

module.exports = {
  name: 'clean preview Choc TV on the Sound Check model: day cards, radar = Forecast tab, week strip, new runs, tides down',
  options: { viewport: { width: 1180, height: 820 }, timeoutMs: 150000 },
  async run({ page, ctx, assert, log }) {
    const FIX = JSON.parse(ctx.fixture('soundcheck/fc.json'));
    const serveRun = d => ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
    const TV = '/?kiosk=1&preview=clean&kioskRotate=600000&kioskRadarStep=600000';
    const boot = async () => {
      await ctx.open(TV);
      await ctx.waitFor(() => window.CLEAN && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted && window.CLEAN_TV && CLEAN_TV.state().model !== 'loading', { label: 'Choc TV and its forecast' });
      await ctx.waitForLoad();
      await ctx.waitFor(() => { const p = document.querySelector('#cl-tv [data-panel="cl-days1"]'); return p && p.querySelectorAll('.cl-tv-card').length === 3; }, { label: 'three day cards' });
    };
    const readCards = () => ctx.state(() => {
      const wk = CLEAN.data.week();
      return {
        days: wk.map(d => ({ sunrise: d.sun && d.sun.sunrise.getTime(), sunset: d.sun && d.sun.sunset.getTime(), low: d.low && d.low.t && d.low.t.getTime(), until: d.low && d.low.until && d.low.until.getTime(), tidesDown: !!d.tidesDown })),
        cards: ['cl-days1', 'cl-days2'].flatMap(p => [...document.querySelectorAll('#cl-tv [data-panel="' + p + '"] .cl-tv-card')]).map(c => ({
          day: c.querySelector('.cl-tv-day').textContent,
          num: c.querySelector('.cl-tv-num') ? c.querySelector('.cl-tv-num').textContent : null,
          sw: c.querySelector('.cl-tv-sw') ? c.querySelector('.cl-tv-sw').textContent.replace(/\s+/g, ' ').trim() : null,
          tide: c.querySelector('.cl-tv-win').textContent.replace(/\s+/g, ' ').trim(),
          wind: c.querySelector('.cl-tv-wd').textContent.replace(/\s+/g, ' ').trim(),
          tags: c.querySelectorAll('.cl-tv-st').length
        }))
      };
    });
    const S = stepsOf(FIX);

    // ── Day cards: Choc's biggest over the daylight incoming tide ──
    serveRun(FIX);
    await boot();
    let rc = await readCards();
    log('cards', JSON.stringify(rc.cards.map(c => [c.day, c.num, c.sw, c.tide])));
    assert.equal(rc.cards.length, 6);
    rc.cards.forEach((c, k) => {
      const w = dayWant(S, rc.days[k]);
      assert.ok(w, c.day + ': the run covers it');
      assert.equal(c.num, w.num, c.day + ': Choc’s biggest over the incoming tide in daylight, from the model');
      assert.equal(c.sw, w.sw, c.day + ': the main swell then');
      assert.match(c.tide, /^Incoming \d/, c.day + ': the incoming tide it is read over');
      assert.equal(c.tags, 0, c.day + ': no in-window / blocked tag (the model already counts what bends in)');
    });
    assert.equal(rc.cards[0].num, '0.5', 'today matches the Forecast tab’s 11 AM headline (0.5 ft)');
    await ctx.screenshot('tv-days1');

    // ── Status strip and Sources: the run and its age ──
    const strip = await ctx.state(() => { const e = document.querySelector('#cl-tv .cl-tv-fc'); return { text: e.textContent, cls: e.className }; });
    log('status strip', JSON.stringify(strip));
    assert.equal(sp(strip.text), 'Forecast run 30 min ago');
    assert.doesNotMatch(strip.cls, /is-(stale|dead)/);
    await page.locator('#cl-tv .cl-tv-btn[data-act="sources"]').click();
    await ctx.waitFor(() => { const o = document.getElementById('kiosk-info-overlay'); return o && o.closest('#cl-tv') && getComputedStyle(o).display !== 'none'; }, { label: 'Sources open' });
    let src = sp(await ctx.state(() => document.getElementById('kiosk-info-card').innerText));
    log('sources', src.slice(0, 500));
    assert.match(src, /^Sources Wave forecast run 10:30\sAM · 30 min old Wind forecast /, 'the first row is the Sound Check run (Open-Meteo’s wave row is gone)');
    assert.match(src, /Each day shows Choc’s biggest height over the incoming tide in daylight/);
    assert.match(src, /Swell: the Sound Check model/);
    assert.doesNotMatch(src, /Swell and wind: Open-Meteo/, 'the swell is no longer Open-Meteo’s');
    await page.locator('#kiosk-info-overlay').click();
    await ctx.waitFor(() => getComputedStyle(document.getElementById('kiosk-info-overlay')).display === 'none', { label: 'Sources closed' });

    // ── Radar: a step two days on, read as the Forecast tab reads it ──
    await ctx.state(() => CLEAN_TV.show('cl-radar'));
    await ctx.waitFor(() => document.querySelector('#cl-tv .cl-tv-cht path.sw'), { label: 'radar strip drawn' });
    const k = S.findIndex(s => s.t === Date.parse('2026-10-03T15:00Z'));   // Sat 11 AM
    await ctx.state(i => CLEAN_TV.playAt(i), k);
    const tv = await ctx.state(() => ({
      day: document.querySelector('#cl-tv .cl-tv-rt .cl-tv-day').textContent,
      num: document.querySelector('#cl-tv .cl-tv-rt .cl-tv-num').textContent,
      mods: document.querySelector('#cl-tv .cl-tv-rt .cl-tv-mods').textContent,
      rows: [...document.querySelectorAll('#cl-tv .cl-tv-rt .cl-tv-swr')].map(r => r.textContent),
      arrows: [...document.querySelectorAll('#cl-tv .cl-tv-scope-top path.sa')].map(p => ({ stroke: getComputedStyle(p).stroke, w: parseFloat(p.style.strokeWidth) })),
      wind: document.querySelectorAll('#cl-tv .cl-tv-scope-top path.wa').length
    }));
    log('radar', JSON.stringify(tv));
    assert.equal(sp(tv.day), 'Sat 11:00 AM');
    assert.equal(tv.num, num(S[k].m), 'Choc: the two models’ mean');
    assert.equal(sp(tv.mods), `GFS-Wave ${num(S[k].g)} · ECMWF ${num(S[k].e)} ft`);
    const tr = S[k].trains.filter(x => isNum(x.choc)), e2 = tr.reduce((a, x) => a + x.choc * x.choc, 0);
    const parts = tr.map(x => ({ x, share: x.choc * x.choc / e2 })).filter(p => p.share >= 0.005).sort((a, b) => b.share - a.share).slice(0, 3);
    assert.deepEqual(tv.rows.map(sp), parts.map((p, n) => `${n + 1}° ${num(p.x.ft)} ft @ ${Math.round(p.x.T)} s ${compass(p.x.D)}${p.x.k === 'ww' ? ' wind sea' : ''} → ${Math.round(p.share * 100)}%`), 'each swell and its share of Choc');
    const FAM = d => (d >= 60 && d < 115 ? 'rgb(64, 190, 198)' : d >= 115 && d < 160 ? 'rgb(240, 138, 75)' : d >= 160 && d < 205 ? 'rgb(170, 128, 236)' : 'rgb(140, 154, 168)');
    assert.deepEqual(tv.arrows.map(a => a.stroke), parts.slice().reverse().map(p => FAM(p.x.D)), 'one arrow per swell, in its colour, the biggest share on top');
    assert.ok(tv.arrows.every((a, n) => !n || a.w >= tv.arrows[n - 1].w), 'thicker for a bigger share');
    assert.equal(tv.wind, 1, 'and the wind');

    // the week strip: the green's height over the baseline follows the two models' mean, step by step
    const shape = await ctx.state(() => {
      const d = document.querySelector('#cl-tv .cl-tv-cht path.sw').getAttribute('d'), pts = new Map();
      d.split('M').filter(Boolean).forEach(sub => sub.replace(/Z/g, '').split('L').forEach(p => { const [x, y] = p.trim().split(/\s+/).map(Number); if (!pts.has(x) || y < pts.get(x)) pts.set(x, y); }));
      return { subs: d.split('M').filter(Boolean).length, band: !!document.querySelector('#cl-tv .cl-tv-cht path.gh'), pts: [...pts.entries()] };
    });
    const t0 = Date.parse('2026-10-01T04:00Z');          // the start of today, Eastern
    const X = t => Math.round((t - t0) / (7 * DAY) * 1100 * 10) / 10;
    const ratios = S.filter(s => isNum(s.m) && s.m >= 0.3 && X(s.t) >= 0 && X(s.t) <= 1100).map(s => { const y = new Map(shape.pts).get(X(s.t)); return isNum(y) ? (174 - y) / s.m : null; }).filter(isNum);
    log('strip', shape.subs, 'shape(s);', ratios.length, 'steps; height/ft', Math.min(...ratios).toFixed(2), '–', Math.max(...ratios).toFixed(2));
    assert.equal(shape.subs, 1, 'one continuous shape');
    assert.ok(shape.band, 'with the band between the two models');
    assert.ok(ratios.length > 40, 'most of the week checked');
    assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.6, 'the green rises with the mean at every step');

    // Big readouts: no trailing ".0". Play a daylight step whose mean rounds to whole feet.
    const whole = await ctx.state(() => {
      const st = CLEAN.model.state.steps;
      for (let i = 0; i < st.length; i++) {
        const s = st[i], r = Math.round(s.choc.m * 10) / 10, sun = CLEAN.data.sun(new Date(s.t));
        if (!(r > 0 && r < 10 && r === Math.round(r)) || !sun || s.t < sun.sunrise.getTime() || s.t >= sun.sunset.getTime()) continue;
        CLEAN_TV.playAt(i);
        return { i, r, hero: document.querySelector('#cl-tv .cl-tv-rt .cl-tv-num').textContent };
      }
      return null;
    });
    log('whole-feet step', JSON.stringify(whole));
    assert.ok(whole, 'the run has a daylight step of whole feet');
    assert.equal(whole.hero, String(whole.r), 'the radar hero drops the trailing .0');
    assert.ok((await ctx.state(() => [...document.querySelectorAll('#cl-tv .cl-tv-num')].map(e => e.textContent))).every(t => !/\.0$/.test(t)), 'no big number ends in .0');
    await ctx.state(i => CLEAN_TV.playAt(i), k);
    await page.waitForTimeout(300);
    await ctx.screenshot('tv-radar');

    // Land: one faint light fill over land and knob, a muted outline.
    const land = await ctx.state(() => {
      const base = document.querySelector('#cl-tv .cl-tv-scope-base svg'), g = base.querySelector('.land'), shore = base.querySelector('.shore');
      return {
        paths: g.querySelectorAll('path').length, fills: [...new Set([...g.querySelectorAll('path')].map(p => getComputedStyle(p).fill))], opacity: getComputedStyle(g).opacity,
        rim: !!base.querySelector('circle.rim[clip-path]'), shoreStroke: shore && getComputedStyle(shore).stroke
      };
    });
    assert.deepEqual(land, { paths: 2, fills: ['rgb(255, 255, 255)'], opacity: '0.05', rim: true, shoreStroke: 'rgb(154, 170, 162)' }, 'the board’s land and shore');
    assert.deepEqual(await ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message)), [], 'no CLEAN.errors');

    // ── The same step on the phone's Forecast tab: the same numbers ──
    await page.setViewportSize({ width: 390, height: 844 });
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok', { label: 'Forecast tab' });
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    await page.keyboard.press('Home');
    for (let j = 0; j < k; j++) await page.keyboard.press('ArrowRight');
    const ft = await ctx.state(() => ({
      step: CLEAN.forecastInfo().step,
      num: document.querySelector('#cl-view-forecast .cl-f-num').textContent,
      models: document.querySelector('#cl-view-forecast .cl-f-models').textContent,
      rows: [...document.querySelectorAll('#cl-view-forecast .cl-f-tr li .cl-f-trt')].map(r => r.textContent)
    }));
    log('Forecast tab', JSON.stringify(ft));
    assert.equal(ft.step, k);
    assert.equal(ft.num, tv.num, 'Choc TV and the Forecast tab show the same Choc number');
    assert.equal(sp(ft.models), sp(tv.mods), 'and the same two models');
    const pick = r => { const m = sp(r).match(/^(\d)° (\S+ ft @ \d+ s \S+).*?→ (\d+)%/); return m && [m[1], m[2], m[3]]; };
    assert.deepEqual(ft.rows.slice(0, 3).map(pick), tv.rows.map(pick), 'and the same swells with the same shares');
    await page.setViewportSize({ width: 1180, height: 820 });

    // ── A newer pull published later goes up without a reload ──
    serveRun(FIX);
    await boot();
    const newer = JSON.parse(JSON.stringify(FIX));
    newer.made = '2026-10-01T15:20Z';
    newer.gfs.forEach(r => { if (isNum(r.choc)) r.choc = Math.round(r.choc * 20) / 10; });
    newer.ec.forEach(r => { if (isNum(r.choc)) r.choc = Math.round(r.choc * 20) / 10; });
    ctx.net.fcLive = () => ({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }, json: newer });
    await page.clock.fastForward('31:00');
    await ctx.waitFor(() => CLEAN_TV.state().made === '2026-10-01T15:20Z', { label: 'the newer run is up', timeout: 15000 });
    rc = await readCards();
    const S2 = stepsOf(newer);
    log('after the new pull', JSON.stringify(rc.cards.slice(0, 3).map(c => c.num)), sp(await ctx.state(() => document.querySelector('#cl-tv .cl-tv-fc').textContent)));
    rc.cards.forEach((c, n) => { assert.equal(c.num, dayWant(S2, rc.days[n]).num, c.day + ': from the newer run'); });
    assert.notEqual(rc.cards[0].num, '0.5', 'today moved with it');
    assert.match(sp(await ctx.state(() => document.querySelector('#cl-tv .cl-tv-fc').textContent)), /^Forecast run \d+ min ago$/);
    ctx.net.fcLive = 'none';

    // ── A run that ends before now: it says so, and shows no old numbers as the week ahead ──
    serveRun(shift(FIX, -10 * DAY));
    await boot();
    rc = await readCards();
    const ended = await ctx.state(() => { CLEAN_TV.show('cl-radar'); const e = document.querySelector('#cl-tv .cl-tv-fc'); return { strip: e.textContent, cls: e.className, hint: document.querySelector('#cl-tv .cl-tv-rt .cl-tv-hint').textContent }; });
    log('ended', JSON.stringify(ended), JSON.stringify(rc.cards.slice(0, 2).map(c => [c.num, c.sw])));
    assert.match(sp(ended.strip), /^Forecast run .+ ago, ended$/);
    assert.match(ended.cls, /is-dead/);
    assert.equal(ended.hint, 'The forecast run ends before now');
    assert.ok(rc.cards.every(c => c.num === '—' && c.sw === 'No model forecast for this day'), 'no old numbers on the cards');

    // ── NOAA's tide predictions down: all daylight, and the cards and Sources say so ──
    ctx.net.coops = 'error';
    serveRun(FIX);
    await ctx.state(() => { localStorage.clear(); sessionStorage.clear(); });   // no saved tides to fall back on
    await boot();
    rc = await readCards();
    log('tides down', JSON.stringify(rc.cards.map(c => [c.day, c.num, c.tide, c.wind])));
    assert.deepEqual(rc.days.map(d => d.tidesDown), [true, true, true, true, true, true, true], 'CO-OPS down: every day falls back to all daylight');
    rc.cards.forEach((c, n) => {
      assert.equal(c.num, dayWant(S, rc.days[n]).num, c.day + ': Choc’s biggest over all daylight');
      assert.equal(c.tide, 'No tide times · swell over all daylight', c.day + ': the card says so');
      assert.match(c.wind, /^At noon /, c.day + ': the wind is the noon forecast');
    });
    await ctx.screenshot('tv-tides-down-days1');
    await page.locator('#cl-tv .cl-tv-btn[data-act="sources"]').click();
    await ctx.waitFor(() => getComputedStyle(document.getElementById('kiosk-info-overlay')).display !== 'none', { label: 'Sources open' });
    src = sp(await ctx.state(() => document.getElementById('kiosk-info-card').innerText));
    assert.match(src, /tide times didn’t load, so each day shows Choc’s biggest height over all of its daylight/);
    assert.match(src, /The wind is the forecast at noon\./);
    assert.doesNotMatch(src, /over the incoming tide in daylight/, 'Sources no longer claims the incoming tide');
    assert.deepEqual(await ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message)), [], 'no CLEAN.errors');
  }
};
