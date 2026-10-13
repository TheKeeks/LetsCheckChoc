"""16 m depth tile around Fishers, the Race and the mouth of the sound, for the 3D view.
From the 8 m survey grid (elev8.npy), 2x2 averaged. 16-bit: v = round((depth + 30) * 100), red = high byte,
green = low byte, blue 255 = water; depth < 0 is land height. Writes site/ocean/fine16.png + fine16.json."""
import json, numpy as np
from PIL import Image
W = json.load(open('world.json')); z8 = np.load('elev8.npy', mmap_mode='r')
LON0, LON1, LAT0, LAT1 = -72.12, -71.84, 41.18, 41.34
r0 = int((W['top'] - LAT1) * W['kmlat'] * 1000 / 8); r1 = int((W['top'] - LAT0) * W['kmlat'] * 1000 / 8)
c0 = int((LON0 - W['left']) * W['kmlon'] * 1000 / 8); c1 = int((LON1 - W['left']) * W['kmlon'] * 1000 / 8)
r1 -= (r1 - r0) % 2; c1 -= (c1 - c0) % 2
z = np.asarray(z8[r0:r1, c0:c1], np.float32).reshape((r1 - r0) // 2, 2, (c1 - c0) // 2, 2).mean(axis=(1, 3))
dep = -z; v = np.clip(np.round((dep + 30) * 100), 0, 65535).astype(np.uint32)
rgb = np.stack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.where(dep > 0, 255, 0).astype(np.uint8)], -1)
Image.fromarray(rgb, 'RGB').save('site/ocean/fine16.png', optimize=True)
# exact bounds of the crop (cell edges)
top = W['top'] - r0 * 8 / 1000 / W['kmlat']; left = W['left'] + c0 * 8 / 1000 / W['kmlon']
json.dump(dict(top=top, left=left, dx=16.0, rows=int(z.shape[0]), cols=int(z.shape[1]), kmlon=W['kmlon'], kmlat=W['kmlat'], off=30, scale=100), open('site/ocean/fine16.json', 'w'))
import os; print(z.shape, os.path.getsize('site/ocean/fine16.png'), float(dep.max()), float(dep.min()))
