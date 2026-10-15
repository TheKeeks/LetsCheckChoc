# LetsCheckChoc — Setup Instructions

## Quick Start

1. Create a new GitHub repository called `LetsCheckChoc`
2. Copy all files from this package into the repo root
3. Push to GitHub
4. Enable GitHub Pages:
   - Go to Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` / `root`
   - Save
5. Enable the GitHub Actions workflow:
   - Go to Actions tab
   - Enable the "Update Buoy Data" workflow
   - Run it manually once to generate the initial `data/buoy.json`

Your site will be live at `https://[username].github.io/LetsCheckChoc/`

## The look

The site opens on Forecast in the clean, light design. The navigation shows
**Forecast, Explore, Methods, Log**: along the bottom on a phone, across the top on
a computer or a sideways iPad. Log asks you to sign in with Google; after
signing in, **My ratings** (what your logged sessions say about size, ride and
wind) joins the navigation and your surf journal opens. Settings (top right)
controls Light, Dark, Follow system, or Sunset to sunrise on every tab. Choc TV
still follows the sun.

**Forecast** is the Sound Check model, one hour at a time. The big number is
the height at Choc (or Wilderness, one tap on the map) for that hour: the
average of GFS-Wave and ECMWF, read at buoy 44097 and carried over the sea
floor, with each model under it. Under it, every swell at the buoy and its
share of the energy that reaches Choc, e.g. "1° 2.9 ft @ 8 s S 178° → 66% of
Choc" with a bar. The map follows the same hour (below). The week chart
underneath is the scrubber:
drag it, use the arrow keys, « day / ‹ / Now / › / day »; nights are shaded,
the tide and the wind (blue offshore, grey cross-shore, orange onshore) run
along the bottom. Then the wind and tide for that hour, and the buoy check:
44097's latest reading next to what was forecast for that hour 1, 2 and 3 days
before ("forecasts on track" when they were within half a foot or 15 %). Tap
it for the last two days. If the model run doesn't reach the present (the
forecast bot stalled), Forecast says so instead of showing an old number.
**↻** (top right, beside Settings) asks for the newest model run now, without
waiting for a reload (the forecast bot publishes one every 3 hours), and loads
the wind, tides and buoy again. For a few seconds the top line says what it
found: "New forecast: run 2:00 PM", "Up to date: run 11:00 AM", or that
GitHub couldn't be reached.

The map is one map with layers, at the hour on the scrubber; how far out you
look picks what it shows. **Ocean**: the North Atlantic from the Gulf of
Mexico to Africa, GFS-Wave's wave height in colour, GFS's sea-level pressure
as lines every 4 hPa, the lows (L) and highs (H) with their pressure, and
each storm's track over the run (lows that last a day and get down to
1000 hPa), brighter for the hours still to come. **Region**: the swell
headed our way, the dots far offshore aimed at the spot from an angle its
reef can see (tap one for when it gets here). **Fishers**: each swell's rays
bending into Choc, thicker for a bigger share and coloured like its row
(teal E, orange SE, violet S, grey anything else), labelled with its share.
Layers (the stacked-squares button) switches the model (GFS-Wave or ECMWF)
and each layer on or off; **3D** opens the sea floor in 3D on Explore at the
same hour. On a phone one finger scrolls past the map and two move it. ▶
plays the week, so you can watch a storm cross the ocean and the swell it
makes head for the coast.

**Explore** (the Map tab before) is past days and the sea floor. It opens on
the newest day of the history, with the ten years month by month beside the
map (under it on a phone): the grid of good days (or big swell days, or Choc
at 3 ft+), the month on show as a calendar, the day's details, and what the
ocean was doing that day. Tap a month for its days and a day to see it on the
map; a day picked on the map moves the calendar to it. The calendar follows
the surf log (on Methods too): a session you log, edit or delete shows at
once, with a dot on its day (a camera when it has photos), the month's count,
and who, when, the ratings, notes and photos in the day's details. A session
from today gets its dot before the history reaches today. **Drop a wave** traces
one wave over the sea floor. The **3D** button opens Fishers Island's sea
floor in 3D (Wilderness opens the Fishers view); **← Map** goes back. The 3D map is built from the Fishers Island viewer's own
elevation: NOAA's 2023 topobathy lidar and multibeam surveys at 0.8 m near the
island and 4 m around it, then the Sound Check 16 m and 144 m grids across Block
Island Sound. **3D bathymetry** raises it (depth stretch 1–10×, land always
1.25×); off, the same map lies flat. Drag to move, scroll or pinch to zoom,
right-drag or two fingers to tilt and turn; Choc, The Race, Fishers and Sound
jump to set views. On the water, for any 3-hour forecast step (GFS-Wave or
ECMWF, play or scrub along the bottom bar):

- **Wave height**: the Sound Check refraction model (each swell train at buoy
  44097 times its refraction coefficient, capped at 0.78 × depth).
- **Swell motion**: streaks that follow wave rays traced over the bottom, bend
  around the reefs and slow down as they shoal; more streaks where rays bunch
  up (focused swell).
- **Swell paths to Choc**: the model's rays, the ones reaching Choc and
  Wilderness bright.

All three are draped on the terrain, so in 3D they ride over the bottom.
Base layers: sea floor with aerial land (Esri), sea floor with elevation
colors, aerial photo everywhere, or the NOAA nautical chart; optional 5 m
contours. Hover (or tap on a phone) for depth, its survey and the modeled wave
height. The 3D map (about 1 MB of MapLibre) loads only the first time it is
opened.

**Methods** is the research page, now in the shared light/dark design: how
the model works, what makes a good day, the swell window, Check a date, the
ten years month by month, how far ahead to trust the forecast, and
Wilderness. It no longer carries a 7-day forecast of its own: the forecast
is the Forecast tab's. Its historical-day links open Explore at that date.
Its history (every day since May 2016, the ten years month by month, and
the counts in its text) is rebuilt every day from buoy 44097's own data,
through yesterday. On the same run the ratings model that decides a good
day, how your sessions compare with the buoy, and the forecast scorecard are
fitted again to the surf log, so a session you log counts from the next
update, and the numbers the page quotes about your sessions follow. The bot
reads the log with a read-only key the owner adds once
(`scripts/history/README.md` says how), and keeps no notes or names.

The old Windows-style look and its screens are gone, code and all; an old
`?classic=1` link opens this one. Its surf-log tools live in Settings →
Surf log: Export CSV and Export JSON, and (signed in) Import JSON and Fetch
conditions again. If the page ever can't start (its scripts didn't load),
it says so on a plain card with a Reload button instead of a blank screen;
on Choc TV the card says it will try again, and it does, by itself.

### Testing this branch locally

From the checkout, run `python3 -m http.server 8765 --bind 127.0.0.1`, then
open `http://127.0.0.1:8765/`. Run `npm test` for unit/regression checks;
`npm run test:e2e` uses the documented Playwright dependency and Chromium.
The site still needs no build step for GitHub Pages. `node scripts/build-preview.js`
packages static files into ignored `dist/` for the separate private branch
preview defined in `.openai/hosting.json`.

Google sign-in uses the existing Firebase project. A new hosted preview domain
must be added to Firebase Authentication → Settings → Authorized domains by a
project administrator before Google login works there. The login screen
reports that condition; it never substitutes a simulated account. No Firebase
rules or production deployment settings are changed by this branch.

## File Structure

```
LetsCheckChoc/
├── index.html                  Page shell (Forecast / Explore / Methods / Log / Model)
├── map/                        Explore page: past days on the Sound Check map, the sea floor in 3D (~117 MB of gzip grids in the TheKeeks/LetsCheckChoc-data repo), workers, forecast layers
├── app.js                      Data, forecast load, surf log and ratings model (no screens)
├── kiosk.js                    Choc TV's appliance side (?kiosk=1): rotation, refresh, self-healing — see below
├── previews/clean/             The look: every screen (Forecast, Explore, Methods, Log, My ratings, Choc TV)
├── style.css                   Toasts and the rating charts My ratings borrows
├── manifest.webmanifest        PWA manifest (Add to Home Screen → "Choc TV")
├── icons/                      PWA icons (generated by scripts/generate_icons.js)
├── firebase-config.js          Firebase project + auth helpers
├── test-gate.js                Legacy node checks (run by `npm test`)
├── package.json                Test scripts only — no build, no dependencies
├── CLAUDE.md                   Orientation for Claude Code sessions
├── CHANGELOG.md                Per-commit changelog
├── AUDIT.md                    Historical fact-finding (line numbers stale)
├── firebase.json               Emulator config for the rules tests
├── firestore.rules             Paste into Firebase Console → Firestore → Rules
├── storage.rules               Paste into Firebase Console → Storage → Rules
├── vendor/maplibre/            MapLibre GL, self-hosted (Explore's 3D sea floor)
├── tests/                      unit/ (node:test), e2e/ (Playwright), rules/, fixtures/
├── data/
│   ├── buoys-east-coast.json   Static: ~29 ndbc buoys
│   ├── tide-stations.json      Static: ~48 CO-OPS stations
│   ├── buoy.json               Auto-generated by pipeline
│   └── verification.json       Auto-generated: model-vs-buoy nowcast log
├── project/
│   ├── Swell Forecast.html     React prototype (not deployed)
│   └── assets/lineup.jpg       Lineup photo
├── scripts/
│   ├── fetch_buoy.py           Pipeline: fetches ndbc 44097
│   └── canary.py               Upstream health probes (files a GitHub issue)
├── .github/workflows/
│   ├── update-buoy.yml         Runs every 2 hours
│   ├── ci.yml                  Unit, Python and browser tests on every push/PR
│   ├── rules.yml               Firestore/Storage rules tests in the emulator
│   └── canary.yml              Probes every upstream every 6 hours
└── README.md                   This file
```

## Choc TV (iPad kiosk mode)

Open the site with `?kiosk=1` and it boots straight into Chocomount
full-screen and cycles three panels: next 3 days, days 4–6 and the radar,
with the forecast run's and the buoy's ages and the clock along the bottom.
Its swell is the Sound Check model, the same number as the Forecast tab
(the two models' mean at Choc). Each day card shows Choc's biggest height
over the day's incoming tide in daylight, and the main swell then. The
radar plays the model forward through daylight: Choc's height, each
model's, and each swell with its share of Choc, drawn as arrows into the
reef in the swell's colour and thicker for a bigger share; the week strip
under it is Choc's height. The TV asks for a newer model run every 30
minutes, so a new run shows without a reload.

Tapping pauses the rotation for about a minute. Sources opens a card
explaining where each reading comes from (plain text, no links — a tapped
link would navigate the appliance away). The PWA icon is the lineup's
coastline with the swell-window cone (regenerate with
`node scripts/generate_icons.js`).

### iPad setup (one-time)

1. In Safari, open `https://[username].github.io/LetsCheckChoc/?kiosk=1`
2. Share → **Add to Home Screen** — the "Choc TV" icon appears
3. Settings → Display & Brightness → **Auto-Lock: Never**
4. Settings → Accessibility → **Guided Access: On** (set a passcode)
5. Launch Choc TV from the home screen, then **triple-click the
   top/side button** to pin it with Guided Access
6. Put the iPad on a stand in landscape, keep it plugged in

### Notes & limits

- The screen wake lock needs iOS ≥ 16.4 and is best-effort — Guided
  Access + Auto-Lock "Never" is the reliable always-on path
- Needs network (no offline cache). If a refresh fails, the kiosk keeps
  the last good forecast and the status strip shows its true age, turning
  stale after ~40 min and showing a red banner after 3 h
- Self-healing: it retries the buoy/tide catalogs if they fail at boot,
  reloads itself if no load completes within 10 min, picks up deploys on
  its refresh tick, and reloads nightly around 03:30 (each reload only
  after a successful network probe)
- Updating from a build older than October 2026, which can't update
  itself: relaunch once by hand. Triple-click and enter the passcode to
  end Guided Access, swipe Choc TV away in the app switcher, reopen it
  from the home screen and start Guided Access again. ⓘ SOURCES shows
  "Choc TV build …" once the new code is running
- If its screen can't start (a bad deploy, or the network dropped while
  it loaded), it shows a plain "didn't start" card and reloads itself a
  minute later, then every 5 minutes, once the site answers
- Debug params (seconds): `&kioskRotate=`, `&kioskPause=`,
  `&kioskRefresh=`, `&kioskRadarStep=` (radar seconds-per-hour,
  default 1) — e.g. `?kiosk=1&kioskRotate=5` for quick cycling

## App Structure

`app.js` has no screens of its own any more: it loads the data (forecast,
wind, tides, the buoy), keeps the surf log and fits the ratings model.
Every screen is the look's (`previews/clean/`, API in its `CONTRACT.md`).
The surf-log form and the rating panels My ratings borrows still live,
hidden, in `index.html`.

Forecast and wind data come from Open-Meteo (no `models=` is sent, so
the API picks `best_match`). Chocomount's buoy and spectral data come
from the `data/buoy.json` pipeline (NDBC 44097, fetched server-side by
GitHub Actions). NDBC sends no CORS headers and the public CORS proxies
the app used to rely on are dead, so other buoys show the model forecast
plus an "unavailable" note until a relay you control is added to
`CONFIG.api.ndbcProxies` (see the comment there).

## Data Sources

All data is fetched browser-side (no server needed) except NDBC, which the pipeline fetches.

| Source | Used For | cors-friendly? |
|--------|----------|----------------|
| Open-Meteo Marine | Swell forecast, sst | Yes |
| Open-Meteo Weather | Wind forecast | Yes |
| CO-OPS | Tides, water temp | Yes |
| NDBC 44097 via `data/buoy.json` | Buoy readings, spectrum, 8 s+ swell band | Pipeline (GitHub Actions) |

The update-buoy pipeline also logs **nowcast-verification** rows to
`data/verification.json`: one per buoy observation hour (each run fills
any hours a skipped run missed, up to 72 h back), each observation paired with the Open-Meteo model value for the same hour at
two grid points — the buoy itself (model skill) and the Choc forecast
point (spatial offset). My ratings' "Model vs Buoy" panel
plots the series (height / period / direction) and reports bias and
MAE for both analyses.

## Persisted preferences

Per-user state is split between `localStorage` (cross-session) and
`sessionStorage` (per-tab):

| Key | Storage | Set by |
|-----|---------|--------|
| `lcc-forecast-use-buoy-coords` | local | "Use buoy coordinates for forecast" in Settings |
| `lcc-forecast-model` | local | the Open-Meteo model the ratings read |

## Customization

The Chocomount swell window is defined in `CONFIG.chocomount`.

To add more buoys, edit `data/buoys-east-coast.json`.
To add more tide stations, edit `data/tide-stations.json`.
