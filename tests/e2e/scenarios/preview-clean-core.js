// ?preview=clean — core's readings (previews/clean/core.js, base.css),
// checked the way the crew sees them, against the fixtures:
//   • one number style: one decimal, a trailing ".0" dropped (1 ft, 1.6 ft,
//     0 ft tide, "3 / 10"), and a wind barb that never shows the calm ring
//     beside "3 mph";
//   • the wave forecast down (no saved copy): the wind and the CO-OPS tides
//     that did load still show, on the phone (Now block, week lows) and on
//     Choc TV ("Incoming 7:28 AM");
//   • CO-OPS down: a day whose bigger band is blocked but whose other band
//     is in the window headlines the band that reaches the reef (Fri);
//   • the reef's swell leads the Now block: at Fri 7:05 AM the 9 s SE
//     groundswell (in the window) beats the bigger 4 s wind swell from S
//     174° (blocked), which drops to the dim "· blocked" line;
//   • a Wi-Fi blip on the buoy list at boot: the phone gives up "Loading…"
//     after a minute and, once the list answers, loads by itself;
//   • keyboard focus: the build's green ring (not the classic blue one), and
//     a focused week row is never left under the tab bar; Details values
//     share one left edge (A2-Phone-Sat).
'use strict';

const fs = require('fs');
const path = require('path');

const PHONE = { width: 390, height: 844 };
const TV = { width: 1180, height: 820 };
const BUOYS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'buoys-east-coast.json'));

module.exports = {
  name: 'clean preview core: number style, wind and tides without the wave forecast, reach-first hero and week, boot recovery, focus ring',
  options: {
    gate: null,                                   // the preview skips the boat question itself
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
        await ctx.waitFor(() => CLEAN.data.generation() > 0 && document.querySelector('#cl-view-forecast .cl-f-now, #cl-tv .cl-tv-card'), { label: 'first paint' });
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
        if (!e || !e.matches('#cl-view-forecast .cl-f-row[data-k="3"]')) return null;
        const cs = getComputedStyle(e), r = e.getBoundingClientRect();
        const bar = document.querySelector('.cl-tabs').getBoundingClientRect();
        return { color: cs.outlineColor, width: cs.outlineWidth, offset: cs.outlineOffset, bottom: r.bottom, barTop: bar.top };
      });
    }
    log('focused week row', JSON.stringify(row));
    assert.ok(row, 'Tab reaches the Sun week row');
    assert.equal(row.color, 'rgb(0, 105, 62)', 'focus ring is --in (the build\'s green), not the classic slate blue');
    assert.equal(row.width, '2px');
    assert.equal(row.offset, '2px');
    assert.ok(row.bottom <= row.barTop, `the focused row sits above the tab bar (row bottom ${row.bottom}, bar top ${row.barTop})`);

    // Details › Light and water: the values share one left edge.
    if (await ctx.state(() => document.querySelector('#cl-view-forecast .cl-f-dr[data-dd="light"]').getAttribute('aria-expanded')) !== 'true') {
      await page.locator('#cl-view-forecast .cl-f-dr[data-dd="light"]').click();
    }
    await ctx.waitFor(() => document.querySelector('#cl-view-forecast .cl-f-kv'), { label: 'light details open' });
    const xs = await ctx.state(() => [...document.querySelectorAll('#cl-view-forecast .cl-f-kv > :nth-child(even)')].map(e => {
      const r = document.createRange(); r.selectNodeContents(e); return Math.round(r.getBoundingClientRect().left);
    }));
    log('kv value left edges', xs.join(' '));
    assert.ok(xs.length >= 4, 'light rows');
    assert.equal(new Set(xs).size, 1, 'values left-aligned in one column');
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
    const nowBlock = await txt('#cl-view-forecast .cl-f-now');
    const week = await txt('#cl-view-forecast .cl-f-wk');
    log('marine down', JSON.stringify(md), '| now:', nowBlock, '| week:', week);
    assert.equal(md.fd, false, 'the app has no wave forecast (STATE.forecastData null)');
    assert.deepEqual(md.health, { marine: 'failed', wind: 'live', tides: 'live' });
    assert.match(nowBlock, /No wave forecast right now/);
    assert.match(nowBlock, /7 mph SW/, 'Now block: the wind that loaded');
    assert.match(nowBlock, /Low 8:33 PM/, 'Now block: the next low from the tides that loaded');
    assert.ok(md.events > 20, 'tide events from the loaded hi/lo');
    assert.deepEqual(md.lows.slice(0, 3), ['7:28 AM', '8:29 AM', '9:34 AM'], 'week lows');
    assert.match(week, /Today.*7:28 AM.*Fri.*8:29 AM.*Sat.*9:34 AM/, 'week rows show the lows');
    assert.doesNotMatch(week, /didn.t load/);
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
    const friRow = await txt('#cl-view-forecast .cl-f-row[data-k="1"]');
    log('Fri, no tides', JSON.stringify(fri), '|', friRow);
    assert.equal(fri.swell.status, 'in', 'Fri headlines the in-window band');
    assert.equal(fri.swell.compass, 'SE');
    assert.equal(fri.other.status, 'blocked', 'the bigger blocked band becomes the other');
    assert.equal(fri.other.compass, 'S');
    assert.equal(fri.reaches, true);
    assert.doesNotMatch(friRow, /Nothing reaches the reef|BLOCKED/);
    assert.match(friRow, /0–1 ft @ 8 s SE/);
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
    await ctx.waitFor(() => /No wave forecast right now/.test(document.querySelector('#cl-view-forecast .cl-f-now').innerText), { label: 'Now block says it did not load', timeout: 5000 });
    const gaveUp = await txt('#cl-view-forecast .cl-f-wk');
    log('gave up', gaveUp, '| catalog requests', catalogHits);
    assert.doesNotMatch(gaveUp, /Loading/, 'the week stops saying Loading');
    assert.ok(catalogHits >= 2, 'the phone retried the buoy list');
    mode = 'ok';
    await page.clock.fastForward('01:05');                // next retry (once a minute) succeeds
    await ctx.waitForLoad({ timeout: 20000 });
    await ctx.waitFor(() => document.querySelector('#cl-view-forecast .cl-f-now .cl-f-num'), { label: 'Now block hero after recovery', timeout: 10000 });
    const rec = await ctx.state(() => ({ fresh: CLEAN.data.freshness(), sel: STATE.selectedBuoy && STATE.selectedBuoy.home }));
    log('recovered', JSON.stringify(rec), '| catalog requests', catalogHits);
    assert.equal(rec.sel, 'chocomount', 'the home spot was selected without a reload');
    assert.notEqual(rec.fresh, 'loading');
    await ctx.screenshot('clean-core-recovered');

    // ── 6. Fri 2 Oct 7:05 AM: the reef's swell leads the Now block ──
    await page.clock.setSystemTime(new Date('2026-10-02T07:05:00-04:00'));
    await boot('/?preview=clean');
    const raw = await ctx.state(() => {
      const m = STATE.forecastData.marine.hourly, i = marineNowIndex(STATE.forecastData.marine);
      return { t: m.time[i], p: [m.swell_wave_height[i], m.swell_wave_period[i], m.swell_wave_direction[i]],
        s: [m.secondary_swell_wave_height[i], m.secondary_swell_wave_period[i], m.secondary_swell_wave_direction[i]] };
    });
    const hero = await ctx.state(() => {
      const q = s => { const e = document.querySelector('#cl-view-forecast .cl-f-now ' + s); return e ? e.textContent.replace(/[  ]/g, ' ').trim() : null; };
      return { num: q('.cl-f-num'), meta: q('.cl-f-meta'), status: q('.cl-st'), dim: q('.cl-f-dim') };
    });
    log('Fri 7:05 AM', JSON.stringify(raw), JSON.stringify(hero));
    assert.equal(raw.t, '2026-10-02T07:00');
    assert.ok(raw.p[2] > 163 && raw.s[2] >= 115 && raw.s[2] <= 158, 'fixture: primary blocked from the south, secondary in the window');
    assert.equal(hero.num, '1.1', 'hero = the in-window 9 s train');
    assert.match(hero.meta, /^9 s\s*·\s*SE 124°$/);
    assert.equal(hero.status, 'IN WINDOW');
    assert.equal(hero.dim, '1.6 ft @ 4 s S · blocked', 'the bigger blocked train is the dim line');
    assert.deepEqual(await cleanErrors(), [], 'CLEAN.errors (Fri)');
    await ctx.screenshot('clean-core-fri-hero');
  }
};
