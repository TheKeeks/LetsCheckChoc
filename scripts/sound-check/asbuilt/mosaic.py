"""Mosaic NOAA CUDEM tiles into map rasters for the Choc animation.

For each frame: a shaded-relief colour JPEG (the 2D map / 3D texture base) and a
16-bit heightmap PNG (R = high byte, G = low byte of (elev_m * 10 + 10000)).
"""
import glob, json, sys
import numpy as np, tifffile
from PIL import Image

FRAMES = {
    # name: lat_top, lat_bottom, lon_left, lon_right, res (arc-seconds)
    'sound': (41.40, 40.80, -72.12, -71.50, 1.5),
    'wide':  (41.43, 40.75, -72.12, -71.00, 4.0),
}

def tiles():
    out = []
    for f in sorted(glob.glob('bathy/ncei1*.tif')):
        with tifffile.TiffFile(f) as t:
            p = t.pages[0]
            tp = p.tags['ModelTiepointTag'].value; sc = p.tags['ModelPixelScaleTag'].value
            out.append(dict(f=f, lon0=tp[3], lat0=tp[4], res=sc[0], shape=p.shape, ninth='ncei19' in f))
    return out

def block_mean(a, k):
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    b = a[:h, :w].reshape(h // k, k, w // k, k)
    with np.errstate(invalid='ignore'):
        return np.nanmean(b, axis=(1, 3))

def build(name):
    top, bot, left, right, res_s = FRAMES[name]
    res = res_s / 3600
    rows, cols = int(round((top - bot) / res)), int(round((right - left) / res))
    z = np.full((rows, cols), np.nan, np.float32)
    lat_c = top - (np.arange(rows) + 0.5) * res
    lon_c = left + (np.arange(cols) + 0.5) * res
    # paint 1/3" tiles first, then 1/9" on top (finer wins where both exist)
    for t in sorted(tiles(), key=lambda t: t['ninth']):
        lat_hi, lon_lo = t['lat0'], t['lon0']
        lat_lo = lat_hi - t['shape'][0] * t['res']; lon_hi = lon_lo + t['shape'][1] * t['res']
        if lat_lo > top or lat_hi < bot or lon_lo > right or lon_hi < left: continue
        a = tifffile.imread(t['f']).astype(np.float32)
        a[a < -9000] = np.nan
        k = max(1, int(round(res / t['res'])))
        a = block_mean(a, k); r2 = t['res'] * k
        ri = ((lat_hi - lat_c) / r2).astype(int); ci = ((lon_c - lon_lo) / r2).astype(int)
        rm = (ri >= 0) & (ri < a.shape[0]); cm = (ci >= 0) & (ci < a.shape[1])
        sub = a[np.ix_(ri[rm], ci[cm])]
        tgt = z[np.ix_(np.where(rm)[0], np.where(cm)[0])]
        z[np.ix_(np.where(rm)[0], np.where(cm)[0])] = np.where(np.isnan(sub), tgt, sub)
        print(name, t['f'], 'k', k, file=sys.stderr)
    miss = np.isnan(z).mean()
    print(name, 'grid', z.shape, 'missing %.4f' % miss, 'range', np.nanmin(z), np.nanmax(z), file=sys.stderr)
    # fill small holes with nearest valid along rows then columns
    if miss:
        for _ in range(2):
            for arr in (z, z.T):
                for r in range(arr.shape[0]):
                    row = arr[r]; m = np.isnan(row)
                    if m.all() or not m.any(): continue
                    idx = np.where(~m, np.arange(len(row)), 0); np.maximum.accumulate(idx, out=idx)
                    row[m] = row[idx[m]]
        z[np.isnan(z)] = -40
    return z, dict(top=top, bottom=bot, left=left, right=right, rows=rows, cols=cols)

def shade(z, res_deg, lat_mid, exag):
    dx = res_deg * 111320 * np.cos(np.radians(lat_mid)); dy = res_deg * 110950
    gy, gx = np.gradient(z * exag, dy, dx)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(42)
    s = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    return np.clip(s, 0, 1)

def colour(z, res_deg, lat_mid):
    land = z > 0.3
    s_sea = shade(np.minimum(z, 0), res_deg, lat_mid, 6.0)
    s_land = shade(np.maximum(z, 0), res_deg, lat_mid, 3.0)
    depth = np.clip(-z, 0, None)
    t = np.sqrt(np.clip(depth / 70.0, 0, 1))[..., None]          # 0 shallow .. 1 deep
    shallow = np.array([30, 74, 92], np.float32); deep = np.array([5, 12, 22], np.float32)
    sea = shallow * (1 - t) + deep * t
    sea = sea * (0.55 + 0.75 * s_sea[..., None])
    hi = np.clip(z / 40.0, 0, 1)[..., None]
    lo_land = np.array([52, 50, 46], np.float32); hi_land = np.array([92, 86, 76], np.float32)
    landc = (lo_land * (1 - hi) + hi_land * hi) * (0.45 + 0.85 * s_land[..., None])
    rgb = np.where(land[..., None], landc, sea)
    # thin bright shoreline
    edge = land ^ np.roll(land, 1, 0) | land ^ np.roll(land, 1, 1)
    rgb[edge] = rgb[edge] * 0.4 + np.array([150, 160, 150]) * 0.6
    return np.clip(rgb, 0, 255).astype(np.uint8)

meta = {}
for name in FRAMES:
    z, m = build(name)
    res_deg = FRAMES[name][4] / 3600; lat_mid = (m['top'] + m['bottom']) / 2
    Image.fromarray(colour(z, res_deg, lat_mid)).save(f'map_{name}.jpg', quality=82)
    # heightmap at half resolution for the 3D mesh and land mask
    zh = z[::2, ::2]
    enc = np.clip(np.round(zh * 10 + 10000), 0, 65535).astype(np.uint16)
    rgb = np.zeros(enc.shape + (3,), np.uint8); rgb[..., 0] = enc >> 8; rgb[..., 1] = enc & 255
    Image.fromarray(rgb).save(f'height_{name}.png', optimize=True)
    m['hrows'], m['hcols'] = zh.shape
    meta[name] = m
json.dump(meta, open('map_meta.json', 'w'), indent=1)
print(json.dumps(meta))
