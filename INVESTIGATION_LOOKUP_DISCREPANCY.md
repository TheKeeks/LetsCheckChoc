# Investigation: Lookup "before" vs "after" for the 2025-10-18 session

Session: **2025-10-18 17:43 ET (21:43 UTC), Chocomount.**

The edit dialog showed one set of conditions; clicking "Lookup Historical
Conditions" again showed very different numbers:

| | Before (saved on the entry) | After (re-Lookup, May 2026 code) |
| --- | --- | --- |
| Swell | 2.4 ft @ 9.1 s, 94° E, + 0.3 ft @ 3.9 s | 4.8 ft @ 11.8 s, 118° ESE, no secondary |
| Wind | 4 mph W (260°) | 0 mph N (0°) |
| Tide | 2.4 ft rising | 2.4 ft rising |
| Lag | 3.66 h ("~3.7 h ago at buoy") | 2.8 h |
| Source line | none | "NDBC buoy 44097 (measured)" |

> **This report replaces an earlier version** that analysed the May 2026
> code and made several claims that turned out to be wrong. The corrections
> are listed at the end. The code has since moved on (archive-first swell,
> archive wind, hourly tide); the findings below are checked against both
> and against live data from NDBC, Open-Meteo and NOAA CO-OPS. Raw responses
> for this session are saved in `test-fixtures/`.

## Short answer

- **Before** was Open-Meteo Marine model output saved when the session was
  logged (no `cond.source` field existed yet; the secondary swell and the
  unrounded lag are Open-Meteo signatures).
- **After** was NDBC buoy 44097. In May 2026 the Lookup button sent any
  Chocomount session older than 5 days to the buoy archive.
- They disagree because they **measure different things in different
  places**, not because one API is broken. Several of the app's own
  calculations were also wrong, in both readouts.

## What each source actually measures

| | Open-Meteo marine | NDBC 44097 stdmet |
| --- | --- | --- |
| Where | Grid cell 41.125 N 71.708 W (Open-Meteo snaps the request to it), **14.7 nmi** from the beach, inside the sound | 40.969 N 71.124 W, **42.2 nmi** offshore, open ocean |
| Height | `swell_wave_height`: swell partition only | `WVHT`: significant height of the **whole sea state** (swell + wind sea) |
| Period | `swell_wave_period`: **mean** period of the swell partition | `DPD`: period of **peak** energy (`APD` is the average) |
| Direction | Per train (primary, secondary, wind wave) | One (`MWD`, at the peak period) |
| Wind | n/a (wind comes from the weather archive) | **None — 44097 has no anemometer.** Zero wind readings in the whole 2025 file. |

Open-Meteo **at the buoy's own location** for this afternoon gives 4.0–4.2 ft
total, close to the buoy's 4.0–5.2 ft over the same hours. At the near-shore cell it gives
2.4 ft. Most of the 2.4 vs 4.8 gap is the sheltering by Montauk and Block
Island between the buoy and the beach, not model error. Comparing
Open-Meteo's 9.1 s *mean swell* period with the buoy's 11.8 s *peak* period
is also apples to oranges: the buoy's average period was 8.6–9.0 s.

## What the app got wrong

1. **Lag distance (all Open-Meteo lookups, and the May backfill).** The
   Open-Meteo swell was read at the grid cell 14.7 nmi from the beach but
   lagged as if it came from the buoy 50 miles away. For a 9.1 s swell that
   pulled data from 3.7 h before the session instead of ~0.9 h. Every
   session's Open-Meteo swell came from the wrong hour, and was wrongest
   for short-period swell or a sea state that was building or dropping.
2. **Lag units.** `buoyDistanceMiles` (50, statute) was divided by a speed
   in knots. The real buoy→beach distance is 42.2 nautical miles. The
   rule-of-thumb 1.5·T knots is also replaced by the deep-water group
   velocity g·T/4π (1.52·T knots).
3. **Lag direction.** The swell travels along its own heading, not along
   the buoy→beach line. The path is now the component of that line along
   the swell's direction of travel: the full 42.2 nmi for ESE swell like
   this one, 18.6 nmi for swell from due south.
4. **Fake calm wind.** The buoy path looked for wind on a buoy with no
   anemometer and saved 0 mph / 0° when it found none. Already fixed on
   `main` before this work (Open-Meteo archive wind at the beach); the dead
   buoy-wind lookup is now removed.
5. **Tide was the next high/low, not the water level.** The saved 2.4 ft
   was the 20:09 high tide; the water at 17:43 was 1.5 ft and rising.
   Already fixed on `main` (hourly interpolation); the historical fetch now
   also covers the day before and after, so evening sessions get a real
   rate.
6. **Different quantities in the same field.** The NDBC fallback wrote
   total height and peak period into `cond.swell`, where the Open-Meteo
   path writes swell-only height and mean period. The regressions trained
   on a mix of the two.
7. **No time limit on "nearest".** If the buoy or archive had a gap, the
   lookup took the nearest sample however far away (days or months). Now
   90 minutes maximum, otherwise null.
8. **Device timezone.** Session times, Open-Meteo hours and tide times were
   parsed in the viewing device's timezone. Correct only on a device set to
   Eastern time.

## Corrected numbers for this session

| | Value | Where it comes from |
| --- | --- | --- |
| Open-Meteo swell | 2.4 ft @ 9.1 s, 94° E | Grid cell, ~0.9 h before the session (20:50 UTC) |
| Buoy 44097 | 4.9 ft total, 11.8 s peak / 8.6 s avg, 113° ESE | Row 19:26 UTC, **2.4 h** before the session |
| Wind | 6 mph WSW (250°) | Open-Meteo archive at the beach |
| Tide | 1.5 ft rising at +0.51 ft/hr | NOAA 8510719 hourly predictions at 17:43 ET |

**The correctly computed buoy lag is 2.4 h**, not 2.8 h or 3.66 h. The
averaged buoy peak period near the arrival time is 11.6 s, giving
Cg = 17.6 kt over 42.2 nmi.

## What changed (this PR)

- One travel-time calculation for both sources (`swellTravelHours`):
  nautical miles, deep-water group velocity, projected along the swell's
  heading, measured from the point the data describes. Lag is iterated
  once so it uses the swell that actually arrives at session time.
- Every lookup stores **both** swell sets side by side: `cond.swell`
  (Open-Meteo) and `cond.buoy` (NDBC, with `observedAt`, peak and average
  period). They are never merged.
- NDBC coverage for the current year: yearly archive → monthly files →
  45-day realtime feed. The yearly file only exists for finished years.
- 90-minute limit on nearest-sample matching; session times parsed as
  America/New_York; failed tide fetches store null instead of 0 ft.
- Regression tab: toggle between the Open-Meteo and buoy sets for the Wave
  and Ride models. Both refit on every save. Forecast prediction and
  threshold lights always use the Open-Meteo set, because there are no
  future buoy readings to score a forecast hour with. Old-format entries
  (buoy reading saved in `cond.swell`) are left out of the Open-Meteo set
  until re-fetched.
- Edit dialog: when a re-Lookup differs from what's saved, both are shown
  side by side and Update stays blocked until one is picked.
- Backfill: fetches everything first and writes nothing, shows saved vs new
  per session, then on confirm downloads a JSON backup and saves with the
  old block under `conditions.previous`. A session whose Open-Meteo swell
  would disappear in a transient outage is skipped; failed wind/tide
  fetches keep the saved values.

## Known limits (not fixed)

- **Wind grid cell.** Open-Meteo's archive snaps the Chocomount land point
  to 41.37 N 72.03 W, on the Connecticut shore ~8 nmi away. Local effects
  at the beach (sea breeze, Fishers Island terrain) are not resolved.
- **Buoy direction is offshore.** MWD at 44097 is before refraction into
  the sound; the swell window (115–158°) is defined at the beach. The buoy
  set uses the same window as an approximation.
- **Shoaling.** Deep-water group velocity is assumed the whole way; the
  last few miles in the sound slow long-period swell by minutes.
- **Recent sessions.** The weather archive lags real time by a few days, so
  wind is null for very recent sessions until a later Lookup.

## Corrections to the first version of this report

- It said both lag calculations were arithmetically correct. They used the
  wrong distance for Open-Meteo and mixed statute miles with knots.
- It said the correct lag was 2.82 h. It is ~2.4 h.
- It said Open-Meteo under-predicted the swell. Mostly it describes a
  sheltered location; at the buoy's location it agrees within ~15%.
- It compared Open-Meteo's mean swell period with the buoy's peak period
  as if they were the same quantity.
- It cited line numbers and routing from the May 2026 code, which `main`
  had since replaced.
