// Sound Check (research/): the in-page ray tracers (Drop a wave, the 50 km side view, Part 1's forward rays) work
// out how fast a swell travels at each depth. They used the explicit Fenton-McKee formula, up to 1.7 % off the
// exact linear dispersion relation; that error changes with depth, so rays bent up to 0.9 deg wrong (Snell's-law
// check: scripts/test_raycore.py). They now solve w^2 = g k tanh(k h) exactly, like the tables they're drawn with.
'use strict';

module.exports = {
  name: 'Sound Check: wave speeds come from the exact dispersion relation, like the ray tables',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip._speeds, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const g = 9.81, out = { worst: 0, table: 0, tracer: 0, rows: [] };
      for (let T = 5; T <= 17; T++) {
        for (const h of [0.5, 1, 2, 4, 10, 20, 48, 200, 1000, 4000]) {
          const L = window.CHOC.waveL(T, h), k = 2 * Math.PI / L, w = 2 * Math.PI / T;
          out.worst = Math.max(out.worst, Math.abs(g * k * Math.tanh(k * h) - w * w) / (w * w));
          out.table = Math.max(out.table, Math.abs(window.CHOC.crestSpeed(T, h) * T / L - 1));
          out.tracer = Math.max(out.tracer, Math.abs(window.CHOC.trip._speeds(T, h)[0] * T / L - 1));
        }
      }
      const s = window.CHOC.trip._speeds(12, 10);
      out.rows = [window.CHOC.waveL(12, 10), s[0], s[1], s[2]];
      return out;
    });
    log(`dispersion residual ${r.worst.toExponential(1)}, table ${r.table.toExponential(1)}, tracer ${r.tracer.toExponential(1)}; ` +
        `12 s in 10 m: L ${r.rows[0].toFixed(2)} m, crest ${r.rows[1].toFixed(3)} m/s, group ${r.rows[2].toFixed(3)} m/s, zone ${Math.round(r.rows[3])} m`);
    assert.ok(r.worst < 1e-10, `w^2 = g k tanh(k h) holds to rounding error (worst ${r.worst})`);
    assert.ok(r.table < 1e-5, `the tracers' speed table matches it (worst ${r.table})`);
    assert.ok(r.tracer < 1e-5, `Drop a wave's tracer uses it (worst ${r.tracer})`);
    // 12 s swell in 10 m of water is 113.30 m long (the old formula said 115.14 m, 1.6 % long)
    assert.ok(Math.abs(r.rows[0] - 113.30) < 0.01, `12 s swell in 10 m is 113.30 m long (${r.rows[0]})`);
    assert.deepEqual(errors, [], 'no page errors');
  }
};
