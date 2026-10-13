"""The rays that land: research/fr/land.json for the Forecast tab's ray map.

The Sound Check page's ray pictures (research/fr/<T>.json, about 5.7 MB for the six periods) hold every sampled ray
of a straight crest for each period and direction. The Forecast tab draws only the ones that reach Choc or
Wilderness, for the hour's swells, so it gets them from one small file instead: per period and direction, the
landing rays for each spot, simplified (Ramer-Douglas-Peucker, 50 m tolerance: well under a pixel at any zoom the
tab draws) and stored in tenths of a kilometre from the pictures' top-left corner. The frame comes along from the
page's fr_page.json (scripts/sound-check/page): the pictures' corners in degrees (world: west, east, south, north),
km per degree, the Choc pin and the Wilderness shoreline ends in km from that corner (research/fr_world.jpg is the
backdrop of exactly that frame).

  {"tol_km": 0.05, "unit_km": 0.1, "frame": {"world": [...], "kmlon": .., "kmlat": .., "choc": [x, y], "w1": [..],
   "w2": [..]}, "T": {"8": {"140": {"c": [[x0, y0, x1, y1, ...], ...], "w": [...]}}}}

usage: python3 land_rays.py [research/fr] [research/fr/land.json] [fr_page.json]
"""
import json
import math
import os
import sys

TOL_KM = 0.05
UNIT_KM = 0.1


def simplify(pts, tol):
    """Ramer-Douglas-Peucker on [(x, y), ...]: drops points closer than tol to the kept polyline, keeps both ends."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        far, fi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L else math.hypot(px - ax, py - ay)
            if d > far:
                far, fi = d, i
        if far > tol:
            keep[fi] = True
            stack.append((a, fi))
            stack.append((fi, b))
    return [p for p, k in zip(pts, keep) if k]


def landing(table, tol=TOL_KM, unit=UNIT_KM):
    """One period's picture table ({dir: {rays: [{h, p}]}}, p in hundredths of a km) -> {dir: {c: [...], w: [...]}}."""
    out = {}
    for d, b in table.items():
        spots = {}
        for r in b.get('rays', []):
            if not r.get('h'):
                continue
            p = r['p']
            pts = [(p[i] / 100.0, p[i + 1] / 100.0) for i in range(0, len(p) - 1, 2)]
            flat = []
            for x, y in simplify(pts, tol):
                flat += [round(x / unit), round(y / unit)]
            for s in ('c', 'w'):
                if s in r['h']:
                    spots.setdefault(s, []).append(flat)
        if spots:
            out[d] = spots
    return out


def build(src, dst, page=None):
    frame = None
    if page and os.path.exists(page):
        with open(page) as fh:
            m = json.load(fh)['meta']
        frame = {k: m[k] for k in ('world', 'kmlon', 'kmlat', 'choc', 'w1', 'w2')}
    T = {}
    for f in sorted(os.listdir(src)):
        stem = f[:-5]
        if f.endswith('.json') and stem.isdigit():
            with open(os.path.join(src, f)) as fh:
                T[stem] = landing(json.load(fh))
    with open(dst, 'w') as fh:
        json.dump({'tol_km': TOL_KM, 'unit_km': UNIT_KM, 'frame': frame, 'T': T}, fh, separators=(',', ':'))
    return T


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '..', '..', 'research', 'fr')
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, 'land.json')
    page = sys.argv[3] if len(sys.argv) > 3 else os.path.join(here, '..', 'sound-check', 'page', 'fr_page.json')
    T = build(src, dst, page)
    print(dst, os.path.getsize(dst), 'bytes,', sum(len(v) for d in T.values() for v in d.values()), 'spot bins')
