// ?preview=clean — core's readings (previews/clean/core.js, base.css),
// checked the way the crew sees them, against the fixtures:
//   • one number style: one decimal, a trailing ".0" dropped (1 ft, 1.6 ft,
//     0 ft tide, "3 / 10"), and a wind barb that never shows the calm ring
//     beside "3 mph";
//   • the wave forecast down (no saved copy): the wind and the CO-OPS tides
//     that did load still show, on the phone (Forecast's wind and tide line,
//     the week's lows in CLEAN.data) and on Choc TV ("Incoming 7:28 AM");
//   • CO-OPS down: a day whose bigger band is blocked but whose other band
//     is in the window headlines the band that reaches the reef (Fri, the
//     day summaries Choc TV draws);
//   • the reef's swell leads CLEAN.data.now(): at Fri 7:05 AM the 9 s SE
//     groundswell (in the window) beats the bigger 4 s wind swell from S
//     174° (blocked), which goes to the blocked list;
//   • a Wi-Fi blip on the buoy list at boot: the phone gives up "Loading…"
//     after a minute and, once the list answers, loads by itself;
//   • keyboard focus: the build's green ring (not the classic blue one), and
//     a focused control low on the Forecast tab is never left under the tab bar.
'use strict';

const fs = require('fs');
const path = require('path');

const PHONE = { width: 390, height: 844 };
const TV = { width: 1180, height: 820 };
const BUOYS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'buoys-east-coast.json'));

module.exports = {
  name: 'clean preview core: number style, wind and tides without the wave forecast, reach-first now and week, boot recovery, focus ring',
  options: {
    viewport: PHONE,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
  },
  async run({ page, ctx, assert, log }) {
    const txt = (sel) => ctx.state(s => {
      const e = document.querySelector(s);
      return e ? e.innerText.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim() : null;
    }, sel);
    const cleanErrors = () => ctx.state(() => (window.CLEAN && CLEAN.errors || []).map(e => e.where + ': ' + e.message));
    // Fresh storage for every boot: a saved forecast would hide the outage.
    const boot = async (url, { load = true } = {}) => {
      await ctx.state(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* fine */ } }).catch(() => {});
      await ctx.open(url);
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean shell up' });
      if (load) {
        await ctx.waitForLoad();
        await ctx.waitFor(() => CLEAN.data.generation() > 0 && document.querySelector('#cl-view-forecast .cl-f-head, #cl-tv .cl-tv-card'), { label: 'first paint' });
        await page.waitForTimeout(400);
      }
    };

    // ── 1. Number style and the wind barb (CLEAN.fmt, CLEAN.icon) ──
    await boot('/?preview=clean');
    const f = await ctx.state(() => {
      const F = CLEAN.fmt, sp = s => s.replace(/ /g, ' ');
      const ring = s => /r="5.5"/.test(s), staff = s => /M16 13.5V4/.test(s);
      return {
        ft: [F.ft(2), F.ft(1.6), F.ft(0.96), F.ft(1.04), F.ft(12.4)].map(sp),
        num: [F.num(1), F.num(1.575), F.num(0)],
        swell: [F.swell([1, 2], 8.15, 'ESE'), F.swell(1.0, 9), F.swell(1.575, 8.15)].map(sp),
        tide: [F.tide(0), F.tide(-0.04), F.tide(-0.42, false), F.tide(2.0, true), F.tide(2.32, true)].map(sp),
        score: [F.score(3), F.score(3.04), F.score(3.84)],
        wind: [2.4, 2.6, 2.9, 7.4, 7.5].map(v => ({ v, text: sp(F.wind(v, 322)), ring: ring(CLEAN.icon.barb(v, 322)), staff: staff(CLEAN.icon.barb(v, 322)) }))
      };
    });
    log('fmt', JSON.stringify(f));
    assert.deepEqual(f.ft, ['2 ft', '1.6 ft', '1 ft', '1 ft', '12 ft'], 'heights: one decimal, a trailing .0 dropped');
    assert.deepEqual(f.num, ['1', '1.6', '0']);
    assert.deepEqual(f.swell, ['1–2 ft @ 8 s ESE', '1 ft @ 9 s', '1.6 ft @ 8 s']);
    assert.deepEqual(f.tide, ['0 ft', '0 ft', '−0.4 ft ▼', '2 ft ▲', '2.3 ft ▲'], 'tide heights in the same style, never "-0"');
    assert.deepEqual(f.score, ['3', '3', '3.8']);
    for (const w of f.wind) {
      const calm = Number(w.text.split(' ')[0]) < 3;
      assert.equal(w.ring, calm, `${w.v} mph prints "${w.text}": calm ring only under 3 mph as printed`);
      assert.equal(w.staff, !calm, `${w.v} mph: a staff and tick whenever the number is 3 or more`);
    }
    // The window band's steady runs (CLEAN.util.steadyRuns): a call under
    // 3 hours joins its neighbour (the one matching on both sides, else
    // the longer), shortest first; a missing hour stays missing.
    const runs = await ctx.state(() => {
      const S = a => CLEAN.util.steadyRuns(a, 3).map(s => s == null ? '-' : s[0]).join('');
      const A = s => s.split('').map(c => c === '-' ? null : { i: 'in', e: 'edge', b: 'blocked' }[c]);
      return ['iiieiii', 'iiiebbbb', 'iiiibeebbbiii', '-e-', 'iii-biii', 'iiibbbiii', ''].map(x => S(A(x)));
    });
    assert.deepEqual(runs, ['iiiiiii', 'iiibbbbb', 'iiiiiiibbbiii', '-e-', 'iii-iiii', 'iiibbbiii', ''], 'steadyRuns');
    // Model › Typical miss in the same style: a miss of 1.0 prints "1", so
    // the unit turns singular ("±1 point", never "±1 points"). Uses the
    // fallback (the app's per-model RMSE) with a stand-in fit, restored after.
    const miss = await ctx.state(() => {
      const S = STATE, cfg = REG_SUBMODELS.cond, keys = ['_lastFitAt', cfg.weightsKey, cfg.rmseKey];
      const keep = {}; keys.forEach(k => { keep[k] = S[k]; });
      const loo = window._regLOOFor;
      const read = v => {
        S._lastFitAt = S._lastFitAt || Date.now();
        S[cfg.weightsKey] = cfg.featureNames.map((_, j) => (j + 1) / 10 + v);   // new weights: a fresh fit, not the memo
        S[cfg.rmseKey] = v;
        CLEAN.render('model', 'request');
        const b = document.querySelector('#cl-view-model .cl-m-err b');
        return b ? b.textContent.replace(/[\u00a0\u202f]/g, ' ') : null;
      };
      window._regLOOFor = undefined;
      try { return [read(1.0), read(1.04), read(0.7), read(2)]; }
      finally { window._regLOOFor = loo; keys.forEach(k => { S[k] = keep[k]; }); CLEAN.render('model', 'request'); }
    });
    log('typical miss', JSON.stringify(miss));
    assert.deepEqual(miss, ['±1 point', '±1 point', '±0.7 points', '±2 points'], 'Model › Typical miss: number style and its unit');

    // ── 2. Keyboard focus: the clean ring, never under the tab bar ──
    await page.mouse.click(5, 300);
    let row = null;
    for (let i = 0; i < 40 && !row; i++) {
      await page.keyboard.press('Tab');
      row = await ctx.state(() => {
        const e = document.activeElement;
        if (!e || !e.matches('#cl-view-forecast .cl-f-bc')) return null;
        const cs = getComputedStyle(e), r = e.getBoundingClientRect();
        const bar = document.querySelector('.cl-tabs').getBoundingClientRect();
        return { color: cs.outlineColor, width: cs.outlineWidth, offset: cs.outlineOffset, bottom: r.bottom, barTop: bar.top };
      });
    }
    log('focused buoy check', JSON.stringify(row));
    assert.ok(row, 'Tab reaches the buoy check');
    assert.equal(row.color, 'rgb(0, 105, 62)', 'focus ring is --in (the build\'s green), not the classic slate blue');
    assert.equal(row.width, '2px');
    assert.equal(row.offset, '2px');
    assert.ok(row.bottom <= row.barTop, `the focused control sits above the tab bar (bottom ${row.bottom}, bar top ${row.barTop})`);
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (fresh boot)');

    // ── 3. Wave forecast down, no saved copy: wind and tides still show ──
    ctx.net.marine = 'down';
    await boot('/?preview=clean');
    const md = await ctx.state(() => ({
      fd: !!STATE.forecastData,
      health: { marine: STATE.dataHealth.marine.origin, wind: STATE.dataHealth.wind.origin, tides: STATE.dataHealth.tides.origin },
      wind: CLEAN.data.now().wind && CLEAN.data.now().wind.mph,
      events: CLEAN.data.tideEvents().length,
      lows: CLEAN.data.week().map(d => d.low ? CLEAN.fmt.time(d.low.t).replace(/ /g, ' ') : null)
    }));
    const cond = await txt('#cl-view-forecast .cl-f-cond');
    log('marine down', JSON.stringify(md), '| wind and tide:', cond);
    assert.equal(md.fd, false, 'the app has no wave forecast (STATE.forecastData null)');
    assert.deepEqual(md.health, { marine: 'failed', wind: 'live', tides: 'live' });
    assert.match(cond, /Wind 7 mph SW/, 'Forecast: the wind that loaded');
    assert.match(cond, /Tide 2\.3 ft ▲ · high 1:37 PM/, 'Forecast: the tide that loaded');
    assert.ok(md.events > 20, 'tide events from the loaded hi/lo');
    assert.deepEqual(md.lows.slice(0, 3), ['7:28 AM', '8:29 AM', '9:34 AM'], 'week lows');
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (marine down)');

    // Same outage on Choc TV.
    await page.setViewportSize(TV);
    await boot('/?kiosk=1&preview=clean&kioskRotate=100000');
    await ctx.waitFor(() => document.querySelector('#cl-tv [data-panel="cl-days1"] .cl-tv-card'), { label: 'TV cards' });
    const card = await txt('#cl-tv [data-panel="cl-days1"] .cl-tv-card');
    log('TV marine down', card);
    assert.match(card, /Incoming 7:28 AM/, 'TV card: the incoming tide from the tides that loaded');
    assert.doesNotMatch(card, /No tide times/);
    assert.match(card, /At low \d+ mph/, 'TV card: wind at the low from the wind that loaded');
    ctx.net.marine = 'ok';

    // ── 4. CO-OPS down: the band that reaches the reef heads the day ──
    ctx.net.coops = 'error';
    await page.setViewportSize(PHONE);
    await boot('/?preview=clean');
    const fri = await ctx.state(() => {
      const d = CLEAN.data.week()[1];
      const b = x => x && { min: x.min, max: x.max, period: x.period, compass: x.compass, status: x.status };
      return { swell: b(d.swell), other: b(d.other), status: d.status, reaches: d.reaches };
    });
    log('Fri, no tides', JSON.stringify(fri));
    assert.equal(fri.swell.status, 'in', 'Fri headlines the in-window band');
    assert.equal(fri.swell.compass, 'SE');
    assert.equal(fri.other.status, 'blocked', 'the bigger blocked band becomes the other');
    assert.equal(fri.other.compass, 'S');
    assert.equal(fri.reaches, true);
    assert.deepEqual([fri.swell.min, fri.swell.max, Math.round(fri.swell.period)], [0, 1, 8], '0–1 ft @ 8 s SE');
    ctx.net.coops = 'ok';

    // ── 5. Buoy list blip at boot: give up "Loading…", then recover ──
    let mode = 'down', catalogHits = 0;
    ctx.serve('/data/buoys-east-coast.json', () => { catalogHits++; return mode === 'down' ? { status: 503, body: '' } : BUOYS; });
    await boot('/?preview=clean', { load: false });
    await page.waitForTimeout(1500);
    const b0 = await ctx.state(() => ({ fresh: CLEAN.data.freshness(), sel: !!STATE.selectedBuoy }));
    assert.deepEqual(b0, { fresh: 'loading', sel: false }, 'first seconds: still loading, nothing selected');
    await page.clock.fastForward('01:05');                // retry at 15 s fails too; a minute passes
    await ctx.waitFor(() => CLEAN.data.freshness() === 'dead', { label: 'loading gave up', timeout: 10000 });
    log('gave up | catalog requests', catalogHits);
    assert.ok(catalogHits >= 2, 'the phone retried the buoy list');
    mode = 'ok';
    await page.clock.fastForward('01:05');                // next retry (once a minute) succeeds
    await ctx.waitForLoad({ timeout: 20000 });
    await ctx.waitFor(() => CLEAN.data.loaded() && CLEAN.data.now().swell, { label: 'wave forecast after recovery', timeout: 10000 });
    const rec = await ctx.state(() => ({ fresh: CLEAN.data.freshness(), sel: STATE.selectedBuoy && STATE.selectedBuoy.home }));
    log('recovered', JSON.stringify(rec), '| catalog requests', catalogHits);
    assert.equal(rec.sel, 'chocomount', 'the home spot was selected without a reload');
    assert.notEqual(rec.fresh, 'loading');
    await ctx.screenshot('clean-core-recovered');

    // ── 6. Fri 2 Oct 7:05 AM: the reef's swell leads CLEAN.data.now() (Choc TV's hero) ──
    await page.clock.setSystemTime(new Date('2026-10-02T07:05:00-04:00'));
    await boot('/?preview=clean');
    const raw = await ctx.state(() => {
      const m = STATE.forecastData.marine.hourly, i = marineNowIndex(STATE.forecastData.marine);
      return { t: m.time[i], p: [m.swell_wave_height[i], m.swell_wave_period[i], m.swell_wave_direction[i]],
        s: [m.secondary_swell_wave_height[i], m.secondary_swell_wave_period[i], m.secondary_swell_wave_direction[i]] };
    });
    const hero = await ctx.state(() => {
      const n = CLEAN.data.now(), F = CLEAN.fmt, sp = s => s.replace(/[\u00a0\u202f]/g, ' ');
      return { h: F.num(n.swell.h), period: Math.round(n.swell.period), dir: Math.round(n.swell.dir), compass: n.swell.compass, status: n.swell.status,
        blocked: n.blocked.map(b => sp(F.swell(b.h, b.period, b.compass))) };
    });
    log('Fri 7:05 AM', JSON.stringify(raw), JSON.stringify(hero));
    assert.equal(raw.t, '2026-10-02T07:00');
    assert.ok(raw.p[2] > 163 && raw.s[2] >= 115 && raw.s[2] <= 158, 'fixture: primary blocked from the south, secondary in the window');
    assert.deepEqual(hero, { h: '1.1', period: 9, dir: 124, compass: 'SE', status: 'in', blocked: ['1.6 ft @ 4 s S'] }, 'the in-window 9 s train leads; the bigger 4 s S train is blocked');
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (Fri)');
    await ctx.screenshot('clean-core-fri-hero');
  }
};
