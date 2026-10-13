"""Which way of tying the GFS-Wave forecast to Choc does best?  For logged sessions plus random hours
2021-2025, at leads 0/1/2 days (archived GFS-Wave runs on AWS):
  edge  - current: sampled along the survey map's open edge, weighted by where Choc's rays cross it
  buoy  - the forecast at buoy 44097 (CDIP 154), the same point the historical model reads
  near  - mean energy of a 5x5 block of model points around the buoy (0.16 deg apart)
  blend - energy mean of edge and buoy
each run through the same per-direction, per-period ray response. Scored against what arrived (the
buoy-spectrum model for Choc, the history's number) and, for sessions, the logged size."""
import csv, json, math, random, datetime as dt, concurrent.futures as cf, sys
import numpy as np
from zoneinfo import ZoneInfo
import fcpull as P
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
BLAT, BLON = 40.969, -71.127
buoy = json.load(open('spec_choc.json'))
elat = np.array([p[0] for p in P.EDGE]); elon = np.array([p[1] for p in P.EDGE])
nlat = np.array([BLAT + 0.16 * i for i in range(-2, 3) for j in range(-2, 3)]); nlon = np.array([BLON + 0.16 * j for i in range(-2, 3) for j in range(-2, 3)])
_cache = {}
def fields(c, s):
    k = (c, s)
    if k in _cache: return _cache[k]
    u = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{c:%Y%m%d}/{c:%H}/wave/gridded/gfswave.t{c:%H}z.atlocn.0p16.f{s:03d}.grib2"
    idx = P.get(u + '.idx').decode().splitlines(); offs = [int(l.split(':')[1]) for l in idx]
    f = {}
    for kk, name in P.GFS_VARS.items():
        if kk in ('wind', 'wdir', 'hs'): continue
        i = next(n for n, l in enumerate(idx) if (':'.join(l.split(':')[3:5])) == name)
        f[kk] = P.decode(P.get(u, offs[i], (offs[i + 1] - 1) if i + 1 < len(offs) else ''))
    _cache[k] = f; return f
def point_ft(f, lat, lon):
    """trains at one or more points -> Choc ft (energy mean over the points)"""
    en = 0.0
    for key in ('w1', 'w2', 'w3', 'ww'):
        h = P.sample(f[key + 'h'], lat, lon); T = P.sample(f[key + 't'], lat, lon); D = P.sample_dir(f[key + 'd'], lat, lon)
        ok = ~(np.isnan(h) | np.isnan(T) | np.isnan(D))
        if not ok.any(): continue
        e = [h[i] ** 2 * P.kfactor(T[i], D[i], P.SPREAD[key], 'choc') for i in range(len(h)) if ok[i]]
        en += float(np.mean(e))
    return math.sqrt(en) * P.FT
def methods(t_utc, lead_d):
    issue = t_utc - dt.timedelta(days=lead_d); c = issue.replace(hour=issue.hour // 6 * 6, minute=0, second=0, microsecond=0)
    s = int(round((t_utc - c).total_seconds() / 3600))
    if s > 120: s = int(round(s / 3) * 3)
    f = fields(c, s)
    tr = [(k, P.sample(f[k + 'h'], elat, elon), P.sample(f[k + 't'], elat, elon), P.sample_dir(f[k + 'd'], elat, elon)) for k in ('w1', 'w2', 'w3', 'ww')]
    edge = P.spot_height(tr, 'choc')[0]
    b = point_ft(f, np.array([BLAT]), np.array([BLON])); n = point_ft(f, nlat, nlon)
    return dict(edge=edge, buoy=b, near=n, blend=math.sqrt((edge ** 2 + b ** 2) / 2))
def job(item):
    kind, t, extra = item; out = dict(kind=kind, t=t.strftime('%Y-%m-%dT%H'), **extra)
    k = t.strftime('%Y-%m-%dT%H'); out['arrived'] = buoy[k][1] if k in buoy else None
    for L in (0, 1, 2):
        try:
            for m, v in methods(t, L).items(): out[f'{m}{L}'] = round(v, 2)
        except Exception as e: print('miss', out['t'], L, e, file=sys.stderr)
    print(json.dumps(out), flush=True); return out
items = []
for r in csv.DictReader(open('surflog.csv')):
    t = dt.datetime.fromisoformat(r['date']).replace(tzinfo=ET).astimezone(UTC).replace(minute=0, second=0)
    if t.year >= 2021: items.append(('log', t, dict(size=float(r['size']))))
random.seed(7)
keys = [k for k in buoy if k >= '2021-03-01' and k < '2025-10-01' and buoy[k][0] is not None]
for k in random.sample(keys, int(sys.argv[1]) if len(sys.argv) > 1 else 150):
    items.append(('rand', dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC), {}))
with cf.ThreadPoolExecutor(8) as ex: res = list(ex.map(job, items))
json.dump(res, open('fctest.json', 'w'))
