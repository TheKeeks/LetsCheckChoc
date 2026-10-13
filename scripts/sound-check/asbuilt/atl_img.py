"""Atlantic background for the opening animation: ETOPO 2022 30" (35-42 N, 76-63 W), plus depth contours."""
import json, math, numpy as np
from PIL import Image
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
A = np.load('atl/etopo30.npz'); lat, lon, z = A['lat'], A['lon'], A['z'].astype(float)
z = z[::-1]                                   # north at the top
cl = math.cos(math.radians(41))
dy = 0.93e3 * 1; dx = dy * cl                # metres per pixel (approx)
gy, gx = np.gradient(z * 4, dy, dx)          # 4x vertical exaggeration for the deep slopes
az, el = math.radians(315), math.radians(40)
nx, ny, nz = -gx, gy, np.ones_like(z); n = np.sqrt(nx * nx + ny * ny + 1)
shade = (math.cos(el) * math.sin(az) * nx + math.cos(el) * math.cos(az) * ny + math.sin(el)) / n
shade = np.clip(1 + 1.3 * (shade - math.sin(el)), 0.45, 1.4)
h = np.clip(-z, 0, None)
t = np.clip(np.log10(np.maximum(h, 1)) / np.log10(5500), 0, 1)           # 0 shallow .. 1 abyss
shallow = np.array([62, 104, 150]); deep = np.array([20, 42, 78])
col = (shallow[None, None] * (1 - t[..., None]) + deep[None, None] * t[..., None]) * shade[..., None]
landc = np.array([92, 82, 70]) * np.clip(shade, 0.5, 1.2)[..., None]
img = np.where((z >= 0)[..., None], landc * np.array([0.63, 0.68, 0.71]), col * np.array([0.78, 0.78, 0.74]))   # match the survey map's tones
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('site/ocean/atlantic.jpg', quality=82, optimize=True)
# contours
fig = plt.figure(); cs = plt.contour(lon, lat, -A['z'].astype(float), levels=[50, 100, 200, 1000, 2000, 3000, 4000])
out = {}
for lev, segs in zip(cs.levels, cs.allsegs):
    lines = []
    for s in segs:
        if len(s) < 8: continue
        s = s[::2] if len(s) > 40 else s
        lines.append([int(round(v * 1000)) for p in s for v in p])
    out[int(lev)] = lines
json.dump(dict(bounds=[float(lon[0]), float(lon[-1]), float(lat[0]), float(lat[-1])], contours=out), open('site/ocean/atl_meta.json', 'w'), separators=(',', ':'))
import os; print(os.path.getsize('site/ocean/atlantic.jpg'), os.path.getsize('site/ocean/atl_meta.json'), img.shape)
