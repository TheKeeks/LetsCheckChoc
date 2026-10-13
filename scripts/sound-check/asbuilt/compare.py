import json, glob, math, statistics as st, datetime as dt
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); UTC = dt.timezone.utc; FT = 3.28084
T0, T1 = dt.datetime(2024, 10, 1, tzinfo=ET), dt.datetime(2026, 10, 1, tzinfo=ET)

def ndbc(files, cols):
    out = {}
    for f in files:
        for line in open(f):
            if line.startswith('#'): continue
            p = line.split()
            if len(p) < 12: continue
            try: t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=UTC).astimezone(ET)
            except ValueError: continue
            try: v = tuple(float(p[c]) for c in cols)
            except ValueError: continue
            if any(x in (99.0, 999.0, 9999.0) for x in v): continue
            out.setdefault(t, v)
    return out
buoy = ndbc(sorted(glob.glob('ndbc/44097*.txt')), (8, 9, 11))          # Hs m, DPD, MWD
mtk = ndbc(sorted(glob.glob('obs/mtkn6*.txt')), (5, 6))                 # WDIR, WSPD m/s

def om(f, keys):
    d = json.load(open(f))['hourly']; out = {}
    for i, t in enumerate(d['time']):
        v = tuple(d[k][i] for k in keys)
        if None in v: continue
        out[dt.datetime.fromisoformat(t).replace(tzinfo=ET)] = v
    return out
W = ('wave_height', 'wave_period', 'wave_direction')
waves = {
  'ERA5 reanalysis (41.0N 71.5W)': om('m_era5_ocean.json', W),
  'Meteo-France MFWAM at Choc pin (what the site uses)': om('cmp_best_match.json', W),
  'GFS-Wave 0.25° (41.0N 71.75W)': om('cmp_ncep_gfswave025.json', W),
  'GFS-Wave 0.16° (41.17N 71.67W)': om('cmp_ncep_gfswave016.json', W),
}
def gap(a, b): return abs((a - b + 180) % 360 - 180)
inwin = lambda d: 115 <= d <= 158
res = {}
print(f'window {T0.date()} .. {T1.date()}')
for name, m in waves.items():
    ks = [t for t in buoy if T0 <= t < T1 and t in m]
    b = [buoy[t][0] * FT for t in ks]; x = [m[t][0] * FT for t in ks]
    big = [(buoy[t][0] * FT, m[t][0] * FT) for t in ks if buoy[t][0] * FT >= 6]
    dirs = [gap(buoy[t][2], m[t][2]) for t in ks if buoy[t][0] * FT >= 3]
    pb = [buoy[t][1] for t in ks]; pm = [m[t][1] for t in ks]
    # agreement on "in-window and >= 4 ft"
    A = [(inwin(buoy[t][2]) and buoy[t][0] * FT >= 4, inwin(m[t][2]) and m[t][0] * FT >= 4) for t in ks]
    both = sum(1 for a, c in A if a and c); onlyb = sum(1 for a, c in A if a and not c); onlym = sum(1 for a, c in A if c and not a)
    r = dict(n=len(ks), r=round(st.correlation(b, x), 2), bias_ft=round(st.mean(x) - st.mean(b), 2),
             rms_ft=round(math.sqrt(st.mean([(p - q) ** 2 for p, q in zip(x, b)])), 2),
             big_ratio=round(st.mean(q / p for p, q in big), 2) if big else None, n_big=len(big),
             dir_med_deg=round(st.median(dirs)), dir_within20=round(100 * sum(d <= 20 for d in dirs) / len(dirs)),
             period_note=f'buoy dominant {st.mean(pb):.1f}s vs model mean {st.mean(pm):.1f}s',
             big_hours_buoy=both + onlyb, big_hours_model=both + onlym, agree=both)
    res[name] = r; print(name, r)

# GFS vs MFWAM directly (Windy-style pin vs site)
g, mf = waves['GFS-Wave 0.25° (41.0N 71.75W)'], waves['Meteo-France MFWAM at Choc pin (what the site uses)']
ks = [t for t in g if T0 <= t < T1 and t in mf]
print('GFS vs MFWAM: r', round(st.correlation([g[t][0] for t in ks], [mf[t][0] for t in ks]), 2),
      'mean ft', round(st.mean(g[t][0] for t in ks) * FT, 2), round(st.mean(mf[t][0] for t in ks) * FT, 2),
      'dir median gap', round(st.median(gap(g[t][2], mf[t][2]) for t in ks)))

# winds vs Montauk Point observed
KN = 1.94384
winds = {'ERA5 (used in the analysis)': om('wind.json', ('wind_speed_10m', 'wind_direction_10m')),
         'GFS at the beach (Windy-style)': om('wind_gfs.json', ('wind_speed_10m', 'wind_direction_10m'))}
clean = lambda s, d: s < 6 or (gap(d, 335) <= 60 and s < 20)
for name, m in winds.items():
    ks = [t for t in mtk if T0 <= t < T1 and t in m]
    o = [mtk[t][1] * KN for t in ks]; x = [m[t][0] for t in ks]
    dg = [gap(mtk[t][0], m[t][1]) for t in ks if mtk[t][1] * KN >= 8]
    agree = sum(clean(mtk[t][1] * KN, mtk[t][0]) == clean(m[t][0], m[t][1]) for t in ks)
    r = dict(n=len(ks), r=round(st.correlation(o, x), 2), obs_mean_kn=round(st.mean(o), 1), model_mean_kn=round(st.mean(x), 1),
             dir_med_deg=round(st.median(dg)), clean_agree_pct=round(100 * agree / len(ks)),
             obs_clean_pct=round(100 * sum(clean(mtk[t][1] * KN, mtk[t][0]) for t in ks) / len(ks)),
             model_clean_pct=round(100 * sum(clean(m[t][0], m[t][1]) for t in ks) / len(ks)))
    res[name] = r; print(name, r)
json.dump(res, open('compare.json', 'w'), indent=1)
