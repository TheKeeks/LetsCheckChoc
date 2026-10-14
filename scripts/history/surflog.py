"""The crew's surf log, for the history update to fit the ratings model and the session statistics to (ratings.py).

The log lives in the site's Firestore (collection surf_logs). The update reads it with a Google service account that
may only read (role Cloud Datastore Viewer), whose JSON key is the repository secret SURFLOG_READ_KEY; the workflow
passes it in as an environment variable of the same name. Without it the update fits nothing and carries the
committed model and session files over as they are. By hand, an export from the site's Log (Export JSON or CSV)
does the same job:

  python3 scripts/history/update.py --log surflog-export.json

What the update keeps of each session: its time (Eastern, to the minute), the three ratings and their average as
the app computes it, the swell height and the tide the app saved with it. Never the notes, the photos or who
logged it: the files it writes are public, and keep every version.
"""
import csv, json, os, re, sys, urllib.parse, urllib.request
from decimal import Decimal, ROUND_HALF_UP

KEY_ENV = 'SURFLOG_READ_KEY'
SCOPE = 'https://www.googleapis.com/auth/datastore'
DOCS = 'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/surf_logs'
TS = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')


def log(*a): print(*a, file=sys.stderr, flush=True)


# ── Firestore ────────────────────────────────────────────────────────────────────────────────────────────────────
def value(v):
    """a Firestore REST value ({'stringValue': 'x'}, {'mapValue': {'fields': ...}}, ...) → plain Python"""
    if not isinstance(v, dict): return None
    if 'mapValue' in v: return {k: value(x) for k, x in (v['mapValue'].get('fields') or {}).items()}
    if 'arrayValue' in v: return [value(x) for x in (v['arrayValue'].get('values') or [])]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return float(v['doubleValue'])
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    return None                                   # null, bytes, references, places: nothing the log uses


def document(doc):
    """a Firestore REST document → the entry as the app sees it (with its document id when the entry has none)"""
    e = value({'mapValue': {'fields': doc.get('fields') or {}}})
    if not e.get('id'): e['id'] = (doc.get('name') or '').rsplit('/', 1)[-1]
    return e


def token(key):
    """an access token for the service account (key: its JSON key, parsed), allowed to read Firestore"""
    from google.oauth2 import service_account               # pip install google-auth requests (the workflow does)
    import google.auth.transport.requests
    creds = service_account.Credentials.from_service_account_info(key, scopes=[SCOPE])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def http_get(url, tok, timeout=60):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok, 'User-Agent': 'LetsCheckChoc history'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def fetch(key, get=http_get, tok=None):
    """every entry in surf_logs, page by page. key: the service account's JSON key (parsed); get(url, token) → the
    page's JSON (injected by the tests)"""
    tok = tok or token(key)
    base, page, out = DOCS.format(project=key['project_id']), None, []
    for _ in range(100):                                    # 300 a page: far more than the crew will ever log
        url = base + '?pageSize=300' + ('&pageToken=' + urllib.parse.quote(page, safe='') if page else '')
        d = get(url, tok)
        out += [document(doc) for doc in d.get('documents') or []]
        page = d.get('nextPageToken')
        if not page: return out
    raise RuntimeError('surf_logs: too many pages')


# ── sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────
def num(v):
    """a number (int, float or numeric string), else None: a missing value stays missing, never 0"""
    if isinstance(v, bool) or v is None or v == '': return None
    try: x = float(v)
    except (TypeError, ValueError): return None
    return x if x == x and abs(x) != float('inf') else None


def js_fixed1(x):
    """x to one decimal as JavaScript's toFixed(1) does (halves away from zero, on the exact binary value): the app's
    export writes each session's average rating that way, and the model was fitted to it"""
    return float(Decimal(x).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))


def rating(v):
    x = num(v)
    return x if x is not None and 0 <= x <= 10 else None


def sessions(entries):
    """the log's entries (from Firestore or the app's JSON export) → the sessions the update fits to, oldest first:
    {id, date ('YYYY-MM-DDTHH:MM', Eastern), size, windQuality, rideQuality, avg, swellH, tideH, tideRate}.
    An entry without a time or a full set of ratings is left out."""
    out = []
    for e in entries:
        if not isinstance(e, dict): continue
        ts, r = e.get('timestamp'), e.get('ratings') or {}
        if not isinstance(ts, str) or not TS.match(ts) or not isinstance(r, dict): continue
        s, w, rd = rating(r.get('size')), rating(r.get('windQuality')), rating(r.get('rideQuality'))
        if None in (s, w, rd): continue
        c = e.get('conditions') or {}
        sw, td = (c.get('swell') or {}) if isinstance(c, dict) else {}, (c.get('tide') or {}) if isinstance(c, dict) else {}
        out.append(dict(id=str(e.get('id') or ''), date=ts[:16], size=s, windQuality=w, rideQuality=rd,
                        avg=js_fixed1((s + w + rd) / 3), swellH=num(sw.get('height')), tideH=num(td.get('height')),
                        tideRate=num(td.get('rate'))))
    out.sort(key=lambda x: (x['date'], x['id']))          # by time, so an edit (which re-saves an entry) moves nothing
    return out


def csv_sessions(path):
    """the app's CSV export (Export CSV on the Log) → sessions(), as above. Its columns: id, date, size, windQuality,
    rideQuality, avg, notes, swellH, swellDir, swellPer, windSpd, windDir, tideH, tideRate, tideStage"""
    out = []
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            ts = r.get('date') or ''
            s, w, rd = rating(r.get('size')), rating(r.get('windQuality')), rating(r.get('rideQuality'))
            if not TS.match(ts) or None in (s, w, rd): continue
            out.append(dict(id=r.get('id') or '', date=ts[:16], size=s, windQuality=w, rideQuality=rd,
                            avg=num(r.get('avg')) if num(r.get('avg')) is not None else js_fixed1((s + w + rd) / 3),
                            swellH=num(r.get('swellH')), tideH=num(r.get('tideH')), tideRate=num(r.get('tideRate'))))
    out.sort(key=lambda x: (x['date'], x['id']))
    return out


def load(path=None, env=os.environ, get=http_get):
    """the sessions to fit to, and where they came from: an export (path), else Firestore with the key in the
    environment, else (None, why not)"""
    if path:
        if path.lower().endswith('.csv'): return csv_sessions(path), 'the export ' + os.path.basename(path)
        with open(path) as f: doc = json.load(f)
        return sessions(doc if isinstance(doc, list) else doc.get('entries') or []), 'the export ' + os.path.basename(path)
    raw = (env.get(KEY_ENV) or '').strip()
    if not raw: return None, f'no {KEY_ENV}: the surf log is not read'
    try: key = json.loads(raw)
    except ValueError: return None, f'{KEY_ENV} is not a service account key (JSON)'
    if not isinstance(key, dict) or not key.get('project_id') or not key.get('client_email'):
        return None, f'{KEY_ENV} is not a service account key (no project_id or client_email)'
    return sessions(fetch(key, get=get)), 'Firestore (surf_logs)'
