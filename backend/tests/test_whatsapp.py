"""WhatsApp order updates through Twilio (INT-05)."""
import json

import pytest

from apps.notifications import whatsapp
from apps.notifications.models import NotificationLog

from .conftest import client_for

pytestmark = pytest.mark.django_db


class Resp:
    def __init__(self, ok=True, status=201, text=""):
        self.ok, self.status_code, self.text = ok, status, text


@pytest.fixture
def sent(monkeypatch, settings):
    settings.WHATSAPP_BACKEND = "twilio"
    settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN = "AC1", "tok"
    settings.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886"
    settings.WHATSAPP_TEMPLATE_SIDS = ""
    calls = []
    monkeypatch.setattr("apps.notifications.whatsapp.requests.post", lambda url, **kw: (calls.append((url, kw)), Resp())[1])
    return calls


@pytest.fixture
def opted_in(customer):
    customer.phone, customer.phone_verified, customer.notify_whatsapp = "+233240000000", True, True
    customer.save()
    return customer


def event(user, key="order_confirmation", **ctx):
    whatsapp.whatsapp_for_email(key, user.email, {"order_number": "MP-1", **ctx})


def test_sends_to_whatsapp_address_with_sender(sent, opted_in):
    event(opted_in)
    assert len(sent) == 1
    url, kw = sent[0]
    assert url.endswith("/Accounts/AC1/Messages.json")
    assert kw["data"]["To"] == "whatsapp:+233240000000" and kw["data"]["From"] == "whatsapp:+14155238886"
    assert "MP-1" in kw["data"]["Body"]
    log = NotificationLog.objects.get(channel="whatsapp")
    assert log.status == NotificationLog.Status.SENT and log.key == "whatsapp_order_confirmation"


@pytest.mark.parametrize("field,value", [("notify_whatsapp", False), ("phone_verified", False), ("is_active", False)])
def test_not_sent_unless_opted_in_verified_and_active(sent, opted_in, field, value):
    setattr(opted_in, field, value)
    opted_in.save()
    event(opted_in)
    assert sent == []


def test_other_events_without_text_are_skipped(sent, opted_in):
    event(opted_in, key="password_reset")
    assert sent == []


def test_approved_template_is_used_when_configured(sent, opted_in, settings):
    settings.WHATSAPP_TEMPLATE_SIDS = json.dumps({"shipment_dispatched": "HX999"})
    event(opted_in, key="shipment_dispatched", carrier="DHL", tracking_number="T123")
    data = sent[0][1]["data"]
    assert data["ContentSid"] == "HX999" and "Body" not in data
    assert json.loads(data["ContentVariables"]) == {"1": "MP-1", "2": "DHL", "3": "T123"}


def test_bad_template_setting_falls_back_to_plain_text(sent, opted_in, settings):
    settings.WHATSAPP_TEMPLATE_SIDS = "not json"
    event(opted_in)
    assert "Body" in sent[0][1]["data"]


def test_twilio_failure_is_logged_and_never_raises(monkeypatch, opted_in, settings):
    settings.WHATSAPP_BACKEND, settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_WHATSAPP_FROM = "twilio", "AC1", "t", "whatsapp:+1"
    monkeypatch.setattr("apps.notifications.whatsapp.requests.post", lambda *a, **k: Resp(ok=False, status=400, text="not opted in"))
    event(opted_in)
    log = NotificationLog.objects.get(channel="whatsapp")
    assert log.status == NotificationLog.Status.FAILED and "400" in log.error


def test_missing_sender_is_a_logged_failure(monkeypatch, opted_in, settings):
    settings.WHATSAPP_BACKEND, settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_WHATSAPP_FROM = "twilio", "AC1", "t", ""
    event(opted_in)
    assert "TWILIO_WHATSAPP_FROM" in NotificationLog.objects.get(channel="whatsapp").error


def test_default_log_backend_sends_nothing_out(opted_in, settings):
    settings.WHATSAPP_BACKEND = "log"
    event(opted_in)
    assert NotificationLog.objects.get(channel="whatsapp").status == NotificationLog.Status.SENT


def test_the_email_pipeline_triggers_whatsapp(sent, opted_in):
    from apps.notifications.services import send_notification

    send_notification("order_confirmation", opted_in.email, {"order_number": "MP-7"})
    assert any("MP-7" in kw["data"].get("Body", "") for _, kw in sent)


def test_preference_is_saved_through_the_profile_endpoint(customer):
    c = client_for(customer)
    r = c.patch("/api/v1/auth/me/", {"notify_whatsapp": True}, format="json")
    assert r.status_code == 200 and r.json()["notify_whatsapp"] is True
