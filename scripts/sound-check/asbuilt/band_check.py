import json, glob, math, sys
import numpy as np
import smx
for name in sys.argv[1:]:
    R = {}
    for f in glob.glob(f'smx_{name}_[0-3].json'): R.update(json.load(open(f)))
    worst = sorted(R.items(), key=lambda kv: -kv[1]['edge'])[:4]
    v = smx.VARIANTS[name]
    for key, r in worst:
        T, D = key.split('_'); T = int(T); D = float(D)
        Fd = smx.fields_v(T, v); pts, phi0 = smx.crest_e(D, smx.SP / smx.DENSE)
        X = np.array([p[2] for p in pts]); Y = np.array([p[3] for p in pts])
        mC = smx.run_v(Fd, X, Y, phi0, ds_cells=v.get('ds', 0.5), bilinear=v.get('bilinear', False), prune=6000.0)
        full = int((mC < smx.rc_of(T)).sum())
        print(f'{name} T={T} D={D:g}: band count {r["nc"]} (edge landers {r["edge"]}) vs all {len(pts)} dense rays {full}', flush=True)
