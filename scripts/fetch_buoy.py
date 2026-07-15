#!/usr/bin/env python3
"""
fetch_buoy.py — Fetches NDBC buoy 44097 data for Chocomount fallback.
Writes data/buoy.json. Run by GitHub Actions every 2 hours.
Only needed when CORS proxy is unavailable.
"""

import json
import sys
from datetime import datetime, timezone
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

# ── Nowcast verification ─────────────────────────────────────────────
# Every run also logs one row comparing the buoy's latest observation
# against the Open-Meteo model's value for that same hour, at two grid
# points: the buoy itself (model skill) and the app's Choc forecast
# point (spatial difference). The site plots data/verification.json.
VERIF_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "verification.json"
BUOY_LAT, BUOY_LON = 40.969, -71.124
CHOC_LAT, CHOC_LON = 41.089152, -71.721050  # CONFIG.chocomount.forecastLat/Lon
MARINE_API = "https://marine-api.open-meteo.com/v1/marine"
VERIF_MAX_ROWS = 4500  # ~1 year at 12 rows/day
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

    if len(data) < len(headers):
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
    if len(data) < 15:
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
    if len(lines) < 2:
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


def compute_primary_swell_dir(bins):
    """Energy-weighted circular mean of dir1, restricted to swell band (>=8s).
    Falls back to all positive-energy bins if the swell band is empty."""
    if not bins:
        return None
    import math
    swell = [b for b in bins if b["period"] >= 8 and b["energy"] > 0]
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


def fetch_model_hour(lat, lon, obs_dt):
    """Open-Meteo marine hourly values (converted to ft) nearest obs_dt,
    or None when the fetch fails or no sample lands within 90 minutes."""
    try:
        resp = requests.get(MARINE_API, params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "wave_height,wave_period,swell_wave_height,"
                      "swell_wave_period,swell_wave_direction",
            "past_days": 1,
            "forecast_days": 1,
            "timezone": "UTC",
        }, timeout=30)
        resp.raise_for_status()
        hourly = resp.json().get("hourly") or {}
        times = hourly.get("time") or []
        best, best_d = -1, 90 * 60
        for i, t in enumerate(times):
            dt = datetime.strptime(t, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
            d = abs((dt - obs_dt).total_seconds())
            if d < best_d:
                best, best_d = i, d
        if best < 0:
            return None

        def val(key, ft=False):
            arr = hourly.get(key) or []
            v = arr[best] if best < len(arr) else None
            if v is None:
                return None
            return round(v * M_TO_FT, 2) if ft else round(v, 1)

        return {
            "hs": val("wave_height", ft=True),
            "wvp": val("wave_period"),
            "swh": val("swell_wave_height", ft=True),
            "swp": val("swell_wave_period"),
            "swd": val("swell_wave_direction"),
        }
    except Exception as e:
        print(f"  Verification: model fetch failed at {lat},{lon}: {e}")
        return None


def append_verification_row(buoy, spectral):
    """Append one obs-vs-model row to data/verification.json. Best-effort:
    never lets a failure break the main buoy.json pipeline."""
    if not buoy or buoy.get("wave_height") is None:
        print("  Verification: no buoy observation — skipping row")
        return
    try:
        obs_dt = datetime.strptime(buoy["time"], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
    except (ValueError, KeyError) as e:
        print(f"  Verification: unparseable obs time: {e}")
        return

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

    t_iso = obs_dt.strftime("%Y-%m-%dT%H:%MZ")
    if doc["rows"] and doc["rows"][-1].get("t") == t_iso:
        print(f"  Verification: obs {t_iso} already logged — skipping")
        return

    spectral = spectral or {}
    swh_m = spectral.get("swell_height_m")
    row = {
        "t": t_iso,
        "buoy": {
            "hs": buoy.get("wave_height"),
            "dpd": buoy.get("dominant_period"),
            "mwd": buoy.get("mean_wave_direction"),
            "swh": round(swh_m * M_TO_FT, 2) if swh_m is not None else None,
            "swp": spectral.get("swell_period"),
            "swd": spectral.get("swell_direction"),
        },
        "mb": fetch_model_hour(BUOY_LAT, BUOY_LON, obs_dt),
        "mc": fetch_model_hour(CHOC_LAT, CHOC_LON, obs_dt),
    }
    if row["mb"] is None and row["mc"] is None:
        print("  Verification: both model fetches failed — skipping row")
        return

    doc["rows"].append(row)
    doc["rows"] = doc["rows"][-VERIF_MAX_ROWS:]
    doc["updated"] = datetime.now(timezone.utc).isoformat()
    with open(VERIF_OUTPUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"  Verification: logged obs {t_iso} ({len(doc['rows'])} rows)")


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
    spectral_files = ["data_spec", "swdir", "swdir2", "swr1", "swr2"]
    spectral_texts = {}
    for ext in spectral_files:
        print(f"  Fetching {BUOY_ID}.{ext}...")
        spectral_texts[ext] = fetch_text(f"{NDBC_BASE}{BUOY_ID}.{ext}")

    spectral_bins = build_spectral_bins(
        spectral_texts.get("data_spec"),
        spectral_texts.get("swdir"),
        spectral_texts.get("swdir2"),
        spectral_texts.get("swr1"),
        spectral_texts.get("swr2"),
    )

    # Energy-weighted swell direction from bins overrides the coarse 22.5°
    # compass value from .spec when bin data is available.
    if spectral_bins and spectral:
        derived = compute_primary_swell_dir(spectral_bins)
        if derived is not None:
            spectral["swell_direction"] = derived

    # Build output
    output = {
        "fetch_time": fetch_time,
        "buoy_id": BUOY_ID,
        "buoy_name": "Block Island, RI",
        "buoy_lat": 40.969,
        "buoy_lon": -71.124,
        "buoy": buoy,
        "spectral_summary": spectral,
        "spectral_bins": spectral_bins,
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
    else:
        print("  Warning: no spectral bin data parsed")

    # Nowcast verification row (best-effort; never fails the pipeline).
    try:
        append_verification_row(buoy, spectral)
    except Exception as e:
        print(f"  Verification: unexpected error: {e}")


if __name__ == "__main__":
    main()
