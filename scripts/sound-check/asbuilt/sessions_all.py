import csv, math, random, statistics as st, datetime as dt, json
import analyze_helpers as h
ET = h.ET; B = h.load_buoy()
rows = list(csv.DictReader(open('surflog.csv')))
def power(hs_ft, per): return 0.49 * (hs_ft / h.FT) ** 2 * 0.9 * per
def w_strict(d): return 1.0 if 115 <= d <= 158 else 0.0
def w_soft(d):
    if 115 <= d <= 158: return 1.0
    if 100 <= d < 115: return (d - 100) / 15
    if 158 < d <= 175: return (175 - d) / 17
    return 0.0
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
            m = sum(win) / len(win); best = m if best is None or m > best else best
    return best
def around(t, n):  # n-hour window centred on session hour
    c = t.replace(minute=0)
    return [c + dt.timedelta(hours=k) for k in range(-(n // 2), n - n // 2)]

M = {}  # metric name -> fn(session_time) ; daylight-only for day metrics
def day_daylight(t): return hours(t.date())
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

sess = []
for r in rows:
    t = dt.datetime.fromisoformat(r['date']).replace(tzinfo=ET)
    rec = dict(t=t, size=float(r['size']), notes=r['notes'][:40], L=float(r['swellH']))
    for k, f in M.items():
        rec[k] = rec['L'] if f is None else f(t)
    sess.append(rec)
print('sessions', len(sess))
for s in sorted(sess, key=lambda s: s['t']):
    print(s['t'].strftime('%Y-%m-%d %H:%M'), s['size'], '| A', round(s[list(M)[0]] or -1, 1), 'B', round(s[list(M)[1]] or 0, 1), 'E', round(s[list(M)[4]] or 0, 1), 'E*', round(s[list(M)[11]] or 0, 1), 'I', round(s[list(M)[8]] or 0, 1))
random.seed(1)
res = {}
for k in M:
    pairs = [(s[k], s['size']) for s in sess if s[k] is not None]
    x = [p[0] for p in pairs]; y = [p[1] for p in pairs]
    rho = spearman(x, y)
    boots = []
    for _ in range(4000):
        idx = [random.randrange(len(pairs)) for _ in pairs]
        bx = [x[i] for i in idx]; by = [y[i] for i in idx]
        try: boots.append(spearman(bx, by))
        except st.StatisticsError: pass
    boots.sort()
    res[k] = dict(n=len(pairs), rho=round(rho, 2), lo=round(boots[int(.025 * len(boots))], 2), hi=round(boots[int(.975 * len(boots))], 2))
for k, v in sorted(res.items(), key=lambda kv: -kv[1]['rho']): print(f"{v['rho']:+.2f} [{v['lo']:+.2f},{v['hi']:+.2f}] n={v['n']}  {k}")
# paired bootstrap: E vs A, D vs C, E vs I
def paired(k1, k2):
    pairs = [(s[k1], s[k2], s['size']) for s in sess if s[k1] is not None and s[k2] is not None]
    d = []
    for _ in range(4000):
        idx = [random.randrange(len(pairs)) for _ in pairs]
        try: d.append(spearman([pairs[i][0] for i in idx], [pairs[i][2] for i in idx]) - spearman([pairs[i][1] for i in idx], [pairs[i][2] for i in idx]))
        except st.StatisticsError: pass
    d.sort(); return round(st.mean(d), 2), round(d[int(.025 * len(d))], 2), round(d[int(.975 * len(d))], 2), round(100 * sum(v > 0 for v in d) / len(d))
names = list(M)
for a, b in [(4, 0), (4, 2), (3, 2), (4, 3), (4, 8), (11, 4), (4, 5)]:
    print('paired', names[a][:30], 'minus', names[b][:30], paired(names[a], names[b]))
json.dump(dict(res=res, sessions=[{k: (v.isoformat() if isinstance(v, dt.datetime) else v) for k, v in s.items()} for s in sess]), open('sessions_all.json', 'w'), indent=1)
