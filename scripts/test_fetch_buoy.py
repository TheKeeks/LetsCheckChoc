"""Offline tests for scripts/fetch_buoy.py: the parser baseline, plus the
audit fixes for outages (C06), the 8 s+ swell band (C14) and back-filled,
like-for-like verification rows (C15).

Run: npm run test:py   (python3 -m unittest discover -s scripts -p 'test_*.py')

Fixtures are the trimmed NDBC 44097 realtime2 files in tests/fixtures/ndbc
(recorded 2026-10-01). Nothing here touches the network or data/*.json:
load_fetch_buoy() points OUTPUT / VERIF_OUTPUT at a temp dir and swaps the
module's `requests` for a stub that refuses to connect. Other test files can
reuse it:  from test_fetch_buoy import load_fetch_buoy, ndbc_fixture
"""

import contextlib
import hashlib
import importlib.util
import io
import json
import math
import shutil
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
FIXTURES = REPO_ROOT / "tests" / "fixtures"
NDBC_EXTS = ("txt", "spec", "data_spec", "swdir", "swdir2", "swr1", "swr2")
UTC = timezone.utc
NOW = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)   # fixture instant (11:00 EDT)


def ndbc_fixture(ext, buoy="44097"):
    """Text of a recorded NDBC realtime2 file, e.g. ndbc_fixture('spec')."""
    return (FIXTURES / "ndbc" / f"{buoy}.{ext}").read_text()


def ndbc_as_of(ext, cutoff):
    """The recorded file as NDBC served it at `cutoff`: rows newer are dropped."""
    out = []
    for line in ndbc_fixture(ext).split("\n"):
        cols = line.split()
        if line.startswith("#") or len(cols) < 5 or datetime(*map(int, cols[:5]), tzinfo=UTC) <= cutoff:
            out.append(line)
    return "\n".join(out)


def fixture_fetch_text(exts=NDBC_EXTS, text_for=ndbc_fixture):
    """A fetch_text stand-in: recorded files for `exts`, a failed fetch (None) otherwise."""
    def fetch_text(url):
        ext = url.rsplit(".", 1)[1]
        return text_for(ext) if ext in exts else None
    return fetch_text


def model_series_stub(calls=None, fail=False):
    """A fetch_model_series stand-in: five days of hourly model values from
    2026-09-28, slightly different at the buoy and the Choc point."""
    def fetch_model_series(lat, lon, past_days):
        if calls is not None:
            calls.append((lat, lon, past_days))
        if fail:
            return None
        hs = 2.3 if lat < 41 else 1.8
        t0 = datetime(2026, 9, 28, tzinfo=UTC)
        return {t0 + timedelta(hours=h): {"hs": hs, "wvp": 8.2, "wvd": 120.0, "swh": 2.1, "swp": 7.7, "swd": 112.0}
                for h in range(24 * 5)}
    return fetch_model_series


class _NoNetwork:
    """Stands in for the `requests` module: any request is a test bug."""

    class RequestException(Exception):
        pass

    def get(self, *args, **kwargs):
        raise RuntimeError(f"network disabled in tests: GET {args[0] if args else kwargs.get('url')}")


def load_fetch_buoy(out_dir=None):
    """Import a fresh copy of fetch_buoy.py with outputs redirected.

    The module's top-level `import requests` would pip-install requests when
    it is missing, so a stub is registered first in that case.
    """
    if "requests" not in sys.modules:
        try:
            import requests  # noqa: F401
        except ImportError:
            sys.modules["requests"] = types.ModuleType("requests")
    spec = importlib.util.spec_from_file_location("fetch_buoy_under_test", SCRIPTS_DIR / "fetch_buoy.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.requests = _NoNetwork()
    out_dir = Path(out_dir or tempfile.mkdtemp(prefix="lcc-fetch-buoy-"))
    mod.OUTPUT = out_dir / "buoy.json"
    mod.VERIF_OUTPUT = out_dir / "verification.json"
    return mod


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


class ParserBaseline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fb = load_fetch_buoy()

    def test_parse_stdmet_newest_row(self):
        b = self.fb.parse_stdmet(ndbc_fixture("txt"))
        self.assertEqual(b["time"], "2026-10-01 14:00 UTC")
        self.assertEqual(b["wave_height"], 1.97)          # 0.6 m → ft, 2 dp
        self.assertEqual(b["dominant_period"], 9.0)
        self.assertEqual(b["average_period"], 5.2)
        self.assertEqual(b["mean_wave_direction"], 132.0)
        self.assertEqual(b["water_temp"], 62.6)
        self.assertIsNone(b["wind_speed"])                # "MM"
        self.assertIsNone(self.fb.parse_stdmet(""))
        self.assertIsNone(self.fb.parse_stdmet(None))

    def test_parse_spectral_summary_compass_columns(self):
        s = self.fb.parse_spectral_summary(ndbc_fixture("spec"))
        self.assertEqual(s["significant_wave_height_m"], 0.6)
        self.assertEqual(s["swell_height_m"], 0.3)
        self.assertEqual(s["swell_period"], 10.5)
        self.assertEqual(s["swell_direction"], 135)       # "SE"
        self.assertEqual(s["wind_wave_direction"], 112.5)  # "ESE"
        self.assertEqual(s["mean_wave_direction"], 125.0)

    def test_parse_spectral_file_interleaved_pairs(self):
        energy = self.fb.parse_spectral_file(ndbc_fixture("data_spec"), has_sep_freq=True)
        self.assertEqual(len(energy["freqs"]), 98)   # 0.025–0.96 Hz
        self.assertEqual(energy["freqs"][0], 0.025)
        self.assertEqual(len(energy["freqs"]), len(energy["values"]))
        dirs = self.fb.parse_spectral_file(ndbc_fixture("swdir"))
        self.assertEqual(dirs["values"][0], 232.0)
        self.assertIsNone(self.fb.parse_spectral_file(""))

    def test_build_spectral_bins_and_primary_direction(self):
        bins = self.fb.build_spectral_bins(*(ndbc_fixture(e) for e in ("data_spec", "swdir", "swdir2", "swr1", "swr2")))
        self.assertEqual(len(bins), 98)
        self.assertEqual(set(bins[0]), {"freq", "period", "energy", "dir1", "dir2", "r1", "r2"})
        self.assertEqual(bins[0]["period"], 40.0)
        d = self.fb.compute_primary_swell_dir(bins)
        self.assertTrue(90 < d < 180, d)
        # Only the energy file is required; missing directional files default,
        # except the directions: unknown is None, never 0° (north).
        only_energy = self.fb.build_spectral_bins(ndbc_fixture("data_spec"), None, None, None, None)
        self.assertEqual(only_energy[0]["r1"], 0.5)
        self.assertTrue(all(b["dir1"] is None and b["dir2"] is None for b in only_energy))
        self.assertIsNone(self.fb.build_spectral_bins(None, None, None, None, None))


class MainOffline(unittest.TestCase):
    """main() end to end on fixtures, writing only to a temp dir."""

    def test_main_writes_buoy_json_and_a_verification_row(self):
        data_dir = REPO_ROOT / "data"
        before = {p.name: _digest(p) for p in (data_dir / "buoy.json", data_dir / "verification.json")}
        with tempfile.TemporaryDirectory() as tmp:
            fb = load_fetch_buoy(tmp)
            fb.fetch_text = fixture_fetch_text()
            fb.fetch_model_series = model_series_stub()
            with contextlib.redirect_stdout(io.StringIO()):
                fb.main()

            out = json.loads((Path(tmp) / "buoy.json").read_text())
            self.assertEqual(out["buoy_id"], "44097")
            self.assertEqual(out["buoy"]["time"], "2026-10-01 14:00 UTC")
            self.assertEqual(out["spectral_summary"]["swell_period"], 10.5)
            self.assertEqual(len(out["spectral_bins"]), 98)

            verif = json.loads((Path(tmp) / "verification.json").read_text())
            # The 14:00 obs waits for its hourly data_spec row (published
            # at 13:00 so far); a later run logs it complete.
            self.assertEqual(verif["rows"][-1]["t"], "2026-10-01T13:00Z")
        after = {p.name: _digest(p) for p in (data_dir / "buoy.json", data_dir / "verification.json")}
        self.assertEqual(before, after, "tests must never write data/*.json")

    def test_network_is_refused(self):
        fb = load_fetch_buoy()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertIsNone(fb.fetch_text("https://www.ndbc.noaa.gov/data/realtime2/44097.txt"))
        self.assertIn("network disabled in tests", out.getvalue())


# ── Audit C06: a failed NDBC fetch must not clobber the last good data ──

HTML_503 = """<!DOCTYPE html>
<html><head><title>503 Service Unavailable</title></head>
<body><h1>Service Unavailable</h1> The server is temporarily unable to service your request due to maintenance downtime or capacity problems. Please try again later. 0.6 9 5.2 132</body>
</html>
"""


class PipelineOutage(unittest.TestCase):
    """main() when some or all NDBC files fail (audit C06)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="lcc-outage-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        # Last good files: the pipeline snapshot (obs 12:30 UTC, 98 bins).
        self.prev = json.loads((FIXTURES / "pipeline" / "buoy.json").read_text())
        self.prev["spectral_obs_time"] = "2026-10-01 12:00 UTC"
        self.prev["spectral_summary"]["time"] = "2026-10-01 12:30 UTC"
        (self.tmp / "buoy.json").write_text(json.dumps(self.prev, indent=2))
        shutil.copy(FIXTURES / "pipeline" / "verification.json", self.tmp / "verification.json")
        self.fb = load_fetch_buoy(self.tmp)
        self.fb.fetch_model_series = model_series_stub()

    def run_main(self, now=NOW):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.fb.main(now=now)
        return json.loads((self.tmp / "buoy.json").read_text()), out.getvalue()

    def assert_exit_1_and_files_untouched(self, fetch_text):
        before = {p: _digest(self.tmp / p) for p in ("buoy.json", "verification.json")}
        self.fb.fetch_text = fetch_text
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as cm:
            self.fb.main()
        self.assertEqual(cm.exception.code, 1, "a failed step skips the workflow's commit")
        self.assertIn("::error", out.getvalue(), "GitHub annotation for the run page")
        self.assertEqual(before, {p: _digest(self.tmp / p) for p in ("buoy.json", "verification.json")})

    def test_total_outage_exits_1_and_keeps_last_good_files(self):
        self.assert_exit_1_and_files_untouched(lambda url: None)

    def test_html_error_page_counts_as_a_failed_fetch(self):
        self.assertIsNone(self.fb.parse_stdmet(HTML_503))
        self.assertIsNone(self.fb.parse_spectral_summary(HTML_503))
        self.assertIsNone(self.fb.parse_spectral_file(HTML_503, has_sep_freq=True))
        self.assert_exit_1_and_files_untouched(lambda url: HTML_503)

    def test_spectral_outage_carries_the_previous_spectrum_over(self):
        self.fb.fetch_text = fixture_fetch_text(exts=("txt",))
        out, log = self.run_main()
        self.assertEqual(out["buoy"]["time"], "2026-10-01 14:00 UTC", "stdmet is fresh")
        self.assertEqual(out["spectral_summary"], self.prev["spectral_summary"])
        self.assertEqual(out["spectral_bins"], self.prev["spectral_bins"])
        self.assertEqual(out["stale_sections"], ["spectral_summary", "spectral_bins"])
        self.assertEqual(out["spectral_obs_time"], "2026-10-01 12:00 UTC", "the carried spectrum keeps its own time")
        self.assertEqual(out["spectral_summary"]["time"], "2026-10-01 12:30 UTC", "and so does the .spec summary")
        self.assertEqual(out["swell_band"], self.fb.compute_swell_band(self.prev["spectral_bins"]))
        self.assertIn("::warning", log)

    def test_carried_spectrum_expires_after_6_hours(self):
        # The spectral files keep failing. Each run's output is the next
        # run's previous file, so only the spectrum's own time ends the
        # carry-over: past 6 h it is null again, as before carry-over, and
        # the swell card falls back to the fresh .txt reading.
        self.fb.fetch_text = fixture_fetch_text(exts=("txt",))
        out, _ = self.run_main(now=datetime(2026, 10, 1, 17, 59, tzinfo=UTC))
        self.assertEqual(out["spectral_bins"], self.prev["spectral_bins"], "data_spec row 5 h 59 min old: kept")

        out, log = self.run_main(now=datetime(2026, 10, 1, 18, 1, tzinfo=UTC))
        self.assertIsNone(out["spectral_bins"], "6 h 1 min old: not shown as the current swell")
        self.assertIsNone(out["swell_band"])
        self.assertIsNone(out["spectral_obs_time"])
        self.assertEqual(out["spectral_summary"], self.prev["spectral_summary"], ".spec row 12:30, 5.5 h old: kept")
        self.assertEqual(out["stale_sections"], ["spectral_summary", "spectral_bins"])
        self.assertIn("Kept the previous spectral_summary", log)
        self.assertIn("No recent spectral_bins to keep; published null", log)

        out, _ = self.run_main(now=datetime(2026, 10, 1, 18, 31, tzinfo=UTC))
        self.assertIsNone(out["spectral_summary"])
        self.assertIsNone(out["spectral_bins"])
        self.assertEqual(out["stale_sections"], ["spectral_summary", "spectral_bins"])
        self.assertEqual(out["buoy"]["time"], "2026-10-01 14:00 UTC", "stdmet stays fresh throughout")

        # NDBC recovers: everything is fresh again.
        self.fb.fetch_text = fixture_fetch_text()
        out, _ = self.run_main(now=datetime(2026, 10, 1, 20, 0, tzinfo=UTC))
        self.assertEqual((out["stale_sections"], len(out["spectral_bins"])), ([], 98))

    def test_a_carried_spectrum_with_no_time_is_not_trusted(self):
        # A buoy.json written before spectra were timed: their age is unknown.
        del self.prev["spectral_obs_time"], self.prev["spectral_summary"]["time"]
        (self.tmp / "buoy.json").write_text(json.dumps(self.prev))
        self.fb.fetch_text = fixture_fetch_text(exts=("txt",))
        out, _ = self.run_main()
        self.assertEqual((out["spectral_summary"], out["spectral_bins"], out["swell_band"]), (None, None, None))
        self.assertEqual(out["stale_sections"], ["spectral_summary", "spectral_bins"])

    def test_stdmet_outage_carries_the_previous_obs_over(self):
        self.fb.fetch_text = fixture_fetch_text(exts=tuple(e for e in NDBC_EXTS if e != "txt"))
        out, _ = self.run_main()
        self.assertEqual(out["buoy"], self.prev["buoy"])
        self.assertEqual(out["buoy"]["time"], "2026-10-01 12:30 UTC")
        self.assertEqual(out["stale_sections"], ["buoy"])
        self.assertEqual(out["spectral_obs_time"], "2026-10-01 13:00 UTC")
        self.assertEqual(len(out["spectral_bins"]), 98)

    def test_partial_outage_without_a_previous_file_stays_null(self):
        (self.tmp / "buoy.json").unlink()
        self.fb.fetch_text = fixture_fetch_text(exts=("txt",))
        out, _ = self.run_main()
        self.assertIsNone(out["spectral_bins"])
        self.assertIsNone(out["swell_band"])
        self.assertIsNone(out["spectral_obs_time"])
        self.assertEqual(out["stale_sections"], ["spectral_summary", "spectral_bins"])

    def test_healthy_run_lists_no_stale_sections(self):
        self.fb.fetch_text = fixture_fetch_text()
        out, _ = self.run_main()
        self.assertEqual(out["stale_sections"], [])
        self.assertEqual(out["spectral_obs_time"], "2026-10-01 13:00 UTC", "data_spec row, an hour behind stdmet")
        self.assertEqual(out["spectral_summary"]["time"], "2026-10-01 13:30 UTC", ".spec row")
        # Existing keys keep their meaning (audit C14: new data goes under new keys).
        self.assertEqual(out["spectral_summary"]["swell_height_m"], 0.3)
        self.assertEqual(set(out["swell_band"]), {"hs_m", "peak_period_s", "dir_deg", "min_period_s"})
        self.assertEqual(out["swell_band"]["min_period_s"], 8)
        self.assertGreater(out["swell_band"]["hs_m"], out["spectral_summary"]["swell_height_m"])
        self.assertTrue(115 <= out["swell_band"]["dir_deg"] <= 158, out["swell_band"])

    def test_swdir_outage_leaves_the_swell_direction_unknown_not_north(self):
        # Only the direction file fails (a timeout, or an error page served
        # with HTTP 200). The spectrum's energy is still good but its
        # direction is unknown: 0° would put the swell card's hero swell at
        # N, out of Choc's window, while the real swell is SE.
        healthy = self.fb.compute_swell_band(self.fb.build_spectral_bins(
            *(ndbc_fixture(e) for e in self.fb.SPECTRAL_FILES)))
        for swdir in (None, HTML_503):
            with self.subTest(swdir="failed" if swdir is None else "HTML page"):
                shutil.copy(FIXTURES / "pipeline" / "verification.json", self.tmp / "verification.json")
                self.fb.fetch_text = fixture_fetch_text(text_for=lambda e: swdir if e == "swdir" else ndbc_fixture(e))
                out, _ = self.run_main()
                self.assertEqual(out["stale_sections"], [], "the energy spectrum is fresh")
                self.assertEqual(len(out["spectral_bins"]), 98)
                self.assertTrue(all(b["dir1"] is None for b in out["spectral_bins"]))
                self.assertEqual(out["swell_band"], dict(healthy, dir_deg=None), "height and period still stand")
                self.assertEqual(out["spectral_summary"]["swell_direction"], 135, ".spec's own SwD (SE), not 0")
                row = json.loads((self.tmp / "verification.json").read_text())["rows"][-1]
                self.assertEqual((row["t"], row["buoy"]["swd"]), ("2026-10-01T13:00Z", 135))


# ── Audit C14 / C15: swell band and like-for-like periods ───────────────

def synthetic_bins(energy_by_freq, dir_by_freq=None):
    """Bins on an even 0.01 Hz grid (0.05–0.30 Hz), so every df is 0.01."""
    bins = []
    for k in range(5, 31):
        f = round(k * 0.01, 2)
        bins.append({"freq": f, "period": round(1 / f, 3), "energy": energy_by_freq.get(f, 0.0),
                     "dir1": (dir_by_freq or {}).get(f, 0.0), "dir2": 0.0, "r1": 0.5, "r2": 0.25})
    return bins


class SpectralBand(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fb = load_fetch_buoy()

    def test_bin_widths_follow_uneven_band_spacing(self):
        w = self.fb.bin_widths([0.09, 0.095, 0.1, 0.11, 0.12])
        for got, want in zip(w, [0.005, 0.005, 0.0075, 0.01, 0.01]):
            self.assertAlmostEqual(got, want, places=9)
        self.assertEqual(self.fb.bin_widths([0.1]), [0.0])

    def test_swell_band_on_a_synthetic_spectrum(self):
        # 2 m²/Hz at 10 s from 120°, 1 m²/Hz at 8.3 s from 150°, and a 5 s
        # wind sea (3 m²/Hz from 300°) that must not count.
        bins = synthetic_bins({0.10: 2.0, 0.12: 1.0, 0.20: 3.0}, {0.10: 120.0, 0.12: 150.0, 0.20: 300.0})
        band = self.fb.compute_swell_band(bins)
        self.assertEqual(band["hs_m"], round(4 * math.sqrt((2.0 + 1.0) * 0.01), 2))   # 0.69
        self.assertEqual(band["peak_period_s"], 10.0)
        x = 2 * math.cos(math.radians(120)) + math.cos(math.radians(150))
        y = 2 * math.sin(math.radians(120)) + math.sin(math.radians(150))
        self.assertAlmostEqual(band["dir_deg"], round(math.degrees(math.atan2(y, x)), 1), places=1)  # 129.9
        self.assertEqual(band["min_period_s"], 8)
        # NDBC's own 10 s split sees only the 10 s bin.
        self.assertEqual(self.fb.compute_swell_band(bins, min_period=10)["hs_m"], round(4 * math.sqrt(0.02), 2))

    def test_swell_band_edges(self):
        # 0.125 Hz is exactly 8.0 s and counts; 0.13 Hz (7.7 s) does not.
        edge = [{"freq": f, "period": round(1 / f, 3), "energy": 1.0, "dir1": 135.0, "dir2": 0, "r1": 0.5, "r2": 0.25}
                for f in (0.12, 0.125, 0.13)]
        band = self.fb.compute_swell_band(edge)
        self.assertEqual(band["hs_m"], round(4 * math.sqrt(1.0 * 0.005 + 1.0 * 0.005), 2))
        only_wind_sea = self.fb.compute_swell_band(synthetic_bins({0.20: 3.0}, {0.20: 300.0}))
        self.assertEqual(only_wind_sea, {"hs_m": 0.0, "peak_period_s": None, "dir_deg": None, "min_period_s": 8})
        self.assertIsNone(self.fb.compute_swell_band(None))
        self.assertIsNone(self.fb.compute_swell_band([]))

    def test_missing_directions_are_skipped_not_read_as_north(self):
        # NDBC writes 999.0 for a bin with no direction (999° would average
        # as 279°), and a failed swdir leaves dir1 None. Neither counts.
        bins = synthetic_bins({0.10: 2.0, 0.12: 1.0, 0.20: 3.0}, {0.10: 120.0, 0.12: 999.0, 0.20: 300.0})
        self.assertEqual(self.fb.compute_swell_band(bins)["dir_deg"], 120.0)
        self.assertEqual(self.fb.compute_primary_swell_dir(bins), 120.0)
        for b in bins:
            b["dir1"] = None
        band = self.fb.compute_swell_band(bins)
        self.assertEqual((band["hs_m"], band["peak_period_s"], band["dir_deg"]), (0.69, 10.0, None))
        self.assertIsNone(self.fb.compute_primary_swell_dir(bins))
        # A swell band with energy but no direction doesn't borrow the wind sea's.
        self.assertIsNone(self.fb.compute_primary_swell_dir(synthetic_bins({0.10: 2.0, 0.20: 3.0},
                                                                            {0.10: 999.0, 0.20: 300.0})))
        # The 999 code never reaches buoy.json's bins (the app would draw it).
        swdir = ndbc_fixture("swdir").replace(" 232.0 (0.025)", " 999.0 (0.025)", 1)
        bins = self.fb.build_spectral_bins(ndbc_fixture("data_spec"), swdir, None, None, None)
        self.assertEqual((bins[0]["dir1"], bins[1]["dir1"]), (None, 68.0))

    def test_real_event_where_ndbc_swh_missed_the_swell(self):
        # 44097 on 2026-09-23 19:00 UTC (.spec: WVHT 3.1 m, SwH 0.6 m @ 10.0 s,
        # WWH 3.1 m @ 8.7 s ESE). The swell card said 2 ft; the 8 s+ band
        # held 2.0 m (6.6 ft). Integration must also reproduce NDBC's numbers.
        text = (FIXTURES / "ndbc" / "44097-20260923T1900Z.data_spec").read_text()
        bins = self.fb.build_spectral_bins(text, None, None, None, None)
        band = self.fb.compute_swell_band(bins)
        self.assertAlmostEqual(band["hs_m"], 2.0, delta=0.1)
        self.assertEqual(band["peak_period_s"], 8.7)
        self.assertAlmostEqual(self.fb.compute_swell_band(bins, min_period=0)["hs_m"], 3.1, delta=0.1, msg="= WVHT")
        self.assertAlmostEqual(self.fb.compute_swell_band(bins, min_period=10)["hs_m"], 0.6, delta=0.11, msg="= SwH")
        self.assertEqual(self.fb.ndbc_row_time(text), "2026-09-23 19:00 UTC")

    def test_tm10_on_a_synthetic_spectrum(self):
        # Equal energy at 10 s and 5 s: Tm-1,0 = (10 + 5) / 2.
        self.assertEqual(self.fb.compute_tm10(synthetic_bins({0.10: 1.0, 0.20: 1.0})), 7.5)
        # 3:1 energy at 10 s and 5 s: (3·10 + 1·5) / 4.
        self.assertEqual(self.fb.compute_tm10(synthetic_bins({0.10: 3.0, 0.20: 1.0})), 8.75)
        self.assertIsNone(self.fb.compute_tm10(synthetic_bins({})))
        self.assertIsNone(self.fb.compute_tm10(None))
        # Real spectrum: between APD (5.2 s, which over-weights the short
        # chop) and the 10 s peak.
        bins = self.fb.build_spectral_bins(*(ndbc_fixture(e) for e in self.fb.SPECTRAL_FILES))
        self.assertTrue(5.2 < self.fb.compute_tm10(bins) < 10, self.fb.compute_tm10(bins))


# ── Audit C15: verification rows, back-filled across dropped cron runs ──

FRESH_HOURS = ["2026-09-30T23:00Z"] + [f"2026-10-01T{h:02d}:00Z" for h in range(14)]


class VerificationRows(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="lcc-verif-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.fb = load_fetch_buoy(self.tmp)
        self.calls = []
        self.fb.fetch_model_series = model_series_stub(self.calls)

    def append(self, text_for=ndbc_fixture, exts=NDBC_EXTS, now=NOW, fb=None):
        fb = fb or self.fb
        t = {e: (text_for(e) if e in exts else None) for e in NDBC_EXTS}
        with contextlib.redirect_stdout(io.StringIO()):
            fb.append_verification_rows(t["txt"], t["spec"], {e: t[e] for e in fb.SPECTRAL_FILES}, now=now)

    def rows(self, fb=None):
        path = (fb or self.fb).VERIF_OUTPUT
        return json.loads(path.read_text())["rows"] if path.exists() else []

    def test_fresh_log_gets_one_row_per_hour_with_like_for_like_fields(self):
        self.append()
        rows = self.rows()
        self.assertEqual([r["t"] for r in rows], FRESH_HOURS, "hourly, oldest first, up to data_spec's 13:00 row")
        r = rows[-1]
        # Buoy 13:00 row: WVHT 0.6 m, DPD 10, APD 5.4, MWD 123; .spec SwH 0.3 m @ 11.8 s.
        self.assertEqual({k: r["buoy"][k] for k in ("hs", "dpd", "apd", "mwd", "swh", "swp")},
                         {"hs": 1.97, "dpd": 10.0, "apd": 5.4, "mwd": 123.0, "swh": 0.98, "swp": 11.8})
        self.assertTrue(5.4 < r["buoy"]["tm10"] < 10, r["buoy"])
        self.assertGreater(r["buoy"]["swh8"], r["buoy"]["swh"], "the 8 s+ band includes the 8–10 s swell SwH drops")
        self.assertTrue(8 <= r["buoy"]["swp8"] <= 25)
        self.assertTrue(115 <= r["buoy"]["swd"] <= 158, "direction from the >=8 s bins, not .spec compass text")
        self.assertEqual(r["mb"]["wvd"], 120.0)
        self.assertEqual((r["mb"]["hs"], r["mc"]["hs"]), (2.3, 1.8))
        self.assertTrue(all(row["buoy"]["tm10"] is not None and row["mb"] for row in rows))

    def test_rerun_adds_no_duplicates(self):
        self.append()
        digest = _digest(self.tmp / "verification.json")
        self.append()
        self.assertEqual(_digest(self.tmp / "verification.json"), digest)

    def test_dropped_cron_runs_are_back_filled(self):
        # A run at 05:00, then GitHub drops every run until 14:00.
        cutoff = datetime(2026, 10, 1, 5, 0, tzinfo=UTC)
        self.append(text_for=lambda e: ndbc_as_of(e, cutoff), now=cutoff + timedelta(minutes=50))
        self.assertEqual(self.rows()[-1]["t"], "2026-10-01T05:00Z")
        self.append()
        backfilled = self.rows()

        other = Path(tempfile.mkdtemp(prefix="lcc-verif-"))
        self.addCleanup(shutil.rmtree, other, ignore_errors=True)
        fresh = load_fetch_buoy(other)
        fresh.fetch_model_series = model_series_stub()
        self.append(fb=fresh)
        self.assertEqual([r["t"] for r in backfilled], FRESH_HOURS)
        self.assertEqual(backfilled, self.rows(fresh), "same rows as if every run had fired")

    def test_continues_an_existing_log_without_overlap(self):
        shutil.copy(FIXTURES / "pipeline" / "verification.json", self.tmp / "verification.json")
        old = self.rows()
        self.assertEqual(old[-1]["t"], "2026-10-01T12:30Z")   # pairs with model hour 12:00
        self.append()
        rows = self.rows()
        self.assertEqual(rows[:len(old)], old, "existing rows are never rewritten")
        self.assertEqual([r["t"] for r in rows[len(old):]], ["2026-10-01T13:00Z"])

    def test_waits_for_a_lagging_data_spec_but_not_a_dead_one(self):
        # data_spec two hours behind stdmet: hours past it wait.
        lag = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
        spectral_as_of = lambda e: ndbc_as_of(e, lag) if e not in ("txt", "spec") else ndbc_fixture(e)
        self.append(text_for=spectral_as_of)
        self.assertEqual(self.rows()[-1]["t"], "2026-10-01T12:00Z")
        self.append()
        self.assertEqual(self.rows()[-1]["t"], "2026-10-01T13:00Z")

    def test_spectral_files_far_behind_are_not_waited_for(self):
        stuck = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)   # 5 h behind the 14:00 obs
        self.append(text_for=lambda e: ndbc_as_of(e, stuck) if e not in ("txt", "spec") else ndbc_fixture(e))
        rows = {r["t"]: r for r in self.rows()}
        self.assertEqual(list(rows)[-1], "2026-10-01T13:00Z", ".spec (13:30) still paces the log")
        self.assertIsNotNone(rows["2026-10-01T09:00Z"]["buoy"]["tm10"])
        self.assertIsNone(rows["2026-10-01T10:00Z"]["buoy"]["tm10"], "no data_spec row within 30 min")

    def test_rows_wait_for_a_lagging_swdir_instead_of_logging_north(self):
        # NDBC updates each file on its own: swdir an hour behind data_spec.
        # Rows are never revisited, so the 13:00 row waits for its direction.
        lag = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
        self.append(text_for=lambda e: ndbc_as_of(e, lag) if e == "swdir" else ndbc_fixture(e))
        self.assertEqual(self.rows()[-1]["t"], "2026-10-01T12:00Z")
        self.append()
        rows = self.rows()
        self.assertEqual([r["t"] for r in rows], FRESH_HOURS)
        self.assertTrue(115 <= rows[-1]["buoy"]["swd"] <= 158, rows[-1]["buoy"])

    def test_dead_swdir_logs_the_spec_direction_not_north(self):
        self.append(exts=tuple(e for e in NDBC_EXTS if e != "swdir"))
        rows = self.rows()
        self.assertEqual([r["t"] for r in rows], FRESH_HOURS, "a failed swdir is not waited for")
        spec_swd = {dt.strftime("%Y-%m-%dT%H:%MZ"): self.fb.parse_spectral_summary(t)["swell_direction"]
                    for dt, t in self.fb.ndbc_rows(ndbc_fixture("spec"), 2).items()}
        self.assertEqual([r["buoy"]["swd"] for r in rows], [spec_swd[r["t"]] for r in rows], ".spec SwD, never 0")
        self.assertNotIn(0, [r["buoy"]["swd"] for r in rows])

        # Everything that comes from the energy spectrum is unaffected.
        other = Path(tempfile.mkdtemp(prefix="lcc-verif-"))
        self.addCleanup(shutil.rmtree, other, ignore_errors=True)
        healthy = load_fetch_buoy(other)
        healthy.fetch_model_series = model_series_stub()
        self.append(fb=healthy)
        energy_keys = ("hs", "tm10", "swh8", "swp8")
        self.assertEqual([{k: r["buoy"][k] for k in energy_keys} for r in rows],
                         [{k: r["buoy"][k] for k in energy_keys} for r in self.rows(healthy)])

    def test_failed_spectral_files_do_not_hold_the_log_back(self):
        self.append(exts=("txt",))
        rows = self.rows()
        self.assertEqual(rows[-1]["t"], "2026-10-01T14:00Z")
        self.assertEqual({k: rows[-1]["buoy"][k] for k in ("swh", "swd", "tm10", "swh8", "swp8")},
                         {"swh": None, "swd": None, "tm10": None, "swh8": None, "swp8": None})

    def test_model_outage_logs_nothing_and_the_next_run_catches_up(self):
        self.fb.fetch_model_series = model_series_stub(fail=True)
        self.append()
        self.assertFalse((self.tmp / "verification.json").exists())
        self.fb.fetch_model_series = model_series_stub()
        self.append()
        self.assertEqual([r["t"] for r in self.rows()], FRESH_HOURS)

    def test_backfill_window_is_bounded(self):
        self.fb.VERIF_BACKFILL_HOURS = 3
        self.append()
        self.assertEqual([r["t"] for r in self.rows()], ["2026-10-01T11:00Z", "2026-10-01T12:00Z", "2026-10-01T13:00Z"])

    def test_one_model_request_per_point_reaching_the_oldest_hour(self):
        self.append(now=datetime(2026, 10, 3, 12, 0, tzinfo=UTC))
        self.assertEqual(self.calls, [(self.fb.BUOY_LAT, self.fb.BUOY_LON, 3), (self.fb.CHOC_LAT, self.fb.CHOC_LON, 3)])

    def test_off_hour_obs_pair_with_the_nearest_model_hour(self):
        # Some weeks 44097 reports at :26 / :56 instead of :00 / :30.
        head = "\n".join(ndbc_fixture("txt").split("\n")[:2])
        row = "2026 10 01 {} MM   MM   MM   0.6     9   5.2 132     MM  17.9  17.0    MM   MM   MM    MM"
        txt = "\n".join([head] + [row.format(t) for t in ("13 56", "13 26", "12 56", "12 26")])
        self.append(text_for=lambda e: txt if e == "txt" else None)
        # 12:26 → 12:00; 12:56 beats 13:26 for 13:00; 13:56 → 14:00.
        self.assertEqual([r["t"] for r in self.rows()], ["2026-10-01T12:26Z", "2026-10-01T12:56Z", "2026-10-01T13:56Z"])
        mh = self.fb._model_hour
        self.assertEqual(mh(datetime(2026, 10, 1, 13, 30, tzinfo=UTC)).hour, 13)
        self.assertEqual(mh(datetime(2026, 10, 1, 13, 31, tzinfo=UTC)).hour, 14)


class _FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status = payload, status

    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError(f"HTTP {self.status}")

    def json(self):
        return self.payload


class ModelSeries(unittest.TestCase):
    def test_one_request_returns_every_hour_with_wave_direction(self):
        fb = load_fetch_buoy()
        seen = []
        payload = {"hourly": {
            "time": ["2026-10-01T13:00", "2026-10-01T14:00"],
            "wave_height": [1.0, None], "wave_period": [8.24, 8.0], "wave_direction": [130, 131.26],
            "swell_wave_height": [0.5, 0.6], "swell_wave_period": [7.7, 7.8], "swell_wave_direction": [112, 113],
        }}
        fb.requests = types.SimpleNamespace(get=lambda url, params, timeout: seen.append(params) or _FakeResponse(payload))
        series = fb.fetch_model_series(fb.BUOY_LAT, fb.BUOY_LON, 2)
        self.assertIn("wave_direction", seen[0]["hourly"].split(","))
        self.assertEqual((seen[0]["past_days"], seen[0]["timezone"]), (2, "UTC"))
        self.assertEqual(series[datetime(2026, 10, 1, 13, tzinfo=UTC)],
                         {"hs": 3.28, "wvp": 8.2, "wvd": 130, "swh": 1.64, "swp": 7.7, "swd": 112})
        self.assertIsNone(series[datetime(2026, 10, 1, 14, tzinfo=UTC)]["hs"])
        self.assertEqual(series[datetime(2026, 10, 1, 14, tzinfo=UTC)]["wvd"], 131.3)

        fb.requests = types.SimpleNamespace(get=lambda url, params, timeout: _FakeResponse({}, status=503))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNone(fb.fetch_model_series(fb.BUOY_LAT, fb.BUOY_LON, 1))


if __name__ == "__main__":
    unittest.main()
