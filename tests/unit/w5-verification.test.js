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

// Review ux#4: the getters switch definition row by row (DPD → Tm-1,0 for
// period, ≥ 8 s swell → MWD for direction), but the table averaged both
// kinds of row into one number, so the period "typical miss" drifted from
// −0.7 s towards +0.5 s as new rows arrived, with no change in the model.
// Each statistic must rest on one definition: the new rows once a day of
// them (24) is logged, the older rows alone (and said so) before that.
const OLD_ROWS = readFixtureJSON('pipeline/verification.json').rows;

// n hourly new-format rows after the fixture's last row. The model's mean
// period is 0.7 s above the buoy's Tm-1,0 (and 1.3 s below its DPD); its
// mean direction is 4° right of the buoy's MWD.
function newRows(n) {
  const t0 = Date.parse(OLD_ROWS.at(-1).t);
  return Array.from({ length: n }, (_, i) => ({
    t: new Date(t0 + (i + 1) * 3600e3).toISOString().slice(0, 16) + 'Z',
    buoy: { hs: 2, dpd: 9, tm10: 7, mwd: 130, swd: 140 },
    mb: { hs: 2.2, wvp: 7.7, wvd: 134, swp: 9, swd: 160 },
    mc: { hs: 1.9, wvp: 7.5, wvd: 128, swp: 9, swd: 160 }
  }));
}

// Renders the panel for `rows` → { Height: [mbMiss, mbSize, mcMiss, mcSize, n], ... }.
function renderTable(rows) {
  const app = loadApp();
  app.set('_verifDoc', { rows });
  app.call('_verifRender');
  const html = app.dom.byId('verif-stats').innerHTML;
  const out = {};
  for (const tr of html.split('<tr>').slice(1)) {
    const cells = [...tr.matchAll(/<td>([^<]*)<\/td>/g)].map(m => m[1]);
    if (cells.length === 6) out[cells[0]] = cells.slice(1);
  }
  return { app, table: out, footer: app.dom.byId('footer-verification').textContent };
}

test('verification table: old rows only → period and direction say which definition they score', () => {
  const app = loadApp();
  const oldOnly = renderTable(OLD_ROWS).table;
  assert.deepEqual(Object.keys(oldOnly), ['Height', 'Period (buoy peak)', 'Direction (swell ≥ 8 s)']);
  // A handful of new rows doesn't sneak into the old-definition numbers.
  const mixed = renderTable(OLD_ROWS.concat(newRows(10))).table;
  assert.deepEqual(Object.keys(mixed), ['Height', 'Period (buoy peak)', 'Direction (swell ≥ 8 s)']);
  assert.deepEqual(mixed['Period (buoy peak)'], oldOnly['Period (buoy peak)'], 'period scored on the old rows alone');
  assert.equal(mixed['Period (buoy peak)'][4], String(OLD_ROWS.length));
  assert.deepEqual(mixed['Direction (swell ≥ 8 s)'], oldOnly['Direction (swell ≥ 8 s)']);
  assert.equal(mixed.Height[4], String(OLD_ROWS.length + 10), 'height has one definition and uses every row');
  const p = stats(app, OLD_ROWS, 'period', 'mb');
  assert.equal(mixed['Period (buoy peak)'][0], `${p.bias >= 0 ? '+' : ''}${p.bias.toFixed(1)} s`);
});

test('verification table: a day of new rows → period and direction score them alone', () => {
  const { table, footer } = renderTable(OLD_ROWS.concat(newRows(24)));
  assert.deepEqual(Object.keys(table), ['Height', 'Period', 'Direction']);
  // Like for like: the model runs +0.7 s / +4° at the buoy and
  // +0.5 s / −2° at the Choc point, over the 24 new rows only.
  assert.deepEqual(table.Period, ['+0.7 s', '0.7 s', '+0.5 s', '0.5 s', '24']);
  assert.deepEqual(table.Direction, ['+4°', '4°', '-2°', '2°', '24']);
  assert.equal(table.Height[4], String(OLD_ROWS.length + 24));
  assert.match(footer, /never averages the two kinds of row/);
  // A fresh log with only new rows needs no warm-up.
  const fresh = renderTable(newRows(5)).table;
  assert.deepEqual(Object.keys(fresh), ['Height', 'Period', 'Direction']);
  assert.equal(fresh.Period[4], '5');
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
