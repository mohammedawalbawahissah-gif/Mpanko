import pytest
from django.core import mail

from apps.accounts.models import Role
from apps.catalog.models import Inventory
from apps.notifications.models import EmailTemplate, NotificationLog
from apps.notifications.services import send_notification
from apps.orders.models import Order, OrderStatus
from apps.shipping.models import Carrier

from .conftest import client_for, make_product, make_user, place_order
from .test_orders_payments import paid_order

pytestmark = pytest.mark.django_db


# ---- Notification templates and delivery log (FR-NOT-03) ------------------------------------------------------

def test_templates_listed_for_admin_only(admin, customer, fulfillment):
    r = client_for(admin).get("/api/v1/notifications/templates/")
    assert r.status_code == 200 and {t["key"] for t in r.data} >= {"order_confirmation", "password_reset"}
    assert client_for(customer).get("/api/v1/notifications/templates/").status_code == 403
    assert client_for(fulfillment).get("/api/v1/notifications/templates/").status_code == 403


def test_admin_edits_template_and_it_is_used(admin):
    c = client_for(admin)
    r = c.put("/api/v1/notifications/templates/order_delivered/", {"subject": "Arrived: {{ order_number }}", "body": "Enjoy {{ order_number }}!"}, format="json")
    assert r.status_code == 200 and r.data["customised"] is True
    assert send_notification("order_delivered", "x@example.com", {"order_number": "MP-9"}, ref="MP-9")
    assert mail.outbox[-1].subject == "Arrived: MP-9" and mail.outbox[-1].body == "Enjoy MP-9!"
    # reset goes back to the built-in wording
    r = c.delete("/api/v1/notifications/templates/order_delivered/")
    assert r.data["customised"] is False


def test_broken_template_is_rejected(admin):
    r = client_for(admin).put("/api/v1/notifications/templates/order_delivered/", {"subject": "Hi", "body": "{% if %}"}, format="json")
    assert r.status_code == 400 and "body" in r.data
    assert not EmailTemplate.objects.exists()


def test_same_event_emails_once():
    assert send_notification("order_delivered", "x@example.com", {"order_number": "MP-1"}, ref="MP-1") is True
    assert send_notification("order_delivered", "x@example.com", {"order_number": "MP-1"}, ref="MP-1") is False
    assert len(mail.outbox) == 1


def test_turned_off_template_is_skipped_and_logged(admin):
    EmailTemplate.objects.create(key="order_delivered", subject="s", body="b", is_active=False)
    assert send_notification("order_delivered", "x@example.com", {}, ref="MP-2") is False
    assert NotificationLog.objects.get().status == "skipped" and not mail.outbox


def test_failed_send_is_logged_and_visible_to_staff(admin, settings, monkeypatch):
    def boom(*a, **k):
        raise OSError("smtp down")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", boom)
    assert send_notification("order_delivered", "x@example.com", {"order_number": "MP-3"}, ref="MP-3") is False
    r = client_for(admin).get("/api/v1/notifications/logs/?status=failed")
    assert r.status_code == 200 and r.data[0]["error"] == "smtp down" and r.data[0]["recipient"] == "x@example.com"


def test_test_send_goes_to_the_staff_member(admin):
    r = client_for(admin).post("/api/v1/notifications/templates/order_confirmation/test/")
    assert r.data == {"sent": True, "to": "admin@example.com"}
    assert mail.outbox[-1].to == ["admin@example.com"]


def test_payment_failure_emails_customer_once(customer, address, product, django_capture_on_commit_callbacks):
    from .conftest import signed_mock_webhook
    from .test_orders_payments import pay_start

    _, variant = product
    c, r = place_order(customer, variant, address)
    pay = pay_start(c, r.data["number"])
    with django_capture_on_commit_callbacks(execute=True):
        signed_mock_webhook(c, pay.data["reference"], status="failed", event_id="e-f1")
    assert [m.subject for m in mail.outbox if "did not go through" in m.subject] == [f"Payment for order {r.data['number']} did not go through"]


# ---- Low stock alerts (FR-CAT-06) -----------------------------------------------------------------------------

def test_low_stock_alert_fires_once_when_level_is_crossed(admin, django_capture_on_commit_callbacks):
    from apps.catalog.models import StockMovement, adjust_stock

    _, variant = make_product(name="Alert Item", stock=7)
    Inventory.objects.filter(variant=variant).update(low_stock_threshold=5)
    with django_capture_on_commit_callbacks(execute=True):
        adjust_stock(variant.id, -1, StockMovement.Reason.ADJUSTMENT)  # 6: still fine
    assert not mail.outbox
    with django_capture_on_commit_callbacks(execute=True):
        adjust_stock(variant.id, -1, StockMovement.Reason.ADJUSTMENT)  # 5: crosses
        adjust_stock(variant.id, -1, StockMovement.Reason.ADJUSTMENT)  # 4: already low, no second alert
    alerts = [m for m in mail.outbox if m.subject.startswith("Low stock")]
    assert len(alerts) == 1 and alerts[0].to == ["admin@example.com"]


def test_admin_can_set_threshold(admin):
    _, variant = make_product(name="T Item", stock=3)
    c = client_for(admin)
    r = c.patch(f"/api/v1/inventory/{variant.id}/threshold/", {"low_stock_threshold": 10}, format="json")
    assert r.status_code == 200 and r.data["is_low"] is True
    assert c.patch(f"/api/v1/inventory/{variant.id}/threshold/", {"low_stock_threshold": -1}, format="json").status_code == 400
    low = c.get("/api/v1/inventory/?low=1").data
    assert variant.sku in str(low)


# ---- Split shipments (FR-ORD-06) ------------------------------------------------------------------------------

def two_item_order(customer, address):
    _, variant = make_product(name="Split Item", stock=10)
    c, r = place_order(customer, variant, address, qty=3, key="split-1")
    return c, r, variant


def pay(customer, address, variant, qty=3):
    c, r = place_order(customer, variant, address, qty=qty, key="split-pay")
    from .conftest import signed_mock_webhook
    from .test_orders_payments import pay_start

    p = pay_start(c, r.data["number"])
    signed_mock_webhook(c, p.data["reference"], amount=r.data["grand_total"], currency="USD")
    return c, r.data["number"]


def test_order_ships_in_two_parcels_and_delivers_after_both(customer, address, fulfillment):
    _, variant = make_product(name="Split Two", stock=10)
    c, number = pay(customer, address, variant, qty=3)
    order = Order.objects.get(number=number)
    item = order.items.get()
    staff = client_for(fulfillment)
    carrier = Carrier.objects.create(name="Local", code="local")

    r1 = staff.post("/api/v1/shipments/", {"order_number": number, "carrier": carrier.id, "items": [{"order_item": item.id, "quantity": 2}]}, format="json")
    assert r1.status_code == 201 and r1.data["items"][0]["quantity"] == 2
    bad = staff.post("/api/v1/shipments/", {"order_number": number, "items": [{"order_item": item.id, "quantity": 2}]}, format="json")
    assert bad.status_code == 400  # only 1 unit left
    r2 = staff.post("/api/v1/shipments/", {"order_number": number, "carrier": carrier.id}, format="json")  # no items = the rest
    assert r2.status_code == 201 and r2.data["items"][0]["quantity"] == 1
    assert staff.post("/api/v1/shipments/", {"order_number": number}, format="json").status_code == 400  # nothing left

    staff.post(f"/api/v1/shipments/{r1.data['id']}/events/", {"status": "in_transit"}, format="json")
    staff.post(f"/api/v1/shipments/{r1.data['id']}/events/", {"status": "delivered"}, format="json")
    order.refresh_from_db()
    assert order.status == OrderStatus.SHIPPED  # second parcel still out
    staff.post(f"/api/v1/shipments/{r2.data['id']}/events/", {"status": "delivered"}, format="json")
    order.refresh_from_db()
    assert order.status == OrderStatus.DELIVERED


def test_dispatch_and_delivery_emails_sent_once(customer, address, fulfillment, django_capture_on_commit_callbacks):
    _, variant = make_product(name="Mail Item", stock=5)
    c, number = pay(customer, address, variant, qty=1)
    staff = client_for(fulfillment)
    s = staff.post("/api/v1/shipments/", {"order_number": number, "tracking_number": "T123"}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        staff.post(f"/api/v1/shipments/{s.data['id']}/events/", {"status": "in_transit", "external_id": "a"}, format="json")
        staff.post(f"/api/v1/shipments/{s.data['id']}/events/", {"status": "out_for_delivery", "external_id": "b"}, format="json")
        staff.post(f"/api/v1/shipments/{s.data['id']}/events/", {"status": "delivered", "external_id": "c"}, format="json")
    subjects = [m.subject for m in mail.outbox]
    assert sum("on its way" in x for x in subjects) == 1 and sum("was delivered" in x for x in subjects) == 1


def test_customer_can_turn_off_shipping_emails(customer, address, fulfillment, django_capture_on_commit_callbacks):
    customer.notify_order_emails = False
    customer.save()
    _, variant = make_product(name="Quiet Item", stock=5)
    c, number = pay(customer, address, variant, qty=1)
    staff = client_for(fulfillment)
    s = staff.post("/api/v1/shipments/", {"order_number": number}, format="json")
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        staff.post(f"/api/v1/shipments/{s.data['id']}/events/", {"status": "in_transit"}, format="json")
    assert not mail.outbox


# ---- Carrier accept / decline / proof of delivery (FR-SHP-08) -------------------------------------------------

def assigned_shipment(customer, address, fulfillment):
    _, variant = make_product(name="Carrier Item", stock=5)
    c, number = pay(customer, address, variant, qty=1)
    carrier = Carrier.objects.create(name="Partner", code="partner")
    cu = make_user("driver@example.com", Role.CARRIER)
    carrier.users.add(cu)
    s = client_for(fulfillment).post("/api/v1/shipments/", {"order_number": number, "carrier": carrier.id}, format="json")
    assert s.data["status"] == "assigned"
    return s.data["id"], cu


def test_carrier_accepts_then_delivers_with_proof(customer, address, fulfillment):
    sid, cu = assigned_shipment(customer, address, fulfillment)
    c = client_for(cu)
    assert c.post(f"/api/v1/shipments/{sid}/accept/").data["status"] == "accepted"
    assert c.post(f"/api/v1/shipments/{sid}/accept/").status_code == 400  # not twice
    assert c.post(f"/api/v1/shipments/{sid}/proof/", {}, format="json").status_code == 400  # recipient required
    r = c.post(f"/api/v1/shipments/{sid}/proof/", {"recipient_name": "Ama", "note": "Left with neighbour"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "delivered" and r.data["pod_recipient"] == "Ama" and r.data["delivered_at"]
    assert r.data["events"][0]["description"] == "Delivered. Received by Ama"


def test_carrier_decline_needs_reason_and_is_attributed(customer, address, fulfillment):
    sid, cu = assigned_shipment(customer, address, fulfillment)
    c = client_for(cu)
    assert c.post(f"/api/v1/shipments/{sid}/decline/", {}, format="json").status_code == 400
    r = c.post(f"/api/v1/shipments/{sid}/decline/", {"reason": "No capacity"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "declined"
    from apps.shipping.models import TrackingEvent

    assert TrackingEvent.objects.filter(shipment_id=sid, status="declined", actor=cu).exists()


def test_other_carriers_cannot_touch_the_shipment(customer, address, fulfillment):
    sid, _ = assigned_shipment(customer, address, fulfillment)
    stranger = make_user("other-driver@example.com", Role.CARRIER)
    assert client_for(stranger).post(f"/api/v1/shipments/{sid}/accept/").status_code == 404


# ---- Profile and preferences (FR-CUS-01) ------------------------------------------------------------------------

def test_customer_updates_profile_and_preferences(customer):
    c = client_for(customer)
    r = c.patch("/api/v1/auth/me/", {"full_name": "Ama Mensah", "phone": "+233 24 000 0000", "notify_sms": True, "preferred_currency": "ghs"}, format="json")
    assert r.status_code == 200 and r.data["preferred_currency"] == "GHS" and r.data["notify_sms"] is True
    assert c.patch("/api/v1/auth/me/", {"phone": "call me"}, format="json").status_code == 400
    assert c.patch("/api/v1/auth/me/", {"preferred_currency": "XXX"}, format="json").status_code == 400
    assert c.patch("/api/v1/auth/me/", {"role": "super_admin"}, format="json").data["role"] == "customer"


# ---- Payment states (FR-PAY-05) -----------------------------------------------------------------------------------

def _attempt(customer, address, product):
    from .test_orders_payments import pay_start

    _, variant = product
    c, r = place_order(customer, variant, address)
    pay = pay_start(c, r.data["number"])
    from apps.payments.models import PaymentAttempt

    return c, r.data["number"], PaymentAttempt.objects.get(reference=pay.data["reference"])


def test_every_state_change_is_audited(customer, address, product):
    from apps.payments.services import apply_result

    c, number, attempt = _attempt(customer, address, product)
    apply_result(attempt.reference, "failed")
    apply_result(attempt.reference, "failed")  # repeat is a no-op
    apply_result(attempt.reference, "succeeded", amount=attempt.amount, currency=attempt.currency)  # late success
    attempt.refresh_from_db()
    assert attempt.status == "succeeded"
    trail = list(attempt.status_events.values_list("from_status", "to_status"))
    assert trail == [("pending", "failed"), ("failed", "succeeded")]
    assert Order.objects.get(number=number).status == OrderStatus.PAID


def test_cancelled_and_expired_attempts_close_with_the_order(customer, address, product):
    from apps.orders.services import transition

    c, number, attempt = _attempt(customer, address, product)
    transition(Order.objects.get(number=number), OrderStatus.CANCELLED, note="Customer cancelled")
    attempt.refresh_from_db()
    assert attempt.status == "cancelled" and attempt.status_events.get().source == "order"


def test_reversal_after_payment_marks_attempt_and_order(customer, address, product):
    from apps.payments.services import apply_result

    c, number, attempt = _attempt(customer, address, product)
    apply_result(attempt.reference, "succeeded", amount=attempt.amount, currency=attempt.currency)
    apply_result(attempt.reference, "reversed")
    attempt.refresh_from_db()
    assert attempt.status == "reversed" and Order.objects.get(number=number).status == OrderStatus.REFUNDED
    apply_result(attempt.reference, "succeeded", amount=attempt.amount, currency=attempt.currency)  # closed for good
    attempt.refresh_from_db()
    assert attempt.status == "reversed"


def test_full_refund_moves_attempt_to_refunded(customer, address, product, admin):
    from apps.payments.services import issue_refund

    c, number, _ = (lambda r: r)(paid_order(customer, address, product[1]))
    order = Order.objects.get(number=number)
    issue_refund(order, None, "Customer request", admin)
    from apps.payments.models import PaymentAttempt

    a = PaymentAttempt.objects.get(order=order)
    assert a.status == "refunded" and a.status_events.last().source == "refund"


# ---- Checkout declarations (FR-CHK-03) ----------------------------------------------------------------------------

def _raw_checkout(customer, address, variant, **extra):
    c = client_for(customer)
    c.post("/api/v1/cart/items/", {"variant": variant.id, "quantity": 1}, format="json")
    service = "local-standard" if address.country == "GH" else "intl-standard"
    body = {"address_id": address.id, "shipping_service": service, "currency": "USD", **extra}
    return c.post("/api/v1/checkout/", body, format="json", HTTP_IDEMPOTENCY_KEY="decl-1")


def test_checkout_requires_terms(customer, address, product):
    r = _raw_checkout(customer, address, product[1])
    assert r.status_code == 400 and "accept_terms" in r.data


def test_international_checkout_requires_duties_acknowledgement(customer, us_address, product):
    r = _raw_checkout(customer, us_address, product[1], accept_terms=True)
    assert r.status_code == 400 and "duties_acknowledged" in r.data
    r = _raw_checkout(customer, us_address, product[1], accept_terms=True, duties_acknowledged=True, delivery_notes="Leave at door")
    assert r.status_code == 201 and r.data["duties_acknowledged"] is True and r.data["delivery_notes"] == "Leave at door"
    assert r.data["contact_phone"] == "+12025550100"


def test_domestic_checkout_needs_no_duties_and_phone_can_be_overridden(customer, address, product):
    r = _raw_checkout(customer, address, product[1], accept_terms=True, phone="+233 55 111 2222")
    assert r.status_code == 201 and r.data["contact_phone"] == "+233 55 111 2222"
    order = Order.objects.get(number=r.data["number"])
    assert order.terms_accepted_at and order.duties_acknowledged is False


# ---- Shipping zones, rate tables and blocked destinations (FR-SHP-02, FR-SHP-09) ----------------------------

def _zone(admin, **kw):
    c = client_for(admin)
    r = c.post("/api/v1/shipping/zones/", {"name": kw.get("name", "West Africa"), "countries": kw.get("countries", ["gh", "ng"])}, format="json")
    assert r.status_code == 201, r.data
    return c, r.data


def test_no_rate_tables_means_flat_rate_fallback(api):
    r = api.get("/api/v1/shipping/quote/?country=GH")
    assert [s["service_code"] for s in r.data["services"]] == ["local-standard"]


def test_zone_rates_replace_the_fallback_and_follow_weight(api, admin):
    c, zone = _zone(admin)
    assert zone["countries"] == ["GH", "NG"]
    for body in (
        {"zone": zone["id"], "service_code": "std", "service_name": "Standard", "base_price": "5.00", "price_per_kg": "2.00", "eta_days_min": 2, "eta_days_max": 4},
        {"zone": zone["id"], "service_code": "heavy", "service_name": "Heavy freight", "base_price": "40.00", "min_weight_grams": 20000},
    ):
        assert c.post("/api/v1/shipping/rates/", body, format="json").status_code == 201
    _, variant = make_product(name="Quote Item", stock=5)  # 300 g each
    slug = variant.product.slug
    r = api.get(f"/api/v1/shipping/quote/?country=NG&products={slug}:5")
    assert [(s["service_code"], s["price"]) for s in r.data["services"]] == [("std", "9.00")]  # 1500 g bills as 2 kg
    # Countries outside every zone are not offered anything
    assert api.get(f"/api/v1/shipping/quote/?country=US&products={slug}").data["services"] == []


def test_rest_of_world_zone_catches_everything_else(api, admin):
    c, _ = _zone(admin)
    r = c.post("/api/v1/shipping/zones/", {"name": "Rest of world", "countries": ["*"]}, format="json")
    c.post("/api/v1/shipping/rates/", {"zone": r.data["id"], "service_code": "intl", "service_name": "International", "base_price": "30"}, format="json")
    c.post("/api/v1/shipping/rates/", {"zone": _zone_id(c, "West Africa"), "service_code": "std", "service_name": "Standard", "base_price": "5"}, format="json")
    assert [s["service_code"] for s in api.get("/api/v1/shipping/quote/?country=US").data["services"]] == ["intl"]
    assert [s["service_code"] for s in api.get("/api/v1/shipping/quote/?country=GH").data["services"]] == ["std"]


def _zone_id(c, name):
    return next(z["id"] for z in c.get("/api/v1/shipping/zones/").data if z["name"] == name)


def test_blocked_destination_offers_nothing_and_blocks_checkout(api, admin, customer, product):
    c = client_for(admin)
    assert c.post("/api/v1/shipping/blocked/", {"country": "kp", "reason": "Not permitted"}, format="json").data["country"] == "KP"
    r = api.get("/api/v1/shipping/quote/?country=KP")
    assert r.data["services"] == [] and r.data["blocked_reason"] == "Not permitted"
    from apps.accounts.models import Address

    addr = Address.objects.create(user=customer, recipient_name="X", phone="+850", line1="1", city="P", country="KP")
    _, resp = place_order(customer, product[1], addr)
    assert resp.status_code == 400


def test_only_admins_change_shipping_rules(fulfillment, customer):
    f = client_for(fulfillment)
    assert f.get("/api/v1/shipping/zones/").status_code == 200
    assert f.post("/api/v1/shipping/zones/", {"name": "X", "countries": ["GH"]}, format="json").status_code == 403
    assert client_for(customer).get("/api/v1/shipping/zones/").status_code == 403


def test_rate_validation(admin):
    c, zone = _zone(admin)
    bad = c.post("/api/v1/shipping/rates/", {"zone": zone["id"], "service_code": "x", "service_name": "X", "base_price": "5", "min_weight_grams": 500, "max_weight_grams": 100}, format="json")
    assert bad.status_code == 400
    assert c.post("/api/v1/shipping/zones/", {"name": "Bad", "countries": ["Ghana"]}, format="json").status_code == 400


# ---- Product images (permanent storage, upload and delete) ---------------------------------------------------------

def _png(name="a.png", size=(4, 4)):
    import io

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, "red").save(buf, "PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


def test_admin_uploads_reorders_and_deletes_images(admin, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    product, _ = make_product(name="Pic Item")
    c = client_for(admin)
    url = f"/api/v1/products/{product.slug}/images/"
    r = c.post(url, {"image": _png(), "alt_text": "Front"}, format="multipart")
    assert r.status_code == 201 and r.data["alt_text"] == "Front" and r.data["position"] == 0
    r2 = c.post(url, {"image": _png("b.png")}, format="multipart")
    assert r2.data["position"] == 1
    assert c.patch(f"{url}{r2.data['id']}/", {"alt_text": "Back"}, format="json").data["alt_text"] == "Back"
    assert c.delete(f"{url}{r.data['id']}/").status_code == 204
    assert product.images.count() == 1


def test_bad_or_oversized_uploads_are_refused(admin, settings, tmp_path):
    from django.core.files.uploadedfile import SimpleUploadedFile

    settings.MEDIA_ROOT = tmp_path
    product, _ = make_product(name="Pic Item 2")
    c = client_for(admin)
    url = f"/api/v1/products/{product.slug}/images/"
    assert c.post(url, {"image": SimpleUploadedFile("x.png", b"not an image", content_type="image/png")}, format="multipart").status_code == 400
    big = SimpleUploadedFile("big.png", _png().read() + b"0" * (5 * 1024 * 1024), content_type="image/png")
    assert c.post(url, {"image": big}, format="multipart").status_code == 400


def test_customers_cannot_upload_images(customer, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    product, _ = make_product(name="Pic Item 3")
    assert client_for(customer).post(f"/api/v1/products/{product.slug}/images/", {"image": _png()}, format="multipart").status_code == 403


def test_check_email_command_sends():
    from django.core.management import call_command

    call_command("check_email", "owner@example.com")
    assert mail.outbox[-1].to == ["owner@example.com"]


# ---- Variants editor ---------------------------------------------------------------------------------------------

def test_admin_edits_and_turns_off_variants(admin):
    product, v1 = make_product(name="Var Item")
    c = client_for(admin)
    base = f"/api/v1/products/{product.slug}"
    r = c.post(f"{base}/variants/", {"sku": "VAR-L", "name": "Large", "attributes": {"Size": "L"}}, format="json")
    assert r.status_code == 201
    vid = r.data["id"]
    r = c.patch(f"{base}/variants/{vid}/", {"name": "Large (new)", "price_override": "55.00"}, format="json")
    assert r.status_code == 200 and r.data["name"] == "Large (new)" and r.data["price"] == "55.00"
    assert c.patch(f"{base}/variants/{vid}/", {"sku": v1.sku}, format="json").status_code == 400  # SKU already used
    r = c.delete(f"{base}/variants/{vid}/")
    assert r.status_code == 200 and r.data["is_active"] is False
    # the last active variant of a published product cannot be switched off
    assert c.delete(f"{base}/variants/{v1.id}/").status_code == 400
    assert c.patch(f"{base}/variants/99999/", {"name": "x"}, format="json").status_code == 404
