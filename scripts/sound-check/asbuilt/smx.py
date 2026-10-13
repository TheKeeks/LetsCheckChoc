"""Smoothing / numerics experiment on the Choc forward-ray tables (see fwdprod2.py, frbuild2.py).

Pass 1 (pass1): the production tracer as is (speed blurred with radius 3 = sigma ~166 m, 20 m ray spacing), all rays;
  keeps which rays pass within 6 km of the Choc pin, and checks the landing count against fwd2_table_s1.json.
Variants (variant NAME): only those rays and 8 neighbours each side, re-traced 4x denser (5 m apart), under:
  blur radius r (sigma ~68/118/166/263/407 m for r = 1/2/3/5/8), a period-scaled blur (sigma ~ one wavelength at
  20 m depth), masked blur (land doesn't leak into the water's speeds), and 'paper-grade' numerics (exact dispersion,
  bilinear sampling, half steps). Output: fwd2_table_<NAME>.json in frbuild2's layout (Choc columns only; the peel
  columns are copied from the production table, they don't enter the heights).
usage: python3 smx.py pass1 <worker> <nworkers> | python3 smx.py variant <NAME> <worker> <nworkers> | python3 smx.py table <NAME>
"""
import json, math, sys, glob
import numpy as np
import fwdprod2 as F

G = 9.81; SP = 20.0; DENSE = 4; NEAR = 6000.0; MARGIN = 8
PERS = list(range(5, 18)); DIRS = [50 + 2.5 * i for i in range(77)]

def L_fm(T, hh):                                   # Fenton & McKee explicit wavelength (the production formula)
    L0 = G * T * T / (2 * math.pi)
    return L0 * np.tanh((2 * math.pi * np.sqrt(hh / G) / T) ** 1.5) ** (2 / 3)
def L_exact(T, hh):                                # exact linear dispersion: Newton on w^2 = g k tanh(k h)
    w = 2 * math.pi / T; k = 2 * math.pi / L_fm(T, hh)
    for _ in range(30):
        t = np.tanh(k * hh); f = G * k * t - w * w; df = G * t + G * k * hh * (1 - t * t)
        k = k - f / df
    return 2 * math.pi / k
def sig_cells(r): return math.sqrt(3 * ((2 * r + 1) ** 2 - 1) / 12)        # 3 passes of a (2r+1) box
def r_for_sigma(s_m):
    return min(range(1, 16), key=lambda r: abs(sig_cells(r) * F.dx - s_m))

VARIANTS = {
    'r1': dict(r=1), 'r2': dict(r=2), 'r3': dict(r=3), 'r5': dict(r=5), 'r8': dict(r=8),
    'lam': dict(r='lambda'),                        # sigma ~ wavelength at 20 m depth, per period
    'mask3': dict(r=3, masked=True),                # same sigma, but land is left out of the average
    'num3': dict(r=3, exact=True, bilinear=True, ds=0.25),   # paper-grade numerics at the production sigma
    'ds3': dict(r=3, ds=0.25),                      # half steps only
}

def fields_v(T, v):
    hh = np.maximum(F.h, 0.5)
    L = L_exact(T, hh) if v.get('exact') else L_fm(T, hh)
    c = L / T
    r = v['r']
    if r == 'lambda': r = r_for_sigma(float(L_exact(T, np.array(20.0)) if v.get('exact') else L_fm(T, 20.0)))
    if v.get('masked'):
        wm = F.water.astype(float)
        cs = F.blur(np.where(F.water, c, 0.0), r) / np.maximum(F.blur(wm, r), 1e-6)
        cs = np.where(F.blur(wm, r) > 1e-3, cs, c[F.water].min())
    else:
        cs = F.blur(np.where(F.water, c, c[F.water].min()), r)
    gy, gx = np.gradient(cs, F.dx, F.dx)
    return dict(cs=cs, gx=gx, gy=gy, r=r)

def sample(A, X, Y, bilinear):
    if not bilinear:
        return A[(Y / F.dx).astype(int), (X / F.dx).astype(int)]
    fx = X / F.dx - 0.5; fy = Y / F.dx - 0.5                      # cell centres sit at (i + 0.5) dx
    i0 = np.clip(np.floor(fx).astype(int), 0, F.C - 2); j0 = np.clip(np.floor(fy).astype(int), 0, F.R - 2)
    a = np.clip(fx - i0, 0, 1); b = np.clip(fy - j0, 0, 1)
    return (A[j0, i0] * (1 - a) * (1 - b) + A[j0, i0 + 1] * a * (1 - b) + A[j0 + 1, i0] * (1 - a) * b + A[j0 + 1, i0 + 1] * a * b)

def run_v(Fd, X, Y, phi0, ds_cells=0.5, bilinear=False, prune=None):
    """the production update (fwdprod2.run): heading first, then position, nearest cell unless bilinear;
    returns each ray's closest approach to the Choc pin (m)"""
    n = len(X); phi = np.full(n, float(phi0)); alive = np.ones(n, bool); ds = ds_cells * F.dx
    minC = np.full(n, 1e9)
    for step in range(int(2.6 * (F.R + F.C) / ds_cells)):
        idx = np.where(alive)[0]
        if not len(idx): break
        ci = (X[idx] / F.dx).astype(int); ri = (Y[idx] / F.dx).astype(int)
        inb = (ci >= 0) & (ci < F.C) & (ri >= 0) & (ri < F.R)
        alive[idx[~inb]] = False; idx = idx[inb]; ci = ci[inb]; ri = ri[inb]
        dC = np.hypot(X[idx] - F.CHOC[0], Y[idx] - F.CHOC[1]); b = dC < minC[idx]; minC[idx[b]] = dC[b]
        land = ~F.water[ri, ci]
        if prune: land |= dC > minC[idx] + prune          # well past its closest approach: it isn't coming back
        alive[idx[land]] = False
        idx = idx[~land]
        nxv, nyv = -np.sin(phi[idx]), np.cos(phi[idx])
        gx = sample(Fd['gx'], X[idx], Y[idx], bilinear); gy = sample(Fd['gy'], X[idx], Y[idx], bilinear); cs = sample(Fd['cs'], X[idx], Y[idx], bilinear)
        phi[idx] -= ds * (gx * nxv + gy * nyv) / cs
        X[idx] += ds * np.cos(phi[idx]); Y[idx] += ds * np.sin(phi[idx])
    return minC

def crest_e(D, sp):
    """fwdprod2.crest with the edge and along-edge slot of every ray (same order, same points for sp = SP)"""
    beta = math.radians(D + 180); tx, ty = math.sin(beta), -math.cos(beta)
    out = []
    if ty < -0.05:
        for x in np.arange(sp / 2 / abs(ty), F.C * F.dx, sp / abs(ty)):
            if F.water[F.R - 1, min(F.C - 1, int(x / F.dx))]: out.append((0, x / (SP / abs(ty)), x, F.R * F.dx - 1))
    if tx < -0.05:
        for y in np.arange(sp / 2 / abs(tx), F.R * F.dx, sp / abs(tx)):
            if F.water[min(F.R - 1, int(y / F.dx)), F.C - 1]: out.append((1, y / (SP / abs(tx)), F.C * F.dx - 1, y))
    if tx > 0.05:
        for y in np.arange(sp / 2 / abs(tx), F.R * F.dx, sp / abs(tx)):
            if F.west_open[min(F.R - 1, int(y / F.dx))]: out.append((2, y / (SP / abs(tx)), 1.0, y))
    return out, math.atan2(ty, tx)

def rc_of(T): return max(250.0, 0.5 * math.sqrt(float(L_fm(T, 20.0)) * 15000))
def cg_fm(T, h):
    L = float(L_fm(T, h)); k = 2 * math.pi / L; kh = min(20, k * h); return 0.5 * (1 + 2 * kh / math.sinh(2 * kh)) * L / T
def shoal(T): return cg_fm(T, 48) / cg_fm(T, 4.0)

def run_full(name, wk, nw):
    """every ray at the production spacing (20 m), under the variant's field and numerics"""
    v = VARIANTS[name]; out = {}
    for T in PERS[wk::nw]:
        Fd = fields_v(T, v)
        for D in DIRS:
            pts, phi0 = crest_e(D, SP)
            X = np.array([p[2] for p in pts]); Y = np.array([p[3] for p in pts])
            mC = run_v(Fd, X, Y, phi0, ds_cells=v.get('ds', 0.5), bilinear=v.get('bilinear', False))
            out[f'{T}_{D:g}'] = dict(nc=int((mC < rc_of(T)).sum()), edge=0, n=len(pts), sp=SP)
        print(name, T, flush=True)
    json.dump(out, open(f'smx_{name}_{wk}.json', 'w'))
    print('DONE', name, flush=True)

def run_variant(name, wk, nw):
    v = VARIANTS[name]
    P1 = {}
    for f in glob.glob('smx_pass1_*.json'): P1.update(json.load(open(f)))
    out = {}
    for T in PERS[wk::nw]:
        Fd = fields_v(T, v)
        for D in DIRS:
            cand = P1[f'{T}_{D:g}']['cand']
            keep = set()
            for e, s in cand:
                for d in range(-MARGIN, MARGIN + 1): keep.add((e, s + d))
            pts, phi0 = crest_e(D, SP / DENSE)
            sel = [p for p in pts if (p[0], int(math.floor(p[1]))) in keep]
            if not sel:
                out[f'{T}_{D:g}'] = dict(nc=0, edge=0, n=0); continue
            X = np.array([p[2] for p in sel]); Y = np.array([p[3] for p in sel])
            mC = run_v(Fd, X, Y, phi0, ds_cells=v.get('ds', 0.5), bilinear=v.get('bilinear', False), prune=6000.0)
            rc = rc_of(T); nc = int((mC < rc).sum())
            # margin check: the outermost kept rays of each run of slots must not land
            slots = np.array([[p[0], math.floor(p[1])] for p in sel])
            edge = 0
            for i, p in enumerate(sel):
                s = math.floor(p[1])
                if ((p[0], s - 1) not in keep or (p[0], s + 1) not in keep) and mC[i] < rc: edge += 1
            out[f'{T}_{D:g}'] = dict(nc=nc, edge=edge, n=len(sel))
        print(name, T, flush=True)
    json.dump(out, open(f'smx_{name}_{wk}.json', 'w'))
    print('DONE', flush=True)

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'pass1':
        wk, nw = int(sys.argv[2]), int(sys.argv[3]); base = json.load(open('fwd2_table_s1.json'))
        out = {}
        for T in PERS[wk::nw]:
            Fd = fields_v(T, VARIANTS['r3'])
            for D in DIRS:
                pts, phi0 = crest_e(D, SP)
                X = np.array([p[2] for p in pts]); Y = np.array([p[3] for p in pts])
                X0, Y0, _ = F.crest(D); assert np.allclose(X, X0) and np.allclose(Y, Y0)
                mC = run_v(Fd, X.copy(), Y.copy(), phi0)
                nc = int((mC < rc_of(T)).sum()); ref = base[str(T)][f'{D:g}'][0]
                cand = sorted({(pts[i][0], int(round(pts[i][1] - 0.5))) for i in np.where(mC < NEAR)[0]})
                out[f'{T}_{D:g}'] = dict(nc=nc, ref=ref, cand=cand)
                print(T, D, nc, ref, len(cand), flush=True)
        json.dump(out, open(f'smx_pass1_{wk}.json', 'w'))
        print('DONE', flush=True)
    elif mode == 'full':
        wk, nw = int(sys.argv[2]), int(sys.argv[3])
        for name in sys.argv[4].split(','): run_full(name, wk, nw)
    elif mode in ('variant', 'multi'):
        if mode == 'multi': names, wk, nw = sys.argv[4].split(','), int(sys.argv[2]), int(sys.argv[3])
        else: names, wk, nw = [sys.argv[2]], int(sys.argv[3]), int(sys.argv[4])
        for name in names: run_variant(name, wk, nw)
    elif mode == 'table':
        name = sys.argv[2]; base = json.load(open('fwd2_table_s1.json')); R = {}
        src = 'pass1' if name == 'r3' else name
        for f in glob.glob(f'smx_{src}_[0-9].json'): R.update(json.load(open(f)))
        tab = {}; edges = 0
        for T in PERS:
            for D in DIRS:
                r = R[f'{T}_{D:g}']; b = base[str(T)][f'{D:g}']
                k2 = r['nc'] * r.get('sp', SP if src == 'pass1' else SP / DENSE) / (2 * rc_of(T)) * shoal(T); edges += r.get('edge', 0)
                tab.setdefault(str(T), {})[f'{D:g}'] = [r['nc'], 0, round(k2, 5), 0] + b[4:7] + [None, None, 0]
        json.dump(tab, open(f'fwd2_table_{name}.json', 'w'), separators=(',', ':'))
        print(name, 'table written; landing rays at the edge of the kept band:', edges)
