"""Ray tables with the narrower fixed landing zones (250 m at Choc, 150 m at Wilderness) instead of the wavelength-wide
ones, from the same trace records. Usage: python3 fixed_zone.py old|new  ->  fwd2_table_fix<mode>.json"""
import sys, os, json, math, shutil
sys.path.insert(0, '/home/user/LetsCheckChoc/scripts/rays')
import raycore as rc
import build_tables as bt
mode = sys.argv[1]
src = {'old': [f'fwd2_{i}.json' for i in range(4)], 'new': [f'exact/fwd_{i}.json' for i in range(4)]}[mode]
out = f'fixed_{mode}'; os.makedirs(out, exist_ok=True)
for i, f in enumerate(src):
    dst = os.path.join(out, f'fwd_{i}.json')
    if not os.path.exists(dst): os.symlink(os.path.abspath(f), dst)
if mode == 'old':   # the old tables' shoaling used Fenton-McKee too
    def fm(T, h):
        h = rc.np.asarray(h, float); w = 2 * math.pi / T
        return rc.G * T * T / (2 * math.pi) * rc.np.tanh((w * rc.np.sqrt(h / rc.G)) ** 1.5) ** (2 / 3)
    rc.wavelength = fm
rc.landing_radius = lambda T, r0: r0
bt.build_tables('.', out, False)
shutil.copy(os.path.join(out, 'fwd_table.json'), f'fwd2_table_fix{mode}.json')
