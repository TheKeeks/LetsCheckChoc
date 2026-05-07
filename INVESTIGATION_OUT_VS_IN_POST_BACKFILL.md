# Investigation: Out-of-window primary + in-window secondary swell — POST-BACKFILL

**Spot owner user ID:** `jHJZVsSsTPNADKBnCjfVxuXJO1k1` (`keeks.george@gmail.com`)
**Swell window:** 115°–158° (CONFIG.chocomount.swellWindowMin/Max)
**Sessions analyzed:** 28
**Backfill source:** Open-Meteo archive (reanalysis), with NDBC stdmet 44097 fallback for dates outside archive coverage

---

## What changed since the original report

The original `INVESTIGATION_OUT_VS_IN.md` was generated from session conditions
that had been written by the previous historical-lookup code path:

- For sessions ≤5 days old at lookup time, the system pulled from the
  Open-Meteo *forecast* endpoint with `past_days=7` — i.e. the model's
  prediction, not the actual outcome.
- For sessions >5 days old at Chocomount, the system used NDBC stdmet
  historical, which has no secondary-swell decomposition.
- For sessions >5 days old anywhere else, the system used the Open-Meteo
  archive endpoint.

That mix produced two artefacts in the original report:

1. The "secondary swell" column was populated for only **6 of 28 sessions**
   (the recent ones whose lookup happened to hit the marine-API path with
   the secondary fields requested). For the remaining 22 sessions the SEC IN
   bucket was structurally unreachable.
2. The primary-swell values for the recent (≤5d) sessions were the values
   the *forecast* endpoint had reported — which can be wrong by 50%+ on
   swell height, per the diagnostic write-up in
   `INVESTIGATION_LOOKUP_DISCREPANCY.md` (referenced by the migration spec).

The migration replaced the historical-lookup path with the Open-Meteo
**archive** endpoint for ALL ages. Archive data is reanalysis — model output
that has been re-run after the fact, incorporating actual observations
including buoy readings. It includes secondary swell. It covers dates back
to ~2016 for marine variables.

After the user clicks the **"Re-fetch all session conditions from
Open-Meteo archive"** button on Tab 3, every session's `cond.swell` block
is replaced with the archive value (and `cond.swell.secondary` /
`cond.swell.windWave` populated where the archive returns them).
Subjective ratings (size, wind quality, ride quality) and notes are not
touched. Wind and tide blocks are preserved.

---

## How to regenerate the table below

This file is committed with a placeholder table so the structure is in
place before the user clicks the backfill button. To regenerate the
table from real post-backfill data:

1. Open the app, sign in, switch to Tab 3 (surf log).
2. Click **"Re-fetch all session conditions from Open-Meteo archive"** and
   wait for the summary modal.
3. Open DevTools and run:
   ```js
   console.log(window._llcGeneratePostBackfillReport());
   ```
4. Copy the printed markdown and replace the table + summary block below.
5. Commit the file.

The diagnostic logic is in `app.js`
(`window._llcGeneratePostBackfillReport`); it walks `STATE.surfLog`,
re-buckets each session against `CONFIG.chocomount.swellWindowMin/Max`,
and emits the same table format as the original investigation.

---

## Sessions table (sorted: SEC IN → BOTH IN → PRI IN → BOTH OUT)

> Replace the rows below with the output from
> `_llcGeneratePostBackfillReport()` after running the backfill.

| Date | Bucket | Primary | Secondary | Size | Wind | Ride | Source | Notes |
|---|---|---|---|---|---|---|---|---|
| _pending backfill_ | — | — | — | — | — | — | — | _run `_llcGeneratePostBackfillReport()` after clicking the backfill button_ |

---

## Expected differences vs. the original report

After backfill, the new bucket counts should differ from the original
because:

- **All 28 sessions** should now have secondary swell data
  (assuming archive coverage; pre-2016 dates may still fall back to NDBC,
  which has no secondary). The original report had only 6 of 28.
- **The actual conditions** for each session may differ from what was
  previously stored, because forecast data is replaced with reanalysis.
  Expect non-trivial movement in the primary-direction column for
  sessions that were previously ≤5 days old at lookup time.
- The **SEC IN bucket** (out-of-window primary + in-window secondary —
  the spot owner's "10 ft out vs 2 ft in" target configuration) may grow
  if reanalysis surfaces secondary trains the forecast endpoint missed
  or misplaced.

The original summary as a baseline:

- BOTH IN:  0
- PRI IN:   14
- SEC IN:   2
- BOTH OUT: 12
- Sessions with secondary-swell data: 6 of 28 (21%)

---

## Source breakdown (post-backfill)

> Replace this block with the output from `_llcGeneratePostBackfillReport()`.

- openmeteo-archive: _pending_
- ndbc-stdmet:       _pending_
- other / unknown:   _pending_

---

## Caveats that don't change

- The "10 ft out vs 2 ft in" magnitude gap that the spot owner asked
  about is still not directly observable in the dataset because no
  logged session has a primary > ~5 ft *while* a secondary lands inside
  the window. Backfill will not fabricate sessions that don't exist; it
  only replaces the conditions snapshot for existing sessions.
- The follow-up question for the spot owner — confirm by interview
  whether the small-primary SEC IN sessions felt like "secondary became
  the swell" or "no swell at all" — remains open. See the original
  report's "Sessions for spot-owner review" section.
