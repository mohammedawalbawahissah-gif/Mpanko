"""Batch 8: endpoints and scheduled jobs that earlier suites did not exercise directly."""
from decimal import Decimal
from io import StringIO
from unittest import mock

import pytest
from django.core import mail
from django.core.management import call_command

from apps.catalog.models import Category
from apps.payments.models import PaymentAttempt, Refund
from .conftest import client_for, make_product, place_order

pytestmark = pytest.mark.django_db


# --- categories --------------------------------------------------------------------------------------------

def test_category_list_is_public(api, db):
    Category.objects.create(name="Textiles")
    Category.objects.create(name="Beauty")
    r = api.get("/api/v1/categories/")
    assert r.status_code == 200
    rows = r.data["results"] if isinstance(r.data, dict) else r.data
    assert {c["name"] for c in rows} == {"Textiles", "Beauty"}


def test_category_detail_and_no_public_writes(api, db):
    c = Category.objects.create(name="Textiles")
    assert api.get(f"/api/v1/categories/{c.pk}/").status_code == 200
    assert api.post("/api/v1/categories/", {"name": "Hacked"}, format="json").status_code in (401, 403)
    assert not Category.objects.filter(name="Hacked").exists()


# --- sign-out and email verification ----------------------------------------------------------------------

def test_logout_blacklists_the_refresh_token(api, customer):
    login = api.post("/api/v1/auth/login/", {"email": customer.email, "password": "Str0ng-pass-123"}, format="json")
    assert login.status_code == 200
    refresh = login.data["refresh"]
    assert api.post("/api/v1/auth/logout/", {"refresh": refresh}, format="json").status_code == 200
    assert api.post("/api/v1/auth/refresh/", {"refresh": refresh}, format="json").status_code == 401


def test_verification_email_is_sent_once_requested(customer):
    assert not customer.email_verified
    r = client_for(customer).post("/api/v1/auth/verify-email/request/", {}, format="json")
    assert r.status_code == 200
    assert len(mail.outbox) == 1
    assert customer.email in mail.outbox[0].to


def test_verification_request_for_a_verified_account_sends_nothing(customer):
    customer.email_verified = True
    customer.save()
    r = client_for(customer).post("/api/v1/auth/verify-email/request/", {}, format="json")
    assert r.status_code == 200
    assert mail.outbox == []


def test_verification_request_needs_sign_in(api, db):
    assert api.post("/api/v1/auth/verify-email/request/", {}, format="json").status_code == 401


# --- payment methods ---------------------------------------------------------------------------------------

def test_payment_methods_list_and_filter_by_currency(api, db):
    r = api.get("/api/v1/payments/methods/")
    assert r.status_code == 200
    assert [m["provider"] for m in r.data] == ["mock"]
    assert api.get("/api/v1/payments/methods/?currency=GHS").data
    assert api.get("/api/v1/payments/methods/?currency=ZZZ").data == []


# --- refund report -----------------------------------------------------------------------------------------

def _refunded_order(customer, address):
    _, variant = make_product()
    _, r = place_order(customer, variant, address)
    from apps.orders.models import Order

    order = Order.objects.get(number=r.data["number"])
    attempt = PaymentAttempt.objects.create(
        order=order, provider="mock", reference="ref-8", amount=order.grand_total, currency=order.currency, status="succeeded",
    )
    Refund.objects.create(attempt=attempt, order=order, amount=Decimal("5.00"), currency=order.currency, reason="=cmd|' /C calc'!A0", status="succeeded")
    return order


def test_refund_report_for_finance_and_csv_export(finance, customer, address):
    order = _refunded_order(customer, address)
    r = client_for(finance).get("/api/v1/reports/refunds/")
    assert r.status_code == 200
    assert r.data["count"] == 1
    assert r.data["rows"][0]["order"] == order.number
    csv = client_for(finance).get("/api/v1/reports/refunds/?export=csv")
    assert csv["Content-Type"].startswith("text/csv")
    body = csv.content.decode()
    assert order.number in body
    # A reason that looks like a spreadsheet formula is neutralised in the export.
    assert "'=cmd" in body


def test_refund_report_is_closed_to_customers_and_fulfilment(customer, fulfillment):
    assert client_for(customer).get("/api/v1/reports/refunds/").status_code == 403
    assert client_for(fulfillment).get("/api/v1/reports/refunds/").status_code == 403


# --- scheduled jobs and commands --------------------------------------------------------------------------

def test_retention_task_and_command_report_each_rule(db):
    from apps.privacy.tasks import run_retention

    counts = run_retention()
    assert isinstance(counts, dict) and counts
    out = StringIO()
    call_command("apply_retention", stdout=out)
    for rule in counts:
        assert f"{rule}:" in out.getvalue()


def test_fx_refresh_task_delegates_to_the_service(db):
    from apps.currency.tasks import refresh_fx_rates

    with mock.patch("apps.currency.tasks.refresh_live_rates", return_value=7) as svc:
        assert refresh_fx_rates() == 7
    svc.assert_called_once_with()


def test_seed_demo_is_repeatable(db):
    from apps.catalog.models import Product

    call_command("seed_demo", stdout=StringIO())
    first = Product.objects.count()
    assert first >= 4
    call_command("seed_demo", stdout=StringIO())
    assert Product.objects.count() == first
