"""Page text that quotes numbers built from the ray tables: old (Fenton-McKee) -> new (exact dispersion) values."""
b = open('v13_body.html').read()
R = [
 ('of your sessions <span class="mono" id="qa1M">87%</span>', 'of your sessions <span class="mono" id="qa1M">88%</span>'),
 ("through the linear dispersion relation (Fenton and McKee's explicit form, within about 2% of the exact one).",
  "through the linear dispersion relation, ω² = <i>g·k</i>·tanh(<i>k·h</i>), solved exactly at every depth."),
 ('<b class="mono">2.1 ft</b><span>Modeled at Choc on the day you logged as "completely flat"', '<b class="mono">2.2 ft</b><span>Modeled at Choc on the day you logged as "completely flat"'),
 ('<span id="q2cN">784</span>', '<span id="q2cN">821</span>'),
 ('<b class="mono">58%</b><span>of Choc\'s modeled energy during your 29 Aug 2023 sessions', '<b class="mono">54%</b><span>of Choc\'s modeled energy during your 29 Aug 2023 sessions'),
 ('<b class="mono">24 days</b><span>in ten years (3 ft+ at Choc)', '<b class="mono">20 days</b><span>in ten years (3 ft+ at Choc)'),
 ('which barely reaches Choc (2.1 ft).', 'which barely reaches Choc (2.2 ft).'),
 ('(0.85; the model alone 0.72–0.76; blends up to 0.82)', '(0.85; the model alone 0.73–0.75; blends up to 0.82)'),
 ('It runs at most a tenth of a foot high at any lead, and misses what arrived by about 0.3 ft a day out and 0.35 ft two or three days out.',
  'On average it lands within a twentieth of a foot of what arrived at every lead, and typically misses by 0.3–0.4 ft one to three days out.'),
 ("Over ten years Wilderness models 2.5 ft+ on 721 days against Choc's 954, and only beats Choc by half a foot or more on 21 days.",
  "Over ten years Wilderness models 2.5 ft+ on 698 days against Choc's 1,012, and only beats Choc by half a foot or more on 9 days."),
 ('happened on 314 days in ten years, about 31 a year,', 'happened on 300 days in ten years, about 30 a year,'),
 ('(almost all days score 0.44–0.56)', '(almost all days score 0.42–0.55)'),
 ('<b class="mono">5.0–6.3 ft</b><span>What the model puts at Wilderness for those hours (Choc: 5.2–7.0 ft).',
  '<b class="mono">4.9–6.1 ft</b><span>What the model puts at Wilderness for those hours (Choc: 5.3–7.0 ft).'),
 ("It's the 30th-biggest modeled Wilderness day of 3,692. Shape read: 0.47–0.50,", "It's the 33rd-biggest modeled Wilderness day of 3,692. Shape read: 0.48–0.51,"),
 ('Narrower fixed zones (250 m / 150 m) rank your sessions the same (0.86),', 'Narrower fixed zones (250 m / 150 m) rank your sessions about the same (0.84 against 0.85),'),
 ('gives Choc heights within about 7% of the forward count', 'gives Choc heights within about 9% of the forward count'),
 ('<td class="num"><b>0.85</b> (0.66–0.93)</td><td class="num">0.75 (0.50–0.89)</td>', '<td class="num"><b>0.85</b> (0.66–0.93)</td><td class="num">0.74 (0.48–0.89)</td>'),
 ('comes out at 2.1 ft at Choc although the buoy peaked at 4.6 ft', 'comes out at 2.2 ft at Choc although the buoy peaked at 4.6 ft'),
 ('<span id="sizeR2">63%</span>', '<span id="sizeR2">62%</span>'),
]
for a, c in R:
    n = b.count(a); assert n == 1, (n, a[:80]); b = b.replace(a, c)
open('v13_body.html', 'w').write(b); print(len(R), 'replacements')
# (applied after the first run) the Drop-a-wave legend's funnel, re-measured with the page's own tracer (funnel.js)
# (applied after the first run) the forecast-point experiment (fctest.py + fcan.py) re-run on the new tables:
#   0.20 -> 0.22 ft typical miss a day ahead; ranks 0.69/0.71, 0.60/0.67, 0.60/0.58 -> 0.70/0.69, 0.66/0.67, 0.64/0.55
