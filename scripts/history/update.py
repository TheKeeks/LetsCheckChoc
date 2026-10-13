"""The daily history update: fetch what's new, rebuild the Sound Check's history from 2016 through the last full
day, and write it where the page reads it.

  python3 scripts/history/update.py                      fetch, rebuild, write
  python3 scripts/history/update.py --offline            rebuild from what's in the cache (no downloads)
  python3 scripts/history/update.py --end 2026-10-05 --out DIR    stop at that day; write under DIR, not the repo

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
  research/hist.js                all of the above (and sessions_all.json, sess_pairs.json, which come from the
                                  surf log and stay as they are) as the page's constants (build_hist.py)
  research/ocean/day/<year>.json  the Block Island lane of the Past days panels: the trains every hour (the
                                  other lanes in those files stay as they are)
"""
import argparse, json, os, sys, datetime as dt
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'sound-check', 'page'))
import spectra, analyze, derive, sources   # noqa: E402
import build_hist                          # noqa: E402

ROOT = sources.ROOT
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
T0 = int(dt.datetime(2015, 12, 31, tzinfo=UTC).timestamp())      # the history's first spectrum
TABLE = os.path.join(HERE, 'tables', 'fwd_table.json')            # the forward-ray table (Choc, Wilderness)
KAVG = os.path.join(HERE, 'tables', 'kchoc_avg_s.json')           # the older direction/period table (fallback)
HIST = os.path.join('data', 'history')
DAY = os.path.join('research', 'ocean', 'day')
SLACK = 7          # days a rebuild may lose against the committed history (its last day stepping back) before it's refused


def et_day(key):
    """a UTC hour 'YYYY-MM-DDTHH' → its Eastern date"""
    return dt.datetime.strptime(key, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET).date()


def rebuild(inp, sp, buoy, end, model, kavg):
    """everything through Eastern day `end` (a date) → {file: object}"""
    e = end.isoformat()
    H = {s: {k: v for k, v in sp['heights'][s].items() if et_day(k) <= end} for s in ('choc', 'wild')}
    trains = [x for x in sp['trains'] if spectra.local_day(x[0])[0] <= e]
    bent = [x for x in sp['bent'] if spectra.local_day(x[0])[0] <= e]
    bh = {t: v for t, v in buoy.items() if t.date() <= end}
    wind = analyze.wind_hours(inp['sea']); wh = derive.wind_by_hour(inp['sea'])
    C, W = derive.two(H['choc']), derive.two(H['wild'])
    return {
        'results4.json': analyze.analyze(bh, H['choc'], wind, analyze.tide_turns(inp['hilo']), kavg, model),
        'days2.json': derive.days2(C, W, wh, derive.per_dir(inp['f44097'])),
        'trains_days.json': spectra.trains_days(trains),
        'bend_days.json': spectra.bend_days(bent),
        'wild_stats.json': derive.wild_stats(C, W, H['wild'], wh),
        'windgrid_out.json': derive.windgrid(inp['sea'], inp['ifs'], inp['era16'], end),
        'lane': spectra.day_lane(trains),
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
            o = (old(DAY, f) or {}).get('44097')
            n = out['lane'].get(int(f[:4]), {}) if f[:4].isdigit() else {}
            if o and len(n) < len(o) - SLACK * 24: lost.append(f'{DAY}/{f}: {len(o)} buoy hours -> {len(n)}')
    return lost


def dump(name, obj):
    """each file in the form the history was first written in (so an unchanged day is an unchanged file)"""
    if name == 'results4.json': return json.dumps(obj, separators=(',', ':'), default=str)
    if name == 'wild_stats.json': return json.dumps(obj)
    return json.dumps(obj, separators=(',', ':'))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--cache', default=sources.CACHE)
    ap.add_argument('--offline', action='store_true', help='use the cache only')
    ap.add_argument('--end', type=dt.date.fromisoformat, help='last day to include (default: yesterday, Eastern)')
    ap.add_argument('--out', default=ROOT, help='where to write (default: the repo)')
    ap.add_argument('--force', action='store_true', help='write even if the history gets shorter (a deliberate rebuild)')
    a = ap.parse_args(argv)
    now = dt.datetime.now(ET)
    if not a.offline: sources.fetch_all(a.cache, now.astimezone(UTC).date())
    inp = sources.load(a.cache)
    model = sources.jload(os.path.join(ROOT, HIST, 'results4.json'))['model']   # the ratings model, as fitted
    kavg = sources.jload(KAVG)['Kavg']

    sources.log('reading the spectra')
    sp = spectra.read_all(inp['historic'], inp['realtime'], spectra.Table(TABLE), T0)
    buoy, filled = analyze.buoy_hours(inp['f44097'], inp['f44017'])
    if not sp['t'] or not buoy: raise SystemExit('no buoy data')
    end = min(a.end or (now.date() - dt.timedelta(days=1)),
              dt.date.fromisoformat(spectra.local_day(sp['t'][-1])[0]), max(buoy).date())
    for _ in range(4):                       # every per-day file must end on the same day
        sources.log('rebuilding through', end)
        out = rebuild(inp, sp, buoy, end, model, kavg)
        ends = last_days(out)
        if all(v == end for v in ends.values()): break
        sources.log('  files end on different days:', {k: str(v) for k, v in ends.items()})
        end = min(v for v in ends.values() if v)
    else:
        raise SystemExit(f'could not bring the files to one last day: {ends}')
    lost = losses(out)
    if lost and not a.force:
        raise SystemExit('refusing to shorten the history (a source is missing or cut short?): ' + '; '.join(lost))

    os.makedirs(os.path.join(a.out, HIST), exist_ok=True)
    for name, obj in out.items():
        if name == 'lane': continue
        with open(os.path.join(a.out, HIST, name), 'w') as f: f.write(dump(name, obj))
    for name in ('sessions_all.json', 'sess_pairs.json'):          # from the surf log: carried over as they are
        src, dst = os.path.join(ROOT, HIST, name), os.path.join(a.out, HIST, name)
        if os.path.abspath(src) != os.path.abspath(dst):
            with open(src) as f, open(dst, 'w') as g: g.write(f.read())
    os.makedirs(os.path.join(a.out, 'research'), exist_ok=True)
    with open(os.path.join(a.out, 'research', 'hist.js'), 'w') as f: f.write(build_hist.build(os.path.join(a.out, HIST)))
    os.makedirs(os.path.join(a.out, DAY), exist_ok=True)
    for y, lane in sorted(out['lane'].items()):
        src = os.path.join(ROOT, DAY, f'{y}.json')
        doc = sources.jload(src) if os.path.exists(src) else {}
        doc['44097'] = lane                   # replaced in place, so the file keeps its order of lanes
        with open(os.path.join(a.out, DAY, f'{y}.json'), 'w') as f: json.dump(doc, f, separators=(',', ':'))
    sources.log(f'history through {end}: {len(out["results4.json"]["daily"])} days, {len(sp["t"])} spectra, '
                f'{len(buoy)} buoy hours ({filled} from 44017)')
    return end


if __name__ == '__main__':
    print(main())        # the last day, for the workflow's commit message (the log goes to stderr)
