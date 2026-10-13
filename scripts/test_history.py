"""Tests for the Sound Check history: the page reads it from research/hist.js, which build_hist.py writes from
data/history/ (the history bot keeps both current).

  python3 -m unittest scripts/test_history.py
"""
import importlib.util, json, os, re, unittest

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PAGE = os.path.join(ROOT, 'scripts', 'sound-check', 'page')


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
        r = json.load(open(os.path.join(h, 'results4.json')))
        last = r['daily'][-1][0]                      # 'yymmdd'
        last = '20%s-%s-%s' % (last[:2], last[2:4], last[4:6])
        for name in ('trains_days.json', 'bend_days.json', 'days2.json'):
            days = sorted(json.load(open(os.path.join(h, name))).keys())
            self.assertEqual(days[-1], last, name)


if __name__ == '__main__':
    unittest.main()
