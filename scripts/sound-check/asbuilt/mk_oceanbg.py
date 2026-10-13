"""Ocean-wide backdrop for the forecast map: ETOPO 2022 at 6' (every 24th 15" cell), hillshaded like
the coastal maps, plus a land-only layer used to mask the swell colours. Bounds cover more than the
forecast grid so the map has no empty margins on wide or tall screens."""
import numpy as np, math, json, os, sys
from PIL import Image
src = sys.argv[1]
d = np.loadtxt(src, delimiter=',', skiprows=2)
la = np.unique(d[:, 0]); lo = np.unique(d[:, 1]); z = d[:, 2].reshape(len(la), len(lo))[::-1]
el = math.radians(40); az = math.radians(315); dy = 11.1e3; dx = dy * math.cos(math.radians(35))
gy, gx = np.gradient(z * 6, dy, dx); nx, ny = -gx, gy; n = np.sqrt(nx * nx + ny * ny + 1)
shade = (math.cos(el) * math.sin(az) * nx + math.cos(el) * math.cos(az) * ny + math.sin(el)) / n
shade = np.clip(1 + 1.3 * (shade - math.sin(el)), 0.45, 1.4)
h = np.clip(-z, 0, None); t = np.clip(np.log10(np.maximum(h, 1)) / np.log10(6000), 0, 1)
shallow = np.array([62, 104, 150]); deep = np.array([20, 42, 78])
col = (shallow[None, None] * (1 - t[..., None]) + deep[None, None] * t[..., None]) * shade[..., None] * np.array([0.78, 0.78, 0.74])
landc = np.array([92, 82, 70]) * np.clip(shade, 0.5, 1.2)[..., None] * np.array([0.63, 0.68, 0.71])
land = (z >= 0)
Image.fromarray(np.clip(np.where(land[..., None], landc, col), 0, 255).astype(np.uint8)).save('site/ocean/ocean_bg.jpg', quality=80, optimize=True)
Image.fromarray(np.dstack([np.zeros(land.shape + (3,), np.uint8), (land * 255).astype(np.uint8)]), 'RGBA').save('site/ocean/ocean_land.png', optimize=True)
json.dump(dict(bounds=[float(lo[0]), float(lo[-1]), float(la[0]), float(la[-1])]), open('site/ocean/ocean_meta.json', 'w'))
print(z.shape, [os.path.getsize('site/ocean/' + f) for f in ('ocean_bg.jpg', 'ocean_land.png')])
