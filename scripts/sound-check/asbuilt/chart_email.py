"""Email figure: my size rating vs raw buoy height and vs modeled Choc height (28 sessions)."""
import json, itertools
import numpy as np
S = json.load(open('chart_sessions.json'))
Z = np.array([s['size'] for s in S]); B = np.array([s['buoy'] for s in S]); M = np.array([s['model'] for s in S])
def pairs_right(x):
    c = n = 0
    for i, j in itertools.combinations(range(len(Z)), 2):
        if Z[i] == Z[j]: continue
        n += 1; c += (x[i] - x[j]) * (Z[i] - Z[j]) > 0
    return round(100 * c / n), n
pb, n_pairs = pairs_right(B); pm, _ = pairs_right(M)
HL = [(s['size'] <= 3 and s['buoy'] > 4.0) for s in S]          # small days the buoy made look decent

C = dict(surface='#fcfcfb', ink='#0b0b0b', ink2='#52514e', muted='#898781', grid='#e1e0d9', base='#c3c2b7',
         accent='#2a78d6', other='#898781', fit='#c3c2b7')
FONT = '"Liberation Sans", Arial, system-ui, -apple-system, "Segoe UI", sans-serif'
W, H = 680, 506
PT, PB = 168, 400                                             # plot top / bottom (y px)
panels = [dict(key='buoy', x0=62, x1=330, xmax=14, ticks=[0, 2, 4, 6, 8, 10, 12, 14], name='Raw buoy height',
               axis='Block Island buoy, best 3 hours (ft)', pct=pb, ylabels=True),
          dict(key='model', x0=384, x1=652, xmax=8, ticks=[0, 2, 4, 6, 8], name='Modeled height at Choc',
               axis='Choc ray model, best 3 hours (ft)', pct=pm, ylabels=False)]
Y = lambda r: PB - (PB - PT) * r / 10
out = []
A = out.append
A(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family=\'{FONT}\' role="img" '
  f'aria-label="Two scatter plots of 28 surf sessions: size rating against raw buoy height, and against modeled height at Choc. The model picks the bigger of two sessions {pm}% of the time, the buoy {pb}%.">')
A(f'<rect width="{W}" height="{H}" fill="{C["surface"]}"/>')
A(f'<text x="24" y="36" font-size="18" font-weight="700" fill="{C["ink"]}">The model ranks my sessions better than the raw buoy</text>')
A(f'<text x="24" y="58" font-size="13" fill="{C["ink2"]}">28 logged sessions at Choc: my size rating against each source&#8217;s best 3 hours that day</text>')
# legend (2 series: highlighted vs other)
lx = 24
A(f'<circle cx="{lx + 5}" cy="82" r="5" fill="{C["accent"]}"/>')
A(f'<text x="{lx + 16}" y="86" font-size="12" fill="{C["ink2"]}">Small days (I rated size 3 or less) when the buoy read over 4 ft</text>')
A(f'<circle cx="{lx + 5}" cy="102" r="5" fill="{C["other"]}"/>')
A(f'<text x="{lx + 16}" y="106" font-size="12" fill="{C["ink2"]}">Other sessions</text>')
for p in panels:
    x0, x1, xm = p['x0'], p['x1'], p['xmax']; X = lambda v, x0=x0, x1=x1, xm=xm: x0 + (x1 - x0) * v / xm
    vals = B if p['key'] == 'buoy' else M
    A(f'<text x="{x0}" y="132" font-size="14" font-weight="700" fill="{C["ink"]}">{p["name"]}</text>')
    A(f'<text x="{x0}" y="153" font-size="12.5" fill="{C["ink2"]}">Picks the bigger of two sessions: <tspan font-size="15" font-weight="700" fill="{C["ink"]}">{p["pct"]}%</tspan></text>')
    for r in range(0, 11, 2):                                   # gridlines + y ticks
        A(f'<line x1="{x0}" x2="{x1}" y1="{Y(r):.1f}" y2="{Y(r):.1f}" stroke="{C["grid"] if r else C["base"]}" stroke-width="1"/>')
        if p['ylabels']: A(f'<text x="{x0 - 8}" y="{Y(r) + 4:.1f}" font-size="11" fill="{C["muted"]}" text-anchor="end" style="font-variant-numeric:tabular-nums">{r}</text>')
    for t in p['ticks']:
        A(f'<text x="{X(t):.1f}" y="{PB + 17}" font-size="11" fill="{C["muted"]}" text-anchor="middle" style="font-variant-numeric:tabular-nums">{t}</text>')
    A(f'<text x="{(x0 + x1) / 2:.1f}" y="{PB + 36}" font-size="11.5" fill="{C["ink2"]}" text-anchor="middle">{p["axis"]}</text>')
    a, b = np.polyfit(vals, Z, 1); lo, hi = vals.min(), min(vals.max(), (10 - b) / a)   # straight-line fit, under the dots, kept inside 0-10
    A(f'<line x1="{X(lo):.1f}" y1="{Y(a * lo + b):.1f}" x2="{X(hi):.1f}" y2="{Y(a * hi + b):.1f}" stroke="{C["fit"]}" stroke-width="2" stroke-linecap="round"/>')
    for hl in (False, True):
        for s, h, v in zip(S, HL, vals):
            if h != hl: continue
            A(f'<circle cx="{X(v):.1f}" cy="{Y(s["size"]):.1f}" r="5" fill="{C["accent"] if h else C["other"]}" stroke="{C["surface"]}" stroke-width="2"/>')
    # sparing direct labels: the "completely flat" day and the biggest day
    flat = next(i for i, s in enumerate(S) if s['date'] == '2022-09-12'); top = next(i for i, s in enumerate(S) if s['date'] == '2022-10-14')
    HALO = f'stroke="{C["surface"]}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"'
    A(f'<text x="{X(vals[flat]) + 10:.1f}" y="{Y(1) + 4:.1f}" font-size="11.5" fill="{C["ink2"]}" {HALO}>&#8220;Completely flat&#8221; ({vals[flat]:.1f} ft)</text>')
    A(f'<text x="{X(vals[top]) + 6:.1f}" y="{Y(9) - 11:.1f}" font-size="11.5" fill="{C["ink2"]}" text-anchor="end" {HALO}>14 Oct 2022 ({vals[top]:.1f} ft)</text>')
A(f'<text x="18" y="{(PT + PB) / 2:.1f}" font-size="11.5" fill="{C["ink2"]}" text-anchor="middle" transform="rotate(-90 18 {(PT + PB) / 2:.1f})">My size rating (0&#8211;10)</text>')
A(f'<text x="24" y="{H - 30}" font-size="11" fill="{C["muted"]}">Of the {n_pairs} pairs of sessions I rated differently, how often the higher reading went with the higher rating. Grey lines: straight-line fits.</text>')
A(f'<text x="24" y="{H - 14}" font-size="11" fill="{C["muted"]}">Two days had two sessions with the same rating, so two dots hide behind others. Buoy: NDBC 44097 (CDIP 154).</text>')
A('</svg>')
svg = '\n'.join(out)
open('/home/user/LetsCheckChoc/tmp-email/model-vs-buoy.svg', 'w').write(svg)
open('chart_email.html', 'w').write(f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:{C["surface"]}}}</style>{svg}')
print('pairs', n_pairs, 'buoy', pb, 'model', pm, 'highlighted', sum(HL))
