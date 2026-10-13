"""When is it big at Choc? 2016-2026 climatology from buoy 44097 + ERA5 wind + CO-OPS tides."""
import json, glob, math, collections, datetime as dt
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
WMIN, WMAX = 115, 158
OFFSHORE = 335
LAG_H = 0            # buoy -> Choc travel time (knowledge doc: 12 s takes ~3-4 h)
FT = 3.28084


import glob
def load_buoy():
    b = {}
    for f in sorted(glob.glob('ndbc/44097h*.txt')) + sorted(glob.glob('ndbc/44097_2026_*.txt')) + ['ndbc/44097_realtime.txt']:
        for line in open(f):
            if line.startswith('#'): continue
            p = line.split()
            try:
                t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC)
                hs, dpd, mwd = float(p[8]), float(p[9]), float(p[11])
            except (ValueError, IndexError): continue
            if hs >= 99 or dpd >= 99 or mwd >= 999: continue
            b.setdefault(t.astimezone(ET), (hs * FT, dpd, mwd))
    return b

LAT, LON = 41.276, -71.963
def sun_times(d):
    n = d.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1)
    eq = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    ha = math.degrees(math.acos(math.cos(math.radians(90.833)) / (math.cos(math.radians(LAT)) * math.cos(dec)) - math.tan(math.radians(LAT)) * math.tan(dec)))
    noon = 720 - 4 * LON - eq
    base = dt.datetime(d.year, d.month, d.day, tzinfo=UTC)
    return (base + dt.timedelta(minutes=noon - 4 * ha)).astimezone(ET), (base + dt.timedelta(minutes=noon + 4 * ha)).astimezone(ET)
_sun = {}
def is_day(t):
    d = t.date()
    if d not in _sun: _sun[d] = sun_times(d)
    r, s = _sun[d]
    return r <= t <= s

