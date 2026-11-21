from celery import shared_task
from apps.notifications.enqueue import enqueue


@shared_task
def expire_unpaid_orders_task():
    from .services import expire_unpaid_orders

    return expire_unpaid_orders()


@shared_task
def send_order_confirmation(order_id):
    from apps.notifications.services import send_notification

    from .models import Order

    order = Order.objects.prefetch_related("items").get(pk=order_id)
    lines = "\n".join(f"  {i.quantity} x {i.product_name} — {order.currency} {i.line_total}" for i in order.items.all())
    send_notification(
        "order_confirmation", order.contact_email,
        {"order_number": order.number, "lines": lines, "currency": order.currency,
         "shipping_total": order.shipping_total, "grand_total": order.grand_total},
        ref=order.number,
    )


@shared_task
def send_payment_failed(order_id, reference):
    from django.conf import settings

    from apps.notifications.services import send_notification

    from .models import Order

    order = Order.objects.get(pk=order_id)
    send_notification(
        "payment_failed", order.contact_email,
        {"order_number": order.number, "link": f"{settings.FRONTEND_URL}/orders/{order.number}"},
        ref=reference,
    )
    enqueue(staff_order_alert, order_id, "staff_payment_failed", {"method": reference})


@shared_task
def send_shipment_email(shipment_id, key):
    from apps.notifications.services import send_notification
    from apps.shipping.models import Shipment

    sh = Shipment.objects.select_related("order__user", "carrier").get(pk=shipment_id)
    user = sh.order.user
    if user and not user.notify_order_emails:
        return
    send_notification(
        key, sh.order.contact_email,
        {"order_number": sh.order.number, "carrier": sh.carrier.name if sh.carrier else sh.service_name,
         "tracking_number": sh.tracking_number or "—"},
        ref=f"shipment-{sh.pk}" if key == "shipment_dispatched" else sh.order.number,
    )


@shared_task
def send_guest_order_link(order_id, dedupe=True):
    from apps.notifications.services import send_notification

    from .guest import order_link
    from .models import Order

    order = Order.objects.get(pk=order_id)
    if order.user_id:
        return
    # The link changes every time it is signed, so a resend is a genuinely new email.
    send_notification(
        "guest_order_link", order.contact_email,
        {"order_number": order.number, "link": order_link(order)},
        ref=order.number if dedupe else f"{order.number}:{order.updated_at.timestamp()}", dedupe=dedupe,
    )


def _link(order):
    from django.conf import settings

    return f"{settings.FRONTEND_URL}/orders/{order.number}"


def is_pickup_order(order):
    svc = order.shipping_service or {}
    return "pickup" in f"{svc.get('service_code', '')} {svc.get('service_name', '')}".lower()


def _who(order):
    addr = order.shipping_address or {}
    return (addr.get("recipient_name") or (order.user.full_name if order.user_id else "") or order.contact_email), addr.get("country", "")


@shared_task
def notify_order_event(order_id, key, extra=None):
    """Tell the customer about one stage of their order (processing, ready for pickup, cancelled, expired, waiting for payment...)."""
    from apps.notifications.services import send_notification

    from .models import Order

    order = Order.objects.get(pk=order_id)
    ctx = {"order_number": order.number, "link": _link(order), "currency": order.currency, "amount": order.grand_total,
           "pickup_place": (order.shipping_service or {}).get("service_name", "our pickup point"), "instructions": ""}
    ctx.update(extra or {})
    send_notification(key, order.contact_email, ctx, ref=f"{order.number}:{key}")


@shared_task
def staff_order_alert(order_id, key, extra=None):
    """Tell staff about an order event: a new paid order, a payment to confirm, a failed payment."""
    from apps.notifications.staff import admin_link, notify_staff

    from .models import Order

    order = Order.objects.prefetch_related("items").get(pk=order_id)
    who, country = _who(order)
    lines = "\n".join(f"  {i.quantity} x {i.product_name}" for i in order.items.all())
    ctx = {"order_number": order.number, "customer": who, "country": country, "lines": lines, "currency": order.currency,
           "grand_total": order.grand_total, "amount": order.grand_total, "delivery": (order.shipping_service or {}).get("service_name", ""),
           "method": "", "link": admin_link(f"orders/{order.number}" if key != "staff_manual_payment" else "manual-payments")}
    ctx.update(extra or {})
    notify_staff(key, ctx, ref=f"{order.number}:{key}:{(extra or {}).get('method', '')}", path_ref=order.number if key != "staff_manual_payment" else "")
