"""Announcements from staff to customers who agreed to hear from the shop."""
import logging
from collections import Counter

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .inbox import add_to_inbox
from .models import Campaign
from .preferences import allowed, unsubscribe_token
from .services import send_notification
from apps.notifications.enqueue import enqueue

logger = logging.getLogger(__name__)


def customer_country(user):
    """Where a customer is: their default address, else where their latest order went. Blank when unknown."""
    from apps.orders.models import Order

    addr = user.addresses.order_by("-is_default", "-created_at").first()
    if addr and addr.country:
        return addr.country.upper()
    order = Order.objects.filter(user=user).order_by("-created_at").first()
    return ((order.shipping_address or {}).get("country", "") if order else "").upper()


def unsubscribe_url(user):
    base = settings.API_PUBLIC_URL.rstrip("/") if settings.API_PUBLIC_URL else ""
    return f"{base}/api/v1/notifications/unsubscribe/?token={unsubscribe_token(user)}"


def audience(countries=None):
    """Customers a campaign can reach: active, verified, opted in to offers, and in the chosen countries."""
    from apps.accounts.models import Role, User

    wanted = {c.strip().upper() for c in (countries or []) if c and c.strip()}
    for user in User.objects.filter(role=Role.CUSTOMER, is_active=True, email_verified=True, marketing_opt_in=True).order_by("pk"):
        if wanted and customer_country(user) not in wanted:
            continue
        yield user


def summary():
    """What staff see about their customers: how many, where they are, and how many agreed to offers by channel."""
    from apps.accounts.models import Role, User

    customers = User.objects.filter(role=Role.CUSTOMER, is_active=True)
    opted = [u for u in customers.filter(marketing_opt_in=True, email_verified=True)]
    countries = Counter(customer_country(u) or "Unknown" for u in customers)
    return {
        "customers": customers.count(),
        "agreed_to_offers": len(opted),
        "offers_by_channel": {
            "email": sum(1 for u in opted if allowed(u, "offers", "email")),
            "push": sum(1 for u in opted if allowed(u, "offers", "push") and (u.device_tokens.exists() or u.web_push_subscriptions.exists())),
            "sms": sum(1 for u in opted if allowed(u, "offers", "sms")),
            "whatsapp": sum(1 for u in opted if allowed(u, "offers", "whatsapp")),
        },
        "countries": [{"country": c, "customers": n} for c, n in countries.most_common()],
    }


def deliver(campaign, user):
    """Send one campaign message to one customer. Returns (emailed, pushed)."""
    emailed = pushed = False
    ctx = {"subject": campaign.subject, "message": campaign.body, "link": campaign.link, "unsubscribe_url": unsubscribe_url(user)}
    if campaign.send_email and allowed(user, "offers", "email"):
        headers = {"List-Unsubscribe": f"<{ctx['unsubscribe_url']}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
        emailed = send_notification("announcement", user.email, ctx, ref=f"campaign-{campaign.pk}", fanout=False, headers=headers)
    if campaign.send_push:
        add_to_inbox(user, "announcement", campaign.subject[:120], campaign.body[:200], "notifications")
        if allowed(user, "offers", "push"):
            from .push import send_push, send_web_push

            if user.device_tokens.exists():
                enqueue(send_push, user.pk, campaign.subject[:120], campaign.body[:150], {"url": f"{settings.APP_SCHEME}://notifications"})
                pushed = True
            if user.web_push_subscriptions.exists() and settings.VAPID_PRIVATE_KEY:
                enqueue(send_web_push, user.pk, campaign.subject[:120], campaign.body[:150], "/notifications")
                pushed = True
    return emailed, pushed


def run_campaign(campaign_id):
    """Send a draft campaign to everyone it should reach. Safe to call twice: a campaign sends once."""
    with transaction.atomic():
        updated = Campaign.objects.filter(pk=campaign_id, status=Campaign.Status.DRAFT).update(status=Campaign.Status.SENDING)
    if not updated:
        return 0
    campaign = Campaign.objects.get(pk=campaign_id)
    emailed = pushed = skipped = 0
    for user in audience(campaign.countries):
        try:
            e, p = deliver(campaign, user)
        except Exception as exc:  # noqa: BLE001 — one bad address must not stop the rest
            logger.warning("Campaign %s to user %s failed: %s", campaign_id, user.pk, exc)
            skipped += 1
            continue
        emailed += 1 if e else 0
        pushed += 1 if p else 0
        skipped += 0 if (e or p) else 1
    Campaign.objects.filter(pk=campaign_id).update(status=Campaign.Status.SENT, sent_at=timezone.now(), emailed=emailed, pushed=pushed, skipped=skipped)
    return emailed + pushed
