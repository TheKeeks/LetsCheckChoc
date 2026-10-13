import json, csv, datetime as dt, itertools
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
new = json.load(open('fwd2spec_choc_s1.json')); old = json.load(open('back_v12/spec_choc.json'))
rows = list(csv.DictReader(open('surflog.csv')))
def best3(src, day, idx):
    v = []
    for hr in range(24):
        k = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H')
        v.append(src[k][idx] if k in src else None)
    best = None
    for i in range(22):
        w = [x for x in v[i:i + 3] if x is not None]
        if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
    return best
D = []
for r in rows:
    d = dt.datetime.fromisoformat(r['date']).date()
    b, m, o = best3(new, d, 0), best3(new, d, 1), best3(old, d, 1)
    if None not in (b, m, o): D.append((b, m, o, float(r['size']), float(r['avg'])))
D = np.array(D); B, M, O, SZ, AV = D.T
def spear(x, y):
    from scipy.stats import spearmanr; return spearmanr(x, y).correlation
def pairs(x, z):
    c = n = 0
    for i, j in itertools.combinations(range(len(z)), 2):
        if z[i] == z[j]: continue
        n += 1; c += (x[i] - x[j]) * (z[i] - z[j]) > 0
    return c / n
for nm, z in (('size', SZ), ('overall', AV)):
    print(f'{nm}: spearman buoy {spear(B, z):.2f} model {spear(M, z):.2f} backward {spear(O, z):.2f} | pick-bigger buoy {pairs(B, z):.0%} model {pairs(M, z):.0%}')
rng = np.random.default_rng(1); dsp, dpr = [], []
for _ in range(4000):
    i = rng.integers(0, len(SZ), len(SZ)); z = SZ[i]
    if np.ptp(z) == 0: continue
    dsp.append(spear(M[i], z) - spear(B[i], z)); dpr.append(pairs(M[i], z) - pairs(B[i], z))
dsp, dpr = np.array(dsp), np.array(dpr)
print('paired bootstrap, size: model beats buoy in %.1f%% of resamples (rank corr); diff 90%% range %.2f to %.2f' % (100 * (dsp > 0).mean(), *np.percentile(dsp, [5, 95])))
print('paired bootstrap, size: pick-bigger diff 90%% range %.0f to %.0f points; model ahead in %.1f%%' % (*(100 * np.percentile(dpr, [5, 95])), 100 * (dpr > 0).mean()))
# leave-one-out typical miss in rating points, size and overall
for nm, z in (('size', SZ), ('overall', AV)):
    for lab, x in (('buoy', B), ('model', M)):
        e = [abs(np.polyval(np.polyfit(np.delete(x, k), np.delete(z, k), 1), x[k]) - z[k]) for k in range(len(z))]
        print(f'  LOO typical miss {nm} {lab}: {np.mean(e):.2f}')
    print(f'  guess-average {nm}: {np.mean([abs(np.mean(np.delete(z, k)) - z[k]) for k in range(len(z))]):.2f}')
