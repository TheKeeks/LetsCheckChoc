"""Tests for the Past days' pressure maps (scripts/history/pressure.py): the encoding, the rows, the regrid, the ERA5
reader and the update's fill / never-shrink / retry rules, all with the network blocked and made-up sources.

  python3 -m unittest scripts/test_pressure.py

Needs numpy and Pillow (skips without them); the ERA5 reader's test also needs numcodecs (blosc).
"""
import json, os, sys, tempfile, unittest, datetime as dt, urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
HISTORY = os.path.join(ROOT, 'scripts', 'history')
UTC = dt.timezone.utc
try:
    import numpy as np
    from PIL import Image
    HAVE = True
except ImportError:
    HAVE = False
try:
    import numcodecs
except ImportError:
    numcodecs = None
if HAVE:
    if HISTORY not in sys.path: sys.path.insert(0, HISTORY)
    import pressure as P


def no_network(*a, **k): raise AssertionError('the tests must not touch the network')


def T(s): return dt.datetime.fromisoformat(s).replace(tzinfo=UTC)


def rd(*p, mode='r'):
    with open(os.path.join(*p), mode) as f: return f.read()


class Fake:
    """a source: hPa = base + the step's hour of the year / 100 everywhere, except the steps in `fail`"""
    def __init__(self, name, fail=(), base=1000.0):
        self.name, self.fail, self.base, self.asked = name, set(fail), base, []
        self.stats = P.Stats()

    def rows(self, times):
        self.asked += list(times)
        return {t: None if t in self.fail else np.full(P.COLS, self.base + P.row_of(t)[1] / 100.0) for t in times}


@unittest.skipUnless(HAVE, 'needs numpy and Pillow')
class TestEncoding(unittest.TestCase):
    def setUp(self):
        self._urlopen = urllib.request.urlopen; urllib.request.urlopen = no_network

    def tearDown(self):
        urllib.request.urlopen = self._urlopen

    def test_round_trip_and_clamping(self):
        """940 + 0.5 v: half-hPa steps survive the trip, everything outside 940-1067 is clamped, no data is 255"""
        hpa = np.array([940.0, 940.2, 940.3, 1000.0, 1013.25, 1067.0, 1080.0, 900.0, np.nan])
        v = P.encode(hpa)
        self.assertEqual(v.dtype, np.uint8)
        self.assertEqual(v.tolist(), [0, 0, 1, 120, 146, 254, 254, 0, 255])
        back = P.decode(v)
        self.assertTrue(np.isnan(back[-1]))
        self.assertEqual(back[:6].tolist(), [940.0, 940.0, 940.5, 1000.0, 1013.0, 1067.0])
        x = np.arange(940, 1067, 0.37)
        self.assertLessEqual(np.abs(P.decode(P.encode(x)) - x).max(), 0.25)

    def test_rows_and_times(self):
        """row = (t - Jan 1 00Z) / 6 h, four rows a day, a leap year has 1464"""
        self.assertEqual(P.row_of(T('2016-01-01T00:00')), (2016, 0))
        self.assertEqual(P.row_of(T('2016-01-23T18:00')), (2016, 22 * 4 + 3))
        self.assertEqual(P.row_of(T('2016-12-31T18:00')), (2016, 1463))
        self.assertEqual(P.steps_in_year(2016), 1464); self.assertEqual(P.steps_in_year(2017), 1460)
        self.assertEqual(P.time_of(2026, P.row_of(T('2026-10-05T12:00'))[1]), T('2026-10-05T12:00'))
        with self.assertRaises(ValueError): P.row_of(T('2026-10-05T03:00'))
        self.assertEqual(P.rows_through(2026, dt.date(2026, 10, 5)), P.row_of(T('2026-10-05T18:00'))[1] + 1)
        self.assertEqual(P.rows_through(2025, dt.date(2026, 10, 5)), 1460)
        self.assertEqual(P.rows_through(2027, dt.date(2026, 10, 5)), 0)
        self.assertEqual(P.stamp(T('2016-01-01T00:00')), '2016-01-01T00Z')

    def test_grid(self):
        """north to south, each row west to east, every degree"""
        la, lo = P.axes()
        self.assertEqual((la[0], la[-1], lo[0], lo[-1]), (P.NORTH, P.SOUTH, P.WEST, P.EAST))
        self.assertEqual((len(la), len(lo), P.COLS), (P.NLAT, P.NLON, P.NLAT * P.NLON))
        self.assertLessEqual(P.COLS, 6500)

    def test_bilinear_regrid(self):
        """a field linear in lat and lon on a 1.5 deg global grid (0-358.5 E, north first) comes out exact on the 1 deg
        grid, west longitudes wrapping round; NaN cells don't drag their neighbours to 0"""
        lat = np.arange(90, -90.1, -1.5); lon = np.arange(0, 360, 1.5)
        LA, LO = np.meshgrid(lat, lon, indexing='ij')
        lon_w = np.where(LO > 180, LO - 360, LO)                        # -180..180, smooth over the grid's area
        v = 101000 + 30 * LA + 10 * lon_w                                # Pa
        f = dict(v=v, la0=90.0, lo0=0.0, dl=1.5, dj=1.5, ni=len(lon), nj=len(lat))
        got = P.to_grid(f).reshape(P.NLAT, P.NLON)
        la, lo = P.axes()
        want = (101000 + 30 * la[:, None] + 10 * lo[None, :]) / 100
        self.assertLess(np.abs(got - want).max(), 1e-9)
        v2 = v.copy(); v2[np.argmin(np.abs(lat - 40.5)), np.argmin(np.abs(lon - 288))] = np.nan
        g2 = P.bilinear(dict(f, v=v2), [41.0], [-72.0])
        self.assertAlmostEqual(float(g2[0]), 101000 + 30 * 42 - 720, places=6, msg="the NaN corner's weight goes to the cells with data")

    @unittest.skipUnless(numcodecs, 'needs numcodecs')
    def test_era5_reader(self):
        """the zarr store as WeatherBench2 lays it out (time, lon, lat; lat south first; blosc lz4; 4 steps a chunk):
        each step lands on its own row, one download per chunk"""
        codec = dict(id='blosc', cname='lz4', clevel=5, shuffle=1, blocksize=0); b = numcodecs.get_codec(codec)
        lat = np.arange(-90, 90.1, 1.0); lon = np.arange(0, 360, 1.0); nt = 16
        def field(k): return (100000 + 100 * k + 20 * lat[None, :] + 0 * lon[:, None]).astype('<f4')   # [lon, lat]
        files = {
            '.zmetadata': json.dumps(dict(metadata={
                'mean_sea_level_pressure/.zarray': dict(shape=[nt, 360, 181], chunks=[4, 360, 181], dtype='<f4', compressor=codec, fill_value='NaN', filters=None, order='C', zarr_format=2),
                'mean_sea_level_pressure/.zattrs': dict(_ARRAY_DIMENSIONS=['time', 'longitude', 'latitude'], units='Pa'),
                'time/.zarray': dict(shape=[nt], chunks=[nt], dtype='<i8', compressor=codec),
                'time/.zattrs': dict(units='hours since 2016-01-01'),
                'latitude/.zarray': dict(shape=[181], chunks=[181], dtype='<f8', compressor=codec),
                'longitude/.zarray': dict(shape=[360], chunks=[360], dtype='<f8', compressor=codec)})).encode(),
            'time/0': b.encode(np.arange(nt, dtype='<i8') * 6), 'latitude/0': b.encode(lat.astype('<f8')),
            'longitude/0': b.encode(lon.astype('<f8'))}
        for c in range(nt // 4):
            files[f'mean_sea_level_pressure/{c}.0.0'] = b.encode(np.stack([field(4 * c + i) for i in range(4)]))
        asked = []
        def get(u):
            k = u.split('.zarr/', 1)[1]; asked.append(k); return files[k]
        cache = tempfile.mkdtemp()
        e = P.ERA5(cache, get=get, stores=(('test.zarr', 'ERA5 test'),))
        self.assertEqual((e.t0, e.end), (T('2016-01-01T00:00'), T('2016-01-04T18:00')))
        times = [T('2016-01-01T06:00'), T('2016-01-02T00:00'), T('2016-01-02T18:00'), T('2016-01-05T00:00')]
        rows = e.rows(times)
        la, _ = P.axes()
        for k, t in ((1, times[0]), (4, times[1]), (7, times[2])):
            got = rows[t].reshape(P.NLAT, P.NLON)
            self.assertLess(np.abs(got - (1000 + k + 0.2 * la[:, None])).max(), 1e-3, P.stamp(t))
        self.assertIsNone(rows[times[3]], 'past the store: none')
        self.assertEqual(sorted(k for k in asked if k.startswith('mean')), ['mean_sea_level_pressure/0.0.0', 'mean_sea_level_pressure/1.0.0'])
        asked.clear(); P.ERA5(cache, get=get, stores=(('test.zarr', 'ERA5 test'),))
        self.assertEqual(asked, [], "the store's description comes from the cache the second time")


@unittest.skipUnless(HAVE, 'needs numpy and Pillow')
class TestUpdate(unittest.TestCase):
    def setUp(self):
        self._urlopen = urllib.request.urlopen; urllib.request.urlopen = no_network
        self.root = tempfile.mkdtemp(); self.logs = []

    def tearDown(self):
        urllib.request.urlopen = self._urlopen

    def run_update(self, end, era5=None, gfs=None, first=2016, **kw):
        era5 = era5 or Fake('ERA5 fake'); gfs = gfs or Fake('GFS fake', base=1010.0)
        years = P.update(end, root=self.root, cache=self.root, era5=era5, gfs=gfs, first=first, log=self.logs.append, **kw)
        return years, era5, gfs

    def png(self, y): return P.read_png(os.path.join(self.root, P.DIR, f'{y}.png'))
    def meta(self): return json.loads(rd(self.root, P.DIR, 'meta.json'))

    def test_fills_missing_steps_and_retries_failures(self):
        """the first run writes every step through 18Z of the last day; a step whose source failed stays 255 and is
        the only one asked for again; meta.json says what each year holds"""
        bad = T('2016-01-02T06:00')
        years, era5, _ = self.run_update(dt.date(2016, 1, 3), era5=Fake('ERA5 fake', fail=[bad]))
        self.assertEqual(len(era5.asked), 12)
        a = self.png(2016)
        self.assertEqual(a.shape, (12, P.COLS))
        self.assertTrue((a[5] == 255).all(), 'the failed step stays missing')
        self.assertEqual(int(a[4][0]), int(P.encode(1000.04)))
        m = self.meta()
        for k, v in dict(lat0=70, lat1=10, lon0=-100, lon1=-5, deg=1, hours=6, base=940.0, scale=0.5, missing=255, cols=P.COLS).items():
            self.assertEqual(m[k], v, k)
        self.assertEqual(m['years']['2016'], dict(rows=12, first='2016-01-01T00Z', last='2016-01-03T18Z', missing=1, source='ERA5 fake'))
        # the next day: yesterday's four steps and the one that failed, nothing else
        years, era5, _ = self.run_update(dt.date(2016, 1, 4))
        self.assertEqual(era5.asked, [bad] + [T('2016-01-04T%02d:00' % h) for h in (0, 6, 12, 18)])
        a2 = self.png(2016)
        self.assertEqual(a2.shape, (16, P.COLS))
        self.assertTrue((a2[:12][np.arange(12) != 5] == a[np.arange(12) != 5]).all(), 'filled steps are kept as they were')
        self.assertFalse((a2 == 255).all(axis=1).any())
        self.assertEqual(self.meta()['years']['2016']['missing'], 0)
        # nothing new: nothing asked for, the picture unchanged
        before = rd(self.root, P.DIR, '2016.png', mode='rb')
        _, era5, _ = self.run_update(dt.date(2016, 1, 4))
        self.assertEqual(era5.asked, [])
        self.assertEqual(rd(self.root, P.DIR, '2016.png', mode='rb'), before)

    def test_never_shrinks_a_year(self):
        """a run that stops earlier than what's written (an older --end, a clock gone wrong) keeps every row"""
        self.run_update(dt.date(2016, 1, 5))
        self.run_update(dt.date(2016, 1, 2))
        self.assertEqual(self.png(2016).shape[0], 20)
        self.assertEqual(self.meta()['years']['2016']['rows'], 20)

    def test_other_grid_is_left_alone(self):
        """a picture of another width (an older grid) isn't overwritten by a different grid's rows"""
        os.makedirs(os.path.join(self.root, P.DIR))
        Image.fromarray(np.zeros((8, 10), np.uint8), 'L').save(os.path.join(self.root, P.DIR, '2016.png'))
        _, era5, _ = self.run_update(dt.date(2016, 1, 3))
        self.assertEqual(era5.asked, [])
        self.assertEqual(self.png(2016).shape, (8, 10))
        self.assertTrue(any('left as it is' in x for x in self.logs))

    def test_era5_then_gfs_oldest_first_within_budget(self):
        """ERA5 through 2022, GFS from 2023-01-01 00Z; with no time left nothing is fetched and the rows stay
        missing for the next run"""
        years, era5, gfs = self.run_update(dt.date(2023, 1, 1), first=2022, budget=-1)
        self.assertEqual((era5.asked, gfs.asked), ([], []))
        self.assertEqual(years[2022]['missing'], 1460)
        self.assertTrue(any('budget' in x for x in self.logs))
        years, era5, gfs = self.run_update(dt.date(2023, 1, 1), first=2022)
        self.assertEqual(len(era5.asked), 1460); self.assertEqual(era5.asked[0], T('2022-01-01T00:00'))
        self.assertEqual(gfs.asked, [T('2023-01-01T%02d:00' % h) for h in (0, 6, 12, 18)])
        self.assertEqual(self.meta()['years']['2022']['source'], 'ERA5 fake')
        self.assertEqual(self.meta()['years']['2023'], dict(rows=4, first='2023-01-01T00Z', last='2023-01-01T18Z', missing=0, source='GFS fake'))
        self.assertEqual(int(self.png(2023)[0][0]), int(P.encode(1010.0)))

    def test_a_source_that_cant_start_leaves_its_steps_missing(self):
        """no numcodecs, no eccodes, a store that won't answer: a warning, the rows stay 255, nothing raises"""
        class Broken:
            def __init__(self): raise RuntimeError('no store')
        orig = P.ERA5; P.ERA5 = lambda cache: Broken()
        try:
            years = P.update(dt.date(2016, 1, 1), root=self.root, cache=self.root, log=self.logs.append, first=2016)
        finally:
            P.ERA5 = orig
        self.assertEqual(years[2016]['missing'], 4)
        self.assertTrue(any('no ERA5' in x for x in self.logs))

    def test_meta_is_one_line_per_year(self):
        self.run_update(dt.date(2016, 1, 1))
        text = rd(self.root, P.DIR, 'meta.json')
        self.assertEqual(json.loads(text)['years']['2016']['rows'], 4)
        self.assertIn('\n  "2016": {"rows": 4,', text)


@unittest.skipUnless(HAVE, 'needs numpy and Pillow')
class TestFixtures(unittest.TestCase):
    """tests/fixtures/soundcheck/pressure-*: what the page's tests read, in the bot's format"""
    def test_fixture_matches_the_format(self):
        d = os.path.join(ROOT, 'tests', 'fixtures', 'soundcheck')
        m = json.loads(rd(d, 'pressure-meta.json'))
        self.assertEqual(m['cols'], m['nlat'] * m['nlon'])
        y = m['years']['2026']
        a = P.read_png(os.path.join(d, 'pressure-2026.png'))
        self.assertEqual(a.shape, (y['rows'], m['cols']))
        self.assertEqual(y['first'], '2026-01-01T00Z')
        last = P.time_of(2026, y['rows'] - 1)
        self.assertEqual(P.stamp(last), y['last'])
        self.assertGreaterEqual(last, T('2026-10-05T18:00'))
        r0 = P.row_of(T('2026-09-20T00:00'))[1]
        self.assertFalse((a[r0:] == 255).all(axis=1).any(), '20 Sep - 5 Oct all there')
        self.assertEqual(y['missing'], int((a == 255).all(axis=1).sum()))


if __name__ == '__main__':
    unittest.main()
