"""Forecast pull for Chocomount: two wave models, cropped to what the page shows, tied to Choc with the
forward-ray model.

  GFS-Wave (NOAA, Atlantic grid 0.16 deg, hourly to 120 h then 3-hourly): total sea, three swell trains and
    wind sea, each with height, period and direction.  Source: noaa-gfs-bdp-pds on AWS (public).
  ECMWF IFS wave (open data, 0.25 deg, 3-hourly to 144 h, 6-hourly after): total sea height, mean direction,
    peak period, plus significant height in long-period bands (10-12, 12-14, 14-17, 17-21, 21-25, 25-30 s).
    No direction per train.  Source: data.ecmwf.int (CC-BY 4.0).

Tie to Choc: each model's swell trains are read at buoy 44097 (CDIP 154, 40.969 N 71.127 W), the same point
the ten-year history reads, then run through the same per-direction, per-period ray response the rest of
the page uses. A test against 177 hours in 2021-25 (fctest.py, archived GFS-Wave runs) found this closer to
what arrived than the earlier edge-weighted version: typical miss 0.20 ft vs 0.30 ft a day ahead, with less
bias. Where the model has no value at the buoy, the mean over a 5x5 block of points around it is used.

Usage: python3 scripts/forecast/fcpull.py OUTDIR   -> OUTDIR/fc.json, OUTDIR/field_<model>_<grid>.png

Run every few hours by .github/workflows/update-forecast.yml, which publishes the output to the fc-data branch;
the Sound Check page reads it from there (research/fc/ holds the copy that ships with the page). Inputs: world.json
(the survey map's bounds) and fwdk.json (each spot's response by period and direction) next to this file, and the
page's forward-ray tables in research/fr/.
"""
import json, math, sys, os, datetime as dt, urllib.request, concurrent.futures as cf
import numpy as np
import eccodes
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FR_DIR = os.path.join(HERE, '..', '..', 'research', 'fr')             # the page's forward-ray tables
FT = 3.28084
STEPS = list(range(0, 145, 3)) + list(range(150, 169, 6))           # hours ahead, both models
GRIDS = {'reg': dict(lat=(35.0, 45.5), lon=(-77.5, -62.0), d=0.25),     # New Jersey to Cape Cod and out past the shelf
         'ocean': dict(lat=(-5.0, 70.0), lon=(-100.0, 10.0), d=1.0)}     # the whole North Atlantic, so the ocean view fills any screen

def get(url, a=None, b=None, tries=4):
    for k in range(tries):
        try:
            rq = urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}'} if a is not None else {})
            return urllib.request.urlopen(rq, timeout=90).read()
        except Exception as e:
            if k == tries - 1: raise
            import time; time.sleep(2 * (k + 1))

def jload(p):
    with open(p) as f: return json.load(f)

def decode(msg):
    g = eccodes.codes_new_from_message(msg)
    ni, nj = eccodes.codes_get(g, 'Ni'), eccodes.codes_get(g, 'Nj')
    la0, lo0 = eccodes.codes_get(g, 'latitudeOfFirstGridPointInDegrees'), eccodes.codes_get(g, 'longitudeOfFirstGridPointInDegrees')
    dl = eccodes.codes_get(g, 'iDirectionIncrementInDegrees'); dj = eccodes.codes_get(g, 'jDirectionIncrementInDegrees')
    v = eccodes.codes_get_values(g).reshape(nj, ni).astype(np.float32); miss = eccodes.codes_get(g, 'missingValue')
    eccodes.codes_release(g)
    v[v >= miss * 0.99] = np.nan
    return dict(v=v, la0=la0, lo0=((lo0 + 180) % 360) - 180, dl=dl, dj=dj, ni=ni, nj=nj)

def sample(f, lat, lon):
    """bilinear sample (lat, lon arrays) of a decoded field; north-first rows, west-first columns; NaN-aware"""
    lon = np.asarray(lon, float); lat = np.asarray(lat, float)
    fj = ((lon - f['lo0']) % 360) / f['dl']; fi = (f['la0'] - lat) / f['dj']
    i0 = np.clip(np.floor(fi).astype(int), 0, f['nj'] - 2); j0 = np.floor(fj).astype(int) % f['ni']; j1 = (j0 + 1) % f['ni']
    a, b = fi - i0, fj - np.floor(fj)
    v = f['v']; q = [v[i0, j0], v[i0, j1], v[i0 + 1, j0], v[i0 + 1, j1]]; w = [(1 - a) * (1 - b), (1 - a) * b, a * (1 - b), a * b]
    num = sum(np.where(np.isnan(x), 0, x) * ww for x, ww in zip(q, w)); den = sum(np.where(np.isnan(x), 0, ww) for x, ww in zip(q, w))
    return np.where(den > 0.25, num / np.maximum(den, 1e-9), np.nan)

def sample_dir(f, lat, lon):
    """directions: average as unit vectors"""
    s = dict(f, v=np.sin(np.radians(f['v']))); c = dict(f, v=np.cos(np.radians(f['v'])))
    return (np.degrees(np.arctan2(sample(s, lat, lon), sample(c, lat, lon))) + 360) % 360

# ── which runs
def latest_gfs():
    now = dt.datetime.now(dt.timezone.utc)
    for h in range(0, 48, 6):
        t = now - dt.timedelta(hours=h); c = t.replace(hour=t.hour // 6 * 6, minute=0, second=0, microsecond=0)
        u = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{c:%Y%m%d}/{c:%H}/wave/gridded/gfswave.t{c:%H}z.atlocn.0p16.f{STEPS[-1]:03d}.grib2.idx"
        try: get(u, tries=1); return c
        except Exception: pass
    raise SystemExit('no complete GFS-Wave run found')
def latest_ec():
    now = dt.datetime.now(dt.timezone.utc)
    for h in range(0, 48, 12):
        t = now - dt.timedelta(hours=h); c = t.replace(hour=t.hour // 12 * 12, minute=0, second=0, microsecond=0)
        u = f"https://data.ecmwf.int/forecasts/{c:%Y%m%d}/{c:%H}z/ifs/0p25/wave/{c:%Y%m%d%H}0000-{STEPS[-1]}h-wave-fc.index"
        try: get(u, tries=1); return c
        except Exception: pass
    raise SystemExit('no complete ECMWF wave run found')

GFS_VARS = {'hs': 'HTSGW:surface', 'w1h': 'SWELL:1 in sequence', 'w1t': 'SWPER:1 in sequence', 'w1d': 'SWDIR:1 in sequence',
            'w2h': 'SWELL:2 in sequence', 'w2t': 'SWPER:2 in sequence', 'w2d': 'SWDIR:2 in sequence',
            'w3h': 'SWELL:3 in sequence', 'w3t': 'SWPER:3 in sequence', 'w3d': 'SWDIR:3 in sequence',
            'wwh': 'WVHGT:surface', 'wwt': 'WVPER:surface', 'wwd': 'WVDIR:surface', 'wind': 'WIND:surface', 'wdir': 'WDIR:surface'}
EC_VARS = ['swh', 'mwd', 'pp1d', 'h1012', 'h1214', 'h1417', 'h1721', 'h2125', 'h2530']

def gfs_step(c, s):
    u = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{c:%Y%m%d}/{c:%H}/wave/gridded/gfswave.t{c:%H}z.atlocn.0p16.f{s:03d}.grib2"
    idx = get(u + '.idx').decode().splitlines(); offs = [int(l.split(':')[1]) for l in idx]
    out = {}
    for k, name in GFS_VARS.items():
        i = next(n for n, l in enumerate(idx) if (':'.join(l.split(':')[3:5])) == name)
        out[k] = decode(get(u, offs[i], (offs[i + 1] - 1) if i + 1 < len(offs) else ''))
    return s, out
GLOB_VARS = {'hs': 'HTSGW:surface', 'w1h': 'SWELL:1 in sequence', 'w1t': 'SWPER:1 in sequence', 'w1d': 'SWDIR:1 in sequence',
             'w2h': 'SWELL:2 in sequence', 'w2t': 'SWPER:2 in sequence', 'w2d': 'SWDIR:2 in sequence',
             'w3h': 'SWELL:3 in sequence', 'w3t': 'SWPER:3 in sequence', 'w3d': 'SWDIR:3 in sequence', 'wwt': 'WVPER:surface', 'wwd': 'WVDIR:surface'}
def gfs_glob_step(c, s):
    # the 0.16 deg Atlantic grid is a coastal nest (it only has data near the US coast); the open
    # ocean on the maps comes from the same run's global 0.25 deg grid
    u = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{c:%Y%m%d}/{c:%H}/wave/gridded/gfswave.t{c:%H}z.global.0p25.f{s:03d}.grib2"
    idx = get(u + '.idx').decode().splitlines(); offs = [int(l.split(':')[1]) for l in idx]
    out = {}
    for k, name in GLOB_VARS.items():
        i = next(n for n, l in enumerate(idx) if (':'.join(l.split(':')[3:5])) == name)
        out[k] = decode(get(u, offs[i], (offs[i + 1] - 1) if i + 1 < len(offs) else ''))
    return s, out
def ec_step(c, s):
    base = f"https://data.ecmwf.int/forecasts/{c:%Y%m%d}/{c:%H}z/ifs/0p25/wave/{c:%Y%m%d%H}0000-{s}h-wave-fc"
    idx = [json.loads(l) for l in get(base + '.index').decode().splitlines()]
    out = {}
    for k in EC_VARS:
        e = next(x for x in idx if x['param'] == k)
        out[k] = decode(get(base + '.grib2', e['_offset'], e['_offset'] + e['_length'] - 1))
    return s, out

# ── the survey map's open edges, and which part of each feeds Choc / Wilderness (Part 1's rays)
W = jload(os.path.join(HERE, 'world.json'))
WKM, HKM = (W['right'] - W['left']) * W['kmlon'], (W['top'] - W['bottom']) * W['kmlat']
EDGE = [(W['bottom'], lo) for lo in np.arange(W['left'] + 0.1, W['right'], 0.2)] + [(la, W['right']) for la in np.arange(W['bottom'] + 0.1, W['top'] - 0.25, 0.2)]
EDGE = [(round(float(a), 3), round(float(b), 3)) for a, b in EDGE]
def edge_pos(lat, lon):          # distance along the open edge, west->east along the south edge then up the east edge (km)
    if lat <= W['bottom'] + 0.02: return (lon - W['left']) * W['kmlon']
    if lon >= W['right'] - 0.02: return WKM + (lat - W['bottom']) * W['kmlat']
    return -1.0                  # the west edge (south of Long Island): counted with the first south point
EPOS = np.array([edge_pos(a, b) for a, b in EDGE])
_fr = {}
def landers(T, D, spot):
    """edge-point weights (sum 1) for rays of period T from direction D that land at the spot"""
    Te = int(min(16, max(6, round(T / 2) * 2))); De = str(int(round(D / 5) * 5))
    if Te not in _fr:
        p = os.path.join(FR_DIR, f'{Te}.json'); _fr[Te] = jload(p) if os.path.exists(p) else {}
    rays = (_fr[Te].get(De) or {}).get('rays', [])
    pos = []
    for r in rays:
        if (spot == 'choc' and 'c' in r['h']) or (spot == 'wild' and 'w' in r['h']):
            x, y = r['p'][0] / 100, r['p'][1] / 100
            lat, lon = W['top'] - y / W['kmlat'], W['left'] + x / W['kmlon']
            pos.append(max(0.0, edge_pos(lat, lon)))
    w = np.zeros(len(EDGE))
    if not pos: return None
    for p in pos: w[int(np.argmin(np.abs(EPOS - p)))] += 1
    return w / w.sum()

BK = jload(os.path.join(HERE, 'fwdk.json'))
def kfactor(T, D, s, spot):
    """energy share reaching the spot for one train (the page's trainFactor squared)"""
    P, R = BK[spot]['periods'], BK[spot]['R']; t = min(P[-1], max(P[0], T)); j = 0
    while j < len(P) - 2 and t > P[j + 1]: j += 1
    w = (t - P[j]) / (P[j + 1] - P[j]); K = np.array(R[j]) * (1 - w) + np.array(R[j + 1]) * w
    i = np.arange(360) + 0.5; Dd = np.cos(np.radians(i - D) / 2) ** 2; Dd = Dd ** s; Dd /= Dd.sum()
    return float((Dd * K).sum() / math.radians(1))
SPREAD = {'w1': 15, 'w2': 10, 'w3': 10, 'ww': 3, 'ec': 4}

BUOY = (40.969, -71.127)
NLAT = np.array([BUOY[0] + 0.16 * i for i in range(-2, 3) for j in range(-2, 3)]); NLON = np.array([BUOY[1] + 0.16 * j for i in range(-2, 3) for j in range(-2, 3)])
def at_buoy(fh, fT, fD):
    """(h m, T s, D deg) of one train at the buoy; the 5x5 block around it if the buoy point has no value"""
    h = sample(fh, np.array([BUOY[0]]), np.array([BUOY[1]]))[0]; T = sample(fT, np.array([BUOY[0]]), np.array([BUOY[1]]))[0]; D = sample_dir(fD, np.array([BUOY[0]]), np.array([BUOY[1]]))[0]
    if not (np.isnan(h) or np.isnan(T) or np.isnan(D)): return float(h), float(T), float(D)
    h = sample(fh, NLAT, NLON); T = sample(fT, NLAT, NLON); D = sample_dir(fD, NLAT, NLON); ok = ~(np.isnan(h) | np.isnan(T) | np.isnan(D))
    if not ok.any(): return None
    e = h[ok] ** 2
    return (float(math.sqrt(e.mean())), float((e * T[ok]).sum() / max(e.sum(), 1e-9)),
            float((np.degrees(np.arctan2((e * np.sin(np.radians(D[ok]))).sum(), (e * np.cos(np.radians(D[ok]))).sum())) + 360) % 360))
def train_ft(h, T, D, key, spot):
    """one train's height at the spot, ft"""
    return h * math.sqrt(kfactor(T, D, SPREAD[key], spot)) * FT

def spot_height(trains_at_edge, spot):
    """trains_at_edge: list of (key, h[m] array over EDGE, T array, D array). Returns ft and per-train ft."""
    tot = 0.0; per = []
    for key, h, T, D in trains_at_edge:
        ok = ~(np.isnan(h) | np.isnan(T) | np.isnan(D))
        if not ok.any(): per.append(0.0); continue
        # representative period and direction for the lander lookup: energy-weighted over the edge
        e = np.where(ok, h, 0) ** 2; Tm = float((e * np.nan_to_num(T)).sum() / max(e.sum(), 1e-9))
        Dm = float((np.degrees(np.arctan2((e * np.sin(np.radians(np.nan_to_num(D)))).sum(), (e * np.cos(np.radians(np.nan_to_num(D)))).sum())) + 360) % 360)
        wts = landers(Tm, Dm, spot)
        if wts is None: wts = np.ones(len(EDGE)) / len(EDGE)
        en = 0.0
        for i in range(len(EDGE)):
            if ok[i] and wts[i] > 0: en += wts[i] * h[i] ** 2 * kfactor(T[i], D[i], SPREAD[key[:2] if key != 'ec' else 'ec'], spot)
        if not ok[wts > 0].any():                                    # no data at the feeding points: fall back to the edge mean
            en = float(np.nanmean(np.where(ok, h, np.nan)) ** 2 * kfactor(Tm, Dm, SPREAD[key[:2] if key != 'ec' else 'ec'], spot))
        tot += en; per.append(math.sqrt(en) * FT)
    return math.sqrt(tot) * FT, per

def grid_axes(g):
    G = GRIDS[g]; la = np.round(np.arange(G['lat'][1], G['lat'][0] - 1e-6, -G['d']), 3); lo = np.round(np.arange(G['lon'][0], G['lon'][1] + 1e-6, G['d']), 3)
    return la, lo

def q8(a, s, top=254):
    return np.where(np.isnan(a), 255, np.clip(np.round(a * s), 0, top)).astype(np.uint8)

def main(OUT):
    os.makedirs(OUT, exist_ok=True)
    cg, ce = latest_gfs(), latest_ec()
    print('GFS-Wave', cg, 'ECMWF', ce, flush=True)
    with cf.ThreadPoolExecutor(8) as ex:
        G = dict(ex.map(lambda s: gfs_step(cg, s), STEPS)); print('gfs done', flush=True)
        GG = dict(ex.map(lambda s: gfs_glob_step(cg, s), STEPS)); print('gfs global done', flush=True)
        E = dict(ex.map(lambda s: ec_step(ce, s), STEPS)); print('ec done', flush=True)
    elat = np.array([p[0] for p in EDGE]); elon = np.array([p[1] for p in EDGE])
    t0g, t0e = cg, ce
    times = sorted({t0g + dt.timedelta(hours=s) for s in STEPS} & {t0e + dt.timedelta(hours=s) for s in STEPS} | {t0g + dt.timedelta(hours=s) for s in STEPS})
    series = {'gfs': [], 'ec': []}
    for s in STEPS:
        f = G[s]
        # each train at the buoy, and what it brings to each spot
        trains = []; ec2 = {'choc': 0.0, 'wild': 0.0}
        for k in ('w1', 'w2', 'w3', 'ww'):
            q = at_buoy(f[k + 'h'], f[k + 't'], f[k + 'd'])
            if q is None or q[0] < 0.05: continue
            h, T, D = q; a, b = train_ft(h, T, D, k, 'choc'), train_ft(h, T, D, k, 'wild'); ec2['choc'] += a * a; ec2['wild'] += b * b
            trains.append(dict(k=k, ft=round(h * FT, 1), T=round(T, 1), D=int(round(D)) % 360, choc=round(a, 1), wild=round(b, 1)))
        c, w = math.sqrt(ec2['choc']), math.sqrt(ec2['wild'])
        wspd = float(sample(f['wind'], np.array([41.276]), np.array([-71.963]))[0]) * 1.94384
        wdir = float(sample_dir(f['wdir'], np.array([41.276]), np.array([-71.963]))[0])
        series['gfs'].append(dict(t=(t0g + dt.timedelta(hours=s)).strftime('%Y-%m-%dT%H:%MZ'), choc=round(c, 1), wild=round(w, 1), trains=trains,
                                  hs=round(float(sample(f['hs'], np.array([BUOY[0]]), np.array([BUOY[1]]))[0]) * FT, 1), wind=[round(wspd), int(round(wdir))]))
        fe = E[s]
        q = at_buoy(fe['swh'], fe['pp1d'], fe['mwd'])         # ECMWF: total sea at the buoy (no per-train directions)
        h, T, D = q if q else (float('nan'),) * 3
        c = train_ft(h, T, D, 'ec', 'choc') if q else float('nan'); w = train_ft(h, T, D, 'ec', 'wild') if q else float('nan')
        lp = math.sqrt(sum(float(np.nan_to_num(sample(fe[b], NLAT, NLON)).mean()) ** 2 for b in ('h1214', 'h1417', 'h1721', 'h2125', 'h2530')))
        series['ec'].append(dict(t=(t0e + dt.timedelta(hours=s)).strftime('%Y-%m-%dT%H:%MZ'), choc=round(c, 1) if q else None, wild=round(w, 1) if q else None,
                                 hs=round(h * FT, 1) if q else None, T=round(T, 1) if q else None, D=int(round(D)) % 360 if q else None, long=round(lp * FT, 1)))
    # ── field images: one PNG per model per grid; row = step, each cell = 1 RGB pixel (height dm, period 0.1 s, from /2 deg)
    meta = {}
    for g in GRIDS:
        la, lo = grid_axes(g); LA, LO = np.meshgrid(la, lo, indexing='ij')
        for model, F, hk, tk, dk in (('gfs', G, 'hs', 'w1t', 'w1d'), ('ec', E, 'swh', 'pp1d', 'mwd')):
            rows = []
            for s in STEPS:
                f = F[s]; hv = sample(f[hk], LA.ravel(), LO.ravel()); tv = sample(f[tk], LA.ravel(), LO.ravel()); dv = sample_dir(f[dk], LA.ravel(), LO.ravel())
                if model == 'gfs':                                   # outside the coastal nest: the global grid
                    gg = GG[s]; miss = np.isnan(hv) | np.isnan(tv) | np.isnan(dv)
                    hv = np.where(miss, sample(gg['hs'], LA.ravel(), LO.ravel()), hv); tv = np.where(miss, sample(gg['w1t'], LA.ravel(), LO.ravel()), tv)
                    dv = np.where(miss, sample_dir(gg['w1d'], LA.ravel(), LO.ravel()), dv)
                    # a cell with a wave height but no swell partition (only wind sea there): use the wind sea's
                    # period and direction, so the cell still has a direction instead of reading as no data
                    for src in (f, gg):
                        nod = ~np.isnan(hv) & (np.isnan(tv) | np.isnan(dv))
                        if not nod.any(): break
                        tv = np.where(nod, sample(src['wwt'], LA.ravel(), LO.ravel()), tv); dv = np.where(nod, sample_dir(src['wwd'], LA.ravel(), LO.ravel()), dv)
                rows.append(np.stack([q8(hv, 10), q8(tv, 10), q8(dv, 0.5, 179)], -1))
            Image.fromarray(np.stack(rows), 'RGB').save(os.path.join(OUT, f'field_{model}_{g}.png'), optimize=True)
            if model == 'gfs':                                       # every swell train, for the "headed our way" dots: 3 pixels per cell
                rows = []
                for s in STEPS:
                    f, gg = F[s], GG[s]; px = []
                    for k in ('w1', 'w2', 'w3'):
                        hv = sample(f[k + 'h'], LA.ravel(), LO.ravel()); tv = sample(f[k + 't'], LA.ravel(), LO.ravel()); dv = sample_dir(f[k + 'd'], LA.ravel(), LO.ravel())
                        miss = np.isnan(hv) | np.isnan(tv) | np.isnan(dv)
                        hv = np.where(miss, sample(gg[k + 'h'], LA.ravel(), LO.ravel()), hv); tv = np.where(miss, sample(gg[k + 't'], LA.ravel(), LO.ravel()), tv)
                        dv = np.where(miss, sample_dir(gg[k + 'd'], LA.ravel(), LO.ravel()), dv)
                        px.append(np.stack([q8(hv, 10), q8(tv, 10), q8(dv, 0.5, 179)], -1))
                    rows.append(np.stack(px, 1).reshape(-1, 3))
                Image.fromarray(np.stack(rows), 'RGB').save(os.path.join(OUT, f'field_gfs_{g}_sw.png'), optimize=True)
        meta[g] = dict(lat=[float(la[0]), float(la[-1]), GRIDS[g]['d'], len(la)], lon=[float(lo[0]), float(lo[-1]), GRIDS[g]['d'], len(lo)])
    fc = dict(made=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), runs=dict(gfs=t0g.strftime('%Y-%m-%dT%HZ'), ec=t0e.strftime('%Y-%m-%dT%HZ')),
              steps=STEPS, buoy=BUOY, grids=meta, gfs=series['gfs'], ec=series['ec'])
    with open(os.path.join(OUT, 'fc.json'), 'w') as f: json.dump(fc, f, separators=(',', ':'))
    print('wrote', OUT, 'steps', len(STEPS), 'peak Choc gfs', max(x['choc'] for x in series['gfs']), 'ec', max(x['choc'] for x in series['ec']))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'fc')
