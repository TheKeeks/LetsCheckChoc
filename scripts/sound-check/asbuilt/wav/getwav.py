"""Copernicus WAVERYS (MFWAM reanalysis, 0.2 deg, 3-hourly) + global analysis (0.083 deg) point series
near the Choc approach, straight from the public ARCO Zarr stores (time-long chunks)."""
import json, sys, os, subprocess, numpy as np
sys.path.insert(0, '../pylib')
import numcodecs
B = 'https://s3.waw3-1.cloudferro.com/'
DS = {'my': 'mdl-arco-geo-032/arco/GLOBAL_MULTIYEAR_WAV_001_032/cmems_mod_glo_wav_my_0.2deg_PT3H-i_202411/geoChunked.zarr',
      'anfc': 'mdl-arco-geo-015/arco/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/geoChunked.zarr'}
VARS = ['VHM0', 'VTPK', 'VMDR', 'VHM0_SW1', 'VTM01_SW1', 'VMDR_SW1', 'VHM0_SW2', 'VTM01_SW2', 'VMDR_SW2', 'VHM0_WW', 'VTM01_WW', 'VMDR_WW']
def get(url, fn):
    if not os.path.exists(fn) or os.path.getsize(fn) == 0:
        for i in range(5):
            if subprocess.run(['curl', '-sS', '-f', '-m', '300', '-o', fn, url]).returncode == 0: break
    return open(fn, 'rb').read()
def arr(meta, name, raw):
    za = meta[name + '/.zarray']; codec = numcodecs.get_codec(za['compressor'])
    return np.frombuffer(codec.decode(raw), dtype=za['dtype'])
os.makedirs('chunks', exist_ok=True)
CELLS = [(40.6, -71.6), (40.8, -71.2), (40.4, -71.0)]
out = {}
for key, ds in DS.items():
    meta = json.loads(get(B + ds + '/.zmetadata', f'chunks/{key}.zmeta'))['metadata']
    lat = arr(meta, 'latitude', get(B + ds + '/latitude/0', f'chunks/{key}_lat')).astype(float)
    lon = arr(meta, 'longitude', get(B + ds + '/longitude/0', f'chunks/{key}_lon')).astype(float)
    tz = meta['time/.zarray']; nt = tz['shape'][0]; tch = tz['chunks'][0]
    t = np.concatenate([arr(meta, 'time', get(B + ds + f'/time/{k}', f'chunks/{key}_time{k}')) for k in range(-(-nt // tch))]).astype(float)
    t0 = np.datetime64('1950-01-01T00:00') + (t * 60).astype('timedelta64[m]')
    za = meta['VHM0/.zarray']; cT, cY, cX = za['chunks']
    sel = np.where(t0 >= np.datetime64('2015-12-31'))[0]
    ks = sorted(set(sel // cT))
    for (la, lo) in CELLS:
        i = int(np.argmin(abs(lat - la))); j = int(np.argmin(abs(lon - lo)))
        ci, cj, ii, jj = i // cY, j // cX, i % cY, j % cX
        rec = {'lat': float(lat[i]), 'lon': float(lon[j]), 't': [str(x) for x in t0[sel]]}
        for v in VARS:
            att = meta[v + '/.zattrs']; sc = att.get('scale_factor', 1); off = att.get('add_offset', 0)
            parts = []
            for k in ks:
                raw = get(B + ds + f'/{v}/{k}.{ci}.{cj}', f'chunks/{key}_{v}_{k}_{ci}_{cj}')
                a = arr(meta, v, raw).reshape(-1, cY, cX)[:, ii, jj]
                parts.append(a)
            a = np.concatenate(parts)[sel - ks[0] * cT].astype(float)
            a = np.where(a == meta[v + '/.zarray']['fill_value'], np.nan, a * sc + off)
            rec[v] = [None if np.isnan(x) else round(float(x), 2) for x in a]
        out[f'{key}_{la}_{lo}'] = rec
        print(key, la, lo, '->', rec['lat'], rec['lon'], len(rec['t']), rec['t'][0], rec['t'][-1], 'nan share SW1', np.mean([x is None for x in rec['VHM0_SW1']]), flush=True)
json.dump(out, open('wav_points.json', 'w'))
