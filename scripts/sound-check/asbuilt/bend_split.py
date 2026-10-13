"""For one hour: split Choc's modeled wave energy by the direction each part of the buoy's spectrum came FROM.
Inside 115-158 deg = a straight path through the Block-Montauk gap exists; outside = it only reaches Choc by bending.
Also: the share of the buoy's own energy that sits inside the window (what a pure 'window' rule would count)."""
import sys, json, datetime as dt
import numpy as np
from scipy.io import netcdf_file
from zoneinfo import ZoneInfo
sys.argv = [sys.argv[0]]                                   # valid_fwd2 reads argv at import
import valid_fwd2 as V2
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc; FT = 3.28084
TH = np.arange(0, 360, 2.5) + 1.25; WIN = (TH >= 115) & (TH <= 158)
files = {}
def nc(fn):
    if fn not in files: files[fn] = netcdf_file(fn, 'r', mmap=True)
    return files[fn]
def hour(day, h_et):
    t = int(dt.datetime.fromisoformat(day).replace(hour=h_et, tzinfo=ET).timestamp())
    for fn in ('spec/154p1_rt.nc', 'spec/154p1_historic.nc'):
        f = nc(fn); V = f.variables; tt = V['waveTime'][:].astype(np.int64)
        i = int(np.argmin(np.abs(tt - t)))
        if abs(int(tt[i]) - t) <= 1800 and V['waveFlagPrimary'][i] == 1: return V, i
    return None, None
def split(day, h_et):
    V, i = hour(day, h_et)
    if V is None: return None
    fr = V['waveFrequency'][:].astype(float); bw = V['waveBandwidth'][:].astype(float); fm = (fr >= 0.04) & (fr <= 0.35)
    E = V['waveEnergyDensity'][i][fm].astype(float); a1 = V['waveA1Value'][i][fm].astype(float); b1 = V['waveB1Value'][i][fm].astype(float)
    th1 = np.arctan2(b1, a1); r1 = np.clip(np.hypot(a1, b1), 0.05, 0.985); s = np.clip(r1 / (1 - r1), 0.5, 60)
    Dd = np.cos((np.radians(TH)[None, :] - th1[:, None]) / 2) ** 2; Dd = Dd ** s[:, None]; Dd /= Dd.sum(axis=1, keepdims=True)
    KF = V2.for_freq(V2.FG['choc'], fr[fm])                  # fraction of buoy energy reaching Choc, by period and from-direction
    eb = E[:, None] * bw[fm][:, None] * Dd                   # buoy energy by frequency and direction
    ec = eb * KF                                             # what reaches Choc
    Hb = 4 * np.sqrt(eb.sum()) * FT; Hc = 4 * np.sqrt(ec.sum()) * FT
    inC = ec[:, WIN].sum() / ec.sum(); inB = eb[:, WIN].sum() / eb.sum()
    Hwin = 4 * np.sqrt(eb[:, WIN].sum()) * FT                # a pure window rule: only the buoy's in-window energy, carried straight in
    return dict(day=day, h=h_et, buoy_ft=round(Hb, 1), choc_ft=round(Hc, 1), choc_from_outside=round(100 * (1 - inC)), buoy_in_window=round(100 * inB), window_rule_ft=round(Hwin, 1))
for day, h in [('2022-09-23', 18), ('2023-08-29', 22), ('2023-08-30', 16), ('2023-08-31', 5), ('2022-10-14', 12), ('2025-08-22', 4), ('2021-09-10', 18)]:
    print(split(day, h))
