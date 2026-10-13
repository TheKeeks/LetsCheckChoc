"""One wave's trip: single rays from the deep Atlantic to landfall, for the opening animation.

Deep leg: ETOPO 2022 at 30" (about 0.9 km) from 35-42 N, 76-63 W. Ray equations on the sphere
(heading clockwise from north): the ray bends toward slower water, plus the small great-circle
term. Near leg: once the ray enters the 8 m survey map it is handed to the same 48 m forward-ray
tracer that Part 1 uses (fwdprod2.run), so the last 20-100 km match the page's model exactly.

Two kinds of rays:
  aim    - for each period and incoming direction at the map edge, the forward ray that passes
           closest to the Choc pin (or the Wilderness shoreline), traced BACKWARD from where it
           entered the map out to 2,500 m of water. Played forward, it's a wave that started out
           there and ends on the reef. The ray equations run the same both ways.
  random - start somewhere out past the 2,500 m line, aim roughly at Fishers (+-10 deg), trace
           forward, and see where it lands.

Writes ocean/aim_<spot>_<T>.json, ocean/random.json and ocean/meta.json; points are
[lon*1e4, lat*1e4, depth m, minutes since start] (time at group speed: how fast the energy moves).
Usage: python3 ocean.py
"""
import json, math, os, random
import numpy as np
import fwdprod2 as FP

RE = 6371000.0; G = 9.81
A = np.load('atl/etopo30.npz'); LAT = A['lat']; LON = A['lon']; Z = A['z'].astype(np.float64)
LAT0, DLAT = LAT[0], LAT[1] - LAT[0]; LON0, DLON = LON[0], LON[1] - LON[0]
NR, NC = Z.shape
HC = np.clip(-Z, 0, None)
W = FP.world

def disp(T, h):
    L0 = G * T * T / (2 * math.pi); h = np.maximum(h, 0.5)
    L = L0 * np.tanh((2 * math.pi * np.sqrt(h / G) / T) ** 1.5) ** (2 / 3)
    k = 2 * math.pi / L; c = L / T; kh = np.minimum(k * h, 20)
    return c, 0.5 * (1 + 2 * kh / np.sinh(2 * kh)) * c

_cf = {}
def coarse(T):
    if T in _cf: return _cf[T]
    c, _ = disp(T, HC); wet = HC > 1
    cs = FP.blur(np.where(wet, c, c[wet].min()), 1)
    gn, ge = np.gradient(cs)                                   # per row (north), per column (east)
    gn = gn / (math.radians(DLAT) * RE)
    ge = ge / (math.radians(DLON) * RE * np.cos(np.radians(LAT))[:, None])
    _cf[T] = (cs, ge, gn); return _cf[T]

def bil(a, fi, fj):
    i = int(fi); j = int(fj); di = fi - i; dj = fj - j
    return (a[i, j] * (1 - di) * (1 - dj) + a[i + 1, j] * di * (1 - dj) + a[i, j + 1] * (1 - di) * dj + a[i + 1, j + 1] * di * dj)

def depth_at(lat, lon):
    fi = (lat - LAT0) / DLAT; fj = (lon - LON0) / DLON
    if not (0 <= fi < NR - 1 and 0 <= fj < NC - 1): return None
    return bil(HC, fi, fj)

def in_world(lat, lon, inset=0.004):
    return W['bottom'] + inset < lat < W['top'] - inset and W['left'] + inset < lon < W['right'] - inset
def to_world(lat, lon): return (lon - W['left']) * W['kmlon'] * 1000, (W['top'] - lat) * W['kmlat'] * 1000
def from_world(x, y): return W['top'] - y / 1000 / W['kmlat'], W['left'] + x / 1000 / W['kmlon']

def trace(T, lat, lon, th, stop, ds=400.0, nmax=6000):
    """march a ray on the sphere; stop(lat, lon, depth, dist) -> reason or None"""
    cs, ge, gn = coarse(T); pts = [(lat, lon)]; dist = 0.0
    for _ in range(nmax):
        fi = (lat - LAT0) / DLAT; fj = (lon - LON0) / DLON
        if not (0 <= fi < NR - 1 and 0 <= fj < NC - 1): return pts, 'edge'
        h = HC[int(round(fi)), int(round(fj))]
        if h < 1: return pts, 'land'
        r = stop(lat, lon, h, dist)
        if r: return pts, r
        c = bil(cs, fi, fj); ce = bil(ge, fi, fj); cn = bil(gn, fi, fj)
        st, ct = math.sin(th), math.cos(th); phi = math.radians(lat)
        th += ds * (-(ce * ct - cn * st) / c + st * math.tan(phi) / RE)
        lat += math.degrees(ds * math.cos(th) / RE); lon += math.degrees(ds * math.sin(th) / (RE * math.cos(phi)))
        dist += ds; pts.append((lat, lon))
    return pts, 'max'

_ff = {}
def fine(T):
    if T not in _ff: _ff[T] = FP.fields(T)
    return _ff[T]
def fine_run(T, x, y, phi):
    Fd = fine(T)
    mC, mW, _, _, paths = FP.run(Fd, np.array([x]), np.array([y]), phi, record_every=4)
    return [from_world(px, py) for px, py in paths[0]], float(mC[0]), float(mW[0])

def fine_depth(lat, lon):
    x, y = to_world(lat, lon); r = int(y / FP.dx); c = int(x / FP.dx)
    if 0 <= r < FP.R and 0 <= c < FP.C: return float(FP.h[r, c])
    return None

def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dl = math.radians(b[1] - a[1])
    return 2 * RE * math.asin(math.sqrt(math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))
def bearing(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dl = math.radians(b[1] - a[1])
    return math.atan2(math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))
def dest(a, br, d):
    p1, l1 = math.radians(a[0]), math.radians(a[1]); dr = d / RE
    p2 = math.asin(math.sin(p1) * math.cos(dr) + math.cos(p1) * math.sin(dr) * math.cos(br))
    l2 = l1 + math.atan2(math.sin(br) * math.sin(dr) * math.cos(p1), math.cos(dr) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), math.degrees(l2)

PLACES = [("Montauk Point", 41.071, -71.857), ("Ditch Plains, Montauk", 41.038, -71.92), ("Amagansett", 40.97, -72.13),
          ("Southampton", 40.86, -72.40), ("Shinnecock", 40.84, -72.48), ("Westhampton", 40.80, -72.64), ("Fire Island", 40.65, -73.10),
          ("Long Beach, NY", 40.58, -73.66), ("New Jersey", 40.10, -74.03), ("Block Island", 41.17, -71.58), ("Watch Hill", 41.31, -71.86),
          ("Napatree Point", 41.305, -71.885), ("Misquamicut", 41.32, -71.80), ("Charlestown, RI", 41.36, -71.65),
          ("Point Judith", 41.36, -71.48), ("Narragansett", 41.43, -71.45), ("Newport", 41.46, -71.33), ("Sakonnet Point", 41.46, -71.19),
          ("Cuttyhunk", 41.42, -70.93), ("Martha's Vineyard", 41.35, -70.70), ("Nomans Land", 41.25, -70.81), ("Nantucket", 41.25, -70.05),
          ("Cape Cod", 41.65, -69.95), ("Plum Island", 41.18, -72.19), ("Great Gull Island", 41.20, -72.12),
          ("Gardiners Island", 41.10, -72.10), ("Orient Point", 41.16, -72.24), ("Stonington", 41.33, -71.90)]
def place(lat, lon, mC, mW, T, how):
    if mC < FP.r_eff(T, FP.RC): return 'Choc'
    if mW < FP.r_eff(T, FP.RW): return 'Wilderness'
    if 41.235 < lat < 41.305 and -72.07 < lon < -71.90:
        return 'Fishers Island, %.1f km from Choc' % (hav((lat, lon), (41.27591, -71.96359)) / 1000)
    if how == 'edge' and lon < -72.3 and lat > 40.95: return 'on up Long Island Sound'
    if how == 'edge': return 'off the edge of the map'
    best = min(PLACES, key=lambda p: hav((lat, lon), (p[1], p[2])))
    d = hav((lat, lon), (best[1], best[2])) / 1000
    return best[0] if d < 6 else 'near ' + best[0]

def pack(T, pts):
    """[lon e4, lat e4, depth m, minutes] with depth from the finest source and time at group speed"""
    out = []; t = 0.0; prev = None
    for lat, lon in pts:
        h = fine_depth(lat, lon) if in_world(lat, lon, 0) else None
        if h is None: h = depth_at(lat, lon) or 0.0
        if prev is not None:
            _, cg = disp(T, np.array(max(h, 0.5))); t += hav(prev, (lat, lon)) / float(cg)
        prev = (lat, lon)
        out.append([round(lon * 1e4), round(lat * 1e4), int(round(h)), int(round(t / 60))])
    # thin the deep leg (straight lines) so files stay small; keep every point near the coast
    keep = [0]
    for i in range(1, len(out) - 1):
        if out[i][2] < 120 or i - keep[-1] >= (6 if out[i][2] < 1000 else 12): keep.append(i)
    keep.append(len(out) - 1)
    return [v for i in keep for v in out[i]]

def deep_stop(lat, lon, h, dist): return 'deep' if (h >= 2500 and dist > 60000) or dist > 900000 else None

def aim(spot, T, D, pre=None):
    X, Y, phi0 = FP.crest(D); Fd = fine(T)
    mC, mW, _, _, _ = pre or FP.run(Fd, X.copy(), Y.copy(), phi0)
    m = mC if spot == 'c' else mW; r = FP.r_eff(T, FP.RC if spot == 'c' else FP.RW)
    for i in np.argsort(m)[:12]:
        if m[i] >= r: break
        lat, lon = from_world(X[i], Y[i])
        back, why = trace(T, lat, lon, math.radians(D), deep_stop)
        if why != 'deep': continue
        near, fmC, fmW = fine_run(T, X[i], Y[i], phi0)
        pts = back[::-1] + near[1:]
        o = back[-1]; th_o = bearing(back[-1], back[-2])          # travel heading at the start
        return dict(T=T, D=D, spot=spot, miss=int(m[i]), dfrom=round((math.degrees(th_o) + 180) % 360, 1),
                    km=round(sum(hav(pts[k], pts[k + 1]) for k in range(len(pts) - 1)) / 1000), land=place(*near[-1], fmC, fmW, T, 'land'),
                    p=pack(T, pts))
    return None

def rand_ray(rng, T):
    fish = (41.27, -71.96)
    for _ in range(50):
        b = math.radians(rng.uniform(95, 215)); d = 30000
        while d < 1200000:
            p = dest(fish, b, d); h = depth_at(*p)
            if h is None or h >= 2500: break
            d += 5000
        if h is None: continue
        p = dest(fish, b, d + rng.uniform(0, 200000))
        if depth_at(*p) is None or depth_at(*p) < 2500: continue
        th = bearing(p, fish) + math.radians(rng.uniform(-10, 10))
        def stop(lat, lon, h, dist): return 'world' if in_world(lat, lon) and fine_depth(lat, lon) and fine_depth(lat, lon) > 0.5 else None
        pts, why = trace(T, p[0], p[1], th, stop, nmax=8000)
        if why == 'world':
            x, y = to_world(*pts[-1]); thl = th_at(pts)
            near, fmC, fmW = fine_run(T, x, y, math.atan2(-math.cos(thl), math.sin(thl)))
            end = near[-1]; how = 'edge' if not in_world(*end, 0.01) else 'land'
            pts = pts + near[1:]; land = place(*end, fmC, fmW, T, how)
        elif why == 'land':
            land = place(*pts[-1], 1e9, 1e9, T, 'land')
        else: continue
        return dict(T=T, D=round((math.degrees(bearing(pts[0], pts[1])) + 180) % 360, 1), spot='r', land=land,
                    km=round(sum(hav(pts[k], pts[k + 1]) for k in range(len(pts) - 1)) / 1000), p=pack(T, pts))
    return None
def th_at(pts): return bearing(pts[-2], pts[-1])

if __name__ == '__main__':
    import sys
    os.makedirs('ocean', exist_ok=True)
    if len(sys.argv) > 1:                                  # one period: python3 ocean.py <T>
        T = int(sys.argv[1]); out = {'c': [], 'w': []}
        for D in range(90, 225, 5):
            X, Y, phi0 = FP.crest(D); pre = FP.run(fine(T), X.copy(), Y.copy(), phi0)
            for spot in 'cw':
                r = aim(spot, T, D, pre)
                if r: out[spot].append(r); print(spot, T, D, r['miss'], r['dfrom'], r['km'], r['land'], len(r['p']) // 4, flush=True)
        for spot in 'cw': json.dump(out[spot], open(f'ocean/aim_{spot}_{T}.json', 'w'), separators=(',', ':'))
        print('DONE', flush=True); sys.exit()
    idx = {}
    for T in (8, 10, 12, 14, 16):
        for spot in 'cw': idx[f'{spot}{T}'] = [r['D'] for r in json.load(open(f'ocean/aim_{spot}_{T}.json'))]
    rng = random.Random(7); R = []
    for k in range(90):
        T = rng.choice((8, 10, 12, 14, 16)); r = rand_ray(rng, T)
        if r: R.append(r); print('rand', T, r['D'], r['km'], r['land'], flush=True)
    json.dump(R, open('ocean/random.json', 'w'), separators=(',', ':'))
    json.dump(dict(aim=idx), open('ocean/meta.json', 'w'))
    print('DONE')
