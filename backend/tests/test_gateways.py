"""Stripe, PayPal and Flutterwave adapters (FR-PAY-02), tested against mocked gateway responses."""
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from apps.payments.models import AttemptStatus, Dispute, PaymentAttempt
from apps.payments.providers import InvalidSignature, ProviderError, enabled_providers, get_provider

from .conftest import client_for, place_order

pytestmark = pytest.mark.django_db


class Resp:
    def __init__(self, data, ok=True):
        self._d, self.ok, self.content = data, ok, b"x"

    def json(self):
        return self._d


@pytest.fixture
def gateway(monkeypatch, settings):
    """Route every outgoing gateway call to a handler: gateway.routes[('GET', '/v1/x')] = data."""
    calls, routes = [], {}

    def fake(method, url, **kwargs):
        calls.append((method, url, kwargs))
        for (m, suffix), data in routes.items():
            if m == method and url.endswith(suffix):
                if isinstance(data, list):  # sequential pages
                    data = data.pop(0)
                return data if isinstance(data, Resp) else Resp(data)
        return Resp({"message": "no route " + url}, ok=False)

    monkeypatch.setattr("apps.payments.providers_extra.requests.request", fake)
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock", "stripe", "paypal", "flutterwave"]
    settings.STRIPE_SECRET_KEY = "sk_test_x"
    settings.STRIPE_WEBHOOK_SECRET = "whsec_x"
    settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET, settings.PAYPAL_WEBHOOK_ID = "cid", "sec", "WH-1"
    settings.FLUTTERWAVE_SECRET_KEY, settings.FLUTTERWAVE_WEBHOOK_HASH = "FLWSECK_TEST-x", "hash-x"

    class G:
        pass

    g = G()
    g.calls, g.routes = calls, routes
    routes[("POST", "/v1/oauth2/token")] = {"access_token": "tok"}
    return g


@pytest.fixture
def attempt(customer, address, product):
    _, variant = product
    _, r = place_order(customer, variant, address, currency="USD")
    assert r.status_code == 201, r.content
    from apps.orders.models import Order

    order = Order.objects.get(number=r.json()["number"])
    return PaymentAttempt.objects.create(order=order, provider="stripe", amount=order.grand_total, currency="USD", idempotency_key="k")


def test_registry_lists_the_new_gateways(gateway):
    assert {"stripe", "paypal", "flutterwave"} <= set(enabled_providers())
    assert get_provider("stripe").supports_currency("usd")


# ------------------------------------------------------------------ Stripe


def stripe_sig(body, secret="whsec_x", stamp=None):
    stamp = stamp or int(time.time())
    mac = hmac.new(secret.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    return {"stripe-signature": f"t={stamp},v1={mac}"}


def test_stripe_initiate_sends_amount_reference_and_returns_checkout_url(gateway, attempt):
    gateway.routes[("POST", "/checkout/sessions")] = {"id": "cs_1", "url": "https://checkout.stripe.com/c/cs_1"}
    out = get_provider("stripe").initiate(attempt, "a@b.com", "https://shop.test/checkout/complete")
    assert out["authorization_url"].startswith("https://checkout.stripe.com")
    assert out["provider_reference"] == "cs_1"
    body = gateway.calls[-1][2]["data"]
    assert body["line_items[0][price_data][unit_amount]"] == int(attempt.amount * 100)
    assert body["client_reference_id"] == attempt.reference
    assert f"reference={attempt.reference}" in body["success_url"]


def test_stripe_verify_maps_status(gateway, attempt):
    attempt.provider_reference = "cs_1"
    p = get_provider("stripe")
    gateway.routes[("GET", "/checkout/sessions/cs_1")] = {"id": "cs_1", "payment_status": "paid", "amount_total": 5500, "currency": "usd"}
    v = p.verify(attempt)
    assert (v.status, v.amount, v.currency) == ("succeeded", Decimal("55.00"), "USD")
    gateway.routes[("GET", "/checkout/sessions/cs_1")] = {"id": "cs_1", "payment_status": "unpaid", "status": "expired"}
    assert p.verify(attempt).status == "expired"


def test_stripe_rejection_surfaces_message(gateway, attempt):
    gateway.routes[("POST", "/checkout/sessions")] = Resp({"error": {"message": "Invalid currency"}}, ok=False)
    with pytest.raises(ProviderError, match="Invalid currency"):
        get_provider("stripe").initiate(attempt, "a@b.com", "https://shop.test/x")


def test_stripe_webhook_signature(gateway):
    body = json.dumps({"id": "evt_1", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_1", "client_reference_id": "REF1", "payment_status": "paid", "amount_total": 1000, "currency": "usd"}}}).encode()
    p = get_provider("stripe")
    ev = p.parse_webhook(body, stripe_sig(body))
    assert (ev.reference, ev.status, ev.amount, ev.currency, ev.event_id) == ("REF1", "succeeded", Decimal("10.00"), "USD", "evt_1")
    with pytest.raises(InvalidSignature):
        p.parse_webhook(body, stripe_sig(body, secret="wrong"))
    with pytest.raises(InvalidSignature):
        p.parse_webhook(body, stripe_sig(body, stamp=int(time.time()) - 3600))
    with pytest.raises(InvalidSignature):
        p.parse_webhook(body, {})


def test_stripe_webhook_tampered_body_rejected(gateway):
    body = b'{"id":"evt_1","type":"checkout.session.completed","data":{"object":{}}}'
    sig = stripe_sig(body)
    with pytest.raises(InvalidSignature):
        get_provider("stripe").parse_webhook(body + b" ", sig)


def test_stripe_refund_uses_payment_intent(gateway, attempt):
    attempt.provider_reference = "cs_1"
    gateway.routes[("GET", "/checkout/sessions/cs_1")] = {"id": "cs_1", "payment_intent": "pi_9"}
    gateway.routes[("POST", "/refunds")] = {"id": "re_1"}
    assert get_provider("stripe").refund(attempt, Decimal("12.50")) == "re_1"
    sent = gateway.calls[-1][2]["data"]
    assert sent == {"payment_intent": "pi_9", "amount": 1250}


def test_stripe_dispute_events_open_and_close_a_chargeback(gateway, attempt, settings):
    attempt.status = AttemptStatus.SUCCEEDED
    attempt.provider_reference = "cs_1"
    attempt.save()
    gateway.routes[("GET", "/payment_intents/pi_9")] = {"id": "pi_9", "metadata": {"reference": attempt.reference}}
    due = int(datetime(2026, 12, 1, tzinfo=timezone.utc).timestamp())

    def event(eid, etype, status):
        return json.dumps({"id": eid, "type": etype, "data": {"object": {
            "id": "dp_1", "payment_intent": "pi_9", "status": status, "reason": "fraudulent", "amount": 1000, "currency": "usd",
            "evidence_details": {"due_by": due}}}}).encode()

    from rest_framework.test import APIClient

    c = APIClient()
    b = event("evt_d1", "charge.dispute.created", "needs_response")
    assert c.post("/api/v1/payments/webhooks/stripe/", b, content_type="application/json", **{"HTTP_STRIPE_SIGNATURE": stripe_sig(b)["stripe-signature"]}).status_code == 200
    d = Dispute.objects.get(provider_dispute_id="dp_1")
    assert d.status == Dispute.Status.OPEN and d.respond_by.year == 2026
    b = event("evt_d2", "charge.dispute.closed", "lost")
    assert c.post("/api/v1/payments/webhooks/stripe/", b, content_type="application/json", **{"HTTP_STRIPE_SIGNATURE": stripe_sig(b)["stripe-signature"]}).status_code == 200
    d.refresh_from_db()
    assert d.status == Dispute.Status.LOST


def test_stripe_list_transactions_pages(gateway, attempt):
    from django.utils import timezone as tz

    pages = ([
        {"data": [{"id": "cs_1", "client_reference_id": "R1", "payment_status": "paid", "amount_total": 100, "currency": "usd"}], "has_more": True},
        {"data": [{"id": "cs_2", "client_reference_id": "R2", "payment_status": "unpaid", "status": "open", "amount_total": 200, "currency": "usd"}], "has_more": False},
    ])
    gateway.routes[("GET", "/checkout/sessions")] = pages
    out = get_provider("stripe").list_transactions(tz.now(), tz.now())
    assert [(t["reference"], t["status"]) for t in out] == [("R1", "succeeded"), ("R2", "pending")]


def test_stripe_needs_key(settings):
    settings.PAYMENT_PROVIDERS_ENABLED = ["stripe"]
    settings.STRIPE_SECRET_KEY = ""
    with pytest.raises(ProviderError, match="STRIPE_SECRET_KEY"):
        get_provider("stripe")._auth()


# ------------------------------------------------------------------ Flutterwave


def test_flutterwave_initiate_and_verify(gateway, attempt):
    gateway.routes[("POST", "/payments")] = {"status": "success", "data": {"link": "https://checkout.flutterwave.com/v3/hosted/pay/abc"}}
    p = get_provider("flutterwave")
    out = p.initiate(attempt, "a@b.com", "https://shop.test/checkout/complete")
    assert out["authorization_url"].endswith("/abc")
    sent = gateway.calls[-1][2]["json"]
    assert sent["tx_ref"] == attempt.reference and sent["amount"] == str(attempt.amount) and "reference=" in sent["redirect_url"]
    gateway.routes[("GET", "/transactions/verify_by_reference")] = {"status": "success", "data": {"id": 777, "status": "successful", "amount": 55, "currency": "GHS"}}
    v = p.verify(attempt)
    assert (v.status, v.amount, v.currency, v.provider_reference) == ("succeeded", Decimal("55.00"), "GHS", "777")
    gateway.routes[("GET", "/transactions/verify_by_reference")] = {"status": "error", "message": "No transaction"}
    assert p.verify(attempt).status == "pending"


def test_flutterwave_webhook_hash(gateway):
    body = json.dumps({"event": "charge.completed", "data": {"id": 5, "tx_ref": "R9", "status": "successful", "amount": 20, "currency": "NGN"}}).encode()
    p = get_provider("flutterwave")
    ev = p.parse_webhook(body, {"verif-hash": "hash-x"})
    assert (ev.reference, ev.status, ev.amount, ev.currency, ev.provider_reference) == ("R9", "succeeded", Decimal("20.00"), "NGN", "5")
    with pytest.raises(InvalidSignature):
        p.parse_webhook(body, {"verif-hash": "nope"})
    with pytest.raises(InvalidSignature):
        p.parse_webhook(body, {})


def _fw_chargeback(p, **data):
    body = json.dumps({"event": "chargeback.updated", "data": data}).encode()
    return p.parse_webhook(body, {"verif-hash": "hash-x"})


def test_flutterwave_chargeback_opens_a_dispute(gateway):
    # UNVERIFIED payload shape: built from Flutterwave's documentation, not from a real sandbox chargeback.
    ev = _fw_chargeback(get_provider("flutterwave"), id=91, status="pending", stage="initiated", tx_ref="R9", amount=20, currency="ghs", due_date="2026-12-01T00:00:00Z")
    assert ev.dispute["id"] == "91" and ev.dispute["resolved"] is False and ev.dispute["currency"] == "GHS"
    assert ev.reference == "R9" and ev.status == "pending" and ev.dispute["respond_by"].startswith("2026-12-01")


def test_flutterwave_chargeback_outcomes(gateway):
    p = get_provider("flutterwave")
    for status, final in [("won", True), ("lost", True), ("accepted", True), ("declined", False), ("pending", False)]:
        ev = _fw_chargeback(p, id=1, status=status, tx_ref="R9", amount=5, currency="GHS")
        assert ev.dispute["resolved"] is final and (ev.dispute["resolution"] == status if final else ev.dispute["resolution"] == "")


def test_flutterwave_chargeback_finds_the_payment_by_transaction_id(gateway, attempt):
    attempt.provider, attempt.provider_reference = "flutterwave", "777"
    attempt.save()
    ev = _fw_chargeback(get_provider("flutterwave"), id=2, status="pending", transaction_id=777, amount=5, currency="GHS")
    assert ev.reference == attempt.reference


def test_flutterwave_chargeback_end_to_end(gateway, attempt):
    from apps.payments.disputes import record_dispute
    from apps.payments.models import Dispute

    attempt.provider, attempt.provider_reference = "flutterwave", "777"
    attempt.save()
    p = get_provider("flutterwave")
    ev = _fw_chargeback(p, id=3, status="pending", stage="initiated", tx_ref=attempt.reference, amount=str(attempt.amount), currency="USD")
    record_dispute("flutterwave", ev.dispute, ev.reference)
    assert Dispute.objects.get().status == "open"
    ev = _fw_chargeback(p, id=3, status="lost", tx_ref=attempt.reference, amount=str(attempt.amount), currency="USD")
    record_dispute("flutterwave", ev.dispute, ev.reference)
    assert Dispute.objects.get().status == "lost"


def test_flutterwave_refund(gateway, attempt):
    gateway.routes[("GET", "/transactions/verify_by_reference")] = {"status": "success", "data": {"id": 777, "status": "successful", "amount": 55, "currency": "GHS"}}
    gateway.routes[("POST", "/transactions/777/refund")] = {"status": "success", "data": {"id": 42}}
    assert get_provider("flutterwave").refund(attempt, Decimal("10")) == "42"
    gateway.routes[("POST", "/transactions/777/refund")] = Resp({"status": "error", "message": "Insufficient balance"}, ok=False)
    with pytest.raises(ProviderError, match="Insufficient balance"):
        get_provider("flutterwave").refund(attempt, Decimal("10"))


def test_flutterwave_list_pages(gateway):
    from django.utils import timezone as tz

    pages = ([
        {"status": "success", "data": [{"tx_ref": "A", "status": "successful", "amount": 1, "currency": "GHS"}], "meta": {"page_info": {"total_pages": 2}}},
        {"status": "success", "data": [{"tx_ref": "B", "status": "failed", "amount": 2, "currency": "GHS"}], "meta": {"page_info": {"total_pages": 2}}},
    ])
    gateway.routes[("GET", "/transactions")] = pages
    out = get_provider("flutterwave").list_transactions(tz.now(), tz.now())
    assert [t["status"] for t in out] == ["succeeded", "failed"]


# ------------------------------------------------------------------ PayPal


def test_paypal_initiate_returns_approval_link(gateway, attempt):
    gateway.routes[("POST", "/v2/checkout/orders")] = {"id": "ORD1", "links": [{"rel": "self", "href": "x"}, {"rel": "payer-action", "href": "https://paypal.test/approve"}]}
    out = get_provider("paypal").initiate(attempt, "a@b.com", "https://shop.test/checkout/complete")
    assert out["authorization_url"] == "https://paypal.test/approve" and out["provider_reference"] == "ORD1"
    unit = gateway.calls[-1][2]["json"]["purchase_units"][0]
    assert unit["custom_id"] == attempt.reference and unit["amount"]["value"] == str(attempt.amount)


def test_paypal_verify_captures_an_approved_order(gateway, attempt):
    attempt.provider_reference = "ORD1"
    gateway.routes[("GET", "/v2/checkout/orders/ORD1")] = {"id": "ORD1", "status": "APPROVED", "purchase_units": [{"amount": {"value": "55.00", "currency_code": "USD"}}]}
    gateway.routes[("POST", "/v2/checkout/orders/ORD1/capture")] = {"id": "ORD1", "status": "COMPLETED", "purchase_units": [
        {"payments": {"captures": [{"id": "CAP1", "status": "COMPLETED", "amount": {"value": "55.00", "currency_code": "USD"}}]}}]}
    v = get_provider("paypal").verify(attempt)
    assert (v.status, v.amount, v.currency, v.provider_reference) == ("succeeded", Decimal("55.00"), "USD", "ORD1")
    assert any(c[0] == "POST" and c[1].endswith("/capture") for c in gateway.calls)


def test_paypal_verify_waits_for_approval(gateway, attempt):
    attempt.provider_reference = "ORD1"
    gateway.routes[("GET", "/v2/checkout/orders/ORD1")] = {"id": "ORD1", "status": "CREATED"}
    assert get_provider("paypal").verify(attempt).status == "pending"
    assert not any(c[1].endswith("/capture") for c in gateway.calls)


def paypal_headers():
    return {"paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://c", "paypal-transmission-id": "t1", "paypal-transmission-sig": "s", "paypal-transmission-time": "now"}


def test_paypal_webhook_verifies_with_paypal(gateway):
    body = json.dumps({"id": "WH-EV1", "event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": {
        "id": "CAP1", "custom_id": "REFX", "amount": {"value": "55.00", "currency_code": "USD"}, "supplementary_data": {"related_ids": {"order_id": "ORD1"}}}}).encode()
    p = get_provider("paypal")
    gateway.routes[("POST", "/v1/notifications/verify-webhook-signature")] = {"verification_status": "SUCCESS"}
    ev = p.parse_webhook(body, paypal_headers())
    assert (ev.reference, ev.status, ev.amount, ev.provider_reference) == ("REFX", "succeeded", Decimal("55.00"), "ORD1")
    sent = gateway.calls[-1][2]["json"]
    assert sent["webhook_id"] == "WH-1" and sent["transmission_id"] == "t1"
    gateway.routes[("POST", "/v1/notifications/verify-webhook-signature")] = {"verification_status": "FAILURE"}
    with pytest.raises(InvalidSignature):
        p.parse_webhook(body, paypal_headers())


def test_paypal_webhook_without_webhook_id_is_rejected(gateway, settings):
    settings.PAYPAL_WEBHOOK_ID = ""
    with pytest.raises(InvalidSignature):
        get_provider("paypal").parse_webhook(b"{}", paypal_headers())


def test_paypal_dispute_is_recorded(gateway, attempt):
    attempt.status = AttemptStatus.SUCCEEDED
    attempt.save()
    gateway.routes[("POST", "/v1/notifications/verify-webhook-signature")] = {"verification_status": "SUCCESS"}
    gateway.routes[("GET", "/v2/payments/captures/CAP1")] = {"id": "CAP1", "custom_id": attempt.reference}
    body = json.dumps({"id": "WH-D1", "event_type": "CUSTOMER.DISPUTE.CREATED", "resource": {
        "dispute_id": "PP-D-1", "status": "WAITING_FOR_SELLER_RESPONSE", "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "dispute_amount": {"value": "10.00", "currency_code": "USD"}, "seller_response_due_date": "2026-12-01T00:00:00.000Z",
        "disputed_transactions": [{"seller_transaction_id": "CAP1"}]}}).encode()
    ev = get_provider("paypal").parse_webhook(body, paypal_headers())
    assert ev.reference == attempt.reference
    assert ev.dispute["id"] == "PP-D-1" and ev.dispute["amount"] == Decimal("10.00") and ev.dispute["resolved"] is False


def test_paypal_refund_uses_capture_id(gateway, attempt):
    attempt.provider_reference = "ORD1"
    gateway.routes[("GET", "/v2/checkout/orders/ORD1")] = {"id": "ORD1", "purchase_units": [{"payments": {"captures": [{"id": "CAP1"}]}}]}
    gateway.routes[("POST", "/v2/payments/captures/CAP1/refund")] = {"id": "RF1"}
    assert get_provider("paypal").refund(attempt, Decimal("5")) == "RF1"
    assert gateway.calls[-1][2]["json"]["amount"] == {"value": "5.00", "currency_code": "USD"}


def test_paypal_uses_sandbox_unless_live(settings):
    from apps.payments.providers_extra import PayPalProvider

    settings.PAYPAL_ENV = "sandbox"
    assert "sandbox" in PayPalProvider().base_url
    settings.PAYPAL_ENV = "live"
    assert "sandbox" not in PayPalProvider().base_url


def test_paypal_bad_credentials(gateway):
    gateway.routes[("POST", "/v1/oauth2/token")] = Resp({"error": "invalid_client"}, ok=False)
    with pytest.raises(ProviderError, match="sign-in failed"):
        get_provider("paypal")._token()
