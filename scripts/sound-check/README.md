# Sound Check sources

Until now the Sound Check page (`research/index.html`) and the tools that built its numbers lived only in a
Claude Code web session's scratch folder, which is deleted when the session ends. They are kept here so the page
can be rebuilt and the history refreshed from the repo.

## `page/`: rebuild `research/index.html` and `research/map.html`

```sh
cd scripts/sound-check/page
python3 build13.py                                   # assembles site/choc-big.html and site/choc-map.html from the parts below
python3 mk_research.py ../../../research/index.html ../../../research/map.html   # wraps them as the repo pages
rm -rf site
```

This reproduces the committed `research/index.html` and `research/map.html` byte for byte. `map.html` is the map
alone: the same head and map section, and only the map's code (`v13_map.js`, `v13_lab.js`, `ocean.js`), without the
history or the charts; the Forecast tab frames it (`?view=map&fill=1&ui=forecast`). Edit the parts, not the built page:
`v13_head.html`, `v13_body.html` (markup), `v13_map.js` (map and forecast), `v7_charts.js` (charts),
`v13_lab.js` (Check a date, Drop a wave), `fray.js` (forward rays), `ocean.js` / `oceanday.js` (ocean views),
`decade.js` (the ten-year month tiles), `errnote.js`. The page embeds its fixed tables: `fwdk.json`,
`fr_page.json`, `ray2.json`, `tiles-manifest.json`. Its history is not in it: the page loads `research/hist.js`,
which `build_hist.py` writes from `data/history/` (`results4.json`: daily history, climatology, events, model;
`days2.json`, `trains_days.json`, `bend_days.json`, `windgrid_out.json`, `wild_stats.json`, `sessions_all.json`,
`sess_pairs.json`). The history bot rebuilds both every day (`scripts/history/`), so a page rebuild never rolls
the history back, and the text's dates and counts are filled from `hist.js` when the page loads (`data-hist`
spans). The same goes for what the text says about the surf log, which the bot fits the model, the session pairs
and the scorecard (`research/fc/score.json`) to (`data-log` spans and the ids `v7_charts.js`'s `logText()` and
`v13_lab.js`'s scorecard fill): the markup carries the values as of the page's build. The images, ray tables and
tiles it loads at run time are already in `research/`.

## `asbuilt/`: the tools, as they were used

Unsorted and unreviewed: the session's working scripts, kept so nothing is lost. The history comes from Copernicus
Marine's public cloud stores (no login): the WAVERYS reanalysis to July 2026, then the global wave analysis
(`asbuilt/wav/getwav.py`, `getfield.py`, `getocean.py`); ERA5 wind through Open-Meteo; CO-OPS tides. The large
downloads (about 1 GB) are not kept. The history part now runs every day from `scripts/history/`, a port of
`valid_fwd2.py`, `trains.py`, `bend_days.py`, `fwdk.py`, `analyze4.py`, `mk_days2.py`, `mk_wildstats*.py` and
`mk_wildpeel.py` that reproduces their output byte for byte; `regen_chain.sh` is the order they ran in.
