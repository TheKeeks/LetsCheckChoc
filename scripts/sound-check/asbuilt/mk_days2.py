import json, datetime as dt, collections, math, glob
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
C = json.load(open('spec_choc.json')); W = json.load(open('spec_wild.json'))
w = json.load(open('wind_sea.json'))['hourly']
wind = {t: (s, d) for t, s, d in zip(w['time'], w['wind_speed_10m'], w['wind_direction_10m']) if s is not None}
# buoy peak direction/period per hour from stdmet
B = {}
for f in sorted(glob.glob('ndbc/44097h*.txt')) + sorted(glob.glob('ndbc/44097_2026_*.txt')) + ['ndbc/44097_realtime.txt']:
    for line in open(f):
        if line.startswith('#'): continue
        p = line.split()
        try: t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC); per, d = float(p[9]), float(p[11])
        except (ValueError, IndexError): continue
        if per < 99 and d < 999: B.setdefault(t.strftime('%Y-%m-%dT%H'), (per, d))
gap = lambda a, b: abs((a - b + 180) % 360 - 180)
days = collections.defaultdict(list)
for k, (hb, hc) in C.items():
    if k not in W: continue
    t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
    days[t.date()].append((t.hour, hb, hc, W[k][1], wind.get(t.strftime('%Y-%m-%dT%H:00')), B.get(k)))
def best(v, j):
    b, bi = -1, None
    for i in range(len(v) - 2):
        if v[i + 2][0] - v[i][0] > 3: continue
        m = sum(x[j] for x in v[i:i + 3]) / 3
        if m > b: b, bi = m, i
    return (round(b, 1), v[bi:bi + 3]) if bi is not None else (None, [])
out = {}
for d, v in days.items():
    v.sort()
    if len(v) < 6: continue
    bc, wc = best(v, 2); bw, ww = best(v, 3)
    def wsum(win, off, sect):
        ws = [x[4] for x in win if x[4]]
        if not ws: return None
        sx = sum(s * math.sin(math.radians(a)) for s, a in ws); cx = sum(s * math.cos(math.radians(a)) for s, a in ws)
        dd = round(math.degrees(math.atan2(sx, cx)) % 360); sp = round(sum(s for s, _ in ws) / len(ws))
        return [dd, sp, int(sp < 6 or gap(dd, off) <= sect)]
    pk = max(v, key=lambda x: x[1]); sw = pk[5] or (None, None)
    out[d.isoformat()] = [round(pk[1], 1), sw[1] and round(sw[1]), sw[0] and round(sw[0], 1), bc, bw, wsum(wc, 335, 60), wsum(ww, 40, 70), wc[0][0] if wc else None, ww[0][0] if ww else None]
json.dump(out, open('days2.json', 'w'), separators=(',', ':'))
print(len(out), out.get('2022-10-14'), out.get('2024-04-04'))