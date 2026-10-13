import json, datetime as dt, collections, math
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
C = json.load(open('spec_choc.json')); W = json.load(open('spec_wild.json'))
w = json.load(open('wind_sea.json'))['hourly']
wind = {t: (s, d) for t, s, d in zip(w['time'], w['wind_speed_10m'], w['wind_direction_10m']) if s is not None}
gap = lambda a, b: abs((a - b + 180) % 360 - 180)
days = collections.defaultdict(list)
for k, (hb, hc) in C.items():
    t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
    if k not in W: continue
    lw = wind.get(t.strftime('%Y-%m-%dT%H:00'))
    days[t.date()].append((t.hour, hb, hc, W[k][1], lw))
def best3(v, j):
    v = sorted(v); best, bi = None, None
    for i in range(len(v) - 2):
        win = v[i:i + 3]
        if win[2][0] - win[0][0] > 3: continue
        m = sum(x[j] for x in win) / 3
        if best is None or m > best: best, bi = m, i
    return best, (v[bi:bi + 3] if bi is not None else [])
THR = 2.5
mon = collections.defaultdict(lambda: [0, 0, 0, 0, 0])   # days, choc>=thr, wild>=thr, wild>=thr & east/offshore wind, wild beats choc by 0.5
top = []
for d, v in days.items():
    if len(v) < 18: continue
    bc, _ = best3(v, 2); bw, win = best3(v, 3)
    if bc is None or bw is None: continue
    ws = [x[4] for x in win if x[4]]
    good_wind = bool(ws) and all(s < 6 or gap(dd, 40) <= 70 for s, dd in ws)
    m = mon[d.month]; m[0] += 1; m[1] += bc >= THR; m[2] += bw >= THR; m[3] += (bw >= THR and good_wind); m[4] += (bw >= THR and bw - bc >= 0.5)
    top.append((round(bw, 1), str(d), round(bc, 1), round(max(x[1] for x in win), 1), good_wind, [round(x[4][1]) for x in win if x[4]][:1]))
M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
res = dict(thr=THR, months=[dict(month=M[i - 1], days=mon[i][0], choc=round(100 * mon[i][1] / mon[i][0], 1), wild=round(100 * mon[i][2] / mon[i][0], 1),
           wild_wind=round(100 * mon[i][3] / mon[i][0], 1), wild_beats=round(100 * mon[i][4] / mon[i][0], 1)) for i in range(1, 13)])
top.sort(reverse=True)
res['top'] = [dict(date=t[1], wild=t[0], choc=t[2], buoy=t[3], wind_ok=t[4], wdir=t[5][0] if t[5] else None) for t in top[:12]]
# beat days by swell direction: daily dominant (peak hour) direction from buoy stdmet is not here; summarize ratio
tot = sum(mon[i][0] for i in mon)
print('days', tot, 'wild>=thr', sum(mon[i][2] for i in mon), 'choc>=thr', sum(mon[i][1] for i in mon), 'wild beats', sum(mon[i][4] for i in mon), 'wild+wind', sum(mon[i][3] for i in mon))
for m in res['months']: print(m)
for t in res['top']: print(t)
json.dump(res, open('wild_stats.json', 'w'))