"""
SMS delivery (FR-NOT-02). One function, two backends picked by SMS_BACKEND:
  "log"    — writes the message to the server log (development and tests; the default)
  "twilio" — Twilio Programmable Messaging (needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM or a messaging service)
Another gateway (Hubtel, Arkesel ...) is one more function in BACKENDS. Failures are logged and never raise.
"""
import logging

import requests
from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)

# Email key -> short text (SMS has no room for the long email body)
SMS_EVENTS = {
    "order_confirmation": "Mpanko: order {order_number} is confirmed. Thank you!",
    "shipment_dispatched": "Mpanko: order {order_number} has shipped with {carrier}. Tracking: {tracking_number}",
    "order_delivered": "Mpanko: order {order_number} was delivered. We hope you love it.",
    "payment_failed": "Mpanko: payment for order {order_number} did not go through. You can try again in your orders.",
    "return_approved": "Mpanko: your return for order {order_number} is approved. Check your email for next steps.",
    "return_refunded": "Mpanko: your refund for return {return_number} is on its way.",
}


def _log_backend(to, body):
    logger.info("SMS to %s: %s", to, body)
    return True


def _twilio_backend(to, body):
    sid, token = settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN
    if not (sid and token):
        raise RuntimeError("Twilio credentials are not configured.")
    data = {"To": to, "Body": body}
    if settings.TWILIO_MESSAGING_SERVICE_SID:
        data["MessagingServiceSid"] = settings.TWILIO_MESSAGING_SERVICE_SID
    elif settings.TWILIO_FROM:
        data["From"] = settings.TWILIO_FROM
    else:
        raise RuntimeError("Set TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.")
    resp = requests.post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", data=data, auth=(sid, token), timeout=15)
    if not resp.ok:
        raise RuntimeError(f"Twilio error {resp.status_code}: {resp.text[:200]}")
    return True


BACKENDS = {"log": _log_backend, "twilio": _twilio_backend}


def send_sms(to, body, kind="notice", ref=""):
    """Queue one SMS. Returns immediately; the outcome is written to the notification log."""
    if not to:
        return False
    deliver_sms.delay(to, body[:320], kind, ref)
    return True


@shared_task(name="notifications.deliver_sms")
def deliver_sms(to, body, kind="notice", ref=""):
    from .models import NotificationLog

    status, error = NotificationLog.Status.SENT, ""
    try:
        BACKENDS[settings.SMS_BACKEND](to, body)
    except Exception as exc:  # noqa: BLE001 — a gateway problem must never break checkout or sign-in
        logger.warning("SMS to %s failed: %s", to, exc)
        status, error = NotificationLog.Status.FAILED, str(exc)[:300]
    # One-time codes are never stored in the log.
    subject = "One-time code" if kind == "otp" else body[:200]
    NotificationLog.objects.create(key=f"sms_{kind}"[:60], channel="sms", recipient=to, subject=subject, status=status, error=error, ref=ref)
    return status == NotificationLog.Status.SENT


def sms_for_email(key, to, context, ref=""):
    """Send the SMS twin of an email event to the customer behind `to`, if they chose SMS and verified a number."""
    text = SMS_EVENTS.get(key)
    if not text:
        return
    from apps.accounts.models import User

    user = User.objects.filter(email__iexact=to, is_active=True, notify_sms=True, phone_verified=True).first()
    if not user:
        return
    try:
        body = text.format_map({**{k: "" for k in ("order_number", "carrier", "tracking_number", "return_number")}, **context})
    except (KeyError, IndexError, ValueError):
        return
    send_sms(user.phone, body, kind=key, ref=ref)
