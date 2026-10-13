import json, datetime as dt, collections
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
C = json.load(open('spec_choc.json')); W = json.load(open('spec_wild.json'))
w = json.load(open('wind_sea.json'))['hourly']
wind = {t: (s, d) for t, s, d in zip(w['time'], w['wind_speed_10m'], w['wind_direction_10m']) if s is not None}
gap = lambda a, b: abs((a - b + 180) % 360 - 180)
hours = collections.defaultdict(list)
for k, (hb, hc) in C.items():
    if k not in W: continue
    t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
    lw = wind.get(t.strftime('%Y-%m-%dT%H:00'))
    if not lw: continue
    s, d = lw
    hours[t.date()].append((t.hour, hc, W[k][1], s < 6 or gap(d, 335) <= 60, s < 6 or gap(d, 40) <= 70))
st = json.load(open('wild_stats.json'))
cnt = collections.Counter(); ex = []
for d, v in hours.items():
    v.sort()
    for i in range(len(v) - 2):
        win = v[i:i + 3]
        if win[2][0] - win[0][0] > 3: continue
        wild_ok = all(x[2] >= 2.5 and x[4] for x in win); choc_ok = all(x[1] >= 2.5 and x[3] for x in win)
        if wild_ok and not choc_ok: cnt[d.month] += 1; ex.append(str(d)); break
for m in st['months']:
    i = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split().index(m['month']) + 1
    m['wild_day'] = round(100 * cnt[i] / m['days'], 1)
st['wild_days_total'] = sum(cnt.values()); st['wild_examples'] = ex[-8:]
json.dump(st, open('wild_stats.json', 'w'))
print(st['wild_days_total'], [m['wild_day'] for m in st['months']], ex[-8:])