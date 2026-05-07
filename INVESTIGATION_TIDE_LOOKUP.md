# Investigation: Historical Tide Lookup Behavior

Read-only audit of how the surf-log "Lookup Historical Conditions"
button retrieves tide data, what it stores, and what (if any) timing
corrections it applies. All file references are against the working
tree on branch `claude/investigate-tide-lookup-peyJ8`.

## TL;DR

| Question | Answer |
|---|---|
| 1. Which station? | **(a) `CONFIG.chocomount.tideStation` = `'8510719'` (Silver Eel Pond).** Correct. |
| 2. Time offset on tide? | **None.** Tide is queried for the session's exact timestamp. The 1.5 kt × period buoy lag is applied only to the swell-index lookup, not to the tide call. |
| 3. Actual fetch URL? | See §3. `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=20251018&range=24&station=8510719&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&interval=hilo&application=letscheckchoc&format=json` |
| 4. Predicted vs measured? | **Predicted (harmonic hi/lo).** `product=predictions`, `interval=hilo`. Consistent across both the surf-log lookup path and the live-forecast path. Measured water level is **never** queried for tide. |
| 5. `cond.tide.rate` correct? | **Field does not exist in the codebase.** No `rate`, no central difference, no signed ft/hr. Tide on a session is only `{ height, stage, timeToNearest }`. |

---

## 1. Station traced from button click to fetch

Click handler (`app.js:4749`):

```js
el('sl-lookup-btn')?.addEventListener('click', async () => {
  const dt = el('sl-datetime')?.value;
  ...
  const lat = CONFIG.chocomount.forecastLat;
  const lon = CONFIG.chocomount.forecastLon;
  _slConditions = await lookupHistoricalConditions(lat, lon, dt);
```

`lookupHistoricalConditions` (`app.js:4591`) fans out three calls in
parallel:

```js
const [archiveResult, wind, tide] = await Promise.all([
  lookupOpenMeteoArchive(lat, lon, dateStr).catch(...),
  fetchHistoricalWind(dateStr).catch(...),
  fetchHistoricalTide(dateStr).catch(...)        // ← raw dateStr, no lag
]);
```

`fetchHistoricalTide` (`app.js:4453`):

```js
async function fetchHistoricalTide(dateStr) {
  const d = new Date(dateStr);
  const bd = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'),
              String(d.getDate()).padStart(2,'0')].join('');
  const p = new URLSearchParams({
    begin_date: bd, range: 24,
    station: CONFIG.chocomount.tideStation,   // ← '8510719'
    product: 'predictions', datum: 'MLLW',
    units: 'english', time_zone: 'lst_ldt',
    interval: 'hilo', application: 'letscheckchoc', format: 'json'
  });
  return fetchJSON(CONFIG.api.coops + '?' + p);
}
```

Config values (`app.js:24-25`):

```js
tideStation: '8510719',
waterTempStation: '8510560',
```

So the answer is **(a)**: `8510719` Silver Eel Pond. The Montauk
station (`8510560`) is referenced only in `fetchWaterTemp` paths
(`app.js:1437`) and is unrelated to tide. There is no path through the
lookup that consults the user's selected tide-stations panel
(`STATE.tideStations`); that panel is purely a map-display feature
(`app.js:715, 870, 7544`).

The same station is also used by the bulk historical-rebuild flow
(`app.js:5024` calls the same `lookupHistoricalConditions`) and by the
NDBC fallback (`app.js:4357` reuses the pre-fetched tide). One station,
one product, all paths.

## 2. Time offset / lag on the tide query

**No offset.** The tide call gets the unmodified `dateStr`. Compare:

- **Swell lag (yes, applied):** `lookupOpenMeteoArchive` computes
  `lagHours = getSwellLagHours(...)` (`app.js:4540, 4416`) using the
  1.5 kt × period rule (`SWELL_SPEED_KTS_PER_PERIOD = 1.5` at
  `app.js:4411`), constructs `laggedDateStr` (`app.js:4541-4543`), and
  passes that lagged timestamp into `findNearestHour` for the swell
  index. The NDBC fallback does the same (`app.js:4368-4372`).
- **Tide (no offset):** `fetchHistoricalTide(dateStr)` (`app.js:4603`)
  receives the raw session string; the same raw `dateStr` is then used
  by `parseTideAtTime(tide, dateStr)` (`app.js:4610`) to pick the
  nearest hi/lo prediction. There is nowhere in the code that
  subtracts a travel time from the tide timestamp.

This matches the spec stated in the question: tide is a local
station-specific quantity at session time, no lag should apply, none
does.

## 3. Concrete fetch URL example

For a session at `2025-10-18T17:43`:

`new Date('2025-10-18T17:43')` → `getFullYear=2025`, `getMonth+1=10`,
`getDate=18`, so `bd = "20251018"`. `range=24` (hours). The full URL
that `fetchJSON` is handed:

```
https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=20251018&range=24&station=8510719&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&interval=hilo&application=letscheckchoc&format=json
```

(Base URL from `CONFIG.api.coops` at `app.js:37`.) Note the 24-hour
range starts at midnight local (`begin_date` is date-only,
`time_zone=lst_ldt`), so the response covers 2025-10-18 00:00 →
2025-10-19 00:00. With `interval=hilo` that is at most 4 rows (the
day's two highs and two lows), and `parseTideAtTime` picks whichever
is closest to 17:43.

## 4. Predictions vs measured water level

**Predicted, exclusively.** Two flags fix this:

- `product=predictions` — harmonic-derived predictions, not the
  `water_level` sensor product.
- `interval=hilo` — only the day's high/low extremes, not the 6-min
  observation series.

`parseTideAtTime` (`app.js:4470`) reads `tideData.predictions[*].t`
and `.v` directly:

```js
function parseTideAtTime(tideData, dateStr) {
  if (!tideData?.predictions?.length) return { height: 0, stage: 'rising', timeToNearest: 0 };
  const preds = tideData.predictions, tt = new Date(dateStr).getTime();
  let ni = 0, nd = Infinity;
  for (let i = 0; i < preds.length; i++) {
    const d = Math.abs(new Date(preds[i].t).getTime() - tt);
    if (d < nd) { nd = d; ni = i; }
  }
  const n = preds[ni], nt = new Date(n.t).getTime();
  const stage = nt > tt ? (n.type === 'H' ? 'rising' : 'falling')
                        : (n.type === 'H' ? 'falling' : 'rising');
  return { height: parseFloat(n.v) || 0, stage,
           timeToNearest: Math.round(Math.abs(nt - tt) / 3600000 * 10) / 10 };
}
```

Note this means `cond.tide.height` is the **height of the nearest
hi/lo extremum**, not the interpolated water level at session time. A
session logged exactly between a low (1.0 ft) and a high (4.0 ft) will
record either 1.0 or 4.0, whichever is temporally closer — never 2.5.
That is a separate accuracy concern from the question asked, but worth
flagging because it materially affects `cond.tide.height` semantics
and the `_TIDE_MEDIAN` / `low_incoming` features computed off it
(`app.js:5273-5344, 5453-5454`).

The live-forecast path uses the same `parseTideAtTime` against
`tideHiLo` (`app.js:5684`), so predictions/hilo is consistent across
the codebase. The only `product` other than `predictions` in any tide
call is in `fetchWaterTemp` (water temperature, different station,
different product). No `water_level` product is ever requested.

## 5. `cond.tide.rate` — does not exist

The question presupposes a `rate` field added in a recent prompt and
asks whether the central-difference computation is correct. After
grepping the entire codebase:

```bash
grep -n "tide.rate\|tideRate\|ft/hr\|ftPerHr\|central diff" app.js
# (no matches)
```

The tide object is constructed in exactly three places, all with the
identical three-field shape:

- `app.js:4389` (NDBC fallback path):
  `tide: { height: ..., stage: ..., timeToNearest: ... }`
- `app.js:4620` (Open-Meteo archive path):
  `tide: { height: ..., stage: ..., timeToNearest: ... }`
- `app.js:5684` (live-forecast card):
  same three-field shape via `parseTideAtTime`.

There is no `rate` key, no derivative computation, no `± 30 min`
sampling, and `parseTideAtTime` returns only `{ height, stage,
timeToNearest }`. If a prior prompt requested adding a `rate` field,
the change was either reverted, never landed on this branch, or
landed on a different branch.

If `tide.rate` is meant to land here, the natural place to compute it
would be inside or alongside `parseTideAtTime`, using interpolated
predictions (interval `hilo` only gives 2-4 points per day, so a
`±30 min` central difference around 17:43 will frequently fall
outside the nearest hi/lo pair — to compute a real ft/hr rate the
fetch would need `interval=h` or `interval=` (6-min) and probably
`product=predictions` kept). That is a code change request, not
something to confirm against existing code.

---

## Bonus: paths that *don't* affect the answer

- `STATE.tideStations` (`app.js:62, 715, 870, 7544`) is populated for
  the map's clickable tide-station overlay only. It is never read by
  any tide-fetching function.
- `fetchWaterTemp` at `app.js:1437` uses Montauk (`8510560`) but only
  for water temperature; that station is never used for tide.
- The NDBC historical fallback (`_fetchNDBCHistoricalConditionsCore`
  at `app.js:4350`) accepts a pre-fetched tide arg — when called from
  `lookupHistoricalConditions` it receives the same Silver-Eel-Pond
  predictions object, so the station does not change in the fallback.
