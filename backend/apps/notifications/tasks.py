"""Scheduled and batch notification jobs: bag reminders, order feedback requests, back-in-stock messages, announcements."""
import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

BAG_REMINDER_AFTER = timedelta(hours=24)
BAG_REMINDER_WINDOW = timedelta(days=7)  # not for bags forgotten for longer than this
FEEDBACK_AFTER = timedelta(days=5)  # after delivery
FEEDBACK_WINDOW = timedelta(days=30)


@shared_task
def send_bag_reminders():
    """Remind signed-in customers once about a bag they left. One reminder per bag, only if they did not order since."""
    from apps.accounts.models import User
    from apps.orders.models import Cart, Order

    from .events import category_of
    from .preferences import allowed
    from .services import send_notification

    now = timezone.now()
    sent = 0
    carts = Cart.objects.filter(updated_at__lte=now - BAG_REMINDER_AFTER, updated_at__gte=now - BAG_REMINDER_WINDOW, items__isnull=False).select_related("user").distinct()
    for cart in carts:
        user = cart.user
        if not user.is_active or not user.email_verified or not allowed(user, category_of("abandoned_bag"), "email"):
            continue
        if Order.objects.filter(user=user, created_at__gte=cart.updated_at).exists():
            continue
        lines = "\n".join(f"  {i.quantity} x {i.variant.product.name}" for i in cart.items.select_related("variant__product"))
        ref = f"bag-{cart.pk}-{int(cart.updated_at.timestamp())}"
        ok = send_notification("abandoned_bag", user.email, {"lines": lines, "link": f"{settings.FRONTEND_URL}/bag",
                                                             "preferences_url": f"{settings.FRONTEND_URL}/account/notifications"}, ref=ref)
        sent += 1 if ok else 0
    return sent


@shared_task
def send_feedback_requests():
    """Ask customers how a delivered order went, once, a few days after delivery."""
    from apps.orders.models import Order, OrderStatus

    from .services import send_notification

    now = timezone.now()
    sent = 0
    orders = Order.objects.filter(status=OrderStatus.DELIVERED, shipments__delivered_at__lte=now - FEEDBACK_AFTER,
                                  shipments__delivered_at__gte=now - FEEDBACK_WINDOW).select_related("user").distinct()
    for order in orders:
        user = order.user
        if user and not (user.is_active and user.email):
            continue
        if user:
            from .events import category_of
            from .preferences import allowed

            if not allowed(user, category_of("order_feedback"), "email"):
                continue
        ok = send_notification("order_feedback", order.contact_email, {"order_number": order.number, "link": f"{settings.FRONTEND_URL}/support"}, ref=order.number)
        sent += 1 if ok else 0
    return sent


@shared_task
def notify_back_in_stock(variant_id):
    """Tell everyone waiting for this item that it is available, once each."""
    from apps.catalog.models import ProductVariant

    from .models import StockAlert
    from .services import send_notification

    variant = ProductVariant.objects.select_related("product", "inventory").get(pk=variant_id)
    inv = getattr(variant, "inventory", None)
    if not inv or (inv.quantity <= 0 and not inv.allow_backorder):
        return 0
    sent = 0
    for alert in StockAlert.objects.filter(variant=variant, notified_at__isnull=True).select_related("user"):
        user = alert.user
        if user.is_active:
            ok = send_notification("back_in_stock", user.email, {"product": variant.product.name, "link": f"{settings.FRONTEND_URL}/shop/{variant.product.slug}",
                                                                "preferences_url": f"{settings.FRONTEND_URL}/account/notifications"}, ref=f"stock-{alert.pk}")
            sent += 1 if ok else 0
        alert.notified_at = timezone.now()
        alert.save(update_fields=["notified_at"])
    return sent


@shared_task
def send_campaign(campaign_id):
    from .campaigns import run_campaign

    return run_campaign(campaign_id)
