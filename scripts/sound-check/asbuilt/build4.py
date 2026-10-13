import json, base64
r = json.load(open('results2.json'))
sess = json.load(open('sessions_all.json'))['res']
data = dict(daily=r['daily'], clim=r['clim'], ym=r['ym'], events=r['events'], per=r['per'], good=r['good'], model=r['model'],
            sess=[[k, v['rho'], v['lo'], v['hi']] for k, v in sorted(sess.items(), key=lambda kv: -kv[1]['rho'])])
meta = json.load(open('map_meta.json'))
b64 = lambda f, mt: f'data:{mt};base64,' + base64.b64encode(open(f, 'rb').read()).decode()
js = 'const DATA=' + json.dumps(data, separators=(',', ':')) + ';\n'
js += 'const MAPMETA=' + json.dumps(meta) + ';\n'
js += 'const MAPIMG=' + json.dumps({k: b64(f'map_{k}.jpg', 'image/jpeg') for k in meta}) + ';\n'
js += 'const MASKPNG=' + json.dumps({k: b64(f'height_{k}.png', 'image/png') for k in meta}) + ';\n'
js += 'const H3DPNG=' + json.dumps({k: b64(f'h3d_{k}.png', 'image/png') for k in meta}) + ';\n'
html = open('v4_head.html').read() + open('v4_body.html').read() + '<script>\n' + js + open('v4_map.js').read() + '\n' + open('v4_charts.js').read() + '\n</script>\n'
open('choc-big.html', 'w').write(html)
print('page bytes', len(html))
