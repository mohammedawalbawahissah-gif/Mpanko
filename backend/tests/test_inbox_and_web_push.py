from unittest.mock import patch

import pytest
from django.core.management import call_command

from apps.notifications.management.commands.generate_vapid_keys import make_keys
from apps.notifications.models import DeviceToken, InboxMessage, WebPushSubscription
from apps.notifications.services import send_notification
from tests.conftest import client_for

CTX = {"order_number": "MP-1234", "subject": "x"}


@pytest.fixture(autouse=True)
def _eager(settings):
    settings.CELERY_TASK_ALWAYS_EAGER = True


@pytest.mark.django_db
def test_an_order_email_also_lands_in_the_customers_list(customer):
    send_notification("order_confirmation", customer.email, {**CTX, "name": "A", "total": "1", "order_url": "x", "items": ""}, ref="MP-1234")
    msg = InboxMessage.objects.get(user=customer)
    assert (msg.title, msg.path, msg.read_at) == ("Order confirmed", "orders/MP-1234", None)


@pytest.mark.django_db
def test_events_with_no_customer_message_add_nothing(customer):
    send_notification("account_verification", customer.email, {"name": "A", "code": "123456", "link": "x"})
    assert InboxMessage.objects.count() == 0


@pytest.mark.django_db
def test_the_list_is_private_and_can_be_read_and_cleared(customer, other_customer):
    mine = InboxMessage.objects.create(user=customer, key="k", title="Mine", path="orders")
    InboxMessage.objects.create(user=customer, key="k", title="Second", path="orders")
    theirs = InboxMessage.objects.create(user=other_customer, key="k", title="Theirs", path="orders")
    c = client_for(customer)
    assert {m["title"] for m in c.get("/api/v1/notifications/inbox/").data["results"]} == {"Mine", "Second"}
    assert c.get("/api/v1/notifications/inbox/unread-count/").data == {"count": 2}
    assert c.post(f"/api/v1/notifications/inbox/{mine.pk}/read/").data["is_read"] is True
    assert c.get("/api/v1/notifications/inbox/unread-count/").data == {"count": 1}
    assert len(c.get("/api/v1/notifications/inbox/?unread=1").data["results"]) == 1
    assert c.post(f"/api/v1/notifications/inbox/{theirs.pk}/read/").status_code == 404
    assert c.delete(f"/api/v1/notifications/inbox/{theirs.pk}/").status_code == 404
    assert c.post("/api/v1/notifications/inbox/read-all/").data == {"marked": 1}
    assert c.get("/api/v1/notifications/inbox/unread-count/").data == {"count": 0}
    assert c.delete(f"/api/v1/notifications/inbox/{mine.pk}/").status_code == 204


@pytest.mark.django_db
def test_the_list_keeps_only_the_newest_messages(customer, monkeypatch):
    from apps.notifications import inbox

    monkeypatch.setattr(inbox, "KEEP", 3)
    for i in range(5):
        inbox.add_to_inbox(customer, "k", f"T{i}", "", "orders")
    assert list(InboxMessage.objects.filter(user=customer).values_list("title", flat=True)) == ["T4", "T3", "T2"]


@pytest.mark.django_db
def test_the_list_needs_signing_in(api):
    assert api.get("/api/v1/notifications/inbox/").status_code in (401, 403)


@pytest.mark.django_db
def test_browser_push_needs_keys_and_subscribes_per_browser(api, customer, settings):
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = "", ""
    assert api.get("/api/v1/notifications/web-push/key/").data == {"public_key": ""}
    pub, priv = make_keys()
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = pub, priv
    assert api.get("/api/v1/notifications/web-push/key/").data == {"public_key": pub}
    c = client_for(customer)
    body = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "p256dh": "k", "auth": "a"}
    assert c.post("/api/v1/notifications/web-push/", body, format="json").data == {"subscribed": True}
    assert c.post("/api/v1/notifications/web-push/", {"endpoint": "https://fcm.googleapis.com/fcm/send/abc"}, format="json").status_code == 400
    assert WebPushSubscription.objects.filter(user=customer).count() == 1
    assert c.delete("/api/v1/notifications/web-push/", {"endpoint": "https://fcm.googleapis.com/fcm/send/abc"}, format="json").data == {"subscribed": False}
    assert WebPushSubscription.objects.count() == 0


@pytest.mark.django_db
def test_an_event_is_pushed_to_the_customers_browsers_when_they_allow_it(customer, settings):
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = make_keys()
    WebPushSubscription.objects.create(user=customer, endpoint="https://fcm.googleapis.com/fcm/send/abc", p256dh="k", auth="a")
    ctx = {**CTX, "name": "A", "total": "1", "order_url": "x", "items": ""}
    with patch("pywebpush.webpush") as sent:
        send_notification("order_confirmation", customer.email, ctx, ref="1")  # push is off by default
        assert sent.call_count == 0
        customer.notify_push = True
        customer.save()
        send_notification("order_confirmation", customer.email, ctx, ref="2")
    assert sent.call_count == 1
    assert '"url": "/orders/MP-1234"' in sent.call_args.kwargs["data"]
    assert sent.call_args.kwargs["vapid_claims"]["sub"].startswith("mailto:")


@pytest.mark.django_db
def test_a_dead_browser_is_forgotten(customer, settings):
    from pywebpush import WebPushException

    from apps.notifications.push import send_web_push

    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = make_keys()
    WebPushSubscription.objects.create(user=customer, endpoint="https://fcm.googleapis.com/fcm/send/gone", p256dh="k", auth="a")

    class Gone:
        status_code = 410

    with patch("pywebpush.webpush", side_effect=WebPushException("gone", response=Gone())):
        assert send_web_push(customer.pk, "t", "b", "/") == 0
    assert WebPushSubscription.objects.count() == 0


def test_generated_keys_are_valid_for_signing():
    from py_vapid import Vapid

    pub, priv = make_keys()
    sig = Vapid.from_string(priv).sign({"aud": "https://push.example", "sub": "mailto:a@b.co"})
    assert sig["Authorization"].startswith("vapid ")
    assert len(pub) == 87  # a 65-byte uncompressed point, URL-safe base64


@pytest.mark.django_db
def test_check_notifications_reports_each_channel(customer, capsys):
    DeviceToken.objects.create(user=customer, token="ExponentPushToken[abc]", platform="ios")
    with patch("apps.notifications.management.commands.check_notifications.send_push", return_value=1):
        call_command("check_notifications", "--phone", "+233240000000", "--user", customer.email)
    out = capsys.readouterr().out
    assert "SMS (log): accepted" in out and "WhatsApp (log): accepted" in out
    assert "Phone push: 1 of 1 accepted" in out
    assert "Browser push" in out


@pytest.mark.django_db
def test_deleting_an_account_removes_notifications_and_devices(customer):
    from apps.privacy.services import delete_account, export_user_data

    InboxMessage.objects.create(user=customer, key="k", title="Order confirmed", path="orders")
    WebPushSubscription.objects.create(user=customer, endpoint="https://fcm.googleapis.com/fcm/send/x", p256dh="k", auth="a")
    DeviceToken.objects.create(user=customer, token="ExponentPushToken[z]")
    assert export_user_data(customer)["notifications"][0]["title"] == "Order confirmed"
    delete_account(customer)
    assert not InboxMessage.objects.exists() and not WebPushSubscription.objects.exists() and not DeviceToken.objects.exists()
