"""Reorganize v13_body.html around the two research questions. Every existing block is kept (moved, not
rewritten), except the section labels, the header, and the tiles that move to the question they answer."""
import re
src = open('v13_body.bak88.html').read()

def cut(s, start, end):
    i = s.index(start); j = s.index(end, i) + len(end); return s[i:j]
def rep(s, old, new, n=1):
    assert s.count(old) == n, (old[:70], s.count(old)); return s.replace(old, new)

# ── blocks, by their top-level markers
order = ['trip-h', 'dec-h', 'how-h', 'good-h', 'ans-h', 'model-h', 'wild-h', 'tr-h', 'dc-h', 'week-h', 'behind-h']
starts = {k: src.index(f'<section aria-labelledby="{k}">') for k in order}
blk = {}
for a, b in zip(order, order[1:] + [None]):
    end = starts[b] if b else src.index('</div>\n<div id="tip"')
    blk[a] = src[starts[a]:end].rstrip('\n') + '\n'
head = src[:starts['trip-h']]
tail = src[src.index('</div>\n<div id="tip"'):]

# ── header: the two questions, answered (numbers are refilled from the data by the page script)
head = rep(head, head[head.index('  <ol class="qs">'):head.index('</ol>\n') + len('</ol>\n')], """  <div class="qa-box">
    <a class="qa" href="#q1-h"><span class="eyebrow">Question 1</span><b>What makes the surf good at Choc?</b><span>The swell that actually reaches the reef, not the buoy's number. The model's height at Choc picks the bigger of two of your sessions <span class="mono" id="qa1M">87%</span> of the time, the raw buoy <span class="mono" id="qa1B">77%</span>. After size comes offshore wind; the tide barely matters.</span></a>
    <a class="qa" href="#q2-h"><span class="eyebrow">Question 2</span><b>How real is the swell window?</b><span>Real, but soft-edged. On only <span class="mono" id="qa2In">40%</span> of Choc's 3 ft+ days does the swell come straight through the gap between Block Island and Montauk; on <span class="mono" id="qa2S">45%</span> it bends in from south of Montauk.</span></a>
  </div>
  <p class="qs-more">Also on this page: <a href="#trip-h">the map</a> (this week's forecast, any day since 2016, or drop your own wave), <a href="#how-h">how the model works</a>, <a href="#dec-h">ten years, month by month</a>, <a href="#week-h">the 7-day forecast</a> and <a href="#wild-h">Wilderness</a>.</p>
""")

# ── the map: its help text pointed at "Part 1"
blk['trip-h'] = rep(blk['trip-h'], "the color gives way to Part 1's rays:", "the color gives way to the model's rays (see How the model works):")
blk['trip-h'] = rep(blk['trip-h'], "Part 1's rays that reach Choc", "The model's rays that reach Choc")

# ── how the model works: the method only; its result tiles move to the question each one answers
how = blk['how-h']
tiles = cut(how, '  <div class="takeaways">', '  </div>\n')
how = rep(how, tiles, '  <p>Does it work? <a href="#q1-h">Question 1</a> checks it against your logged sessions.</p>\n')
how = rep(how, '<div class="eyebrow">Part 1</div>', '<div class="eyebrow">The method</div>')
blk['how-h'] = how
tile = lambda key: re.search(r'    <div class="take"><b class="mono">' + re.escape(key) + r'</b>.*?</div>\n', tiles).group(0)
t085, t58, tflat = tile('0.85'), tile('58%'), tile('2.1 ft')

# ── Question 1: the answer up front, then the ratings model, then when in the year
q1 = """<section aria-labelledby="q1-h">
  <div class="eyebrow">Question 1</div>
  <h2 id="q1-h">What makes the surf good at Choc?</h2>
  <p>First, the swell that actually reaches the reef. The buoy's wave height counts every wave it feels: groundswell, local wind chop, and swell headed away from Fishers. The model keeps only what bends in to Choc. Checked against your 28 logged sessions, its height at Choc sorts them by size much better than the buoy does.</p>
  <figure class="chart">
    <h3>Size at the reef beats size at the buoy</h3>
    <div id="q1Pair" class="q1-pair"></div>
    <figcaption>One dot per logged session: the size you rated against the best 3 hours of that day, at the Block Island buoy (left) and modeled at Choc (right). Blue-green dots are days you rated 3 or less while the buoy read over 4 ft: the model puts them where they belong. "Picks the bigger" counts the pairs of sessions you rated differently in which the higher reading went with the higher rating; a coin flip gets 50%. More measures are compared under Behind the numbers.</figcaption>
  </figure>
  <div class="takeaways" id="q1Takes">
""" + t085 + tflat + """  </div>
  <p>Then wind and tide (the ratings model below), and when in the year it all comes together.</p>
</section>
"""
model = blk['model-h']
model = rep(model, '<div class="eyebrow">Trained on your 28 logged sessions</div>', '<div class="eyebrow">Question 1 · trained on your 28 logged sessions</div>')
model = rep(model, 'modeled swell at the Choc reef (from part 1)', 'modeled swell at the Choc reef (from the model above)')
ans = rep(blk['ans-h'], '<div class="eyebrow">The answer so far</div>', '<div class="eyebrow">Question 1 · when it happens</div>')

# ── Question 2: the answer up front, then the window by direction and period (out of its collapsed box),
# the swell trains, and Check a date
behind = blk['behind-h']
kdet = cut(behind, '<details class="more"><summary>Each spot\'s window by direction and period</summary>', '</details>\n')
behind = rep(behind, kdet, '')
kfig = cut(kdet, '  <figure class="chart">', '  </figure>\n')
behind = rep(behind, "go through Part 1's response for that spot", "go through the model's response for that spot")
q2 = """<section aria-labelledby="q2-h">
  <div class="eyebrow">Question 2</div>
  <h2 id="q2-h">How real is the swell window?</h2>
  <p>From Choc, the straight-line gap to open ocean runs from Block Island (115°) to Montauk Point (158°). Swell from inside it has a straight shot at the reef, and that is still where Choc does best. But the sea floor bends swell around both islands, so the window's edges are soft, and most of Choc's 3 ft+ days get their swell from outside it.</p>
  <figure class="chart">
    <h3>Most of Choc's 3 ft+ days come from outside the window</h3>
    <div id="q2Share" class="share-rows"></div>
    <figcaption>On <span id="q2cIn">40%</span> of the <span id="q2cN">784</span> days in ten years when the model has Choc at 3 ft or more, the swell doing the work came through the 115–158° window. On <span id="q2cS">45%</span> it came from south of it, mostly 160–190° at about 10 s, and on <span id="q2cE">15%</span> from east of it. "Doing the work" means the swell bringing Choc the most energy at its biggest hour: the buoy's reading split into separate swells, each carried over the sea floor by the model.</figcaption>
  </figure>
""" + kfig + """  <div class="takeaways" id="q2Takes">
""" + t58 + """  </div>
</section>
"""
tr = blk['tr-h']
tr = rep(tr, '  <h2 id="tr-h">One swell or two?</h2>', '  <div class="eyebrow">Question 2 · swell trains</div>\n  <h2 id="tr-h">One swell or two?</h2>')
t40 = re.search(r'    <div class="take"><b class="mono">40%</b>.*?</div>\n', tr).group(0)
tr = rep(tr, t40, '')                                         # now the Question 2 chart
dc = rep(blk['dc-h'], '  <h2 id="dc-h">Check a date</h2>', '  <div class="eyebrow">Question 2 · any day you remember</div>\n  <h2 id="dc-h">Check a date</h2>')

# ── ten years, month by month: now after the questions, so Check a date sits above it
dec = rep(blk['dec-h'], 'You can also pick any date in “Check a date” further down.', 'You can also pick any date in “Check a date” above.')

# ── forecast and Wilderness: their pointers at "Part 1"
week = rep(blk['week-h'], '<div class="eyebrow">Part 3</div>', '<div class="eyebrow">Forecast</div>')
week = rep(week, "Tap a cell to see that hour's swell as rays in Part 1.", "Tap a cell to see that hour's swell as rays in How the model works.")
week = rep(week, 'Tap to see that hour in Part 1.', 'Tap to see that hour in How the model works.')
wild = rep(blk['wild-h'], '(part 1 shows both)', '(How the model works shows both)')

out = head + blk['trip-h'] + '\n' + blk['how-h'] + '\n' + q1 + model + ans + '\n' + q2 + tr + dc + '\n' + dec + '\n' + week + '\n' + wild + '\n' + behind + tail
assert 'Part 1' not in out and 'Part 2' not in out and 'Part 3' not in out and 'part 1' not in out, [m for m in ('Part 1', 'Part 2', 'Part 3', 'part 1') if m in out]
open('v13_body.html', 'w').write(out)
ids = lambda s: sorted(set(re.findall(r'id="([^"]+)"', s)))
lost = set(ids(src)) - set(ids(out)) - {'good-h'}
print('ids lost:', lost, '| new:', sorted(set(ids(out)) - set(ids(src))))
print('sections:', re.findall(r'<section aria-labelledby="([^"]+)">', out))
