"""Offline tests for scripts/canary.py (the upstream data canary).

Run: npm run test:py

Every probe answer comes from tests/fixtures (recorded 2026-10-01) and the
GitHub API is a recording fake, so nothing touches the network, the repo's
data/*.json or a real issue tracker.
"""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError

SCRIPTS_DIR = Path(__file__).resolve().parent
FIXTURES = SCRIPTS_DIR.parent / "tests" / "fixtures"
UTC = timezone.utc
NOW = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)   # fixture instant (11:00 EDT)


def load_canary():
    spec = importlib.util.spec_from_file_location("canary_under_test", SCRIPTS_DIR / "canary.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


canary = load_canary()


def fx(rel):
    return (FIXTURES / rel).read_text()


def fixture_fetch(overrides=None):
    """Answers each probe URL from the recordings; overrides map a URL
    substring to a body string, or to an exception to raise."""
    routes = [
        ("marine-api.open-meteo.com", "open-meteo/marine.json"),
        ("api.open-meteo.com/v1/forecast", "open-meteo/wind.json"),
        ("interval=hilo", "coops/hilo-240h.json"),
        ("interval=6&", "coops/predictions-6min-168h.json"),
        ("44097.txt", "ndbc/44097.txt"),
        ("44097.data_spec", "ndbc/44097.data_spec"),
        ("data/buoy.json", "pipeline/buoy.json"),
    ]

    def fetch(url):
        for needle, answer in (overrides or {}).items():
            if needle in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        for needle, rel in routes:
            if needle in url:
                return fx(rel)
        raise AssertionError(f"unrouted probe URL {url}")
    return fetch


def results_for(overrides=None, now=NOW):
    return canary.run_probes(canary.build_probes(now), fixture_fetch(overrides), now, sleep=lambda s: None)


class FakeGitHub:
    """Records API calls; serves one optional open issue."""

    def __init__(self, open_issue=None, label_exists=True, fail=None):
        self.open_issue, self.label_exists, self.fail = open_issue, label_exists, fail
        self.calls = []

    def find_open_issue(self):
        if self.fail:
            raise self.fail
        return self.open_issue

    def ensure_label(self):
        self.calls.append(("ensure_label",))

    def call(self, method, path, payload=None, allow_404=False):
        self.calls.append((method, path, payload))
        return {}


def http_error(code):
    return HTTPError("https://example.test", code, "err", {}, io.BytesIO(b""))


class Checks(unittest.TestCase):
    """Each check wants real data, not just HTTP 200."""

    def test_open_meteo_needs_168_hourly_values(self):
        check = canary.check_hourly(["wave_height", "swell_wave_height"])
        self.assertEqual(check(fx("open-meteo/marine.json"), NOW), (True, "168 hourly values"))
        short = json.loads(fx("open-meteo/marine.json"))
        short["hourly"] = {k: v[:100] for k, v in short["hourly"].items()}
        self.assertEqual(check(json.dumps(short), NOW), (False, "100 hourly values, expected 168"))
        holes = json.loads(fx("open-meteo/marine.json"))
        holes["hourly"]["swell_wave_height"][:20] = [None] * 20
        ok, detail = check(json.dumps(holes), NOW)
        self.assertFalse(ok)
        self.assertIn("swell_wave_height 148/168", detail)
        ok, detail = check(fx("open-meteo/error-invalid-model.json"), NOW)
        self.assertFalse(ok)
        self.assertIn("API error", detail)

    def test_coops_needs_predictions_and_no_error(self):
        self.assertTrue(canary.check_tides(fx("coops/hilo-240h.json"), NOW)[0])
        ok, detail = canary.check_tides(fx("coops/error-no-predictions.json"), NOW)
        self.assertFalse(ok, "NOAA's outage answer is HTTP 200")
        self.assertIn("No Predictions data was found", detail)
        self.assertEqual(canary.check_tides('{"predictions": []}', NOW), (False, "empty predictions[]"))

    def test_ndbc_newest_row_under_3_hours(self):
        txt = fx("ndbc/44097.txt")   # newest row 14:00 UTC
        self.assertTrue(canary.check_ndbc_fresh(txt, NOW)[0])
        self.assertTrue(canary.check_ndbc_fresh(txt, datetime(2026, 10, 1, 17, 0, tzinfo=UTC))[0])
        ok, detail = canary.check_ndbc_fresh(txt, datetime(2026, 10, 1, 17, 1, tzinfo=UTC))
        self.assertFalse(ok)
        self.assertIn("2026-10-01 14:00 UTC, 3.0 h old", detail)
        self.assertEqual(canary.check_ndbc_fresh("<html><body>503</body></html>", NOW),
                         (False, "no data rows (error page?)"))

    def test_buoy_json_pipeline_under_6_hours(self):
        body = fx("pipeline/buoy.json")   # fetch_time 13:15:38 UTC
        self.assertTrue(canary.check_buoy_json(body, NOW)[0])
        ok, detail = canary.check_buoy_json(body, datetime(2026, 10, 1, 19, 20, tzinfo=UTC))
        self.assertFalse(ok, "GitHub dropped the update-buoy runs")
        self.assertIn("pipeline last ran 6.1 h ago; buoy obs 2026-10-01 12:30 UTC", detail)
        stale = json.loads(body)
        stale["stale_sections"] = ["spectral_bins"]
        self.assertIn("carried over: spectral_bins", canary.check_buoy_json(json.dumps(stale), NOW)[1])


class Probes(unittest.TestCase):
    def test_the_seven_probes_and_their_urls(self):
        probes = canary.build_probes(NOW)
        self.assertEqual([p.key for p in probes],
                         ["marine", "wind", "tides-hilo", "tides-6min", "ndbc-txt", "ndbc-data_spec", "buoy-json"])
        self.assertTrue(all(r.ok for r in results_for()), results_for())

    def test_tide_begin_date_is_the_crews_local_date(self):
        late_evening = datetime(2026, 10, 2, 2, 0, tzinfo=UTC)   # 22:00 EDT on 10-01
        urls = {p.key: p.url for p in canary.build_probes(late_evening)}
        self.assertIn("begin_date=20261001&range=240&", urls["tides-hilo"])
        self.assertIn("begin_date=20261001&range=168&", urls["tides-6min"])

    def test_failures_are_retried_once(self):
        answers = {"44097.txt": [http_error(503), fx("ndbc/44097.txt")]}
        sleeps = []

        def fetch(url):
            for needle, queue in answers.items():
                if needle in url:
                    a = queue.pop(0)
                    if isinstance(a, Exception):
                        raise a
                    return a
            return fixture_fetch()(url)
        results = canary.run_probes(canary.build_probes(NOW), fetch, NOW, sleep=sleeps.append)
        self.assertTrue(all(r.ok for r in results), "a one-off blip does not open an issue")
        self.assertEqual(sleeps, [canary.RETRY_DELAY_S])

        sleeps.clear()
        canary.run_probes(canary.build_probes(NOW), fixture_fetch(), NOW, sleep=sleeps.append)
        self.assertEqual(sleeps, [], "no retry pause when everything passes")

    def test_request_errors_become_failed_results(self):
        r = {x.key: x for x in results_for({"44097.txt": http_error(503), "44097.data_spec": OSError("timed out"),
                                            "interval=hilo": "not json"})}
        self.assertEqual((r["ndbc-txt"].ok, r["ndbc-txt"].detail), (False, "HTTP 503"))
        self.assertEqual(r["ndbc-data_spec"].detail, "request failed: timed out")
        self.assertFalse(r["tides-hilo"].ok)
        self.assertTrue(r["tides-hilo"].detail.startswith("unreadable answer: JSONDecodeError"))


class Decide(unittest.TestCase):
    def test_all_pass_and_no_issue_does_nothing(self):
        results = results_for()
        self.assertEqual(canary.decide(results, None, "report").kind, "none")

    def test_first_failure_opens_one_issue_with_a_table(self):
        results = results_for({"44097.txt": http_error(503)})
        report = canary.render_report(results, NOW, "https://github.com/o/r/actions/runs/1")
        action = canary.decide(results, None, report)
        self.assertEqual(action.kind, "open")
        self.assertEqual(action.title, "Data canary: NDBC 44097 buoy readings (.txt) failing")
        self.assertIn("**1 of 7 upstream checks failing** (checked 2026-10-01 15:00 UTC)", action.body)
        self.assertIn("| NDBC 44097 buoy readings (.txt) | **FAIL** | HTTP 503 |", action.body)
        self.assertIn("| Open-Meteo marine (Choc forecast point) | ok | 168 hourly values |", action.body)
        self.assertIn("Choc buoy card goes stale", action.body)
        self.assertIn("https://github.com/o/r/actions/runs/1", action.body)
        self.assertEqual(canary.failing_keys(action.body), {"ndbc-txt"})

    def test_same_failures_update_the_issue_quietly(self):
        results = results_for({"44097.txt": http_error(503)})
        issue = {"number": 7, "body": canary.render_report(results, NOW - timedelta(hours=6))}
        action = canary.decide(results, issue, canary.render_report(results, NOW))
        self.assertEqual((action.kind, action.issue, action.comment), ("update", 7, None))
        self.assertIn("(checked 2026-10-01 15:00 UTC)", action.body)

    def test_changed_failures_update_and_comment(self):
        before = results_for({"44097.txt": http_error(503)})
        issue = {"number": 7, "body": canary.render_report(before, NOW - timedelta(hours=6))}
        now = results_for({"44097.txt": http_error(503), "interval=hilo": fx("coops/error-no-predictions.json")})
        action = canary.decide(now, issue, canary.render_report(now, NOW))
        self.assertEqual(action.kind, "update")
        self.assertTrue(action.comment.startswith("The failing checks changed:"))
        self.assertEqual(canary.failing_keys(action.body), {"ndbc-txt", "tides-hilo"})

    def test_recovery_comments_and_closes(self):
        issue = {"number": 7, "body": canary.render_report(results_for({"44097.txt": http_error(503)}), NOW)}
        results = results_for()
        action = canary.decide(results, issue, canary.render_report(results, NOW))
        self.assertEqual((action.kind, action.issue), ("close", 7))
        self.assertTrue(action.comment.startswith("All upstream checks pass again"))


class ApplyAndGitHub(unittest.TestCase):
    def test_apply_maps_actions_to_api_calls(self):
        gh = FakeGitHub()
        canary.apply(canary.Action("open", None, "T", "B", None), gh)
        self.assertEqual(gh.calls, [("ensure_label",), ("POST", "/issues", {"title": "T", "body": "B", "labels": ["data-canary"]})])
        gh = FakeGitHub()
        canary.apply(canary.Action("update", 7, "T", "B", "C"), gh)
        self.assertEqual(gh.calls, [("PATCH", "/issues/7", {"title": "T", "body": "B"}),
                                    ("POST", "/issues/7/comments", {"body": "C"})])
        gh = FakeGitHub()
        canary.apply(canary.Action("close", 7, None, None, "C"), gh)
        self.assertEqual(gh.calls, [("POST", "/issues/7/comments", {"body": "C"}),
                                    ("PATCH", "/issues/7", {"state": "closed", "state_reason": "completed"})])
        gh = FakeGitHub()
        canary.apply(canary.Action("none", None, None, None, None), gh)
        self.assertEqual(gh.calls, [])

    def test_github_client_uses_the_workflow_token_and_one_label(self):
        sent = []

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def urlopen(req, timeout):
            sent.append((req.get_method(), req.full_url, req.get_header("Authorization"),
                         json.loads(req.data) if req.data else None))
            if req.full_url.endswith("/labels/data-canary"):
                raise http_error(404)
            if "/issues?" in req.full_url:
                return Resp(json.dumps([{"number": 3, "pull_request": {}}, {"number": 5}, {"number": 9}]).encode())
            return Resp(b"{}")

        gh = canary.GitHub("thekeeks/LetsCheckChoc", "tok", urlopen=urlopen)
        self.assertEqual(gh.find_open_issue()["number"], 5, "oldest open issue, never a PR")
        gh.ensure_label()
        self.assertEqual(sent[0][:3], ("GET", "https://api.github.com/repos/thekeeks/LetsCheckChoc/issues?state=open"
                                       "&labels=data-canary&sort=created&direction=asc&per_page=20", "Bearer tok"))
        self.assertEqual(sent[2][0:2], ("POST", "https://api.github.com/repos/thekeeks/LetsCheckChoc/labels"))
        self.assertEqual(sent[2][3]["name"], "data-canary")


class Main(unittest.TestCase):
    ENV = {"GITHUB_TOKEN": "tok", "GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "42"}

    def run_main(self, argv=(), overrides=None, gh=None, env=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = canary.main(list(argv), env=self.ENV if env is None else env, fetch=fixture_fetch(overrides),
                               sleep=lambda s: None, gh=gh, now=NOW)
        return code, out.getvalue()

    def test_healthy_run_touches_no_issue(self):
        gh = FakeGitHub()
        code, out = self.run_main(gh=gh)
        self.assertEqual((code, gh.calls), (0, []))
        self.assertIn("data-canary issue: none", out)

    def test_outage_opens_the_issue_and_the_run_stays_green(self):
        gh = FakeGitHub()
        code, out = self.run_main(overrides={"marine-api": http_error(503)}, gh=gh)
        self.assertEqual(code, 0, "the issue is the alert; a red run every 6 h would just repeat it")
        self.assertEqual(gh.calls[0], ("ensure_label",))
        self.assertIn("https://github.com/o/r/actions/runs/42", gh.calls[1][2]["body"])
        self.assertIn("::warning title=Canary: Open-Meteo marine (Choc forecast point)::HTTP 503", out)

    def test_recovery_closes_the_open_issue(self):
        gh = FakeGitHub(open_issue={"number": 4, "body": "<!-- canary-failing: marine -->"})
        code, _ = self.run_main(gh=gh)
        self.assertEqual(code, 0)
        self.assertEqual(gh.calls[-1], ("PATCH", "/issues/4", {"state": "closed", "state_reason": "completed"}))

    def test_github_api_failure_fails_the_run(self):
        code, out = self.run_main(overrides={"44097.txt": http_error(503)}, gh=FakeGitHub(fail=http_error(410)))
        self.assertEqual(code, 1, "GitHub's failed-run email is the fallback alert")
        self.assertIn("::error title=Canary could not update its issue::HTTPError", out)

    def test_dry_run_and_missing_token(self):
        self.assertEqual(self.run_main(["--dry-run"], env={})[0], 0)
        self.assertEqual(self.run_main(["--dry-run"], overrides={"44097.txt": http_error(503)}, env={})[0], 1)
        code, out = self.run_main(env={})
        self.assertEqual(code, 1)
        self.assertIn("GITHUB_TOKEN and GITHUB_REPOSITORY are required", out)

    def test_job_summary_gets_the_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = Path(tmp) / "summary.md"
            self.run_main(["--dry-run"], env={"GITHUB_STEP_SUMMARY": str(summary)})
            self.assertIn("| Check | Result | Detail |", summary.read_text())

    def test_print_urls_for_a_given_day(self):
        code, out = self.run_main(["--print-urls", "--date", "2026-10-01"], env={})
        urls = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(set(urls), {"marine", "wind", "tides-hilo", "tides-6min", "ndbc-txt", "ndbc-data_spec"})
        self.assertIn("begin_date=20261001", urls["tides-hilo"])


if __name__ == "__main__":
    unittest.main()
