# Changelog

## [Unreleased] — Prompt #4: stacked forecast panels

### Forecast chart layout

The single-panel chart from Prompt #3 is replaced by three stacked panels
sharing one x-axis on a single canvas — `app.js:_drawForecastChartFull`.
Internal y-coordinate ranges partition the canvas; there is still one
canvas, one draw cycle, one scrubber, and one ResizeObserver.

Vertical regions (CSS pixels):

```
[pad.top]
[swell panel       — 50% of usable]
[gap               — 10–14px]
[wind  panel       — 25% of usable]
[callout band      — 28px, sits directly above the tide curve]
[tide  panel       — 15% of usable]
[arrow strip       — 40px fixed]
[day-label band    — 22px fixed]
[pad.bottom]
```

Day separators (faint vertical lines at midnight) and nighttime shading
(rgba grey at sunset→sunrise) span the full panel stack so the time axis
reads as one continuous cue.

`.chart-container-tall` height bumped 340 → 540px to fit the stack.
That is the only CSS change in this prompt; the full styling pass is
Prompt #6.

### Swell panel

- Two y-axes. Left: feet, dynamic 0 → max(primary, secondary) × 1.2,
  rounded up to the nearest 2. Right: seconds, fixed 0–25.
- Z-order, back-to-front: secondary swell area (lighter blue, 60%
  alpha) → primary swell area (darker blue, 85% alpha) → primary stroke
  → period line (burnt-orange, right axis).
- Period series uses `swell_wave_peak_period` when present, otherwise
  `swell_wave_period`. Both are requested in the existing fetch.
- No direction arrows on this panel — moved to the strip below tide.

### Wind panel

- Single mph y-axis, dynamic 0 → max × 1.2 (floor 10).
- Per-hour fill colored by wind quality. Each hour-segment is filled
  to its own color; adjacent segments butt against each other (no
  gradient — quality is per-hour).
- Bucketing: gap to Choc's offshore center (335°) → < 60° offshore /
  < 120° cross-shore / else onshore. Light-wind override (< 5 mph)
  upgrades cross-shore → offshore and onshore → cross-shore.
- Palette: green `#6ea96b`, yellow `#d4b34a`, red `#c25e5e`, all 0.6
  alpha. Top stroke is uniform dark gray. Gust is no longer rendered
  on the chart — only in the floating label.

### Tide panel

- Clean teal curve, no fill, autoscaled to the predicted min/max with
  4px inside-padding so the trough/peak don't kiss the edges.
- Callout above the panel (HTML overlay so scrub updates don't force
  a canvas redraw):
  - Idle: `NEXT LOW: <Today|Tomorrow|<Wkd>> <h:mm><am/pm> · <h>ft · in <Xh Ym>`
  - Scrubbed off-now: prefix becomes
    `NEXT LOW AFTER <h:mm><am/pm>:` and the timing is relative to the
    scrubbed hour. Resets when the user clicks "Reset to now".
- Next two lows after the reference time are labeled at the trough
  with a small filled triangle and stacked `<h:mm><am/pm>` / `<h>ft`
  text (above or below the trough depending on room).
- Subsequent lows render as small unlabeled triangle markers.
- Highs are unmarked.
- A faint dashed `now` vertical sits inside the tide panel (the
  scrubber crosshair carries the cross-panel role).

### Direction arrow strip

- 40-px band below the tide panel.
- One filled-triangle arrow per 6 hours (28 across the 168h window).
- Convention: arrows point toward the direction the swell is going TO
  (Open-Meteo reports `swell_wave_direction` as the from-direction;
  `drawArrow` already adds 180°).
- Slate-blue (`#4a6e91`) to visually link the strip to the primary
  swell area above.
- Each arrow gets a small `<deg>° <compass>` sub-label.

### Day-label band

- Bottom 22px of the canvas.
- Day 1 → "Today", day 2 → "Tomorrow", day 3+ → `<Wkd> M/D` (e.g.
  "Thu 5/7"). Centered on the visible portion of each day.
- Hour ticks (`00:00 / 06:00 / 12:00 / 18:00`) are rendered just
  above the day-label band, day 1 only.

### Scrubber

- Single dashed vertical now spans swell + wind + tide panels + arrow
  strip; ends above the day-label band.
- Circular handle still snaps to the swell-height curve (using the
  panel-local `swellTop`/`swellH`/`swellMaxY`).
- Floating detail bar reformatted per spec §7:
  `time | 3.4ft @ 11.2s | 290° WNW | wind 8mph (gust 12) NE | tide +1.8ft`.
  Direction is mandatory now that inline arrows are gone; tide level
  is interpolated from the 6-min CO-OPS prediction array at the
  scrubbed time.
- Tide callout is re-rendered relative to the scrubbed hour on every
  scrub move, and reverted to "now" form on Reset to now.

### Deletions

- Mini in-plot legend (per-panel labeling makes it redundant).
- Inline 28 swell-direction arrows on the swell area.
- Low-tide drop-lines on the swell panel.
- "All lows labeled" tide treatment (replaced by callout + 2 labels +
  sparse marks).
- Helper functions `_fcSwellArea` / `_fcPeriodLine` / `_fcWindLine`
  introduced in commit 1 of this prompt are removed in commit 2 once
  the per-panel rewrite makes them redundant.

### Commits (in order)

1. `Forecast chart: extract draw functions per panel`
2. `Forecast chart: stacked swell / wind / tide panels`
3. `Forecast chart: wind quality color shading`
4. `Forecast chart: tide callout + sparse low-tide labeling`
5. `Forecast chart: direction arrow strip below tide`
6. `Forecast chart: Today/Tomorrow/Thu 5/7 day labels`
7. `Forecast chart: floating-label adds direction + tide level`

## [Unreleased] — Prompt #3: Tab 1 forecast redesign

### Gate

- **Reverted** the Prompt #2 `sessionStorage['lcc-gate'] = 'yes'` write.
  Yes path now matches the original spec: show "Go Home" splash for 2s
  and return to the gate question. Only `'no'` persists and dismisses
  the overlay. `test-gate.js` gains an explicit test asserting the
  Yes-write does not exist.

### Buoy selector

- The `<section id="panel-map">` now lives outside `#view-forecast`
  (between the global header and the tab strip), so it's visible on
  every tab.
- Auto-collapse to a one-line summary on the first buoy/pin selection
  (e.g. `📍 Choc · 44097 — Block Island, NY · 40.97°N, -71.12°W
  [change]`). `[change]` re-expands. State persists to
  `localStorage.lcc-buoy-map-collapsed`; if no selection is in flight
  the map force-expands regardless.

### Tab 1 reorder

DOM order now: lineup map → forecast chart → stat grid → wave-spectra
summary + compass rose (side by side; summary left, rose right) →
wave energy spectrum → tide stations panel + tide-station selector
map.

### Forecast chart

Sweeping rewrite of `drawForecastChart` / `_drawForecastChartFull` at
`app.js`. A header comment block lists what was ported from
`project/Swell Forecast.html` and what was invented locally.

- **Full 7-day view, no pagination.** `_forecastDayOffset`,
  `FORECAST_DAYS_VISIBLE`, the `#forecast-prev` / `#forecast-next`
  buttons, the day-range nav label, swipe-to-page, and
  `wireForecastNav()` are all gone. The chart spans 168 hours anchored
  at `marine.hourly.time[0]`.
- **Visual redesign.** Right-side y-axis (0–30) carries swell period
  (solid burnt-orange line) and wind speed (dashed dark line). One
  swell-direction arrow every 6 hours (~28 across the window) anchored
  just above the height curve. Day separators stay at midnights;
  weekday labels render at noon; hour ticks (`00:00 / 06:00 / 12:00 /
  18:00`) only on the current day. Mini in-plot legend on desktop.
- **Tide overlay.** Thin teal tide curve drawn beneath the swell-height
  area from a new 168-hour 6-min CO-OPS predictions fetch (existing
  `fetchTidePredictions(stationId, undefined, 168)`). Existing
  low-tide drop-lines preserved on top.
- **Draggable scrubber.** Vertical line + circular handle on the height
  curve. Click to jump, drag to follow, release leaves it in place.
  Defaults to the hour matching `Date.now()` on idle. Persists for the
  session via `sessionStorage.lcc-scrubber-hour` (ISO hour string).
  A "Reset to now" link below the chart appears off-now and clears
  the storage.
  - Cross-feature wiring: lineup map's three arrows + the swell /
    secondary-swell / wind stat cards adopt the scrubbed-hour values.
    Stat cards gain a `+Xh` / `-Xh` badge when off-now. Tide / temp /
    daylight cards are pinned to "now" (not meaningfully forecastable
    at this resolution). Wave Spectra / Compass / Energy Spectrum /
    Tide Stations are buoy-instantaneous and unaffected.
- **Model toggle.** New `<select id="forecast-model-select">` next to
  the chart title. Default = best_match (no `models=` param sent).
  Verified models from the live Open-Meteo Marine docs (only those
  exposing `swell_wave_*` are user-selectable):
    - `meteofrance_wave` — MeteoFrance MFWAM (0.08°)
    - `dwd_ewam` — DWD EWAM (0.05°)
    - `dwd_gwam` — DWD GWAM (0.25°)
    - `ecmwf_wam` — ECMWF WAM (~9 km)
    - `ecmwf_wam025` — ECMWF WAM (0.25°)
    - `gfs_wave025` — GFS Wave (NOAA, 0.25°)
    - `gfs_wave016` — GFS Wave (NOAA, 0.16°)
    - `era5_ocean` — ERA5-Ocean (0.5°)
  - `meteofrance_ocean_currents` is omitted (no swell variables).
  - Selection persists to `localStorage.lcc-forecast-model`. On a
    failed fetch, falls back to best_match for that load with a toast.
  - Chart footer now reads `Open-Meteo Marine · <model description> ·
    <coords>` — replaces the placeholder
    `best_match (default)` literal from Prompt #2.
- **DPR fix.** New `setCanvasDPR(canvas, ctx, cssW, cssH)` helper
  applied to `forecast-canvas`, `tide-canvas`, `compass-canvas`,
  `spectrum-canvas`. The ResizeObserver now watches the forecast and
  tide containers in addition to the existing spectral pair, so all
  four charts re-render crisply on viewport resize.

### New keys

- `localStorage.lcc-buoy-map-collapsed` (`'true'`|`'false'`)
- `localStorage.lcc-forecast-model` (model id or absent)
- `sessionStorage.lcc-scrubber-hour` (ISO hour, e.g.
  `'2026-05-04T15:00'`)

## [Unreleased] — Tab restructure pass

### Three-tab shell

- **Tab 1 — Current Conditions & Forecast.** Reorganised existing forecast
  view content; no visual restyle. Order: lineup map (Choc only) → swell
  forecast chart → stat grid → wave spectra → compass rose + wave-energy
  spectrum → tide-station selector. Audit §2 rows 7, 10, 12–18.
- **Tab 2 — Regression Results.** New tab. Sample summary (n / date range
  / last-refit timestamp), the existing weights panel moved over,
  placeholder for diagnostics coming next pass. Empty-state for non-Choc.
  Audit §10, §2 row 24.
- **Tab 3 — Log a Session.** Surf-log content moved here. Sign-in copy
  changed to "Sign in w/ Google to log sessions". Past Sessions table now
  shows a one-line crowdsource note above it. Form hidden for non-Choc;
  Past Sessions table stays visible. Audit §2 rows 19–28.

### Header

- Added a `<select id="buoy-select">` dropdown for keyboard /
  accessibility selection. Map click path unchanged. Audit §8.1.
- Tab strip is no longer hidden on non-Choc selections; per-tab content
  gates instead. Audit §14.2.

### Tab 1 deletions (audit §2)

- Conditions summary banner + rating dots + best-window line (row 6).
- Best-window predictor function `findBestWindow` (was app.js:252-312).
- Hourly forecast detail table (row 17) + `buildHourlyTable` populator.
- Advanced Data toggle + `initAdvancedToggle` + `lcc-advanced` localStorage
  key (row 16).
- Personal Matches toggle + `#personal-match-cards` (row 11). Match
  computation code (`findBestMatchPerDay`, `renderPersonalMatchCards`)
  retained for Tab 2 work next pass.
- Wind Map and Waves Map Windy iframes (rows 8, 9) + `updateWindyEmbeds`.
- Helper functions `calcSurfRating`, `ratingLabel`, `buildConditionsSummary`,
  and `isLightWind` removed (only the deleted summary banner used them).

### Tab 1 additions

- Lineup satellite map (Choc only). Ported from
  `project/Swell Forecast.html` as a vanilla SVG overlay on
  `project/assets/lineup.jpg` — no React in production. Audit §7.
- New "Secondary Swell" stat card driven by `secondary_swell_wave_*`
  hourly fields. Hidden when secondary height < 1 ft. Audit §4.6, §4.8.
- Per-card coord footer (small italic line stating the source coordinate).
  For non-Choc, the three coords coincide and only one footer line shows.
- Forecast-coords toggle: "Use buoy coordinates for forecast" near the
  swell forecast chart, Choc only. Persists to
  `localStorage.lcc-forecast-use-buoy-coords`; toggling re-fetches
  Open-Meteo at either the hardcoded open-water point (default) or the
  buoy's own lat/lon. Audit §4.4.

### Tab 3 deletions

- "I Surfed This" feedback flow inside the match modal (audit §2 row 30):
  `#modal-feedback`, `#fb-*` slider listeners, the `fb-save-btn` handler.
  Match modal kept for photo viewing.

### Bug fixes (each in its own commit)

1. **Gate "Yes" persists.** Writes `sessionStorage['lcc-gate'] = 'yes'`
   and dismisses the overlay after the splash; reload respects the
   choice and skips Choc auto-select. Audit §14.1, §16.2.
2. **`fetchTextWithProxies` repaired.** Was reading `proxy.encode` and
   `proxy.prefix` which the live config doesn't expose; now uses
   `proxy.wrap()` like the working `fetchWithProxies`. Audit §1.7, §16.1.
3. **`test-gate.js` assertion aligned.** Test 6 now matches the current
   `wrap:` shape instead of the long-removed `prefix:`. Renamed the
   second `const lagHours` to `ndbcLagHours` to clear the duplicate-
   declaration grep test (test 2). Audit §1.2, §16.1.
4. **Dead code removed.** `fetchNWSWind` (no callers) and the
   `CONFIG.api.nws` entry; `scripts/spot_check_2023.py` (orphaned
   developer scratch); README references to long-deleted
   `scripts/fetch_forecast.py` and `data/forecast.json`. Audit §16.1.
5. **Unused regression features stripped.** `blown_water_index` and
   `wind_offshore_score` were computed and persisted on every session
   and forecast hour but never appeared in any `*_FEATURE_NAMES` array.
   Removed computation, helpers (`computeBlownWaterIndex`,
   `computeWindOffshoreScore`), the constants `CHOC_OFFSHORE_CENTER` /
   `OFFSHORE_HALF_WINDOW`, and render call sites (entry detail, modal,
   `renderConditionsDisplay`, CSV export). Existing Firestore docs that
   already carry these fields are left as-is — loaders ignore extras.
   Audit §16.2.
6. **Photo upload retry on failure.** Failed Storage uploads previously
   silently dropped the photo. Now the entry's photo is marked with
   `{url: null, path: null, _uploadFailed: true, _localDataURI: <uri>}`
   in the local mirror; `retryFailedPhotoUploads()` runs after
   `loadSurfLog` on init and re-saves any entry that still carries a
   marker. Toasts: "Retrying N photo upload(s)…" → "All photos synced"
   or "X photos still failing". The data URI itself is stripped from
   the Firestore payload to stay under the 1 MB doc cap. Audit §16.2.
7. **Forecast chart footer truth.** Footer was hardcoded
   "Open-Meteo Marine · gfs Wave 0.16°" but no `models=` param is sent —
   the API uses `best_match` by default. Footer now reads
   "Open-Meteo Marine · best_match (default)" until a real model toggle
   ships in the next prompt. Audit §4.2.
