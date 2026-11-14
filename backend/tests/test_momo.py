"""MTN MoMo adapter, mocked responses only (never run against a live MTN account)."""
import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from apps.payments.providers import InvalidSignature, ProviderError, get_provider
from apps.payments.providers_momo import msisdn, request_id

from .conftest import place_order

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def cfg(settings):
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock", "mtn_momo"]
    settings.MTN_MOMO_API_USER, settings.MTN_MOMO_API_KEY, settings.MTN_MOMO_SUBSCRIPTION_KEY = "u", "k", "s"
    settings.MTN_MOMO_BASE_URL, settings.MTN_MOMO_ENVIRONMENT, settings.MTN_MOMO_CURRENCY = "https://momo.test", "sandbox", "GHS"
    settings.API_PUBLIC_URL = "https://api.example.com"


def resp(status=200, data=None):
    r = MagicMock(status_code=status, ok=status < 400, content=b"x")
    r.json.return_value = data or {}
    return r


def test_phone_formatting_and_stable_request_id():
    assert msisdn("024 123 4567") == "233241234567"
    assert msisdn("+233241234567") == "233241234567"
    assert request_id("abc") == request_id("abc") != request_id("abd")


def test_only_offered_for_ghs():
    from rest_framework.test import APIClient

    ghs = {m["provider"] for m in APIClient().get("/api/v1/payments/methods/?currency=GHS").json()}
    usd = {m["provider"] for m in APIClient().get("/api/v1/payments/methods/?currency=USD").json()}
    assert "mtn_momo" in ghs and "mtn_momo" not in usd


def _attempt(phone="0241234567"):
    order = MagicMock(contact_phone=phone, number="MP-1")
    return MagicMock(order=order, reference="ref-1", amount=Decimal("25.00"))


def test_initiate_pushes_to_phone():
    calls = []

    def fake(method, url, what, **kw):
        calls.append((method, url, kw))
        return (resp(200, {"access_token": "t"}), {"access_token": "t"}) if url.endswith("/token/") else (resp(202), {})

    with patch("apps.payments.providers_momo._call", fake):
        out = get_provider("mtn_momo").initiate(_attempt(), "a@b.c", "")
    method, url, kw = calls[-1]
    assert url.endswith("/collection/v1_0/requesttopay")
    assert kw["json"]["payer"]["partyId"] == "233241234567" and kw["json"]["externalId"] == "ref-1"
    assert kw["headers"]["X-Reference-Id"] == request_id("ref-1")
    assert out["authorization_url"] == "" and out["raw"]["push"]


def test_initiate_rejects_missing_phone_and_bad_status():
    with pytest.raises(ProviderError):
        get_provider("mtn_momo").initiate(_attempt(phone=""), "a@b.c", "")

    def fake(method, url, what, **kw):
        return (resp(200), {"access_token": "t"}) if url.endswith("/token/") else (resp(500), {"message": "nope"})

    with patch("apps.payments.providers_momo._call", fake), pytest.raises(ProviderError):
        get_provider("mtn_momo").initiate(_attempt(), "a@b.c", "")


def _status_fake(body):
    def fake(method, url, what, **kw):
        if url.endswith("/token/"):
            return resp(200), {"access_token": "t"}
        return resp(200), body
    return fake


def test_verify_maps_statuses():
    p = get_provider("mtn_momo")
    for mtn, ours in [("SUCCESSFUL", "succeeded"), ("FAILED", "failed"), ("PENDING", "pending")]:
        with patch("apps.payments.providers_momo._call", _status_fake({"status": mtn, "amount": "25.00", "currency": "GHS", "financialTransactionId": "9"})):
            assert p.verify(_attempt()).status == ours


def test_callback_is_re_verified_with_mtn():
    p = get_provider("mtn_momo")
    body = json.dumps({"externalId": "ref-1", "status": "SUCCESSFUL"}).encode()
    with patch("apps.payments.providers_momo._call", _status_fake({"status": "FAILED", "amount": "25", "currency": "GHS"})):
        assert p.parse_webhook(body, {}).status == "failed"  # a forged "SUCCESSFUL" callback changes nothing
    with patch("apps.payments.providers_momo._call", _status_fake({})), pytest.raises(InvalidSignature):
        p.parse_webhook(body, {})
