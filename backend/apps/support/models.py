import secrets

from django.conf import settings
from django.db import models


def return_number():
    return "RT-" + secrets.token_hex(3).upper()


def case_number():
    return "SC-" + secrets.token_hex(3).upper()


class ReturnRequest(models.Model):
    """A customer's request to send items back (FR-ORD-05, WF-02)."""

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        APPROVED = "approved", "Approved, awaiting parcel"
        REJECTED = "rejected", "Rejected"
        RECEIVED = "received", "Received"
        REFUNDED = "refunded", "Refunded"
        CANCELLED = "cancelled", "Cancelled by customer"

    class Reason(models.TextChoices):
        DAMAGED = "damaged", "Arrived damaged"
        WRONG_ITEM = "wrong_item", "Wrong item sent"
        NOT_AS_DESCRIBED = "not_as_described", "Not as described"
        CHANGED_MIND = "changed_mind", "Changed my mind"
        OTHER = "other", "Other"

    number = models.CharField(max_length=12, unique=True, default=return_number, editable=False)
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="returns")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="returns")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.REQUESTED, db_index=True)
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.CharField(max_length=1000, blank=True)
    staff_note = models.CharField(max_length=500, blank=True, help_text="Shown to the customer with the decision")
    refund_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, help_text="In the order's currency")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.number


class ReturnItem(models.Model):
    request = models.ForeignKey(ReturnRequest, on_delete=models.CASCADE, related_name="items")
    order_item = models.ForeignKey("orders.OrderItem", on_delete=models.PROTECT, related_name="return_items")
    quantity = models.PositiveIntegerField()


class SupportCase(models.Model):
    """A customer's question or problem, optionally about an order (FR-CUS-04)."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ANSWERED = "answered", "Answered, waiting on customer"
        CLOSED = "closed", "Closed"

    number = models.CharField(max_length=12, unique=True, default=case_number, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="support_cases")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="support_cases")
    subject = models.CharField(max_length=150)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.number


class SupportMessage(models.Model):
    case = models.ForeignKey(SupportCase, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    from_staff = models.BooleanField(default=False)
    body = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
