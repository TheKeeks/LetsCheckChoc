"""Each logged session at its own hour: the buoy spectrum split into swell trains (trains.py's partition),
each train's share of Choc's modeled energy (forward-ray model, as in the 0.85 check), and how much of Choc's
energy came from outside the 115-158 deg window."""
import sys, csv, math, datetime as dt
import numpy as np
sys.argv = ['x']
import valid_fwd2 as V2
from trains import partition
from scipy.io import netcdf_file
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); FT = 3.28084
TH = np.arange(0, 360, 2.5) + 1.25; WIN = (TH >= 115) & (TH <= 158)
F = {fn: netcdf_file(fn, 'r', mmap=True) for fn in ('spec/154p1_rt.nc', 'spec/154p1_historic.nc')}
def comp(d): return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][round(d / 22.5) % 16]
def at(when):
    t = int(dt.datetime.fromisoformat(when).replace(tzinfo=ET).timestamp())
    for f in F.values():
        V = f.variables; tt = V['waveTime'][:].astype(np.int64); ok = np.where(V['waveFlagPrimary'][:] == 1)[0]
        i = ok[np.argmin(np.abs(tt[ok] - t))]
        if abs(int(tt[i]) - t) <= 3600: return V, i
    return None, None
out = []
for r in sorted(csv.DictReader(open('surflog.csv')), key=lambda r: r['date']):
    V, i = at(r['date'][:16])
    fr = V['waveFrequency'][:].astype(float); bw = V['waveBandwidth'][:].astype(float); fm = (fr >= 0.04) & (fr <= 0.35)
    E = V['waveEnergyDensity'][i][fm].astype(float); a1 = V['waveA1Value'][i][fm].astype(float); b1 = V['waveB1Value'][i][fm].astype(float); bwm = bw[fm]
    th1 = np.arctan2(b1, a1); r1 = np.clip(np.hypot(a1, b1), 0.05, 0.985); s = np.clip(r1 / (1 - r1), 0.5, 60)
    Dd = np.cos((np.radians(TH)[None, :] - th1[:, None]) / 2) ** 2; Dd = Dd ** s[:, None]; Dd /= Dd.sum(axis=1, keepdims=True)
    KF = V2.for_freq(V2.FG['choc'], fr[fm]); fac = (Dd * KF).sum(axis=1)
    ec = (E * bwm)[:, None] * Dd * KF; outside = 1 - ec[:, WIN].sum() / ec.sum()
    trs = []
    for ix in partition(E, a1, b1, bwm):
        e = E[ix] * bwm[ix]; d = (math.degrees(math.atan2((b1[ix] * e).sum(), (a1[ix] * e).sum())) + 360) % 360
        trs.append(dict(ft=4 * math.sqrt(e.sum()) * FT, T=1 / fr[fm][ix[np.argmax(E[ix])]], d=d, choc2=(e * fac[ix]).sum()))
    tot = sum(t['choc2'] for t in trs)
    for t in trs: t['share'] = t['choc2'] / tot; t['choc'] = 4 * math.sqrt(t['choc2']) * FT
    trs.sort(key=lambda t: -t['ft'])
    prim = trs[0]; sec = [t for t in trs[1:] if t['share'] >= 0.10]
    out_win = not (115 <= prim['d'] <= 158)
    out.append(dict(when=r['date'][:16], size=r['size'], avg=r['avg'], note=r['notes'][:70].replace('\n', ' '), prim=prim, sec=sec, trs=trs,
                    choc=4 * math.sqrt(tot) * FT, outside=outside, q=out_win and not sec))
for o in out:
    p = o['prim']
    tr = ' | '.join(f"{t['ft']:.1f}ft {t['T']:.0f}s {t['d']:.0f}°({comp(t['d'])}) →{t['choc']:.1f}ft [{100 * t['share']:.0f}%]" for t in o['trs'])
    print(f"{'YES' if o['q'] else '   '} {o['when']} size {o['size']:>2} avg {o['avg']:>4} Choc {o['choc']:.1f}ft, {100 * o['outside']:.0f}% from outside window | {tr}")
print()
for o in out:
    if o['q']: print(o['when'], 'size', o['size'], 'avg', o['avg'], '|', o['note'])
