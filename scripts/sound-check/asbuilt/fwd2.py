"""fwd.py on a finer grid (F x 8 m cells) to check the Wilderness east lane."""
import json, math, sys
import numpy as np
F = int(sys.argv[1]) if len(sys.argv) > 1 else 6
world = json.load(open('world.json'))
z8 = np.load('elev8.npy', mmap_mode='r')
R, C = z8.shape[0] // F, z8.shape[1] // F
z = np.asarray(z8[:R * F, :C * F], np.float32).reshape(R, F, C, F).mean(axis=(1, 3)).astype(np.float64)
dx = 8.0 * F
h = np.clip(-z, 0, None); water = h > 0.5
import raymodel2 as m0
def blur(a, r): return m0.blur(a, r)
def speeds(T):
    L0 = 9.81 * T * T / (2 * math.pi); hh = np.maximum(h, 0.5)
    L = L0 * np.tanh((2 * math.pi * np.sqrt(hh / 9.81) / T) ** 1.5) ** (2 / 3)
    k = 2 * math.pi / L; c = L / T; kh = np.minimum(k * hh, 20); n = 0.5 * (1 + 2 * kh / np.sinh(2 * kh))
    return c, n * c, L0 / T, 0.5 * L0 / T
class M: pass
m = M(); m.world = world; m.dx = dx / 1000; m.R = R; m.C = C; m.h = h; m.water = water; m.speeds = speeds; m.blur = blur
import fwd
fwd.m = m; fwd.dx = dx; fwd.R = R; fwd.C = C; fwd.FIELDS = {}
_fields = fwd.fields
def fields(T):
    if T in fwd.FIELDS: return fwd.FIELDS[T]
    c, cg, c0, cg0 = speeds(T)
    r = max(1, round(150 / dx))
    cs = blur(np.where(water, c, c[water].min()), r)
    gy, gx = np.gradient(cs, dx, dx)
    fwd.FIELDS[T] = (cs, gx, gy, cg, cg0); return fwd.FIELDS[T]
fwd.fields = fields
B = json.load(open('backk2.json'))
def back(spot, T, D, s=15):
    bk = B[spot]; j = bk['periods'].index(T); K = np.array(bk['R'][j]); th = np.arange(360) + 0.5
    Dd = np.cos(np.radians(th - D) / 2) ** (2 * s); Dd /= Dd.sum()
    return math.sqrt((Dd * K).sum() / (math.pi / 180))
print('grid', R, C, 'cell m', dx, flush=True)
for T in [9]:
    for D in [90, 110, 130, 150, 170]:
        fc, fw, rc, rw, dC, dW = fwd.factor(D, T, SP=12.0)
        print(f'T{T} D{D}: fwd choc {fc:.2f} (bk {back("choc", T, D):.2f}) wild {fw:.2f} (bk {back("wild", T, D):.2f}) ratio {rc:.2f}/{rw:.2f} depth {dC:.1f}/{dW:.1f}', flush=True)
