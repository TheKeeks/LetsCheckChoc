"""Pack the model swell field into one PNG per year for the day map (site/ocean/field/YYYY.png).
Row = 3-hourly time step; each grid cell is 3 RGB pixels:
  (primary swell height dm, primary period 0.1 s (Tm01 x 1.12 ~ peak), primary from /2 deg),
  (secondary height dm, secondary from /2, wind-sea height dm), (wind-sea from /2, 0, 0); 255 = none.
RGB only (no alpha), so the browser's canvas can't alter the bytes."""
import json, os, numpy as np
from PIL import Image
F = np.load('wav/field.npz')
t = F['t']; lat = F['lat']; lon = F['lon']
def q(a, s, top=254):
    a = np.asarray(a, float); out = np.where(np.isnan(a), 255, np.clip(np.round(a * s), 0, top)); return out.astype(np.uint8)
h1 = q(F['VHM0_SW1'], 10); T1 = q(F['VTM01_SW1'] * 1.12, 10); d1 = q(np.mod(F['VMDR_SW1'], 360), 0.5, 179)
h2 = q(F['VHM0_SW2'], 10); d2 = q(np.mod(F['VMDR_SW2'], 360), 0.5, 179); hw = q(F['VHM0_WW'], 10); dw = q(np.mod(F['VMDR_WW'], 360), 0.5, 179)
z = np.zeros_like(h1)
cells = np.stack([np.stack([h1, T1, d1], -1), np.stack([h2, d2, hw], -1), np.stack([dw, z, z], -1)], axis=3)   # [t, la, lo, 3px, rgb]
nt = len(t); flat = cells.reshape(nt, len(lat) * len(lon) * 3, 3)
os.makedirs('site/ocean/field', exist_ok=True)
months = {}
tt = np.array([np.datetime64(x) for x in t])
for m in sorted({str(x)[:4] for x in t}):
    idx = np.where(np.array([str(x)[:4] == m for x in t]))[0]
    d = np.diff(tt[idx]).astype('timedelta64[h]').astype(int)
    assert (d == 3).all(), (m, set(d))
    Image.fromarray(flat[idx], 'RGB').save(f'site/ocean/field/{m}.png', optimize=True)
    months[m] = [str(t[idx[0]])[:16], int(len(idx))]
json.dump(dict(lat=[float(x) for x in lat], lon=[float(x) for x in lon], months=months), open('site/ocean/field/meta.json', 'w'))
tot = sum(os.path.getsize('site/ocean/field/' + f) for f in os.listdir('site/ocean/field'))
print(len(months), 'years', tot)
