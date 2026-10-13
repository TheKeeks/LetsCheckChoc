"""Forecast scorecard: for every logged session, what GFS-Wave forecast for Choc 1, 2 and 3 days ahead
(the archived runs on AWS, read at buoy 44097 as fcpull.py does), next to the buoy-based model (what actually arrived) and the size you logged.
Writes site/fc/score.json."""
import csv, json, math, datetime as dt, concurrent.futures as cf
import numpy as np
from zoneinfo import ZoneInfo
import fcpull as P
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
rows = list(csv.DictReader(open('surflog.csv')))
buoy = json.load(open('spec_choc.json'))
elat = np.array([p[0] for p in P.EDGE]); elon = np.array([p[1] for p in P.EDGE])
def fc_choc(t_utc, lead_d):
    issue = t_utc - dt.timedelta(days=lead_d); c = issue.replace(hour=issue.hour // 6 * 6, minute=0, second=0, microsecond=0)
    s = int(round((t_utc - c).total_seconds() / 3600))
    if s > 120: s = int(round(s / 3) * 3)
    u = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{c:%Y%m%d}/{c:%H}/wave/gridded/gfswave.t{c:%H}z.atlocn.0p16.f{s:03d}.grib2"
    idx = P.get(u + '.idx').decode().splitlines(); offs = [int(l.split(':')[1]) for l in idx]
    f = {}
    for k, name in P.GFS_VARS.items():
        if k in ('wind', 'wdir', 'hs'): continue
        i = next(n for n, l in enumerate(idx) if (':'.join(l.split(':')[3:5])) == name)
        f[k] = P.decode(P.get(u, offs[i], (offs[i + 1] - 1) if i + 1 < len(offs) else ''))
    en = 0.0                                                 # the same read as fcpull: each train at buoy 44097
    for k in ('w1', 'w2', 'w3', 'ww'):
        q = P.at_buoy(f[k + 'h'], f[k + 't'], f[k + 'd'])
        if q: en += P.train_ft(*q, k, 'choc') ** 2
    return math.sqrt(en)
def one(r):
    t = dt.datetime.fromisoformat(r['date']).replace(tzinfo=ET).astimezone(UTC).replace(minute=0, second=0)
    out = dict(date=r['date'][:16], size=float(r['size']), avg=float(r['avg']))
    k = t.strftime('%Y-%m-%dT%H'); out['buoy_model'] = buoy[k][1] if k in buoy else None
    for L in (1, 2, 3):
        try: out[f'd{L}'] = round(fc_choc(t, L), 2)
        except Exception as e: out[f'd{L}'] = None; print('miss', r['date'], L, e)
    print(out, flush=True); return out
with cf.ThreadPoolExecutor(6) as ex: res = list(ex.map(one, rows))
def spearman(x, y):
    rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return float(np.corrcoef(rx, ry)[0, 1])
summ = {}
for key in ('buoy_model', 'd1', 'd2', 'd3'):
    ok = [x for x in res if x.get(key) is not None]
    summ[key] = dict(n=len(ok), rho_size=round(spearman([x[key] for x in ok], [x['size'] for x in ok]), 2))
    if key != 'buoy_model':
        both = [x for x in ok if x.get('buoy_model') is not None]
        summ[key]['median_vs_arrived_ft'] = round(float(np.median([x[key] - x['buoy_model'] for x in both])), 2)
        summ[key]['typical_miss_ft'] = round(float(np.median([abs(x[key] - x['buoy_model']) for x in both])), 2)
json.dump(dict(sessions=res, summary=summ), open('site/fc/score.json', 'w'), indent=0)
print(json.dumps(summ, indent=1))
