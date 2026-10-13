"""How much the exact wave speed moves the old 144 m map layer (raymodel2.py): K for a few swells, shortcut vs exact."""
import sys, math, time
import numpy as np
sys.path.insert(0, '/home/user/LetsCheckChoc/scripts/rays')
import raycore as rc
import raymodel2 as m
fm_speeds = m.speeds
def exact_speeds(T):
    hh = np.maximum(m.h, 0.5); L0 = m.G * T * T / (2 * math.pi)
    L = rc.wavelength(T, hh); k = 2 * math.pi / L; c = L / T; kh = np.minimum(k * hh, 20)
    n = 0.5 * (1 + 2 * kh / np.sinh(2 * kh))
    return c, n * c, L0 / T, 0.5 * L0 / T
for T, D in ((12, 150), (9, 170), (15, 130)):
    t0 = time.time(); m.speeds = fm_speeds; K0, _ = m.trace(D, T); t1 = time.time()
    m.speeds = exact_speeds; K1, _ = m.trace(D, T)
    w = m.water & (K0 > 0.05)
    r = K1[w] / K0[w]
    # near the spots: Choc pin 41.27591 N 71.96359 W
    W = m.world; rr = int((W['top'] - 41.27591) * W['kmlat'] / m.dy); cc = int((-71.96359 - W['left']) * W['kmlon'] / m.dx)
    print(f'T {T} D {D}: {t1 - t0:.0f} s per trace; K exact/shortcut over water median {np.median(r):.3f}, 5-95% {np.percentile(r, 5):.3f}-{np.percentile(r, 95):.3f}; near Choc {K0[rr-2:rr+3, cc-2:cc+3].mean():.3f} -> {K1[rr-2:rr+3, cc-2:cc+3].mean():.3f}', flush=True)
