"""Data for the spot-drawing tool: imagery as JPEG, merged depth grid (2023 NOAA lidar 1 m where it
has bottom returns, else the 8 m CUDEM mosaic), depth contours (GeoJSON-ish), depth grid PNG for tap readout."""
import json, math, os, sys
import numpy as np, rasterio
from PIL import Image
from pyproj import Transformer
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
os.chdir(os.path.dirname(os.path.abspath(__file__)))
R = 6378137.0
meta = json.load(open('img/meta.json'))
os.makedirs('out/img', exist_ok=True)
YEARS = ['2001', '2004', '2007', '2010', '2013', '2016', 'NAIP_2019', '2020', '2023']
# imagery -> jpeg
for a in meta:
    for y in YEARS:
        o = f'out/img/{a}_{y}.jpg'
        if os.path.exists(o): continue
        im = Image.open(f'img/{a}_{y}.png').convert('RGB')
        im.save(o, quality=74, optimize=True, progressive=True)
        print(o, os.path.getsize(o), flush=True)
# depth
lid = rasterio.open('../hires/ngs2023_lis_dem_10274/2023_750000e_4575000n_dem.tif')
L = lid.read(1); Lnd = lid.nodata
to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:6347', always_xy=True)
w = json.load(open('../world.json')); z8 = np.load('../elev8.npy', mmap_mode='r')
out = {}
for a in ('choc', 'wild'):
    m = meta[a]; res = 2.0 / math.cos(math.radians(41.26))       # 2 m on the ground, in mercator metres
    W = int((m['x1'] - m['x0']) / res); H = int((m['y1'] - m['y0']) / res)
    xs = m['x0'] + (np.arange(W) + 0.5) * res; ys = m['y1'] - (np.arange(H) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    lon = np.degrees(X / R); lat = np.degrees(np.arctan(np.sinh(Y / R)))
    ux, uy = to_utm.transform(lon, lat)
    # lidar: 3x3 mean of 1 m cells around each 2 m sample (ignoring voids)
    c = ((ux - lid.bounds.left) / 1.0).astype(int); r = ((lid.bounds.top - uy) / 1.0).astype(int)
    acc = np.zeros_like(lon); n = np.zeros_like(lon)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            rr = np.clip(r + dr, 0, L.shape[0] - 1); cc = np.clip(c + dc, 0, L.shape[1] - 1)
            v = L[rr, cc]; ok = (v != Lnd) & (v > -100) & (r + dr >= 0) & (r + dr < L.shape[0]) & (c + dc >= 0) & (c + dc < L.shape[1])
            acc += np.where(ok, v, 0); n += ok
    zl = np.where(n > 0, acc / np.maximum(n, 1), np.nan)
    # CUDEM 8 m elsewhere
    pr = ((w['top'] - lat) * w['kmlat'] / 0.008).astype(int); pc = ((lon - w['left']) * w['kmlon'] / 0.008).astype(int)
    zc = np.asarray(z8[pr.min():pr.max() + 1, pc.min():pc.max() + 1], np.float32)[pr - pr.min(), pc - pc.min()]
    src = np.where(np.isnan(zl), 0, 1).astype(np.uint8)          # 1 = lidar, 0 = CUDEM
    z = np.where(np.isnan(zl), zc, zl)
    # smooth a touch for clean contours
    from scipy.ndimage import gaussian_filter
    zs = gaussian_filter(z, 1.0)
    fig = plt.figure()
    levels = [0, -1, -2, -3, -4, -5, -6, -8, -10, -12, -15, -20]
    cs = plt.contour(xs, ys, zs, levels=sorted(levels))
    cont = {}
    for lev, segs in zip(cs.levels, cs.allsegs):
        lines = []
        for s in segs:
            if len(s) < 6: continue
            ll = [[round(float(np.degrees(math.atan(math.sinh(p[1] / R)))), 6), round(float(np.degrees(p[0] / R)), 6)] for p in s[::2]]
            lines.append(ll)
        cont[str(int(-lev))] = lines
    plt.close(fig)
    # depth grid PNG: depth (m below NAVD88) * 50 as 16 bit in R,G; B = 255 if lidar else 0; A = 255 water/land
    d = np.clip((-z) * 50 + 2000, 0, 65535).astype(np.uint16)          # offset so land (negative depth) still encodes
    rgba = np.dstack([(d >> 8).astype(np.uint8), (d & 255).astype(np.uint8), src * 255, np.full_like(src, 255)])
    Image.fromarray(rgba, 'RGBA').save(f'out/depth_{a}.png', optimize=True)
    lidfrac = float(src[z < 0].mean())
    out[a] = dict(x0=m['x0'], y0=m['y0'], x1=m['x1'], y1=m['y1'], W=W, H=H, lidar_share=round(lidfrac, 3))
    json.dump(cont, open(f'out/contours_{a}.json', 'w'), separators=(',', ':'))
    print(a, W, H, 'lidar share of water', round(lidfrac, 3), os.path.getsize(f'out/contours_{a}.json'), os.path.getsize(f'out/depth_{a}.png'), flush=True)
json.dump(dict(img=meta, depth=out, years=YEARS), open('out/meta.json', 'w'), indent=1)
