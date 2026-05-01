# LetsCheckChoc — Audit

Read-only fact-finding. Sections 1–3 only. Section 4 (swell forecast deep dive) is reserved for a follow-up prompt and is intentionally not started here.

---

## 1. Routes & files

### 1.1 HTML entry points

| File | Role | Renders |
|---|---|---|
| `index.html` | The only production HTML served by GitHub Pages (`https://thekeeks.github.io/LetsCheckChoc`). | The full app shell: boat-gate overlay (`#gate-overlay`), main app (`#app`) with header + auth bar, tab nav (`#tab-bar`), forecast view (`#view-forecast`) and surf-log view (`#view-surflog`), match-detail modal (`#match-modal`), page footer, toast container. Loads Firebase compat SDKs, Leaflet, `firebase-config.js`, and `app.js`. See `index.html:447-455`. |
| `project/Swell Forecast.html` | A standalone React-prototype page (Babel-in-browser, React 18 from unpkg). Not linked from `index.html`, not deployed by Pages routing. Per `FORECAST_CARDS_PROGRESS.md:3` it is a working prototype for new forecast cards. **Marked stale/prototype** for the production audit; behavior here belongs to a separate scratch surface. |

There is no router; `index.html` is a single-page app and view-switching is done via `display:none/""` toggles in JS (`app.js:3180-3194` `switchTab`).

### 1.2 JavaScript files

Grouped by purpose. Line ranges are for `app.js` only (a single 4738-line monolith). All non-vendored code lives in three files: `app.js`, `firebase-config.js`, `test-gate.js`.

#### UI / DOM rendering / events
| Region | Lines | Notes |
|---|---|---|
| Gate logic | `app.js:411-441` | Boat-question overlay + sessionStorage `lcc-gate`. |
| Buoy map (Leaflet) | `app.js:771-851` | Markers, draggable forecast pin, right-click custom-spot prompt, `localStorage` `lcc-spots`. |
| Tide-station map | `app.js:866-898` | Marker per station + click-to-load. |
| Selection logic | `app.js:904-966` | `selectBuoy`, `selectPin`, `selectTideStation`. |
| Condition cards | `app.js:1240-1385` | swell, wind, water-temp, daylight cards. |
| Tide condition card | `app.js:1391-1441` | "Next high/low" widget. |
| Conditions summary banner | `app.js:1447-1479` | Rating dots + summary text + best-window line. |
| Advanced data toggle | `app.js:1485-1520` | Expand/collapse hourly table. |
| Windy embeds | `app.js:1526-1533` | iframe `src` builders. |
| Tides panel + chart | `app.js:1539-1586`, `2202-2299` | High/low list and Canvas tide curve. |
| Forecast chart (Canvas 2D) | `app.js:1596-2196` | Chart drawing, paging, mouse/touch interaction, nav buttons, arrow draw helper. |
| Spectral panels | `app.js:2315-2796` | Summary table, compass rose, energy spectrum, empty/show-charts helpers, scale toggle. |
| Hourly forecast table | `app.js:2860-2912` | Table populator. |
| Toasts + auth UI | `app.js:2918-2974` | `showToast`, `updateAuthUI`, anonymous→Google migration. |
| Surf log — tab nav | `app.js:3175-3200` | |
| Surf log — photos / sliders | `app.js:3206-3282` | Resize, gallery thumbs, slider descriptions. |
| Surf log — form | `app.js:3704-3894` | Init, reset, edit. |
| Surf log — table & filters | `app.js:4003-4103` | Render, incomplete banner, expand row. |
| Personal-match cards + modal | `app.js:4572-4677` | Toggle, render, "I Surfed This" feedback. |
| App initialization | `app.js:4683-4738` | Loads static JSON, wires everything. |

#### Data fetching
| Region | Lines | Notes |
|---|---|---|
| Generic fetch helpers | `app.js:445-525` | `fetchJSON`, `fetchText`, `fetchTextWithProxies`, `fetchWithProxies`. |
| Open-Meteo Marine | `app.js:528-551` | |
| Open-Meteo Weather | `app.js:554-565` | |
| CO-OPS tide predictions / hi-lo / water temp | `app.js:568-623` | |
| NDBC stdmet + spectral via proxy | `app.js:626-641` | |
| NWS wind | `app.js:644-648` | Defined but I did not find a call site for `fetchNWSWind` outside its own block — **uncertain whether it is currently invoked**. |
| Pipeline buoy fallback | `app.js:651-653` | Reads `data/buoy.json`. |
| NDBC historical archive | `app.js:3315-3357` | Year cache + `view_text_file.php` proxy chain. |
| Surf-log historical lookup pipeline | `app.js:3396-3665` | Chocomount-only NDBC vs Open-Meteo branching. |
| Firebase persistence | `app.js:3065-3169`, `firebase-config.js:34-129` | Save/load Firestore docs, Storage uploads, anon→Google migration. |

#### Parsing
| Region | Lines |
|---|---|
| NDBC stdmet text → object | `app.js:656-688` |
| NDBC spectral file (`data_spec`/`swdir`/etc.) | `app.js:695-736` |
| NDBC `.spec` text columns | `app.js:2315-2342` |
| NDBC historical text rows | `app.js:3328-3357` |

#### Model / scoring
| Region | Lines |
|---|---|
| Surf rating (1-5 heuristic) | `app.js:157-200` |
| Conditions natural-language summary | `app.js:203-249` |
| Best-window predictor | `app.js:252-312` |
| Feature extractors (wave / ride / cond) | `app.js:4145-4221` |
| Linear-model training (normal equation, LOO RMSE) | `app.js:4223-4347` |
| Retrain pipeline + sanity logging | `app.js:4308-4448` |
| Match scoring + predictions | `app.js:4488-4517` |
| Forecast→conditions vector + per-day best match | `app.js:4519-4570` |
| Weights panel render | `app.js:4449-4482` |

#### Utilities
| Region | Lines |
|---|---|
| Math/geo (`degToRad`, `haversine`, `directionLabel/Arrow`) | `app.js:99-123` |
| Color/class helpers (temp, swell-direction) | `app.js:125-152` |
| Formatters (`formatTime`, `formatDay*`, `el`, `setFooter`) | `app.js:314-336` |
| Daylight / sun calc | `app.js:339-391` |
| Swell arrival estimator | `app.js:394-407` |
| Find nearest buoy / tide station | `app.js:739-765` |
| Date/angle helpers (`fmtDate`, `angularDist`) | `app.js:3489-3491` |

#### Tests
| File | Notes |
|---|---|
| `test-gate.js` | Node-only test harness using `vm`/`fs`. Tests gate handlers, parsers, proxy config shape. **Note:** at `test-gate.js:74-77` it asserts `prefix:` appears at least twice in `CONFIG.api.ndbcProxies`, but `app.js:41-45` defines proxies with `wrap:` (no `prefix` key). I did not run the test to confirm, but the assertion looks **stale relative to `app.js`**. |

#### Vendored libs (loaded via CDN, not in repo)
- `firebase-app-compat.js@9.23.0`, `firebase-auth-compat.js@9.23.0`, `firebase-firestore-compat.js@9.23.0`, `firebase-storage-compat.js@9.23.0` — `index.html:448-451`.
- `leaflet@1.9.4` JS + CSS — `index.html:9, 452`.
- Google Fonts: Libre Baskerville, DM Mono — `index.html:8`.
- `project/Swell Forecast.html` additionally pulls React 18 + `@babel/standalone` from unpkg (prototype only).

### 1.3 CSS / styling

| File | Notes |
|---|---|
| `style.css` (2014 lines) | Single global stylesheet. Sectioned by comment banners covering: design tokens, gate, header, panels, widget help, maps, condition row, charts, forecast nav, spectral rose, hourly table, tide list, page footer, Leaflet markers, loading shimmer, conditions summary, advanced toggle, spectral table/empty state, responsive (`/* ── Responsive ── */`), surf-log tab bar / form / entries / weights / personal match cards, modal, surf-log responsive, auth bar, toasts, surf-log sign-in prompt. Section banners visible at `style.css:1-46, 999-1035, 1337, 1477, 1506, 1571, 1645, 1817, 1881, 1922, 1967`. |
| Inline `<style>` in `project/Swell Forecast.html` | Self-contained styling for the prototype page. |

### 1.4 Data / asset files

| File | Purpose | Stale? |
|---|---|---|
| `data/buoys-east-coast.json` | Static buoy list (29 entries, `data/buoys-east-coast.json:1-30`). Loaded by `initApp` via `app.js:4686`. | Live. |
| `data/tide-stations.json` | Static CO-OPS station list (48 entries). Loaded by `initApp` via `app.js:4687`. | Live. |
| `data/buoy.json` | Auto-regenerated NDBC fallback for buoy 44097, written by the pipeline. Read at `app.js:651-653` (`fetchPipelineBuoy`). | Live; updated every 2 hours by GitHub Actions. |
| `project/assets/lineup.jpg` | 318 KB lineup photo. Referenced only by `project/Swell Forecast.html:1728` (`src="assets/lineup.jpg"`). | **Orphaned w.r.t. production** (`index.html` does not reference it). Used only by the prototype page. |
| `firestore.rules` | Documentation of Firestore rules to paste into the Firebase console — `firestore.rules:2`. Not auto-deployed from this repo (no `firebase.json`/CI). | Live but manual. |
| `firestore.indexes.json` | Same — manual paste, two composite indexes on `surf_logs`. | Live but manual. |
| `storage.rules` | Same — Cloud Storage rules for `surf-photos/raw/{userId}/{year}/{month}/{filename}` and `gallery/`. | Live but manual. |

### 1.5 Build / CI / scripts

| File | Purpose | Stale? |
|---|---|---|
| `.github/workflows/update-buoy.yml` | Cron `15 */2 * * *` plus manual dispatch; runs `scripts/fetch_buoy.py`, commits `data/buoy.json` if changed. | Live. |
| `scripts/fetch_buoy.py` | NDBC fetch + parse for buoy 44097 (`stdmet`, `.spec`, and 5 spectral files). Writes `data/buoy.json`. | Live. |
| `scripts/spot_check_2023.py` | One-off comparison script against 2023-09-10 data — `scripts/spot_check_2023.py:5-7`. Not referenced by the workflow or app. | **Orphaned** developer scratch. |

### 1.6 Documentation

| File | Notes |
|---|---|
| `README.md` | Setup + file-structure reference. Mentions the now-deleted `scripts/fetch_forecast.py` and `data/forecast.json` (`README.md:46-50`). |
| `FORECAST_CARDS_PROGRESS.md` | Working log for the React prototype in `project/Swell Forecast.html`. |

### 1.7 Other observations on file currency

- `app.js:475-484` `fetchTextWithProxies` reads `proxy.encode` and `proxy.prefix`, but the actual proxy entries at `app.js:41-45` only have `name` and `wrap`. **I did not exercise this path at runtime; flagging as a likely stale code path** (the working proxy chain is `fetchWithProxies` at `app.js:491-525`, which uses `proxy.wrap`).
- `test-gate.js:74-77` expects `prefix:` in `CONFIG.api.ndbcProxies` — same mismatch (see §1.2 Tests).

---

## 2. Existing UI surfaces

One row per user-visible feature. "Location" gives the DOM anchor in `index.html` and the JS that drives it.

| # | Feature | Location (HTML / JS) | What the user sees | Inputs | Outputs / side effects |
|---|---|---|---|---|---|
| 1 | "Are you coming by boat?" gate | `index.html:14-26`, `app.js:411-441` | Full-screen overlay with anchor icon and Yes / No buttons. Clicking **Yes** swaps in a "Go Home" message that auto-clears after 2s; **No** dismisses the overlay and reveals the app. | Click on `#gate-yes` / `#gate-no`; previously stored `sessionStorage['lcc-gate']`. | Sets `STATE.boatGatePassed`, hides overlay, calls `initApp()`, persists `'no'` to sessionStorage. |
| 2 | Header / location label | `index.html:30-43`, set by `app.js:918, 934, 1156` | Site title, current selection (`Choc · 44097 …` or `lat°N, lon°W`), last-updated time, auth bar. | Buoy or pin selection. | Updates `#header-location`, `#header-update-time`. |
| 3 | Google sign-in / sign-out UI | `index.html:37-41`, `app.js:2931-2950, 4712-4724`, `firebase-config.js:86-129` | "Sign in with Google" button or current user name + "Sign out". | Click. Auth state via `firebase.auth.onAuthStateChanged`. | Popup OAuth, anonymous→Google account linking, post-link `migrateAnonDataToUser()` (`app.js:2952-2974`). |
| 4 | Tab bar (Forecast / My Surf Log) | `index.html:46-49`, `app.js:3175-3200` | Two tab buttons; only visible when Chocomount is selected (`updateTabBarVisibility`, `app.js:3196-3200`). | Click. | Toggles `#view-forecast` ↔ `#view-surflog`; triggers surf-log table + weights re-render. |
| 5 | Buoy selector map (Leaflet) | `index.html:55-57` `#buoy-map`, `app.js:771-851` | OSM/Carto tiles, blue dots for each NDBC buoy, a star marker at the Chocomount forecast point (only if gate passed), a draggable 📍 pin, optional 📌 user-saved spots. | Click marker / drag pin / right-click for custom spot. | `selectBuoy()` / `selectPin()` triggers full data load (`loadAllData` / `loadPinData`). Right-click prompts for a name and persists to `localStorage['lcc-spots']`. |
| 6 | Conditions summary banner | `index.html:60-64`, `app.js:1447-1479` | Rating dots (1-5), short natural-language description, "Best window:" line. | Marine + wind + tide hi/lo arrays. | DOM-only render of `#summary-rating/#summary-text/#summary-best`. |
| 7 | Current-conditions cards (5) | `index.html:67-99`, `app.js:1240-1385` | Cards for **Swell**, **Wind**, **Tide**, **Water Temp**, **Daylight**, each with value + sub-detail + footer source. | Buoy parsed data, marine current, wind current, tide hi/lo, CO-OPS water temp. | Updates each `#val-…/#footer-…`. Tide and swell cards apply `quality-good/fair/poor` class accents. |
| 8 | Wind map (Windy embed) | `index.html:102-108` `#windy-wind`, `app.js:1526-1533` | iframe with Windy ECMWF wind overlay at the selected lat/lon, zoom 8. | `lat`/`lon` from current selection. | Rewrites iframe `src`. |
| 9 | Waves map (Windy embed) | `index.html:111-117` `#windy-swell`, `app.js:1530` | iframe with Windy ECMWF waves overlay, zoom 6. | `lat`/`lon`. | Rewrites iframe `src`. |
| 10 | Swell forecast chart (Canvas) | `index.html:120-142` `#forecast-canvas`, `app.js:1596-2196` | Multi-day swell-height area + line chart with nighttime shading, day separators, low-tide drop-lines, swell + wind direction arrows at 6 am, x-axis day & low-tide labels, y-axis ft labels, plus prev/next nav buttons (`#forecast-prev/next`) and a label band (`#forecast-nav-label`) showing the visible 3-day window. Hovering or tapping reveals a detail bar (`#forecast-detail-bar`). | Marine + wind hourly arrays, daylight, tide hi/lo, mouse/touch events. | Draws to canvas; updates `#forecast-detail-bar`; `setFooter('footer-forecast', …)` (`app.js:1055-1059`). |
| 11 | Personal Matches toggle + cards | `index.html:145-153`, `app.js:4572-4615` | Hidden unless `STATE.isChocomount` AND surf log has entries. Button "Show My Personal Matches" reveals one card per upcoming day with the best forecast→past-session match. | Trained model weights + cached marine/wind/tide. | Renders `#personal-match-cards`; clicking a card opens the match modal. |
| 12 | Tides panel (chart + hi/lo list) | `index.html:156-167`, `app.js:1539-1569`, `app.js:2202-2299` | Canvas curve of predicted water level for ~3 days with a dashed "now" line, plus a row of upcoming H/L chips. | CO-OPS predictions @ 6-min interval and `interval=hilo`. | Draws `#tide-canvas`; populates `#tide-hilo-list`. |
| 13 | Wave-spectra summary table | `index.html:170-183`, `app.js:2360-2415` | Table with rows for Primary Swell, Wind Waves, Significant Hs (height, period, direction). | NDBC `.spec` summary (live or pipeline), buoy stdmet for fallback values. | Populates `#spectral-summary-table`. |
| 14 | Spectral compass rose | `index.html:187-212` `#compass-canvas`, `app.js:2492-2664` | Polar canvas plot of energy by arrival direction colored by period (2-22 s); legend bar with period scale; Linear / √ scale toggle (`#panel-compass .rose-scale-chip`). | Parsed NDBC spectral bins (live via proxy or pipeline fallback) + buoy parsed object. | Draws to canvas; persists scale mode to localStorage (see `STATE.roseScaleMode`, `app.js:94`); footer set in `app.js:1115-1119`. |
| 15 | Wave energy spectrum | `index.html:213-223` `#spectrum-canvas`, `app.js:2669-2796` | Canvas line/area plot of spectral energy density vs. period. | Spectral bins. | Canvas draw + `#footer-spectrum`. |
| 16 | Advanced data toggle | `index.html:227-260`, `app.js:1485-1520` | "▶ Advanced Data" button; expanded section reveals the hourly table. | Click. | Toggles `#advanced-sections.collapsed/expanded`; persists to `localStorage['lcc-advanced']`; redraws spectral canvases. |
| 17 | Hourly forecast table | `index.html:243-258`, `app.js:2860-2912` | 72 rows: Time, Height, Period, Dir, Wind, Gust; with day-separator and night-row classes; Chocomount swell-direction cells get `dir-in/edge/out` color. | Marine + wind hourly arrays. | Populates `#hourly-tbody`; sets `#footer-hourly`. |
| 18 | Tide-station selector map | `index.html:262-268` `#tide-map`, `app.js:866-898, 939-966, 1571-1586` | Smaller Leaflet map with a dot per station; clicking shows next 8 hi/lo predictions for that station in `#tide-map-info`. Nearest station to current selection gets darkened. | Click marker. | Calls `fetchTideHiLo(stationId)`; renders into `#tide-map-info`; mutates marker styles. |
| 19 | Surf-log sign-in prompt | `index.html:276-280`, `app.js:4718-4724`, `app.js:3187-3192` | Inline yellow banner shown when surf-log tab is active and the user is not signed in with Google. | Click "Sign in" or "Continue without signing in". | Triggers `signInWithGoogle()` or hides the banner. |
| 20 | Log-a-Session form | `index.html:283-341`, `app.js:3713-3811` | Date/time input, three 0-10 sliders (Size / Wind quality / Ride quality) with text descriptions, notes textarea, photo URL + file upload + thumbnail gallery, a Conditions display block, and the action buttons. | Manual entry; sliders fire `input` to update labels; file picker resizes via `resizeImageFile` (`app.js:3209-3228`); URL field appends to `_slPhotos`. | Calls `addLogEntry`/`updateLogEntry` (`app.js:3003-3034`) which write to `STATE.surfLog`, `localStorage['lcc_surfLog']`, and Firestore + Storage. |
| 21 | "Lookup Historical Conditions" button | `index.html:336` `#sl-lookup-btn`, `app.js:3613-3665` (general) and `app.js:3396-3483` (NDBC path) | Auto-fills the Conditions block with swell, wind, tide, offshore-score, blown-water index, and source label. Recent dates use Open-Meteo; >5 days old + Chocomount uses NDBC historical archive (`app.js:3619-3622`). | `#sl-datetime` value. | Renders into `#sl-conditions-display` via `renderConditionsDisplay` (`app.js:3667-3691`). |
| 22 | Conditions display panel | `index.html:328-333`, `app.js:3667-3691` | Compact two-row block: swell (with optional secondary), wind, tide, plus offshore score and blown-water index, with a swell-lag note and source line. | Output of the lookup pipeline. | Populates `#sl-conditions-display`. |
| 23 | Save / Cancel-Edit buttons | `index.html:336-339`, `app.js:3713-3894` | Submits the form; "Cancel Edit" appears only while editing an existing entry (`app.js:3833-3894`). | Click. | Persists entry locally + to Firebase. |
| 24 | Learned preference weights panel | `index.html:344-347`, `app.js:4449-4482` | Three subsections (Wave / Ride / Cond), each listing per-feature weight and mean ± stddev, plus an LOO-RMSE status line. Visible only with sufficient training data — exact threshold is gated inside `slRetrain` (`app.js:4308-4347`); **uncertain on the precise minimum-N rule without re-reading.** | Surf-log entries (`STATE.surfLog`). | Populates `#surflog-weights`. |
| 25 | Past-sessions table + filters | `index.html:350-385`, `app.js:4003-4067` | Table of all logged sessions: Date, Photos thumb, Size, Wind, Ride, Avg, Notes, action menu. Filter row above with From/To date pickers and a min-Avg input. | Filter inputs; click on row toggles a detail row (`toggleEntryDetail`, `app.js:4089-4103`). | Re-renders `#surflog-tbody`; surfaces an "incomplete entries" banner via `renderIncompleteBanner` (`app.js:4068-4087`). |
| 26 | Surf-log empty state | `index.html:383-385` `#surflog-empty` | "No sessions logged yet…" message. | None. | Visibility toggled inside `renderSurfLogTable`. |
| 27 | JSON / CSV export + JSON import | `index.html:386-392`, `app.js:3900-3944` | Three buttons: Export JSON, Import JSON (hidden file input), Export CSV. Storage note shows `n entries · ✓ Synced to cloud` or `⚠ Local only`. | Click; for import, JSON file. | Triggers anchor download (`exportJSON`, `exportCSV`); on import, replaces `STATE.surfLog`, retrains, and re-renders. |
| 28 | Match-detail modal | `index.html:398-439` `#match-modal`, `app.js:4620-4677` | Full-screen modal with photo carousel (prev/next + dots), badge, title, conditions summary, ratings, notes, and an "I Surfed This" feedback panel. | Click on a personal-match card or surf-log row trigger that opens the modal; arrow buttons cycle photos. | Updates `#modal-carousel-img/dots`. Saves feedback as a new log entry via `addLogEntry` (`app.js:4665-4676`). |
| 29 | Photo lightbox / carousel | `index.html:401-406`, `app.js:4644-4664` | Image with prev/next buttons and dot indicators inside the modal. | Click prev/next. | Mutates `STATE.matchModalPhotoIdx` and the `<img>` src. |
| 30 | "I Surfed This" feedback flow | `index.html:414-436`, `app.js:4665-4676` | Sliders (Size/Wind/Ride) + notes + "Save Feedback" inside the modal. | Slider inputs + textarea. | Calls `addLogEntry({ … conditions: buildForecastConditions(…) })` then closes the modal. |
| 31 | Toast notifications | `index.html:455` `#toast-container`, `app.js:2918-2929` | Transient toast in bottom corner ("Saved", "⚠ Saved locally — sync failed", etc.). | Programmatic. | DOM-only; auto-removed after ~3.5 s. |
| 32 | Page footer | `index.html:441-444` | Static credits line linking to NDBC, Open-Meteo, CO-OPS, Windy. | None. | Static. |
| 33 | Per-panel "What is this?" disclosures | e.g. `index.html:133-136, 158-161, 172-180, 195-198, 215-217, 239-242` | Native `<details>` glossary blocks beside each chart. | Click to expand. | None. |

Surfaces I do **not** see implemented anywhere despite README/code hints, but flagging only with caveats: there is no separate gallery view (Cloud Storage `gallery/` is referenced only in `storage.rules:9-13` and I did not find code that lists or displays it — uncertain).

---

## 3. External data sources (overview)

Shallow only. The swell-forecast usage of Open-Meteo and NDBC will be re-examined in Section 4 (next prompt).

### 3.1 NDBC (National Data Buoy Center)

| Aspect | Detail |
|---|---|
| Endpoints (live) | `https://www.ndbc.noaa.gov/data/realtime2/{buoyId}.txt` (stdmet), `.spec`, `.data_spec`, `.swdir`, `.swdir2`, `.swr1`, `.swr2`. Built at `app.js:46` (`CONFIG.api.ndbcBase`) and used at `app.js:626-641`. |
| Endpoints (historical) | `https://www.ndbc.noaa.gov/view_text_file.php?filename={buoyId}h{year}.txt.gz&dir=data/historical/stdmet/` — `app.js:3319`. The PHP endpoint serves decompressed text. |
| CORS | None of these are CORS-friendly, so calls go through one of three public proxies in order: `corsproxy.io`, `api.allorigins.win/raw`, `api.codetabs.com/v1/proxy?quest=` — defined at `app.js:41-45`. The chain runs through `fetchWithProxies` (`app.js:491-525`), with a content-type / body-shape guard against proxies returning HTML error pages (`app.js:514`). |
| Response fields consumed (stdmet) | `WVHT, DPD, APD, MWD, WTMP, WSPD, WDIR, GST` — `app.js:668-687`. |
| Response fields consumed (.spec) | `WVHT, SwH, SwP, WWH, WWP, SwD (compass), WWD (compass), APD, MWD` — `app.js:2315-2342`. |
| Spectral bin files | Each parsed as interleaved `value (freq)` pairs; `data_spec` has a leading `sep_freq` scalar (`app.js:695-711`). Bins composed of `freq, period, energy, dir1, dir2, r1, r2` (`app.js:725-733`). |
| Refresh cadence (browser) | On selection / page load only — there is no polling timer in `app.js`. |
| Refresh cadence (pipeline) | Cron `15 */2 * * *` in `.github/workflows/update-buoy.yml`; commits `data/buoy.json` on change. |
| Where stored | Live: in-memory only (`STATE.lastSpectral`, `STATE.lastBuoyParsed`, `STATE.forecastData`). Pipeline: `data/buoy.json` (committed to the repo and shipped via Pages). |
| Latency | Live observations are typically ~30-60 min behind real time (NDBC standard). Historical archive: NDBC archives current year ~weekly; `lookupNDBCHistoricalConditions` (`app.js:3396-3483`) only runs when the session is >5 days old. |
| Auth / keys | None. Public endpoints; proxies are unauthenticated. |

### 3.2 Open-Meteo

| Aspect | Detail |
|---|---|
| Endpoints | `https://marine-api.open-meteo.com/v1/marine`, `https://api.open-meteo.com/v1/forecast`, `https://archive-api.open-meteo.com/v1/archive`. Defined at `app.js:36-38`. |
| Marine params | `latitude, longitude, hourly=[…wave_height, wave_direction, wave_period, swell_wave_*, secondary_swell_*, wind_wave_*, sea_surface_temperature], current=[…], length_unit=imperial, temperature_unit=fahrenheit, timezone=auto, forecast_days=7` — `app.js:528-550`. |
| Weather (wind) params | `hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m`, `current=…same…`, `wind_speed_unit=mph`, `timezone=auto`, `forecast_days=7` — `app.js:554-565`. |
| Archive params (historical wind / marine) | Same vars, but with `start_date`/`end_date` or `past_days=7&forecast_days=1` for the last 5 days — `app.js:3518-3541`. |
| Response fields consumed | `current.{wave_height, wave_period, wave_direction, swell_wave_*, sea_surface_temperature}`, `hourly.{time, swell_wave_height|wave_height, swell_wave_period|wave_period, swell_wave_direction|wave_direction, secondary_swell_*}`, `hourly.{wind_speed_10m, wind_direction_10m, wind_gusts_10m}` — see uses at `app.js:1042-1047, 1657-1663, 2860-2898, 3500-3516, 3633-3641`. **Section 4 will go deeper on which of these actually drive the forecast chart vs. cards.** |
| Refresh cadence | On selection / page load only (no timer). |
| Where stored | In-memory: `STATE._cachedMarine`, `STATE._cachedWind`, `STATE._cachedTideHiLo` (`app.js:1034-1036`); `STATE.forecastData` (`app.js:1598`). Not persisted. |
| Latency | Open-Meteo Marine forecast is hourly, model-derived. Archive endpoint has a documented ~5-day lag, which is precisely the cutoff used to decide between forecast vs. archive at `app.js:3522, 3534`. |
| Auth / keys | None — Open-Meteo is open. |

### 3.3 NOAA CO-OPS (Tides & Currents)

| Aspect | Detail |
|---|---|
| Endpoint | `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` — `app.js:39`. |
| Products consumed | `predictions` with `interval=6` (curve) — `app.js:568-588`; `predictions` with `interval=hilo` (high/low list) — `app.js:590-609`; `water_temperature` with `date=latest` — `app.js:612-622`. |
| Common params | `datum=MLLW, units=english, time_zone=lst_ldt, application=letscheckchoc, format=json`; `range=24×N hours` for predictions; `station={CO-OPS id}`. |
| Response fields consumed | `predictions[].t/v/type` (`H` / `L`); `data[0].v` for water temperature. |
| Stations | Static list at `data/tide-stations.json` (48 stations), plus a Chocomount-specific station id `8510719` and water-temp station `8510560` in `CONFIG.chocomount` (`app.js:25-26`). |
| Refresh cadence | On selection / load. Loaded for the chart, the tide card, the tides panel, and per-click on the tide-station map. |
| Where stored | In-memory only (passed through to `drawTideChart`, `STATE._cachedTideHiLo`). |
| Latency | Predictions are precomputed; effectively instantaneous and not dependent on observations. |
| Auth / keys | None. The `application` query param is a courtesy identifier, not auth. |

### 3.4 Windy

| Aspect | Detail |
|---|---|
| Endpoint | `https://embed.windy.com/embed.html` (iframe, not an API). URL builder at `app.js:1527-1532`. |
| Params | `type=map, location=coordinates, metricWind=mph, metricTemp=°F, zoom=8|6, overlay=wind|waves, product=ecmwf, level=surface, lat, lon`. |
| Response fields consumed | None — pure iframe embed. |
| Refresh cadence | Whenever lat/lon changes. Internal Windy refresh is opaque. |
| Where stored | DOM `<iframe>.src` only. |
| Latency | Driven by ECMWF model; user-visible "current" timestamp is rendered inside Windy's UI. |
| Auth / keys | None used. |

### 3.5 Google (OAuth via Firebase Auth)

| Aspect | Detail |
|---|---|
| Endpoint | `firebase.auth.GoogleAuthProvider` + `signInWithPopup` / `linkWithPopup` — `firebase-config.js:86-119`. Underlying OAuth lives at `accounts.google.com` (handled inside the Firebase SDK). |
| Params | None set explicitly. Default scopes (email, profile). |
| Response fields consumed | `user.uid`, `user.isAnonymous`, `user.displayName`, `user.email` — `firebase-config.js:34-49`. |
| Refresh cadence | Token refresh handled by Firebase SDK. |
| Where stored | IndexedDB / localStorage by Firebase SDK; mirrored to `window._fbUserId`, `window._fbUserIsAnon`, `window._fbDisplayName` (`firebase-config.js:21-23, 38-40`). |
| Auth / keys | The Firebase web API key (used for OAuth bootstrap and Firestore / Storage) is committed at `firebase-config.js:3`: `apiKey: "AIzaSyBWuLMPKGS91HSOzmQALinQl3w5FwkIdIs"`. Per Google's docs this key is identifier-only — security relies on Firestore/Storage rules and the OAuth consent screen — but flagging since the key is in version control. The OAuth client itself is implicit (configured in the Firebase project console; no client_id appears in this repo). |

### 3.6 Firebase (Auth + Firestore + Cloud Storage)

| Aspect | Detail |
|---|---|
| Project | `letscheckchoc` (`firebase-config.js:5`). Bucket `letscheckchoc.firebasestorage.app` (`firebase-config.js:6`). |
| Auth | Anonymous sign-in 2 s after load if no persisted session (`firebase-config.js:76-82`); Google upgrade via `linkWithPopup` (`firebase-config.js:92-103`); sign-out reverts to anonymous (`firebase-config.js:122-129`). |
| Firestore collection | `surf_logs/{docId}`. Documents written at `app.js:3113-3128` with `id, userId, displayName, timestamp, photos[], ratings, notes, conditions, createdAt(serverTimestamp)`, and optionally `repairedAt/repairedFields`. Reads are bounded — `limit(200)` — at `app.js:3150-3153`. |
| Storage path | `surf-photos/raw/{userId}/{YYYY}/{MM}/{ts}_{i}.jpg` — `app.js:3091-3102`. |
| Rules | `firestore.rules`: any authenticated user can read all `surf_logs`; only the owner can create/update/delete. `storage.rules`: any authenticated user can read `surf-photos/...`; only the owner can write, with 10 MB and `image/*` restrictions. `gallery/` is read-by-auth, no client writes. |
| Indexes | Two composite indexes on `surf_logs` (`firestore.indexes.json:1-19`): `(userId asc, createdAt desc)` and `(createdAt desc)`. |
| Refresh cadence | On auth state change (`firebase-config.js:46-52`) and on manual save/delete in the surf-log UI. No subscriptions / `onSnapshot` listeners. |
| Where stored | Firestore (cloud) + mirrored to `STATE.surfLog` and `localStorage['lcc_surfLog']` (`app.js:2996-3001, 3131-3169`). |
| Latency | Network-bound; `addLogEntry` saves locally first, then attempts Firebase, with a "Saved locally — sync failed" toast on failure (`app.js:3014-3017`). |
| Auth / keys | Same Firebase web API key as §3.5; rules + Auth UID gate everything. |

### 3.7 Other / minor

- **NWS** — `https://api.weather.gov/points/{lat},{lon}` followed by `properties.forecastHourly` (`app.js:644-648`). Defined but I did not locate a current call site. **Uncertain whether it is wired in** — flagging for re-check.
- **Leaflet basemap** — `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png` (`app.js:51`), with OSM/Carto attribution. Public, no key.
- **GitHub raw / Pages** — `data/buoy.json`, `data/buoys-east-coast.json`, `data/tide-stations.json` are fetched as same-origin static assets from the deployed site. Updated via Actions for the buoy.json case only.
- **Browser storage used** — `sessionStorage['lcc-gate']`; `localStorage['lcc-spots']`, `['lcc-advanced']`, `['lcc_surfLog']`; plus whatever the Firebase SDK and rose-scale toggle write. Rose-scale persistence is **declared in state** at `app.js:94` but the read/write call sites live inside `initRoseScaleToggle` at `app.js:2827-2855` — flagging that I read the declaration only.

---

*End of sections 1–3.*

---

## 4. Swell forecast pipeline (deep dive)

### 4.1 Provider

A single provider supplies the swell forecast in production: **Open-Meteo Marine Weather API**. Wind comes from a sibling product, **Open-Meteo Weather (forecast) API**.

Endpoints, declared in `CONFIG.api` at `app.js:36-38`:

```
openMeteoMarine:  https://marine-api.open-meteo.com/v1/marine
openMeteoWeather: https://api.open-meteo.com/v1/forecast
openMeteoArchive: https://archive-api.open-meteo.com/v1/archive   // historical only, surf-log scoring
```

NDBC buoy text and the local `data/buoy.json` pipeline file supply *current* buoy observations (used to override the swell card's "now" reading); they do NOT supply the forecast curves on the chart or hourly table. See `app.js:991-996`. So "swell forecast" = Open-Meteo Marine, full stop.

### 4.2 Marine call — full parameter set

`fetchMarineForecast(lat, lon)` at `app.js:528-551`:

```js
const params = new URLSearchParams({
  latitude: lat,
  longitude: lon,
  hourly: [
    'wave_height','wave_direction','wave_period',
    'swell_wave_height','swell_wave_direction','swell_wave_period','swell_wave_peak_period',
    'wind_wave_height','wind_wave_direction','wind_wave_period',
    'secondary_swell_wave_height','secondary_swell_wave_direction','secondary_swell_wave_period',
    'sea_surface_temperature'
  ].join(','),
  current: [
    'wave_height','wave_direction','wave_period',
    'swell_wave_height','swell_wave_direction','swell_wave_period',
    'wind_wave_height','wind_wave_direction','wind_wave_period',
    'sea_surface_temperature'
  ].join(','),
  length_unit: 'imperial',
  temperature_unit: 'fahrenheit',
  timezone: 'auto',
  forecast_days: 7
});
```

**No `models=` parameter is ever sent on the live forecast call.** That means Open-Meteo's `best_match` default is used. The chart footer still reads `Open-Meteo Marine · gfs Wave 0.16°` (`app.js:1056`, `app.js:1204`) — that string is hard-coded and does NOT reflect a real model selection. Flagging this as a caption/code mismatch.

The historical re-fetch for surf-log scoring (`fetchHistoricalMarine` at `app.js:3530-3541`) hits `marine-api` for ≤5-day-old dates and `archive-api` for older dates, with `wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period`. Same lat/lon as the live Choc forecast. Also no `models=`.

### 4.3 Wind call

`fetchWindForecast(lat, lon)` at `app.js:554-565`:

```js
hourly:           'wind_speed_10m,wind_direction_10m,wind_gusts_10m'
current:          'wind_speed_10m,wind_direction_10m,wind_gusts_10m'
wind_speed_unit:  'mph'
timezone:         'auto'
forecast_days:    7
```

No `models=` here either.

### 4.4 Lat/lon used for the marine query

For the Chocomount buoy (`buoy.home === 'chocomount'`), `loadAllData` substitutes a hard-coded **open-water forecast point** at `app.js:976-982`:

```js
const forecastLat = isChoc ? CONFIG.chocomount.forecastLat : lat;
const forecastLon = isChoc ? CONFIG.chocomount.forecastLon : lon;
```

with values `forecastLat: 41.089152`, `forecastLon: -71.721050` (`app.js:21-22`). These coords are roughly south of Block Island/Fishers Island, deliberately offshore — not the Chocomount Beach landfall (`41.275693, -71.963310` at `app.js:19-20`).

For all other buoys: the marine query uses the **buoy's own `lat`/`lon`** straight from `data/buoys-east-coast.json` (`app.js:976-979` then `app.js:992`).

For a user-dragged pin: marine + wind both fetch at the **pin lat/lon** with no Choc substitution (`loadPinData` at `app.js:1167-1170`).

So: the forecast point is ONE of (a) hard-coded open-water Choc point, (b) the buoy coord, (c) the pin coord. It is never the buoy coord for Choc, and the displayed wind card for Choc actually uses a *third* coord — `displayLat = CONFIG.chocomount.lat` (`app.js:981, 993`), i.e. the land-side beach point — which gives a different wind reading than the marine point. This is intentional per `CHOC_WIND_LAT/LON` at `app.js:12-13` and the comment "Chocomount land GPS for wind history".

### 4.5 Forecast horizon and resolution

- Horizon: **7 days** (`forecast_days: 7` on both calls).
- Temporal resolution: **hourly** (the `hourly=` array). No client-side interpolation — values are read directly per-index via `marine.hourly.time[i]`. The chart paginates 3 days at a time; see `_forecastDayOffset` and `FORECAST_DAYS_VISIBLE = 3` at `app.js:1593-1594`. The hourly table renders the full 168-hour series.
- A `current` block is requested separately and used for the "now" reading on the cards (`app.js:1283-1293`).

### 4.6 Variables consumed → UI surface

| Open-Meteo field | Where it surfaces |
|---|---|
| `wave_height` (total Hs) | Swell card fallback when no buoy data (`app.js:1286, 1289`); hourly table; chart total. |
| `wave_period` | Swell card fallback (`app.js:1287`); hourly table. |
| `wave_direction` | Swell card fallback (`app.js:1288`); hourly table; chart arrows. |
| `swell_wave_height` | **Primary** swell-only height for cards/chart when overriding total (`app.js:1286 ?? wave_height`). Surf-log historical scoring (`app.js:3503` via period). |
| `swell_wave_period` | Same — primary swell period (`app.js:1287, 3503`). |
| `swell_wave_direction` | Primary swell direction (`app.js:1288`). |
| `swell_wave_peak_period` | Requested in hourly only (`app.js:534`). I did **not** find a render site — appears unused on the UI. Flagging as uncertain. |
| `wind_wave_height` / `_direction` / `_period` | Requested but I did **not** locate any UI consumer. The hourly table at `app.js:2860-2912` and chart drawing don't appear to read them. Flagging — possibly fetched-and-unused. |
| `secondary_swell_wave_height` / `_direction` / `_period` | Requested in hourly. **No consumer found in `app.js` for the production view.** Used only in `project/Swell Forecast.html` (the React prototype) at lines 1640-1647 for the secondary-swell arrow on the lineup map. Flagging clearly: production fetches it but does not render it. |
| `sea_surface_temperature` | Water-temp card fallback (`updateWaterTempCard`, `app.js:1330-`) when CO-OPS / buoy unavailable. |
| `wind_speed_10m` | Wind card "now" (`app.js:1304, 1308`); hourly table; chart. |
| `wind_direction_10m` | Wind card direction + arrow (`app.js:1305, 1310-1311`); chart arrows. |
| `wind_gusts_10m` | Wind card "gusts X mph" (`app.js:1306, 1311-1312`). |

### 4.7 Unit handling

All conversions are pushed server-side via Open-Meteo params, so there is essentially no client-side unit math on the forecast path:

- Wave/swell heights: `length_unit: 'imperial'` → API returns **feet**. No m→ft conversion in JS for this path.
- Sea temp / air temp from Marine: `temperature_unit: 'fahrenheit'`.
- Wind speed: `wind_speed_unit: 'mph'`.
- The **one** client-side height conversion is for the `data/buoy.json` pipeline's spectral summary, which is metric: `swellFt = specSwellM * 3.28084` at `app.js:1252-1253`.
- NDBC stdmet text is parsed at `app.js:656+` (not re-read in this audit pass) — its unit handling is out of this section.

No m/s↔kt conversion exists in production (wind comes back in mph already). `SWELL_SPEED_KTS_PER_PERIOD = 1.5` at `app.js:3495` is a group-velocity rule for the Choc buoy-→-shore lag, not a unit conversion.

### 4.8 Secondary swell — current state

Open-Meteo exposes **discrete fields** for secondary swell (`secondary_swell_wave_height/_direction/_period`). The production app **requests them** (`app.js:536`) but does not render them anywhere I could find. They are not derived from a spectrum on the client. The only place they're used is the React prototype at `project/Swell Forecast.html:1640-1647`, which gates the secondary arrow on `sHeight >= 1` and `sHeight >= 0.25 × waveFt`. Marking secondary swell as **fetched but unused in production**.

### 4.9 Caching and refetch triggers

- Client-side caching: results are stored on `STATE._cachedMarine`, `STATE._cachedWind`, `STATE._cachedTideHiLo` (`app.js:1034-1036`) and read back by personal-match rendering. There is **no time-based cache** — every call to `loadAllData` / `loadPinData` re-fetches.
- Refetch triggers: any call to `selectBuoy` (`app.js:925`), `selectPin` (`app.js:936`), or the initial `initApp` auto-select for Choc (`app.js:4730`). Tide-map clicks (`selectTideStation`) do NOT trigger a marine refetch.
- No `Cache-Control`, `ETag`, or service-worker layer on top of `fetchJSON` (`app.js:445-455` — only `AbortController`, no caching).

### 4.10 Model toggle — does one exist?

**No.** Neither the marine call nor the wind call sends a `models=` parameter (`app.js:528-551, 554-565`). There is no UI control bound to model selection — searching `models` / `model=` in `app.js`/`index.html` returns nothing on the forecast path. The "gfs Wave 0.16°" label in the footer is a static string and does not reflect any selection.

### 4.11 Available Open-Meteo Marine models (for a future toggle)

I cannot fetch live docs in this pass, so the following list is **from prior knowledge of Open-Meteo's public Marine API** and may be incomplete or out of date. Treat as a starting point, not a final spec — verify against `https://open-meteo.com/en/docs/marine-weather-api` before wiring a UI:

| `models=` value (best-effort) | Underlying source / notes |
|---|---|
| `best_match` *(default)* | Open-Meteo's blend; what the app currently effectively uses. |
| `gwam` | DWD Global Wave Model (~25 km). |
| `ewam` | DWD European Wave Model (regional, higher res for Europe). |
| `era5_ocean` | ERA5 reanalysis (archive endpoint, historical). |
| `ecmwf_wam025` | ECMWF WAM @ 0.25° (recent additions; availability has changed over time). |
| `meteofrance_wave` | Meteo-France MFWAM. |
| `ncep_gfswave_global` (a.k.a. `gfs_wave025` or similar) | NOAA NCEP GFS-Wave global, ~0.25°. |
| `ncep_gfswave_atlantic` / regional GFS-Wave subdomains | NOAA NCEP GFS-Wave regional nests at ~0.16° / ~0.25° depending on basin. |

Open-Meteo also exposes `cell_selection`, `forecast_hours`, `past_hours`, and per-variable model choice via `wave_height_models=` etc. — none of which the app uses today. **Confirm exact model identifiers and which variables each supports before relying on this list.**

---

## 5. Persisted state (full inventory)

### 5.1 Browser storage

| Store | Key | Schema | Writer | Reader | Notes |
|---|---|---|---|---|---|
| sessionStorage | `lcc-gate` | string `'no'` (only set when user clicks "I'm not on a boat") | `app.js:435` | `app.js:412` | Gates the boat-question overlay; presence = passed gate this session. |
| localStorage | `lcc-spots` | JSON array of `{name:string, lat:number, lon:number}` | `app.js:842-844` (right-click on buoy map) | `app.js:849` (replay on map init) | Custom user pins. |
| localStorage | `lcc-advanced` | string `'open'` \| `'closed'` | `app.js:1505, 1510` | `app.js:1492` | Hourly-table expand/collapse. |
| localStorage | `lcc-rose-scale` | string `'linear'` \| `'sqrt'` | `app.js:2849` | `app.js:2829` | Compass-rose energy scale toggle. |
| localStorage | `lcc_surfLog` | JSON array of surf-log entries (mirror of `STATE.surfLog`) | `app.js:2998` (every save) | `app.js:2990` (Firebase fallback path) | Local mirror; canonical source is Firestore for signed-in users. |
| IndexedDB | (Firebase SDK internal) | Firebase Auth persistence, Firestore offline cache | Firebase compat SDK | Firebase compat SDK | Not directly read by app code. |

I did not find any direct `indexedDB.open(...)` calls in `app.js` or `firebase-config.js`; the only IndexedDB usage is whatever the Firebase SDK does internally.

### 5.2 Firestore collections

| Path | Schema (per doc) | Writer | Reader | Rules |
|---|---|---|---|---|
| `surf_logs/{docId}` (docId = entry id, e.g. `entry.id` from `app.js:3004`) | `{ id, userId, displayName, timestamp, photos: [{url,path}], ratings, notes, conditions, createdAt: serverTimestamp, repairedAt?: serverTimestamp, repairedFields?: [] }` (`app.js:3113-3127`) | `saveLogEntryToFirebase` (`app.js:3128`); `migrateAnonDataToUser` (`app.js:2952`) | `loadLogsFromFirebase` — `orderBy('createdAt','desc').limit(200)` (`app.js:3150-3153`) | `firestore.rules:10-16`: any authed user reads all docs; only owner (matching `userId`) creates/updates/deletes. |

There are no other Firestore collections referenced in code.

### 5.3 Firebase Storage paths

| Path | Writer | Reader | Rules |
|---|---|---|---|
| `surf-photos/raw/{userId}/{YYYY}/{MM}/{ts}_{i}.jpg` | `app.js:3091-3102` (per-photo upload during `saveLogEntryToFirebase`) | Public via `getDownloadURL()` stored on Firestore doc; auth required (`storage.rules:17-23`) | Authed users read; only matching `auth.uid == userId` can write; size <10 MB; `image/*` content type. |
| `gallery/{filename}` | Admin SDK only (rules deny client writes) | Authed users (`storage.rules:9-13`) | I did **not** find a client read site in `app.js`; flagging as possibly unused by the production UI. |

### 5.4 What about the React prototype?

`project/Swell Forecast.html` is not deployed and uses no persistent storage path that I located in this pass. Out of scope for production state.

---

## 6. Auth & sync

### 6.1 Wiring

- Library: Firebase **compat** SDK v10.x (loaded via `<script>` tags in `index.html`; the file uses globals `firebase`, `fbAuth`, `fbFirestore`, `fbStorage`).
- Provider: `firebase.auth.GoogleAuthProvider()` (`firebase-config.js:89`). **No `provider.addScope(...)` calls** — only Google's default scopes (basic profile + email).
- Sign-in flow: `signInWithGoogle` at `firebase-config.js:86-119`. If the current user is anonymous, it tries `currentUser.linkWithPopup(provider)` first; on `auth/credential-already-in-use` or `auth/email-already-in-use` it falls back to `fbAuth.signInWithPopup(provider)`. Otherwise it goes straight to `signInWithPopup`.
- Sign-out: `signOutUser` at `firebase-config.js:122-130` — signs out then immediately re-signs in anonymously.
- Anonymous bootstrap: 2 s after page load, if no `currentUser`, the app does `signInAnonymously` (`firebase-config.js:76-82`).
- Token storage: Firebase Auth's default persistence (IndexedDB-backed `local` persistence). The app does not call `setPersistence` anywhere I searched.

### 6.2 What signing in actually changes

Both **gating** and **cross-device sync** happen at sign-in:

- **Gating**: `loadLogsFromFirebase` short-circuits with `console.log('… skipping — user is anonymous')` at `app.js:3144-3147`. So an anonymous user sees only their localStorage `lcc_surfLog` mirror. A real user sees the **community log** — `surf_logs` is queried with no `where userId == ...` filter (`app.js:3150-3153`), and `firestore.rules` only requires `request.auth != null` for read.
- **Sync**: signing in triggers `migrateAnonDataToUser` (`firebase-config.js:43-45`, body at `app.js:2952-2974`), which uploads each in-memory `STATE.surfLog` entry via `saveLogEntryToFirebase`, then calls `loadLogsFromFirebase`.
- **Surf-log auth prompt**: `#sl-auth-prompt` shown when the user is on the surf-log tab and `_fbUserIsAnon !== false` (`app.js:3189-3191`).

### 6.3 Source of truth, conflicts, offline

- **Source of truth** (signed in): Firestore `surf_logs`. After every local mutation, the entry is also pushed (`addLogEntry` at `app.js:3009-3017`, `updateLogEntry` at `app.js:3025-3033`).
- **Cache**: localStorage `lcc_surfLog` is a mirror, written on every save (`app.js:2998`) and read only as fallback when Firebase load throws (`app.js:2987-2992`).
- **Conflict resolution**: last-write-wins per-doc — `set(payload)` at `app.js:3128` overwrites. There is no `update`-with-merge, no version field, no compare-and-set. Concurrent edits from two devices clobber.
- **Offline**: the app does **not** call `firebase.firestore().enablePersistence(...)`, so the SDK's offline write queue is not enabled. On Firebase failure, `addLogEntry` keeps the entry in localStorage and shows a `"Saved locally — sync failed"` toast (`app.js:3014-3017`). There's no automatic retry — the next mutation that succeeds will only sync that one entry, not backlog.
- **Photo handling**: data-URI photos in the local mirror are uploaded to Storage on the next successful save and replaced with `{url, path}` objects (`app.js:3089-3102, 3112`). On upload failure the photo is dropped, not retained as base64 (`app.js:3106-3108`).

---

## 7. Chocomount satellite map asset

### 7.1 Does it exist?

Yes — but **only in the React prototype, not in the production site**.

- File: `project/assets/lineup.jpg` (the only image asset in the repo besides Leaflet's tile sources). JPEG, **1992 × 949 pixels** (`file` reports `1992x949`), 326 KB.
- Usage: `project/Swell Forecast.html:1727-1731`:
  ```jsx
  <img className="fn-lineup-img" src="assets/lineup.jpg" alt="Lineup satellite view" ... />
  ```
- It is **not referenced** from `index.html`, `app.js`, or `style.css`. I grep'd for `lineup`, `satellite`, `aerial`, `background-image`, etc. — zero hits in the production code path.

### 7.2 Geographic registration

There is **no lat/lon → pixel projection math anywhere**. The image is treated as a stylized backdrop, not a georegistered raster:

- The container `.fn-lineup-frame` holds the image and a sibling SVG with `viewBox="0 0 100 100"` and `preserveAspectRatio="xMidYMid meet"` (`Swell Forecast.html:1735-1745`).
- All overlays anchor to the image's **viewBox center (50, 50)** as the apex/lineup point. Arrows and the reef guide are computed in degrees from compass north relative to this fixed center, e.g.:
  ```js
  const reefEndX = 50 + reefLen * Math.sin(reefRad);   // line 1673
  const reefEndY = 50 - reefLen * Math.cos(reefRad);
  ```
- `REEF_HEADING_DEG = 335` (used at line 1671 and labeled "reef 335°" at line 1769) is a hand-set bearing for the reef alignment, not derived from the image.
- The swell-window cone uses `SWELL_WINDOW_MIN = 115` and `SWELL_WINDOW_MAX = 158` (`Swell Forecast.html:729-730`) — `CONFIG.chocomount.swellWindowMin/Max` in the production code (`app.js:28-29`).

So the projection is "compass bearings emanating from the SVG center". There are **no declared geographic bounds** (no NW-corner / SE-corner lat/lon, no pixels-per-degree). To convert bearings to image pixels would require eyeballing the image's true center coordinate and orientation — which is not encoded anywhere I could find.

### 7.3 Existing overlays

In the prototype only (`project/Swell Forecast.html:1747-1796`):

- A **swell-window cone** (`<path d={conePath}>`), filled cyan when not firing or green when firing.
- A dashed **reef heading line** at 335° from center, with text label `reef 335°`.
- Up to three **`<ConvergingArrow>`** components: primary swell, secondary swell (when `sHeight >= 1` and `>= 0.25 × waveFt`), and wind. Each arrow's tail length is energy-scaled (`Math.sqrt(secondaryEnergy) * K_SWELL`, line 1650).
- A **legend** below the frame mapping arrow colors to swell vs wind (lines 1799-1810).

No pins beyond these are rendered.

### 7.4 Production status

Production renders **no satellite/aerial overlay**. The buoy map and tide map are pure Leaflet on a Carto Light basemap (`app.js:777, 872`). No image of Chocomount Beach is loaded by `index.html` or `app.js`.

---

## 8. Buoy selector

### 8.1 Default and selectable list

- Default: when the gate is passed and not by boat, `initApp` auto-selects the buoy with `home === 'chocomount'`, i.e. **NDBC 44097 Block Island** (`app.js:4727-4732`). For "by boat" entry, no auto-select; user picks from the map.
- Source: `data/buoys-east-coast.json`, 29 entries, fetched at `app.js:4686`.
- UI: there is **no `<select>` dropdown** — selection is a click on a Leaflet marker (`app.js:800: marker.on('click', () => selectBuoy(buoy))`). The Choc buoy gets a separate ⭐ marker at the open-water forecast point (`app.js:805-823`); clicking it also calls `selectBuoy(chocBuoy)`. Right-click on the buoy map adds a custom-spot pin that calls `selectPin` (`app.js:839-846`).
- Chocomount buoy is hidden until `boatGatePassed`: `if (buoy.home === 'chocomount' && !STATE.boatGatePassed) return` (`app.js:785`).

### 8.2 What `selectBuoy` re-triggers

`selectBuoy` at `app.js:904-926`:

1. Sets `STATE.selectedBuoy`, `STATE.isChocomount`, `STATE.pinLat/Lon`.
2. Moves the draggable forecast pin to the buoy's coords.
3. Updates `#header-location` text.
4. `updateTabBarVisibility()` and `updatePersonalMatchToggle()`.
5. Calls `loadAllData(buoy)` — which re-fetches Marine, Wind, NDBC stdmet (if `buoy.spectral`), and the Choc pipeline JSON if Choc. Updates every card, the chart, the spectral panels, the hourly table, the tides panel, and `highlightNearestTideStation`.

### 8.3 Does buoy selection drive the forecast query coordinates?

**Yes for non-Choc buoys; no for Chocomount.** From `app.js:976-993`:

```js
const lat = buoy.lat;
const lon = buoy.lon;
const isChoc = buoy.home === 'chocomount';
const forecastLat = isChoc ? CONFIG.chocomount.forecastLat : lat;   // 41.089152 if Choc
const forecastLon = isChoc ? CONFIG.chocomount.forecastLon : lon;   // -71.721050 if Choc
const displayLat  = isChoc ? CONFIG.chocomount.lat : lat;           // 41.275693 if Choc (land)
const displayLon  = isChoc ? CONFIG.chocomount.lon : lon;
...
fetchMarineForecast(forecastLat, forecastLon),
fetchWindForecast(displayLat, displayLon),
```

So:

- For 28 of the 29 buoys, marine query lat/lon = **the buoy's own lat/lon**.
- For Chocomount (44097), the marine query lat/lon is **hardcoded to `(41.089152, -71.721050)`** — independent of the buoy's actual location at `(40.969, -71.124)` per `data/buoys-east-coast.json:2`. The wind query for Choc uses yet another hardcoded point (the land beach point).

This split is invisible to the user — there is no UI indication that "Choc forecast" doesn't come from buoy 44097's lat/lon.

---

## 9. Tide stations

### 9.1 List and source

- File: `data/tide-stations.json`, 48 stations (`grep -c '"id"'`). Loaded at `app.js:4687`.
- Schema per entry: `{id: string, name: string, lat: number, lon: number}` (e.g. `{"id":"8510719","name":"Silver Eel Pond, Fishers Island, NY","lat":41.263,"lon":-72.048}`, `data/tide-stations.json:2-7`).
- All 48 are NOAA CO-OPS stations queried via `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` (`app.js:39, 587`).

### 9.2 UI dependencies on the selected station

There are **two distinct concepts** of "selected tide station" in the code:

**(A) The implicit "nearest" station — `STATE.nearestTideStation`.**
Set by `findNearestTideStation(lat, lon)` (`app.js:739-751`) which picks the closest station within `coopsNearbyRadiusMiles = 50`. This is what every UI surface that depends on tide data actually reads:

- The **tide condition card** ("Next high/low" widget) — `updateTideCard(tideHiLoForChart, tideStn)` at `app.js:1039, 1192`.
- The **forecast chart's tide curve overlay** — `tideHiLoForChart` passed into `drawForecastChart` (`app.js:1049, 1202`).
- The **tides panel** (high/low list + Canvas tide chart) — `loadTidesPanel(STATE.nearestTideStation)` at `app.js:1064, 1212`.
- The **highlighted dot on the tide map** — `highlightNearestTideStation(displayLat, displayLon)` at `app.js:1153, 1232, 1571-1586`.

`STATE.nearestTideStation` is recomputed every time a buoy or pin is selected (`app.js:1025-1026, 1183-1184`). It is **driven by buoy/pin coordinates**, not by user clicks on the tide map.

**(B) The map-click "selected station" — argument to `selectTideStation(station)`.**
At `app.js:939-966`. Clicking a tide-station marker on the dedicated tide map only:

1. Recolors the markers (highlights the clicked one in dark, others in blue).
2. Fetches `fetchTideHiLo(station.id, 2)` (a fresh CO-OPS call with `range=48h`).
3. Renders the result into `#tide-map-info` — a small text block on the tide-map panel.

It does **not** update `STATE.nearestTideStation`, the tide condition card, the forecast chart's tide overlay, or the tides panel. Users may experience this as confusing: the map click only updates one inline info blurb, while the "real" tide displays remain pinned to whatever station the buoy/pin selection chose.

### 9.3 Independence from buoy selector

The tide-map selector is **independent of the buoy selector** in the sense that clicking a tide marker does not re-select a buoy or refetch any forecast.

The reverse is **not** symmetric: selecting a buoy or moving the pin **does** change the highlighted tide station and the data displayed in the tide card / tides panel / chart overlay (via `findNearestTideStation` of the buoy's coords). For Chocomount specifically, the lookup uses `displayLat/Lon = (41.275693, -71.963310)`, which yields `8510719 Silver Eel Pond` (≈ 1.4 miles away) — matching `CONFIG.chocomount.tideStation = '8510719'` (`app.js:26`), although that constant itself is only used by the historical-tide fetch in surf-log scoring (`app.js:3546`), not by the live forecast path.

---

*End of sections 4–9. Sections 10–16 reserved for the next prompt.*
