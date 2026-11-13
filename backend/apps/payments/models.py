import uuid

from django.conf import settings
from django.db import models


class AttemptStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"
    EXPIRED = "expired", "Expired"
    MISMATCH = "mismatch", "Amount/currency mismatch — needs review"
    REVERSED = "reversed", "Reversed (money taken back by the bank/provider)"
    REFUNDED = "refunded", "Refunded in full"


def new_reference():
    return "MPK-" + uuid.uuid4().hex[:20].upper()


class PaymentAttempt(models.Model):
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="payment_attempts")
    provider = models.CharField(max_length=30)
    reference = models.CharField(max_length=60, unique=True, default=new_reference)
    idempotency_key = models.CharField(max_length=80, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    status = models.CharField(max_length=12, choices=AttemptStatus.choices, default=AttemptStatus.PENDING, db_index=True)
    provider_reference = models.CharField(max_length=120, blank=True)
    authorization_url = models.URLField(max_length=500, blank=True)
    raw_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["order", "idempotency_key"], condition=~models.Q(idempotency_key=""), name="uniq_attempt_idempotency"
            )
        ]

    def __str__(self):
        return f"{self.reference} ({self.status})"


class PaymentStatusEvent(models.Model):
    """Audit trail: every change of a payment attempt's state, who/what caused it (FR-PAY-05)."""

    attempt = models.ForeignKey(PaymentAttempt, on_delete=models.CASCADE, related_name="status_events")
    from_status = models.CharField(max_length=12)
    to_status = models.CharField(max_length=12)
    source = models.CharField(max_length=30, blank=True, help_text="webhook, verify, refund, order, staff ...")
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class WebhookEvent(models.Model):
    """Every provider callback is stored once; replays are detected by (provider, event_id) (FR-PAY-06)."""

    provider = models.CharField(max_length=30)
    event_id = models.CharField(max_length=120)
    event_type = models.CharField(max_length=60, blank=True)
    payload = models.JSONField(default=dict)
    processed = models.BooleanField(default=False)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["provider", "event_id"], name="uniq_webhook_event")]


class Refund(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    attempt = models.ForeignKey(PaymentAttempt, on_delete=models.PROTECT, related_name="refunds")
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="refunds")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    provider_reference = models.CharField(max_length=120, blank=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ReconciliationRun(models.Model):
    """One comparison of our payment records against the provider's own transaction list (FR-PAY-08)."""

    provider = models.CharField(max_length=30)
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    matched = models.PositiveIntegerField(default=0)
    exceptions = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ReconciliationRecord(models.Model):
    """One exception found by a run. Finance reviews each and records how it was resolved."""

    class Kind(models.TextChoices):
        PAID_NOT_CONFIRMED = "paid_not_confirmed", "Provider shows paid, our record is not — customer charged"
        MISSING_AT_PROVIDER = "missing_at_provider", "We show paid, provider has no successful charge"
        UNKNOWN_AT_PROVIDER = "unknown_at_provider", "Provider charge with no matching record on our side"
        AMOUNT_MISMATCH = "amount_mismatch", "Amount or currency differs"

    run = models.ForeignKey(ReconciliationRun, on_delete=models.CASCADE, related_name="records")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    reference = models.CharField(max_length=60)
    order_number = models.CharField(max_length=20, blank=True)
    internal_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    provider_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True)
    internal_status = models.CharField(max_length=12, blank=True)
    provider_status = models.CharField(max_length=12, blank=True)
    resolved = models.BooleanField(default=False)
    resolution_note = models.CharField(max_length=255, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["resolved", "kind", "reference"]


class Dispute(models.Model):
    """A customer's bank questioning a charge (chargeback). Opened and updated by provider webhooks (FR-PAY-05)."""

    class Status(models.TextChoices):
        OPEN = "open", "Open — evidence needed"
        EVIDENCE_SENT = "evidence_sent", "Evidence sent, waiting for the bank"
        WON = "won", "Won — we keep the money"
        LOST = "lost", "Lost — money taken back"
        ACCEPTED = "accepted", "Accepted — refunded to the customer"

    attempt = models.ForeignKey(PaymentAttempt, on_delete=models.PROTECT, related_name="disputes")
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="disputes")
    provider = models.CharField(max_length=30)
    provider_dispute_id = models.CharField(max_length=80)
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.OPEN, db_index=True)
    category = models.CharField(max_length=80, blank=True, help_text="Reason the bank gave, as reported by the provider")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    respond_by = models.DateTimeField(null=True, blank=True, help_text="Deadline to send evidence")
    provider_status = models.CharField(max_length=60, blank=True)
    resolution = models.CharField(max_length=60, blank=True)
    notes = models.TextField(blank=True, help_text="What staff did and sent; kept as the case file")
    opened_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "respond_by", "-opened_at"]
        constraints = [models.UniqueConstraint(fields=["provider", "provider_dispute_id"], name="uniq_provider_dispute")]

    def __str__(self):
        return f"Dispute {self.provider_dispute_id} on {self.order.number}"
