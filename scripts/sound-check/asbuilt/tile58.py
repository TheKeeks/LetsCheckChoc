import sys, csv, datetime as dt, numpy as np
sys.argv = [sys.argv[0]]
import bend_split as B
rows = [r for r in csv.DictReader(open('surflog.csv')) if r['date'].startswith('2023-08-29')]
res = []
for r in rows:
    t = dt.datetime.fromisoformat(r['date'])
    for h in sorted({t.hour, (t + dt.timedelta(minutes=30)).hour}):
        s = B.split('2023-08-29', h)
        if s: res.append((h, s['choc_from_outside'], s['choc_ft']))
print('session hours', res)
