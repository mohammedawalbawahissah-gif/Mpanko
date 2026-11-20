"""Preferences, staff alerts, order and payment messages, announcements, stock alerts, reminders."""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.models import Role
from apps.notifications import campaigns, preferences, services
from apps.notifications.models import Campaign, InboxMessage, NotificationLog, NotificationPreference, StockAlert
from apps.notifications.staff import notify_staff
from apps.orders.models import Order, OrderStatus
from apps.orders.services import mark_paid, transition

from .conftest import client_for, make_product, make_user, place_order

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def eager(settings, monkeypatch):
    # Tests run inside a transaction that never commits, so run "after commit" work straight away.
    monkeypatch.setattr("django.db.transaction.on_commit", lambda fn, using=None, robust=False: fn())
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock", "zelle"]
    settings.ZELLE_RECIPIENT, settings.ZELLE_NAME = "508-410-9719", "Teefa Fuseini"
    settings.STAFF_ALERT_WHATSAPP = []
    settings.ADMIN_APP_URL = "https://admin.example.com"


def subjects():
    return [m.subject for m in mail.outbox]


# ---- Preferences ------------------------------------------------------------------------------------------

def test_every_template_renders_with_its_sample():
    for key, (_, subject, body, ctx) in services.DEFAULTS.items():
        services.validate_template(key, subject, body)


def test_order_and_support_email_cannot_be_switched_off(customer):
    preferences.set_preferences(customer, {"orders": {"email": False}, "support": {"email": False}})
    assert preferences.allowed(customer, "orders", "email") and preferences.allowed(customer, "support", "email")
    assert not NotificationPreference.objects.filter(user=customer).exists()


def test_offers_need_opt_in_and_sms_needs_a_verified_phone(customer):
    assert not preferences.allowed(customer, "offers", "email")
    customer.marketing_opt_in = True
    customer.save()
    assert preferences.allowed(customer, "offers", "email")
    customer.notify_sms = True
    customer.phone = "+12025550100"
    customer.save()
    assert not preferences.allowed(customer, "orders", "sms")  # number not verified
    customer.phone_verified = True
    customer.save()
    assert preferences.allowed(customer, "orders", "sms")


def test_a_per_type_switch_narrows_a_channel(customer):
    customer.notify_push = True
    customer.save()
    preferences.set_preferences(customer, {"orders": {"push": False}})
    assert not preferences.allowed(customer, "orders", "push")
    assert preferences.allowed(customer, "support", "push")


def test_ticking_a_channel_needs_a_verified_number_and_turns_it_on_for_that_type_only(customer):
    preferences.set_preferences(customer, {"orders": {"sms": True}})
    assert not preferences.allowed(customer, "orders", "sms")  # no verified number yet
    customer.phone, customer.phone_verified = "+12025550100", True
    customer.save()
    preferences.set_preferences(customer, {"orders": {"sms": True}})
    customer.refresh_from_db()
    assert customer.notify_sms is True
    assert preferences.allowed(customer, "orders", "sms")
    assert not preferences.allowed(customer, "support", "sms") and not preferences.allowed(customer, "reminders", "sms")


def test_the_preferences_api_reads_and_writes(customer):
    c = client_for(customer)
    data = c.get("/api/v1/notifications/preferences/").data
    assert [r["category"] for r in data["categories"]] == ["orders", "support", "reminders", "offers"]
    assert data["categories"][0]["channels"]["email"]["locked"] is True
    r = c.put("/api/v1/notifications/preferences/", {"marketing_opt_in": True, "categories": {"reminders": {"email": False}}}, format="json")
    cells = {row["category"]: row["channels"] for row in r.data["categories"]}
    assert cells["reminders"]["email"]["enabled"] is False and cells["offers"]["email"]["enabled"] is True
    assert "staff" not in r.data


def test_staff_also_get_their_own_alert_switches(admin):
    c = client_for(admin)
    r = c.put("/api/v1/notifications/preferences/", {"staff": {"push": True, "email": False}}, format="json")
    assert r.data["staff"]["channels"]["push"]["enabled"] is True and r.data["staff"]["channels"]["email"]["enabled"] is False


def test_an_sms_for_a_customer_who_turned_that_type_off_is_not_sent(customer):
    customer.notify_sms, customer.phone, customer.phone_verified = True, "+12025550100", True
    customer.save()
    preferences.set_preferences(customer, {"orders": {"sms": False}})
    with patch("apps.notifications.sms.send_sms") as sms:
        services.send_notification("order_confirmation", customer.email, {"order_number": "MP-1", "lines": "", "currency": "USD", "shipping_total": 0, "grand_total": 1}, ref="MP-1")
    sms.assert_not_called()


# ---- Order and payment messages ---------------------------------------------------------------------------

def test_a_manual_payment_tells_the_customer_how_to_pay_and_alerts_staff(customer, address, product, admin):
    _, variant = product
    c, r = place_order(customer, variant, address)
    mail.outbox.clear()
    InboxMessage.objects.all().delete()
    pay = c.post("/api/v1/payments/initiate/", {"order_number": r.data["number"], "provider": "zelle"}, format="json")
    assert pay.status_code == 201
    mine = [m for m in mail.outbox if m.to == [customer.email]]
    assert mine and "508-410-9719" in mine[0].body and r.data["number"] in mine[0].subject
    staff_mail = [m for m in mail.outbox if m.to == [admin.email]]
    assert staff_mail and "Confirm payment" in staff_mail[0].subject
    assert InboxMessage.objects.filter(user=admin, key="staff_manual_payment").exists()


def test_paying_alerts_staff_to_a_new_order_and_confirms_to_the_customer(customer, address, product, admin, fulfillment):
    _, variant = product
    _, r = place_order(customer, variant, address)
    mail.outbox.clear()
    mark_paid(Order.objects.get(number=r.data["number"]))
    assert any("New order" in s for s in subjects()) and any("confirmed" in s for s in subjects())
    msg = InboxMessage.objects.get(user=fulfillment, key="staff_new_order")
    assert msg.path == f"orders/{r.data['number']}"
    assert not InboxMessage.objects.filter(user=customer, key="staff_new_order").exists()


def test_processing_cancelled_and_expired_each_tell_the_customer(customer, address, product):
    _, variant = product
    _, r = place_order(customer, variant, address)
    order = Order.objects.get(number=r.data["number"])
    order = transition(order, OrderStatus.PAID)
    mail.outbox.clear()
    order = transition(order, OrderStatus.PROCESSING)
    assert any("preparing" in s for s in subjects())
    order = transition(order, OrderStatus.CANCELLED)
    assert any("cancelled" in s for s in subjects())
    _, r2 = place_order(customer, variant, address, key="key-2")
    mail.outbox.clear()
    transition(Order.objects.get(number=r2.data["number"]), OrderStatus.EXPIRED)
    assert any("released" in s for s in subjects())


def test_ready_for_pickup_is_staff_only_and_pickup_only(customer, address, product, fulfillment):
    _, variant = product
    _, r = place_order(customer, variant, address)
    order = Order.objects.get(number=r.data["number"])
    transition(order, OrderStatus.PAID)
    url = f"/api/v1/orders/{order.number}/ready-for-pickup/"
    assert client_for(customer).post(url).status_code in (403, 404)
    assert client_for(fulfillment).post(url).status_code == 400  # not a pickup order
    Order.objects.filter(pk=order.pk).update(shipping_service={"service_code": "pickup", "service_name": "Pickup in Worcester"})
    mail.outbox.clear()
    assert client_for(fulfillment).post(url).status_code == 200
    ready = [m for m in mail.outbox if "ready for pickup" in m.subject]
    assert ready and "Pickup in Worcester" in ready[0].body


# ---- Staff alerts -----------------------------------------------------------------------------------------

def test_staff_choose_their_own_channels(admin):
    NotificationPreference.objects.create(user=admin, category="staff", channel="email", enabled=False)
    notify_staff("staff_new_order", {"order_number": "MP-9", "customer": "Ama", "country": "US", "lines": "", "currency": "USD", "grand_total": "5", "delivery": "", "link": ""}, ref="MP-9")
    assert InboxMessage.objects.filter(user=admin).count() == 1
    assert not [m for m in mail.outbox if m.to == [admin.email]]


def test_urgent_alerts_also_go_to_the_owners_whatsapp(settings, admin):
    settings.STAFF_ALERT_WHATSAPP = ["+15084109719"]
    ctx = {"order_number": "MP-9", "customer": "Ama", "country": "US", "lines": "", "currency": "USD", "grand_total": "5", "delivery": "", "link": ""}
    with patch("apps.notifications.whatsapp.send_whatsapp") as wa:
        notify_staff("staff_new_order", ctx, ref="MP-9")
        notify_staff("staff_payment_failed", {"order_number": "MP-9", "customer": "Ama", "link": ""}, ref="MP-9:f")  # not urgent
    assert wa.call_count == 1 and wa.call_args[0][0] == "+15084109719"


def test_a_support_message_alerts_support_staff(customer):
    support = make_user("help@example.com", Role.SUPPORT)
    c = client_for(customer)
    r = c.post("/api/v1/support/cases/", {"subject": "Where is my order?", "message": "It has been a week", "order_number": ""}, format="json")
    assert r.status_code == 201
    assert InboxMessage.objects.filter(user=support, key="staff_support_case").exists()


def test_the_staff_bell_works_through_the_same_inbox_endpoints(admin):
    notify_staff("low_stock_alert", {"product": "Scarf", "sku": "S1", "quantity": 2, "threshold": 5, "link": ""}, ref="S1-2")
    c = client_for(admin)
    assert c.get("/api/v1/notifications/inbox/unread-count/").data == {"count": 1}


# ---- Announcements ----------------------------------------------------------------------------------------

def _customer(email, opted=True, country="US"):
    from apps.accounts.models import Address

    u = make_user(email)
    u.email_verified, u.marketing_opt_in = True, opted
    u.save()
    Address.objects.create(user=u, recipient_name="X", phone="+1", line1="1", city="c", country=country, is_default=True)
    return u


def test_an_announcement_reaches_only_opted_in_customers_in_the_chosen_countries(admin):
    us, gh = _customer("us@example.com"), _customer("gh@example.com", country="GH")
    _customer("no@example.com", opted=False)
    camp = Campaign.objects.create(title="Launch", subject="We are open", body="Come and see.", countries=["US"], created_by=admin)
    c = client_for(admin)
    assert c.get(f"/api/v1/notifications/campaigns/{camp.pk}/preview/").data["people"] == 1
    mail.outbox.clear()
    r = c.post(f"/api/v1/notifications/campaigns/{camp.pk}/send/")
    assert r.status_code == 200
    camp.refresh_from_db()
    assert camp.status == "sent" and camp.emailed == 1
    assert [m.to for m in mail.outbox] == [[us.email]]
    assert "unsubscribe" in mail.outbox[0].body.lower() and mail.outbox[0].extra_headers["List-Unsubscribe"]
    assert InboxMessage.objects.filter(user=us, key="announcement").exists() and not InboxMessage.objects.filter(user=gh).exists()
    assert c.post(f"/api/v1/notifications/campaigns/{camp.pk}/send/").status_code == 400  # only once
    assert c.patch(f"/api/v1/notifications/campaigns/{camp.pk}/", {"subject": "x"}, format="json").status_code == 400


def test_the_unsubscribe_link_switches_offers_off_without_signing_in(admin):
    from rest_framework.test import APIClient

    u = _customer("a@example.com")
    url = campaigns.unsubscribe_url(u)
    assert APIClient().get(url).status_code == 200
    u.refresh_from_db()
    assert u.marketing_opt_in is False
    assert APIClient().get("/api/v1/notifications/unsubscribe/?token=bad").status_code == 400


def test_a_test_send_goes_only_to_the_sender(admin):
    camp = Campaign.objects.create(title="T", subject="Hello", body="Hi")
    _customer("a@example.com")
    mail.outbox.clear()
    assert client_for(admin).post(f"/api/v1/notifications/campaigns/{camp.pk}/test/").data == {"sent": True}
    assert [m.to for m in mail.outbox] == [[admin.email]]


def test_announcements_and_the_audience_are_for_staff_only(customer):
    c = client_for(customer)
    assert c.get("/api/v1/notifications/campaigns/").status_code == 403
    assert c.get("/api/v1/notifications/audience/").status_code == 403


def test_the_audience_summary_shows_where_customers_are(admin):
    _customer("us@example.com")
    _customer("gh@example.com", country="GH", opted=False)
    data = client_for(admin).get("/api/v1/notifications/audience/").data
    assert data["customers"] == 2 and data["agreed_to_offers"] == 1 and data["offers_by_channel"]["email"] == 1
    assert {c["country"] for c in data["countries"]} == {"US", "GH"}


# ---- Stock alerts and reminders ---------------------------------------------------------------------------

def test_a_back_in_stock_message_goes_once_when_the_item_returns(customer):
    from apps.catalog.models import StockMovement, adjust_stock

    _, variant = make_product(name="Rare Scarf", stock=0)
    c = client_for(customer)
    assert c.post("/api/v1/notifications/stock-alerts/", {"variant": variant.pk}, format="json").status_code == 201
    mail.outbox.clear()
    from django.db import transaction

    with transaction.atomic():
        adjust_stock(variant.pk, 5, StockMovement.Reason.RESTOCK)
    assert any("back in stock" in s for s in subjects())
    assert StockAlert.objects.get(user=customer).notified_at is not None
    mail.outbox.clear()
    with transaction.atomic():
        adjust_stock(variant.pk, 1, StockMovement.Reason.RESTOCK)
    assert not mail.outbox


def test_one_bag_reminder_and_none_after_an_order(customer, product):
    from apps.notifications.tasks import send_bag_reminders
    from apps.orders.models import Cart, CartItem

    customer.email_verified = True
    customer.save()
    _, variant = product
    cart = Cart.objects.create(user=customer)
    CartItem.objects.create(cart=cart, variant=variant, quantity=1)
    Cart.objects.filter(pk=cart.pk).update(updated_at=timezone.now() - timedelta(hours=30))
    mail.outbox.clear()
    assert send_bag_reminders() == 1 and send_bag_reminders() == 0
    assert any("left something" in s for s in subjects())


def test_bag_reminders_respect_the_reminders_switch(customer, product):
    from apps.notifications.tasks import send_bag_reminders
    from apps.orders.models import Cart, CartItem

    customer.email_verified = True
    customer.save()
    preferences.set_preferences(customer, {"reminders": {"email": False}})
    _, variant = product
    cart = Cart.objects.create(user=customer)
    CartItem.objects.create(cart=cart, variant=variant, quantity=1)
    Cart.objects.filter(pk=cart.pk).update(updated_at=timezone.now() - timedelta(hours=30))
    assert send_bag_reminders() == 0


def test_order_feedback_is_asked_once_after_delivery(customer, address, product):
    from apps.notifications.tasks import send_feedback_requests
    from apps.shipping.models import Shipment, ShipmentStatus

    _, variant = product
    _, r = place_order(customer, variant, address)
    order = Order.objects.get(number=r.data["number"])
    Order.objects.filter(pk=order.pk).update(status=OrderStatus.DELIVERED)
    Shipment.objects.create(order=order, status=ShipmentStatus.DELIVERED, delivered_at=timezone.now() - timedelta(days=6))
    mail.outbox.clear()
    assert send_feedback_requests() == 1 and send_feedback_requests() == 0
    assert any("How was order" in s for s in subjects())
