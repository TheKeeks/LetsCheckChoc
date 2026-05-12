# Investigation: Backfill regressions — null swell + null wind on post-backfill sessions

After the most recent backfill, the Conditions sub-model could not retrain
(n < 12 usable rows). A drill-down on session conditions surfaced two
independent regressions that combined to drop the Conditions training set
below the gate:

  1. Secondary-swell / wind-wave columns were null on every session
     marked `openmeteo-archive`.
  2. Wind fields were null on every session marked `ndbc-stdmet`.

Both bugs trace back to backfill-path code paths that quietly degrade to a
"no data" result instead of failing loudly, so the issue only became
visible once the regression refused to train.

---

## Regression #1 — `lookupOpenMeteoArchive` hits the atmospheric endpoint

`CONFIG.api.openMeteoArchive` is set to
`https://archive-api.open-meteo.com/v1/archive`. That endpoint is the
ERA5 reanalysis re-run of the atmospheric forecast model — it carries
temperature, wind, precipitation, etc., but does NOT carry the wave /
swell variables we request:

```
wave_height, wave_direction, wave_period,
swell_wave_height, swell_wave_direction, swell_wave_period,
secondary_swell_wave_height, secondary_swell_wave_direction, secondary_swell_wave_period,
wind_wave_height, wind_wave_direction, wind_wave_period
```

Open-Meteo's atmospheric archive responds with a 200 + an `hourly` block
where every requested wave variable is an array of `null`s. Our parser
takes the first non-null swell height — and finds one for the primary
swell because the atmospheric archive happens to expose
`swell_wave_height` on a separate marine layer when called via the
atmospheric API, but secondary swell and wind wave come back as nulls.
That matches the "primary present, secondary always null" symptom on
every freshly-backfilled session.

The marine reanalysis lives at
`https://marine-api.open-meteo.com/v1/marine`. Same parameters,
same start_date/end_date semantics, but it returns the full marine
hourly stack including secondary and wind wave.

**Fix:** point `lookupOpenMeteoArchive` at the marine endpoint. Same
parameter schema, no other code change required.

## Regression #2 — NDBC fallback discards Open-Meteo wind

When `lookupOpenMeteoArchive` returns null (pre-2016 coverage, or
temporary endpoint failure), `lookupHistoricalConditions` falls through
to `_fetchNDBCHistoricalConditionsCore`. That function builds the wind
block from the NDBC stdmet row at session time — but buoy 44097 has no
historical anemometer column, so `windRow.windSpeed` is always null and
the wind block ends up `{ speed: null, direction: null }`.

The bug is that the fallback path discards the Open-Meteo Weather wind
fetch that the caller has already done in parallel. The wind data is
sitting there, fully populated, but the NDBC branch never reads it.

**Fix:** in the NDBC fallback branch of `lookupHistoricalConditions`,
after `_fetchNDBCHistoricalConditionsCore` returns, overlay the wind
block from the already-fetched Open-Meteo Weather response (when it has
a usable value at the session hour). Mark the source as
`ndbc-stdmet+openmeteo-wind` so the dual provenance is explicit. If the
weather fetch failed too, leave wind as null (per the wind quality fix
in #83 — null is correct, not 0/0).

---

## Verification

Re-running the backfill after both fixes should land essentially every
session on `openmeteo-archive` with primary + secondary + wind-wave +
wind all populated. The handful that fall through to NDBC stdmet (none
expected for 2016+ dates) should carry Open-Meteo wind alongside the
NDBC swell. The Conditions sub-model should clear the n ≥ 12 gate again.
# Investigation: Backfill regressions after the wind fix

Read-only investigation. No code changes.

After commit `97bcd2e` ("Fix wind data quality") landed and the user re-ran
"Re-fetch all session conditions", two regressions appeared:

1. All 28 sessions report `cond.source = 'ndbc-stdmet'` (previously a
   mix dominated by `openmeteo-archive` for 2025 dates).
2. The Conditions model reports "Need 13 more sessions to train this
   model" — implying 0 sessions have a valid wind block.

**Both regressions share a single root cause**: the Open-Meteo *archive*
endpoint (`archive-api.open-meteo.com/v1/archive`) silently stopped
serving wave/swell variables — it now returns every `wave_*` /
`swell_wave_*` array as all-`null`. The wind fix didn't cause this; it
exposed it by overwriting the previously-cached (and previously bogus
`0/0`) wind values with truthful `null` sentinels.

---

## A. Archive lookup regression

### A.1 `lookupOpenMeteoArchive` (app.js:4621–4684)

Current implementation (verbatim):

```js
async function lookupOpenMeteoArchive(lat, lon, dateStr) {
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const dayBefore = new Date(target); dayBefore.setDate(dayBefore.getDate() - 1);
  const startDate = fmtDate(dayBefore);
  const endDate = fmtDate(target);

  const vars = [
    'wave_height','wave_direction','wave_period',
    'swell_wave_height','swell_wave_direction','swell_wave_period',
    'secondary_swell_wave_height','secondary_swell_wave_direction','secondary_swell_wave_period',
    'wind_wave_height','wind_wave_direction','wind_wave_period'
  ].join(',');
  const p = new URLSearchParams({
    latitude: Number(lat).toFixed(4),
    longitude: Number(lon).toFixed(4),
    start_date: startDate,
    end_date: endDate,
    hourly: vars,
    length_unit: 'imperial',
    timezone: 'auto'
  });

  const data = await fetchJSON(CONFIG.api.openMeteoArchive + '?' + p);
  if (!data || !data.hourly || !Array.isArray(data.hourly.time) || data.hourly.time.length === 0) return null;

  const lagHours = getSwellLagHours(data, dateStr);
  const laggedDateStr = lagHours > 0
    ? new Date(target.getTime() - lagHours * 3600000).toISOString()
    : dateStr;
  const idx = findNearestHour(data.hourly.time, laggedDateStr);
  if (idx == null || idx < 0) return null;

  const swH = data.hourly.swell_wave_height?.[idx];
  if (swH == null) return null;                 // ← all sessions die here
  …
}
```

`CONFIG.api.openMeteoArchive = 'https://archive-api.open-meteo.com/v1/archive'`
(app.js:36).

### A.2 `lookupHistoricalConditions` archive-vs-NDBC decision (app.js:4699–4764)

```js
async function lookupHistoricalConditions(lat, lon, dateStr) {
  const [archiveResult, wind, tide] = await Promise.all([
    lookupOpenMeteoArchive(lat, lon, dateStr).catch(err => { … return null; }),
    fetchHistoricalWind(dateStr).catch(err => { … return null; }),
    fetchHistoricalTide(dateStr).catch(err => { … return null; })
  ]);

  if (archiveResult && archiveResult.swell && archiveResult.swell.height != null) {
    // openmeteo-archive branch — Open-Meteo wind merged here
    …
    return { swell, wind: …, tide: …, source: 'openmeteo-archive' };
  }

  if (isChocomountSpot(lat, lon)) {
    try {
      const ndbc = await _fetchNDBCHistoricalConditionsCore(dateStr, tide);
      if (ndbc && ndbc.swell && ndbc.swell.height != null) {
        ndbc.source = 'ndbc-stdmet';
        ndbc.note = 'Open-Meteo archive unavailable; NDBC measurement used (no secondary swell)';
        return ndbc;
      }
    } catch (err) { … }
  }
  return null;
}
```

The decision is: **archive must return a non-null `swell.height`,
otherwise fall through to NDBC stdmet**.

Critical side effect of the fallthrough: the Open-Meteo `wind` block
fetched in parallel is **discarded** in the NDBC branch.
`_fetchNDBCHistoricalConditionsCore` reads wind only from the NDBC
stdmet row (app.js:4373, 4381–4383), and returns its own conditions
object. The Open-Meteo wind never reaches the saved entry once the
archive branch fails.

### A.3 Trace for the 2025-10-18 session

Coords: `forecastLat=41.089152, forecastLon=-71.721050` (Choc offshore).
`fmtDate(target) = '2025-10-18'`, `fmtDate(dayBefore) = '2025-10-17'`.

URL built by `lookupOpenMeteoArchive`:

```
https://archive-api.open-meteo.com/v1/archive
  ?latitude=41.0892
  &longitude=-71.7211
  &start_date=2025-10-17
  &end_date=2025-10-18
  &hourly=wave_height,wave_direction,wave_period,
          swell_wave_height,swell_wave_direction,swell_wave_period,
          secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,
          wind_wave_height,wind_wave_direction,wind_wave_period
  &length_unit=imperial
  &timezone=auto
```

### A.4 What that URL actually returns

I curled it. The response is HTTP 200 with a structurally valid body,
**but every wave/swell array is all-`null`**:

```json
{
  "latitude": 41.08963, "longitude": -71.74283,
  "hourly_units": {
    "time": "iso8601",
    "wave_height": "ft",
    "wave_direction": "°",
    "wave_period": "s",
    "swell_wave_height": "undefined",         ← note: literal "undefined"
    "swell_wave_direction": "undefined",
    "swell_wave_period": "undefined",
    "secondary_swell_wave_height": "undefined",
    "secondary_swell_wave_direction": "undefined",
    "secondary_swell_wave_period": "undefined",
    "wind_wave_height": "undefined",
    …
  },
  "hourly": {
    "time": ["2025-10-17T00:00", …, "2025-10-18T23:00"],   ← 48 hours
    "wave_height": [null, null, null, …, null],            ← all null
    "swell_wave_height": [null, null, null, …, null],      ← all null
    "secondary_swell_wave_height": [null, …, null],        ← all null
    "wind_wave_height": [null, …, null],
    …
  }
}
```

So `data.hourly.time.length === 48` (passes the early-return guard at
line 4645), `findNearestHour` returns a valid `idx`, then
`data.hourly.swell_wave_height[idx]` is `null` → line 4656 returns
`null` → `lookupHistoricalConditions` falls through to the NDBC branch
→ `cond.source = 'ndbc-stdmet'`.

This is deterministic for **every** 2025 session, which is exactly
what the user reports.

### A.5 Why the endpoint silently fails

The `archive-api.open-meteo.com/v1/archive` endpoint serves the ERA5
**atmospheric** reanalysis (wind, temperature, pressure, humidity,
radiation). Marine variables (`wave_*`, `swell_wave_*`,
`secondary_swell_wave_*`, `wind_wave_*`) are *not* supported on this
endpoint. Open-Meteo accepts the parameter names without erroring —
the unit shows up as `"undefined"` and every value comes back `null`.

The historical wave data lives on the **marine** API at
`marine-api.open-meteo.com/v1/marine`, which accepts `start_date` /
`end_date` (no `past_days` required) and returns full wave/swell/
secondary-swell/wind-wave arrays.

I confirmed by curling the same coords and dates against the marine
endpoint:

```
GET https://marine-api.open-meteo.com/v1/marine
    ?latitude=41.0892&longitude=-71.7211
    &start_date=2025-10-17&end_date=2025-10-18
    &hourly=wave_height,swell_wave_height,secondary_swell_wave_height,…
    &length_unit=imperial&timezone=auto

→ wave_height          : [4.134, 3.871, 3.675, …]      (real values)
  swell_wave_height    : [1.772, 1.706, 1.575, …]      (real values)
  secondary_swell_wave_height : [0.525, 0.591, 0.591, …]  (real values)
```

Whether Open-Meteo *previously* served wave variables from the
archive endpoint and silently dropped them, or whether it never did
and the original commit (`2412534` — "switch all ages to Open-Meteo
archive (reanalysis)") was always broken but masked because the user's
older sessions were still backfilled by an earlier code path, I can't
tell from inside the repo. Either way, **today** the archive endpoint
returns nulls and the only working historical-wave endpoint is the
marine one.

### A.6 Verdict for regression A

Bug is in the response-parsing/endpoint-choice side: the URL returns
a structurally valid response (`hourly.time` populated, no HTTP error)
but with `swell_wave_height` all-`null`, so the guard at app.js:4656
fails for every session and the function returns `null`. Fix: point
`lookupOpenMeteoArchive` at `marine-api.open-meteo.com/v1/marine`
instead of `archive-api.open-meteo.com/v1/archive`.

---

## B. Wind fetch regression

### B.1 Wind values on the 28 backfilled sessions

I cannot read the user's Firestore directly. From the deterministic
trace below, every session's stored `cond.wind` after the re-run is

```json
{ "speed": null, "direction": null }
```

This is consistent with the "Need 13 more sessions" message
(Conditions model has 2 features → `minSamples = max(2·2, 12) + 1 = 13`;
the message reads "Need `minSamples - looData.n` more sessions"; 13 −
0 = 13, so `looData.n = 0` valid-wind sessions).

### B.2 Wind code path during backfill

Backfill calls `lookupHistoricalConditions` (app.js:5168), which kicks
off three parallel fetches:

```js
fetchHistoricalWind(dateStr).catch(err => null)
```

`fetchHistoricalWind` (app.js:4449–4462):

```js
async function fetchHistoricalWind(dateStr) {
  const target = new Date(dateStr);
  const dayBefore = new Date(target); dayBefore.setDate(dayBefore.getDate() - 1);
  const p = new URLSearchParams({
    latitude: CHOC_WIND_LAT,                    // 41.276083
    longitude: CHOC_WIND_LON,                   // -71.963725
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    start_date: fmtDate(dayBefore),
    end_date: fmtDate(target)
  });
  return fetchJSON(CONFIG.api.openMeteoArchive + '?' + p);
}
```

Success-detection logic in `lookupHistoricalConditions`
(app.js:4717–4733):

```js
if (archiveResult && archiveResult.swell && archiveResult.swell.height != null) {
  let wSpd = null, wDir = null;
  if (wind?.hourly?.time) {
    const wIdx = findNearestHour(wind.hourly.time, dateStr);
    const s = wind.hourly.wind_speed_10m?.[wIdx];
    const d = wind.hourly.wind_direction_10m?.[wIdx];
    if (s != null && d != null) { wSpd = s; wDir = d; }
  }
  conditions = { …, wind: (wSpd != null && wDir != null) ? {…} : { speed: null, direction: null }, … };
}
```

**The Open-Meteo wind block is only merged inside the
`archiveResult.swell.height != null` branch.** Because every session
now fails that guard (A.5), the wind from this fetch is **always
discarded** and we fall through to the NDBC stdmet branch.

### B.3 Manually fetching the wind URL

```
GET https://archive-api.open-meteo.com/v1/archive
    ?latitude=41.276083&longitude=-71.963725
    &start_date=2025-10-17&end_date=2025-10-18
    &hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m
    &wind_speed_unit=mph&timezone=auto

→ wind_speed_10m     : [11.1, 10.6, 11.2, …]        (real values)
  wind_direction_10m : [349, 347, 338, …]            (real values)
  wind_gusts_10m     : [ …, real values, … ]
```

So **the wind URL works perfectly**. Wind is *not* the broken endpoint
— wave data is. The wind regression is purely an indirect consequence
of the archive-wave failure.

### B.4 What actually populates `cond.wind` for every session

After the archive branch fails, `lookupHistoricalConditions` calls
`_fetchNDBCHistoricalConditionsCore` (app.js:4350–4410). That function
reads wind from the NDBC stdmet historical file for buoy 44097:

```js
const windRow = _findNearestNDBCRow(rows.filter(r => r.windSpeed !== null), sessionMs, false);
…
const haveWind = windRow && windRow.windSpeed != null && windRow.windDir != null;
…
wind: haveWind ? { speed: …, direction: … } : { speed: null, direction: null }
```

I curled the 44097 historical stdmet file directly:

```
$ curl https://www.ndbc.noaa.gov/view_text_file.php?filename=44097h2025.txt.gz&dir=data/historical/stdmet/
#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD …
2025 01 01 00 26  999 99.0 99.0  1.63  8.33  6.01 170 …
2025 01 01 00 56  999 99.0 99.0  1.49  8.33  5.89 166 …
…
```

`WDIR=999` and `WSPD=99.0` are NDBC's missing-value sentinels.
`_parseNDBCHistoricalText` (app.js:4220–4228) maps `wspd >= 99` and
`wdir >= 999` to `null`. A sanity check on all of 2024:

```
$ curl …44097h2024.txt.gz… | awk 'NR>2 {print $6,$7}' | sort -u
999 99.0
```

That is the **only** distinct `(WDIR, WSPD)` pair in the entire 2024
historical file. Buoy 44097's anemometer has no published historical
record on NDBC. Realtime 44097 stdmet (`44097.txt`) shows the same:

```
#YY  MM DD hh mm WDIR WSPD GST  WVHT  …
2026 05 12 14 56   MM   MM   MM   0.8  …
2026 05 12 14 26   MM   MM   MM   0.8  …
```

`MM` = missing in realtime; the historical archive substitutes 999 /
99 for the same fields. Either way, `windRow.windSpeed` is always
`null` for 44097, `haveWind` is always `false`, and
`_fetchNDBCHistoricalConditionsCore` returns `wind: { speed: null,
direction: null }` for every session.

### B.5 Why the wind fix made this visible

Pre-`97bcd2e`, `_fetchNDBCHistoricalConditionsCore` wrote
`wind: { speed: Math.round(0), direction: Math.round(0) } = { speed: 0,
direction: 0 }` (old lines 4378–4379 / 4388). The Conditions extractor
treated these as real data — a stiff offshore (0°) calm — so the model
trained on 28 fake datapoints. The wind fix correctly changed those to
`null` and made `extractCondFeatures` return `null` to drop them
(app.js:5527–5535). With 28 sessions all hitting NDBC and NDBC never
having wind, the dropped-session count is 28 → trainable rows = 0 →
the "Need 13 more sessions" message.

Additionally, the wind fix flipped backfill's merge order from
"preserve existing wind unless missing" to "always overwrite with
freshly fetched wind" (app.js:5186, diff in `97bcd2e`). That overwrote
whatever real wind the user had stored on legacy entries (presumably
from an earlier code path that did persist Open-Meteo wind even when
swell came from NDBC) with the new NDBC-derived `null/null`.

### B.6 Verdict for regression B

No parsing bug introduced by the wind fix. The wind URL returns valid
data; the parsing path is correct. Wind comes out `null` because:

1. The archive wave fetch fails (Section A).
2. Falling through to NDBC stdmet replaces — and never merges back —
   the Open-Meteo wind, and
3. NDBC buoy 44097 has no historical wind data (all `MM` / 999 / 99).

The wind fix is correct in spirit; it's surfacing a pre-existing data
flow bug that was previously hidden behind fabricated `0/0` values.

---

## Single root cause and fix

`lookupOpenMeteoArchive` is hitting the wrong Open-Meteo endpoint. The
ERA5 atmospheric archive (`archive-api.open-meteo.com/v1/archive`)
silently returns nulls for marine variables; the marine archive
(`marine-api.open-meteo.com/v1/marine`) returns the wave/swell data
the code expects. Switching the endpoint:

- Restores `cond.source = 'openmeteo-archive'` for 2025 sessions
  (regression A), and
- Lets `lookupHistoricalConditions` enter the archive branch where it
  merges the (already-working) Open-Meteo wind fetch into `cond.wind`
  with real values, so the Conditions model regains its training set
  (regression B).

A secondary code smell worth fixing alongside, but not the root cause:
`lookupHistoricalConditions` should still merge the Open-Meteo wind
fetch into the NDBC branch when NDBC has no wind, since 44097 has no
anemometer record. That avoids a future repeat of this exact failure
mode if the marine archive ever degrades again. Today the wind fetch
result is wasted whenever we go to NDBC.

## What was *not* the cause

- Not a wind-URL change. `archive-api.open-meteo.com/v1/archive` still
  serves wind (`wind_speed_10m` etc.) correctly.
- Not a parsing bug introduced by the wind fix. The new
  null-sentinel logic matches the API contract.
- Not a JS timezone / `findNearestHour` issue. Times line up; the
  underlying values are simply null.
- Not an NDBC fetch failure. The historical text file downloads
  fine; the buoy genuinely has no wind data.

## Files / lines referenced

- app.js:36 — `openMeteoArchive` endpoint config
- app.js:4350 — `_fetchNDBCHistoricalConditionsCore`
- app.js:4220 — NDBC missing-sentinel parsing (99 / 999)
- app.js:4449 — `fetchHistoricalWind` (uses archive endpoint, works)
- app.js:4621 — `lookupOpenMeteoArchive` (uses archive endpoint, broken for waves)
- app.js:4699 — `lookupHistoricalConditions` decision tree
- app.js:5168 — backfill calls `lookupHistoricalConditions`
- app.js:5527 — `extractCondFeatures` drops null-wind sessions
- app.js:7329 — "Need N more sessions" message (N = 13 − valid-wind count)
