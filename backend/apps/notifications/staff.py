"""Alerts to you and your team: new orders, payments to confirm, returns, support messages, disputes, enquiries, low stock.

Each staff member chooses how to be told (bell in the admin app, email, phone push, WhatsApp). The default is bell and email.
Urgent events can also go to the numbers in STAFF_ALERT_WHATSAPP, so the owner hears about a new order or a payment to confirm
even without the admin app open."""
import logging

from django.conf import settings

from . import services
from .events import STAFF_EVENTS
from .inbox import add_to_inbox
from .preferences import _explicit, channel_available, staff_allows

logger = logging.getLogger(__name__)


def admin_link(path=""):
    return f"{settings.ADMIN_URL}/{path.lstrip('/')}" if settings.ADMIN_URL else ""


def _summary(key, context):
    """One line for the bell, push and WhatsApp: the email subject, rendered."""
    subject_t, _, _, _ = services.effective_template(key)
    try:
        return services.render(subject_t, context).replace("\n", " ").strip()[:150]
    except Exception:  # noqa: BLE001 — a broken template must not stop the alert
        return STAFF_EVENTS[key]["title"]


def notify_staff(key, context, ref="", path_ref="", extra_emails=()):
    """Tell every active staff member who should hear about `key`, on the channels they chose. Never raises. Returns people reached."""
    event = STAFF_EVENTS[key]
    from apps.accounts.models import User

    title = event["title"]
    body = _summary(key, context)
    screen = event["screen"]
    path = f"{screen}/{path_ref}" if path_ref else screen
    reached = 0
    emailed = set()
    try:
        people = list(User.objects.filter(is_active=True, role__in=event["roles"]))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Staff alert %s could not find recipients: %s", key, exc)
        return 0
    for user in people:
        try:
            explicit = _explicit(user)
            did = False
            if staff_allows(user, "bell", explicit):
                add_to_inbox(user, key, title, body, path)
                did = True
            if staff_allows(user, "email", explicit) and user.email:
                services.send_notification(key, user.email, context, ref=f"{ref}:{user.pk}" if ref else "", fanout=False, dedupe=bool(ref))
                emailed.add(user.email.lower())
                did = True
            if staff_allows(user, "push", explicit) and user.device_tokens.exists():
                from .push import send_push

                send_push.delay(user.pk, title, body, {"url": f"{settings.ADMIN_APP_SCHEME}://{path}"})
                did = True
            if staff_allows(user, "whatsapp", explicit) and channel_available(user, "whatsapp"):
                from .whatsapp import send_whatsapp

                send_whatsapp(user.phone, f"Mpanko: {body}", kind=key, ref=ref)
                did = True
            reached += 1 if did else 0
        except Exception as exc:  # noqa: BLE001 — one person's problem must not stop the others
            logger.warning("Staff alert %s for user %s failed: %s", key, user.pk, exc)
    for address in extra_emails:
        if address and address.lower() not in emailed:
            services.send_notification(key, address, context, ref=f"{ref}:{address}" if ref else "", fanout=False, dedupe=bool(ref))
    if event["urgent"]:
        from .whatsapp import send_whatsapp

        for number in settings.STAFF_ALERT_WHATSAPP:
            try:
                send_whatsapp(number, f"Mpanko: {body}", kind=key, ref=ref)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Urgent WhatsApp alert %s to %s failed: %s", key, number, exc)
    return reached
