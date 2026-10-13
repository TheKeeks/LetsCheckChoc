"""Buoy 44097's hourly spectra (CDIP 154) → what reaches Choc and Wilderness, hour by hour.

The same arithmetic as the scripts that built the history (scripts/sound-check/asbuilt/valid_fwd2.py, trains.py,
bend_days.py, fwdk.py), in one pass over the spectra, so the daily update reproduces the history it extends:

  heights   every hour: [buoy ft, spot ft, peel share] for Choc and Wilderness (the forward-ray table, each
            frequency's energy spread over direction with cos^2s, s from the buoy's own r1)
  trains    every hour: the swell trains (humps in energy vs frequency with their own direction), each with its
            buoy height, peak period, direction and height at Choc and Wilderness
  bent      every hour: Choc's height and the share of its energy that came from outside the 115-158 deg window

CDIP serves the history in two NetCDF files: the archive (154p1_historic.nc, about 750 MB, to the last time CDIP
moved data into it) and the recent months (154p1_rt.nc). Records come every half hour; the first of each hour with
a good flag is used.
"""
import json, math, datetime as dt
import numpy as np
from scipy.io import netcdf_file

FT = 3.28084
UTC = dt.timezone.utc
TS = list(range(5, 18))                       # the forward-ray table: periods 5..17 s ...
DS = [50 + 2.5 * i for i in range(77)]        # ... and directions 50..240 deg by 2.5
TH25 = np.radians(np.arange(0, 360, 2.5) + 1.25)   # the heights' direction bins (2.5 deg)
TH2 = np.arange(0, 360, 2) + 1.0                    # the trains' and the bend's (2 deg)
WIN2 = (TH2 >= 115) & (TH2 <= 158)
BATCH = 1500


# ── the forward-ray table: T -> D -> [nc, nw, k2c, k2w, peelC, medC, nC, peelW, medW, nW]
class Table:
    def __init__(self, path):
        with open(path) as f: tab = json.load(f)
        self.tab = tab
        K2 = {s: np.array([[tab[str(T)][f'{D:g}'][2 if s == 'choc' else 3] for D in DS] for T in TS]) for s in ('choc', 'wild')}
        PS = {s: np.array([[(tab[str(T)][f'{D:g}'][4 if s == 'choc' else 7] or 0) for D in DS] for T in TS]) for s in ('choc', 'wild')}
        self.FG = {s: self._full(K2[s]) for s in K2}
        self.FP = {s: self._full(K2[s] * PS[s]) for s in K2}
        self.kernel = {s: self._kernel(s) for s in ('choc', 'wild')}

    @staticmethod
    def _full(arr):
        g = np.zeros((len(TS), 144))
        for j, D in enumerate(DS): g[:, int(D / 2.5) % 144] = arr[:, j]
        return g

    def _kernel(self, spot):
        """fwdk.py's per-degree kernel (rounded to 6 places as it was stored), summed to 2 deg bins as trains.py read it"""
        col = 2 if spot == 'choc' else 3
        DSa = np.array(DS); deg = np.arange(360) + 0.5; R = []
        for T in TS:
            v = np.array([self.tab[str(T)][f'{D:g}'][col] for D in DSa])
            k = np.interp(deg, DSa, v, left=0, right=0)
            R.append((k * math.pi / 180).round(6).tolist())
        R = np.array(R)
        return np.array(TS, float), R.reshape(len(TS), 180, 2).sum(axis=2)

    def fwdk(self):
        """the page's BACKK table (scripts/sound-check/page/fwdk.json): R[T][deg] = k2 x pi/180"""
        out = {}
        DSa = np.array(DS); deg = np.arange(360) + 0.5
        for spot, col in (('choc', 2), ('wild', 3)):
            R = []
            for T in TS:
                v = np.array([self.tab[str(T)][f'{D:g}'][col] for D in DSa])
                R.append((np.interp(deg, DSa, v, left=0, right=0) * math.pi / 180).round(6).tolist())
            out[spot] = dict(periods=TS, R=R)
        return out


def _for_freq25(G_, fr):
    T = np.clip(1 / fr, TS[0], TS[-1]); j = np.clip((T - TS[0]).astype(int), 0, len(TS) - 2); w = T - TS[0] - j
    return G_[j] * (1 - w)[:, None] + G_[j + 1] * w[:, None]


def _kernel_for_freq(KP, KR2, fr):
    T = np.clip(1 / fr, KP[0], KP[-1])
    j = np.clip(np.searchsorted(KP, T) - 1, 0, len(KP) - 2); w = (T - KP[j]) / (KP[j + 1] - KP[j])
    return KR2[j] * (1 - w)[:, None] + KR2[j + 1] * w[:, None]


def angdiff(a, b): return abs((a - b + 180) % 360 - 180)

def total(xs):
    """xs added left to right, as Python's sum() added floats until 3.12 (which compensates for rounding): the history
    was built that way, so it comes out the same on any Python"""
    t = 0
    for x in xs: t = t + x
    return t



def partition(E, a1, b1, bw):
    """Split one spectrum into trains: a list of frequency-index arrays (trains.py's partition, unchanged)."""
    n = len(E)
    Es = np.convolve(np.pad(E, 1, mode='edge'), [0.25, 0.5, 0.25], 'valid')
    lab = np.empty(n, int)
    for i in range(n):                                       # steepest ascent: every frequency climbs to its peak
        j = i
        while True:
            nb = [k for k in (j - 1, j + 1) if 0 <= k < n]
            k = max(nb, key=lambda k: Es[k])
            if Es[k] > Es[j]: j = k
            else: break
        lab[i] = j
    peaks = sorted(set(lab))
    parts = [np.where(lab == p)[0] for p in peaks]
    def info(ix):
        e = E[ix] * bw[ix]; m = e.sum()
        d = (math.degrees(math.atan2((b1[ix] * e).sum(), (a1[ix] * e).sum())) + 360) % 360
        return m, d, Es[ix].max()
    changed = True
    while changed and len(parts) > 1:                        # merge neighbours from about the same direction, or not separated
        changed = False
        for i in range(len(parts) - 1):
            A, B = parts[i], parts[i + 1]
            mA, dA, pA = info(A); mB, dB, pB = info(B)
            trough = Es[A[-1]:B[0] + 1].min()
            if angdiff(dA, dB) < 30 or trough > 0.7 * min(pA, pB):
                parts[i] = np.concatenate([A, B]); del parts[i + 1]; changed = True; break
    small = (0.3 / FT / 4) ** 2
    changed = True
    while changed and len(parts) > 1:                        # fold trains under 0.3 ft into the closest-direction neighbour
        changed = False
        for i, P in enumerate(parts):
            m, d, _ = info(P)
            if m < small:
                nb = [k for k in (i - 1, i + 1) if 0 <= k < len(parts)]
                k = min(nb, key=lambda k: angdiff(info(parts[k])[1], d))
                lo, hi = sorted((i, k))
                parts[lo] = np.concatenate([parts[lo], parts[hi]]); del parts[hi]; changed = True; break
    return parts


def hour_key(tt): return dt.datetime.fromtimestamp(int(tt) - int(tt) % 3600, UTC).strftime('%Y-%m-%dT%H')


def read(path, table, t_from, t_to=None, heights=True, trains=True):
    """One CDIP file → {'t': [record times], 'heights': {spot: {hour: [buoy ft, spot ft, peel]}}, 'trains': [(t, trs)],
    'bent': [(t, Choc ft, share outside)]} for the records at or after t_from (and before t_to)."""
    f = netcdf_file(path, 'r', mmap=False); V = f.variables
    t = V['waveTime'][:].astype(np.int64); fr = V['waveFrequency'][:].astype(float)
    bw = V['waveBandwidth'][:].astype(float); flag = V['waveFlagPrimary'][:]
    keep = (t >= t_from) & (flag == 1) & (t % 3600 < 1800)
    if t_to is not None: keep &= t < t_to
    sel = np.where(keep)[0]
    fm = (fr >= 0.04) & (fr <= 0.35); frm = fr[fm]; bwm = bw[fm]
    KF = {s: _for_freq25(table.FG[s], frm) for s in ('choc', 'wild')}
    KP = {s: _for_freq25(table.FP[s], frm) for s in ('choc', 'wild')}
    KFc = _kernel_for_freq(*table.kernel['choc'], frm); KFw = _kernel_for_freq(*table.kernel['wild'], frm)
    out = dict(t=[int(x) for x in t[sel]], heights={'choc': {}, 'wild': {}}, trains=[], bent=[])
    for s0 in range(0, len(sel), BATCH):
        ii = sel[s0:s0 + BATCH]
        Efull = V['waveEnergyDensity'][ii].astype(float)
        E = Efull[:, fm]
        a1 = V['waveA1Value'][ii][:, fm].astype(float); b1 = V['waveB1Value'][ii][:, fm].astype(float)
        th1 = np.arctan2(b1, a1); r1 = np.clip(np.hypot(a1, b1), 0.05, 0.985); s = np.clip(r1 / (1 - r1), 0.5, 60)
        if heights:                                          # valid_fwd2.run
            D = np.cos((TH25[None, None, :] - th1[..., None]) / 2) ** 2; D = D ** s[..., None]; D /= D.sum(axis=2, keepdims=True)
            Hb = 4 * np.sqrt((Efull * bw).sum(axis=1))
            for spot in ('choc', 'wild'):
                fac = (D * KF[spot][None]).sum(axis=2); facp = (D * KP[spot][None]).sum(axis=2)
                es = (E * fac * bwm).sum(axis=1); Hs = 4 * np.sqrt(es)
                pf = (E * facp * bwm).sum(axis=1) / np.maximum(es, 1e-12)
                H = out['heights'][spot]
                for tt, hb, hs, p in zip(t[ii], Hb, Hs, pf):
                    H[hour_key(tt)] = [round(float(hb) * FT, 2), round(float(hs) * FT, 2), round(float(p), 3)]
        if trains:                                           # trains.run and bend_days.run
            D = np.cos((np.radians(TH2)[None, None, :] - th1[..., None]) / 2) ** 2
            D = D ** s[..., None]; D /= D.sum(axis=2, keepdims=True)
            fc = (D * KFc[None]).sum(axis=2) / math.radians(2)
            fw = (D * KFw[None]).sum(axis=2) / math.radians(2)
            ec = (E * bwm)[..., None] * D * KFc[None] / math.radians(2)
            tot = ec.sum(axis=(1, 2)); ins = ec[:, :, WIN2].sum(axis=(1, 2))
            for r in range(len(ii)):
                trs = []
                for ix in partition(E[r], a1[r], b1[r], bwm):
                    e = E[r, ix] * bwm[ix]
                    d = (math.degrees(math.atan2((b1[r, ix] * e).sum(), (a1[r, ix] * e).sum())) + 360) % 360
                    tp = 1 / frm[ix[np.argmax(E[r, ix])]]
                    trs.append((4 * math.sqrt(e.sum()) * FT, tp, d,
                                4 * math.sqrt((e * fc[r, ix]).sum()) * FT, 4 * math.sqrt((e * fw[r, ix]).sum()) * FT))
                trs.sort(key=lambda x: -x[0])
                tt = int(t[ii[r]])
                out['trains'].append((tt, trs))
                out['bent'].append((tt, 4 * math.sqrt(max(tot[r], 0)) * FT, 1 - ins[r] / tot[r] if tot[r] > 0 else None))
    f.close()
    return out


def read_all(historic, realtime, table, t_from, t_to=None):
    """The archive, then the recent file from just after the archive's last hour (as the history was built)."""
    a = read(historic, table, t_from, t_to) if historic else dict(t=[], heights={'choc': {}, 'wild': {}}, trains=[], bent=[])
    # valid_fwd2 continued after the archive's last HOUR, trains/bend after its last record: with half-hourly records
    # and only the first of each hour kept, both are the same next hour
    nxt = (a['t'][-1] + 1) if a['t'] else t_from
    b = read(realtime, table, max(nxt, t_from), t_to)
    for spot in ('choc', 'wild'): a['heights'][spot].update(b['heights'][spot])
    a['trains'] += b['trains']; a['bent'] += b['bent']; a['t'] += b['t']
    return a


def local_day(tt):
    """Eastern date and hour of a UTC time (US daylight saving, as trains.py and bend_days.py computed it)"""
    u = dt.datetime.fromtimestamp(tt, UTC); y = u.year
    s = dt.datetime(y, 3, 8 + (6 - dt.date(y, 3, 8).weekday()) % 7, 7, tzinfo=UTC)
    e = dt.datetime(y, 11, 1 + (6 - dt.date(y, 11, 1).weekday()) % 7, 6, tzinfo=UTC)
    l = u + dt.timedelta(hours=-4 if s <= u < e else -5)
    return l.strftime('%Y-%m-%d'), l.hour


def trains_days(trains):
    """trains_days.json: per Eastern day, the trains at the hour Choc peaks and the hour Wilderness peaks:
    {day: [Choc hour, trains, Wilderness hour, trains]}, each train [buoy ft, Tp s, from deg, Choc ft, Wilderness ft]"""
    days = {}
    for tt, trs in trains:
        d, hr = local_day(tt)
        c = math.sqrt(total(x[3] ** 2 for x in trs)); w = math.sqrt(total(x[4] ** 2 for x in trs))
        D = days.setdefault(d, {'c': (-1, None, None), 'w': (-1, None, None)})
        if c > D['c'][0]: D['c'] = (c, hr, trs)
        if w > D['w'][0]: D['w'] = (w, hr, trs)
    def enc(trs): return [[round(x[0], 1), round(x[1], 1), int(round(x[2])) % 360, round(x[3], 1), round(x[4], 1)] for x in trs[:4]]
    return {d: [v['c'][1], enc(v['c'][2]), v['w'][1], enc(v['w'][2])] for d, v in sorted(days.items())}


def bend_days(bent):
    """bend_days.json: per Eastern day, at Choc's biggest hour, the % of Choc's energy from outside 115-158 deg"""
    days = {}
    for tt, c, o in bent:
        d, hr = local_day(tt)
        if c > days.get(d, (-1,))[0]: days[d] = (c, hr, o)
    return {d: (None if v[2] is None else round(100 * v[2])) for d, v in sorted(days.items())}


def day_lane(trains):
    """research/ocean/day/<year>.json's '44097' lane: {UTC hour: [[ft, Tp, from, Choc ft], ...]} by year"""
    by = {}
    for tt, trs in trains:
        k = dt.datetime.fromtimestamp(tt - tt % 3600, UTC)
        by.setdefault(k.year, {})[k.strftime('%Y-%m-%dT%H')] = [[round(x[0], 1), round(x[1], 1), int(round(x[2])) % 360, round(x[3], 1)] for x in trs[:4]]
    return by
