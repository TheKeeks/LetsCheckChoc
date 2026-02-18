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


def parse_spectral_summary(text):
    """Parse NDBC .spec spectral summary file."""
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

    return {
        "significant_wave_height_m": sf(5),
        "swell_height_m": sf(6),
        "swell_period": sf(7),
        "swell_direction": sf(8, invalid=999),
        "wind_wave_height_m": sf(9),
        "wind_wave_period": sf(10),
        "wind_wave_direction": sf(11, invalid=999),
    }


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

    # Build output
    output = {
        "fetch_time": fetch_time,
        "buoy_id": BUOY_ID,
        "buoy_name": "Block Island, RI",
        "buoy_lat": 40.969,
        "buoy_lon": -71.124,
        "buoy": buoy,
        "spectral_summary": spectral,
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


if __name__ == "__main__":
    main()
