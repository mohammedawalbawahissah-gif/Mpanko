from django.conf import settings
from django.db import models


class EmailTemplate(models.Model):
    """Staff-edited override of a built-in email. No row = the built-in default is used (FR-NOT-03)."""

    key = models.SlugField(unique=True)
    subject = models.CharField(max_length=200)
    body = models.TextField()
    is_active = models.BooleanField(default=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key


class NotificationLog(models.Model):
    """One row per attempted send: what, to whom, and whether it worked."""

    class Status(models.TextChoices):
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped (template turned off)"

    key = models.CharField(max_length=60, db_index=True)
    channel = models.CharField(max_length=10, default="email", help_text="email or sms")
    recipient = models.CharField(max_length=254, help_text="Email address, or phone number for SMS")
    subject = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices)
    error = models.CharField(max_length=300, blank=True)
    ref = models.CharField(max_length=60, blank=True, help_text="Order number, shipment id, etc. Used so one event emails once.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["key", "ref", "recipient"])]


class DeviceToken(models.Model):
    """A phone that can receive push notifications for a customer (S7-04, INT-07)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="device_tokens")
    token = models.CharField(max_length=200, unique=True)
    platform = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)
