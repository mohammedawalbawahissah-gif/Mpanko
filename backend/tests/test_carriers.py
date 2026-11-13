import base64
from decimal import Decimal

import pytest
import requests

from apps.orders.models import Order
from apps.shipping import carriers, providers
from apps.shipping.models import Carrier, Shipment

from .conftest import client_for, make_product
from .test_batch1 import pay

pytestmark = pytest.mark.django_db


class Resp:
    def __init__(self, payload, status=200):
        self._p, self.status_code, self.ok = payload, status, status < 400

    def json(self):
        return self._p


@pytest.fixture
def creds(settings):
    settings.DHL_EXPRESS_USER, settings.DHL_EXPRESS_PASSWORD, settings.DHL_EXPRESS_ACCOUNT = "u", "p", "123"
    settings.FEDEX_CLIENT_ID, settings.FEDEX_CLIENT_SECRET, settings.FEDEX_ACCOUNT = "id", "secret", "456"
    settings.UPS_CLIENT_ID, settings.UPS_CLIENT_SECRET, settings.UPS_ACCOUNT = "id", "secret", "789"
    carriers.FedEx._token.update(value="", exp=0.0)
    carriers.UPS._token.update(value="", exp=0.0)


DEST = {"country": "US", "city": "Austin", "postal_code": "73301", "line1": "1 Main St", "recipient_name": "Sam", "phone": "123"}


def fake_http(monkeypatch, routes):
    """routes: list of (substring, payload). First match wins. Records calls."""
    calls = []

    def fake(method, url, **kw):
        calls.append((method, url, kw))
        for part, payload in routes:
            if part in url:
                return payload if isinstance(payload, Resp) else Resp(payload)
        return Resp({"detail": "no route"}, 404)

    monkeypatch.setattr(carriers.requests, "request", fake)
    return calls


DHL_RATES = {"products": [{"productName": "EXPRESS WORLDWIDE", "productCode": "P", "totalPrice": [
    {"currencyType": "BILLC", "priceCurrency": "USD", "price": 61.5}], "deliveryCapabilities": {"totalTransitDays": "3"}}]}
FEDEX_RATES = {"output": {"rateReplyDetails": [{"serviceType": "INTERNATIONAL_PRIORITY", "serviceName": "FedEx International Priority",
                                                  "ratedShipmentDetails": [{"totalNetCharge": 55.25, "currency": "USD"}]}]}}
UPS_RATES = {"RateResponse": {"RatedShipment": [{"Service": {"Code": "65"}, "TotalCharges": {"MonetaryValue": "48.10", "CurrencyCode": "USD"},
                                                 "GuaranteedDelivery": {"BusinessDaysInTransit": "4"}}]}}


def test_adapters_parse_rate_responses(creds, monkeypatch):
    fake_http(monkeypatch, [("mydhlapi", DHL_RATES), ("oauth/token", {"access_token": "t", "expires_in": 3000}), ("rate/v1", FEDEX_RATES), ("rating", UPS_RATES)])
    dhl = carriers.LIVE_CARRIERS["dhl"].rates(DEST, 1500)[0]
    assert (dhl.service_code, dhl.price, dhl.eta_max) == ("P", Decimal("61.5"), 3)
    assert carriers.LIVE_CARRIERS["fedex"].rates(DEST, 1500)[0].service_code == "INTERNATIONAL_PRIORITY"
    ups = carriers.LIVE_CARRIERS["ups"]
    monkeypatch.setattr(ups, "_headers", lambda: {})
    q = ups.rates(DEST, 1500)[0]
    assert q.price == Decimal("48.10") and q.service_name == "UPS Worldwide Saver"


def test_live_rates_need_credentials_and_an_active_carrier_row(creds, monkeypatch):
    fake_http(monkeypatch, [("mydhlapi", DHL_RATES)])
    assert providers.live_rates(DEST, 1000) == []  # no Carrier row yet
    Carrier.objects.create(name="DHL Express", code="dhl-express", provider="dhl")
    rates = providers.live_rates(DEST, 1000)
    assert [r.service_code for r in rates] == ["dhl:P"] and rates[0].provider == "dhl"
    Carrier.objects.update(is_active=False)
    assert providers.live_rates(DEST, 1000) == []


def test_carrier_failure_never_blocks_quotes(creds, monkeypatch):
    Carrier.objects.create(name="DHL Express", code="dhl-express", provider="dhl")

    def boom(*a, **k):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(carriers.requests, "request", boom)
    rates = providers.get_rates("US", 1000, destination=DEST)
    assert rates and all(r.provider == "manual" for r in rates)  # flat-rate fallback still offered


def test_live_quotes_merge_with_table_rates_and_are_cached(creds, monkeypatch):
    Carrier.objects.create(name="DHL Express", code="dhl-express", provider="dhl")
    calls = fake_http(monkeypatch, [("mydhlapi", DHL_RATES)])
    first = providers.get_rates("US", 1000, destination=DEST)
    again = providers.get_rates("US", 1000, destination=DEST)
    assert any(r.service_code == "dhl:P" for r in first) and len(first) == len(again)
    assert len(calls) == 1  # second quote came from the cache


def test_quote_endpoint_passes_postal_code(creds, monkeypatch, api):
    Carrier.objects.create(name="DHL Express", code="dhl-express", provider="dhl")
    calls = fake_http(monkeypatch, [("mydhlapi", DHL_RATES)])
    r = api.get("/api/v1/shipping/quote/?country=US&city=Austin&postal_code=73301")
    assert r.status_code == 200 and any(s["service_code"] == "dhl:P" for s in r.data["services"])
    assert calls[0][2]["params"]["destinationPostalCode"] == "73301"


def _shipment(customer, address, fulfillment, provider="dhl"):
    _, variant = make_product(name="Label Item", stock=5)
    _, number = pay(customer, address, variant, qty=1)
    carrier = Carrier.objects.create(name=provider.upper(), code=f"{provider}-x", provider=provider)
    staff = client_for(fulfillment)
    s = staff.post("/api/v1/shipments/", {"order_number": number, "carrier": carrier.id}, format="json")
    assert s.status_code == 201
    return staff, s.data["id"], number


def test_label_booking_stores_label_and_tracking(customer, us_address, fulfillment, creds, monkeypatch):
    staff, sid, number = _shipment(customer, us_address, fulfillment)
    pdf = b"%PDF-1.4 fake"
    fake_http(monkeypatch, [("/shipments", {"shipmentTrackingNumber": "1234567890", "documents": [{"typeCode": "label", "content": base64.b64encode(pdf).decode()}]})])
    bad = staff.post(f"/api/v1/shipments/{sid}/label/", {}, format="json")
    assert bad.status_code == 400  # customer chose a non-DHL service, staff must pick one
    r = staff.post(f"/api/v1/shipments/{sid}/label/", {"service_code": "dhl:P"}, format="json")
    assert r.status_code == 201 and r.data["tracking_number"] == "1234567890" and r.data["has_label"]
    assert staff.get(f"/api/v1/shipments/{sid}/label/").content == pdf
    assert staff.post(f"/api/v1/shipments/{sid}/label/", {"service_code": "dhl:P"}, format="json").status_code == 400  # already booked
    assert Shipment.objects.get(pk=sid).label_format == "pdf"


def test_label_errors_are_readable(customer, us_address, fulfillment, settings, monkeypatch):
    staff, sid, _ = _shipment(customer, us_address, fulfillment)
    r = staff.post(f"/api/v1/shipments/{sid}/label/", {"service_code": "dhl:P"}, format="json")
    assert r.status_code == 400 and "credentials" in str(r.data)
    settings.DHL_EXPRESS_USER = settings.DHL_EXPRESS_PASSWORD = settings.DHL_EXPRESS_ACCOUNT = "x"
    fake_http(monkeypatch, [("/shipments", Resp({"detail": "Invalid account"}, 422))])
    r = staff.post(f"/api/v1/shipments/{sid}/label/", {"service_code": "dhl:P"}, format="json")
    assert r.status_code == 400 and "Invalid account" in str(r.data)


def test_manual_carrier_cannot_book_labels(customer, us_address, fulfillment):
    staff, sid, _ = _shipment(customer, us_address, fulfillment, provider="manual")
    assert staff.post(f"/api/v1/shipments/{sid}/label/", {}, format="json").status_code == 400


def test_fedex_and_ups_book(creds, monkeypatch, customer, us_address, fulfillment):
    staff, sid, _ = _shipment(customer, us_address, fulfillment, provider="fedex")
    shipment = Shipment.objects.get(pk=sid)
    fake_http(monkeypatch, [("oauth/token", {"access_token": "t", "expires_in": 3000}), ("ship/v1", {"output": {"transactionShipments": [
        {"masterTrackingNumber": "FX1", "pieceResponses": [{"packageDocuments": [{"encodedLabel": base64.b64encode(b"L").decode()}]}]}]}})])
    b = carriers.LIVE_CARRIERS["fedex"].book(shipment, us_address.snapshot(), 500, "INTERNATIONAL_PRIORITY")
    assert (b.tracking_number, b.label_bytes) == ("FX1", b"L")
    ups = carriers.LIVE_CARRIERS["ups"]
    monkeypatch.setattr(ups, "_headers", lambda: {})
    fake_http(monkeypatch, [("ship", {"ShipmentResponse": {"ShipmentResults": {"ShipmentIdentificationNumber": "1Z999", "PackageResults": [
        {"ShippingLabel": {"GraphicImage": base64.b64encode(b"G").decode()}}]}}})])
    b = ups.book(shipment, us_address.snapshot(), 500, "65")
    assert (b.tracking_number, b.label_format) == ("1Z999", "gif")


def test_ready_endpoint_reports_database(api):
    r = api.get("/ready/")
    assert r.status_code == 200 and r.json()["checks"]["database"] == "ok"
