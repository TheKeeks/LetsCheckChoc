# The Sound Check history, rebuilt every day

Everything the Sound Check says about the past (every day since May 2016, the month-by-month tiles, % of days with
swell through the window, good-day shares, the storms, the swell trains, the share that bent in from outside the
window, Wilderness vs Choc, the daily wind) comes from these scripts. Four times a day (from 5:23 AM Eastern)
`.github/workflows/update-history.yml` fetches what's new, rebuilds the whole history from 2016 through yesterday
(Eastern), and commits what changed to `main`. GitHub drops many scheduled runs, so the later runs catch up when an
earlier one doesn't start; one that finds nothing new commits nothing.

```sh
python3 scripts/history/update.py                        # fetch, rebuild, write into the repo
python3 scripts/history/update.py --offline              # rebuild from what's already in the cache
python3 scripts/history/update.py --end 2026-10-05 --out /tmp/h   # stop at that day, write somewhere else
python3 -m unittest scripts/test_history.py               # tests (numpy and scipy)
```

The cache (`history-cache/` at the repo root, git-ignored, or `HISTORY_CACHE`) holds the downloads, about 800 MB,
most of it CDIP's spectra archive. The workflow keeps the cache between runs, so a normal day downloads about
15 MB.

## What goes in

| Source | What | Used for |
|---|---|---|
| CDIP 154 (= NDBC 44097, Block Island) spectra: the archive plus the recent file | energy by frequency and direction, every half hour | Choc's and Wilderness's height every hour, the swell trains, the bent-in share |
| NDBC 44097 readings: finished years, then months, then the last 45 days | height, period, direction every hour | the buoy columns, big-swell hours, storms; Montauk 44017 fills gaps until 2023 |
| ERA5 at the over-water cell 41.25 N 72.00 W (Open-Meteo) | hourly wind | clean hours, good-day scores, Wilderness's wind; it lags about 6 days, so the newest days fill in their wind on later runs |
| ECMWF IFS at a 4 x 5 grid over the sound (Open-Meteo), ERA5 for 2016 | daily wind | the map's wind arrows |
| CO-OPS 8510719 (Silver Eel Pond) | highs and lows | the tide's rate (incoming or not) |

Two tables in `tables/` turn the buoy into the spots: `fwd_table.json`, the forward-ray table (share of the buoy's
energy reaching Choc and Wilderness by period and direction, from `scripts/rays/build_tables.py`), and
`kchoc_avg_s.json`, the older direction/period response, used only for the few hours with readings but no spectrum.
Replace the forward-ray table with a new one and the next run rebuilds all ten years with it.

## What comes out

| File | |
|---|---|
| `data/history/results4.json` | `daily` (one row per day: peak, best 3 hours of energy through the window, the ratings model's best 3 hours, wind, % clean), `ym` (per month: days with 3+ big hours, days with 2+ good hours, hours of data), `clim`, `events`, `per`, `good`; `model` is the ratings model as it was fitted |
| `data/history/days2.json` | per day: the best 3 hours at Choc and at Wilderness and the wind over them |
| `data/history/trains_days.json` | per day: the swell trains at Choc's biggest hour and at Wilderness's |
| `data/history/bend_days.json` | per day: % of Choc's energy that came from outside 115–158° |
| `data/history/wild_stats.json` | Wilderness vs Choc by month, its biggest days, the peel read |
| `data/history/windgrid_out.json` | the daily wind at 17 points |
| `research/hist.js` | all of these as the page's constants (`scripts/sound-check/page/build_hist.py`) |
| `research/ocean/day/<year>.json` | the `44097` lane only: the trains every hour, for the Past days panels |

`sessions_all.json` and `sess_pairs.json` come from the surf log and stay as they are, and so does the ratings
model. The log lives in the crew's Firestore, which the bot doesn't read. Refitting the model with a new export of
the log is a by-hand step, done with `scripts/sound-check/asbuilt/analyze4.py`.
The other lanes of `research/ocean/day/` (Montauk, Long Island, the Copernicus model) and the model's ocean maps
in `research/ocean/field/` aren't part of this update yet.

## Every file ends on the same day

The last day is yesterday, or earlier if the spectra or the readings stop sooner. A day needs 6 hours of
spectra for its calendar entry, so if the last day is short of that, every file stops the day before. No file
counts hours past the last day.

## It never shortens the history

A run whose rebuild has more than 7 days fewer than the committed history (a download cut short, a source that
failed with nothing cached) stops without writing, the site keeps the last good history, and GitHub emails the
owner. `--force` writes anyway, for a deliberate rebuild.

## It reproduces the history it took over

`spectra.py`, `analyze.py` and `derive.py` are the scripts that built the history (in
`scripts/sound-check/asbuilt/`: `valid_fwd2.py`, `trains.py`, `bend_days.py`, `fwdk.py`, `analyze4.py`,
`mk_days2.py`, `mk_wildstats*.py`, `mk_wildpeel.py`, and the wind-grid step), rewritten as functions of their
inputs. Run on the inputs that history was built from (data through 5 Oct 2026), `update.py --offline --end
2026-10-05` gives every file in `data/history/` and `research/hist.js` byte for byte. The one change it brings is to
the `44097` lane of `research/ocean/day/`: its Choc heights were still on the ray table before the 11 Oct rebuild,
and the first run brings them onto the current one. The buoy's own trains don't change.
