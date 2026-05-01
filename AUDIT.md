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

*End of sections 1–3. Section 4 (swell forecast deep dive) is intentionally not started; awaiting the next prompt.*
