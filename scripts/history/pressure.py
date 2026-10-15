"""Sea-level pressure over the North Atlantic every 6 hours since 2016, for the Past days' storm view (isobars,
lows and highs, storm tracks), the way the Forecast tab draws GFS's pressure for the days ahead.

  research/ocean/pressure/<year>.png   one 8-bit grayscale image per year. Each ROW is one 6-hourly step (00, 06,
                                       12, 18 UTC; row = (t - Jan 1 00Z) / 6 h), each COLUMN one cell of a regular
                                       1 deg grid, row-major: north to south, each row of the grid west to east.
                                       Value v -> hPa = 940 + 0.5 v (940 ... 1067 hPa, clamped); 255 = no data.
  research/ocean/pressure/meta.json    the grid, the encoding and, per year, its rows, first and last step, how many
                                       are still missing, and the source.

Sources (both public, no key):
  ERA5 (ECMWF's reanalysis), 2016-2022: WeatherBench2's 6-hourly copy on Google Cloud, already conservatively
    regridded to 1 deg (360 x 181, the same grid as GFS's 1 deg files), read straight from its zarr store over
    HTTPS: one chunk is one day (4 steps) of the whole globe, blosc/lz4, about 0.6 MB. The store ends on
    2023-01-10; the 1.5 deg store is the fallback if the 1 deg one can't be read.
  GFS analyses, 2023 on: f000 of the 00/06/12/18Z cycles from NOAA's open data on AWS (noaa-gfs-bdp-pds), PRMSL
    range-read from the 1 deg file as scripts/forecast/fcpull.py does for the forecast (decoded with its decode());
    when a cycle's f000 is missing, the cycle before's f006. The bucket's 1 deg files start in 2021, after which
    ERA5 and GFS overlap until 2023-01-10: ERA5 is kept through 2022 (one source per year), GFS from 2023-01-01 00Z.

Every run (update.py calls update()) fills what's missing, oldest first, up to a time budget: on the first run all
the years since 2016, then each day yesterday's four steps. A step whose source fails stays 255 and is asked for
again on the next run. A year that's written never gets shorter, and a filled step is never fetched again (the
pictures in the repo are the record: the cache only keeps the ERA5 store's description).
"""
import io, json, os, sys, time, datetime as dt, concurrent.futures as cf
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path: sys.path.insert(0, HERE)
import sources  # noqa: E402

UTC = dt.timezone.utc
DIR = os.path.join('research', 'ocean', 'pressure')
FIRST_YEAR = 2016
# the grid: what the past view's ocean map shows (research/ocean/ocean_meta.json: 110 W-5 W, 10-70 N), every 1 deg,
# less 100-110 W (the Rockies and the Pacific), which keeps a year's picture under about 3 MB; the forecast's ocean
# grid stops at 100 W too. The north stays at 70 N: the lows that matter for swell often pass 60-65 N.
NORTH, SOUTH, WEST, EAST, DEG = 70, 10, -100, -5, 1
NLAT, NLON = (NORTH - SOUTH) // DEG + 1, (EAST - WEST) // DEG + 1
COLS = NLAT * NLON
HOURS, BASE, SCALE, MISSING = 6, 940.0, 0.5, 255

WB2 = 'https://storage.googleapis.com/weatherbench2/datasets/era5/'
ERA5_STORES = (('1959-2023_01_10-6h-360x181_equiangular_with_poles_conservative.zarr', 'ERA5 (WeatherBench2, 1°)'),
               ('1959-2023_01_10-6h-240x121_equiangular_with_poles_conservative.zarr', 'ERA5 (WeatherBench2, 1.5°)'))
ERA5_VAR = 'mean_sea_level_pressure'
SWITCH = dt.datetime(2023, 1, 1, tzinfo=UTC)          # ERA5 before, GFS from here on
GFS = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{c:%Y%m%d}/{c:%H}/atmos/gfs.t{c:%H}z.pgrb2.1p00.f{s:03d}'
GFS_NAME = 'GFS analysis (NOAA, f000, 1°)'
BUDGET = float(os.environ.get('PRESSURE_BUDGET') or 1200)   # seconds a run may spend fetching


# ── the grid, the encoding and the rows
def axes():
    """the grid's latitudes (north first) and longitudes (west first)"""
    return np.arange(NORTH, SOUTH - 1e-9, -DEG, dtype=float), np.arange(WEST, EAST + 1e-9, DEG, dtype=float)


def encode(hpa):
    """hPa -> uint8: 940 + 0.5 v, clamped to 940 ... 1067 (v 0 ... 254); NaN (no data) -> 255"""
    p = np.asarray(hpa, float)
    v = np.clip(np.round((np.where(np.isfinite(p), p, BASE) - BASE) / SCALE), 0, MISSING - 1)
    return np.where(np.isfinite(p), v, MISSING).astype(np.uint8)


def decode(v):
    """uint8 -> hPa (NaN where 255), as the page reads it"""
    v = np.asarray(v)
    return np.where(v == MISSING, np.nan, BASE + SCALE * v.astype(float))


def year_start(y): return dt.datetime(y, 1, 1, tzinfo=UTC)
def steps_in_year(y): return int((year_start(y + 1) - year_start(y)).total_seconds() // (HOURS * 3600))
def time_of(y, row): return year_start(y) + dt.timedelta(hours=HOURS * row)
def stamp(t): return t.strftime('%Y-%m-%dT%HZ')


def row_of(t):
    """a 00/06/12/18Z time -> (year, row)"""
    t = t.astimezone(UTC); h = (t - year_start(t.year)).total_seconds() / 3600
    if h % HOURS: raise ValueError(f'{t} is not a {HOURS}-hourly step')
    return t.year, int(h // HOURS)


def rows_through(y, end):
    """the rows of year y through the 18Z step of UTC day `end`"""
    last = dt.datetime(end.year, end.month, end.day, 18, tzinfo=UTC)
    if last < year_start(y): return 0
    return min(steps_in_year(y), row_of(last)[1] + 1 if last.year == y else steps_in_year(y))


def bilinear(f, lat, lon):
    """bilinear sample of a field at (lat, lon): f = dict(v=[rows north first, columns from lo0 eastward], la0, lo0,
    dl, dj, ni, nj), the layout fcpull.decode() gives; longitudes wrap round the globe. NaN where under a quarter of
    the weight has data."""
    lat = np.asarray(lat, float); lon = np.asarray(lon, float)
    fj = ((lon - f['lo0']) % 360) / f['dl']; fi = (f['la0'] - lat) / f['dj']
    i0 = np.clip(np.floor(fi).astype(int), 0, f['nj'] - 2); j0 = np.floor(fj).astype(int) % f['ni']; j1 = (j0 + 1) % f['ni']
    a, b = np.clip(fi - i0, 0, 1), fj - np.floor(fj)
    v = f['v']; q = [v[i0, j0], v[i0, j1], v[i0 + 1, j0], v[i0 + 1, j1]]; w = [(1 - a) * (1 - b), (1 - a) * b, a * (1 - b), a * b]
    num = sum(np.where(np.isnan(x), 0, x) * ww for x, ww in zip(q, w)); den = sum(np.where(np.isnan(x), 0, ww) for x, ww in zip(q, w))
    return np.where(den > 0.25, num / np.maximum(den, 1e-9), np.nan)


def to_grid(f, scale=0.01):
    """a field (Pa) -> hPa at the grid's cells, in the images' order"""
    la, lo = axes(); LA, LO = np.meshgrid(la, lo, indexing='ij')
    return bilinear(f, LA.ravel(), LO.ravel()) * scale


class Stats:
    def __init__(self): self.bytes = 0; self.requests = 0; self.steps = 0; self.seconds = 0.0
    def __str__(self):
        per = f', {self.bytes / max(self.steps, 1) / 1e3:.0f} kB and {self.seconds / max(self.steps, 1):.2f} s a step' if self.steps else ''
        return f'{self.steps} steps, {self.requests} requests, {self.bytes / 1e6:.1f} MB in {self.seconds:.0f} s{per}'


# ── ERA5 from WeatherBench2's zarr store
class ERA5:
    """WeatherBench2's ERA5 msl: {time: hPa on the grid} for the steps it has. Chunk layout, compressor, axes and
    time base come from the store's own metadata (kept in the cache)."""

    def __init__(self, cache, get=None, stores=ERA5_STORES):
        self.get = get or (lambda u: sources.get(u, timeout=120)[0])
        self.stats = Stats(); err = None
        for store, name in stores:
            try:
                self._open(cache, store); self.name = name; return
            except Exception as e:
                err = e; sources.log(f'  ERA5 store {store} unreadable ({type(e).__name__}: {e})')
        raise RuntimeError(f'no ERA5 store could be read: {err}')

    def _fetch(self, url):
        data = self.get(url); self.stats.bytes += len(data); self.stats.requests += 1
        return data

    def _open(self, cache, store):
        import numcodecs                                   # blosc (lz4) chunks
        self.base = WB2 + store + '/'
        path = os.path.join(cache, 'pressure', store + '.json') if cache else None
        if path and os.path.exists(path):
            m = sources.jload(path)
        else:
            zm = json.loads(self._fetch(self.base + '.zmetadata'))['metadata']
            arr, attrs = zm[ERA5_VAR + '/.zarray'], zm[ERA5_VAR + '/.zattrs']
            dims = attrs['_ARRAY_DIMENSIONS']
            ax = {}
            for d in ('time', 'latitude', 'longitude'):
                za = zm[d + '/.zarray']
                if za['chunks'][0] < za['shape'][0] and d != 'time': raise ValueError(f'{d} axis in several chunks')
                codec = numcodecs.get_codec(za['compressor']) if za['compressor'] else None
                raw = self._fetch(self.base + d + '/0')
                ax[d] = np.frombuffer(codec.decode(raw) if codec else raw, za['dtype']).tolist()
            units = zm['time/.zattrs']['units']                   # 'hours since 1959-01-01'
            if not units.startswith('hours since '): raise ValueError(f'time in {units}')
            t = ax['time']
            if len(t) < 2 or any(b - a != t[1] - t[0] for a, b in zip(t, t[1:])): raise ValueError('time not regular')
            m = dict(shape=arr['shape'], chunks=arr['chunks'], dtype=arr['dtype'], compressor=arr['compressor'],
                     sep=arr.get('dimension_separator', '.'), dims=dims, units=zm[ERA5_VAR + '/.zattrs'].get('units', 'Pa'),
                     t0=units[len('hours since '):], t0h=t[0], step=t[1] - t[0], lat=ax['latitude'], lon=ax['longitude'])
            if path:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w') as f: json.dump(m, f)
        self.m = m
        self.codec = numcodecs.get_codec(m['compressor'])
        t0 = dt.datetime.fromisoformat(m['t0']).replace(tzinfo=UTC) + dt.timedelta(hours=m['t0h'])
        self.t0, self.step = t0, dt.timedelta(hours=m['step'])
        self.end = t0 + self.step * (m['shape'][0] - 1)
        lat, lon = np.array(m['lat']), np.array(m['lon'])
        self.flip = lat[0] < lat[-1]                       # stored south first: flip to north first
        dl, dj = float(lon[1] - lon[0]), float(abs(lat[1] - lat[0]))
        self.frame = dict(la0=float(max(lat[0], lat[-1])), lo0=float(lon[0]), dl=dl, dj=dj, ni=len(lon), nj=len(lat))
        self.scale = 0.01 if self.m['units'] == 'Pa' else 1.0

    def index(self, t): return int(round((t - self.t0) / self.step))
    def has(self, t): return self.t0 <= t <= self.end and (t - self.t0) % self.step == dt.timedelta(0)

    def _chunk(self, k):
        """chunk k of the time axis -> array [time, lat (north first), lon]"""
        m = self.m; nt = m['chunks'][0]
        key = m['sep'].join([str(k)] + ['0'] * (len(m['shape']) - 1))
        a = np.frombuffer(self.codec.decode(self._fetch(self.base + ERA5_VAR + '/' + key)), m['dtype'])
        a = a.reshape([nt] + m['chunks'][1:])
        order = [m['dims'].index(d) for d in ('time', 'latitude', 'longitude')]
        a = a.transpose(order)
        return a[:, ::-1, :] if self.flip else a

    def rows(self, times, workers=8):
        """{t: hPa on the grid, or None} for each of `times` (a chunk that fails leaves its steps None)"""
        out = {t: None for t in times}
        by = {}
        for t in times:
            if self.has(t): by.setdefault(self.index(t) // self.m['chunks'][0], []).append(t)
        def one(k):
            try: a = self._chunk(k)
            except Exception as e:
                sources.log(f'  ERA5 chunk {k} failed ({type(e).__name__}: {e})'); return k, None
            return k, a
        t0 = time.time()
        with cf.ThreadPoolExecutor(workers) as ex:
            for k, a in ex.map(one, sorted(by)):
                if a is None: continue
                for t in by[k]:
                    out[t] = to_grid(dict(self.frame, v=a[self.index(t) - k * self.m['chunks'][0]].astype(float)), self.scale)
                    self.stats.steps += 1
        self.stats.seconds += time.time() - t0
        return out


# ── GFS analyses from NOAA's bucket on AWS
class GFSAnalysis:
    """f000 of each cycle (else the cycle before's f006): PRMSL is the 1 deg file's first record, a ~85 kB range read"""
    name = GFS_NAME

    def __init__(self, get=None):
        fc = os.path.join(HERE, '..', 'forecast')
        if fc not in sys.path: sys.path.insert(0, fc)
        import fcpull                                         # its GRIB decoder (eccodes)
        self.decode = fcpull.decode
        self.get = get or (lambda u, a=None, b=None: sources_range(u, a, b))
        self.stats = Stats()

    def _fetch(self, *a):
        data = self.get(*a); self.stats.bytes += len(data); self.stats.requests += 1
        return data

    def step(self, t):
        for c, s in ((t, 0), (t - dt.timedelta(hours=6), 6)):
            u = GFS.format(c=c, s=s)
            try:
                idx = self._fetch(u + '.idx').decode().splitlines(); offs = [int(x.split(':')[1]) for x in idx]
                i = next(n for n, x in enumerate(idx) if ':'.join(x.split(':')[3:5]) == 'PRMSL:mean sea level')
                f = self.decode(self._fetch(u, offs[i], (offs[i + 1] - 1) if i + 1 < len(offs) else ''))
                return to_grid(f)
            except Exception as e:
                last = e
        sources.log(f'  GFS {stamp(t)}: none ({type(last).__name__}: {last})')
        return None

    def rows(self, times, workers=16):
        t0 = time.time()
        with cf.ThreadPoolExecutor(workers) as ex:
            out = dict(zip(times, ex.map(self.step, times)))
        self.stats.seconds += time.time() - t0; self.stats.steps += sum(v is not None for v in out.values())
        return out


def sources_range(url, a=None, b=None, tries=4):
    """a GET (a byte range when a is given), retried with backoff; a 404 (no such file) is final at once"""
    import urllib.request, urllib.error
    err = None
    for i in range(tries):
        try:
            h = dict(sources.UA, **({'Range': f'bytes={a}-{b}'} if a is not None else {}))
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=90) as r: return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 403, 404): break
        except Exception as e:
            err = e
        if i + 1 < tries: time.sleep(2 ** (i + 1))
    raise err


def source_for(t): return 'era5' if t < SWITCH else 'gfs'


# ── the pictures
def read_png(path):
    from PIL import Image
    with Image.open(path) as im:
        if im.mode != 'L': raise ValueError(f'{path}: mode {im.mode}, not 8-bit grayscale')
        return np.array(im, dtype=np.uint8)


def png_bytes(arr):
    from PIL import Image
    b = io.BytesIO(); Image.fromarray(np.ascontiguousarray(arr, np.uint8), 'L').save(b, 'PNG', optimize=True)
    return b.getvalue()


def year_meta(y, arr, names):
    n = arr.shape[0]
    used = sorted({names[source_for(time_of(y, r))] for r in range(n)})
    return dict(rows=n, first=stamp(time_of(y, 0)), last=stamp(time_of(y, n - 1)),
                missing=int((arr == MISSING).all(axis=1).sum()), source=' then '.join(used))


def meta_doc(years):
    return dict(lat0=NORTH, lat1=SOUTH, lon0=WEST, lon1=EAST, deg=DEG, hours=HOURS, base=BASE, scale=SCALE,
                missing=MISSING, cols=COLS, nlat=NLAT, nlon=NLON,
                order='row = (t - Jan 1 00Z) / 6 h; column = i * nlon + j, i from lat0 (north) south, j from lon0 (west) east',
                years={str(y): years[y] for y in sorted(years)})


def update(end, root=sources.ROOT, out=None, cache=sources.CACHE, budget=BUDGET, era5=None, gfs=None, log=sources.log,
           first=FIRST_YEAR):
    """Fill research/ocean/pressure/ through the 18Z step of UTC day `end` (a date): every missing step since
    `first` (2016), oldest first, until `budget` seconds are spent. era5, gfs: the sources (made here when None: a source that
    can't be set up leaves its steps missing). Writes into `out` (default root) only the years that changed, and
    meta.json. Returns {year: year_meta}."""
    out = out or root
    old_meta = {}
    try: old_meta = sources.jload(os.path.join(root, DIR, 'meta.json')).get('years', {})
    except (FileNotFoundError, ValueError): pass
    arrs, changed, todo = {}, set(), []
    for y in range(first, end.year + 1):
        n = rows_through(y, end)
        if not n: continue
        path = os.path.join(root, DIR, f'{y}.png'); old = None
        if os.path.exists(path):
            try: old = read_png(path)
            except Exception as e: log(f'::warning::pressure {y}.png unreadable ({e}): left as it is'); continue
            if old.shape[1] != COLS:
                log(f'::warning::pressure {y}.png is {old.shape[1]} cells wide, the grid has {COLS}: left as it is'); continue
        rows = max(n, old.shape[0] if old is not None else 0)       # never shorter than what's written
        a = np.full((rows, COLS), MISSING, np.uint8)
        if old is not None: a[:old.shape[0]] = old
        if old is None or old.shape[0] < rows: changed.add(y)
        arrs[y] = a
        todo += [time_of(y, r) for r in range(n) if (a[r] == MISSING).all()]
    log(f'pressure: {len(todo)} steps to fetch' + (f' ({stamp(todo[0])} ... {stamp(todo[-1])})' if todo else ''))
    names = {'era5': ERA5_STORES[0][1], 'gfs': GFS_NAME}
    srcs = {}
    def src(kind):
        if kind not in srcs:
            try: srcs[kind] = (era5 or ERA5(cache)) if kind == 'era5' else (gfs or GFSAnalysis())
            except Exception as e:
                log(f'::warning::pressure: no {kind.upper()} ({type(e).__name__}: {e}); its steps stay missing'); srcs[kind] = None
            if srcs[kind] is not None: names[kind] = srcs[kind].name
        return srcs[kind]
    start, filled, i, said = time.time(), 0, 0, time.time()
    batch = {'era5': 120, 'gfs': 96}                     # a month of ERA5 chunks, 24 days of GFS steps between checks
    while i < len(todo):
        if time.time() - start > budget:
            log(f'::notice::pressure: time budget ({budget:.0f} s) spent; {len(todo) - i} steps left for the next run'); break
        kind = source_for(todo[i]); j = i
        while j < len(todo) and j - i < batch[kind] and source_for(todo[j]) == kind: j += 1
        s = src(kind)
        if s is not None:
            for t, hpa in s.rows(todo[i:j]).items():
                if hpa is None: continue
                y, r = row_of(t); arrs[y][r] = encode(hpa); changed.add(y); filled += 1
        i = j
        if time.time() - said > 60:
            said = time.time(); log(f'  pressure: through {stamp(todo[j - 1])}, {filled} steps filled in {said - start:.0f} s')
    for kind, s in srcs.items():
        if s is not None: log(f'pressure from {s.name}: {s.stats}')
    years = {int(k): v for k, v in old_meta.items()}
    os.makedirs(os.path.join(out, DIR), exist_ok=True)
    total = 0
    for y, a in sorted(arrs.items()):
        years[y] = year_meta(y, a, names) if (y in changed or str(y) not in old_meta) else old_meta[str(y)]
        if y in changed or os.path.abspath(out) != os.path.abspath(root):
            data = png_bytes(a); total += len(data)
            with open(os.path.join(out, DIR, f'{y}.png'), 'wb') as f: f.write(data)
    with open(os.path.join(out, DIR, 'meta.json'), 'w') as f: f.write(dump_meta(meta_doc(years)))
    log(f'pressure: {filled} steps filled in {time.time() - start:.0f} s; {sum(v["missing"] for v in years.values())} still missing; '
        f'{len(changed)} year(s) written ({total / 1e6:.1f} MB)')
    return years


def dump_meta(doc):
    """one line per year, so a day's update changes one line"""
    head = {k: v for k, v in doc.items() if k != 'years'}
    s = json.dumps(head, ensure_ascii=False)[:-1] + ',\n "years": {\n'
    s += ',\n'.join(f'  "{y}": {json.dumps(v, ensure_ascii=False)}' for y, v in doc['years'].items())
    return s + '\n }\n}\n'


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description='fill research/ocean/pressure/ through a day (default: yesterday, UTC)')
    ap.add_argument('--end', type=dt.date.fromisoformat, default=dt.datetime.now(UTC).date() - dt.timedelta(days=1))
    ap.add_argument('--out', default=None); ap.add_argument('--budget', type=float, default=BUDGET)
    a = ap.parse_args()
    update(a.end, out=a.out, budget=a.budget)
