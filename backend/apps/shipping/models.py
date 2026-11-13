from django.conf import settings
from django.db import models


class Carrier(models.Model):
    name = models.CharField(max_length=100)
    code = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)
    provider = models.CharField(
        max_length=20, default="manual", blank=True,
        help_text="'dhl' to poll DHL for tracking automatically; 'manual' for hand-entered tracking",
    )
    webhook_secret = models.CharField(
        max_length=100, blank=True, help_text="Shared secret for signed inbound tracking webhooks. Blank = webhooks disabled."
    )
    # Carrier-portal users: a carrier user only ever sees shipments assigned to their own carrier(s).
    users = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="carriers")

    def __str__(self):
        return self.name


class ShipmentStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    ASSIGNED = "assigned", "Assigned to carrier"
    ACCEPTED = "accepted", "Accepted by carrier"
    DECLINED = "declined", "Declined by carrier"
    IN_TRANSIT = "in_transit", "In transit"
    OUT_FOR_DELIVERY = "out_for_delivery", "Out for delivery"
    DELIVERED = "delivered", "Delivered"
    EXCEPTION = "exception", "Delivery exception"
    RETURNED = "returned", "Returned to sender"


class Shipment(models.Model):
    order = models.ForeignKey("orders.Order", on_delete=models.CASCADE, related_name="shipments")
    carrier = models.ForeignKey(Carrier, null=True, blank=True, on_delete=models.SET_NULL, related_name="shipments")
    service_name = models.CharField(max_length=120, blank=True)
    tracking_number = models.CharField(max_length=100, blank=True)
    label_reference = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=ShipmentStatus.choices, default=ShipmentStatus.PENDING)
    override_reason = models.CharField(max_length=255, blank=True, help_text="Required when staff override the customer's chosen service")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Shipment {self.pk} for {self.order.number}"


class TrackingEvent(models.Model):
    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name="events")
    status = models.CharField(max_length=20, choices=ShipmentStatus.choices)
    description = models.CharField(max_length=255, blank=True)
    location = models.CharField(max_length=150, blank=True)
    occurred_at = models.DateTimeField()
    external_id = models.CharField(max_length=100, blank=True, help_text="Carrier event id used to de-duplicate webhook retries")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["shipment", "external_id"], condition=~models.Q(external_id=""), name="uniq_shipment_external_event"
            )
        ]
