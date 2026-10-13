import math, json, sys, numpy as np
import backtrace as bt
def seg_dist_km(lat, lon, a, b):
    # distance from point to segment a-b in km (local flat projection)
    ax, ay = a[1] * bt.kmlon, a[0] * 110.95; bx, by = b[1] * bt.kmlon, b[0] * 110.95; px, py = lon * bt.kmlon, lat * 110.95
    vx, vy = bx - ax, by - ay; t = max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy))) if (vx or vy) else 0
    return math.hypot(px - ax - t * vx, py - ay - t * vy)
def cell_ll(r, c):
    m = bt.meta; return m['top'] - (r + 0.5) * (m['top'] - m['bottom']) / bt.R, m['left'] + (c + 0.5) * (m['right'] - m['left']) / bt.C
SPOTS = {
    'choc': dict(a=(41.27591, -71.96359), b=(41.27591, -71.96359), radius=0.45),
    'wild': dict(a=(41.25286, -72.00573), b=(41.25551, -72.01117), radius=0.30),
}
out = {}
for name, sp in SPOTS.items():
    pts = []
    for r in range(bt.R):
        for c in range(bt.C):
            if not (3 <= bt.h[r, c] <= 10): continue
            lat, lon = cell_ll(r, c)
            if abs(lat - sp['a'][0]) > 0.02 or abs(lon - sp['a'][1]) > 0.03: continue
            if seg_dist_km(lat, lon, sp['a'], sp['b']) <= sp['radius'] and lat < max(sp['a'][0], sp['b'][0]) + 0.001: pts.append((r, c))
    bt.START = pts
    print(name, 'start points', len(pts), 'depths', sorted(round(float(bt.h[p]), 1) for p in pts), file=sys.stderr)
    K = []
    for T in bt.PERIODS:
        Rk, _ = bt.backtrace(T); K.append(Rk)
    K = np.array(K)
    np.savez_compressed(f'backkernel_{name}.npz', periods=np.array(bt.PERIODS), R=K)
    th = np.radians(np.arange(360))
    def fac(T, d0, s=15):
        D = np.cos((th - math.radians(d0)) / 2) ** (2 * s); D /= D.sum() * math.radians(1)
        return math.sqrt((D * K[bt.PERIODS.index(T)]).sum())
    for T in (6, 9, 12, 15):
        print(f'  {name} T{T:2d}', ' '.join(f'{d}:{fac(T, d):.2f}' for d in range(70, 221, 15)), file=sys.stderr)
    out[name] = dict(start=[[int(r), int(c)] for r, c in pts], a=sp['a'], b=sp['b'])
json.dump(out, open('spots.json', 'w'))
