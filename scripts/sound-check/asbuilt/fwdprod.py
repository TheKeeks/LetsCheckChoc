"""Forward-ray tables and pictures for Part 1 (48 m grid).

For every period T (5-17 s) and direction D (50-240 deg, 2.5 deg steps), single direction:
  rays leave a straight deep-water crest every 20 m (crest = just offshore of everything
  shallower than 45 m, square to the swell), bend over the bottom, stop on land.
  Counted: rays passing within 250 m of the Choc pin, and within 150 m of the Wilderness
  shoreline segment. ratio = rays through the zone / rays that would cross it in open water.
  K2 = ratio x shoaling (cg0 / cg at the zone's mean depth)  -> fraction of deep-water energy.
For the picture (T even, D multiple of 5): ~140 evenly spaced rays plus up to 40 that land at
each spot, with their paths (every ~480 m), in km x 100 from the world's top-left.
Usage: python3 fwdprod.py <worker> <nworkers>   -> fwd_<worker>.json
"""
import json, math, sys
import numpy as np
F = 6
world = json.load(open('world.json'))
z8 = np.load('elev8.npy', mmap_mode='r')
R, C = z8.shape[0] // F, z8.shape[1] // F
z = np.asarray(z8[:R * F, :C * F], np.float32).reshape(R, F, C, F).mean(axis=(1, 3)).astype(np.float64)
dx = 8.0 * F
h = np.clip(-z, 0, None); water = h > 0.5
G = 9.81
def toxy(lat, lon): return ((lon - world['left']) * world['kmlon'] * 1000, (world['top'] - lat) * world['kmlat'] * 1000)
CHOC = toxy(41.27591, -71.96359); W1, W2 = toxy(41.25286, -72.00573), toxy(41.25551, -72.01117)
RC, RW, SP = 250.0, 150.0, 20.0

def box(a, r, axis):
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    p = np.pad(a, pad, mode='edge'); cs = np.cumsum(p, axis=axis)
    cs = np.concatenate([np.zeros_like(np.take(cs, [0], axis=axis)), cs], axis=axis)
    n = a.shape[axis]
    return (np.take(cs, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(cs, np.arange(0, n), axis=axis)) / (2 * r + 1)
def blur(a, r):
    for _ in range(3): a = box(box(a, r, 0), r, 1)
    return a
def seg_dist(px, py, a, b):
    ax, ay = a; bx, by = b; vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))
Yg, Xg = np.mgrid[0:R, 0:C]; Xg = (Xg + 0.5) * dx; Yg = (Yg + 0.5) * dx
ZC = (np.hypot(Xg - CHOC[0], Yg - CHOC[1]) < RC) & water
ZW = (seg_dist(Xg, Yg, W1, W2) < RW) & water

def fields(T):
    L0 = G * T * T / (2 * math.pi); hh = np.maximum(h, 0.5)
    L = L0 * np.tanh((2 * math.pi * np.sqrt(hh / G) / T) ** 1.5) ** (2 / 3)
    k = 2 * math.pi / L; c = L / T; kh = np.minimum(k * hh, 20); n = 0.5 * (1 + 2 * kh / np.sinh(2 * kh))
    cg = n * c
    Lb = L0 * math.tanh((2 * math.pi * math.sqrt(48 / G) / T) ** 1.5) ** (2 / 3); kb = 2 * math.pi / Lb
    cg0 = 0.5 * (1 + 2 * kb * 48 / math.sinh(2 * kb * 48)) * Lb / T     # group speed at the buoy's depth
    cs = blur(np.where(water, c, c[water].min()), 3)
    gy, gx = np.gradient(cs, dx, dx)
    return dict(cs=cs, gx=gx, gy=gy, shC=cg0 / cg[ZC].mean(), shW=cg0 / cg[ZW].mean())

# open-ocean edges: the whole south edge, the east edge (water), and the west edge only south of Long Island
west_open = np.zeros(R, bool)
for r in range(R - 1, -1, -1):
    if not water[r, 0]: break
    west_open[r] = True
def crest(D):
    """Rays enter where the swell crosses the open-ocean edges, spaced so they are SP apart
    measured along the crest (equal energy each). Returns start points and the travel angle."""
    beta = math.radians(D + 180); tx, ty = math.sin(beta), -math.cos(beta)
    xs, ys = [], []
    if ty < -0.05:                                     # travelling north: south edge
        for x in np.arange(SP / 2 / abs(ty), C * dx, SP / abs(ty)):
            if water[R - 1, min(C - 1, int(x / dx))]: xs.append(x); ys.append(R * dx - 1)
    if tx < -0.05:                                     # travelling west: east edge
        for y in np.arange(SP / 2 / abs(tx), R * dx, SP / abs(tx)):
            if water[min(R - 1, int(y / dx)), C - 1]: xs.append(C * dx - 1); ys.append(y)
    if tx > 0.05:                                      # travelling east: west edge south of Long Island
        for y in np.arange(SP / 2 / abs(tx), R * dx, SP / abs(tx)):
            if west_open[min(R - 1, int(y / dx))]: xs.append(1.0); ys.append(y)
    return np.array(xs, float), np.array(ys, float), math.atan2(ty, tx)

def run(Fd, X, Y, phi0, record_every=0):
    n = len(X); phi = np.full(n, float(phi0)); alive = np.ones(n, bool)
    hitC = np.zeros(n, bool); hitW = np.zeros(n, bool); ds = 0.5 * dx
    paths = [[(X[i], Y[i])] for i in range(n)] if record_every else None
    for step in range(int(2.6 * (R + C) / 0.5)):
        idx = np.where(alive)[0]
        if not len(idx): break
        ci = (X[idx] / dx).astype(int); ri = (Y[idx] / dx).astype(int)
        inb = (ci >= 0) & (ci < C) & (ri >= 0) & (ri < R)
        alive[idx[~inb]] = False; idx = idx[inb]; ci = ci[inb]; ri = ri[inb]
        hitC[idx] |= np.hypot(X[idx] - CHOC[0], Y[idx] - CHOC[1]) < RC
        hitW[idx] |= seg_dist(X[idx], Y[idx], W1, W2) < RW
        land = ~water[ri, ci]
        alive[idx[land]] = False
        if record_every:
            for i in idx[land]: paths[i].append((X[i], Y[i]))
        idx = idx[~land]; ci = ci[~land]; ri = ri[~land]
        nxv, nyv = -np.sin(phi[idx]), np.cos(phi[idx])
        phi[idx] -= ds * (Fd['gx'][ri, ci] * nxv + Fd['gy'][ri, ci] * nyv) / Fd['cs'][ri, ci]
        X[idx] += ds * np.cos(phi[idx]); Y[idx] += ds * np.sin(phi[idx])
        if record_every and step % record_every == 0:
            for i in idx: paths[i].append((X[i], Y[i]))
    if record_every:
        for i in np.where(alive)[0]: paths[i].append((X[i], Y[i]))
    return hitC, hitW, paths

if __name__ == '__main__':
    wk, nw = int(sys.argv[1]), int(sys.argv[2])
    PERS = list(range(5, 18)); DIRS = [50 + 2.5 * i for i in range(77)]
    out = {}
    for T in PERS[wk::nw]:
        Fd = fields(T)
        for D in DIRS:
            X, Y, phi0 = crest(D)
            hc, hw, _ = run(Fd, X.copy(), Y.copy(), phi0)
            rec = dict(n=int(len(X)), hc=int(hc.sum()), hw=int(hw.sum()),
                       k2c=float(hc.sum() * SP / (2 * RC) * Fd['shC']), k2w=float(hw.sum() * SP / (2 * RW) * Fd['shW']))
            if T % 2 == 0 and D % 5 == 0:
                n = len(X); ctx = list(range(0, n, max(1, n // 140)))
                ic = list(np.where(hc)[0]); iw = list(np.where(hw)[0])
                ic = ic[::max(1, len(ic) // 40)]; iw = iw[::max(1, len(iw) // 40)]
                sel = sorted(set(ctx) | set(ic) | set(iw))
                a, b, paths = run(Fd, X[sel].copy(), Y[sel].copy(), phi0, record_every=10)
                rays = []
                for j, i in enumerate(sel):
                    p = paths[j]
                    rays.append(dict(h=('c' if hc[i] else '') + ('w' if hw[i] else ''), p=[int(round(v / 10)) for q in p for v in q]))
                rec.update(rays=rays, sp=SP * n / len(ctx))
            out[f'{T}_{D:g}'] = rec
            print(T, D, rec['hc'], rec['hw'], round(rec['k2c'], 3), round(rec['k2w'], 3), flush=True)
        json.dump(out, open(f'fwd_{wk}.json', 'w'), separators=(',', ':'))
    json.dump(out, open(f'fwd_{wk}.json', 'w'), separators=(',', ':'))
    print('DONE', flush=True)
