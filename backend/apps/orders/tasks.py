from celery import shared_task


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
