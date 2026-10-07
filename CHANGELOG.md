# Changelog

## [Unreleased] — Swell Map: tapping a dot shows that dot's swell

Since the dots began checking every swell train, a dot can stand for a smaller swell aimed at Choc that sits under a bigger sea from another direction. Tapping it showed the bigger sea's numbers instead, for example "3.6 ft at 5 s from NNW" on a dot for a 7 s swell from the southeast, which read like a north swell reaching Choc. The card now shows the dot's own swell (height, period, direction, and when its ray reaches the spot). Where a bigger sea from another direction is also there, a second line says so ("One of the swells here; the biggest sea is …"). A picked dot also clears when you move to another hour.

Verified by `w6-swell-map-cutaway.js`, which finds an hour with a dot under a different sea, taps it and checks the card. The full unit, e2e and Python suites pass.

## [Unreleased] — Swell Map 3D: the front reaches the sea floor, sharper bottom around Fishers

In the 3D view, each part of the wave front is now a curtain from the sea floor up to the wave's crest. The pale part is the water column under that part of the front, and the colored top is the wave itself, so you can see how deep the water is under every part of it as it crosses shoals and holes. Water and wave share one vertical scale: depths stretched 70 times (squeezed below 60 m so the deep ocean doesn't swallow the view), the wave 4 times more than that.

Around Fishers, the Race and the mouth of the sound (about 24 by 18 km), the 3D sea floor now comes from a 16 m cut of the survey (`research/ocean/fine16.png`, about 1.9 MB, loaded only with 3D) instead of the page's 64 m grid. The rocks off Choc, the reef and the Race's trench show. The mesh there has a point about every 35–40 m. The 3D view only redraws when something changes, so a paused, still view costs nothing. The follow camera stops nudging once it has caught up, and it comes in closer as the wave reaches shallow water.

Verified by `w6-swell-map-3d.js` (now about 20 s with software WebGL) and the full unit, e2e and Python suites.

## [Unreleased] — Swell Map: the wave front in 3D

Drop a wave's panel under the map now has a 3D view next to the side view. It shows the sea floor in 3D, with the depth stretched and the deep ocean squeezed so the shelf shows, and your wave's whole front moving across it. The front is a line of rays 30 km wide, one every 150 m, square to your wave and traced with the same tracer as the rest of the page. It stands up as a band as tall as the wave is at each point.

You can watch it bend left and right around Montauk and Block Island, grow where the bottom bunches it up, shrink where it spreads out, tear apart, and stop where it reaches land or breaks (white). A readout gives the time since it left, the share of its starting energy still moving, and its tallest part. You can drag to turn, pinch or scroll to zoom, and use two fingers to move; Follow keeps the wave in view, and playback slows once it reaches the shelf. The height uses the page's existing math: shoaling times how far the neighboring rays have spread or bunched, with breaking at 0.78 times the depth. The 3D drawing library (three.js r128, MIT, `research/vendor/three.min.js`) loads only when 3D is first opened. The side view is now a plain 2D cross-section.

Verified by a new e2e scenario, `w6-swell-map-3d.js`. It checks that the library isn't loaded up front, that 3D opens in Drop a wave, that the front is traced (200 rays), that the readout reports time, energy and height, and that the side view comes back. The full unit, e2e and Python suites pass.

## [Unreleased] — Swell Map: wave cutaway, dots for every swell, how the forecast is read

Drop a wave now has a cross-section under the map. It shows your wave side-on, flat in 2D, over the real sea floor right under its last 300 m, 1 km or 5 km, for a 3, 6 or 10 ft swell. You can watch it get shorter, slow down and grow as the water shoals, then break once it is about 0.78 times as tall as the water is deep. Its height comes from shoaling plus how much the bottom focused or spread that ray, and the caption gives the numbers (wavelength, speed, breaking depth and height).

The forecast's "headed our way" dots now check every GFS-Wave swell train in each patch of ocean, not just the biggest. A secondary swell aimed at the spot now shows even when a bigger swell from another direction sits on top of it (for example a 12 s ESE swell under an 8 s east swell). Some coastal forecast cells had a wave height but no swell direction, so they showed color but read as "no data" and could never show a dot. They now take the wind sea's period and direction. A new "How the forecast is tied to Choc and Wilderness" section under Behind the numbers explains that the forecast is read at buoy 44097, why, how that was chosen, and what it can miss.

Verified by a new e2e scenario, `w6-swell-map-cutaway.js`. It checks that all three swell trains are loaded for the dots, that the cutaway stays hidden on the forecast and appears in Drop a wave, that waves shorten toward shore, that the 300 m view draws the wave, and that the cutaway hides again on return. The full unit, e2e and Python suites pass.

## [Unreleased] — Swell Map: forecast read at the buoy, the whole Atlantic in the past, wind arrows

The Swell Map's Choc and Wilderness forecasts now read each model's swell at buoy 44097, off Block Island, the same point the ten-year history reads. They used to read it along the edge of the sea-floor survey map. Both are then run through the same ray model. A test on 177 past hours in 2021–25, using archived GFS-Wave runs, compared the two against what then arrived. Reading at the buoy came closer at every lead: a typical miss of 0.20 ft against 0.30 ft a day ahead, and it no longer runs a tenth of a foot high. Both rank the crew's 28 logged sessions about equally. The scorecard under the forecast was re-run the same way. The forecast snapshot in `research/fc/` is also fresh (GFS-Wave 7 Oct 2am run).

The map is easier to read. Near Fishers, the rays show only the spot you picked, and each fades in from open water, so they no longer start on an unexplained line. A small diamond marks buoy 44097. Tapping any patch of water in the forecast traces that swell in, the same way the "headed our way" dots do, and says where it lands. This replaces the old "map edge model covers this" note. The moving streaks stay on when you zoom in to Fishers instead of fading out.

The Past view now has wave data for the whole North Atlantic: every 2° and every 6 hours from the Copernicus reanalysis, under the existing detailed box from New Jersey to Georges Bank. Past and Forecast share the same Ocean, Region and Fishers views. Everywhere wind appears as text (map headline, day card, forecast table, tooltips), a small arrow points where the wind is blowing to. This adds about 38 MB to `research/`.

Verified by a new e2e scenario, `w6-swell-map-explore.js`. It checks the wind arrow's direction and size, streaks at Fishers zoom, a fan of rays from a tap on open water, Past wave data mid-Atlantic, and the day card's arrows. It fails on the previous page and passes now. The full unit, e2e and Python suites pass.

## [Unreleased] — Swell Map: zooming in close and leaving Drop a wave no longer glitch

Two glitches on the Swell Map tab. First, pinching far in on the Forecast or Past map went down to about half a kilometer across. The forecast grid and sea-floor survey have no detail at that scale, and the iPad had to stretch whole-ocean images to millions of pixels, so the map went blank or stuttered. Second, opening Drop a wave starts its demo wave after a few seconds. If you switched back to Forecast or Past before it started, the wave played on top of that map anyway, and the headline showed the wave's depth and speed instead of the forecast.

The map views now stop zooming at 3 km across, still close enough to see the reef shelf off Choc. Each background image is cut to the part on screen before it is drawn, so close zoom stays sharp and smooth. Drop a wave now plays its demo only if you are still on Drop a wave when it is ready. The Forecast headline also shows the numbers as soon as the forecast loads, instead of "Loading the forecast…" until the swell rays arrive.

Verified by a new e2e scenario, `w6-swell-map-zoom.js`, on an iPad-sized screen. It zooms far in and checks that the map stops at 3 km across. It then opens Drop a wave, goes back to Forecast and then Past, and checks that no wave plays and the forecast headline is back. Both checks fail on the previous page and pass now. The full unit, e2e and Python suites pass.

## [Unreleased] — Swell Map tab: forecast, past days and one wave's trip on one map

A fourth tab, Swell Map, opens the research page built alongside the site: one full-screen map with its controls laid over it like a weather app. Its Forecast view plays this week's swell from GFS-Wave and ECMWF across the Atlantic down to the reef. The colors show wave height, moving streaks show where the swell travels, and dots mark open-ocean swell aimed at Choc or Wilderness; tapping a dot traces that swell's rays in and gives its arrival time. Its Past view shows any day since 2016 in the same frame, from buoy 44097 run through the ray model plus the Copernicus wave reanalysis offshore. Drop a wave traces one line of swell from anywhere over the real sea floor. Below the map are the ten-year analysis, a month-by-month heatmap of good days with a calendar for each month, and the forecast table with its scorecard.

The page lives in `research/` as its own static page (classic scripts, no build step) and loads in a frame only when the tab is first opened, so the Forecast tab's load is unchanged. `research/` is about 80 MB, mostly sea-floor tiles and the yearly reanalysis fields. Its forecast (`research/fc/`) is a snapshot taken 6 Oct 2026; nothing refreshes it yet. A scheduled job running the pull script is the next step. On phones the four tab buttons tighten so they fit a 375 px screen.

Verified by a new e2e scenario (`w6-swell-map-tab.js`). On a 375 px phone it checks that nothing under `research/` loads before the tab is opened, that the tab bar fits, and that the map boots on the forecast with no errors. The full unit and e2e suites pass.

## [Unreleased] — The new look is the default (old look at ?classic=1)

The owner approved the clean "A refined" design for everyone. The plain address and Choc TV (`?kiosk=1`) now open it with no special link, so the crew's bookmarks and Home Screen icons get the new look on their next load. The Choc TV iPad picks it up by itself within about 15 minutes, because it reloads when the site's code changes. The old Windows-style look, boat question included, is still available at `?classic=1` (`?kiosk=1&classic=1` for the TV), and Settings › "Open the classic view" goes there. `?preview=<name>` still opens the other candidate looks.

Nothing about the forecast, tides, the surf log or the model changed. The new look runs on top of the same app, which still does all the fetching, saving and training underneath. The e2e runner opens the older scenarios with `?classic=1` so they keep testing that app. A new scenario, `look-default.js`, checks that the plain address and `?kiosk=1` mount the new look without asking the boat question, that Settings links to `?classic=1`, and that `?classic=1` loads the old look with no look files. It fails on the previous `index.html` and passes now.

## [Unreleased] — Try the clean redesign (?preview=clean)

The redesign you approved in Claude Design (the "A refined" boards) can now be tried on the real app with live data. On your phone, open the site with `?preview=clean` added to the address. For Choc TV, use `?kiosk=1&preview=clean`. The plain address is unchanged and loads none of it, so the crew sees nothing new until you decide.

On the phone there are three tabs. Forecast leads with this hour's swell in one number style ("1.6 ft @ 8 s") and whether it is in the window, the wind (as a barb, with its offshore, cross-shore or onshore word), and the tide led by the time of the next low. Below that come the week, the chart, the lineup and the details. Tapping a day slides the chart cursor to that day's low. After last light it leads with the next window instead ("Dark until 6:18 AM · next window Fri, low 8:29 AM"). Log fills in the time and conditions for you and keeps Save off until size, wind and ride are all rated. It saves through the app's own surf log, so ownership and the photo upload work as before. Model says in one sentence what raises your rating, then lists what matters most and your typical miss. The predicted-vs-actual and per-factor charts are one tap away. Settings holds the account, a Display choice (automatic at sunset, follow phone, always light, always dark), the forecast model, data sources and the spot details. The boat question is skipped and the spot name is not shown anywhere. The page turns dark at sunset at the spot.

Choc TV rotates through the next three days (10 s), days four to six (6 s) and a radar that plays the forecast forward an hour a second (12 s). The radar draws the coastline from the TV's own map, with the 115–158° window cone. The strip along the bottom shows the forecast and buoy ages, amber when stale and red when dead, plus the clock, Sources and Next. The TV's self-healing reloads, nightly reload and 15-minute refresh keep running underneath, and a change to this look now reaches the iPad within 15 minutes.

Not done yet: this is still a preview layered over the old app (all of it lives in previews/clean/ and wraps app.js and kiosk.js rather than replacing them). The 0–10 rating cells are 32 px wide, below the 44 px rule, a risk the design accepted to fit 11 cells on one row. The model's chart page reuses the classic charts, restyled, rather than new drawings. The Forecast hour and the Log's looked-up conditions can differ by a few tenths of a foot at the same clock time. The Log pairs the tide with the swell that reached the reef at that hour, read about an hour earlier offshore. The Forecast shows the forecast hour itself. A board-by-board comparison with screenshots goes with the PR.

After review, the swell that reaches the reef always leads. A bigger swell from outside the window (say 1.6 ft @ 4 s from the south at 174°) used to headline the Now block over a smaller groundswell in the window and hide it. Now the in-window swell leads and the blocked one drops to the dim "· blocked" line. Week rows and TV cards work the same way: a day whose bigger swell is blocked but whose other swell is in the window shows the one that reaches, instead of "Nothing reaches the reef". Every number uses one style, with a trailing ".0" dropped: 1 ft, 2 ft ▲, a model score of 3 / 10, a typical miss of ±1 point. The calm ring on the wind barb only shows when the number beside it is under 3 mph.

The preview also handles bad data better. When the wave forecast fails, the wind and NOAA tides that did load still show on the phone and the TV (they used to vanish with it). When NOAA's tide times are missing, each day's swell is read over all daylight instead of over the incoming tide. The week now says so ("all day" where the low would be), and so do the TV cards ("No tide times · swell over all daylight", wind at noon) and TV Sources. A buoy reading from an earlier day names the day it reached the reef. A Wi-Fi blip on the buoy list at boot no longer leaves the phone on "Loading…" forever: it retries once a minute and loads by itself. Switching accounts in Settings ends an open Log edit, so Save can't write one surfer's changes over another's session, even on this device.

On the chart and the TV radar strip, the swell is one continuous shape. Each swell counts by how well it lines up with the window, and all the swell sits grey behind it. The window band under it is a few blocks: a call that lasts under 3 hours, usually Open-Meteo's second swell flipping direction for an hour, joins its neighbour. The readout still gives each hour's own call. The lineup is drawn in flat colour blocks, as on the board (water, reef shallows, sand, land, readings in dark pills). The TV radar's land is a faint fill with the round knob on the shore drawn as land. Now is a live button at rest. The keyboard focus ring is the design's green and never hides under the tab bar. Details values line up in one column, and "Tomorrow, Fri" is regular weight.

Verified by a new browser scenario (`tests/e2e/scenarios/preview-clean.js`, fails without the preview). On a 390 px phone it checks that the clean look loads with no page errors and skips the boat question without remembering the answer. It checks that the three tabs switch and the Now block shows the fixture's 1.6 ft @ 8 s ESE 118°, in window. It checks that the week has 7 rows and that tapping Saturday puts the readout and cursor on its 9:34 AM low. It checks that Settings' Display choice survives a reload, and that Log's Save stays off until three ratings are set, then saves one session under the signed-in surfer. It checks that nothing scrolls sideways at 375 px and the spot name never shows. On Choc TV at 1180×820 it checks for three day cards, that Sources pauses, that Next moves on without pausing, and that reduced motion stops the radar sweep. The existing preview scenario now loads `clean` too. The review fixes add four scenarios, each failing on the code before its fix: `preview-clean-core.js` (number style, wind and tides without the wave forecast, reach-first hero and week, recovery from a buoy-list blip, focus ring, the band's 3-hour blocks), `preview-clean-forecast.js` (tides down, buoy arrival day, one continuous swell shape, the band in at most a dozen blocks, Now live, flat lineup), `preview-clean-log.js` (an account switch ends the edit and nothing is written over another surfer's session) and `preview-clean-tv.js` (tides down on cards and Sources, the strip and its band, the radar land, no trailing ".0"). Every unit, Python and browser test passes.

## [Unreleased] — The model pairs each Silver Eel tide with the swell that's actually on the reef

The owner's rule: for tide purposes there is no lag vs Silver Eel (CO-OPS 8510719) in the model. An audit of every tide path, measured against the raw Silver Eel predictions, found the tide itself was already exact. The model's training and its predictions, the forecast chart and scrubber, the tide card and Choc TV's lows and incoming windows all use Silver Eel's own times, with a best-fit offset of 0 min. What broke the rule was the swell the model set next to that tide. Learning from a logged session, it read swell from hours before the session: 4–7 h for the usual 5–8 s swell, about 3 h for a 12 s groundswell. It applied the buoy's 50-mile travel time even though that swell comes from the open-water forecast point, about 16 nmi from the beach. Predicting, it read swell from the same hour as the tide. So the model learned how the tide mattered against one swell and applied it against another.

Training (from the Open-Meteo archive) and prediction now use one rule. Tide and wind come from the session or forecast hour itself, with no lag. Swell is the reading that reaches the reef at that hour: it is read that many hours earlier, worked out with the 1.5 kt × period rule over the distance from where it was read. That is about 1–2 hours from the forecast point (1.3 h for an 8 s swell), or the buoy's ~42 nmi when "Use buoy coordinates" is on. The "IF I WENT AT" card, threshold lights and match lights now rate that pairing. The card's swell line now reads "On the reef: 1.2ft @ 4.8s SSE (offshore ~2.2h earlier)", because it can differ from the chart's reading for the same hour. The log's lookup says the swell came from the offshore forecast point, not "at buoy". Another buoy's forecast gets no Choc lag.

When NOAA is down and an older saved tide copy stands in, forecast hours past the end of its 6-min predictions used to get the last value held flat: a frozen slack tide at 0 ft/hr. They now fall back to the saved highs and lows (10 days), drawn as straight lines between them. An hour past the end of both copies gets no tide and no Ride rating.

Sessions already in the log still carry swell from the old lag. Tap "Re-fetch all session conditions from Open-Meteo archive" in the Log tab once to re-pair them; ratings are untouched. Each crew member re-fetches their own sessions. CHOCOMOUNT_KNOWLEDGE.md records the owner's rule in the owner's own words.

Verified by `tests/unit/tide-no-lag.test.js`. Three of its tests guard the tide timing, which was already right: they fail if a 1-hour lag is injected into the model's tide lookup or into Choc TV's lows. The other five fail on the previous code and pass now:
- training read a 4.7 h swell lag where the travel time is 1.4 h;
- the swell paired with a tide differed between training and prediction;
- a frozen tide was rated;
- the card and the log mislabelled the swell;
- another buoy got Choc's lag.

## [Unreleased] — Try the redesign drafts on your own phone and Choc TV (?preview=)

The look-and-feel audit produced three prototype redesigns (Shader Pack, One Instrument, Chart Room) and, from the owner's pick of One Instrument's layout with Chart Room's colours, two hybrid drafts: Paper (chart paper by day, navy chart after sunset at Choc, best in sun) and Navy (a navy instrument with 14-segment digits by day, black glass at night). Until now they existed only as screenshots. Adding `?preview=draft-paper`, `?preview=draft-navy`, `?preview=one-instrument`, `?preview=chart-room` or `?preview=shader-pack` to the site's address (and `?kiosk=1&preview=…` for Choc TV) now layers that look over the real app with live data. The plain address is unchanged and loads none of it; the crew sees nothing new.

Each look is a stylesheet and script under `previews/<name>/`, written by two small inline loaders in `index.html` exactly where the prototypes were developed (after `styles-kiosk.css` and after `kiosk.js`). Only the five listed names are accepted. An e2e scenario loads every preview on a phone and on Choc TV with no page errors, checks the plain address fetches nothing from `previews/`, and checks an unknown name is ignored.

## [Unreleased] — Review follow-ups: one data age, no invented directions, sign-in hand-over, phones fit again

An independent review of the audit branch, with every finding re-checked by a second reviewer, turned up twenty real problems in the new code. All are fixed here, each with a test that fails on the earlier branch code.

Choc TV's status strip and the site header now report one age: the age of the swell and wind forecast on screen. During a NOAA tide outage the kiosk had raised "FORECAST 3 H OLD — NOT UPDATING" over a forecast fetched minutes earlier, because saved tide predictions counted toward the age. Tide predictions are astronomical and stay right for days, so they no longer count; the header just adds "saved tides". If the marine forecast stays down past the 24-hour fallback, the strip keeps counting the real age of the forecast still on the cards instead of flipping back to "updated just now", and with no forecast on screen it shows NO DATA. Cards filled from a saved Open-Meteo copy show that copy's forecast for this hour, not its day-old nowcast. The kiosk's deploy check fingerprints the address it actually loads (./?kiosk=1), so it no longer shows an old build ID or reloads once for nothing.

The buoy pipeline no longer invents measurements. When NDBC's direction file (44097.swdir) fails, directions are left blank instead of 0° (north, out of window), and NDBC's 999 "no value" code is skipped; the browser's spectrum parser and spectral-table direction now do the same, and the swell card falls back to the buoy's mean wave direction. A spectrum carried over from an earlier run expires after 6 hours, and the swell card won't headline a carried-over spectrum, or one more than 2 hours behind the buoy reading, under the fresh observation time. The canary's "pipeline hasn't run" alarm moves from 6 to 12 hours, because GitHub's skipped runs routinely leave 6–8.5-hour gaps and it would have opened and closed an issue several times a week.

Signing in to an existing Google account after logging a session anonymously hands that session over again: the stricter rules refuse an update that changes a doc's owner, so the app now removes the anonymous copy while still anonymous, completes sign-in with the Google approval already given (no second pop-up, which iPhone Safari blocks) and re-creates the session under your account, putting it back if sign-in fails. A session saved while the surf log is still loading no longer vanishes when the load finishes.

On 375–414 px iPhones the Forecast tab no longer slides sideways, and Choc TV shows the whole Direction column again: the spectral rows read "Swell 10 s+" and "Wind waves <10 s" and may wrap. The overflow checks that missed this measured a width that grows with the page; they now measure the screen, at four phone widths and two kiosk sizes. The "data is old" cues are darker amber and red so they pass contrast in sunlight, the hidden "Reset to now" link no longer holds space above the chart on phones, and Model vs Buoy no longer averages old and new buoy definitions into one statistic.

## [Unreleased] — Crew surf log: only your own sessions are ever re-saved, entries render as text, missing tide stays missing

Backfill, signing in with Google after using the app anonymously, and JSON import all re-saved every session in the loaded log, including up to 200 community entries from other crew members. Each re-save was stamped with the uid of whoever clicked, and the Firestore rules allowed it. A single Backfill could move the whole crew's sessions, with their ratings, into one person's model and out of everyone else's. The app now writes only entries that belong to the signed-in account. Backfill and photo retries skip everyone else's entries. Migration moves only the sessions logged under the anonymous account you are leaving. Import skips sessions owned by another account and ratings that are not 0–10 numbers. firestore.rules now enforces the same thing: you can create only as yourself, update only a doc that is yours and stays yours, and delete only your own. Writes must also have the app's shape: no extra fields, ratings 0–10 or blank, a server-set createdAt so rows can't be back- or future-dated, and generous size caps. storage.rules accepts only real image types (JPEG/PNG/WebP/HEIC/HEIF/GIF, no SVG) at the app's own photo path. A crew-only email allowlist is included as a commented-out template for when the crew's emails are supplied.

Notes, display names, photo links and condition values were pasted into the page as raw HTML. One crafted note or name in the community log would have run script for every crew member who opened the Surf Log or the Regression drill-down. They are now escaped everywhere they are shown, and photo links must be http(s) or image data.

During a NOAA CO-OPS outage, a looked-up session was saved with a made-up tide of 0.0 ft "rising". That looks exactly like Choc's favourite low incoming tide, so the Ride model trained on it, the forecast-time Ride prediction rated it, and Backfill could write it over sessions that had real tides. A missing tide is now stored as missing and shown as "Tide unavailable". Backfill keeps the stored tide and wind when a fetch fails. Sessions already saved with the made-up tide load as tide-unavailable and are skipped by the Ride model until they are looked up again.

Training also changed: the "incomplete" check now reads the swell height field the app actually stores. One shared filter now decides which sessions every model and every Regression-tab metric uses. A blank, text or out-of-range rating, or a swell with no direction, is excluded everywhere, so the banner's "excluded from your model" is now true. A blocked Firebase Storage script no longer stops sign-in.

Verified with node unit tests, two Chromium scenarios (hostile entries render as text and no injected handler runs; sign-in works with Storage blocked) and a new Firebase-emulator rules suite (npm run test:rules, and a "Firebase rules" GitHub Actions workflow). Every new test fails on the previous code. The rules only take effect once pasted into the Firebase console.

## [Unreleased] — Forecast loads in under a second and is honest about how old its data is

Every visit used to wait on three free NDBC relays that are dead (corsproxy, allorigins, codetabs). The forecast chart took about 5–18 s to appear and the spectra about 34 s, and Choc TV paid that on every 15-minute refresh. Before Choc was even selected, the page also waited 2–15 s on Firebase sign-in for the surf log. The relay list is now empty. Chocomount's buoy reading and spectra come straight from the pipeline's data/buoy.json, and the surf log loads in the background. In the offline test harness the chart now appears in about 0.3 s, and Choc TV boots with one load instead of two. Leaflet is now served from the repo (vendor/leaflet, unmodified 1.9.4), so a CDN outage no longer stops the forecast from loading. Google Fonts no longer delay first paint.

A failed refresh used to blank the chart, or just its tides or wind, under a header saying "Updated <now>". One network blip also erased the forecast model you had picked. Now a failed source falls back to its last good saved copy: forecasts up to 24 h old, tide predictions up to 4 days. The header says "Refresh failed · data from 6:12 AM", or "Forecast unavailable" with a note in the chart when nothing is saved. CO-OPS' "No Predictions" error can no longer overwrite good saved tides. A model choice is only dropped when that model really has no data for the spot. The cache-first paint on repeat visits had never worked for Choc, because the tide cache was saved under one name and looked up under another. It works now. Every load also records how old its data really is (STATE.dataAsOf / STATE.dataHealth) for Choc TV's status strip.

The swell card used to show the 44097 reading as "Current" with no time, even when the pipeline last ran hours ago. It now shows "Buoy obs 8:30 AM (2h 30m ago)", amber past 2 h and red past 6 h. The arrival line is now a clock time counted from the observation ("reaches Choc ~11:48 AM"). On the chart, the obs marker sits at the time the buoy measured it, not on the now line. The headline number is now the swell from 8 s up, worked out from the buoy spectrum: 1.3 ft today, where NDBC's own swell figure says 1.0 ft. At 44097, NDBC counts only waves of 10 s and up as swell, which files Choc's 8–9 s swell under wind waves. NDBC's split stays in the spectral table, labelled as such. Other spectral buoys no longer show Block Island's spectrum under their own name. They say plainly that no live spectrum is available. The Secondary Swell card now reads the current hour instead of midnight.

Verified with 43 new unit tests (tests/unit/w1-*.test.js) and 4 new browser scenarios (tests/e2e/scenarios/w1-*.js). Each fails on the previous code and passes now. The scenarios cover dead relays, a non-Choc buoy, Open-Meteo down on a reload, and Leaflet plus Firebase both down. The baseline time-to-chart bound was tightened from 45 s to 3 s.

## [Unreleased] — Choc TV: honest freshness, self-healing boot, automatic updates, in-window hero

The kiosk's status strip said "updated just now" after any refresh, including one where every fetch had failed, so a dead feed looked live. Now the strip shows the age of the forecast actually on screen. It reads "NO DATA" when a load finished with nothing to show. When refreshes keep failing it goes stale: the age turns bold and the pilot light goes hollow once the data is older than two missed refreshes plus ten minutes. After three hours it shows the alert state: red pilot light, red age and a full-width "FORECAST 3 H OLD — NOT UPDATING" banner. The age comes from the load path's STATE.dataAsOf when it is present. Otherwise it comes from the forecast cache timestamps, which keep the true fetch time. The SOURCES card also lists each data source's health when the app reports it.

Choc TV now looks after itself. A Wi-Fi blip during boot used to leave it on "loading…" forever, or showing NO TIDE DATA forever. Now it re-fetches whichever station list failed and reloads the forecast once the list arrives. If no forecast has loaded ten minutes after boot (for example because the station lists never arrive), it checks that the site answers and then reloads. It also picks up new code without anyone exiting Guided Access. Every 15 minutes it compares the deployed index.html, app.js, kiosk.js and styles-kiosk.css with the code it booted with, and it reloads every night at about 03:30. Every reload first checks that the site is reachable, happens at most once per 30 minutes, and never happens while someone is using the screen or has the SOURCES card open. The SOURCES card shows the running build's signature. The iPad already on the wall runs the old code, which cannot do any of this, so relaunch Choc TV by hand once after this deploy; the SOURCES card's build line confirms the new code is running.

The day cards no longer lead with swell that Montauk or Block Island blocks. Each day, the big reading goes to whichever of the model's two swell trains carries more energy inside the 115–158° window, per the spec's "the secondary becomes the de facto primary". On the recorded fixtures, Tomorrow and Saturday now lead with the 9 s SE groundswell instead of a 5 s southerly wind swell. A train from outside the window is dimmed and tagged OUT OF WINDOW. The radar sweep is now redrawn about 20 times a second instead of 60, at the same rotation speed, so the iPad does less work.

Verified by new unit tests (tests/unit/w2-kiosk-*.test.js) and browser scenarios (tests/e2e/scenarios/w2-kiosk-*.js): a marine outage on refresh shows the stale and then the dead state, the boot blip recovers, a boot that never loads is reloaded by the watchdog, and a kiosk.js deploy is picked up. Each of these fails on the previous kiosk.js.

## [Unreleased] — Buoy pipeline keeps last-good data, logs every hour, and an upstream canary files an issue

The 2-hourly buoy pipeline used to overwrite data/buoy.json with nulls whenever NDBC failed, including when NDBC returned an error page with HTTP 200. It still finished green and the bot committed the blanks, so the buoy card and compass rose went empty and nobody was told. Now a run where every NDBC file fails exits with an error before writing anything: the commit is skipped and GitHub emails the owner. If only some files fail, the parts that did not refresh are carried over from the last good file and listed in a new `stale_sections` field. A new `spectral_obs_time` says how old the spectrum is, since it can trail the buoy reading by an hour or more.

buoy.json also gains a `swell_band` (height, peak period, direction) computed from the spectrum over periods of 8 s and longer. NDBC's own "swell" at 44097 only counts energy at 10 s and longer, so the 8–10 s SE swell that matters at Choc was being booked as wind-wave. On 2026-09-23 NDBC said 2 ft of swell while the 8 s+ band held 6.6 ft. The existing fields are unchanged. The site's swell card reads `swell_band` when it is present and otherwise computes the same band from the spectrum in the browser.

Model-vs-buoy verification now logs one row per hour and back-fills every hour since the last row, so the runs GitHub's cron drops (about 60% lately) no longer leave gaps. Each row adds like-for-like fields for the app to compare: buoy average period, the spectrum's energy period (Tm-1,0), the 8 s+ band height and period, and the model's mean wave direction. The existing series are unchanged. The update-buoy workflow now runs one at a time and rebases before pushing, so an owner merge landing mid-run no longer breaks it.

A new Upstream Canary workflow runs every 6 hours. It probes Open-Meteo marine and wind, the NOAA tide predictions, NDBC 44097 and the bot's buoy.json with the same requests the page and the pipeline make, and checks each for real, recent data rather than just a 200. When something breaks it opens one GitHub issue labelled data-canary with a table of what failed and what the crew will notice. It comments only when the set of failures changes, and closes the issue when everything recovers.

Verified with offline tests in CI. Python unit tests cover the outage, carry-over, swell-band, back-fill and canary decision logic, including a real 2026-09-23 spectrum. A Node test runs the workflow's real push step against a git remote that moved mid-run. An e2e scenario fails if the canary's URLs ever drift from the page's requests or the pipeline's NDBC downloads. Live dry runs of the pipeline (into scratch copies) and the canary against the real services also passed.

## [Unreleased] — Phone chart scrolls, accurate sunrise/sunset, honest model checks, readable greys

On a phone, a vertical swipe over the forecast chart barely scrolled the page. It also jumped the selected hour to wherever the finger landed, often days ahead, and kept it for the session. Now the browser keeps vertical swipes as page scrolls (and pinch-zoom), and only a drag that starts out sideways moves the hour. A plain tap still picks an hour. The gesture survives the chart redrawing mid-drag, and "Reset to now" keeps its space, so showing it no longer reflows the detail bar. The pulsing "now" dot used to redraw 60 times a second forever, even with the chart hidden. It now animates at about 10 frames a second and stops while the chart is on another tab, scrolled off-screen, or behind a Choc TV day panel. It comes back on the forecast tab and on the kiosk radar.

Sunrise and sunset ignored atmospheric refraction, so they ran 5–9 minutes late and early, and the Daylight card's "11h 31m" was really 11h 45m. calcDaylight now uses the NOAA solar equations and matches the US Naval Observatory to about a minute (06:45 / 18:30 today). The model dropdown offered eight wave models, but six return no swell at Choc (two weren't valid ids, and others are blank or total-sea only). It now lists MeteoFrance MFWAM, NOAA GFS-Wave 0.25° and 0.16°, and DWD GWAM (marked "no secondary swell"). "Auto" now names what it is at Choc: MeteoFrance MFWAM, not GFS.

The Model vs Buoy panel compared the buoy's 10 s-and-longer swell band with the model's own, mostly wind-sea, swell partition. That showed a fake 5.8 s period error and a 27° direction miss. Period now compares the buoy's energy period (its dominant period on older readings) with the model's mean wave period: −0.7 s bias, 1.3 s typical miss. Direction compares like with like: mean wave direction on new readings, and on older ones 8 s+ swell only where the model also has 8 s+ swell. The day marks now sit on local midnight instead of 8 PM, and the footer and chart labels say what is compared. Grey secondary text (2:1 on the silver background) is darkened to pass WCAG AA. The ⓘ/? badges are 24 px tap targets, the rating sliders have labels, and the verification panel no longer runs off the right edge on a 390 px phone.

Verified by node unit tests and Chromium scenarios at iPhone size with real touch input, and on Choc TV. Each new test fails on the previous code. Sunrise/sunset is checked against USNO times under New York, UTC and Los Angeles. The model list is checked against a live Open-Meteo probe.

## [Unreleased] — Test harness, offline fixtures, CI and CLAUDE.md

Nothing checked a change before it went live through Pages. The only
tests were test-gate.js, which mostly greps source strings. The
28-test Playwright suite from PR #123 lived in a session scratchpad
and was lost. The repo now has a test layer that needs no npm install
and runs the same way in GitHub Actions and in a Claude Code web
session.

`npm test` loads the real app.js and kiosk.js into a Node sandbox. The
sandbox has browser stubs, a frozen clock and recorded Open-Meteo,
CO-OPS and NDBC 44097 responses. On those it checks the buoy parsers,
daylight times, kiosk day cards and the cache, then runs test-gate.js.
`npm run test:e2e` drives headless Chromium against the real page. It
answers every outside host from fixtures, with the three dead NDBC
proxies emulated as they really fail. Two baseline checks run:
Chocomount auto-selects and the forecast chart draws (about 5 s with
fast-failing proxies, 18 s at production proxy timing), and Choc TV
renders its day cards. `npm run test:py` checks fetch_buoy.py's
parsers without network access or writes to data/. A new CI workflow
runs all three on every push and PR and keeps the screenshots as a
downloadable artifact.

CLAUDE.md now orients future sessions. It covers the iPad-only
workflow, the commands, a module map keyed on section-banner grep
anchors, the data flow and the invariants. A unit test keeps its
commands, anchors and paths in sync with the code. App behaviour is
unchanged.

## [Unreleased] — Day cards degrade gracefully when NOAA tide predictions are down

Diagnosis of "swell data isn't loading": Open-Meteo swell is fine
(exact app request replayed — 200, all 168 hours), but NOAA CO-OPS
tide *predictions* are erroring service-wide ("No Predictions data was
found…" for every station and datum, including NOAA's own documented
sample request; observed water levels still work). With no lows, the
day cards had no incoming-tide windows and blanked every reading to
NO SWELL DATA. Now: when tide predictions are unavailable, the cards
sample the full daylight span instead and the first low slot says
"NO TIDE DATA — ALL-DAY SWELL". Suite grows a tide-outage context
(CO-OPS stub returns NOAA's error JSON) asserting the primary swell
band still renders with the note.

## [Unreleased] — Radar: back to the satellite trace, landmark labels, period-axis color

The owner's sketch coastline and its features (rocks, break lines,
lot, path) are removed — the positions hadn't survived the conversion —
and the scope returns to the original satellite-derived trace (shore +
pond, lineup at frame center) with the fill-height + 15% top-crop
framing kept from the legibility pass. The swell-window cone's edges
are now labeled in small Orbitron with what they actually point at:
MONTAUK PT on the southern edge (158°), SOUTHWEST PT (BLOCK) on the
eastern edge (115°). PWA icons regenerated from the restored shore.
On the swell chart (site-wide), the right-hand period axis labels now
render in the period line's own color so scale and line read as one.

## [Unreleased] — Radar: the owner's coastline replaces the provisional trace

KIOSK_COAST is now the owner's own sketch, digitized in its native
positions — shore polyline (43 points, frame aspect 2.122), rock
clusters, reef wave-break lines, parking lot, and beach path — with the
lineup point seated just seaward of the traced break lines. The paint
code contain-fits the new frame and extends both shore ends along
their own headings past the screen edges (replacing the old
right-edge-only extension and the top-crop, which the tighter frame no
longer needs); the pond blob from the old satellite trace is gone. The
PWA icons are regenerated from the same shore, crop centered on the
lineup. Info card + README updated: the trace is no longer provisional.

## [Unreleased] — Radar: owner-traced features, taller chart, cleaner labels

The scope shrinks 66.7 → 56vh and crops the top 15% of the frame (all
land), handing the swell chart real vertical amplitude. The owner's
traced features are mapped onto the shore by along-coast position +
offset and drawn on the scope: rock spots (dark dots with a faint rim —
the NW-of-reef cluster, offshore SW rocks, shoreline strings east and
south), the three wave-break lines on the reef (dashed), the parking
lot outline, and the dotted path from the lot to the beach. Arrow
labels drop the compass word (the bearing against the swell-window cone
carries direction) and all mph/s units go lowercase with no space after
the number ("1.9ft @ 12s", "7mph") — including the day cards' period
("9s") and the wind dials' caption ("mph WNW").

## [Unreleased] — Day cards: wind becomes a heading dial

Owner pick (option C, wind only): the day cards' wind readings are now
heading dials — a compass ring with 30° ticks and a rim pointer at the
travel direction, the speed and FROM label upright in the middle
(kioskDialHTML). Same 72px slot as the old medium arrows so row
alignment across cards is unchanged. Swell keeps the big filled
arrows; the radar keeps its vector arrows. Info card + README wording
updated.

## [Unreleased] — Choc TV: Orbitron instrument type

The kiosk's sans face is now Orbitron (self-hosted variable woff2,
OFL license included), routed through a new --np-sans token: day-card
legends/titles/units, arrow overlays, status strip + buttons, info-card
headings, spectral table/status strip, rose readout, detail bar, and
the chart canvases (FC_CHART_FONT is reassigned at kiosk boot — const
→ let in app.js; the main site keeps MS Sans Serif). The radar scope's
canvas labels and time-block captions render in Orbitron too. The
segment digits stay DSEG14 and the info card's long-form paragraphs
stay Tahoma for reading comfort. Orbitron runs wide, so sizes drop a
point and tracking tightens across the board; spectra table re-measured
clip-free and day cards verified against the suite.

## [Unreleased] — Verification panel: plain-language labels

Relabeled the Model-vs-Buoy panel for a non-technical reader. Legend
title becomes "is the forecast telling the truth?" with an intro line
explaining the 2-hour measured-vs-claimed logging and how to read the
timelines. Table headers become "How accurate is the model?" / "How
different is the Choc forecast point?" with bias → "typical miss" and
MAE → "typical size", plus a footnote decoding the signs; the stats
terms stay in the footer for rigor. Chart labels explain the units
("seconds between waves — longer = more powerful"), the direction
chart's y-axis now shows compass names instead of raw degrees
(drawVerifChart grows an fmtY hook), and legend entries read
"Buoy — actually measured" / "Model's claim at …".

## [Unreleased] — Model-vs-buoy nowcast verification (pipeline + Tab 2 panel)

The update-buoy pipeline now logs one verification row per run (every
2 h) to `data/verification.json`: the buoy's latest observation (Hs,
DPD/SwP, MWD/SwD from the .spec swell partition) paired with the
Open-Meteo best_match value for the same hour at two grid points —
**the buoy itself** (Analysis 1: pure model skill) and **the Choc
forecast point** (Analysis 2: how different the point the app actually
forecasts from is). Rows cap at ~1 year (4500); model fetches convert
m → ft; failures skip the row rather than break buoy.json. New "Model
vs Buoy — nowcast verification" panel on the Regression tab: a
bias/MAE table for both analyses (height, period, direction — circular
math for degrees) over three retro line charts (buoy solid, model@buoy
dashed, model@Choc dotted) with gap-aware segments, wraparound breaks
on the direction series, UTC-midnight gridlines, and a "collecting"
note until a few rows accumulate. First real row logged: buoy 5.9 ft
vs model 4.7 ft @ buoy / 3.7 ft @ Choc point. test-gate grows to 16
(verifAngDiff wraparound, verifStats bias/MAE/null handling; summary
tally moved to end of file so appended tests count).

## [Unreleased] — Choc TV: radar icon + sources & methodology card

The PWA icons (512/192/180) are regenerated as the radar scope's
identity: the Chocomount coastline outline with the swell-window cone
and lineup dot, phosphor green on true black (`scripts/generate_icons.js`
rewritten; manifest background/theme now #000000). New ⓘ SOURCES
button in the kiosk status strip opens a per-panel methodology card —
day summaries (incoming-tide windows, swell lag, wind sampling, moon),
radar loop (arrow semantics, swell window, playback), and wave spectra
(decomposition, rose encoding) — each ending with its data sources
(Open-Meteo, NOAA CO-OPS 8510719, NDBC 44097 + pipeline fallback).
Plain text, no links, phosphor-styled; opening pauses rotation, any
tap on the card closes it without resuming the radar under the reader,
and the card closes automatically on panel change.

## [Unreleased] — Choc TV radar: 2/3-map / 1/3-chart split, edge to edge

The radar panel is now a strict split tuned for the iPad: the scope
holds the top two-thirds of the screen and the swell chart the bottom
third (above the status strip), both running edge to edge — the
radar-mode `#app` sheds all padding, the chart's flex chain lifts the
base 900px panel cap (`max-width: none; width: 100%`), and the chart
pieces drop their side borders/rounding for the full-bleed look. The
scope's readings scale up to match: arrow shafts 5.5/3.5px with
proportionally larger heads, minimum lengths raised so nothing huddles
at the lineup dot, labels 17px, the corner clock 34px DSEG, and a
bigger lineup marker. Detail bar bumped to 15px.

## [Unreleased] — Choc TV: radar full-screen, tap-toggle pause, bigger spectra

Owner feedback pass on the radar rotation. The standalone forecast
panel is gone (the radar already carries the swell chart), so the
kiosk cycles four panels. The scope now fills every pixel the swell
chart doesn't need: the canvas is full-bleed, the coastline trace
keeps its true proportions inside a fit-contained frame (letterbox is
black-on-black) with the shore's right end extended to the screen
edge, and the corner captions ("CHOCOMOUNT — NIGHT RADAR", the legend
line) and the chart's title strip are deleted. Tapping the scope now
toggles: tap pauses the loop, re-tap resumes it in place (chart
touches still scrub, and the pause backstop resumes in place instead
of advancing). Wave-spectra panel legibility: table headers 17px /
cells 20px with real padding, bigger status strip, compass rose grown
to min(66vh, 46vw). The swell chart's direction axis is capped at due
east (90°) — swell can't arrive from over the island — so the E–SW
band gets the full strip height.

## [Unreleased] — Choc TV: night-radar panel (animated swell/wind loop)

New fifth kiosk rotation panel, `radar`: a phosphor radar-scope
rendering of the Chocomount lineup — coastline outline (provisional
hand trace of `project/assets/lineup.jpg`, swappable via the
`KIOSK_COAST` constant), range rings, rotating sweep, swell-window
cone, and the hour's primary swell / secondary swell / wind arrows
converging on the lineup with readings printed beside them, plus a
14-segment time block with a red NOW tag and ±hour offset. Playback
drives the existing forecast scrubber (`applyScrubberToHour`) at
1 s = 1 forecast hour through the full forecast and loops; the swell
chart rides below the scope (wind/tide strips hidden on this panel
only) so its dots, crosshair, and detail bar move in lockstep. The
panel dwells one full loop, a tap pauses playback for hand-scrubbing
(the radar follows via a kiosk-scoped wrapper around
`applyScrubberToHour`), and leaving the panel stops the timer and
snaps the scrubber back to now. Debug param `&kioskRadarStep=`
(seconds per hour). No app.js changes; all new code is kiosk-scoped.

## [Unreleased] — Forecast tab polish pass

Six-commit visual cleanup of the Forecast tab. No new features, no
regression model / feature-set changes, no chart math touched beyond
adjusting the cards' left margin after the rotated label is removed.

1. **Stacked single-letter labels → horizontal headers.** The
   `S`/`W`/`E`/`L`/`L` (and W·I·N·D, T·I·D·E) vertical letter columns
   along the left edge of each forecast card were replaced with a single
   serif-navy horizontal "Swell" / "Wind" / "Tide" label in the top-left
   of the card, matching the existing `panel-title` hierarchy. Each
   card's left padding drops 64 → 8px (reclaiming ~56px of chart width);
   top padding grows 8 → 20px and card heights grow by 12px so the inner
   canvas height — and the hardcoded swell-card divider Y — stays
   exactly where it was. `FC_PAD` is untouched.
2. **Mobile chrome compression (≤640px).** The Win95/IE `File/Edit/View`
   menu bar and the Address bar consumed ~35% of mobile first-paint
   before any content was visible. Both are hidden at the existing
   640px breakpoint; the title bar shrinks to 24px tall; the buoy /
   sign-in cluster reflows so it doesn't overflow narrow viewports.
   Desktop (>640px) is unchanged.
3. **Buoy selector truncation.** `#buoy-select` max-width was 220px,
   which cut "Choc · 44097 — Block Island, RI" mid-word at "Block
   Islar". Bumped to 320px on desktop; on mobile the select flexes to
   the row width so labels are never truncated.
4. **Attribution footers collapsed behind ⓘ.** Every forecast-tab
   panel's `.panel-footer` (sources / coords / station IDs) is hidden
   by default; a `panel-info-toggle` ⓘ button injected into each
   panel's top-right toggles it open. All footer text is preserved
   verbatim — the surface is the only thing that changed. Applies to
   `.panel`, `.panel-half`, and `.condition-card` containers inside
   `#view-forecast`.
5. **"What is this?" disclosures consolidated.** The full-width yellow
   `widget-help` strips throughout the forecast tab are restyled as a
   "?" badge in each panel's top-right (alongside the ⓘ from item 4);
   the explanation body drops as a floating popover when the disclosure
   opens. Default state: collapsed. No content was duplicated across
   panels, so nothing was removed.
6. **Scrubber default position on mobile.** `getScrubberIndex()` was
   reading the stored ISO hour from `sessionStorage` without checking
   freshness — a mobile tab kept alive overnight resurrected a stale
   position and painted the SWELL: CURRENT card with a "-11H" relative-
   hour badge on first paint. Stored hours older than 1 hour are now
   treated as stale and dropped; the scrubber defaults to the nearest
   current forecast hour on first paint on both desktop and mobile.
   Future-hour scrubs still persist as before (the common case for
   scrub-and-reload navigation).

## [Unreleased] — Revert `effective_in_window_period_squared` from Wave and Ride models

**Why:** The quadratic period term was merged on the strength of a
hypothesis (10/10 sessions cluster at ~15s and ~8s, so a U-shape over
period should fit better than a single linear slope) and coefficient
signs from a synthetic smoke-test. The pre-stated merge gate was a real
LOO-CV check against the 28-session Firestore log: keep the feature only
if ΔR² ≥ +0.03 with correct (linear-negative, squared-positive) signs.

`_llcCompareModels()` on the real 28-session dataset:

| Model | Old R² (LOO) | New R² (LOO) | ΔR²    | Linear period | Period² |
|-------|--------------|--------------|--------|---------------|---------|
| Wave  | 0.420        | 0.394        | −0.026 | −0.179        | +0.451  |
| Ride  | 0.297        | 0.280        | −0.018 | −0.791        | +0.867  |

Signs match the bimodal hypothesis in both models, but LOO-CV regressed
in both. At n = 28 the extra degree of freedom is fitting noise, not
signal. The gate fails; revert.

**Change:**

- `app.js` `WAVE_FEATURE_NAMES`: back to 3 features —
  `[effective_in_window_height, effective_in_window_period,
  total_swell_height]`.
- `app.js` `RIDE_FEATURE_NAMES`: back to 4 features —
  `[tide_height, tide_rate, effective_in_window_period,
  effective_in_window_height]`.
- `app.js` `extractWaveFeatures`, `extractRideFeatures`: stop emitting
  `effPeriod * effPeriod`.
- `app.js` `REG_FEATURE_LABELS` / `REG_FEATURE_UNITS`: remove
  `effective_in_window_period_squared` entries.
- `app.js` `_llcLeakDegSweep` extractors: back to 3F-Wave / 4F-Ride.
- `app.js` `_llcCompareModels`: removed (temporary diagnostic helper,
  served its purpose).
- Conditions model, swell window, `LEAK_DEG`, ridge λ, min-sample gate
  unchanged.
- `CHOCOMOUNT_KNOWLEDGE.md` "Period bimodality" section updated to
  record the empirical finding (kept rest of the file's geography and
  10/10-session sections — those don't depend on the quadratic).

**When to revisit:** if n ≥ 50 and the same U-shape coefficient pattern
returns with ΔR² ≥ +0.03, the hypothesis is real. If ΔR² stays ≤ 0 at
n = 50+, reject.

---

## [Unreleased] — Backfill regressions: marine archive endpoint + NDBC wind merge

**Why:** Two regressions surfaced after the most recent backfill prevented
the Conditions sub-model from training (n < 12 usable rows). See
`INVESTIGATION_BACKFILL_REGRESSIONS.md` for the diagnosis.

  1. `lookupOpenMeteoArchive` hit the atmospheric archive endpoint
     (`archive-api.open-meteo.com/v1/archive`), which silently returns
     null arrays for every requested wave/swell variable. Sessions
     showed primary swell only — `secondary_swell_*` and `wind_wave_*`
     came back null on every backfilled session.
  2. The NDBC stdmet fallback discarded the parallel-fetched
     Open-Meteo Weather wind data. Buoy 44097 has no historical
     anemometer column, so sessions on that path lost wind entirely.

**Fix:**

- `app.js` `CONFIG.api.openMeteoMarineArchive` (new) →
  `https://marine-api.open-meteo.com/v1/marine`. `lookupOpenMeteoArchive`
  uses the marine endpoint, which returns the full marine variable
  stack. `CONFIG.api.openMeteoArchive` stays pointed at the atmospheric
  endpoint for `fetchHistoricalWind`.
- `app.js` new helper `_windAtHour(wind, dateStr)`: extract
  `{speed, direction}` at the session hour from an Open-Meteo Weather
  hourly response, returning null when missing. Shared between the
  archive branch and the NDBC fallback branch in
  `lookupHistoricalConditions`.
- `app.js` NDBC fallback branch: overlay `_windAtHour(wind, dateStr)`
  onto the NDBC core's wind block. When present, mark the dual
  provenance as `source: 'ndbc-stdmet+openmeteo-wind'` with a note;
  otherwise stay on `ndbc-stdmet` and leave wind null.
- `app.js` `backfillAllSessionsFromArchive`: split the source counter
  into `archive` / `ndbcWithWind` / `ndbcOnly` / `failed`; surface the
  three success buckets in the summary modal and progress label.
- `app.js` `renderConditionsDisplay` + `_regFmtConditionsBlock` +
  surf-log markdown report: new source label "NDBC buoy 44097 swell +
  Open-Meteo archive wind" for the dual-source rows.

**Operator follow-up:** click "Re-fetch all session conditions" once
post-deploy. Sessions should land essentially all on
`openmeteo-archive` with full secondary swell and wind populated; the
Conditions model should clear n ≥ 12 and retrain.

## [Unreleased] — Regression redesign: effective in-window energy + tide-rate

**Why:** The data foundation now supports the feature design called for in
`CHOCOMOUNT_KNOWLEDGE.md` — every session has archive-grounded primary
+ secondary swell (per `INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md`),
hourly-interpolated tide height, and a signed `cond.tide.rate` from the
central-difference computation (per `INVESTIGATION_TIDE_LOOKUP.md`). With
the inputs solid, the regression features should reflect the spot's
physics rather than work around stale inputs.

The old Wave model carried 8 features for 28 sessions (encoding direction
as alignment + outside-deg ramps, secondary as three independent inputs,
plus a period × alignment interaction), risking overfit. The old Ride
model duplicated direction features the Wave model already covered, and
discretised tide via `low_incoming` + `time_to_low`.

**Fix:** Drop to 3 features per sub-model on the Wave and Ride paths,
each physically interpretable, continuous where possible, derived from
the new clean inputs.

- `app.js` `WAVE_FEATURE_NAMES`: replaced with
  `[effective_in_window_height, effective_in_window_period, total_swell_height]`.
  In-window energy aggregates primary + secondary so the regression sees
  what hit the reef, not which train Open-Meteo labelled primary.
- `app.js` `RIDE_FEATURE_NAMES`: replaced with
  `[tide_height, tide_rate, effective_in_window_period]`. Direction
  drops (already absorbed by the perception-based size rating in the
  Wave model). `tide_rate` enters as a continuous signed ft/hr instead
  of the binary `low_incoming` indicator.
- `app.js` `COND_FEATURE_NAMES`: unchanged. Spot owner has noted wind is
  "relatively predictable and unimportant" but the Conditions model has
  the highest R² of the three on existing data — decision deferred per
  `CHOCOMOUNT_KNOWLEDGE.md`.
- `app.js` new helpers `_inSwellWindow(deg)` and
  `_effectiveInWindowSwell(cond)`: shared by both Wave and Ride
  extractors. Window bounds read from
  `CONFIG.chocomount.swellWindowMin/Max`, not hardcoded.
- `app.js` `extractRideFeatures`: defensive fallbacks for the rare
  un-backfilled session — skip if `cond.tide.height` is missing, infer
  `tide_rate` from `cond.tide.stage` (±0.5 ft/hr, 0 on slack) with a
  console warning if `cond.tide.rate` is missing.
- `app.js` `slRetrain`: dropped `_TIDE_MEDIAN` recompute (no longer
  needed without `low_incoming`); deleted `_windowGeometry`,
  `_dirAlignment`, `_dirOutsideDeg` (no longer needed without direction
  features in Ride).
- `app.js` `REG_FEATURE_LABELS` / `REG_FEATURE_UNITS`: updated for the
  new feature names; `tide_rate` gets `ft/hr` with a signed formatter.
- `app.js` `_logSanityModel`: now surfaces the top feature by `|w_j|`
  with sign alongside n / R² / LOO RMSE.
- `app.js` new `window._llcRegressionMetricsReport()`: paste-friendly
  text summary the spot owner can run from DevTools to get a compact
  metrics block.
- `scripts/smoke_regression.js` (new): node harness that loads `app.js`
  in a stubbed context, trains all three sub-models on a synthetic
  28-session dataset whose distribution mirrors
  `INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md`, and prints the metrics
  report. Used to verify the pipeline produces finite metrics with the
  new feature set.

Tab 2 visualisations (per-feature scatter grid, importance bars,
preferred-conditions card, predicted-vs-actual scatters, drill-down
attribution) read from `*_FEATURE_NAMES` arrays so they auto-adapt to
the new 3-feature shape. The Tab 1 "If I went at scrubbed time" widget
reuses the same extractors, so it tracks the new features automatically.

**Smoke-test metrics (synthetic 28-session dataset):**

  Wave: n=28, R²=+0.22, LOO RMSE=1.90, top: effective_in_window_height (+)
  Ride: n=28, R²=+0.47, LOO RMSE=1.87, top: tide_height (−)
  Cond: n=28, R²=+0.63, LOO RMSE=1.02, top: wind_speed (−)

Synthetic data only — real numbers come from the spot owner reloading
the app (slRetrain runs on load) and either reading the
`[regression-sanity]` console group or running
`_llcRegressionMetricsReport()` from DevTools.

**Design rationale:** `CHOCOMOUNT_KNOWLEDGE.md`,
`INVESTIGATION_OUT_VS_IN.md`,
`INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md`,
`INVESTIGATION_TIDE_LOOKUP.md`.

## [Unreleased] — Historical tide lookup: hourly interpolation + signed rate

**Why:** Tide audit (`INVESTIGATION_TIDE_LOOKUP.md`) confirmed
`cond.tide.height` was being stored as the next hi/lo extremum (the
upcoming peak or trough), not the actual water level at session time.
For a 5:43 PM session with the next high at 8:00 PM at 3.5ft, the stored
height was 3.5ft — but the real water level under the wave was something
like 2.6ft, partway between the previous low and the upcoming high. The
Ride model's negative R² (-0.28) is partly explained by this — the model
was being trained on a feature that wasn't actually water-level-at-session-time.

**Fix:** Switch CO-OPS predictions to hourly samples and linear-interpolate
the water level at session time. Add a new signed `cond.tide.rate` field
(ft/hr, positive = rising, negative = falling) computed from a ±30-min
central difference. Backfill all logged sessions.

- `app.js` `fetchHistoricalTide(dateStr)`: switched `interval=hilo` →
  `interval=h`. Same URL, same station (8510719), same date range; the
  payload now contains 24 hourly samples per day instead of 2-4 extrema.
- `app.js` `parseTideAtTime(tideData, dateStr)`: rewritten to return
  `{ height, rate, stage, timeToNearest }`. `height` is the linear-
  interpolated water level at session time (not the next extremum's
  value). `rate` is the signed central-difference slope in ft/hr.
  `stage` is derived from `rate`: `|rate| < 0.1` → slack
  (`slack-high` / `slack-low` by absolute height percentile across the
  day), otherwise `rising` / `falling`. `timeToNearest` is hours to the
  nearest local extremum (kept for the existing UI readout).
- `app.js` `tideHeightAt(predictions, sessionDateTime)`,
  `tideRateAt(predictions, sessionDateTime)`,
  `_normalizeTidePredictions`, `_detectTideExtrema`,
  `_timeToNearestExtremum`, `_tideStageFromRate`: new helpers.
- `app.js` `_fetchNDBCHistoricalConditionsCore` and
  `lookupHistoricalConditions`: now persist `cond.tide.rate` alongside
  height/stage/timeToNearest.
- `app.js` `buildForecastConditions(marine, wind, tideHiLo, tidePred, hi)`:
  signature gained `tidePred` (the 6-min CO-OPS predictions series Tab 1
  already fetches) so live-forecast tide is interpolated from hourly
  samples too, with the explicit-typed `tideHiLo` consulted only for
  `timeToNearest`. All callers (`findBestMatchPerDay`, `openMatchModal`,
  `renderRegressionPredictionWidget`, `_regBestMatchAtScrub`) updated.
- `app.js` `backfillAllSessionsFromArchive`: tide block is now ALWAYS
  overwritten on backfill (previously preserved when present), since
  the migration changes both the height semantics AND adds the new rate
  field. Backfill now reports tide-rate distribution at completion:
  "Tide rate distribution across N sessions: X positive, Y negative,
  Z near-zero (slack)."
- `app.js` `_formatTideReadout(tide)`: new helper. Renders
  `2.4ft rising at +0.62 ft/hr (2.4h to next)` when rate is present,
  falls back to the legacy `2.4ft rising (2.4h to next)` for sessions
  not yet backfilled.
- `app.js` `renderConditionsDisplay`, `toggleEntryDetail`,
  `openMatchModal`, `_regFmtConditionsBlock`: tide line now includes
  the signed ft/hr rate when populated.
- `app.js` `exportCSV`: added `tideRate` column.

NON-GOALS: regression feature math (`extractRideFeatures`,
`low_incoming`, `_TIDE_MEDIAN`) was not touched in this change — that's
a separate prompt that uses the new `rate` field as input. Tab 1's tide
chart pipeline (`fetchTidePredictions` / `fetchTideHiLo`) is unchanged
— it already used 6-min predictions for the chart and hi/lo for the
markers; only the historical-lookup path gained the hourly fetch.

## [Previous] — Historical conditions lookup: Open-Meteo archive (reanalysis) for all ages

**Why:** The previous historical-lookup path had two known problems
documented in `INVESTIGATION_LOOKUP_DISCREPANCY.md` and reflected in the
bucket distribution in `INVESTIGATION_OUT_VS_IN.md`:

1. For sessions ≤5 days old, the system pulled from Open-Meteo's
   *forecast* endpoint with `past_days=7`. That returns the FORECAST that
   was made for those past hours — not what actually happened. Forecasts
   can be wrong by 50%+ on swell height; using forecast data to ground
   regression training labels corrupts the model.
2. For sessions >5 days old at Chocomount, the system routed to NDBC
   stdmet historical, which is ground-truth measurement but lacks
   secondary-swell decomposition. Only 6 of 28 sessions ended up with
   any secondary-swell data, making the SEC IN bucket structurally
   unreachable for older sessions.

**Fix:** Use Open-Meteo's *archive* endpoint
(`https://archive-api.open-meteo.com/v1/archive`) as the primary source
for ALL historical lookups, regardless of age. Archive data is
reanalysis — model output rerun after the fact incorporating actual
observations including buoy readings. It includes secondary swell and
wind-wave decomposition. Coverage starts ~2016 for marine variables.

- `app.js` `lookupHistoricalConditions(lat, lon, dateStr)`: rewritten as
  a decision tree — try Open-Meteo archive first via the new
  `lookupOpenMeteoArchive(lat, lon, dateStr)` helper; if archive returns
  no swell, fall back to NDBC stdmet for Chocomount only via the new
  `_fetchNDBCHistoricalConditionsCore(dateStr, preFetchedTide)` helper.
  The days-old branching is gone.
- `app.js` `lookupOpenMeteoArchive`: new helper. Fetches a 2-day window
  centered on the session date; pulls primary swell, secondary swell,
  and wind-wave fields; applies the existing offshore-to-beach travel
  lag; returns a swell-only object plus lag metadata.
- `app.js` `fetchHistoricalWind`: collapsed to always use the archive
  endpoint regardless of age.
- `app.js` `fetchHistoricalMarine`: deleted (its only caller was the
  removed branch in `lookupHistoricalConditions`).
- `app.js` `lookupNDBCHistoricalConditions`: replaced by
  `_fetchNDBCHistoricalConditionsCore` — same lag math, no DOM writes,
  optional pre-fetched tide arg so the archive code path doesn't
  double-fetch CO-OPS.
- `app.js` `isChocomountSpot(lat, lon)`: new helper. Treats the
  Chocomount beach point and its offshore forecast pair as the same
  spot for fallback routing.
- `app.js` `renderConditionsDisplay` and the regression drilldown's
  source label: extended to recognise `openmeteo-archive` and
  `ndbc-stdmet` source values alongside the legacy `openmeteo` /
  `ndbc` strings.
- `app.js` `initSurfLogForm` `sl-lookup-btn` click handler: passes
  `(lat, lon, dt)` (the offshore-Choc forecast pair) to the rewritten
  `lookupHistoricalConditions`; the form now owns the
  "Looking up…" / "Lookup failed" status messages instead of the
  lookup function writing to the DOM.

Tab 1's live forecast continues to use the Open-Meteo *forecast*
endpoint — this change applies only to the historical-lookup paths used
when logging or editing sessions.

## [Unreleased] — Surf log: backfill button to re-fetch all sessions from archive

Adds a one-click backfill so existing logged sessions can be moved off
forecast-derived conditions onto archive (reanalysis) conditions without
disturbing subjective ratings.

- `index.html` (`#sl-export-row` block): adds a
  `#sl-backfill-archive-btn` — *"Re-fetch all session conditions from
  Open-Meteo archive"* — next to the Import/Export buttons. Inline
  progress structure (`#sl-backfill-progress`) renders a thin
  progress bar + status line during the run.
- `app.js` `backfillAllSessionsFromArchive()`: new function bound to
  the button. Confirms with the user, iterates `STATE.surfLog`, calls
  `lookupHistoricalConditions(forecastLat, forecastLon, ts)` for each
  entry, replaces `cond.swell` (including `cond.swell.secondary` and
  `cond.swell.windWave` where the archive returns them) and
  `cond.source`, preserves existing `cond.wind` / `cond.tide` blocks
  (their sources don't change in this migration), and saves to
  Firestore. Rate-limited at 500 ms between requests. Surfaces a
  summary modal with archive / NDBC / failure counts.
- `app.js` `window._llcGeneratePostBackfillReport()`: new diagnostic
  that walks `STATE.surfLog`, re-buckets every session against
  `CONFIG.chocomount.swellWindowMin/Max`, and prints the
  `INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md` table + summary +
  source breakdown to the console for copy-paste into the file.
- `INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md`: new file. Methodology +
  expectations + a placeholder table to be filled in after the user
  runs backfill and the diagnostic.

## [Unreleased] — Edit panel: update stale "5 day delay" note

The historical-lookup edit panel previously carried the note *"Weather
archive has a ~5 day delay. Very recent sessions may show partial
data."*  That note made sense when the system used Open-Meteo's forecast
endpoint for sessions ≤5 days old; with archive-only lookups it is
misleading — what matters now is that archive coverage starts ~2016 and
trails real-time by ~1–2 days.

- `index.html`: replaces the note with *"Conditions are loaded from
  Open-Meteo's archive (reanalysis). Data is typically available within
  1–2 days of the session date."*

## [Unreleased] — Forecast page: scrubber header colors (black on white inset)

The sticky scrubber detail bar previously used white/cream text on a
dark gray (`#2c2825`) background, which read as modern web styling
rather than proper Win95 chrome.

- `style.css` `.forecast-detail-bar`: switched to a white inset bevel
  (`background: #ffffff`, `box-shadow: inset 1px 1px 0 #808080,
  inset -1px -1px 0 #ffffff`, 1px `#c0c0c0` border) with black
  Courier New monospace text. The tide accent is now `#000080` navy
  (the Win95 title-bar accent) instead of cyan. Detail values use
  `#000000`, the day/time stamp is bold black, secondary labels use
  `#404040`.
- `style.css` `.forecast-reset-btn`: re-skinned for the new bar — blue
  underlined link (`#0000ee`, hover `#800080`) in Courier New, so it
  reads as a proper hyperlink on the white surface.
- `style.css` `.scrub-badge`: matched to the new treatment (white
  inset, black mono, 1px `#808080` border).
- `styles-web1-extensions.css` `.forecast-detail-bar`: switched from
  `var(--w1-face)` raised bevel to a white inset bevel
  (border-color `#404040 #ffffff #ffffff #404040`); detail values use
  `--w1-ink`, the tide accent uses `--w1-navy` (bold).

Visually the bar now reads like a Win95 text-display field rather than
a dark callout band, matching the address-bar treatment. No
white-on-dark-gray surfaces remain on the forecast page.

## [Unreleased] — Forecast page: compress header rows above chart

Collapses the four full-width rows that sat above the swell forecast
chart (title + model dropdown, "What is this?" disclosure, "Use buoy
coordinates" checkbox, sticky scrubber band) into a single horizontal
toolbar plus the scrubber band — saving ~80–90px of vertical space.

- `index.html` (`#panel-forecast` block): one `.forecast-header-row`
  now hosts the title on the left and a `.forecast-toolbar` on the
  right containing the cache indicator, the relabeled "Buoy coords"
  checkbox, and the model dropdown. The standalone `<details
  class="widget-help">` row is replaced by an inline `?` icon-button
  next to the title (`.forecast-help-popover`) that opens a small
  CSS-only popover with the same explainer copy.
- The `.forecast-coord-toggle` wrap is now a `<label>` directly inside
  the toolbar rather than a full-width row; visibility is still
  controlled by `applyChocOnlyVisibility()` via the existing
  `#forecast-coord-toggle-wrap` id, so the Choc-only gating is
  unchanged. Re-fetch on toggle is unchanged
  (`initForecastCoordsToggle`).
- The bottom-of-chart "Reset to now" row is removed; the button now
  lives at the right edge of the sticky scrubber detail bar (still
  hidden when scrubber is at "now").
- `style.css`: new `.forecast-panel-title`,
  `.forecast-help-popover` (summary as `?` chip, `<p>` as absolute
  popover), inline `.forecast-coord-toggle`, and updated
  `.forecast-reset-btn` (now a small inline link inside the bar, not
  a row beneath the chart). The old `.forecast-coord-toggle` rule
  block in the conditions/lineup section is removed (collapsed into
  the new inline rule). The mobile media query tightens the new
  header row.
- `styles-web1-extensions.css`: matching Win95 treatments for
  `.forecast-panel-title` (navy serif, bold) and the help popover
  (raised-bevel `?` button, "tooltip yellow" `#ffffe1` body).
- `app.js` `applyScrubberToHour()`: the inner detail row is now
  written into a separate `#forecast-detail-row` element so the
  sibling `#forecast-reset-now` button is preserved across re-renders.
  The reset button's visibility is toggled directly (no more
  `forecast-reset-row` wrapper).

## [Unreleased] — Prompt #6: Web 1.0 visual overhaul + Tab 3 cleanup

Restyles the entire app with restrained Win95-era chrome — bevels,
fieldsets, titlebars, address bar, status bar — and folds in the
remaining Tab 3 / Tab 2 polish from Prompt #5. No React in production:
the entire pass is pure CSS plus minor HTML wrapper additions and small
JS hooks for the decorative shell. Charts are not touched — only the
containers around them are reframed.

### Stylesheets

Two new files, both scoped under `[data-era="web1"]` so they layer on
top of `style.css` without polluting the modern stylesheet:

- `styles-web1.css` — design tokens (#000080 navy, #c0c0c0 face,
  #ffffff highlight, #808080 shadow, etc.), bevel mix-ins, button /
  input / range / fieldset / table / titlebar / menubar / addrbar /
  statusbar / tab-strip primitives.
- `styles-web1-extensions.css` — application-specific re-skins that
  map existing selectors (`.panel`, `.tab-bar .tab-btn`, `.condition-card`,
  `.forecast-card`, `.surflog-table`, `.sl-btn`, `.reg-section`,
  `.reg-feature-mini`, `#gate-card`, `.modal-card`, `.reg-drilldown`,
  …) to the Win95 chrome.

`<body>` now carries `data-era="web1"`. The cascade does the rest.

### App shell (Win95 IE5 wrapper)

`#app` is wrapped in `#app-window.w1-window`, with four decorative
chrome rows above and one below the existing app content:

- **Titlebar** — `🌊 LetsCheckChoc — Microsoft Internet Explorer` plus
  `_ □ ×` buttons (decorative, `tabindex="-1"`, do nothing).
- **Menubar** — File · Edit · View · Favorites · Tools · Help.
  Decorative.
- **Address bar** — read-only URL display with a Go button.
  `switchTab` updates the URL string to `index.html` /
  `regression.html` / `log.html` per active tab.
- **Status bar** — three segments at the bottom of the window:
  `Done · N session(s) loaded` (`STATE.surfLog.length`), the active
  buoy id or pin coords, and a fixed `🔒 Internet`. New
  `updateW1StatusBar()` helper called from `switchTab`, `selectBuoy`,
  `selectPin`, `loadSurfLog`, and `saveSurfLog`.

`el('app').classList.remove('hidden')` is preserved verbatim so
`test-gate.js` Test 3 still passes; an additional
`el('app-window')?.classList.remove('hidden')` reveals the chrome.

### Tabs

Tab strip restyled as a Win95 raised-tab strip. Tab labels shortened
("Current Conditions & Forecast" → "Forecast", "Regression Results" →
"Regression", "Log a Session" → "Surf Log") to fit the tighter Win95
metrics.

### Panels and fieldsets

Every visual container picks up bevel chrome:
- `.panel`, `.condition-card`, `.forecast-card`, lineup frame, map
  containers, photo thumbnails — all rebevelled (raised for surfaces,
  inset for input wells / canvases).
- Tab 2 sub-sections (per-feature scatters, feature importance,
  preferred conditions, model fit) are now `<fieldset class="w1-fieldset">`
  with descriptive `<legend>` text. Same for the Tab 2 PVA grid,
  threshold tuning, and Tab 3 log form / past sessions sections.
- Forecast cards (SWELL / WIND / TIDE) become sunken inset bevels.
- Section labels (`.forecast-section-label`, `.condition-label`)
  switch to small-caps MS Sans Serif.

### Buttons, inputs, sliders, tables

- All `.sl-btn`, `.gate-btn`, `.auth-btn`, `.buoy-map-expand-btn`,
  `.forecast-reset-btn`, and `.reg-submodel-tab` get the Win95
  bevel-button look (raised normally, sunken on `:active`).
  `.sl-btn-primary` / `.gate-btn-primary` get a dotted-outline
  default-button affordance.
- Inputs (`<input type="text|date|datetime-local|number|search">`,
  `<textarea>`, `<select>`) get inset bevels with white interiors,
  Courier New monospace, and a hand-drawn dropdown caret.
- `<input type="range">` retrofit: track styled as inset bevel,
  thumb as raised bevel button. New `w1-untouched` class hides the
  thumb until the user has interacted (Tab 3 default-rating fix).
- `.surflog-table` gets the full `table.w1` treatment: bevelled
  header cells with the down-triangle indicator, alternating row
  backgrounds, hover row highlight.

### Boat gate as Win95 modal

`#gate-card` is now a `.w1-window` with a real titlebar (text:
"Are you coming by boat today?"), the same decorative `_ □ ×`
buttons, and Yes/No buttons styled as Win95 dialog buttons (the No
button — the primary action — gets the dotted default-button outline).

### Drill-down side panel

`.reg-drilldown` becomes a Win95 window: titlebar synthesised via
`::before` pulling from `data-w1-title` (set in
`openRegressionDrilldown` to `Session detail · <date>`), 4×4 box
shadow drop shadow, raised bevel border. Backdrop dimming preserved.

### Photo lightbox

`.modal-card` gets a synthetic Win95 titlebar ("Session Photo") via
`::before`, raised bevel, drop shadow. The existing × close button is
restyled as a small bevel button.

### Typography & palette

- Body default font: Times New Roman serif.
- UI controls (buttons, menus, tabs, table cells, status bar):
  MS Sans Serif / Tahoma fallback.
- Numerical readouts (timestamps, coords, ratings, percentages):
  Courier New monospace.
- Panel headings: Times New Roman bold navy.
- Charts unchanged — they render their own internal fonts and
  palettes; only the chrome around them is Win95.

### Tab 3 cleanup (folded in)

a. **Rating sliders default to untouched.** New per-slider
   `w1-untouched` state. CSS hides the slider thumb (and its numeric
   readout) until the user has touched it; a centred italic
   placeholder "Tap to rate" sits over the track. Touch is detected
   on `input` / `pointerdown` / `keydown`. The Save button stays
   `disabled` (Win95 disabled-bevel) until all three sliders are
   touched. New helper `_slUpdateSaveEnabled()` evaluates
   `wave.touched && wind.touched && ride.touched` and toggles the
   button. Editing an existing entry pre-touches the sliders for any
   already-valid stored rating; stale-rating repair candidates stay
   untouched until the user re-rates. This addresses the (10,10)
   cluster artifact from Prompt #5.

b. **"I Surfed This" remnants** verified gone. One orphan
   `.modal-feedback` CSS rule was found in `style.css` and deleted.
   No markup or JS references remain.

c. **Sign-in copy** verified exact: "Sign in w/ Google to log
   sessions" on `#sl-auth-prompt`.

d. **Crowdsource note** verified above the past-sessions table:
   "Crowdsourced log — sessions from all signed-in users are
   visible. Training uses your sessions only." Restyled as a Win95
   tooltip-yellow (`#ffffe0`) italic note.

e. **Per-feature plot title truncation.** Fixed both ways: labels
   shortened to "Dir outside window" / "Sec in window" (was
   "Direction outside window" / "Secondary in window"), and the
   `.reg-feature-mini-title` rule under `[data-era="web1"]` adds
   `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.

f. **Match-modal feedback panel** confirmed gone; visual overhaul did
   not reintroduce it.

### Explicit non-inclusions

No marquees, no `.w1-blink`, no hit counter, no `NEW!` badges, no
"Best viewed in Netscape", no Comic Sans, no animated GIFs, no MIDI,
no Geocities banners, no visitor counters. Restrained Win95 — feels
like a 1998 productivity application.

### Commits (in order)

1. `Add data-era=web1 attribute and link styles-web1.css`
2. `App shell: title bar, menu bar, address bar, status bar`
3. `Tabs: Win95 tab strip styling`
4. `Tab 1: wrap panels in fieldsets and bevels`
5. `Tab 2: wrap panels in fieldsets and bevels`
6. `Tab 3: wrap panels in fieldsets and bevels`
7. `Buttons, inputs, sliders: Win95 styling`
8. `Tables: Win95 row striping and headers`
9. `Boat gate dialog: Win95 modal`
10. `Drill-down side panel: Win95 window`
11. `Tab 3: rating sliders default to untouched, save disabled until rated`
12. `Tab 2: fix per-feature plot title truncation`
13. `Tab 3: verify and fix sign-in copy + crowdsource note`
14. `Verify and remove any 'I Surfed This' remnants`

### Prompt #6 follow-up — card containers properly Win95

After the initial app-shell pass landed, the inner chart cards still
read as 2020s Material cards (white background, rounded corners,
soft drop shadows) because the modern `style.css` selectors
out-specified the `[data-era="web1"]` overrides for `.forecast-card`
et al. Six follow-up commits address this:

1. **`Win95: card containers become raised bevels`** — bumps
   specificity on inner forecast cards (SWELL/WIND/TIDE), Tab 2 PVA
   scatter cards, and per-feature mini cards so they read as raised
   gray (`#c0c0c0`) Win95 panels. Adds `border-radius: 0` enforcement
   on every panel/card/section selector.
2. **`Win95: canvas content sits in sunken inset bevels`** — every
   chart canvas inside a raised bevel is now a sunken white well
   (`#ffffff` bg, dark top/left + light bottom/right border). Applies
   to forecast SWELL/WIND/TIDE canvases, PVA scatters, per-feature
   mini canvases, residual chart, compass rose, spectrum, and tide
   canvases. Day-label band stays on gray (it's a label strip, not
   a chart); the small `forecast-compass` overlay stays transparent.
3. **`Win95: section labels onto gray bevel margin`** — chose the
   stacked-letter option: SWELL/WIND/TIDE labels stay in the
   `.forecast-card`'s 64px left padding column, but on the gray panel
   surface in navy MS Sans Serif 11px (was Times-ish 10.5px gray with
   small-caps + letter-spacing). No more teal-ish strip behind them.
4. **`Win95: hide overlapping hour ticks under day labels`** — drops
   the `06:00 / 12:00 / 18:00` tick row under "Today" entirely
   (`drawDayLabels` in `app.js`); the day labels now centre vertically
   in the band. Precise time is still readable via the scrubber's
   sticky header.
5. **`Win95: 'What is this?' disclosures restyled`** — `.widget-help`
   now Win95-tooltip-yellow (`#ffffe1`) with 1px `#808080` border, MS
   Sans Serif 11px, summary text styled as a Win95 link
   (`#0000ee` underlined), and the disclosure caret is a literal `▶`
   when collapsed and `▼` when open (replaces the rotating triangle).
6. **`Win95: scrub remaining modern card styling`** — final pass that
   forces `border-radius: 0` on every panel/card/section selector,
   removes the lingering hover drop shadow on `.pm-card`, kills CSS
   transitions on every Win95 button/tab/input (Win95 buttons snap,
   not fade), and strips the green/orange/gray quality-indicator
   left border on condition cards in favour of the standard Win95
   raised highlight.

Charts and chart-drawing code unchanged. Only their containers
moved.

### Non-goals

No mobile-specific Win95 layout (Prompt #7). No regression math
changes. No new features. No removal of existing features. No
marquees / blinks / hit counters.

## [Unreleased] — Prompt #5: Tab 2 regression diagnostics

Builds out Tab 2 (Regression Results) into a full diagnostic page.
Replaces the placeholder summary + raw-weights panel with a stacked
visualisation surface, all painted with the same hand-rolled
Canvas / SVG approach as Tab 1 — no React in production. The
underlying regression math is unchanged: this is purely a visualisation
layer over the existing in-memory three-sub-model OLS fit at
`app.js:4767-4892` (audit §10).

### Section 1 — Header strip

Single-row strip at the top: `Trained on N sessions · earliest YYYY-MM-DD ·
latest YYYY-MM-DD · last refit YYYY-MM-DD HH:MM UTC`, plus an explicit
italic note "Model trained on Open-Meteo `best_match` historical
conditions · refits on every session save". Reads `STATE._lastFitN /
_lastFitDateRange / _lastFitAt` set by `slRetrain` at `app.js:4875-4888`.

### Section 2 — "If I went at scrubbed time" prediction widget

Wide card showing predicted Wave / Ride / Conditions ratings for the
scrubbed hour from Tab 1. Reads the scrubber index from
`STATE.scrubberIdx` (or the persisted `lcc-scrubber-hour` session key),
runs `buildForecastConditions` (`app.js:5065`) +
`predictWaveRating / predictRideRating / predictCondRating`
(`app.js:5056-5058`). Header label flips between `IF I WENT NOW` and
`IF I WENT AT [Day, Time]`. Re-renders silently when the scrubber moves
via a notify hook in `applyScrubberToHour`.

### Section 3 — Predicted vs Actual scatters

Three side-by-side hand-rolled Canvas 2D scatters (wave / ride / cond),
~280×280, with diagonal y=x reference, dot per session, R²/RMSE/n
caption. Dot positions use the same fold layout as
`leaveOneOutRMSE` (`app.js:4813`) so each predicted value mathematically
reconciles with the surfaced LOO RMSE. R² caption coloured green > 0.5,
orange 0.2–0.5, red < 0.2 — surfaces R² from `_logSanityModel` at
`app.js:4959`, previously console-only.

A new `_regLOOCache` keyed off `(_lastFitAt, _lastFitN)` lets the
per-feature scatters, residual chart, and fit metrics share the same
fold without recomputing.

### Section 4 — Match threshold tuning

Three independent sliders (wave / ride / cond), 0–100 step 5, default
60%. Persisted to `lcc-match-threshold-{wave,ride,cond}` in localStorage.
Per-row preview light shows how the currently scrubbed hour scores
against the user's best-matching past session under that sub-model's
`_matchPct` formula (`app.js:5034`) — green ≥ threshold, yellow ≥
(threshold − 15), red otherwise. Updates on slider input AND scrubber
movement. Sliders don't drive Tab 1 yet (deferred per spec non-goal).

### Section 5 — Sub-model selector

Segmented `[Wave | Ride | Conditions]` control, default Wave. Drives
the five sub-model surfaces below it (per-feature scatters, importance,
preferred conditions, fit metrics, residual chart). A central
`REG_SUBMODELS` registry encodes (label / extractor / target fn /
feature-name array / weights/stats keys) per sub-model so each surface
pivots off a single source of truth.

### Section 6 — Per-feature scatter grid

8 minis for wave, 6 for ride, 2 for cond — keyed off
`WAVE_FEATURE_NAMES / RIDE_FEATURE_NAMES / COND_FEATURE_NAMES` at
`app.js:4653-4671`. Each mini ~220×160 with x = feature value, y =
target. Dots include the whole crowdsourced log; user dots are primary
blue, community dots muted gray at lower alpha. The OLS fit line is
computed from the user-scoped subset only — community sessions are
visualised but not used for fitting. Inline legend documents the
convention. Click any dot → drilldown.

### Section 7 — Feature importance bars

Horizontal bars sorted by `|w_j|` descending, normalised so the largest
weight = 100%. Green for positive coefficients, red for negative.
Sourced from `STATE.surfLog{Wave,Ride,Cond}Weights` — visualises the
same data the existing weights panel renders as raw text.

### Section 8 — Preferred conditions

For each feature with `|w_j| ≥ 5%` of the largest weight, surfaces the
implicit preferred direction (positive coefficient ⇒ "prefers >mean";
negative ⇒ "<mean") plus a "your top N sessions" range derived from the
top quartile of user-scoped sessions sorted by target.

### Section 9 — Model fit metrics + residual chart

Two-column layout:
- LEFT: R², LOO RMSE, baseline RMSE (= std of actuals), improvement %
  = 1 − rmse/baseline, N sessions, last-refit relative time. When
  improvement ≤ 0, percentage turns red and a warning surfaces:
  *"Model is no better than guessing the mean."*
- RIGHT: residual chart, ~280×220 — x = predicted, y = actual − predicted,
  dashed zero line, dot per session. Click any dot → drilldown.

Surfaces R², baseline RMSE, and improvement that today only run inside
`_logRegressionSanity` (`app.js:4983`).

### Section 10 — Existing weights panel (collapsed)

`renderWeightsPanel` (`app.js:5018`) is wrapped in a `<details>` element,
collapsed by default with summary "Raw weights (advanced)". Lives at the
bottom of the tab — kept as the numerical complement to the
visualisations.

### Section 11 — Drill-down side panel

Right-anchored slide-in panel (full-screen modal on mobile) opened when
any scatter dot is clicked. Header shows session date / "logged by" /
community badge for non-own sessions. Photo, your-vs-predicted ratings
with residuals, conditions snapshot, top-5 per-feature attribution,
notes, and an "Open in surf log" deep link.

The attribution math reconciles the dot's predicted value:
`contribution_j = w_j × ((feature_j − mean_j) / std_j)`, sorted by
`|contribution|`, top 5 displayed. Footer shows
`Σcontributions + targetMean = predicted_raw → bounded to [1, 10]` so
the user can verify the dot's pred matches what the regression
actually computed. Backdrop click and Escape close the panel.

### New keys

- `localStorage.lcc-match-threshold-wave`  (`'0'`–`'100'`, step 5)
- `localStorage.lcc-match-threshold-ride`  (same)
- `localStorage.lcc-match-threshold-cond`  (same)

### Non-goals

No CSS overhaul (Web 1.0 redesign is Prompt #7). No mobile-specific
layout (Prompt #8). No Tab 1 / Tab 3 changes. No regression math
changes. No threshold-driven match lights on Tab 1.

### Commits (in order)

1. `Tab 2: header strip with sample summary + last-fit timestamp`
2. `Tab 2: 'If I went at scrubbed time' prediction widget + scrubber listener`
3. `Tab 2: predicted-vs-actual scatters (3 sub-models)`
4. `Tab 2: drill-down side panel (basic structure)`
5. `Tab 2: drill-down per-feature attribution`
6. `Tab 2: match threshold tuning sliders`
7. `Tab 2: sub-model selector`
8. `Tab 2: per-feature scatter grid`
9. `Tab 2: feature importance bars`
10. `Tab 2: preferred conditions card`
11. `Tab 2: model fit metrics + residual chart`
12. `Tab 2: move existing weights panel into <details> at bottom`

## [Unreleased] — Prompt #4.1: forecast chart fix-up

Restructures Prompt #4's single partitioned canvas into the Surfline-style
stacked card layout the spec was actually after. All Prompt #4 functionality
(scrubber persistence + cross-feature wiring, model toggle, model footer,
day labels, wind quality color shading with 5mph overrides, model auto-
fallback, DPR fix) is preserved.

### Three canvases in cards

`#forecast-chart-container` now holds three independent `<canvas>` elements:
`forecast-canvas-swell` / `forecast-canvas-wind` / `forecast-canvas-tide`,
each wrapped in a white card (1px #e0e0e0 border, 4px radius, 8px padding,
8px vertical gap). A separate small canvas (`forecast-canvas-days`) hosts
the day-label band; the tide callout sits inside the tide card.
`_drawForecastChartFull` now orchestrates `drawSwellPanel` →
`drawWindPanel` → `drawTidePanel` → `drawDayLabels` in sequence; all four
share an `FC_PAD.left/right` anchor so the time-axis lines up exactly
across cards.

### Section labels

Each card has a fixed 60px left column with stacked uppercase letters
("S / W / E / L / L", "W / I / N / D", "T / I / D / E") rendered as plain
HTML so the canvas stays focused on data. The arrow row, day-label row, and
tide callout share the same 60px left padding so canvases right-align.

### Day separators + today accent + nighttime shading

- Midnight verticals: 1px solid #c0c0c0 (was 0.5px #e0dbd3) — drawn on
  every panel canvas at identical x-coords so they read as continuous
  columns punching through all three cards.
- New `_fcDrawTodayAccent` paints a 2px primary-swell-blue stripe at the
  left edge of today's column on every canvas.
- Nighttime shading dropped to alpha 0.04 so it doesn't compete.

### Period line back with halo

Re-implemented as a `Path2D`: a 4px white rgba(255,255,255,0.85) halo
strokes first, then the warm-orange (#c46a32) 2px line on top. Right-axis
seconds numbers and the 's' unit label adopt the same warmer tone.
Unit labels get +4px padding off the canvas edge.

### Inline daily-peak direction arrows (replaces arrow strip)

The 40-px direction-arrow strip below the tide card is gone. Direction
now appears INLINE on the swell panel as 7 white-filled / blue-stroke
triangle arrows (one per day), each anchored ~14px above the swell-height
curve at that day's height-peak hour. Compass-only label below in 9px
gray monospace. New `drawArrowFilled` helper renders the filled triangle.
The floating scrubber label still shows degrees + compass for the scrubbed
hour — that's the precision view; the inline arrows are the at-a-glance.

### Wind panel polish

- Card height bumped to 120px (was ~75 effective).
- Quality-color alpha bumped 0.6 → 0.7 so the green/yellow/red read.
- 5mph light-wind override unchanged.
- 'mph' unit label still top-left in-canvas.

### Tide panel polish

- Card height bumped to 161px = 24px callout row + 1px divider + 120px
  curve area + paddings.
- The "NEXT LOW: …" callout moves INSIDE the tide card top with a
  `.forecast-tide-divider` 1px #e8e8e8 line below it. Bold, monospace.
- Curve stroke 1.5px (was 1.25), pure teal #3a9aa3. Today's segment at
  alpha 1.0; days 2–7 at alpha 0.7 via clipped sub-strokes.
- Label-collision fix: when two labeled lows are within `labelWidth + 8px`,
  the second's stack is pushed 14px and a thin 0.5px teal connector
  bridges the trough to the label. Triangle alone if a low is unlabeled.

### Floating scrubber label

The detail bar moved INTO `#forecast-chart-container` as the first child
with `position:sticky; top:0; z-index:10`. Restyled dark (#2c2825) with
light text and tabular-nums monospace numerals; tide value gets a cyan
accent. Content unchanged: time | swell h/p | direction | wind | tide.

### Deletions

- `forecast-canvas-arrows` element + `.forecast-arrow-row` CSS + the
  `drawArrowStrip` function — all gone with the inline arrows replacing
  them.
- The single-canvas internal partitioning logic (the swellTop/windTop/
  tideTop math, the giant `_drawForecastChartFull` body that drew every
  panel into shared y-bands) — now isolated to per-panel canvases.
- The mid-canvas y-axis number duplication that came from the shared
  canvas — each canvas now draws its own axis once.
- The `.forecast-detail-bar.scrub-active` light/dark toggle, since the
  bar is always dark.
- `positionAndUpdateTideCallout` no longer sets left/top/width/height —
  it's a static-flow div now; the function only updates innerHTML.

### Commits (in order)

1. `Forecast chart: split into three canvases inside cards`
2. `Forecast chart: add SWELL/WIND/TIDE left-edge section labels`
3. `Forecast chart: bolder day separators + today-column accent`
4. `Forecast chart: bring back period line with halo`
5. `Forecast chart: replace arrow strip with inline daily-peak arrows`
6. `Forecast chart: tide panel height bump + label collision fix`
7. `Forecast chart: float scrubber label to top`

### Follow-up fixes

After deploy + screenshot, seven additional fixes landed before
Prompt #5:

- **Period line visibility (real fix)** — the line was drawing in
  theory but never rendering because some Open-Meteo models return
  `swell_wave_peak_period` as an array of all nulls. The previous
  `peakPeriods.length ? peakPeriods : meanPeriods` picker chose that
  null array, so every per-hour `p == null` guard skipped the sample.
  Now the picker requires at least one finite value before preferring
  peak; otherwise it falls through to `swell_wave_period` /
  `wave_period`. Also re-implemented the line draw with explicit
  `beginPath` / `moveTo` / `lineTo` (no Path2D), required ≥ 2 valid
  samples before stroking, and bumped the halo alpha 0.85 → 0.95.
- **Direction sub-panel 70px** — swell card 256 → 267, sub-panel
  doubles in height so the E/SE/S/SW tick labels have ≥ 4px between
  them and the line isn't squashed.
- **Compass dial 72px, no FROM** — dial 60 → 72, cardinal letters
  bolder (600/10px) and darker (#666), centre/radius derived from
  live canvas size so DPR scaling is right. Dropped the "FROM"
  caption — the direction sub-panel's y-axis already labels the
  convention.
- **Wind panel fixed 0–25 mph** — replaces the auto-fit
  `Math.max(10, ceil(peak × 1.2 / 5) × 5)` axis. Faint gridlines at
  every 5 mph; tick labels at 0/5/10/15/20/25. Existing
  `Math.min(val, windMaxY)` clamp pins area fills to the ceiling
  visually on storm hours.
- **Tide NEXT LOW callout removed** — the "NEXT LOW AFTER hh:mm: …"
  row above the tide curve duplicated info that's already on the curve
  itself (next two lows after now get triangle markers + time + height
  baked in). Card 161 → 120, canvas reclaims the whole card,
  `formatNextLowCallout` / `positionAndUpdateTideCallout` /
  `.forecast-tide-callout` / `.forecast-tide-divider` all deleted.
- **Lineup card shrink + overlay labels** — frame max-width 720 → 588
  so it caps at 280px tall while preserving aspect ratio. Caption
  ("Scrubbed to … — primary swell, secondary swell, wind. Arrows
  converge on the lineup.") moves into the bottom-left corner of the
  image as an overlay pill (rgba(0,0,0,0.55) / 11px white mono / 4px
  padding / 4px radius), legend ("Swell direction · Wind direction")
  moves to the top-right corner with the same treatment. Previous
  panel-footer + dedicated legend row are gone.
- **WIND label clipping** — section-label column 60 → 64px (label
  content 52 → 56) so "WIND" doesn't clip at the W/N edges. Day-row
  padding bumped to match.

### Follow-up commits (in order)

1. `Forecast chart: period line visibility — fall back to mean period when peak is empty`
2. `Forecast chart: direction sub-panel 70px tall, more room for compass ticks`
3. `Forecast chart: compass dial 72px, drop FROM caption`
4. `Forecast chart: wind panel fixed 0–25 mph axis with gridlines`
5. `Forecast chart: remove tide NEXT LOW callout row`
6. `Lineup card: shrink to 280px max, overlay caption + legend on the image`
7. `Forecast chart: section-label column 60 → 64 to fix WIND clipping`

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
