import json, sys, time, urllib.request, urllib.error, concurrent.futures as cf
src, cyc, conc = sys.argv[1], sys.argv[2], int(sys.argv[3])   # e.g. https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com 20261010/12z 2
d, h = cyc.split('/'); stamp = d + h[:2] + '0000'
def get(u, a=None, b=None):
    rq = urllib.request.Request(u, headers={'Range': f'bytes={a}-{b}'} if a is not None else {})
    try:
        return 200, urllib.request.urlopen(rq, timeout=90).read()
    except urllib.error.HTTPError as e:
        return e.code, (e.headers.get('Retry-After'), e.reason)
stats = {}
def step(s):
    base = f"{src}/{d}/{h}/ifs/0p25/wave/{stamp}-{s}h-wave-fc"
    code, body = get(base + '.index'); stats[code] = stats.get(code, 0) + 1
    if code != 200: return
    idx = [json.loads(l) for l in body.decode().splitlines()]
    for k in ['swh', 'mwd', 'pp1d']:
        e = next(x for x in idx if x['param'] == k)
        code, body = get(base + '.grib2', e['_offset'], e['_offset'] + e['_length'] - 1)
        stats[code] = stats.get(code, 0) + 1
        if code != 200: print(s, k, code, body, flush=True)
t = time.time()
with cf.ThreadPoolExecutor(conc) as ex: list(ex.map(step, list(range(0, 49, 3))))
print(src.split('/')[2], cyc, 'conc', conc, stats, round(time.time() - t, 1), 's')
