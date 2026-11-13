import pytest
from django.core import mail

from apps.accounts.models import AuditLog, Role, User

from .conftest import client_for, make_product, make_user
from .test_batch1 import pay

pytestmark = pytest.mark.django_db


def test_customers_list_and_detail(admin, customer, address, fulfillment):
    _, variant = make_product(name="Cust Item", stock=5)
    pay(customer, address, variant, qty=1)
    a = client_for(admin)
    lst = a.get("/api/v1/customers/?search=buyer")
    assert lst.status_code == 200 and lst.data["results"][0]["order_count"] == 1
    detail = a.get(f"/api/v1/customers/{customer.id}/")
    assert detail.data["orders"][0]["number"].startswith("MP-") and detail.data["addresses"]
    assert client_for(fulfillment).get("/api/v1/customers/").status_code == 403
    assert client_for(customer).get("/api/v1/customers/").status_code == 403
    assert not any(r["email"] == admin.email for r in a.get("/api/v1/customers/").data["results"])  # staff are not customers


def test_only_store_admin_switches_a_customer_off(admin, customer):
    support = make_user("help@example.com", Role.SUPPORT)
    assert client_for(support).patch(f"/api/v1/customers/{customer.id}/", {"is_active": False}, format="json").status_code == 403
    assert client_for(admin).patch(f"/api/v1/customers/{customer.id}/", {"is_active": False}, format="json").status_code == 200
    customer.refresh_from_db()
    assert not customer.is_active and AuditLog.objects.filter(action="customer.deactivate").exists()


def test_inviting_staff(admin, django_capture_on_commit_callbacks):
    a = client_for(admin)
    with django_capture_on_commit_callbacks(execute=True):
        r = a.post("/api/v1/staff/", {"email": "new@example.com", "full_name": "New Hire", "role": "fulfillment"}, format="json")
    assert r.status_code == 201
    user = User.objects.get(email="new@example.com")
    assert user.role == "fulfillment" and not user.has_usable_password()
    assert any("added to Mpanko" in m.subject for m in mail.outbox)
    assert a.post("/api/v1/staff/", {"email": "NEW@example.com", "role": "finance"}, format="json").status_code == 400
    assert a.post("/api/v1/staff/", {"email": "x@example.com", "role": "customer"}, format="json").status_code == 400


def test_role_limits(admin, customer):
    store = make_user("store@example.com", Role.STORE_ADMIN)
    s = client_for(store)
    assert s.post("/api/v1/staff/", {"email": "boss@example.com", "role": "store_admin"}, format="json").status_code == 400
    ok = s.post("/api/v1/staff/", {"email": "fin@example.com", "role": "finance"}, format="json")
    assert ok.status_code == 201
    assert s.patch(f"/api/v1/staff/{admin.id}/", {"is_active": False}, format="json").status_code == 403  # cannot touch the super admin
    assert s.patch(f"/api/v1/staff/{store.id}/", {"role": "finance"}, format="json").status_code == 400  # not yourself
    assert client_for(customer).get("/api/v1/staff/").status_code == 403
    assert client_for(make_user("ff@example.com", Role.FULFILLMENT)).get("/api/v1/staff/").status_code == 403


def test_changing_role_updates_and_audits(admin):
    staff = make_user("mover@example.com", Role.FULFILLMENT)
    from rest_framework.test import APIClient

    live = APIClient()
    token = live.post("/api/v1/auth/login/", {"email": "mover@example.com", "password": "Str0ng-pass-123"}, format="json").data["access"]
    live.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert live.get("/api/v1/auth/me/").status_code == 200
    r = client_for(admin).patch(f"/api/v1/staff/{staff.id}/", {"role": "support"}, format="json")
    assert r.status_code == 200 and r.data["role"] == "support"
    log = AuditLog.objects.get(action="staff.update")
    assert log.detail["role_from"] == "fulfillment" and log.detail["role_to"] == "support"
    off = client_for(admin).patch(f"/api/v1/staff/{staff.id}/", {"is_active": False}, format="json")
    assert off.status_code == 200
    assert live.get("/api/v1/auth/me/").status_code == 401  # switched-off staff are locked out with their real token


def test_audit_log_browser(admin, fulfillment):
    AuditLog.record(admin, "coupon.create", None, code="X")
    a = client_for(admin)
    r = a.get("/api/v1/audit/?search=coupon")
    assert r.status_code == 200 and r.data["results"][0]["actor_email"] == admin.email
    assert a.get("/api/v1/audit/?from=2999-01-01").data["count"] == 0
    assert client_for(fulfillment).get("/api/v1/audit/").status_code == 403
