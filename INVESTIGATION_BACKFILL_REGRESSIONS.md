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
