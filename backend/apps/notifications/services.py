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
    "corporate_enquiry": (
        "Website enquiry (staff)",
        "New enquiry from {{ name }} about {{ about }}",
        "{{ name }} wrote to you through the corporate website.\n\nEmail: {{ email }}\nPhone: {{ phone }}\nAbout: {{ about }}\n\n{{ message }}\n\n"
        "Reply to them directly at {{ email }}, then open Enquiries in the admin app and mark it handled.\n",
        {"name": "Ama Mensah", "email": "ama@example.com", "phone": "+233200000000", "about": "Mpanko", "message": "Do you ship to Canada?"},
    ),
    "low_stock_alert": (
        "Low stock alert (staff)",
        "Low stock: {{ sku }}",
        "{{ product }} ({{ sku }}) is down to {{ quantity }} in stock. The alert level is {{ threshold }}.\n",
        {"product": "Kente scarf", "sku": "KS-001", "quantity": "3", "threshold": "5"},
    ),

    "order_awaiting_payment": (
        "Order held, waiting for payment",
        "Order {{ order_number }} is held for you",
        "We are holding order {{ order_number }} for you.\n\n{{ instructions }}\n\nOnce the money arrives we confirm your order and email you.\nSee your order: {{ link }}\n",
        {"order_number": "MP-1001", "instructions": "Send exactly USD 70.00 with Zelle to 508-410-9719. Write MP-1001 in the memo.", "link": "https://shop.example/orders/MP-1001"},
    ),
    "order_processing": (
        "Order being prepared",
        "We are preparing order {{ order_number }}",
        "Good news: we have started preparing order {{ order_number }}. We will email you again when it ships or is ready for pickup.\nSee your order: {{ link }}\n",
        {"order_number": "MP-1001", "link": "https://shop.example/orders/MP-1001"},
    ),
    "order_ready_for_pickup": (
        "Order ready for pickup",
        "Order {{ order_number }} is ready for pickup",
        "Order {{ order_number }} is ready for you to collect.\n\nPickup: {{ pickup_place }}\nBring your order number.\nSee your order: {{ link }}\n",
        {"order_number": "MP-1001", "pickup_place": "Worcester, Massachusetts", "link": "https://shop.example/orders/MP-1001"},
    ),
    "order_cancelled": (
        "Order cancelled",
        "Order {{ order_number }} was cancelled",
        "Order {{ order_number }} was cancelled. If you paid, we will refund you to your original payment method.\nQuestions? Reach us from the Help page: {{ link }}\n",
        {"order_number": "MP-1001", "link": "https://shop.example/support"},
    ),
    "order_expired": (
        "Order released",
        "We released order {{ order_number }}",
        "We did not receive payment for order {{ order_number }} in time, so we released the items. You can place the order again any time.\n{{ link }}\n",
        {"order_number": "MP-1001", "link": "https://shop.example/shop"},
    ),
    "abandoned_bag": (
        "Bag reminder",
        "You left something in your bag",
        "Your bag is waiting:\n{{ lines }}\n\nFinish your order whenever you are ready: {{ link }}\n\nStop these reminders: {{ preferences_url }}\n",
        {"lines": "  1 x Kente scarf", "link": "https://shop.example/bag", "preferences_url": "https://shop.example/account/notifications"},
    ),
    "back_in_stock": (
        "Back in stock",
        "{{ product }} is back in stock",
        "You asked us to tell you when {{ product }} is available again. It is back: {{ link }}\n\nStock can go quickly. Stop these messages: {{ preferences_url }}\n",
        {"product": "Kente scarf", "link": "https://shop.example/shop/kente-scarf", "preferences_url": "https://shop.example/account/notifications"},
    ),
    "order_feedback": (
        "How was your order?",
        "How was order {{ order_number }}?",
        "Your order {{ order_number }} was delivered. We would love to know how it went. Tell us from the Help page and a person will read it: {{ link }}\n",
        {"order_number": "MP-1001", "link": "https://shop.example/support"},
    ),
    "announcement": (
        "Announcement (campaigns)",
        "{{ subject }}",
        "{{ message }}\n\n{{ link }}\n\nYou get this because you chose to hear from us. Unsubscribe: {{ unsubscribe_url }}\n",
        {"subject": "A new collection", "message": "Our new collection has arrived.", "link": "https://shop.example/shop", "unsubscribe_url": "https://api.example/unsubscribe"},
    ),
    "staff_new_order": (
        "New order (staff)",
        "New order {{ order_number }}: {{ currency }} {{ grand_total }}",
        "{{ customer }} ({{ country }}) paid for order {{ order_number }}.\n{{ lines }}\nTotal: {{ currency }} {{ grand_total }}\nDelivery: {{ delivery }}\n\nOpen it: {{ link }}\n",
        {"order_number": "MP-1001", "customer": "Ama Mensah", "country": "US", "lines": "  1 x Kente scarf", "currency": "USD", "grand_total": "70.00", "delivery": "Local delivery", "link": "https://admin.example/orders/MP-1001"},
    ),
    "staff_manual_payment": (
        "Payment to confirm (staff)",
        "Confirm payment for order {{ order_number }}",
        "{{ customer }} chose {{ method }} for order {{ order_number }}: {{ currency }} {{ amount }}.\nCheck your {{ method }} account for it, then confirm it here: {{ link }}\n",
        {"order_number": "MP-1001", "customer": "Ama Mensah", "method": "Zelle", "currency": "USD", "amount": "70.00", "link": "https://admin.example/manual-payments"},
    ),
    "staff_payment_failed": (
        "Payment failed (staff)",
        "Payment failed for order {{ order_number }}",
        "A payment for order {{ order_number }} from {{ customer }} did not go through.\nOpen it: {{ link }}\n",
        {"order_number": "MP-1001", "customer": "Ama Mensah", "link": "https://admin.example/orders/MP-1001"},
    ),
    "staff_return_requested": (
        "Return requested (staff)",
        "Return {{ return_number }} requested for order {{ order_number }}",
        "{{ customer }} asked to return items from order {{ order_number }}.\nReview it: {{ link }}\n",
        {"return_number": "RT-1A2B3C", "order_number": "MP-1001", "customer": "Ama Mensah", "link": "https://admin.example/returns"},
    ),
    "staff_support_case": (
        "New support message (staff)",
        "New support message {{ case_number }}",
        "{{ customer }} wrote: {{ subject }}\n\n{{ body }}\n\nReply: {{ link }}\n",
        {"case_number": "SUP-1", "customer": "Ama Mensah", "subject": "Where is my order?", "body": "It has been a week.", "link": "https://admin.example/support"},
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


def send_notification(key, to, context, ref="", dedupe=True, fanout=True, headers=None):
    """
    Render and send one templated email, and log the outcome. With a `ref`, the same (key, ref, recipient)
    is only ever sent once, so retries never double-email (FR-NOT-01). Returns True if sent.
    `fanout=False` sends the email alone (staff alerts choose their own channels). `headers` adds email headers, e.g. List-Unsubscribe.
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

        msg = EmailMultiAlternatives(subject, body, getattr(settings, "DEFAULT_FROM_EMAIL", None), [to], headers=headers or None)
        msg.attach_alternative(to_html(subject, body), "text/html")
        msg.send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001 — never let a mail problem break checkout or shipping
        logger.warning("Email %s to %s failed: %s", key, to, exc)
        NotificationLog.objects.create(key=key, recipient=to, subject=subject, status=NotificationLog.Status.FAILED, error=str(exc)[:300], ref=ref)
        return False
    NotificationLog.objects.create(key=key, recipient=to, subject=subject, status=NotificationLog.Status.SENT, ref=ref)
    if not fanout:
        return True
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
