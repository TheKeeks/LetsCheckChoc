# Test fixtures

Recorded live responses for the unit (`tests/helpers/load-app.js`) and e2e
(`tests/e2e/run.js`) harnesses. One mapping, `apiFixtureFor()` in
`tests/helpers/fixtures.js`, decides which file answers which request.
Neither harness ever touches the network.

All recordings are from **2026-10-01, about 10:15–11:10 EDT**. The harnesses
freeze their clocks at `FIXTURE_NOW = 2026-10-01T11:00:00-04:00`, so "today",
"now", tide lows and age labels all line up with the data. If you re-record,
move `FIXTURE_NOW` to match and update any assertions that depend on it.

| File | Source (exact URL app.js builds; see `fetch*` in app.js) |
|---|---|
| `open-meteo/marine.json` | `marine-api.open-meteo.com/v1/marine?latitude=41.089152&longitude=-71.72105&hourly=…&current=…&length_unit=imperial&temperature_unit=fahrenheit&timezone=auto&forecast_days=7` (168 h from 2026-10-01T00:00 local, `current` 11:00) |
| `open-meteo/wind.json` | `api.open-meteo.com/v1/forecast?latitude=41.275693&longitude=-71.96331&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&…&wind_speed_unit=mph&timezone=auto&forecast_days=7` |
| `open-meteo/error-invalid-model.json` | HTTP 400 body for `models=bogus_model` |
| `open-meteo/marine-previous-runs.json` | `marine-api.open-meteo.com/v1/marine?latitude=40.969&longitude=-71.127&hourly=wave_height,wave_height_previous_day1,wave_height_previous_day2,wave_height_previous_day3&start_date=2026-09-28&end_date=2026-10-02&timezone=GMT`, recorded 2026-10-13: the forecast at buoy 44097 for each hour as made 1, 2 and 3 days earlier (the Forecast tab's buoy check). Served for any marine request asking for `previous_day` fields |
| `soundcheck/fc.json` | The committed `research/fc/fc.json` (GFS-Wave and ECMWF 12Z runs of 2026-10-09) moved 8 days earlier, values untouched: runs 2026-10-01 12Z, `made` 14:30 UTC, steps to 2026-10-08 12Z. Its `mslp` entry names the run's GFS sea-level pressure picture, `research/fc/field_gfs_mslp.png` (served as is, step by step like the wave pictures). Forecast tab scenarios serve it for `research/fc/fc.json` so the model covers FIXTURE_NOW |
| `soundcheck/hist.js.gz` | `research/hist.js` as first split out of the page (history through 2026-10-05, the day the hand-built history ended), gzipped to keep the fixtures small. The e2e runner serves it, unzipped, for `research/hist.js` (`PINNED_FILES`), because the history bot adds a day every day and the research scenarios check counts |
| `soundcheck/score.json` | `research/fc/score.json`, the forecast scorecard, as fitted by hand to the 28 sessions logged through 2025-10-18 (before the history bot fitted it to the live surf log). The e2e runner serves it for `research/fc/score.json` (`PINNED_FILES`), because the bot refits it whenever a session is logged |
| `soundcheck/pressure-2026.png`, `soundcheck/pressure-meta.json` | The history bot's pressure maps (`scripts/history/pressure.py`, format in `scripts/history/README.md`) for 2026, as the bot made them in a run on 2026-10-15 from real GFS analyses (f000 of the 00/06/12/18Z runs, `noaa-gfs-bdp-pds`), cut to 2026-09-20 00Z … 2026-10-06 18Z: the picture keeps the year's row numbers (row 0 = 1 Jan 00Z), and every row before 20 Sep is 255 (missing), which `meta.json`'s `missing` counts, so it stays small. Not synthetic. For the Past days' storm view tests; `scripts/test_pressure.py` checks it matches the format |
| `soundcheck/ocean-day-2026.json` | A cut of `research/ocean/day/2026.json` to the hours of 2026-09-25 … 2026-10-05 (Eastern): its `44097` and `wm` lanes as committed at ffa29e1, plus the bot's new `wind` lane (ERA5 at the over-water cell, `archive-api.open-meteo.com/v1/archive?latitude=41.27&longitude=-71.96&hourly=wind_speed_10m,wind_direction_10m&models=era5&cell_selection=sea&start_date=2026-09-24&end_date=2026-10-06&timezone=America/New_York&wind_speed_unit=kn`, recorded 2026-10-15, `utc_offset_seconds` −14400) and `tide` lane (CO-OPS 8510719 hi/lo predictions for 2026, `time_zone=lst_ldt`, recorded 2026-10-15), both made by `derive.wind_lane` / `derive.tide_lane`. For the Past days' hour-by-hour tests |
| `coops/hilo-240h.json`, `coops/hilo-72h.json` | `api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=20261001&range=240\|72&station=8510719&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&interval=hilo&application=letscheckchoc&format=json` |
| `coops/predictions-6min-168h.json`, `coops/predictions-6min-72h.json` | same, `range=168\|72&interval=6` |
| `coops/water-temp-8510560.json` | `…?date=latest&station=8510560&product=water_temperature&units=english&time_zone=lst_ldt&…` |
| `coops/error-no-predictions.json` | NOAA's exact HTTP **200** body when predictions are unavailable (recorded for station 9999999; the 2026 outage returned it for every station) |
| `ndbc/44097.{txt,spec,data_spec,swdir,swdir2,swr1,swr2}` | `www.ndbc.noaa.gov/data/realtime2/44097.*`, captured 14:17 UTC, trimmed to the header line(s) plus the newest 30 rows. Newest stdmet row is 14:00 UTC; data_spec has 98 bands (0.025–0.96 Hz) |
| `ndbc/44097-20260923T1900Z.data_spec` | One `44097.data_spec` row (2026-09-23 19:00 UTC, captured 2026-10-01 15:16 UTC with the header line): the event where NDBC's SwH said 0.6 m but the 8 s+ band held 2.0 m. `.spec` for that row: WVHT 3.1 m, SwH 0.6 m @ 10.0 s, WWH 3.1 m @ 8.7 s ESE |
| `pipeline/buoy.json`, `pipeline/verification.json` | Snapshots of the bot-owned `data/` files at commit b528f75 (fetch 13:15 UTC, obs 12:30 UTC). The harnesses serve these for `data/buoy.json` / `data/verification.json`, because the live files change every 2 h |
| `firebase-stub.js` | Hand-written Firebase compat stub (not a recording). Its knobs are documented in the file header |

Requests the harnesses answer without a file:

- Open-Meteo, CO-OPS and NDBC requests for any other lat/lon/station get the
  Chocomount recording.
- The three NDBC CORS proxies are emulated as recorded: corsproxy.io 403
  `keyless_legacy_url`, allorigins 522 after ~20 s, codetabs 503.

## Re-recording

From a web session, outbound HTTPS works through the session proxy, so
`curl -sS '<url>' > tests/fixtures/<file>` with the URLs above refreshes a
file. To print the exact URLs the current code builds, call the fetchers
through `loadApp({ fetch: fixtureFetch() })` and read `app.fetchLog`. Trim the
NDBC files with `head -n 32` for `.txt`/`.spec` (two header lines) and
`head -n 31` for the others. Keep the whole directory under 1.5 MB (a unit
test enforces this).
