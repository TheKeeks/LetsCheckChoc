import numpy as np, fwdprod2 as m
for T in (8, 14):
    Fd = m.fields(T)
    for D in (100, 140, 190):
        X, Y, phi0 = m.crest(D)
        mC, mW, pC, pW, _ = m.run(Fd, X.copy(), Y.copy(), phi0)
        rw, rc = m.r_eff(T, m.RW), m.r_eff(T, m.RC)
        hw = mW < rw; hc = mC < rc
        def s(p): p = p[p >= 0]; return f'n{len(p)} med {np.median(p):.0f} q25 {np.percentile(p,25):.0f} q75 {np.percentile(p,75):.0f}' if len(p) else 'n0'
        print(f'T{T} D{D} rEff {rc:.0f}/{rw:.0f}  Choc {s(pC[hc])} | Wild {s(pW[hw])}', flush=True)
