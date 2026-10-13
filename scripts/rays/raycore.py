"""Wave-ray physics behind Choc's numbers on the Sound Check page (research/): how fast a swell travels at a
given depth, the smoothed speed field the rays steer by, and the step that bends a ray toward slower water.

The table builder (build_tables.py) and the tests (scripts/test_raycore.py) both use this file, so the tests
check the same code that makes the page's numbers.

Rays follow Snell's law in gradient form: the heading turns by -(1/c) dc/dn per metre travelled, where c is the
crest (phase) speed and n points to the ray's left, so a crest bends toward the slower, shallower water.
Speeds come from the exact linear dispersion relation w^2 = g k tanh(k h), solved by Newton's method, as in
Halsne et al. (2023, GMD 16, 6515). The explicit Fenton & McKee (1990) formula used before is up to 1.7 % off
and that error changes with depth, so it bent rays by up to 0.9 deg too much or too little.
"""
import math
import numpy as np

G = 9.81


def wavelength(T, h):
    """Wavelength (m) of period-T (s) waves in water h (m) deep; h may be an array. Exact linear dispersion:
    Newton's method from the Fenton & McKee estimate, which is within 1.7 %, so a few steps reach machine precision."""
    h = np.asarray(h, float)
    w = 2 * math.pi / T
    k = 2 * math.pi / (G * T * T / (2 * math.pi) * np.tanh((w * np.sqrt(h / G)) ** 1.5) ** (2 / 3))
    for _ in range(6):
        t = np.tanh(k * h)
        k = k - (G * k * t - w * w) / (G * t + G * k * h * (1 - t * t))
    return 2 * math.pi / k


def phase_speed(T, h):
    """Crest speed (m/s): what refraction runs on."""
    return wavelength(T, h) / T


def group_speed(T, h):
    """Speed (m/s) the energy travels at: half the crest speed in deep water, all of it in shallow water."""
    L = wavelength(T, h)
    kh = np.minimum(2 * math.pi / L * np.asarray(h, float), 20)
    return 0.5 * (1 + 2 * kh / np.sinh(2 * kh)) * L / T


def _box(a, r, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r, r)
    p = np.pad(a, pad, mode='edge')
    cs = np.cumsum(p, axis=axis)
    cs = np.concatenate([np.zeros_like(np.take(cs, [0], axis=axis)), cs], axis=axis)
    n = a.shape[axis]
    return (np.take(cs, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(cs, np.arange(0, n), axis=axis)) / (2 * r + 1)


def blur(a, r):
    """Three passes of a (2r+1)-cell box each way: close to a Gaussian, sigma = sqrt((2r+1)^2 - 1) / 2 cells."""
    for _ in range(3):
        a = _box(_box(a, r, 0), r, 1)
    return a


def speed_field(h, water, T, dx, r=3):
    """The crest speed the rays steer by, and its gradient. Land is given the slowest speed over water before the
    blur, so a coast bends rays toward it like a beach; r = 3 on 48 m cells is sigma ~166 m, about a wavelength."""
    c = phase_speed(T, np.maximum(h, 0.5))
    cs = blur(np.where(water, c, c[water].min()), r)
    gy, gx = np.gradient(cs, dx, dx)
    return dict(cs=cs, gx=gx, gy=gy)


def trace(F, X, Y, phi0, water, dx, targets=(), step=0.5, record_every=0):
    """March rays from (X, Y) (metres; y grows southward, like the grid's rows) heading phi0 (radians from +x).
    Each step of step * dx metres first turns the heading by Snell's law, read at the cell the ray is in, then moves.
    A ray stops on land or at the edge of the grid. X and Y are moved in place.

    targets: distance functions f(X, Y) -> metres. For each, returns every ray's closest approach and where it was
    (x, y, heading) then. With record_every, also every ray's path, a point every record_every steps."""
    R, C = water.shape
    n = len(X)
    phi = np.full(n, float(phi0))
    alive = np.ones(n, bool)
    ds = step * dx
    best = [np.full(n, 1e9) for _ in targets]
    at = [np.zeros((n, 3)) for _ in targets]
    paths = [[(X[i], Y[i])] for i in range(n)] if record_every else None
    for it in range(int(2.6 * (R + C) / step)):
        idx = np.where(alive)[0]
        if not len(idx):
            break
        ci = (X[idx] / dx).astype(int)
        ri = (Y[idx] / dx).astype(int)
        inb = (ci >= 0) & (ci < C) & (ri >= 0) & (ri < R)
        alive[idx[~inb]] = False
        idx, ci, ri = idx[inb], ci[inb], ri[inb]
        for t, f in enumerate(targets):
            d = f(X[idx], Y[idx])
            b = d < best[t][idx]
            j = idx[b]
            best[t][j] = d[b]
            at[t][j, 0], at[t][j, 1], at[t][j, 2] = X[j], Y[j], phi[j]
        land = ~water[ri, ci]
        alive[idx[land]] = False
        if record_every:
            for i in idx[land]:
                paths[i].append((X[i], Y[i]))
        idx, ci, ri = idx[~land], ci[~land], ri[~land]
        nx, ny = -np.sin(phi[idx]), np.cos(phi[idx])
        phi[idx] -= ds * (F['gx'][ri, ci] * nx + F['gy'][ri, ci] * ny) / F['cs'][ri, ci]
        X[idx] += ds * np.cos(phi[idx])
        Y[idx] += ds * np.sin(phi[idx])
        if record_every and it % record_every == 0:
            for i in idx:
                paths[i].append((X[i], Y[i]))
    if record_every:
        for i in np.where(alive)[0]:
            paths[i].append((X[i], Y[i]))
    return best, at, paths


def landing_radius(T, r0):
    """Radius (m) of a spot's landing zone: at least r0, else half the Fresnel width sqrt(L d) for the wavelength at
    20 m and d = 15 km (Montauk-Block Island gap to Fishers). Long waves can't be focused into anything narrower."""
    return max(r0, 0.5 * math.sqrt(float(wavelength(T, 20.0)) * 15000))


def shoaling(T, h_from=48.0, h_to=4.0):
    """Energy gained by slowing from the buoy's depth (48 m) to the comparison depth (4 m): cg ratio."""
    return float(group_speed(T, h_from) / group_speed(T, h_to))
