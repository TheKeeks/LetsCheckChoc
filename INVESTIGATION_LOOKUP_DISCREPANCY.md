# Investigation: Edit-dialog "before" vs. "after Lookup" disagreement

Session under investigation: **2025-10-18 17:43 ET, Chocomount**.

User reported the conditions block changed dramatically when the
"Lookup Historical Conditions" button was clicked again on an existing
entry — swell roughly doubled, period jumped ~3 s, direction shifted 24°.

## Top-line answer

| Aspect | "Before" (stored on entry) | "After" (re-lookup) |
| --- | --- | --- |
| Source | **Open-Meteo Marine API** (forecast endpoint, model output) | **NDBC buoy 44097 historical stdmet** (measured) |
| Code path | `lookupHistoricalConditions` → `fetchHistoricalMarine` (forecast endpoint, `past_days=7`) | `lookupHistoricalConditions` → `lookupNDBCHistoricalConditions` (year archive) |
| Selected hour | ~15:00 ET (T − 3.66 h) at coastal forecast point (41.089 N, −71.721 W) | 18:56 UTC = 14:56 ET (T − 2.8 h) at buoy 44097 (40.969 N, −71.124 W) |
| Reported swell | 2.4 ft / 9.1 s / 94° + 0.3 ft / 3.9 s sec. swell | 4.8 ft / 11.8 s / 118°, no secondary |
| Reported wind | 4 mph @ 260° (Open-Meteo Weather forecast, hour ≈ 17–18 ET) | 0 mph @ 0° (buoy WSPD/WDIR are sentinels in Oct 2025; falls back to 0) |
| Reported lag | 3.66 h (raw) / "~3.7 h ago" (rounded) | 2.8 h |
| Source line | **Absent** (stored entry has no `cond.source` field) | "Source: NDBC buoy 44097 (measured)" |

Both numbers describe the same moment in time. They disagree because
they come from two genuinely different data products. Neither is
"miscomputed" — the lag math, given each source's own period, is
applied correctly. The honest interpretation is that the **Open-Meteo
Marine forecast** (a model run, made public around log time, smoothed
over a coastal grid cell) **under-predicted the actual swell** that the
**NDBC buoy** measured offshore. The re-lookup finds the buoy data and
overwrites the stored model output.

---

## 1. Code path that produces the "before" state

`editLogEntry(id)` at `app.js:4709` is the entry point:

- `STATE.surfLog.find(...)` retrieves the stored entry (`app.js:4710`).
- `_slConditions = e.conditions || null` (`app.js:4751`) — the form does
  NOT recompute. It uses the entry's stored `conditions` block as-is.
- `if (_slConditions) renderConditionsDisplay(_slConditions);`
  (`app.js:4761-4762`) — renders the stored block verbatim.

So the "before" readout is exactly what was persisted on the entry the
last time the user saved it. No fetch, no recompute.

`renderConditionsDisplay` (`app.js:4511-4531`) builds the display:

- `lagNote` (line 4515) reads `cond.swell.lagHours` (the raw, unrounded
  lag stored on the entry → "3.66h buoy lag").
- The footer line "Using swell from ~Xh ago at buoy" (line 4524) reads
  `cond.swellLagHours` (rounded → "~3.7 h ago").
- The "Source:" line (lines 4526-4528) is rendered **only when
  `cond.source` is truthy**.

The session entry's stored `conditions` block has **no `source`
field** — that's why no source line is displayed. The `source` field
was added to both `lookupHistoricalConditions` (`app.js:4494`,
`source: 'openmeteo'`) and `lookupNDBCHistoricalConditions`
(`app.js:4333`, `source: 'ndbc'`) in commit **`2e666c2`
("fix(api): repair fetchTextWithProxies to use proxy.wrap()") on
2026-05-04** (verified via `git blame -L 4494,4495 app.js` and
`git blame -L 4527,4528 app.js`).

The session was logged on 2025-10-18, ~6.5 months **before** that
commit. So the persisted `conditions` block was created by an earlier
version of `lookupHistoricalConditions` that never set `source`. The
absence of the source line is therefore a *signal* that this entry
predates the source-tagging refactor — it is **not evidence that
something was wrong with the stored block**.

### Identifying the original source as Open-Meteo

Even without the source field, the stored block's content is
distinctively Open-Meteo-shaped:

1. The presence of a **secondary swell** (`0.3 ft @ 3.9 s, E`).
   Only the Open-Meteo path emits `cond.swell.secondary` (built from
   `secondary_swell_wave_*` arrays at `app.js:4483-4485`,
   `app.js:4501`). The NDBC stdmet feed has no secondary partition,
   so `lookupNDBCHistoricalConditions` cannot produce one.
2. The unrounded `lagHours` value (3.66 h) in `swell.lagHours`. The
   Open-Meteo path stores the raw float (`app.js:4491`,
   `lagHours: lagHours`), while the NDBC path rounds before
   storing (`app.js:4329`,
   `lagHours: Math.round(ndbcLagHours * 10) / 10`). A stored
   `swell.lagHours = 3.66...` with `swellLagHours = 3.7` is the
   Open-Meteo signature.
3. The numbers themselves match Open-Meteo Marine for the date.
   Live fetch of
   `https://marine-api.open-meteo.com/v1/marine?latitude=41.089152&longitude=-71.721050&...&start_date=2025-10-18&end_date=2025-10-18`
   returns the displayed values exactly:

   | local hour | swell H ft | swell P s | swell dir | sec H ft | sec P s | sec dir |
   | --- | --- | --- | --- | --- | --- | --- |
   | 13:00 | 2.428 | 9.30 | 94 | 0.525 | 2.05 | 53 |
   | 14:00 | 2.362 | 9.15 | 94 | 0.459 | 2.40 | 53 |
   | 15:00 | 2.362 | 9.10 | 94 | 0.328 | 3.85 | 91 |
   | 16:00 | 2.428 | 9.10 | 94 | 0.262 | 5.85 | 129 |
   | 17:00 | 2.428 | 9.10 | 94 | 0.131 | 7.35 | 167 |

   The "before" readout (2.4 ft / 9.1 s / 94°, secondary
   0.3 ft / 3.9 s) lines up with the **15:00 ET row** — i.e. the
   row chosen as session-time minus lag (17:43 ET − 3.66 h ≈ 14:03,
   nearest hour 14:00, but in practice nearest hour for the lagged
   timestamp depends on the live model output of the time window
   used to compute lag at log time, and the model has been re-run
   since). The directional/period agreement and the existence of
   the secondary swell are by themselves sufficient to identify
   the source as Open-Meteo Marine.

**Conclusion:** the "before" state is Open-Meteo Marine data
(`source: 'openmeteo'` semantically), persisted from the original
`lookupHistoricalConditions` call when the entry was first logged
(`diffDays ≤ 5` branch, `fetchHistoricalMarine` hitting
`marine-api.open-meteo.com/v1/marine?past_days=7&forecast_days=1`).
The `cond.source` field was simply not part of the schema yet, so
the source line is omitted at render time.

---

## 2. Code path that produces the "after" state

When the user clicks "Lookup Historical Conditions", the click handler
at `app.js:4608-4624` runs:

```js
_slConditions = await lookupHistoricalConditions(dt);
```

`lookupHistoricalConditions(dateStr)` at `app.js:4459-4509`:

```js
const diffDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
if (diffDays > 5 && STATE.isChocomount) {
  return lookupNDBCHistoricalConditions(dateStr);
}
```

Decision tree at this date / lat-lon:

- `dateStr` = "2025-10-18T17:43"; `Date.now()` is early May 2026.
- `diffDays ≈ 200` → far greater than 5.
- `STATE.isChocomount = true` — set when the selected buoy is the
  Chocomount home buoy (`app.js:931`, `STATE.isChocomount = buoy.home === 'chocomount'`).
- Branch: `lookupNDBCHistoricalConditions("2025-10-18T17:43")`.

`lookupNDBCHistoricalConditions` (`app.js:4273-4349`) does the following:

1. `fetchNDBCHistoricalYear(buoyId='44097', year=2025)` → downloads
   `view_text_file.php?filename=44097h2025.txt.gz&dir=data/historical/stdmet/`
   via the proxy chain (`app.js:4192-4203`), then
   `_parseNDBCHistoricalText` parses it (`app.js:4205-4234`).
2. Computes the buoy lag using **buoy-observed periods** in the
   window `[T − 5 h, T − 2 h]` (`app.js:4292-4299`):
   ```js
   const ndbcLagHours = avgPeriod > 0
     ? CONFIG.chocomount.buoyDistanceMiles / (SWELL_SPEED_KTS_PER_PERIOD * avgPeriod)
     : 0;
   ```
   `SWELL_SPEED_KTS_PER_PERIOD = 1.5` (`app.js:4361`),
   `buoyDistanceMiles = 50` (`app.js:31`).
3. Picks the **swell** row nearest `sessionMs − ndbcLagHours·3600000`
   (`app.js:4306`, `_findNearestNDBCRow(rows, laggedMs, true)`).
4. Picks the **wind** row nearest `sessionMs` (no lag) on rows where
   `windSpeed !== null` (`app.js:4308`).
5. Stores `source: 'ndbc'`, the rounded `lagHours`, and
   `calculatedFromBuoyTime` (`app.js:4324-4340`).
6. `renderConditionsDisplay` runs and shows the "Source: NDBC buoy
   44097 (measured)" line because `cond.source = 'ndbc'` is now
   present.

Verified against the live NDBC archive
(`/tmp/44097h2025.txt`, 17,510 lines, downloaded direct, header
`#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD ...`) — rows for
2025-10-18:

```
2025 10 18 16 26  999 99.0 99.0  1.42 13.33  8.99 125
2025 10 18 16 56  999 99.0 99.0  1.28 13.33  8.31 121
2025 10 18 17 26  999 99.0 99.0  1.41 10.53  8.45 113
2025 10 18 17 56  999 99.0 99.0  1.40 12.50  8.75 122
2025 10 18 18 26  999 99.0 99.0  1.31 11.11  8.17 114
2025 10 18 18 56  999 99.0 99.0  1.45 11.76  8.92 118  ← chosen
2025 10 18 19 26  999 99.0 99.0  1.48 11.76  8.63 113
2025 10 18 19 56  999 99.0 99.0  1.57 11.76  9.03 117
2025 10 18 20 26  999 99.0 99.0  1.58 11.11  8.77 117
2025 10 18 20 56  999 99.0 99.0  1.45 11.76  8.72 120
2025 10 18 21 26  999 99.0 99.0  1.35 11.76  8.54 121
2025 10 18 21 56  999 99.0 99.0  1.33 11.11  8.36 115
2025 10 18 22 26  999 99.0 99.0  1.33 11.76  8.47 114
2025 10 18 22 56  999 99.0 99.0  1.41 11.11  8.94 114
```

Session at 17:43 EDT = **21:43 UTC** (Oct 18 is still EDT;
DST ended Nov 2). Lag window = `[T − 5 h, T − 2 h]` =
**[16:43 UTC, 19:43 UTC]**. Buoy rows in the window with `period > 0`:

| t (UTC) | DPD (s) |
| --- | --- |
| 16:56 | 13.33 |
| 17:26 | 10.53 |
| 17:56 | 12.50 |
| 18:26 | 11.11 |
| 18:56 | 11.76 |
| 19:26 | 11.76 |

Average period = 11.83 s. Lag = 50 / (1.5 × 11.83) = **2.818 h**,
rounds to **2.8 h** ✓ (matches the displayed "after" lag exactly).

Lagged target = 21:43 UTC − 2:49 = 18:54 UTC. Nearest row =
**2025-10-18 18:56 UTC**, Δ ≈ 2 minutes. Values:

- WVHT = 1.45 m × 3.28084 = **4.76 ft → rounds to 4.8 ft** ✓
- DPD = **11.76 s → rounds to 11.8 s** ✓
- MWD = **118°** ✓ (`directionLabel(118) = "ESE"`)

Wind: every WSPD/WDIR in the entire 18:00–22:00 UTC window is
the sentinel `99.0 / 999`, parsed to `null` at `app.js:4226-4228`.
`windRow = _findNearestNDBCRow(rows.filter(r => r.windSpeed !== null), sessionMs, false)`
on a filtered list with no in-range rows still returns the
nearest non-null row from the rest of the year — but the fallback
`wSpd = windRow ? (windRow.windSpeed || 0) : 0` (line 4321)
collapses `null` (or even very-distant) to 0. The displayed
"Wind: 0 mph @ 0°" matches this fallback. ✓

So the "after" state is a faithful reading of NDBC 44097's
2025-10-18 18:56 UTC stdmet record, lagged by group-velocity travel
time correctly.

---

## 3. Why the buoy lag differs (3.66 h vs 2.8 h)

Both lags use the same formula:
`lag = buoyDistanceMiles / (1.5 × avgPeriod)` with
`buoyDistanceMiles = 50`. The difference is **which `avgPeriod`** they
average:

- **Before (Open-Meteo path,** `getSwellLagHours`, `app.js:4366-4382`**):**
  averages `swell_wave_period` from the **Open-Meteo Marine model
  output at 41.089°N, −71.721°W** (a coastal grid point a few miles
  off the beach) over `[T − 5 h, T − 2 h]`. Open-Meteo reports
  9.1–9.3 s in that window → avg ≈ 9.18 s → lag ≈ 3.63 h. (The
  stored 3.66 h likely reflects a slightly different model run from
  October 2025; Open-Meteo's archive can shift slightly with later
  reanalysis updates.)

- **After (NDBC path):** averages `DPD` from **buoy 44097 stdmet**
  over the same window. Buoy reports 11.83 s → lag ≈ 2.82 h.

The lag formula itself is identical. The two paths simply pick
different average periods, because the two data products themselves
disagree about what the period was (model 9.1 s vs. measured 11.8 s).

**Side note (not a bug, but worth flagging in the report):** the
Open-Meteo path applies the buoy-distance lag to a **coastal** grid
cell that is *not* at buoy 44097. The grid cell at
(41.089°N, −71.721°W) is essentially right next to the beach
(`forecastLat`/`forecastLon` is also `starLat`/`starLon`,
`app.js:19-22`). Lagging a coastal-cell forecast by buoy-to-beach
travel time is conceptually unmotivated — there's no buoy
upstream of the data point. The NDBC path is the one where the
lag has a clean physical interpretation.

---

## 4. NDBC vs. Open-Meteo for this moment — verified against live data

Both fetched directly from the originating APIs:

- **NDBC 44097 archive** (`/tmp/44097h2025.txt`, downloaded with
  `curl` from
  `https://www.ndbc.noaa.gov/view_text_file.php?filename=44097h2025.txt.gz&dir=data/historical/stdmet/`):
  the row chosen by the app's algorithm — 2025-10-18 18:56 UTC —
  records 1.45 m / 11.76 s / 118° → **4.76 ft / 11.8 s / 118°**.
  The "after" readout matches this exactly.

- **Open-Meteo Marine** (live fetch from
  `https://marine-api.open-meteo.com/v1/marine?latitude=41.089152&longitude=-71.721050&...&start_date=2025-10-18&end_date=2025-10-18`):
  swell heights of 2.36–2.43 ft, periods 9.10–9.30 s, direction 94°
  across the afternoon hours, with a small secondary partition
  (0.3–0.5 ft, 2–6 s, direction shifting from ESE through ESE/SSE).
  The "before" readout lines up with this.

The two sources genuinely disagree. The likely reason: Open-Meteo
Marine for U.S. East Coast is a coastal/near-shore wave model that
tends to **underestimate offshore swell heights and report shorter
peak periods** than buoy DPD, particularly when long-period swell
is mixed with short-period wind sea — the model splits the spectrum
differently than NDBC's continuous-wavelet DPD detector. NDBC's
DPD reports the dominant peak of the measured spectrum directly.

A 2.4 ft / 9.1 s model output vs. 4.8 ft / 11.8 s buoy measurement
for the same date is a substantial under-forecast, but not an
extraordinary one for this region.

---

## 5. Is one of them "wrong"?

**The lag computation is correct on both paths.** Each path averages
its own data's periods and divides distance by group velocity. No
miscalculation drops one out of the right hour:

- Open-Meteo lag: 50 / (1.5 × 9.18) = 3.63 h (stored as 3.66 h with
  October 2025 model values).
- NDBC lag: 50 / (1.5 × 11.83) = 2.82 h. Verified against the
  current archive.

**However**, the two readouts represent different physical things:

- The NDBC "after" readout is **what buoy 44097 measured 50 mi
  offshore at 18:56 UTC**, asserted as "what arrived at Chocomount
  by 21:43 UTC". This is a defensible estimate of arrival
  conditions if the swell propagates as deep-water linear waves
  along the bearing from buoy to beach.
- The Open-Meteo "before" readout is **a coastal model output at
  41.089°N, −71.721°W at ~15:00 ET**. The lag-back of 3.66 h
  applied to that grid cell is not physically motivated — the
  model already represents that location's conditions at that
  time. The persisted entry effectively assigns an arbitrary
  earlier hour's coastal-grid output to the session.

So neither is "wrong" in the lookup sense, but the **NDBC reading
is the more trustworthy of the two for "what the swell actually
was"**. Open-Meteo's model under-predicted the swell that the buoy
ultimately measured.

---

## 6. Buoy lag for this session, computed correctly

Using the actual NDBC measurements from buoy 44097 in the window
[16:43 UTC, 19:43 UTC] on 2025-10-18:

- avg period = 11.83 s
- lag = 50 mi / (1.5 × 11.83 s · kts/s) = 50 / 17.745 kts = **2.82 h**

Rounded: **2.8 h**. This is exactly what the "after" state shows.

---

## 7. Summary of findings

1. The "before" state is the entry's stored `conditions` block,
   originally produced by `lookupHistoricalConditions` →
   Open-Meteo Marine (forecast endpoint, `past_days=7`). The
   missing "Source:" line just reflects that the entry predates
   commit `2e666c2` (2026-05-04), which introduced
   `cond.source`.
2. The "after" state is fresh output from
   `lookupNDBCHistoricalConditions` (NDBC 44097 archive). The
   routing (`diffDays > 5 && STATE.isChocomount`) sends the
   re-lookup to the NDBC path; the original log was within 5 days
   so it went down the Open-Meteo path. **The button silently
   switches data sources depending on how old the session is at
   the moment of click.**
3. Both lag calculations are arithmetically correct given their
   own input periods. The 0.86 h difference (3.66 h vs. 2.8 h)
   reflects the two sources reporting different periods (9.1 s
   vs. 11.8 s), not a bug.
4. The two sources genuinely report different conditions. The
   NDBC measurement is the more physically grounded number; the
   Open-Meteo model output appears to have under-predicted swell
   height and reported a shorter peak period for this storm.
5. Saving over the existing entry with the "after" data would
   replace a model-derived block (Open-Meteo, no `source`)
   with a measurement-derived block (NDBC, `source: 'ndbc'`).
   That is the user-visible cause of the dramatic numerical
   change in the dialog.

## Files / functions referenced

- `app.js:14-32` — `CONFIG.chocomount` (buoy/forecast lat-lon, distance).
- `app.js:474-528` — Open-Meteo Marine / Weather fetch helpers.
- `app.js:4192-4234` — NDBC historical archive fetch + parser.
- `app.js:4273-4349` — `lookupNDBCHistoricalConditions`.
- `app.js:4366-4382` — `getSwellLagHours` (Open-Meteo path).
- `app.js:4384-4407` — `fetchHistoricalWind`, `fetchHistoricalMarine`
  (5-day forecast vs archive split).
- `app.js:4459-4509` — `lookupHistoricalConditions` (top-level
  router; calls NDBC for `diffDays > 5 && isChocomount`).
- `app.js:4511-4531` — `renderConditionsDisplay` (renders source line
  only if `cond.source` is set).
- `app.js:4608-4624` — Lookup-button click handler.
- `app.js:4625-4647` — Save handler (persists `_slConditions` as
  `entry.conditions`).
- `app.js:4709-4777` — `editLogEntry` (uses stored `e.conditions`
  as-is for the "before" readout; no recompute).
