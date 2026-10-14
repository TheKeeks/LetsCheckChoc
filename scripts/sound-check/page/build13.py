"""Assemble the research page (v13) into site/: choc-big.html (research/index.html), choc-map.html (research/map.html,
the map alone) plus loaded assets
(tiles/, kfull/, fr/, kgrid.png, depth144.png, fr_world.jpg, fr_close.jpg).

The page carries its code and its fixed tables (tiles, ray tables). The history it shows (every day since 2016,
the swell trains, the wind, the surf-log pairs) is not in it: the page loads hist.js, which build_hist.py writes
from data/history/ and the history bot keeps current. So rebuilding the page never rolls the history back."""
import json, os, shutil
fp = json.load(open('fr_page.json'))
js = 'const TILEMAN=' + open('tiles-manifest.json').read() + ';\nconst RAY2=' + open('ray2.json').read() + ';\n'
js += 'const FRMETA=' + json.dumps(fp['meta'], separators=(',', ':')) + ';\nconst FRTAB=' + json.dumps(fp['tab'], separators=(',', ':')) + ';\n'
js += 'const BACKK=' + open('fwdk.json').read() + ';\n'
html = open('v13_head.html').read() + open('v13_body.html').read() + '<script>\n' + open('errnote.js').read() + '</script>\n<script src="hist.js"></script>\n<script>\n' + js + open('v13_map.js').read() + '\n' + open('v7_charts.js').read() + '\n' + open('v13_lab.js').read() + '\n' + open('fray.js').read() + '\n' + open('ocean.js').read() + '\n' + open('oceanday.js').read() + '\n' + open('decade.js').read() + '\n</script>\n'
os.makedirs('site', exist_ok=True)
open('site/choc-big.html', 'w').write(html)
# The map alone (research/map.html, the Forecast tab's map): the same head and map section, and only the code the map
# runs (v13_map, v13_lab, ocean), without the history (hist.js, 1.4 MB) or the charts. Its forecast doesn't need them.
body = open('v13_body.html').read()
a = body.index('<section aria-labelledby="trip-h">'); b = body.index('</section>\n', a) + len('</section>\n')
head = open('v13_head.html').read().replace('<title>Methods · LetsCheckChoc</title>', '<title>Map · LetsCheckChoc</title>')
mhtml = head + '<div class="wrap">\n' + body[a:b] + '</div>\n<div id="tip" hidden></div>\n' + '<script>\n' + open('errnote.js').read() + '</script>\n<script>\n' + js + open('v13_map.js').read() + '\n' + open('v13_lab.js').read() + '\n' + open('ocean.js').read() + '\n</script>\n'
open('site/choc-map.html', 'w').write(mhtml)
# the page's image and ray assets already live in research/ (tiles/, kfull/, fr/, kgrid.png, depth144.png,
# fr_world.jpg, fr_close.jpg); copy them only when building in the original working folder that has them
for d in ('tiles', 'kfull', 'fr'):
    if not os.path.isdir(d): continue
    if os.path.exists('site/' + d): shutil.rmtree('site/' + d)
    shutil.copytree(d, 'site/' + d)
for f in ('kgrid.png', 'depth144.png', 'fr_world.jpg', 'fr_close.jpg'):
    if os.path.exists(f): shutil.copy(f, 'site/' + f)
print('page bytes', len(html), 'map page bytes', len(mhtml))
