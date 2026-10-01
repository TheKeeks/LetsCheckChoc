#!/usr/bin/env python3
"""
fetch_buoy.py — Fetches NDBC buoy 44097 data for Chocomount fallback.
Writes data/buoy.json. Run by GitHub Actions every 2 hours.
Only needed when CORS proxy is unavailable.

Exits 1 without touching data/buoy.json when every NDBC file fails, so the
workflow skips its commit step and GitHub emails the owner. When only some
files fail, the missing sections are carried over from the previous
buoy.json and listed in `stale_sections`.
"""

import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("Installing requests...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "--quiet"])
    import requests

BUOY_ID = "44097"
NDBC_BASE = "https://www.ndbc.noaa.gov/data/realtime2/"
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "buoy.json"

# Sections of buoy.json that come straight from NDBC files. A run that
# can't refresh one keeps the previous value and names it in stale_sections.
DATA_SECTIONS = ("buoy", "spectral_summary", "spectral_bins")
# build_spectral_bins() argument order.
SPECTRAL_FILES = ("data_spec", "swdir", "swdir2", "swr1", "swr2")

# NDBC's own SwH/SwP split at 44097 is a fixed 0.10 Hz (10 s), which books
# the 8–10 s SE swell that matters at Choc as wind-wave. swell_band
# integrates the spectrum from this period up instead (same cut the
# primary swell direction already uses).
SWELL_BAND_MIN_PERIOD = 8  # s

# ── Nowcast verification ─────────────────────────────────────────────
# Every run also logs rows comparing the buoy's observations against the
# Open-Meteo model's value for the same hour, at two grid points: the
# buoy itself (model skill) and the app's Choc forecast point (spatial
# difference). One row per hour; each run back-fills every hour since the
# last logged row, so cron runs GitHub drops leave no gaps. The site plots
# data/verification.json.
VERIF_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "verification.json"
BUOY_LAT, BUOY_LON = 40.969, -71.124
CHOC_LAT, CHOC_LON = 41.089152, -71.721050  # CONFIG.chocomount.forecastLat/Lon
MARINE_API = "https://marine-api.open-meteo.com/v1/marine"
VERIF_MAX_ROWS = 4500  # ~6 months at one row per hour
VERIF_BACKFILL_HOURS = 72  # how far back one run fills gaps (realtime2 keeps 45 days)
VERIF_MATCH = timedelta(minutes=30)  # obs ↔ model hour / data_spec row pairing
VERIF_SOURCE_MAX_LAG = timedelta(hours=3)  # stop waiting for a spectral file this far behind
M_TO_FT = 3.28084


def fetch_text(url):
    """Fetch text from a URL with timeout and error handling."""
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"  Failed to fetch {url}: {e}")
        return None


def _row_datetime(line):
    """UTC datetime from the YY MM DD hh mm columns of an NDBC data row,
    or None for header lines and anything else (e.g. an HTML error page)."""
    if line.startswith("#"):
        return None
    cols = line.split()
    try:
        return datetime(*(int(c) for c in cols[:5]), tzinfo=timezone.utc) if len(cols) >= 5 else None
    except ValueError:
        return None


def ndbc_row_time(text):
    """Newest row time of an NDBC realtime2 file as "YYYY-MM-DD HH:MM UTC"
    (the format of buoy.time), or None."""
    for line in (text or "").strip().split("\n"):
        if not line.startswith("#"):
            dt = _row_datetime(line)
            return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else None
    return None


def ndbc_rows(text, header_lines, since=None):
    """{row datetime: single-row text} for every data row of an NDBC
    realtime2 file at or after `since`. Each single-row text is the header
    lines plus that one row, so the newest-row parsers below can read any
    row: header_lines is 2 for .txt/.spec and 1 for the spectral files."""
    if not text:
        return {}
    lines = text.strip().split("\n")
    head, rows = lines[:header_lines], {}
    for line in lines[header_lines:]:
        dt = _row_datetime(line)
        if dt is not None and (since is None or dt >= since):
            rows.setdefault(dt, "\n".join(head + [line]))  # newest copy wins
    return rows


def parse_stdmet(text):
    """Parse NDBC standard meteorological data file."""
    if not text:
        return None
    lines = text.strip().split("\n")
    if len(lines) < 3:
        return None

    headers = lines[0].split()
    # Remove # from first header
    headers[0] = headers[0].lstrip("#")
    data = lines[2].split()

    # No timestamp, no data: an HTML error page served with HTTP 200 must
    # count as a failed fetch, not as a row of nulls.
    if len(data) < len(headers) or _row_datetime(lines[2]) is None:
        return None

    row = dict(zip(headers, data))

    def safe_float(key, invalid=99.0):
        try:
            v = float(row.get(key, "MM"))
            return v if v < invalid else None
        except (ValueError, TypeError):
            return None

    return {
        "time": f"{row.get('YY','')}-{row.get('MM','')}-{row.get('DD','')} {row.get('hh','')}:{row.get('mm','')} UTC",
        "wave_height": round(safe_float("WVHT") * 3.28084, 2) if safe_float("WVHT") is not None else None,
        "dominant_period": safe_float("DPD"),
        "average_period": safe_float("APD"),
        "mean_wave_direction": safe_float("MWD", invalid=999),
        "water_temp": round(safe_float("WTMP") * 9/5 + 32, 1) if safe_float("WTMP") is not None else None,
        "wind_speed": round(safe_float("WSPD") * 2.237, 1) if safe_float("WSPD") is not None else None,
        "wind_direction": safe_float("WDIR", invalid=999),
        "wind_gust": round(safe_float("GST") * 2.237, 1) if safe_float("GST") is not None else None,
        "pressure": safe_float("PRES", invalid=9999),
        "air_temp": round(safe_float("ATMP") * 9/5 + 32, 1) if safe_float("ATMP") is not None else None,
    }


COMPASS_TO_DEG = {
    'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
    'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
    'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
    'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5,
}


def parse_spectral_summary(text):
    """Parse NDBC .spec spectral summary file.

    Column order: YY MM DD hh mm WVHT SwH SwP WWH WWP SwD WWD STEEPNESS APD MWD
    Indices:      0  1  2  3  4  5    6   7   8   9   10  11  12        13  14
    SwD and WWD are text compass (e.g. "SE", "SSE"); MWD is numeric degrees.
    """
    if not text:
        return None
    lines = text.strip().split("\n")
    if len(lines) < 3:
        return None

    data = lines[2].split()
    if len(data) < 15 or _row_datetime(lines[2]) is None:
        return None

    def sf(idx, invalid=99.0):
        try:
            v = float(data[idx])
            return v if v < invalid else None
        except (ValueError, IndexError):
            return None

    def compass(idx):
        try:
            return COMPASS_TO_DEG.get(data[idx].upper())
        except IndexError:
            return None

    return {
        "significant_wave_height_m": sf(5),
        "swell_height_m": sf(6),
        "swell_period": sf(7),
        "wind_wave_height_m": sf(8),
        "wind_wave_period": sf(9),
        "swell_direction": compass(10),
        "wind_wave_direction": compass(11),
        "mean_wave_direction": sf(14, invalid=999),
    }


def parse_spectral_file(text, has_sep_freq=False):
    """Parse an NDBC spectral data file (data_spec, swdir, swdir2, swr1, swr2).

    NDBC realtime2 format interleaves each value with its frequency in parens:
        YY MM DD hh mm [sep_freq] v1 (f1) v2 (f2) v3 (f3) ...
    data_spec has the extra sep_freq scalar before the pairs; the directional
    files (swdir, swdir2, swr1, swr2) do not.
    """
    if not text:
        return None
    lines = text.strip().split("\n")
    if len(lines) < 2 or _row_datetime(lines[1]) is None:
        return None
    row = lines[1].split()
    i = 5 + (1 if has_sep_freq else 0)
    freqs, values = [], []
    while i + 1 < len(row):
        try:
            v = float(row[i])
            f = float(row[i + 1].strip("()"))
        except ValueError:
            break
        values.append(v)
        freqs.append(f)
        i += 2
    return {"freqs": freqs, "values": values} if freqs else None


def compute_primary_swell_dir(bins, min_period=SWELL_BAND_MIN_PERIOD):
    """Energy-weighted circular mean of dir1, restricted to swell band (>=8s).
    Falls back to all positive-energy bins if the swell band is empty."""
    if not bins:
        return None
    swell = [b for b in bins if b["period"] >= min_period and b["energy"] > 0]
    pool = swell if swell else [b for b in bins if b["energy"] > 0]
    if not pool:
        return None
    sx = sy = wsum = 0.0
    for b in pool:
        rad = math.radians(b["dir1"])
        sx += math.cos(rad) * b["energy"]
        sy += math.sin(rad) * b["energy"]
        wsum += b["energy"]
    if wsum == 0:
        return None
    deg = (math.degrees(math.atan2(sy / wsum, sx / wsum)) + 360) % 360
    return round(deg, 1)


def bin_widths(freqs):
    """Bandwidth (Hz) of each spectral bin: from the midpoint with the bin
    below to the midpoint with the bin above (end bins mirror their inner
    half). 44097's bands step 0.005, then 0.01, then 0.02 Hz, so no single
    df fits; integrating with these widths reproduces NDBC's WVHT and SwH."""
    n = len(freqs)
    if n < 2:
        return [0.0] * n
    widths = []
    for i, f in enumerate(freqs):
        lo = (freqs[i - 1] + f) / 2 if i > 0 else f - (freqs[1] - f) / 2
        hi = (freqs[i + 1] + f) / 2 if i < n - 1 else f + (f - freqs[i - 1]) / 2
        widths.append(hi - lo)
    return widths


def compute_swell_band(bins, min_period=SWELL_BAND_MIN_PERIOD):
    """Height, peak period and direction of the energy at periods >=
    min_period: Hs = 4·sqrt(Σ E·df) over those bins, the period of the
    most energetic one, and the energy-weighted direction. None without
    bins; hs_m 0.0 (and no period/direction) when the band is empty."""
    if not bins:
        return None
    widths = bin_widths([b["freq"] for b in bins])
    band = [(b, w) for b, w in zip(bins, widths) if b["period"] >= min_period]
    m0 = sum(max(b["energy"], 0) * w for b, w in band)
    peak = max((b for b, _ in band if b["energy"] > 0), key=lambda b: b["energy"], default=None)
    return {
        "hs_m": round(4 * math.sqrt(m0), 2),
        "peak_period_s": round(peak["period"], 1) if peak else None,
        "dir_deg": compute_primary_swell_dir([b for b, _ in band], min_period),
        "min_period_s": min_period,
    }


def compute_tm10(bins):
    """Energy period Tm-1,0 = Σ(E·df/f) / Σ(E·df) in seconds, over the
    whole spectrum. The models' mean `wave_period` tracks it far better
    than DPD, APD or NDBC's SwP (audit C15), so it is the like-for-like
    buoy value for the model-vs-buoy period comparison."""
    if not bins:
        return None
    widths = bin_widths([b["freq"] for b in bins])
    m0 = m_1 = 0.0
    for b, w in zip(bins, widths):
        if b["freq"] > 0 and b["energy"] > 0:
            m0 += b["energy"] * w
            m_1 += b["energy"] * w / b["freq"]
    return round(m_1 / m0, 2) if m0 > 0 else None


def build_spectral_bins(data_spec_text, swdir_text, swdir2_text, swr1_text, swr2_text):
    """Build spectral bin data from raw NDBC spectral files."""
    energy = parse_spectral_file(data_spec_text, has_sep_freq=True)
    if not energy:
        return None
    dir1 = parse_spectral_file(swdir_text)
    dir2 = parse_spectral_file(swdir2_text)
    r1 = parse_spectral_file(swr1_text)
    r2 = parse_spectral_file(swr2_text)

    bins = []
    for i, freq in enumerate(energy["freqs"]):
        bins.append({
            "freq": freq,
            "period": round(1.0 / freq, 3) if freq > 0 else 0,
            "energy": energy["values"][i] if i < len(energy["values"]) else 0,
            "dir1": dir1["values"][i] if dir1 and i < len(dir1["values"]) else 0,
            "dir2": dir2["values"][i] if dir2 and i < len(dir2["values"]) else 0,
            "r1": r1["values"][i] if r1 and i < len(r1["values"]) else 0.5,
            "r2": r2["values"][i] if r2 and i < len(r2["values"]) else 0.25,
        })
    return bins


def fetch_model_series(lat, lon, past_days):
    """Open-Meteo marine hourly values (heights in ft) keyed by UTC hour,
    from one request reaching `past_days` back, or None when it fails."""
    try:
        resp = requests.get(MARINE_API, params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "wave_height,wave_period,wave_direction,swell_wave_height,"
                      "swell_wave_period,swell_wave_direction",
            "past_days": past_days,
            "forecast_days": 1,
            "timezone": "UTC",
        }, timeout=30)
        resp.raise_for_status()
        hourly = resp.json().get("hourly") or {}

        def val(key, i, ft=False):
            arr = hourly.get(key) or []
            v = arr[i] if i < len(arr) else None
            if v is None:
                return None
            return round(v * M_TO_FT, 2) if ft else round(v, 1)

        series = {}
        for i, t in enumerate(hourly.get("time") or []):
            dt = datetime.strptime(t, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
            series[dt] = {
                "hs": val("wave_height", i, ft=True),
                "wvp": val("wave_period", i),
                "wvd": val("wave_direction", i),
                "swh": val("swell_wave_height", i, ft=True),
                "swp": val("swell_wave_period", i),
                "swd": val("swell_wave_direction", i),
            }
        return series
    except Exception as e:
        print(f"  Verification: model fetch failed at {lat},{lon}: {e}")
        return None


def _model_hour(dt):
    """The model hour an observation pairs with: the nearest whole hour,
    :30 going to the earlier one, so never more than VERIF_MATCH away."""
    base = dt.replace(minute=0, second=0, microsecond=0)
    return base + timedelta(hours=1) if dt - base > VERIF_MATCH else base


def _nearest(times, dt):
    """The key of `times` nearest dt if it is within VERIF_MATCH, else None."""
    best = min(times, key=lambda t: abs(t - dt), default=None)
    return best if best is not None and abs(best - dt) <= VERIF_MATCH else None


def _row_t(row):
    """UTC datetime of a verification row's "t" ("YYYY-MM-DDTHH:MMZ"), or None."""
    try:
        return datetime.strptime(row["t"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    except (TypeError, KeyError, ValueError):
        return None


def _verif_buoy(obs, spec, bins):
    """The buoy half of a verification row (heights in ft)."""
    spec = spec or {}
    swd = spec.get("swell_direction")
    if bins and spec:
        # Same override as buoy.json: the energy-weighted >=8 s direction
        # beats the 22.5° compass text in .spec.
        derived = compute_primary_swell_dir(bins)
        if derived is not None:
            swd = derived
    band = compute_swell_band(bins)

    def ft(m):
        return round(m * M_TO_FT, 2) if m is not None else None

    return {
        "hs": obs.get("wave_height"),
        "dpd": obs.get("dominant_period"),
        "mwd": obs.get("mean_wave_direction"),
        "swh": ft(spec.get("swell_height_m")),
        "swp": spec.get("swell_period"),
        "swd": swd,
        "apd": obs.get("average_period"),
        "tm10": compute_tm10(bins),
        "swh8": ft(band["hs_m"]) if band else None,
        "swp8": band["peak_period_s"] if band else None,
    }


def append_verification_rows(stdmet_text, spec_text, spectral_texts, now=None):
    """Append one obs-vs-model row per hour to data/verification.json for
    every buoy observation newer than the last logged row (back to
    VERIF_BACKFILL_HOURS), oldest first. Best-effort: never lets a failure
    break the main buoy.json pipeline."""
    now = now or datetime.now(timezone.utc)
    obs = {}
    for dt, text in ndbc_rows(stdmet_text, 2).items():
        b = parse_stdmet(text)
        if b and b.get("wave_height") is not None:
            obs[dt] = b
    if not obs:
        print("  Verification: no buoy observation — skipping")
        return
    newest = max(obs)
    since = newest - timedelta(hours=VERIF_BACKFILL_HOURS)

    doc = {"buoy_id": BUOY_ID, "buoy_coords": [BUOY_LAT, BUOY_LON],
           "choc_point": [CHOC_LAT, CHOC_LON], "rows": []}
    if VERIF_OUTPUT.exists():
        try:
            with open(VERIF_OUTPUT) as f:
                loaded = json.load(f)
            if isinstance(loaded.get("rows"), list):
                doc["rows"] = loaded["rows"]
        except Exception as e:
            print(f"  Verification: could not read existing file ({e}) — starting fresh")
    last = max(filter(None, map(_row_t, doc["rows"])), default=None)

    spec = {dt: parse_spectral_summary(t) for dt, t in ndbc_rows(spec_text, 2, since).items()}
    spectral = {ext: ndbc_rows(spectral_texts.get(ext), 1, since - VERIF_MATCH) for ext in SPECTRAL_FILES}

    # Hold back observations the spectral files haven't caught up with yet
    # (data_spec is hourly and often an hour behind), so a later run logs
    # them complete instead of this one logging them half-empty. A file
    # that failed, or has fallen far behind, is not waited for.
    horizon = newest
    for times, slack in ((spec, timedelta(0)), (spectral["data_spec"], VERIF_MATCH)):
        if times and newest - max(times) <= VERIF_SOURCE_MAX_LAG:
            horizon = min(horizon, max(times) + slack)

    picks = {}  # model hour -> the observation nearest it
    for dt in obs:
        hour = _model_hour(dt)
        if not since <= dt <= horizon or (last and (dt <= last or hour <= _model_hour(last))):
            continue
        if hour not in picks or abs(dt - hour) < abs(picks[hour] - hour):
            picks[hour] = dt
    if not picks:
        print("  Verification: no new observation since the last row — skipping")
        return

    past_days = min(92, max(1, (now.date() - min(picks).date()).days))
    models = [fetch_model_series(lat, lon, past_days)
              for lat, lon in ((BUOY_LAT, BUOY_LON), (CHOC_LAT, CHOC_LON))]
    if models[0] is None and models[1] is None:
        print("  Verification: both model fetches failed — skipping (the next run back-fills)")
        return
    mb_series, mc_series = (m or {} for m in models)

    rows = []
    for hour in sorted(picks):
        dt = picks[hour]
        mb, mc = mb_series.get(hour), mc_series.get(hour)
        if mb is None and mc is None:
            continue
        sdt = _nearest(spectral["data_spec"], dt)
        bins = build_spectral_bins(*(spectral[ext].get(sdt) for ext in SPECTRAL_FILES)) if sdt else None
        rows.append({
            "t": dt.strftime("%Y-%m-%dT%H:%MZ"),
            "buoy": _verif_buoy(obs[dt], spec.get(dt), bins),
            "mb": mb,
            "mc": mc,
        })
    if not rows:
        print("  Verification: no model values for the new observations — skipping")
        return

    doc["rows"].extend(rows)
    doc["rows"] = doc["rows"][-VERIF_MAX_ROWS:]
    doc["updated"] = datetime.now(timezone.utc).isoformat()
    with open(VERIF_OUTPUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"  Verification: logged {len(rows)} obs {rows[0]['t']} … {rows[-1]['t']} ({len(doc['rows'])} rows)")


def load_previous_output():
    """The buoy.json this run replaces, or {} when missing or unreadable."""
    try:
        with open(OUTPUT) as f:
            prev = json.load(f)
        return prev if isinstance(prev, dict) else {}
    except (OSError, ValueError):
        return {}


def main():
    print(f"Fetching NDBC buoy {BUOY_ID} data...")
    fetch_time = datetime.now(timezone.utc).isoformat()

    # Fetch standard meteorological data
    print(f"  Fetching {BUOY_ID}.txt (stdmet)...")
    stdmet_text = fetch_text(f"{NDBC_BASE}{BUOY_ID}.txt")
    buoy = parse_stdmet(stdmet_text)

    # Fetch spectral summary
    print(f"  Fetching {BUOY_ID}.spec (spectral summary)...")
    spec_text = fetch_text(f"{NDBC_BASE}{BUOY_ID}.spec")
    spectral = parse_spectral_summary(spec_text)

    # Fetch all 6 spectral bin files
    spectral_texts = {}
    for ext in SPECTRAL_FILES:
        print(f"  Fetching {BUOY_ID}.{ext}...")
        spectral_texts[ext] = fetch_text(f"{NDBC_BASE}{BUOY_ID}.{ext}")

    spectral_bins = build_spectral_bins(
        spectral_texts.get("data_spec"),
        spectral_texts.get("swdir"),
        spectral_texts.get("swdir2"),
        spectral_texts.get("swr1"),
        spectral_texts.get("swr2"),
    )
    spectral_obs_time = ndbc_row_time(spectral_texts.get("data_spec")) if spectral_bins else None

    # Energy-weighted swell direction from bins overrides the coarse 22.5°
    # compass value from .spec when bin data is available.
    if spectral_bins and spectral:
        derived = compute_primary_swell_dir(spectral_bins)
        if derived is not None:
            spectral["swell_direction"] = derived

    sections = {"buoy": buoy, "spectral_summary": spectral, "spectral_bins": spectral_bins}
    if all(v is None for v in sections.values()):
        # Nothing usable: keep the last good buoy.json. Failing the step
        # skips the workflow's commit and makes GitHub email the owner.
        print("::error title=NDBC 44097 fetch failed::Every NDBC file failed or was unreadable; "
              "data/buoy.json left as it was")
        sys.exit(1)

    # Partial outage: carry each missing section over from the previous
    # run instead of publishing nulls, and say which ones are old.
    stale = [k for k in DATA_SECTIONS if sections[k] is None]
    if stale:
        prev = load_previous_output()
        for k in stale:
            sections[k] = prev.get(k)
        if "spectral_bins" in stale:
            spectral_obs_time = prev.get("spectral_obs_time")
        print(f"::warning title=NDBC 44097 partial outage::Kept the previous {', '.join(stale)} in data/buoy.json")

    # Build output
    output = {
        "fetch_time": fetch_time,
        "buoy_id": BUOY_ID,
        "buoy_name": "Block Island, RI",
        "buoy_lat": 40.969,
        "buoy_lon": -71.124,
        "buoy": sections["buoy"],
        "spectral_summary": sections["spectral_summary"],
        "spectral_bins": sections["spectral_bins"],
        # data_spec row time ("YYYY-MM-DD HH:MM UTC"). The spectrum is hourly
        # and can trail buoy.time, or be much older when carried over.
        "spectral_obs_time": spectral_obs_time,
        "swell_band": compute_swell_band(sections["spectral_bins"]),
        "stale_sections": stale,
    }

    # Write JSON
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(output, f, indent=2)

    print(f"  Wrote {OUTPUT}")

    # Report
    if buoy:
        wh = buoy.get("wave_height")
        dp = buoy.get("dominant_period")
        print(f"  Wave height: {wh} ft, Period: {dp}s")
    else:
        print("  Warning: no buoy data parsed")

    if spectral:
        sh = spectral.get("swell_height_m")
        sp = spectral.get("swell_period")
        print(f"  Swell: {sh}m, {sp}s")
    else:
        print("  Warning: no spectral data parsed")

    if spectral_bins:
        print(f"  Spectral bins: {len(spectral_bins)} frequency bins")
        band = output["swell_band"]
        print(f"  {SWELL_BAND_MIN_PERIOD} s+ swell band: {band['hs_m']}m, {band['peak_period_s']}s, {band['dir_deg']}°")
    else:
        print("  Warning: no spectral bin data parsed")

    # Nowcast verification rows (best-effort; never fails the pipeline).
    try:
        append_verification_rows(stdmet_text, spec_text, spectral_texts)
    except Exception as e:
        print(f"  Verification: unexpected error: {e}")


if __name__ == "__main__":
    main()
