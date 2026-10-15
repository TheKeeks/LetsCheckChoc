"""Downloads for the daily history update, kept in one cache folder so each run fetches only what changed.

  python3 scripts/history/sources.py [CACHE]       fetch everything (update.py does this first)

CACHE is HISTORY_CACHE or history-cache/ at the repo root (git-ignored); the workflow keeps it between runs.

  cdip/154p1_historic.nc     CDIP 154 (= NDBC 44097) spectra archive, about 750 MB: fetched again only when CDIP
                             updates it (every month or two)
  cdip/154p1_rt.nc           the spectra since the archive's last update, every run
  ndbc/44097h<Y>.txt         44097's half-hourly readings for a finished year, kept once NDBC publishes it
  ndbc/44097_<Y>_<MM>.txt    one month of a year NDBC hasn't published yet, kept once NDBC publishes the month
  ndbc/44097_<Y>_<MM>p.txt   that month before then (NDBC's provisional file), every run
  ndbc/44097_realtime.txt    the last 45 days, every run
  ndbc17/44017h<Y>.txt       Montauk 44017, 2016-2023 (fills 44097's gaps; the buoy was retired in 2023)
  tides/hilo_<Y>.json        Silver Eel Pond (CO-OPS 8510719) highs and lows, one file per year
  wind/sea.json              ERA5 at the over-water cell 41.25 N 72.00 W, hourly since 2016 (Eastern time), every run
  wind/ifs1.json, ifs2.json  ECMWF IFS daily means at the 20-point wind grid since 2017, every run
  wind/era16.json            ERA5 daily means at the same points for 2016

A download that fails keeps the copy already in the cache (an older one is better than none); one that fails
with nothing in the cache stops the update, so the history on the site stays as it was.
"""
import json, os, sys, time, shutil, urllib.request, urllib.error, datetime as dt

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CACHE = os.environ.get('HISTORY_CACHE') or os.path.join(ROOT, 'history-cache')
FIRST_YEAR = 2016
UA = {'User-Agent': 'LetsCheckChoc history (github.com/TheKeeks/LetsCheckChoc)'}

CDIP = 'https://thredds.cdip.ucsd.edu/thredds/fileServer/cdip/'
CDIP_HIST = CDIP + 'archive/154p1/154p1_historic.nc'
CDIP_RT = CDIP + 'realtime/154p1_rt.nc'
NDBC = 'https://www.ndbc.noaa.gov/'
YEARLY = NDBC + 'view_text_file.php?filename={st}h{y}.txt.gz&dir=data/historical/stdmet/'
MONTHLY = NDBC + 'view_text_file.php?filename={st}{code}{y}.txt.gz&dir=data/stdmet/{mon}/'
PROVISIONAL = NDBC + 'data/stdmet/{mon}/{st}.txt'
REALTIME = NDBC + 'data/realtime2/{st}.txt'
MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
TIDES = ('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=LetsCheckChoc'
         '&begin_date={y}0101&end_date={y}1231&datum=MLLW&station=8510719&time_zone=lst_ldt&units=english&interval=hilo&format=json')
OM = 'https://archive-api.open-meteo.com/v1/archive?'
SEA = OM + ('latitude=41.27&longitude=-71.96&hourly=wind_speed_10m,wind_direction_10m&models=era5&cell_selection=sea'
            '&start_date=2016-01-01&end_date={end}&timezone=America%2FNew_York&wind_speed_unit=kn')
GRID = OM + ('latitude={lats}&longitude={lons}&daily=wind_speed_10m_mean,wind_direction_10m_dominant&models={model}'
             '&start_date={start}&end_date={end}&timezone=America%2FNew_York&wind_speed_unit=kn')
# the wind grid: 4 rows x 5 columns over the sound and the shelf south of it (the map's wind arrows)
GRID_LATS = [40.75, 40.977, 41.203, 41.43]
GRID_LONS = [-72.12, -71.84, -71.56, -71.28, -71.0]


def log(*a): print(*a, file=sys.stderr, flush=True)


def jload(path):
    with open(path) as f: return json.load(f)


def get(url, timeout=180, tries=4, method='GET'):
    """the response (bytes, headers), retried with backoff; raises the last error"""
    err = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method=method), timeout=timeout) as r:
                return (r.read() if method == 'GET' else b''), r.headers
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 403, 404): break          # won't change on a retry
        except Exception as e:                            # network trouble: try again
            err = e
        if i + 1 < tries: time.sleep(2 ** (i + 1))
    raise err


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.part'
    with open(tmp, 'wb') as f: f.write(data)
    os.replace(tmp, path)


def is_stdmet(data):
    """an NDBC stdmet file: its '#YY' header and at least one reading (NDBC answers a missing file with a short
    'Unable to access data file' page, status 200)"""
    t = data.decode('latin-1', 'replace')
    return t.startswith('#YY') and any(line[:1].isdigit() for line in t.splitlines()[2:4])


def fetch(path, url, keep=False, valid=None, need=True):
    """Download url to path. keep: a copy in the cache is final, don't fetch it again. A failed or invalid download
    keeps the cached copy; with none, raises when need, else returns False."""
    if keep and os.path.exists(path): return True
    try:
        data, _ = get(url)
        if valid and not valid(data): raise ValueError('not the expected file')
        save(path, data)
        return True
    except Exception as e:
        if os.path.exists(path):
            log(f'  kept the cached {os.path.relpath(path, CACHE)} ({e})'); return True
        if need: raise RuntimeError(f'{url}: {e}')
        return False


def fetch_cdip(cache):
    """the archive when CDIP has changed it (by its size and date), and the recent file every run"""
    path = os.path.join(cache, 'cdip', '154p1_historic.nc'); meta = path + '.json'
    _, h = get(CDIP_HIST, method='HEAD')
    stamp = dict(size=int(h.get('Content-Length') or 0), modified=h.get('Last-Modified'))
    old = jload(meta) if os.path.exists(meta) else None
    if old != stamp or not os.path.exists(path) or os.path.getsize(path) != stamp['size']:
        log(f'  CDIP archive changed ({old} -> {stamp}): downloading')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.part'
        with urllib.request.urlopen(urllib.request.Request(CDIP_HIST, headers=UA), timeout=600) as r, open(tmp, 'wb') as f:
            shutil.copyfileobj(r, f, 1 << 22)
        if os.path.getsize(tmp) != stamp['size']: raise RuntimeError('CDIP archive download cut short')
        os.replace(tmp, path)
        with open(meta, 'w') as f: json.dump(stamp, f)
    fetch(os.path.join(cache, 'cdip', '154p1_rt.nc'), CDIP_RT, valid=lambda d: d[:3] == b'CDF')


def month_code(m): return str(m) if m < 10 else 'abc'[m - 10]


def fetch_ndbc(cache, today):
    d = os.path.join(cache, 'ndbc')
    for y in range(FIRST_YEAR, today.year + 1):
        if y < today.year and fetch(os.path.join(d, f'44097h{y}.txt'), YEARLY.format(st='44097', y=y), keep=True, valid=is_stdmet, need=False):
            continue
        # a year NDBC hasn't published as one file yet: its months
        for m in range(1, 13):
            if (y, m) >= (today.year, today.month): break
            final = os.path.join(d, f'44097_{y}_{m:02d}.txt')
            ok = False
            for code in dict.fromkeys((month_code(m), str(m))):   # NDBC names Oct-Dec a, b, c
                ok = ok or fetch(final, MONTHLY.format(st='44097', code=code, y=y, mon=MON[m - 1]), keep=True, valid=is_stdmet, need=False)
            prov = os.path.join(d, f'44097_{y}_{m:02d}p.txt')
            if ok:
                if os.path.exists(prov): os.remove(prov)
            else:
                fetch(prov, PROVISIONAL.format(st='44097', mon=MON[m - 1]), valid=is_stdmet, need=False)
    fetch(os.path.join(d, '44097_realtime.txt'), REALTIME.format(st='44097'), valid=is_stdmet)
    for y in range(FIRST_YEAR, 2024):
        fetch(os.path.join(cache, 'ndbc17', f'44017h{y}.txt'), YEARLY.format(st='44017', y=y), keep=True, valid=is_stdmet)


def fetch_tides(cache, today):
    def ok(data):
        try: return bool(json.loads(data).get('predictions'))
        except ValueError: return False
    for y in range(FIRST_YEAR, today.year + 2):
        fetch(os.path.join(cache, 'tides', f'hilo_{y}.json'), TIDES.format(y=y), keep=True, valid=ok, need=y <= today.year)


def fetch_wind(cache, today):
    end = today.isoformat()                       # Open-Meteo's archive takes dates up to today
    def hourly(data):
        try: return 'hourly' in json.loads(data)
        except ValueError: return False
    def points(n):
        def ok(data):
            try: v = json.loads(data); return isinstance(v, list) and len(v) == n and all('daily' in p for p in v)
            except ValueError: return False
        return ok
    w = os.path.join(cache, 'wind')
    fetch(os.path.join(w, 'sea.json'), SEA.format(end=end), valid=hourly)
    lats = [la for la in GRID_LATS for _ in GRID_LONS]; lons = [lo for _ in GRID_LATS for lo in GRID_LONS]
    j = lambda v: ','.join(map(str, v))
    for part, s in (('ifs1', slice(0, 10)), ('ifs2', slice(10, 20))):
        fetch(os.path.join(w, part + '.json'), GRID.format(lats=j(lats[s]), lons=j(lons[s]), model='ecmwf_ifs', start='2017-01-01', end=end), valid=points(10))
    fetch(os.path.join(w, 'era16.json'), GRID.format(lats=j(lats), lons=j(lons), model='era5', start='2016-01-01', end='2016-12-31'),
          keep=True, valid=points(20))


def fetch_all(cache=CACHE, today=None):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    for name, fn in (('CDIP spectra', fetch_cdip), ('NDBC readings', fetch_ndbc), ('tides', fetch_tides), ('wind', fetch_wind)):
        log('fetching', name)
        fn(cache) if fn is fetch_cdip else fn(cache, today)


def stdmet_files(cache):
    """44097's files in order of precedence: finished years, then months (NDBC's file, else its provisional one),
    then the last 45 days (newest first, as NDBC serves it)"""
    d = os.path.join(cache, 'ndbc')
    names = sorted(os.listdir(d)) if os.path.isdir(d) else []
    years = sorted(n for n in names if n.startswith('44097h'))
    months = sorted(n for n in names if n.startswith('44097_') and n[6:10].isdigit() and not n.endswith('p.txt'))
    prov = sorted(n for n in names if n.endswith('p.txt') and n.replace('p.txt', '.txt') not in months)
    return [os.path.join(d, n) for n in years + months + prov] + ([os.path.join(d, '44097_realtime.txt')] if '44097_realtime.txt' in names else [])


def load(cache=CACHE):
    """everything update.py reads, from the cache"""
    def rd(p):
        with open(p, encoding='latin-1') as f: return f.read()
    j = lambda *p: jload(os.path.join(cache, *p))
    d17 = os.path.join(cache, 'ndbc17'); dt_ = os.path.join(cache, 'tides'); sea = j('wind', 'sea.json')
    return dict(
        historic=os.path.join(cache, 'cdip', '154p1_historic.nc'), realtime=os.path.join(cache, 'cdip', '154p1_rt.nc'),
        f44097=[rd(p) for p in stdmet_files(cache)],
        f44017=[rd(os.path.join(d17, n)) for n in sorted(os.listdir(d17))] if os.path.isdir(d17) else [],
        hilo=[jload(os.path.join(dt_, n)) for n in sorted(os.listdir(dt_)) if n.endswith('.json')],
        sea=sea['hourly'], sea_offset=sea.get('utc_offset_seconds'), ifs=j('wind', 'ifs1.json') + j('wind', 'ifs2.json'), era16=j('wind', 'era16.json'))


if __name__ == '__main__':
    fetch_all(sys.argv[1] if len(sys.argv) > 1 else CACHE)
