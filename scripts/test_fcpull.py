"""Offline tests for scripts/forecast/fcpull.py, the Sound Check forecast pull that
.github/workflows/update-forecast.yml runs every few hours.

Run: npm run test:py   (python3 -m unittest discover -s scripts -p 'test_*.py')

Nothing here touches the network: the module's get() is replaced by a stub that
answers only for the model runs a test says are published, and the clock is pinned.
The pull needs numpy, Pillow and eccodes (CI's Python job installs them); without
them these tests are skipped.
"""

import datetime as dt
import email.message
import importlib.util
import json
import types
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent / "forecast" / "fcpull.py"
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 9, 19, 50, tzinfo=UTC)   # a Friday afternoon (3:50 pm EDT)
MIRROR, ECMWF = "https://storage.googleapis.com/ecmwf-open-data", "https://data.ecmwf.int/forecasts"

try:
    import numpy  # noqa: F401
    import eccodes  # noqa: F401
    import PIL  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False


def load_module():
    spec = importlib.util.spec_from_file_location("fcpull_under_test", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def load_fcpull(published):
    """The module with its clock pinned at NOW and get() answering only for runs in `published`, a set of
    (model, cycle datetime) or, for ECMWF, (model, cycle, source): a run with no source is on both ECMWF's
    mirror and ECMWF itself. Every other request fails like a missing file."""
    m = load_module()

    class Clock(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW
    m.dt = types.SimpleNamespace(datetime=Clock, timedelta=dt.timedelta, timezone=dt.timezone)
    asked = []

    def get(url, a=None, b=None, tries=6):
        asked.append(url)
        for model, c, *src in published:
            if model == "gfs":
                ok = f"gfs.{c:%Y%m%d}/{c:%H}/wave" in url
            else:
                ok = f"/{c:%Y%m%d}/{c:%H}z/ifs/" in url and url.startswith(tuple(src) or (MIRROR, ECMWF))
            if ok:
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
        self.assertEqual(m.latest_ec(), (dt.datetime(2026, 10, 9, 0, tzinfo=UTC), MIRROR))

    def test_ecmwf_from_its_google_mirror(self):
        # the bot's first run got HTTP 429 (too many requests) from data.ecmwf.int halfway through: GitHub's
        # runners share addresses. ECMWF's Google Cloud mirror has the same files without that limit (its AWS
        # mirror refused about 40% of byte-range reads with 503 Slow Down, even two at a time).
        m, asked = load_fcpull({("ec", dt.datetime(2026, 10, 9, 12, tzinfo=UTC))})
        self.assertEqual(m.latest_ec(), (dt.datetime(2026, 10, 9, 12, tzinfo=UTC), MIRROR))
        self.assertTrue(asked[0].startswith(MIRROR + "/"), asked[0])

    def test_ecmwf_itself_only_when_the_mirror_has_nothing(self):
        # a run that is only on ECMWF so far waits for the mirror (minutes behind)
        m, _ = load_fcpull({("ec", dt.datetime(2026, 10, 9, 12, tzinfo=UTC), ECMWF), ("ec", dt.datetime(2026, 10, 9, 0, tzinfo=UTC), MIRROR)})
        self.assertEqual(m.latest_ec(), (dt.datetime(2026, 10, 9, 0, tzinfo=UTC), MIRROR))
        # with nothing on the mirror for two days, ECMWF itself
        m, _ = load_fcpull({("ec", dt.datetime(2026, 10, 9, 12, tzinfo=UTC), ECMWF)})
        self.assertEqual(m.latest_ec(), (dt.datetime(2026, 10, 9, 12, tzinfo=UTC), ECMWF))

    def test_ecmwf_fields_come_from_the_chosen_source(self):
        m, asked = load_fcpull(set())
        index = "\n".join(json.dumps({"param": k, "_offset": 10 * i, "_length": 10}) for i, k in enumerate(m.EC_VARS)).encode()
        m.get = lambda url, a=None, b=None, tries=6: (asked.append(url), index if url.endswith(".index") else b"grib")[1]
        m.decode = lambda msg: msg
        step, out = m.ec_step(dt.datetime(2026, 10, 9, 12, tzinfo=UTC), MIRROR, 24)
        self.assertEqual((step, sorted(out)), (24, sorted(m.EC_VARS)))
        self.assertTrue(asked and all(u.startswith(MIRROR + "/20261009/12z/ifs/0p25/wave/20261009120000-24h-wave-fc") for u in asked), asked)

    def test_nothing_published_for_two_days_fails(self):
        # exits non-zero, so the workflow skips publishing and fc-data keeps the last good pull
        m, _ = load_fcpull(set())
        with self.assertRaises(SystemExit):
            m.latest_gfs()
        with self.assertRaises(SystemExit):
            m.latest_ec()


@unittest.skipUnless(HAVE_DEPS, "fcpull needs numpy, Pillow and eccodes")
class TestDownloads(unittest.TestCase):
    def test_a_busy_server_is_waited_out(self):
        # two "429 Too Many Requests", then the file: the first wait is what the server asks for (Retry-After),
        # the second a back-off
        m = load_module()
        busy = email.message.Message(); busy["Retry-After"] = "7"
        answers = [urllib.error.HTTPError("u", 429, "Too Many Requests", busy, None),
                   urllib.error.HTTPError("u", 429, "Too Many Requests", email.message.Message(), None),
                   mock.Mock(read=lambda: b"grib")]
        def urlopen(rq, timeout=None):
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a
        with mock.patch.object(m.urllib.request, "urlopen", urlopen), mock.patch("time.sleep") as sleep:
            self.assertEqual(m.get("https://example.test/f.grib2", 0, 9), b"grib")
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [7, 4])


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


@unittest.skipUnless(HAVE_DEPS, "fcpull needs numpy, Pillow and eccodes")
class TestPressure(unittest.TestCase):
    """Sea-level pressure for the Forecast tab's storm view (field_gfs_mslp.png)."""

    def grib(self, values, bitmap):
        """a GRIB2 message on a 1 deg global grid holding `values` (181 x 360, north row first)"""
        g = eccodes.codes_grib_new_from_samples("regular_ll_sfc_grib2")
        for k, v in (("Ni", 360), ("Nj", 181), ("latitudeOfFirstGridPointInDegrees", 90), ("longitudeOfFirstGridPointInDegrees", 0),
                     ("latitudeOfLastGridPointInDegrees", -90), ("longitudeOfLastGridPointInDegrees", 359),
                     ("iDirectionIncrementInDegrees", 1), ("jDirectionIncrementInDegrees", 1)):
            eccodes.codes_set(g, k, v)
        eccodes.codes_set(g, "bitmapPresent", 1 if bitmap else 0)
        eccodes.codes_set_values(g, values.ravel())
        msg = eccodes.codes_get_message(g)
        eccodes.codes_release(g)
        return msg

    def test_pressure_in_pascals_is_not_read_as_missing(self):
        # PRMSL comes in Pa (about 101325), above the GRIB missing value 9999: it has no bitmap, so every value stays
        m, _ = load_fcpull(set())
        f = m.decode(self.grib(numpy.full((181, 360), 101325.0), bitmap=False))
        self.assertEqual(int(numpy.isnan(f["v"]).sum()), 0)
        self.assertAlmostEqual(float(f["v"][90, 0]), 101325.0, delta=1)

    def test_a_wave_field_still_masks_its_land(self):
        m, _ = load_fcpull(set())
        v = numpy.full((181, 360), 1.5)
        v[:10, :] = 9999.0                                   # the missing value marks the cells with no data
        f = m.decode(self.grib(v, bitmap=True))
        self.assertTrue(numpy.isnan(f["v"][:10]).all())
        self.assertFalse(numpy.isnan(f["v"][10:]).any())

    def test_encoding_round_trip(self):
        m, _ = load_fcpull(set())
        got = m.dec_hpa(m.enc_hpa(numpy.array([950.04, 1013.25, float("nan"), 1041.4, 700.0])))
        self.assertAlmostEqual(got[0], 950.0, places=6)
        self.assertAlmostEqual(got[1], 1013.2, delta=0.051)
        self.assertTrue(numpy.isnan(got[2]))
        self.assertAlmostEqual(got[3], 1041.4, places=6)
        self.assertTrue(numpy.isnan(got[4]), "below the range: no data, never a made-up pressure")

    def test_image_rows_are_steps_and_cells_follow_the_swell_fields(self):
        # a field where the pressure says where it is: 1000 hPa + latitude / 10 + (longitude + 180) / 1000 (40 N 70 W: 1004.11)
        m, _ = load_fcpull(set())
        lat = 90 - numpy.arange(181)[:, None]
        lon = numpy.arange(360)[None, :]
        lon = numpy.where(lon >= 180, lon - 360, lon)
        f = dict(v=(100000.0 + 10.0 * lat + 0.1 * (lon + 180)) * numpy.ones((181, 360)), la0=90.0, lo0=0.0, dl=1.0, dj=1.0, ni=360, nj=181)
        img = m.mslp_image({s: f for s in m.STEPS})
        la, lo = m.grid_axes("ocean")
        self.assertEqual(img.shape, (len(m.STEPS), len(la) * len(lo), 3))
        i, j = list(la).index(40.0), list(lo).index(-70.0)
        p = m.dec_hpa(img[5, i * len(lo) + j])
        self.assertAlmostEqual(float(p), 1000.0 + 4.0 + 0.11, delta=0.06)


if __name__ == "__main__":
    unittest.main()
