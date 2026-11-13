import hashlib
import hmac
import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounts.models import Role
from apps.currency.models import ExchangeRate
from apps.currency.services import refresh_live_rates
from apps.orders import pricing
from apps.orders.models import Order, OrderStatus
from apps.shipping.models import Carrier, Shipment
from apps.shipping.providers import DHLTracking, TrackingError
from apps.shipping.services import sync_shipment
from apps.shipping.tasks import poll_active_shipments

from .conftest import client_for, make_user, place_order
from .test_orders_payments import paid_order

pytestmark = pytest.mark.django_db


class FakeResponse:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status
        self.ok = status < 400

    def json(self):
        return self._p


# ---- Exchange rates ---------------------------------------------------------------------------------------------

def rate_row(quote, rate, source, age_hours=0):
    return ExchangeRate.objects.create(base="USD", quote=quote, rate=rate, source=source, fetched_at=timezone.now() - timedelta(hours=age_hours))


def test_rate_priority_manual_then_fresh_live_then_config():
    assert pricing.rate("GHS") == Decimal("10")  # configured fallback
    rate_row("GHS", "12.5", "live", age_hours=100)
    assert pricing.rate("GHS") == Decimal("10")  # stale live rate ignored
    rate_row("GHS", "11.9", "live", age_hours=1)
    assert pricing.rate("GHS") == Decimal("11.9")
    rate_row("GHS", "13", "manual")
    assert pricing.rate("GHS") == Decimal("13")  # owner override always wins


def test_checkout_records_which_rate_was_used(customer, address, product):
    _, variant = product
    rate_row("GHS", "12", "live")
    _, r = place_order(customer, variant, address, currency="GHS", service="local-standard")
    assert r.data["subtotal"] == "600.00"  # 50.00 USD x 12
    assert "1 USD = 12 GHS (live rate" in r.data["fx_rate_note"]


def test_refresh_stores_only_supported_currencies(monkeypatch):
    payload = {"result": "success", "rates": {"USD": 1, "GHS": 11.7, "EUR": 0.9, "JPY": 150}}
    monkeypatch.setattr("apps.currency.services.requests.get", lambda *a, **k: FakeResponse(payload))
    assert refresh_live_rates() == 1  # USD is the base, EUR/JPY are not enabled
    assert ExchangeRate.objects.get().quote == "GHS"


def test_failed_refresh_keeps_existing_rates(monkeypatch):
    rate_row("GHS", "11.9", "live")
    monkeypatch.setattr("apps.currency.services.requests.get", lambda *a, **k: FakeResponse({"result": "error"}, 500))
    assert refresh_live_rates() == 0
    assert pricing.rate("GHS") == Decimal("11.9")
    monkeypatch.setattr("apps.currency.services.requests.get", lambda *a, **k: FakeResponse({"result": "success", "rates": {"GHS": "garbage"}}))
    assert refresh_live_rates() == 0 and ExchangeRate.objects.count() == 1


def test_public_rates_endpoint(api):
    r = api.get("/api/v1/currency/rates/")
    assert r.status_code == 200 and r.data["base"] == "USD" and r.data["rates"]["GHS"] == "10"


# ---- Carrier tracking (DHL adapter, polling, webhooks) -----------------------------------------------------------

DHL_PAYLOAD = {"shipments": [{"id": "TRK123", "status": {"statusCode": "transit"}, "events": [
    {"timestamp": "2026-11-14T08:00:00Z", "statusCode": "pre-transit", "description": "Shipment information received"},
    {"timestamp": "2026-11-15T10:30:00Z", "statusCode": "transit", "description": "Departed facility", "location": {"address": {"addressLocality": "Leipzig"}}},
]}]}


@pytest.fixture
def shipped(customer, address, product, fulfillment, settings):
    settings.DHL_API_KEY = "test-key"
    _, variant = product
    _, number, _ = paid_order(customer, address, variant)
    carrier = Carrier.objects.create(name="DHL Express", code="dhl", provider="dhl", webhook_secret="whsec")
    r = client_for(fulfillment).post("/api/v1/shipments/", {"order_number": number, "carrier": carrier.id, "tracking_number": "TRK123"}, format="json")
    return Shipment.objects.get(pk=r.data["id"]), Order.objects.get(number=number), carrier


def test_dhl_sync_creates_events_once_and_advances_order(shipped, monkeypatch):
    shipment, order, _ = shipped
    monkeypatch.setattr("requests.get", lambda *a, **k: FakeResponse(DHL_PAYLOAD))
    assert sync_shipment(shipment) == 2
    assert sync_shipment(shipment) == 0  # same events again: nothing new
    shipment.refresh_from_db(); order.refresh_from_db()
    assert shipment.status == "in_transit" and order.status == OrderStatus.SHIPPED
    assert shipment.events.filter(location="Leipzig").exists()


def test_dhl_errors_are_reported_not_swallowed(shipped, monkeypatch, settings):
    shipment, _, _ = shipped
    settings.DHL_API_KEY = ""
    with pytest.raises(TrackingError):
        DHLTracking().fetch_tracking(shipment)
    settings.DHL_API_KEY = "k"
    monkeypatch.setattr("requests.get", lambda *a, **k: FakeResponse({"shipments": []}, 404))
    assert DHLTracking().fetch_tracking(shipment) == []


def test_poller_skips_manual_carriers_and_survives_failures(shipped, monkeypatch, fulfillment, customer, address):
    shipment, _, _ = shipped
    manual = Carrier.objects.create(name="Local courier", code="local", provider="manual")
    Shipment.objects.create(order=shipment.order, carrier=manual, tracking_number="LOCAL1")
    calls = []
    def fake_get(*a, **k):
        calls.append(k["params"]["trackingNumber"])
        return FakeResponse(DHL_PAYLOAD)
    monkeypatch.setattr("requests.get", fake_get)
    assert poll_active_shipments() == 2
    assert calls == ["TRK123"]  # only the DHL shipment was polled


def test_refresh_endpoint_requires_api_carrier(shipped, fulfillment):
    shipment, _, _ = shipped
    manual = Carrier.objects.create(name="Local", code="loc", provider="manual")
    other = Shipment.objects.create(order=shipment.order, carrier=manual)
    assert client_for(fulfillment).post(f"/api/v1/shipments/{other.id}/refresh/").status_code == 400


def sign(secret, body):
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_carrier_webhook_signature_dedupe_and_delivery(shipped, api):
    shipment, order, _ = shipped
    body = json.dumps({"tracking_number": "TRK123", "status": "in_transit", "event_id": "ev-1", "description": "Left hub"}).encode()
    url = "/api/v1/shipping/webhooks/dhl/"
    assert api.post(url, data=body, content_type="application/json", HTTP_X_MPANKO_SIGNATURE="nope").status_code == 401
    good = {"data": body, "content_type": "application/json", "HTTP_X_MPANKO_SIGNATURE": sign("whsec", body)}
    assert api.post(url, **good).data["created"] is True
    assert api.post(url, **good).data["created"] is False  # carrier retry
    done = json.dumps({"tracking_number": "TRK123", "status": "delivered", "event_id": "ev-2"}).encode()
    api.post(url, data=done, content_type="application/json", HTTP_X_MPANKO_SIGNATURE=sign("whsec", done))
    order.refresh_from_db()
    assert order.status == OrderStatus.DELIVERED
    ghost = json.dumps({"tracking_number": "NOPE", "status": "delivered"}).encode()
    assert api.post(url, data=ghost, content_type="application/json", HTTP_X_MPANKO_SIGNATURE=sign("whsec", ghost)).status_code == 404


def test_carrier_without_secret_cannot_receive_webhooks(api):
    Carrier.objects.create(name="NoSecret", code="nosecret")
    assert api.post("/api/v1/shipping/webhooks/nosecret/", data=b"{}", content_type="application/json").status_code == 404


@pytest.mark.django_db
def test_carrier_list_is_staff_only_and_hides_secrets(customer, fulfillment):
    from apps.shipping.models import Carrier

    Carrier.objects.create(name="Test Courier", code="tc", webhook_secret="topsecret")
    assert client_for(customer).get("/api/v1/carriers/").status_code == 403
    resp = client_for(fulfillment).get("/api/v1/carriers/")
    assert resp.status_code == 200
    assert resp.json()[0]["name"] == "Test Courier"
    assert "topsecret" not in resp.content.decode()
