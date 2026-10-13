"""NYS orthoimagery (NYS ITS Geospatial Services, public) for the drawing tool, in web mercator."""
import math, subprocess, json, os, time, sys
R = 6378137.0
def merc(lat, lon): return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
AREAS = {'choc': (41.2690, -71.9745, 41.2815, -71.9535, 0.45),
         'wild': (41.2465, -72.0195, 41.2610, -71.9985, 0.45),
         'shore': (41.236, -72.040, 41.300, -71.925, 3.0)}
YEARS = ['2001', '2004', '2007', '2010', '2013', '2016', 'NAIP_2019', '2020', '2023']
meta = {}
os.makedirs('img', exist_ok=True)
for a, (la0, lo0, la1, lo1, res) in AREAS.items():
    x0, y0 = merc(la0, lo0); x1, y1 = merc(la1, lo1)
    # mercator metres are stretched by 1/cos(lat): ground res -> mercator res
    mres = res / math.cos(math.radians((la0 + la1) / 2))
    W = int((x1 - x0) / mres); H = int((y1 - y0) / mres)
    x1 = x0 + W * mres; y1 = y0 + H * mres
    meta[a] = dict(x0=x0, y0=y0, x1=x1, y1=y1, W=W, H=H, res=res)
    for y in YEARS:
        f = f'img/{a}_{y}.png'
        if os.path.exists(f) and os.path.getsize(f) > 10000: continue
        # tile requests to stay under the 4096 px limit
        url = (f'https://orthos.its.ny.gov/arcgis/rest/services/wms/{y}/MapServer/export?bbox={x0},{y0},{x1},{y1}'
               f'&bboxSR=3857&imageSR=3857&size={W},{H}&format=png24&f=image')
        for i in range(6):
            r = subprocess.run(['curl', '-sS', '-m', '180', '-o', f, url])
            if r.returncode == 0 and os.path.getsize(f) > 10000: break
            time.sleep(3 * (i + 1))
        print(a, y, W, H, os.path.getsize(f) if os.path.exists(f) else 0, flush=True)
json.dump(meta, open('img/meta.json', 'w'), indent=1)
print('DONE')
