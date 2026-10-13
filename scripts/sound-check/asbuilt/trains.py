"""Split every hourly buoy spectrum (CDIP 154 = NDBC 44097) into swell trains.

A train is a hump in the energy-vs-frequency curve with its own direction:
1. smooth E(f), find its peaks, and give every frequency to the peak it climbs to
   (a 1-D watershed);
2. merge neighbouring humps that come from about the same direction (< 30 deg apart)
   or are not really separated (the dip between them is > 70 % of the smaller peak),
   and fold any hump under 0.3 ft into its closest-direction neighbour;
3. for each train: buoy height, peak period, energy-weighted mean direction, and how
   much of it reaches Choc and Wilderness, using the same per-frequency backward-ray
   factors as backspec.py (so the trains add up exactly to the modeled spot height).

Writes trains_days.json (per day, the trains at Choc's and Wilderness's biggest hour)
and trains_stats.json (how often the buoy's biggest train is not what makes Choc).
"""
import json, math, datetime as dt
import numpy as np
from scipy.io import netcdf_file

FT = 3.28084
TH = np.radians(np.arange(0, 360, 2) + 1.0)

def load_kernel(fn):
    K = np.load(fn); KP = K['periods'].astype(float); KR = K['R']
    return KP, KR.reshape(len(KP), 180, 2).sum(axis=2)

def kernel_for_freq(KP, KR2, fr):
    T = np.clip(1 / fr, KP[0], KP[-1])
    j = np.clip(np.searchsorted(KP, T) - 1, 0, len(KP) - 2); w = (T - KP[j]) / (KP[j + 1] - KP[j])
    return KR2[j] * (1 - w)[:, None] + KR2[j + 1] * w[:, None]

KC = load_kernel('fwdkernel_choc.npz'); KW = load_kernel('fwdkernel_wild.npz')

def angdiff(a, b): return abs((a - b + 180) % 360 - 180)

def partition(E, a1, b1, bw):
    """Return list of index arrays, one per train."""
    n = len(E)
    Es = np.convolve(np.pad(E, 1, mode='edge'), [0.25, 0.5, 0.25], 'valid')
    # steepest-ascent labels
    lab = np.empty(n, int)
    for i in range(n):
        j = i
        while True:
            nb = [k for k in (j - 1, j + 1) if 0 <= k < n]
            k = max(nb, key=lambda k: Es[k])
            if Es[k] > Es[j]: j = k
            else: break
        lab[i] = j
    peaks = sorted(set(lab))
    parts = [np.where(lab == p)[0] for p in peaks]          # in frequency order (contiguous)
    def info(ix):
        e = E[ix] * bw[ix]; m = e.sum()
        d = (math.degrees(math.atan2((b1[ix] * e).sum(), (a1[ix] * e).sum())) + 360) % 360
        return m, d, Es[ix].max()
    changed = True
    while changed and len(parts) > 1:
        changed = False
        for i in range(len(parts) - 1):
            A, B = parts[i], parts[i + 1]
            mA, dA, pA = info(A); mB, dB, pB = info(B)
            trough = Es[A[-1]:B[0] + 1].min()
            if angdiff(dA, dB) < 30 or trough > 0.7 * min(pA, pB):
                parts[i] = np.concatenate([A, B]); del parts[i + 1]; changed = True; break
    # fold tiny trains (< 0.3 ft) into the neighbour closest in direction
    small = (0.3 / FT / 4) ** 2
    changed = True
    while changed and len(parts) > 1:
        changed = False
        for i, P in enumerate(parts):
            m, d, _ = info(P)
            if m < small:
                nb = [k for k in (i - 1, i + 1) if 0 <= k < len(parts)]
                k = min(nb, key=lambda k: angdiff(info(parts[k])[1], d))
                lo, hi = sorted((i, k))
                parts[lo] = np.concatenate([parts[lo], parts[hi]]); del parts[hi]; changed = True; break
    return parts

def run(fn, t_from):
    f = netcdf_file(fn, 'r', mmap=False); V = f.variables
    t = V['waveTime'][:].astype(np.int64); fr = V['waveFrequency'][:].astype(float)
    bw = V['waveBandwidth'][:].astype(float); flag = V['waveFlagPrimary'][:]
    sel = np.where((t >= t_from) & (flag == 1) & (t % 3600 < 1800))[0]
    fm = (fr >= 0.04) & (fr <= 0.35); frm = fr[fm]; bwm = bw[fm]
    KFc = kernel_for_freq(*KC, frm); KFw = kernel_for_freq(*KW, frm)
    out = []
    for s0 in range(0, len(sel), 1500):
        ii = sel[s0:s0 + 1500]
        E = V['waveEnergyDensity'][ii][:, fm].astype(float)
        a1 = V['waveA1Value'][ii][:, fm].astype(float); b1 = V['waveB1Value'][ii][:, fm].astype(float)
        th1 = np.arctan2(b1, a1); r1 = np.clip(np.hypot(a1, b1), 0.05, 0.985)
        s = np.clip(r1 / (1 - r1), 0.5, 60)
        D = np.cos((TH[None, None, :] - th1[..., None]) / 2) ** 2
        D = D ** s[..., None]; D /= D.sum(axis=2, keepdims=True)
        fc = (D * KFc[None]).sum(axis=2) / math.radians(2)
        fw = (D * KFw[None]).sum(axis=2) / math.radians(2)
        for r in range(len(ii)):
            trs = []
            for ix in partition(E[r], a1[r], b1[r], bwm):
                e = E[r, ix] * bwm[ix]
                d = (math.degrees(math.atan2((b1[r, ix] * e).sum(), (a1[r, ix] * e).sum())) + 360) % 360
                tp = 1 / frm[ix[np.argmax(E[r, ix])]]
                trs.append((4 * math.sqrt(e.sum()) * FT, tp, d,
                            4 * math.sqrt((e * fc[r, ix]).sum()) * FT, 4 * math.sqrt((e * fw[r, ix]).sum()) * FT))
            trs.sort(key=lambda x: -x[0])
            out.append((int(t[ii[r]]), trs))
    return out

if __name__ == '__main__':
    t0 = int(dt.datetime(2015, 12, 31, tzinfo=dt.timezone.utc).timestamp())
    a = run('spec/154p1_historic.nc', t0)
    b = run('spec/154p1_rt.nc', a[-1][0] + 1)
    H = a + b
    # check: trains add up to backspec's modeled heights
    sc = json.load(open('spec_choc.json')); errs = []
    for tt, trs in H[::97]:
        k = dt.datetime.fromtimestamp(tt - tt % 3600, dt.timezone.utc).strftime('%Y-%m-%dT%H')
        if k in sc: errs.append(math.sqrt(sum(x[3] ** 2 for x in trs)) - sc[k][1])
    print('hours', len(H), 'sum-of-trains vs backspec Choc: max abs diff %.3f ft' % max(map(abs, errs)))

    # per local day: trains at the hour each spot peaks
    NY = dt.timezone(dt.timedelta(hours=-5))
    def local_day(tt):
        u = dt.datetime.fromtimestamp(tt, dt.timezone.utc)
        # Eastern time: EDT second Sunday Mar to first Sunday Nov
        y = u.year
        s = dt.datetime(y, 3, 8 + (6 - dt.date(y, 3, 8).weekday()) % 7, 7, tzinfo=dt.timezone.utc)
        e = dt.datetime(y, 11, 1 + (6 - dt.date(y, 11, 1).weekday()) % 7, 6, tzinfo=dt.timezone.utc)
        off = -4 if s <= u < e else -5
        l = u + dt.timedelta(hours=off)
        return l.strftime('%Y-%m-%d'), l.hour
    days = {}
    for tt, trs in H:
        d, hr = local_day(tt)
        c = math.sqrt(sum(x[3] ** 2 for x in trs)); w = math.sqrt(sum(x[4] ** 2 for x in trs))
        D = days.setdefault(d, {'c': (-1, None, None), 'w': (-1, None, None)})
        if c > D['c'][0]: D['c'] = (c, hr, trs)
        if w > D['w'][0]: D['w'] = (w, hr, trs)
    def enc(trs): return [[round(x[0], 1), round(x[1], 1), int(round(x[2])) % 360, round(x[3], 1), round(x[4], 1)] for x in trs[:4]]
    out = {d: [v['c'][1], enc(v['c'][2]), v['w'][1], enc(v['w'][2])] for d, v in sorted(days.items())}
    json.dump(out, open('trains_days.json', 'w'), separators=(',', ':'))

    # stats
    n_tr = [len(trs) for _, trs in H]
    def win(d): return 115 <= d <= 158
    big = [(tt, trs) for tt, trs in H if math.sqrt(sum(x[3] ** 2 for x in trs)) >= 3]
    hidden = [(tt, trs) for tt, trs in big if not win(trs[0][2])]
    # which train made Choc: biggest contributor at Choc
    hid_src = [max(trs, key=lambda x: x[3]) for _, trs in hidden]
    # days
    bigd = {d for d, v in days.items() if v['c'][0] >= 3}
    hidd = {d for d, v in days.items() if v['c'][0] >= 3 and not win(v['c'][2][0][2])}
    notmain = {d for d, v in days.items() if v['c'][0] >= 3 and max(v['c'][2], key=lambda x: x[3]) is not v['c'][2][0]}
    # wind sea on top: biggest buoy train < 8 s and from outside window, Choc made by a >= 9 s train
    under = {d for d, v in days.items() if v['c'][0] >= 3 and v['c'][2][0][1] < 8 and max(v['c'][2], key=lambda x: x[3])[1] >= 9}
    multi = sum(1 for n in n_tr if n >= 2) / len(n_tr)
    st = dict(hours=len(H), share_multi=round(multi, 3), share_three=round(sum(1 for n in n_tr if n >= 3) / len(n_tr), 3),
              big_hours=len(big), hidden_hours=len(hidden),
              big_days=len(bigd), hidden_days=len(hidd), notmain_days=len(notmain), under_days=len(under),
              hidden_src_dir_med=float(np.median([x[2] for x in hid_src])) if hid_src else None,
              hidden_src_tp_med=float(np.median([x[1] for x in hid_src])) if hid_src else None,
              examples=sorted(notmain, key=lambda d: -days[d]['c'][0])[:12])
    json.dump(st, open('trains_stats.json', 'w'), indent=1)
    print(json.dumps(st, indent=1))
