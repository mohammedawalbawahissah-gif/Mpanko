"""
WhatsApp order updates through Twilio (INT-05). Same events as SMS, sent only to customers who ticked WhatsApp
and have a verified phone number. WHATSAPP_BACKEND is "log" (default; development and tests) or "twilio".

WhatsApp only lets a business start a conversation with a pre-approved template. Free text works inside a 24-hour
window after the customer last wrote to you, and in the Twilio sandbox. For real customers, approve one template
per event in Twilio and list them in WHATSAPP_TEMPLATE_SIDS, for example
  {"order_confirmation": "HX123...", "shipment_dispatched": "HX456..."}
Each template's numbered placeholders {{1}}, {{2}} ... are filled in the order given in TEMPLATE_VARIABLES below.
An event without a template falls back to plain text. Failures are logged and never raise.
"""
import json
import logging

import requests
from celery import shared_task
from django.conf import settings

from .sms import SMS_EVENTS

logger = logging.getLogger(__name__)

# Order of values for each event's template placeholders.
TEMPLATE_VARIABLES = {
    "order_confirmation": ["order_number"],
    "shipment_dispatched": ["order_number", "carrier", "tracking_number"],
    "order_delivered": ["order_number"],
    "payment_failed": ["order_number"],
    "return_approved": ["order_number"],
    "return_refunded": ["return_number"],
}


def _log_backend(to, body, template=None):
    logger.info("WhatsApp to %s: %s", to, body if not template else f"template {template[0]} {template[1]}")
    return True


def _twilio_backend(to, body, template=None):
    sid, token = settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN
    sender = settings.TWILIO_WHATSAPP_FROM
    if not (sid and token):
        raise RuntimeError("Twilio credentials are not configured.")
    if not sender:
        raise RuntimeError("Set TWILIO_WHATSAPP_FROM, for example whatsapp:+14155238886.")
    data = {"To": f"whatsapp:{to}", "From": sender if sender.startswith("whatsapp:") else f"whatsapp:{sender}"}
    if template:
        data["ContentSid"], data["ContentVariables"] = template[0], json.dumps(template[1])
    else:
        data["Body"] = body
    resp = requests.post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", data=data, auth=(sid, token), timeout=15)
    if not resp.ok:
        raise RuntimeError(f"Twilio error {resp.status_code}: {resp.text[:200]}")
    return True


BACKENDS = {"log": _log_backend, "twilio": _twilio_backend}


def send_whatsapp(to, body, kind="notice", ref="", template=None):
    """Queue one WhatsApp message. Returns immediately; the outcome is written to the notification log."""
    if not to:
        return False
    deliver_whatsapp.delay(to, body[:1000], kind, ref, list(template) if template else None)
    return True


@shared_task(name="notifications.deliver_whatsapp")
def deliver_whatsapp(to, body, kind="notice", ref="", template=None):
    from .models import NotificationLog

    status, error = NotificationLog.Status.SENT, ""
    try:
        BACKENDS[settings.WHATSAPP_BACKEND](to, body, tuple(template) if template else None)
    except Exception as exc:  # noqa: BLE001 — a gateway problem must never break checkout
        logger.warning("WhatsApp to %s failed: %s", to, exc)
        status, error = NotificationLog.Status.FAILED, str(exc)[:300]
    NotificationLog.objects.create(key=f"whatsapp_{kind}"[:60], channel="whatsapp", recipient=to, subject=body[:200], status=status, error=error, ref=ref)
    return status == NotificationLog.Status.SENT


def _template_sids():
    try:
        sids = json.loads(settings.WHATSAPP_TEMPLATE_SIDS or "{}")
        return sids if isinstance(sids, dict) else {}
    except ValueError:
        return {}


def whatsapp_for_email(key, to, context, ref=""):
    """Send the WhatsApp twin of an email event to the customer behind `to`, if they chose WhatsApp and verified a number."""
    text = SMS_EVENTS.get(key)
    if not text:
        return
    from apps.accounts.models import User

    user = User.objects.filter(email__iexact=to, is_active=True, notify_whatsapp=True, phone_verified=True).first()
    if not user:
        return
    values = {**{k: "" for k in ("order_number", "carrier", "tracking_number", "return_number")}, **context}
    try:
        body = text.format_map(values)
    except (KeyError, IndexError, ValueError):
        return
    template = None
    sid = _template_sids().get(key)
    if sid:
        template = (sid, {str(i + 1): str(values.get(name, "")) for i, name in enumerate(TEMPLATE_VARIABLES.get(key, []))})
    send_whatsapp(user.phone, body, kind=key, ref=ref, template=template)
