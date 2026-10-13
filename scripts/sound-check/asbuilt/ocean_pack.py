"""Thin the ocean rays (Douglas-Peucker, 6 m) for the page: site/ocean/*.json"""
import json, glob, os, math
import numpy as np
os.makedirs('site/ocean', exist_ok=True)
def dp(P, eps):
    keep = np.zeros(len(P), bool); keep[0] = keep[-1] = True; st = [(0, len(P) - 1)]
    while st:
        a, b = st.pop()
        if b <= a + 1: continue
        A, B = P[a], P[b]; ab = B - A; L = np.hypot(*ab); Q = P[a + 1:b]
        d = np.abs(ab[0] * (Q[:, 1] - A[1]) - ab[1] * (Q[:, 0] - A[0])) / L if L > 0 else np.hypot(*(Q - A).T)
        i = int(np.argmax(d))
        if d[i] > eps: keep[a + 1 + i] = True; st += [(a, a + 1 + i), (a + 1 + i, b)]
    return keep
def thin(r):
    p = np.array(r['p'], float).reshape(-1, 4)
    xy = np.c_[p[:, 0] / 1e4 * 111320 * math.cos(math.radians(41)), p[:, 1] / 1e4 * 110950]
    k = dp(xy, 6.0)
    # keep a point at least every 40 for a smooth depth/time readout
    k[::40] = True
    r['p'] = [int(v) for v in p[k].ravel()]; return r
tot = 0
for f in glob.glob('ocean/aim_*.json') + ['ocean/random.json']:
    rays = [thin(r) for r in json.load(open(f))]
    pass
    out = 'site/' + f; json.dump(rays, open(out, 'w'), separators=(',', ':')); tot += os.path.getsize(out)
    print(out, len(rays), os.path.getsize(out))
print('total', tot)
