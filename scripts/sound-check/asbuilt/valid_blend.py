"""Surf-log test: does a model picture of the offshore swell beat the Block Island buoy alone?

Inputs (hourly modeled Choc height, then each logged session's best 3 hours, ranked against
the size and overall ratings in the surf log):
  buoy     - current model: CDIP 154 / NDBC 44097 directional spectrum x forward-ray table
  model    - Copernicus WAVERYS (MFWAM reanalysis, 0.2 deg, 3-hourly; global analysis after
             2026-07) swell partitions at one offshore cell: primary swell, secondary swell,
             wind sea, each spread over period (+-15 %) and direction (cos^2s) and run through
             the same forward-ray table
  blend    - model trains rescaled every hour so their total matches the buoy's measured
             height: the buoy sets the size, the model splits it into trains and directions
  mean     - average of buoy and model Choc heights
Usage: python3 valid_blend.py [cell-key]
"""
import json, math, csv, sys, datetime as dt
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc; FT = 3.28084
tab = json.load(open('fwd2_table_s1.json'))
TS = list(range(5, 18)); DS = [50 + 2.5 * i for i in range(77)]
K2 = np.array([[tab[str(T)][f'{D:g}'][2] for D in DS] for T in TS])
full = np.zeros((len(TS), 144))
for j, D in enumerate(DS): full[:, int(D / 2.5) % 144] = K2[:, j]
TH = np.arange(0, 360, 2.5) + 1.25

def k2_at(T, d):
    """fraction of offshore energy reaching Choc for one train: period T (s), mean direction d (from)"""
    if T is None or d is None: return None
    # spread over period (+-15 %) and direction (cos^2s, s = 15 for swell)
    tot = 0.0
    for f, w in ((0.85, 0.25), (1.0, 0.5), (1.15, 0.25)):
        TT = min(max(T * f, TS[0]), TS[-1]); j = min(int(TT - TS[0]), len(TS) - 2); a = TT - TS[0] - j
        row = full[j] * (1 - a) + full[j + 1] * a
        dd = np.radians(TH - d); D = np.cos(dd / 2) ** 2; D = D ** 15; D /= D.sum()
        tot += w * float((D * row).sum())
    return tot

def model_hourly(rec, tp_fac=1.12):
    """modeled Choc height (ft) and total offshore height (ft) per hour, from 3-hourly partitions"""
    out = {}
    for i, t in enumerate(rec['t']):
        e_spot = 0.0; e_off = 0.0; ok = False
        for p, sp in (('SW1', 15), ('SW2', 15), ('WW', 4)):
            h = rec['VHM0_' + p][i]; T = rec['VTM01_' + p][i]; d = rec['VMDR_' + p][i]
            if h is None or h <= 0: continue           # no such train this hour
            ok = True; m0 = (h / 4) ** 2; e_off += m0
            k = k2_at(T * tp_fac, d) if T else 0.0
            e_spot += m0 * (k or 0.0)
        if not ok: continue
        k = dt.datetime.fromisoformat(t).strftime('%Y-%m-%dT%H')
        out[k] = [4 * math.sqrt(e_off) * FT, 4 * math.sqrt(e_spot) * FT]
    # fill the hours between 3-hourly steps
    keys = sorted(out); res = {}
    for a, b in zip(keys, keys[1:]):
        ta = dt.datetime.strptime(a, '%Y-%m-%dT%H'); tb = dt.datetime.strptime(b, '%Y-%m-%dT%H'); n = int((tb - ta).total_seconds() // 3600)
        if n > 6: res[a] = out[a]; continue
        for s in range(n):
            f = s / n; res[(ta + dt.timedelta(hours=s)).strftime('%Y-%m-%dT%H')] = [out[a][q] * (1 - f) + out[b][q] * f for q in (0, 1)]
    res[keys[-1]] = out[keys[-1]]
    return res

def spearman(x, y):
    rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return float(np.corrcoef(rx, ry)[0, 1])

def best3(src, day, idx=1):
    v = []
    for hr in range(24):
        k = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H')
        v.append(src[k][idx] if k in src else None)
    best = None
    for i in range(22):
        w = [x for x in v[i:i + 3] if x is not None]
        if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
    return best

if __name__ == '__main__':
    W = json.load(open('wav/wav_points.json'))
    cells = sorted({k.split('_', 1)[1] for k in W})
    buoy = json.load(open('spec_choc.json'))                 # hour -> [buoy ft, Choc ft]
    rows = list(csv.DictReader(open('surflog.csv')))
    days = sorted({dt.datetime.fromisoformat(r['date']).date() for r in rows})
    res = {}
    for cell in cells:
        m = {}
        for key in ('my', 'anfc'):
            if f'{key}_{cell}' in W: m.update({k: v for k, v in model_hourly(W[f'{key}_{cell}']).items() if key == 'my' or k > '2026-07-31T21'})
        blend = {}
        for k, (ho, hs) in m.items():
            if k in buoy and ho > 0.05: blend[k] = [buoy[k][0], hs * buoy[k][0] / ho]
        mean = {k: [0, (buoy[k][1] + m[k][1]) / 2] for k in m if k in buoy}
        # offshore height agreement (model total vs buoy total), all hours
        common = [k for k in m if k in buoy]
        bh = np.array([buoy[k][0] for k in common]); mh = np.array([m[k][0] for k in common])
        P = []
        for r in rows:
            d = dt.datetime.fromisoformat(r['date']).date()
            vals = [best3(s, d) for s in (buoy, m, blend, mean)]
            if None not in vals: P.append(vals + [float(r['size']), float(r['avg'])])
        P = np.array(P)
        rng = np.random.default_rng(1)
        out = {'cell': cell, 'n': len(P), 'offshore_bias_ft': round(float(np.median(mh - bh)), 2), 'offshore_r': round(float(np.corrcoef(bh, mh)[0, 1]), 3), 'hours': len(common)}
        for j, name in enumerate(('buoy', 'model', 'blend', 'mean')):
            rs = spearman(P[:, j], P[:, 4]); ra = spearman(P[:, j], P[:, 5])
            bs = [spearman(P[i, j], P[i, 4]) for i in (rng.integers(0, len(P), len(P)) for _ in range(2000))]
            out[name] = dict(size=round(rs, 2), avg=round(ra, 2), size95=[round(float(x), 2) for x in np.percentile(bs, [2.5, 97.5])])
        # paired: how often does each beat the buoy on bootstrap resamples
        for j, name in ((1, 'model'), (2, 'blend'), (3, 'mean')):
            wins = 0
            for _ in range(2000):
                i = rng.integers(0, len(P), len(P))
                wins += spearman(P[i, j], P[i, 4]) > spearman(P[i, 0], P[i, 4])
            out[name]['beats_buoy_share'] = round(wins / 2000, 2)
        res[cell] = out
        print(json.dumps(out))
        if cell == '40.8_-71.2':
            json.dump({k: [round(v[0], 2), round(v[1], 2)] for k, v in m.items()}, open('wavspec_choc.json', 'w'))
            json.dump({k: [round(v[0], 2), round(v[1], 2)] for k, v in blend.items()}, open('blendspec_choc.json', 'w'))
    json.dump(res, open('valid_blend.json', 'w'), indent=1)
