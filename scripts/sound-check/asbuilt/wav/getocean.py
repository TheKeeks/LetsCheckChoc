"""Ocean-wide layer for the Past map: Copernicus WAVERYS (then the global analysis after July 2026), primary
swell only (height, mean period, direction), every 2 degrees over the North Atlantic (0-66 N, 98 W-8 E),
6-hourly, 2016 on. Same source and decoding as getfield.py; blocks run in parallel and resume.
Writes ocean.npz: t, lat, lon, VHM0_SW1/VTM01_SW1/VMDR_SW1 float32 [time, lat, lon]."""
import json, sys, os, subprocess, numpy as np, concurrent.futures as cf, threading
sys.path.insert(0, '../pylib'); import numcodecs
B = 'https://s3.waw3-1.cloudferro.com/'
DS = {'my': 'mdl-arco-geo-032/arco/GLOBAL_MULTIYEAR_WAV_001_032/cmems_mod_glo_wav_my_0.2deg_PT3H-i_202411/geoChunked.zarr',
      'anfc': 'mdl-arco-geo-015/arco/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/geoChunked.zarr'}
VARS = ['VHM0_SW1', 'VTM01_SW1', 'VMDR_SW1']
LATS = np.round(np.arange(0.0, 66.01, 2.0), 2); LONS = np.round(np.arange(-98.0, 8.01, 2.0), 2)
os.makedirs('ochunks', exist_ok=True)
def get(url, fn):
    for i in range(6):
        r = subprocess.run(['curl', '-sS', '-m', '300', '-o', fn, '-w', '%{http_code}', url], capture_output=True, text=True)
        if r.stdout == '200' and r.returncode == 0: return open(fn, 'rb').read()
        if r.stdout in ('403', '404'): return None
    raise RuntimeError(url)
res = {}
for key, ds in DS.items():
    meta = json.loads(open(f'chunks/{key}.zmeta').read())['metadata']
    def arr(name, raw, meta=meta):
        za = meta[name + '/.zarray']; return np.frombuffer(numcodecs.get_codec(za['compressor']).decode(raw), dtype=za['dtype'])
    lat = arr('latitude', open(f'chunks/{key}_lat', 'rb').read()).astype(float)
    lon = arr('longitude', open(f'chunks/{key}_lon', 'rb').read()).astype(float)
    tz = meta['time/.zarray']; nt = tz['shape'][0]; tch = tz['chunks'][0]
    t = np.concatenate([arr('time', open(f'chunks/{key}_time{k}', 'rb').read()) for k in range(-(-nt // tch))]).astype(float)
    t0 = np.datetime64('1950-01-01T00:00') + (t * 60).astype('timedelta64[m]')
    hr = (t0.astype('datetime64[h]').astype(int)) % 24
    sel = np.where((t0 >= np.datetime64('2016-01-01')) & (hr % 6 == 0) & ((t0 <= np.datetime64('2026-07-31T21:00')) if key == 'my' else (t0 > np.datetime64('2026-07-31T21:00'))))[0]
    cT, cY, cX = meta['VHM0_SW1/.zarray']['chunks']
    II = np.array([int(np.argmin(abs(lat - a))) for a in LATS]); JJ = np.array([int(np.argmin(abs(lon - b))) for b in LONS])
    blocks = sorted({(i // cY, j // cX) for i in II for j in JJ})
    ks = sorted(set(sel // cT))
    out = {v: np.full((len(sel), len(LATS), len(LONS)), np.nan, np.float32) for v in VARS}
    done_n = [0]; lock = threading.Lock()
    def block(bij):
        bi, bj = bij
        mi = [a for a, i in enumerate(II) if i // cY == bi]; mj = [b for b, j in enumerate(JJ) if j // cX == bj]
        for v in VARS:
            att = meta[v + '/.zattrs']; sc = att.get('scale_factor', 1); off = att.get('add_offset', 0); fill = meta[v + '/.zarray']['fill_value']
            done = f'ochunks/res_{key}_{v}_{bi}_{bj}.npy'
            if os.path.exists(done): a = np.load(done)
            else:
                parts = []
                for k in ks:
                    fn = f'ochunks/{key}_{v}_{k}_{bi}_{bj}'; n_k = min(cT, nt - k * cT); a = None; missing = False
                    for attempt in range(4):
                        raw = get(B + ds + f'/{v}/{k}.{bi}.{bj}', fn)
                        if raw is None: missing = True; break
                        try: a = arr(v, raw).reshape(-1, cY, cX); break
                        except RuntimeError: os.remove(fn)
                    if missing:
                        if v == VARS[0] and k == ks[0]:              # all-land block: skip the rest of it
                            np.save(done, np.full((len(sel), len(mi), len(mj)), np.nan, np.float32))
                            for v2 in VARS[1:]: np.save(f'ochunks/res_{key}_{v2}_{bi}_{bj}.npy', np.full((len(sel), len(mi), len(mj)), np.nan, np.float32))
                            with lock: done_n[0] += 1
                            return (mi, mj, None)
                        parts.append(np.full((n_k, len(mi), len(mj)), fill, np.int16)); continue
                    if a is None: raise RuntimeError('chunk keeps failing ' + fn)
                    os.remove(fn)
                    parts.append(a[:n_k, [II[q] % cY for q in mi]][:, :, [JJ[q] % cX for q in mj]])
                a = np.concatenate(parts)[sel - ks[0] * cT].astype(np.float32)
                a = np.where(a == fill, np.nan, a * sc + off)
                np.save(done, a)
        with lock:
            done_n[0] += 1
            if done_n[0] % 50 == 0: print(key, done_n[0], '/', len(blocks), flush=True)
        return (mi, mj, True)
    with cf.ThreadPoolExecutor(24) as ex:
        list(ex.map(block, blocks))
    for (bi, bj) in blocks:
        mi = [a for a, i in enumerate(II) if i // cY == bi]; mj = [b for b, j in enumerate(JJ) if j // cX == bj]
        for v in VARS: out[v][:, mi[0]:mi[-1] + 1, mj[0]:mj[-1] + 1] = np.load(f'ochunks/res_{key}_{v}_{bi}_{bj}.npy')
    res[key] = (t0[sel], out); print(key, 'done', len(sel), flush=True)
t = np.concatenate([res[k][0] for k in res])
V = {v: np.concatenate([res[k][1][v] for k in res]) for v in VARS}
np.savez_compressed('ocean.npz', t=np.array([str(x) for x in t]), lat=LATS, lon=LONS, **V)
print('DONE', len(t), str(t[0]), str(t[-1]))
