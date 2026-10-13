import sys
sys.argv = [sys.argv[0]]
import bend_split as B
for hours in ((17, 18), (17, 18, 19), (18,), (18, 19)):
    s = [B.split('2023-08-29', h) for h in hours]
    w = [x['choc_ft'] ** 2 for x in s]
    share = sum(x['choc_from_outside'] * wi for x, wi in zip(s, w)) / sum(w)
    print(hours, 'energy-weighted from outside', round(share, 1), [x['choc_from_outside'] for x in s], 'buoy', [x['buoy_ft'] for x in s])
