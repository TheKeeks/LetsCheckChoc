"""Pack the ocean-wide past layer (wav/ocean.npz from wav/getocean.py) into one PNG per year:
site/ocean/field/ocean/YYYY.png, row = 6-hourly step, one RGB pixel per cell (primary swell height dm,
period 0.1 s (Tm01 x 1.12 ~ peak), from /2 deg); 255 = land. Plus site/ocean/field/ocean_meta.json."""
import json, os, numpy as np
from PIL import Image
F = np.load('wav/ocean.npz')
t = F['t']; lat = F['lat']; lon = F['lon']
def q(a, s, top=254):
    a = np.asarray(a, float); out = np.where(np.isnan(a), 255, np.clip(np.round(a * s), 0, top)); return out.astype(np.uint8)
h = q(F['VHM0_SW1'], 10); T = q(F['VTM01_SW1'] * 1.12, 10); d = q(np.mod(F['VMDR_SW1'], 360), 0.5, 179)
land = (h == 255) | (T == 255) | (d == 255); h[land] = T[land] = d[land] = 255
cells = np.stack([h, T, d], -1).reshape(len(t), len(lat) * len(lon), 3)
os.makedirs('site/ocean/field/ocean', exist_ok=True)
tt = np.array([np.datetime64(x) for x in t]); months = {}
for y in sorted({str(x)[:4] for x in t}):
    idx = np.where(np.array([str(x)[:4] == y for x in t]))[0]
    dd = np.diff(tt[idx]).astype('timedelta64[h]').astype(int); assert (dd == 6).all(), (y, set(dd))
    Image.fromarray(cells[idx], 'RGB').save(f'site/ocean/field/ocean/{y}.png', optimize=True)
    months[y] = [str(t[idx[0]])[:16], int(len(idx))]
json.dump(dict(lat=[float(x) for x in lat], lon=[float(x) for x in lon], step_h=6, months=months), open('site/ocean/field/ocean_meta.json', 'w'))
tot = sum(os.path.getsize('site/ocean/field/ocean/' + f) for f in os.listdir('site/ocean/field/ocean'))
print(len(months), 'years', tot)
