import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template import Context, Engine, TemplateSyntaxError

from .models import EmailTemplate, NotificationLog

logger = logging.getLogger(__name__)
_engine = Engine(autoescape=False)  # plain-text email: no HTML escaping

TAGLINE = "Rooted in Africa. Made for the World."

# key -> (label, subject, body, {variable: example value})
DEFAULTS = {
    "account_verification": (
        "Confirm email address",
        "Confirm your Mpanko email",
        "Welcome to Mpanko — " + TAGLINE + "\n\nConfirm your email address:\n{{ link }}\n\n"
        "If you did not create this account you can ignore this message.",
        {"link": "https://shop.example/verify-email?uid=x&token=y"},
    ),
    "password_reset": (
        "Password reset",
        "Reset your Mpanko password",
        "We received a request to reset your password:\n{{ link }}\n\n"
        "This link expires in 24 hours and works once. If you did not ask for this, ignore this email.",
        {"link": "https://shop.example/reset-password?uid=x&token=y"},
    ),
    "order_confirmation": (
        "Order confirmation",
        "Mpanko order {{ order_number }} confirmed",
        "Thank you for shopping with Mpanko — " + TAGLINE + "\n\nOrder {{ order_number }}\n{{ lines }}\n\n"
        "Shipping: {{ currency }} {{ shipping_total }}\nTotal: {{ currency }} {{ grand_total }}\n",
        {"order_number": "MP-1001", "lines": "  1 x Kente scarf — USD 40.00", "currency": "USD", "shipping_total": "30.00", "grand_total": "70.00"},
    ),
    "guest_order_link": (
        "Guest order link",
        "Your Mpanko order {{ order_number }}",
        "You placed order {{ order_number }} without an account. Use this link to see it, pay for it or track it:\n{{ link }}\n\n"
        "The link works for 30 days. Create an account with this email address any time to keep all your orders in one place.",
        {"order_number": "MP-1001", "link": "https://shop.example/orders/guest/MP-1001?token=x"},
    ),
    "payment_failed": (
        "Payment failed",
        "Payment for order {{ order_number }} did not go through",
        "We could not complete the payment for order {{ order_number }}.\nYou can try again from your orders page:\n{{ link }}\n",
        {"order_number": "MP-1001", "link": "https://shop.example/orders/MP-1001"},
    ),
    "shipment_dispatched": (
        "Order shipped",
        "Your Mpanko order {{ order_number }} is on its way",
        "Good news — order {{ order_number }} has shipped.\nCarrier: {{ carrier }}\nTracking number: {{ tracking_number }}\n",
        {"order_number": "MP-1001", "carrier": "DHL Express", "tracking_number": "1234567890"},
    ),
    "order_delivered": (
        "Order delivered",
        "Your Mpanko order {{ order_number }} was delivered",
        "Order {{ order_number }} has been delivered. We hope you love it.\n\nIf anything is wrong, reply to this email.\n",
        {"order_number": "MP-1001"},
    ),
    "return_requested": (
        "Return request received",
        "We received your return request {{ return_number }}",
        "Thanks. We received your return request {{ return_number }} for order {{ order_number }}.\n"
        "We will review it and email you the decision.\n{{ link }}\n",
        {"return_number": "RT-1A2B3C", "order_number": "MP-1001", "link": "https://shop.example/orders/MP-1001"},
    ),
    "return_approved": (
        "Return approved",
        "Your return {{ return_number }} is approved",
        "Your return {{ return_number }} for order {{ order_number }} is approved.\n{{ staff_note }}\n\n"
        "Send the items back and we will refund {{ currency }} {{ refund_amount }} once they arrive.\n{{ link }}\n",
        {"return_number": "RT-1A2B3C", "order_number": "MP-1001", "staff_note": "Please include the order number in the parcel.",
         "currency": "USD", "refund_amount": "40.00", "link": "https://shop.example/orders/MP-1001"},
    ),
    "return_rejected": (
        "Return not approved",
        "Your return request {{ return_number }}",
        "We could not approve return {{ return_number }} for order {{ order_number }}.\n\nReason: {{ staff_note }}\n\n"
        "If you think this is a mistake, reply to this email or open a support request.\n{{ link }}\n",
        {"return_number": "RT-1A2B3C", "order_number": "MP-1001", "staff_note": "The item was used.", "link": "https://shop.example/orders/MP-1001"},
    ),
    "return_refunded": (
        "Return refunded",
        "Your refund for return {{ return_number }} is on its way",
        "We received your return {{ return_number }} and refunded {{ currency }} {{ refund_amount }} to your original payment method.\n"
        "It can take a few days to show on your statement.\n",
        {"return_number": "RT-1A2B3C", "currency": "USD", "refund_amount": "40.00"},
    ),
    "support_reply": (
        "Support reply",
        "Re: {{ subject }} ({{ case_number }})",
        "{{ body }}\n\nYou can reply here:\n{{ link }}\n",
        {"case_number": "SC-1A2B3C", "subject": "Where is my order?", "body": "Your parcel is with the carrier.", "link": "https://shop.example/account/support/SC-1A2B3C"},
    ),
    "staff_invite": (
        "Staff invitation",
        "You have been added to Mpanko as {{ role }}",
        "You now have a Mpanko back-office account as {{ role }}.\n\nSet your password here, then sign in to the admin app:\n{{ link }}\n\n"
        "The link works once and expires in 24 hours. If you were not expecting this, ignore this email.",
        {"role": "Order / fulfillment staff", "link": "https://admin.example/reset-password?uid=x&token=y"},
    ),
    "dispute_opened": (
        "Chargeback opened (staff)",
        "Chargeback on order {{ order_number }}: send evidence by {{ respond_by }}",
        "A customer's bank is disputing the payment for order {{ order_number }}.\nAmount: {{ amount }}\nReason given: {{ category }}\n"
        "Send evidence (proof of delivery, tracking, messages) before {{ respond_by }} or the money is taken back.\n"
        "Open Payments, then Chargebacks, in the admin app to see the case.\n",
        {"order_number": "MP-1001", "amount": "USD 70.00", "category": "fraudulent", "respond_by": "30 Nov 2026"},
    ),
    "low_stock_alert": (
        "Low stock alert (staff)",
        "Low stock: {{ sku }}",
        "{{ product }} ({{ sku }}) is down to {{ quantity }} in stock. The alert level is {{ threshold }}.\n",
        {"product": "Kente scarf", "sku": "KS-001", "quantity": "3", "threshold": "5"},
    ),
}


def sample_context(key):
    return dict(DEFAULTS[key][3])


def render(text, context):
    return _engine.from_string(text).render(Context(context, autoescape=False))


def validate_template(key, subject, body):
    """Raise ValueError with a plain message if the text cannot be rendered with the key's variables."""
    try:
        render(subject, sample_context(key))
        render(body, sample_context(key))
    except (TemplateSyntaxError, Exception) as exc:  # noqa: BLE001 — any render failure is a staff-facing error
        raise ValueError(str(exc)) from exc


def effective_template(key):
    """(subject, body, is_active, customised)"""
    row = EmailTemplate.objects.filter(key=key).first()
    if row:
        return row.subject, row.body, row.is_active, True
    _, subject, body, _ = DEFAULTS[key]
    return subject, body, True, False


def send_notification(key, to, context, ref="", dedupe=True):
    """
    Render and send one templated email, and log the outcome. With a `ref`, the same (key, ref, recipient)
    is only ever sent once, so retries never double-email (FR-NOT-01). Returns True if sent.
    """
    if not to:
        return False
    if dedupe and ref and NotificationLog.objects.filter(key=key, ref=ref, recipient=to, status=NotificationLog.Status.SENT).exists():
        return False
    subject_t, body_t, active, _ = effective_template(key)
    if not active:
        NotificationLog.objects.create(key=key, recipient=to, status=NotificationLog.Status.SKIPPED, ref=ref)
        return False
    subject = body = ""
    try:
        subject = render(subject_t, context).replace("\n", " ").strip()[:200]
        body = render(body_t, context)
        from .html import to_html

        msg = EmailMultiAlternatives(subject, body, getattr(settings, "DEFAULT_FROM_EMAIL", None), [to])
        msg.attach_alternative(to_html(subject, body), "text/html")
        msg.send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001 — never let a mail problem break checkout or shipping
        logger.warning("Email %s to %s failed: %s", key, to, exc)
        NotificationLog.objects.create(key=key, recipient=to, subject=subject, status=NotificationLog.Status.FAILED, error=str(exc)[:300], ref=ref)
        return False
    NotificationLog.objects.create(key=key, recipient=to, subject=subject, status=NotificationLog.Status.SENT, ref=ref)
    try:
        from .push import push_for_email

        push_for_email(key, to, context)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Push for %s skipped: %s", key, exc)
    try:
        from .sms import sms_for_email

        sms_for_email(key, to, context, ref=ref)
    except Exception as exc:  # noqa: BLE001
        logger.warning("SMS for %s skipped: %s", key, exc)
    try:
        from .whatsapp import whatsapp_for_email

        whatsapp_for_email(key, to, context, ref=ref)
    except Exception as exc:  # noqa: BLE001
        logger.warning("WhatsApp for %s skipped: %s", key, exc)
    return True
