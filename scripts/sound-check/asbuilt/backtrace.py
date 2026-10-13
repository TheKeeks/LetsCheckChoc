"""Backward ray tracing from the Choc reef (Longuet-Higgins method).

Rays leave reef points in every direction and are traced *outward* over the
bathymetry with the same refraction equation as the forward model (rays are
reversible). A ray that reaches the open-ocean edge of the domain tells us that
swell arriving at the reef from direction a came, offshore, from direction
theta_off(a). Spectral density times c*cg is conserved along a ray, so

    E_reef(f) = E_off(f) * (c cg)_off / (c cg)_reef * sum_a D_off(theta_off(a)) da

for every frequency f, where D_off is the offshore directional distribution.
Rays that hit land are blocked (shadow). We store, for each period T, a
response kernel R_T(theta) on a 1 degree grid: the reef's sensitivity to
offshore energy from direction theta (already including the c*cg ratio).
Then E_reef/E_off = sum_theta D(theta) R_T(theta).
"""
import json, math, sys
import numpy as np
from PIL import Image

meta = json.load(open('map_meta.json'))['wide']
a = np.array(Image.open('height_wide.png')).astype(np.int32)
z = ((a[..., 0] << 8) | a[..., 1]).astype(np.float64) / 10 - 1000
R, C = z.shape
lat_mid = (meta['top'] + meta['bottom']) / 2
kmlon = 111.32 * math.cos(math.radians(lat_mid))
dx = (meta['right'] - meta['left']) * kmlon / C
dy = (meta['top'] - meta['bottom']) * 110.95 / R
h = np.clip(-z, 0, None); water = h > 0.5
lat_of_row = meta['top'] - (np.arange(R) + 0.5) * (meta['top'] - meta['bottom']) / R
G = 9.81
BUOY_DEPTH = 48.0

def box(arr, r, axis):
    pad = [(0, 0)] * arr.ndim; pad[axis] = (r, r)
    p = np.pad(arr, pad, mode='edge'); cs = np.cumsum(p, axis=axis)
    cs = np.concatenate([np.zeros_like(np.take(cs, [0], axis=axis)), cs], axis=axis)
    n = arr.shape[axis]
    return (np.take(cs, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(cs, np.arange(0, n), axis=axis)) / (2 * r + 1)
def blur(arr, r):
    for _ in range(3): arr = box(box(arr, r, 0), r, 1)
    return arr

def speeds(T, depth):
    L0 = G * T * T / (2 * math.pi); hh = np.maximum(depth, 0.5)
    L = L0 * np.tanh((2 * math.pi * np.sqrt(hh / G) / T) ** 1.5) ** (2 / 3)
    k = 2 * math.pi / L; c = L / T; kh = np.minimum(k * hh, 20)
    n = 0.5 * (1 + 2 * kh / np.sinh(2 * kh))
    return c, n * c

# reef start points: water 3-10 m deep within ~1 km of the beach point, ocean side
def rc(lat, lon): return int((meta['top'] - lat) / (meta['top'] - meta['bottom']) * R), int((lon - meta['left']) / (meta['right'] - meta['left']) * C)
r0, c0 = rc(41.275693, -71.963310)
START = [(r, c) for r in range(r0 - 3, r0 + 8) for c in range(c0 - 8, c0 + 9)
         if 3 <= h[r, c] <= 10 and r >= r0 and ((r - r0) * dy) ** 2 + ((c - c0) * dx) ** 2 < 1.0]
PERIODS = list(range(4, 21))
DA = 0.5   # outbound angle step, degrees

def backtrace(T, keep_paths=False):
    c, cg = speeds(T, h)
    cs = blur(np.where(water, c, c[water].min()), 2)
    gy, gx = np.gradient(cs, dy, dx)      # d/d(south), d/d(east)
    ang = np.radians(np.arange(0, 360, DA))
    X, Y, PHI, SRC = [], [], [], []
    for k, (r, cc) in enumerate(START):
        bear = ang                                  # compass bearing of outbound travel
        X.append(np.full(len(ang), (cc + 0.5) * dx)); Y.append(np.full(len(ang), (r + 0.5) * dy))
        PHI.append(np.arctan2(-np.cos(bear), np.sin(bear)))   # math angle in (east, south) coords
        SRC.append(np.full(len(ang), k))
    X, Y, PHI, SRC = map(np.concatenate, (X, Y, PHI, SRC))
    A0 = np.tile(np.arange(0, 360, DA), len(START))
    n = len(X); alive = np.ones(n, bool); escaped = np.zeros(n, bool); out_bear = np.full(n, np.nan)
    ds = 0.5 * min(dx, dy)
    paths = [[(X[i], Y[i])] for i in range(n)] if keep_paths else None
    for step in range(int(2.5 * (R * dy + C * dx) / ds)):
        idx = np.where(alive)[0]
        if not len(idx): break
        ci = (X[idx] / dx).astype(int); ri = (Y[idx] / dy).astype(int)
        out = (ci < 0) | (ci >= C) | (ri < 0) | (ri >= R)
        if out.any():
            o = idx[out]; ri_c = np.clip(ri[out], 0, R - 1)
            # open-ocean edges: south, east, and the west edge south of Long Island
            open_edge = (ri[out] >= R) | (ci[out] >= C) | ((ci[out] < 0) & (lat_of_row[ri_c] < 40.98))
            escaped[o] = open_edge
            hx, hy = np.cos(PHI[o]), np.sin(PHI[o])          # east, south of travel
            out_bear[o] = (np.degrees(np.arctan2(hx, -hy)) + 360) % 360
            alive[o] = False
            idx = idx[~out]; ci = ci[~out]; ri = ri[~out]
        land = ~water[ri, ci]
        alive[idx[land]] = False
        idx = idx[~land]; ci = ci[~land]; ri = ri[~land]
        nx, ny = -np.sin(PHI[idx]), np.cos(PHI[idx])
        PHI[idx] -= ds * (gx[ri, ci] * nx + gy[ri, ci] * ny) / cs[ri, ci]
        X[idx] += ds * np.cos(PHI[idx]); Y[idx] += ds * np.sin(PHI[idx])
        if keep_paths and step % 4 == 0:
            for i in idx: paths[i].append((X[i], Y[i]))
    # response kernel on 1 degree grid of offshore direction-from
    c_off, cg_off = speeds(T, np.array(BUOY_DEPTH))
    Rk = np.zeros(360)
    for k, (r, cc) in enumerate(START):
        sel = (SRC == k) & escaped
        ratio = (c_off * cg_off) / (c[r, cc] * cg[r, cc])
        bins = np.floor(out_bear[sel]).astype(int) % 360
        np.add.at(Rk, bins, ratio * math.radians(DA))
    Rk /= len(START)
    return Rk, dict(A0=A0, SRC=SRC, escaped=escaped, out_bear=out_bear, paths=paths)

if __name__ == '__main__':
    print('reef start points', len(START), 'depths', [round(h[p], 1) for p in START], file=sys.stderr)
    K = {}
    for T in PERIODS:
        Rk, info = backtrace(T)
        K[T] = Rk
        esc = info['escaped'].mean()
        # transfer for a narrow-ish swell (cos^2s, s=20) from a few directions
        th = np.radians(np.arange(360))
        def factor(d0, s=20):
            D = np.cos((th - math.radians(d0)) / 2) ** (2 * s); D /= D.sum() * math.radians(1)
            return math.sqrt((D * Rk).sum() * math.radians(1) / math.radians(1))
        print(f'T {T:2d}s escaped {esc:.2f}  Hs factor @120 {factor(120):.2f} @140 {factor(140):.2f} @160 {factor(160):.2f} @180 {factor(180):.2f} @200 {factor(200):.2f}', file=sys.stderr)
    np.savez_compressed('backkernel.npz', periods=np.array(PERIODS), R=np.array([K[T] for T in PERIODS]))
    json.dump(dict(start=[[int(r), int(c)] for r, c in START]), open('backstart.json', 'w'))
