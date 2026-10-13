"""The Wilderness numbers in the page text, old (fm_backup/) vs new: 12 Oct 2025 session, rank, shape read spread."""
import json, datetime as dt, collections
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
key = lambda d, h: dt.datetime(d.year, d.month, d.day, h, tzinfo=ET).astimezone(UTC).strftime('%Y-%m-%dT%H')
for tag, pre in (('old', 'fm_backup/'), ('new', '')):
    W = json.load(open(pre + 'fwd2spec_wild_s1.json')); C = json.load(open(pre + 'fwd2spec_choc_s1.json'))
    d = dt.date(2025, 10, 12)
    hrs = [h for h in (15, 16, 17) if key(d, h) in W]
    print(tag, '12 Oct 2025 15-17h wild', [W[key(d, h)][1] for h in hrs], 'choc', [C[key(d, h)][1] for h in hrs], 'peel', [round(W[key(d, h)][2], 3) for h in hrs])
    # best 3 h per day at Wilderness, rank of 12 Oct 2025
    days = collections.defaultdict(list)
    for k, v in W.items():
        t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET); days[t.date()].append((t.hour, v[1], v[2]))
    best = {}; peel = {}
    for dd, v in days.items():
        v.sort(); b = None
        for i in range(len(v) - 2):
            win = v[i:i + 3]
            if win[2][0] - win[0][0] > 3: continue
            m = sum(x[1] for x in win) / 3
            if b is None or m > b[0]: b = (m, sum(x[2] for x in win) / 3)
        if b: best[dd] = b[0]; peel[dd] = b[1]
    order = sorted(best, key=lambda x: -best[x])
    print(tag, '  rank of 12 Oct 2025', order.index(d) + 1, 'of', len(order), 'best3h', round(best[d], 2))
    p = np.array(list(peel.values())); print(tag, '  daily shape read 2.5/5/10/90/95/97.5%:', np.round(np.percentile(p, [2.5, 5, 10, 90, 95, 97.5]), 3))
    D = json.load(open(pre + 'days2.json'))
    for lab, sel in (('east 0-120', lambda v: v[1] is not None and v[1] < 120), ('SE 120-160', lambda v: v[1] is not None and 120 <= v[1] < 160),
                     ('S-SW 160-250', lambda v: v[1] is not None and 160 <= v[1] < 250), ('T<9', lambda v: v[2] is not None and v[2] < 9),
                     ('T 9-12', lambda v: v[2] is not None and 9 <= v[2] < 12), ('T>=12', lambda v: v[2] is not None and v[2] >= 12)):
        ks = [k for k, v in D.items() if sel(v) and v[4] is not None and v[4] >= 1.5 and dt.date.fromisoformat(k) in peel]
        r = [D[k][4] / D[k][3] for k in ks if D[k][3]]
        print(tag, f'  {lab}: n {len(ks)} median peel {np.median([peel[dt.date.fromisoformat(k)] for k in ks]):.3f}  wild/choc {np.median(r):.2f}')
