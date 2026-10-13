"""Reproduce the page's Wilderness size sentence (721 days vs Choc's 954, beats Choc by 0.5 ft+ on 21 days) from spec_*.json."""
import json, sys, datetime as dt, collections
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
pre = sys.argv[1] if len(sys.argv) > 1 else ''
C = json.load(open(pre + 'spec_choc.json')); W = json.load(open(pre + 'spec_wild.json'))
hours = collections.defaultdict(list)
for k, (hb, hc) in C.items():
    if k not in W: continue
    t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
    hours[t.date()].append((t.hour, hc, W[k][1], hb))
res = collections.Counter()
for d, v in hours.items():
    v.sort(); bc = bw = None
    for i in range(len(v) - 2):
        win = v[i:i + 3]
        if win[2][0] - win[0][0] > 3: continue
        mc = sum(x[1] for x in win) / 3; mw = sum(x[2] for x in win) / 3
        bc = mc if bc is None or mc > bc else bc; bw = mw if bw is None or mw > bw else bw
        if all(x[2] >= 2.5 for x in win): res['w3h'] += 0
    if bc is None: continue
    res['days'] += 1
    res['c_best'] += bc >= 2.5; res['w_best'] += bw >= 2.5; res['beat_best'] += bw - bc >= 0.5
    okw = any(all(x[2] >= 2.5 for x in v[i:i + 3]) and v[i + 2][0] - v[i][0] <= 3 for i in range(len(v) - 2))
    okc = any(all(x[1] >= 2.5 for x in v[i:i + 3]) and v[i + 2][0] - v[i][0] <= 3 for i in range(len(v) - 2))
    res['c_3h'] += okc; res['w_3h'] += okw
    res['beat_hour'] += any(x[2] - x[1] >= 0.5 and x[2] >= 2.5 for x in v)
    res['beat_best_w25'] += bw - bc >= 0.5 and bw >= 2.5
print(dict(res))
