"""The 28 logged sessions for the page's 'size at the reef vs at the buoy' chart: date, size rating, and the best
3 hours of that day at the Block Island buoy and modeled at Choc (same inputs as simple_stats.py / the 0.85 check)."""
import json, csv, datetime as dt
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
src = json.load(open('fwd2spec_choc_s1.json'))
def best3(day, idx):
    v = []
    for hr in range(24):
        k = dt.datetime(day.year, day.month, day.day, hr, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H')
        v.append(src[k][idx] if k in src else None)
    best = None
    for i in range(22):
        w = [x for x in v[i:i + 3] if x is not None]
        if len(w) >= 2: m = sum(w) / len(w); best = m if best is None or m > best else best
    return best
out = []
for r in csv.DictReader(open('surflog.csv')):
    d = dt.datetime.fromisoformat(r['date']).date()
    b, m = best3(d, 0), best3(d, 1)
    if b is not None and m is not None: out.append([r['date'][:10], int(float(r['size'])), round(b, 4), round(m, 4)])
out.sort()
json.dump(out, open('sess_pairs.json', 'w'), separators=(',', ':'))
print(len(out), out[:3])
