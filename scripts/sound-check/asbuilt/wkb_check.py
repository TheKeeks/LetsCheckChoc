"""Where does ray theory hold near Choc? WKB parameter eps = |grad c| / (k c): the fractional change of the phase
speed over one radian of phase (Halsne et al.'s check_WKB_valitidy_depht uses |grad d| / (d k), the same idea).
eps << 1: rays are fine. eps ~ 0.3 or more: the bottom changes within about a wavelength, so ray theory is off.
Computed on the 48 m grid around the approach to Choc, for the raw speed field and for each blur the experiment tries.
"""
import math, sys
import numpy as np
import fwdprod2 as F
from smx import L_fm, sig_cells
G = 9.81
# the approach: water within 3 km of the Choc pin, deeper than 2 m (the rays' last stretch)
Yg, Xg = np.mgrid[0:F.R, 0:F.C]; Xg = (Xg + 0.5) * F.dx; Yg = (Yg + 0.5) * F.dx
dC = np.hypot(Xg - F.CHOC[0], Yg - F.CHOC[1])
zones = {'within 1 km': (dC < 1000) & F.water & (F.h > 2), '1-3 km': (dC >= 1000) & (dC < 3000) & F.water & (F.h > 2)}
r0, r1 = int((F.CHOC[1] - 4000) / F.dx), int((F.CHOC[1] + 4000) / F.dx); c0, c1 = int((F.CHOC[0] - 4000) / F.dx), int((F.CHOC[0] + 4000) / F.dx)
print('blur sigma (m):', {r: round(sig_cells(r) * F.dx) for r in (1, 2, 3, 5, 8)})
for T in (6, 9, 12, 15):
    hh = np.maximum(F.h, 0.5); L = L_fm(T, hh); c = L / T; k = 2 * math.pi / L
    row = []
    for r in (0, 1, 2, 3, 5, 8):
        cs = c if r == 0 else F.blur(np.where(F.water, c, c[F.water].min()), r)
        sub = cs[r0:r1, c0:c1]; gy, gx = np.gradient(sub, F.dx, F.dx)
        eps = np.hypot(gx, gy) / (k[r0:r1, c0:c1] * sub)
        cell = []
        for nm, m in zones.items():
            e = eps[m[r0:r1, c0:c1]]
            cell.append(f'{nm}: median {np.median(e):.3f}, >0.3 {100 * (e > 0.3).mean():.0f}%')
        row.append((r, cell))
    print(f'T={T}s  L(20 m)={float(L_fm(T, 20.0)):.0f} m')
    for r, cell in row: print(f'   blur r={r} ({"raw" if r == 0 else str(round(sig_cells(r) * F.dx)) + " m"}): ' + ' | '.join(cell))
