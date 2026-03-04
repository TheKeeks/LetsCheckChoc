#!/usr/bin/env python3
"""
Spot-check: compare Open-Meteo marine archive vs NDBC buoy 44097 historical data
for a 2023 date where both sources have data.

Session: 2023-09-10 09:00 EDT (13:00 UTC) — adjust SESSION_UTC below to test others.
"""

import gzip
import io
import json
import urllib.request
from datetime import datetime, timezone, timedelta

# ── Config ──────────────────────────────────────────────────────────────────
BUOY_ID        = '44097'
BUOY_DIST_MI   = 50          # miles from buoy to Chocomount
SWELL_KTS_PER_S = 1.5        # group velocity rule
FORECAST_LAT   = 41.089152   # Open-Meteo grid point
FORECAST_LON   = -71.721050

CHECK_DATE     = '2023-09-10'
SESSION_UTC    = '2023-09-10T13:00:00Z'   # 09:00 EDT

# ── Helpers ──────────────────────────────────────────────────────────────────
def parse_utc(s):
    for fmt in ('%Y-%m-%dT%H:%MZ', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%dT%H:%M',
                '%Y-%m-%d %H:%M', '%Y %m %d %H %M'):
        try:
            dt = datetime.strptime(s.strip(), fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    raise ValueError(f"Unparseable time: {s!r}")

def lag_hours(avg_period):
    if avg_period <= 0:
        return 0
    return BUOY_DIST_MI / (SWELL_KTS_PER_S * avg_period)

# ── 1. Open-Meteo Archive ─────────────────────────────────────────────────────
print("=" * 60)
print("1. Open-Meteo Marine Archive")
print("=" * 60)

vars_ = ','.join([
    'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
    'wave_height', 'wave_direction', 'wave_period',
])
om_url = (
    f'https://marine-api.open-meteo.com/v1/marine'
    f'?latitude={FORECAST_LAT}&longitude={FORECAST_LON}'
    f'&hourly={vars_}'
    f'&length_unit=imperial&timezone=UTC'
    f'&start_date={CHECK_DATE}&end_date={CHECK_DATE}'
)
print(f"URL: {om_url}\n")

with urllib.request.urlopen(om_url, timeout=20) as r:
    om = json.loads(r.read())

times_om  = [parse_utc(t) for t in om['hourly']['time']]
swell_h   = om['hourly'].get('swell_wave_height', [])
swell_d   = om['hourly'].get('swell_wave_direction', [])
swell_p   = om['hourly'].get('swell_wave_period', [])
wave_h    = om['hourly'].get('wave_height', [])

session_t = parse_utc(SESSION_UTC)
win_start = session_t - timedelta(hours=5)
win_end   = session_t - timedelta(hours=2)

# Lag calculation window
om_periods_in_window = [
    swell_p[i] for i, t in enumerate(times_om)
    if win_start <= t <= win_end and swell_p[i] is not None and swell_p[i] > 0
]
om_avg_period = sum(om_periods_in_window) / len(om_periods_in_window) if om_periods_in_window else 0
om_lag        = lag_hours(om_avg_period)
om_lagged_t   = session_t - timedelta(hours=om_lag)

print(f"Session time (UTC):          {session_t.strftime('%Y-%m-%d %H:%M')}")
print(f"Lag window:                  {win_start.strftime('%H:%M')} – {win_end.strftime('%H:%M')} UTC")
print(f"Periods in window:           {[round(p,1) for p in om_periods_in_window]}")
print(f"Avg swell period:            {om_avg_period:.1f}s")
print(f"Computed lag:                {om_lag:.2f}h")
print(f"Lagged lookup time (UTC):    {om_lagged_t.strftime('%Y-%m-%d %H:%M')}")

# Find nearest hour to lagged time
best_i, best_d = 0, float('inf')
for i, t in enumerate(times_om):
    d = abs((t - om_lagged_t).total_seconds())
    if d < best_d:
        best_d = d; best_i = i

print(f"\nOpen-Meteo swell at lagged time ({times_om[best_i].strftime('%H:%M')} UTC):")
print(f"  Height:    {swell_h[best_i]:.1f} ft  (wave_height={wave_h[best_i]:.1f} ft)")
print(f"  Period:    {swell_p[best_i]:.0f} s")
print(f"  Direction: {swell_d[best_i]:.0f}°")

# Also show raw session-time value (no lag) for reference
sess_i, sess_d = 0, float('inf')
for i, t in enumerate(times_om):
    d = abs((t - session_t).total_seconds())
    if d < sess_d:
        sess_d = d; sess_i = i

print(f"\n  (Un-lagged reference at {session_t.strftime('%H:%M')} UTC: "
      f"{swell_h[sess_i]:.1f} ft {swell_p[sess_i]:.0f}s {swell_d[sess_i]:.0f}°)")

# ── 2. NDBC Historical ────────────────────────────────────────────────────────
print()
print("=" * 60)
print("2. NDBC Buoy 44097 Historical (2023)")
print("=" * 60)

ndbc_url = f'https://www.ndbc.noaa.gov/data/historical/stdmet/{BUOY_ID}h2023.txt.gz'
print(f"URL: {ndbc_url}\n")

with urllib.request.urlopen(ndbc_url, timeout=30) as r:
    raw = r.read()

with gzip.open(io.BytesIO(raw)) as gz:
    lines = gz.read().decode('utf-8', errors='replace').splitlines()

# Parse header
header_line = lines[0].lstrip('#').split()
rows = []
for line in lines[2:]:   # skip header + units line
    parts = line.split()
    if len(parts) < len(header_line):
        continue
    obj = dict(zip(header_line, parts))
    try:
        yr = int(obj.get('YY', obj.get('YYYY', 0)))
        if yr < 100: yr += 2000
        mm = int(obj['MM']); dd = int(obj['DD'])
        hh = int(obj['hh']); mi = int(obj.get('mm', 0))
        t = datetime(yr, mm, dd, hh, mi, tzinfo=timezone.utc)
        wvht  = float(obj.get('WVHT', 99))
        dpd   = float(obj.get('DPD',  99))
        mwd   = float(obj.get('MWD',  999))
        rows.append({'t': t, 'wvht': wvht, 'dpd': dpd, 'mwd': mwd})
    except (ValueError, KeyError):
        continue

print(f"Parsed {len(rows)} NDBC observations for 2023")

# Lag window from NDBC
ndbc_in_window = [r for r in rows if win_start <= r['t'] <= win_end and r['dpd'] < 99]
ndbc_periods   = [r['dpd'] for r in ndbc_in_window]
ndbc_avg_period = sum(ndbc_periods) / len(ndbc_periods) if ndbc_periods else 0
ndbc_lag        = lag_hours(ndbc_avg_period)
ndbc_lagged_t   = session_t - timedelta(hours=ndbc_lag)

print(f"\nSession time (UTC):          {session_t.strftime('%Y-%m-%d %H:%M')}")
print(f"Lag window:                  {win_start.strftime('%H:%M')} – {win_end.strftime('%H:%M')} UTC")
print(f"NDBC obs in window:          {[{'t': r['t'].strftime('%H:%M'), 'dpd': r['dpd']} for r in ndbc_in_window]}")
print(f"Avg DPD (period):            {ndbc_avg_period:.1f}s")
print(f"Computed lag:                {ndbc_lag:.2f}h")
print(f"Lagged lookup time (UTC):    {ndbc_lagged_t.strftime('%Y-%m-%d %H:%M')}")

# Find nearest NDBC observation to lagged time
valid = [r for r in rows if r['wvht'] < 99]
best_r, best_d2 = None, float('inf')
for r in valid:
    d = abs((r['t'] - ndbc_lagged_t).total_seconds())
    if d < best_d2:
        best_d2 = d; best_r = r

wvht_ft = best_r['wvht'] * 3.28084
print(f"\nNDBC swell at lagged time ({best_r['t'].strftime('%H:%M')} UTC):")
print(f"  WVHT:      {wvht_ft:.1f} ft  ({best_r['wvht']:.2f} m)")
print(f"  DPD:       {best_r['dpd']:.0f} s")
print(f"  MWD:       {best_r['mwd']:.0f}°" if best_r['mwd'] < 999 else "  MWD:       N/A")

# Un-lagged NDBC reference
best_r2, best_d3 = None, float('inf')
for r in valid:
    d = abs((r['t'] - session_t).total_seconds())
    if d < best_d3:
        best_d3 = d; best_r2 = r
wvht_ft2 = best_r2['wvht'] * 3.28084
print(f"\n  (Un-lagged reference at {best_r2['t'].strftime('%H:%M')} UTC: "
      f"{wvht_ft2:.1f} ft {best_r2['dpd']:.0f}s {best_r2['mwd']:.0f}°)")

# ── 3. Side-by-side comparison ────────────────────────────────────────────────
print()
print("=" * 60)
print("3. Side-by-side comparison (lagged values)")
print("=" * 60)
print(f"{'Metric':<20} {'Open-Meteo':>15} {'NDBC 44097':>15} {'Delta':>10}")
print("-" * 62)
om_h  = swell_h[best_i]
nd_h  = wvht_ft
om_p  = swell_p[best_i]
nd_p  = best_r['dpd']
om_d2 = swell_d[best_i]
nd_d2 = best_r['mwd']
print(f"{'Swell Height (ft)':<20} {om_h:>15.1f} {nd_h:>15.1f} {nd_h-om_h:>+10.1f}")
print(f"{'Period (s)':<20} {om_p:>15.0f} {nd_p:>15.0f} {nd_p-om_p:>+10.0f}")
if nd_d2 < 999:
    print(f"{'Direction (°)':<20} {om_d2:>15.0f} {nd_d2:>15.0f} {nd_d2-om_d2:>+10.0f}")
else:
    print(f"{'Direction (°)':<20} {om_d2:>15.0f} {'N/A':>15}")
print(f"{'Lag (h)':<20} {om_lag:>15.2f} {ndbc_lag:>15.2f} {ndbc_lag-om_lag:>+10.2f}")
print()
print("Notes:")
print(f"  Open-Meteo grid:  {FORECAST_LAT}N, {FORECAST_LON}W (open water NE of Chocomount)")
print(f"  NDBC 44097:       40.969N, 71.124W (Block Island, RI — ~50 mi from beach)")
print(f"  WVHT is significant wave height (not swell-only); Open-Meteo swell_wave_height is swell-only.")
