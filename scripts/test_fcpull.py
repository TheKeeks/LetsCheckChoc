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


@unittest.skipUnless(HAVE_DEPS, "fcpull needs numpy, Pillow and eccodes")
class TestTenDays(unittest.TestCase):
    """Days 8-10 for the Forecast tab's "10 days" switch: the same pull, kept apart from the week (fc.json's ext and
    field_*_x.png), all of them or none."""

    def field(self, v):
        return dict(v=numpy.full((181, 360), float(v), numpy.float32), la0=90.0, lo0=0.0, dl=1.0, dj=1.0, ni=360, nj=181)

    def run_pull(self, ec_reaches=240):
        import tempfile
        from PIL import Image
        m, _ = load_fcpull(set())
        cg, ce = dt.datetime(2026, 10, 9, 12, tzinfo=UTC), dt.datetime(2026, 10, 9, 12, tzinfo=UTC)
        m.latest_gfs = lambda: cg
        m.latest_ec = lambda: (ce, MIRROR)
        gv = dict(hs=1.5, w1h=1.2, w1t=11, w1d=140, w2h=0.5, w2t=8, w2d=100, w3h=0.3, w3t=6, w3d=180, wwh=0.4, wwt=4, wwd=200, wind=5, wdir=330)
        asked = []
        def gfs(c, s):
            asked.append(("gfs", s)); return s, {k: self.field(v + s / 1000) for k, v in gv.items()}
        def ec(c, src, s):
            asked.append(("ec", s))
            if s > ec_reaches: raise OSError("404: this run doesn't reach %d h yet" % s)
            return s, {k: self.field(v) for k, v in dict(swh=1.4, mwd=135, pp1d=10, h1012=0.3, h1214=0.2, h1417=0.1, h1721=0, h2125=0, h2530=0).items()}
        m.gfs_step, m.gfs_glob_step, m.ec_step = gfs, gfs, ec
        m.gfs_mslp_step = lambda c, s: (s, self.field(101300.0))
        out = tempfile.mkdtemp()
        m.main(out)
        fc = json.loads(Path(out, "fc.json").read_text())
        rows = {}
        for f in Path(out).glob("field_*.png"):
            with Image.open(f) as im: rows[f.name] = im.size[1]
        return m, fc, rows, asked

    def test_days_8_to_10_ride_along_in_their_own_files(self):
        m, fc, rows, asked = self.run_pull()
        self.assertEqual(m.XSTEPS, list(range(174, 241, 6)))
        self.assertEqual(fc["steps"], m.STEPS, "the week as before")
        self.assertEqual(len(fc["gfs"]), len(m.STEPS))
        self.assertEqual(fc["gfs"][-1]["t"], "2026-10-16T12:00Z", "the week ends 168 h after the run")
        x = fc["ext"]
        self.assertEqual(x["steps"], m.XSTEPS)
        self.assertEqual([r["t"] for r in x["gfs"]][:2], ["2026-10-16T18:00Z", "2026-10-17T00:00Z"])
        self.assertEqual(x["gfs"][-1]["t"], "2026-10-19T12:00Z", "10 days after the run")
        self.assertEqual(len(x["ec"]), len(m.XSTEPS))
        self.assertTrue(all(r["choc"] is not None for r in x["ec"]))
        self.assertTrue(x["mslp"])
        for name in ("field_gfs_reg", "field_gfs_ocean", "field_ec_reg", "field_ec_ocean", "field_gfs_reg_sw", "field_gfs_ocean_sw", "field_gfs_mslp"):
            self.assertEqual(rows[name + ".png"], len(m.STEPS), name + ": a row per step of the week")
            self.assertEqual(rows[name + "_x.png"], len(m.XSTEPS), name + "_x: a row per step of days 8-10")
        self.assertIn(("ec", 240), asked)

    def test_a_run_that_doesnt_reach_day_10_yet_publishes_the_week_alone(self):
        m, fc, rows, _ = self.run_pull(ec_reaches=200)
        self.assertNotIn("ext", fc)
        self.assertEqual(len(fc["gfs"]), len(m.STEPS))
        self.assertEqual(sorted(n for n in rows if n.endswith("_x.png")), [], "no half-written days 8-10")
        self.assertEqual(rows["field_gfs_reg.png"], len(m.STEPS))


if __name__ == "__main__":
    unittest.main()
