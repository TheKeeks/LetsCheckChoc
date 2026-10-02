// Audit C16 + C44: which logged sessions the models train on.
//
// C44: isLogEntryIncomplete read swell.size, a field nothing writes (swell
// objects store .height), so zeroed swell or a missing direction was never
// flagged. C16: trainModel / leaveOneOutRMSE / _runLOOForSanity pushed
// targetFn(e) unchecked, so one null, "7" or NaN rating flipped or blanked
// a model while the Regression tab (which filtered) kept reporting healthy
// metrics, and the "N entries are incomplete and excluded from your model"
// banner was not true. Now one predicate and one row filter (_modelRows)
// serve all of them.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/load-app');

// ── C44 ────────────────────────────────────────────────
const RATED = { size: 5, windQuality: 5, rideQuality: 5 };
const entryWith = swell => ({ ratings: RATED, conditions: { swell } });

test('isLogEntryIncomplete reads swell.height (legacy swell.size still works)', () => {
  const app = loadApp();
  const inc = e => app.call('isLogEntryIncomplete', e);
  assert.equal(inc(entryWith({ height: 0, period: 0, direction: 0 })), true, 'zeroed swell');
  assert.equal(inc(entryWith({ height: 3, period: 8, direction: null })), true, 'height but no direction');
  assert.equal(inc(entryWith({ height: 3, period: 8, direction: 0 })), true, 'direction 0 from an old || 0 fallback');
  assert.equal(inc(entryWith({ size: 3, period: 8, direction: null })), true, 'legacy size field');
  assert.equal(inc(entryWith({ height: 3, period: 8, direction: 140 })), false, 'healthy');
  assert.equal(inc({ ratings: { size: null, windQuality: 5, rideQuality: 5 }, conditions: { swell: { height: 3, period: 8, direction: 140 } } }), true);
  // tide is NOT part of completeness: a session that only lacks tide still
  // trains Wave and Conditions (the Ride extractor skips it on its own).
  assert.equal(inc({ ratings: RATED, conditions: { swell: { height: 3, period: 8, direction: 140 }, tide: null } }), false);
  // one predicate: the banner's field list agrees with the boolean
  assert.deepEqual(app.clone(app.call('getIncompleteFields', entryWith({ height: 3, period: 8, direction: null }))), ['swell']);
});

// ── C16 ────────────────────────────────────────────────
// 28 deterministic synthetic sessions with signal in all three models.
function sessions() {
  const out = [];
  for (let i = 0; i < 28; i++) {
    const r = k => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const h = 1 + r(1) * 6, dir = 100 + r(2) * 90, per = 5 + r(3) * 9;
    const tideH = 0.5 + r(4) * 3, rate = -0.8 + r(5) * 1.6;
    const wsp = Math.round(r(6) * 18), wdir = Math.round(r(7) * 359);
    const inWin = dir >= 115 && dir <= 158 ? 1 : 0.3;
    const clamp = v => Math.max(0, Math.min(10, Math.round(v)));
    out.push({
      id: 's' + i, userId: 'me', timestamp: new Date(Date.UTC(2026, 6, 1 + i, 12)).toISOString(),
      ratings: {
        size: clamp(h * inWin * 1.3 + r(8) * 2),
        rideQuality: clamp(per * 0.5 + rate * 2 - tideH + r(9) * 2),
        windQuality: clamp(9 - wsp * 0.3 + Math.cos((wdir - 335) * Math.PI / 180) * 2)
      },
      conditions: {
        swell: { height: Math.round(h * 10) / 10, direction: Math.round(dir), period: Math.round(per * 10) / 10 },
        wind: { speed: wsp, direction: wdir },
        tide: { height: Math.round(tideH * 10) / 10, rate: Math.round(rate * 100) / 100,
                stage: rate > 0.1 ? 'rising' : rate < -0.1 ? 'falling' : 'slack-low', timeToNearest: 1.5 }
      }
    });
  }
  return out;
}

function retrain(app, entries) {
  app.get('STATE').surfLog = app.run(JSON.stringify(entries));
  app.call('slRetrain');
  return app.clone(`({
    wave: STATE.surfLogWaveWeights, ride: STATE.surfLogRideWeights, cond: STATE.surfLogCondWeights,
    waveLoo: STATE.surfLogWaveValidation, rideLoo: STATE.surfLogRideValidation, condLoo: STATE.surfLogCondValidation
  })`);
}

const MUTATIONS = {
  'ratings.size = null': e => { e.ratings.size = null; },
  'ratings.size missing': e => { delete e.ratings.size; },
  'ratings.size = "7" (string)': e => { e.ratings.size = '7'; },
  'ratings.rideQuality = 99': e => { e.ratings.rideQuality = 99; },
  'ratings.windQuality = -1': e => { e.ratings.windQuality = -1; },
  'swell.direction = null': e => { e.conditions.swell.direction = null; },
  'swell zeroed (height 0, period 0)': e => { e.conditions.swell.height = 0; e.conditions.swell.period = 0; }
};

for (const [label, mutate] of Object.entries(MUTATIONS)) {
  test(`one bad row (${label}) is excluded everywhere: models equal training without it, tab metrics match`, () => {
    const app = loadApp();
    app.run("window._fbUserId = 'me';");
    const base = sessions();
    const without = retrain(app, base.filter((_, i) => i !== 10));
    assert.ok(without.wave && without.ride && without.cond, 'all three models train on the clean 27');
    const bad = sessions();
    mutate(bad[10]);
    const got = retrain(app, bad);
    assert.deepEqual(got, without);
    // The Regression tab's LOO numbers are the live model's numbers.
    for (const sub of ['wave', 'ride', 'cond']) {
      const tab = app.clone(`_regComputeLOOData('${sub}').rmse`);
      assert.equal(tab, got[sub + 'Loo'], `${sub}: tab RMSE vs trainer RMSE`);
      assert.equal(app.run(`_regUserScopedFeatureSeries('${sub}').length`), 27, `${sub}: preferred-conditions series`);
    }
    // ...and the flagged row is the one the banner calls excluded.
    assert.equal(app.run('STATE.surfLog.filter(isLogEntryIncomplete).length'), 1);
  });
}

test('_modelRows keeps only complete rows with finite features and a 0-10 target', () => {
  const app = loadApp();
  const rows = sessions().slice(0, 4);
  rows[1].ratings.size = '7';
  rows[2].conditions.wind.speed = 'calm';
  const mr = app.call('_modelRows', app.run(JSON.stringify(rows)), app.get('extractCondFeatures'), app.run('e => e.ratings.windQuality'));
  assert.deepEqual(app.clone(mr.kept.map(e => e.id)), ['s0', 's3']);
  assert.equal(mr.X.length, 2);
  assert.equal(mr.y.length, 2);
});
