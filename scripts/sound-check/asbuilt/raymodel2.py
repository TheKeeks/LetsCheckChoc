"""Forward ray model v2 on the full map (40.60-41.50 N, 72.40-70.85 W, 144 m cells).

Same physics as raymodel.py (refraction by Snell's law in gradient form, shoaling by
group-speed change, shadowing by land, a wide blur standing in for diffraction), plus
the arrival time of the wave crests, so the page can draw crests marching in:

  every ray starts on a straight offshore crest (plane wave), so its start time is its
  distance along the travel direction / deep-water speed; it then adds ds / c(local)
  as it goes. Averaging over the rays crossing a cell gives tau(x), the crest arrival
  time. The page draws a crest wherever tau / (T m) is a whole number, where m is how
  many real wavelengths one drawn crest spacing stands for (so drawn spacing is about
  1.6 km x (T / 9 s)^1.5 offshore and shortens in shallow water, like the real thing).

Outputs:
  kgrid.png       all K fields (8-bit, K x 100) at 288 m, one tile per (period, direction)
  crest/T_D.jpg   per bin, 144 m: R = cos(2 pi psi), G = sin(2 pi psi), B = K x 100
  h3d.png         16-bit terrain for the 3D view (288 m)
  ray2.json       grid metadata
"""
import json, math, os, sys
import numpy as np
from PIL import Image

world = json.load(open('world.json'))
F = 18                                             # 8 m -> 144 m
z8 = np.load('elev8.npy', mmap_mode='r')
R, C = z8.shape[0] // F, z8.shape[1] // F
z = np.asarray(z8[:R * F, :C * F], np.float32).reshape(R, F, C, F).mean(axis=(1, 3)).astype(np.float64)
dx = dy = world['px_km'] * F                      # km
h = np.clip(-z, 0, None); water = h > 0.5
lat_of_row = world['top'] - (np.arange(R) + 0.5) * dy / world['kmlat']
print('grid', R, C, 'cell km', dx, file=sys.stderr)

def box(a, r, axis):
    if r < 1: return a
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    p = np.pad(a, pad, mode='edge'); cs = np.cumsum(p, axis=axis)
    cs = np.concatenate([np.zeros_like(np.take(cs, [0], axis=axis)), cs], axis=axis)
    n = a.shape[axis]
    return (np.take(cs, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(cs, np.arange(0, n), axis=axis)) / (2 * r + 1)
def blur(a, r):
    for _ in range(3): a = box(box(a, r, 0), r, 1)
    return a

G = 9.81
def wavelength(T, hh):
    # exact linear dispersion w^2 = g k tanh(k h): Newton's method from Fenton and McKee's explicit form, which
    # alone is up to 1.7 % off (same solver as scripts/rays/raycore.py in the repo)
    w = 2 * math.pi / T
    k = 2 * math.pi / (G * T * T / (2 * math.pi) * np.tanh((w * np.sqrt(hh / G)) ** 1.5) ** (2 / 3))
    for _ in range(6):
        t = np.tanh(k * hh); k = k - (G * k * t - w * w) / (G * t + G * k * hh * (1 - t * t))
    return 2 * math.pi / k
def speeds(T):
    L0 = G * T * T / (2 * math.pi); hh = np.maximum(h, 0.5)
    L = wavelength(T, hh)
    k = 2 * math.pi / L; c = L / T; kh = np.minimum(k * hh, 20)
    n = 0.5 * (1 + 2 * kh / np.sinh(2 * kh))
    return c, n * c, L0 / T, 0.5 * L0 / T          # m/s: c, cg, c_deep, cg_deep

# west edge counts as open ocean only south of Long Island's south shore
west_open = np.zeros(R, bool)
for r in range(R - 1, -1, -1):
    if not water[r, 0]: break
    west_open[r] = True

DIRS = list(range(60, 221, 10))
PERS = [6, 9, 12, 15]

def trace(D, T):
    c, cg, c0, cg0 = speeds(T)
    cs = blur(np.where(water, c, c[water].min()), 2)
    gy, gx = np.gradient(cs, dy * 1000, dx * 1000)                 # per metre
    beta = math.radians(D + 180)
    tx, ty = math.sin(beta), -math.cos(beta)                       # east, south
    pts = []; step = 0.25
    if ty < -0.05: pts += [(x * dx, (R - 0.01) * dy) for x in np.arange(0, C, step) if water[R - 1, min(C - 1, int(x))]]
    if tx < -0.05: pts += [((C - 0.01) * dx, y * dy) for y in np.arange(0, R, step) if water[min(R - 1, int(y)), C - 1]]
    if tx > 0.05: pts += [(0.01 * dx, y * dy) for y in np.arange(0, R, step) if west_open[min(R - 1, int(y))]]
    if ty > 0.05: pass                                              # never from the north (land / bays)
    P = np.array(pts); X, Y = P[:, 0].copy(), P[:, 1].copy()
    tau = (X * tx + Y * ty) * 1000 / c0; tau -= tau.min()          # plane-wave start, seconds
    phi = np.full(len(X), math.atan2(ty, tx)); alive = np.ones(len(X), bool)
    acc = np.zeros((R, C)); acct = np.zeros((R, C))
    ds = 0.5 * dx
    for _ in range(int(2.2 * (R + C) / 0.5)):
        if not alive.any(): break
        ci = (X / dx).astype(int); ri = (Y / dy).astype(int)
        alive &= (ci >= 0) & (ci < C) & (ri >= 0) & (ri < R)
        ci = np.clip(ci, 0, C - 1); ri = np.clip(ri, 0, R - 1)
        alive &= water[ri, ci]
        idx = np.where(alive)[0]
        if not len(idx): break
        r_, c_ = ri[idx], ci[idx]
        np.add.at(acc, (r_, c_), ds); np.add.at(acct, (r_, c_), ds * tau[idx])
        cc = cs[r_, c_]
        nx, ny = -np.sin(phi[idx]), np.cos(phi[idx])
        phi[idx] -= ds * 1000 * (gx[r_, c_] * nx + gy[r_, c_] * ny) / cc
        X[idx] += ds * np.cos(phi[idx]); Y[idx] += ds * np.sin(phi[idx])
        tau[idx] += ds * 1000 / c[r_, c_]
    dens = acc / (dx * dy)
    d1 = blur(dens, 2); d2 = blur(dens, 8)
    densb = np.where(water, 0.7 * d1 + 0.3 * d2, 0)
    deep = water & (h > 40) & (densb > 0)
    ref = np.median(densb[deep]) if deep.sum() > 100 else np.median(densb[densb > 0])
    K = np.sqrt(np.clip(densb / ref, 0, 9) * (cg0 / np.maximum(cg, 1e-3)))
    K[~water] = 0; K = np.clip(K, 0, 2.5)
    # crest arrival time: ray-weighted mean, lightly smoothed (same smoothing for both sums)
    a1, t1 = blur(acc, 1), blur(acct, 1)
    tau_c = np.where(a1 > 1e-9, t1 / np.maximum(a1, 1e-9), np.nan)
    # fill cells no ray reached (shadows) from neighbours so the phase is continuous; K hides them anyway
    for _ in range(6):
        m = np.isnan(tau_c)
        if not m.any(): break
        num = blur(np.nan_to_num(tau_c), 2); den = blur((~m).astype(float), 2)
        tau_c = np.where(m & (den > 0.05), num / np.maximum(den, 1e-9), tau_c)
    tau_c = np.nan_to_num(tau_c)
    L0 = 1.56 * T * T; Lam = 1600 * (T / 9) ** 1.5; mult = Lam / L0
    psi = tau_c / (T * mult)
    return K, psi

if __name__ == '__main__':
    os.makedirs('crest', exist_ok=True)
    R2, C2 = R // 2, C // 2
    katlas = np.zeros((len(PERS) * R2, len(DIRS) * C2), np.uint8)
    for ti, T in enumerate(PERS):
        for di, D in enumerate(DIRS):
            K, psi = trace(D, T)
            k8 = np.clip(K * 100, 0, 255)
            katlas[ti * R2:(ti + 1) * R2, di * C2:(di + 1) * C2] = k8[:R2 * 2, :C2 * 2].reshape(R2, 2, C2, 2).mean(axis=(1, 3)).astype(np.uint8)
            rgb = np.stack([(np.cos(2 * np.pi * psi) * 127.5 + 127.5), (np.sin(2 * np.pi * psi) * 127.5 + 127.5), k8], -1)
            Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(f'crest/{T}_{D}.jpg', quality=88, subsampling=0, optimize=True)
            print('T', T, 'D', D, 'K mean water %.2f' % K[water].mean(), 'psi max %.0f' % psi.max(), file=sys.stderr)
    Image.fromarray(katlas).save('kgrid.png', optimize=True)
    # 3D terrain at 288 m
    z2 = z[:R2 * 2, :C2 * 2].reshape(R2, 2, C2, 2).mean(axis=(1, 3))
    v = np.clip(np.round(z2 * 10 + 10000), 0, 65535).astype(np.uint32)
    Image.fromarray(np.stack([(v >> 8), v & 255, np.zeros_like(v)], -1).astype(np.uint8)).save('h3d.png')
    json.dump(dict(R=R, C=C, R2=R2, C2=C2, cell_km=dx, dirs=DIRS, pers=PERS), open('ray2.json', 'w'))
    tot = sum(os.path.getsize('crest/' + f) for f in os.listdir('crest'))
    print('kgrid bytes', os.path.getsize('kgrid.png'), 'crest MB %.1f' % (tot / 1e6), file=sys.stderr)
