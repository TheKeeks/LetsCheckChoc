"""Hour-by-hour swell trains for the 'what was the ocean doing' panels.
Block Island (CDIP 154 = 44097, netCDF) and the NDBC buoys 44017 (Montauk, to Feb 2023) and
44025 (Long Island) from their yearly spectral text files. Same split as trains.py: humps in the
energy-vs-frequency curve, merged when they come from about the same direction.
For Block Island each train also gets its modeled share at Choc (forward-ray table).
Writes site/ocean/tr/<station>_<year>.json: {"YYYY-MM-DDTHH" (UTC): [[ft, Tp s, from deg, Choc ft]...]}"""
import json, gzip, math, os, glob, datetime as dt
import numpy as np
import trains as TR
FT = 3.28084; UTC = dt.timezone.utc
os.makedirs('site/ocean/tr', exist_ok=True)

def save(st, H, choc):
    by = {}
    for tt, trs in H:
        k = dt.datetime.fromtimestamp(tt - tt % 3600, UTC) if choc else dt.datetime.fromtimestamp(tt + 1800 - (tt + 1800) % 3600, UTC)   # NDBC logs at :40 -> nearest hour
        by.setdefault(k.year, {})[k.strftime('%Y-%m-%dT%H')] = [[round(x[0], 1), round(x[1], 1), int(round(x[2])) % 360] + ([round(x[3], 1)] if choc else []) for x in trs[:4]]
    for y, d in by.items(): json.dump(d, open(f'site/ocean/tr/{st}_{y}.json', 'w'), separators=(',', ':'))
    return {y: len(d) for y, d in by.items()}

# Block Island: trains.run already returns (t, trains with Choc / Wilderness heights)
t0 = int(dt.datetime(2015, 12, 31, tzinfo=UTC).timestamp())
a = TR.run('spec/154p1_historic.nc', t0); b = TR.run('spec/154p1_rt.nc', a[-1][0] + 1)
print('44097', save('44097', a + b, True))

def read(fn):
    rows = {}
    with gzip.open(fn, 'rt') as f:
        hdr = f.readline().split(); fr = np.array([float(x) for x in hdr[5:]])
        for line in f:
            if line.startswith('#'): continue
            p = line.split()
            if len(p) < 6: continue
            y, mo, d, h, mi = (int(x) for x in p[:5])
            rows[dt.datetime(y, mo, d, h, mi, tzinfo=UTC)] = np.array([float(x) for x in p[5:]])
    return fr, rows

def ndbc(st):
    H = []
    for wf in sorted(glob.glob(f'ndbc2/{st}w20??.txt.gz')):
        y = wf[-11:-7]
        try:
            fr, W = read(wf); _, D = read(f'ndbc2/{st}d{y}.txt.gz'); _, R1 = read(f'ndbc2/{st}j{y}.txt.gz')
        except FileNotFoundError: continue
        bw = np.gradient(fr)
        fm = (fr >= 0.04) & (fr <= 0.35)
        for t, e in sorted(W.items()):
            if t not in D or t not in R1: continue
            al = D[t]; r1 = R1[t]
            if len(al) != len(fr) or len(r1) != len(fr): continue
            r1 = np.where(r1 > 1.5, r1 / 100, r1); ok = (al < 999) & (r1 < 9) & (e < 999)
            if ok[fm].mean() < 0.8: continue
            e = np.where(ok, e, 0.0); al = np.where(ok, al, 0); r1 = np.where(ok, r1, 0)
            a1 = r1 * np.cos(np.radians(al)); b1 = r1 * np.sin(np.radians(al))
            E, A1, B1, BW, F = e[fm], a1[fm], b1[fm], bw[fm], fr[fm]
            if (E * BW).sum() <= 0: continue
            trs = []
            for ix in TR.partition(E, A1, B1, BW):
                en = E[ix] * BW[ix]
                d = (math.degrees(math.atan2((B1[ix] * en).sum(), (A1[ix] * en).sum())) + 360) % 360
                trs.append((4 * math.sqrt(en.sum()) * FT, 1 / F[ix[np.argmax(E[ix])]], d))
            trs.sort(key=lambda x: -x[0])
            H.append((int(t.timestamp()), trs))
    return H
for st in ('44017', '44025'):
    print(st, save(st, ndbc(st), False))
