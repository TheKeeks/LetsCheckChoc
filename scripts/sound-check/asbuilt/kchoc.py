import json, math, numpy as np
meta = json.load(open('map_meta.json'))['wide']; km = json.load(open('kmeta.json'))
F = np.load('kfields.npz'); R, C = km['R'], km['C']
from PIL import Image
a = np.array(Image.open('height_wide.png')).astype(np.int32); z = ((a[..., 0] << 8) | a[..., 1]) / 10 - 1000
def rc(lat, lon): return int((meta['top'] - lat) / (meta['top'] - meta['bottom']) * R), int((lon - meta['left']) / (meta['right'] - meta['left']) * C)
r0, c0 = rc(41.275693, -71.963310)
cand = [(r, c) for r in range(r0 - 6, r0 + 7) for c in range(c0 - 6, c0 + 7) if 1 < -z[r, c] < 8]
# the reef point: shallow water cell closest to the beach point, on the south (ocean) side
cand.sort(key=lambda p: (p[0] < r0, (p[0] - r0) ** 2 + (p[1] - c0) ** 2))
CH = cand[0]
print('Choc cell', CH, 'depth m', round(-z[CH], 1))
def K(D, T, cell=CH):
    Ds, Ts = km['dirs'], km['pers']
    D = min(max(D, Ds[0]), Ds[-1]); T = min(max(T, Ts[0]), Ts[-1])
    i = min(len(Ds) - 2, int((D - Ds[0]) // 10)); fd = (D - Ds[i]) / 10
    j = max(0, min(len(Ts) - 2, sum(1 for t in Ts if t <= T) - 1)); ft = (T - Ts[j]) / (Ts[j + 1] - Ts[j])
    g = lambda d, t: F[f'{d}_{t}'][cell]
    return float((g(Ds[i], Ts[j]) * (1 - fd) + g(Ds[i + 1], Ts[j]) * fd) * (1 - ft) + (g(Ds[i], Ts[j + 1]) * (1 - fd) + g(Ds[i + 1], Ts[j + 1]) * fd) * ft)
if __name__ == '__main__':
    for T in km['pers']:
        print('T', T, ' '.join(f"{D}:{F[f'{D}_{T}'][CH]:.2f}" for D in km['dirs']))
    json.dump(dict(cell=CH), open('kchoc.json', 'w'))
