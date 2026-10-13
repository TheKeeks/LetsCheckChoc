"""Choc research v2: all-hours default (daylight as a variant), over-water ERA5 wind,
soft window edge, best-3h daily swell energy, and a ridge model trained on the surf log."""
import json, glob, math, csv, bisect, collections, random, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np

ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc; FT = 3.28084
OFFSHORE = 335

def w_soft(d):
    if 115 <= d <= 158: return 1.0
    if 100 <= d < 115: return (d - 100) / 15
    if 158 < d <= 175: return (175 - d) / 17
    return 0.0
def gap(a, b): return abs((a - b + 180) % 360 - 180)
def power(hs_ft, per): return 0.49 * (hs_ft / FT) ** 2 * 0.9 * per   # kW per m of crest

# ── buoy 44097 (no lag: the buoy hour is the beach hour)
buoy = {}
for f in sorted(glob.glob('ndbc/44097h*.txt')) + sorted(glob.glob('ndbc/44097_2026_*.txt')) + ['ndbc/44097_realtime.txt']:
    for line in open(f):
        if line.startswith('#'): continue
        p = line.split()
        try:
            t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC)
            hs, dpd, mwd = float(p[8]), float(p[9]), float(p[11])
        except (ValueError, IndexError): continue
        if hs >= 99 or dpd >= 99 or mwd >= 999: continue
        buoy.setdefault(t.astimezone(ET), (hs * FT, dpd, mwd))
# Montauk 44017 fills 44097 gaps (2016–Jan 2023): heights scaled by the 1.05 overlap ratio
FILLED = 0
for f in sorted(glob.glob('ndbc17/44017h*.txt')):
    for line in open(f):
        if line.startswith('#'): continue
        p = line.split()
        try:
            t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC).astimezone(ET)
            hs, dpd, mwd = float(p[8]), float(p[9]), float(p[11])
        except (ValueError, IndexError): continue
        if hs >= 99 or dpd >= 99 or mwd >= 999 or t in buoy: continue
        buoy[t] = (hs * FT * 1.05, dpd, mwd); FILLED += 1
print('hours filled from 44017:', FILLED)

# ── our swell model: transfer coefficient at the Choc reef (directional + frequency spread)
KAVG = json.load(open('kchoc_avg_s.json'))['Kavg']; KD, KT = list(range(90, 211, 10)), [6, 9, 12, 15]
def kchoc(D, T):
    D = min(max(D, KD[0]), KD[-1]); T = min(max(T, KT[0]), KT[-1])
    i = min(len(KD) - 2, int((D - KD[0]) // 10)); fd = (D - KD[i]) / 10
    j = max(0, min(len(KT) - 2, sum(1 for x in KT if x <= T) - 1)); ft = (T - KT[j]) / (KT[j + 1] - KT[j])
    g = lambda d, t: KAVG[f'{d}_{t}']
    return (g(KD[i], KT[j]) * (1 - fd) + g(KD[i + 1], KT[j]) * fd) * (1 - ft) + (g(KD[i], KT[j + 1]) * (1 - fd) + g(KD[i + 1], KT[j + 1]) * fd) * ft

# ── wind: ERA5 over-water cell at 41.25N 72.00W (knots)
w = json.load(open('wind_sea.json'))['hourly']
wind = {dt.datetime.fromisoformat(t).replace(tzinfo=ET): (s, d)
        for t, s, d in zip(w['time'], w['wind_speed_10m'], w['wind_direction_10m']) if s is not None and d is not None}

# ── tide: Silver Eel Pond hi/lo, cosine interpolation between turns
turns = []
for f in sorted(glob.glob('tides/hilo_*.json')):
    for r in json.load(open(f))['predictions']:
        turns.append((dt.datetime.fromisoformat(r['t'].replace(' ', 'T')).replace(tzinfo=ET), r['type'], float(r['v'])))
turns.sort(); tt = [x[0] for x in turns]
def tide(t):
    i = bisect.bisect_right(tt, t) - 1
    if i < 0 or i + 1 >= len(turns): return None
    (t0, _, h0), (t1, _, h1) = turns[i], turns[i + 1]
    span = (t1 - t0).total_seconds() / 3600; f = (t - t0).total_seconds() / 3600 / span
    height = (h0 + h1) / 2 + (h0 - h1) / 2 * math.cos(math.pi * f)
    rate = (h1 - h0) / 2 * math.sin(math.pi * f) * math.pi / span     # ft/hr, + = incoming
    return height, rate

# ── daylight
LAT, LON = 41.276, -71.963
_sun = {}
def is_day(t):
    d = t.date()
    if d not in _sun:
        n = d.timetuple().tm_yday; g = 2 * math.pi / 365 * (n - 1)
        eq = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
        dec = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
        ha = math.degrees(math.acos(math.cos(math.radians(90.833)) / (math.cos(math.radians(LAT)) * math.cos(dec)) - math.tan(math.radians(LAT)) * math.tan(dec)))
        noon = 720 - 4 * LON - eq; base = dt.datetime(d.year, d.month, d.day, tzinfo=UTC)
        _sun[d] = ((base + dt.timedelta(minutes=noon - 4 * ha)).astimezone(ET), (base + dt.timedelta(minutes=noon + 4 * ha)).astimezone(ET))
    r, s = _sun[d]; return r <= t <= s

# ── hourly table
H = {}
for t, (hs, per, d) in buoy.items():
    e = power(hs, per) * w_soft(d)
    wd = wind.get(t); td = tide(t)
    mc = hs * kchoc(d, per)
    H[t] = dict(hs=hs, per=per, dir=d, e=e, w=w_soft(d), day=is_day(t), mc=mc, mce=power(mc, per),
                ws=wd[0] if wd else None, wdir=wd[1] if wd else None,
                th=td[0] if td else None, tr=td[1] if td else None)
times = sorted(H)
def e3(t):  # 3 h centred mean of soft in-window energy
    v = [H[x]['e'] for x in (t - dt.timedelta(hours=1), t, t + dt.timedelta(hours=1)) if x in H]
    return sum(v) / len(v) if v else None
for t in times: H[t]['e3'] = e3(t)
for t in times:
    v = [H[x]['mce'] for x in (t - dt.timedelta(hours=1), t, t + dt.timedelta(hours=1)) if x in H]
    H[t]['m3'] = sum(v) / len(v)
    v = [H[x]['mc'] for x in (t - dt.timedelta(hours=1), t, t + dt.timedelta(hours=1)) if x in H]
    H[t]['mh3'] = sum(v) / len(v)
for t in times:
    v = [power(H[x]['hs'], H[x]['per']) for x in (t - dt.timedelta(hours=1), t, t + dt.timedelta(hours=1)) if x in H]
    H[t]['ea3'] = sum(v) / len(v)
def clean(r): return r['ws'] is not None and (r['ws'] < 6 or (gap(r['wdir'], OFFSHORE) <= 60 and r['ws'] < 20))
def big(r): return r['hs'] >= 4 and r['w'] >= 0.5
print('hours', len(times), times[0], times[-1])

# ── climatology, two variants
M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
def clim(day_only):
    out = []
    for m in range(1, 13):
        hrs = [H[t] for t in times if t.month == m and (H[t]['day'] or not day_only)]
        n = len(hrs) or 1
        b = [r for r in hrs if big(r)]; bc = [r for r in b if clean(r)]; bci = [r for r in bc if (r['tr'] or 0) > 0]
        out.append(dict(month=M[m - 1], hours=len(hrs), big=round(100 * len(b) / n, 1), big6=round(100 * sum(r['hs'] >= 6 for r in b) / n, 1),
                        clean=round(100 * len(bc) / n, 1), good=round(100 * len(bci) / n, 1),
                        core=round(100 * sum(1 for r in b if 140 <= r['dir'] <= 158) / n, 1)))
    return out

days = collections.OrderedDict()
for t in times: days.setdefault(t.date(), []).append(t)
def best3(ts, key):
    best = None
    for i in range(len(ts)):
        win = [H[x][key] for x in ts[i:i + 3] if H[x][key] is not None and (x - ts[i]) <= dt.timedelta(hours=2)]
        if len(win) >= 2:
            m = sum(win) / len(win); best = m if best is None or m > best else best
    return best

def ym(day_only):
    c = collections.defaultdict(lambda: [0, 0, 0])
    for d, ts in days.items():
        ts2 = [t for t in ts if H[t]['day'] or not day_only]
        nb = sum(big(H[t]) for t in ts2); ng = sum(big(H[t]) and clean(H[t]) and (H[t]['tr'] or 0) > 0 for t in ts2)
        k = f'{d.year}-{d.month:02d}'
        c[k][2] += len(ts)
        if nb >= 3: c[k][0] += 1
        if ng >= 2: c[k][1] += 1
    return dict(sorted(c.items()))

# ── events: runs of big hours (all hours), gap <= 4 h
events, cur = [], None
for t in times:
    if big(H[t]):
        if cur and t - cur['end'] <= dt.timedelta(hours=4): cur['end'] = t; cur['ts'].append(t)
        else: cur = dict(start=t, end=t, ts=[t]); events.append(cur)
ev = []
for e in events:
    rs = [H[t] for t in e['ts']]; pk = max(rs, key=lambda r: r['hs'])
    ev.append(dict(start=e['start'].isoformat()[:16], hours=len(rs), peak_ft=round(pk['hs'], 1), peak_period=pk['per'], peak_dir=pk['dir'],
                   energy=round(sum(r['e'] for r in rs)), clean=sum(clean(r) for r in rs),
                   good=sum(1 for r in rs if clean(r) and (r['tr'] or 0) > 0),
                   good_day=sum(1 for r in rs if clean(r) and (r['tr'] or 0) > 0 and r['day'])))
ev.sort(key=lambda e: -e['energy'])

per_hist = collections.Counter(int(H[t]['per']) for t in times if big(H[t]))

# ══ MODEL: what makes a good session ══════════════════════════════════════
rows = list(csv.DictReader(open('surflog.csv')))
FEATS = ['swell', 'offshore', 'tide_rate']                       # the model (simplest of five sets tried; best LOO)
SCAT = ['swell', 'period', 'offshore', 'wind', 'tide_rate', 'tide_h']  # shown as scatter panels
FLABEL = {'swell': 'Modeled swell energy at Choc (log)', 'period': 'Swell period (s)', 'offshore': 'Offshore wind (kn, − = onshore)',
          'wind': 'Wind speed (kn)', 'tide_rate': 'Tide rate (ft/hr, + = incoming)', 'tide_h': 'Tide height (ft)'}
def scat_at(t):
    """Scatter features for hour t. Swell: best 3 h of in-window energy within +/-3 h of t."""
    ns = [t + dt.timedelta(hours=k) for k in range(-3, 4) if t + dt.timedelta(hours=k) in H]
    r = H.get(t)
    if not ns or r is None or r['ws'] is None or r['th'] is None: return None
    best = max(ns, key=lambda x: H[x]['m3'] or 0)
    off = r['ws'] * math.cos(math.radians(gap(r['wdir'], OFFSHORE)))
    return [math.log1p(H[best]['m3'] or 0), H[best]['per'], off, r['ws'], r['tr'], r['th']]
def feats_at(t):
    f = scat_at(t)
    return None if f is None else [f[0], f[2], f[4]]

S = []
for r in rows:
    t = dt.datetime.fromisoformat(r['date']).replace(tzinfo=ET).replace(minute=0)
    f = feats_at(t)
    if f is None: print('no features for', t); continue
    S.append(dict(t=t, x=f, sx=scat_at(t), size=float(r['size']), wind_q=float(r['windQuality']), ride=float(r['rideQuality']), avg=float(r['avg']),
                  app_tide=float(r['tideH']), app_rate=float(r['tideRate']), notes=r['notes'][:60]))
S.sort(key=lambda s: s['t'])
print('sessions with features', len(S))
print('tide check: corr(my tide height, app tideH) =', round(np.corrcoef([s['sx'][5] for s in S], [s['app_tide'] for s in S])[0, 1], 2),
      '; rate', round(np.corrcoef([s['sx'][4] for s in S], [s['app_rate'] for s in S])[0, 1], 2))

def ridge_fit(X, y, lam):
    mu, sd = X.mean(0), X.std(0); sd[sd == 0] = 1
    Z = (X - mu) / sd; ym_ = y.mean()
    b = np.linalg.solve(Z.T @ Z + lam * np.eye(Z.shape[1]), Z.T @ (y - ym_))
    return dict(mu=mu, sd=sd, b=b, c=ym_)
def ridge_pred(m, X): return m['c'] + ((X - m['mu']) / m['sd']) @ m['b']
def loo(X, y, lam):
    p = np.zeros(len(y))
    for i in range(len(y)):
        k = np.arange(len(y)) != i; p[i] = ridge_pred(ridge_fit(X[k], y[k], lam), X[i:i + 1])[0]
    return p
def r2(y, p): return 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum()
def spear(a, b):
    ra = np.argsort(np.argsort(a)); rb = np.argsort(np.argsort(b)); return float(np.corrcoef(ra, rb)[0, 1])

X = np.array([s['x'] for s in S])
LAMS = [0.3, 1, 3, 10, 30]
XS = np.array([s['sx'] for s in S])
models = {}
random.seed(2); np.random.seed(2)
for target in ['avg', 'size', 'ride', 'wind_q']:
    y = np.array([s[target] for s in S])
    scores = {lam: r2(y, loo(X, y, lam)) for lam in LAMS}
    lam = max(scores, key=scores.get)
    p = loo(X, y, lam); full = ridge_fit(X, y, lam)
    # bootstrap sign stability of standardized coefficients
    B = []
    for _ in range(2000):
        idx = np.random.randint(0, len(y), len(y))
        if len(set(idx)) < 8: continue
        B.append(ridge_fit(X[idx], y[idx], lam)['b'])
    B = np.array(B)
    # prequential: predict each session from earlier sessions only
    preq = []
    for i in range(6, len(y)):
        m = ridge_fit(X[:i], y[:i], lam)
        preq.append(dict(i=i + 1, date=S[i]['t'].strftime('%Y-%m-%d'), actual=float(y[i]),
                         model=float(np.clip(ridge_pred(m, X[i:i + 1])[0], 0, 10)), base=float(y[:i].mean())))
    # univariate correlations for the scatter panels
    uni = {f: round(spear(XS[:, j], y), 2) for j, f in enumerate(SCAT)}
    models[target] = dict(lam=lam, loo_r2=round(scores[lam], 2), loo_rho=round(spear(y, p), 2),
                          mae=round(float(np.abs(y - p).mean()), 2), mae_base=round(float(np.abs(y - np.array([(y.sum() - v) / (len(y) - 1) for v in y])).mean()), 2),
                          coef=[round(float(v), 2) for v in full['b']],
                          coef_lo=[round(float(v), 2) for v in np.percentile(B, 5, axis=0)],
                          coef_hi=[round(float(v), 2) for v in np.percentile(B, 95, axis=0)],
                          sign_pos=[round(float(v), 2) for v in (B > 0).mean(0)],
                          uni=uni, loo_pred=[round(float(v), 2) for v in p], preq=preq,
                          fit=dict(mu=full['mu'].tolist(), sd=full['sd'].tolist(), b=full['b'].tolist(), c=float(full['c'])))
    print(target, 'lam', lam, 'LOO R2', round(scores[lam], 2), 'rho', round(spear(y, p), 2), 'MAE', models[target]['mae'], 'vs base', models[target]['mae_base'])
    print('   coef', dict(zip(FEATS, models[target]['coef'])), '\n   P(+)', dict(zip(FEATS, models[target]['sign_pos'])), '\n   uni', uni)

# ── apply the overall model to every hour → daily predicted score
fit = models['avg']['fit']
def predict(f):
    z = (np.array(f) - np.array(fit['mu'])) / np.array(fit['sd'])
    return float(np.clip(fit['c'] + z @ np.array(fit['b']), 0, 10))
for t in times:
    f = feats_at(t); H[t]['score'] = predict(f) if f else None

def daily(day_only):
    out = []
    for d, ts in days.items():
        ts2 = [t for t in ts if H[t]['day'] or not day_only]
        if not ts2: out.append(None); continue
        out.append(dict(e=best3(ts2, 'e3') or 0, ea=best3(ts2, 'ea3') or 0, s=best3(ts2, 'score'), mh=best3(ts2, 'mh3') or 0))
    return out
dall, dday = daily(False), daily(True)

def good_clim(dd, thr=7.0):
    c = collections.defaultdict(lambda: [0, 0])
    for (d, ts), v in zip(days.items(), dd):
        if v is None or v['s'] is None: continue
        c[d.month][1] += 1
        if v['s'] >= thr: c[d.month][0] += 1
    return [round(100 * c[m][0] / c[m][1], 1) if c[m][1] else 0 for m in range(1, 13)]

# daily series for the animation: date, peak ft, dir@peak, period@peak, best3h energy (all, day), score (all, day), wind (mean dir, mean kn), clean%
series = []
for (d, ts), a, b in zip(days.items(), dall, dday):
    pk = max((H[t] for t in ts), key=lambda r: r['hs'])
    ws = [(H[t]['wdir'], H[t]['ws']) for t in ts if H[t]['ws'] is not None]
    if ws:
        sx = sum(s * math.sin(math.radians(a_)) for a_, s in ws); cx = sum(s * math.cos(math.radians(a_)) for a_, s in ws)
        wdir = round(math.degrees(math.atan2(sx, cx)) % 360); wspd = round(sum(s for _, s in ws) / len(ws), 1)
        cl = round(100 * sum(clean(H[t]) for t in ts if H[t]['ws'] is not None) / len(ws))
    else: wdir = wspd = cl = None
    series.append([d.strftime('%y%m%d'), round(pk['hs'], 1), round(pk['dir']), round(pk['per'], 1),
                   round(a['e'], 1), round(b['e'], 1) if b else 0, round(a['ea'], 1),
                   round(a['s'], 1) if a['s'] is not None else None, round(b['s'], 1) if b and b['s'] is not None else None,
                   wdir, wspd, cl, round(a['mh'], 1), round(b['mh'], 1) if b else 0])

out = dict(
    clim=dict(all=clim(False), day=clim(True)), ym=dict(all=ym(False), day=ym(True)),
    events=ev[:12], per=sorted(per_hist.items()),
    good=dict(all=good_clim(dall), day=good_clim(dday)),
    model=dict(feats=FEATS, scat=SCAT, labels=FLABEL, targets=models,
               sessions=[dict(date=s['t'].strftime('%Y-%m-%d %H:%M'), x=[round(v, 3) for v in s['sx']], size=s['size'], ride=s['ride'],
                              wind_q=s['wind_q'], avg=s['avg'], notes=s['notes']) for s in S]),
    daily=series)
json.dump(out, open('results3.json', 'w'), separators=(',', ':'), default=str)
print('good-day % by month (all hours):', out['good']['all'])
print('good-day % by month (daylight):', out['good']['day'])
print('top events', [(e['start'][:10], e['peak_ft'], e['peak_dir']) for e in ev[:6]])
