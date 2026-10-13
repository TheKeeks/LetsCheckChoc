"""Forward-ray response in the old kernel format, so every part of the page uses the same rays:
R[T][deg] = k2(T, deg) x (pi/180), i.e. per radian, so sqrt(sum D * R / rad) = sqrt(sum D * k2)."""
import json, math, numpy as np
tab = json.load(open('fwd_table.json'))
TS = list(range(5, 18)); DS = np.array([50 + 2.5 * i for i in range(77)])
out = {}
for spot, col in (('choc', 2), ('wild', 3)):
    R = []
    for T in TS:
        v = np.array([tab[str(T)][f'{D:g}'][col] for D in DS])
        deg = np.arange(360) + 0.5
        k = np.interp(deg, DS, v, left=0, right=0)
        R.append((k * math.pi / 180).round(6).tolist())
    out[spot] = dict(periods=TS, R=R)
    np.savez_compressed(f'fwdkernel_{spot}.npz', periods=np.array(TS), R=np.array(R))
json.dump(out, open('fwdk.json', 'w'), separators=(',', ':'))
print('ok')
