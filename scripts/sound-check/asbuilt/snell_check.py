"""Snell's-law check of the production ray update (fwdprod2.run), like Halsne et al. (2023) Fig. 4a.

A plane beach: depth falls from 60 m to 2 m over 25 km, contours straight east-west. A ray starts in 60 m
heading north-east at a0 to the contour normal. Snell: sin(a) / c(h) is constant, so the exact angle at
depth h is asin(sin a0 * c(h) / c(60 m)) with the exact dispersion. We compare the traced angle with it.

Production scheme: 48 m cells, speed from the Fenton-McKee wavelength, speed blurred (3 passes of a 7-cell box),
gradient by central differences, sampled at the cell the ray is in, heading updated then position, steps of 24 m.
'better': exact dispersion, bilinear sampling, 12 m steps.
"""
import math
import numpy as np
G = 9.81; dx = 48.0

def L_fm(T, h):
    L0 = G * T * T / (2 * math.pi); return L0 * np.tanh((2 * math.pi * np.sqrt(h / G) / T) ** 1.5) ** (2 / 3)
def L_ex(T, h):
    w = 2 * math.pi / T; k = 2 * math.pi / L_fm(T, h)
    for _ in range(40):
        t = np.tanh(k * h); k = k - (G * k * t - w * w) / (G * t + G * k * h * (1 - t * t))
    return 2 * math.pi / k
def box(a, r, axis):
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    p = np.pad(a, pad, mode='edge'); cs = np.cumsum(p, axis=axis)
    cs = np.concatenate([np.zeros_like(np.take(cs, [0], axis=axis)), cs], axis=axis); n = a.shape[axis]
    return (np.take(cs, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(cs, np.arange(0, n), axis=axis)) / (2 * r + 1)
def blur(a, r):
    for _ in range(3): a = box(box(a, r, 0), r, 1)
    return a

R, C = 700, 300                                   # 33.6 km south-north, 14.4 km east-west
yc = (np.arange(R) + 0.5) * dx                    # metres from the north edge (rows grow southward)
h1d = np.clip(2 + (60 - 2) * (yc - 4000) / 25000, 2, 60)          # 2 m near the north, 60 m in the south
H = np.repeat(h1d[:, None], C, axis=1)

def sample(A, X, Y, bil):
    X = np.mod(X, (C - 2) * dx)                       # depth doesn't change east-west: wrap, so oblique rays reach the shallows
    if not bil: return A[(Y / dx).astype(int), (X / dx).astype(int)]
    fx = X / dx - 0.5; fy = Y / dx - 0.5; i0 = np.clip(np.floor(fx).astype(int), 0, C - 2); j0 = np.clip(np.floor(fy).astype(int), 0, R - 2)
    a = np.clip(fx - i0, 0, 1); b = np.clip(fy - j0, 0, 1)
    return A[j0, i0] * (1 - a) * (1 - b) + A[j0, i0 + 1] * a * (1 - b) + A[j0 + 1, i0] * (1 - a) * b + A[j0 + 1, i0 + 1] * a * b

def trace(T, a0_deg, exact, bil, ds_cells, r=3):
    c = (L_ex(T, H) if exact else L_fm(T, H)) / T
    cs = blur(c, r) if r else c
    gy, gx = np.gradient(cs, dx, dx)
    X, Y = np.array([2000.0]), np.array([(R - 3) * dx])                 # start in the south, heading north-east
    phi = np.array([-math.pi / 2 + math.radians(a0_deg)])
    ds = ds_cells * dx; out = []
    while Y[0] > 4200:
        nxv, nyv = -np.sin(phi), np.cos(phi)
        phi -= ds * (sample(gx, X, Y, bil) * nxv + sample(gy, X, Y, bil) * nyv) / sample(cs, X, Y, bil)
        X += ds * np.cos(phi); Y += ds * np.sin(phi)
        out.append((float(np.interp(Y[0], yc, h1d)), math.degrees(phi[0] + math.pi / 2)))
    return out

c_ex = lambda T, h: float(L_ex(T, np.array(h))) / T
CASES = (('production (FM dispersion, nearest cell, 24 m)', False, False, 0.5), ('exact dispersion only', True, False, 0.5),
         ('bilinear only', False, True, 0.5), ('12 m steps only', False, False, 0.25), ('all three', True, True, 0.25))
for T in (8, 12, 16):
    for a0 in (20, 45):
        line = []
        for tag, ex, bil, dsc in CASES:
            e = np.array([(h, a, math.degrees(math.asin(min(1, math.sin(math.radians(a0)) * c_ex(T, h) / c_ex(T, 60.0)))))
                          for h, a in trace(T, a0, ex, bil, dsc) if 2.5 < h < 58])
            dev = e[:, 1] - e[:, 2]
            line.append(f'{np.abs(dev).max():.2f}')
            if tag.startswith('production'):
                at = {d: e[np.argmin(np.abs(e[:, 0] - d))] for d in (30, 10, 4)}
        print(f'T={T:2d}s a0={a0:2d}deg  max |angle error| deg: ' + ' / '.join(line) +
              '   (production at 30/10/4 m: ' + ', '.join(f'{at[d][1]:.2f} vs {at[d][2]:.2f}' for d in (30, 10, 4)) + ')')
print('columns:', ' / '.join(c[0] for c in CASES))
