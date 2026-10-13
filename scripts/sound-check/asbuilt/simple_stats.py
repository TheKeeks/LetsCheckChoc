import json, csv, datetime as dt, itertools, sys
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
src = json.load(open(sys.argv[1]))
rows = list(csv.DictReader(open('surflog.csv')))
def best3(day, idx):
    v = []
    for hr in range(24):
        k = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H')
        v.append(src[k][idx] if k in src else None)
    best = None
    for i in range(22):
        w = [x for x in v[i:i + 3] if x is not None]
        if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
    return best
S = []
for r in rows:
    d = dt.datetime.fromisoformat(r['date']).date()
    b, m = best3(d, 0), best3(d, 1)
    if b is not None and m is not None: S.append((r['date'][:10], b, m, float(r['size']), float(r['avg']), r.get('notes', '')[:40]))
print('sessions', len(S))
B = np.array([s[1] for s in S]); M = np.array([s[2] for s in S]); Z = np.array([s[3] for s in S])
def spear(x, y): rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return np.corrcoef(rx, ry)[0, 1]
print('spearman buoy %.2f model %.2f' % (spear(B, Z), spear(M, Z)))
def pairs(x):
    c = t = n = 0
    for i, j in itertools.combinations(range(len(Z)), 2):
        if Z[i] == Z[j]: continue
        n += 1; s = np.sign(x[i] - x[j]) * np.sign(Z[i] - Z[j]); c += s > 0
    return c, n
for nm, x in (('buoy', B), ('model', M)): c, n = pairs(x); print(nm, 'pairs right %d/%d = %.0f%%' % (c, n, 100 * c / n))
# top and bottom quarter
k = 7; order = np.argsort(-Z)
top = set(np.argsort(-Z)[:k]); bot = set(np.argsort(Z)[:k])
for nm, x in (('buoy', B), ('model', M)):
    pt = set(np.argsort(-x)[:k]); pb = set(np.argsort(x)[:k])
    print(nm, 'top7 overlap', len(pt & top), 'bottom7 overlap', len(pb & bot))
# LOO linear fit: predict size rating
for nm, x in (('buoy', B), ('model', M)):
    err = []
    for i in range(len(Z)):
        msk = np.arange(len(Z)) != i; a, b = np.polyfit(x[msk], Z[msk], 1); err.append(abs(a * x[i] + b - Z[i]))
    print(nm, 'LOO mean abs error in size points %.2f' % np.mean(err), ' pearson r %.2f' % np.corrcoef(x, Z)[0, 1])
print('guess-average error %.2f' % np.mean([abs(np.mean(np.delete(Z, i)) - Z[i]) for i in range(len(Z))]))
for s in sorted(S, key=lambda s: s[3]): print('%s  size %4.1f  buoy %5.1f ft  model %4.1f ft  %s' % (s[0], s[3], s[1], s[2], s[5]))
json.dump([{'date': s[0], 'buoy': round(s[1], 2), 'model': round(s[2], 2), 'size': s[3]} for s in S], open('chart_sessions.json', 'w'), indent=0)
