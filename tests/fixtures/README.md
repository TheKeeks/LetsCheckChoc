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
| `coops/hilo-240h.json`, `coops/hilo-72h.json` | `api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=20261001&range=240\|72&station=8510719&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&interval=hilo&application=letscheckchoc&format=json` |
| `coops/predictions-6min-168h.json`, `coops/predictions-6min-72h.json` | same, `range=168\|72&interval=6` |
| `coops/water-temp-8510560.json` | `…?date=latest&station=8510560&product=water_temperature&units=english&time_zone=lst_ldt&…` |
| `coops/error-no-predictions.json` | NOAA's exact HTTP **200** body when predictions are unavailable (recorded for station 9999999; the 2026 outage returned it for every station) |
| `ndbc/44097.{txt,spec,data_spec,swdir,swdir2,swr1,swr2}` | `www.ndbc.noaa.gov/data/realtime2/44097.*`, captured 14:17 UTC, trimmed to the header line(s) plus the newest 30 rows. Newest stdmet row is 14:00 UTC; data_spec has 98 bands (0.025–0.96 Hz) |
| `pipeline/buoy.json`, `pipeline/verification.json` | Snapshots of the bot-owned `data/` files at commit b528f75 (fetch 13:15 UTC, obs 12:30 UTC). The harnesses serve these for `data/buoy.json` / `data/verification.json`, because the live files change every 2 h |
| `vendor/leaflet-1.9.4.{js,css}` | `unpkg.com/leaflet@1.9.4/dist/…` (byte-identical, md5 35b48eb9… / c02c12fe…) |
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
