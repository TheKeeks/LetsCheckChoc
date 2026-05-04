# Changelog

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
