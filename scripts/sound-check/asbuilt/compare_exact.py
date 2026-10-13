"""How much the exact wave-speed formula moves each of the page's numbers: fm_backup/ (old) vs the files in place (new)."""
import json, csv, itertools, datetime as dt
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
O = lambda f: json.load(open('fm_backup/' + f)); N = lambda f: json.load(open(f))
TS = list(range(5, 18)); DS = [50 + 2.5 * i for i in range(77)]
to, tn = O('fwd2_table_s1.json'), N('fwd2_table_s1.json')
for col, spot in ((2, 'Choc'), (3, 'Wilderness')):
    a = np.array([[to[str(T)][f'{D:g}'][col] for D in DS] for T in TS]); b = np.array([[tn[str(T)][f'{D:g}'][col] for D in DS] for T in TS])
    print(f'{spot} table: total energy new/old {b.sum() / a.sum():.3f}; per period ' + ' '.join(f'{T}s {b[i].sum() / max(a[i].sum(), 1e-9):.2f}' for i, T in enumerate(TS)))
for spot in ('choc', 'wild'):
    a, b = O(f'fwd2spec_{spot}_s1.json'), N(f'fwd2spec_{spot}_s1.json'); k = [x for x in a if x in b and a[x][1] > 2.0]
    r = np.array([b[x][1] / a[x][1] for x in k])
    print(f'{spot} hourly heights where old > 2 ft ({len(k)} h): new/old median {np.median(r):.3f}, 10-90% {np.percentile(r, 10):.3f}-{np.percentile(r, 90):.3f}')
rows = list(csv.DictReader(open('surflog.csv')))
def best3(src, day):
    v = []
    for hr in range(24):
        kk = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H'); v.append(src[kk][1] if kk in src else None)
    best = None
    for i in range(22):
        w = [x for x in v[i:i + 3] if x is not None]
        if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
    return best
def spear(x, y): rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return float(np.corrcoef(rx, ry)[0, 1])
def pairs(x, z):
    c = n = 0
    for i, j in itertools.combinations(range(len(z)), 2):
        if z[i] == z[j]: continue
        n += 1; c += np.sign(x[i] - x[j]) * np.sign(z[i] - z[j]) > 0
    return c, n
for tag, src in (('old', O('fwd2spec_choc_s1.json')), ('new', N('fwd2spec_choc_s1.json'))):
    d = [dt.datetime.fromisoformat(r['date']).date() for r in rows]; x = np.array([best3(src, dd) for dd in d], float)
    z = np.array([float(r['size']) for r in rows]); av = np.array([float(r['avg']) for r in rows])
    c, n = pairs(x, z)
    print(f'{tag}: sessions {len(z)}  rho size {spear(x, z):.3f}  rho overall {spear(x, av):.3f}  pairs {c}/{n} = {100 * c / n:.1f}%')
so, sn = O('sess_pairs.json'), N('sess_pairs.json')
print('session chart: Choc ft changes', sorted({round(b[3] - a[3], 2) for a, b in zip(so, sn)})[:3], '...', sorted({round(b[3] - a[3], 2) for a, b in zip(so, sn)})[-3:])
bo, bn = O('bend_days.json'), N('bend_days.json')
print('29 Aug 2023 bent in:', bo.get('2023-08-29'), '->', bn.get('2023-08-29'), '| 22 Aug 2025:', bo.get('2025-08-22'), '->', bn.get('2025-08-22'))
wo, wn = O('wild_stats.json'), N('wild_stats.json')
print('Wilderness days', wo['wild_days_total'], '->', wn['wild_days_total'], '| peel days', wo['peel_days_total'], '->', wn['peel_days_total'], '| share', wo['peel_share_days'], '->', wn['peel_share_days'])
ro, rn = O('results4.json'), N('results4.json')
print('results4 keys changed:', [k for k in rn if rn[k] != ro.get(k)])
sc_o, sc_n = O('score.json'), json.load(open('site/fc/score.json'))
print('forecast scorecard summary old', sc_o['summary']); print('forecast scorecard summary new', sc_n['summary'])
ko, kn = O('fwdk.json'), N('fwdk.json')
for spot in ('choc', 'wild'):
    a, b = np.array(ko[spot]['R']), np.array(kn[spot]['R']); print(f'forecast response {spot}: total new/old {b.sum() / a.sum():.3f}')
