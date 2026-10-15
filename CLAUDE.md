# CLAUDE.md — working on LetsCheckChoc

LetsCheckChoc is a static surf-forecast site for one spot: Chocomount Beach,
Fishers Island NY. It has no build step. GitHub Pages serves `main` as-is
(`index.html` + classic scripts + CSS). The owner builds it for themself and a
small crew. Choc TV (`?kiosk=1`) runs full-screen on an iPad at the house.

## How the owner works (read this first)

- The owner works **only from an iPad, through Claude Code on the web**. They
  have no local checkout, no DevTools and no terminal. "It works on my machine"
  means nothing here. A change counts as verified when it is covered by tests
  that run in GitHub Actions (`.github/workflows/ci.yml`) and in a web session.
- Nothing merges without the owner. Prepare a branch or PR with a clear summary,
  screenshots (the e2e runner saves them under `tests/e2e/artifacts/`, and CI
  uploads them) and a CHANGELOG entry.
- Explain behaviour in surf terms (swell window, tide, lows), not framework jargon.

## Commands

```sh
npm test              # node:test unit suite (tests/unit, TZ=America/New_York) + legacy test-gate.js
npm run test:e2e      # Playwright scenarios (tests/e2e/scenarios), fully offline
npm run test:py       # python unittest for scripts/ (fetch_buoy.py)
npm run test:rules    # Firestore/Storage rules in the Firebase emulators (tests/rules, needs Java 21)
node tests/e2e/run.js kiosk   # run only scenarios whose file/name matches
```

- Unit and Python tests need **no npm install** (`scripts/test_fcpull.py` also
  needs numpy, Pillow and eccodes, `scripts/test_raycore.py` numpy, `scripts/test_history.py` numpy and scipy, else they skip). `test:rules` needs
  `npm i --no-save firebase-tools@15.32.1 @firebase/rules-unit-testing@5.0.2 firebase@12.19.0`
  first (CI: `.github/workflows/rules.yml`).
- e2e needs Playwright 1.56.x. A web session has it globally, with Chromium in
  `/opt/pw-browsers` (the runner sets `PLAYWRIGHT_BROWSERS_PATH` to it). Never
  run `playwright install` in a web session. CI runs
  `npm i --no-save playwright@1.56.1 && npx playwright install --with-deps chromium`.
- The e2e runner routes **every** external host to fixtures or emulations: live
  proxies and NDBC are unreachable from a browser, and headless Chromium rejects
  CDN certificates in web sessions. `E2E_ALLORIGINS_DELAY_MS` sets the dead
  allorigins proxy's 522 delay (default 2000; production is about 20000).

## Files

| Path | What |
|---|---|
| `index.html` | The single page: the app's hidden engine room (`#app-window`: the surf-log form Log drives, the Tab 2 panels My ratings borrows), the "didn't start" card (`lccDown`), then the Firebase 9.23.0 compat SDK (gstatic), `firebase-config.js`, `app.js`, `kiosk.js` (keep that file name: Choc TV's reload probe looks for it) and the look (`previews/clean/theme.js`) |
| `app.js` | About 4.9k-line global-scope script: forecast, tides and buoy data with their saved copies and ages, the surf log, the ratings models and the Tab 2 panels. Draws no screens; the look hooks `renderForecastSet`, `recordDataHealth`, `updateAuthUI`, `surfLogChanged`, `slRetrain` by name |
| `kiosk.js` | Choc TV's machinery under `previews/clean/tv.js`: rotation, 15-min refresh, deploy pickup, nightly and watchdog reloads, the down-card retry, `kioskDaySummary`. A no-op unless `?kiosk=1` |
| `firebase-config.js` | Firebase init and auth. Globals: `fbAuth`, `fbFirestore`, `fbStorage`, `window._fbUserId`, `window._fbAuthReady` |
| `style.css` | The tokens, toasts and Tab 2 panel styles My ratings borrows; the look's own are `previews/clean/*.css` |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json` | Repo copies only (see Invariants) |
| `data/buoy.json`, `data/verification.json` | Written by the pipeline bot. Never edit them |
| `scripts/history/` | Sound Check history bot (`.github/workflows/update-history.yml`, daily): CDIP 44097 spectra, NDBC readings, ERA5/ECMWF wind, CO-OPS tides → `data/history/*.json`, `research/hist.js` (via `scripts/sound-check/page/build_hist.py`) and the `44097` lane of `research/ocean/day/<year>.json`; rebuilds since 2016 each run; it also fits the ratings model, `data/history/sess_pairs.json`, `data/history/sessions_all.json` and the forecast scorecard `research/fc/score.json` to the crew's surf log, read from Firestore with the read-only service-account key in the `SURFLOG_READ_KEY` secret (`scripts/history/surflog.py`, `scripts/history/ratings.py`; no notes or names in what it writes; without the key they stay as committed); how-to in `scripts/history/README.md`, tests `scripts/test_history.py` |
| `data/buoys-east-coast.json`, `data/tide-stations.json` | Static catalogs read by `initApp` |
| `scripts/fetch_buoy.py` | Pipeline: NDBC 44097 → `data/buoy.json`, plus model-vs-buoy rows |
| `scripts/canary.py` | Upstream canary (`.github/workflows/canary.yml`, every 6 h): opens/closes one `data-canary` issue |
| `scripts/rays/raycore.py`, `scripts/rays/build_tables.py` | Sound Check's wave-ray physics (exact wave speed, Snell's-law ray step) and the builder of Choc's and Wilderness's ray tables (its 812 MB survey grid stays outside the repo); tested by `scripts/test_raycore.py` |
| `scripts/forecast/fcpull.py` | Sound Check forecast pull: GFS-Wave + ECMWF → `research/fc/fc.json` + field PNGs (and GFS sea-level pressure, `field_gfs_mslp.png`, for Forecast's Storms view; `--pressure DIR` adds it to a pull), tied to the spots with `research/fr/` and `scripts/forecast/{world,fwdk}.json` |
| `scripts/smoke_regression.js`, `scripts/leak_deg_sensitivity.js`, `scripts/generate_icons.js`, `scripts/bracelet_plans.js` | Dev-only tools, never loaded by the page |
| `test-gate.js` | Legacy tests, still run by `npm test` |
| `tests/` | `tests/helpers/` (vm loader, DOM stub, fixture map), `tests/unit/`, `tests/e2e/`, `tests/fixtures/` |
| `project/` | React prototype (not loaded by the site) |
| `research/` | Sound Check tab (was "Swell Map"): a self-contained research page (`research/index.html` plus its tiles, ray tables and the forecast copy that ships with it, `research/fc/`; the page shows the newer of that and the `fc-data` branch), framed by the Methods and Explore tabs and loaded on first open; opened on its own it sends the visitor to the site (`research/methods-theme.js`). `research/map.html` is the same map alone (its code without the history or the charts): the Forecast tab's map (`?view=map&fill=1&ui=forecast`). Generated: edit its parts in `scripts/sound-check/page/` and rebuild (`scripts/sound-check/README.md`); its history, `research/hist.js`, is the history bot's |
| `previews/` | The look layered over the live app by the inline loaders in `index.html`: `previews/clean/`, the site's only look (no parameter; `?preview=clean` names it; the candidate looks are retired and their names open it too). The old look and its code are gone (e2e `tests/e2e/scenarios/look-default.js`); a look that fails to start shows `index.html`'s card, and Choc TV retries by itself. `previews/clean/` is the approved "A refined" design: `previews/clean/core.js` (shell, data, Settings) plus one js/css pair per screen (forecast, map = Explore, methods, log, model = My ratings, tv), API in `previews/clean/CONTRACT.md`, e2e `tests/e2e/scenarios/preview-clean.js` plus `preview-clean-{core,forecast,forecast-fallback,forecast-storms,explore,log,tv}.js`. Forecast and Choc TV show the Sound Check model (`research/fc/`, loaded once per page by core's `CLEAN.model`); the Forecast tab's map is `research/map.html` in a frame (`ui=forecast`, driven by the tab's hour, spot and zoom): Ocean shows the storms (the engine's "Pressure & storms" layer: `field_gfs_mslp.png`), Fishers the landing rays (`research/fr/land.json` from `scripts/rays/land_rays.py`). The Forecast tab's header ↻ (`CLEAN.refresh`) asks for the newest run past GitHub's cache (the map too, message `lcc-fc-refresh`) and reloads the wind, tides and buoy; e2e `tests/e2e/scenarios/preview-clean-forecast-refresh.js`. Explore and Methods post `lcc-log` to their frames when a session is saved, edited or deleted (`CLEAN.logRev()` changed), and the research page's ten years read the log again through the site's Firebase connection; e2e `tests/e2e/scenarios/preview-clean-log-follows.js` |
| `map/` | Map page, the Explore tab: one map. It opens on the Sound Check map's past days (`research/index.html?view=map&fill=1&ui=explore`: the ten years month by month beside the map, Drop a wave; no forecast, that's the Forecast tab's); its "3D" button (added by `research/methods-theme.js`, message `lcc-open-3d`) opens the sea floor in 3D, "← Map" goes back; `?show=3d` starts in 3D. MapLibre GL 5.24.0 vendored in `vendor/maplibre/` with one local patch (`vendor/maplibre/PATCHES.md`), loaded with `map/map.js` (the 3D map) the first time 3D is opened. `map/page.js` (page, `window.ChocMap` test API, postMessage `lcc-map` from the parent, and `lcc-log`, the surf log changed, passed on to the research page), `map/bathy-worker.js` (draws sea-floor color and terrain tiles for the `lccbathy://` protocol from the separate repo `TheKeeks/LetsCheckChoc-data`, which GitHub Pages serves at `/LetsCheckChoc-data/` next to the site (e2e and CI read a checkout in `map-data/`, git-ignored; `E2E_MAP_DATA` points elsewhere): the Fishers Island viewer's 4 m overview and 0.8 m detail chunks, int16 cm row deltas, gzip; plus `research/ocean/fine16` and `research/depth144`), `map/height-worker.js` (the Sound Check K model, ported from `research/index.html`), `map/swell-worker.js` (wave-ray tracing for swell motion), `map/geometry.js` (pure maths, unit `tests/unit/map-geometry.test.js`). e2e `tests/e2e/scenarios/map-one-map.js`, `tests/e2e/scenarios/map-terrain.js` and `tests/e2e/scenarios/preview-clean-explore.js`. `research/ocean/fine16.png` stores DEPTH (positive down), not height |
| `bracelet/` | Fishers Bracelet, a side project not linked from the forecast: a 3D designer for a one-wire gold bracelet that traces the island, closes it at the East End in one end-on joint and ends in a ball clasp on North Hill. `bracelet/index.html` (page), `bracelet/geometry.js` (pure route and shape maths), `bracelet/plans.js` (the jeweller's 1:1 flat drawing, Spanish how-to, SVG and PDF), `bracelet/jeweler.html` (plans page), `bracelet/plans/` (PDF + SVG of the standard design, regenerate with `scripts/bracelet_plans.js`), `bracelet/fishers-outline.js` (OSM coastline), three.js r128 and jsPDF 2.5.1 vendored in `bracelet/vendor/`. Unit `tests/unit/bracelet-geometry.test.js`, `tests/unit/bracelet-plans.test.js`; e2e `tests/e2e/scenarios/bracelet-designer.js` (open `/bracelet/index.html`: the runner's server has no folder index) |

## Module map (grep anchors, not line numbers)

`app.js` is organised by section banners. `grep -n "<anchor>" app.js` lands on
each one. Line numbers drift with every edit, so do not cite them in docs.

| Anchor | Contents |
|---|---|
| `// ── Configuration` | `CONFIG`: spot coords, swell window, API URLs, NDBC proxy list |
| `// ── State` | `STATE`, the single mutable app state |
| `// ── Daylight calculator (solar position)` | `calcDaylight` |
| `// ── Data fetching helpers` | `fetchJSON` (10 s abort) |
| `// ── Forecast cache (TTL-backed localStorage)` | `readCache` / `writeCache`, `lcc-cache-*` keys |
| `// ── API: Open-Meteo Marine` | `FORECAST_MODELS`, `fetchMarineForecast` |
| `// ── API: CO-OPS tides` | hi/lo and 6-min predictions, water temp |
| `// ── API: Pipeline fallback for Chocomount` | `fetchPipelineBuoy` (`data/buoy.json`) |
| `// ── Load concurrency guard` | `loadAllData` / `_loadAllDataImpl`: the whole forecast load path |
| `// DATA LOADING` | `renderForecastSet` (writes `STATE.forecastData`, a hook for the look) |
| `// SURF LOG — Storage` | `loadSurfLog`, `addLogEntry`, local mirror `lcc_surfLog` |
| `// SURF LOG — Firebase persistence helpers` | `saveLogEntryToFirebase`, `loadLogsFromFirebase` |
| `// SURF LOG — Historical Condition Lookup` | `lookupHistoricalConditions`, `parseTideAtTime` (training inputs) |
| `// SURF LOG — Linear Regression (Normal Equation)` | features, `normalEquation`, `slRetrain` |
| `// SURF LOG — Export / Import` | `exportCSV`, `exportJSON`, `importJSON` (Settings › Surf log) |
| `// MY RATINGS' DETAILS` | `renderRegressionTab`, the borrowed Tab 2 panels (`window[name]` dispatch in `_regUpdateSubmodelSurfaces`) |
| `// MODEL vs BUOY — nowcast verification (Tab 2)` | `verifStats`, `drawVerifChart` |
| `// INITIALIZATION` | `initApp` (catalogs, auto-select Choc, surf log), `startApp` on DOMContentLoaded |
| `// DAY SUMMARIES` | kiosk.js: `kioskDaySummary` (the TV's day cards, from incoming-tide windows) |
| `// ── Self-heal and code refresh` | kiosk.js: `KIOSK_CODE_FILES`, reload guards, watchdog, the down-card retry |

## Data flow

- **Browser (every load):** `startApp` → `initApp` → `selectBuoy` → `loadAllData`.
  It paints from `lcc-cache-*` first (stale-while-revalidate), then fetches
  Open-Meteo marine (Choc forecast point 41.089152, -71.72105), Open-Meteo wind
  (beach point), and CO-OPS 8510719 hi/lo (240 h) and 6-min (168 h).
  Chocomount's buoy and spectra come from `data/buoy.json` (`CONFIG.api.ndbcProxies`
  is empty: browsers can't read NDBC). A failed fetch falls back to the last good saved
  copy (forecast up to 24 h old, tides up to 4 days). `STATE.dataAsOf` and
  `STATE.dataHealth` record the real age of the data, and kiosk.js reads them.
- **Pipeline:** `.github/workflows/update-buoy.yml` runs every 2 h (GitHub drops many runs). `scripts/fetch_buoy.py`
  writes `data/buoy.json` and appends to `data/verification.json`, and the bot commits both straight to `main`. If
  every NDBC file fails it exits 1 and writes nothing; a partial failure keeps the previous sections and lists them
  in `stale_sections`. Verification rows are hourly and back-fill the hours of dropped runs.
- **Sound Check history:** `.github/workflows/update-history.yml` runs `scripts/history/update.py` daily: it rebuilds the history since 2016 through yesterday and commits what changed to `main`; it refuses to write a history shorter than the committed one. With the `SURFLOG_READ_KEY` secret it reads the surf log and refits the ratings model (so the good days), the session statistics and the scorecard to it; a read that comes back with fewer than half the sessions keeps the committed model.
- **Sound Check forecast:** `.github/workflows/update-forecast.yml` runs the pull every 3 h and force-pushes it to the `fc-data` branch (latest pull only); `research/`, the Forecast tab and Choc TV show the newer of it and `research/fc/` (Choc TV asks again every 30 min; e2e: `net.fcLive`).
- **Firebase:** anonymous auth by default, Google sign-in optional. Surf logs
  live in Firestore `surf_logs`, photos in Storage `surf-photos/raw/<uid>/…`.
  `loadSurfLog` waits on `window._fbAuthReady`. It runs in the background,
  so the forecast never waits on it.

## Tests

- **Unit (`tests/unit/<prefix>-*.test.js`, node:test).** Use
  `loadApp()` from `tests/helpers/load-app.js`. It runs the real app.js (and
  optionally kiosk.js and firebase-config.js) in a vm sandbox with DOM, storage
  and canvas stubs, a fake clock starting at `FIXTURE_NOW`
  (2026-10-01T11:00-04:00) and an injectable `fetch` (`fixtureFetch()` serves
  `tests/fixtures`). The full API is in the header comment of that file. Reach
  top-level `const`/`let` through `app.get('STATE')` / `app.run('expr')`. Use
  `app.clone(...)` before `assert.deepStrictEqual`, because sandbox objects
  belong to another realm.
- **e2e (`tests/e2e/scenarios/<prefix>-*.js`).** Each scenario exports
  `{ name, options?, run: async ({ page, ctx, assert, log }) }`. The `ctx` API
  (`open`, `waitFor`, `waitForChart`, `net` modes, `serve`, `screenshot`,
  `metric`) is documented at the top of `tests/e2e/run.js`. Uncaught page
  errors fail the scenario.
- **Fixtures (`tests/fixtures/`).** Live recordings, with provenance in its
  README. Tests serve `data/buoy.json` from `tests/fixtures/pipeline/` and `research/hist.js` and
  `research/fc/score.json` from `tests/fixtures/soundcheck/`, never the bot-updated files.
- **Python (`scripts/test_*.py`).** `load_fetch_buoy()` in `scripts/test_fetch_buoy.py`
  imports the pipeline with the network blocked and outputs in a temp dir.
- Every fix gets a test that fails before the change and passes after it.

## Invariants (do not break)

- Swell window is **115–158°** (`CONFIG.chocomount.swellWindowMin/Max`), centred
  near 136.5°. The reef faces 335°. The domain spec is `CHOCOMOUNT_KNOWLEDGE.md`:
  read it before touching forecast or model logic.
- Times are **America/New_York**. Fixtures, tests and the crew are all on
  Eastern time. Never assume the viewer's timezone is UTC.
- `data/*.json`, `data/history/`, `research/hist.js`, `research/fc/score.json` and the `44097` lanes of `research/ocean/day/` belong to the bots. Never hand-edit or commit changes to them; change how they're made in `scripts/history/` instead.
- Classic scripts only: no ES modules, no bundler, no npm runtime deps.
  Functions and top-level `const`/`let` are shared globals across
  `firebase-config.js` → `app.js` → `kiosk.js`. kiosk.js reassigns some app.js
  functions, so keep them `function` declarations.
- `firestore.rules` / `storage.rules` are **pasted into the Firebase console by
  hand**. Nothing deploys the repo copy, so a rules change does nothing until
  the owner pastes it. Say so in the PR. Only an entry's owner may write it:
  never re-save another crew member's entry (`saveLogEntryToFirebase` refuses).
- Tide and wind lookups can fail (CO-OPS answers HTTP 200 with
  `{"error":{"message":"No Predictions data was found..."}}`). Missing data must
  stay null, never 0: a made-up 0 ft tide poisons the training data.

## Conventions

- Match the surrounding code: 2-space indent, section banners, comments that
  say *why*. Keep diffs targeted and avoid drive-by reformatting.
- CHANGELOG.md: one entry per change, newest first, headed
  `## [Unreleased] — <Title>` and followed by plain-prose paragraphs (what was
  wrong, what changed, how it was verified).
- Docs: README.md is user-facing. `CHOCOMOUNT_KNOWLEDGE.md` is the owner's
  domain truth; change it only with the owner's approval. `AUDIT.md`,
  `INVESTIGATION_*.md` and `FORECAST_CARDS_PROGRESS.md` are historical: their
  line numbers and sizes are stale, so re-check against the code.
