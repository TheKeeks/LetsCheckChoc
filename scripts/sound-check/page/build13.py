"""Assemble the research page (v13) into site/: choc-big.html plus loaded assets
(tiles/, kfull/, fr/, kgrid.png, depth144.png, fr_world.jpg, fr_close.jpg)."""
import json, os, shutil
r = json.load(open('results4.json'))
sess = json.load(open('sessions_all.json'))['res']
data = dict(daily=r['daily'], clim=r['clim'], ym=r['ym'], events=r['events'], per=r['per'], good=r['good'], model=r['model'],
            sess=[[k, v['rho'], v['lo'], v['hi']] for k, v in sorted(sess.items(), key=lambda kv: -kv[1]['rho'])])
fp = json.load(open('fr_page.json'))
js = 'const DATA=' + json.dumps(data, separators=(',', ':')) + ';\n'
js += 'const TILEMAN=' + open('tiles-manifest.json').read() + ';\nconst RAY2=' + open('ray2.json').read() + ';\n'
js += 'const FRMETA=' + json.dumps(fp['meta'], separators=(',', ':')) + ';\nconst FRTAB=' + json.dumps(fp['tab'], separators=(',', ':')) + ';\n'
js += 'const BACKK=' + open('fwdk.json').read() + ';\nconst WILDSTATS=' + open('wild_stats.json').read() + ';\n'
js += 'const DAYS2=' + open('days2.json').read() + ';\nconst TRAINS=' + open('trains_days.json').read() + ';\nconst BENT=' + open('bend_days.json').read() + ';\nconst WIND=' + open('windgrid_out.json').read() + ';\n'
js += 'const SESSPAIRS=' + open('sess_pairs.json').read() + ';\n'   # [date, size rating, buoy ft, Choc ft] per logged session (best 3 h)
html = open('v13_head.html').read() + open('v13_body.html').read() + '<script>\n' + open('errnote.js').read() + '</script>\n<script>\n' + js + open('v13_map.js').read() + '\n' + open('v7_charts.js').read() + '\n' + open('v13_lab.js').read() + '\n' + open('fray.js').read() + '\n' + open('ocean.js').read() + '\n' + open('oceanday.js').read() + '\n' + open('decade.js').read() + '\n</script>\n'
os.makedirs('site', exist_ok=True)
open('site/choc-big.html', 'w').write(html)
# the page's image and ray assets already live in research/ (tiles/, kfull/, fr/, kgrid.png, depth144.png,
# fr_world.jpg, fr_close.jpg); copy them only when building in the original working folder that has them
for d in ('tiles', 'kfull', 'fr'):
    if not os.path.isdir(d): continue
    if os.path.exists('site/' + d): shutil.rmtree('site/' + d)
    shutil.copytree(d, 'site/' + d)
for f in ('kgrid.png', 'depth144.png', 'fr_world.jpg', 'fr_close.jpg'):
    if os.path.exists(f): shutil.copy(f, 'site/' + f)
print('page bytes', len(html))
