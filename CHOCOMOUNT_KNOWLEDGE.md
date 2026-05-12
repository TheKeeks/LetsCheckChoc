# CHOCOMOUNT_[KNOWLEDGE.md](http://KNOWLEDGE.md)

A field guide to how Chocomount works, for use by anyone building or modifying the LetsCheckChoc forecast logic. Internal reference encoding the spot owner's hard-won intuitions so models and features can be designed against real conditions, not generic surf forecasting heuristics.

## The spot

- Reef break at Chocomount Beach, Block Island Sound area. Reef heading: ~335° (NNW-facing).
- Swell window: 115°–158° (ESE through SSE), ~43° wide, centered at 136.5° (SE).
- NDBC buoy 44097 (Block Island, 40.969°N, 71.124°W) is the nearest buoy — but it's offshore and the spot's energy is a function of bathymetry and refraction between the buoy and shore.
- Forecast point: 41.089°N, 71.721°W (open water, ~50 mi from buoy). NOT the buoy lat/lon.
- Wind point: 41.276°N, 71.963°W (the land-side beach point).
- Tide station: NOAA CO-OPS 8510719 (Silver Eel Pond, Fishers Island), ~1.4 mi from beach.
- Water temp station: NOAA CO-OPS 8510560 (Montauk).
- Group velocity rule: 1.5 knots × period in seconds. A 12-second swell takes ~3-4 hours to arrive after the buoy reads it.

## The wave: a left that peels in three segments

The wave at Chocomount is a left peeling from a rock reef takeoff. It has a discrete structure:

  takeoff  →  reef section  →  eelgrass section  →  shorebreak
  (rock)      (1 turn)         (1 turn)              (continues OR shuts off)

- Maximum length: 4-5 turns on the best days.
- Ride quality rating (the 0-10 the spot owner gives) is essentially a count of how many segments were surfable. A 10/10 day = full ride through to shorebreak. A 5/10 day = died on the eelgrass. A 2/10 = never made it past the reef.
- This makes ride quality a discrete, physically interpretable variable — not a vague subjective measure.

## Swell window: the central concept

The reef faces NNW (335°), and swell arrives from approximately ESE-to-SSE. The 43° swell window means the orientation of incoming swell, not just its size, determines whether it hits the lineup at all.

### Secondary swell can be the actual swell

When the primary swell is out of window but the secondary is in window, the secondary becomes the de facto primary at the spot. The current model treats secondary as a small contributor — it should treat it as part of the answer to "what's actually hitting the spot."

### Total in-window energy is what matters

When both primary and secondary are in window, total in-window energy matters, not which one is bigger. Two 2-ft swells in window at different periods may produce the same surf as one 3-ft swell in window. The model should aggregate, not pick favorites.

### Crossing/competing direction case

This configuration is rare in spot owner's experience. When it does happen, default behavior should be: only the in-window component contributes.

### Out-of-window leak

Spot owner suspects there is some out-of-window leak (especially at long period, near the window edges) but this is a hunch, not confirmed. Defer to the data. The model should default to "only in-window energy counts" because that's the conservative hypothesis. If logged sessions reveal a pattern where the model under-predicts on long-period-near-edge days, the doc gets updated and a leak feature added.

### Rating is already perception-based

The spot owner's "size" rating is perceived size at the lineup, not measured size offshore. This is important: the Wave model's target already encodes whether the swell reached the spot. If a session shows 4ft offshore but the size rating is 2, the rating itself is saying "out of window, didn't reach me." The model doesn't need to encode this twice.

## Period

Spot owner has had some of the best days at low period. The relationship between period and quality at this spot is one of the central things the model is meant to discover — the spot owner does not have a strong intuition about whether long or short period is better and is using the regression to learn this.

Modeling rule: include period as a feature, do not transform it via interactions, let the regression weight speak. Trust the model's per-feature scatter to surface whether period is an important predictor.

## Tide

Spot owner's stated rule: "Best on low incoming tide." Two distinct phenomena are encoded:

### 1. Reef depth (absolute tide height)

The reef breaks better with less water on it. Lower absolute tide height = waves break harder/cleaner. Absolute tide height matters in feet, not as a fraction of that day's range.

Upper cutoff: it slowly degrades, with slack-high being notably the worst. No hard cutoff observed.

### 2. Tidal current (water movement)

Incoming tide pushes water toward the reef and amplifies the swell. Outgoing tide mutes it. This is independent of absolute tide height. Tide rate of change matters.

### 3. Falling tide

Spot owner reports falling tide "sometimes works on big days" but specifically that they probably don't have any logs on outgoing tide. The model literally cannot learn falling-tide behavior because the training data is biased toward incoming tide sessions. The doc flags this; if it ever matters, it's because the spot owner started logging outgoing-tide sessions.

A "head-high or bigger" threshold for falling tide to be worth surfing is the spot owner's rule of thumb but is unverified.

### Tide modeling implications

Replace the current 3 tide features with:
- tide_height: absolute height in feet, continuous
- tide_rate: signed rate of change, in ft/hr (positive = incoming, negative = outgoing)
- swell_height × tide_rate interaction: captures the "big swell + outgoing tide still works" dynamic

Drop the binary low_incoming indicator — it discretizes information that's better as continuous.

## Wind

Spot owner intuition: wind is "relatively predictable and unimportant." Current Conditions model has the highest R² of the three sub-models on the existing 28-session dataset. Tension between intuition and data.

Decision: leave the Conditions model as-is for now. Revisit after more sessions are logged.

## Ride quality is mostly tide and period, not size

The spot owner reports:
- Big days: ride quality is consistently high — "when it's pumping, it's pumping."
- Small days: ride quality varies — small + low tide + good shape = great session; small + wrong tide = mush.

This means ride quality is mostly explained by shape (tide and period), not size. Wave size is captured by the Wave model. The Ride model should focus on:
- Tide variables (height, rate)
- Period (longer period = more energy through the eelgrass section)
- Possibly an interaction with size (big swell + bad tide still rides; small swell + bad tide is dead)

The Ride model should NOT use swell direction features — those are already captured in the Wave model, and the perception-based rating already encodes "out of window = small."

## The "10ft out vs 2ft in" question

Spot owner's central unknown: how does the model attribute the contribution of an in-window-but-small swell vs. an out-of-window-but-large swell? The model can only answer this if there are logged sessions with this configuration. Spot owner has requested an investigation of past sessions to see if this configuration exists in their data.

Action item: before redesigning the regression, query the logged sessions and identify any with: primary swell out of window + secondary swell in window + meaningful size differential between them. If found, walk through them with the spot owner to inform feature design.

## Modeling guardrails

- Three separate sub-models: Wave, Ride, Conditions. These should not be merged.
- Each model has fewer features rather than more. Aim for ~3-4 features per sub-model on a dataset of ~28 sessions to avoid overfitting.
- Features should be physically interpretable. Each feature should be a thing you can name in plain English.
- Continuous over binary wherever possible.
- Derived features that combine primary and secondary swell into "effective in-window energy" are preferred over treating them independently.
- Match scoring uses three independent threshold sliders (Wave, Ride, Conditions). A forecast hour can have green Wave, red Ride, yellow Conditions.
- Period transformations are not pre-baked. Let the regression discover whether period matters and in what direction.
- Direction features only live in the Wave model. Ride model focuses on tide and period. Direction is already absorbed by perceived-size ratings.

## Proposed feature set (subject to confirmation after the past-session investigation)

### Wave model — 3 features, target = perceived size rating

- effective_in_window_height: sum of (primary_height if primary in window) + (secondary_height if secondary in window). When both are in, both count. When primary is out and secondary is in, only secondary counts. When both are out, value is 0.
- effective_in_window_period: height-weighted average period of contributing in-window trains.
- total_swell_height: gross swell magnitude regardless of direction. Acts as a sanity check / baseline.

### Ride model — 3 features, target = ride quality rating (count of segments surfed)

- tide_height: absolute, continuous, ft.
- tide_rate: signed, continuous, ft/hr.
- effective_in_window_period: shared with Wave model. Long period = more power through the eelgrass section.

Optional 4th if data supports: effective_in_window_height × tide_rate interaction term.

### Conditions model — keep as-is

Wind speed + offshoreness. 2 features. No changes pending more data.

## Future workstreams (not part of regression redesign)

1. Per-session compass + satellite visualization in the past-sessions drill-down. When viewing a logged session, show a small compass dial with primary + secondary swell direction arrows, plus optional satellite-mini with arrows. Helps the spot owner visually pattern-match sessions and spot configurations the model might be missing. Pure UX, no model change.

2. Out-of-window leak feature if longitudinal data shows the model systematically under-predicting on long-period-near-edge days.

3. Falling-tide model if/when the spot owner accumulates enough outgoing-tide sessions.

4. Period × tide interaction if the simple model surfaces a hint of nonlinearity.

## Document maintenance

This knowledge document evolves as the spot owner logs more sessions and validates or refutes hypotheses. When the regression's per-feature attributions disagree with the spot owner's intuition, this document gets updated and the next regression iteration tests the updated hypothesis.

## Physical character of the spot

Choc faces SSE into Block Island Sound. The configured swell window 115°-158°
is not arbitrary — it matches the geographic gap between Block Island's south
tip (bearing 114° from Choc) and Montauk Point (bearing 157°):
- East of the window: Block Island shadows incoming swell.
- West of the window: the eastern end of Long Island (Montauk) blocks it.
- The 43° gap between these two land masses is the only opening into Block
  Island Sound from the SE quadrant.

Reef perpendicular is 155° (the reef heads 335° NNW). Swells from 145°-155°
hit the reef closest to head-on, which is one reason the best logged days
cluster in this part of the window.

## Historic 10/10 sessions

Both perfect-rating sessions in the log are tropical-system swells:

- 2021-09-10: Hurricane Larry. Cat 3 recurving east of Bermuda with strongest
  fetch directed NNW at the Northeast U.S. Buoy peak ~15ft @ 15s at South
  Bermuda. Choc session: 6.4ft @ 15.4s @ 145°.
- 2022-10-14: Hurricane Ian remnants combined with a frontal boundary stalled
  off the Mid-Atlantic with blocking high to the east. Multi-day swell event.
  Choc session: 8.8ft @ 8.1s @ 150°.

The two events are different period regimes (15s vs 8s) but the same
direction (~145°-150°) and the same general source category (tropical or
post-tropical system in the SE quadrant of Choc).

## Period bimodality

Both period regimes work, possibly via different physical mechanisms:
- 13-15s (hurricane recurvature): long-period swell refracts strongly over
  the bathymetric highs south of Fishers Island, focusing energy onto the
  reef.
- 8-10s (nor'easter / post-tropical): shorter period doesn't refract as
  dramatically but also loses less energy to shoaling over the Block Island
  Sound shelf.
- 11-12s (the "middle"): may be the weakest regime — not enough refraction
  to focus, not enough efficient transmission to power through.

The bimodal hypothesis was tested empirically by adding a quadratic
period term to both Wave and Ride models (2026-05-12, see git history).
On the 28-session dataset, LOO-CV R² regressed: Wave −0.026, Ride −0.018,
despite coefficient signs that matched the U-shape pattern (linear
negative, squared positive). The conclusion is not that bimodality is
physically wrong — the coefficient signs are tantalizing — but that
28 sessions is too small to extract the signal from noise.

Revisit when n ≥ 50. If the U-shape pattern is real, ΔR² should turn
positive with more data. If it remains negative or flat at n=50+, the
hypothesis is rejected.

## Spot character summary

Choc is a tropical-cyclone-specialist break. The geographic window is too
narrow to consistently catch dominant winter NE/NNE groundswell from the
North Atlantic. It is optimized for storms that recurve in the western
Atlantic — exactly the dominant tropical pattern in August-October. Winter
and summer sessions are possible but rarer, and they require an unusual
storm geometry that puts a low-pressure system south or southeast of Long
Island with fetch directed at the gap between Block Island and Montauk.
