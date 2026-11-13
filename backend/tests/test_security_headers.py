import pytest

pytestmark = pytest.mark.django_db


def test_api_responses_carry_security_headers(api):
    r = api.get("/api/v1/products/")
    assert r.status_code == 200
    assert r["Content-Security-Policy"] == "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    assert "camera=()" in r["Permissions-Policy"]
    assert r["X-Content-Type-Options"] == "nosniff"
    assert r["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert r["Cross-Origin-Opener-Policy"] == "same-origin"
    assert r["X-Frame-Options"] == "DENY"
    assert r["Cross-Origin-Resource-Policy"] == "same-site"


def test_errors_carry_them_too(api):
    r = api.get("/api/v1/does-not-exist/")
    assert r.status_code == 404 and "Content-Security-Policy" in r


def test_api_docs_keep_their_own_policy(api):
    pytest.importorskip("drf_spectacular")
    r = api.get("/api/v1/docs/")
    assert r.status_code == 200
    assert "default-src 'none'" not in r.get("Content-Security-Policy", "")
