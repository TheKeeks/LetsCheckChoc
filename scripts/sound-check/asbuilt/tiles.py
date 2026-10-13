"""Zoom-tile pyramid for the map from elev8.npy (8 m pixels).

Levels: L3 = 8 m, L2 = 16 m, L1 = 32 m, L0 = 64 m per pixel; 1024 px tiles.
Two layers per tile so the page can put the swell colours between them:
  w/L/x_y.jpg   sea floor as a light relief map (depth shading, hill shading, depth
                contours); land is pure white. The page multiplies it over the swell
                colours, so the sea floor shows through at every swell size.
  l/L/x_y.webp  land only (hill-shaded), transparent over water, drawn on top.
Tiles that would be empty are skipped, and L3 is only cut where the sea floor
has detail worth it (shallower than 40 m or land in the tile); the page falls back
to the parent level elsewhere. Writes tiles/manifest.json.
"""
import json, math, os, sys
import numpy as np
from PIL import Image

T = 1024
OUT = 'tiles'
world = json.load(open('world.json'))
Z8 = np.load('elev8.npy', mmap_mode='r')
H8, W8 = Z8.shape

def down(a):
    h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
    return a[:h, :w].reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3)).astype(np.float32)

CONT = np.array([2, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100])
DEP = np.array([0, 3, 8, 15, 25, 40, 60, 90, 130.]); LUM = np.array([.99, .96, .92, .87, .82, .76, .70, .64, .60])

def render(z, px_m, ve):
    """z: elevation block with a 1-px border. Returns (water RGB uint8, land RGBA uint8) without the border."""
    gy, gx = np.gradient(z * ve, px_m)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(42)
    hs = np.clip(np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect), 0, 1)
    depth = np.clip(-z, 0, None)
    lum = np.interp(depth, DEP, LUM) * np.clip(0.80 + 0.32 * (hs - 0.66) / 0.34, 0.55, 1.12)
    # depth contours: a pixel is on a line where the band index changes to its right/below neighbour
    b = np.searchsorted(CONT, depth)
    edge = np.zeros_like(b, bool); edge[:, :-1] |= b[:, :-1] != b[:, 1:]; edge[:-1, :] |= b[:-1, :] != b[1:, :]
    lum = np.where(edge & (depth > 0.5), lum * 0.86, lum)
    land = np.clip((z + 0.3) / 0.6, 0, 1)                     # soft coastline
    water = np.empty(z.shape + (3,), np.float32)
    for k, tint in enumerate((0.92, 0.97, 1.0)): water[..., k] = lum * tint
    water = water * (1 - land[..., None]) + land[..., None]   # land -> white (neutral under multiply)
    el = np.clip(z / 60, 0, 1)
    lc = np.array([46, 46, 45.]) + el[..., None] * np.array([18, 14, 8.])
    lr = lc * (0.55 + 0.75 * hs[..., None])
    rgba = np.concatenate([np.clip(lr, 0, 255), (land * 255)[..., None]], axis=-1)
    s = (slice(1, -1), slice(1, -1))
    return np.clip(water[s] * 255, 0, 255).astype(np.uint8), rgba[s].astype(np.uint8), z[s]

def cut(level, zfull, px_m, ve, l3=False):
    H, W = zfull.shape
    nx, ny = math.ceil(W / T), math.ceil(H / T)
    os.makedirs(f'{OUT}/w/{level}', exist_ok=True); os.makedirs(f'{OUT}/l/{level}', exist_ok=True)
    wl, ll = [], []
    zp = np.pad(zfull, 1, mode='edge')
    for ty in range(ny):
        for tx in range(nx):
            y0, x0 = ty * T, tx * T; y1, x1 = min(H, y0 + T), min(W, x0 + T)
            z = np.asarray(zp[y0:y1 + 2, x0:x1 + 2], np.float32)
            inner = z[1:-1, 1:-1]
            anyland, anywater = (inner > 0).any(), (inner <= 0).any()
            if l3 and not (anyland or (-inner).min() < 40): continue
            wrgb, lrgba, _ = render(z, px_m, ve)
            if anywater:
                Image.fromarray(wrgb).save(f'{OUT}/w/{level}/{tx}_{ty}.jpg', quality=82, optimize=True, progressive=True)
                wl.append(ty * nx + tx)
            if (lrgba[..., 3] > 0).any():
                Image.fromarray(lrgba, 'RGBA').save(f'{OUT}/l/{level}/{tx}_{ty}.webp', quality=80, method=5)
                ll.append(ty * nx + tx)
    print('level', level, W, H, 'tiles', nx, ny, 'water', len(wl), 'land', len(ll), file=sys.stderr)
    return dict(z=level, W=W, H=H, px_km=px_m / 1000, nx=nx, ny=ny, water=wl, land=ll)

if __name__ == '__main__':
    z3 = np.asarray(Z8, np.float32)
    z2 = down(z3); z1 = down(z2); z0 = down(z1)
    levels = [cut(0, z0, 64, 6), cut(1, z1, 32, 4), cut(2, z2, 16, 3)]
    del z0, z1, z2
    levels.append(cut(3, z3, 8, 2.5, l3=True))
    json.dump(dict(world=world, tile=T, levels=levels), open(f'{OUT}/manifest.json', 'w'), separators=(',', ':'))
    tot = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print('total MB %.1f' % (tot / 1e6), 'files', sum(len(fs) for _, _, fs in os.walk(OUT)), file=sys.stderr)
