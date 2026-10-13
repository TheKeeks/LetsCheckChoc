import json, sys, numpy as np
rows = [json.loads(l) for l in open('fctest.log') if l.startswith('{')]
B = json.load(open('spec_choc.json'))
for r in rows: r['arrived'] = B[r['t']][1] if r['t'] in B else None
def sp(x, y):
    rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return float(np.corrcoef(rx, ry)[0, 1])
print('n', len(rows), 'log', sum(r['kind']=='log' for r in rows))
for L in (0, 1, 2):
    print(f'-- lead {L} d')
    for m in ('edge', 'buoy', 'near', 'blend'):
        k = f'{m}{L}'; ok = [r for r in rows if r.get(k) is not None and r.get('arrived') is not None]
        e = np.array([r[k] - r['arrived'] for r in ok]); a = np.array([r['arrived'] for r in ok]); f = np.array([r[k] for r in ok])
        lg = [r for r in rows if r['kind'] == 'log' and r.get(k) is not None]
        big = a >= 1.5
        print(f'{m:6s} n={len(ok):3d} bias={np.median(e):+.2f} MAE={np.mean(abs(e)):.2f} medAE={np.median(abs(e)):.2f} r={np.corrcoef(f,a)[0,1]:.2f} big-MAE={np.mean(abs(e[big])) if big.any() else float("nan"):.2f}(n{big.sum()}) | log rho_size={sp([r[k] for r in lg],[r["size"] for r in lg]):.2f} (n{len(lg)})')
lg=[r for r in rows if r['kind']=='log' and r.get('arrived') is not None]
print('arrived vs size rho', round(sp([r['arrived'] for r in lg],[r['size'] for r in lg]),2), len(lg))
