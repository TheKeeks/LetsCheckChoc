"""The per-day tables the Sound Check page reads beside results4.json, from the hourly heights (spectra.py), the
over-water wind and the buoy's own readings. The same arithmetic as the scripts that built the history
(scripts/sound-check/asbuilt/mk_days2.py, mk_wildstats.py, mk_wildstats2.py, mk_wildpeel.py, and the wind-grid step):

  days2       per Eastern day with 6+ hours: the buoy's peak, its period and direction, the best 3 hours at Choc and
              at Wilderness, the wind over each of those windows and whether each spot liked it, when they start
  wild_stats  Wilderness vs Choc by month (days 2.5 ft+, with wind it likes, when it beats Choc), its biggest days,
              the days it worked when Choc didn't, and the peel read
  windgrid    the daily wind at 17 over-water points (ECMWF IFS since 2017, ERA5 for 2016) for the map's arrows,
              the over-water cell's daily mean where a point has no value
  wind_lane   research/ocean/day/<year>.json's 'wind' lane: the over-water wind every hour, keyed by UTC hour
  tide_lane   and its 'tide' lane: the day's highs and lows, keyed by Eastern date
"""
import collections, math, datetime as dt
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc
M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
def gap(a, b): return abs((a - b + 180) % 360 - 180)

def total(xs):
    """xs added left to right, as Python's sum() added floats until 3.12 (which compensates for rounding): the history
    was built that way, so it comes out the same on any Python"""
    t = 0
    for x in xs: t = t + x
    return t



def two(heights):
    """{UTC hour: [buoy ft, spot ft]} (the pages' older spec_*.json form) from spectra.py's [buoy ft, spot ft, peel]"""
    return {k: v[:2] for k, v in heights.items()}


def wind_by_hour(hourly, offset=None):
    """ERA5's over-water cell → {'YYYY-MM-DDTHH:00' Eastern: (kn, from deg)}, each label placed by sea_utc with the
    series' UTC offset (in November the repeated 1 AM keeps its first hour, as the buoy's tables do)"""
    out = {}
    for u, s, d in zip(sea_utc(hourly['time'], offset), hourly['wind_speed_10m'], hourly['wind_direction_10m']):
        if u is not None and s is not None: out.setdefault(u.astimezone(ET).strftime('%Y-%m-%dT%H:00'), (s, d))
    return out


def per_dir(f44097):
    """{UTC hour: (DPD s, MWD deg)} from 44097's stdmet files in order of precedence (the first reading of an hour wins)"""
    B = {}
    for text in f44097:
        for line in text.splitlines():
            if line.startswith('#'): continue
            p = line.split()
            try: t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC); per, d = float(p[9]), float(p[11])
            except (ValueError, IndexError): continue
            if per < 99 and d < 999: B.setdefault(t.strftime('%Y-%m-%dT%H'), (per, d))
    return B


def days2(C, W, wind, B):
    """days2.json: {day: [buoy peak ft, its direction, its period, Choc best 3 h ft, Wilderness best 3 h ft,
    Choc's wind [dir, kn, liked], Wilderness's wind [dir, kn, liked], Choc's start hour, Wilderness's start hour]}"""
    days = collections.defaultdict(list)
    for k, (hb, hc) in C.items():
        if k not in W: continue
        t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
        days[t.date()].append((t.hour, hb, hc, W[k][1], wind.get(t.strftime('%Y-%m-%dT%H:00')), B.get(k)))
    def best(v, j):
        b, bi = -1, None
        for i in range(len(v) - 2):
            if v[i + 2][0] - v[i][0] > 3: continue
            m = total(x[j] for x in v[i:i + 3]) / 3
            if m > b: b, bi = m, i
        return (round(b, 1), v[bi:bi + 3]) if bi is not None else (None, [])
    def wsum(win, off, sect):
        ws = [x[4] for x in win if x[4]]
        if not ws: return None
        sx = total(s * math.sin(math.radians(a)) for s, a in ws); cx = total(s * math.cos(math.radians(a)) for s, a in ws)
        dd = round(math.degrees(math.atan2(sx, cx)) % 360); sp = round(total(s for s, _ in ws) / len(ws))
        return [dd, sp, int(sp < 6 or gap(dd, off) <= sect)]
    out = {}
    for d, v in days.items():
        v.sort()
        if len(v) < 6: continue
        bc, wc = best(v, 2); bw, ww = best(v, 3)
        pk = max(v, key=lambda x: x[1]); sw = pk[5] or (None, None)
        out[d.isoformat()] = [round(pk[1], 1), sw[1] and round(sw[1]), sw[0] and round(sw[0], 1), bc, bw, wsum(wc, 335, 60), wsum(ww, 40, 70),
                              wc[0][0] if wc else None, ww[0][0] if ww else None]
    return out


def wild_stats(C, W, PW, wind):
    """wild_stats.json. C, W: {UTC hour: [buoy ft, spot ft]}; PW: Wilderness's [buoy ft, ft, peel share]"""
    THR = 2.5
    # Wilderness vs Choc by month, and its biggest days (mk_wildstats.py)
    days = collections.defaultdict(list)
    for k, (hb, hc) in C.items():
        t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
        if k not in W: continue
        days[t.date()].append((t.hour, hb, hc, W[k][1], wind.get(t.strftime('%Y-%m-%dT%H:00'))))
    def best3(v, j):
        v = sorted(v); best, bi = None, None
        for i in range(len(v) - 2):
            win = v[i:i + 3]
            if win[2][0] - win[0][0] > 3: continue
            m = total(x[j] for x in win) / 3
            if best is None or m > best: best, bi = m, i
        return best, (v[bi:bi + 3] if bi is not None else [])
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
    pc = lambda a, n: round(100 * a / n, 1) if n else 0.0       # (a month with no full day: only in a short history)
    st = dict(thr=THR, months=[dict(month=M[i - 1], days=mon[i][0], choc=pc(mon[i][1], mon[i][0]), wild=pc(mon[i][2], mon[i][0]),
              wild_wind=pc(mon[i][3], mon[i][0]), wild_beats=pc(mon[i][4], mon[i][0])) for i in range(1, 13)])
    top.sort(reverse=True)
    st['top'] = [dict(date=t[1], wild=t[0], choc=t[2], buoy=t[3], wind_ok=t[4], wdir=t[5][0] if t[5] else None) for t in top[:12]]

    # days Wilderness worked (3 hours 2.5 ft+ with wind it likes) and Choc didn't (mk_wildstats2.py)
    hours = collections.defaultdict(list)
    for k, (hb, hc) in C.items():
        if k not in W: continue
        t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
        lw = wind.get(t.strftime('%Y-%m-%dT%H:00'))
        if not lw: continue
        s, d = lw
        hours[t.date()].append((t.hour, hc, W[k][1], s < 6 or gap(d, 335) <= 60, s < 6 or gap(d, 40) <= 70))
    cnt = collections.Counter(); ex = []
    for d, v in hours.items():
        v.sort()
        for i in range(len(v) - 2):
            win = v[i:i + 3]
            if win[2][0] - win[0][0] > 3: continue
            wild_ok = all(x[2] >= 2.5 and x[4] for x in win); choc_ok = all(x[1] >= 2.5 and x[3] for x in win)
            if wild_ok and not choc_ok: cnt[d.month] += 1; ex.append(str(d)); break
    for m in st['months']:
        i = M.index(m['month']) + 1
        m['wild_day'] = pc(cnt[i], m['days'])
    st['wild_days_total'] = sum(cnt.values()); st['wild_examples'] = ex[-8:]

    # the peel read: share of the arriving energy meeting the contours at 30 deg+ over the best 3 hours (mk_wildpeel.py)
    hours = collections.defaultdict(list)
    for k, v in PW.items():
        t = dt.datetime.strptime(k, '%Y-%m-%dT%H').replace(tzinfo=UTC).astimezone(ET)
        lw = wind.get(t.strftime('%Y-%m-%dT%H:00'))
        ok = bool(lw) and (lw[0] < 6 or gap(lw[1], 40) <= 70)
        hours[t.date()].append((t.hour, v[1], v[2], ok))
    cnt = collections.Counter(); daypeel = {}
    for d, v in hours.items():
        v.sort(); hit = False; best = None
        for i in range(len(v) - 2):
            win = v[i:i + 3]
            if win[2][0] - win[0][0] > 3: continue
            h = total(x[1] for x in win) / 3; p = total(x[2] for x in win) / 3
            if best is None or h > best[0]: best = (h, p)
            if not hit and all(x[1] >= 2.5 and x[3] for x in win) and p >= 0.5: hit = True
        if best: daypeel[str(d)] = round(best[1], 2)
        if hit: cnt[d.month] += 1
    for t in st['top']: t['peel'] = daypeel.get(t['date'])   # experimental: it annotates the table only
    st['peel_days_total'] = sum(cnt.values())
    st['peel_share_days'] = round(sum(1 for p in daypeel.values() if p >= 0.5) / max(1, len(daypeel)), 3)
    return st


def windgrid(hourly, ifs, era16, end, start=dt.date(2016, 1, 1), offset=None):
    """windgrid_out.json: {start, base: [[u, v]] per day, pts: [{lat, lon, elev, uv}]}, one [u, v] per day from start
    to end in half knots (the wind's from-direction vector). ifs: Open-Meteo's daily ECMWF IFS at the 20 grid points
    (2017 on), era16: ERA5 at the same points for 2016; points over 20 m up (land) are left out."""
    def idx(d): return (d - start).days
    N = idx(end) + 1
    acc = {}
    for u, s, d in zip(sea_utc(hourly['time'], offset), hourly['wind_speed_10m'], hourly['wind_direction_10m']):
        if u is None or s is None or d is None: continue
        k = idx(u.astimezone(ET).date()); a = acc.setdefault(k, [0, 0, 0])
        a[0] += s * math.sin(math.radians(d)); a[1] += s * math.cos(math.radians(d)); a[2] += 1
    def enc(u, v): return [int(round(u * 2)), int(round(v * 2))]
    base = [enc(acc[k][0] / acc[k][2], acc[k][1] / acc[k][2]) if k in acc else [0, 0] for k in range(N)]
    P = []
    for p, e in zip(ifs, era16):
        if p['elevation'] > 20: continue
        arr = [None] * N
        for src in (e, p):
            for t, s, d in zip(src['daily']['time'], src['daily']['wind_speed_10m_mean'], src['daily']['wind_direction_10m_dominant']):
                if s is None or d is None: continue
                k = idx(dt.date.fromisoformat(t))
                if 0 <= k < N: arr[k] = enc(s * math.sin(math.radians(d)), s * math.cos(math.radians(d)))
        P.append(dict(lat=p['latitude'], lon=p['longitude'], elev=p['elevation'], uv=[x if x is not None else base[i] for i, x in enumerate(arr)]))
    return dict(start=start.isoformat(), base=base, pts=P)


# ── the Past days' hour-by-hour lanes (research/ocean/day/<year>.json, beside the buoy's '44097' lane)
def sea_utc(times, offset=None):
    """Open-Meteo's local time labels -> UTC datetimes (None for a label that can't be placed). Open-Meteo gives a
    series one UTC offset (utc_offset_seconds) and evenly spaced labels: label - offset. A series whose labels repeat
    or skip an hour (a DST-aware one), or one with no offset recorded, is read as Eastern wall-clock time, walking it
    in order so a repeated 1 AM in November is the second 1 AM the second time."""
    lab = [dt.datetime.fromisoformat(t) for t in times]
    even = all((b - a) == dt.timedelta(hours=1) for a, b in zip(lab, lab[1:]))
    if offset is not None and even:
        return [(t - dt.timedelta(seconds=offset)).replace(tzinfo=UTC) for t in lab]
    out, prev = [], None
    for t in lab:
        c = sorted({t.replace(tzinfo=ET, fold=f).astimezone(UTC) for f in (0, 1)})
        c = [u for u in c if prev is None or u > prev]
        out.append(c[0] if c else None)
        if c: prev = c[0]
    return out


def wind_lane(hourly, end, offset=None, start=dt.date(2016, 1, 1)):
    """{UTC year: {'YYYY-MM-DDTHH' UTC: [kn (1 decimal), from deg (int)]}} for the hours of Eastern days start..end;
    an hour without a speed or a direction is left out (never 0)"""
    by = {}
    for u, s, d in zip(sea_utc(hourly['time'], offset), hourly['wind_speed_10m'], hourly['wind_direction_10m']):
        if u is None or s is None or d is None: continue
        if not start <= u.astimezone(ET).date() <= end: continue
        by.setdefault(u.year, {})[u.strftime('%Y-%m-%dT%H')] = [round(float(s), 1), int(round(float(d))) % 360]
    return {y: dict(sorted(v.items())) for y, v in by.items()}


def tide_lane(hilo_docs, end, start=dt.date(2016, 1, 1)):
    """{Eastern year: {'YYYY-MM-DD' Eastern: [['HH:MM' Eastern, ft (2 decimals), 'H'|'L'], ...]}} from CO-OPS's
    high/low predictions (local time, as fetched); a day without predictions is left out"""
    days = {}
    for doc in hilo_docs:
        for r in doc.get('predictions') or []:
            try: day, hm, v, kind = r['t'][:10], r['t'][11:16], float(r['v']), (r.get('type') or '')[:1].upper()
            except (KeyError, TypeError, ValueError): continue
            if kind not in ('H', 'L') or not start.isoformat() <= day <= end.isoformat(): continue
            e = [hm, round(v, 2), kind]
            if e not in days.setdefault(day, []): days[day].append(e)
    by = {}
    for day in sorted(days): by.setdefault(int(day[:4]), {})[day] = sorted(days[day])
    return by
