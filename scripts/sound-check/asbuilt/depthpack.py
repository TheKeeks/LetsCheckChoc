"""Depth grids for the in-browser ray tracer (opening animation).
atl.dat : ETOPO 2022 30" (35-42 N, 76-63 W), rows north->south, uint8
world.dat: the 8 m survey mosaic averaged to 64 m over the page's world box, rows north->south, uint8
Encoding: uint16, 0 = land, else depth x scale (8-bit was too coarse: its depth steps bent rays on the gentle shelf). Both gzip-compressed."""
import json, gzip, math, numpy as np
def enc(h, land, scale):
    """uint16 little-endian: 0 = land, else depth * scale (scale 100 = cm, 10 = dm), at least 1"""
    v = np.clip(np.round(h * scale), 1, 65535)
    return np.where(land, 0, v).astype('<u2')
from PIL import Image
def png16(v, fn):
    # 16-bit depth split over red (high byte) and green (low byte) of an ordinary 8-bit PNG
    v = v.astype(np.uint16); rgb = np.dstack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.zeros(v.shape, np.uint8)])
    Image.fromarray(rgb, 'RGB').save(fn, optimize=True)
A = np.load('atl/etopo30.npz'); za = A['z'][::-1].astype(float)          # north at the top
ha = np.clip(-za, 0, None); a8 = enc(ha, ha < 1, 10)
png16(a8, 'site/ocean/atl_depth.png')
w = json.load(open('world.json')); z8 = np.load('elev8.npy', mmap_mode='r')
z = np.asarray(z8, np.float32); z = z[:z.shape[0] // 8 * 8, :z.shape[1] // 8 * 8].reshape(z.shape[0] // 8, 8, z.shape[1] // 8, 8).mean(axis=(1, 3))
hw = np.clip(-z, 0, None); w8 = enc(hw, hw < 0.5, 100)
png16(w8, 'site/ocean/world_depth.png')
meta = dict(atl=dict(rows=a8.shape[0], cols=a8.shape[1], north=float(A['lat'][-1]), west=float(A['lon'][0]), dlat=float(A['lat'][1] - A['lat'][0]), dlon=float(A['lon'][1] - A['lon'][0]), scale=10),
            world=dict(rows=w8.shape[0], cols=w8.shape[1], dx=64.0, top=w['top'], left=w['left'], kmlon=w['kmlon'], kmlat=w['kmlat'], scale=100))
json.dump(meta, open('site/ocean/depth_meta.json', 'w'))
import os; print(meta, os.path.getsize('site/ocean/atl_depth.png'), os.path.getsize('site/ocean/world_depth.png'), hw.max())
