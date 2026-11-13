import logging

import requests
from celery import shared_task
from django.conf import settings

from .models import DeviceToken

logger = logging.getLogger(__name__)
EXPO_URL = "https://exp.host/--/api/v2/push/send"

# Email key -> (push title, context key holding the number used to open the right screen, screen)
PUSH_EVENTS = {
    "order_confirmation": ("Order confirmed", "order_number", "orders"),
    "shipment_dispatched": ("Your order has shipped", "order_number", "orders"),
    "order_delivered": ("Your order was delivered", "order_number", "orders"),
    "payment_failed": ("Payment didn't go through", "order_number", "orders"),
    "return_approved": ("Your return was approved", "order_number", "orders"),
    "return_rejected": ("About your return request", "order_number", "orders"),
    "return_refunded": ("Your refund is on its way", None, None),
    "support_reply": ("New reply from Mpanko support", "case_number", "support"),
}


def push_for_email(key, to, context):
    """Queue a push for the customer behind this email, if they have a phone registered and allow push."""
    event = PUSH_EVENTS.get(key)
    if not event:
        return
    from apps.accounts.models import User

    user = User.objects.filter(email__iexact=to, is_active=True, notify_push=True).first()
    if not user or not user.device_tokens.exists():
        return
    title, ref_key, screen = event
    ref = context.get(ref_key) if ref_key else None
    url = f"{settings.APP_SCHEME}://{screen}/{ref}" if screen and ref else f"{settings.APP_SCHEME}://orders"
    body = f"Order {context['order_number']}" if context.get("order_number") else (context.get("subject") or "Open the app for details")
    send_push.delay(user.pk, title, str(body)[:150], {"url": url})


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
