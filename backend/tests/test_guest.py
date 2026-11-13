"""Guest checkout (FR-AUTH-05, FR-CHK-05): off by default, then signed links, payment and claiming by verified email."""
import re

import pytest
from django.core import mail
from django.core.signing import dumps
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tokens import email_verification_token
from apps.catalog.models import Inventory
from apps.orders.guest import SALT, make_token
from apps.orders.models import Order
from apps.promotions.models import Coupon

from .conftest import make_product, make_user, signed_mock_webhook

pytestmark = pytest.mark.django_db

GH_ADDRESS = {"recipient_name": "Ama Mensah", "phone": "+233200000000", "line1": "12 Market Rd", "city": "Tamale", "region": "Northern", "country": "GH"}


@pytest.fixture
def guest_on(settings):
    settings.GUEST_CHECKOUT_ENABLED = True
    settings.GUEST_ORDER_LINK_DAYS = 30
    settings.FRONTEND_URL = "https://shop.example"


def body(variant, **over):
    data = {
        "email": "guest@example.com", "items": [{"variant": variant.id, "quantity": 2}], "address": dict(GH_ADDRESS),
        "shipping_service": "local-standard", "currency": "USD", "accept_terms": True, "duties_acknowledged": True,
    }
    data.update(over)
    return data


def place(api, variant, key="g-1", **over):
    return api.post("/api/v1/checkout/guest/", body(variant, **over), format="json", HTTP_IDEMPOTENCY_KEY=key)


# --- off by default ------------------------------------------------------------------------------------------

def test_guest_checkout_is_closed_until_switched_on(api):
    _, variant = make_product()
    assert api.get("/api/v1/config/").data == {"guest_checkout": False}
    assert place(api, variant).status_code == 404
    assert api.get("/api/v1/orders/guest/MP-1/?token=x").status_code == 404
    assert api.post("/api/v1/orders/guest/lookup/", {"number": "MP-1", "email": "a@b.co"}, format="json").status_code == 404
    assert api.post("/api/v1/payments/guest/initiate/", {"order_number": "MP-1", "provider": "mock", "token": "x"}, format="json").status_code == 404
    assert Order.objects.count() == 0


def test_config_reports_when_it_is_on(api, guest_on):
    assert api.get("/api/v1/config/").data == {"guest_checkout": True}


# --- placing an order -----------------------------------------------------------------------------------------

def test_a_visitor_can_place_an_order_without_an_account(api, guest_on):
    _, variant = make_product(stock=10)
    r = place(api, variant)
    assert r.status_code == 201, r.data
    order = Order.objects.get(number=r.data["number"])
    assert order.user is None and order.contact_email == "guest@example.com"
    assert order.items.get().quantity == 2
    assert Inventory.objects.get(variant=variant).quantity == 8  # reserved like any other order
    assert r.data["guest_token"]
    assert not User.objects.filter(email="guest@example.com").exists()
    # The emailed link works for 30 days and carries the same token.
    link_mail = [m for m in mail.outbox if "without an account" in m.body]
    assert len(link_mail) == 1 and "https://shop.example/orders/guest/" in link_mail[0].body


def test_repeating_the_idempotency_key_does_not_create_a_second_order(api, guest_on):
    _, variant = make_product(stock=10)
    first = place(api, variant, key="same")
    second = place(api, variant, key="same")
    assert second.status_code == 200
    assert second.data["number"] == first.data["number"]
    assert Order.objects.count() == 1
    assert Inventory.objects.get(variant=variant).quantity == 8
    assert len([m for m in mail.outbox if "without an account" in m.body]) == 1


def test_the_same_key_from_a_different_email_is_a_different_order(api, guest_on):
    _, variant = make_product(stock=10)
    a = place(api, variant, key="k")
    b = place(api, variant, key="k", email="other@example.com")
    assert a.data["number"] != b.data["number"]


def test_checkout_problems_are_reported_per_field(api, guest_on):
    _, variant = make_product(stock=1)
    assert place(api, variant, accept_terms=False).data["accept_terms"]
    assert place(api, variant, items=[{"variant": variant.id, "quantity": 5}]).data["cart"]
    assert place(api, variant, items=[{"variant": 99999, "quantity": 1}]).data["cart"]
    assert place(api, variant, items=[]).status_code == 400
    assert place(api, variant, email="not-an-email").status_code == 400
    assert api.post("/api/v1/checkout/guest/", body(variant), format="json").status_code == 400  # no Idempotency-Key
    assert place(api, variant, shipping_service="made-up").data["shipping_service"]
    us = dict(GH_ADDRESS, country="US", region="TX", phone="+12025550100")  # no ZIP code
    assert "postal_code" in place(api, variant, address=us).data["address"]
    assert Order.objects.count() == 0


def test_a_code_limited_per_customer_needs_an_account(api, guest_on):
    _, variant = make_product(stock=10)
    Coupon.objects.create(code="ONCE", kind="percent", value=10, per_user_limit=1)
    r = place(api, variant, coupon_code="ONCE")
    assert r.status_code == 400 and "Sign in" in str(r.data["coupon_code"])
    Coupon.objects.create(code="OPEN", kind="percent", value=10, per_user_limit=None)
    assert place(api, variant, key="g-2", coupon_code="OPEN").status_code == 201


def test_signed_in_checkout_still_works_with_guest_checkout_on(customer, address, guest_on):
    from .conftest import place_order

    _, variant = make_product(stock=5)
    _, r = place_order(customer, variant, address)
    assert r.status_code == 201
    assert Order.objects.get(number=r.data["number"]).user == customer


# --- reaching the order ---------------------------------------------------------------------------------------

def test_the_link_opens_the_order_and_nothing_else_does(api, guest_on):
    _, variant = make_product(stock=10)
    r = place(api, variant)
    number, token = r.data["number"], r.data["guest_token"]
    ok = api.get(f"/api/v1/orders/guest/{number}/?token={token}")
    assert ok.status_code == 200 and ok.data["number"] == number
    assert api.get(f"/api/v1/orders/guest/{number}/").status_code == 404
    assert api.get(f"/api/v1/orders/guest/{number}/?token=garbage").status_code == 404
    other = place(api, variant, key="g-2", email="x@example.com").data
    assert api.get(f"/api/v1/orders/guest/{number}/?token={other['guest_token']}").status_code == 404  # another order's link
    forged = dumps({"n": number}, salt="some-other-salt")
    assert api.get(f"/api/v1/orders/guest/{number}/?token={forged}").status_code == 404


def test_an_old_link_stops_working(api, guest_on, settings):
    _, variant = make_product(stock=10)
    r = place(api, variant)
    settings.GUEST_ORDER_LINK_DAYS = -1
    assert api.get(f"/api/v1/orders/guest/{r.data['number']}/?token={r.data['guest_token']}").status_code == 404


def test_an_account_holders_order_is_not_reachable_by_link(api, customer, address, guest_on):
    from .conftest import place_order

    _, variant = make_product(stock=5)
    _, r = place_order(customer, variant, address)
    order = Order.objects.get(number=r.data["number"])
    assert api.get(f"/api/v1/orders/guest/{order.number}/?token={make_token(order)}").status_code == 404


# --- paying ---------------------------------------------------------------------------------------------------

def test_a_guest_can_pay_and_the_order_becomes_paid(api, guest_on):
    _, variant = make_product(stock=10)
    r = place(api, variant)
    number, token = r.data["number"], r.data["guest_token"]
    pay = api.post("/api/v1/payments/guest/initiate/", {"order_number": number, "provider": "mock", "token": token}, format="json", HTTP_IDEMPOTENCY_KEY="p-1")
    assert pay.status_code == 201, pay.data
    reference = pay.data["reference"]
    # Wrong or missing link: no payment, no information.
    bad = api.post("/api/v1/payments/guest/initiate/", {"order_number": number, "provider": "mock", "token": "nope"}, format="json")
    assert bad.status_code == 404
    assert api.get(f"/api/v1/payments/guest/verify/{reference}/?token=nope").status_code == 404
    assert signed_mock_webhook(APIClient(), reference).status_code == 200
    done = api.get(f"/api/v1/payments/guest/verify/{reference}/?token={token}")
    assert done.status_code == 200 and done.data["order_status"] == "paid"
    assert Order.objects.get(number=number).status == "paid"


def test_guest_payment_endpoints_do_not_touch_account_orders(api, customer, address, guest_on):
    from .conftest import place_order

    _, variant = make_product(stock=5)
    _, r = place_order(customer, variant, address)
    order = Order.objects.get(number=r.data["number"])
    res = api.post("/api/v1/payments/guest/initiate/", {"order_number": order.number, "provider": "mock", "token": make_token(order)}, format="json")
    assert res.status_code == 404


# --- find my order --------------------------------------------------------------------------------------------

def test_find_my_order_emails_a_fresh_link_only_for_a_match(api, guest_on):
    _, variant = make_product(stock=10)
    number = place(api, variant).data["number"]
    mail.outbox.clear()
    same = api.post("/api/v1/orders/guest/lookup/", {"number": number, "email": "GUEST@example.com"}, format="json")
    no = api.post("/api/v1/orders/guest/lookup/", {"number": number, "email": "wrong@example.com"}, format="json")
    unknown = api.post("/api/v1/orders/guest/lookup/", {"number": "MP-NOPE", "email": "guest@example.com"}, format="json")
    assert same.status_code == no.status_code == unknown.status_code == 200
    assert same.data == no.data == unknown.data  # nothing to learn from the reply
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["guest@example.com"]
    token = re.search(r"token=([^\s]+)", mail.outbox[0].body).group(1)
    assert api.get(f"/api/v1/orders/guest/{number}/?token={token}").status_code == 200


# --- turning a guest order into an account order --------------------------------------------------------------

def _verify(api, user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return api.post("/api/v1/auth/verify-email/confirm/", {"uid": uid, "token": email_verification_token.make_token(user)}, format="json")


def test_orders_move_into_the_account_once_the_email_is_verified(api, guest_on):
    _, variant = make_product(stock=10)
    number = place(api, variant, email="later@example.com").data["number"]
    user = make_user("later@example.com")
    assert Order.objects.get(number=number).user is None  # registering alone proves nothing
    assert _verify(api, user).status_code == 200
    assert Order.objects.get(number=number).user == user


def test_someone_elses_orders_are_not_claimed(api, guest_on):
    _, variant = make_product(stock=10)
    number = place(api, variant, email="owner@example.com").data["number"]
    user = make_user("someone-else@example.com")
    assert _verify(api, user).status_code == 200
    assert Order.objects.get(number=number).user is None
