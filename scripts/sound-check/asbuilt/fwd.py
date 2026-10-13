"""Forward rays: a straight offshore crest, evenly spaced rays, count how many reach each spot.

For swell from direction D (period T): the starting crest is the straight line, square to
the swell, just offshore of every place shallower than 45 m (so nothing has bent yet).
Rays leave it every SP metres, bend over the bottom (same physics as raymodel2), and stop
on land. A ray 'reaches' Choc if it passes within 250 m of the Choc pin, Wilderness if it
passes within 150 m of the Wilderness shoreline segment.

Height factor at the spot (fraction of the deep-water height):
    rays through the zone / rays that would cross it in open water = how much the bottom
    bunched the energy up; times the shoaling gain cg0/cg at the zone depth; square root.
A directional spread (cos^2s, s = 15) is applied by repeating for 7 sub-directions.
"""
import json, math, sys
import numpy as np
import raymodel2 as m

G = 9.81
world = m.world
dx = m.dx * 1000                         # metres per cell
R, C = m.R, m.C
def toxy(lat, lon): return ((lon - world['left']) * world['kmlon'] * 1000, (world['top'] - lat) * world['kmlat'] * 1000)
CHOC = toxy(41.27591, -71.96359)
W1, W2 = toxy(41.25286, -72.00573), toxy(41.25551, -72.01117)
RC, RW = 250.0, 150.0

def seg_dist(px, py, a, b):
    ax, ay = a; bx, by = b; vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))

FIELDS = {}
def fields(T):
    if T in FIELDS: return FIELDS[T]
    c, cg, c0, cg0 = m.speeds(T)
    cs = m.blur(np.where(m.water, c, c[m.water].min()), 2)
    gy, gx = np.gradient(cs, dx, dx)
    FIELDS[T] = (cs, gx, gy, cg, cg0); return FIELDS[T]

def crest(D, SP):
    """start points of the rays (metres), on the crest line just offshore of everything < 45 m deep"""
    beta = math.radians(D + 180); tx, ty = math.sin(beta), -math.cos(beta)
    Y, X = np.mgrid[0:R, 0:C]; X = (X + 0.5) * dx; Y = (Y + 0.5) * dx
    s = X * tx + Y * ty
    shallow = m.h < 45
    s0 = s[shallow].min() - 1000
    # the line s = s0 inside the map rectangle
    nx, ny = -ty, tx                                        # along-crest direction
    corners = np.array([[0, 0], [C * dx, 0], [0, R * dx], [C * dx, R * dx]])
    # parametrise p = s0 * t + u * n ; keep u where p is inside the rectangle
    us = np.arange(-3e5, 3e5, SP)
    px = s0 * tx + us * nx; py = s0 * ty + us * ny
    ok = (px > 0) & (px < C * dx) & (py > 0) & (py < R * dx)
    return px[ok], py[ok], math.atan2(ty, tx)

def trace(D, T, SP=25.0, keep=False):
    cs, gx, gy, cg, cg0 = fields(T)
    X, Y, phi0 = crest(D, SP)
    n = len(X); phi = np.full(n, phi0); alive = np.ones(n, bool)
    hitC = np.zeros(n, bool); hitW = np.zeros(n, bool)
    ds = 0.5 * dx
    paths = [[] for _ in range(n)] if keep else None
    for step in range(int(2.6 * (R + C) / 0.5)):
        idx = np.where(alive)[0]
        if not len(idx): break
        ci = (X[idx] / dx).astype(int); ri = (Y[idx] / dx).astype(int)
        inb = (ci >= 0) & (ci < C) & (ri >= 0) & (ri < R)
        alive[idx[~inb]] = False; idx = idx[inb]; ci = ci[inb]; ri = ri[inb]
        hitC[idx] |= np.hypot(X[idx] - CHOC[0], Y[idx] - CHOC[1]) < RC
        hitW[idx] |= seg_dist(X[idx], Y[idx], W1, W2) < RW
        land = ~m.water[ri, ci]
        alive[idx[land]] = False; idx = idx[~land]; ci = ci[~land]; ri = ri[~land]
        nxv, nyv = -np.sin(phi[idx]), np.cos(phi[idx])
        phi[idx] -= ds * (gx[ri, ci] * nxv + gy[ri, ci] * nyv) / cs[ri, ci]
        X[idx] += ds * np.cos(phi[idx]); Y[idx] += ds * np.sin(phi[idx])
    return n, hitC.sum(), hitW.sum()

def zone_shoal(T, centre_fn):
    cs, gx, gy, cg, cg0 = fields(T)
    Y, X = np.mgrid[0:R, 0:C]; X = (X + 0.5) * dx; Y = (Y + 0.5) * dx
    z = centre_fn(X, Y) & m.water
    return cg0 / cg[z].mean() if z.any() else 1.0, m.h[z].mean() if z.any() else 0

def factor(D, T, s=15, SP=25.0):
    subs = np.arange(-30, 31, 7.5); w = np.cos(np.radians(subs) / 2) ** (2 * s); w /= w.sum()
    fc = fw = 0
    for d, wt in zip(subs, w):
        n, hc, hw = trace(D + d, T, SP)
        fc += wt * hc * SP / (2 * RC); fw += wt * hw * SP / (2 * RW)       # rays through / rays in open water
    shC, dC = zone_shoal(T, lambda X, Y: np.hypot(X - CHOC[0], Y - CHOC[1]) < max(RC, 1.5 * dx))
    shW, dW = zone_shoal(T, lambda X, Y: seg_dist(X, Y, W1, W2) < max(RW, 1.5 * dx))
    return math.sqrt(fc * shC), math.sqrt(fw * shW), fc, fw, dC, dW

if __name__ == '__main__':
    B = json.load(open('backk2.json'))
    def back(spot, T, D, s=15):
        bk = B[spot]; j = bk['periods'].index(T); K = np.array(bk['R'][j]); th = np.arange(360) + 0.5
        Dd = np.cos(np.radians(th - D) / 2) ** (2 * s); Dd /= Dd.sum()
        return math.sqrt((Dd * K).sum() / (math.pi / 180))
    for T in [9, 12]:
        for D in [90, 110, 130, 150, 170, 190]:
            fc, fw, rc, rw, dC, dW = factor(D, T)
            print(f'T{T} D{D}: fwd choc {fc:.2f} (bk {back("choc", T, D):.2f}) wild {fw:.2f} (bk {back("wild", T, D):.2f})  ray ratio {rc:.2f}/{rw:.2f}  zone depth {dC:.1f}/{dW:.1f}', flush=True)
