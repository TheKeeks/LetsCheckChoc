"""Offline tests for scripts/forecast/fcpull.py, the Sound Check forecast pull that
.github/workflows/update-forecast.yml runs every few hours.

Run: npm run test:py   (python3 -m unittest discover -s scripts -p 'test_*.py')

Nothing here touches the network: the module's get() is replaced by a stub that
answers only for the model runs a test says are published, and the clock is pinned.
The pull needs numpy, Pillow and eccodes (CI's Python job installs them); without
them these tests are skipped.
"""

import datetime as dt
import importlib.util
import types
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "forecast" / "fcpull.py"
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 9, 19, 50, tzinfo=UTC)   # a Friday afternoon (3:50 pm EDT)

try:
    import numpy  # noqa: F401
    import eccodes  # noqa: F401
    import PIL  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False


def load_fcpull(published):
    """The module with its clock pinned at NOW and get() answering only for runs in `published`
    (a set of (model, cycle datetime)); every other request fails like a missing file."""
    spec = importlib.util.spec_from_file_location("fcpull_under_test", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    class Clock(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW
    m.dt = types.SimpleNamespace(datetime=Clock, timedelta=dt.timedelta, timezone=dt.timezone)
    asked = []

    def get(url, a=None, b=None, tries=4):
        asked.append(url)
        for model, c in published:
            stamp = f"gfs.{c:%Y%m%d}/{c:%H}/wave" if model == "gfs" else f"forecasts/{c:%Y%m%d}/{c:%H}z/"
            if stamp in url:
                return b"ok"
        raise OSError("404 " + url)
    m.get = get
    return m, asked


@unittest.skipUnless(HAVE_DEPS, "fcpull needs numpy, Pillow and eccodes")
class TestWhichRun(unittest.TestCase):
    def test_newest_complete_gfs_run(self):
        m, _ = load_fcpull({("gfs", dt.datetime(2026, 10, 9, 18, tzinfo=UTC)), ("gfs", dt.datetime(2026, 10, 9, 12, tzinfo=UTC))})
        self.assertEqual(m.latest_gfs(), dt.datetime(2026, 10, 9, 18, tzinfo=UTC))

    def test_gfs_run_still_coming_in_falls_back(self):
        # 18Z isn't complete yet (no index for its last step): the 12Z run is used
        m, asked = load_fcpull({("gfs", dt.datetime(2026, 10, 9, 12, tzinfo=UTC))})
        self.assertEqual(m.latest_gfs(), dt.datetime(2026, 10, 9, 12, tzinfo=UTC))
        self.assertIn("f168.grib2.idx", asked[0], "a run counts once its last step (168 h) is out")

    def test_ecmwf_runs_every_12_hours(self):
        m, _ = load_fcpull({("ec", dt.datetime(2026, 10, 9, 0, tzinfo=UTC))})
        self.assertEqual(m.latest_ec(), dt.datetime(2026, 10, 9, 0, tzinfo=UTC))

    def test_nothing_published_for_two_days_fails(self):
        # exits non-zero, so the workflow skips publishing and fc-data keeps the last good pull
        m, _ = load_fcpull(set())
        with self.assertRaises(SystemExit):
            m.latest_gfs()
        with self.assertRaises(SystemExit):
            m.latest_ec()


@unittest.skipUnless(HAVE_DEPS, "fcpull needs numpy, Pillow and eccodes")
class TestTieToChoc(unittest.TestCase):
    def test_swell_window(self):
        # the same 12 s swell reaches Choc bigger from inside the 115-158 deg window than from either side
        m, _ = load_fcpull(set())
        inside = m.train_ft(1.0, 12, 136, "w1", "choc")
        for outside in (60, 220):
            self.assertGreater(inside, 1.5 * m.train_ft(1.0, 12, outside, "w1", "choc"), outside)

    def test_missing_cell_encodes_as_no_data(self):
        m, _ = load_fcpull(set())
        self.assertEqual(list(m.q8(numpy.array([float("nan"), 1.23, 99.0]), 10)), [255, 12, 254])


if __name__ == "__main__":
    unittest.main()
