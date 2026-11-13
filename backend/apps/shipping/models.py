from django.conf import settings
from django.db import models


class Carrier(models.Model):
    name = models.CharField(max_length=100)
    code = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)
    provider = models.CharField(
        max_length=20, default="manual", blank=True,
        help_text="'dhl', 'fedex' or 'ups' for live rates, labels and tracking (needs credentials); 'manual' for hand-entered tracking",
    )
    webhook_secret = models.CharField(
        max_length=100, blank=True, help_text="Shared secret for signed inbound tracking webhooks. Blank = webhooks disabled."
    )
    # Carrier-portal users: a carrier user only ever sees shipments assigned to their own carrier(s).
    users = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="carriers")

    def __str__(self):
        return self.name


class ShippingZone(models.Model):
    """A group of destination countries that share one rate table (FR-SHP-02). "*" means the rest of the world."""

    name = models.CharField(max_length=100, unique=True)
    countries = models.JSONField(default=list, help_text='ISO 2-letter codes, e.g. ["GH"], or ["*"] for everywhere else')
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ShippingRate(models.Model):
    """One service offered in a zone. Price = base + per-kg x billable kilograms, in the store currency."""

    zone = models.ForeignKey(ShippingZone, on_delete=models.CASCADE, related_name="rates")
    service_code = models.SlugField(max_length=60)
    service_name = models.CharField(max_length=120)
    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    price_per_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    min_weight_grams = models.PositiveIntegerField(default=0)
    max_weight_grams = models.PositiveIntegerField(null=True, blank=True, help_text="Blank = no upper limit")
    eta_days_min = models.PositiveSmallIntegerField(null=True, blank=True)
    eta_days_max = models.PositiveSmallIntegerField(null=True, blank=True)
    allows_dangerous_goods = models.BooleanField(default=False, help_text="Cleared by the carrier to move dangerous goods (batteries, aerosols ...)")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["zone__name", "base_price"]
        constraints = [models.UniqueConstraint(fields=["zone", "service_code"], name="uniq_rate_per_zone")]

    def __str__(self):
        return f"{self.zone.name}: {self.service_name}"


class BlockedDestination(models.Model):
    """A country we do not ship to at all, with the reason shown to staff (FR-SHP-09)."""

    country = models.CharField(max_length=2, unique=True)
    reason = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["country"]

    def __str__(self):
        return self.country


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
    label_file = models.FileField(upload_to="labels/%Y/%m/", blank=True)
    label_format = models.CharField(max_length=8, blank=True)
    service_code = models.CharField(max_length=60, blank=True, help_text="Carrier service the shipment was booked on, e.g. 'dhl:P'")
    status = models.CharField(max_length=20, choices=ShipmentStatus.choices, default=ShipmentStatus.PENDING)
    override_reason = models.CharField(max_length=255, blank=True, help_text="Required when staff override the customer's chosen service")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # Proof of delivery (FR-SHP-08)
    pod_recipient = models.CharField(max_length=150, blank=True, help_text="Who received the parcel")
    pod_note = models.CharField(max_length=255, blank=True)
    pod_photo_url = models.URLField(blank=True)
    pod_photo = models.ImageField(upload_to="pod/%Y/%m/", blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
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


class ShipmentItem(models.Model):
    """Which order lines (and how many units) travel in a shipment, so one order can ship in parts (FR-ORD-06)."""

    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name="items")
    order_item = models.ForeignKey("orders.OrderItem", on_delete=models.CASCADE, related_name="shipment_items")
    quantity = models.PositiveIntegerField()
