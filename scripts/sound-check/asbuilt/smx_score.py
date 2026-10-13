"""Score smoothing / numerics variants against the surf log, paired against the dense production-smoothing run (r3).
For each variant: table -> hourly Choc heights (valid_fwd2.py) -> best 3 h of each logged day vs the size you logged.
usage: python3 smx_score.py r3 r1 r5 ...   (variants whose smx_<name>_[0-3].json are complete)
"""
import json, csv, os, sys, subprocess, itertools, datetime as dt
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
rows = list(csv.DictReader(open('surflog.csv')))
def best3(src, day):
    v = []
    for hr in range(24):
        k = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H'); v.append(src[k][1] if k in src else None)
    best = None
    for i in range(22):
        w = [x for x in v[i:i + 3] if x is not None]
        if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
    return best
def spear(x, y): rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return float(np.corrcoef(rx, ry)[0, 1])
def pairs(x, z):
    c = n = 0
    for i, j in itertools.combinations(range(len(z)), 2):
        if z[i] == z[j]: continue
        n += 1; c += np.sign(x[i] - x[j]) * np.sign(z[i] - z[j]) > 0
    return c / n
def loo(x, z):
    e = []
    for i in range(len(z)):
        m = np.arange(len(z)) != i; a, b = np.polyfit(x[m], z[m], 1); e.append(abs(a * x[i] + b - z[i]))
    return float(np.mean(e))
def hourly(name):
    f = f'fwd2spec_choc_{name}.json'
    if not os.path.exists(f):
        if name != 'prod':
            subprocess.run(['python3', 'smx.py', 'table', name], check=True)
        subprocess.run(['python3', 'valid_fwd2.py', f'fwd2_table_{name}.json'], check=True, capture_output=True)
    return json.load(open(f))
names = ['prod'] + sys.argv[1:]
H = {n: hourly(n) for n in names}
days = [dt.datetime.fromisoformat(r['date']).date() for r in rows]; Z = np.array([float(r['size']) for r in rows])
X = {n: np.array([best3(H[n], d) for d in days], float) for n in names}
ok = np.all([~np.isnan(X[n]) for n in names], axis=0); Z = Z[ok]; X = {n: x[ok] for n, x in X.items()}
ref = 'r3' if 'r3' in names else 'prod'
rng = np.random.default_rng(3); B = [rng.integers(0, len(Z), len(Z)) for _ in range(3000)]
keys = sorted(set.intersection(*[set(H[n]) for n in names]))
base = np.array([H[ref][k][1] for k in keys]); surf = base > 2.0
print(f'{len(Z)} sessions; reference for the paired columns: {ref}; hours compared {len(keys)} ({surf.sum()} with Choc > 2 ft)')
print(f'{"variant":8s} {"rho":>5s} {"pairs":>6s} {"LOO":>5s}   {"d_rho vs ref (95%)":>22s}   {"height vs ref, Choc>2ft: median (10-90%)":>40s}')
for n in names:
    x = X[n]; d = [spear(x[i], Z[i]) - spear(X[ref][i], Z[i]) for i in B]
    hv = np.array([H[n][k][1] for k in keys])[surf] / base[surf]
    print(f'{n:8s} {spear(x, Z):5.2f} {100 * pairs(x, Z):5.0f}% {loo(x, Z):5.2f}   {np.mean(d):+.3f} ({np.percentile(d, 2.5):+.2f} to {np.percentile(d, 97.5):+.2f})   '
          f'{np.median(hv):6.2f} ({np.percentile(hv, 10):.2f}-{np.percentile(hv, 90):.2f})')
