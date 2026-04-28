# Forecast Cards — Progress Log

Running log for the three new cards on `project/Swell Forecast.html`. Updated
at each commit; serves as a resume point if a session times out mid-flight.

## Decisions

- **Q1 (extractCondFeatures fallback)**: added unconditional fallback to
  `computeWindOffshoreScore(wind.direction)` when `cond.wind_offshore_score`
  isn't pre-attached. Edit-existing-logs UI is **out of scope today** — it'll
  ship as a follow-up against `app.js` (not this branch).
- **Q2 (photo modal)**: opens on both mobile tap and desktop click.
- **Q3 (forest-plot label format)**: `Math.round(weight * 10)` with sign,
  rendered as `+4%` / `-7%`. Section sub explains "Δ rating per 1σ change in
  feature, as % of 10-pt scale."
- **Q4 (Card 1 hover)**: local hover state — no coupling to SwellChart's
  `hoveredIdx`.

## Stages

- [x] **Stage 0** — extractCondFeatures fallback + Sources non-link items + this doc
- [x] **Stage 1** — Prediction/geometry helpers (computePredictionSeries,
      yForScore, scoreQ, computeTimelineGeometry, foldWeightStds,
      alignmentClass, FEATURE_LABELS / prettyFeature, source lists)
- [x] **Stage 2** — Card 1: PredictedScoreTimeline (800×270 SVG, 3 colored
      lines, hover banner desktop + mobile, empty-state overlays, sources).
      Component is *defined* but **not yet wired** into App() — that's Stage 5.
- [ ] **Stage 3** — Card 2: FeatureWeightsForestPlot (tab pills, vertical
      forest, uncertainty bands, signed % labels, RMSE status bar)
- [ ] **Stage 4** — Card 3: PredVsActualScatter (tab pills, scatter w/
      diagonal, alignment-colored dots, hover/tap tooltip, photo modal,
      RMSE + R² status)
- [ ] **Stage 5** — Wire all three into App() between LineupOverlay and
      LiveSpectralPanel; verify HTML parses; final commit + push

## Out of scope today

- Edit-existing-logs UI (separate follow-up against app.js)

## Insertion points (post-Stage 0)

- New components + helpers go between `logTrainSummary` (line ~2857) and the
  `// modelStatus drives` comment block (line ~2859).
- New cards render between `<LineupOverlay>` and `<LiveSpectralPanel>` inside
  App's return JSX.
