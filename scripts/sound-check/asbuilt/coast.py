"""Atlantic coastline for the storm builder: Natural Earth 50m land (world-atlas TopoJSON),
rings near 20-54 N / 84-38 W, simplified, plus a 0.1-degree land mask for path blocking."""
import json, math, base64
import numpy as np
from PIL import Image, ImageDraw
t = json.load(open('land50.json')); sx, sy = t['transform']['scale']; tx, ty = t['transform']['translate']
arcs = []
for a in t['arcs']:
    x = y = 0; pts = []
    for dx, dy in a: x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)
def arc(i): return arcs[i] if i >= 0 else arcs[~i][::-1]
rings = []
g = t['objects']['land']
geoms = g['geometries'] if g['type'] == 'GeometryCollection' else [g]
for gm in geoms:
    polys = gm['arcs'] if gm['type'] == 'MultiPolygon' else [gm['arcs']]
    for poly in polys:
        for ring in poly:
            pts = []
            for i in ring: p = arc(i); pts.extend(p[1:] if pts else p)
            rings.append(pts)
W, E, S, N = -84, -38, 20, 54
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); P = np.array(pts)
    d = np.abs(np.cross(b - a, P - a)) / (np.linalg.norm(b - a) + 1e-12) if np.any(b != a) else np.linalg.norm(P - a, axis=1)
    i = int(np.argmax(d))
    if d[i] > eps: return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps)
    return [pts[0], pts[-1]]
out = []
for r in rings:
    xs = [p[0] for p in r]; ys = [p[1] for p in r]
    if max(xs) < W or min(xs) > E or max(ys) < S or min(ys) > N: continue
    s = dp(r, 0.02)
    if len(s) >= 4: out.append([round(v, 3) for p in s for v in p])
print('rings', len(out), 'points', sum(len(r) // 2 for r in out))
# land mask 0.1 deg (full-resolution rings)
lon = np.arange(W, E, 0.1) + 0.05; lat = np.arange(S, N, 0.1) + 0.05
img = Image.new('1', (len(lon), len(lat)), 0); dr = ImageDraw.Draw(img)
for r in rings:
    xs = [p[0] for p in r]; ys = [p[1] for p in r]
    if max(xs) < W or min(xs) > E or max(ys) < S or min(ys) > N: continue
    # odd-even fill is right for land outlines (lakes are separate rings drawn as land; fine at 0.1 deg)
    dr.polygon([((x - W) / 0.1, (y - S) / 0.1) for x, y in r], fill=1)
mask = np.array(img, bool)                       # row 0 = southern edge (lat0)
bits = np.packbits(mask.ravel())
json.dump(dict(rings=out, mask=dict(w=len(lon), h=len(lat), lon0=W, lat0=S, step=0.1, b64=base64.b64encode(bits.tobytes()).decode())),
          open('atlantic.json', 'w'), separators=(',', ':'))
import os; print('bytes', os.path.getsize('atlantic.json'), 'land share', mask.mean().round(3))
