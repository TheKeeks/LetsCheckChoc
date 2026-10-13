"""Re-check against the surf log: modeled Choc height from the buoy spectrum, using
(a) the backward-ray kernels (the current, checked model) and (b) the new forward-ray table.
Rank correlation of each session day's best 3 hours with the size you logged.
Also writes fwdspec_choc.json / fwdspec_wild.json: hourly [buoy ft, spot ft] like spec_*.json."""
import json, math, csv, glob, datetime as dt, sys
import numpy as np
from scipy.io import netcdf_file
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc; FT = 3.28084

# forward table k2[T][D] (fraction of buoy energy), T 5..17, D 50..240 by 2.5
TABF = sys.argv[1] if len(sys.argv) > 1 else 'fwd2_table_s1.json'
WRITE = 'write' in sys.argv
tab = json.load(open(TABF))    # T -> D -> [nc, nw, k2c, k2w, peelC, medC, nC, peelW, medW, nW]
TS = list(range(5, 18)); DS = [50 + 2.5 * i for i in range(77)]
K2 = {s: np.array([[tab[str(T)][f'{D:g}'][2 if s == 'choc' else 3] for D in DS] for T in TS]) for s in ('choc', 'wild')}
PS = {s: np.array([[(tab[str(T)][f'{D:g}'][4 if s == 'choc' else 7] or 0) for D in DS] for T in TS]) for s in ('choc', 'wild')}
TH = np.radians(np.arange(0, 360, 2.5) + 1.25)
def full(arr):
    g = np.zeros((len(TS), 144))
    for j, D in enumerate(DS): g[:, int(D / 2.5) % 144] = arr[:, j]
    return g
FG = {s: full(K2[s]) for s in K2}; FP = {s: full(K2[s] * PS[s]) for s in K2}
def for_freq(G_, fr):
    T = np.clip(1 / fr, TS[0], TS[-1]); j = np.clip((T - TS[0]).astype(int), 0, len(TS) - 2); w = T - TS[0] - j
    return G_[j] * (1 - w)[:, None] + G_[j + 1] * w[:, None]

def run(fn, t_from, t_to, spot):
    f = netcdf_file(fn, 'r', mmap=False); V = f.variables
    t = V['waveTime'][:].astype(np.int64); fr = V['waveFrequency'][:].astype(float)
    bw = V['waveBandwidth'][:].astype(float); flag = V['waveFlagPrimary'][:]
    sel = np.where((t >= t_from) & (t < t_to) & (flag == 1) & (t % 3600 < 1800))[0]
    fm = (fr >= 0.04) & (fr <= 0.35); KF = for_freq(FG[spot], fr[fm]); KP = for_freq(FP[spot], fr[fm])
    out = {}
    for s0 in range(0, len(sel), 1500):
        ii = sel[s0:s0 + 1500]
        E = V['waveEnergyDensity'][ii][:, fm].astype(float)
        a1 = V['waveA1Value'][ii][:, fm].astype(float); b1 = V['waveB1Value'][ii][:, fm].astype(float)
        th1 = np.arctan2(b1, a1); r1 = np.clip(np.hypot(a1, b1), 0.05, 0.985); s = np.clip(r1 / (1 - r1), 0.5, 60)
        D = np.cos((TH[None, None, :] - th1[..., None]) / 2) ** 2; D = D ** s[..., None]; D /= D.sum(axis=2, keepdims=True)
        fac = (D * KF[None]).sum(axis=2); facp = (D * KP[None]).sum(axis=2)
        Hb = 4 * np.sqrt((V['waveEnergyDensity'][ii].astype(float) * bw).sum(axis=1)); es = (E * fac * bw[fm]).sum(axis=1); Hs = 4 * np.sqrt(es)
        pf = (E * facp * bw[fm]).sum(axis=1) / np.maximum(es, 1e-12)
        for tt, hb, hs, p in zip(t[ii], Hb, Hs, pf):
            out[dt.datetime.fromtimestamp(int(tt) - int(tt) % 3600, UTC).strftime('%Y-%m-%dT%H')] = [round(float(hb) * FT, 2), round(float(hs) * FT, 2), round(float(p), 3)]
    return out

def spearman(x, y):
    rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return float(np.corrcoef(rx, ry)[0, 1])

if __name__ == '__main__':
    t0 = int(dt.datetime(2015, 12, 31, tzinfo=UTC).timestamp()); t1 = int(dt.datetime(2030, 1, 1, tzinfo=UTC).timestamp())
    TAG = TABF.replace('fwd2_table_', '').replace('.json', '')
    for spot in (('choc', 'wild') if WRITE else ('choc',)):
        a = run('spec/154p1_historic.nc', t0, t1, spot)
        last = max(int(dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).timestamp()) for k in a)
        a.update(run('spec/154p1_rt.nc', last + 1, t1, spot))
        json.dump(a, open(f'fwd2spec_{spot}_{TAG}.json', 'w'))
        print(spot, 'hours', len(a), file=sys.stderr)
    old = json.load(open('back_v12/spec_choc.json')); new = json.load(open(f'fwd2spec_choc_{TAG}.json'))
    rows = list(csv.DictReader(open('surflog.csv')))
    def best3(src, day):
        v = []
        for hr in range(24):
            k = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H')
            v.append(src[k][1] if k in src else None)
        best = None
        for i in range(22):
            w = [x for x in v[i:i + 3] if x is not None]
            if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
        return best
    P = []
    for r in rows:
        d = dt.datetime.fromisoformat(r['date']).date()
        o, n = best3(old, d), best3(new, d)
        if o is not None and n is not None: P.append((o, n, float(r['size']), float(r['avg'])))
    P = np.array(P)
    print('sessions', len(P))
    print('size rating:  backward rho %.2f   forward rho %.2f' % (spearman(P[:, 0], P[:, 2]), spearman(P[:, 1], P[:, 2])))
    print('overall avg:  backward rho %.2f   forward rho %.2f' % (spearman(P[:, 0], P[:, 3]), spearman(P[:, 1], P[:, 3])))
    print('median forward/backward height ratio %.2f' % np.median(P[:, 1] / np.maximum(P[:, 0], 0.1)))
    rng = np.random.default_rng(1); bo, bn = [], []
    for _ in range(2000):
        i = rng.integers(0, len(P), len(P)); bo.append(spearman(P[i, 0], P[i, 2])); bn.append(spearman(P[i, 1], P[i, 2]))
    print('bootstrap 95%%: backward %.2f-%.2f  forward %.2f-%.2f' % (*np.percentile(bo, [2.5, 97.5]), *np.percentile(bn, [2.5, 97.5])))
