// Model-vs-Buoy verification panel (Tab 2).
//   Audit C15: the Period and Direction rows compared different wave
//   partitions (NDBC SwP, always ≥ 10 s at 44097, vs the model's swell
//   partition, median 5.6 s), so the panel reported a -5.8 s "model
//   error" that was a definition mismatch. The getters must pair like
//   with like, for old rows and for the new rows the pipeline now logs
//   (buoy tm10/apd/swh8, model wvd).
//   Audit C25: day ticks sat on UTC midnight but carried the local date,
//   so in New York each "M/D" marked 8 PM of that day.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixtureJSON } = require('../helpers/load-app');

function stats(app, rows, key, series) {
  app.set('_w5Rows', rows);
  return app.clone(`(() => { const g = VERIF_GET.${key}; return verifStats(_w5Rows, g.obs, g.${series}, g.circular); })()`);
}

test('period pairs the buoy energy period (or DPD on old rows) with the model mean period', () => {
  const app = loadApp();
  const rows = [
    // New row: tm10 wins over DPD and SwP.
    { t: '2026-10-02T00:30Z', buoy: { hs: 2, swp: 12.5, dpd: 9, apd: 5.1, tm10: 7 }, mb: { hs: 2, swp: 5, wvp: 7 }, mc: { hs: 2, swp: 5, wvp: 7.5 } },
    // Old row (no tm10): DPD vs model mean period.
    { t: '2026-10-01T22:30Z', buoy: { hs: 2, swp: 12.5, dpd: 9 }, mb: { hs: 2, swp: 5, wvp: 9 }, mc: { hs: 2, swp: 5, wvp: 9.5 } }
  ];
  assert.deepEqual(stats(app, rows, 'period', 'mb'), { n: 2, bias: 0, mae: 0 });
  assert.deepEqual(stats(app, rows, 'period', 'mc'), { n: 2, bias: 0.5, mae: 0.5 });
});

test('direction: MWD vs model wave direction on new rows, ≥ 8 s swell only on old rows', () => {
  const app = loadApp();
  const rows = [
    // New row: buoy MWD vs model wvd; the swell fields are ignored.
    { t: '2026-10-02T00:30Z', buoy: { mwd: 130, swd: 150 }, mb: { swp: 5, swd: 90, wvd: 132 }, mc: { swp: 5, swd: 90, wvd: 128 } },
    // Old row, model swell partition is wind sea (5 s): not comparable, skipped.
    { t: '2026-10-01T22:30Z', buoy: { mwd: 120, swd: 140 }, mb: { swp: 5, swd: 60 }, mc: { swp: 5, swd: 60 } },
    // Old row, model swell ≥ 8 s: buoy ≥ 8 s direction vs model swell direction.
    { t: '2026-10-01T20:30Z', buoy: { mwd: 120, swd: 140 }, mb: { swp: 9, swd: 144 }, mc: { swp: 8, swd: 136 } }
  ];
  assert.deepEqual(stats(app, rows, 'dir', 'mb'), { n: 2, bias: 3, mae: 3 });
  assert.deepEqual(stats(app, rows, 'dir', 'mc'), { n: 2, bias: -3, mae: 3 });
  // The plotted buoy line follows the same definition row by row.
  app.set('_w5Rows', rows);
  assert.deepEqual(app.clone('_w5Rows.map(VERIF_GET.dir.obs)'), [130, 140, 140]);
  assert.deepEqual(app.clone('_w5Rows.map(VERIF_GET.dir.mb)'), [132, null, 144]);
});

test('over the logged rows the period miss is ~1 s, not the -5.8 s partition artefact', () => {
  const app = loadApp();
  const rows = readFixtureJSON('pipeline/verification.json').rows;
  assert.ok(rows.length > 600 && rows.every(r => r.buoy.tm10 === undefined && r.mb.wvd === undefined), 'fixture holds old-format rows');
  const p = stats(app, rows, 'period', 'mb');
  assert.equal(p.n, rows.length);
  assert.ok(Math.abs(p.bias) < 1.5 && p.mae < 2, `period bias ${p.bias} mae ${p.mae}`);
  const d = stats(app, rows, 'dir', 'mb');
  assert.equal(d.n, rows.filter(r => r.mb.swp >= 8).length, 'direction only where the model swell is ≥ 8 s');
  assert.ok(d.mae < 15, `direction mae ${d.mae}`);
  const h = stats(app, rows, 'height', 'mb');
  assert.ok(Math.abs(h.bias - 0.25) < 0.01, 'height (total Hs both sides) is unchanged');
});

test('the footer describes the pairs it actually compares', () => {
  const app = loadApp();
  app.set('_verifDoc', readFixtureJSON('pipeline/verification.json'));
  app.call('_verifRender');
  const footer = app.dom.byId('footer-verification').textContent;
  assert.match(footer, /Tm-1,0/);
  assert.match(footer, /mean wave period/);
  assert.match(footer, /≥ 8 s/);
  assert.doesNotMatch(footer, /compare swell partitions/);
});

// Rows every 2 h across the 2026-11-01 fall-back, drawn on a 360x120 canvas.
function dayTicks(tz) {
  const app = loadApp({ tz });
  app.set('ensureCanvasCssDims', () => ({ cssW: 360, cssH: 120 }));
  const rows = [];
  for (let t = Date.parse('2026-10-29T03:00Z'); t <= Date.parse('2026-11-04T03:00Z'); t += 2 * 3600e3) {
    rows.push({ t: new Date(t).toISOString().slice(0, 16) + 'Z', buoy: { hs: 2 }, mb: { hs: 2.2 }, mc: { hs: 1.9 } });
  }
  app.set('_w5Rows', rows);
  app.run("drawVerifChart('verif-canvas-height', _w5Rows, VERIF_GET.height)");
  const calls = app.clone(app.dom.byId('verif-canvas-height').getContext('2d').__calls.map(c => ({ fn: c.fn, args: c.args.filter(a => typeof a !== 'object') })));
  const t0 = Date.parse(rows[0].t), tRange = Date.parse(rows.at(-1).t) - t0;
  const padL = 8, padT = 8, plotW = 360 - 8 - 44, plotH = 120 - 8 - 20;
  const tAt = x => Math.round((t0 + ((x - padL) / plotW) * tRange) / 60000) * 60000;
  const labels = calls.filter(c => c.fn === 'fillText' && /^\d+\/\d+$/.test(c.args[0]))
    .map(c => ({ text: c.args[0], t: new Date(tAt(c.args[1])) }));
  const lines = [];
  calls.forEach((c, i) => {
    const n = calls[i + 1];
    if (c.fn === 'moveTo' && c.args[1] === padT && n && n.fn === 'lineTo' && n.args[0] === c.args[0] && n.args[1] === padT + plotH) {
      lines.push(new Date(tAt(c.args[0])));
    }
  });
  return { labels, lines };
}

for (const tz of ['America/New_York', 'America/Los_Angeles', 'UTC']) {
  test(`verification day ticks sit on local midnight and name that day (${tz})`, () => {
    try {
      const { labels, lines } = dayTicks(tz);
      assert.equal(lines.length, 6, 'one tick per local day in the span');
      assert.equal(labels.length, 6);
      for (const t of lines) assert.deepEqual([t.getHours(), t.getMinutes()], [0, 0], `tick at ${t.toString()}`);
      for (const { text, t } of labels) {
        assert.deepEqual([t.getHours(), t.getMinutes()], [0, 0], `label ${text} at ${t.toString()}`);
        assert.equal(text, `${t.getMonth() + 1}/${t.getDate()}`);
      }
    } finally {
      process.env.TZ = 'America/New_York';
    }
  });
}
