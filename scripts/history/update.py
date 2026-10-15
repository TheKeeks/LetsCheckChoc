"""The daily history update: fetch what's new, rebuild the Sound Check's history from 2016 through the last full
day, and write it where the page reads it.

  python3 scripts/history/update.py                      fetch, rebuild, write
  python3 scripts/history/update.py --offline            rebuild from what's in the cache (no downloads)
  python3 scripts/history/update.py --end 2026-10-05 --out DIR    stop at that day; write under DIR, not the repo
  python3 scripts/history/update.py --log surflog-export.json      fit the ratings model to an export of the log

Run every day by .github/workflows/update-history.yml. It rebuilds everything from the raw readings each time (about
5 minutes), so a late or corrected reading anywhere in the ten years lands on the next run, and every file ends on
the same day: the last Eastern day before today that the buoy's spectra and its readings both reach.

Writes (all owned by the history bot; never edit them by hand):
  data/history/results4.json      daily rows, month-by-month counts, climatology, storms, good-day shares
  data/history/days2.json         per day: best 3 hours at Choc and Wilderness, the wind over them
  data/history/trains_days.json   per day: the swell trains at Choc's and Wilderness's biggest hour
  data/history/bend_days.json     per day: the share of Choc's swell that bent in from outside the window
  data/history/wild_stats.json    Wilderness vs Choc by month, its biggest days, the peel read
  data/history/windgrid_out.json  the daily wind at 17 points over the sound
  data/history/sess_pairs.json    the surf log's sessions: size rating against the buoy and Choc
  data/history/sessions_all.json  how each daily measure of the buoy ranks the sessions
  research/hist.js                all of the above as the page's constants (build_hist.py)
  research/ocean/day/<year>.json  the Past days panels' lanes the history makes: '44097' (Block Island's trains
                                  every hour), 'wind' (the over-water wind every hour) and 'tide' (each Eastern day's
                                  highs and lows); the other lanes in those files stay as they are
  research/ocean/pressure/        sea-level pressure every 6 hours since 2016 for the Past days' storm view
                                  (pressure.py): what's missing is filled each run, oldest first
  research/fc/score.json          the forecast scorecard: GFS-Wave's forecasts for each session, 1-3 days ahead

The ratings model (results4.json's model), the two session files and the scorecard are fitted to the crew's surf
log (ratings.py), read from Firestore with the read-only key in SURFLOG_READ_KEY (surflog.py), or from an export
given with --log. Without either, or when the log can't be read, they stay as committed.
"""
import argparse, json, os, sys, datetime as dt
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'sound-check', 'page'))
sys.path.insert(0, os.path.join(HERE, '..', 'forecast'))             # fcpull, for the scorecard's forecasts
import spectra, analyze, derive, sources, surflog, ratings, pressure   # noqa: E402
import build_hist                          # noqa: E402

ROOT = sources.ROOT
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
T0 = int(dt.datetime(2015, 12, 31, tzinfo=UTC).timestamp())      # the history's first spectrum
TABLE = os.path.join(HERE, 'tables', 'fwd_table.json')            # the forward-ray table (Choc, Wilderness)
KAVG = os.path.join(HERE, 'tables', 'kchoc_avg_s.json')           # the older direction/period table (fallback)
HIST = os.path.join('data', 'history')
DAY = os.path.join('research', 'ocean', 'day')
SCORE = os.path.join('research', 'fc', 'score.json')
SLACK = 7          # days a rebuild may lose against the committed history (its last day stepping back) before it's refused


def et_day(key):
    """a UTC hour 'YYYY-MM-DDTHH' → its Eastern date"""
    return dt.datetime.strptime(key, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET).date()


def rebuild(inp, sp, buoy, end, model, kavg, sessions=None):
    """everything through Eastern day `end` (a date) → {file: object}. sessions: the surf log's, to fit the ratings
    model to (None: keep `model`)"""
    e = end.isoformat()
    H = {s: {k: v for k, v in sp['heights'][s].items() if et_day(k) <= end} for s in ('choc', 'wild')}
    trains = [x for x in sp['trains'] if spectra.local_day(x[0])[0] <= e]
    bent = [x for x in sp['bent'] if spectra.local_day(x[0])[0] <= e]
    bh = {t: v for t, v in buoy.items() if t.date() <= end}
    wind = analyze.wind_hours(inp['sea']); wh = derive.wind_by_hour(inp['sea'])
    C, W = derive.two(H['choc']), derive.two(H['wild'])
    return {
        'results4.json': analyze.analyze(bh, H['choc'], wind, analyze.tide_turns(inp['hilo']), kavg, model, sessions),
        'days2.json': derive.days2(C, W, wh, derive.per_dir(inp['f44097'])),
        'trains_days.json': spectra.trains_days(trains),
        'bend_days.json': spectra.bend_days(bent),
        'wild_stats.json': derive.wild_stats(C, W, H['wild'], wh),
        'windgrid_out.json': derive.windgrid(inp['sea'], inp['ifs'], inp['era16'], end),
        'lane': spectra.day_lane(trains),
        'wind': derive.wind_lane(inp['sea'], end, inp.get('sea_offset')),
        'tide': derive.tide_lane(inp['hilo'], end),
    }


def last_days(out):
    """the last day each per-day file reaches"""
    d = out['results4.json']['daily']
    return {'results4.json': dt.date(2000 + int(d[-1][0][:2]), int(d[-1][0][2:4]), int(d[-1][0][4:])) if d else None,
            **{n: dt.date.fromisoformat(max(out[n])) if out[n] else None for n in ('days2.json', 'trains_days.json', 'bend_days.json')}}


def losses(out, root=ROOT):
    """what the rebuild would lose against the committed history. A truncated download, or a source that failed with
    nothing in the cache, gives a much shorter history: that must never replace the real one."""
    lost = []
    def old(*p):
        try: return sources.jload(os.path.join(root, *p))
        except FileNotFoundError: return None
    r4 = old(HIST, 'results4.json')
    if r4 and len(out['results4.json']['daily']) < len(r4['daily']) - SLACK:
        lost.append(f"results4.json: {len(r4['daily'])} days -> {len(out['results4.json']['daily'])}")
    for n in ('days2.json', 'trains_days.json', 'bend_days.json'):
        o = old(HIST, n)
        if o and len(out[n]) < len(o) - SLACK: lost.append(f'{n}: {len(o)} days -> {len(out[n])}')
    if os.path.isdir(os.path.join(root, DAY)):
        for f in sorted(os.listdir(os.path.join(root, DAY))):
            doc = old(DAY, f) or {}
            for name, key, slack, what in (('44097', 'lane', SLACK * 24, 'buoy hours'), ('wind', 'wind', SLACK * 24, 'wind hours'),
                                           ('tide', 'tide', SLACK, 'tide days')):
                o = doc.get(name)
                n = out[key].get(int(f[:4]), {}) if f[:4].isdigit() else {}
                if o and len(n) < len(o) - slack: lost.append(f'{DAY}/{f}: {len(o)} {what} -> {len(n)}')
    return lost


def write_lanes(out, root, dest):
    """research/ocean/day/<year>.json: the history's lanes ('44097', 'wind', 'tide') replaced in place, so a file
    keeps its order of lanes (a new lane goes last), and every other lane (44025, 44017, wm) as committed in `root`"""
    os.makedirs(os.path.join(dest, DAY), exist_ok=True)
    for y in sorted(set(out['lane']) | set(out['wind']) | set(out['tide'])):
        src = os.path.join(root, DAY, f'{y}.json')
        doc = sources.jload(src) if os.path.exists(src) else {}
        for name, key in (('44097', 'lane'), ('wind', 'wind'), ('tide', 'tide')):
            if out[key].get(y): doc[name] = out[key][y]
        with open(os.path.join(dest, DAY, f'{y}.json'), 'w') as f: json.dump(doc, f, separators=(',', ':'))


def dump(name, obj):
    """each file in the form the history was first written in (so an unchanged day is an unchanged file)"""
    if name == 'results4.json': return json.dumps(obj, separators=(',', ':'), default=str)
    if name == 'wild_stats.json': return json.dumps(obj)
    if name == 'sessions_all.json': return json.dumps(obj, indent=1)
    if name == 'score.json': return json.dumps(obj, indent=0)
    return json.dumps(obj, separators=(',', ':'))


def read_log(path, stored):
    """the surf log's sessions to fit to, or None (with the reason in the log): None without a key or an export, when
    the log can't be read, or when it comes back with fewer than half the sessions the stored model was fitted to (a
    read cut short must not replace the model: a deliberate clear-out of the log needs --force)"""
    try:
        sessions, src = surflog.load(path)
    except Exception as e:                       # Firestore down, a key that may not read, ...: never the key itself
        code = getattr(e, 'code', None)
        why = ('Google refused the key (was the service account or its key deleted?)' if type(e).__name__ == 'RefreshError'
               else f'Firestore answered {code} (does the service account have the Cloud Datastore Viewer role?)' if code in (401, 403)
               else f'{type(e).__name__}' + (f' {code}' if isinstance(code, int) else ''))
        sources.log(f'::warning::the surf log could not be read: {why}. The ratings model stays as committed')
        return None
    if sessions is None:
        sources.log(src + '; the ratings model stays as committed'); return None
    sources.log(f'surf log: {len(sessions)} sessions from {src}')
    if len(sessions) < len(stored.get('sessions') or []) // 2:
        sources.log(f'::warning::the surf log has {len(sessions)} sessions, the model was fitted to '
                    f'{len(stored["sessions"])}: not refitting (--force to refit anyway)')
        return None
    return sessions


def forecaster(offline):
    """the scorecard's forecast reader (ratings.gfs_choc), or None offline or without eccodes"""
    if offline: return None
    try:
        import fcpull  # noqa: F401              (numpy, eccodes, Pillow)
    except ImportError as e:
        sources.log(f'no forecasts for new sessions ({e}): the scorecard keeps the ones it has'); return None
    return ratings.gfs_choc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--cache', default=sources.CACHE)
    ap.add_argument('--offline', action='store_true', help='use the cache only')
    ap.add_argument('--end', type=dt.date.fromisoformat, help='last day to include (default: yesterday, Eastern)')
    ap.add_argument('--out', default=ROOT, help='where to write (default: the repo)')
    ap.add_argument('--force', action='store_true', help='write even if the history gets shorter (a deliberate rebuild)')
    ap.add_argument('--log', help='an export of the surf log (the Log\'s Export JSON or CSV) to fit to, instead of '
                    'Firestore (whose read-only key is SURFLOG_READ_KEY)')
    a = ap.parse_args(argv)
    now = dt.datetime.now(ET)
    if not a.offline: sources.fetch_all(a.cache, now.astimezone(UTC).date())
    inp = sources.load(a.cache)
    model = sources.jload(os.path.join(ROOT, HIST, 'results4.json'))['model']   # the ratings model, as last fitted
    kavg = sources.jload(KAVG)['Kavg']
    sessions = read_log(a.log, {} if a.force else model)

    sources.log('reading the spectra')
    sp = spectra.read_all(inp['historic'], inp['realtime'], spectra.Table(TABLE), T0)
    buoy, filled = analyze.buoy_hours(inp['f44097'], inp['f44017'])
    if not sp['t'] or not buoy: raise SystemExit('no buoy data')
    end = min(a.end or (now.date() - dt.timedelta(days=1)),
              dt.date.fromisoformat(spectra.local_day(sp['t'][-1])[0]), max(buoy).date())
    for _ in range(4):                       # every per-day file must end on the same day
        sources.log('rebuilding through', end)
        out = rebuild(inp, sp, buoy, end, model, kavg, sessions)
        ends = last_days(out)
        if all(v == end for v in ends.values()): break
        sources.log('  files end on different days:', {k: str(v) for k, v in ends.items()})
        end = min(v for v in ends.values() if v)
    else:
        raise SystemExit(f'could not bring the files to one last day: {ends}')
    lost = losses(out)
    if lost and not a.force:
        raise SystemExit('refusing to shorten the history (a source is missing or cut short?): ' + '; '.join(lost))
    # the surf log's files, when the model was fitted to it (else they stay as committed)
    refit = out['results4.json']['model'] is not model
    if sessions is not None and not refit:
        sources.log(f'too few sessions with conditions to fit to (under {ratings.MIN_SESSIONS}): the model stays as committed')
    score = None
    if refit:
        cspec = {k: v for k, v in sp['heights']['choc'].items() if et_day(k) <= end}
        b97 = {t: v for t, v in analyze.buoy_hours(inp['f44097'])[0].items() if t.date() <= end}   # 44097 alone, as fitted
        out['sess_pairs.json'] = ratings.sess_pairs(sessions, cspec)
        out['sessions_all.json'] = ratings.sessions_all(sessions, b97)
        prev = sources.jload(os.path.join(ROOT, SCORE)) if os.path.exists(os.path.join(ROOT, SCORE)) else None
        score = ratings.scorecard(sessions, cspec, prev, forecaster(a.offline), log=sources.log)
        sources.log(f'ratings model fitted to {len(out["results4.json"]["model"]["sessions"])} sessions; '
                    f'{len(out["sess_pairs.json"])} with a day in the history; scorecard: {len(score["sessions"])} sessions')

    os.makedirs(os.path.join(a.out, HIST), exist_ok=True)
    for name, obj in out.items():
        if name == 'lane': continue
        with open(os.path.join(a.out, HIST, name), 'w') as f: f.write(dump(name, obj))
    for name in ('sessions_all.json', 'sess_pairs.json'):          # from the surf log: carried over when not refitted
        src, dst = os.path.join(ROOT, HIST, name), os.path.join(a.out, HIST, name)
        if name not in out and os.path.abspath(src) != os.path.abspath(dst):
            with open(src) as f, open(dst, 'w') as g: g.write(f.read())
    if score is not None:
        os.makedirs(os.path.dirname(os.path.join(a.out, SCORE)), exist_ok=True)
        with open(os.path.join(a.out, SCORE), 'w') as f: f.write(dump('score.json', score))
    os.makedirs(os.path.join(a.out, 'research'), exist_ok=True)
    with open(os.path.join(a.out, 'research', 'hist.js'), 'w') as f: f.write(build_hist.build(os.path.join(a.out, HIST)))
    write_lanes(out, ROOT, a.out)
    sources.log(f'history through {end}: {len(out["results4.json"]["daily"])} days, {len(sp["t"])} spectra, '
                f'{len(buoy)} buoy hours ({filled} from 44017)')
    # the pressure maps, through yesterday (they don't wait for the buoy). Never fatal: a step that fails stays
    # missing and is asked for again on the next run, and the history above is committed either way
    if not a.offline:
        try:
            pressure.update(a.end or (now.date() - dt.timedelta(days=1)), root=ROOT, out=a.out, cache=a.cache)
        except Exception as e:
            sources.log(f'::warning::pressure maps not updated ({type(e).__name__}: {e})')
    return end


if __name__ == '__main__':
    print(main())        # the last day, for the workflow's commit message (the log goes to stderr)
