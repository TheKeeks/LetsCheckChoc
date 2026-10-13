"""When is it big at Choc? 2016-2026 climatology from buoy 44097 + ERA5 wind + CO-OPS tides."""
import json, glob, math, collections, datetime as dt
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
WMIN, WMAX = 115, 170
OFFSHORE = 335
LAG_H = 3            # buoy -> Choc travel time (knowledge doc: 12 s takes ~3-4 h)
FT = 3.28084

# ── buoy 44097, hourly (first obs each hour), UTC -> local after lag
buoy = {}
files = sorted(glob.glob('ndbc/44097h*.txt')) + sorted(glob.glob('ndbc/44097_2026_*.txt')) + ['ndbc/44097_realtime.txt']
for f in files:
    for line in open(f):
        if line.startswith('#'): continue
        p = line.split()
        if len(p) < 12: continue
        try:
            t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC)
            hs, dpd, mwd = float(p[8]), float(p[9]), float(p[11])
        except ValueError:
            continue
        if hs >= 99 or dpd >= 99 or mwd >= 999: continue
        key = (t + dt.timedelta(hours=LAG_H)).astimezone(ET).replace(minute=0)
        buoy.setdefault(key, (hs, dpd, mwd))

# ── wind (local hours, knots)
w = json.load(open('wind.json'))['hourly']
wind = {}
for t, s, d in zip(w['time'], w['wind_speed_10m'], w['wind_direction_10m']):
    if s is None or d is None: continue
    wind[dt.datetime.fromisoformat(t).replace(tzinfo=ET)] = (s, d)

# ── tides: hi/lo turns -> incoming flag
turns = []
for f in sorted(glob.glob('tides/hilo_*.json')):
    for r in json.load(open(f))['predictions']:
        turns.append((dt.datetime.fromisoformat(r['t'].replace(' ', 'T')).replace(tzinfo=ET), r['type'], float(r['v'])))
turns.sort()
tturn = [x[0] for x in turns]
import bisect
def tide_phase(t):
    i = bisect.bisect_right(tturn, t) - 1
    if i < 0 or i + 1 >= len(turns): return None
    prev, nxt = turns[i], turns[i + 1]
    frac = (t - prev[0]) / (nxt[0] - prev[0])
    return ('in' if prev[1] == 'L' else 'out'), frac

# ── daylight (NOAA approximation) at Choc
LAT, LON = 41.276, -71.963
def sun_times(d):
    n = d.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1)
    eq = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    ha = math.degrees(math.acos(math.cos(math.radians(90.833)) / (math.cos(math.radians(LAT)) * math.cos(dec)) - math.tan(math.radians(LAT)) * math.tan(dec)))
    noon = 720 - 4 * LON - eq
    base = dt.datetime(d.year, d.month, d.day, tzinfo=UTC)
    return (base + dt.timedelta(minutes=noon - 4 * ha)).astimezone(ET), (base + dt.timedelta(minutes=noon + 4 * ha)).astimezone(ET)
_sun = {}
def is_day(t):
    d = t.date()
    if d not in _sun: _sun[d] = sun_times(d)
    r, s = _sun[d]
    return r <= t <= s

def gap(a, b): return abs((a - b + 180) % 360 - 180)

# ── per-hour records
rows = []
for t, (hs, dpd, mwd) in buoy.items():
    hf = hs * FT
    inwin = WMIN <= mwd <= WMAX
    flux = 0.49 * hs * hs * (0.9 * dpd)        # kW per m of crest, Te ~ 0.9 Tp
    wd = wind.get(t)
    tp = tide_phase(t)
    clean = None
    if wd:
        spd, d = wd
        clean = spd < 6 or (gap(d, OFFSHORE) <= 60 and spd < 20)
    rows.append(dict(t=t, hs=hf, dpd=dpd, mwd=mwd, inwin=inwin, flux=flux, day=is_day(t),
                     wspd=wd[0] if wd else None, wdir=wd[1] if wd else None, clean=clean,
                     tide=tp[0] if tp else None, tfrac=tp[1] if tp else None))
rows.sort(key=lambda r: r['t'])
print('hours', len(rows), rows[0]['t'], rows[-1]['t'])

def big(r, ft=4.0): return r['inwin'] and r['hs'] >= ft

# ── monthly climatology (daylight hours only)
M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
clim = []
for m in range(1, 13):
    hrs = [r for r in rows if r['t'].month == m and r['day']]
    n = len(hrs) or 1
    b4 = [r for r in hrs if big(r)]
    b6 = [r for r in hrs if big(r, 6)]
    inw = [r for r in hrs if r['inwin']]
    b4c = [r for r in b4 if r['clean']]
    b4ci = [r for r in b4c if r['tide'] == 'in']
    allwind = [r for r in hrs if r['clean'] is not None]
    clim.append(dict(month=M[m - 1], hours=len(hrs),
        pct_inwin=100 * len(inw) / n,
        pct_big4=100 * len(b4) / n, pct_big6=100 * len(b6) / n,
        mean_inwin_flux=sum(r['flux'] for r in inw) / n,      # in-window flux averaged over ALL daylight hours
        pct_clean_all=100 * sum(r['clean'] for r in allwind) / (len(allwind) or 1),
        pct_big4_clean=100 * len(b4c) / n, pct_big4_clean_in=100 * len(b4ci) / n,
        clean_share_of_big=100 * len(b4c) / (len(b4) or 1)))
for c in clim: print({k: (round(v, 1) if isinstance(v, float) else v) for k, v in c.items()})

# ── year x month: "big days" = >= 3 daylight hours in window >= 4 ft
days = collections.defaultdict(lambda: [0, 0])
for r in rows:
    if r['day'] and big(r):
        days[r['t'].date()][0] += 1
        if r['clean'] and r['tide'] == 'in': days[r['t'].date()][1] += 1
ym = collections.defaultdict(lambda: [0, 0])
for d, (h, hg) in days.items():
    if h >= 3: ym[(d.year, d.month)][0] += 1
    if hg >= 2: ym[(d.year, d.month)][1] += 1
coverage = collections.Counter((r['t'].year, r['t'].month) for r in rows)

# ── events: contiguous runs of in-window >= 4 ft (allow 3 h gaps), ranked by total flux
events = []; cur = None
for r in rows:
    if big(r):
        if cur and (r['t'] - cur['end']) <= dt.timedelta(hours=4):
            cur['end'] = r['t']; cur['rows'].append(r)
        else:
            cur = dict(start=r['t'], end=r['t'], rows=[r]); events.append(cur)
ev = []
for e in events:
    rs = e['rows']; pk = max(rs, key=lambda r: r['hs'])
    ev.append(dict(start=e['start'].isoformat()[:16], hours=len(rs), peak_ft=round(pk['hs'], 1), peak_period=pk['dpd'], peak_dir=pk['mwd'],
                   energy=round(sum(r['flux'] for r in rs)), clean_hours=sum(1 for r in rs if r['clean']),
                   good_hours=sum(1 for r in rs if r['clean'] and r['tide'] == 'in' and r['day'])))
ev.sort(key=lambda e: -e['energy'])
print('events', len(ev))
for e in ev[:20]: print(e)

# ── period regimes of big hours
per = collections.Counter()
for r in rows:
    if big(r): per[int(r['dpd'])] += 1
print('period histogram of big in-window hours', sorted(per.items()))

# ── daily series for the animation prototype (local days)
daily = collections.OrderedDict()
for r in rows:
    d = r['t'].date().isoformat()
    x = daily.setdefault(d, dict(hs=0, dir=None, per=None, flux=0, influx=0, n=0, wclean=0, wn=0, wdirs=[]))
    x['n'] += 1; x['flux'] += r['flux']
    if r['inwin']: x['influx'] += r['flux']
    if r['hs'] > x['hs']: x['hs'], x['dir'], x['per'] = r['hs'], r['mwd'], r['dpd']
    if r['clean'] is not None and r['day']:
        x['wn'] += 1; x['wclean'] += r['clean']
        x['wdirs'].append((r['wdir'], r['wspd']))
out_daily = []
for d, x in daily.items():
    if x['wdirs']:
        sx = sum(s * math.sin(math.radians(a)) for a, s in x['wdirs']); cx = sum(s * math.cos(math.radians(a)) for a, s in x['wdirs'])
        wmean = round(math.degrees(math.atan2(sx, cx)) % 360); wspd = round(sum(s for _, s in x['wdirs']) / len(x['wdirs']), 1)
    else: wmean = wspd = None
    out_daily.append([d, round(x['hs'], 1), x['dir'], x['per'], round(x['flux'] / x['n'], 1), round(x['influx'] / x['n'], 1),
                      round(100 * x['wclean'] / x['wn']) if x['wn'] else None, wmean, wspd])

json.dump(dict(clim=clim,
               ym={f'{y}-{m:02d}': [v[0], v[1], coverage[(y, m)]] for (y, m), v in sorted(ym.items())},
               coverage={f'{y}-{m:02d}': c for (y, m), c in sorted(coverage.items())},
               events=ev[:25], period_hist=sorted(per.items()), daily=out_daily),
          open('results_wide.json', 'w'), default=str)
