# Sound Check sources

Until now the Sound Check page (`research/index.html`) and the tools that built its numbers lived only in a
Claude Code web session's scratch folder, which is deleted when the session ends. They are kept here so the page
can be rebuilt and the history refreshed from the repo.

## `page/`: rebuild `research/index.html`

```sh
cd scripts/sound-check/page
python3 build13.py                                   # assembles site/choc-big.html from the parts below
python3 mk_research.py ../../../research/index.html  # wraps it as the repo page
rm -rf site
```

This reproduces the committed `research/index.html` byte for byte. Edit the parts, not the built page:
`v13_head.html`, `v13_body.html` (markup), `v13_map.js` (map and forecast), `v7_charts.js` (charts),
`v13_lab.js` (Check a date, Drop a wave), `fray.js` (forward rays), `ocean.js` / `oceanday.js` (ocean views),
`decade.js` (the ten-year month tiles), `errnote.js`. The page embeds these data files, built by the tools in
`asbuilt/`: `results4.json` (daily history, climatology, events, model), `days2.json`, `trains_days.json`,
`bend_days.json`, `windgrid_out.json`, `wild_stats.json`, `fwdk.json`, `fr_page.json`, `ray2.json`,
`sessions_all.json`, `sess_pairs.json`, `tiles-manifest.json`. The images, ray tables and tiles it loads at run
time are already in `research/`.

## `asbuilt/`: the tools, as they were used

Unsorted and unreviewed: the session's working scripts, kept so nothing is lost. The history comes from Copernicus
Marine's public cloud stores (no login): the WAVERYS reanalysis to July 2026, then the global wave analysis
(`asbuilt/wav/getwav.py`, `getfield.py`, `getocean.py`); ERA5 wind through Open-Meteo; CO-OPS tides. The large
downloads (about 1 GB) are not kept. A later change turns the history part into a daily job and drops what is
not needed.
