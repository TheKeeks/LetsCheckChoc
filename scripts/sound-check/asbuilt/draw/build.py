"""Assemble the drawing tool into site/: index page + imagery + depth data."""
import json, os, shutil
import numpy as np
from PIL import Image
os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.makedirs('site/img', exist_ok=True)
meta = json.load(open('out/meta.json'))
css = open('/home/user/LetsCheckChoc/vendor/leaflet/leaflet.css').read()
html = open('page.html').read().replace('/*LEAFLETCSS*/', css).replace('/*META*/null', json.dumps(meta, separators=(',', ':')))
open('site/reef-map.html', 'w').write(html)
for f in os.listdir('out/img'):
    o = 'site/img/' + f.replace('.jpg', '.webp')
    if os.path.exists(o): continue
    a = np.asarray(Image.open('out/img/' + f).convert('RGB'))
    white = (a > 246).all(axis=2)                      # outside the state's photo coverage: make it see-through
    from scipy.ndimage import binary_opening, binary_dilation
    white = binary_dilation(binary_opening(white, iterations=4), iterations=3)
    alpha = np.where(white, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([a, alpha]), 'RGBA').save(o, quality=74, method=4)
for f in ('contours_choc.json', 'contours_wild.json', 'depth_choc.png', 'depth_wild.png'): shutil.copy('out/' + f, 'site/' + f)
print(len(html), sum(os.path.getsize('site/img/' + f) for f in os.listdir('site/img')))
