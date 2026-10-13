"""Ray-based swell transformation model for Block Island Sound.

Linear wave rays are launched from the open-ocean edges of the 'wide' domain and
marched over the NOAA bathymetry. Each ray bends toward slower water (refraction,
Snell's law in gradient form: dphi/ds = -(1/c) dc/dn), stops on land (shadowing),
and deposits path length into the cells it crosses. Ray density relative to deep
water gives the refraction coefficient; group-velocity change gives shoaling:

    K = H_local / H_offshore = sqrt( (rho / rho_deep) * (cg_deep / cg_local) )

One K field per (direction, period) bin. The page multiplies the buoy height by
K (interpolated between bins) and caps it at a depth-limited breaking height.
Not modelled: diffraction (approximated by a wide blur near shadows), wave-current
interaction, wind growth inside the sound, bottom friction, nonlinear effects.
"""
import json, math, sys
import numpy as np
from PIL import Image

meta = json.load(open('map_meta.json'))['wide']
a = np.array(Image.open('height_wide.png')).astype(np.int32)
z = ((a[..., 0] << 8) | a[..., 1]).astype(np.float64) / 10 - 1000
R, C = z.shape
lat_mid = (meta['top'] + meta['bottom']) / 2
dx = (meta['right'] - meta['left']) * 111.32 * math.cos(math.radians(lat_mid)) / C   # km per col (east)
dy = (meta['top'] - meta['bottom']) * 110.95 / R                                      # km per row (south)
h = np.clip(-z, 0, None)
water = h > 0.5
lat_of_row = meta['top'] - (np.arange(R) + 0.5) * (meta['top'] - meta['bottom']) / R
print('grid', R, C, 'cell km', round(dx, 3), round(dy, 3), file=sys.stderr)

def box(a, r, axis):
    if r < 1: return a
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    p = np.pad(a, pad, mode='edge'); cs = np.cumsum(p, axis=axis)
    cs = np.concatenate([np.zeros_like(np.take(cs, [0], axis=axis)), cs], axis=axis)
    n = a.shape[axis]
    return (np.take(cs, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(cs, np.arange(0, n), axis=axis)) / (2 * r + 1)
def blur(a, r):
    for _ in range(3):
        a = box(box(a, r, 0), r, 1)
    return a

G = 9.81
def wave_speeds(T):
    L0 = G * T * T / (2 * math.pi)
    hh = np.maximum(h, 0.5)
    L = L0 * np.tanh((2 * math.pi * np.sqrt(hh / G) / T) ** 1.5) ** (2 / 3)    # Fenton & McKee
    k = 2 * math.pi / L; c = L / T
    kh = np.minimum(k * hh, 20)
    n = 0.5 * (1 + 2 * kh / np.sinh(2 * kh))
    return c / 1000 * 3600, (n * c) / 1000 * 3600, L0 / T * 0.5 / 1000 * 3600     # km/h: c, cg, cg_deep

DIRS = list(range(90, 211, 10))
PERS = [6, 9, 12, 15]

def trace(D, T):
    c, cg, cg0 = wave_speeds(T)
    cs = blur(np.where(water, c, c[water].min()), 2)
    gy, gx = np.gradient(cs, dy, dx)            # d/d(south), d/d(east)
    beta = math.radians(D + 180)                # travel bearing
    tx, ty = math.sin(beta), -math.cos(beta)    # east, south components
    # launch points along the open-ocean edges facing the swell
    pts = []
    step = 0.25
    if ty < -0.05:   # travelling north: launch from the south edge
        for x in np.arange(0, C, step): pts.append((x * dx, (R - 0.01) * dy))
    if tx < -0.05:   # travelling west: launch from the east edge (water only)
        for y in np.arange(0, R, step): pts.append(((C - 0.01) * dx, y * dy))
    if tx > 0.05:    # travelling east: west edge, only the ocean south of Long Island
        for y in np.arange(0, R, step):
            if lat_of_row[min(R - 1, int(y))] < 40.98: pts.append((0.01 * dx, y * dy))
    P = np.array(pts); X, Y = P[:, 0].copy(), P[:, 1].copy()
    phi = np.full(len(X), math.atan2(ty, tx))
    alive = np.ones(len(X), bool)
    acc = np.zeros((R, C))
    ds = 0.5 * min(dx, dy)
    for _ in range(int(2.2 * (R * dy + C * dx) / ds)):
        if not alive.any(): break
        ci = (X / dx).astype(int); ri = (Y / dy).astype(int)
        inside = (ci >= 0) & (ci < C) & (ri >= 0) & (ri < R)
        alive &= inside
        ci = np.clip(ci, 0, C - 1); ri = np.clip(ri, 0, R - 1)
        alive &= water[ri, ci]
        idx = np.where(alive)[0]
        if not len(idx): break
        r_, c_ = ri[idx], ci[idx]
        np.add.at(acc, (r_, c_), ds)
        cc = cs[r_, c_]
        nx, ny = -np.sin(phi[idx]), np.cos(phi[idx])
        dcdn = gx[r_, c_] * nx + gy[r_, c_] * ny
        phi[idx] -= ds * dcdn / cc
        X[idx] += ds * np.cos(phi[idx]); Y[idx] += ds * np.sin(phi[idx])
    dens = acc / (dx * dy)
    # spread a little (numerical noise) plus a wide component standing in for diffraction
    d1 = blur(dens, 2); d2 = blur(dens, 8)
    dens = np.where(water, 0.7 * d1 + 0.3 * d2, 0)
    deep = water & (h > 40) & (dens > 0)
    ref = np.median(dens[deep]) if deep.sum() > 100 else np.median(dens[dens > 0])
    K = np.sqrt(np.clip(dens / ref, 0, 9) * (cg0 / np.maximum(cg, 1e-3)))
    K[~water] = 0
    return np.clip(K, 0, 2.5)

if __name__ == '__main__':
    fields = {}
    for T in PERS:
        for D in DIRS:
            K = trace(D, T)
            fields[(D, T)] = K
            print('T', T, 'D', D, 'K mean water %.2f' % K[water].mean(), file=sys.stderr)
    np.savez_compressed('kfields.npz', **{f'{D}_{T}': v.astype(np.float32) for (D, T), v in fields.items()})
    json.dump(dict(dirs=DIRS, pers=PERS, R=R, C=C), open('kmeta.json', 'w'))
