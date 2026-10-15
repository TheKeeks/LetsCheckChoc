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

    def test_floats_add_up_as_the_history_was_built(self):
        """Python 3.12's sum() compensates for rounding; the history was built with plain left-to-right addition, so the
        scripts add that way on any Python (the daily wind and the best 3 hours otherwise shift by a tenth on ~60 days)"""
        import functools, operator
        xs = [0.1] * 10
        self.assertEqual(self.an.total(xs), 0.9999999999999999)
        self.assertEqual(self.an.total(xs), functools.reduce(operator.add, xs, 0))
        speeds = [7.25, 7.15, 7.15, 7.05, 7.15, 7.25]          # a day whose mean sits on a rounding edge
        self.assertEqual(self.an.total(speeds), functools.reduce(operator.add, speeds, 0))
        self.assertEqual(self.an.total([]), 0)
        for name in ('derive.py', 'spectra.py'):
            m = load(os.path.join(HISTORY, name), name[:-3])
            self.assertEqual(m.total(xs), 0.9999999999999999, name)

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


class TestSurfLog(unittest.TestCase):
    """the crew's log as the history update reads it (surflog.py): Firestore's documents or the app's exports →
    the sessions the ratings model is fitted to"""

    @classmethod
    def setUpClass(cls):
        cls.sl = load(os.path.join(HISTORY, 'surflog.py'), 'surflog')

    def entry(self, ts, s, w, r, **extra):
        e = dict(id=extra.pop('id', ts), timestamp=ts, ratings=dict(size=s, windQuality=w, rideQuality=r), notes='Glassy, crowd by 8',
                 photos=[{'url': 'https://example.test/p.jpg'}], userId='u1', displayName='Test Surfer')
        e.update(extra)
        return e

    def test_firestore_values(self):
        """Firestore's REST values, nested, to plain values; what the log doesn't use comes out None"""
        doc = {'name': 'projects/p/databases/(default)/documents/surf_logs/abc123', 'fields': {
            'timestamp': {'stringValue': '2026-10-12T07:30'},
            'ratings': {'mapValue': {'fields': {'size': {'integerValue': '7'}, 'windQuality': {'doubleValue': 8.5}, 'rideQuality': {'integerValue': '6'}}}},
            'conditions': {'mapValue': {'fields': {'swell': {'mapValue': {'fields': {'height': {'doubleValue': 2.6}}}},
                                                   'tide': {'mapValue': {'fields': {'height': {'nullValue': None}, 'rate': {'doubleValue': -0.4}}}}}}},
            'photos': {'arrayValue': {'values': [{'mapValue': {'fields': {'url': {'stringValue': 'https://x'}}}}]}},
            'createdAt': {'timestampValue': '2026-10-12T15:00:00Z'}, 'ref': {'referenceValue': 'x'}}}
        e = self.sl.document(doc)
        self.assertEqual(e['id'], 'abc123', 'the document id when the entry carries none')
        self.assertEqual(e['ratings'], {'size': 7, 'windQuality': 8.5, 'rideQuality': 6})
        self.assertEqual(e['conditions']['tide'], {'height': None, 'rate': -0.4})
        self.assertEqual(e['photos'], [{'url': 'https://x'}])
        self.assertIsNone(e['ref'])

    def test_sessions_keep_what_the_model_needs_and_nothing_personal(self):
        got = self.sl.sessions([
            self.entry('2026-10-12T07:30', 7, 8, 6, conditions={'swell': {'height': 2.6}, 'tide': {'height': 0.8, 'rate': 0.5}}),
            self.entry('2025-06-01T18:05', 1, 2, 2, id='b'),                              # no conditions saved
            self.entry('2025-06-01T18:05', 3, 3, 3, id='a'),
            self.entry('2024-08-01T10:00', 2.5, 2, 2.25, conditions={'swell': {'height': 0}, 'tide': {'height': 0, 'rate': None}}),
            self.entry('not a time', 5, 5, 5), self.entry('2026-01-01T09:00', 5, None, 5), self.entry('2026-01-02T09:00', 11, 5, 5),
            'junk'])
        self.assertEqual([(x['date'], x['id']) for x in got], [('2024-08-01T10:00', '2024-08-01T10:00'), ('2025-06-01T18:05', 'a'),
                                                                ('2025-06-01T18:05', 'b'), ('2026-10-12T07:30', '2026-10-12T07:30')],
                         'oldest first (same minute: by id); no time, a missing rating or one over 10: left out')
        self.assertEqual(got[3], dict(id='2026-10-12T07:30', date='2026-10-12T07:30', size=7, windQuality=8, rideQuality=6, avg=7.0,
                                      swellH=2.6, tideH=0.8, tideRate=0.5))
        self.assertEqual(got[2]['avg'], 1.7, 'the average rounded as the app writes it')
        self.assertEqual(got[0]['avg'], 2.3, '6.75 / 3 = 2.25 rounds up, as JavaScript\'s toFixed(1) does (Python\'s round gives 2.2)')
        self.assertEqual((got[0]['swellH'], got[0]['tideH'], got[0]['tideRate']), (0, 0, None), 'a 0 stays 0, a missing value stays None')
        self.assertEqual((got[1]['swellH'], got[1]['tideH']), (None, None), 'no conditions: None, never 0')
        for x in got:
            self.assertEqual(set(x), {'id', 'date', 'size', 'windQuality', 'rideQuality', 'avg', 'swellH', 'tideH', 'tideRate'}, 'no notes, photos or names')

    def test_csv_export(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'surflog-export.csv')
            with open(p, 'w') as f:
                f.write('id,date,size,windQuality,rideQuality,avg,notes,swellH,swellDir,swellPer,windSpd,windDir,tideH,tideRate,tideStage\n'
                        'b,2023-08-29T17:52,6,6,7,6.3,"chest high, ""rippable""",2.8,165,11,5,40,1.9,0.74,rising\n'
                        'a,2023-08-29T17:50,6,5,6,5.7,,2.8,165,11,5,40,,0.75,rising\n')
            got, src = self.sl.load(p)
        self.assertEqual(src, 'the export surflog-export.csv')
        self.assertEqual([(x['id'], x['avg'], x['swellH'], x['tideH'], x['tideRate']) for x in got], [('a', 5.7, 2.8, None, 0.75), ('b', 6.3, 2.8, 1.9, 0.74)])

    def test_firestore_pages_and_the_key(self):
        pages = {None: {'documents': [{'name': '.../surf_logs/one', 'fields': {'timestamp': {'stringValue': '2026-10-12T07:30'},
                 'ratings': {'mapValue': {'fields': {k: {'integerValue': '5'} for k in ('size', 'windQuality', 'rideQuality')}}}}}],
                        'nextPageToken': 'p/2=='},
                 'p/2==': {'documents': [{'name': '.../surf_logs/two', 'fields': {'timestamp': {'stringValue': '2021-09-10T11:00'},
                           'ratings': {'mapValue': {'fields': {k: {'integerValue': '9'} for k in ('size', 'windQuality', 'rideQuality')}}}}}]}}
        asked = []
        def get(url, tok):
            asked.append((url, tok)); tokn = url.split('pageToken=')[1] if 'pageToken=' in url else None
            import urllib.parse
            return pages[urllib.parse.unquote(tokn) if tokn else None]
        key = {'type': 'service_account', 'project_id': 'letscheckchoc', 'client_email': 'history-bot@letscheckchoc.iam.gserviceaccount.com'}
        got = self.sl.fetch(key, get=get, tok='test-token')
        self.assertEqual([e['id'] for e in got], ['one', 'two'])
        self.assertTrue(asked[0][0].startswith('https://firestore.googleapis.com/v1/projects/letscheckchoc/databases/(default)/documents/surf_logs?pageSize=300'))
        self.assertTrue(asked[1][0].endswith('&pageToken=p%2F2%3D%3D'), 'the page token, escaped')
        self.assertEqual({t for _, t in asked}, {'test-token'})
        self.assertEqual(self.sl.load(env={}), (None, 'no SURFLOG_READ_KEY: the surf log is not read'))
        self.assertIn('not a service account key', self.sl.load(env={'SURFLOG_READ_KEY': 'abc'})[1])
        self.assertIn('not a service account key', self.sl.load(env={'SURFLOG_READ_KEY': '{"project_id": "x"}'})[1])


@unittest.skipUnless(HAVE, 'needs numpy and scipy')
class TestRatings(unittest.TestCase):
    """the surf log's part of the history (ratings.py) on made-up sessions"""

    @classmethod
    def setUpClass(cls):
        cls.ra = load(os.path.join(HISTORY, 'ratings.py'), 'ratings')

    def sess(self, n, start=dt.datetime(2026, 6, 1, 8)):
        return [dict(id=str(i), date=(start + dt.timedelta(days=i, hours=i % 5)).strftime('%Y-%m-%dT%H:%M'), size=float(i % 9 + 1),
                     windQuality=float((i * 3) % 10), rideQuality=float((i * 7) % 10), avg=round(((i % 9 + 1) + (i * 3) % 10 + (i * 7) % 10) / 3, 1),
                     swellH=1.0 + i % 4, tideH=0.5, tideRate=0.1) for i in range(n)]

    def test_model_needs_enough_sessions_with_conditions(self):
        scat = lambda t: [math.log1p(t.day % 7 + 1), 8 + t.day % 3, 2.0 * math.sin(t.day), 6.0, 0.3 * math.cos(t.day), 1.2]
        feats = lambda t: (lambda f: [f[0], f[2], f[4]])(scat(t))
        m = self.ra.fit_model(self.sess(14), feats, scat)
        self.assertEqual(list(m), ['feats', 'scat', 'labels', 'targets', 'sessions'])
        self.assertEqual(list(m['targets']), ['avg', 'size', 'ride', 'wind_q'])
        self.assertEqual(len(m['sessions']), 14)
        self.assertEqual(set(m['sessions'][0]), {'date', 'x', 'size', 'ride', 'wind_q', 'avg'}, 'no notes')
        self.assertEqual(m['sessions'][0]['date'], '2026-06-01 08:00')
        self.assertEqual(len(m['targets']['avg']['preq']), 14 - 6, 'each session after the first 6 predicted from the ones before')
        self.assertIsNone(self.ra.fit_model(self.sess(9), feats, scat), 'fewer than 10: keep the stored model')
        self.assertIsNone(self.ra.fit_model(self.sess(14), lambda t: None, scat), 'no conditions: nothing to fit')
        again = self.ra.fit_model(self.sess(14), feats, scat)
        self.assertEqual(again, m, 'the same sessions, the same model (the bootstrap draws are seeded)')

    def test_pairs_take_the_best_3_hours_of_the_sessions_day(self):
        day = dt.datetime(2026, 6, 2, tzinfo=self.ra.ET)
        cspec = {(day + dt.timedelta(hours=h)).astimezone(UTC).strftime('%Y-%m-%dT%H'): [1.0 + (h == 10) * 3 + (h == 11) * 2, 0.5 + (h == 11)] for h in range(24)}
        s = self.sess(3)
        got = self.ra.sess_pairs(s, cspec)
        self.assertEqual(got, [['2026-06-02', 2, round((1 + 4 + 3) / 3, 4), round((0.5 + 0.5 + 1.5) / 3, 4)]], 'only the day the history covers')

    def test_measures_rank_the_sessions(self):
        s = self.sess(12)
        B = {}
        for x in s:
            t0 = dt.datetime.fromisoformat(x['date'][:10]).replace(tzinfo=self.ra.ET)
            for h in range(24): B[t0 + dt.timedelta(hours=h)] = (x['size'] * 0.8 + 0.1 * h, 9.0, 140.0)
        got = self.ra.sessions_all(s, B)
        self.assertEqual(got['res']['B day peak height, in window']['n'], 12)
        self.assertEqual(got['res']['B day peak height, in window']['rho'], 1.0, 'the peak follows the rating exactly')
        self.assertLessEqual(got['res']['B day peak height, in window']['lo'], 1.0)
        s[0]['swellH'] = s[1]['swellH'] = None
        self.assertEqual(self.ra.sessions_all(s, B)['res']['L swell height the app logged (forecast pin)']['n'], 10, 'sessions the app saved no swell with: left out')
        self.assertNotIn('notes', got['sessions'][0])
        self.assertNotIn('C day peak power, in window', self.ra.sessions_all(s[:2], B)['res'], 'fewer than 3 sessions: left out')

    def test_scorecard_keeps_old_forecasts_and_asks_for_new_ones(self):
        s = self.sess(5, start=dt.datetime(2025, 7, 1, 8))
        cspec = {self.ra.session_time(x).astimezone(UTC).strftime('%Y-%m-%dT%H'): [3.0, 1.0 + i] for i, x in enumerate(s)}
        prev = {'sessions': [{'date': s[0]['date'], 'd1': 1.1, 'd2': 1.2, 'd3': 1.3}, {'date': s[1]['date'], 'd1': 2.1, 'd2': None, 'd3': 2.3}]}
        asked = []
        def forecast(t, lead):
            asked.append((t.strftime('%Y-%m-%dT%H'), lead))
            if t.day == 4: raise self.ra.NotArchived('x')
            return 1.0 + lead / 10
        got = self.ra.scorecard(s, cspec, prev, forecast, budget=3)
        d = {x['date']: x for x in got['sessions']}
        self.assertEqual([d[s[0]['date']][k] for k in ('d1', 'd2', 'd3')], [1.1, 1.2, 1.3], 'scored before: kept, not asked again')
        self.assertEqual([d[s[1]['date']][k] for k in ('d1', 'd2', 'd3')], [2.1, 1.2, 2.3], 'a lead missing before: asked again')
        self.assertEqual([d[s[2]['date']][k] for k in ('d1', 'd2', 'd3')], [1.1, 1.2, 1.3])
        self.assertEqual([d[s[3]['date']][k] for k in ('d1', 'd2', 'd3')], [None, None, None], 'not in the archive: left empty')
        self.assertEqual([d[s[4]['date']][k] for k in ('d1', 'd2', 'd3')], [None, None, None], 'over the run\'s budget: next run')
        self.assertEqual(len({t for t, _ in asked}), 3, 'three sessions asked for, at most')
        self.assertEqual(d[s[2]['date']]['buoy_model'], 3.0, "Choc's modeled height at the session's hour")
        self.assertEqual(got['summary']['buoy_model']['n'], 5)
        self.assertEqual(got['summary']['d1']['n'], 3)
        self.assertEqual(got['summary']['d1']['median_vs_arrived_ft'], round(float(np.median([1.1 - 1.0, 2.1 - 2.0, 1.1 - 3.0])), 2))
        off = self.ra.scorecard(s, cspec, prev, None)
        self.assertEqual([x['d1'] for x in off['sessions']], [1.1, 2.1, None, None, None], 'offline: only what was scored before')
        self.assertNotIn('d1', self.ra.scorecard(s, cspec, None, None)['summary'], 'a lead with fewer than 3 sessions: no score')


@unittest.skipUnless(HAVE, 'needs numpy and scipy')
class TestLanes(unittest.TestCase):
    """the Past days' hour-by-hour lanes: the wind (UTC hours, like the buoy's) and the tides (Eastern days)"""

    @classmethod
    def setUpClass(cls):
        cls.d = load(os.path.join(HISTORY, 'derive.py'), 'derive_lanes')

    def test_wind_hours_are_utc_and_missing_hours_stay_out(self):
        """Open-Meteo's series with its one UTC offset (EST all year, as asked from Jan 2016): label + 5 h, even in
        July; an hour without a speed or a direction is left out, never 0"""
        times = ['2026-07-01T00:00', '2026-07-01T01:00', '2026-07-01T02:00', '2026-07-01T03:00']
        h = dict(time=times, wind_speed_10m=[8.04, None, 12.0, 0.0], wind_direction_10m=[359.6, 200, None, 90])
        lane = self.d.wind_lane(h, dt.date(2026, 7, 1), offset=-18000)
        self.assertEqual(lane, {2026: {'2026-07-01T05': [8.0, 0], '2026-07-01T08': [0.0, 90]}})

    def test_wind_lane_by_utc_year_and_eastern_days(self):
        """the last hours of an Eastern 31 December are in the next UTC year's file; hours of Eastern days past the
        history's last day are left out"""
        times = ['2025-12-31T%02d:00' % h for h in range(18, 24)] + ['2026-01-01T%02d:00' % h for h in range(24)]
        h = dict(time=times, wind_speed_10m=[5.0] * len(times), wind_direction_10m=[270] * len(times))
        lane = self.d.wind_lane(h, dt.date(2025, 12, 31), offset=-18000)
        self.assertEqual(sorted(lane), [2025, 2026])
        self.assertEqual(max(lane[2025]), '2025-12-31T23')
        self.assertEqual(sorted(lane[2026]), ['2026-01-01T00', '2026-01-01T01', '2026-01-01T02', '2026-01-01T03', '2026-01-01T04'])

    def test_wind_labels_that_follow_daylight_saving(self):
        """a series whose labels repeat 1 AM in November and skip 2 AM in March (or one with no offset recorded) is
        read as Eastern wall-clock time"""
        u = self.d.sea_utc(['2025-11-02T00:00', '2025-11-02T01:00', '2025-11-02T01:00', '2025-11-02T02:00'], -14400)
        self.assertEqual([x.strftime('%dT%H') for x in u], ['02T04', '02T05', '02T06', '02T07'])
        u = self.d.sea_utc(['2026-03-08T01:00', '2026-03-08T03:00', '2026-03-08T04:00'], -18000)
        self.assertEqual([x.strftime('%dT%H') for x in u], ['08T06', '08T07', '08T08'])
        u = self.d.sea_utc(['2026-10-10T00:00', '2026-10-10T01:00'])
        self.assertEqual([x.strftime('%dT%H') for x in u], ['10T04', '10T05'])

    def test_tides_by_eastern_day(self):
        """CO-OPS's local times as they are, heights to the hundredth, H or L; a turn late on an Eastern 31 December
        stays in that year's file; a day without predictions (or a bad value) is left out"""
        docs = [dict(predictions=[
            dict(t='2016-12-31 23:10', v='2.946', type='H'), dict(t='2016-12-31 16:58', v='-0.304', type='L'),
            dict(t='2017-01-01 05:12', v='0.127', type='L'), dict(t='2017-01-03 06:00', v='', type='L'),
            dict(t='2017-01-04 06:00', v='1.0', type='H')])]
        lane = self.d.tide_lane(docs, dt.date(2017, 1, 3))
        self.assertEqual(lane, {2016: {'2016-12-31': [['16:58', -0.3, 'L'], ['23:10', 2.95, 'H']]},
                                2017: {'2017-01-01': [['05:12', 0.13, 'L']]}})


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
        # the log, as the app's Export JSON writes it: 14 sessions on the 10th and 11th, one before the history
        log = [dict(id=f's{i}', timestamp=f'2026-10-{10 + i // 7}T{7 + 2 * (i % 7):02d}:15', notes='private',
                    ratings=dict(size=1 + i % 8, windQuality=(3 * i) % 10, rideQuality=(5 * i) % 10),
                    conditions=dict(swell=dict(height=1.5 + 0.2 * i), tide=dict(height=1.0, rate=0.3))) for i in range(14)]
        log.append(dict(id='old', timestamp='2015-08-01T10:00', ratings=dict(size=5, windQuality=5, rideQuality=5)))
        cls.log = os.path.join(cls.dir, 'surflog-export.json'); dump(log, cls.log)

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
        self.assertFalse(os.path.exists(os.path.join(out, 'research', 'fc', 'score.json')), 'without the log the scorecard is left alone')
        w = H('windgrid_out.json')
        self.assertEqual(len(w['base']), (dt.date(2026, 10, 11) - dt.date(2016, 1, 1)).days + 1)
        self.assertEqual(w['pts'][0]['uv'][-1], [int(round(2 * 10 * math.sin(math.radians(45)))), int(round(2 * 10 * math.cos(math.radians(45))))])
        self.assertEqual(H('sess_pairs.json'), jload(os.path.join(ROOT, 'data', 'history', 'sess_pairs.json')), 'surf-log tables carried over')
        with open(os.path.join(out, 'research', 'hist.js')) as f: js = f.read()
        self.assertEqual(js, load(os.path.join(PAGE, 'build_hist.py'), 'build_hist').build(os.path.join(out, 'data', 'history')))
        day = jload(os.path.join(out, 'research', 'ocean', 'day', '2026.json'))
        committed = jload(os.path.join(ROOT, 'research', 'ocean', 'day', '2026.json'))
        self.assertEqual(list(day)[:len(committed)], list(committed), 'the lanes keep their order')
        self.assertEqual([k for k in day if k not in committed], [k for k in ('wind', 'tide') if k not in committed], 'new lanes go last')
        self.assertEqual(day['wm'], committed['wm'], 'the model lane is left as it is')
        self.assertEqual(min(day['44097']), '2026-10-10T04')
        self.assertEqual(max(day['44097']), '2026-10-12T03', 'the last hour of the 11th, Eastern')
        # the wind every hour (UTC, like the buoy's), from midnight on the 10th to the end of the 11th, Eastern
        self.assertEqual(min(day['wind']), '2026-10-10T04')
        self.assertEqual(max(day['wind']), '2026-10-12T03')
        self.assertEqual(len(day['wind']), 48)
        self.assertEqual(day['wind']['2026-10-11T12'], [8.0, 330])
        # the highs and lows of each Eastern day the tide tables have, through the 11th
        self.assertEqual(sorted(day['tide']), ['2026-10-09', '2026-10-10', '2026-10-11'])
        self.assertEqual(day['tide']['2026-10-09'][0], ['03:10', 2.9, 'H'])
        with open(os.path.join(out, 'research', 'ocean', 'day', '2026.json')) as f: text = f.read()
        self.assertEqual(text, json.dumps(day, separators=(',', ':')), 'compact JSON, as before')
        self.assertFalse(os.path.exists(os.path.join(out, 'research', 'ocean', 'pressure')), 'offline: no pressure maps')

    def test_lanes_keep_the_other_lanes(self):
        """the buoy, wind and tide lanes are replaced; Long Island (44025), Montauk (44017) and the model (wm) stay
        as committed, in their places"""
        root, dest = tempfile.mkdtemp(dir=self.dir), tempfile.mkdtemp(dir=self.dir)
        os.makedirs(os.path.join(root, 'research', 'ocean', 'day'))
        old = {'44025': {'2016-01-01T00': [1]}, '44097': {'2016-01-01T00': [[1.0, 8.0, 150, 0.5]]}, '44017': {'x': 1},
               'tide': {'2016-01-01': [['01:00', 1.0, 'H']]}, 'wm': {'2016-01-01T00': [2]}}
        dump(old, os.path.join(root, 'research', 'ocean', 'day', '2016.json'))
        new = dict(lane={2016: {'2016-01-02T00': [[2.0, 9.0, 160, 0.7]]}}, wind={2016: {'2016-01-02T00': [5.0, 270]}, 2017: {'2017-01-01T00': [6.0, 180]}},
                   tide={2016: {'2016-01-02': [['02:00', 2.0, 'H']]}})
        self.up.write_lanes(new, root, dest)
        doc = jload(os.path.join(dest, 'research', 'ocean', 'day', '2016.json'))
        self.assertEqual(list(doc), ['44025', '44097', '44017', 'tide', 'wm', 'wind'])
        for k in ('44025', '44017', 'wm'): self.assertEqual(doc[k], old[k], k)
        self.assertEqual(doc['44097'], new['lane'][2016]); self.assertEqual(doc['tide'], new['tide'][2016]); self.assertEqual(doc['wind'], new['wind'][2016])
        self.assertEqual(jload(os.path.join(dest, 'research', 'ocean', 'day', '2017.json')), {'wind': new['wind'][2017]})

    def test_lanes_that_shrink_stop_the_update(self):
        """a wind or tide download cut short must not replace the committed lanes either"""
        root = tempfile.mkdtemp(dir=self.dir); os.makedirs(os.path.join(root, 'research', 'ocean', 'day'))
        dump({'wind': {'2016-01-%02dT%02d' % (d, h): [5.0, 1] for d in range(1, 21) for h in range(24)},
              'tide': {'2016-01-%02d' % d: [] for d in range(1, 21)}}, os.path.join(root, 'research', 'ocean', 'day', '2016.json'))
        out = {'results4.json': {'daily': []}, 'days2.json': {}, 'trains_days.json': {}, 'bend_days.json': {}, 'lane': {},
               'wind': {2016: {'2016-01-01T00': [5.0, 1]}}, 'tide': {2016: {'2016-01-01': []}}}
        lost = self.up.losses(out, root)
        self.assertEqual(len(lost), 2, lost)
        self.assertIn('480 wind hours -> 1', lost[0]); self.assertIn('20 tide days -> 1', lost[1])


    def test_fits_the_model_and_the_sessions_to_the_log(self):
        """with the log: the ratings model is fitted to its sessions on these three days, which scores the hours;
        the sessions' pairs, the buoy measures and the scorecard follow it (offline: no new forecasts); nothing a
        crew member wrote goes into the files"""
        end, out = self.run_update('--force', '--log', self.log)
        H = lambda n: jload(os.path.join(out, 'data', 'history', n))
        m = H('results4.json')['model']
        self.assertEqual(len(m['sessions']), 14, 'the session before the history has no conditions')
        self.assertEqual(m['sessions'][0]['date'], '2026-10-10 07:00')
        self.assertNotEqual(m['targets'], jload(os.path.join(ROOT, 'data', 'history', 'results4.json'))['model']['targets'])
        pairs = H('sess_pairs.json')
        self.assertEqual(len(pairs), 14)
        self.assertEqual(pairs[0][:2], ['2026-10-10', 1])
        allm = H('sessions_all.json')
        self.assertEqual(allm['res']['L swell height the app logged (forecast pin)']['n'], 14)
        score = jload(os.path.join(out, 'research', 'fc', 'score.json'))
        self.assertEqual(len(score['sessions']), 15)
        self.assertTrue(all(x['d1'] is None for x in score['sessions']), 'offline: no forecasts fetched')
        self.assertIsNotNone(score['sessions'][1]['buoy_model'])
        self.assertIn('buoy_model', score['summary'])
        for name in ('results4.json', 'sessions_all.json', 'sess_pairs.json'):
            with open(os.path.join(out, 'data', 'history', name)) as f: self.assertNotIn('private', f.read(), name)
        with open(os.path.join(out, 'research', 'hist.js')) as f: js = f.read()
        self.assertEqual(js, load(os.path.join(PAGE, 'build_hist.py'), 'build_hist').build(os.path.join(out, 'data', 'history')))
        self.assertIn('"2026-10-10 07:00"', js)

    def test_a_log_cut_short_keeps_the_model(self):
        """a read that comes back with fewer than half the sessions the model was fitted to must not replace it"""
        short = os.path.join(self.dir, 'short.json')
        dump(jload(self.log)[:3], short)
        self.assertIsNone(self.up.read_log(short, {'sessions': [{}] * 28}))
        self.assertEqual(len(self.up.read_log(self.log, {'sessions': [{}] * 28})), 15)
        self.assertIsNone(self.up.read_log(None, {'sessions': []}), 'no key, no export: nothing to fit to')


if __name__ == '__main__':
    unittest.main()
