"""
Concurrency tests. SQLite cannot show row-lock behaviour, so these run only against PostgreSQL:

    set DATABASE_URL=postgres://user:pass@localhost:5432/mpanko_test
    python -m pytest tests/test_postgres_races.py

Each worker thread has its own database connection and its own customer, as real simultaneous requests would.
"""
import threading
from decimal import Decimal

import pytest
from django.db import connection, connections

from apps.accounts.models import Role
from apps.catalog.models import Inventory
from apps.orders.models import Order, OrderStatus
from apps.payments.models import PaymentAttempt, Refund
from apps.promotions.models import Coupon, CouponRedemption

from .conftest import (
    client_for,
    make_product,
    make_user,
    place_order,
    signed_mock_webhook,
)

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(connection.vendor != "postgresql", reason="needs PostgreSQL row locks"),
]


def run_together(jobs):
    """Run every job in its own thread, released at the same moment; return their results (or the exception raised)."""
    start, results = threading.Barrier(len(jobs)), [None] * len(jobs)

    def worker(i, job):
        try:
            start.wait(10)
            results[i] = job()
        except Exception as exc:  # noqa: BLE001
            results[i] = exc
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i, j)) for i, j in enumerate(jobs)]
    [t.start() for t in threads]
    [t.join(60) for t in threads]
    return results


def _checkout(user, variant, address, key, coupon=None):
    c = client_for(user)
    c.post("/api/v1/cart/items/", {"variant": variant.id, "quantity": 1}, format="json")
    body = {"address_id": address.id, "shipping_service": "local-standard", "currency": "USD", "accept_terms": True, "duties_acknowledged": True}
    if coupon:
        body["coupon_code"] = coupon
    return c.post("/api/v1/checkout/", body, format="json", HTTP_IDEMPOTENCY_KEY=key).status_code


def _buyers(n):
    from apps.accounts.models import Address

    out = []
    for i in range(n):
        u = make_user(f"racer{i}@example.com")
        a = Address.objects.create(user=u, recipient_name="R", line1="1 Road", city="Accra", country="GH", phone="+233201234567", region="Greater Accra", is_default=True)
        out.append((u, a))
    return out


def test_last_units_are_never_oversold():
    _, variant = make_product(stock=3)
    buyers = _buyers(8)
    results = run_together([lambda u=u, a=a, i=i: _checkout(u, variant, a, f"k{i}") for i, (u, a) in enumerate(buyers)])
    assert all(not isinstance(r, Exception) for r in results), results
    assert sorted(results).count(201) == 3, results
    assert Inventory.objects.get(variant=variant).quantity == 0
    assert Order.objects.filter(status=OrderStatus.PENDING_PAYMENT).count() == 3


def test_a_single_use_coupon_is_used_once():
    _, variant = make_product(stock=20)
    Coupon.objects.create(code="ONLYONE", kind="percent", value=10, max_uses=1, per_user_limit=None)
    buyers = _buyers(6)
    results = run_together([lambda u=u, a=a, i=i: _checkout(u, variant, a, f"c{i}", "ONLYONE") for i, (u, a) in enumerate(buyers)])
    assert all(not isinstance(r, Exception) for r in results), results
    assert CouponRedemption.objects.filter(coupon__code="ONLYONE").count() == 1, results


def test_simultaneous_payment_starts_open_one_attempt(customer, address, product):
    _, variant = product
    _c, r = place_order(customer, variant, address)
    number = r.json()["number"]

    def start():
        return client_for(customer).post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json").status_code

    results = run_together([start] * 6)
    assert all(not isinstance(x, Exception) and x in (200, 201) for x in results), results
    assert PaymentAttempt.objects.filter(order__number=number).count() == 1


def test_the_same_webhook_delivered_at_once_pays_the_order_once(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    number = r.json()["number"]
    ref = c.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json").json()["reference"]
    from rest_framework.test import APIClient

    results = run_together([lambda: signed_mock_webhook(APIClient(), ref).status_code] * 6)
    assert all(not isinstance(x, Exception) and x == 200 for x in results), results
    order = Order.objects.get(number=number)
    assert order.status == OrderStatus.PAID
    assert order.events.filter(to_status=OrderStatus.PAID).count() == 1


def test_simultaneous_refunds_never_exceed_what_was_paid(customer, address, product):
    from apps.payments import services

    _, variant = product
    c, r = place_order(customer, variant, address)
    number = r.json()["number"]
    ref = c.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json").json()["reference"]
    from rest_framework.test import APIClient

    signed_mock_webhook(APIClient(), ref)
    order = Order.objects.get(number=number)
    finance = make_user("fin@example.com", Role.FINANCE)
    half = (order.grand_total / 2).quantize(Decimal("0.01"))

    def refund():
        return services.issue_refund(Order.objects.get(pk=order.pk), half, "race", finance).status

    results = run_together([refund] * 5)
    ok = [x for x in results if x == "succeeded"]
    assert len(ok) <= 2, results
    total = sum(Refund.objects.filter(order=order, status="succeeded").values_list("amount", flat=True))
    assert total <= order.grand_total
