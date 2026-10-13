import math, time, numpy as np
import smx
F = smx.F
for T, D in ((12, 142.5), (8, 162.5), (16, 207.5)):
    Fd = smx.fields_v(T, smx.VARIANTS['r3'])
    pts, phi0 = smx.crest_e(D, smx.SP); X = np.array([p[2] for p in pts]); Y = np.array([p[3] for p in pts])
    mC = smx.run_v(Fd, X.copy(), Y.copy(), phi0)
    keep = set()
    for i in np.where(mC < smx.NEAR)[0]:
        for d in range(-smx.MARGIN, smx.MARGIN + 1): keep.add((pts[i][0], int(round(pts[i][1] - 0.5)) + d))
    dp, _ = smx.crest_e(D, smx.SP / smx.DENSE); sel = [p for p in dp if (p[0], math.floor(p[1])) in keep]
    Xd = np.array([p[2] for p in sel]); Yd = np.array([p[3] for p in sel])
    t0 = time.time(); a = smx.run_v(Fd, Xd.copy(), Yd.copy(), phi0); t1 = time.time(); b = smx.run_v(Fd, Xd.copy(), Yd.copy(), phi0, prune=6000.0); t2 = time.time()
    # every dense ray (incl. those outside the kept band) for the same check without the band
    Xa = np.array([p[2] for p in dp]); Ya = np.array([p[3] for p in dp]); t3 = time.time(); full = smx.run_v(Fd, Xa.copy(), Ya.copy(), phi0); t4 = time.time()
    rc = smx.rc_of(T)
    print(f'T={T} D={D}: production 20 m rays landing {int((mC < rc).sum())}; dense band {len(sel)} rays: landing {int((a < rc).sum())} (no prune, {t1 - t0:.1f}s) / {int((b < rc).sum())} (prune, {t2 - t1:.1f}s); '
          f'all {len(dp)} dense rays: landing {int((full < rc).sum())} ({t4 - t3:.1f}s); identical minC under prune for landers: {bool(np.allclose(a[a < 3000], b[a < 3000]))}', flush=True)
