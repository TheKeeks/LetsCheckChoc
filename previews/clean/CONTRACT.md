# `?preview=clean` — the CLEAN contract

The "A refined" boards from Claude Design, built as a preview look over the
**real** app with live data. The plain URL does not change. This file is the
shared API that `core.js` gives the four parts. It is owned by Core: parts
read it and do not edit it.

## Files and owners

| File | Owner | What |
|---|---|---|
| `theme.css` | Core | Tokens (day, and night under `html[data-clean-theme="night"]`), legacy hiding, `@import`s the five files below |
| `base.css` | Core | Scoped reset, phone shell, sub-page, shared classes (below) |
| `theme.js` | Core | Loader: `document.write`s `core.js`, `forecast.js`, `log.js`, `model.js`, `tv.js` in that order |
| `core.js` | Core | `window.CLEAN`: shell, theme, gate skip, data adapters, formatting, icons, events, Settings |
| `forecast.js` + `forecast.css` | Forecast | Forecast tab (Now block, This week, chart, lineup, details) |
| `log.js` + `log.css` | Log | Log tab |
| `model.js` + `model.css` | Model | Model tab |
| `tv.js` + `tv.css` | TV | Choc TV (`?kiosk=1`) |

Parts must not edit `core.js`, `theme.js`, `theme.css`, `base.css`, this file,
`index.html`, `app.js`, `kiosk.js`, `firebase-config.js` or `style*.css`. If a
part needs a helper core does not have, it writes it locally in its own file
(and says so in its result).

`index.html` writes `previews/clean/theme.css` after `styles-kiosk.css` and
`previews/clean/theme.js` after `kiosk.js`, so every app.js / kiosk.js /
firebase-config.js global (`STATE`, `CONFIG`, `loadAllData`, `kioskDaySummary`,
`signInWithGoogle`, …) already exists when the parts run. Classic scripts only:
no modules, no bundler. Wrap each file in an IIFE and keep its globals inside.

## What core does at load

1. Picks the theme (below), sets `html[data-clean-theme]`.
2. Removes `body[data-era]` (the Win95 styles hang off it) and builds the shell:
   - **phone**: `#cl-app.cl` = header (`h1` title + date, Settings button), three
     views `#cl-view-forecast|log|model` (`section.cl-view`), fixed tab bar;
   - **Choc TV** (`isKioskMode()`): one empty `#cl-tv.cl` (fixed, full screen).
3. Sets `html.cl-on` (and `html.cl-tv` on the TV). Only then does `theme.css`
   hide the legacy chrome (`#gate-overlay`, `#app-window`, `#kiosk-status`,
   `#kiosk-stale-banner`, `#kiosk-info-overlay`) with `display:none`. The legacy
   nodes stay in the DOM: STATE, the scrubber, the surf-log inputs and the
   kiosk timers keep working. A legacy node a part moves into its own root
   becomes visible again (a canvas then needs `invalidateCanvasDPR(cv)` and a
   redraw).
4. Wraps app globals (see Events) and stubs `startNowPulse` (the hidden legacy
   chart's 10 fps pulse).
5. Skips the boat gate: after app.js's `initGate` (DOMContentLoaded) it takes the
   gate's "No, continue" path (`boatGatePassed`, show app, `initApp()`) **without**
   writing `sessionStorage lcc-gate`, so the plain URL still asks. Choc TV's gate
   is already seeded by kiosk.js.
6. On the phone, at DOMContentLoaded, a tab whose part did not register (or whose
   `mount` threw) shows "This screen didn't load. Open the classic view". On the
   TV, if no `tv` part has mounted 1.5 s after `load`, core unmounts itself and
   the classic Choc TV takes the screen back (a kiosk never sits blank).
7. If core itself throws at boot it unmounts: the page is the classic app.

Deep links (handy for screenshots): `?preview=clean#log`, `#model`, `#settings`.

## Parts: register, mount, render

```js
(function () {
  'use strict';
  if (!window.CLEAN) return;            // core failed: the classic app is showing
  var root;
  CLEAN.register('forecast', {          // 'forecast' | 'log' | 'model' | 'tv'
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
| `CLEAN.show(tab)` | Switch to `'forecast' \| 'log' \| 'model'` (120 ms fade, scroll remembered per tab, also runs the app's own `switchTab` so Tab 2/3 renderers and `STATE.activeTab` stay in step). Tapping the active tab scrolls to the top. |
| `CLEAN.tab()` | Current tab (`'tv'` on the TV) |
| `CLEAN.setTitle(tab, title, sub?)` | Override the header for a tab; `CLEAN.setTitle(tab, null)` restores the default. Defaults: Forecast "Today"/"Tonight" + "Thu 1 Oct", Log "Log", Model "Your model". |
| `CLEAN.openSettings(section?)` | Opens Settings; `section` scrolls to `'account' \| 'display' \| 'forecast' \| 'sources' \| 'spot'` (e.g. the Forecast part's Details › Data sources row). |
| `CLEAN.sub.open({ id, title, mount(body, handle), onClose })` | A full-screen sub-page with a back chevron and a serif title (the Settings pattern). One history entry, so the iPhone back swipe, the browser Back and Escape close it. Returns `handle = { el, body, close(), setTitle(t) }`. Stackable. |
| `CLEAN.sub.close()` / `.depth()` / `.top()` | Close the top page / how many are open / its handle |

The tab bar and header are hidden while a sub-page is open (as on the Settings
board). Settings is core's: Account (Sign in with Google / Sign out), Display
(the four theme modes), Forecast model (picker sub-page, reloads), Data sources
(per-source time; amber stale, red dead), Spot and buoy (sub-page: forecast
point, buoy-coords switch, station ids, swell window), and a link back to the
classic view.

## Theme

- `CLEAN.theme()` → `'day' | 'night'` (also `html[data-clean-theme]`).
- `CLEAN.themeMode()` → `'sunset'` (default) `| 'system' | 'light' | 'dark'`.
- `CLEAN.setThemeMode(mode)`; stored in `localStorage lcc-clean-display`.
- `'sunset'`: night from sunset to sunrise at the spot (`calcDaylight`), checked
  every minute; the colours fade over 400 ms, layout never moves. Choc TV always
  follows the sun. Reduced motion: no fades or slides anywhere.
- Event `'theme'` (`t`) and the part's `onTheme(t)`.

## Events

`CLEAN.on(evt, fn)` returns an unsubscribe function; `CLEAN.off(evt, fn)`;
`CLEAN.emit(evt, arg)` for your own `x-…` events between parts.

| Event | Arg | When (hook) |
|---|---|---|
| `data` | `{ reason: 'forecast' \| 'health' }` | After `renderForecastSet` (cache pre-paint and post-fetch) and `recordDataHealth` (end of every load); coalesced. Parts' `render('data')` runs first. |
| `model` | — | After `slRetrain` (model scores changed) |
| `log` | — | After `renderSurfLogTable` (surf log changed / loaded), coalesced |
| `auth` | `CLEAN.auth()` | After `updateAuthUI` (sign in / out / anonymous) |
| `hour` | `idx` | After `applyScrubberToHour` (the shared cursor moved; Choc TV's radar playback fires this every step) |
| `tab` | `tab` | Tab switched |
| `sub` | `{ id, open }` | Sub-page opened / closed |
| `theme` | `'day' \| 'night'` | Theme flipped |
| `themeMode` | mode | Display setting changed |
| `tick` | — | Every minute (and when the page becomes visible): update ages and clocks |

On the phone core also refreshes the data in the background once the last load
is 15 min old (Choc TV refreshes itself), so stale and dead stay rare and true.

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
cards do (`marineNowIndex`, the current local hour). The **hero** train is the
one carrying more in-window energy (alignment × H², app.js `_alignmentScore`),
the same rule as Choc TV's day hero; the other train goes to `others` (and to
`blocked` when it is blocked). `week()` comes from Choc TV's `kioskDaySummary`
(swell over the daylight incoming-tide windows, sampled one swell-travel lag
earlier). Model scores use the app's `buildForecastConditions` + `predict*Rating`.

```
Train  = { h, period, dir, compass, status, energy, train: 'primary'|'secondary' }
Wind   = { mph, gust, dir, compass, quality }
```

| Call | Returns |
|---|---|
| `now()` | `{ at, idx, swell: Train\|null, others: [Train], blocked: [Train], status, wind: Wind\|null, tide: { h, rising, nextLow: {t,h}, nextHigh: {t,h}, prevLow, prevHigh }\|null, model: number\|null, buoy: Buoy\|null, updatedAt: Date\|null, freshness, night, afterDark, loaded }` |
| `hour(idx)` | `{ idx, at, swell, others, blocked, status, wind, tide: { h, rising }\|null, night, dark, past }` or `null` (idx is the marine hourly index, the same index as `STATE.forecastChart.times` and the app's scrubber) |
| `hours()` | `hour(i)` for every forecast hour (≈ 7–8 days), for the chart |
| `nowIndex()` | Current hour index (`-1` before data) |
| `indexAt(t)` | Hour index nearest `t` (within 90 min), `-1` otherwise |
| `timeAt(idx)` | `Date` of hour idx |
| `week()` | 7 × `{ offset, date, label: 'Today'\|'Fri', longLabel: 'Today'\|'Tomorrow'\|'Saturday', swell: Band\|null, other: Band\|null, status, reaches, low: Low\|null, lows: [Low], window: {start, end}\|null, sun: {firstLight, sunrise, sunset, lastLight}\|null, moon: {pct, icon}\|null, model: number\|null, tidesDown }` |
| | `Band = { min, max, period, dir, compass, status }` (whole feet; `reaches` is false when the hero is blocked: "Nothing reaches the reef") |
| | `Low = { t, h, until (next high), untilH, wind: Wind\|null, idx, daylight }`; `low` is the day's first daylight low, else the first whose incoming tide reaches daylight, else the first |
| `nextWindow()` | Next incoming tide (low → high) that reaches daylight and has not ended: `{ t (low), until, h, start (daylight start), dayOffset, label: 'Today'\|'Tomorrow'\|'Fri' }` or `null` |
| `modelAt(idx)` | Your model's score at hour idx: average of the available size / ride / wind predictions, one decimal, `null` when untrained |
| `ratingsAt(idx)` | `{ size, ride, wind, avg }` or `null` |
| `tideAt(t)` | `{ h, rising }` or `null` (null outside the predictions, never a made-up 0) |
| `tideEvents()` | `[{ t, h, type: 'H'\|'L' }]` (CO-OPS hi/lo, ~10 days) |
| `tideCurve()` | `[{ t, h }]` (6-min predictions, 7 days) |
| `buoy()` | `Buoy = { h, period, dir, compass, total, band, obsAt, ageMin, level: 'fresh'\|'stale'\|'dead', reachesAt }` or `null`. `h/period/dir` are the 8 s+ swell band of the buoy spectrum when the pipeline has one (`band: true`), else WVHT/DPD/MWD; `total` is WVHT. `reachesAt` = obs time + buoy-to-reef travel. Stale past 2 h, dead past 6 h. |
| `sun(t?)` | `{ firstLight, sunrise, sunset, lastLight }` for t's day at the spot |
| `isNight(t?)` | Sunset → sunrise (the theme's rule) |
| `isAfterDark(t?)` | Last light → first light: the boards' "Tonight" (6:40 PM is still Today; 9:30 PM is Tonight) |
| `darkUntil(t?)` | Next first light while after dark ("Dark until 6:18 AM"), else `null` |
| `freshness()` | `'loading' \| 'fresh' \| 'stale' \| 'dead'`: Choc TV's thresholds on `STATE.dataAsOf` (stale past 40 min or a saved copy after a failed refresh, dead past 3 h or no forecast) |
| `sources()` | `[{ key: 'marine'\|'wind'\|'tides'\|'buoy', label, at, origin, level: 'fresh'\|'stale'\|'dead'\|'none', text }]` (Settings › Data sources, TV Sources). Tide predictions are astronomical: a saved copy is never stale. |
| `lagHours()` | Swell travel from the forecast point to the reef (1, or 2 with the buoy-coords setting) |
| `loaded()` / `generation()` | A forecast is in / a counter that changes whenever the data under the readings changes |

### The shared cursor — `CLEAN.cursor`

The app's scrubber hour, shared by every part: `get()` → idx (the scrubbed hour,
else `nowIndex()`), `set(idx)` (moves the app's scrubber, repaints its hidden
chart, raises `hour`), `reset()` (back to now), `atNow()`.

## Formatting — `CLEAN.fmt`

One number style everywhere. Between a number and its unit, and before AM/PM,
the space is a **no-break space** (`CLEAN.fmt.NB`, U+00A0) so "8 s" or
"7:28 AM" never wraps. Missing → `CLEAN.fmt.DASH` ("—"). Clock times are in the
spot's time zone (America/New_York).

| Call | Example |
|---|---|
| `swell(h, period, dir?)` | `swell(1.575, 8.15)` → "1.6 ft @ 8 s"; `swell([1, 2], 8, 'ESE')` → "1–2 ft @ 8 s ESE"; `swell(1.6, null)` → "1.6 ft @ —"; `swell(null, 8)` → "—" |
| `num(h)` / `ft(h)` | "1.6" / "1.6 ft" (one decimal, whole feet from 10) |
| `range(min, max)` | "1–2", "1" |
| `period(p)` | "8 s" |
| `compass(deg)` / `deg(deg)` | "ESE" / "118°" |
| `wind(mph, dir?)` | "7 mph SW" |
| `tide(h, rising?)` | "2.3 ft ▲", "−0.4 ft ▼"; `arrow(rising)` → "▲"/"▼"/"" |
| `time(t)` | "7:28 AM" |
| `day(t)` / `dayLong(t)` / `date(t)` | "Thu" / "Thursday" / "Thu 1 Oct" |
| `dayLabel(t, { tomorrow })` | "Today" / "Tomorrow" / "Fri" |
| `when(t)` | "11:00 AM" today, "Wed 6:12 PM" otherwise |
| `ago(t)` / `age(t)` | "2h 30m ago" / "2h 30m old" (the app's `formatAgo`) |
| `quality(q, style?)` | "cross"; `'long'` → "cross-shore"; `'caps'` → "CROSS-SHORE" |
| `status(s, short?)` | "IN WINDOW" / "IN", "EDGE", "BLOCKED" |
| `score(v)` | "3.8" |

`CLEAN.html.status(s, { short, small, pill })` →
`<span class="cl-st cl-st-in"><i class="cl-dt"></i>IN WINDOW</span>` (`small` =
week-row size, `pill` = white on green at night for the Now block).
`CLEAN.html.quality(q, style)` → `<span class="cl-q-crs">cross</span>`.

## Icons — `CLEAN.icon`

Inline SVG strings (`aria-hidden`), paths copied from the boards, round set
(1.75 stroke), `currentColor`. Size in px is the last argument.

| Call | Board |
|---|---|
| `forecast()` `log()` `model()` | Tab icons (24) |
| `settings()` `back()` | Header sliders, sub-page back (22) |
| `chevronRight()` `chevronLeft()` `chevronDown()` | Rows (18) |
| `jumpLeft()` `jumpRight()` `jumpsLeft()` `jumpsRight()` | Chart buttons ‹ › « » (14, 2.5 stroke) |
| `check()` `up()` `down()` `edit()` `trash()` `camera()` | Settings tick, Model ↑/↓, Log row actions, Add photo |
| `swell(fromDeg, 22)` | Solid wedge pointing where the swell **travels** (rotated from + 180°) |
| `wind(fromDeg, 15)` | Feathered line arrow pointing where the wind **blows to** (week rows) |
| `barb(mph, fromDeg, 44)` | Wind barb (A-Wind-Barb): ring where the wind is headed; short tick 5 mph, long 10, flag 50, rounded to 5; calm double ring under 3 mph; ink only |
| `tide(44)` / `tideHigh(44)` | T2 "dashed drop" (low) and its flip (high), in `--tide` |
| `CLEAN.icon.paths` | Raw paths, incl. `chartArrow` (7×7 arrow centred on 0,0 for wind bars inside a chart SVG: `<use>` or `<path d>` with `transform="translate(x,y) rotate(from+180)"`) |

## CSS

Tokens on `html.cl-on` (day) and `html.cl-on[data-clean-theme="night"]`:
`--bg --ink --muted --hair --in --chip --edge --edge-fill --blk --blk-fill --off
--crs --on --tide --amber --red --shade --ghost`, plus `--gut` (16 px), `--r`
(12 px), `--tab-h`, `--sans`, `--serif`, `--mono`. Values and contrasts are
A2-Tokens'. Red is dead data only, amber stale data only.

Every clean root has class `.cl` (zero-specificity reset via `:where(.cl)`, so a
part's single class always wins). Shared classes in `base.css`:

| Class | Use |
|---|---|
| `.cl-serif` | Headings and subtitles only (lining numerals) |
| `.cl-h2` | Section heading (serif 21/500, 42 px, gutter) |
| `.cl-gap` | 28 px between sections |
| `.cl-pad` / `.cl-lead` / `.cl-lab` / `.cl-muted` | Gutter padding / lead line / small label / muted text |
| `.cl-fine` (+ `.cl-stale`, `.cl-dead`) | 12.5 px fine print, data age |
| `.cl-list` + `.cl-sr` (`<small>`, `.cl-v`, `.cl-ck`) | Settings-style rows, 56 px, hair rule on top |
| `.cl-dr`, `.cl-kv` | Detail rows (52 px), key/value grid |
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

## Rules every part keeps

- Missing data stays `null` and shows "—", never 0. Never edit `data/*.json`.
- Never re-save another crew member's surf-log entry (`saveLogEntryToFirebase`
  refuses; check `entry.userId === CLEAN.auth().uid` before offering Edit/Delete).
- Red only for dead data, amber only for stale. Spot name never on screen.
- 44 px touch targets, tabular numerals (the default), no horizontal scroll at
  375–414 px, reduced motion respected (`CLEAN.util.reducedMotion()`).
- To hook an app global, wrap it in your own file the way core does:
  `var orig = window.fn; window.fn = function () { var r = orig.apply(this, arguments); try { … } catch (e) { CLEAN.err('x', e); } return r; };`
  Keep the original behaviour; never replace a function another part or kiosk.js
  relies on without calling through.
- Choc TV: `tv.js` owns `#cl-tv`. The legacy kiosk keeps running underneath
  (rotation timers, 15-min refresh, self-heal reloads, `kioskPause` on every
  pointerdown); tv.js decides what to reuse (e.g. `kioskDaySummary`,
  `KIOSK_COAST`, `kioskFreshness`) and what to stop.

## Utilities

`CLEAN.util`: `esc(s)`, `h(tag, attrs, html|nodes)` (attrs `class`, `aria-*`,
`onclick: fn`), `isNum`, `round1`, `clamp`, `toDate`, `dayKey(t)` ("2026-10-01",
spot time), `startOfDay(t, days)`, `reducedMotion()`, `statusFor(deg)`,
`alignment(deg)`, `windQuality(mph, deg)`, `qualityClass(q)`, `statusClass(s)`.

Auth: `CLEAN.auth()` → `{ signedIn, uid, name }`; `CLEAN.signIn()`;
`CLEAN.signOut()`.

Errors: `CLEAN.errors` (`[{ where, message, at }]`), `CLEAN.err(where, e)`,
`CLEAN.guard(where, fn)`. `CLEAN.ready` is true once the shell is up;
`CLEAN.isTV`.

## Screenshots

`scratchpad/clean/shootlib.js` runs the real app offline on the fixtures
(clock 2026-10-01 11:00 ET; the repo working tree is served, so these files are
live). See its header; `shoot-core.js` is a full example. `L.check(h, label)`
prints page errors, console errors, `CLEAN.errors`, horizontal scroll, targets
under 44 px and text under 10 px for the state on screen.
