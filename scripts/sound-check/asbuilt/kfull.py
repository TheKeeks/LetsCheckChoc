"""Full-resolution (144 m) K fields, one grayscale PNG per (period, direction): K x 100.
Single-direction ray density keeps the refraction streaks visible on the map."""
import os, json, numpy as np
from PIL import Image
import raymodel2 as m
os.makedirs('kfull', exist_ok=True)
for T in m.PERS:
    for D in m.DIRS:
        K, _ = m.trace(D, T)
        Image.fromarray(np.clip(K * 100, 0, 255).astype(np.uint8)).save(f'kfull/{T}_{D}.png', optimize=True)
v = np.clip(np.round(m.z * 10 + 10000), 0, 65535).astype(np.uint32)
Image.fromarray(np.stack([(v >> 8), v & 255, np.zeros_like(v)], -1).astype(np.uint8)).save('depth144.png')
print('MB', sum(os.path.getsize('kfull/' + f) for f in os.listdir('kfull')) / 1e6)
