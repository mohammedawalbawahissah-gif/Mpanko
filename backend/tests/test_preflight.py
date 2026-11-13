import io
import json

import pytest
from django.core.management import call_command

from apps.payments import preflight
from apps.payments.preflight import FAIL, PASS, SKIP, WARN

pytestmark = pytest.mark.django_db


def by_name(results):
    return {r.name: r for r in results}


def test_development_settings_are_flagged(settings):
    settings.DEBUG = True
    settings.SECRET_KEY = "dev-secret"  # do not depend on the developer's .env
    settings.FRONTEND_URL = "http://localhost:5173"
    r = by_name(preflight.check_core(offline=True))
    assert r["DEBUG is off"].level == FAIL
    assert r["SECRET_KEY is strong"].level == FAIL
    assert r["FRONTEND_URL uses https"].level == FAIL


def test_good_server_settings_pass(settings):
    settings.DEBUG = False
    settings.SECRET_KEY = "x" * 60
    settings.FRONTEND_URL = "https://shop.example.com"
    settings.ALLOWED_HOSTS = ["api.example.com"]
    settings.CORS_ALLOWED_ORIGINS = ["https://shop.example.com"]
    settings.MFA_ENCRYPTION_KEY = "k" * 40
    r = by_name(preflight.check_core(offline=True))
    for name in ("DEBUG is off", "SECRET_KEY is strong", "FRONTEND_URL uses https", "ALLOWED_HOSTS is tight", "CORS lists only your sites", "Staff two-step key is set"):
        assert r[name].level == PASS, name


def test_pending_migrations_are_reported(monkeypatch):
    from django.db.migrations import executor

    monkeypatch.setattr(executor.MigrationExecutor, "migration_plan", lambda self, targets: [("m", False)])
    r = by_name(preflight.check_core(offline=True))
    assert r["Database is up to date"].level == FAIL and "migrate" in r["Database is up to date"].fix


def test_mock_gateway_in_production_fails(settings):
    settings.DEBUG = False
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock"]
    res = preflight.check_payments(offline=True)
    assert any(r.name == "At least one real gateway" and r.level == FAIL for r in res)
    assert any(r.name == "Mock gateway is off" and r.level == FAIL for r in res)


def test_test_keys_and_missing_webhook_secret_fail(settings):
    settings.PAYMENT_PROVIDERS_ENABLED = ["stripe"]
    settings.STRIPE_SECRET_KEY = "sk_test_abc"
    settings.STRIPE_WEBHOOK_SECRET = ""
    r = by_name(preflight._provider_check("stripe", offline=True))
    assert r["Stripe uses live keys"].level == FAIL
    assert r["Stripe webhook secret"].level == FAIL
    assert r["Stripe accepts the keys"].level == SKIP


def test_live_keys_checked_against_the_gateway(settings, monkeypatch):
    settings.PAYMENT_PROVIDERS_ENABLED = ["paystack"]
    settings.PAYSTACK_SECRET_KEY = "sk_live_abc"
    calls = []

    class R:
        ok, status_code = True, 200

    monkeypatch.setattr(preflight.requests, "get", lambda url, **kw: (calls.append((url, kw["headers"])), R())[1])
    r = by_name(preflight._provider_check("paystack", offline=False))
    assert r["Paystack accepts the keys"].level == PASS
    assert calls[0][0] == "https://api.paystack.co/balance" and calls[0][1]["Authorization"] == "Bearer sk_live_abc"


def test_rejected_credentials_fail(settings, monkeypatch):
    settings.PAYMENT_PROVIDERS_ENABLED = ["flutterwave"]
    settings.FLUTTERWAVE_SECRET_KEY, settings.FLUTTERWAVE_WEBHOOK_HASH = "FLWSECK-live", "h"

    class R:
        ok, status_code = False, 401

    monkeypatch.setattr(preflight.requests, "get", lambda *a, **k: R())
    r = by_name(preflight._provider_check("flutterwave", offline=False))
    assert r["Flutterwave accepts the keys"].level == FAIL and "401" in r["Flutterwave accepts the keys"].detail


def test_unused_gateways_are_skipped(settings):
    settings.PAYMENT_PROVIDERS_ENABLED = ["paystack"]
    assert preflight._provider_check("paypal", offline=True)[0].level == SKIP


def test_missing_email_key_fails(settings):
    settings.RESEND_API_KEY = ""
    settings.SMS_BACKEND = settings.WHATSAPP_BACKEND = "log"
    r = by_name(preflight.check_messaging(offline=True))
    assert r["Email"].level == FAIL
    assert r["SMS and WhatsApp"].level == SKIP


def test_whatsapp_needs_sender_and_templates(settings):
    settings.RESEND_API_KEY = "re_x"
    settings.WHATSAPP_BACKEND = "twilio"
    settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN = "AC1", "t"
    settings.TWILIO_WHATSAPP_FROM, settings.WHATSAPP_TEMPLATE_SIDS = "", ""
    r = by_name(preflight.check_messaging(offline=True))
    assert r["WhatsApp sender"].level == FAIL
    assert r["WhatsApp templates"].level == WARN


def test_half_configured_carrier_fails(settings):
    settings.DHL_EXPRESS_USER, settings.DHL_EXPRESS_PASSWORD, settings.DHL_EXPRESS_ACCOUNT = "u", "", ""
    r = by_name(preflight.check_carriers(offline=True))
    assert r["DHL Express rates and labels"].level == FAIL


def test_command_exit_code_and_output(settings):
    settings.DEBUG = True
    out = io.StringIO()
    with pytest.raises(SystemExit) as e:
        call_command("preflight", "--offline", stdout=out)
    assert e.value.code == 1
    text = out.getvalue()
    assert "Fix:" in text and "to fix" in text and "Not ready" in text


def test_command_json(settings):
    out = io.StringIO()
    with pytest.raises(SystemExit):
        call_command("preflight", "--offline", "--json", stdout=out)
    data = json.loads(out.getvalue())
    assert {"group", "name", "level", "detail", "fix"} <= set(data[0])
