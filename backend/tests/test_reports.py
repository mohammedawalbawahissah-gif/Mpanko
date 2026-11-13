from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounts.models import Role
from apps.payments.models import PaymentAttempt
from apps.payments.providers import MockProvider

from .conftest import client_for, make_product, make_user, place_order
from .test_orders_payments import paid_order, pay_start

pytestmark = pytest.mark.django_db


def test_dashboard_is_role_specific(customer, admin, finance, fulfillment, address, product):
    _, variant = product
    paid_order(customer, address, variant)
    assert client_for(customer).get("/api/v1/reports/dashboard/").status_code == 403
    fin = client_for(finance).get("/api/v1/reports/dashboard/").data
    assert "sales_last_7_days" in fin and "to_ship" not in fin
    ful = client_for(fulfillment).get("/api/v1/reports/dashboard/").data
    assert ful["to_ship"] == 1 and "sales_last_7_days" not in ful
    full = client_for(admin).get("/api/v1/reports/dashboard/").data
    assert "sales_last_7_days" in full and "to_ship" in full


def test_sales_report_totals_and_permissions(customer, finance, fulfillment, address, product):
    _, variant = product
    _, number, _ = paid_order(customer, address, variant)
    rows = client_for(finance).get("/api/v1/reports/sales/").data["rows"]
    assert len(rows) == 1 and rows[0]["orders"] == 1 and Decimal(str(rows[0]["total"])) == Decimal("60.00") and rows[0]["currency"] == "USD"
    assert client_for(fulfillment).get("/api/v1/reports/sales/").status_code == 403
    assert client_for(make_user("s@example.com", Role.SUPPORT)).get("/api/v1/reports/payments/").status_code == 403
    assert client_for(finance).get("/api/v1/reports/sales/?from=bad").status_code == 400
    assert client_for(finance).get("/api/v1/reports/sales/?from=2030-01-01&to=2030-01-31").data["rows"] == []  # window respected
    assert client_for(finance).get("/api/v1/reports/sales/?from=2030-02-01&to=2030-01-01").status_code == 400  # reversed range


def test_csv_export_and_formula_injection_guard(customer, finance, address, product):
    product_obj, variant = make_product("=HYPERLINK(\"http://evil\")", stock=5)
    paid_order(customer, address, variant)
    r = client_for(finance).get("/api/v1/reports/orders/?export=csv")
    assert r.status_code == 200 and r["Content-Type"].startswith("text/csv")
    assert r.content.decode().splitlines()[0].startswith("number,created_at,status")
    # customer-controlled text starting with = + - @ is neutralised so it cannot execute when opened in a spreadsheet
    from apps.reports.views import respond
    from rest_framework.test import APIRequestFactory
    from rest_framework.request import Request
    req = Request(APIRequestFactory().get("/x/?export=csv"))
    out = respond(req, "t", ["v"], [{"v": "=1+1"}, {"v": "@cmd"}, {"v": "ok"}]).content.decode()
    assert "'=1+1" in out and "'@cmd" in out and "\nok" in out


def test_stock_report_low_filter(admin):
    make_product("Plenty", stock=100)
    make_product("Scarce", stock=2)
    rows = client_for(admin).get("/api/v1/reports/stock/?low=1").data["rows"]
    assert [r["product"] for r in rows] == ["Scarce"]


def test_shipping_report_requires_fulfilment_role(finance, fulfillment):
    assert client_for(finance).get("/api/v1/reports/shipping/").status_code == 403
    assert client_for(fulfillment).get("/api/v1/reports/shipping/").status_code == 200


# ---- Reconciliation -------------------------------------------------------------------------------------------------

def run_reconciliation(finance, ledger, monkeypatch):
    monkeypatch.setattr(MockProvider, "ledger", ledger)
    now = timezone.now()
    r = client_for(finance).post("/api/v1/payments/reconciliation/", {
        "provider": "mock", "start": (now - timedelta(days=1)).isoformat(), "end": (now + timedelta(hours=1)).isoformat(),
    }, format="json")
    assert r.status_code == 201
    return client_for(finance).get(f"/api/v1/payments/reconciliation/{r.data['id']}/").data


def test_reconciliation_finds_each_kind_of_discrepancy(customer, other_customer, address, product, finance, monkeypatch):
    from apps.accounts.models import Address
    _, variant = product
    addr2 = Address.objects.create(user=other_customer, recipient_name="B", phone="1", line1="x", city="Accra", country="GH")
    _, variant2 = make_product("Second", stock=5)
    _, variant3 = make_product("Third", stock=5)
    _, variant4 = make_product("Fourth", stock=5)

    # A: fully matched (paid both sides)
    _, num_a, ref_a = paid_order(customer, address, variant)
    # B: customer charged at the provider but our order is still pending (the costly one)
    c, r = place_order(other_customer, variant2, addr2, key="b")
    ref_b = pay_start(c, r.data["number"]).data["reference"]
    # C: we think it is paid, provider says it failed
    c3, r3 = place_order(customer, variant3, address, key="c")
    pay3 = pay_start(c3, r3.data["number"])
    from .conftest import signed_mock_webhook
    signed_mock_webhook(c3, pay3.data["reference"], amount=r3.data["grand_total"], currency="USD", event_id="e-c")
    ref_c = pay3.data["reference"]
    # D: amount differs at provider
    c4, r4 = place_order(other_customer, variant4, addr2, key="d")
    ref_d = pay_start(c4, r4.data["number"]).data["reference"]

    attempt_a = PaymentAttempt.objects.get(reference=ref_a)
    ledger = [
        {"reference": ref_a, "status": "succeeded", "amount": attempt_a.amount, "currency": "USD"},
        {"reference": ref_b, "status": "succeeded", "amount": Decimal(r.data["grand_total"]), "currency": "USD"},
        {"reference": ref_c, "status": "failed", "amount": Decimal(r3.data["grand_total"]), "currency": "USD"},
        {"reference": ref_d, "status": "succeeded", "amount": Decimal("1.00"), "currency": "USD"},
        {"reference": "MPK-UNKNOWNREF", "status": "succeeded", "amount": Decimal("9.99"), "currency": "USD"},
        {"reference": "OTHER-APP-123", "status": "succeeded", "amount": Decimal("5.00"), "currency": "USD"},  # not ours: ignored
    ]
    run = run_reconciliation(finance, ledger, monkeypatch)
    kinds = {rec["reference"]: rec["kind"] for rec in run["records"]}
    assert kinds[ref_b] == "paid_not_confirmed"
    assert kinds[ref_c] == "missing_at_provider"
    assert kinds[ref_d] == "paid_not_confirmed"  # provider charged; our attempt is still pending, so this takes priority
    assert kinds["MPK-UNKNOWNREF"] == "unknown_at_provider"
    assert ref_a not in kinds and "OTHER-APP-123" not in kinds
    assert run["matched"] == 1 and run["exceptions"] == 4


def test_amount_mismatch_on_confirmed_payment(customer, address, product, finance, monkeypatch):
    _, variant = product
    _, _, ref = paid_order(customer, address, variant)
    run = run_reconciliation(finance, [{"reference": ref, "status": "succeeded", "amount": Decimal("1.00"), "currency": "USD"}], monkeypatch)
    assert [r["kind"] for r in run["records"]] == ["amount_mismatch"]


def test_reconciliation_resolve_and_permissions(customer, address, product, finance, fulfillment, monkeypatch):
    run = run_reconciliation(finance, [{"reference": "MPK-GHOST", "status": "succeeded", "amount": Decimal("3.00"), "currency": "USD"}], monkeypatch)
    rec_id = run["records"][0]["id"]
    assert client_for(fulfillment).get("/api/v1/payments/reconciliation/").status_code == 403
    assert client_for(finance).post(f"/api/v1/payments/reconciliation/records/{rec_id}/resolve/", {}, format="json").status_code == 400  # note required
    done = client_for(finance).post(f"/api/v1/payments/reconciliation/records/{rec_id}/resolve/", {"note": "Test charge, refunded in Paystack"}, format="json")
    assert done.data["resolved"] is True
    assert client_for(finance).get("/api/v1/payments/reconciliation/").data[0]["unresolved"] == 0
    bad = client_for(finance).post("/api/v1/payments/reconciliation/", {"provider": "mock", "start": "2026-11-02T00:00:00Z", "end": "2026-11-01T00:00:00Z"}, format="json")
    assert bad.status_code == 400
