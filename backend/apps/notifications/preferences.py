"""Who may be told what, on which channel.

Rules, in plain words:
- Email for orders, support and account messages is always on: people must hear about money, returns and security.
- Every other switch can be turned off by the person. SMS and WhatsApp also need a verified phone number and the account-level switch.
- "News and offers" are off until the customer opts in.
"""
from django.core import signing

from .events import CHANNELS, CUSTOMER_CATEGORIES, LOCKED_EMAIL, STAFF_CATEGORY, STAFF_CHANNELS
from .models import NotificationPreference

UNSUB_SALT = "mpanko-unsubscribe"


def _explicit(user):
    return {(p.category, p.channel): p.enabled for p in NotificationPreference.objects.filter(user=user)}


def channel_available(user, channel):
    """Can this channel reach the person at all right now?"""
    if channel == "email":
        return bool(user.email)
    if channel in ("sms", "whatsapp"):
        return bool(user.phone and user.phone_verified)
    if channel == "push":
        return user.device_tokens.exists() or user.web_push_subscriptions.exists()
    return True


def _master(user, channel):
    """The account-level switch for a channel (Profile in the app, Account on the shop)."""
    return {"sms": user.notify_sms, "whatsapp": user.notify_whatsapp, "push": user.notify_push}.get(channel, True)


def allowed(user, category, channel, explicit=None):
    """May we send a `category` message to this person on this channel?"""
    if category in LOCKED_EMAIL and channel == "email":
        return True
    if channel in ("sms", "whatsapp") and not (user.phone and user.phone_verified):
        return False
    if not _master(user, channel):
        return False
    if category == "offers" and not user.marketing_opt_in:
        return False
    explicit = _explicit(user) if explicit is None else explicit
    value = explicit.get((category, channel))
    return True if value is None else value


def matrix(user):
    """What the preferences screen shows: every category, every channel, its current value and whether it can be changed."""
    explicit = _explicit(user)
    categories = dict(CUSTOMER_CATEGORIES)
    rows = []
    for key, label in categories.items():
        cells = {}
        for channel in CHANNELS:
            locked = channel == "email" and key in LOCKED_EMAIL
            cells[channel] = {
                "enabled": allowed(user, key, channel, explicit),
                "locked": locked,
                "available": channel_available(user, channel) if channel != "email" else True,
            }
        rows.append({"category": key, "label": label, "channels": cells})
    return {
        "categories": rows,
        "marketing_opt_in": user.marketing_opt_in,
        "phone_verified": user.phone_verified,
        "has_push_device": channel_available(user, "push"),
    }


def staff_matrix(user):
    explicit = _explicit(user)
    cells = {}
    for channel in STAFF_CHANNELS:
        value = explicit.get((STAFF_CATEGORY, channel))
        cells[channel] = {"enabled": value if value is not None else channel in ("bell", "email"), "available": channel_available(user, channel) if channel in ("push", "whatsapp") else True}
    return {"category": STAFF_CATEGORY, "label": "Alerts for you and your team", "channels": cells}


def set_preferences(user, changes):
    """Apply {"category": {"channel": bool}} from the screen. Locked switches and unknown names are ignored. Returns the new matrix."""
    for category, channels in (changes or {}).items():
        if category not in CUSTOMER_CATEGORIES:
            continue
        for channel, value in (channels or {}).items():
            if channel not in CHANNELS or not isinstance(value, bool):
                continue
            if channel == "email" and category in LOCKED_EMAIL:
                continue
            NotificationPreference.objects.update_or_create(user=user, category=category, channel=channel, defaults={"enabled": value})
    return matrix(user)


def set_staff_preferences(user, channels):
    for channel, value in (channels or {}).items():
        if channel in STAFF_CHANNELS and isinstance(value, bool):
            NotificationPreference.objects.update_or_create(user=user, category=STAFF_CATEGORY, channel=channel, defaults={"enabled": value})
    return staff_matrix(user)


def staff_allows(user, channel, explicit=None):
    explicit = _explicit(user) if explicit is None else explicit
    value = explicit.get((STAFF_CATEGORY, channel))
    if value is not None:
        return value
    return channel in ("bell", "email")


def unsubscribe_token(user):
    return signing.dumps({"u": user.pk}, salt=UNSUB_SALT)


def user_from_unsubscribe_token(token, max_age_days=365):
    from apps.accounts.models import User

    try:
        data = signing.loads(token, salt=UNSUB_SALT, max_age=max_age_days * 86400)
    except signing.BadSignature:
        return None
    return User.objects.filter(pk=data.get("u")).first()
