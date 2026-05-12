# Investigation: LEAK_DEG sensitivity for Wave / Ride models

Read-only sensitivity analysis of the swell-window edge-softening decay
constant (`LEAK_DEG`) in `_alignmentScore` (`app.js:5507`). The current
value was chosen by intuition; this report asks whether the data prefers
a different value. **No production code was modified, no parameter was
auto-selected.**

Sweep script: `scripts/leak_deg_sensitivity.js` (run with `node`).

## TL;DR

| Question | Answer |
|---|---|
| Does the data prefer a different `LEAK_DEG`? | **Marginally, yes** — but the gap to the production value is small and the dataset is synthetic. |
| Wave best `LEAK_DEG` (LOO-RMSE) | **45°** (LOO-RMSE 1.5746 vs production 30° at 1.6098 — a 2.19% improvement). The curve is flat across 25°–45°. |
| Ride best `LEAK_DEG` (LOO-RMSE) | **15°** (LOO-RMSE 1.4314 vs production 30° at 1.5077 — a 5.06% improvement). |
| Recommendation | **Do not change production yet.** Findings are on the 28-session synthetic corpus from `scripts/smoke_regression.js`, not the active user's real log (Firestore is unreachable from a node script). Re-run in DevTools against `STATE.surfLog` before considering a value change. |

---

## 1. Method

For each `LEAK_DEG ∈ [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]`:

1. Re-evaluate `_alignmentScore` and `_effectiveInWindowSwell` with that
   leak width.
2. Re-extract Wave features `[effective_in_window_height,
   effective_in_window_period, total_swell_height]` for all 28 sessions
   (`extractWaveFeatures`, `app.js:5538`).
3. Re-extract Ride features `[tide_height, tide_rate,
   effective_in_window_period, effective_in_window_height]` for the same
   sessions (`extractRideFeatures`, `app.js:5549`).
4. Refit the model with the same z-score normalization, mean-centered
   target, ridge λ = 0.001, and matrix-form OLS as `_trainOnArrays`
   (`app.js:5609`).
5. Report:
   - **R²**: in-sample, 1 − SSE/SST on the full 28-session fit.
   - **LOO-RMSE**: leave-one-out RMSE, identical loop to
     `leaveOneOutRMSE` (`app.js:5641`).
   - **Top feature** + signed standardized weight.

`LEAK_DEG = 0` is treated as a hard window gate (no decay). The swell
window stays at `[115°, 158°]` (`CONFIG.chocomount`, `app.js:26-27`).

### Data caveat

The active user's surf log lives in Firestore and is not reachable from
a node script. The 28-session corpus used here is the synthetic dataset
embedded in `scripts/smoke_regression.js`, which was modeled after the
spot owner's session distribution per
`INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md` (2 SEC-IN, 14 PRI-IN,
12 BOTH-OUT). It exercises every directional regime that `LEAK_DEG`
controls but is **not** calibrated to real ratings. Treat the absolute
RMSE numbers as illustrative, not authoritative.

To re-run against the real log: open the app in a browser, open
DevTools, paste the body of `scripts/leak_deg_sensitivity.js` into the
console after replacing `SESSIONS` with `STATE.surfLog.filter(e =>
e.userId === window._fbUserId && e.conditions?.swell).map(e =>
({ ...e.conditions, ratings: e.ratings }))`.

---

## 2. Wave model results (target = `ratings.size`, n = 28)

| LEAK_DEG | R²       | LOO-RMSE | Top feature                  | Top feature weight |
|---------:|---------:|---------:|------------------------------|-------------------:|
|        0 |   0.5954 |   1.8992 | effective_in_window_height   |            +1.4800 |
|        5 |   0.6176 |   1.7486 | effective_in_window_height   |            +1.4677 |
|       10 |   0.6250 |   1.7151 | effective_in_window_height   |            +1.5871 |
|       15 |   0.6114 |   1.7239 | effective_in_window_height   |            +1.2034 |
|       20 |   0.5903 |   1.7544 | effective_in_window_height   |            +1.0539 |
|       25 |   0.5761 |   1.6303 | total_swell_height           |            +0.9574 |
|       30 |   0.5820 |   1.6098 | total_swell_height           |            +0.8731 |
|       35 |   0.5870 |   1.5911 | total_swell_height           |            +0.7991 |
|       40 |   0.5895 |   1.5787 | effective_in_window_height   |            +0.8054 |
|       45 |   0.5908 |   1.5746 | effective_in_window_height   |            +0.8322 |

**Best by LOO-RMSE: `LEAK_DEG = 45°`** (LOO-RMSE 1.5746, R² 0.5908).
Production `LEAK_DEG = 30°` is at LOO-RMSE 1.6098 — the gap is **2.19%**.

Observations:

- The LOO-RMSE curve is U-shaped but **shallow**: from 10° to 45° the
  spread is only 1.5746 → 1.7239, less than 10% of the rating-1-to-10
  range. Differences within this band are likely noise on n=28.
- At very small leaks (`0°`, `5°`) the top weight on
  `effective_in_window_height` shoots up (1.48, 1.47) because the
  in-window energy column becomes nearly all-or-nothing — the model
  leans harder on the surviving signal, in-sample R² is fine, but
  out-of-sample error worsens because PRI-IN sessions near the window
  edges get treated as fully in-window.
- At `25°`–`35°` the model swaps its top feature to `total_swell_height`
  (the ungated baseline) — a sign that with moderate decay the
  in-window and total columns become collinear enough that the ridge
  prior can't cleanly choose between them. At `≥ 40°` `total_swell_height`
  steps back down and `effective_in_window_height` reclaims the top
  slot.
- The widening of the decay band (`40°`, `45°`) flattens the in-window
  metric back toward "total swell, lightly weighted by direction",
  which on this corpus happens to fit `ratings.size` slightly better.

## 3. Ride model results (target = `ratings.rideQuality`, n = 28)

| LEAK_DEG | R²       | LOO-RMSE | Top feature                  | Top feature weight |
|---------:|---------:|---------:|------------------------------|-------------------:|
|        0 |   0.7501 |   1.6294 | effective_in_window_height   |            +1.6760 |
|        5 |   0.7631 |   1.5902 | effective_in_window_height   |            +1.5196 |
|       10 |   0.7793 |   1.5022 | effective_in_window_height   |            +1.4820 |
|       15 |   0.8005 |   1.4314 | effective_in_window_height   |            +1.5823 |
|       20 |   0.7878 |   1.4716 | effective_in_window_height   |            +1.5592 |
|       25 |   0.7652 |   1.5301 | tide_height                  |            -1.2279 |
|       30 |   0.7714 |   1.5077 | effective_in_window_height   |            +1.2390 |
|       35 |   0.7768 |   1.4862 | effective_in_window_height   |            +1.2514 |
|       40 |   0.7789 |   1.4752 | effective_in_window_height   |            +1.2541 |
|       45 |   0.7775 |   1.4749 | effective_in_window_height   |            +1.2414 |

**Best by LOO-RMSE: `LEAK_DEG = 15°`** (LOO-RMSE 1.4314, R² 0.8005).
Production `LEAK_DEG = 30°` is at LOO-RMSE 1.5077 — the gap is **5.06%**.

Observations:

- The minimum is **sharper** than for Wave: 15° clearly out-performs
  both narrower (0°, 5°, 10°) and wider (20°, 25°, 30°) decays. This
  matches the physical intuition that ride quality depends more on the
  swell actually peeling through the reef segments (a tighter
  directional gate) than on raw arriving energy.
- The 25° row is the only one where `tide_height` becomes the top
  feature — at that decay width the in-window-height signal weakens
  just enough for tide to outrank it. The sign is negative (lower tide
  = better ride), consistent with the known Chocomount preference for
  lower-tide rides per `CHOCOMOUNT_KNOWLEDGE.md`.
- At ≥ 35° the curve flattens again as more refracted/leaking swell
  gets folded into `effective_in_window_height`, weakening its
  discriminating power.

## 4. Cross-comparison

|              | Wave (size) | Ride (rideQuality) |
|--------------|------------:|-------------------:|
| Best LEAK_DEG | 45°        | 15°                |
| Best LOO-RMSE | 1.5746     | 1.4314             |
| Prod 30° LOO  | 1.6098     | 1.5077             |
| Δ vs prod     | −2.19%     | −5.06%             |

The two models prefer **opposite ends** of the candidate range — Wave
trends better with a wider decay (more total-swell character), Ride
trends better with a narrower decay (more strictly window-gated
in-window height). A single shared `LEAK_DEG` is therefore a
compromise; the production value `30°` sits roughly midway between the
two optima.

## 5. Findings

1. On the 28-session synthetic corpus, neither the Wave nor the Ride
   model dramatically prefers a different `LEAK_DEG`. The Ride
   improvement (5.06%) is the more interesting of the two but is still
   inside the noise band you would expect from LOO on n=28.
2. The Wave and Ride models pull in opposite directions, which means
   any change to a single shared constant trades one model's accuracy
   for the other's. If the constant were ever split, Wave would want
   wider and Ride would want narrower — but that is a production-code
   change and outside the scope of this read-only investigation.
3. **No change to `LEAK_DEG` is being recommended.** Before reopening
   this question, re-run the sweep against the real Firestore-backed
   `STATE.surfLog` in DevTools (instructions in §1). If the real-data
   picture matches the synthetic picture (Ride preferring a narrower
   leak), only then is it worth a follow-up that explicitly proposes a
   production change.

## 6. Reproducing

```
node scripts/leak_deg_sensitivity.js
```

The script is self-contained: synthetic data is inlined, math is a
straight port of `_trainOnArrays` and `leaveOneOutRMSE` from `app.js`,
and `_alignmentScore` is parameterized by `leakDeg` rather than reading
the hardcoded constant. No `app.js` mutation, no LEAK_DEG override at
runtime in the app.
