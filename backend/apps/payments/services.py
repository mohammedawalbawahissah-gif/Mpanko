import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from apps.orders import services as order_services
from apps.orders.models import Order, OrderStatus

from .models import AttemptStatus, PaymentAttempt, Refund
from .providers import ProviderError, get_provider

logger = logging.getLogger(__name__)


@transaction.atomic
def apply_result(reference, status, amount=None, currency="", provider_reference="", raw=None):
    """
    The single place where a provider outcome changes our records. Safe to call any number of times for the
    same payment (webhook retries, customer returning twice, verify polling) — money effects happen once.
    """
    attempt = PaymentAttempt.objects.select_for_update().filter(reference=reference).first()
    if attempt is None:
        logger.warning("Payment result for unknown reference %s", reference)
        return None
    if attempt.status == AttemptStatus.SUCCEEDED:
        return attempt  # already applied

    if raw:
        attempt.raw_response = {**attempt.raw_response, "last_event": raw}
    if provider_reference:
        attempt.provider_reference = provider_reference

    if status == "succeeded":
        # Never trust a "success" whose amount or currency differs from what we asked for.
        if (amount is not None and Decimal(amount) != attempt.amount) or (currency and currency.upper() != attempt.currency):
            attempt.status = AttemptStatus.MISMATCH
            attempt.save()
            logger.error("Payment %s amount/currency mismatch; order not confirmed", reference)
            return attempt
        attempt.status = AttemptStatus.SUCCEEDED
        attempt.save()
        order = Order.objects.select_for_update().get(pk=attempt.order_id)
        if order.status == OrderStatus.PENDING_PAYMENT:
            order_services.mark_paid(order, note=f"Payment verified via {attempt.provider}")
        else:
            # Paid after the order expired/cancelled: keep the money record, flag for finance review.
            logger.error("Payment %s succeeded but order %s is '%s' — needs manual review", reference, order.number, order.status)
    elif status == "failed":
        attempt.status = AttemptStatus.FAILED
        attempt.save()
    else:
        attempt.save()
    return attempt


def refundable_amount(attempt):
    refunded = attempt.refunds.exclude(status=Refund.Status.FAILED).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    return attempt.amount - refunded


@transaction.atomic
def issue_refund(order, amount, reason, actor):
    attempt = order.payment_attempts.select_for_update().filter(status=AttemptStatus.SUCCEEDED).first()
    if not attempt:
        raise ProviderError("This order has no successful payment to refund.")
    remaining = refundable_amount(attempt)
    amount = Decimal(amount) if amount is not None else remaining
    if amount <= 0 or amount > remaining:
        raise ProviderError(f"Refund must be between 0.01 and {remaining} {attempt.currency}.")
    provider_ref = get_provider(attempt.provider).refund(attempt, amount, reason)
    refund = Refund.objects.create(
        attempt=attempt, order=order, amount=amount, currency=attempt.currency, reason=reason,
        status=Refund.Status.SUCCEEDED, provider_reference=provider_ref, requested_by=actor,
    )
    if refundable_amount(attempt) == 0:
        order_services.transition(order, OrderStatus.REFUNDED, actor=actor, note=reason or "Fully refunded")
    return refund


# --- Reconciliation ---------------------------------------------------------------------------------------------

def reconcile(provider_name, start, end, actor=None):
    """
    Compare our PaymentAttempts with the provider's transaction list for [start, end] and store every exception.
    The costly one is PAID_NOT_CONFIRMED: the customer was charged but the order never became paid.
    """
    from .models import ReconciliationRecord, ReconciliationRun

    provider = get_provider(provider_name)
    theirs = {t["reference"]: t for t in provider.list_transactions(start, end) if t["reference"].startswith("MPK-")}
    ours = {a.reference: a for a in PaymentAttempt.objects.filter(provider=provider_name, created_at__gte=start, created_at__lte=end).select_related("order")}
    run = ReconciliationRun.objects.create(provider=provider_name, period_start=start, period_end=end, created_by=actor)
    matched, records = 0, []

    def add(kind, ref, attempt=None, t=None):
        records.append(ReconciliationRecord(
            run=run, kind=kind, reference=ref, order_number=attempt.order.number if attempt else "",
            internal_amount=attempt.amount if attempt else None, provider_amount=t["amount"] if t else None,
            currency=(attempt.currency if attempt else t["currency"]) if (attempt or t) else "",
            internal_status=attempt.status if attempt else "", provider_status=t["status"] if t else "",
        ))

    for ref in set(ours) | set(theirs):
        a, t = ours.get(ref), theirs.get(ref)
        if a and t:
            if t["status"] == "succeeded" and a.status != AttemptStatus.SUCCEEDED:
                add(ReconciliationRecord.Kind.PAID_NOT_CONFIRMED, ref, a, t)
            elif t["status"] == "succeeded" and (t["amount"] != a.amount or t["currency"] != a.currency):
                add(ReconciliationRecord.Kind.AMOUNT_MISMATCH, ref, a, t)
            elif a.status == AttemptStatus.SUCCEEDED and t["status"] != "succeeded":
                add(ReconciliationRecord.Kind.MISSING_AT_PROVIDER, ref, a, t)
            else:
                matched += 1
        elif a and a.status == AttemptStatus.SUCCEEDED:
            add(ReconciliationRecord.Kind.MISSING_AT_PROVIDER, ref, a, None)
        elif t and t["status"] == "succeeded":
            add(ReconciliationRecord.Kind.UNKNOWN_AT_PROVIDER, ref, None, t)
        else:
            matched += 1  # e.g. abandoned/failed on both sides, or a pending attempt the provider never saw
    ReconciliationRecord.objects.bulk_create(records)
    run.matched, run.exceptions = matched, len(records)
    run.save(update_fields=["matched", "exceptions"])
    return run
