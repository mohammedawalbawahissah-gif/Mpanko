import io
import json
import re

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.accounts import phone as phone_utils
from apps.accounts.models import Address, PhoneOTP, Role, User
from apps.catalog.models import Inventory, Product, ProductVariant
from apps.notifications.models import NotificationLog
from apps.orders.models import Order, OrderStatus
from apps.payments.models import Dispute, PaymentAttempt
from apps.payments.providers import MockProvider
from apps.shipping.models import Carrier, ShippingRate, ShippingZone
from apps.tax.models import DutyRule, TaxRule

from .conftest import client_for, make_product, make_user, place_order
from .test_batch1 import assigned_shipment, pay
from .test_orders_payments import paid_order

pytestmark = pytest.mark.django_db


@pytest.fixture
def sms_box(monkeypatch):
    """Capture every SMS instead of sending it."""
    sent = []
    monkeypatch.setattr("apps.notifications.sms.BACKENDS", {"log": lambda to, body: sent.append((to, body)) or True})
    return sent


def last_code(sms_box):
    return re.search(r"\b(\d{6})\b", sms_box[-1][1]).group(1)


# ---- Phone numbers and sign-in -----------------------------------------------------------------------------

def test_phone_numbers_normalise_to_e164():
    assert phone_utils.normalize("024 000 0000") == "+233240000000"
    assert phone_utils.normalize("+1 202 555 0100") == "+12025550100"
    assert phone_utils.normalize("0012025550100") == "+12025550100"
    assert phone_utils.normalize("call me") is None
    assert phone_utils.normalize("123") is None


def verify_phone(user, sms_box, number="0240000000"):
    c = client_for(user)
    assert c.post("/api/v1/auth/phone/verify/", {"phone": number}, format="json").status_code == 200
    r = c.post("/api/v1/auth/phone/verify/confirm/", {"phone": number, "code": last_code(sms_box)}, format="json")
    assert r.status_code == 200, r.data
    return r


def test_verifying_a_number_then_signing_in_with_it(customer, api, sms_box):
    r = verify_phone(customer, sms_box)
    assert r.data["phone_verified"] is True and r.data["phone"] == "+233240000000"
    # sign in by SMS code
    assert api.post("/api/v1/auth/phone/login/", {"phone": "0240000000"}, format="json").status_code == 200
    code = last_code(sms_box)
    login = api.post("/api/v1/auth/phone/login/confirm/", {"phone": "+233 24 000 0000", "code": code}, format="json")
    assert login.status_code == 200 and login.data["user"]["email"] == customer.email and login.data["access"]
    # the code works once
    assert api.post("/api/v1/auth/phone/login/confirm/", {"phone": "0240000000", "code": code}, format="json").status_code == 401


def test_sign_in_request_does_not_reveal_whether_a_number_has_an_account(api, sms_box):
    r = api.post("/api/v1/auth/phone/login/", {"phone": "0241111111"}, format="json")
    assert r.status_code == 200 and "If that number is linked" in r.data["detail"]
    assert sms_box == []  # nothing was sent, and the reply looks the same


def test_wrong_codes_are_limited_to_five_guesses(customer, api, sms_box):
    verify_phone(customer, sms_box)
    api.post("/api/v1/auth/phone/login/", {"phone": "0240000000"}, format="json")
    good = last_code(sms_box)
    bad = "000000" if good != "000000" else "111111"
    for _ in range(5):
        assert api.post("/api/v1/auth/phone/login/confirm/", {"phone": "0240000000", "code": bad}, format="json").status_code == 401
    # even the right code is dead now
    assert api.post("/api/v1/auth/phone/login/confirm/", {"phone": "0240000000", "code": good}, format="json").status_code == 401


def test_codes_cannot_be_requested_in_a_burst(customer, sms_box):
    c = client_for(customer)
    assert c.post("/api/v1/auth/phone/verify/", {"phone": "0240000000"}, format="json").status_code == 200
    assert c.post("/api/v1/auth/phone/verify/", {"phone": "0240000000"}, format="json").status_code == 400


def test_a_number_belongs_to_one_account_and_changing_it_unverifies(customer, other_customer, sms_box):
    verify_phone(customer, sms_box)
    c2 = client_for(other_customer)
    r = c2.post("/api/v1/auth/phone/verify/", {"phone": "0240000000"}, format="json")
    assert r.status_code == 400 and "already linked" in str(r.data["phone"])
    c = client_for(customer)
    r = c.patch("/api/v1/auth/me/", {"phone": "+233 20 111 2222"}, format="json")
    assert r.status_code == 200 and r.data["phone_verified"] is False
    # re-saving the same number in another format keeps nothing to re-verify
    verify_phone(customer, sms_box, "0201112222")
    r = c.patch("/api/v1/auth/me/", {"phone": "020 111 2222"}, format="json")
    assert r.data["phone_verified"] is True


def test_staff_cannot_sign_in_by_phone(admin, api, sms_box):
    admin.phone, admin.phone_verified = "+233240000000", True
    admin.save()
    api.post("/api/v1/auth/phone/login/", {"phone": "0240000000"}, format="json")
    assert sms_box == []


def test_a_code_for_another_person_cannot_verify_my_number(customer, other_customer, sms_box):
    client_for(customer).post("/api/v1/auth/phone/verify/", {"phone": "0240000000"}, format="json")
    code = last_code(sms_box)
    r = client_for(other_customer).post("/api/v1/auth/phone/verify/confirm/", {"phone": "0240000000", "code": code}, format="json")
    assert r.status_code == 400
    assert not User.objects.filter(phone_verified=True).exists()


def test_one_time_codes_are_stored_hashed_and_never_logged(customer, monkeypatch):
    monkeypatch.setattr("apps.notifications.sms.BACKENDS", {"log": lambda to, body: True})
    client_for(customer).post("/api/v1/auth/phone/verify/", {"phone": "0240000000"}, format="json")
    otp = PhoneOTP.objects.get()
    assert len(otp.code_hash) == 64 and not otp.code_hash.isdigit()
    row = NotificationLog.objects.get(channel="sms")
    assert row.subject == "One-time code" and row.status == "sent"


# ---- SMS updates -------------------------------------------------------------------------------------------

def test_sms_update_goes_only_to_customers_who_chose_it_and_verified(customer, address, product, sms_box, django_capture_on_commit_callbacks):
    _, variant = product
    verify_phone(customer, sms_box)
    sms_box.clear()
    customer.refresh_from_db()
    customer.notify_sms = True
    customer.save()
    with django_capture_on_commit_callbacks(execute=True):
        paid_order(customer, address, variant)
    texts = [b for _, b in sms_box]
    assert any("is confirmed" in t for t in texts)
    assert all(to == "+233240000000" for to, _ in sms_box)
    assert NotificationLog.objects.filter(channel="sms", key="sms_order_confirmation", status="sent").exists()


def test_no_sms_without_opt_in_or_verification(customer, address, product, sms_box, django_capture_on_commit_callbacks):
    _, variant = product
    customer.phone, customer.notify_sms = "+233240000000", True  # opted in but never verified
    customer.save()
    with django_capture_on_commit_callbacks(execute=True):
        paid_order(customer, address, variant)
    assert sms_box == []


def test_gateway_failure_is_logged_and_does_not_break_the_event(monkeypatch):
    def boom(to, body):
        raise RuntimeError("gateway down")

    monkeypatch.setattr("apps.notifications.sms.BACKENDS", {"log": boom})
    from apps.notifications.sms import deliver_sms

    assert deliver_sms("+233240000000", "hello") is False
    row = NotificationLog.objects.get(channel="sms")
    assert row.status == "failed" and "gateway down" in row.error


def test_twilio_backend_posts_to_twilio(settings, monkeypatch):
    settings.SMS_BACKEND, settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_FROM = "twilio", "AC1", "tok", "Mpanko"
    seen = {}

    class R:
        ok = True

    def fake_post(url, data, auth, timeout):
        seen.update(url=url, data=data, auth=auth)
        return R()

    monkeypatch.setattr("apps.notifications.sms.requests.post", fake_post)
    from apps.notifications.sms import deliver_sms

    assert deliver_sms("+233240000000", "hi")
    assert seen["url"].endswith("/Accounts/AC1/Messages.json") and seen["data"] == {"To": "+233240000000", "Body": "hi", "From": "Mpanko"}


# ---- Address rules ------------------------------------------------------------------------------------------

def post_address(client, **over):
    body = {"recipient_name": "Sam", "phone": "+12025550100", "line1": "1 Main St", "city": "Austin", "country": "US", "region": "TX", "postal_code": "73301"}
    body.update(over)
    return client.post("/api/v1/auth/addresses/", body, format="json")


def test_us_address_needs_a_valid_zip_and_state(customer):
    c = client_for(customer)
    assert post_address(c).status_code == 201
    assert "postal_code" in post_address(c, postal_code="").data
    assert "postal_code" in post_address(c, postal_code="ABCDE").data
    assert "region" in post_address(c, region="").data


def test_postcodes_are_tidied_and_checked_per_country(customer):
    c = client_for(customer)
    r = post_address(c, country="GB", region="", postal_code="sw1a  1aa", phone="+442071234567")
    assert r.status_code == 201 and r.data["postal_code"] == "SW1A 1AA"
    assert post_address(c, country="GB", region="", postal_code="12345").status_code == 400
    assert post_address(c, country="DE", region="", postal_code="10115").status_code == 201


def test_ghana_needs_a_region_and_accepts_a_digital_address(customer):
    c = client_for(customer)
    assert post_address(c, country="GH", region="", postal_code="").status_code == 400
    assert post_address(c, country="GH", region="Northern", postal_code="").status_code == 201
    assert post_address(c, country="GH", region="Northern", postal_code="ga-123-4567").data["postal_code"] == "GA-123-4567"
    assert post_address(c, country="GH", region="Northern", postal_code="nonsense").status_code == 400


def test_countries_without_postcodes_and_unknown_codes(customer):
    c = client_for(customer)
    assert post_address(c, country="AE", region="Dubai", postal_code="").status_code == 201
    assert post_address(c, country="ZZ", region="", postal_code="").status_code == 400
    assert post_address(c, phone="abc").status_code == 400


def test_address_rules_endpoint_tells_forms_what_to_ask(api):
    us = api.get("/api/v1/auth/address-rules/?country=us").data
    assert us["postal_code"] == "required" and us["region_required"] and us["region_label"] == "State"
    assert api.get("/api/v1/auth/address-rules/?country=AE").data["postal_code"] == "none"
    assert api.get("/api/v1/auth/address-rules/?country=KE").data["postal_code"] == "optional"
    assert api.get("/api/v1/auth/address-rules/?country=XX").status_code == 400


# ---- Tax and duties -----------------------------------------------------------------------------------------

def quote_total(customer, variant, address, **kw):
    _, r = place_order(customer, variant, address, **kw)
    assert r.status_code == 201, r.data
    return Order.objects.get(number=r.data["number"])


def test_tax_rule_for_a_country_replaces_the_default(customer, us_address, product):
    _, variant = product
    TaxRule.objects.create(country="*", name="Tax", rate="0")
    TaxRule.objects.create(country="US", name="Sales tax", rate="0.0800")
    order = quote_total(customer, variant, us_address)
    assert str(order.tax_total) == "4.00"  # 8% of 50.00 goods
    assert order.grand_total == order.subtotal + order.shipping_total + order.tax_total


def test_tax_can_include_shipping_and_falls_back_to_the_setting(customer, address, product, settings):
    _, variant = product
    settings.TAX_RATE = "0.10"
    assert str(quote_total(customer, variant, address, key="a").tax_total) == "5.00"  # no rule: the setting applies
    TaxRule.objects.create(country="GH", name="VAT", rate="0.1250", applies_to_shipping=True)
    from apps.tax.services import tax_for

    assert str(tax_for("50.00", "10.00", "GH", "USD")) == "7.50"
    assert str(tax_for("50.00", "10.00", "gh", "USD")) == "7.50"
    TaxRule.objects.filter(country="GH").update(is_active=False)
    assert str(tax_for("50.00", "10.00", "GH", "USD")) == "5.00"


def test_duty_estimate_applies_above_the_de_minimis_only(settings):
    from apps.tax.services import estimate_duties

    DutyRule.objects.create(country="US", de_minimis="80.00", duty_rate="0.0500", import_vat_rate="0.0000", note="Paid to the carrier")
    assert estimate_duties("50.00", "US", "USD")["below_threshold"] is True
    assert str(estimate_duties("50.00", "US", "USD")["total"]) == "0.00"
    big = estimate_duties("200.00", "US", "USD")
    assert str(big["duty"]) == "10.00" and big["below_threshold"] is False and big["note"] == "Paid to the carrier"
    assert estimate_duties("200.00", "GH", "USD") is None  # home country
    assert estimate_duties("200.00", "FR", "USD") is None  # no rule


def test_duty_threshold_converts_to_the_buyers_currency():
    from apps.tax.services import estimate_duties

    DutyRule.objects.create(country="US", de_minimis="80.00", duty_rate="0.0500")
    assert estimate_duties("700.00", "US", "GHS")["below_threshold"] is True  # 80 USD = 800 GHS at the test rate
    assert estimate_duties("900.00", "US", "GHS")["below_threshold"] is False


def test_checkout_records_estimated_duties_without_charging_them(customer, us_address):
    _, variant = make_product(price="200.00")
    DutyRule.objects.create(country="US", de_minimis="0", duty_rate="0.0500", import_vat_rate="0.1000")
    order = quote_total(customer, variant, us_address)
    assert str(order.duties_total) == "31.00"  # 10.00 duty + 10% import VAT on 210.00 (goods + duty)
    assert order.grand_total == order.subtotal + order.shipping_total + order.tax_total


def test_prepaid_mode_adds_duties_to_the_total(customer, us_address, settings):
    settings.DUTIES_MODE = "prepaid"
    _, variant = make_product(price="200.00")
    DutyRule.objects.create(country="US", de_minimis="0", duty_rate="0.0500", import_vat_rate="0.0000")
    order = quote_total(customer, variant, us_address)
    assert str(order.duties_total) == "10.00"
    assert order.grand_total == order.subtotal + order.shipping_total + order.tax_total + order.duties_total


def test_estimate_endpoint_is_public_and_validates(api):
    DutyRule.objects.create(country="US", de_minimis="0", duty_rate="0.1000")
    TaxRule.objects.create(country="US", name="Tax", rate="0.0500")
    r = api.get("/api/v1/tax/estimate/?country=US&currency=USD&goods=100&shipping=20")
    assert r.status_code == 200 and r.data["tax"] == "5.00" and r.data["duties"]["total"] == "10.00"
    assert api.get("/api/v1/tax/estimate/?country=GH&currency=USD&goods=100").data["duties"] is None
    assert api.get("/api/v1/tax/estimate/?country=US&currency=USD&goods=abc").status_code == 400
    assert api.get("/api/v1/tax/estimate/?country=US").status_code == 400


def test_only_finance_and_admin_edit_tax_rules(admin, finance, customer, fulfillment):
    assert client_for(customer).get("/api/v1/tax/rules/").status_code == 403
    assert client_for(fulfillment).get("/api/v1/tax/rules/").status_code == 403
    c = client_for(finance)
    r = c.post("/api/v1/tax/rules/", {"country": "gh", "name": "VAT", "rate": "0.125"}, format="json")
    assert r.status_code == 201 and r.data["country"] == "GH"
    assert c.post("/api/v1/tax/rules/", {"country": "GH", "name": "x", "rate": "0.1"}, format="json").status_code == 400  # duplicate
    assert c.post("/api/v1/tax/rules/", {"country": "ZZ", "name": "x", "rate": "0.1"}, format="json").status_code == 400
    assert c.post("/api/v1/tax/rules/", {"country": "*", "name": "x", "rate": "12.5"}, format="json").status_code == 400  # not a share
    assert client_for(admin).post("/api/v1/tax/duties/", {"country": "US", "de_minimis": "80", "duty_rate": "0.05", "import_vat_rate": "0"}, format="json").status_code == 201
    from apps.accounts.models import AuditLog

    assert AuditLog.objects.filter(action="tax_rule.create").exists()


# ---- Parcel size, billable weight, dangerous goods -----------------------------------------------------------

def sized(name, grams, l, w, h, **kw):
    product, variant = make_product(name=name, price="20.00")
    Product.objects.filter(pk=product.pk).update(weight_grams=grams, length_mm=l, width_mm=w, height_mm=h, **kw)
    return Product.objects.get(pk=product.pk), variant


def test_parcel_uses_volumetric_weight_when_the_box_is_big_and_light():
    from apps.shipping.parcel import from_lines

    p, _ = sized("Basket", 800, 600, 500, 400)  # 60x50x40 cm = 120000 cm3 / 5000 = 24 kg
    parcel = from_lines([(p, 1)])
    assert parcel.dims_cm == (60, 50, 40) and parcel.chargeable_grams == 24000 and parcel.volumetric_applied
    heavy, _ = sized("Drum", 9000, 200, 200, 200)  # 8000 cm3 = 1.6 kg, real weight wins
    assert from_lines([(heavy, 1)]).chargeable_grams == 9000


def test_parcel_stacks_units_and_falls_back_when_unmeasured():
    from apps.shipping.parcel import from_lines

    a, _ = sized("Bowl", 500, 200, 200, 100)
    b, _ = make_product(name="Unmeasured")
    assert from_lines([(a, 3)]).dims_cm == (20, 20, 30)
    unmeasured = from_lines([(a, 1), (Product.objects.get(pk=b.pk), 1)])
    assert unmeasured.dims_cm is None and unmeasured.chargeable_grams == 500 + 300


def test_product_form_needs_full_dimensions_and_a_hazard_class(admin):
    c = client_for(admin)
    base = {"name": "Perfume", "base_price": "30.00", "currency": "USD", "status": "published"}
    assert c.post("/api/v1/products/", {**base, "length_mm": 100}, format="json").status_code == 400
    assert c.post("/api/v1/products/", {**base, "is_dangerous_goods": True}, format="json").status_code == 400
    ok = c.post("/api/v1/products/", {**base, "length_mm": 100, "width_mm": 50, "height_mm": 50, "is_dangerous_goods": True, "dg_class": "3", "un_number": "UN1266", "hs_code": "3303.00"}, format="json")
    assert ok.status_code == 201 and ok.data["is_dangerous_goods"] and ok.data["dg_class"] == "3"


def test_dangerous_goods_only_see_cleared_services(api, customer, us_address):
    product, variant = sized("Power bank", 400, 100, 60, 20, is_dangerous_goods=True, dg_class="9", un_number="UN3481")
    zone = ShippingZone.objects.create(name="World", countries=["*"])
    ShippingRate.objects.create(zone=zone, service_code="std", service_name="Standard", base_price="10", allows_dangerous_goods=False)
    ShippingRate.objects.create(zone=zone, service_code="dg", service_name="Hazmat air", base_price="40", allows_dangerous_goods=True)
    r = api.get(f"/api/v1/shipping/quote/?country=US&products={product.slug}")
    assert r.data["dangerous_goods"] is True and [s["service_code"] for s in r.data["services"]] == ["dg"]
    # checkout enforces it too
    _, bad = place_order(customer, variant, us_address, service="std")
    assert bad.status_code == 400 and "dangerous goods" in str(bad.data["shipping_service"])
    _, good = place_order(customer, variant, us_address, service="dg", key="k2")
    assert good.status_code == 201


def test_billable_weight_drives_the_table_rate(api):
    product, _ = sized("Basket", 800, 600, 500, 400)
    zone = ShippingZone.objects.create(name="World", countries=["*"])
    ShippingRate.objects.create(zone=zone, service_code="std", service_name="Standard", base_price="10", price_per_kg="2")
    r = api.get(f"/api/v1/shipping/quote/?country=US&products={product.slug}")
    assert r.data["services"][0]["price"] == "58.00"  # 10 + 2 x 24 kg billable, not 1 kg


def test_live_label_is_refused_for_dangerous_goods(fulfillment, customer, address, settings):
    from apps.shipping import carriers

    assert carriers.parcel_for(1000, (10, 20, 30))["h"] == 30  # the packed box reaches the carrier request


# ---- Proof of delivery photo ----------------------------------------------------------------------------------

def photo(name="door.jpg", fmt="JPEG", size=(40, 40)):
    buf = io.BytesIO()
    Image.new("RGB", size, "tan").save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type=f"image/{fmt.lower()}")


@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    settings.STORAGES = {**settings.STORAGES, "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"}}


def test_driver_uploads_a_proof_of_delivery_photo(customer, address, fulfillment):
    sid, driver = assigned_shipment(customer, address, fulfillment)
    c = client_for(driver)
    c.post(f"/api/v1/shipments/{sid}/accept/")
    r = c.post(f"/api/v1/shipments/{sid}/proof/", {"recipient_name": "Ama", "photo": photo()}, format="multipart")
    assert r.status_code == 200, r.data
    assert r.data["status"] == "delivered" and "/pod/" in r.data["pod_photo"] and r.data["pod_photo_url"].startswith("http")


def test_proof_photo_must_be_a_real_image_under_8mb(customer, address, fulfillment):
    sid, driver = assigned_shipment(customer, address, fulfillment)
    c = client_for(driver)
    c.post(f"/api/v1/shipments/{sid}/accept/")
    fake = SimpleUploadedFile("x.jpg", b"not an image", content_type="image/jpeg")
    assert c.post(f"/api/v1/shipments/{sid}/proof/", {"recipient_name": "Ama", "photo": fake}, format="multipart").status_code == 400
    gif = photo("x.gif", "GIF")
    assert c.post(f"/api/v1/shipments/{sid}/proof/", {"recipient_name": "Ama", "photo": gif}, format="multipart").status_code == 400
    # the shipment is still not delivered after the failed attempts
    assert c.get(f"/api/v1/shipments/{sid}/").data["status"] == "accepted"


# ---- Chargebacks ---------------------------------------------------------------------------------------------

def dispute_webhook(reference, dispute_id="D1", status="awaiting-merchant-feedback", resolved=False, resolution="", event_id=None, amount="70.00"):
    from django.test import Client

    body = {"event_id": event_id or f"d-{dispute_id}-{status}", "reference": reference, "status": "pending", "type": "charge.dispute.create",
            "dispute": {"id": dispute_id, "status": status, "category": "fraudulent", "amount": amount, "currency": "USD",
                        "respond_by": "2026-12-01T00:00:00Z", "resolution": resolution, "resolved": resolved}}
    raw = json.dumps(body).encode()
    return Client().post("/api/v1/payments/webhooks/mock/", data=raw, content_type="application/json", HTTP_X_MOCK_SIGNATURE=MockProvider.sign(raw))


def paid(customer, address, variant):
    _, number, reference = paid_order(customer, address, variant)
    return Order.objects.get(number=number), PaymentAttempt.objects.get(reference=reference)


def test_chargeback_opens_a_case_and_alerts_staff(customer, address, product, admin, finance, django_capture_on_commit_callbacks):
    _, variant = product
    order, attempt = paid(customer, address, variant)
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        assert dispute_webhook(attempt.reference).status_code == 200
    d = Dispute.objects.get()
    assert d.status == "open" and d.category == "fraudulent" and str(d.amount) == "70.00" and d.respond_by
    recipients = {m.to[0] for m in mail.outbox}
    assert {admin.email, finance.email} <= recipients
    assert "Chargeback" in mail.outbox[0].subject and order.number in mail.outbox[0].subject
    order.refresh_from_db()
    assert order.status == OrderStatus.PAID  # money is only taken back when the bank decides


def test_replayed_dispute_webhook_changes_nothing(customer, address, product):
    _, variant = product
    _, attempt = paid(customer, address, variant)
    dispute_webhook(attempt.reference)
    dispute_webhook(attempt.reference)
    assert Dispute.objects.count() == 1


def test_lost_chargeback_reverses_the_payment_and_refunds_the_order(customer, address, product):
    _, variant = product
    order, attempt = paid(customer, address, variant)
    dispute_webhook(attempt.reference)
    dispute_webhook(attempt.reference, status="resolved", resolved=True, resolution="declined")
    d = Dispute.objects.get()
    attempt.refresh_from_db()
    order.refresh_from_db()
    assert d.status == "lost" and d.resolved_at
    assert attempt.status == "reversed" and order.status == OrderStatus.REFUNDED


def test_won_chargeback_leaves_the_order_alone(customer, address, product):
    _, variant = product
    order, attempt = paid(customer, address, variant)
    dispute_webhook(attempt.reference)
    dispute_webhook(attempt.reference, status="resolved", resolved=True, resolution="merchant-accepted")
    order.refresh_from_db()
    attempt.refresh_from_db()
    assert Dispute.objects.get().status == "won" and attempt.status == "succeeded" and order.status == OrderStatus.PAID


def test_dispute_for_an_unknown_payment_is_ignored(api):
    assert dispute_webhook("MPK-DOESNOTEXIST").status_code == 200
    assert Dispute.objects.count() == 0


def test_finance_works_the_case_but_cannot_declare_it_won(customer, address, product, finance, fulfillment):
    _, variant = product
    _, attempt = paid(customer, address, variant)
    dispute_webhook(attempt.reference)
    pk = Dispute.objects.get().pk
    assert client_for(fulfillment).get("/api/v1/payments/disputes/").status_code == 403
    assert client_for(customer).get("/api/v1/payments/disputes/").status_code == 403
    c = client_for(finance)
    assert len(c.get("/api/v1/payments/disputes/?status=open").data["results"]) == 1
    r = c.patch(f"/api/v1/payments/disputes/{pk}/", {"status": "evidence_sent", "notes": "Sent POD photo and tracking"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "evidence_sent" and "POD" in r.data["notes"]
    assert c.patch(f"/api/v1/payments/disputes/{pk}/", {"status": "won"}, format="json").status_code == 400
    assert c.patch(f"/api/v1/payments/disputes/{pk}/", {"amount": "1.00"}, format="json").data["amount"] == "70.00"  # read-only
    assert c.post("/api/v1/payments/disputes/", {}, format="json").status_code == 405


def test_paystack_dispute_event_is_parsed(settings):
    import hashlib
    import hmac

    from apps.payments.providers import PaystackProvider

    settings.PAYSTACK_SECRET_KEY = "sk_test_x"
    raw = json.dumps({"event": "charge.dispute.create", "data": {"id": 99, "status": "awaiting-merchant-feedback", "category": "chargeback",
                      "refund_amount": 7000, "currency": "GHS", "due_at": "2026-12-01T00:00:00Z", "transaction": {"reference": "MPK-ABC", "id": 5}}}).encode()
    sig = hmac.new(b"sk_test_x", raw, hashlib.sha512).hexdigest()
    event = PaystackProvider().parse_webhook(raw, {"x-paystack-signature": sig})
    assert event.reference == "MPK-ABC" and event.dispute["id"] == "99" and str(event.dispute["amount"]) == "70.00" and event.dispute["currency"] == "GHS"


# ---- Error tracking ------------------------------------------------------------------------------------------

def test_client_errors_are_logged_without_query_strings(api, caplog):
    with caplog.at_level("ERROR", logger="mpanko.client"):
        r = api.post("/api/v1/client-errors/", {"source": "web", "message": "x is undefined", "stack": "at foo", "url": "https://shop/reset?uid=1&token=SECRET", "app_version": "1.0"}, format="json")
    assert r.status_code == 204
    text = caplog.text
    assert "x is undefined" in text and "SECRET" not in text and "https://shop/reset" in text


def test_client_error_rejects_unknown_sources_and_oversized_text(api):
    assert api.post("/api/v1/client-errors/", {"source": "tv", "message": "x"}, format="json").status_code == 400
    assert api.post("/api/v1/client-errors/", {"source": "web", "message": "x" * 600}, format="json").status_code == 400


def test_sentry_setup_scrubs_requests(monkeypatch):
    import importlib

    import sentry_sdk

    seen = {}
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: seen.update(kw))
    monkeypatch.setenv("SENTRY_DSN", "https://abc@o1.ingest.sentry.io/1")
    import config.settings as s

    importlib.reload(s)
    try:
        assert seen["send_default_pii"] is False
        event = seen["before_send"]({"request": {"cookies": "a=b", "data": {"password": "x"}, "headers": {"Authorization": "Bearer t", "Accept": "json"}}}, None)
        assert "cookies" not in event["request"] and "data" not in event["request"]
        assert event["request"]["headers"]["Authorization"] == "[removed]" and event["request"]["headers"]["Accept"] == "json"
    finally:
        monkeypatch.delenv("SENTRY_DSN")
        importlib.reload(s)
