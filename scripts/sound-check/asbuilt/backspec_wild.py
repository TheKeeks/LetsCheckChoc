"""Hourly modeled wave height at the Choc reef from the buoy's full directional spectrum.

For every hourly CDIP 154 (NDBC 44097) spectrum: at each frequency, the directional
distribution is a cos^2s spread around the measured mean direction (s from the
first-moment spread r1). It is weighted by the backward-ray response kernel for
that period (backkernel.npz) and summed; Hs_reef = 4 sqrt(sum E_reef(f) df).
"""
import json, math, datetime as dt
import numpy as np
from scipy.io import netcdf_file

K = np.load('backkernel_wild.npz'); KP = K['periods'].astype(float); KR = K['R']   # (nT, 360) per radian of reef angle
TH = np.radians(np.arange(0, 360, 2) + 1.0)        # 2-degree direction grid (bin centres)
KR2 = KR.reshape(len(KP), 180, 2).sum(axis=2)      # per 2-degree bin

def kernel_for_freq(fr):
    T = np.clip(1 / fr, KP[0], KP[-1])
    j = np.clip(np.searchsorted(KP, T) - 1, 0, len(KP) - 2); w = (T - KP[j]) / (KP[j + 1] - KP[j])
    return KR2[j] * (1 - w)[:, None] + KR2[j + 1] * w[:, None]          # (nf, 180)

def run(fn, t_from):
    f = netcdf_file(fn, 'r', mmap=False); V = f.variables
    t = V['waveTime'][:].astype(np.int64); fr = V['waveFrequency'][:].astype(float)
    bw = V['waveBandwidth'][:].astype(float); flag = V['waveFlagPrimary'][:]
    sel = np.where((t >= t_from) & (flag == 1) & (t % 3600 < 1800))[0]          # one record per hour
    fm = (fr >= 0.04) & (fr <= 0.35)
    KF = kernel_for_freq(fr[fm])                                                 # (nf, 180)
    out_t, out_b, out_c = [], [], []
    for s0 in range(0, len(sel), 1500):
        ii = sel[s0:s0 + 1500]
        E = V['waveEnergyDensity'][ii][:, fm].astype(float)
        a1 = V['waveA1Value'][ii][:, fm].astype(float); b1 = V['waveB1Value'][ii][:, fm].astype(float)
        th1 = np.arctan2(b1, a1); r1 = np.clip(np.hypot(a1, b1), 0.05, 0.985)
        s = np.clip(r1 / (1 - r1), 0.5, 60)
        # cos^2s spread on the grid, normalised per (record, frequency)
        d = np.cos((TH[None, None, :] - th1[..., None]) / 2) ** 2
        D = d ** s[..., None]
        D /= D.sum(axis=2, keepdims=True)                                        # sums to 1 over bins
        fac = (D * KF[None]).sum(axis=2) / math.radians(2)                       # kernel is per radian
        Hs_b = 4 * np.sqrt((V['waveEnergyDensity'][ii].astype(float) * bw).sum(axis=1))
        Hs_c = 4 * np.sqrt((E * fac * bw[fm]).sum(axis=1))
        out_t.append(t[ii]); out_b.append(Hs_b); out_c.append(Hs_c)
    return np.concatenate(out_t), np.concatenate(out_b), np.concatenate(out_c)

if __name__ == '__main__':
    t0 = int(dt.datetime(2015, 12, 31, tzinfo=dt.timezone.utc).timestamp())
    a = run('spec/154p1_historic.nc', t0)
    b = run('spec/154p1_rt.nc', int(a[0][-1]) + 1)
    T = np.concatenate([a[0], b[0]]); HB = np.concatenate([a[1], b[1]]); HC = np.concatenate([a[2], b[2]])
    FT = 3.28084
    out = {}
    for t, hb, hc in zip(T, HB, HC):
        k = dt.datetime.fromtimestamp(int(t) - int(t) % 3600, dt.timezone.utc).strftime('%Y-%m-%dT%H')
        out[k] = [round(float(hb) * FT, 2), round(float(hc) * FT, 2)]
    json.dump(out, open('spec_wild.json', 'w'))
    r = HC / np.maximum(HB, 0.05)
    print('hours', len(out), 'reef/buoy ratio median %.2f p10 %.2f p90 %.2f' % tuple(np.percentile(r[HB > 0.5], [50, 10, 90])))
