import json, base64
r = json.load(open('results4.json'))
sess = json.load(open('sessions_all.json'))['res']
data = dict(daily=r['daily'], clim=r['clim'], ym=r['ym'], events=r['events'], per=r['per'], good=r['good'], model=r['model'],
            sess=[[k, v['rho'], v['lo'], v['hi']] for k, v in sorted(sess.items(), key=lambda kv: -kv[1]['rho'])])
meta = json.load(open('map_meta.json'))
b64 = lambda f, mt: f'data:{mt};base64,' + base64.b64encode(open(f, 'rb').read()).decode()
km = json.load(open('kmeta.json')); km['R'], km['C'] = 245, 403
kc = json.load(open('kchoc_avg_s.json'))['Kavg']
js = 'const DATA=' + json.dumps(data, separators=(',', ':')) + ';\n'
js += 'const MAPMETA=' + json.dumps(meta) + ';\n'
js += 'const MAPIMG=' + json.dumps({k: b64(f'map_{k}.jpg', 'image/jpeg') for k in meta}) + ';\n'
js += 'const H3DPNG=' + json.dumps({k: b64(f'h3d_{k}.png', 'image/png') for k in meta}) + ';\n'
js += 'const KMETA=' + json.dumps(km) + ';\nconst KCHOC=' + json.dumps({k: round(v, 3) for k, v in kc.items()}) + ';\n'
js += 'const KATLAS=' + json.dumps(b64('katlas.png', 'image/png')) + ';\n'
js += 'const BATHYJPG=' + json.dumps(b64('bathy_wide.jpg', 'image/jpeg')) + ';\nconst RAYPNG=' + json.dumps(b64('height_wide.png', 'image/png')) + ';\n'
js += 'const BACKK=' + open('backk2.json').read() + ';\nconst SPOTS=' + open('spots.json').read() + ';\nconst WILDSTATS=' + open('wild_stats.json').read() + ';\nconst FORECAST=' + open('forecast.json').read() + ';\n'
js += 'const CHOCINSET=' + json.dumps(dict(meta=json.load(open('choc_inset.json')), src=b64('choc_inset.jpg', 'image/jpeg'))) + ';\n'
js += 'const WILDINSET=' + json.dumps(dict(meta=json.load(open('wild_inset.json')), src=b64('wild_inset.jpg', 'image/jpeg'))) + ';\n'
js += 'const DAYS2=' + open('days2.json').read() + ';\n'
js += 'const TRAINS=' + open('trains_days.json').read() + ';\n'
js += 'const WIND=' + open('windgrid_out.json').read() + ';\n'
html = open('v10_head.html').read() + open('v10_body.html').read() + '<script>\n' + js + open('v5_map.js').read() + '\n' + open('v7_charts.js').read() + '\n' + open('v10_lab.js').read() + '\n</script>\n'
open('choc-big.html', 'w').write(html)
print('page bytes', len(html))
