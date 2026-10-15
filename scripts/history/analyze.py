"""Every hour at buoy 44097 since 2016 → the Sound Check's daily rows and ten-year statistics (results4.json).

The same arithmetic as scripts/sound-check/asbuilt/analyze4.py, which built the history, so the daily update
extends it rather than replacing it:

  hours     the buoy's height, period and direction (NDBC stdmet; Montauk 44017 fills 44097's gaps until 2023),
            Choc's modeled height that hour (spectra.py; a direction/period table where the spectrum is missing),
            the over-water wind (ERA5), the tide (Silver Eel Pond hi/lo, cosine between turns), daylight
  months    clim: % of hours big (4 ft+ with the swell in the window), big and clean (light or offshore wind),
            good (and the tide coming in); ym: per month, days with 3+ big hours and days with 2+ good hours
  storms    events: runs of big hours, the 12 with the most energy through the window
  days      daily: per Eastern day the peak, the best 3 hours of swell energy, the ratings model's best 3 hours,
            the day's wind and its share of clean hours

The ratings model (what makes a good session) is fitted to the surf log's sessions on this table of hours
(ratings.py), when the update has the log; without it the stored fit is kept. Either way it scores every hour.
"""
import bisect, collections, math, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np
import derive, ratings

ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc; FT = 3.28084
OFFSHORE = 335
M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()


def w_soft(d):
    if 115 <= d <= 158: return 1.0
    if 100 <= d < 115: return (d - 100) / 15
    if 158 < d <= 175: return (175 - d) / 17
    return 0.0
def gap(a, b): return abs((a - b + 180) % 360 - 180)
def power(hs_ft, per): return 0.49 * (hs_ft / FT) ** 2 * 0.9 * per   # kW per m of crest

def total(xs):
    """xs added left to right, as Python's sum() added floats until 3.12 (which compensates for rounding): the history
    was built that way, so it comes out the same on any Python"""
    t = 0
    for x in xs: t = t + x
    return t



def lines(text):
    """an NDBC stdmet file's lines, split into fields (comment lines skipped)"""
    for line in text.splitlines():
        if not line.startswith('#'): yield line.split()


def buoy_hours(f44097, f44017=()):
    """{Eastern hour: (Hs ft, DPD s, MWD deg)} from 44097's stdmet files, in order of precedence (the first reading of
    an hour wins), then Montauk 44017 where 44097 has nothing, heights x 1.05 (the two buoys' overlap ratio)"""
    buoy = {}
    for text in f44097:
        for p in lines(text):
            try:
                t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC)
                hs, dpd, mwd = float(p[8]), float(p[9]), float(p[11])
            except (ValueError, IndexError): continue
            if hs >= 99 or dpd >= 99 or mwd >= 999: continue
            buoy.setdefault(t.astimezone(ET), (hs * FT, dpd, mwd))
    filled = 0
    for text in f44017:
        for p in lines(text):
            try:
                t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC).astimezone(ET)
                hs, dpd, mwd = float(p[8]), float(p[9]), float(p[11])
            except (ValueError, IndexError): continue
            if hs >= 99 or dpd >= 99 or mwd >= 999 or t in buoy: continue
            buoy[t] = (hs * FT * 1.05, dpd, mwd); filled += 1
    return buoy, filled


def kchoc_fn(kavg):
    """the older direction/period response at the Choc reef, for hours without a spectrum"""
    KD, KT = list(range(90, 211, 10)), [6, 9, 12, 15]
    def kchoc(D, T):
        D = min(max(D, KD[0]), KD[-1]); T = min(max(T, KT[0]), KT[-1])
        i = min(len(KD) - 2, int((D - KD[0]) // 10)); fd = (D - KD[i]) / 10
        j = max(0, min(len(KT) - 2, sum(1 for x in KT if x <= T) - 1)); ft = (T - KT[j]) / (KT[j + 1] - KT[j])
        g = lambda d, t: kavg[f'{d}_{t}']
        return (g(KD[i], KT[j]) * (1 - fd) + g(KD[i + 1], KT[j]) * fd) * (1 - ft) + (g(KD[i], KT[j + 1]) * (1 - fd) + g(KD[i + 1], KT[j + 1]) * fd) * ft
    return kchoc


def wind_hours(hourly, offset=None):
    """ERA5's over-water cell (Open-Meteo, knots) → {Eastern hour: (kn, from deg)}. offset: the series' one UTC offset
    (utc_offset_seconds): Open-Meteo labels all ten years with the offset in force on the day it's asked, so a label
    is placed by derive.sea_utc, never read as Eastern clock time (an hour off for half the year)"""
    out = {}
    for u, s, d in zip(derive.sea_utc(hourly['time'], offset), hourly['wind_speed_10m'], hourly['wind_direction_10m']):
        if u is not None and s is not None and d is not None: out.setdefault(u.astimezone(ET), (s, d))
    return out


def tide_turns(hilo_docs):
    """CO-OPS hi/lo predictions (one document per year, local time) → sorted turns [(Eastern time, H/L, ft)]"""
    turns = []
    for doc in hilo_docs:
        for r in doc['predictions']:
            turns.append((dt.datetime.fromisoformat(r['t'].replace(' ', 'T')).replace(tzinfo=ET), r['type'], float(r['v'])))
    turns.sort()
    return turns


def analyze(buoy, cspec, wind, turns, kavg, model, sessions=None):
    """→ the results4.json document. buoy: buoy_hours(); cspec: {UTC hour: [buoy ft, Choc ft, ...]} (spectra.py);
    wind: wind_hours(); turns: tide_turns(); kavg: the direction/period table; model: the stored ratings model;
    sessions: the surf log's (surflog.sessions()), to fit the model to (None: keep the stored one; it is kept too
    when fewer than ratings.MIN_SESSIONS of them have conditions)."""
    kchoc = kchoc_fn(kavg)
    tt = [x[0] for x in turns]
    def tide(t):
        i = bisect.bisect_right(tt, t) - 1
        if i < 0 or i + 1 >= len(turns): return None
        (t0, _, h0), (t1, _, h1) = turns[i], turns[i + 1]
        span = (t1 - t0).total_seconds() / 3600; f = (t - t0).total_seconds() / 3600 / span
        height = (h0 + h1) / 2 + (h0 - h1) / 2 * math.cos(math.pi * f)
        rate = (h1 - h0) / 2 * math.sin(math.pi * f) * math.pi / span     # ft/hr, + = incoming
        return height, rate

    LAT, LON = 41.276, -71.963
    _sun = {}
    def is_day(t):
        d = t.date()
        if d not in _sun:
            n = d.timetuple().tm_yday; g = 2 * math.pi / 365 * (n - 1)
            eq = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
            dec = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
            ha = math.degrees(math.acos(math.cos(math.radians(90.833)) / (math.cos(math.radians(LAT)) * math.cos(dec)) - math.tan(math.radians(LAT)) * math.tan(dec)))
            noon = 720 - 4 * LON - eq; base = dt.datetime(d.year, d.month, d.day, tzinfo=UTC)
            _sun[d] = ((base + dt.timedelta(minutes=noon - 4 * ha)).astimezone(ET), (base + dt.timedelta(minutes=noon + 4 * ha)).astimezone(ET))
        r, s = _sun[d]; return r <= t <= s

    # ── hourly table
    H = {}
    for t, (hs, per, d) in buoy.items():
        e = power(hs, per) * w_soft(d)
        wd = wind.get(t); td = tide(t)
        sk = cspec.get(t.astimezone(UTC).strftime('%Y-%m-%dT%H'))
        mc = sk[1] if sk else hs * kchoc(d, per)        # rays + full spectrum; the direction/period table where it's missing
        H[t] = dict(hs=hs, per=per, dir=d, e=e, w=w_soft(d), day=is_day(t), mc=mc, mce=power(mc, per),
                    ws=wd[0] if wd else None, wdir=wd[1] if wd else None,
                    th=td[0] if td else None, tr=td[1] if td else None)
    times = sorted(H)
    hr1 = dt.timedelta(hours=1)
    for t in times:
        v = [H[x]['e'] for x in (t - hr1, t, t + hr1) if x in H]
        H[t]['e3'] = total(v) / len(v) if v else None     # 3 h centred mean of soft in-window energy
    for t in times:
        v = [H[x]['mce'] for x in (t - hr1, t, t + hr1) if x in H]
        H[t]['m3'] = total(v) / len(v)
        v = [H[x]['mc'] for x in (t - hr1, t, t + hr1) if x in H]
        H[t]['mh3'] = total(v) / len(v)
    for t in times:
        v = [power(H[x]['hs'], H[x]['per']) for x in (t - hr1, t, t + hr1) if x in H]
        H[t]['ea3'] = total(v) / len(v)
    def clean(r): return r['ws'] is not None and (r['ws'] < 6 or (gap(r['wdir'], OFFSHORE) <= 60 and r['ws'] < 20))
    def big(r): return r['hs'] >= 4 and r['w'] >= 0.5

    # ── climatology: all hours, and daylight only
    def clim(day_only):
        out = []
        for m in range(1, 13):
            hrs = [H[t] for t in times if t.month == m and (H[t]['day'] or not day_only)]
            n = len(hrs) or 1
            b = [r for r in hrs if big(r)]; bc = [r for r in b if clean(r)]; bci = [r for r in bc if (r['tr'] or 0) > 0]
            out.append(dict(month=M[m - 1], hours=len(hrs), big=round(100 * len(b) / n, 1), big6=round(100 * sum(r['hs'] >= 6 for r in b) / n, 1),
                            clean=round(100 * len(bc) / n, 1), good=round(100 * len(bci) / n, 1),
                            core=round(100 * sum(1 for r in b if 140 <= r['dir'] <= 158) / n, 1)))
        return out

    days = collections.OrderedDict()
    for t in times: days.setdefault(t.date(), []).append(t)
    def best3(ts, key):
        best = None
        for i in range(len(ts)):
            win = [H[x][key] for x in ts[i:i + 3] if H[x][key] is not None and (x - ts[i]) <= dt.timedelta(hours=2)]
            if len(win) >= 2:
                m = total(win) / len(win); best = m if best is None or m > best else best
        return best

    def ym(day_only):
        c = collections.defaultdict(lambda: [0, 0, 0])
        for d, ts in days.items():
            ts2 = [t for t in ts if H[t]['day'] or not day_only]
            nb = sum(big(H[t]) for t in ts2); ng = sum(big(H[t]) and clean(H[t]) and (H[t]['tr'] or 0) > 0 for t in ts2)
            k = f'{d.year}-{d.month:02d}'
            c[k][2] += len(ts)
            if nb >= 3: c[k][0] += 1
            if ng >= 2: c[k][1] += 1
        return dict(sorted(c.items()))

    # ── storms: runs of big hours (all hours), gaps of up to 4 h
    events, cur = [], None
    for t in times:
        if big(H[t]):
            if cur and t - cur['end'] <= dt.timedelta(hours=4): cur['end'] = t; cur['ts'].append(t)
            else: cur = dict(start=t, end=t, ts=[t]); events.append(cur)
    ev = []
    for e in events:
        rs = [H[t] for t in e['ts']]; pk = max(rs, key=lambda r: r['hs'])
        ev.append(dict(start=e['start'].isoformat()[:16], hours=len(rs), peak_ft=round(pk['hs'], 1), peak_period=pk['per'], peak_dir=pk['dir'],
                       energy=round(total(r['e'] for r in rs)), clean=sum(clean(r) for r in rs),
                       good=sum(1 for r in rs if clean(r) and (r['tr'] or 0) > 0),
                       good_day=sum(1 for r in rs if clean(r) and (r['tr'] or 0) > 0 and r['day'])))
    ev.sort(key=lambda e: -e['energy'])

    per_hist = collections.Counter(int(H[t]['per']) for t in times if big(H[t]))

    # ── the ratings model, fitted to the sessions, and its score for every hour. Its inputs at an hour: the swell (the
    # best 3 h of energy at Choc within +/-3 h), the offshore wind, the tide's rate; the scatter panels add the period,
    # the wind speed and the tide's height
    def scat_at(t):
        ns = [t + dt.timedelta(hours=k) for k in range(-3, 4) if t + dt.timedelta(hours=k) in H]
        r = H.get(t)
        if not ns or r is None or r['ws'] is None or r['th'] is None: return None
        best = max(ns, key=lambda x: H[x]['m3'] or 0)
        off = r['ws'] * math.cos(math.radians(gap(r['wdir'], OFFSHORE)))
        return [math.log1p(H[best]['m3'] or 0), H[best]['per'], off, r['ws'], r['tr'], r['th']]
    def feats_at(t):
        f = scat_at(t)
        return None if f is None else [f[0], f[2], f[4]]
    if sessions is not None:
        model = ratings.fit_model(sessions, feats_at, scat_at) or model
    fit = model['targets']['avg']['fit']
    def predict(f):
        z = (np.array(f) - np.array(fit['mu'])) / np.array(fit['sd'])
        return float(np.clip(fit['c'] + z @ np.array(fit['b']), 0, 10))
    for t in times:
        f = feats_at(t); H[t]['score'] = predict(f) if f else None

    def daily(day_only):
        out = []
        for d, ts in days.items():
            ts2 = [t for t in ts if H[t]['day'] or not day_only]
            if not ts2: out.append(None); continue
            out.append(dict(e=best3(ts2, 'e3') or 0, ea=best3(ts2, 'ea3') or 0, s=best3(ts2, 'score'), mh=best3(ts2, 'mh3') or 0))
        return out
    dall, dday = daily(False), daily(True)

    def good_clim(dd, thr=7.0):
        c = collections.defaultdict(lambda: [0, 0])
        for (d, ts), v in zip(days.items(), dd):
            if v is None or v['s'] is None: continue
            c[d.month][1] += 1
            if v['s'] >= thr: c[d.month][0] += 1
        return [round(100 * c[m][0] / c[m][1], 1) if c[m][1] else 0 for m in range(1, 13)]

    # per day: date, peak ft, dir and period at the peak, best 3 h energy (all hours, daylight), all-swell energy,
    # score (all, daylight), wind (mean direction, mean kn), % clean hours, best 3 h Choc height (all, daylight)
    series = []
    for (d, ts), a, b in zip(days.items(), dall, dday):
        pk = max((H[t] for t in ts), key=lambda r: r['hs'])
        ws = [(H[t]['wdir'], H[t]['ws']) for t in ts if H[t]['ws'] is not None]
        if ws:
            sx = total(s * math.sin(math.radians(a_)) for a_, s in ws); cx = total(s * math.cos(math.radians(a_)) for a_, s in ws)
            wdir = round(math.degrees(math.atan2(sx, cx)) % 360); wspd = round(total(s for _, s in ws) / len(ws), 1)
            cl = round(100 * sum(clean(H[t]) for t in ts if H[t]['ws'] is not None) / len(ws))
        else: wdir = wspd = cl = None
        series.append([d.strftime('%y%m%d'), round(pk['hs'], 1), round(pk['dir']), round(pk['per'], 1),
                       round(a['e'], 1), round(b['e'], 1) if b else 0, round(a['ea'], 1),
                       round(a['s'], 1) if a['s'] is not None else None, round(b['s'], 1) if b and b['s'] is not None else None,
                       wdir, wspd, cl, round(a['mh'], 1), round(b['mh'], 1) if b else 0])

    return dict(
        clim=dict(all=clim(False), day=clim(True)), ym=dict(all=ym(False), day=ym(True)),
        events=ev[:12], per=sorted(per_hist.items()),
        good=dict(all=good_clim(dall), day=good_clim(dday)),
        model=model, daily=series)
