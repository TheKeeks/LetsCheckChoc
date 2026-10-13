"""Old (shortcut) vs new (exact) 144 m map layer: kfull/ per swell and the spread kgrid.png."""
import os, json, sys
import numpy as np
from PIL import Image
W = json.load(open('world.json')); m = json.load(open('ray2.json'))
cell = m['cell_km']
def rc(lat, lon): return int((W['top'] - lat) * W['kmlat'] / cell), int((lon - W['left']) * W['kmlon'] / cell)
spots = {'Choc': rc(41.27591, -71.96359), 'Wilderness': rc(41.2542, -72.0085)}
d = np.array(Image.open('depth144.png'), np.int64); depth = -(((d[..., 0] << 8) | d[..., 1]) / 10 - 1000); water = depth > 0.4
rows = []
for f in sorted(os.listdir('rm2_new/kfull')):
    a = np.array(Image.open('rm2_old/kfull/' + f), float) / 100; b = np.array(Image.open('rm2_new/kfull/' + f), float) / 100
    w = water & ((a > 0.05) | (b > 0.05))
    near = {k: (a[r - 3:r + 4, c - 3:c + 4][water[r - 3:r + 4, c - 3:c + 4]].mean(), b[r - 3:r + 4, c - 3:c + 4][water[r - 3:r + 4, c - 3:c + 4]].mean()) for k, (r, c) in spots.items()}
    rows.append((f, np.abs(b[w] - a[w]).mean(), a[w].mean(), b[w].mean(), near))
mad = np.array([r[1] for r in rows]); print(f'kfull: {len(rows)} swells; mean |change| in K over water {mad.mean():.3f} (K averages {np.mean([r[2] for r in rows]):.2f}); worst swell {mad.max():.3f}')
for k in spots:
    ch = np.array([r[4][k][1] / max(r[4][k][0], 1e-3) for r in rows if r[4][k][0] > 0.1])
    print(f'  near {k}: new/old K median {np.median(ch):.2f}, 10-90% {np.percentile(ch, 10):.2f}-{np.percentile(ch, 90):.2f} (n {len(ch)})')
a = np.array(Image.open('rm2_old/kgrid.png'), float) / 100; b = np.array(Image.open('rm2_new/kgrid.png'), float) / 100
w = (a > 0.05) | (b > 0.05); print(f'kgrid (spread, 288 m): mean |change| {np.abs(b[w] - a[w]).mean():.3f}, K averages {a[w].mean():.2f} -> {b[w].mean():.2f}')
