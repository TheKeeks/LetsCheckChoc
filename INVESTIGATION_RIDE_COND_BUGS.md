# Investigation: Ride `tide_rate` fallback and Conditions wind near-zero weights

Read-only audit on branch `claude/investigate-tide-wind-features-09ZEu`. No
code modified. Scope: trace the data path from the historical-conditions
lookup → `STATE.surfLog[*].conditions` → the per-feature extractors used by
the Ride and Conditions models.

> **Caveat on direct session sampling.** The user-level surf-log entries live
> in Firestore (`firestore.indexes.json`, `firebase-config.js`, persistence
> at `app.js:3748` `loadSurfLog` / `app.js:3868` `saveLogEntryToFirebase`)
> — they are NOT serialised anywhere in the working tree. `data/buoy.json`
> is the live-buoy pipeline cache; the only logged-session arrays in the
> repo are the 28 synthetic rows in `scripts/smoke_regression.js`. So the
> "read 3 user surf log entries" step cannot be satisfied from the
> working tree alone; the analysis below is therefore done at the code-path
> level. The two diagnostic hooks that DO let you sample real entries at
> runtime are:
>
> - `window._llcGeneratePostBackfillReport()` (`app.js:4277`) — walks
>   `STATE.surfLog` and emits the post-backfill table.
> - Console: `STATE.surfLog.slice(0,3).map(e => e.conditions)` — direct
>   sample of three entries' condition blocks.
>
> The investigation calls those out wherever a real-data check is needed.

---

## TL;DR

| Question | Answer |
|---|---|
| 1. Tide-rate field name match (write vs read)? | **Match.** Both use `cond.tide.rate`. |
| 2. So why does Ride see fallback values? | **Backfill never ran on those sessions** (or ran but the result was `null` for that date). The fallback warning at `app.js:5501` fires only when `t.rate` is missing/NaN, which can only happen on a session whose `cond.tide` block predates the `parseTideAtTime` rewrite that added `rate`. |
| 3. Wind extractor reads what? | `cond.wind.speed` and `cond.wind.direction` (`app.js:5512-5516`). Shape matches what the historical lookup writes (`app.js:4721`, `app.js:4388`). |
| 4. Why "all weights near zero" on the Conditions model? | **Two compounding effects, both visible in the code.** (a) When the wind fetch fails, `wSpd` and `wDir` are stored as `0` (`app.js:4716-4717`, `app.js:4379`) — those zeros are *finite numbers*, so the median-fill in `extractCondFeatures` does NOT fire and the regression sees a literal `(0, 0.906)` point. (b) `_trainOnArrays` standardises by per-feature std (`app.js:5559`); when std is below `1e-10` the column is zeroed out entirely. Sessions with low wind-feature variance (selection bias toward clean offshore days **plus** the failed-fetch zeros described in (a)) collapse the standardised column and drive weights to ≈0. |

---

## INVESTIGATION 1 — TIDE RATE

### 1. Three user surf-log entries

Not retrievable from the working tree (see caveat above). The surf log is
Firestore-backed. To sample three entries at runtime, open the app, sign
in, then in DevTools:

```js
STATE.surfLog.slice(0, 3).forEach(e =>
  console.log(new Date(e.timestamp).toISOString(), e.conditions?.tide));
```

The check for the bug under investigation is simply whether
`e.conditions.tide.rate` exists as a finite number. Anything else
(missing, `null`, `undefined`, `NaN`) means the entry will hit the
extractor's fallback branch.

### 2. `extractRideFeatures` — exact line that reads `tide_rate`

From `app.js:5487-5506`:

```js
function extractRideFeatures(cond) {
  if (!cond?.swell) return null;
  const t = cond.tide;
  if (!t || typeof t.height !== 'number' || !isFinite(t.height)) {
    // Backfill should have populated tide.height on every session; bail on
    // training rows that somehow lack it rather than imputing.
    return null;
  }
  let rate = t.rate;                                       // ← READS cond.tide.rate
  if (typeof rate !== 'number' || !isFinite(rate)) {
    // Last-resort fallback for sessions missed by the tide backfill.
    if (t.stage === 'rising') rate = 0.5;
    else if (t.stage === 'falling') rate = -0.5;
    else rate = 0;   // 'slack-high' / 'slack-low' / unknown
    console.warn('[extractRideFeatures] missing cond.tide.rate, inferring from stage',
      { stage: t.stage, inferredRate: rate, height: t.height });
  }
  const { effPeriod } = _effectiveInWindowSwell(cond);
  return [t.height, rate, effPeriod];
}
```

**Field path read:** `cond.tide.rate` (via `t = cond.tide; let rate = t.rate;`).
No alternate spellings (`tideRate`, `dRate`, `tide.dRate`) appear anywhere
in `app.js` — confirmed with `grep -n "tide.rate\|tideRate\|tide\.dRate"`.

### 3. Tide-lookup code that WRITES `tide_rate`

The signed central-difference is computed in `tideRateAt`
(`app.js:4514-4521`) and combined into a tide object by `parseTideAtTime`
(`app.js:4573-4583`):

```js
function tideRateAt(predictions, sessionDateTime) {
  const tPlus  = new Date(sessionDateTime.getTime() + 30 * 60 * 1000);
  const tMinus = new Date(sessionDateTime.getTime() - 30 * 60 * 1000);
  const hPlus  = tideHeightAt(predictions, tPlus);
  const hMinus = tideHeightAt(predictions, tMinus);
  if (hPlus == null || hMinus == null) return 0;
  return hPlus - hMinus;
}
// ...
function parseTideAtTime(tideData, dateStr) {
  const preds = _normalizeTidePredictions(tideData);
  if (!preds.length) return { height: 0, rate: 0, stage: 'rising', timeToNearest: 0 };
  const sessionTime = new Date(dateStr);
  const heightRaw = tideHeightAt(preds, sessionTime);
  const height = heightRaw == null ? 0 : heightRaw;
  const rate = tideRateAt(preds, sessionTime);
  const stage = _tideStageFromRate(rate, height, preds);
  const timeToNearest = _timeToNearestExtremum(preds, sessionTime);
  return { height, rate, stage, timeToNearest };          // ← `rate` field at top level
}
```

`parseTideAtTime` is consumed by exactly two persistence paths, both of
which spread the same four-field object into `cond.tide`:

- Open-Meteo archive path (`app.js:4719-4727`):
  ```js
  const conditions = {
    swell: archiveResult.swell,
    wind: { speed: Math.round(wSpd), direction: Math.round(wDir) },
    tide: {
      height: Math.round(tideInfo.height * 10) / 10,
      rate: Math.round(tideInfo.rate * 100) / 100,         // ← WRITES cond.tide.rate
      stage: tideInfo.stage,
      timeToNearest: tideInfo.timeToNearest
    },
    source: 'openmeteo-archive'
  };
  ```
- NDBC fallback path (`app.js:4381-4395`):
  ```js
  const conditions = {
    swell: { ... },
    wind: { speed: Math.round(wSpd), direction: Math.round(wDir) },
    tide: {
      height: Math.round(tideInfo.height * 10) / 10,
      rate: Math.round(tideInfo.rate * 100) / 100,         // ← WRITES cond.tide.rate
      stage: tideInfo.stage,
      timeToNearest: tideInfo.timeToNearest
    }
  };
  ```

**Field path written:** `cond.tide.rate`.

### 4. Compare write (3) vs read (2)

Both sides use the identical path `cond.tide.rate`. **No name mismatch.**

That rules out the most obvious failure mode hypothesised in the prompt
(`cond.tideRate` vs `cond.tide.rate` etc.). The fallback in
`extractRideFeatures` therefore only fires when:

- the entry's `cond.tide` block was written by a code path **older** than
  commit `640ba06` ("Tide lookup: compute and store cond.tide.rate
  (central difference)"), OR
- the entry's `cond.tide` block was overwritten by something that didn't
  go through `parseTideAtTime` (no such path exists in the current tree
  — confirmed by grepping every assignment to `.tide =` in `app.js`).

### 5. Did the backfill operation actually invoke the new tide computation?

Yes, conditionally. The backfill at `app.js:5111-5202` calls
`lookupHistoricalConditions` per session (`app.js:5150`):

```js
const result = await lookupHistoricalConditions(lat, lon, ts);
if (!result || !result.swell || result.swell.height == null) {
  failed++;
  failures.push({ id: entry.id, ts, reason: 'no swell data returned' });
} else {
  const oldCond = entry.conditions || {};
  const newCond = Object.assign({}, oldCond, {
    swell: result.swell,
    source: result.source
  });
  // ...
  // Wind: preserve existing (source unchanged in this migration).
  // Tide: ALWAYS overwrite with the freshly-computed block — we are
  // migrating from hilo-nearest-extremum to hourly-interpolated
  // height plus a new signed ft/hr `rate` field, so any tide values
  // already on the entry are stale by definition.
  if (oldCond.wind) newCond.wind = oldCond.wind;
  else if (result.wind) newCond.wind = result.wind;
  if (result.tide) newCond.tide = result.tide;             // ← tide overwrite
  else if (oldCond.tide) newCond.tide = oldCond.tide;      // ← keeps stale tide if result.tide missing
  entry.conditions = newCond;
```

`result.tide` is the four-field block from `parseTideAtTime` (with
`rate`). So **every successful backfill row gets the new tide block,
including `rate`**.

Two ways a session can end up *without* `tide.rate`:

1. **The backfill button was never clicked for that session.** The
   button (`sl-backfill-archive-btn`, `app.js:4945`) is user-triggered.
   Sessions logged before the migration commit, on an account where the
   user hasn't clicked the button, will retain their pre-migration tide
   block (which had only `{height, stage, timeToNearest}`, per
   `INVESTIGATION_TIDE_LOOKUP.md:16` and `:165-189`).
2. **The backfill ran but returned `result = null` for that date** (no
   archive swell, no NDBC fallback). The `failed` counter increments
   (`app.js:5152`) and `entry.conditions` is NOT updated. Any stale
   pre-migration `cond.tide` is left in place — also no `rate`.

Either way, on the next `slRetrain`, those sessions' `extractRideFeatures`
calls fall through to the stage-based fallback at `app.js:5497-5503`
and emit the `[extractRideFeatures] missing cond.tide.rate` warning.

**Diagnostic to confirm at runtime** — run in DevTools after sign-in:

```js
const withRate = STATE.surfLog.filter(e => typeof e.conditions?.tide?.rate === 'number').length;
const without  = STATE.surfLog.filter(e => e.conditions && typeof e.conditions?.tide?.rate !== 'number').length;
console.log({ withRate, without, total: STATE.surfLog.length });
```

If `without > 0`, those are the sessions firing the fallback. Clicking
"Re-fetch all session conditions from Open-Meteo archive" on Tab 3
should drive `without` to 0 (modulo dates the archive can't serve and
NDBC fallback also fails — those will still show in the
backfill summary's `failed` count).

### Tide bug summary

- No field-name mismatch.
- Code path for new sessions (logged after the migration) is clean —
  they get `rate` written directly.
- Sessions logged **before** the migration commit (`640ba06`) and never
  re-fetched via the Tab-3 backfill button keep the legacy three-field
  tide block (no `rate`). Those are the rows that surface as
  `[extractRideFeatures] missing cond.tide.rate` warnings and feed the
  stage-derived ±0.5 fallback into the Ride regression.
- Confirm-and-fix is operational, not architectural: click the backfill
  button; verify `without === 0` with the snippet above; retrain.

---

## INVESTIGATION 2 — WIND FEATURES

### 1. cond.wind shape on logged sessions

Same Firestore caveat. Sample three entries at runtime:

```js
STATE.surfLog.slice(0, 3).forEach(e =>
  console.log(new Date(e.timestamp).toISOString(), e.conditions?.wind));
```

What the wind block can look like, derived from the code:

| Source on disk | Shape | Where it's written |
|---|---|---|
| Open-Meteo archive (current) | `{ speed: <int mph>, direction: <int deg> }` | `app.js:4721` |
| NDBC fallback | `{ speed: <int mph>, direction: <int deg> }` | `app.js:4388` |
| Wind-fetch failure on either path | `{ speed: 0, direction: 0 }` | `app.js:4713-4717` (the `?? 0` lines) |
| Pre-migration (legacy) | same `{speed, direction}` shape | `app.js:4314` confirms legacy fields. |

Crucially: the failure shape is **a literal numeric (0, 0)**, not
`null`/`undefined`. That distinction matters for the extractor.

### 2. `extractCondFeatures` — exact extraction code

`app.js:5508-5518`:

```js
function extractCondFeatures(cond) {
  const w = cond?.wind || {};
  // Median-fill missing windSpd so the one session in the dataset with both
  // wind fields blank still trains; cross-shore (0) for missing windDir.
  const haveSpd = w.speed != null && isFinite(w.speed);
  const haveDir = w.direction != null && isFinite(w.direction);
  return [
    haveSpd ? w.speed : _COND_WIND_MEDIAN,
    haveDir ? windOffshoreness(w.direction) : 0
  ];
}
```

with the offshoreness helper at `app.js:5436-5442`:

```js
const REEF_OFFSHORE_BEARING = 335;
function windOffshoreness(windDir) {
  if (windDir == null || isNaN(windDir)) return 0;
  const raw = Math.abs(windDir - REEF_OFFSHORE_BEARING);
  const diff = Math.min(raw, 360 - raw);
  return Math.cos(diff * Math.PI / 180);
}
```

### 3. Manual feature computation — three illustrative cases

Without real Firestore data, we can still trace the three failure
buckets the user is likely to see:

| Stored `cond.wind` | `haveSpd` | `haveDir` | `wind_speed` feature | `wind_offshore` feature |
|---|---|---|---|---|
| `{ speed: 7,  direction: 247 }` | true | true | `7` | `cos(|247-335|=88°) = +0.035` |
| `{ speed: 12, direction: 180 }` | true | true | `12` | `cos(|180-335|=155°, wrap→155) = -0.906` |
| `{ speed: 0,  direction: 0 }` *(failed-fetch shape)* | **true** (0 is finite) | **true** (0 is finite) | `0` | `cos(|0-335|=335°, wrap→25°) = +0.906` |

The third row is the bug-suspect case the prompt is gesturing at.
Because `w.speed === 0` and `w.direction === 0` are both *finite numbers*,
the `haveSpd`/`haveDir` checks pass and the fallbacks
(`_COND_WIND_MEDIAN`, `0`) are **never reached**. The model receives a
literal `(0, 0.906)` point — wind_speed pinned to zero, wind_offshore
pinned to +0.906 (cos 25° because 0° is 25° off the 335° offshore
bearing).

If the per-feature scatters in Tab 2 show clusters at
"wind_speed ≈ 0" and "wind_offshore ≈ 1", the most likely explanation
is: a non-trivial fraction of sessions hit the failed-wind-fetch
sentinel and were saved with `{speed: 0, direction: 0}`.

Two adjacent contributors:

- Even on successful fetches, surf-log selection bias pulls sessions
  toward **low wind speed** (good conditions get logged more than blown-
  out conditions). That alone tightens the wind_speed distribution
  toward zero and the wind_offshore distribution toward +1.
- Sessions that pre-date the migration to the archive endpoint may have
  been saved with the forecast endpoint's value, but the wind shape
  itself is identical (`{speed, direction}`), so the bug is not a
  field-name issue — only a *value-collapse* issue.

### 4. Normalisation between extraction and the regression input matrix

`_trainOnArrays` at `app.js:5548-5566` is the normalisation layer:

```js
function _trainOnArrays(X, y) {
  if (!X.length) return null;
  const nF = X[0].length;
  const stats = { mean: [], std: [] };
  for (let j = 0; j < nF; j++) {
    const col = X.map(r => r[j]);
    const mean = col.reduce((a,b) => a+b, 0) / col.length;
    const variance = col.reduce((a,b) => a + (b-mean)*(b-mean), 0) / col.length;
    stats.mean[j] = mean;
    stats.std[j] = Math.sqrt(variance);
  }
  const Xn = X.map(row => row.map((v,j) =>
    stats.std[j] > 1e-10 ? (v - stats.mean[j]) / stats.std[j] : 0));    // ← variance-collapse guard
  const yMean = y.reduce((a,b) => a+b, 0) / y.length;
  const yCentered = y.map(v => v - yMean);
  const weights = normalEquation(Xn, yCentered);
  if (!weights) return null;
  stats.targetMean = yMean;
  return { weights, stats };
}
```

The guard at the inner `map` zeros out any feature whose std falls below
`1e-10`. With ~28 sessions, if 20+ of them share the failed-fetch
`(0, 0.906)` point (and the remainder are clean offshore days clustering
near the same numbers), the column std for both features can become
small but **not** below `1e-10` — so the column is *not* zeroed,
it's just standardised to a near-degenerate distribution. The normal
equation then assigns these near-degenerate columns a coefficient that
is mathematically valid but effectively zero in *standardised space*,
because the standardised column is dominated by a single value with a
few outliers — and OLS in z-space can't tell that signal from noise.

Note also (`app.js:5536`):

```js
function normalEquation(X,y) {
  const Xt=matTranspose(X), XtX=matMul(Xt,X);
  for(let i=0;i<XtX.length;i++) XtX[i][i]+=0.001;                       // ← ridge
  ...
}
```

There is an L2-style ridge of `0.001` added to the X'X diagonal. With
a degenerate (low-variance) feature, this ridge dominates and the
estimated coefficient is pulled toward 0 — visibly so when the wind
columns have tiny effective variance.

### 5. Per-feature scatter rendering — sanity check

`_regBuildFeatureMini` at `app.js:6510-6638` plots **raw extractor
output** (`x: f[featureIdx]`, `app.js:6530`); no normalisation between
extractor and plot. So whatever values appear on the X-axis of the
Conditions tab's per-feature scatters are *exactly* what the extractor
returned. If the scatter shows two tight clusters at `wind_speed ≈ 0`
and `wind_offshore ≈ +1`, the extractor is producing those clusters
(not the renderer collapsing them).

### Wind bug summary

The chain of suspect behaviours, ranked by likelihood:

1. **Failed-fetch zeros aren't distinguished from real zeros.**
   `app.js:4716-4717` and `app.js:4379` convert a missing wind row into
   `{speed: 0, direction: 0}`. `extractCondFeatures` treats those as
   present-and-finite, so the median-fill safety net never engages.
   Each such session contributes a degenerate `(0, +0.906)` point.
2. **Selection bias compounds (1):** surfers log clean offshore
   sessions more than blown-out ones, so the *real* wind_offshore
   distribution is already biased toward +1 and wind_speed toward 0.
3. **Standardisation + ridge zero-out the standardised weights.**
   `_trainOnArrays` divides by std (`app.js:5559`); the ridge
   `XtX[i][i]+=0.001` (`app.js:5536`) pulls coefficients toward zero
   when standardised variance is low. The Conditions weights panel
   reports the standardised weights (Tab 2 Importance bars at
   `app.js:6658`), so a near-degenerate column shows up as
   "weights near zero".

The *naïve* fix is straightforward (sentinel-out failed fetches in the
storage layer, e.g. write `null`/`undefined` instead of `0` so
`extractCondFeatures` can median-fill). It is intentionally **not**
applied here — this file is an investigation, not a patch.

---

## Pointers for the eventual code fix

(For the follow-up prompt, not done in this branch.)

- `app.js:4713-4717` and `app.js:4377-4379` — change the failed-fetch
  sentinel from `0` to `null` (or omit the field) so the extractor's
  `null`-check engages.
- `app.js:5510-5517` — once sentinels are nullable, the `_COND_WIND_MEDIAN`
  fill at `app.js:5515` does what its comment claims.
- Tide-side cleanup is operational: clicking the backfill button on
  Tab 3 should clear the fallback warnings. If a follow-up wants to
  make the fallback impossible by construction, drop the `if/else`
  chain at `app.js:5495-5503` and `return null` (skipping the row)
  the way `tide.height` already does at `app.js:5490-5493`.
