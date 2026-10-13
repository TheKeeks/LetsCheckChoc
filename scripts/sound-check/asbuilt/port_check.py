import sys, json, math, glob, numpy as np
sys.path.insert(0, '/home/user/LetsCheckChoc/scripts/rays')
import build_tables as B
G = 9.81
def fm(T, h):
    h = np.asarray(h, float); return G * T * T / (2 * math.pi) * np.tanh((2 * math.pi / T * np.sqrt(h / G)) ** 1.5) ** (2 / 3)
B.rc.wavelength = fm                                     # the production tables were made with this
prod = {}
for f in glob.glob('fwd2_[0-3].json'): prod.update(json.load(open(f)))
W = B.World('.')
for T, D in ((12, 140.0), (8, 165.0), (16, 205.0), (6, 115.0)):
    Fd = B.rc.speed_field(W.h, W.water, T, W.dx)
    X, Y, phi0 = W.crest(D)
    mC, mW, pC, pW, _ = W.run(Fd, X.copy(), Y.copy(), phi0)
    ic, iw = np.where(mC < B.NEAR)[0], np.where(mW < B.NEAR)[0]
    rec = dict(n=int(len(X)), c=[[int(mC[i]), int(round(pC[i]))] for i in ic], w=[[int(mW[i]), int(round(pW[i]))] for i in iw])
    p = prod[f'{T}_{D:g}']
    same = rec['n'] == p['n'] and rec['c'] == p['c'] and rec['w'] == p['w']
    extra = ''
    if 'rays' in p:
        hc, hw = mC < B.rc.landing_radius(T, B.RC), mW < B.rc.landing_radius(T, B.RW)
        n = len(X); ctx = list(range(0, n, max(1, n // 140)))
        ic2, iw2 = list(np.where(hc)[0]), list(np.where(hw)[0])
        sel = sorted(set(ctx) | set(ic2[::max(1, len(ic2) // 40)]) | set(iw2[::max(1, len(iw2) // 40)]))
        _, _, _, _, paths = W.run(Fd, X[sel].copy(), Y[sel].copy(), phi0, record_every=10)
        rays = [dict(h=('c' if hc[i] else '') + ('w' if hw[i] else ''), p=[int(round(v / 10)) for q in paths[j] for v in q]) for j, i in enumerate(sel)]
        extra = f'  pictures identical: {rays == p["rays"]} ({len(rays)} rays)'
    print(f'T={T} D={D:g}: rays {rec["n"]}, near Choc {len(rec["c"])}, near Wilderness {len(rec["w"])}; identical to production: {same}{extra}', flush=True)
