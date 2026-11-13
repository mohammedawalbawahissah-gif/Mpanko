from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import AuditLog, Role, User
from apps.orders.models import Order, OrderStatus
from apps.orders.services import transition

from .models import ConsentRecord, LegalPage

OPEN_ORDER_STATES = [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED]
OPEN_RETURN_STATES = ["requested", "approved", "received"]


class DeletionBlocked(Exception):
    pass


def current_version(slug):
    page = LegalPage.objects.filter(slug=slug).first()
    return page.version if page else 1


def record_consent(user, kind, granted):
    version = current_version({"terms": "terms", "privacy": "privacy"}.get(kind, kind))
    return ConsentRecord.objects.create(user=user, kind=kind, granted=bool(granted), version=version)


def export_user_data(user):
    """Everything we hold about this person, as plain data they can keep."""
    orders = []
    for o in user.orders.prefetch_related("items", "shipments"):
        orders.append({
            "number": o.number, "status": o.status, "placed": o.created_at.isoformat(), "currency": o.currency,
            "subtotal": str(o.subtotal), "discount": str(o.discount_total), "shipping": str(o.shipping_total), "tax": str(o.tax_total),
            "total": str(o.grand_total), "coupon_code": o.coupon_code, "contact_email": o.contact_email, "contact_phone": o.contact_phone,
            "shipping_address": o.shipping_address, "delivery_notes": o.delivery_notes,
            "items": [{"product": i.product_name, "variant": i.variant_name, "sku": i.sku, "quantity": i.quantity, "unit_price": str(i.unit_price)} for i in o.items.all()],
            "shipments": [{"carrier": s.carrier.name if s.carrier else "", "tracking_number": s.tracking_number, "status": s.status} for s in o.shipments.all()],
        })
    return {
        "exported_at": timezone.now().isoformat(),
        "profile": {
            "email": user.email, "full_name": user.full_name, "phone": user.phone, "joined": user.date_joined.isoformat(),
            "marketing_opt_in": user.marketing_opt_in, "notify_order_emails": user.notify_order_emails, "notify_sms": user.notify_sms,
            "notify_push": user.notify_push, "preferred_currency": user.preferred_currency,
        },
        "addresses": [{"label": a.label, "recipient_name": a.recipient_name, "phone": a.phone, "line1": a.line1, "line2": a.line2, "city": a.city,
                       "region": a.region, "postal_code": a.postal_code, "country": a.country} for a in user.addresses.all()],
        "orders": orders,
        "returns": [{"number": r.number, "order": r.order.number, "status": r.status, "reason": r.reason, "note": r.note, "created": r.created_at.isoformat()}
                    for r in user.returns.select_related("order")],
        "support_requests": [{"number": c.number, "subject": c.subject, "status": c.status,
                              "messages": [{"from_staff": m.from_staff, "body": m.body, "sent": m.created_at.isoformat()} for m in c.messages.all()]}
                             for c in user.support_cases.prefetch_related("messages")],
        "consents": [{"kind": c.kind, "granted": c.granted, "version": c.version, "recorded": c.created_at.isoformat()} for c in user.consents.all()],
    }


def _anonymise_order(order):
    country = (order.shipping_address or {}).get("country", "")
    Order.objects.filter(pk=order.pk).update(
        contact_email="", contact_phone="", delivery_notes="", shipping_address={"anonymised": True, "country": country},
    )


@transaction.atomic
def delete_account(user):
    """
    Erase a customer's personal data. Orders stay (tax and accounting need them) but lose every personal detail.
    Refused while an order is still being fulfilled or a return is open, because we still need to reach them.
    """
    if user.role != Role.CUSTOMER:
        raise DeletionBlocked("Staff accounts are removed by an administrator.")
    busy = list(user.orders.filter(status__in=OPEN_ORDER_STATES).values_list("number", flat=True))
    if busy:
        raise DeletionBlocked(f"Order {', '.join(busy)} is still being handled. You can delete your account once it is delivered or cancelled.")
    open_returns = list(user.returns.filter(status__in=OPEN_RETURN_STATES).values_list("number", flat=True))
    if open_returns:
        raise DeletionBlocked(f"Return {', '.join(open_returns)} is still open. You can delete your account once it is finished.")
    for order in user.orders.filter(status=OrderStatus.PENDING_PAYMENT):
        transition(order, OrderStatus.CANCELLED, actor=user, note="Account deleted")
    for order in user.orders.all():
        _anonymise_order(order)
    user.addresses.all().delete()
    user.support_cases.all().delete()
    from apps.orders.models import Cart

    Cart.objects.filter(user=user).delete()
    if hasattr(user, "totp_device"):
        user.totp_device.delete()
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for t in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=t)
    pk = user.pk
    user.email = f"deleted-{pk}@deleted.invalid"
    user.full_name = user.phone = user.preferred_currency = ""
    user.marketing_opt_in = user.notify_sms = user.notify_push = user.notify_order_emails = user.email_verified = False
    user.is_active = False
    user.set_unusable_password()
    user.save()
    ConsentRecord.objects.create(user=user, kind=ConsentRecord.Kind.MARKETING, granted=False, version=current_version("privacy"))
    AuditLog.record(None, "account.delete", user, user_id=pk)
    return user


def apply_retention(now=None):
    """Remove data we no longer need. Safe to run daily. Returns a count per rule."""
    from apps.notifications.models import NotificationLog
    from apps.support.models import SupportCase

    now = now or timezone.now()
    done = {}
    stale = User.objects.filter(role=Role.CUSTOMER, email_verified=False, is_active=True, date_joined__lt=now - timedelta(days=settings.RETENTION_UNVERIFIED_DAYS),
                                orders__isnull=True).distinct()
    done["unverified_accounts"] = stale.count()
    for u in list(stale):
        u.delete()
    done["email_logs"] = NotificationLog.objects.filter(created_at__lt=now - timedelta(days=settings.RETENTION_LOG_DAYS)).delete()[0]
    done["closed_support"] = SupportCase.objects.filter(status="closed", updated_at__lt=now - timedelta(days=settings.RETENTION_CLOSED_SUPPORT_DAYS)).delete()[0]
    cutoff = now - timedelta(days=365 * settings.RETENTION_ORDER_YEARS)
    done["old_orders"] = 0
    for o in list(Order.objects.filter(created_at__lt=cutoff)):
        if (o.shipping_address or {}).get("anonymised"):
            continue
        _anonymise_order(o)
        done["old_orders"] += 1
    return done
