#!/usr/bin/env python3
"""
canary.py — Upstream canary for LetsCheckChoc.

Run by .github/workflows/canary.yml every 6 hours. Probes each upstream the
site depends on, with the same requests app.js makes, and checks that the
answer holds real data, not just HTTP 200:

  - Open-Meteo marine (Choc forecast point) and forecast (beach wind point):
    168 hourly values
  - CO-OPS 8510719 tide predictions (hi/lo 240 h, 6-min 168 h): a non-empty
    predictions[] and no "error" (NOAA reports outages with HTTP 200)
  - NDBC 44097 .txt and .data_spec: newest row under 3 h old
  - data/buoy.json in the checkout: the pipeline ran under 6 h ago (GitHub's
    cron drops scheduled runs)

On failure it opens, or updates, ONE GitHub issue labelled `data-canary`
with a table of results; when everything passes again it comments and
closes that issue. It uses the workflow's GITHUB_TOKEN (issues: write).
Standard library only, so the workflow needs no pip install.

  python3 scripts/canary.py                      # probe, then open/update/close the issue
  python3 scripts/canary.py --dry-run            # probe and print; exit 1 if any check fails
  python3 scripts/canary.py --print-urls --date 2026-10-01
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from collections import namedtuple
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent

# Mirrors CONFIG.chocomount / CONFIG.api and the fetch* helpers in app.js.
# tests/e2e/scenarios/w4-canary-parity.js fails if these drift from what
# the page actually requests.
CHOC_FORECAST_POINT = (41.089152, -71.72105)   # forecastLat/Lon: marine forecast
CHOC_BEACH_POINT = (41.275693, -71.96331)      # lat/lon: wind forecast
TIDE_STATION = "8510719"
BUOY_ID = "44097"
MARINE_API = "https://marine-api.open-meteo.com/v1/marine"
WEATHER_API = "https://api.open-meteo.com/v1/forecast"
COOPS_API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
NDBC_BASE = "https://www.ndbc.noaa.gov/data/realtime2/"
MARINE_HOURLY = [
    "wave_height", "wave_direction", "wave_period",
    "swell_wave_height", "swell_wave_direction", "swell_wave_period", "swell_wave_peak_period",
    "wind_wave_height", "wind_wave_direction", "wind_wave_period",
    "secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period",
    "sea_surface_temperature",
]
MARINE_CURRENT = [
    "wave_height", "wave_direction", "wave_period",
    "swell_wave_height", "swell_wave_direction", "swell_wave_period",
    "wind_wave_height", "wind_wave_direction", "wind_wave_period",
    "sea_surface_temperature",
]
WIND_VARS = "wind_speed_10m,wind_direction_10m,wind_gusts_10m"
CREW_TZ = ZoneInfo("America/New_York")  # CO-OPS begin_date is the crew's local date

HOURS = 168                 # forecast_days=7
MAX_MISSING = 8             # nulls tolerated per series (a model's horizon can end early)
NDBC_MAX_AGE = timedelta(hours=3)
BUOY_JSON_MAX_AGE = timedelta(hours=6)
RETRY_DELAY_S = 30          # failing checks are retried once, to ride out blips
TIMEOUT_S = 20

LABEL = "data-canary"
MARKER_RE = re.compile(r"<!-- canary-failing: ([\w,.-]*) -->")
USER_AGENT = "LetsCheckChoc-canary (+https://github.com/{})"

Probe = namedtuple("Probe", "key name url check impact")
Result = namedtuple("Result", "key name ok detail impact")
Action = namedtuple("Action", "kind issue title body comment")  # kind: none | open | update | close


# ── Requests (same query strings as app.js) ─────────────────────────────

def marine_url():
    lat, lon = CHOC_FORECAST_POINT
    return MARINE_API + "?" + urlencode([
        ("latitude", lat), ("longitude", lon),
        ("hourly", ",".join(MARINE_HOURLY)), ("current", ",".join(MARINE_CURRENT)),
        ("length_unit", "imperial"), ("temperature_unit", "fahrenheit"),
        ("timezone", "auto"), ("forecast_days", 7),
    ])


def wind_url():
    lat, lon = CHOC_BEACH_POINT
    return WEATHER_API + "?" + urlencode([
        ("latitude", lat), ("longitude", lon), ("hourly", WIND_VARS), ("current", WIND_VARS),
        ("wind_speed_unit", "mph"), ("timezone", "auto"), ("forecast_days", 7),
    ])


def tides_url(local_day, interval, range_hours):
    return COOPS_API + "?" + urlencode([
        ("begin_date", local_day.strftime("%Y%m%d")), ("range", range_hours),
        ("station", TIDE_STATION), ("product", "predictions"), ("datum", "MLLW"),
        ("units", "english"), ("time_zone", "lst_ldt"), ("interval", interval),
        ("application", "letscheckchoc"), ("format", "json"),
    ])


# ── Checks: (body text, now) -> (ok, detail) ────────────────────────────

def check_hourly(keys):
    def check(body, now):
        data = json.loads(body)
        if data.get("error"):
            return False, f"API error: {data.get('reason')}"
        hourly = data.get("hourly") or {}
        n = len(hourly.get("time") or [])
        if n < HOURS:
            return False, f"{n} hourly values, expected {HOURS}"
        short = []
        for k in keys:
            got = sum(v is not None for v in (hourly.get(k) or [])[:HOURS])
            if got < HOURS - MAX_MISSING:
                short.append(f"{k} {got}/{HOURS}")
        if short:
            return False, "too many missing values: " + ", ".join(short)
        return True, f"{n} hourly values"
    return check


def check_tides(body, now):
    data = json.loads(body)
    if "error" in data:
        return False, "NOAA error: " + str((data["error"] or {}).get("message", data["error"]))
    preds = data.get("predictions") or []
    if not preds:
        return False, "empty predictions[]"
    return True, f"{len(preds)} predictions from {preds[0].get('t')}"


def ndbc_newest(text):
    """UTC time of the first data row of an NDBC realtime2 file, or None."""
    for line in text.split("\n"):
        cols = line.split()
        if line.startswith("#") or len(cols) < 5:
            continue
        try:
            return datetime(*(int(c) for c in cols[:5]), tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _age(td):
    return f"{td.total_seconds() / 3600:.1f} h"


def check_ndbc_fresh(body, now):
    newest = ndbc_newest(body)
    if newest is None:
        return False, "no data rows (error page?)"
    age = now - newest
    detail = f"newest row {newest:%Y-%m-%d %H:%M} UTC, {_age(age)} old"
    return age <= NDBC_MAX_AGE, detail


def check_buoy_json(body, now):
    data = json.loads(body)
    ran = datetime.fromisoformat(data["fetch_time"])
    age = now - ran
    detail = f"pipeline last ran {_age(age)} ago; buoy obs {(data.get('buoy') or {}).get('time')}"
    if data.get("stale_sections"):
        detail += f"; carried over: {', '.join(data['stale_sections'])}"
    return age <= BUOY_JSON_MAX_AGE, detail


def build_probes(now):
    local_day = now.astimezone(CREW_TZ).date()
    return [
        Probe("marine", "Open-Meteo marine (Choc forecast point)", marine_url(),
              check_hourly(["wave_height", "swell_wave_height", "swell_wave_period", "swell_wave_direction"]),
              "No swell forecast: the forecast chart, swell cards and Choc TV day cards go blank."),
        Probe("wind", "Open-Meteo wind (Choc beach)", wind_url(),
              check_hourly(["wind_speed_10m", "wind_direction_10m"]),
              "No wind forecast: offshore/onshore calls and the wind panel go blank."),
        Probe("tides-hilo", f"CO-OPS {TIDE_STATION} tide highs/lows (240 h)", tides_url(local_day, "hilo", 240),
              check_tides, "No tide highs/lows: Choc TV's LOW @ times and the incoming-tide windows disappear."),
        Probe("tides-6min", f"CO-OPS {TIDE_STATION} tide curve (168 h)", tides_url(local_day, "6", 168),
              check_tides, "No tide curve on the forecast chart."),
        Probe("ndbc-txt", f"NDBC {BUOY_ID} buoy readings (.txt)", f"{NDBC_BASE}{BUOY_ID}.txt",
              check_ndbc_fresh, "The pipeline has no fresh buoy reading, so the Choc buoy card goes stale."),
        Probe("ndbc-data_spec", f"NDBC {BUOY_ID} spectrum (.data_spec)", f"{NDBC_BASE}{BUOY_ID}.data_spec",
              check_ndbc_fresh, "No fresh spectrum: the compass rose and 8 s+ swell band go stale."),
        Probe("buoy-json", "data/buoy.json (pipeline bot)", "data/buoy.json",
              check_buoy_json, "The buoy card and spectrum the crew see are hours old: GitHub skipped "
                               "the scheduled update-buoy runs, or they failed."),
    ]


# ── Running probes ──────────────────────────────────────────────────────

def get_text(url):
    """GET an http(s) URL, or read a repo-relative path from the checkout."""
    if not url.startswith("http"):
        return (REPO_ROOT / url).read_text()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT.format(os.environ.get("GITHUB_REPOSITORY", ""))})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return resp.read().decode("utf-8", "replace")


def probe_once(p, fetch, now):
    try:
        body = fetch(p.url)
    except HTTPError as e:
        return Result(p.key, p.name, False, f"HTTP {e.code}", p.impact)
    except Exception as e:
        return Result(p.key, p.name, False, f"request failed: {e}", p.impact)
    try:
        ok, detail = p.check(body, now)
    except Exception as e:
        ok, detail = False, f"unreadable answer: {type(e).__name__}: {e}"
    return Result(p.key, p.name, ok, detail, p.impact)


def run_probes(probes, fetch=get_text, now=None, sleep=time.sleep, retry_delay=RETRY_DELAY_S):
    """Every probe once, then each failing one again after retry_delay."""
    now = now or datetime.now(timezone.utc)
    results = [probe_once(p, fetch, now) for p in probes]
    if retry_delay and not all(r.ok for r in results):
        sleep(retry_delay)
        results = [r if r.ok else probe_once(p, fetch, now) for p, r in zip(probes, results)]
    return results


# ── Issue text and the open/update/close decision ───────────────────────

def _cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def render_report(results, now, run_url=None):
    failed = [r for r in results if not r.ok]
    lines = [f"**{len(failed)} of {len(results)} upstream checks failing** "
             f"(checked {now:%Y-%m-%d %H:%M} UTC)", "",
             "| Check | Result | Detail |", "|---|---|---|"]
    lines += [f"| {_cell(r.name)} | {'ok' if r.ok else '**FAIL**'} | {_cell(r.detail)} |" for r in results]
    if failed:
        lines += ["", "What the crew sees:"] + [f"- **{r.name}**: {r.impact}" for r in failed]
    lines += [""]
    if run_url:
        lines += [f"Run: {run_url}", ""]
    lines += ["Opened, updated and closed by `.github/workflows/canary.yml` (`scripts/canary.py`). "
              "It closes itself once every check passes.",
              f"<!-- canary-failing: {','.join(r.key for r in failed)} -->"]
    return "\n".join(lines)


def issue_title(results):
    return "Data canary: " + ", ".join(r.name for r in results if not r.ok) + " failing"


def failing_keys(issue_body):
    m = MARKER_RE.search(issue_body or "")
    return set(filter(None, m.group(1).split(","))) if m else set()


def decide(results, open_issue, report):
    """What to do with the data-canary issue, given this run's results and
    the currently open issue (a GitHub issue dict, or None)."""
    failing = {r.key for r in results if not r.ok}
    if not failing:
        if open_issue is None:
            return Action("none", None, None, None, None)
        return Action("close", open_issue["number"], None, None,
                      "All upstream checks pass again, closing.\n\n" + report)
    title = issue_title(results)
    if open_issue is None:
        return Action("open", None, title, report, None)
    # The body always shows the latest run; a comment (which notifies) is
    # only added when the set of failing checks changes.
    changed = failing != failing_keys(open_issue.get("body"))
    return Action("update", open_issue["number"], title, report,
                  ("The failing checks changed:\n\n" + report) if changed else None)


# ── GitHub REST API (GITHUB_TOKEN) ──────────────────────────────────────

class GitHub:
    def __init__(self, repo, token, api="https://api.github.com", urlopen=urllib.request.urlopen):
        self.repo, self.token, self.api, self.urlopen = repo, token, api, urlopen

    def call(self, method, path, payload=None, allow_404=False):
        req = urllib.request.Request(
            f"{self.api}/repos/{self.repo}{path}", method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {self.token}",
                     "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json",
                     "User-Agent": USER_AGENT.format(self.repo)})
        try:
            with self.urlopen(req, timeout=TIMEOUT_S) as resp:
                body = resp.read()
        except HTTPError as e:
            if allow_404 and e.code == 404:
                return None
            raise
        return json.loads(body) if body else None

    def find_open_issue(self):
        issues = self.call("GET", f"/issues?state=open&labels={LABEL}&sort=created&direction=asc&per_page=20") or []
        issues = [i for i in issues if "pull_request" not in i]
        return issues[0] if issues else None

    def ensure_label(self):
        if self.call("GET", f"/labels/{LABEL}", allow_404=True) is None:
            self.call("POST", "/labels", {"name": LABEL, "color": "d93f0b",
                                          "description": "Opened by the upstream data canary (scripts/canary.py)"})


def apply(action, gh):
    if action.kind == "open":
        gh.ensure_label()
        gh.call("POST", "/issues", {"title": action.title, "body": action.body, "labels": [LABEL]})
    elif action.kind == "update":
        gh.call("PATCH", f"/issues/{action.issue}", {"title": action.title, "body": action.body})
        if action.comment:
            gh.call("POST", f"/issues/{action.issue}/comments", {"body": action.comment})
    elif action.kind == "close":
        gh.call("POST", f"/issues/{action.issue}/comments", {"body": action.comment})
        gh.call("PATCH", f"/issues/{action.issue}", {"state": "closed", "state_reason": "completed"})


# ── Entry point ─────────────────────────────────────────────────────────

def main(argv=None, env=None, fetch=get_text, sleep=time.sleep, gh=None, now=None):
    env = os.environ if env is None else env
    ap = argparse.ArgumentParser(description="Probe LetsCheckChoc's upstreams.")
    ap.add_argument("--dry-run", action="store_true", help="probe and print only; exit 1 if any check fails")
    ap.add_argument("--print-urls", action="store_true", help="print the probe URLs as JSON and exit")
    ap.add_argument("--date", type=date.fromisoformat, help="with --print-urls: the crew's local date")
    args = ap.parse_args(argv)
    now = now or datetime.now(timezone.utc)

    if args.print_urls:
        at = datetime.combine(args.date, datetime.min.time().replace(hour=12), CREW_TZ) if args.date else now
        print(json.dumps({p.key: p.url for p in build_probes(at) if p.url.startswith("http")}, indent=2))
        return 0

    results = run_probes(build_probes(now), fetch, now, sleep)
    run_url = None
    if env.get("GITHUB_RUN_ID"):
        run_url = f"{env.get('GITHUB_SERVER_URL', 'https://github.com')}/{env.get('GITHUB_REPOSITORY')}/actions/runs/{env['GITHUB_RUN_ID']}"
    report = render_report(results, now, run_url)
    print(report)
    if env.get("GITHUB_STEP_SUMMARY"):
        with open(env["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(report + "\n")
    for r in results:
        if not r.ok:
            print(f"::warning title=Canary: {r.name}::{r.detail}")
    if args.dry_run:
        return 0 if all(r.ok for r in results) else 1

    if gh is None:
        if not env.get("GITHUB_TOKEN") or not env.get("GITHUB_REPOSITORY"):
            print("::error::GITHUB_TOKEN and GITHUB_REPOSITORY are required (use --dry-run locally)")
            return 1
        gh = GitHub(env["GITHUB_REPOSITORY"], env["GITHUB_TOKEN"])
    try:
        action = decide(results, gh.find_open_issue(), report)
        apply(action, gh)
    except Exception as e:
        # Fail the run so GitHub's failed-workflow email still reaches the owner.
        print(f"::error title=Canary could not update its issue::{type(e).__name__}: {e}")
        return 1
    print(f"data-canary issue: {action.kind}" + (f" #{action.issue}" if action.issue else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
