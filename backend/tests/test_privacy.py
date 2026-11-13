import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.orders.models import Order, OrderStatus
from apps.orders.services import transition
from apps.privacy.models import ConsentRecord, LegalPage
from apps.privacy.services import apply_retention

from .conftest import client_for, make_product
from .test_batch1 import pay

pytestmark = pytest.mark.django_db


def test_registration_requires_terms_and_records_consent(api):
    body = {"email": "new@example.com", "password": "Str0ng-pass-123", "full_name": "New"}
    assert api.post("/api/v1/auth/register/", body, format="json").status_code == 400
    assert api.post("/api/v1/auth/register/", {**body, "accept_terms": False}, format="json").status_code == 400
    r = api.post("/api/v1/auth/register/", {**body, "accept_terms": True, "marketing_opt_in": True}, format="json")
    assert r.status_code == 201
    kinds = set(User.objects.get(email="new@example.com").consents.values_list("kind", flat=True))
    assert kinds == {"terms", "privacy", "marketing"}


def test_marketing_toggle_is_recorded(customer):
    c = client_for(customer)
    assert c.post("/api/v1/consents/", {"kind": "marketing", "granted": True}, format="json").status_code == 200
    customer.refresh_from_db()
    assert customer.marketing_opt_in
    assert c.post("/api/v1/consents/", {"kind": "terms", "granted": True}, format="json").status_code == 400
    assert customer.consents.filter(kind="marketing").count() == 1


def test_export_contains_own_data_only(customer, other_customer, address):
    _, variant = make_product(name="Export Me", price="10.00", stock=5)
    pay(customer, address, variant, qty=1)
    r = client_for(customer).get("/api/v1/me/export/")
    assert r.status_code == 200 and "attachment" in r["Content-Disposition"]
    data = json.loads(r.content)
    assert data["profile"]["email"] == "buyer@example.com"
    assert len(data["orders"]) == 1 and data["orders"][0]["items"][0]["product"] == "Export Me"
    assert data["addresses"][0]["city"] == "Tamale"
    assert "other@example.com" not in r.content.decode()
    assert client_for(customer).get("/api/v1/me/export/").status_code == 200


def test_delete_needs_password_and_blocks_open_orders(customer, address):
    _, variant = make_product(name="Busy", price="10.00", stock=5)
    _, number = pay(customer, address, variant, qty=1)
    c = client_for(customer)
    assert c.post("/api/v1/me/delete/", {"password": "wrong"}, format="json").status_code == 400
    r = c.post("/api/v1/me/delete/", {"password": "Str0ng-pass-123"}, format="json")
    assert r.status_code == 400 and number in str(r.data)
    customer.refresh_from_db()
    assert customer.is_active


def test_delete_anonymises_but_keeps_orders(customer, address):
    _, variant = make_product(name="Done Deal", price="10.00", stock=5)
    _, number = pay(customer, address, variant, qty=1)
    order = Order.objects.get(number=number)
    for to in (OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED):
        transition(order, to)
    r = client_for(customer).post("/api/v1/me/delete/", {"password": "Str0ng-pass-123"}, format="json")
    assert r.status_code == 200
    customer.refresh_from_db()
    assert not customer.is_active and customer.email.endswith("@deleted.invalid") and customer.full_name == ""
    assert not customer.has_usable_password()
    assert not customer.addresses.exists()
    order.refresh_from_db()
    assert order.contact_email == "" and order.shipping_address.get("anonymised") and order.grand_total > 0
    assert User.objects.filter(pk=customer.pk).exists()


def test_staff_cannot_self_delete(admin):
    r = client_for(admin).post("/api/v1/me/delete/", {"password": "Str0ng-pass-123"}, format="json")
    assert r.status_code == 400


def test_pages_default_to_draft_then_publish_and_version(api, admin, customer):
    r = api.get("/api/v1/pages/privacy/")
    assert r.status_code == 200 and r.data["is_draft"] and "Wolbi" in r.data["body"]
    assert api.get("/api/v1/pages/nope/").status_code == 404
    assert len(api.get("/api/v1/pages/").data) == 4
    body = {"title": "Privacy policy", "body": "Our real policy.", "is_published": True}
    assert api.put("/api/v1/pages/privacy/", body, format="json").status_code == 403
    assert client_for(customer).put("/api/v1/pages/privacy/", body, format="json").status_code == 403
    assert client_for(admin).put("/api/v1/pages/privacy/", body, format="json").status_code == 200
    r = api.get("/api/v1/pages/privacy/")
    assert not r.data["is_draft"] and r.data["body"] == "Our real policy." and r.data["version"] == 1
    client_for(admin).put("/api/v1/pages/privacy/", {**body, "body": "Changed."}, format="json")
    assert LegalPage.objects.get(slug="privacy").version == 2


def test_retention_rules(customer):
    old = timezone.now() - timedelta(days=60)
    stale = User.objects.create_user(email="stale@example.com", password="Str0ng-pass-123")
    User.objects.filter(pk=stale.pk).update(date_joined=old)
    fresh = User.objects.create_user(email="fresh@example.com", password="Str0ng-pass-123")
    done = apply_retention()
    assert done["unverified_accounts"] == 1
    assert not User.objects.filter(email="stale@example.com").exists() and User.objects.filter(pk=fresh.pk).exists()


def test_old_orders_are_anonymised(customer, address):
    _, variant = make_product(name="Ancient", price="10.00", stock=5)
    _, number = pay(customer, address, variant, qty=1)
    Order.objects.filter(number=number).update(created_at=timezone.now() - timedelta(days=365 * 8))
    assert apply_retention()["old_orders"] == 1
    o = Order.objects.get(number=number)
    assert o.contact_email == "" and o.shipping_address["anonymised"]
    assert apply_retention()["old_orders"] == 0


def test_invoice_pdf_for_paid_orders_only(customer, other_customer, address):
    _, variant = make_product(name="Invoiced", price="10.00", stock=5)
    _, number = pay(customer, address, variant, qty=2)
    r = client_for(customer).get(f"/api/v1/orders/{number}/invoice/")
    assert r.status_code == 200 and r["Content-Type"] == "application/pdf" and r.content[:4] == b"%PDF"
    assert client_for(other_customer).get(f"/api/v1/orders/{number}/invoice/").status_code == 404
    Order.objects.filter(number=number).update(status=OrderStatus.PENDING_PAYMENT, paid_at=None)
    assert client_for(customer).get(f"/api/v1/orders/{number}/invoice/").status_code == 400


def test_emails_are_multipart_with_escaped_html(django_capture_on_commit_callbacks):
    from django.core import mail

    from apps.notifications.services import send_notification

    assert send_notification("support_reply", "a@example.com", {"case_number": "SC-1", "subject": "Hi", "body": "<script>x</script> thanks", "link": "https://shop.example/support/SC-1"})
    m = mail.outbox[-1]
    html = m.alternatives[0][0]
    assert m.alternatives[0][1] == "text/html"
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert 'href="https://shop.example/support/SC-1"' in html and "<script>" in m.body


def test_push_registration_and_delivery(customer, monkeypatch):
    from apps.notifications import push
    from apps.notifications.models import DeviceToken
    from apps.notifications.services import send_notification

    c = client_for(customer)
    assert c.post("/api/v1/notifications/devices/", {"token": "nope"}, format="json").status_code == 400
    tok = "ExponentPushToken[abc123]"
    assert c.post("/api/v1/notifications/devices/", {"token": tok, "platform": "ios"}, format="json").data == {"registered": True}

    calls = []

    class R:
        def raise_for_status(self): pass
        def json(self): return {"data": [{"status": "ok"}]}

    monkeypatch.setattr(push.requests, "post", lambda url, json=None, **k: calls.append(json) or R())
    send_notification("order_delivered", customer.email, {"order_number": "MP-9"})
    assert calls == []  # push is off until the customer allows it
    customer.notify_push = True
    customer.save()
    send_notification("order_delivered", customer.email, {"order_number": "MP-9"}, dedupe=False)
    assert calls[0][0]["to"] == tok and calls[0][0]["data"]["url"] == "mpanko://orders/MP-9"

    class Dead(R):
        def json(self): return {"data": [{"status": "error", "details": {"error": "DeviceNotRegistered"}}]}

    monkeypatch.setattr(push.requests, "post", lambda *a, **k: Dead())
    send_notification("order_delivered", customer.email, {"order_number": "MP-9"}, dedupe=False)
    assert not DeviceToken.objects.filter(token=tok).exists()
    assert c.delete("/api/v1/notifications/devices/", {"token": tok}, format="json").data == {"registered": False}


def test_cors_allows_idempotency_key_header(api):
    r = api.options("/api/v1/checkout/", HTTP_ORIGIN="http://localhost:5173", HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
                    HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type,idempotency-key")
    assert "idempotency-key" in r["access-control-allow-headers"]
