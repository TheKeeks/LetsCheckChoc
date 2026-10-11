"""Tests for scripts/rays/raycore.py, the wave-ray physics behind Choc's numbers on the Sound Check page.

Run: npm run test:py   (python3 -m unittest discover -s scripts -p 'test_*.py')

The main check is the one Halsne et al. (2023, GMD 16, 6515) use for their solver: on a beach whose depth
contours are perfectly straight, Snell's law gives the exact angle a wave should have at every depth, so a ray
tracer can be checked against it. Ours runs here with the settings the page's tables use: 48 m cells, the
speed blurred over ~166 m, 24 m steps. Needs numpy (CI's Python job installs it); without it these are skipped.
"""
import importlib.util
import math
import unittest
from pathlib import Path

try:
    import numpy as np
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False

SCRIPT = Path(__file__).resolve().parent / "rays" / "raycore.py"
G = 9.81
DX = 48.0


def exact_speed(T, h):
    """Crest speed from w^2 = g k tanh(k h) by bisection: an answer that doesn't depend on the code under test."""
    w2 = (2 * math.pi / T) ** 2
    lo, hi = 1e-6, 10.0
    for _ in range(200):
        k = 0.5 * (lo + hi)
        lo, hi = (k, hi) if G * k * math.tanh(k * h) < w2 else (lo, k)
    return (2 * math.pi / T) / (0.5 * (lo + hi))


def load():
    spec = importlib.util.spec_from_file_location("raycore_under_test", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def snell_errors(rc, T, a0_deg):
    """Trace one ray up a straight-contoured beach (60 m deep in the south to 2 m in the north over 25 km), starting
    a0 degrees east of straight in. Returns (depth, traced angle, Snell's exact angle) along the way, degrees."""
    R, C = 700, 700                                   # 33.6 km by 33.6 km of 48 m cells
    yc = (np.arange(R) + 0.5) * DX                    # rows grow southward
    h1d = np.clip(2 + 58 * (yc - 4000) / 25000, 2, 60)
    h = np.repeat(h1d[:, None], C, axis=1)
    water = np.ones((R, C), bool)
    F = rc.speed_field(h, water, T, DX)
    X, Y = np.array([2000.0]), np.array([(R - 3) * DX])
    _, _, paths = rc.trace(F, X, Y, -math.pi / 2 + math.radians(a0_deg), water, DX, record_every=1)
    p = np.array(paths[0])
    head = np.arctan2(np.diff(p[:, 1]), np.diff(p[:, 0]))         # heading of each step, from where the ray went
    depth = np.interp(p[1:, 1], yc, h1d)
    c0 = exact_speed(T, 60.0)
    out = []
    for d, a in zip(depth, head):
        if 2.5 < d < 58:                              # away from the ends of the slope, where the blur sees the flat
            exact = math.degrees(math.asin(math.sin(math.radians(a0_deg)) * exact_speed(T, d) / c0))
            out.append((d, math.degrees(a + math.pi / 2), exact))
    return out


@unittest.skipUnless(HAVE_NUMPY, "raycore needs numpy")
class TestWaveSpeed(unittest.TestCase):
    def setUp(self):
        self.rc = load()

    def test_crest_speed_matches_an_independent_solution(self):
        for T in (5, 8, 12, 17):
            for h in (1.0, 4.0, 20.0, 48.0, 300.0):
                self.assertAlmostEqual(float(self.rc.phase_speed(T, h)) / exact_speed(T, h), 1.0, delta=1e-9, msg=f"T={T} h={h}")

    def test_wavelength_solves_the_dispersion_relation(self):
        # w^2 = g k tanh(k h) to rounding error, for every period on the page and depths from the reef to the open ocean
        for T in range(5, 18):
            h = np.array([0.5, 2, 4, 10, 20, 48, 100, 1000, 4000], float)
            k = 2 * math.pi / self.rc.wavelength(T, h)
            w = 2 * math.pi / T
            np.testing.assert_allclose(G * k * np.tanh(k * h), w * w, rtol=1e-10, err_msg=f"T={T}")

    def test_deep_and_shallow_water_limits(self):
        self.assertAlmostEqual(float(self.rc.wavelength(12, 4000.0)), G * 144 / (2 * math.pi), delta=1e-6)
        # shallow: c = sqrt(g h) (1 - (kh)^2 / 6 + ...); for 17 s in 0.5 m, kh = 0.084
        L = float(self.rc.wavelength(17, 0.5)); kh = 2 * math.pi / L * 0.5
        self.assertAlmostEqual(L / (17 * math.sqrt(G * 0.5)), 1 - kh * kh / 6, delta=1e-5)

    def test_group_speed(self):
        # deep water: energy travels at half the crest speed; shallow: at the crest speed
        self.assertAlmostEqual(float(self.rc.group_speed(10, 4000.0) / self.rc.phase_speed(10, 4000.0)), 0.5, places=6)
        self.assertAlmostEqual(float(self.rc.group_speed(17, 0.5) / self.rc.phase_speed(17, 0.5)), 1.0, delta=0.003)

    def test_shoaling_and_landing_zone(self):
        # 48 m to 4 m: a 5 s wave's energy speeds up a little (it was in deep water at the buoy), so it spreads out
        # (0.87); long swell's energy slows down a lot and bunches up (2.5 at 17 s)
        self.assertAlmostEqual(self.rc.shoaling(5), 0.87, delta=0.01)
        self.assertAlmostEqual(self.rc.shoaling(17), 2.53, delta=0.02)
        for T in range(5, 18):
            self.assertGreaterEqual(self.rc.landing_radius(T, 250.0), 250.0)
        self.assertGreater(self.rc.landing_radius(17, 250.0), self.rc.landing_radius(9, 250.0))


@unittest.skipUnless(HAVE_NUMPY, "raycore needs numpy")
class TestRays(unittest.TestCase):
    def setUp(self):
        self.rc = load()

    def test_snells_law_on_a_straight_beach(self):
        # The tracer's angle stays within 0.1 deg of Snell's law at every depth, for short and long swell, near-square
        # and oblique. With the old Fenton-McKee wave speeds it was 0.3-0.9 deg off (12 s at 45 deg: 22.9 vs 22.2 deg
        # in 10 m of water).
        for T in (8, 12, 16):
            for a0 in (20, 45):
                e = snell_errors(self.rc, T, a0)
                self.assertGreater(len(e), 500, "the ray should cross the whole slope")
                worst = max(abs(a - x) for _, a, x in e)
                self.assertLess(worst, 0.1, f"T={T} s from {a0} deg: off by up to {worst:.2f} deg")

    def test_flat_bottom_rays_go_straight(self):
        R, C = 200, 200
        h = np.full((R, C), 30.0)
        water = np.ones((R, C), bool)
        F = self.rc.speed_field(h, water, 12, DX)
        X, Y = np.array([500.0]), np.array([(R - 3) * DX])
        phi0 = -math.pi / 2 + math.radians(30)
        _, at, _ = self.rc.trace(F, X, Y, phi0, water, DX, targets=[lambda x, y: y])
        self.assertAlmostEqual(at[0][0, 2], phi0, places=9)

    def test_rays_stop_on_land(self):
        R, C = 200, 200
        h = np.full((R, C), 30.0)
        water = np.ones((R, C), bool)
        water[:80, :] = False                         # land across the north
        F = self.rc.speed_field(h, water, 12, DX)
        X, Y = np.array([4800.0]), np.array([(R - 3) * DX])
        best, at, paths = self.rc.trace(F, X, Y, -math.pi / 2, water, DX, targets=[lambda x, y: y], record_every=1)
        self.assertGreaterEqual(Y[0], 80 * DX - DX)   # stopped at the shore, not on the far side
        self.assertLess(Y[0], 81 * DX)


if __name__ == "__main__":
    unittest.main()
