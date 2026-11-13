from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone

from apps.catalog.models import Inventory
from apps.orders.models import Order, OrderStatus
from apps.orders.services import transition
from apps.support.models import ReturnRequest

from .conftest import client_for, make_product
from .test_batch1 import pay

pytestmark = pytest.mark.django_db


@pytest.fixture
def delivered(customer, address):
    _, variant = make_product(name="Return Me", price="40.00", stock=10)
    _, number = pay(customer, address, variant, qty=3)
    order = Order.objects.get(number=number)
    for to in (OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED):
        transition(order, to)
    return Order.objects.get(number=number), variant


def ask(client, order, qty=1, reason="damaged", note=""):
    item = order.items.get()
    return client.post("/api/v1/returns/", {"order_number": order.number, "reason": reason, "note": note, "items": [{"order_item": item.id, "quantity": qty}]}, format="json")


def test_customer_requests_a_return_and_staff_complete_it(delivered, customer, admin, finance, fulfillment, django_capture_on_commit_callbacks):
    order, variant = delivered
    c = client_for(customer)
    elig = c.get(f"/api/v1/returns/eligibility/?order={order.number}")
    assert elig.data["eligible"] and elig.data["items"][0]["max"] == 3

    with django_capture_on_commit_callbacks(execute=True):
        r = ask(c, order, qty=2)
    assert r.status_code == 201 and r.data["status"] == "requested"
    number = r.data["number"]
    assert any("return request" in m.subject for m in mail.outbox)

    # Only 1 unit is left to return.
    assert ask(c, order, qty=2).status_code == 400

    staff = client_for(fulfillment)
    assert staff.post(f"/api/v1/returns/{number}/reject/", {}, format="json").status_code == 400  # reason required
    ok = staff.post(f"/api/v1/returns/{number}/approve/", {"staff_note": "Send it back"}, format="json")
    assert ok.status_code == 200 and Decimal(ok.data["refund_amount"]) == Decimal("80.00")
    assert staff.post(f"/api/v1/returns/{number}/refund/", {}, format="json").status_code == 403  # fulfilment cannot refund
    assert staff.post(f"/api/v1/returns/{number}/refund/", {}, format="json").status_code in (403, 400)

    before = Inventory.objects.get(variant=variant).quantity
    assert staff.post(f"/api/v1/returns/{number}/receive/", {"restock": True}, format="json").data["status"] == "received"
    assert Inventory.objects.get(variant=variant).quantity == before + 2

    fin = client_for(finance)
    with django_capture_on_commit_callbacks(execute=True):
        done = fin.post(f"/api/v1/returns/{number}/refund/", {}, format="json")
    assert done.status_code == 200 and done.data["status"] == "refunded"
    assert any("refund" in m.subject.lower() for m in mail.outbox)
    order.refresh_from_db()
    assert order.status == OrderStatus.DELIVERED  # partial refund leaves the order delivered


def test_rejected_return_frees_the_units_again(delivered, customer, fulfillment):
    order, _ = delivered
    c = client_for(customer)
    number = ask(c, order, qty=3).data["number"]
    assert ask(c, order, qty=1).status_code == 400
    client_for(fulfillment).post(f"/api/v1/returns/{number}/reject/", {"staff_note": "Used item"}, format="json")
    assert ask(c, order, qty=1).status_code == 201


def test_customer_can_cancel_but_only_their_own(delivered, customer, other_customer):
    order, _ = delivered
    number = ask(client_for(customer), order).data["number"]
    assert client_for(other_customer).post(f"/api/v1/returns/{number}/cancel/").status_code == 404
    assert client_for(customer).post(f"/api/v1/returns/{number}/cancel/").data["status"] == "cancelled"
    assert client_for(customer).post(f"/api/v1/returns/{number}/cancel/").status_code == 400


def test_window_and_delivery_rules(delivered, customer, settings):
    order, _ = delivered
    Order.objects.filter(pk=order.pk).update(updated_at=timezone.now() - timedelta(days=30))
    r = ask(client_for(customer), Order.objects.get(pk=order.pk))
    assert r.status_code == 400 and "return window" in str(r.data)
    settings.RETURN_WINDOW_DAYS = 60
    assert ask(client_for(customer), Order.objects.get(pk=order.pk)).status_code == 201


def test_undelivered_order_and_change_of_mind_setting(customer, address, settings):
    _, variant = make_product(name="Not Yet", stock=5)
    _, number = pay(customer, address, variant, qty=1)
    order = Order.objects.get(number=number)
    assert ask(client_for(customer), order).status_code == 400  # still paid, not delivered
    for to in (OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED):
        transition(order, to)
    settings.RETURN_ALLOW_CHANGED_MIND = False
    assert ask(client_for(customer), order, reason="changed_mind").status_code == 400
    assert ask(client_for(customer), order, reason="damaged").status_code == 201


def test_customers_cannot_see_or_act_on_others_returns_or_staff_actions(delivered, customer, other_customer):
    order, _ = delivered
    number = ask(client_for(customer), order).data["number"]
    assert client_for(other_customer).get(f"/api/v1/returns/{number}/").status_code == 404
    assert client_for(customer).post(f"/api/v1/returns/{number}/approve/", {}, format="json").status_code == 403
    assert client_for(other_customer).get("/api/v1/returns/").data["count"] == 0


def test_support_case_conversation(customer, fulfillment, admin, django_capture_on_commit_callbacks):
    c = client_for(customer)
    made = c.post("/api/v1/support/cases/", {"subject": "Where is my parcel?", "message": "It has been a week."}, format="json")
    assert made.status_code == 201 and made.data["status"] == "open"
    number = made.data["number"]
    staff = client_for(admin)
    assert client_for(fulfillment).post(f"/api/v1/support/cases/{number}/messages/", {"body": "hi"}, format="json").status_code == 403
    with django_capture_on_commit_callbacks(execute=True):
        r = staff.post(f"/api/v1/support/cases/{number}/messages/", {"body": "It ships tomorrow."}, format="json")
    assert r.data["status"] == "answered" and r.data["messages"][-1]["from_staff"]
    assert any(number in m.subject for m in mail.outbox)
    assert c.post(f"/api/v1/support/cases/{number}/messages/", {"body": "Thanks"}, format="json").data["status"] == "open"
    assert staff.post(f"/api/v1/support/cases/{number}/close/").data["status"] == "closed"
    assert c.post(f"/api/v1/support/cases/{number}/messages/", {"body": "more"}, format="json").status_code == 400


def test_support_case_privacy(customer, other_customer):
    number = client_for(customer).post("/api/v1/support/cases/", {"subject": "Private", "message": "x"}, format="json").data["number"]
    assert client_for(other_customer).get(f"/api/v1/support/cases/{number}/").status_code == 404
    assert client_for(other_customer).post("/api/v1/support/cases/", {"subject": "Mine", "message": "x", "order_number": "MP-NOPE"}, format="json").status_code == 404
