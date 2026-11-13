from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.models import Role
from apps.catalog.models import Inventory
from apps.orders.models import Order, OrderStatus
from apps.orders.services import expire_unpaid_orders
from apps.payments.models import PaymentAttempt, Refund, WebhookEvent
from apps.shipping.models import Carrier, Shipment

from .conftest import client_for, make_product, make_user, place_order, signed_mock_webhook

pytestmark = pytest.mark.django_db


def pay_start(client, order_number, key="pay-1"):
    return client.post("/api/v1/payments/initiate/", {"order_number": order_number, "provider": "mock"}, format="json", HTTP_IDEMPOTENCY_KEY=key)


# ---- Checkout --------------------------------------------------------------------------------------------

def test_checkout_totals_are_computed_by_server(customer, address, product):
    _, variant = product
    c = client_for(customer)
    c.post("/api/v1/cart/items/", {"variant": variant.id, "quantity": 2}, format="json")
    # Client tries to smuggle in its own prices — these fields are ignored.
    r = c.post("/api/v1/checkout/", {"address_id": address.id, "shipping_service": "local-standard", "currency": "USD", "grand_total": "1.00", "unit_price": "0.01", "accept_terms": True}, format="json", HTTP_IDEMPOTENCY_KEY="k1")
    assert r.status_code == 201
    assert r.data["subtotal"] == "100.00"          # 2 x 50.00
    assert r.data["shipping_total"] == "10.00"      # 30.00 flat / 3 for Ghana-local
    assert r.data["grand_total"] == "110.00"
    assert r.data["status"] == "pending_payment"


def test_checkout_in_ghana_cedis_converts_with_recorded_rate(customer, address, product):
    _, variant = product
    _, r = place_order(customer, variant, address, currency="GHS", service="local-standard")
    assert r.status_code == 201
    assert r.data["currency"] == "GHS" and r.data["subtotal"] == "500.00" and r.data["shipping_total"] == "100.00"
    assert "1 USD = 10" in r.data["fx_rate_note"]


def test_repeated_checkout_creates_one_order(customer, address, product):
    _, variant = product
    c, first = place_order(customer, variant, address, key="same")
    second = c.post("/api/v1/checkout/", {"address_id": address.id, "shipping_service": "intl-standard", "currency": "USD", "accept_terms": True, "duties_acknowledged": True}, format="json", HTTP_IDEMPOTENCY_KEY="same")
    assert first.status_code == 201 and second.status_code == 200
    assert first.data["number"] == second.data["number"]
    assert Order.objects.count() == 1
    assert Inventory.objects.get(variant=variant).quantity == 9  # stock reserved only once


def test_checkout_requires_idempotency_key_and_cart(customer, address):
    c = client_for(customer)
    assert c.post("/api/v1/checkout/", {"address_id": address.id, "shipping_service": "intl-standard"}, format="json").status_code == 400
    r = c.post("/api/v1/checkout/", {"address_id": address.id, "shipping_service": "intl-standard", "accept_terms": True, "duties_acknowledged": True}, format="json", HTTP_IDEMPOTENCY_KEY="k")
    assert r.status_code == 400 and "cart" in r.data


def test_restricted_destination_blocks_checkout(customer, us_address):
    _, variant = make_product("Restricted item", restricted=["US"])
    _, r = place_order(customer, variant, us_address)
    assert r.status_code == 400 and "address" in r.data
    assert Order.objects.count() == 0


def test_shipping_quote_respects_restrictions(api):
    product, _ = make_product("Restricted item", restricted=["US"])
    r = api.get(f"/api/v1/shipping/quote/?country=US&products={product.slug}")
    assert r.data["services"] == [] and r.data["restricted_products"] == ["Restricted item"]
    assert len(api.get("/api/v1/shipping/quote/?country=GH").data["services"]) == 1


def test_cannot_oversell(customer, other_customer, address):
    _, variant = make_product(stock=1)
    other_address = type(address).objects.create(user=other_customer, recipient_name="B", phone="1", line1="x", city="Accra", country="GH")
    _, first = place_order(customer, variant, address, key="a")
    _, second = place_order(other_customer, variant, other_address, key="b")
    assert first.status_code == 201
    assert second.status_code == 400 and "cart" in second.data
    assert Inventory.objects.get(variant=variant).quantity == 0


def test_unsupported_currency_and_service_rejected(customer, address, product):
    _, variant = product
    _, r = place_order(customer, variant, address, currency="JPY")
    assert r.status_code == 400
    _, r = place_order(customer, variant, address, service="teleport", key="k2")
    assert r.status_code == 400


# ---- Payments --------------------------------------------------------------------------------------------

def paid_order(customer, address, variant):
    c, r = place_order(customer, variant, address)
    pay = pay_start(c, r.data["number"])
    assert pay.status_code == 201
    resp = signed_mock_webhook(c, pay.data["reference"], amount=r.data["grand_total"], currency="USD")
    assert resp.status_code == 200
    return c, r.data["number"], pay.data["reference"]


def test_verified_payment_confirms_order_exactly_once(customer, address, product, django_capture_on_commit_callbacks):
    _, variant = product
    with django_capture_on_commit_callbacks(execute=True):
        c, number, ref = paid_order(customer, address, variant)
    order = Order.objects.get(number=number)
    assert order.status == OrderStatus.PAID and order.paid_at
    # Provider redelivers the same event several times.
    with django_capture_on_commit_callbacks(execute=True):
        for _ in range(3):
            assert signed_mock_webhook(c, ref, amount=str(order.grand_total), currency="USD").status_code == 200
    assert WebhookEvent.objects.count() == 1
    assert order.events.filter(to_status=OrderStatus.PAID).count() == 1
    assert len(mail.outbox) == 1  # one confirmation email, not four


def test_forged_webhook_cannot_mark_order_paid(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    pay = pay_start(c, r.data["number"])
    forged = c.post("/api/v1/payments/webhooks/mock/", data=b'{"event_id":"x","reference":"%s","status":"succeeded"}' % pay.data["reference"].encode(), content_type="application/json", HTTP_X_MOCK_SIGNATURE="deadbeef")
    assert forged.status_code == 401
    assert Order.objects.get(number=r.data["number"]).status == OrderStatus.PENDING_PAYMENT


def test_failed_payment_does_not_confirm_and_can_retry(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    pay = pay_start(c, r.data["number"])
    signed_mock_webhook(c, pay.data["reference"], status="failed", event_id="evt-fail")
    assert Order.objects.get(number=r.data["number"]).status == OrderStatus.PENDING_PAYMENT
    assert PaymentAttempt.objects.get(reference=pay.data["reference"]).status == "failed"
    assert pay_start(c, r.data["number"], key="pay-2").status_code == 201  # customer can try again


def test_amount_mismatch_never_confirms_order(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    pay = pay_start(c, r.data["number"])
    signed_mock_webhook(c, pay.data["reference"], amount="1.00", currency="USD", event_id="evt-short")
    assert Order.objects.get(number=r.data["number"]).status == OrderStatus.PENDING_PAYMENT
    assert PaymentAttempt.objects.get(reference=pay.data["reference"]).status == "mismatch"


def test_payment_initiation_is_idempotent_and_uses_server_amount(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    a = pay_start(c, r.data["number"], key="same")
    b = pay_start(c, r.data["number"], key="same")
    assert a.data["reference"] == b.data["reference"] and PaymentAttempt.objects.count() == 1
    assert a.data["amount"] == r.data["grand_total"]


def test_cannot_pay_someone_elses_order(customer, other_customer, address, product):
    _, variant = product
    _, r = place_order(customer, variant, address)
    assert pay_start(client_for(other_customer), r.data["number"]).status_code == 404


def test_customer_return_verifies_with_provider(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    pay = pay_start(c, r.data["number"])
    v = c.get(f"/api/v1/payments/verify/{pay.data['reference']}/")
    assert v.data["order_status"] == "paid"


def test_provider_must_support_order_currency(customer, address, product, settings):
    from apps.payments import providers
    _, variant = product
    c, r = place_order(customer, variant, address, currency="GHS", service="local-standard")
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock"]
    assert pay_start(c, r.data["number"]).status_code == 201  # mock supports GHS


def test_paystack_webhook_signature_round_trip(settings):
    import hashlib, hmac, json
    from apps.payments.providers import InvalidSignature, PaystackProvider

    settings.PAYSTACK_SECRET_KEY = "sk_test_abc"
    body = json.dumps({"event": "charge.success", "data": {"id": 99, "reference": "MPK-1", "amount": 5000, "currency": "GHS"}}).encode()
    good = hmac.new(b"sk_test_abc", body, hashlib.sha512).hexdigest()
    ev = PaystackProvider().parse_webhook(body, {"x-paystack-signature": good})
    assert ev.status == "succeeded" and ev.amount == Decimal("50.00") and ev.currency == "GHS"
    with pytest.raises(InvalidSignature):
        PaystackProvider().parse_webhook(body, {"x-paystack-signature": "bad"})
    settings.PAYSTACK_SECRET_KEY = ""
    with pytest.raises(InvalidSignature):
        PaystackProvider().parse_webhook(body, {"x-paystack-signature": good})


# ---- Lifecycle, refunds, cancellation ----------------------------------------------------------------------

def test_cancel_unpaid_order_releases_stock(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address, qty=3)
    assert Inventory.objects.get(variant=variant).quantity == 7
    assert c.post(f"/api/v1/orders/{r.data['number']}/cancel/").status_code == 200
    assert Inventory.objects.get(variant=variant).quantity == 10


def test_customer_cannot_cancel_paid_order(customer, address, product):
    _, variant = product
    c, number, _ = paid_order(customer, address, variant)
    assert c.post(f"/api/v1/orders/{number}/cancel/").status_code == 400


def test_expired_orders_release_stock(customer, address, product):
    _, variant = product
    _, r = place_order(customer, variant, address, qty=2)
    Order.objects.update(expires_at=timezone.now() - timezone.timedelta(minutes=1))
    assert expire_unpaid_orders() == 1
    assert Order.objects.get().status == OrderStatus.EXPIRED
    assert Inventory.objects.get(variant=variant).quantity == 10


def test_invalid_transitions_rejected(customer, address, product, fulfillment):
    _, variant = product
    _, r = place_order(customer, variant, address)
    f = client_for(fulfillment)
    assert f.post(f"/api/v1/orders/{r.data['number']}/transition/", {"to": "shipped"}, format="json").status_code == 400
    assert f.post(f"/api/v1/orders/{r.data['number']}/transition/", {"to": "paid"}, format="json").status_code == 400  # payment states are not settable by hand


def test_customers_only_see_their_own_orders(customer, other_customer, address, product):
    _, variant = product
    _, r = place_order(customer, variant, address)
    assert client_for(other_customer).get(f"/api/v1/orders/{r.data['number']}/").status_code == 404
    assert client_for(other_customer).get("/api/v1/orders/").data["results"] == []
    assert client_for(customer).get("/api/v1/orders/").data["count"] == 1


def test_finance_can_refund_and_support_cannot(customer, address, product, finance):
    _, variant = product
    _, number, _ = paid_order(customer, address, variant)
    support = make_user("support@example.com", Role.SUPPORT)
    assert client_for(support).post("/api/v1/payments/refunds/", {"order_number": number}, format="json").status_code == 403
    assert client_for(customer).post("/api/v1/payments/refunds/", {"order_number": number}, format="json").status_code == 403
    partial = client_for(finance).post("/api/v1/payments/refunds/", {"order_number": number, "amount": "30.00", "reason": "damaged"}, format="json")
    assert partial.status_code == 201 and Order.objects.get(number=number).status == OrderStatus.PAID
    too_much = client_for(finance).post("/api/v1/payments/refunds/", {"order_number": number, "amount": "999.00"}, format="json")
    assert too_much.status_code == 400
    rest = client_for(finance).post("/api/v1/payments/refunds/", {"order_number": number}, format="json")
    assert rest.status_code == 201 and rest.data["amount"] == "30.00"  # 60.00 total - 30.00 already refunded
    assert Order.objects.get(number=number).status == OrderStatus.REFUNDED
    assert Refund.objects.count() == 2


# ---- Shipping and carrier isolation ----------------------------------------------------------------------

def test_shipment_flow_updates_order_and_dedupes_events(customer, address, product, fulfillment):
    _, variant = product
    _, number, _ = paid_order(customer, address, variant)
    f = client_for(fulfillment)
    carrier = Carrier.objects.create(name="DHL", code="dhl")
    r = f.post("/api/v1/shipments/", {"order_number": number, "carrier": carrier.id, "tracking_number": "TRK123"}, format="json")
    assert r.status_code == 201
    assert Order.objects.get(number=number).status == OrderStatus.PROCESSING
    ev = {"status": "in_transit", "description": "Left facility", "external_id": "e1"}
    assert f.post(f"/api/v1/shipments/{r.data['id']}/events/", ev, format="json").status_code == 201
    assert f.post(f"/api/v1/shipments/{r.data['id']}/events/", ev, format="json").status_code == 200  # duplicate ignored
    assert Order.objects.get(number=number).status == OrderStatus.SHIPPED
    f.post(f"/api/v1/shipments/{r.data['id']}/events/", {"status": "delivered", "external_id": "e2"}, format="json")
    assert Order.objects.get(number=number).status == OrderStatus.DELIVERED
    # Customer can see tracking on their own order, without internal fields.
    seen = client_for(customer).get(f"/api/v1/orders/{number}/").data["shipments"][0]
    assert seen["tracking_number"] == "TRK123" and len(seen["events"]) == 2 and "override_reason" not in seen


def test_unpaid_order_cannot_be_shipped(customer, address, product, fulfillment):
    _, variant = product
    _, r = place_order(customer, variant, address)
    assert client_for(fulfillment).post("/api/v1/shipments/", {"order_number": r.data["number"]}, format="json").status_code == 400


def test_override_requires_reason(customer, address, product, fulfillment):
    _, variant = product
    _, number, _ = paid_order(customer, address, variant)
    f = client_for(fulfillment)
    no_reason = f.post("/api/v1/shipments/", {"order_number": number, "service_name": "DHL Express"}, format="json")
    assert no_reason.status_code == 400
    ok = f.post("/api/v1/shipments/", {"order_number": number, "service_name": "DHL Express", "override_reason": "Customer asked for faster"}, format="json")
    assert ok.status_code == 201


def test_carrier_user_sees_only_own_shipments(customer, address, product, fulfillment):
    _, variant = product
    _, number, _ = paid_order(customer, address, variant)
    dhl, ups = Carrier.objects.create(name="DHL", code="dhl"), Carrier.objects.create(name="UPS", code="ups")
    dhl_user, ups_user = make_user("dhl@example.com", Role.CARRIER), make_user("ups@example.com", Role.CARRIER)
    dhl.users.add(dhl_user)
    ups.users.add(ups_user)
    r = client_for(fulfillment).post("/api/v1/shipments/", {"order_number": number, "carrier": dhl.id}, format="json")
    sid = r.data["id"]
    assert [s["id"] for s in client_for(dhl_user).get("/api/v1/shipments/").data["results"]] == [sid]
    assert client_for(ups_user).get("/api/v1/shipments/").data["results"] == []
    assert client_for(ups_user).get(f"/api/v1/shipments/{sid}/").status_code == 404
    assert client_for(ups_user).post(f"/api/v1/shipments/{sid}/events/", {"status": "delivered"}, format="json").status_code == 404
    assert client_for(dhl_user).post(f"/api/v1/shipments/{sid}/events/", {"status": "accepted"}, format="json").status_code == 201
    assert client_for(customer).get("/api/v1/shipments/").data["results"] == []
    assert client_for(dhl_user).get("/api/v1/orders/").data["results"] == []  # carriers get no order access beyond shipments
