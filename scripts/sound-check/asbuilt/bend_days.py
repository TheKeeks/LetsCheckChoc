"""Per local day, at Choc's biggest hour (the hour trains_days.json reports): the share of Choc's modeled energy
that arrived from outside the 115-158 deg window, i.e. from directions with no straight path to the reef, so it
had to bend around Montauk or Block Island. Same spectra, spreading and kernel as trains.py, so it sits on the
same hour and adds up with the per-train numbers. Writes bend_days.json {day: percent}."""
import json, math, datetime as dt
import numpy as np
from scipy.io import netcdf_file
from trains import KC, kernel_for_freq
FT = 3.28084
TH = np.arange(0, 360, 2) + 1.0; WIN = (TH >= 115) & (TH <= 158); THR = np.radians(TH)
def run(fn, t_from):
    f = netcdf_file(fn, 'r', mmap=False); V = f.variables
    t = V['waveTime'][:].astype(np.int64); fr = V['waveFrequency'][:].astype(float)
    bw = V['waveBandwidth'][:].astype(float); flag = V['waveFlagPrimary'][:]
    sel = np.where((t >= t_from) & (flag == 1) & (t % 3600 < 1800))[0]
    fm = (fr >= 0.04) & (fr <= 0.35); frm = fr[fm]; bwm = bw[fm]; KF = kernel_for_freq(*KC, frm)
    out = []
    for s0 in range(0, len(sel), 1500):
        ii = sel[s0:s0 + 1500]
        E = V['waveEnergyDensity'][ii][:, fm].astype(float)
        a1 = V['waveA1Value'][ii][:, fm].astype(float); b1 = V['waveB1Value'][ii][:, fm].astype(float)
        th1 = np.arctan2(b1, a1); r1 = np.clip(np.hypot(a1, b1), 0.05, 0.985); s = np.clip(r1 / (1 - r1), 0.5, 60)
        D = np.cos((THR[None, None, :] - th1[..., None]) / 2) ** 2; D = D ** s[..., None]; D /= D.sum(axis=2, keepdims=True)
        ec = (E * bwm)[..., None] * D * KF[None] / math.radians(2)   # energy reaching Choc, by frequency and from-direction (kernel is per radian, as in trains.py)
        tot = ec.sum(axis=(1, 2)); ins = ec[:, :, WIN].sum(axis=(1, 2))
        for k in range(len(ii)): out.append((int(t[ii[k]]), 4 * math.sqrt(max(tot[k], 0)) * FT, 1 - ins[k] / tot[k] if tot[k] > 0 else None))
    return out
def local_day(tt):                                          # as trains.py: Eastern time with US daylight saving
    u = dt.datetime.fromtimestamp(tt, dt.timezone.utc); y = u.year
    s = dt.datetime(y, 3, 8 + (6 - dt.date(y, 3, 8).weekday()) % 7, 7, tzinfo=dt.timezone.utc)
    e = dt.datetime(y, 11, 1 + (6 - dt.date(y, 11, 1).weekday()) % 7, 6, tzinfo=dt.timezone.utc)
    l = u + dt.timedelta(hours=-4 if s <= u < e else -5); return l.strftime('%Y-%m-%d'), l.hour
if __name__ == '__main__':
    t0 = int(dt.datetime(2015, 12, 31, tzinfo=dt.timezone.utc).timestamp())
    a = run('spec/154p1_historic.nc', t0); b = run('spec/154p1_rt.nc', a[-1][0] + 1)
    days = {}
    for tt, c, o in a + b:
        d, hr = local_day(tt)
        if c > days.get(d, (-1,))[0]: days[d] = (c, hr, o)
    T = json.load(open('trains_days.json')); same = sum(1 for d, v in days.items() if d in T and T[d][0] == v[1]); 
    print('days', len(days), 'same hour as trains_days.json:', same, 'of', sum(1 for d in days if d in T))
    out = {d: (None if v[2] is None else round(100 * v[2])) for d, v in sorted(days.items())}
    json.dump(out, open('bend_days.json', 'w'), separators=(',', ':'))
    for d in ('2023-08-29', '2023-08-31', '2025-08-22', '2022-10-14', '2021-09-10', '2022-09-23'): print(d, out.get(d), 'hour', days[d][1])
