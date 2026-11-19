"""Regression tests for the 2026-11 audit fixes."""
from apps.accounts.models import Role
from apps.orders.models import Order, OrderStatus
from apps.payments.models import AttemptStatus, PaymentAttempt

import pytest

pytestmark = pytest.mark.django_db

from .conftest import client_for, make_user, place_order, signed_mock_webhook


def _paid_order(customer, address, product, django_capture_on_commit_callbacks):
    _, variant = product
    c, r = place_order(customer, variant, address)
    number = r.json()["number"]
    pay = c.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        signed_mock_webhook(c, pay.json()["reference"])
    return c, number


def test_support_staff_cannot_cancel_a_paid_order(customer, address, product, django_capture_on_commit_callbacks):
    _, number = _paid_order(customer, address, product, django_capture_on_commit_callbacks)
    support = make_user("support@example.com", Role.SUPPORT)
    r = client_for(support).post(f"/api/v1/orders/{number}/cancel/", {"note": "x"}, format="json")
    assert r.status_code in (400, 403), r.content
    assert Order.objects.get(number=number).status == OrderStatus.PAID


def test_two_open_payment_attempts_for_one_order_are_not_allowed(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    number = r.json()["number"]
    a = c.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json")
    c.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json")
    open_attempts = PaymentAttempt.objects.filter(order__number=number, status=AttemptStatus.PENDING).count()
    assert a.status_code == 201 and open_attempts <= 1, open_attempts


def test_finance_staff_can_still_cancel_a_paid_order(customer, address, product, django_capture_on_commit_callbacks):
    _, number = _paid_order(customer, address, product, django_capture_on_commit_callbacks)
    finance = make_user("fin@example.com", Role.FINANCE)
    r = client_for(finance).post(f"/api/v1/orders/{number}/cancel/", {"note": "x"}, format="json")
    assert r.status_code in (200, 400), r.content
    assert r.status_code != 403


def test_a_retry_returns_the_same_attempt(customer, address, product):
    _, variant = product
    c, r = place_order(customer, variant, address)
    number = r.json()["number"]
    a = c.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json")
    b = c.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json")
    assert b.status_code == 200 and b.json()["reference"] == a.json()["reference"]


# --- second audit pass -------------------------------------------------------------------------------------------


def test_web_push_only_accepts_browser_push_services(customer):
    c = client_for(customer)
    keys = {"p256dh": "k", "auth": "a"}
    for bad in ("http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost/x",
                "https://fcm.googleapis.com.evil.example/x", "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"):
        assert c.post("/api/v1/notifications/web-push/", {"endpoint": bad, **keys}, format="json").status_code == 400, bad
    ok = c.post("/api/v1/notifications/web-push/", {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", **keys}, format="json")
    assert ok.status_code == 200
    ok = c.post("/api/v1/notifications/web-push/", {"endpoint": "https://updates.push.services.mozilla.com/wpush/v2/abc", **keys}, format="json")
    assert ok.status_code == 200


def test_unknown_stock_id_is_404_not_500():
    admin = make_user("store@example.com", Role.STORE_ADMIN)
    assert client_for(admin).get("/api/v1/inventory/999999/movements/").status_code == 404


def test_csv_export_guards_formulas_but_keeps_empty_cells():
    import csv, io
    from django.test import RequestFactory
    from rest_framework.request import Request
    from apps.reports.views import respond

    req = Request(RequestFactory().get("/x", {"export": "csv"}))
    resp = respond(req, "t", ["a", "b", "c", "d"], [{"a": "", "b": "=1+1", "c": "\tx", "d": "plain"}])
    row = list(csv.reader(io.StringIO(resp.content.decode())))[1]
    assert row == ["", "'=1+1", "'\tx", "plain"]


def test_registering_an_existing_email_looks_the_same_and_creates_nothing(customer):
    from apps.accounts.models import User

    api = client_for(customer).__class__()
    body = {"password": "Str0ng-pass-123", "accept_terms": True, "full_name": "Z"}
    fresh = api.post("/api/v1/auth/register/", {**body, "email": "fresh@example.com"}, format="json")
    dup = api.post("/api/v1/auth/register/", {**body, "email": customer.email}, format="json")
    assert fresh.status_code == dup.status_code == 201
    assert set(fresh.json()) == set(dup.json())
    assert User.objects.filter(email__iexact=customer.email).count() == 1


def test_account_locks_after_repeated_wrong_passwords(customer):
    from django.core.cache import cache

    cache.clear()
    api = client_for(customer).__class__()
    for _ in range(10):
        assert api.post("/api/v1/auth/login/", {"email": customer.email, "password": "wrong-pass-1"}, format="json").status_code == 401
    locked = api.post("/api/v1/auth/login/", {"email": customer.email, "password": "Str0ng-pass-123"}, format="json")
    assert locked.status_code == 429
    cache.clear()
    assert api.post("/api/v1/auth/login/", {"email": customer.email, "password": "Str0ng-pass-123"}, format="json").status_code == 200


def test_shipping_quote_caps_its_product_list():
    from rest_framework.test import APIClient

    many = ",".join(f"p{i}" for i in range(60))
    assert APIClient().get("/api/v1/shipping/quote/", {"country": "GH", "products": many}).status_code == 400


def test_failed_provider_refund_is_recorded_as_failed_and_can_be_retried(customer, address, product, django_capture_on_commit_callbacks, monkeypatch):
    from apps.payments import providers, services
    from apps.payments.models import Refund

    _, number = _paid_order(customer, address, product, django_capture_on_commit_callbacks)
    order = Order.objects.get(number=number)
    finance = make_user("fin2@example.com", Role.FINANCE)
    prov = providers.get_provider("mock")
    monkeypatch.setattr(type(prov), "refund", lambda self, attempt, amount, reason: (_ for _ in ()).throw(providers.ProviderError("down")))
    with pytest.raises(providers.ProviderError):
        services.issue_refund(order, None, "x", finance)
    assert list(Refund.objects.values_list("status", flat=True)) == ["failed"]
    monkeypatch.undo()
    refund = services.issue_refund(order, None, "x", finance)
    assert refund.status == "succeeded"
    order.refresh_from_db()
    assert order.status == OrderStatus.REFUNDED
