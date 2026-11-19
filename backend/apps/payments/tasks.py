import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import AttemptStatus, PaymentAttempt
from .providers import ProviderError, get_provider
from .services import apply_result

logger = logging.getLogger(__name__)

# Providers whose callback carries no signature and is sent once (MTN) or may never arrive (Hubtel asks merchants
# to check status themselves when no final status shows up within minutes). We ask them directly instead.
POLLED_PROVIDERS = ("mtn_momo", "hubtel")
MIN_AGE = timedelta(minutes=3)   # give the callback a chance first
MAX_AGE = timedelta(days=3)      # stop asking about payments nobody completed


def reverify_pending_payments(now=None):
    """
    Ask the provider about old pending (or recently expired) mobile-money attempts. Returns how many changed state.
    Expired attempts are included because a shopper can approve the phone prompt after the reservation window closed;
    apply_result records that money and flags the order for finance review instead of dropping it.
    """
    now = now or timezone.now()
    due = PaymentAttempt.objects.filter(
        provider__in=POLLED_PROVIDERS, status__in=(AttemptStatus.PENDING, AttemptStatus.EXPIRED),
        created_at__lte=now - MIN_AGE, created_at__gte=now - MAX_AGE,
    ).order_by("created_at")[:200]
    changed = 0
    for attempt in list(due):
        try:
            v = get_provider(attempt.provider).verify(attempt)
        except ProviderError as exc:
            logger.warning("Re-verify of %s failed: %s", attempt.reference, exc)
            continue
        except Exception:  # one bad payment must not stop the rest
            logger.exception("Re-verify of %s crashed", attempt.reference)
            continue
        if v.status == "pending" or (attempt.status == AttemptStatus.EXPIRED and v.status != "succeeded"):
            continue
        result = apply_result(attempt.reference, v.status, v.amount, v.currency, v.provider_reference, source="poll")
        if result is not None and result.status != attempt.status:
            changed += 1
    return changed


@shared_task
def reverify_pending_payments_task():
    return reverify_pending_payments()
