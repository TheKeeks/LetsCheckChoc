"""Add the shape (peel) read to wild_stats.json, from the hourly Wilderness peel share
(fwd2spec_wild_*.json, third value: share of arriving energy meeting the contours at 30 deg+).
A 'Wilderness day' is now: 3 hours with Wilderness 2.5 ft+, wind it likes, and it peels (share >= 0.5)."""
import json, sys, datetime as dt, collections
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
tag = sys.argv[1] if len(sys.argv) > 1 else 's1'
P = json.load(open(f'fwd2spec_wild_{tag}.json'))
w = json.load(open('wind_sea.json'))['hourly']
wind = {t: (s, d) for t, s, d in zip(w['time'], w['wind_speed_10m'], w['wind_direction_10m']) if s is not None}
gap = lambda a, b: abs((a - b + 180) % 360 - 180)
st = json.load(open('wild_stats.json'))
hours = collections.defaultdict(list)
for k, v in P.items():
    t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
    lw = wind.get(t.strftime('%Y-%m-%dT%H:00'))
    ok = bool(lw) and (lw[0] < 6 or gap(lw[1], 40) <= 70)
    hours[t.date()].append((t.hour, v[1], v[2], ok))
cnt = collections.Counter(); ex = []; daypeel = {}
for d, v in hours.items():
    v.sort(); hit = False; best = None
    for i in range(len(v) - 2):
        win = v[i:i + 3]
        if win[2][0] - win[0][0] > 3: continue
        h = sum(x[1] for x in win) / 3; p = sum(x[2] for x in win) / 3
        if best is None or h > best[0]: best = (h, p)
        if not hit and all(x[1] >= 2.5 and x[3] for x in win) and p >= 0.5: hit = True
    if best: daypeel[str(d)] = round(best[1], 2)
    if hit: cnt[d.month] += 1; ex.append(str(d))
# the peel read is experimental: it only annotates the table; 'Wilderness days' stay size + wind
for t in st['top']: t['peel'] = daypeel.get(t['date'])
st['peel_days_total'] = sum(cnt.values())
st['peel_share_days'] = round(sum(1 for p in daypeel.values() if p >= 0.5) / max(1, len(daypeel)), 3)
json.dump(st, open('wild_stats.json', 'w'))
print('wilderness days', st['wild_days_total'], 'peel days', st['peel_days_total'], 'share of days peeling', st['peel_share_days'])
print('2025-10-12 peel', daypeel.get('2025-10-12'))
