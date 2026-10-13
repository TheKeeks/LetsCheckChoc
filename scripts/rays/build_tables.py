"""Choc's and Wilderness's wave-ray tables for the Sound Check page (research/): for every swell period (5-17 s)
and direction (50-240 deg, every 2.5 deg), how much of the buoy's swell energy reaches each spot.

  trace   A straight crest of rays 20 m apart enters where the swell crosses the open edges of the survey map
          (the 8 m NOAA survey averaged to 48 m), bends over the bottom (raycore.py) and stops on land. For every ray
          it keeps the closest approach to the Choc pin and to the Wilderness shoreline, and the angle it meets the
          bottom contours there (the peel angle: 0 = square-on, closes out). Pictures: for even periods and every
          5 deg, sample ray paths. One worker's share of the periods -> OUT/fwd_<worker>.json
  tables  Counts the rays landing in each spot's zone (it widens with wavelength, raycore.landing_radius) and turns
          them into K^2, the fraction of the buoy's energy that arrives, after shoaling to 4 m -> OUT/fwd_table.json.
          With --page also OUT/fr/<T>.json (the page's ray pictures) and OUT/fr_page.json (counts and peel shares).

The inputs live outside the repo (the 8 m survey grid alone is 812 MB): DATA/elev8.npy (elevation in m, 8 m cells,
north row first), DATA/world.json (its edges) and DATA/fr_meta.json (the pictures' backdrop). The tables and
everything built from them are then made into the page outside the repo (see CLAUDE.md, research/).
About 20 minutes on 4 workers.

usage: python3 build_tables.py trace DATA OUT <worker> <nworkers>
       python3 build_tables.py tables DATA OUT [--page]
"""
import glob
import json
import math
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raycore as rc  # noqa: E402

F = 6                                    # 8 m cells per 48 m cell, each way
SP = 20.0                                # ray spacing along the crest, m
RC, RW = 250.0, 150.0                    # smallest landing zones: around the Choc pin, along the Wilderness shoreline
NEAR = 3000.0                            # rays kept per spot (closest approach, m)
PERS = list(range(5, 18))
DIRS = [50 + 2.5 * i for i in range(77)]
PEEL, PEEL_NEAR = 30.0, 400.0            # peels if it meets the contours at 30 deg or more; rays within 400 m count
CHOC_LL, W1_LL, W2_LL = (41.27591, -71.96359), (41.25286, -72.00573), (41.25551, -72.01117)
FINE = dict(lat0=41.32, lat1=41.20, lon0=-72.08, lon1=-71.88)   # where the peel angle is read on the 8 m survey


def seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


class World:
    """The 48 m grid, the spots and the open-ocean edges."""
    def __init__(self, data):
        self.w = json.load(open(os.path.join(data, 'world.json')))
        self.z8 = np.load(os.path.join(data, 'elev8.npy'), mmap_mode='r')
        R, C = self.z8.shape[0] // F, self.z8.shape[1] // F
        z = np.asarray(self.z8[:R * F, :C * F], np.float32).reshape(R, F, C, F).mean(axis=(1, 3)).astype(np.float64)
        self.R, self.C, self.dx = R, C, 8.0 * F
        self.h = np.clip(-z, 0, None)
        self.water = self.h > 0.5
        self.choc, self.w1, self.w2 = self.toxy(*CHOC_LL), self.toxy(*W1_LL), self.toxy(*W2_LL)
        self.west_open = np.zeros(R, bool)              # the west edge is open sea only south of Long Island
        for r in range(R - 1, -1, -1):
            if not self.water[r, 0]:
                break
            self.west_open[r] = True
        w = self.w                                     # bottom-contour directions near Fishers, for the peel angle
        self.fr0 = int((w['top'] - FINE['lat0']) * w['kmlat'] / 0.008)
        r1 = int((w['top'] - FINE['lat1']) * w['kmlat'] / 0.008)
        self.fc0 = int((FINE['lon0'] - w['left']) * w['kmlon'] / 0.008)
        c1 = int((FINE['lon1'] - w['left']) * w['kmlon'] / 0.008)
        zz = rc.blur(np.asarray(self.z8[self.fr0:r1, self.fc0:c1], np.float64), 2)
        self.fgy, self.fgx = np.gradient(zz, 8.0, 8.0)  # elevation gradient: points toward shallower water

    def toxy(self, lat, lon):
        w = self.w
        return ((lon - w['left']) * w['kmlon'] * 1000, (w['top'] - lat) * w['kmlat'] * 1000)

    def crest(self, D):
        """Rays enter where the swell from D crosses the open edges, SP apart measured along the crest (equal energy
        each). Returns start points and the travel angle."""
        R, C, dx, water = self.R, self.C, self.dx, self.water
        beta = math.radians(D + 180)
        tx, ty = math.sin(beta), -math.cos(beta)
        xs, ys = [], []
        if ty < -0.05:                                 # travelling north: south edge
            for x in np.arange(SP / 2 / abs(ty), C * dx, SP / abs(ty)):
                if water[R - 1, min(C - 1, int(x / dx))]:
                    xs.append(x); ys.append(R * dx - 1)
        if tx < -0.05:                                 # travelling west: east edge
            for y in np.arange(SP / 2 / abs(tx), R * dx, SP / abs(tx)):
                if water[min(R - 1, int(y / dx)), C - 1]:
                    xs.append(C * dx - 1); ys.append(y)
        if tx > 0.05:                                  # travelling east: west edge south of Long Island
            for y in np.arange(SP / 2 / abs(tx), R * dx, SP / abs(tx)):
                if self.west_open[min(R - 1, int(y / dx))]:
                    xs.append(1.0); ys.append(y)
        return np.array(xs, float), np.array(ys, float), math.atan2(ty, tx)

    def peel_deg(self, px, py, phi):
        """Angle between travel and the 'toward shallow' direction at (px, py) metres; 0 = square-on."""
        r = (py / 8.0 - self.fr0).astype(int)
        c = (px / 8.0 - self.fc0).astype(int)
        ok = (r >= 0) & (r < self.fgx.shape[0]) & (c >= 0) & (c < self.fgx.shape[1])
        out = np.full(len(px), -1.0)
        gx, gy = self.fgx[r[ok], c[ok]], self.fgy[r[ok], c[ok]]   # x east, y south: the shallow-ward vector is (gx, gy)
        cosang = (np.cos(phi[ok]) * gx + np.sin(phi[ok]) * gy) / (np.hypot(gx, gy) + 1e-9)
        out[ok] = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
        return out

    def run(self, Fd, X, Y, phi0, record_every=0):
        targets = [lambda x, y: np.hypot(x - self.choc[0], y - self.choc[1]), lambda x, y: seg_dist(x, y, self.w1, self.w2)]
        (mC, mW), (aC, aW), paths = rc.trace(Fd, X, Y, phi0, self.water, self.dx, targets=targets, record_every=record_every)
        return mC, mW, self.peel_deg(aC[:, 0], aC[:, 1], aC[:, 2]), self.peel_deg(aW[:, 0], aW[:, 1], aW[:, 2]), paths


def trace_share(data, out, wk, nw):
    W = World(data)
    res = {}
    for T in PERS[wk::nw]:
        Fd = rc.speed_field(W.h, W.water, T, W.dx)
        for D in DIRS:
            X, Y, phi0 = W.crest(D)
            mC, mW, pC, pW, _ = W.run(Fd, X.copy(), Y.copy(), phi0)
            ic, iw = np.where(mC < NEAR)[0], np.where(mW < NEAR)[0]
            rec = dict(n=int(len(X)), c=[[int(mC[i]), int(round(pC[i]))] for i in ic], w=[[int(mW[i]), int(round(pW[i]))] for i in iw])
            if T % 2 == 0 and D % 5 == 0:              # the page's pictures: ~140 evenly spaced rays and up to 40 landing at each spot
                hc, hw = mC < rc.landing_radius(T, RC), mW < rc.landing_radius(T, RW)
                n = len(X)
                ctx = list(range(0, n, max(1, n // 140)))
                ic2, iw2 = list(np.where(hc)[0]), list(np.where(hw)[0])
                sel = sorted(set(ctx) | set(ic2[::max(1, len(ic2) // 40)]) | set(iw2[::max(1, len(iw2) // 40)]))
                _, _, _, _, paths = W.run(Fd, X[sel].copy(), Y[sel].copy(), phi0, record_every=10)
                rec.update(rays=[dict(h=('c' if hc[i] else '') + ('w' if hw[i] else ''), p=[int(round(v / 10)) for q in paths[j] for v in q])
                                 for j, i in enumerate(sel)], sp=SP * n / len(ctx))
            res[f'{T}_{D:g}'] = rec
            print(T, D, len(rec['c']), len(rec['w']), flush=True)
        json.dump(res, open(os.path.join(out, f'fwd_{wk}.json'), 'w'), separators=(',', ':'))
    json.dump(res, open(os.path.join(out, f'fwd_{wk}.json'), 'w'), separators=(',', ':'))
    print('DONE', flush=True)


def width_w(D, r, w1, w2):
    """Width of the Wilderness zone across the swell: the shoreline segment seen from D, plus the zone either side."""
    b = math.radians(D + 180)
    tx, ty = math.sin(b), -math.cos(b)
    vx, vy = w2[0] - w1[0], w2[1] - w1[1]
    return abs(vx * ty - vy * tx) * 1000 + 2 * r


def dp(pts, eps):
    """Douglas-Peucker: drop path points that lie within eps of the line through their neighbours."""
    if len(pts) < 3:
        return pts
    a, b, P = np.array(pts[0], float), np.array(pts[-1], float), np.array(pts, float)
    ab = b - a
    L = np.hypot(*ab)
    d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L if L > 0 else np.hypot(*(P - a).T)
    i = int(np.argmax(d))
    return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps) if d[i] > eps else [pts[0], pts[-1]]


def build_tables(data, out, page):
    w = json.load(open(os.path.join(data, 'world.json')))
    bg = json.load(open(os.path.join(data, 'fr_meta.json')))
    tab = {}
    for f in sorted(glob.glob(os.path.join(out, 'fwd_[0-9].json'))):
        tab.update(json.load(open(f)))

    def toxy(lat, lon): return ((lon - w['left']) * w['kmlon'], (w['top'] - lat) * w['kmlat'])
    choc, w1, w2 = toxy(*CHOC_LL), toxy(*W1_LL), toxy(*W2_LL)

    def peel(a, r):
        if not len(a):
            return [None, None, 0]
        sel = a[(a[:, 0] < PEEL_NEAR) & (a[:, 1] >= 0) & (a[:, 1] <= 95)]
        if len(sel) < 3:
            sel = a[(a[:, 0] < r) & (a[:, 1] >= 0) & (a[:, 1] <= 95)]
        if not len(sel):
            return [None, None, 0]
        return [round(float((sel[:, 1] >= PEEL).mean()), 3), int(np.median(sel[:, 1])), int(len(sel))]

    fine = {}
    for k, r in tab.items():
        T, D = k.split('_')
        T, D = int(T), float(D)
        rcz, rwz = rc.landing_radius(T, RC), rc.landing_radius(T, RW)
        shoal = rc.shoaling(T)
        c = np.array(r['c'], float).reshape(-1, 2)
        ww = np.array(r['w'], float).reshape(-1, 2)
        nc = int((c[:, 0] < rcz).sum()) if len(c) else 0
        nw = int((ww[:, 0] < rwz).sum()) if len(ww) else 0
        k2c = nc * SP / (2 * rcz) * shoal
        k2w = nw * SP / width_w(D, rwz, w1, w2) * shoal
        fine.setdefault(T, {})[f'{D:g}'] = [nc, nw, round(k2c, 5), round(k2w, 5)] + peel(c, rcz) + peel(ww, rwz)
    json.dump(fine, open(os.path.join(out, 'fwd_table.json'), 'w'), separators=(',', ':'))
    print('table written')
    if not page:
        return
    os.makedirs(os.path.join(out, 'fr'), exist_ok=True)
    FRTAB, byT = {}, {}
    for k, r in tab.items():
        if 'rays' not in r:
            continue
        T, D = k.split('_')
        T, Di = int(T), int(float(D))
        row = fine[T][f'{float(D):g}']
        FRTAB.setdefault(T, {})[Di] = [row[0], row[1], row[4], row[7]]            # counts and peel shares
        rays = []
        for ray in r['rays']:
            p = ray['p']
            s = dp([(p[i], p[i + 1]) for i in range(0, len(p), 2)], 3)
            rays.append(dict(h=ray['h'], p=[v for q in s for v in q]))
        byT.setdefault(T, {})[Di] = dict(rays=rays)
    for T, d in byT.items():
        json.dump(d, open(os.path.join(out, 'fr', f'{T}.json'), 'w'), separators=(',', ':'))
    reff = {T: [rc.landing_radius(T, RC), rc.landing_radius(T, RW)] for T in PERS}
    meta = dict(world=bg['world'], kmlon=w['kmlon'], kmlat=w['kmlat'], choc=choc, w1=w1, w2=w2, rc=RC, rw=RW, reff=reff,
                depth=4.0, peel=PEEL, close=bg['close'])
    json.dump(dict(meta=meta, tab=FRTAB), open(os.path.join(out, 'fr_page.json'), 'w'), separators=(',', ':'))
    print('page data written')


if __name__ == '__main__':
    if len(sys.argv) >= 6 and sys.argv[1] == 'trace':
        trace_share(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
    elif len(sys.argv) >= 4 and sys.argv[1] == 'tables':
        build_tables(sys.argv[2], sys.argv[3], '--page' in sys.argv)
    else:
        sys.exit(__doc__)
