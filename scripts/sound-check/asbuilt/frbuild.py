"""Package forward-ray results for the page: fr/<T>.json (ray pictures per direction),
FRTAB (counts) and FRMETA (zones, extents). Also fwd_table.json with corrected k2."""
import json, glob, math, os
import numpy as np
w = json.load(open('world.json')); bg = json.load(open('fr_meta.json'))
tab = {}
for f in glob.glob('fwd_[0-9].json'): tab.update(json.load(open(f)))
def toxy(lat, lon): return ((lon - w['left']) * w['kmlon'], (w['top'] - lat) * w['kmlat'])      # km
CHOC = toxy(41.27591, -71.96359); W1 = toxy(41.25286, -72.00573); W2 = toxy(41.25551, -72.01117)
RC, RW, SP = 250.0, 150.0, 20.0
def width_w(D):
    b = math.radians(D + 180); tx, ty = math.sin(b), -math.cos(b); vx, vy = W2[0] - W1[0], W2[1] - W1[1]
    return abs(vx * ty - vy * tx) * 1000 + 2 * RW
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float); P = np.array(pts, float); ab = b - a; L = np.hypot(*ab)
    d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L if L > 0 else np.hypot(*(P - a).T)
    i = int(np.argmax(d))
    return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps) if d[i] > eps else [pts[0], pts[-1]]
os.makedirs('fr', exist_ok=True)
FRTAB, fine = {}, {}
byT = {}
for k, r in tab.items():
    T, D = k.split('_'); T = int(T); D = float(D)
    # the Wilderness zone is a strip: its open-water width depends on direction (the run used 300 m)
    k2w = r['k2w'] * 2 * RW / width_w(D)
    fine.setdefault(T, {})[f'{D:g}'] = [r['hc'], r['hw'], r['k2c'], k2w]
    if 'rays' in r:
        Di = int(D); FRTAB.setdefault(T, {})[Di] = [r['hc'], r['hw']]
        rays = []
        for ray in r['rays']:
            p = ray['p']; pts = [(p[i], p[i + 1]) for i in range(0, len(p), 2)]
            s = dp(pts, 3)                                  # 30 m tolerance (units are 10 m)
            rays.append(dict(h=ray['h'], p=[v for q in s for v in q]))
        byT.setdefault(T, {})[Di] = dict(rays=rays)
for T, d in byT.items(): json.dump(d, open(f'fr/{T}.json', 'w'), separators=(',', ':'))
json.dump(fine, open('fwd_table.json', 'w'), separators=(',', ':'))
meta = dict(world=bg['world'], kmlon=w['kmlon'], kmlat=w['kmlat'], choc=CHOC, w1=W1, w2=W2, rc=RC, rw=RW, depthC=3.5, depthW=2.5,
            close=bg['close'])
json.dump(dict(meta=meta, tab=FRTAB), open('fr_page.json', 'w'), separators=(',', ':'))
print('picture bins', sum(len(v) for v in byT.values()), 'MB', sum(os.path.getsize('fr/' + f) for f in os.listdir('fr')) / 1e6)
