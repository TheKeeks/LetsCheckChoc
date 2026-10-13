import time, numpy as np, smx
rng = np.random.default_rng(5)
cases = [(int(rng.choice(smx.PERS)), float(rng.choice(smx.DIRS[10:70]))) for _ in range(6)]
for name in ('r1', 'r8'):
    v = smx.VARIANTS[name]
    for T, D in cases[:3] if name == 'r1' else cases[3:]:
        Fd = smx.fields_v(T, v); pts, phi0 = smx.crest_e(D, smx.SP)
        X = np.array([p[2] for p in pts]); Y = np.array([p[3] for p in pts]); rc = smx.rc_of(T)
        t0 = time.time(); a = smx.run_v(Fd, X.copy(), Y.copy(), phi0); t1 = time.time(); b = smx.run_v(Fd, X.copy(), Y.copy(), phi0, prune=6000.0); t2 = time.time()
        print(f'{name} T={T} D={D:g}: landing {int((a < rc).sum())} without / {int((b < rc).sum())} with early stop; {t1 - t0:.1f}s vs {t2 - t1:.1f}s', flush=True)
