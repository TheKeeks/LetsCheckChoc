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

- Unit and Python tests need **no npm install**. `test:rules` needs
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
| `index.html` | The single page. Loads Google Fonts (non-blocking), Leaflet 1.9.4 (vendored in `vendor/leaflet/`) and the Firebase 9.23.0 compat SDK (gstatic), then `firebase-config.js`, `app.js`, `kiosk.js` in that order |
| `app.js` | About 8.8k-line global-scope monolith with all forecast, chart, surf-log and regression logic |
| `kiosk.js` | Choc TV. A no-op unless `?kiosk=1`. Wraps some app.js globals at load time |
| `firebase-config.js` | Firebase init and auth. Globals: `fbAuth`, `fbFirestore`, `fbStorage`, `window._fbUserId`, `window._fbAuthReady` |
| `style.css`, `styles-web1.css`, `styles-web1-extensions.css`, `styles-retro.css`, `styles-kiosk.css` | All five load on every page, in that order |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json` | Repo copies only (see Invariants) |
| `data/buoy.json`, `data/verification.json` | Written by the pipeline bot. Never edit them |
| `data/buoys-east-coast.json`, `data/tide-stations.json` | Static catalogs read by `initApp` |
| `scripts/fetch_buoy.py` | Pipeline: NDBC 44097 → `data/buoy.json`, plus model-vs-buoy rows |
| `scripts/canary.py` | Upstream canary (`.github/workflows/canary.yml`, every 6 h): opens/closes one `data-canary` issue |
| `scripts/smoke_regression.js`, `scripts/leak_deg_sensitivity.js`, `scripts/generate_icons.js`, `scripts/bracelet_plans.js` | Dev-only tools, never loaded by the page |
| `test-gate.js` | Legacy tests, still run by `npm test` |
| `tests/` | `tests/helpers/` (vm loader, DOM stub, fixture map), `tests/unit/`, `tests/e2e/`, `tests/fixtures/` |
| `project/` | React prototype. `project/assets/lineup.jpg` is used by the live page |
| `research/` | Sound Check tab (was "Swell Map"): a self-contained research page (`research/index.html` plus its tiles, ray tables and forecast snapshot `research/fc/`), framed by `#view-research` and loaded on first open. Built outside this repo; treat as generated |
| `previews/` | Looks layered over the live app by the inline loaders in `index.html`. `previews/clean/` is the DEFAULT look (no parameter); `?classic=1` opens the old look with no look files, `?preview=<name>` picks a candidate look instead (e2e `tests/e2e/scenarios/preview-looks.js`, `tests/e2e/scenarios/look-default.js`). The e2e runner's `ctx.open()` adds `classic=1` to any path that names no look, so the older scenarios test the app underneath. Delete a folder (and its name in the loader) when a look is retired. `previews/clean/` is the approved "A refined" design: `previews/clean/core.js` (shell, data, Settings) plus one js/css pair per screen (forecast, log, model, tv), API in `previews/clean/CONTRACT.md`, e2e `tests/e2e/scenarios/preview-clean.js` plus `preview-clean-{core,forecast,log,tv}.js` |
| `bracelet/` | Fishers Bracelet, a side project not linked from the forecast: a 3D designer for a one-wire gold bracelet that traces the island, closes it at the East End in one end-on joint and ends in a ball clasp on North Hill. `bracelet/index.html` (page), `bracelet/geometry.js` (pure route and shape maths), `bracelet/plans.js` (the jeweller's 1:1 flat drawing, Spanish how-to, SVG and PDF), `bracelet/jeweler.html` (plans page), `bracelet/plans/` (PDF + SVG of the standard design, regenerate with `scripts/bracelet_plans.js`), `bracelet/fishers-outline.js` (OSM coastline), three.js r128 and jsPDF 2.5.1 vendored in `bracelet/vendor/`. Unit `tests/unit/bracelet-geometry.test.js`, `tests/unit/bracelet-plans.test.js`; e2e `tests/e2e/scenarios/bracelet-designer.js` (open `/bracelet/index.html`: the runner's server has no folder index) |

## Module map (grep anchors, not line numbers)

`app.js` is organised by section banners. `grep -n "<anchor>" app.js` lands on
each one. Line numbers drift with every edit, so do not cite them in docs.

| Anchor | Contents |
|---|---|
| `// ── Configuration` | `CONFIG`: spot coords, swell window, API URLs, NDBC proxy list |
| `// ── State` | `STATE`, the single mutable app state |
| `// ── Daylight calculator (solar position)` | `calcDaylight` |
| `// ── Gate logic` | `initGate`, the boat gate (`sessionStorage lcc-gate`) |
| `// ── Data fetching helpers` | `fetchJSON` (10 s abort) |
| `// ── Forecast cache (TTL-backed localStorage)` | `readCache` / `writeCache`, `lcc-cache-*` keys |
| `// ── API: Open-Meteo Marine` | `FORECAST_MODELS`, `fetchMarineForecast` |
| `// ── API: CO-OPS tides` | hi/lo and 6-min predictions, water temp |
| `// ── API: NDBC via CORS proxy` | `fetchNDBCStdmet`, `fetchNDBCSpectral` |
| `// ── API: Pipeline fallback for Chocomount` | `fetchPipelineBuoy` (`data/buoy.json`) |
| `// ── Parse NDBC stdmet text` | `parseNDBCStdmet`, plus the spectral parsers below it |
| `// ── Load concurrency guard` | `loadAllData` / `_loadAllDataImpl`: the whole forecast load path |
| `// ── Per-panel drawers` | forecast chart panels (`_drawForecastChartFull`, scrubber) |
| `// TIDE CHART (Canvas 2D)` | Tides panel chart |
| `// SPECTRAL SUMMARY TABLE` | `.spec` strip, `parseSpecRows`, trends |
| `// COMPASS ROSE (Canvas 2D)` | Directional spectrum rose |
| `// SURF LOG — Storage` | `loadSurfLog`, `addLogEntry`, local mirror `lcc_surfLog` |
| `// SURF LOG — Firebase persistence helpers` | `saveLogEntryToFirebase`, `loadLogsFromFirebase` |
| `// SURF LOG — Historical Condition Lookup` | `lookupHistoricalConditions`, `parseTideAtTime` (training inputs) |
| `// SURF LOG — Linear Regression (Normal Equation)` | features, `normalEquation`, `slRetrain` |
| `// SURF LOG — Forecast Matching` | match lights on the forecast chart |
| `// SECONDARY SWELL CARD (Tab 1)` | `updateSecondarySwellCard` |
| `// REGRESSION TAB (Tab 2)` | Tab 2 renderers (`window[name]` dispatch in `_regUpdateSubmodelSurfaces`) |
| `// MODEL vs BUOY — nowcast verification (Tab 2)` | `verifStats`, `drawVerifChart` |
| `// INITIALIZATION` | `initApp` (catalogs, maps, surf log, auto-select Choc) |
| `// DAY SUMMARIES` | kiosk.js: `kioskDaySummary` (cards from incoming-tide windows) |
| `// NIGHT RADAR` | kiosk.js: radar scope and hourly playback |

## Data flow

- **Browser (every load):** `initGate` → `initApp` → `selectBuoy` → `loadAllData`
  (the default clean look skips the boat question and drives the same path).
  It paints from `lcc-cache-*` first (stale-while-revalidate), then fetches
  Open-Meteo marine (Choc forecast point 41.089152, -71.72105), Open-Meteo wind
  (beach point), CO-OPS 8510719 hi/lo (240 h) and 6-min (168 h), and CO-OPS
  8510560 water temp. Chocomount's buoy and spectra come from `data/buoy.json`.
  `CONFIG.api.ndbcProxies` is empty because the free relays are dead, so other
  buoys show "no live data". A failed fetch falls back to the last good saved
  copy (forecast up to 24 h old, tides up to 4 days). `STATE.dataAsOf` and
  `STATE.dataHealth` record the real age of the data, and kiosk.js reads them.
- **Pipeline:** `.github/workflows/update-buoy.yml` runs every 2 h (GitHub drops
  many runs). `scripts/fetch_buoy.py` writes `data/buoy.json` and appends to
  `data/verification.json`, and the bot commits both straight to `main`. If
  every NDBC file fails it exits 1 and writes nothing; a partial failure keeps
  the previous sections and lists them in `stale_sections`. Verification rows
  are hourly and back-fill the hours of dropped runs.
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
  README. Tests serve `data/buoy.json` from `tests/fixtures/pipeline/`, never
  the bot-updated file.
- **Python (`scripts/test_*.py`).** `load_fetch_buoy()` in `scripts/test_fetch_buoy.py`
  imports the pipeline with the network blocked and outputs in a temp dir.
- Every fix gets a test that fails before the change and passes after it.

## Invariants (do not break)

- Swell window is **115–158°** (`CONFIG.chocomount.swellWindowMin/Max`), centred
  near 136.5°. The reef faces 335°. The domain spec is `CHOCOMOUNT_KNOWLEDGE.md`:
  read it before touching forecast or model logic.
- Times are **America/New_York**. Fixtures, tests and the crew are all on
  Eastern time. Never assume the viewer's timezone is UTC.
- `data/*.json` belongs to the bot. Never hand-edit or commit changes to it.
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
