// Sound Check (research/): the history bot fits the ratings model, the sessions' pairs and the forecast scorecard
// to the crew's surf log again whenever a session is logged (scripts/history/ratings.py), so what the page says
// about the log comes from those files, not from when the page was built: how many sessions, how closely the
// model and the buoy rank them, which months they cover, how many flat ones, which input matters most, and how
// close the forecasts came.
// First with the files the tests pin (the 28 sessions logged through 18 Oct 2025): the page says what its markup
// says. Then with a 29th session (a flat December day), a model that now ranks the tide second, and a scorecard
// with bigger misses: the page follows.
'use strict';

const zlib = require('zlib');

const read = () => {
  const t = (id) => { const n = document.getElementById(id); return n && n.textContent.replace(/\s+/g, ' ').trim(); };
  const all = (k) => [...document.querySelectorAll(`[data-log="${k}"]`)].map((n) => n.textContent);
  return {
    pairs: all('pairs'), model: all('model'), score: all('score'),
    rhoM: t('q1RhoM'), rhoB: t('q1RhoB'), better: t('q1Better'), order: t('qa1Order'),
    months: t('goodMonthsNote'), advice: t('logAdvice'), within: t('fcsWithin'), miss: t('fcsMiss'),
    cap: t('decCap'), scoreRows: [...document.querySelectorAll('#fcScore tbody tr')].map((r) => [...r.cells].map((c) => c.textContent).join(' | '))
  };
};
// Spearman's ρ with tied values sharing their average rank (worked out here independently of the page)
function rho(x, y) {
  const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = []; for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const rx = rank(x), ry = rank(y), m = (x.length - 1) / 2;
  let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (rx[i] - m) * (ry[i] - m); b += (rx[i] - m) ** 2; c += (ry[i] - m) ** 2; }
  return a / Math.sqrt(b * c);
}

module.exports = {
  name: 'Sound Check: what the page says about the surf log follows the files the history bot fits to it',
  options: { viewport: { width: 1180, height: 900 }, timeoutMs: 120000 },
  async run({ page, ctx, assert, log }) {
    const ready = () => ctx.waitFor(() => window.CHOC && window.CHOC.D && document.getElementById('decCap').textContent &&
      document.querySelector('#fcScore tbody'), { label: 'page and scorecard' });
    const hist = zlib.gunzipSync(ctx.fixture('soundcheck/hist.js.gz', null)).toString();
    const pairs = JSON.parse(hist.match(/\nconst SESSPAIRS=(.*);\n/)[1]);

    // ── The pinned files: what the page works out is what its markup says ──
    await ctx.open('/research/index.html');
    await ready();
    let r = await page.evaluate(read);
    log('pinned', JSON.stringify(r));
    const built = await page.evaluate(async () => {            // the markup as built, before any script ran
      const doc = new DOMParser().parseFromString(await (await fetch('/research/index.html')).text(), 'text/html');
      const t = (id) => doc.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
      const all = (k) => [...doc.querySelectorAll(`[data-log="${k}"]`)].map((n) => n.textContent);
      return { pairs: all('pairs'), model: all('model'), score: all('score'), rhoM: t('q1RhoM'), rhoB: t('q1RhoB'), better: t('q1Better'),
        order: t('qa1Order'), months: t('goodMonthsNote'), advice: t('logAdvice'), within: t('fcsWithin'), miss: t('fcsMiss') };
    });
    for (const k of Object.keys(built)) assert.deepEqual(r[k], built[k], k + ': worked out from the files = the markup');
    assert.deepEqual(r.pairs, ['28', '28', '28']);
    assert.deepEqual(r.model, ['28']);
    assert.deepEqual(r.score, ['28']);
    assert.equal(r.rhoM, rho(pairs.map((p) => p[3]), pairs.map((p) => p[1])).toFixed(2));
    assert.equal(r.rhoM, '0.86');
    assert.equal(r.rhoB, '0.66');
    assert.equal(r.better, 'much better than');
    assert.equal(r.order, 'After size comes offshore wind; the tide barely matters.');
    assert.equal(r.months, 'Hatched months have no logged sessions (all 28 are June–October), so the model has never seen winter water, winter wind or winter crowds, and those bars are extrapolation.');
    assert.equal(r.advice, 'The ratings model has 28 Choc sessions, none from November to May, only two flat ones, and no logged Wilderness sessions.');
    assert.equal(r.within, 'a twentieth of a foot');
    assert.equal(r.miss, '0.3–0.4 ft');
    assert.match(r.cap, /built from your surf log at Choc\. Your log has no sessions from November to May, so winter counts are extrapolation\./);

    // ── A 29th session (flat, 14 Dec 2025), the tide now second, a scorecard with bigger misses ──
    const more = `
DATA.model.sessions.push({ date: '2025-12-14 10:00', x: [1.2, 9.1, 3.4, 8.0, 0.5, 1.8], size: 1, ride: 2, wind_q: 5, avg: 2.7 });
DATA.model.targets.avg.coef = [0.9, 0.3, 0.6];
SESSPAIRS.push(['2025-12-14', 1, 6.1, 0.8]);
`;
    ctx.serve('/research/hist.js', hist + more);
    const score = JSON.parse(ctx.fixture('soundcheck/score.json'));
    Object.assign(score.summary, {
      buoy_model: { n: 29, rho_size: 0.8 },
      d1: { n: 29, rho_size: 0.66, median_vs_arrived_ft: -0.12, typical_miss_ft: 0.42 },
      d2: { n: 29, rho_size: 0.58, median_vs_arrived_ft: 0.08, typical_miss_ft: 0.5 },
      d3: { n: 28, rho_size: 0.6, median_vs_arrived_ft: 0.02, typical_miss_ft: 0.36 }
    });
    ctx.serve('/research/fc/score.json', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(score) });
    await ctx.open('/research/index.html');
    await ready();
    await ctx.waitFor(() => document.getElementById('fcsMiss').textContent !== '0.3–0.4 ft', { label: 'scorecard caption' });
    r = await page.evaluate(read);
    log('29 sessions', JSON.stringify(r));
    const p2 = pairs.concat([['2025-12-14', 1, 6.1, 0.8]]);
    assert.deepEqual(r.pairs, ['29', '29', '29']);
    assert.deepEqual(r.model, ['29']);
    assert.deepEqual(r.score, ['29'], 'the most sessions any lead was scored on');
    assert.equal(r.rhoM, rho(p2.map((p) => p[3]), p2.map((p) => p[1])).toFixed(2));
    assert.equal(r.rhoB, rho(p2.map((p) => p[2]), p2.map((p) => p[1])).toFixed(2));
    assert.equal(r.order, 'After size comes the tide; offshore wind matters least.');
    assert.equal(r.months, 'Hatched months have no logged sessions (the 29 logged are from June–October and December), so those bars are extrapolation.');
    assert.equal(r.advice, 'The ratings model has 29 Choc sessions, one from November to May, only three flat ones, and no logged Wilderness sessions.');
    assert.equal(r.within, '0.1 ft', 'the biggest average miss over the three leads');
    assert.equal(r.miss, '0.4–0.5 ft');
    assert.match(r.cap, /built from your surf log at Choc\. Months with no logged sessions are extrapolation\./);
    assert.equal(r.scoreRows[1], '1 day ahead | 0.66 | −0.1 ft | 0.4 ft');
    // December's bar in the good-day months is no longer hatched: it has a session now
    const dec = await page.evaluate(() => [...document.querySelectorAll('#goodMonths rect')].filter((n) => n.getAttribute('rx') === '2').map((n) => n.getAttribute('fill'))[11]);
    assert.ok(dec && !/hatch/.test(dec), `December filled, not hatched (${dec})`);
  }
};
