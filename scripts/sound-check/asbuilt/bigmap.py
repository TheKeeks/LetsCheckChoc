"""One seamless elevation grid for the whole map, at 8 m pixels.

World: 40.60-41.50 N, 72.40-70.85 W (Montauk buoy 44017 to Point Judith, Orient to the
buoy 44097 and past it). Pixels are square in km using the same projection as the page:
x = (lon - left) * 111.32 cos(41.05 deg) km, y = (top - lat) * 110.95 km.

Sources, coarse to fine (finer wins wherever it has data):
  ETOPO 2022 15" (about 460 m)      deep-water corner south-east of the buoy
  NOAA CUDEM 1/3" (about 10 m)      offshore and Rhode Island
  NOAA CUDEM 1/9" (about 3 m)       Long Island, Fishers, Block Island Sound, RI shore
Writes elev8.npy (float32 metres, positive up) and world.json.
"""
import glob, json, math, sys
import numpy as np, tifffile
from scipy.ndimage import map_coordinates

TOP, BOT, LEFT, RIGHT = 41.50, 40.60, -72.40, -70.85
LATM = (TOP + BOT) / 2
KMLON, KMLAT = 111.32 * math.cos(math.radians(LATM)), 110.95
PX_KM = 0.008
H = int(round((TOP - BOT) * KMLAT / PX_KM)); W = int(round((RIGHT - LEFT) * KMLON / PX_KM))
dlat = (TOP - BOT) / H; dlon = (RIGHT - LEFT) / W
print('world', W, 'x', H, file=sys.stderr)
z = np.full((H, W), np.nan, np.float32)
lat_c = TOP - (np.arange(H) + 0.5) * dlat
lon_c = LEFT + (np.arange(W) + 0.5) * dlon

def paint(src, lat_hi, lon_lo, res):
    """Bilinear-sample a north-up grid (top-left corner lat_hi, lon_lo, cell res deg) into z."""
    sh = src.shape
    lat_lo, lon_hi = lat_hi - sh[0] * res, lon_lo + sh[1] * res
    rr = np.where((lat_c < lat_hi) & (lat_c > lat_lo))[0]; cc = np.where((lon_c > lon_lo) & (lon_c < lon_hi))[0]
    if not len(rr) or not len(cc): return 0
    fr = (lat_hi - lat_c[rr]) / res - 0.5; fc = (lon_c[cc] - lon_lo) / res - 0.5
    for r0 in range(0, len(rr), 1024):
        R = rr[r0:r0 + 1024]; FR = fr[r0:r0 + 1024]
        g0, g1 = np.meshgrid(FR, fc, indexing='ij')
        v = map_coordinates(src, [g0.ravel(), g1.ravel()], order=1, mode='nearest', cval=np.nan).reshape(len(R), len(cc))
        blk = z[R[0]:R[-1] + 1, cc[0]:cc[-1] + 1]
        np.copyto(blk, v, where=~np.isnan(v))
    return len(rr) * len(cc)

# ETOPO 15"
e = np.loadtxt('bathy/etopo15.csv', delimiter=',', skiprows=2)
la = np.unique(e[:, 0]); lo = np.unique(e[:, 1]); res15 = 15 / 3600
grid = np.full((len(la), len(lo)), np.nan, np.float32)
grid[np.searchsorted(la, e[:, 0]), np.searchsorted(lo, e[:, 1])] = e[:, 2]
grid = grid[::-1]                                       # north-up
paint(grid, la.max() + res15 / 2, lo.min() - res15 / 2, res15)
print('etopo done', file=sys.stderr)

def block_mean(a, k):
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    b = a[:h, :w].reshape(h // k, k, w // k, k)
    with np.errstate(invalid='ignore'), __import__('warnings').catch_warnings():
        __import__('warnings').simplefilter('ignore')
        return np.nanmean(b, axis=(1, 3)).astype(np.float32)

tiles = []
for f in sorted(glob.glob('bathy/ncei1*.tif')):
    with tifffile.TiffFile(f) as t:
        p = t.pages[0]; tp = p.tags['ModelTiepointTag'].value; sc = p.tags['ModelPixelScaleTag'].value
        tiles.append(dict(f=f, lon0=tp[3], lat0=tp[4], res=sc[0], ninth='ncei19' in f))
for t in sorted(tiles, key=lambda t: t['ninth']):
    a = tifffile.imread(t['f']).astype(np.float32); a[a < -9000] = np.nan
    res = t['res']
    if t['ninth']: a = block_mean(a, 2); res *= 2         # 3 m -> 6 m, then bilinear to 8 m
    n = paint(a, t['lat0'], t['lon0'], res)
    print(t['f'], 'px', n, file=sys.stderr)
    del a
miss = np.isnan(z).mean()
print('missing %.5f' % miss, 'range', np.nanmin(z), np.nanmax(z), file=sys.stderr)
if miss: z[np.isnan(z)] = -30.0
np.save('elev8.npy', z)
json.dump(dict(top=TOP, bottom=BOT, left=LEFT, right=RIGHT, latm=LATM, kmlon=KMLON, kmlat=KMLAT, px_km=PX_KM, W=W, H=H),
          open('world.json', 'w'), indent=1)
