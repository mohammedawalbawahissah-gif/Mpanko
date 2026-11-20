import logging

import requests
from celery import shared_task
from django.conf import settings

from .models import DeviceToken

logger = logging.getLogger(__name__)
EXPO_URL = "https://exp.host/--/api/v2/push/send"

from .events import CUSTOMER_EVENTS, category_of  # noqa: E402

PUSH_EVENTS = {k: v["push"] for k, v in CUSTOMER_EVENTS.items() if v.get("push")}


def describe_event(key, context):
    """What a customer is told about an event: (title, body, path) or None. Shared by the app list, phone push and browser push."""
    event = PUSH_EVENTS.get(key)
    if not event:
        return None
    title, ref_key, screen = event
    ref = context.get(ref_key) if ref_key else None
    path = f"{screen}/{ref}" if screen and ref else "orders"
    body = f"Order {context['order_number']}" if context.get("order_number") else (context.get("subject") or "Open the app for details")
    return title, str(body)[:150], path


def push_for_email(key, to, context):
    """Record this event in the customer's notification list, and push it to their phones and browsers if they allow push."""
    described = describe_event(key, context)
    if not described:
        return
    from apps.accounts.models import User

    user = User.objects.filter(email__iexact=to, is_active=True).first()
    if not user:
        return
    title, body, path = described
    from .inbox import add_to_inbox
    from .preferences import allowed

    add_to_inbox(user, key, title, body, path)
    if not allowed(user, category_of(key) or "orders", "push"):
        return
    if user.device_tokens.exists():
        send_push.delay(user.pk, title, body, {"url": f"{settings.APP_SCHEME}://{path}"})
    if user.web_push_subscriptions.exists() and settings.VAPID_PRIVATE_KEY:
        send_web_push.delay(user.pk, title, body, f"/{path}")


@shared_task
def send_push(user_id, title, body, data=None):
    tokens = list(DeviceToken.objects.filter(user_id=user_id).values_list("token", flat=True))
    if not tokens:
        return 0
    messages = [{"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"} for t in tokens]
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if getattr(settings, "EXPO_ACCESS_TOKEN", ""):
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    try:
        res = requests.post(EXPO_URL, json=messages, headers=headers, timeout=10)
        res.raise_for_status()
        results = res.json().get("data", [])
    except Exception as exc:  # noqa: BLE001 — a push problem must never affect orders
        logger.warning("Push to user %s failed: %s", user_id, exc)
        return 0
    sent = 0
    for token, r in zip(tokens, results):
        if r.get("status") == "ok":
            sent += 1
        elif (r.get("details") or {}).get("error") == "DeviceNotRegistered":
            DeviceToken.objects.filter(token=token).delete()
    return sent


@shared_task
def send_web_push(user_id, title, body, url="/"):
    """Send to every browser this customer has allowed. Returns how many accepted it; dead subscriptions are removed."""
    import json

    from pywebpush import WebPushException, webpush

    from .models import WebPushSubscription

    if not settings.VAPID_PRIVATE_KEY:
        return 0
    payload = json.dumps({"title": title, "body": body, "url": url})
    sent = 0
    for sub in WebPushSubscription.objects.filter(user_id=user_id):
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
                ttl=24 * 3600,
            )
            sent += 1
        except WebPushException as exc:
            code = getattr(getattr(exc, "response", None), "status_code", None)
            if code in (404, 410):
                sub.delete()
            else:
                logger.warning("Web push to user %s failed: %s", user_id, exc)
        except Exception as exc:  # noqa: BLE001 — a push problem must never affect orders
            logger.warning("Web push to user %s failed: %s", user_id, exc)
    return sent
