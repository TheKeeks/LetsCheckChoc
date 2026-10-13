"""Backgrounds for the forward-ray figure: whole map (64 m px) and a Fishers close-up (8 m px)."""
import json, math, numpy as np
from PIL import Image
import tiles as T
w = json.load(open('world.json'))
z8 = np.load('elev8.npy', mmap_mode='r')
def img(z, px_m, ve):
    zp = np.pad(z, 1, mode='edge')
    water, land, _ = T.render(zp, px_m, ve)
    lum = water.astype(np.float32) / 255
    base = np.array([62, 104, 150], np.float32) / 255
    out = lum * base[None, None, :] * 255
    a = land[..., 3:4].astype(np.float32) / 255
    out = out * (1 - a) + land[..., :3] * a
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
z = np.asarray(z8, np.float32)
z0 = z[:z.shape[0] // 8 * 8, :z.shape[1] // 8 * 8].reshape(z.shape[0] // 8, 8, z.shape[1] // 8, 8).mean(axis=(1, 3))
img(z0, 64, 6).save('fr_world.jpg', quality=84, optimize=True)
# close-up: 41.215-41.30 N, 72.07-71.90 W
def px(lat, lon): return int((w['top'] - lat) * w['kmlat'] / w['px_km']), int((lon - w['left']) * w['kmlon'] / w['px_km'])
r0, c0 = px(41.300, -72.070); r1, c1 = px(41.215, -71.900)
zc = z[r0:r1, c0:c1]
zc2 = zc[:zc.shape[0] // 2 * 2, :zc.shape[1] // 2 * 2].reshape(zc.shape[0] // 2, 2, zc.shape[1] // 2, 2).mean(axis=(1, 3))
img(zc2, 16, 2.5).save('fr_close.jpg', quality=84, optimize=True)
json.dump(dict(world=[w['left'], w['right'], w['bottom'], w['top']], close=dict(r0=r0, c0=c0, r1=r1, c1=c1, px_km=w['px_km'] * 2,
    x0=c0 * w['px_km'], y0=r0 * w['px_km'], x1=c1 * w['px_km'], y1=r1 * w['px_km'])), open('fr_meta.json', 'w'))
import os; print(os.path.getsize('fr_world.jpg'), os.path.getsize('fr_close.jpg'), z0.shape, zc2.shape)
