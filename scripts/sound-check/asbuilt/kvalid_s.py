import json, math, csv, glob, datetime as dt, numpy as np, random
from zoneinfo import ZoneInfo
import kchoc_s as kc
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
z, F, km = kc.z, kc.F, kc.km
r0, c0 = kc.CH
cells = [(r, c) for r in range(r0 - 6, r0 + 7) for c in range(c0 - 7, c0 + 8)
         if 1.5 < -z[r, c] < 12 and r >= r0 - 1 and ((r - r0) * 0.154) ** 2 + ((c - c0) * 0.116) ** 2 < 0.75 ** 2]
print('reef cells', len(cells))
rr = tuple(np.array(cells).T)
Kavg = {k: float(F[k][rr].mean()) for k in F.files}
for T in km['pers']:
    print('T', T, ' '.join(f"{D}:{Kavg[f'{D}_{T}']:.2f}" for D in km['dirs']))
def K(D, T):
    Ds, Ts = km['dirs'], km['pers']
    D = min(max(D, Ds[0]), Ds[-1]); T = min(max(T, Ts[0]), Ts[-1])
    i = min(len(Ds) - 2, int((D - Ds[0]) // 10)); fd = (D - Ds[i]) / 10
    j = max(0, min(len(Ts) - 2, sum(1 for t in Ts if t <= T) - 1)); ft = (T - Ts[j]) / (Ts[j + 1] - Ts[j])
    g = lambda d, t: Kavg[f'{d}_{t}']
    return (g(Ds[i], Ts[j]) * (1 - fd) + g(Ds[i + 1], Ts[j]) * fd) * (1 - ft) + (g(Ds[i], Ts[j + 1]) * (1 - fd) + g(Ds[i + 1], Ts[j + 1]) * fd) * ft
B = {}
for f in sorted(glob.glob('ndbc/44097h*.txt')) + sorted(glob.glob('ndbc/44097_2026_*.txt')) + ['ndbc/44097_realtime.txt']:
    for line in open(f):
        if line.startswith('#'): continue
        p = line.split()
        try: t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC); hs, per, d = float(p[8]), float(p[9]), float(p[11])
        except (ValueError, IndexError): continue
        if hs >= 99 or per >= 99 or d >= 999: continue
        B.setdefault(t.astimezone(ET), (hs * 3.28084, per, d))
def wsoft(d): return 1 if 115 <= d <= 158 else (d - 100) / 15 if 100 <= d < 115 else (175 - d) / 17 if 158 < d <= 175 else 0
def day_best3(day, fn):
    t0 = dt.datetime(day.year, day.month, day.day, tzinfo=ET); v = [fn(B[t]) if t in B else None for t in (t0 + dt.timedelta(hours=i) for i in range(24))]
    best = None
    for i in range(22):
        w = [x for x in v[i:i + 3] if x is not None]
        if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
    return best
mod = lambda r: r[0] * K(r[2], r[1])                      # modeled Choc height, ft
modE = lambda r: 0.49 * (mod(r) / 3.28084) ** 2 * 0.9 * r[1]
buoyE = lambda r: 0.49 * (r[0] / 3.28084) ** 2 * 0.9 * r[1] * wsoft(r[2])
rows = list(csv.DictReader(open('surflog.csv')))
def rank(a): s = sorted(range(len(a)), key=lambda i: a[i]); r = [0] * len(a); [r.__setitem__(i, k) for k, i in enumerate(s)]; return r
def sp(x, y): return float(np.corrcoef(rank(x), rank(y))[0, 1])
res = {}
for name, fn in [('model height at Choc', mod), ('model energy at Choc', modE), ('buoy soft-window energy', buoyE)]:
    for tgt in ['size', 'avg']:
        xs, ys = [], []
        for r in rows:
            d = dt.datetime.fromisoformat(r['date']).date(); v = day_best3(d, fn)
            if v is not None: xs.append(v); ys.append(float(r[tgt]))
        rho = sp(xs, ys); bs = []
        random.seed(3)
        for _ in range(2000):
            idx = [random.randrange(len(xs)) for _ in xs]; bs.append(sp([xs[i] for i in idx], [ys[i] for i in idx]))
        bs.sort(); res[(name, tgt)] = (round(rho, 2), round(bs[50], 2), round(bs[1950], 2))
        print(f'{name:28s} vs {tgt:5s} rho {rho:+.2f} [{bs[50]:+.2f},{bs[1950]:+.2f}]')
# Ian and Larry check
for day in [dt.date(2022, 10, 14), dt.date(2021, 9, 10), dt.date(2023, 9, 15)]:
    print(day, 'buoy best3 ft', round(day_best3(day, lambda r: r[0]), 1), 'model Choc ft', round(day_best3(day, mod), 1), 'buoy soft energy', round(day_best3(day, buoyE), 1))
json.dump(dict(cells=cells, Kavg=Kavg), open('kchoc_avg_s.json', 'w'))
