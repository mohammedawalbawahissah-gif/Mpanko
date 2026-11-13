from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.promotions.models import Coupon

from .conftest import client_for, make_product

pytestmark = pytest.mark.django_db


def go(user, variant, address, code="", qty=1, key="k1", currency="USD"):
    c = client_for(user)
    c.post("/api/v1/cart/items/", {"variant": variant.id, "quantity": qty}, format="json")
    service = "local-standard" if address.country == "GH" else "intl-standard"
    body = {"address_id": address.id, "shipping_service": service, "currency": currency, "accept_terms": True, "duties_acknowledged": True}
    if code:
        body["coupon_code"] = code
    return c, c.post("/api/v1/checkout/", body, format="json", HTTP_IDEMPOTENCY_KEY=key)


def coupon(**kw):
    kw.setdefault("code", "WELCOME10")
    kw.setdefault("kind", "percent")
    kw.setdefault("value", Decimal("10"))
    return Coupon.objects.create(**kw)


def test_percent_code_reduces_total_and_is_recorded(customer, address):
    coupon()
    _, variant = make_product(price="100.00", stock=5)
    _, r = go(customer, variant, address, "welcome10", qty=2)
    assert r.status_code == 201
    assert Decimal(r.data["discount_total"]) == Decimal("20.00") and r.data["coupon_code"] == "WELCOME10"
    assert Decimal(r.data["grand_total"]) == Decimal("200.00") - Decimal("20.00") + Decimal(r.data["shipping_total"])


def test_fixed_free_shipping_and_cap(customer, address):
    coupon(code="FIVE", kind="fixed", value=Decimal("5"))
    coupon(code="SHIPFREE", kind="free_shipping", value=0)
    coupon(code="CAPPED", kind="percent", value=Decimal("50"), max_discount=Decimal("8"))
    _, variant = make_product(price="40.00", stock=9)
    assert Decimal(go(customer, variant, address, "FIVE", key="a")[1].data["discount_total"]) == Decimal("5.00")
    r = go(customer, variant, address, "SHIPFREE", key="b")[1]
    assert Decimal(r.data["discount_total"]) == Decimal(r.data["shipping_total"]) > 0
    assert Decimal(r.data["grand_total"]) == Decimal(r.data["subtotal"])
    assert Decimal(go(customer, variant, address, "CAPPED", key="c")[1].data["discount_total"]) == Decimal("8.00")


def test_each_customer_can_use_a_code_once_by_default(customer, other_customer, address):
    coupon()
    _, variant = make_product(price="20.00", stock=9)
    assert go(customer, variant, address, "WELCOME10", key="1")[1].status_code == 201
    again = go(customer, variant, address, "WELCOME10", key="2")[1]
    assert again.status_code == 400 and "already used" in str(again.data)


def test_cancelled_orders_give_the_use_back(customer, address):
    coupon()
    _, variant = make_product(price="20.00", stock=9)
    c, r = go(customer, variant, address, "WELCOME10", key="1")
    c.post(f"/api/v1/orders/{r.data['number']}/cancel/")
    assert go(customer, variant, address, "WELCOME10", key="2")[1].status_code == 201


@pytest.mark.parametrize("kwargs,text", [
    ({"is_active": False}, "not valid"),
    ({"starts_at": timezone.now() + timedelta(days=1)}, "not active yet"),
    ({"ends_at": timezone.now() - timedelta(days=1)}, "expired"),
    ({"min_subtotal": Decimal("500")}, "at least"),
])
def test_invalid_codes_are_explained(customer, address, kwargs, text):
    coupon(**kwargs)
    _, variant = make_product(price="20.00", stock=9)
    r = go(customer, variant, address, "WELCOME10")[1]
    assert r.status_code == 400 and text in str(r.data)


def test_total_use_limit(customer, other_customer, address):
    coupon(max_uses=1, per_user_limit=None)
    _, variant = make_product(price="20.00", stock=9)
    assert go(customer, variant, address, "WELCOME10", key="1")[1].status_code == 201
    r = go(customer, variant, address, "WELCOME10", key="3")[1]
    assert r.status_code == 400 and "fully used" in str(r.data)


def test_unknown_code_does_not_create_an_order(customer, address):
    _, variant = make_product(price="20.00", stock=3)
    c, r = go(customer, variant, address, "NOPE")
    assert r.status_code == 400
    assert c.get("/api/v1/orders/").data["count"] == 0


def test_preview_endpoint(customer, address):
    coupon()
    _, variant = make_product(price="50.00", stock=3)
    c = client_for(customer)
    assert c.post("/api/v1/coupons/check/", {"code": "WELCOME10"}, format="json").status_code == 400  # empty bag
    c.post("/api/v1/cart/items/", {"variant": variant.id, "quantity": 2}, format="json")
    ok = c.post("/api/v1/coupons/check/", {"code": "welcome10", "currency": "GHS"}, format="json")
    assert ok.status_code == 200 and Decimal(ok.data["discount"]) == Decimal("100.00")  # 10% of 1000 GHS
    assert c.post("/api/v1/coupons/check/", {"code": "bad"}, format="json").status_code == 400


def test_admin_manages_codes(admin, customer, address):
    a = client_for(admin)
    made = a.post("/api/v1/coupons/", {"code": "spring-5", "kind": "fixed", "value": "5"}, format="json")
    assert made.status_code == 201 and made.data["code"] == "SPRING-5"
    assert a.post("/api/v1/coupons/", {"code": "SPRING-5", "kind": "fixed", "value": "5"}, format="json").status_code == 400
    assert a.post("/api/v1/coupons/", {"code": "PCT", "kind": "percent", "value": "150"}, format="json").status_code == 400
    assert client_for(customer).get("/api/v1/coupons/").status_code == 403
    _, variant = make_product(price="20.00", stock=3)
    go(customer, variant, address, "SPRING-5")
    assert a.delete(f"/api/v1/coupons/{made.data['id']}/").status_code == 400  # used: switch off instead
    assert a.patch(f"/api/v1/coupons/{made.data['id']}/", {"is_active": False}, format="json").status_code == 200
