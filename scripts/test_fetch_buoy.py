"""Offline baseline tests for scripts/fetch_buoy.py.

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
import sys
import tempfile
import types
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
FIXTURES = REPO_ROOT / "tests" / "fixtures"
NDBC_EXTS = ("txt", "spec", "data_spec", "swdir", "swdir2", "swr1", "swr2")


def ndbc_fixture(ext, buoy="44097"):
    """Text of a recorded NDBC realtime2 file, e.g. ndbc_fixture('spec')."""
    return (FIXTURES / "ndbc" / f"{buoy}.{ext}").read_text()


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
        # Only the energy file is required; missing directional files default.
        only_energy = self.fb.build_spectral_bins(ndbc_fixture("data_spec"), None, None, None, None)
        self.assertEqual(only_energy[0]["r1"], 0.5)
        self.assertIsNone(self.fb.build_spectral_bins(None, None, None, None, None))


class MainOffline(unittest.TestCase):
    """main() end to end on fixtures, writing only to a temp dir."""

    def test_main_writes_buoy_json_and_a_verification_row(self):
        data_dir = REPO_ROOT / "data"
        before = {p.name: _digest(p) for p in (data_dir / "buoy.json", data_dir / "verification.json")}
        with tempfile.TemporaryDirectory() as tmp:
            fb = load_fetch_buoy(tmp)
            fb.fetch_text = lambda url: ndbc_fixture(url.rsplit(".", 1)[1]) if url.rsplit(".", 1)[1] in NDBC_EXTS else None
            fb.fetch_model_hour = lambda lat, lon, obs_dt: {"hs": 2.0, "wvp": 6.0, "swh": 1.5, "swp": 8.0, "swd": 130}
            with contextlib.redirect_stdout(io.StringIO()):
                fb.main()

            out = json.loads((Path(tmp) / "buoy.json").read_text())
            self.assertEqual(out["buoy_id"], "44097")
            self.assertEqual(out["buoy"]["time"], "2026-10-01 14:00 UTC")
            self.assertEqual(out["spectral_summary"]["swell_period"], 10.5)
            self.assertEqual(len(out["spectral_bins"]), 98)

            verif = json.loads((Path(tmp) / "verification.json").read_text())
            self.assertTrue(any(r["t"] == "2026-10-01T14:00Z" for r in verif["rows"]))
        after = {p.name: _digest(p) for p in (data_dir / "buoy.json", data_dir / "verification.json")}
        self.assertEqual(before, after, "tests must never write data/*.json")

    def test_network_is_refused(self):
        fb = load_fetch_buoy()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertIsNone(fb.fetch_text("https://www.ndbc.noaa.gov/data/realtime2/44097.txt"))
        self.assertIn("network disabled in tests", out.getvalue())


if __name__ == "__main__":
    unittest.main()
