"""Chargebacks: opened and resolved by provider webhooks, worked by finance staff."""
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import AttemptStatus, Dispute, PaymentAttempt

logger = logging.getLogger(__name__)

# Provider words for how a resolved dispute ended. Anything that is not clearly a win for us is treated as a loss.
WON = {"merchant-accepted", "won", "warning_closed", "resolved-in-favour-of-merchant", "merchant_won"}
ACCEPTED = {"accepted", "refunded", "customer-refunded"}


@transaction.atomic
def record_dispute(provider, info, reference):
    """Create or update the dispute for a webhook. Returns the Dispute, or None if the payment is not ours."""
    attempt = PaymentAttempt.objects.select_for_update().filter(reference=reference).first()
    if attempt is None:
        logger.error("Dispute %s for unknown payment reference %s", info.get("id"), reference)
        return None
    amount = info.get("amount") or attempt.amount
    dispute, created = Dispute.objects.get_or_create(
        provider=provider, provider_dispute_id=info["id"],
        defaults={"attempt": attempt, "order": attempt.order, "amount": amount, "currency": info.get("currency") or attempt.currency},
    )
    dispute.provider_status = info.get("status", "")[:60]
    dispute.category = (info.get("category") or dispute.category)[:80]
    if info.get("respond_by"):
        dispute.respond_by = parse_datetime(str(info["respond_by"])) or dispute.respond_by
    if info.get("resolved"):
        resolution = (info.get("resolution") or info.get("status") or "").lower()
        dispute.resolution = resolution[:60]
        dispute.resolved_at = timezone.now()
        if resolution in WON:
            dispute.status = Dispute.Status.WON
        elif resolution in ACCEPTED:
            dispute.status = Dispute.Status.ACCEPTED
        else:
            dispute.status = Dispute.Status.LOST
    dispute.save()
    if dispute.status in {Dispute.Status.LOST, Dispute.Status.ACCEPTED}:
        # The money is gone. Reverse the payment so the order shows refunded and reports match the bank.
        from .services import apply_result

        apply_result(reference, "reversed", source="dispute", raw={"dispute": dispute.provider_dispute_id})
    if created:
        transaction.on_commit(lambda: alert_staff(dispute.pk))
    return dispute


def alert_staff(dispute_id):
    """Email store admins and finance that a chargeback needs evidence by a deadline."""
    from apps.accounts.models import Role, User
    from apps.notifications.services import send_notification

    d = Dispute.objects.select_related("order").get(pk=dispute_id)
    ctx = {
        "order_number": d.order.number, "amount": f"{d.currency} {d.amount}", "category": d.category or "not given",
        "respond_by": d.respond_by.strftime("%d %b %Y") if d.respond_by else "see your payment dashboard",
    }
    people = set(User.objects.filter(role__in=[Role.STORE_ADMIN, Role.FINANCE], is_active=True).values_list("email", flat=True))
    people |= set(getattr(settings, "STAFF_ALERT_EMAILS", []))
    for email in sorted(people):
        send_notification("dispute_opened", email, ctx, ref=f"dispute-{d.pk}")
