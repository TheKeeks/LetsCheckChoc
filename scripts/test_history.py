"""Tests for the Sound Check history: the daily update (scripts/history/) that rebuilds it from the buoy's spectra and
readings, and the page's copy of it, research/hist.js, which build_hist.py writes from data/history/.

  python3 -m unittest scripts/test_history.py

The update's own tests build small buoy spectra in CDIP's NetCDF layout and run the real code on them; they need
numpy and scipy, and skip without them. A run of the update over the real inputs reproduces the committed history
byte for byte (scripts/history/README.md says how); that run needs about 1 GB of downloads, so it isn't one of these.
"""
import importlib.util, json, math, os, sys, tempfile, unittest, datetime as dt

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PAGE = os.path.join(ROOT, 'scripts', 'sound-check', 'page')
HISTORY = os.path.join(ROOT, 'scripts', 'history')
UTC = dt.timezone.utc
try:
    import numpy as np
    from scipy.io import netcdf_file
    HAVE = True
except ImportError:
    HAVE = False
if HAVE and HISTORY not in sys.path: sys.path.insert(0, HISTORY)
FT = 3.28084


def jload(*p):
    with open(os.path.join(*p)) as f: return json.load(f)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


class TestHistPage(unittest.TestCase):
    def test_hist_js_is_current(self):
        """research/hist.js is what build_hist.py makes of data/history/ (a data update that forgot to rebuild it, or a
        hand edit, fails here)"""
        bh = load(os.path.join(PAGE, 'build_hist.py'), 'build_hist')
        with open(os.path.join(ROOT, 'research', 'hist.js')) as f:
            self.assertEqual(f.read(), bh.build(), 'research/hist.js is stale: run scripts/sound-check/page/build_hist.py')

    def test_page_loads_history_before_its_code(self):
        """the page's code reads DATA, DAYS2, TRAINS ... as globals: hist.js must load first, and the page must not carry
        its own copy (a rebuild from an old checkout would otherwise roll the history back)"""
        with open(os.path.join(ROOT, 'research', 'index.html')) as f:
            html = f.read()
        i = html.find('<script src="hist.js"></script>')
        self.assertGreater(i, 0, 'the page loads hist.js')
        self.assertNotIn('const DATA=', html)
        self.assertNotIn('const DAYS2=', html)
        code = html.find('const TILEMAN=')
        self.assertGreater(code, i, 'hist.js loads before the page code')
        with open(os.path.join(ROOT, 'research', 'hist.js')) as f:
            js = f.read()
        for name in ('DATA', 'WILDSTATS', 'DAYS2', 'TRAINS', 'BENT', 'WIND', 'SESSPAIRS'):
            self.assertRegex(js, r'(^|\n)const ' + name + '=', name)

    def test_history_files_agree_on_their_last_day(self):
        """the daily rows, the per-day trains and the bent-in shares end on the same day (a partial update that
        stopped half way would leave them out of step)"""
        h = os.path.join(ROOT, 'data', 'history')
        r = jload(os.path.join(h, 'results4.json'))
        last = r['daily'][-1][0]                      # 'yymmdd'
        last = '20%s-%s-%s' % (last[:2], last[2:4], last[4:6])
        for name in ('trains_days.json', 'bend_days.json', 'days2.json'):
            days = sorted(jload(os.path.join(h, name)).keys())
            self.assertEqual(days[-1], last, name)


# ── synthetic buoy spectra in CDIP's layout ──
FREQ = [round(0.025 + 0.005 * i, 3) for i in range(100)]          # CDIP's realtime bands: 0.025-0.52 Hz by 0.005


def hump(fp, hs_m, frm, width=0.006, r1=0.95):
    """one swell: a Gaussian hump in E(f) at fp Hz with significant height hs_m, from direction frm (deg)"""
    f = np.array(FREQ); e = np.exp(-0.5 * ((f - fp) / width) ** 2)
    e *= (hs_m / 4) ** 2 / (e * 0.005).sum()
    th = math.radians(frm)
    return e, r1 * math.cos(th) * (e > 0), r1 * math.sin(th) * (e > 0)


def spectrum(*humps):
    """humps added up: E, a1, b1 (a1, b1 energy-weighted, so each band keeps its own swell's direction)"""
    E = sum(h[0] for h in humps) + 1e-7
    a1 = sum(h[0] * h[1] for h in humps) / E; b1 = sum(h[0] * h[2] for h in humps) / E
    return E, a1, b1


def write_cdip(path, records):
    """records: [(UTC datetime, flag, (E, a1, b1))] → a NetCDF file with CDIP's variables"""
    f = netcdf_file(path, 'w')
    f.createDimension('waveTime', len(records)); f.createDimension('waveFrequency', len(FREQ))
    v = f.createVariable('waveTime', 'i', ('waveTime',)); v[:] = [int(r[0].timestamp()) for r in records]
    v = f.createVariable('waveFrequency', 'f', ('waveFrequency',)); v[:] = FREQ
    v = f.createVariable('waveBandwidth', 'f', ('waveFrequency',)); v[:] = [0.005] * len(FREQ)
    v = f.createVariable('waveFlagPrimary', 'b', ('waveTime',)); v[:] = [r[1] for r in records]
    for name, k in (('waveEnergyDensity', 0), ('waveA1Value', 1), ('waveB1Value', 2)):
        v = f.createVariable(name, 'f', ('waveTime', 'waveFrequency')); v[:] = np.array([r[2][k] for r in records])
    f.close()


def dump(obj, path):
    with open(path, 'w') as f: json.dump(obj, f)


def hours(start, n, step=1):
    return [start + dt.timedelta(hours=step * i) for i in range(n)]


@unittest.skipUnless(HAVE, 'needs numpy and scipy')
class TestSpectra(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sp = load(os.path.join(HISTORY, 'spectra.py'), 'spectra')
        cls.table = cls.sp.Table(os.path.join(HISTORY, 'tables', 'fwd_table.json'))
        cls.tmp = tempfile.mkdtemp()

    def read(self, recs, name='a.nc'):
        p = os.path.join(self.tmp, name); write_cdip(p, recs)
        return self.sp.read(p, self.table, 0)

    def test_heights_follow_the_ray_table(self):
        """the buoy's height is the whole spectrum's; Choc's is the buoy's scaled by the forward-ray table at the
        swell's period and direction (spread over nearby directions); swell from the land side never gets there"""
        t0 = dt.datetime(2026, 10, 1, 12, tzinfo=UTC)
        r = self.read([(t0, 1, spectrum(hump(0.1, 1.5, 140))), (t0 + dt.timedelta(hours=1), 1, spectrum(hump(0.1, 1.5, 300)))])
        a, b = r['heights']['choc']['2026-10-01T12'], r['heights']['choc']['2026-10-01T13']
        self.assertAlmostEqual(a[0], 1.5 * FT, delta=0.02)
        k2 = self.table.tab['10']['140'][2]                  # Choc's share of the buoy's energy, 10 s from 140°
        self.assertAlmostEqual(a[1] / a[0], math.sqrt(k2), delta=0.15 * math.sqrt(k2))
        self.assertGreater(a[1], 0.3 * a[0])
        self.assertLess(b[1], 0.05 * b[0], 'from the north-west: no straight or bent path to the reef')
        self.assertTrue(0 <= a[2] <= 1, 'the peel share is a share')

    def test_only_the_first_good_record_of_each_hour(self):
        """CDIP records every half hour: the hour's first record counts, and only with a good flag"""
        t0 = dt.datetime(2026, 10, 1, 0, tzinfo=UTC); s = spectrum(hump(0.1, 1, 150))
        r = self.read([(t0, 1, s), (t0 + dt.timedelta(minutes=30), 1, s), (t0 + dt.timedelta(hours=1), 4, s), (t0 + dt.timedelta(hours=2), 1, s)])
        self.assertEqual(sorted(r['heights']['choc']), ['2026-10-01T00', '2026-10-01T02'])
        self.assertEqual(len(r['trains']), 2)

    def test_trains_split_two_swells(self):
        """a 12 s groundswell from 150° under a 5 s wind sea from 40°: two trains, biggest at the buoy first, each with
        its own height, period and direction, and the wind sea from the north-east barely reaching Choc"""
        t0 = dt.datetime(2026, 10, 1, 0, tzinfo=UTC)
        r = self.read([(t0, 1, spectrum(hump(1 / 12, 1.2, 150), hump(0.2, 1.6, 40, width=0.02)))])
        trs = r['trains'][0][1]
        self.assertEqual(len(trs), 2, trs)
        (h1, tp1, d1, c1, w1), (h2, tp2, d2, c2, w2) = trs
        self.assertAlmostEqual(h1, 1.6 * FT, delta=0.15); self.assertAlmostEqual(h2, 1.2 * FT, delta=0.15)
        self.assertAlmostEqual(tp1, 5, delta=0.3); self.assertAlmostEqual(tp2, 12, delta=0.4)
        self.assertLess(abs(d1 - 40), 3); self.assertLess(abs(d2 - 150), 3)
        self.assertGreater(c2, 3 * c1, 'Choc gets the groundswell')

    def test_bent_share_is_what_comes_from_outside_the_window(self):
        t0 = dt.datetime(2026, 10, 1, 0, tzinfo=UTC)
        r = self.read([(t0, 1, spectrum(hump(0.1, 1.5, 137))), (t0 + dt.timedelta(hours=1), 1, spectrum(hump(1 / 13, 1.5, 190)))])
        (_, _, inside), (_, _, south) = r['bent']
        self.assertLess(inside, 0.2, 'swell from the middle of the window comes straight in')
        self.assertGreater(south, 0.8, 'swell from 190° bends in around Montauk')

    def test_recent_file_continues_after_the_archive(self):
        """the archive wins where both have an hour; the recent file adds the hours after the archive's last"""
        s1, s2 = spectrum(hump(0.1, 1, 150)), spectrum(hump(0.1, 2, 150))
        a, b = os.path.join(self.tmp, 'h.nc'), os.path.join(self.tmp, 'r.nc')
        write_cdip(a, [(t, 1, s1) for t in hours(dt.datetime(2026, 10, 1, 0, tzinfo=UTC), 3)])
        write_cdip(b, [(t, 1, s2) for t in hours(dt.datetime(2026, 10, 1, 1, tzinfo=UTC), 4)])
        r = self.sp.read_all(a, b, self.table, 0)
        H = r['heights']['choc']
        self.assertEqual(sorted(H), ['2026-10-01T0%d' % i for i in range(5)])
        self.assertAlmostEqual(H['2026-10-01T02'][0], 1 * FT, delta=0.02, msg='the archive\'s hour')
        self.assertAlmostEqual(H['2026-10-01T03'][0], 2 * FT, delta=0.02, msg='the recent file\'s hour')
        self.assertEqual(len(r['trains']), 5)

    def test_local_day_is_eastern_time(self):
        """trains and bent-in days use a hand-written US daylight-saving rule: it matches America/New_York every hour"""
        from zoneinfo import ZoneInfo
        ET = ZoneInfo('America/New_York')
        t = int(dt.datetime(2016, 1, 1, tzinfo=UTC).timestamp())
        while t < dt.datetime(2028, 1, 1, tzinfo=UTC).timestamp():
            e = dt.datetime.fromtimestamp(t, UTC).astimezone(ET)
            self.assertEqual(self.sp.local_day(t), (e.strftime('%Y-%m-%d'), e.hour), e)
            t += 3600

    def test_per_day_tables_keep_each_spots_biggest_hour(self):
        """trains_days: the trains at Choc's biggest hour and at Wilderness's (Eastern days, 4 trains at most);
        bend_days: the bent-in share at Choc's biggest hour"""
        T = lambda h: int(dt.datetime(2026, 10, 1, h, tzinfo=UTC).timestamp())     # 2026-10-01 h:00 UTC
        small, big = [(2.0, 8.0, 150.0, 1.0, 0.5)], [(4.0, 12.04, 160.4, 3.0, 1.0), (1.0, 5, 40, 0.2, 0.9), (0.5, 4, 30, 0.1, 0.1), (0.4, 3, 20, 0.1, 0.1), (0.3, 3, 10, 0.1, 0.1)]
        wild = [(3.0, 9.0, 100.0, 0.5, 2.0)]
        d = self.sp.trains_days([(T(12), small), (T(14), big), (T(16), wild)])
        self.assertEqual(list(d), ['2026-10-01'])
        ch, ctr, wh, wtr = d['2026-10-01']
        self.assertEqual((ch, wh), (10, 12), 'Eastern hours: 14 UTC is 10 AM EDT')
        self.assertEqual(len(ctr), 4)
        self.assertEqual(ctr[0], [4.0, 12.0, 160, 3.0, 1.0])
        self.assertEqual(wtr, [[3.0, 9.0, 100, 0.5, 2.0]])
        b = self.sp.bend_days([(T(3), 1.0, 0.9), (T(14), 3.0, 0.42), (T(15), 2.0, None)])
        self.assertEqual(b, {'2026-09-30': 90, '2026-10-01': 42})
        self.assertEqual(self.sp.bend_days([(T(14), 3.0, None)]), {'2026-10-01': None})
        lane = self.sp.day_lane([(T(14), big)])
        self.assertEqual(lane, {2026: {'2026-10-01T14': [[4.0, 12.0, 160, 3.0], [1.0, 5, 40, 0.2], [0.5, 4, 30, 0.1], [0.4, 3, 20, 0.1]]}})


STD_HEAD = '#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n'


def std(rows):
    """an NDBC stdmet file: rows of (UTC datetime, WVHT m, DPD s, MWD deg), 'MM' where missing"""
    return STD_HEAD + ''.join(f'{t:%Y %m %d %H %M}  MM   MM   MM  {h}  {p}   5.0 {d}     MM    MM  18.0    MM   MM   MM    MM\n' for t, h, p, d in rows)


@unittest.skipUnless(HAVE, 'needs numpy and scipy')
class TestReadings(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.an = load(os.path.join(HISTORY, 'analyze.py'), 'analyze')
        cls.src = load(os.path.join(HISTORY, 'sources.py'), 'sources')

    def test_first_reading_of_an_hour_wins_and_montauk_fills_gaps(self):
        t = dt.datetime(2026, 10, 1, 12, tzinfo=UTC)
        year = std([(t, 1.0, 8.0, 150), (t + dt.timedelta(hours=1), 'MM', 8.0, 150), (t + dt.timedelta(hours=2), 99.0, 8.0, 150)])
        recent = std([(t + dt.timedelta(minutes=30), 2.0, 9.0, 160), (t + dt.timedelta(hours=3), 1.5, 7.0, 140)])
        mtk = std([(t, 3.0, 10.0, 170), (t + dt.timedelta(hours=1), 2.0, 10.0, 170)])
        buoy, filled = self.an.buoy_hours([year, recent], [mtk])
        et = lambda h: (t + dt.timedelta(hours=h)).astimezone(self.an.ET)
        self.assertEqual(buoy[et(0)], (1.0 * FT, 8.0, 150.0), 'the year file read first wins its hour')
        self.assertEqual(buoy[et(3)], (1.5 * FT, 7.0, 140.0))
        self.assertAlmostEqual(buoy[et(1)][0], 2.0 * FT * 1.05, msg='a missing hour comes from Montauk, scaled')
        self.assertNotIn(et(2), buoy, '99 is NDBC\'s missing value')
        self.assertEqual(filled, 1)

    def test_soft_window(self):
        for d, w in ((137, 1), (115, 1), (158, 1), (107.5, 0.5), (166.5, 0.5), (100, 0), (175, 0), (200, 0), (60, 0)):
            self.assertAlmostEqual(self.an.w_soft(d), w, msg=d)

    def test_ndbc_files(self):
        """what counts as an NDBC file (it answers a missing one with a short page, status 200), its names for
        October-December, and the order the readings are read in"""
        self.assertTrue(self.src.is_stdmet(std([(dt.datetime(2026, 9, 1, tzinfo=UTC), 1.0, 8.0, 150)]).encode()))
        self.assertFalse(self.src.is_stdmet(b'Unable to access data file'))
        self.assertEqual([self.src.month_code(m) for m in (1, 9, 10, 11, 12)], ['1', '9', 'a', 'b', 'c'])
        with tempfile.TemporaryDirectory() as c:
            os.makedirs(os.path.join(c, 'ndbc'))
            for n in ('44097_realtime.txt', '44097_2026_09p.txt', '44097_2026_08p.txt', '44097_2026_08.txt', '44097_2026_01.txt', '44097h2025.txt', '44097h2016.txt'):
                open(os.path.join(c, 'ndbc', n), 'w').close()
            got = [os.path.basename(p) for p in self.src.stdmet_files(c)]
        self.assertEqual(got, ['44097h2016.txt', '44097h2025.txt', '44097_2026_01.txt', '44097_2026_08.txt', '44097_2026_09p.txt', '44097_realtime.txt'],
                         'finished years, then months (a published month over its provisional file), then the last 45 days')


@unittest.skipUnless(HAVE, 'needs numpy and scipy')
class TestUpdate(unittest.TestCase):
    """the whole update over a made-up cache: three days of spectra and readings, the tides, the wind"""

    @classmethod
    def setUpClass(cls):
        cls.up = load(os.path.join(HISTORY, 'update.py'), 'update')
        cls.dir = tempfile.mkdtemp(); c = cls.cache = os.path.join(cls.dir, 'cache')
        for d in ('cdip', 'ndbc', 'ndbc17', 'tides', 'wind'): os.makedirs(os.path.join(c, d))
        t0 = dt.datetime(2026, 10, 10, 4, tzinfo=UTC)                                   # midnight, 10 Oct, EDT
        s = lambda i: spectrum(hump(1 / 11, 1.0 + 0.04 * i, 150), hump(0.2, 0.5, 60, width=0.02))
        # spectra: the archive to the 11th, the recent file to 4 AM on the 12th (5 hours: too few for a calendar day)
        write_cdip(os.path.join(c, 'cdip', '154p1_historic.nc'), [(t, 1, s(i)) for i, t in enumerate(hours(t0, 33))])
        write_cdip(os.path.join(c, 'cdip', '154p1_rt.nc'), [(t, 1, s(i)) for i, t in enumerate(hours(t0 + dt.timedelta(hours=33), 20))])
        # readings: every hour through the end of the 12th
        with open(os.path.join(c, 'ndbc', '44097_realtime.txt'), 'w') as f:
            f.write(std([(t, round(1.2 + 0.04 * i, 2), 11.0, 150) for i, t in reversed(list(enumerate(hours(t0, 72))))]))
        turns, t, hi = [], dt.datetime(2026, 10, 9, 3, 10), True
        while t < dt.datetime(2026, 10, 15):
            turns.append(dict(t=t.strftime('%Y-%m-%d %H:%M'), v='2.900' if hi else '0.200', type='H' if hi else 'L'))
            t += dt.timedelta(hours=6, minutes=12); hi = not hi
        dump(dict(predictions=turns), os.path.join(c, 'tides', 'hilo_2026.json'))
        et = [dt.datetime(2026, 10, 10) + dt.timedelta(hours=h) for h in range(72)]
        dump(dict(hourly=dict(time=[x.strftime('%Y-%m-%dT%H:%M') for x in et], wind_speed_10m=[8.0] * 60 + [None] * 12,
                              wind_direction_10m=[330] * 60 + [None] * 12)), os.path.join(c, 'wind', 'sea.json'))
        pt = lambda la, lo, days: dict(latitude=la, longitude=lo, elevation=0.0, daily=dict(
            time=days, wind_speed_10m_mean=[10.0] * len(days), wind_direction_10m_dominant=[45] * len(days)))
        oct_days = ['2026-10-10', '2026-10-11', '2026-10-12']
        dump([pt(40.75, -72 + i / 10, oct_days) for i in range(10)], os.path.join(c, 'wind', 'ifs1.json'))
        dump([pt(41.2, -72 + i / 10, oct_days) for i in range(10)], os.path.join(c, 'wind', 'ifs2.json'))
        dump([pt(41, -72, ['2016-01-01'])] * 20, os.path.join(c, 'wind', 'era16.json'))

    def run_update(self, *extra):
        out = tempfile.mkdtemp(dir=self.dir)
        end = self.up.main(['--offline', '--cache', self.cache, '--end', '2026-10-12', '--out', out, *extra])
        return end, out

    def test_never_shortens_the_history(self):
        """three days must not replace ten years: a cut-short download or a failed source stops the update"""
        with self.assertRaises(SystemExit) as e:
            self.run_update()
        self.assertIn('refusing to shorten the history', str(e.exception))

    def test_every_file_ends_on_one_day(self):
        """the recent spectra stop at 4 AM on the 12th: too few hours for that day's calendar entry, so every file
        stops on the 11th, and nothing from the 12th is counted anywhere"""
        end, out = self.run_update('--force')
        self.assertEqual(end, dt.date(2026, 10, 11))
        H = lambda n: jload(os.path.join(out, 'data', 'history', n))
        r4 = H('results4.json')
        self.assertEqual([d[0] for d in r4['daily']], ['261010', '261011'])
        for n in ('days2.json', 'trains_days.json', 'bend_days.json'):
            self.assertEqual(sorted(H(n)), ['2026-10-10', '2026-10-11'], n)
        self.assertEqual(r4['ym']['all']['2026-10'][2], 48, 'the hours of the 10th and 11th, no more')
        self.assertEqual(r4['model'], jload(os.path.join(ROOT, 'data', 'history', 'results4.json'))['model'], 'the ratings model as fitted')
        w = H('windgrid_out.json')
        self.assertEqual(len(w['base']), (dt.date(2026, 10, 11) - dt.date(2016, 1, 1)).days + 1)
        self.assertEqual(w['pts'][0]['uv'][-1], [int(round(2 * 10 * math.sin(math.radians(45)))), int(round(2 * 10 * math.cos(math.radians(45))))])
        self.assertEqual(H('sess_pairs.json'), jload(os.path.join(ROOT, 'data', 'history', 'sess_pairs.json')), 'surf-log tables carried over')
        with open(os.path.join(out, 'research', 'hist.js')) as f: js = f.read()
        self.assertEqual(js, load(os.path.join(PAGE, 'build_hist.py'), 'build_hist').build(os.path.join(out, 'data', 'history')))
        day = jload(os.path.join(out, 'research', 'ocean', 'day', '2026.json'))
        committed = jload(os.path.join(ROOT, 'research', 'ocean', 'day', '2026.json'))
        self.assertEqual(list(day), list(committed), 'the lanes keep their order')
        self.assertEqual(day['wm'], committed['wm'], 'the model lane is left as it is')
        self.assertEqual(min(day['44097']), '2026-10-10T04')
        self.assertEqual(max(day['44097']), '2026-10-12T03', 'the last hour of the 11th, Eastern')


if __name__ == '__main__':
    unittest.main()
