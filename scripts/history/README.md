# The Sound Check history, rebuilt every day

Everything the Sound Check says about the past (every day since May 2016, the month-by-month tiles, % of days with
swell through the window, good-day shares, the storms, the swell trains, the share that bent in from outside the
window, Wilderness vs Choc, the daily wind) comes from these scripts, and so does everything it says about the
crew's surf log (the ratings model, its good days, how the sessions compare with the buoy, the forecast scorecard). Four times a day (from 5:23 AM Eastern)
`.github/workflows/update-history.yml` fetches what's new, rebuilds the whole history from 2016 through yesterday
(Eastern), and commits what changed to `main`. GitHub drops many scheduled runs, so the later runs catch up when an
earlier one doesn't start; one that finds nothing new commits nothing.

```sh
python3 scripts/history/update.py                        # fetch, rebuild, write into the repo
python3 scripts/history/update.py --offline              # rebuild from what's already in the cache
python3 scripts/history/update.py --end 2026-10-05 --out /tmp/h   # stop at that day, write somewhere else
python3 scripts/history/update.py --log surflog-export.json   # fit to an export of the log (the Log's Export JSON or CSV)
python3 -m unittest scripts/test_history.py               # tests (numpy and scipy)
python3 -m unittest scripts/test_pressure.py              # the pressure maps' tests (numpy, Pillow; numcodecs)
```

The cache (`history-cache/` at the repo root, git-ignored, or `HISTORY_CACHE`) holds the downloads, about 800 MB,
most of it CDIP's spectra archive. The workflow keeps the cache between runs, so a normal day downloads about
15 MB.

## What goes in

| Source | What | Used for |
|---|---|---|
| CDIP 154 (= NDBC 44097, Block Island) spectra: the archive plus the recent file | energy by frequency and direction, every half hour | Choc's and Wilderness's height every hour, the swell trains, the bent-in share |
| NDBC 44097 readings: finished years, then months, then the last 45 days | height, period, direction every hour | the buoy columns, big-swell hours, storms; Montauk 44017 fills gaps until 2023 |
| ERA5 at the over-water cell 41.25 N 72.00 W (Open-Meteo) | hourly wind | clean hours, good-day scores, Wilderness's wind, the Past days' wind lane; it lags about 6 days, so the newest days fill in their wind on later runs |
| ECMWF IFS at a 4 x 5 grid over the sound (Open-Meteo), ERA5 for 2016 | daily wind | the map's wind arrows |
| CO-OPS 8510719 (Silver Eel Pond) | highs and lows | the tide's rate (incoming or not), the Past days' tide lane |
| The crew's surf log (Firestore `surf_logs`), with the read-only key in the `SURFLOG_READ_KEY` secret | each session's time, its three ratings, the swell and tide the app saved | the ratings model and the sessions' statistics |
| GFS-Wave's archived runs on AWS (NOAA's open data), for new sessions only | the forecast 1, 2 and 3 days before each session | the forecast scorecard |
| ERA5's sea-level pressure, 2016-2022: WeatherBench2's 6-hourly 1° copy on Google Cloud (a zarr store, no key) | the pressure over the North Atlantic every 6 hours | the Past days' storm view |
| GFS analyses since 2023 (f000 of each 00/06/12/18Z run, NOAA's open data on AWS) | the same | the same |

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
| `data/history/sess_pairs.json` | per session: the size you rated, the best 3 hours of its day at the buoy and modeled at Choc |
| `data/history/sessions_all.json` | how well each daily measure of the buoy ranks the sessions by size, with bootstrap ranges |
| `research/hist.js` | all of these as the page's constants (`scripts/sound-check/page/build_hist.py`) |
| `research/ocean/day/<year>.json` | three lanes of the Past days panels: `44097`, the trains every hour; `wind`, `{"YYYY-MM-DDTHH" (UTC hour): [kn, from deg]}` every hour; `tide`, `{"YYYY-MM-DD" (Eastern day): [["HH:MM" Eastern, ft, "H" or "L"], ...]}`. An hour or a day without data is left out, never 0. The file's other lanes stay as they are, in their places (a new lane goes last) |
| `research/ocean/pressure/<YYYY>-<MM>.png`, `meta.json` | the sea-level pressure every 6 hours since 2016, one picture a month (`pressure.py`, below) |
| `research/fc/score.json` | the forecast scorecard: per session, GFS-Wave's forecast for Choc 1, 2 and 3 days before and what the buoy-based model says arrived |

The other lanes of `research/ocean/day/` (Montauk, Long Island, the Copernicus model) and the model's ocean maps
in `research/ocean/field/` aren't part of this update yet.

The wind's hours: Open-Meteo labels the whole series with one UTC offset, the one in force on the day it's asked
(`utc_offset_seconds`: -4 h when fetched in summer, -5 h in winter, for all ten years), so every table takes each
label less that offset (`derive.sea_utc`): the wind lane, the clean hours and good-day scores (`analyze.wind_hours`),
the days' and Wilderness's wind (`derive.wind_by_hour`) and the daily wind grid. Until 15 Oct 2026 all but the lane
read the labels as Eastern clock time, which put their wind an hour late for the half of the year in the other
season.

## The pressure maps

`pressure.py` keeps the sea-level pressure over the North Atlantic (10-70 N, 100-5 W, every 1°) every 6 hours since
2016, so the Past days can draw the isobars, the lows and highs and the storms' tracks the way the Forecast tab does
for the days ahead. One 8-bit grayscale picture per month, `research/ocean/pressure/<YYYY>-<MM>.png` (UTC months):
a row per step (00, 06, 12, 18 UTC from the 1st 00Z, row = hours since then / 6; 4 x days rows once the month is
complete, fewer while it fills), a column per cell (north to south, each row of the grid west to east, 61 x 96 = 5856
columns), value v = 940 + 0.5 v hPa (940-1067, clamped), 255 = no data. `meta.json` has the grid, the encoding and,
under `months`, one line per month: `"2016-01": {"rows": 124, "first": "2016-01-01T00Z", "last": "2016-01-31T18Z",
"missing": 0, "source": "ERA5 (WeatherBench2, 1°)"}` (`missing`: steps still 255).

ERA5 for 2016-2022 (WeatherBench2's store ends on 10 Jan 2023), GFS's analyses from 1 Jan 2023 00Z (the 1° files on
AWS start in 2021; ERA5 is kept through the overlap, so a month has one source). Each run fills what's missing, oldest
first, for 20 minutes at most (`PRESSURE_BUDGET`, seconds): the first run fills all ten years (measured: an ERA5 year
is 366 downloads, 223 MB, about 30 s; a GFS year 2,920 range reads, 165 MB, about 2 minutes; all ten years 2.2 GB in about 15 minutes), then each day adds
yesterday's four steps to this month's picture. A step whose source fails stays 255 and is asked for again on the
next run; a month never gets shorter, a filled step is never fetched again, and a finished month's picture is never
rewritten. It never stops the rest of the update. A month's picture is about 220 kB (ERA5) to 240 kB (GFS, a little
noisier), 29 MB for the ten years. Pictures by month keep the repo small: a day's commit rewrites only the month so
far (7 kB on the 1st, about 230 kB on the 30th), about 3.5 MB of new picture a month, some 42 MB a year, where one
picture a year rewritten every day would have added about 1 GB a year.

    python3 scripts/history/pressure.py --end 2026-10-14 --out /tmp/p    # fill through a day, write somewhere else
    python3 -m unittest scripts/test_pressure.py

## The surf log

Every run reads the crew's log from Firestore (`surflog.py`) and fits to it (`ratings.py`): the ratings model (a
small ridge regression of your ratings on modeled swell energy at Choc, offshore wind and the tide's rate, scored
on sessions it hasn't seen), which then scores every hour of the ten years and so decides the good days; the
session pairs; the buoy measures; and the scorecard. A session logged today counts from the first run after the
history reaches its day. The scorecard keeps the forecasts it has (a past run never changes) and fetches those
of new sessions, at most 24 sessions a run (GFS-Wave's archive starts in March 2021).

What it keeps of a session: its time, the three ratings and their average as the app writes it, the swell and
tide the app saved. Not the notes, the photos or who logged it: the files are public and keep every version (the
site shows the notes and photos straight from Firestore, so a deleted note is gone).

It leaves the committed model and files as they are when there is no key, when the log can't be read (the
warning in the run's log says why: Google refused the key, or Firestore refused the read), when fewer than half
the sessions the model was last fitted to come back (a read cut short; `--force` refits anyway), and when fewer
than 10 sessions have conditions.

### The key (once, by the owner)

The bot reads with a Google service account that may only read the database:

1. Google Cloud console → IAM & Admin → Service accounts, in the `letscheckchoc` project: **Create service
   account**, named `history-bot`. Role: **Cloud Datastore Viewer** (read-only access to Firestore). Done.
2. Open the account → **Keys** → **Add key** → **Create new key** → **JSON**. The browser downloads the key.
3. GitHub → the repository's Settings → Secrets and variables → Actions → **New repository secret**, named
   `SURFLOG_READ_KEY`; paste the whole key file as its value.
4. Delete the downloaded file. To revoke the bot's access, delete the key in the console.

The next run (or Actions → Update Sound Check history → Run workflow) fits to the log.

### It reproduces the hand-built files

Fitted to the 28 sessions of the export the model was first fitted to (through 18 Oct 2025), on the history
through 13 Oct 2026, `update.py --offline --log surflog.csv` gives the committed model (every number, and the same
28 sessions, minus their notes), the session pairs and every buoy measure of every session exactly. Two kinds of
number move, because the bot takes the sessions in time order where the export listed them newest-saved first
(an edit re-saves a session, which would shuffle them): a few of the buoy measures' bootstrap ranges, by 0.01-0.03,
and three of the scorecard's rank correlations, by 0.01 (ties in your ratings were broken by that order). In the
export's order both come out exactly as committed. The scorecard's forecasts, fetched again for three sessions,
match to the hundredth of a foot. (The wind's hours have been placed by the series' UTC offset since 15 Oct 2026, so
the numbers that use the wind, the clean hours, the good-day scores and Wilderness's wind, now differ from the
hand-built files for half the year.)

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
