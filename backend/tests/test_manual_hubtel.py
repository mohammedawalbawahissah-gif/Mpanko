"""Cash, Zelle and Cash App (confirmed by finance staff) and Hubtel (Ghana gateway, mocked responses only)."""
import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.orders.models import Order, OrderStatus
from apps.payments.models import AttemptStatus, PaymentAttempt
from apps.payments.providers import InvalidSignature, ProviderError, get_provider

from .conftest import client_for, place_order

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def methods(settings):
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock", "zelle", "cashapp", "cash", "hubtel"]
    settings.ZELLE_RECIPIENT, settings.ZELLE_NAME = "pay@wolbi.example", "Wolbi Royal Enterprise"
    settings.CASH_INSTRUCTIONS = "Pay the courier on delivery."
    settings.MANUAL_PAYMENT_HOLD_HOURS = 72
    settings.HUBTEL_CLIENT_ID, settings.HUBTEL_CLIENT_SECRET, settings.HUBTEL_MERCHANT_ACCOUNT = "id", "secret", "11684"
    settings.API_PUBLIC_URL = "https://api.example.com"


def start(customer, address, variant, provider, key="key-1"):
    c, r = place_order(customer, variant, address, key=key)
    assert r.status_code == 201, r.content
    pay = c.post("/api/v1/payments/initiate/", {"order_number": r.data["number"], "provider": provider}, format="json")
    return c, r.data, pay


# ---- Cash and Zelle ---------------------------------------------------------------------------------------

def test_methods_list_marks_manual_ones_and_only_offers_usd():
    from rest_framework.test import APIClient

    data = APIClient().get("/api/v1/payments/methods/?currency=USD").json()
    by = {m["provider"]: m for m in data}
    assert by["zelle"]["manual"] is True and by["cash"]["manual"] is True and by["mock"]["manual"] is False
    assert "hubtel" not in by
    ghs = {m["provider"] for m in APIClient().get("/api/v1/payments/methods/?currency=GHS").json()}
    assert "hubtel" in ghs and "zelle" not in ghs and "cash" not in ghs


def test_zelle_tells_the_shopper_how_to_pay_and_waits(customer, address, product):
    _, variant = product
    _, order, pay = start(customer, address, variant, "zelle")
    assert pay.status_code == 201
    assert pay.data["manual"] is True and pay.data["status"] == "pending"
    assert "pay@wolbi.example" in pay.data["instructions"] and order["number"] in pay.data["instructions"]
    assert "reference=" + pay.data["reference"] in pay.data["authorization_url"]
    assert Order.objects.get(number=order["number"]).status == OrderStatus.PENDING_PAYMENT


def test_a_manual_payment_never_confirms_itself(customer, address, product):
    _, variant = product
    c, _, pay = start(customer, address, variant, "cash")
    v = c.get(f"/api/v1/payments/verify/{pay.data['reference']}/")
    assert v.data["payment_status"] == "pending" and v.data["manual"] is True and "courier" in v.data["instructions"]
    assert c.post("/api/v1/payments/webhooks/cash/", data=b"{}", content_type="application/json").status_code == 401


def test_manual_payment_holds_stock_longer_than_a_card_payment(customer, address, product):
    _, variant = product
    _, order, _ = start(customer, address, variant, "zelle")
    expires = Order.objects.get(number=order["number"]).expires_at
    assert expires > timezone.now() + timedelta(hours=71)


def test_finance_confirms_a_payment_and_the_order_becomes_paid(customer, address, product, finance, django_capture_on_commit_callbacks):
    _, variant = product
    _, order, pay = start(customer, address, variant, "zelle")
    f = client_for(finance)
    listed = f.get("/api/v1/payments/manual/").json()
    assert [x["order_number"] for x in listed] == [order["number"]]
    with django_capture_on_commit_callbacks(execute=True):
        r = f.post(f"/api/v1/payments/manual/{pay.data['reference']}/confirm/", {"amount": order["grand_total"]}, format="json")
    assert r.status_code == 200, r.content
    assert r.data["payment_status"] == "succeeded" and r.data["order_status"] == "paid"
    assert f.get("/api/v1/payments/manual/").json() == []
    from apps.accounts.models import AuditLog

    assert AuditLog.objects.filter(action="payment.confirm_manual").count() == 1


def test_confirming_the_wrong_amount_is_refused(customer, address, product, finance):
    _, variant = product
    _, order, pay = start(customer, address, variant, "cash")
    r = client_for(finance).post(f"/api/v1/payments/manual/{pay.data['reference']}/confirm/", {"amount": "0.01"}, format="json")
    assert r.status_code == 400 and "amount" in r.json()
    assert Order.objects.get(number=order["number"]).status == OrderStatus.PENDING_PAYMENT


def test_only_finance_staff_can_confirm(customer, address, product, fulfillment):
    _, variant = product
    c, order, pay = start(customer, address, variant, "zelle")
    url = f"/api/v1/payments/manual/{pay.data['reference']}/confirm/"
    assert c.post(url, {"amount": order["grand_total"]}, format="json").status_code == 403
    assert client_for(fulfillment).post(url, {"amount": order["grand_total"]}, format="json").status_code == 403
    assert c.get("/api/v1/payments/manual/").status_code == 403


def test_a_gateway_payment_cannot_be_confirmed_by_hand(customer, address, product, finance):
    _, variant = product
    _, order, pay = start(customer, address, variant, "mock")
    r = client_for(finance).post(f"/api/v1/payments/manual/{pay.data['reference']}/confirm/", {"amount": order["grand_total"]}, format="json")
    assert r.status_code == 400


def test_confirming_twice_changes_nothing_the_second_time(customer, address, product, finance):
    _, variant = product
    _, order, pay = start(customer, address, variant, "cash")
    f = client_for(finance)
    url = f"/api/v1/payments/manual/{pay.data['reference']}/confirm/"
    assert f.post(url, {"amount": order["grand_total"]}, format="json").status_code == 200
    assert f.post(url, {"amount": order["grand_total"]}, format="json").status_code == 400


def test_manual_refund_is_recorded_and_flags_that_staff_pay_back_by_hand(customer, address, product, finance, admin):
    _, variant = product
    _, order, pay = start(customer, address, variant, "zelle")
    f = client_for(finance)
    f.post(f"/api/v1/payments/manual/{pay.data['reference']}/confirm/", {"amount": order["grand_total"]}, format="json")
    r = f.post("/api/v1/payments/refunds/", {"order_number": order["number"], "reason": "Customer cancelled"}, format="json")
    assert r.status_code in (200, 201), r.content
    assert PaymentAttempt.objects.get(reference=pay.data["reference"]).status == AttemptStatus.REFUNDED


def test_manual_methods_have_no_statement_to_reconcile(customer, address, product):
    with pytest.raises(ProviderError, match="no statement"):
        get_provider("zelle").list_transactions(timezone.now(), timezone.now())


# ---- Hubtel -----------------------------------------------------------------------------------------------

class Resp:
    def __init__(self, data, ok=True):
        self._d, self.ok, self.content = data, ok, b"x"

    def json(self):
        return self._d


@pytest.fixture
def hubtel(monkeypatch):
    calls, routes = [], {}

    def fake(method, url, **kwargs):
        calls.append((method, url, kwargs))
        for (m, suffix), data in routes.items():
            if m == method and url.endswith(suffix):
                return data if isinstance(data, Resp) else Resp(data)
        return Resp({"message": "no route " + url}, ok=False)

    monkeypatch.setattr("apps.payments.providers_extra.requests.request", fake)

    class G:
        pass

    g = G()
    g.calls, g.routes = calls, routes
    return g


@pytest.fixture
def ghs_attempt(customer, address, product):
    _, variant = product
    address.country, address.region = "GH", "Northern"
    address.save()
    _, r = place_order(customer, variant, address, currency="GHS")
    assert r.status_code == 201, r.content
    order = Order.objects.get(number=r.json()["number"])
    return PaymentAttempt.objects.create(order=order, provider="hubtel", amount=order.grand_total, currency="GHS", idempotency_key="h")


def test_hubtel_initiate_sends_the_order_and_returns_the_checkout_link(hubtel, ghs_attempt):
    hubtel.routes[("POST", "/items/initiate")] = {"responseCode": "0000", "status": "Success", "data": {"checkoutUrl": "https://pay.hubtel.com/abc", "checkoutId": "C1"}}
    out = get_provider("hubtel").initiate(ghs_attempt, "a@b.com", "https://shop.test/checkout/complete")
    assert out["authorization_url"] == "https://pay.hubtel.com/abc" and out["provider_reference"] == "C1"
    method, url, kw = hubtel.calls[-1]
    assert kw["headers"]["Authorization"].startswith("Basic ")
    body = kw["json"]
    assert body["clientReference"] == ghs_attempt.reference and body["totalAmount"] == str(ghs_attempt.amount) and body["merchantAccountNumber"] == "11684"
    assert body["callbackUrl"] == "https://api.example.com/api/v1/payments/webhooks/hubtel/"


def test_hubtel_initiate_error_is_explained(hubtel, ghs_attempt):
    hubtel.routes[("POST", "/items/initiate")] = Resp({"message": "Invalid merchant"}, ok=False)
    with pytest.raises(ProviderError, match="Invalid merchant"):
        get_provider("hubtel").initiate(ghs_attempt, "a@b.com", "https://shop.test/x")


def test_hubtel_is_not_usable_without_credentials(settings, ghs_attempt):
    settings.HUBTEL_CLIENT_SECRET = ""
    with pytest.raises(ProviderError, match="not configured"):
        get_provider("hubtel").verify(ghs_attempt)


def test_hubtel_verify_maps_statuses(hubtel, ghs_attempt):
    p = get_provider("hubtel")
    route = ("GET", "/transactions/11684/status")
    hubtel.routes[route] = {"responseCode": "0000", "data": {"status": "Paid", "amount": float(ghs_attempt.amount), "currencyCode": "GHS", "transactionId": "T9"}}
    v = p.verify(ghs_attempt)
    assert (v.status, v.amount, v.currency, v.provider_reference) == ("succeeded", ghs_attempt.amount, "GHS", "T9")
    hubtel.routes[route] = {"data": {"status": "Unpaid", "amount": 5}}
    assert p.verify(ghs_attempt).status == "pending"
    hubtel.routes[route] = {"data": {"status": "Refunded", "amount": 5}}
    assert p.verify(ghs_attempt).status == "reversed"
    hubtel.routes[route] = Resp({"message": "not found"}, ok=False)
    assert p.verify(ghs_attempt).status == "pending"


def test_hubtel_callback_is_checked_against_hubtel_not_trusted(hubtel, ghs_attempt):
    p = get_provider("hubtel")
    body = json.dumps({"ResponseCode": "0000", "Status": "Success", "Data": {"ClientReference": ghs_attempt.reference, "Status": "Success", "Amount": 1}}).encode()
    # A forged "Success" callback while Hubtel says Unpaid must not mark anything paid.
    hubtel.routes[("GET", "/transactions/11684/status")] = {"data": {"status": "Unpaid", "amount": float(ghs_attempt.amount), "currencyCode": "GHS"}}
    assert p.parse_webhook(body, {}).status == "pending"
    hubtel.routes[("GET", "/transactions/11684/status")] = {"data": {"status": "Paid", "amount": float(ghs_attempt.amount), "currencyCode": "GHS", "transactionId": "T1"}}
    ev = p.parse_webhook(body, {})
    assert (ev.reference, ev.status, ev.amount) == (ghs_attempt.reference, "succeeded", ghs_attempt.amount)
    # If Hubtel cannot confirm the payment at all, the callback is rejected.
    hubtel.routes[("GET", "/transactions/11684/status")] = Resp({}, ok=False)
    with pytest.raises(InvalidSignature):
        p.parse_webhook(body, {})
    with pytest.raises(KeyError):
        p.parse_webhook(b'{"Data": {}}', {})


def test_hubtel_callback_confirms_the_order_end_to_end(hubtel, ghs_attempt, django_capture_on_commit_callbacks):
    from django.test import Client

    hubtel.routes[("GET", "/transactions/11684/status")] = {"data": {"status": "Paid", "amount": float(ghs_attempt.amount), "currencyCode": "GHS", "transactionId": "T1"}}
    body = json.dumps({"Data": {"ClientReference": ghs_attempt.reference}})
    with django_capture_on_commit_callbacks(execute=True):
        r = Client().post("/api/v1/payments/webhooks/hubtel/", data=body, content_type="application/json")
    assert r.status_code == 200
    ghs_attempt.refresh_from_db()
    assert ghs_attempt.status == AttemptStatus.SUCCEEDED and ghs_attempt.order.status == OrderStatus.PAID


def test_hubtel_refund_and_statement_are_not_available():
    with pytest.raises(ProviderError, match="dashboard"):
        get_provider("hubtel").refund(None, Decimal("1"))
    with pytest.raises(ProviderError, match="statement"):
        get_provider("hubtel").list_transactions(timezone.now(), timezone.now())


def test_cash_app_tells_the_shopper_the_cashtag_and_waits(customer, address, product, settings):
    settings.CASHAPP_CASHTAG = "WolbiRoyal"
    _, variant = product
    _, order, pay = start(customer, address, variant, "cashapp")
    assert pay.status_code == 201, pay.content
    text = pay.data["instructions"]
    assert "$WolbiRoyal" in text and order["number"] in text and "Cash App" in text
    from apps.orders.models import Order

    assert Order.objects.get(number=order["number"]).status == "pending_payment"


def test_cash_app_is_only_offered_for_usd_and_marked_manual():
    from rest_framework.test import APIClient

    by = {m["provider"]: m for m in APIClient().get("/api/v1/payments/methods/?currency=USD").json()}
    assert by["cashapp"]["manual"] is True
    assert "cashapp" not in {m["provider"] for m in APIClient().get("/api/v1/payments/methods/?currency=GHS").json()}


def test_cash_app_payment_is_confirmed_by_finance(customer, address, product, finance):
    from apps.orders.models import Order

    _, variant = product
    _, order, pay = start(customer, address, variant, "cashapp")
    url = f"/api/v1/payments/manual/{pay.data['reference']}/confirm/"
    assert client_for(finance).post(url, {"amount": order["grand_total"]}, format="json").status_code == 200
    assert Order.objects.get(number=order["number"]).status == "paid"
