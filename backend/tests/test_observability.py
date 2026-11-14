"""Request IDs, structured request logs and the health endpoint (NFR-05)."""
import json
import logging

import pytest

from config.request_log import JsonFormatter, RequestIDFilter

pytestmark = pytest.mark.django_db


def test_every_response_carries_a_request_id(api):
    r = api.get("/health/")
    assert len(r["X-Request-ID"]) >= 8


def test_a_safe_incoming_id_is_kept_and_an_unsafe_one_is_replaced(api):
    assert api.get("/health/", HTTP_X_REQUEST_ID="abc-12345-xyz")["X-Request-ID"] == "abc-12345-xyz"
    evil = api.get("/health/", HTTP_X_REQUEST_ID="x\r\nSet-Cookie: a=b")["X-Request-ID"]
    assert "\n" not in evil and "Set-Cookie" not in evil


def test_requests_are_logged_with_id_status_and_no_query_string(api, caplog):
    with caplog.at_level(logging.INFO, logger="mpanko.request"):
        r = api.get("/api/v1/products/?search=secret-term", HTTP_X_REQUEST_ID="trace-0001-aaaa")
    rec = [x for x in caplog.records if x.name == "mpanko.request"][-1]
    assert rec.status == r.status_code and rec.path == "/api/v1/products/" and rec.method == "GET"
    assert "secret-term" not in rec.getMessage() and "secret-term" not in rec.path


def test_health_probes_are_not_logged_when_healthy(api, caplog):
    with caplog.at_level(logging.INFO, logger="mpanko.request"):
        api.get("/health/")
        api.get("/ready/")
    assert not [x for x in caplog.records if x.name == "mpanko.request"]


def test_slow_requests_are_flagged(api, caplog, monkeypatch):
    import config.request_log as rl

    monkeypatch.setattr(rl, "SLOW_MS", -1)
    with caplog.at_level(logging.INFO, logger="mpanko.request"):
        api.get("/api/v1/products/")
    rec = [x for x in caplog.records if x.name == "mpanko.request"][-1]
    assert rec.levelno == logging.WARNING and "(slow)" in rec.getMessage()


def test_json_log_lines_parse_and_carry_the_request_id():
    rec = logging.LogRecord("mpanko.request", logging.INFO, "f", 1, "GET /x 200 5ms", None, None)
    rec.status, rec.duration_ms = 200, 5
    RequestIDFilter().filter(rec)
    data = json.loads(JsonFormatter().format(rec))
    assert data["status"] == 200 and data["duration_ms"] == 5 and data["level"] == "INFO" and "request_id" in data


def test_health_reports_the_release_when_known(api, monkeypatch):
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "18ee551aaaaaaaaaaaa")
    assert api.get("/health/").json()["release"] == "18ee551aaaaa"
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA")
    assert "release" not in api.get("/health/").json()


def test_preflight_checks_https_redirect_and_log_format(settings):
    from apps.payments.preflight import check_core

    names = {r.name: r for r in check_core(offline=True)}
    assert "HTTPS redirect is on" in names and "Logs carry request IDs in JSON" in names


def test_wrong_password_message_is_plain_and_does_not_reveal_which_part_is_wrong(api):
    r = api.post("/api/v1/auth/login/", {"email": "nobody@example.com", "password": "nope-nope-1"}, format="json")
    assert r.status_code == 401
    assert "Email or password is wrong" in str(r.data) and "active account" not in str(r.data)
