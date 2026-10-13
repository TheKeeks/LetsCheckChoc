"""Crest timing by the eikonal equation (first-arriving wavefront), for the marching crests.

The ray model's mean arrival time is noisy where two swell families cross (around Montauk
and Block Island). Here the crest arrival time tau(x) solves |grad tau| = 1 / c(x) by fast
marching from a straight offshore crest (plane wave), with land as obstacles. That is the
front a surfer would see first: continuous, bending around islands into their lee.

The grid is padded (edge-replicated) on the south, east and west so the starting crest can
lie entirely offshore of the map for every direction. Writes crest/T_D.jpg with
R, G = cos, sin of 2 pi psi and B = the ray model's K x 100 (kept from raymodel2.py),
where psi = tau / (m T) and one drawn crest spacing is 4 km x (T / 9 s)^1.5 offshore
(the page can halve or quarter it with double-angle formulas when zoomed in).
"""
import json, math, sys
import numpy as np, skfmm
from PIL import Image

world = json.load(open('world.json'))
F = 18
z8 = np.load('elev8.npy', mmap_mode='r')
R, C = z8.shape[0] // F, z8.shape[1] // F
z = np.asarray(z8[:R * F, :C * F], np.float32).reshape(R, F, C, F).mean(axis=(1, 3)).astype(np.float64)
dx = world['px_km'] * F * 1000                     # metres
h = np.clip(-z, 0, None)
P = 760
hp = np.pad(h, ((0, P), (P, P)), mode='edge')     # south, west, east
land = hp <= 0.5
Y, X = np.mgrid[0:hp.shape[0], 0:hp.shape[1]].astype(np.float64)
X = (X - P + 0.5) * dx; Y = (Y + 0.5) * dx        # metres, map origin at the unpadded top-left
G = 9.81
dom = (slice(0, R), slice(P, P + C))

def run(D, T):
    L0 = G * T * T / (2 * math.pi); hh = np.maximum(hp, 0.5)
    L = L0 * np.tanh((2 * math.pi * np.sqrt(hh / G) / T) ** 1.5) ** (2 / 3)
    c = L / T; c0 = L0 / T
    beta = math.radians(D + 180); tx, ty = math.sin(beta), -math.cos(beta)
    s = X * tx + Y * ty                                         # distance along travel
    wd = ~land[dom]
    d0 = s[dom][wd].min() - 3000                                # start crest 3 km offshore of the map
    phi = np.ma.MaskedArray(s - d0, mask=land)
    tt = skfmm.travel_time(phi, np.where(land, c0, c), dx=dx, order=2)
    tau = np.ma.filled(tt, np.nan)[dom] + d0 / c0               # consistent plane-wave time
    tau = np.where(np.isfinite(tau), tau, 0)
    Lam = 4000 * (T / 9) ** 1.5; m = Lam / L0
    return tau / (m * T)

if __name__ == '__main__':
    r2 = json.load(open('ray2.json'))
    for T in r2['pers']:
        for D in r2['dirs']:
            psi = run(D, T)
            old = np.array(Image.open(f'crest/{T}_{D}.jpg'))
            rgb = np.stack([np.cos(2 * np.pi * psi) * 127.5 + 127.5, np.sin(2 * np.pi * psi) * 127.5 + 127.5, old[..., 2]], -1)
            Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(f'crest/{T}_{D}.jpg', quality=90, subsampling=0, optimize=True)
            print('T', T, 'D', D, 'psi max %.1f' % psi.max(), file=sys.stderr)
