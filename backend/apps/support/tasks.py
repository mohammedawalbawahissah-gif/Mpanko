from celery import shared_task
from django.conf import settings


def _ctx(req):
    return {
        "return_number": req.number, "order_number": req.order.number, "staff_note": req.staff_note or "",
        "currency": req.order.currency, "refund_amount": req.refund_amount or "",
        "link": f"{settings.FRONTEND_URL}/orders/{req.order.number}",
    }


@shared_task
def send_return_email(key, return_id):
    from apps.notifications.services import send_notification

    from .models import ReturnRequest

    req = ReturnRequest.objects.select_related("order").get(pk=return_id)
    send_notification(key, req.order.contact_email, _ctx(req), ref=f"{req.number}:{req.status}")


@shared_task
def send_case_reply(message_id):
    from apps.notifications.services import send_notification

    from .models import SupportMessage

    msg = SupportMessage.objects.select_related("case__user").get(pk=message_id)
    case = msg.case
    if case.user_id:
        send_notification(
            "support_reply", case.user.email,
            {"case_number": case.number, "subject": case.subject, "body": msg.body, "link": f"{settings.FRONTEND_URL}/account/support/{case.number}"},
            ref=f"{case.number}:{msg.pk}",
        )
