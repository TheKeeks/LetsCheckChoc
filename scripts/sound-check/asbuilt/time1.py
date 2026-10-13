import time, sys
t0 = time.time()
import fwdprod2 as F
print('setup', round(time.time() - t0, 1), 's  grid', F.R, 'x', F.C, flush=True)
for T, D in ((12, 140.0), (8, 180.0)):
    t1 = time.time(); Fd = F.fields(T); t2 = time.time()
    X, Y, phi0 = F.crest(D)
    mC, mW, pC, pW, _ = F.run(Fd, X.copy(), Y.copy(), phi0)
    t3 = time.time()
    print(T, D, 'fields', round(t2 - t1, 1), 's  run', round(t3 - t2, 1), 's  rays', len(X), ' within 250 m of Choc', int((mC < 250).sum()), flush=True)
