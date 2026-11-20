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


class InboxMessage(models.Model):
    """What a customer sees in the app's notification list: one row per event that also emailed or pushed them."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="inbox")
    key = models.CharField(max_length=60)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=200, blank=True)
    path = models.CharField(max_length=80, blank=True, help_text="Where tapping it goes, e.g. orders/MP-1234 or support/SUP-1")
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["user", "read_at"])]


class WebPushSubscription(models.Model):
    """A browser that can receive push notifications for a customer."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="web_push_subscriptions")
    endpoint = models.CharField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)


class NotificationPreference(models.Model):
    """One switch: a person turns a kind of message on or off for one channel. No row means the default applies."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_preferences")
    category = models.CharField(max_length=20)
    channel = models.CharField(max_length=10)
    enabled = models.BooleanField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "category", "channel"], name="uniq_notification_preference")]


class StockAlert(models.Model):
    """A customer asked to be told when an out-of-stock item is available again."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stock_alerts")
    variant = models.ForeignKey("catalog.ProductVariant", on_delete=models.CASCADE, related_name="stock_alerts")
    created_at = models.DateTimeField(auto_now_add=True)
    notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "variant"], name="uniq_stock_alert")]


class Campaign(models.Model):
    """An announcement or offer that staff send to customers who agreed to receive them."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"

    title = models.CharField(max_length=120, help_text="Only staff see this name")
    subject = models.CharField(max_length=200)
    body = models.TextField(help_text="The message. Plain text; a blank line starts a new paragraph.")
    link = models.URLField(blank=True, help_text="Optional page the message points to")
    send_email = models.BooleanField(default=True)
    send_push = models.BooleanField(default=True, help_text="App list, phone and browser notification, for customers who allowed them")
    countries = models.JSONField(default=list, blank=True, help_text="Two-letter country codes. Empty means everyone who agreed.")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    sent_at = models.DateTimeField(null=True, blank=True)
    emailed = models.PositiveIntegerField(default=0)
    pushed = models.PositiveIntegerField(default=0)
    skipped = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.title
