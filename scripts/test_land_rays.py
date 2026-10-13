"""land_rays.py: the Forecast tab's landing-ray file (research/fr/land.json).

python3 -m unittest scripts/test_land_rays.py
"""
import json
import math
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'rays'))
import land_rays as lr  # noqa: E402

ROOT = os.path.join(HERE, '..')


def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


class Simplify(unittest.TestCase):
    def test_keeps_ends_and_stays_within_tolerance(self):
        pts = [(i * 0.1, math.sin(i * 0.3) * 2) for i in range(200)]
        out = lr.simplify(pts, 0.05)
        self.assertEqual(out[0], pts[0])
        self.assertEqual(out[-1], pts[-1])
        self.assertLess(len(out), len(pts) / 2)
        # every dropped point lies within the tolerance of the kept polyline
        for p in pts:
            d = min(seg_dist(p, out[i], out[i + 1]) for i in range(len(out) - 1))
            self.assertLessEqual(d, 0.05 + 1e-9)

    def test_straight_line_collapses_to_its_ends(self):
        self.assertEqual(lr.simplify([(0, 0), (1, 1), (2, 2), (3, 3)], 0.01), [(0, 0), (3, 3)])


class Landing(unittest.TestCase):
    def test_only_landing_rays_by_spot_in_tenths_of_a_km(self):
        table = {'140': {'rays': [
            {'h': '', 'p': [0, 0, 500, 500]},
            {'h': 'c', 'p': [1000, 0, 1000, 250, 1000, 520]},
            {'h': 'cw', 'p': [0, 100, 300, 100]}]},
            '200': {'rays': [{'h': '', 'p': [0, 0, 1, 1]}]}}
        out = lr.landing(table)
        self.assertEqual(list(out), ['140'])                       # a direction with nothing landing is left out
        self.assertEqual(out['140']['c'], [[100, 0, 100, 52], [0, 10, 30, 10]])
        self.assertEqual(out['140']['w'], [[0, 10, 30, 10]])

    def test_build_reads_period_files_only(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, '8.json'), 'w') as f:
                json.dump({'150': {'rays': [{'h': 'w', 'p': [0, 0, 100, 0]}]}}, f)
            with open(os.path.join(d, 'other.json'), 'w') as f:
                f.write('{}')
            lr.build(d, os.path.join(d, 'land.json'))
            with open(os.path.join(d, 'land.json')) as f:
                got = json.load(f)
        self.assertEqual(got['T'], {'8': {'150': {'w': [[0, 0, 10, 0]]}}})
        self.assertEqual(got['unit_km'], 0.1)


class Committed(unittest.TestCase):
    """The committed file matches the committed pictures, and its Choc rays really reach Choc."""

    def test_land_json_is_current(self):
        with open(os.path.join(ROOT, 'research', 'fr', 'land.json')) as f:
            have = json.load(f)
        with tempfile.TemporaryDirectory() as d:
            lr.build(os.path.join(ROOT, 'research', 'fr'), os.path.join(d, 'land.json'),
                     os.path.join(ROOT, 'scripts', 'sound-check', 'page', 'fr_page.json'))
            with open(os.path.join(d, 'land.json')) as f:
                want = json.load(f)
        self.assertEqual(have, want, 'research/fr/land.json is stale: run python3 scripts/rays/land_rays.py')

    def test_frame_is_the_pages(self):
        html = open(os.path.join(ROOT, 'research', 'index.html')).read()
        m = re.search(r'FRMETA=(\{.*?\});', html)
        page = json.loads(m.group(1))
        with open(os.path.join(ROOT, 'research', 'fr', 'land.json')) as f:
            frame = json.load(f)['frame']
        for k in ('world', 'kmlon', 'kmlat', 'choc', 'w1', 'w2'):
            self.assertEqual(frame[k], page[k], k)

    def test_choc_rays_pass_close_to_the_choc_pin(self):
        with open(os.path.join(ROOT, 'research', 'fr', 'land.json')) as f:
            got = json.load(f)
        T = got['T']
        cx, cy = got['frame']['choc']
        n = 0
        for per in T.values():
            for spots in per.values():
                for p in spots.get('c', []):
                    pts = [(p[i] * 0.1, p[i + 1] * 0.1) for i in range(0, len(p), 2)]
                    d = min(seg_dist((cx, cy), pts[i], pts[i + 1]) for i in range(len(pts) - 1))
                    self.assertLess(d, 1.5, 'a Choc ray ends %.1f km from the pin' % d)
                    n += 1
        self.assertGreater(n, 1000)


if __name__ == '__main__':
    unittest.main()
