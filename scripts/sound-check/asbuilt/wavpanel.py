"""Per-year files of the Copernicus model point series for the day panels:
site/ocean/wm/<year>.json: {"YYYY-MM-DDTHH" (UTC, 3-hourly): [sw1 ft, sw1 s, sw1 from, sw2 ft, sw2 s, sw2 from, ww ft, ww s, ww from, Choc ft]}
at 40.6 N 71.6 W (WAVERYS to 2026-07-31, then the global analysis)."""
import json, os, math, datetime as dt
import valid_blend as VB
FT = 3.28084
W = json.load(open('wav/wav_points.json'))
os.makedirs('site/ocean/wm', exist_ok=True)
by = {}
for key in ('my', 'anfc'):
    rec = W[f'{key}_40.6_-71.6']
    for i, t in enumerate(rec['t']):
        k = dt.datetime.fromisoformat(t).strftime('%Y-%m-%dT%H')
        if key == 'anfc' and k <= '2026-07-31T21': continue
        row = []; e = 0.0
        for p in ('SW1', 'SW2', 'WW'):
            h = rec['VHM0_' + p][i]; T = rec['VTM01_' + p][i]; d = rec['VMDR_' + p][i]
            if h is None or h <= 0.02: row += [None, None, None]; continue
            row += [round(h * FT, 1), round(T * 1.12, 1) if T else None, int(round(d)) % 360 if d is not None else None]
            k2 = VB.k2_at(T * 1.12, d) if (T and d is not None) else 0
            e += (h / 4) ** 2 * (k2 or 0)
        row.append(round(4 * math.sqrt(e) * FT, 1))
        by.setdefault(k[:4], {})[k] = row
for y, d in by.items(): json.dump(d, open(f'site/ocean/wm/{y}.json', 'w'), separators=(',', ':'))
print({y: len(d) for y, d in by.items()})
