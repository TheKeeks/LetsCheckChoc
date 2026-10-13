"""Offshore swell field for the 'what was the ocean doing' map: Copernicus WAVERYS (0.2 deg, 3-hourly,
2016 -> 2026-07) then the global analysis (0.083 deg) after, sampled on a 0.4 deg grid over
38-42 N, 75-66 W. Primary swell (height, mean period, direction), secondary swell (height,
direction) and wind sea (height, direction). Chunks are deleted after use to save disk.
Writes field.npz: t (ISO strings), lat, lon, and V[var] = float32 [time, lat, lon]."""
import json, sys, os, subprocess, numpy as np
sys.path.insert(0, '../pylib'); import numcodecs
B = 'https://s3.waw3-1.cloudferro.com/'
DS = {'my': 'mdl-arco-geo-032/arco/GLOBAL_MULTIYEAR_WAV_001_032/cmems_mod_glo_wav_my_0.2deg_PT3H-i_202411/geoChunked.zarr',
      'anfc': 'mdl-arco-geo-015/arco/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/geoChunked.zarr'}
VARS = ['VHM0_SW1', 'VTM01_SW1', 'VMDR_SW1', 'VHM0_SW2', 'VMDR_SW2', 'VHM0_WW', 'VMDR_WW']
LATS = np.round(np.arange(38.0, 42.01, 0.4), 2); LONS = np.round(np.arange(-75.0, -65.99, 0.4), 2)
def get(url, fn):
    """chunk bytes, or None when the store has no such chunk (all-land blocks are not written: 403/404)"""
    for i in range(6):
        r = subprocess.run(['curl', '-sS', '-m', '300', '-o', fn, '-w', '%{http_code}', url], capture_output=True, text=True)
        if r.stdout == '200' and r.returncode == 0: return open(fn, 'rb').read()
        if r.stdout in ('403', '404'): return None
    raise RuntimeError(url)
def arr(meta, name, raw):
    za = meta[name + '/.zarray']; return np.frombuffer(numcodecs.get_codec(za['compressor']).decode(raw), dtype=za['dtype'])
os.makedirs('fchunks', exist_ok=True)
res = {}
for key, ds in DS.items():
    meta = json.loads(open(f'chunks/{key}.zmeta').read())['metadata']
    lat = arr(meta, 'latitude', open(f'chunks/{key}_lat', 'rb').read()).astype(float)
    lon = arr(meta, 'longitude', open(f'chunks/{key}_lon', 'rb').read()).astype(float)
    tz = meta['time/.zarray']; nt = tz['shape'][0]; tch = tz['chunks'][0]
    t = np.concatenate([arr(meta, 'time', open(f'chunks/{key}_time{k}', 'rb').read()) for k in range(-(-nt // tch))]).astype(float)
    t0 = np.datetime64('1950-01-01T00:00') + (t * 60).astype('timedelta64[m]')
    sel = np.where((t0 >= np.datetime64('2016-01-01')) & ((t0 <= np.datetime64('2026-07-31T21:00')) if key == 'my' else (t0 > np.datetime64('2026-07-31T21:00'))))[0]
    cT, cY, cX = meta['VHM0_SW1/.zarray']['chunks']
    II = np.array([int(np.argmin(abs(lat - a))) for a in LATS]); JJ = np.array([int(np.argmin(abs(lon - b))) for b in LONS])
    blocks = sorted({(i // cY, j // cX) for i in II for j in JJ})
    ks = sorted(set(sel // cT))
    out = {v: np.full((len(sel), len(LATS), len(LONS)), np.nan, np.float32) for v in VARS}
    for n, (bi, bj) in enumerate(blocks):
        mi = [a for a, i in enumerate(II) if i // cY == bi]; mj = [b for b, j in enumerate(JJ) if j // cX == bj]
        for v in VARS:
            att = meta[v + '/.zattrs']; sc = att.get('scale_factor', 1); off = att.get('add_offset', 0); fill = meta[v + '/.zarray']['fill_value']
            done = f'fchunks/res_{key}_{v}_{bi}_{bj}.npy'                  # resume: keep each block's extract
            if os.path.exists(done): out[v][:, mi[0]:mi[-1] + 1, mj[0]:mj[-1] + 1] = np.load(done); continue
            parts = []; a = None
            for k in ks:
                fn = f'fchunks/{key}_{v}_{k}_{bi}_{bj}'
                n_k = min(cT, nt - k * cT)
                missing = False; a = None
                for attempt in range(4):                                  # a cut-off download fails to decompress: fetch again
                    raw = get(B + ds + f'/{v}/{k}.{bi}.{bj}', fn)
                    if raw is None: missing = True; break                # all-land block: not stored
                    try: a = arr(meta, v, raw).reshape(-1, cY, cX); break
                    except RuntimeError: os.remove(fn)
                if missing: parts.append(np.full((n_k, len(mi), len(mj)), fill, np.int16)); continue
                if a is None: raise RuntimeError('chunk keeps failing ' + fn)
                os.remove(fn)
                parts.append(a[:n_k, [II[q] % cY for q in mi]][:, :, [JJ[q] % cX for q in mj]])
            a = np.concatenate(parts)[sel - ks[0] * cT].astype(np.float32)
            a = np.where(a == fill, np.nan, a * sc + off)
            np.save(done, a)
            out[v][:, mi[0]:mi[-1] + 1, mj[0]:mj[-1] + 1] = a
        print(key, 'block', n + 1, '/', len(blocks), flush=True)
    res[key] = (t0[sel], out)
t = np.concatenate([res[k][0] for k in res])
V = {v: np.concatenate([res[k][1][v] for k in res]) for v in VARS}
np.savez_compressed('field.npz', t=np.array([str(x) for x in t]), lat=LATS, lon=LONS, **V)
print('DONE', len(t), str(t[0]), str(t[-1]))
