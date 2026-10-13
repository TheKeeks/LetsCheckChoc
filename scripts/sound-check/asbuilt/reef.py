import tifffile, numpy as np
from PIL import Image, ImageDraw, ImageFont
RES = 3.086419755916971e-05
def read(path, top):
    a = tifffile.imread(path).astype(np.float32); a[a < -9000] = np.nan; return a, top
N, Ntop = read('bathy/n41x50_w072x00.tif', 41.50018519999999)
S, Stop = read('bathy/n41x25_w072x00.tif', 41.25018519999999)
LON0 = -72.00018519999999
def crop(lat1, lat0, lon0, lon1, step):
    rows = []
    for lat in np.arange(lat1, lat0, -RES * step):
        src, top = (N, Ntop) if lat > 41.25 else (S, Stop)
        r = int((top - lat) / RES)
        c0, c1 = int((lon0 - LON0) / RES), int((lon1 - LON0) / RES)
        rows.append(src[min(r, src.shape[0] - 1), c0:c1:step])
    return np.array(rows)
# Choc and the sound in front of it
lat1, lat0, lon0, lon1 = 41.2850, 41.2640, -71.9850, -71.9420
z = crop(lat1, lat0, lon0, lon1, 1)
print('grid', z.shape, 'depth range', np.nanmin(z), np.nanmax(z))
zz = np.nan_to_num(z, nan=np.nanmin(z))
cell = RES * 1 * 111000 * np.array([np.cos(np.radians(41.27)), 1.0])
gy, gx = np.gradient(zz * 3.0, cell[1], cell[0])   # 4x vertical exaggeration
slope = np.pi / 2 - np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
az, alt = np.radians(315), np.radians(40)
shade = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
shade = np.clip(shade, 0, 1)
# colour: land warm grey, water by depth (shallow aqua -> deep navy)
rgb = np.zeros(z.shape + (3,), np.float32)
land = zz > 0
d = np.clip(-zz / 12.0, 0, 1)[..., None]
shallow = np.array([110, 200, 200]); deep = np.array([8, 30, 60])
rgb[:] = shallow * (1 - d) + deep * d
rgb[land] = np.array([190, 178, 158])
rgb *= (0.45 + 0.75 * shade)[..., None]
img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
dr = ImageDraw.Draw(img)
def xy(lat, lon): return ((lon - lon0) / (RES * 1), (lat1 - lat) / (RES * 1))
x, y = xy(41.275693, -71.963310); dr.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 255, 255), width=3)
dr.text((x + 10, y - 22), 'CHOC', fill=(255, 255, 255))
for lab, la, lo in []:
    px, py = xy(la, lo)
    if 0 < px < img.width and 0 < py < img.height: dr.text((px, py), lab, fill=(235, 235, 225))
img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
img.save('choc_reef.png'); print(img.size)
