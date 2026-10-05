// ?preview=clean, Choc TV (?kiosk=1&preview=clean) with NOAA's tide
// predictions down (CO-OPS answers "No Predictions", HTTP 200):
//   • Day cards: without tide times kioskDaySummary reads each day's swell
//     over all daylight (tidesDown), not its incoming tide. Every card with
//     a swell says so ("No tide times · swell over all daylight", the
//     classic Choc TV's "NO TIDE DATA — ALL-DAY SWELL"), so a call that
//     changed with the reading doesn't change silently.
//   • Sources says the same instead of "the swell over the incoming tide".
//   • Radar 7-day strip: the phone chart's rule. Solid = the swell that
//     reaches the reef (each train weighted by its alignment with the
//     115–158° window), ghost = all the swell behind it; one continuous
//     shape hour to hour, no slivers.
//   • Radar land: filled and outlined as the board draws it, the traced
//     round knob on the shore filled as land (not a dark hole).
//   • Big readouts follow the one number style: no trailing ".0".
'use strict';

module.exports = {
  name: 'clean preview Choc TV: tides down → all-day swell named on cards and Sources; radar strip, land, numbers',
  options: {
    gate: null,
    viewport: { width: 1180, height: 820 },
    net: { coops: 'error' }
  },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/?kiosk=1&preview=clean&kioskRotate=600000&kioskRadarStep=600000');
    await ctx.waitFor(() => window.CLEAN && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted, { label: 'clean Choc TV mounted' });
    await ctx.waitForChart();
    await ctx.waitForLoad();
    await ctx.waitFor(() => {
      const p = document.querySelector('#cl-tv [data-panel="cl-days1"]');
      return p && p.querySelectorAll('.cl-tv-card').length === 3 && /\d/.test(p.querySelector('.cl-tv-card').textContent);
    }, { label: 'three day cards' });

    // ── Day cards without tide times ──
    const cards = await ctx.state(() => {
      const wk = CLEAN.data.week();
      return {
        tidesDown: wk.map(d => !!d.tidesDown),
        cards: ['cl-days1', 'cl-days2'].flatMap(p => [...document.querySelectorAll('#cl-tv [data-panel="' + p + '"] .cl-tv-card')].map(c => ({
          day: c.querySelector('.cl-tv-day').textContent,
          hasSwell: !!(c.querySelector('.cl-tv-num') && /\d/.test(c.querySelector('.cl-tv-num').textContent)) || !!c.querySelector('.cl-tv-blk'),
          tide: c.querySelector('.cl-tv-win').textContent.replace(/\s+/g, ' ').trim(),
          wind: c.querySelector('.cl-tv-wd').textContent.replace(/\s+/g, ' ').trim()
        })))
      };
    });
    log('cards', JSON.stringify(cards));
    assert.deepEqual(cards.tidesDown, [true, true, true, true, true, true, true], 'CO-OPS down: every day falls back to all daylight');
    assert.equal(cards.cards.length, 6);
    assert.ok(cards.cards.some(c => c.hasSwell), 'the fixtures have a swell forecast');
    for (const c of cards.cards) {
      if (!c.hasSwell) continue;
      assert.equal(c.tide, 'No tide times · swell over all daylight', c.day + ': the card says the swell is read over all daylight');
      assert.match(c.wind, /^At noon /, c.day + ': the wind is the noon forecast');
    }
    await ctx.screenshot('tv-tides-down-days1');

    // ── Sources: the same, in words ──
    await page.locator('#cl-tv .cl-tv-btn[data-act="sources"]').click();
    await ctx.waitFor(() => { const o = document.getElementById('kiosk-info-overlay'); return o && o.closest('#cl-tv') && getComputedStyle(o).display !== 'none'; }, { label: 'Sources open' });
    const src = await ctx.state(() => document.getElementById('kiosk-info-card').innerText.replace(/\s+/g, ' '));
    log('sources', src.slice(0, 400));
    assert.match(src, /tide times didn’t load, so each day shows the swell over all of its daylight/);
    assert.match(src, /The wind is the forecast at noon\./);
    assert.doesNotMatch(src, /Each day shows the swell over the incoming tide/, 'Sources no longer claims the incoming tide');
    await ctx.screenshot('tv-tides-down-sources');
    await page.locator('#kiosk-info-overlay').click();
    await ctx.waitFor(() => getComputedStyle(document.getElementById('kiosk-info-overlay')).display === 'none', { label: 'Sources closed' });

    // ── Radar ──
    await ctx.state(() => CLEAN_TV.show('cl-radar'));
    await ctx.waitFor(() => document.querySelector('#cl-tv .cl-tv-cht path.sw'), { label: 'radar strip drawn' });

    // Strip: one continuous solid over one continuous ghost (every hour
    // has a reading in the fixtures), and the solid is the in-window part
    // of the ghost: Σ alignment × H over Σ H, hour by hour.
    const strip = await ctx.state(() => {
      const svg = document.querySelector('#cl-tv .cl-tv-cht svg');
      const pts = cls => {
        const d = svg.querySelector('path.' + cls).getAttribute('d');
        const subs = d.split('M').filter(Boolean);
        const map = new Map();
        subs.forEach(s => s.replace(/Z/g, '').split('L').forEach(p => {
          const [x, y] = p.trim().split(/\s+/).map(Number);
          if (!map.has(x)) map.set(x, y);
          else map.set(x, Math.min(map.get(x), y));
        }));
        return { subs: subs.length, map, base: Number(subs[0].split('L')[0].trim().split(/\s+/)[1]) };
      };
      const sw = pts('sw'), gh = pts('gh');
      const t0 = new Date(); t0.setHours(0, 0, 0, 0);
      const X = t => Math.round((t - t0.getTime()) / (7 * 864e5) * 1100 * 10) / 10;
      const rows = [];
      CLEAN.data.hours().forEach(hr => {
        if (!hr || !hr.at) return;
        const x = X(hr.at.getTime());
        if (x < 0 || x > 1100 || !sw.map.has(x) || !gh.map.has(x)) return;
        const all = [];
        [hr.swell].concat(hr.others || []).forEach(t => { if (t && t.h > 0 && all.indexOf(t) < 0) all.push(t); });
        const tot = all.reduce((a, t) => a + t.h, 0);
        const inW = all.reduce((a, t) => a + CLEAN.util.alignment(t.dir) * t.h, 0);
        if (tot < 0.3) return;
        rows.push({ x, want: inW / tot, got: (sw.base - sw.map.get(x)) / (gh.base - gh.map.get(x)), mixed: all.length > 1 && all.some(t => t.status === 'blocked') });
      });
      const worst = rows.reduce((a, r) => Math.max(a, Math.abs(r.got - r.want)), 0);
      return { swSubs: sw.subs, ghSubs: gh.subs, n: rows.length, mixed: rows.filter(r => r.mixed).length, worst };
    });
    log('strip', JSON.stringify(strip));
    assert.equal(strip.swSubs, 1, 'the solid is one continuous shape (no slivers)');
    assert.equal(strip.ghSubs, 1, 'the ghost is one continuous shape');
    assert.ok(strip.n > 100, 'most of the week is checked');
    assert.ok(strip.mixed > 0, 'the week has hours where a blocked train sits beside one that reaches');
    assert.ok(strip.worst < 0.05, 'solid / ghost = the in-window share of the swell, hour by hour (worst ' + strip.worst.toFixed(3) + ')');

    // The strip's window band: blocks of 3 hours or more, as on the phone
    // chart (an hour is 1100 / 168 ≈ 6.5 units; the strip's ends may clip
    // half an hour).
    const tvBand = await ctx.state(() => {
      const hs = 1100 / (7 * 24);
      const rects = [...document.querySelectorAll('#cl-tv .cl-tv-cht rect.b-in, #cl-tv .cl-tv-cht rect.b-edge, #cl-tv .cl-tv-cht rect.b-blk')]
        .map(r => ({ c: r.getAttribute('class'), x: +r.getAttribute('x'), w: +r.getAttribute('width') }));
      return { rects: rects.length, short: rects.filter(r => r.w < 2.5 * hs).map(r => r.c + '@' + Math.round(r.x) + ' ' + r.w) };
    });
    log('strip band', JSON.stringify(tvBand));
    assert.ok(tvBand.rects > 1 && tvBand.rects <= 12, 'the strip band is a few blocks (' + tvBand.rects + ')');
    assert.deepEqual(tvBand.short, [], 'no strip band block under 3 hours');

    // Land: one faint light fill over land and knob, a muted outline;
    // nothing painted in the page colour over it.
    const land = await ctx.state(() => {
      const base = document.querySelector('#cl-tv .cl-tv-scope-base svg');
      const g = base.querySelector('.land');
      const fills = [...g.querySelectorAll('path')].map(p => getComputedStyle(p).fill);
      const shore = base.querySelector('.shore');
      return {
        paths: fills.length, fills: [...new Set(fills)], opacity: getComputedStyle(g).opacity,
        ponds: base.querySelectorAll('.pond').length,
        rim: !!base.querySelector('circle.rim[clip-path]'),
        shoreStroke: shore && getComputedStyle(shore).stroke,
        muted: getComputedStyle(document.querySelector('#cl-tv .cl-tv-radar')).getPropertyValue('--muted').trim()
      };
    });
    log('land', JSON.stringify(land));
    assert.equal(land.paths, 2, 'land and the round knob on the shore are both land');
    assert.deepEqual(land.fills, ['rgb(255, 255, 255)']);
    assert.equal(land.opacity, '0.05', 'the board’s faint light fill');
    assert.equal(land.ponds, 0, 'no dark hole in the land');
    assert.ok(land.rim, 'the land’s edge along the ring is outlined');
    assert.equal(land.shoreStroke, 'rgb(154, 170, 162)', 'the shore is outlined in muted');

    // Big readouts: one decimal with a trailing ".0" dropped. Play an
    // hour whose reef swell is a whole number of feet.
    const whole = await ctx.state(() => {
      const nowIdx = CLEAN.data.nowIndex();
      const hrs = CLEAN.data.hours();
      for (let i = Math.max(0, nowIdx); i < hrs.length; i++) {
        const hr = hrs[i];
        if (!hr || hr.dark) continue;
        // The radar's hero: the biggest train that reaches the reef.
        let reach = null;
        [hr.swell].concat(hr.others || []).forEach(t => {
          if (t && t.h > 0 && (t.status === 'in' || t.status === 'edge') && (!reach || t.h > reach.h)) reach = t;
        });
        if (!reach) continue;
        const r = Math.round(reach.h * 10) / 10;
        if (r > 0 && r < 10 && r === Math.round(r)) {
          CLEAN_TV.playAt(i);
          return { i, h: reach.h, hero: document.querySelector('#cl-tv .cl-tv-rt .cl-tv-num').textContent };
        }
      }
      return null;
    });
    log('whole-feet hour', JSON.stringify(whole));
    assert.ok(whole, 'the fixtures have a daylight hour of whole feet');
    assert.equal(whole.hero, String(Math.round(whole.h)), 'the radar hero drops the trailing .0');
    const nums = await ctx.state(() => [...document.querySelectorAll('#cl-tv .cl-tv-num')].map(e => e.textContent));
    assert.ok(nums.every(t => !/\.0$/.test(t)), 'no big number ends in .0: ' + nums.join(', '));
    await page.waitForTimeout(300);
    await ctx.screenshot('tv-radar');

    const own = await ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message));
    assert.deepEqual(own, [], 'no CLEAN.errors');
  }
};
