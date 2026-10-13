"""Forward rays v2 -> tables for the page and the history.

Landing zone radius widens with wavelength: r = max(R0, s * F), F = 0.5 sqrt(L20 * 15 km)
(half a Fresnel width: long waves can't be focused into, or hidden from, anything narrower).
s = 0 reproduces the fixed 250 m / 150 m zones; s = 1 is the physical default.
Both spots are compared at the same depth (shoaling to 4 m), so neither gets a boost from a
shallower zone. Peel: share of the landing rays (within 400 m) that meet the bottom contours
at 30 degrees or more (0 = square-on, closes out).

Usage: python3 frbuild2.py <s>   -> fwd2_table_s<s>.json ; with 'page' also writes fr/ and fr_page.json
"""
import json, glob, math, os, sys
import numpy as np
S = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
PAGE = 'page' in sys.argv
w = json.load(open('world.json')); bg = json.load(open('fr_meta.json'))
tab = {}
for f in glob.glob('fwd2_[0-9].json'): tab.update(json.load(open(f)))
G = 9.81; SP = 20.0; R0C, R0W = 250.0, 150.0; PEEL = 30.0; NEAR = 400.0
def toxy(lat, lon): return ((lon - w['left']) * w['kmlon'], (w['top'] - lat) * w['kmlat'])
CHOC = toxy(41.27591, -71.96359); W1 = toxy(41.25286, -72.00573); W2 = toxy(41.25551, -72.01117)
def L_at(T, h):
    L0 = G * T * T / (2 * math.pi); return L0 * math.tanh((2 * math.pi * math.sqrt(h / G) / T) ** 1.5) ** (2 / 3)
def cg(T, h):
    L = L_at(T, h); k = 2 * math.pi / L; kh = min(20, k * h); return 0.5 * (1 + 2 * kh / math.sinh(2 * kh)) * L / T
def fres(T): return 0.5 * math.sqrt(L_at(T, 20) * 15000)
def width_w(D, r):
    b = math.radians(D + 180); tx, ty = math.sin(b), -math.cos(b); vx, vy = W2[0] - W1[0], W2[1] - W1[1]
    return abs(vx * ty - vy * tx) * 1000 + 2 * r
fine = {}
for k, r in tab.items():
    T, D = k.split('_'); T = int(T); D = float(D)
    rc, rw = max(R0C, S * fres(T)), max(R0W, S * fres(T))
    shoal = cg(T, 48) / cg(T, 4.0)
    c = np.array(r['c'], float).reshape(-1, 2); ww = np.array(r['w'], float).reshape(-1, 2)
    nc = int((c[:, 0] < rc).sum()) if len(c) else 0; nw = int((ww[:, 0] < rw).sum()) if len(ww) else 0
    k2c = nc * SP / (2 * rc) * shoal; k2w = nw * SP / width_w(D, rw) * shoal
    def peel(a, r):
        if not len(a): return [None, None, 0]
        sel = a[(a[:, 0] < NEAR) & (a[:, 1] >= 0) & (a[:, 1] <= 95)]
        if len(sel) < 3: sel = a[(a[:, 0] < r) & (a[:, 1] >= 0) & (a[:, 1] <= 95)]
        if not len(sel): return [None, None, 0]
        return [round(float((sel[:, 1] >= PEEL).mean()), 3), int(np.median(sel[:, 1])), int(len(sel))]
    pc, pw = peel(c, rc), peel(ww, rw)
    fine.setdefault(T, {})[f'{D:g}'] = [nc, nw, round(k2c, 5), round(k2w, 5)] + pc + pw
json.dump(fine, open(f'fwd2_table_s{S:g}.json', 'w'), separators=(',', ':'))
print('table written', S)

if PAGE:
    def dp(pts, eps):
        if len(pts) < 3: return pts
        a, b = np.array(pts[0], float), np.array(pts[-1], float); P = np.array(pts, float); ab = b - a; L = np.hypot(*ab)
        d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L if L > 0 else np.hypot(*(P - a).T)
        i = int(np.argmax(d))
        return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps) if d[i] > eps else [pts[0], pts[-1]]
    os.makedirs('fr', exist_ok=True)
    FRTAB, byT = {}, {}
    for k, r in tab.items():
        if 'rays' not in r: continue
        T, D = k.split('_'); T = int(T); Di = int(float(D))
        row = fine[T][f'{float(D):g}']
        FRTAB.setdefault(T, {})[Di] = [row[0], row[1], row[4], row[7]]          # counts and peel shares
        rays = []
        for ray in r['rays']:
            p = ray['p']; pts = [(p[i], p[i + 1]) for i in range(0, len(p), 2)]
            s = dp(pts, 3); rays.append(dict(h=ray['h'], p=[v for q in s for v in q]))
        byT.setdefault(T, {})[Di] = dict(rays=rays)
    for T, d in byT.items(): json.dump(d, open(f'fr/{T}.json', 'w'), separators=(',', ':'))
    reff = {T: [max(R0C, S * fres(T)), max(R0W, S * fres(T))] for T in range(5, 18)}
    meta = dict(world=bg['world'], kmlon=w['kmlon'], kmlat=w['kmlat'], choc=CHOC, w1=W1, w2=W2, rc=R0C, rw=R0W, reff=reff,
                depth=4.0, peel=PEEL, close=bg['close'])
    json.dump(dict(meta=meta, tab=FRTAB), open('fr_page.json', 'w'), separators=(',', ':'))
    print('page data written')
