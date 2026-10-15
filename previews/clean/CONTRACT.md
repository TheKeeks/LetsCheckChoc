# `?preview=clean` — the CLEAN contract

The "A refined" boards from Claude Design, built as a preview look over the
**real** app with live data. The plain URL opens Forecast. This file is the
shared API that `core.js` gives the screen parts. It is owned by Core: parts
read it and do not edit it.

## Files and owners

| File | Owner | What |
|---|---|---|
| `theme.css` | Core | Tokens (day, and night under `html[data-clean-theme="night"]`), hides the engine room, `@import`s the five files below |
| `base.css` | Core | Scoped reset, phone shell, sub-page, shared classes (below) |
| `theme.js` | Core | Loader: `document.write`s `core.js`, `forecast.js`, `map.js`, `methods.js`, `log.js`, `model.js`, `tv.js` in that order |
| `core.js` | Core | `window.CLEAN`: shell, theme, data adapters, formatting, icons, events, Settings |
| `forecast.js` + `forecast.css` | Forecast | Forecast tab, built on the Sound Check model: height at Choc or Wilderness, the swells' shares, the map, the week scrubber with play, wind and tide, the buoy check. The map is `research/map.html` (the Sound Check map alone, no history) in a frame, in its forecast profile (`?view=map&fill=1&ui=forecast`): Ocean shows the North Atlantic's wave height with GFS's sea-level pressure, the lows and highs and the storms' tracks (its "Pressure & storms" layer), Region the swell headed for the spot, Fishers each swell's landing rays coloured like its row. The tab sends it the hour, spot and zoom (`postMessage {type: 'lcc-fc', time, spot, zoom}`; the map answers `lcc-fc-ready` or `lcc-fc-failed`), and the map's "3D" button opens the Explore tab in 3D at that hour (`x-open-3d`). Reads the Sound Check model through core's `CLEAN.model` (below), and its own data for the buoy check (Open-Meteo's earlier runs at the buoy, `data/verification.json`); `CLEAN.forecastInfo()` is its read-only state for tests, the map's is `CHOC.trip` in the frame. Layout: one column on a phone; from 900 px the timeline on the map (the map the full width, the readout a card over its top-left, zoom and spot top-right, the week docked in a dark band along its bottom). The map's full-screen button posts `lcc-fc-full` to the tab (`research/methods-theme.js` catches it in the frame), which opens its own full screen on any width (map filling the window, a small card, the week, its buttons and the zoom in a dock; one history entry, so Back and Escape close it); the tab answers `lcc-fc-fullstate {on}` and tells the map what covers its edges (`lcc-fc-inset {top, bottom}`). The week chart has two views, Models | Swells (`localStorage lcc-f-chart`): the models as lines, or the mean stacked by where the swell comes from (`CLEAN.model.fam`, `FAM` colours). `forecastInfo()` carries `view`, `full` and `layout` (`phone` \| `wide` \| `full`). On core's `refresh` event (the header's ↻) it tells the map to ask for the newest run too (`lcc-fc-refresh`) and fetches the buoy check's earlier forecasts and readings again |
| `map.js` + `map.css` | Map | Explore tab (id `map`, `#map`): frames `map/index.html`, the Sound Check map's past days (`ui=explore`: the ten years month by month beside them, Drop a wave) and the sea floor in 3D from its "3D" button; `x-open-3d` (from the Forecast map) opens it in 3D at a spot and hour. When a session is saved, edited or deleted (`log` with a new `CLEAN.logRev()`) it posts `lcc-log` to the frame; `map/page.js` passes it to the research page, whose ten years read the log again |
| `methods.js` + `methods.css` | Methods | Methods tab, the research explanation. Posts `lcc-log` to its frame as Explore does |
| `log.js` + `log.css` | Log | Log tab |
| `model.js` + `model.css` | Model | My ratings tab (id `model`): the surf-log rating models |
| `tv.js` + `tv.css` | TV | Choc TV (`?kiosk=1`) on the Sound Check model (`CLEAN.model`, the Forecast tab's number): day cards with Choc's biggest over the day's incoming tide in daylight and the main swell then; the radar playing the run's daylight steps with each swell's share of Choc (arrows in its colour, thicker for a bigger share) and the week strip (Choc's height). The low, wind, sun and moon come from `CLEAN.data.week()`. Asks `CLEAN.model.refresh()` every 30 min; `CLEAN_TV` is its test hook |

Parts must not edit `core.js`, `theme.js`, `theme.css`, `base.css`, this file,
`index.html`, `app.js`, `kiosk.js`, `firebase-config.js` or `style*.css`. If a
part needs a helper core does not have, it writes it locally in its own file
(and says so in its result).

`index.html` writes `previews/clean/theme.css` after `style.css` and
`previews/clean/theme.js` after `kiosk.js`, so every app.js / kiosk.js /
firebase-config.js global (`STATE`, `CONFIG`, `loadAllData`, `kioskDaySummary`,
`signInWithGoogle`, …) already exists when the parts run. Classic scripts only:
no modules, no bundler. Wrap each file in an IIFE and keep its globals inside.

## What core does at load

1. Picks the theme (below), sets `html[data-clean-theme]`.
2. Builds the shell:
   - **phone**: `#cl-app.cl` = header (`h1` title + date, ↻ on the Forecast tab, Settings button), five
     views `#cl-view-forecast|map|methods|log|model` (`section.cl-view`), fixed tab bar
     (at the bottom on a phone; across the top, icon beside label, from 900 px wide);
     My ratings (`model`) is shown only for a signed-in, nonanonymous account;
   - **Choc TV** (`isKioskMode()`): one empty `#cl-tv.cl` (fixed, full screen).
3. Sets `html.cl-on` (and `html.cl-tv` on the TV). `theme.css` hides app.js's
   engine room (`#app-window`: the surf-log form and the rating panels My ratings
   borrows) and kiosk.js's Sources overlay until tv.js adopts it. A node a part
   moves into its own root becomes visible again (a canvas then needs
   `invalidateCanvasDPR(cv)` and a redraw).
4. Wraps app globals by name (see Events). app.js starts itself on
   DOMContentLoaded (`startApp`: no boat question any more).
5. On the phone, at DOMContentLoaded, a tab whose part did not register (or whose
   `mount` threw) shows "This screen didn't load." with a Reload button. On the TV,
   if no `tv` part has mounted 1.5 s after `load`, core calls `lccDown(why)`.
6. If core itself throws at boot, or the page's scripts never brought it up within
   5 s of DOMContentLoaded, `index.html`'s `lccDown(why)` shows its own card
   (`html.lcc-down`, inline styles, no look files needed): "LetsCheckChoc didn't
   start" with Reload; on Choc TV a line saying it tries again by itself, and
   kiosk.js does (`kioskSelfHealTick`: a minute later, then every 5 min, through
   `kioskTryReload`'s guards and probe). There is no other look to fall back to.

Deep links: `#forecast`, `#map`, `#methods`, `#log`, `#model`, `#settings`.
The tab hash follows navigation. A signed-out `#model` opens the Log login page.

## Parts: register, mount, render

```js
(function () {
  'use strict';
  if (!window.CLEAN) return;            // core failed: index.html's card is showing
  var root;
  CLEAN.register('forecast', {          // 'forecast' | 'map' | 'methods' | 'log' | 'model' | 'tv'
    mount: function (el) {              // once; el = #cl-view-forecast (or #cl-tv)
      root = el;
      el.innerHTML = '<div class="cl-f-now"></div>';
    },
    render: function (reason) {         // idempotent, cheap; core wraps it in try/catch
      var n = CLEAN.data.now();
      root.querySelector('.cl-f-now').textContent = n.swell ? CLEAN.fmt.swell(n.swell.h, n.swell.period) : '—';
    },
    onTheme: function (t) {},           // optional: 'day' | 'night' (CSS vars usually suffice)
    onShow: function () {}              // optional (phone): the tab just became visible
  });
})();
```

- `register(name, def)` → `true` | `false`. Phone parts are ignored on the TV and
  `tv` is ignored on the phone (registered, never mounted).
- `render(reason)` is called with `'mount'` (right after mount), `'data'` (a
  forecast was painted or a load finished, coalesced to one call per tick),
  `'show'` (phone: the tab was opened), `'model'` (the surf-log models were
  retrained), `'request'` (`CLEAN.render(name)`). Hidden tabs are rendered too
  (they are `display:none`, so do not measure inside them; use SVG viewBoxes or
  re-measure on `'show'`).
- Wrap event handlers you add yourself with `CLEAN.guard('where', fn)`; a thrown
  error is recorded in `CLEAN.errors` instead of escaping.
- `CLEAN.render(name?, reason?)` re-renders one part (or all).
- `CLEAN.part(name)` → `{ mounted, failed }` | `null`.
- `CLEAN.root(name)` → the part's root element.

## Shell (phone)

| Call | Does |
|---|---|
| `CLEAN.show(tab)` | Switch to `'forecast' \| 'map' \| 'methods' \| 'log' \| 'model'` (`'map'` is the Explore tab; 120 ms fade, scroll remembered per tab). Log and My ratings also run app.js's `switchTab`; Explore/Methods own their viewers. Signed-out Model requests open Log. Tapping the active tab scrolls to the top. |
| `CLEAN.tab()` | Current tab (`'tv'` on the TV) |
| `CLEAN.setTitle(tab, title, sub?)` | Override the header for a tab; `CLEAN.setTitle(tab, null)` restores the default. Defaults: Forecast "Today"/"Tonight" + "Thu 1 Oct", Log "Log", My ratings "My ratings". |
| `CLEAN.refresh()` | The header's ↻ (Forecast tab only): everything the tab shows, now. The wind, tides and buoy (`loadAllData`, unless a load is running), the Sound Check run (`CLEAN.model.refresh()`), and event `refresh` for the parts' own copies. For 8 s the header says what came of it in place of the date ("New forecast: run 2:00 PM", "Up to date: run 11:00 AM", "No forecast published on GitHub yet", "Couldn’t reach GitHub"). One at a time. → `Promise<'new' \| 'same' \| 'none' \| 'unreachable'>` |
| `CLEAN.openSettings(section?)` | Opens Settings; `section` scrolls to `'account' \| 'display' \| 'forecast' \| 'sources' \| 'spot'` (e.g. the Forecast part's Details › Data sources row). |
| `CLEAN.sub.open({ id, title, mount(body, handle), onClose })` | A full-screen sub-page with a back chevron and a serif title (the Settings pattern). One history entry, so the iPhone back swipe, the browser Back and Escape close it. Returns `handle = { el, body, close(), setTitle(t) }`. Stackable. |
| `CLEAN.sub.close()` / `.depth()` / `.top()` | Close the top page / how many are open / its handle |

The tab bar and header are hidden while a sub-page is open (as on the Settings
board). Settings is core's: Account (Sign in with Google / Sign out), Display
(the four theme modes), Forecast model (picker sub-page, reloads), Data sources
(per-source time; amber stale, red dead), and Spot and buoy (sub-page: forecast
point, buoy-coords switch, station ids, swell window), and Surf log: Export CSV and Export JSON (when there are entries), Import JSON
and Fetch conditions again (signed in), app.js's `exportCSV`, `exportJSON`,
`importJSON` and `backfillAllSessionsFromArchive`. The old look is gone; an old
`?classic=1` link opens this one.

## Theme

- `CLEAN.theme()` → `'day' | 'night'` (also `html[data-clean-theme]`).
- `CLEAN.themeMode()` → `'light'` (default) `| 'sunset' | 'system' | 'dark'`.
- `CLEAN.setThemeMode(mode)`; stored in `localStorage lcc-clean-display`.
- `'sunset'`: night from sunset to sunrise at the spot (`calcDaylight`), checked
  every minute; the colours fade over 400 ms, layout never moves. Choc TV always
  follows the sun. Reduced motion: no fades or slides anywhere.
- Event `'theme'` (`t`) and the part's `onTheme(t)`.
- `CLEAN.bindFrameTheme(iframe)` sends `{ type: 'lcc-theme', theme: 'day'|'night' }`
  to a same-origin frame on load and theme changes. Returns an unsubscribe
  function. Embedded pages must check the message origin and parent source.

## Events

`CLEAN.on(evt, fn)` returns an unsubscribe function; `CLEAN.off(evt, fn)`;
`CLEAN.emit(evt, arg)` for your own `x-…` events between parts.

| Event | Arg | When (hook) |
|---|---|---|
| `data` | `{ reason: 'forecast' \| 'health' }` | After `renderForecastSet` (cache pre-paint and post-fetch) and `recordDataHealth` (end of every load); coalesced. Parts' `render('data')` runs first. |
| `model` | — | After `slRetrain` (model scores changed) |
| `log` | — | After `surfLogChanged` (surf log changed or loaded, or the Log tab opened), coalesced. `CLEAN.logRev()` is a short key that changes only when a session is added, edited or deleted, or finishes saving to the cloud: compare it before costly work |
| `auth` | `CLEAN.auth()` | After `updateAuthUI` (sign in / out / anonymous) |
| `authStatus` | `{ available, pending, error }` | Google popup starts, finishes, or fails |
| `soundcheck` | `CLEAN.model.state` | A Sound Check run is in, a newer one replaced it, or none could load |
| `refresh` | — | The header's ↻ was tapped (`CLEAN.refresh()`): fetch your own copies again |
| `tab` | `tab` | Tab switched |
| `sub` | `{ id, open }` | Sub-page opened / closed |
| `theme` | `'day' \| 'night'` | Theme flipped |
| `themeMode` | mode | Display setting changed |
| `tick` | — | Every minute (and when the page becomes visible): update ages and clocks |

On the phone core also refreshes the data in the background once the last load
is 15 min old (Choc TV refreshes itself), so stale and dead stay rare and true.
It also recovers a boot that never loaded: initApp fetches the buoy and
tide-station lists once, so from 15 s after boot, at most once a minute, core
re-fetches whichever list is still empty and selects the home spot (Choc TV
has kiosk.js `kioskEnsureStatic` / `kioskEnsureSelected` for the same).

## Data — `CLEAN.data`

All calls are null-safe (a failure returns the empty shape and is logged in
`CLEAN.errors`), memoized per data generation, and never invent values: a
missing reading is `null`, shown as "—". Heights are feet, wind mph, angles are
degrees FROM (meteorological). Times are `Date`s. Window `status` is
`'in'` (115–158°) `| 'edge'` (within 5°) `| 'blocked'` `| null` (no direction).
Wind `quality` is `'offshore' | 'cross' | 'onshore' | null`: offshore centre 335°
(the reef faces 335°), under 60° off it offshore, under 120° cross, else onshore;
under 5 mph upgrades one tier (the app chart's rule).

`now()` and `hour(idx)` read the forecast hour itself, as the app's chart and
cards do (`marineNowIndex`, the current local hour). The **hero** train is
**reach first**: among the trains that reach the reef (`'in'` or `'edge'`), the
one carrying more in-window energy (alignment × H², app.js `_alignmentScore`);
only when none reach does the bigger-energy train lead (and read BLOCKED). So a
bigger 4 s wind swell from 174° never buries the 9 s groundswell from 124°. The
other train goes to `others` (and to `blocked` when it is blocked: the Now
block's dim "1.6 ft @ 4 s S · blocked" line). `week()` comes from Choc TV's
`kioskDaySummary` (swell over the daylight incoming-tide windows, sampled one
swell-travel lag earlier), with the same reach-first swap per day. Model scores
use the app's `buildForecastConditions` + `predict*Rating`.

Sources: the wave forecast (`marine`) lives only in `STATE.forecastData`, which
app.js sets only when the marine fetch (or its saved copy) worked. The wind
forecast and the CO-OPS tides load on their own: core reads them from the
newest forecast paint (`renderForecastSet`'s context, kept as `CLEAN._ctx`,
which carries them even when the marine forecast is missing), else from
`STATE.forecastData`. With the wave forecast down, `now().wind`, `now().tide`,
`tideEvents()`, `tideCurve()`, `nextWindow()` and every `week()` day's
`low` / `lows` / `window` / low wind still come through; the swell readings
are `null`.

```
Train  = { h, period, dir, compass, status, energy, train: 'primary'|'secondary' }
Wind   = { mph, gust, dir, compass, quality }
```

| Call | Returns |
|---|---|
| `now()` | `{ at, idx, swell: Train\|null, others: [Train], blocked: [Train], status, wind: Wind\|null, tide: { h, rising, nextLow: {t,h}, nextHigh: {t,h}, prevLow, prevHigh }\|null, model: number\|null, buoy: Buoy\|null, updatedAt: Date\|null, freshness, night, afterDark, loaded }` |
| `hour(idx)` | `{ idx, at, swell, others, blocked, status, wind, tide: { h, rising }\|null, night, dark, past }` or `null` (idx is the marine hourly index, `STATE.forecastData.marine.hourly.time`) |
| `hours()` | `hour(i)` for every forecast hour (≈ 7–8 days), for the chart |
| `nowIndex()` | Current hour index (`-1` before data) |
| `indexAt(t)` | Hour index nearest `t` (within 90 min), `-1` otherwise |
| `timeAt(idx)` | `Date` of hour idx |
| `week()` | 7 × `{ offset, date, label: 'Today'\|'Fri', longLabel: 'Today'\|'Tomorrow'\|'Saturday', swell: Band\|null, other: Band\|null, status, reaches, low: Low\|null, lows: [Low], window: {start, end}\|null, sun: {firstLight, sunrise, sunset, lastLight}\|null, moon: {pct, icon}\|null, model: number\|null, tidesDown }` |
| | `Band = { min, max, period, dir, compass, status }` (whole feet). `swell` is the band that reaches the reef when either does (a blocked bigger band moves to `other`); `reaches` is false only when neither reaches: "Nothing reaches the reef". `swell`/`other` are `null` without a wave forecast, while the tide and wind fields still fill |
| | `Low = { t, h, until (next high), untilH, wind: Wind\|null, idx, daylight }`; `low` is the day's first daylight low, else the first whose incoming tide reaches daylight, else the first. `wind` is the wind forecast's nearest hour; `idx` is `-1` without a wave forecast |
| `nextWindow()` | Next incoming tide (low → high) that reaches daylight and has not ended: `{ t (low), until, h, start (daylight start), dayOffset, label: 'Today'\|'Tomorrow'\|'Fri' }` or `null` |
| `modelAt(idx)` | Your model's score at hour idx: average of the available size / ride / wind predictions, one decimal, `null` when untrained |
| `ratingsAt(idx)` | `{ size, ride, wind, avg }` or `null` |
| `tideAt(t)` | `{ h, rising }` or `null` (null outside the predictions, never a made-up 0) |
| `windAt(t)` | `Wind` from the wind forecast's nearest hour (within 90 min) or `null`; works without a wave forecast (kiosk.js `kioskWindAt` reads only `STATE.forecastData`) |
| `tideEvents()` | `[{ t, h, type: 'H'\|'L' }]` (CO-OPS hi/lo, ~10 days) |
| `tideCurve()` | `[{ t, h }]` (6-min predictions, 7 days) |
| `buoy()` | `Buoy = { h, period, dir, compass, total, band, obsAt, ageMin, level: 'fresh'\|'stale'\|'dead', reachesAt }` or `null`. `h/period/dir` are the 8 s+ swell band of the buoy spectrum when the pipeline has one (`band: true`), else WVHT/DPD/MWD; `total` is WVHT. `reachesAt` = obs time + buoy-to-reef travel. Stale past 2 h, dead past 6 h. |
| `sun(t?)` | `{ firstLight, sunrise, sunset, lastLight }` for t's day at the spot |
| `isNight(t?)` | Sunset → sunrise (the theme's rule) |
| `isAfterDark(t?)` | Last light → first light: the boards' "Tonight" (6:40 PM is still Today; 9:30 PM is Tonight) |
| `darkUntil(t?)` | Next first light while after dark ("Dark until 6:18 AM"), else `null` |
| `freshness()` | `'loading' \| 'fresh' \| 'stale' \| 'dead'`: Choc TV's thresholds on `STATE.dataAsOf` (stale past 40 min or a saved copy after a failed refresh, dead past 3 h or no forecast). `'loading'` only until the first load completes, and at most a minute after boot unless a load is in flight: then `'dead'`, so screens say the forecast didn't load instead of "Loading…" forever |
| `sources()` | `[{ key: 'marine'\|'wind'\|'tides'\|'buoy', label, at, origin, level: 'fresh'\|'stale'\|'dead'\|'none', text }]` (Settings › Data sources, TV Sources). Tide predictions are astronomical: a saved copy is never stale. `text` is "Loading" while `freshness()` is `'loading'`, then "Not loaded" / "No reading". |
| `lagHours()` | Swell travel from the forecast point to the reef (1, or 2 with the buoy-coords setting) |
| `loaded()` / `generation()` | A forecast is in / a counter that changes whenever the data under the readings changes |

### The Sound Check model — `CLEAN.model`

The wave forecast the Forecast tab and Choc TV show: GFS-Wave and ECMWF read at
buoy 44097 and carried over the sea floor to Choc and Wilderness
(`scripts/forecast/fcpull.py`), from `research/fc/fc.json` or the forecast bot's
newer pull on the fc-data branch, whichever is newer. One copy per page, so the
two screens can't disagree.

| Member | What |
|---|---|
| `state` | `{ steps, made, runs, buoy, status: 'loading' \| 'ok' \| 'failed', checkedAt }`, read only. A step: `{ t, hs, trains, choc: { g, e, m }, wild: { g, e, m } }`: `g` GFS-Wave, `e` ECMWF (null without a row there), `m` their mean (one model when the other has no number); `hs` offshore at the buoy (GFS-Wave); `trains` GFS-Wave's swells at the buoy, each with its height at both spots. Every 3 h, 6 h after day 6 |
| `load()` | Fetch once (shipped copy, then the pull); later calls do nothing. Raises `soundcheck` |
| `refresh()` | Ask again (the pull past GitHub's cache; the shipped copy too while nothing has loaded), after the first load, one ask at a time. → `Promise<'new' \| 'same' \| 'none' \| 'unreachable'>`: a newer run went up, the newest is on show already, GitHub has none published, GitHub didn't answer |
| `stepAt(t)` / `nowStep()` | The step nearest a time / now, or -1 when the run doesn't cover it (3 h before its first step to 90 min after its last) |
| `at(t, spot)` | The spot's height (`'choc'` \| `'wild'`) at any time inside the run: the mean, straight between the steps either side; null outside it |
| `parts(step, spot)` | The step's swells with their share of the energy reaching the spot (`{ t: train, v, share }`), biggest first, shares under half a percent left off |
| `FAM`, `fam(deg)` | Where a swell comes from (E, SE, S, other) and its colour, the same on every screen and on the map's rays |

## Formatting — `CLEAN.fmt`

One number style everywhere, the boards': **one decimal, a trailing ".0"
dropped** (1.6 ft, 1 ft, 2 ft, 0 ft, never "-0"), whole feet from 10 ft, day
bands in whole feet ("1–2 ft"). Tide heights and model scores follow the same
rule ("2.3 ft ▲", "2 ft", "−0.4 ft", "3.8 / 10", "3 / 10"). Use these calls
instead of `toFixed` so every screen agrees. Between a number and its unit, and
before AM/PM, the space is a **no-break space** (`CLEAN.fmt.NB`, U+00A0) so
"8 s" or "7:28 AM" never wraps. Missing → `CLEAN.fmt.DASH` ("—"). Clock times
are in the spot's time zone (America/New_York).

| Call | Example |
|---|---|
| `swell(h, period, dir?)` | `swell(1.575, 8.15)` → "1.6 ft @ 8 s"; `swell(1.0, 9)` → "1 ft @ 9 s"; `swell([1, 2], 8, 'ESE')` → "1–2 ft @ 8 s ESE"; `swell(1.6, null)` → "1.6 ft @ —"; `swell(null, 8)` → "—" |
| `num(h)` / `ft(h)` | "1.6" / "1.6 ft"; `ft(2)` → "2 ft", `ft(0.96)` → "1 ft", `ft(12.4)` → "12 ft" |
| `range(min, max)` | "1–2", "1" |
| `period(p)` | "8 s" |
| `compass(deg)` / `deg(deg)` | "ESE" / "118°" |
| `wind(mph, dir?)` | "7 mph SW" |
| `tide(h, rising?)` | "2.3 ft ▲", "2 ft", "0 ft", "−0.4 ft ▼"; `arrow(rising)` → "▲"/"▼"/"" |
| `time(t)` | "7:28 AM" |
| `day(t)` / `dayLong(t)` / `date(t)` | "Thu" / "Thursday" / "Thu 1 Oct" |
| `dayLabel(t, { tomorrow })` | "Today" / "Tomorrow" / "Fri" |
| `when(t)` | "11:00 AM" today, "Wed 6:12 PM" otherwise |
| `ago(t)` / `age(t)` | "2h 30m ago" / "2h 30m old" (the app's `formatAgo`) |
| `quality(q, style?)` | "cross"; `'long'` → "cross-shore"; `'caps'` → "CROSS-SHORE" |
| `status(s, short?)` | "IN WINDOW" / "IN", "EDGE", "BLOCKED" |
| `score(v)` | "3.8", "3" |

`CLEAN.html.status(s, { short, small, pill })` →
`<span class="cl-st cl-st-in"><i class="cl-dt"></i>IN WINDOW</span>` (`small` =
week-row size, `pill` = white on green at night for the Now block).
`CLEAN.html.quality(q, style)` → `<span class="cl-q-crs">cross</span>`.

## Icons — `CLEAN.icon`

Inline SVG strings (`aria-hidden`), paths copied from the boards, round set
(1.75 stroke), `currentColor`. Size in px is the last argument.

| Call | Board |
|---|---|
| `forecast()` `map()` `methods()` `log()` `model()` | Tab icons (24) |
| `settings()` `back()` | Header sliders, sub-page back (22) |
| `chevronRight()` `chevronLeft()` `chevronDown()` | Rows (18) |
| `jumpLeft()` `jumpRight()` `jumpsLeft()` `jumpsRight()` | Chart buttons ‹ › « » (14, 2.5 stroke) |
| `check()` `up()` `down()` `edit()` `trash()` `camera()` | Settings tick, Model ↑/↓, Log row actions, Add photo |
| `swell(fromDeg, 22)` | Solid wedge pointing where the swell **travels** (rotated from + 180°) |
| `wind(fromDeg, 15)` | Feathered line arrow pointing where the wind **blows to** (week rows) |
| `barb(mph, fromDeg, 44)` | Wind barb (A-Wind-Barb): ring where the wind is headed; short tick 5 mph, long 10, flag 50, rounded to 5; calm double ring under 3 mph; ink only. The ladder reads the speed as `fmt.wind` prints it (rounded), so 2.6 mph is "3 mph" with a 5 mph tick, never beside the calm ring |
| `tide(44)` / `tideHigh(44)` | T2 "dashed drop" (low) and its flip (high), in `--tide` |
| `CLEAN.icon.paths` | Raw paths, incl. `chartArrow` (7×7 arrow centred on 0,0 for wind bars inside a chart SVG: `<use>` or `<path d>` with `transform="translate(x,y) rotate(from+180)"`) |

## CSS

Tokens on `html.cl-on` (day) and `html.cl-on[data-clean-theme="night"]`:
`--bg --ink --muted --hair --in --chip --edge --edge-fill --blk --blk-fill --off
--crs --on --tide --amber --red --shade --ghost`, plus `--gut` (16 px), `--r`
(12 px), `--tab-h`, `--sans`, `--serif`, `--mono`. Values and contrasts are
A2-Tokens'. Red is dead data only, amber stale data only.

Every clean root has class `.cl` (zero-specificity reset via `:where(.cl)`, so a
part's single class always wins). The exception is the keyboard focus ring:
`.cl :focus-visible` / `.cl button:focus-visible` (… `a`, `input`, `select`,
`textarea`, `summary`) draw `2px solid var(--in)`, offset 2 px, at 0,2,0 / 0,2,1
so style.css's app-wide slate-blue ring loses. To change the ring on your
own control, write `.cl .cl-x:focus-visible` (0,3,0), or a single-class rule
on a non-form element (later file, same 0,2,0). The phone sets
`scroll-padding-bottom` on `html` so a focused control scrolls into view above
the tab bar. Shared classes in `base.css`:

| Class | Use |
|---|---|
| `.cl-serif` | Headings and subtitles only (lining numerals) |
| `.cl-h2` | Section heading (serif 21/500, 42 px, gutter) |
| `.cl-gap` | 28 px between sections |
| `.cl-pad` / `.cl-lead` / `.cl-lab` / `.cl-muted` | Gutter padding / lead line / small label / muted text |
| `.cl-fine` (+ `.cl-stale`, `.cl-dead`) | 12.5 px fine print, data age |
| `.cl-list` + `.cl-sr` (`<small>`, `.cl-v`, `.cl-ck`) | Settings-style rows, 56 px, hair rule on top |
| `.cl-dr`, `.cl-kv` | Detail rows (52 px), key/value grid (`1fr auto`, values share one left edge, 600 weight) |
| `.cl-st` `.cl-st-in\|edge\|blk` `.cl-dt` (`.cl-st-sm`, `.cl-st-pill`) | Window status tag |
| `.cl-q-off\|crs\|on` | Wind words |
| `.cl-chips` `.cl-chip` (`.on` / `aria-pressed`) | 44 px pills |
| `.cl-btn` (`.cl-btn-fill`, `.cl-btn-quiet`, `.cl-btn-block`) | Ink outline / filled / hair outline buttons |
| `.cl-seg` | Segmented control (AM / PM) |
| `.cl-switch` inside `[role=switch][aria-checked]` | Toggle |
| `.cl-ic`, `.cl-barb`, `.cl-ic-tide` | Icons |
| `.cl-sr-only`, `.cl-nowrap`, `.cl-num` | Helpers |

Part classes are prefixed `cl-f-` (forecast), `cl-l-` (log), `cl-m-` (model),
`cl-tv-` (TV). Style only inside your own root; never restyle `.cl-hd`,
`.cl-tabs` or `#cl-tv` itself.

The current tab is also on `html[data-active-tab]`. Explore and Methods use a
1440 px maximum shell width, Forecast 1200 px (from 900 px the map takes the width, the readout and the week over it);
other tabs remain 640 px. Add `.cl-wide-view` to
a `.cl-sub` for a 1440 px comparison window.

## Rules every part keeps

- Missing data stays `null` and shows "—", never 0. Never edit `data/*.json`.
- Never re-save another crew member's surf-log entry (`saveLogEntryToFirebase`
  refuses; check `entry.userId === CLEAN.auth().uid` before offering Edit/Delete).
- Red only for dead data, amber only for stale. Name the location where a
  choice between Chocomount and the Race would otherwise be ambiguous.
- 44 px touch targets, tabular numerals (the default), no horizontal scroll at
  375–414 px, reduced motion respected (`CLEAN.util.reducedMotion()`).
- To hook an app global, wrap it in your own file the way core does:
  `var orig = window.fn; window.fn = function () { var r = orig.apply(this, arguments); try { … } catch (e) { CLEAN.err('x', e); } return r; };`
  Keep the original behaviour; never replace a function another part or kiosk.js
  relies on without calling through.
- Choc TV: `tv.js` owns `#cl-tv`. kiosk.js is the appliance underneath (rotation
  timers, 15-min refresh, self-heal reloads, `kioskPause` on every pointerdown) and
  draws nothing; tv.js reuses `KIOSK_COAST`, `kioskWindAt`, the rotation and the
  Sources overlay. Its swell is `CLEAN.model`'s, not kiosk.js's `kioskDaySummary`.

## Utilities

`CLEAN.util`: `esc(s)`, `h(tag, attrs, html|nodes)` (attrs `class`, `aria-*`,
`onclick: fn`), `isNum`, `round1`, `clamp`, `toDate`, `dayKey(t)` ("2026-10-01",
spot time), `startOfDay(t, days)`, `reducedMotion()`, `statusFor(deg)`,
`alignment(deg)`, `windQuality(mph, deg)`, `qualityClass(q)`, `statusClass(s)`,
`steadyRuns(calls, minHours = 3)` (hourly in / edge / blocked calls with any call
under `minHours` folded into its neighbour, shortest first; `null` hours stay
gaps: the phone chart's and the TV strip's window band).

Auth: `CLEAN.auth()` → `{ signedIn, uid, name }`; `CLEAN.signIn()`;
`CLEAN.signOut()`; `CLEAN.authStatus()` → `{ available, pending, error }`.
Anonymous Firebase sessions do not count as signed in. The Log gate uses the
existing Google account linking/migration flow; signing out hides the form,
past sessions and Model tab without removing saved data.

Errors: `CLEAN.errors` (`[{ where, message, at }]`), `CLEAN.err(where, e)`,
`CLEAN.guard(where, fn)`. `CLEAN.ready` is true once the shell is up;
`CLEAN.isTV`.

## Screenshots

`scratchpad/clean/shootlib.js` runs the real app offline on the fixtures
(clock 2026-10-01 11:00 ET; the repo working tree is served, so these files are
live). See its header; `shoot-core.js` is a full example. `L.check(h, label)`
prints page errors, console errors, `CLEAN.errors`, horizontal scroll, targets
under 44 px and text under 10 px for the state on screen.
