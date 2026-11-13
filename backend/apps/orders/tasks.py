from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail


@shared_task
def expire_unpaid_orders_task():
    from .services import expire_unpaid_orders

    return expire_unpaid_orders()


@shared_task
def send_order_confirmation(order_id):
    from .models import Order

    order = Order.objects.prefetch_related("items").get(pk=order_id)
    lines = "\n".join(f"  {i.quantity} x {i.product_name} — {order.currency} {i.line_total}" for i in order.items.all())
    send_mail(
        subject=f"Mpanko order {order.number} confirmed",
        message=(
            f"Thank you for shopping with Mpanko — Rooted in Africa. Made for the World.\n\n"
            f"Order {order.number}\n{lines}\n\n"
            f"Shipping: {order.currency} {order.shipping_total}\nTotal: {order.currency} {order.grand_total}\n"
        ),
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
        recipient_list=[order.contact_email],
        fail_silently=True,
    )
