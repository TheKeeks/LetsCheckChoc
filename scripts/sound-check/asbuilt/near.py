"""Nested ray test: the usual 48 m tracer (speed smoothed over 150 m) out to a box around the west end
of Fishers, then the same rays continued on the 8 m survey grid with much lighter smoothing, so they
can feel the reef and the point.  Zones are the owner's sketches (reef.json): Choc's main reef and
peak, Wilderness's three peel lines.  Prints how many rays reach each and at what angle, and draws
coarse vs fine rays.

usage: python3 near.py T D [fine_smooth_m]"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
G = 9.81
T = float(sys.argv[1]); D = float(sys.argv[2]); RF = float(sys.argv[3]) if len(sys.argv) > 3 else 24.0
W = json.load(open('world.json'))
z8 = np.load('elev8.npy', mmap_mode='r')
def box(a, r, ax):
    c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in range(2)], mode='edge'), axis=ax)
    sl = lambda s, e: tuple(slice(s, e) if i == ax else slice(None) for i in range(2))
    n = a.shape[ax]; return (c[sl(2 * r + 1, 2 * r + 1 + n)] - c[sl(0, n)]) / (2 * r + 1)
def blur(a, r):
    for _ in range(3): a = box(box(a, r, 0), r, 1)
    return a
def speeds(h):
    L0 = G * T * T / (2 * math.pi); hh = np.maximum(h, 0.5)
    L = L0 * np.tanh((2 * math.pi * np.sqrt(hh / G) / T) ** 1.5) ** (2 / 3)
    return L / T, L
def toxy(lat, lon): return ((lon - W['left']) * W['kmlon'] * 1000, (W['top'] - lat) * W['kmlat'] * 1000)
# ── coarse grid: 48 m
F = 6; R, C = z8.shape[0] // F, z8.shape[1] // F; dxc = 8.0 * F
zc = np.asarray(z8[:R * F, :C * F], np.float32).reshape(R, F, C, F).mean(axis=(1, 3)).astype(np.float64)
hc = np.clip(-zc, 0, None); wc = hc > 0.5
cc, _ = speeds(hc); csc = blur(np.where(wc, cc, cc[wc].min()), max(1, round(150 / dxc))); gyc, gxc = np.gradient(csc, dxc, dxc)
# ── fine box around the west end of Fishers (8 m)
LAT0, LAT1, LON0, LON1 = 41.236, 41.292, -72.035, -71.940
x0, y0 = toxy(LAT1, LON0); x1, y1 = toxy(LAT0, LON1)
i0, i1, j0, j1 = int(y0 / 8), int(y1 / 8), int(x0 / 8), int(x1 / 8)
zf = np.asarray(z8[i0:i1, j0:j1], np.float64); hf = np.clip(-zf, 0, None); wf = hf > 0.5
cf, Lf = speeds(hf); rf = max(1, round(RF / 8 / 2)); csf = blur(np.where(wf, cf, cf[wf].min()), rf); gyf, gxf = np.gradient(csf, 8.0, 8.0)
FX0, FY0 = j0 * 8.0, i0 * 8.0
# ── sketches
REEF = json.load(open('site/ocean/reef.json'))['shapes']
def pts(s): p = s['pts']; return [toxy(p[i], p[i + 1]) for i in range(0, len(p), 2)] if not isinstance(p[0], (list, dict)) else [toxy(*q) for q in p]
def seg_d(px, py, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]; t = np.clip(((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - a[0] - t * vx, py - a[1] - t * vy)
def line_d(px, py, P): return np.min([seg_d(px, py, P[i], P[i + 1]) for i in range(len(P) - 1)], axis=0) if len(P) > 1 else np.hypot(px - P[0][0], py - P[0][1])
zones = {s['name']: pts(s) for s in REEF if s['kind'] in ('reef', 'peak', 'peel')}
# ── crest of rays
SP = float(sys.argv[4]) if len(sys.argv) > 4 else 10.0
THIN = int(sys.argv[6]) if len(sys.argv) > 6 else 6
beta = math.radians(D + 180); tx, ty = math.sin(beta), -math.cos(beta)
Yg, Xg = np.mgrid[0:R, 0:C]; s = ((Xg + .5) * dxc) * tx + ((Yg + .5) * dxc) * ty
s0 = s[hc < 45].min() - 1000; nx, ny = -ty, tx
us = np.arange(-3e5, 3e5, SP); X = s0 * tx + us * nx; Y = s0 * ty + us * ny
ok = (X > 0) & (X < C * dxc) & (Y > 0) & (Y < R * dxc); X, Y = X[ok], Y[ok]
n = len(X); phi = np.full(n, math.atan2(ty, tx)); alive = np.ones(n, bool); fine = np.zeros(n, bool)
BUF = float(sys.argv[5]) if len(sys.argv) > 5 else 30.0
hit = {k: np.zeros(n, bool) for k in zones}; ang = {k: np.full(n, np.nan) for k in zones}
paths = {}
def keep(idx):
    for i in idx[::1]: paths.setdefault(int(i), []).append((X[i], Y[i]))
ds = 4.0
for step in range(200000):
    idx = np.where(alive)[0]
    if not len(idx): break
    inF = (X[idx] > FX0 + 16) & (X[idx] < FX0 + (j1 - j0) * 8 - 16) & (Y[idx] > FY0 + 16) & (Y[idx] < FY0 + (i1 - i0) * 8 - 16)
    fine[idx[inF]] = True
    # coarse part
    a = idx[~inF]
    if len(a):
        ci = (X[a] / dxc).astype(int); ri = (Y[a] / dxc).astype(int)
        inb = (ci >= 0) & (ci < C) & (ri >= 0) & (ri < R); alive[a[~inb]] = False; a = a[inb]; ci = ci[inb]; ri = ri[inb]
        land = ~wc[ri, ci]; alive[a[land]] = False; a = a[~land]; ci = ci[~land]; ri = ri[~land]
        alive[a[fine[a]]] = False; a = a[~fine[a]]; ci = ci[~fine[a]] if False else ci          # left the fine box again: stop
        a2 = a; ci = (X[a2] / dxc).astype(int); ri = (Y[a2] / dxc).astype(int)
        nxv, nyv = -np.sin(phi[a2]), np.cos(phi[a2]); st = 12.0
        phi[a2] -= st * (gxc[ri, ci] * nxv + gyc[ri, ci] * nyv) / csc[ri, ci]
        X[a2] += st * np.cos(phi[a2]); Y[a2] += st * np.sin(phi[a2])
    b = idx[inF]
    if len(b):
        cj = ((X[b] - FX0) / 8).astype(int); ri = ((Y[b] - FY0) / 8).astype(int)
        shallow = hf[ri, cj] < 1.0
        for k, P in zones.items():
            d = line_d(X[b], Y[b], P); nh = (d < BUF) & ~hit[k][b]
            if nh.any():
                hit[k][b[nh]] = True
                if len(P) > 1:                         # crest vs peel line: 0 = closes out, 90 = peels straight along
                    seg = np.argmin([seg_d(X[b[nh]], Y[b[nh]], P[i], P[i + 1]) for i in range(len(P) - 1)], axis=0)
                    lv = np.array([math.atan2(P[q + 1][1] - P[q][1], P[q + 1][0] - P[q][0]) for q in seg])
                    ang[k][b[nh]] = np.degrees(np.abs(np.arcsin(np.abs(np.cos(phi[b[nh]] - lv)))))
        keep(b)
        alive[b[shallow]] = False; b = b[~shallow]; cj = ((X[b] - FX0) / 8).astype(int); ri = ((Y[b] - FY0) / 8).astype(int)
        nxv, nyv = -np.sin(phi[b]), np.cos(phi[b])
        phi[b] -= ds * (gxf[ri, cj] * nxv + gyf[ri, cj] * nyv) / csf[ri, cj]
        X[b] += ds * np.cos(phi[b]); Y[b] += ds * np.sin(phi[b])
print(f'T{T:g} D{D:g} fine smoothing {RF:g} m, ray spacing {SP:g} m, zone buffer {BUF:g} m; rays into the box: {fine.sum()}')
for k in zones:
    a = ang[k][hit[k]]
    print(f'  {k:28s} rays {hit[k].sum():4d}  (open-water equivalent {hit[k].sum() * SP:.0f} m of crest)' + (f'  peel angle median {np.nanmedian(a):.0f} deg, share >=30: {np.mean(a >= 30):.2f}' if len(a) and not np.all(np.isnan(a)) else ''))
# ── picture: hillshade of the fine box with the rays
img = np.clip(128 + zf * 6, 0, 255); img = np.where(wf, np.clip(40 + np.minimum(hf, 25) * -4 + 140, 30, 200), 90)
hs = np.zeros_like(zf); gy_, gx_ = np.gradient(zf, 8, 8); hs = np.clip(0.6 + (gx_ - gy_) * 0.05, 0, 1.2)
rgb = np.stack([img * 0.35 * hs + (~wf) * 70, img * 0.55 * hs + (~wf) * 60, img * 0.85 * hs + (~wf) * 50], -1).clip(0, 255).astype(np.uint8)
im = Image.fromarray(rgb).convert('RGB'); dr = ImageDraw.Draw(im)
for k, P in zones.items():
    q = [((x - FX0) / 8, (y - FY0) / 8) for x, y in P]
    if len(q) > 1: dr.line(q + ([q[0]] if k == 'Main reef' else []), fill=(255, 210, 120), width=3)
    else: dr.ellipse([q[0][0] - 4, q[0][1] - 4, q[0][0] + 4, q[0][1] + 4], outline=(255, 210, 120), width=2)
for i, p in paths.items():
    if len(p) < 2: continue
    hitany = any(hit[k][i] for k in zones)
    if not hitany and i % THIN: continue
    dr.line([((x - FX0) / 8, (y - FY0) / 8) for x, y in p], fill=(255, 140, 60) if hitany else (210, 225, 240), width=1)
im.save(f'near/near_T{T:g}_D{D:g}_r{RF:g}.png')
for nm, (la, lo, half) in {'wild': (41.2525, -72.0065, 900), 'choc': (41.2757, -71.9638, 700)}.items():
    cx, cy = toxy(la, lo); cx = (cx - FX0) / 8; cy = (cy - FY0) / 8; r = half / 8
    im.crop((int(cx - r * 1.4), int(cy - r), int(cx + r * 1.4), int(cy + r))).resize((int(r * 2.8 * 2), int(r * 4)), Image.NEAREST).save(f'near/{nm}_T{T:g}_D{D:g}_r{RF:g}.png')
