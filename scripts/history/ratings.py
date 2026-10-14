"""The surf log's part of the Sound Check, fitted again on every history update (surflog.py reads the log):

  the ratings model     what makes a good session: a small ridge regression of your ratings on modeled swell
                        energy at Choc, offshore wind and the tide's rate, with its leave-one-out scores, bootstrap
                        ranges, learning curve and per-input correlations (results4.json's model); its fit scores
                        every hour of the history, which gives the good days
  sess_pairs.json       each session's size rating against the best 3 hours of its day at the buoy and at Choc
  sessions_all.json     how well each daily measure of the buoy ranks the sessions by the size you rated
  research/fc/score.json  the forecast scorecard: what GFS-Wave forecast for Choc 1, 2 and 3 days before each
                        session, next to what the buoy-based model says arrived

The same arithmetic as the scripts that made them by hand from an export of the log
(scripts/sound-check/asbuilt/analyze4.py's model section, sess_pairs.py, sessions_all.py, fcscore.py), as functions of
their inputs, so a run on the same sessions gives the same numbers. Two differences: the sessions are taken in
time order (an export lists them newest-saved first, so editing one session would reshuffle the bootstrap), and
nothing a crew member wrote (the notes) goes into these public files.
"""
import math, random, statistics as st, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np

ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc; FT = 3.28084
MIN_SESSIONS = 10        # fewer sessions with conditions than this, and the stored model stays as it is

FEATS = ['swell', 'offshore', 'tide_rate']                       # the model (simplest of five sets tried; best LOO)
SCAT = ['swell', 'period', 'offshore', 'wind', 'tide_rate', 'tide_h']  # shown as scatter panels
FLABEL = {'swell': 'Modeled swell energy at Choc (log)', 'period': 'Swell period (s)', 'offshore': 'Offshore wind (kn, − = onshore)',
          'wind': 'Wind speed (kn)', 'tide_rate': 'Tide rate (ft/hr, + = incoming)', 'tide_h': 'Tide height (ft)'}


def total(xs):
    """xs added left to right (Python's sum() compensates for rounding from 3.12; these files were first built
    before that)"""
    t = 0
    for x in xs: t = t + x
    return t


def session_time(s):
    """a session's time: Eastern, to the minute"""
    return dt.datetime.fromisoformat(s['date']).replace(tzinfo=ET)


# ══ THE RATINGS MODEL ════════════════════════════════════════════════════════════════════════════════════════════
def ridge_fit(X, y, lam):
    mu, sd = X.mean(0), X.std(0); sd[sd == 0] = 1
    Z = (X - mu) / sd; ym_ = y.mean()
    b = np.linalg.solve(Z.T @ Z + lam * np.eye(Z.shape[1]), Z.T @ (y - ym_))
    return dict(mu=mu, sd=sd, b=b, c=ym_)
def ridge_pred(m, X): return m['c'] + ((X - m['mu']) / m['sd']) @ m['b']
def loo(X, y, lam):
    p = np.zeros(len(y))
    for i in range(len(y)):
        k = np.arange(len(y)) != i; p[i] = ridge_pred(ridge_fit(X[k], y[k], lam), X[i:i + 1])[0]
    return p
def r2(y, p): return 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum()
def spear(a, b):
    ra = np.argsort(np.argsort(a)); rb = np.argsort(np.argsort(b)); return float(np.corrcoef(ra, rb)[0, 1])


def fit_model(sessions, feats_at, scat_at):
    """the ratings model fitted to the sessions (surflog.sessions()), or None with fewer than MIN_SESSIONS that have
    conditions. feats_at(t) / scat_at(t): the model's three inputs and the six scatter inputs at an Eastern hour
    (analyze.py), None where the history has no buoy, wind or tide that hour."""
    S = []
    for r in sessions:
        t = session_time(r).replace(minute=0)
        f = feats_at(t)
        if f is None: continue
        S.append(dict(t=t, x=f, sx=scat_at(t), size=float(r['size']), wind_q=float(r['windQuality']), ride=float(r['rideQuality']),
                      avg=float(r['avg'])))
    S.sort(key=lambda s: s['t'])
    if len(S) < MIN_SESSIONS: return None
    X = np.array([s['x'] for s in S])
    LAMS = [0.3, 1, 3, 10, 30]
    XS = np.array([s['sx'] for s in S])
    models = {}
    rs = np.random.RandomState(2)                 # the same draws as the hand-run script's np.random.seed(2)
    for target in ['avg', 'size', 'ride', 'wind_q']:
        y = np.array([s[target] for s in S])
        scores = {lam: r2(y, loo(X, y, lam)) for lam in LAMS}
        lam = max(scores, key=scores.get)
        p = loo(X, y, lam); full = ridge_fit(X, y, lam)
        # bootstrap sign stability of standardized coefficients
        B = []
        for _ in range(2000):
            idx = rs.randint(0, len(y), len(y))
            if len(set(idx)) < 8: continue
            B.append(ridge_fit(X[idx], y[idx], lam)['b'])
        B = np.array(B)
        # prequential: predict each session from earlier sessions only
        preq = []
        for i in range(6, len(y)):
            m = ridge_fit(X[:i], y[:i], lam)
            preq.append(dict(i=i + 1, date=S[i]['t'].strftime('%Y-%m-%d'), actual=float(y[i]),
                             model=float(np.clip(ridge_pred(m, X[i:i + 1])[0], 0, 10)), base=float(y[:i].mean())))
        # univariate correlations for the scatter panels
        uni = {f: round(spear(XS[:, j], y), 2) for j, f in enumerate(SCAT)}
        models[target] = dict(lam=lam, loo_r2=round(scores[lam], 2), loo_rho=round(spear(y, p), 2),
                              mae=round(float(np.abs(y - p).mean()), 2), mae_base=round(float(np.abs(y - np.array([(y.sum() - v) / (len(y) - 1) for v in y])).mean()), 2),
                              coef=[round(float(v), 2) for v in full['b']],
                              coef_lo=[round(float(v), 2) for v in np.percentile(B, 5, axis=0)],
                              coef_hi=[round(float(v), 2) for v in np.percentile(B, 95, axis=0)],
                              sign_pos=[round(float(v), 2) for v in (B > 0).mean(0)],
                              uni=uni, loo_pred=[round(float(v), 2) for v in p], preq=preq,
                              fit=dict(mu=full['mu'].tolist(), sd=full['sd'].tolist(), b=full['b'].tolist(), c=float(full['c'])))
    return dict(feats=FEATS, scat=SCAT, labels=FLABEL, targets=models,
                sessions=[dict(date=s['t'].strftime('%Y-%m-%d %H:%M'), x=[round(v, 3) for v in s['sx']], size=s['size'], ride=s['ride'],
                               wind_q=s['wind_q'], avg=s['avg']) for s in S])


# ══ SIZE AT THE REEF AND AT THE BUOY (sess_pairs.json) ═══════════════════════════════════════════════════════════
def sess_pairs(sessions, cspec):
    """[date, size rating, buoy ft, Choc ft] per session, sorted: the best 3 hours of its Eastern day at the buoy (its
    spectrum's height) and modeled at Choc. cspec: {UTC hour 'YYYY-MM-DDTHH': [buoy ft, Choc ft, ...]} (spectra.py).
    A session whose day the history doesn't cover is left out."""
    def best3(day, idx):
        v = []
        for hr in range(24):
            k = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H')
            v.append(cspec[k][idx] if k in cspec else None)
        best = None
        for i in range(22):
            w = [x for x in v[i:i + 3] if x is not None]
            if len(w) >= 2: m = total(w) / len(w); best = m if best is None or m > best else best
        return best
    out = []
    for r in sessions:
        d = dt.date.fromisoformat(r['date'][:10])
        b, m = best3(d, 0), best3(d, 1)
        if b is not None and m is not None: out.append([r['date'][:10], int(float(r['size'])), round(b, 4), round(m, 4)])
    out.sort()
    return out


# ══ WHICH READING OF THE BUOY RANKS THE SESSIONS (sessions_all.json) ═════════════════════════════════════════════
def power(hs_ft, per): return 0.49 * (hs_ft / FT) ** 2 * 0.9 * per
def w_strict(d): return 1.0 if 115 <= d <= 158 else 0.0
def w_soft(d):
    if 115 <= d <= 158: return 1.0
    if 100 <= d < 115: return (d - 100) / 15
    if 158 < d <= 175: return (175 - d) / 17
    return 0.0
def rank(a):
    s = sorted(range(len(a)), key=lambda i: a[i]); r = [0] * len(a); i = 0
    while i < len(a):
        j = i
        while j + 1 < len(a) and a[s[j + 1]] == a[s[i]]: j += 1
        for k in range(i, j + 1): r[s[k]] = (i + j) / 2
        i = j + 1
    return r
def spearman(x, y):
    return st.correlation(rank(x), rank(y))


def sessions_all(sessions, B):
    """{res: {measure: {n, rho, lo, hi}}, sessions: [...]}: each measure's rank correlation with the size ratings and
    its 95% bootstrap range. B: buoy 44097's readings, {Eastern hour: (Hs ft, period s, direction deg)}, without
    Montauk's fill (analyze.buoy_hours(f44097)). L, the swell the app saved with the session, is left out where the
    app saved none; a measure with fewer than 3 sessions is left out."""
    def hours(day):
        t0 = dt.datetime(day.year, day.month, day.day, tzinfo=ET)
        return [(t0 + dt.timedelta(hours=i)) for i in range(24)]
    def val(t, kind, wf=w_strict):
        r = B.get(t)
        if not r: return None
        hs, per, d = r
        return {'hs': hs, 'hs_in': hs * wf(d), 'pow': power(hs, per), 'pow_in': power(hs, per) * wf(d)}[kind]
    def best_mean(ts, kind, n, wf=w_strict):
        vals = [val(t, kind, wf) for t in ts]
        best = None
        for i in range(len(ts) - n + 1):
            win = [v for v in vals[i:i + n] if v is not None]
            if len(win) >= max(1, n // 2):
                m = total(win) / len(win); best = m if best is None or m > best else best
        return best
    def around(t, n):  # n-hour window centred on session hour
        c = t.replace(minute=0)
        return [c + dt.timedelta(hours=k) for k in range(-(n // 2), n - n // 2)]
    def day_daylight(t): return hours(t.date())
    M = {}
    M['A day peak height (any direction) — current animation'] = lambda t: max([v for v in (val(x, 'hs') for x in hours(t.date())) if v is not None], default=None)
    M['B day peak height, in window'] = lambda t: max([v for v in (val(x, 'hs_in') for x in day_daylight(t)) if v is not None], default=None)
    M['C day peak power, in window'] = lambda t: max([v for v in (val(x, 'pow_in') for x in day_daylight(t)) if v is not None], default=None)
    M['D best 3 h of in-window power'] = lambda t: best_mean(day_daylight(t), 'pow_in', 3)
    M['E best 6 h of in-window power'] = lambda t: best_mean(day_daylight(t), 'pow_in', 6)
    M['F daylight average in-window power'] = lambda t: best_mean(day_daylight(t), 'pow_in', len(day_daylight(t)))
    M['G best 6 h of in-window height'] = lambda t: best_mean(day_daylight(t), 'hs_in', 6)
    M['H height at the session hour (any direction)'] = lambda t: val(t.replace(minute=0), 'hs')
    M['I in-window power at the session hour'] = lambda t: val(t.replace(minute=0), 'pow_in')
    M['J 3 h in-window power around the session'] = lambda t: best_mean(around(t, 3), 'pow_in', 3)
    M['K 6 h in-window power around the session'] = lambda t: best_mean(around(t, 6), 'pow_in', 6)
    M['E* best 6 h in-window power, soft window edge'] = lambda t: best_mean(day_daylight(t), 'pow_in', 6, w_soft)
    M['D* best 3 h in-window power, soft window edge'] = lambda t: best_mean(day_daylight(t), 'pow_in', 3, w_soft)
    M['L swell height the app logged (forecast pin)'] = None

    sess = []
    for r in sessions:
        t = session_time(r)
        rec = dict(t=t, size=float(r['size']), L=r.get('swellH'))
        for k, f in M.items():
            rec[k] = rec['L'] if f is None else f(t)
        sess.append(rec)
    rnd = random.Random(1)                        # the same draws as the hand-run script's random.seed(1)
    res = {}
    for k in M:
        pairs = [(s[k], s['size']) for s in sess if s[k] is not None]
        if len(pairs) < 3: continue
        x = [p[0] for p in pairs]; y = [p[1] for p in pairs]
        try: rho = spearman(x, y)
        except st.StatisticsError: continue       # every session the same: nothing to rank
        boots = []
        for _ in range(4000):
            idx = [rnd.randrange(len(pairs)) for _ in pairs]
            bx = [x[i] for i in idx]; by = [y[i] for i in idx]
            try: boots.append(spearman(bx, by))
            except st.StatisticsError: pass
        if not boots: continue
        boots.sort()
        res[k] = dict(n=len(pairs), rho=round(rho, 2), lo=round(boots[int(.025 * len(boots))], 2), hi=round(boots[int(.975 * len(boots))], 2))
    return dict(res=res, sessions=[{k: (v.isoformat() if isinstance(v, dt.datetime) else v) for k, v in s.items()} for s in sess])


# ══ THE FORECAST SCORECARD (research/fc/score.json) ══════════════════════════════════════════════════════════════
class NotArchived(LookupError):
    """NOAA's archive has no such run (GFS-Wave's files there start in March 2021)"""


def _index(url, tries=3):
    """a GRIB file's .idx lines; NotArchived at once for a file that isn't there (fcpull.get would retry it for a
    minute, for every lead of every session before the archive starts)"""
    import urllib.request, urllib.error, time
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'LetsCheckChoc history'}), timeout=60) as r:
                return r.read().decode().splitlines()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404): raise NotArchived(url) from None
            if k == tries - 1: raise
        except OSError:
            if k == tries - 1: raise
        time.sleep(2 ** (k + 1))


def gfs_choc(t_utc, lead_d):
    """what GFS-Wave's run lead_d days before t forecast for Choc at t (ft): its swells at buoy 44097, carried to
    Choc as the forecast bot does (scripts/forecast/fcpull.py), from NOAA's archive on AWS"""
    import fcpull as P                              # scripts/forecast (numpy, eccodes): imported only when scoring
    issue = t_utc - dt.timedelta(days=lead_d); c = issue.replace(hour=issue.hour // 6 * 6, minute=0, second=0, microsecond=0)
    s = int(round((t_utc - c).total_seconds() / 3600))
    if s > 120: s = int(round(s / 3) * 3)
    u = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{c:%Y%m%d}/{c:%H}/wave/gridded/gfswave.t{c:%H}z.atlocn.0p16.f{s:03d}.grib2"
    idx = _index(u + '.idx'); offs = [int(l.split(':')[1]) for l in idx]
    f = {}
    for k, name in P.GFS_VARS.items():
        if k in ('wind', 'wdir', 'hs'): continue
        i = next(n for n, l in enumerate(idx) if (':'.join(l.split(':')[3:5])) == name)
        f[k] = P.decode(P.get(u, offs[i], (offs[i + 1] - 1) if i + 1 < len(offs) else ''))
    en = 0.0                                                 # the same read as fcpull: each train at buoy 44097
    for k in ('w1', 'w2', 'w3', 'ww'):
        q = P.at_buoy(f[k + 'h'], f[k + 't'], f[k + 'd'])
        if q: en += P.train_ft(*q, k, 'choc') ** 2
    return math.sqrt(en)


def scorecard(sessions, cspec, previous=None, forecast=None, budget=24, log=lambda *a: None):
    """{sessions: [{date, size, avg, buoy_model, d1, d2, d3}], summary: {buoy_model, d1, d2, d3: {n, rho_size, ...}}}.
    buoy_model: Choc's modeled height at the session's hour (cspec, the history's own); d1-d3: the forecasts.
    A forecast already in `previous` (the committed file) is kept: a past run never changes. New ones come from
    forecast(t_utc, lead) (gfs_choc), at most `budget` sessions a run; None (no forecast function, the archive
    has nothing, or the download failed) leaves that lead empty, to be asked again on the next run."""
    prev = {p['date']: p for p in (previous or {}).get('sessions', []) if isinstance(p, dict) and p.get('date')}
    res, asked = [], 0
    for r in sessions:
        t = session_time(r).astimezone(UTC).replace(minute=0, second=0)
        out = dict(date=r['date'][:16], size=float(r['size']), avg=float(r['avg']))
        k = t.strftime('%Y-%m-%dT%H'); out['buoy_model'] = cspec[k][1] if k in cspec else None
        old = prev.get(out['date'], {})
        todo = [L for L in (1, 2, 3) if old.get(f'd{L}') is None] if forecast and asked < budget else []
        if todo: asked += 1
        for L in (1, 2, 3):
            if L not in todo: out[f'd{L}'] = old.get(f'd{L}'); continue
            try: out[f'd{L}'] = round(forecast(t, L), 2)
            except Exception as e: out[f'd{L}'] = None; log('  no forecast', r['date'], L, e)
        res.append(out)
    def spearman_np(x, y):
        rx = np.argsort(np.argsort(x)); ry = np.argsort(np.argsort(y)); return float(np.corrcoef(rx, ry)[0, 1])
    summ = {}
    for key in ('buoy_model', 'd1', 'd2', 'd3'):
        ok = [x for x in res if x.get(key) is not None]
        if len(ok) < 3: continue
        summ[key] = dict(n=len(ok), rho_size=round(spearman_np([x[key] for x in ok], [x['size'] for x in ok]), 2))
        if key != 'buoy_model':
            both = [x for x in ok if x.get('buoy_model') is not None]
            if not both: continue
            summ[key]['median_vs_arrived_ft'] = round(float(np.median([x[key] - x['buoy_model'] for x in both])), 2)
            summ[key]['typical_miss_ft'] = round(float(np.median([abs(x[key] - x['buoy_model']) for x in both])), 2)
    return dict(sessions=res, summary=summ)
