from django.utils import timezone
from rest_framework import serializers

from .models import BlockedDestination, PickupLocation, Shipment, ShipmentItem, ShipmentStatus, ShippingRate, ShippingZone, TrackingEvent


class TrackingEventSerializer(serializers.ModelSerializer):
    occurred_at = serializers.DateTimeField(required=False)

    class Meta:
        model = TrackingEvent
        fields = ("id", "status", "description", "location", "occurred_at", "external_id")

    def validate_occurred_at(self, value):
        return value or timezone.now()


class ShipmentItemSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source="order_item.sku", read_only=True)
    product_name = serializers.CharField(source="order_item.product_name", read_only=True)

    class Meta:
        model = ShipmentItem
        fields = ("order_item", "sku", "product_name", "quantity")


class ShipmentSerializer(serializers.ModelSerializer):
    items = ShipmentItemSerializer(many=True, read_only=True)
    events = TrackingEventSerializer(many=True, read_only=True)
    carrier_name = serializers.CharField(source="carrier.name", read_only=True, default=None)
    order_number = serializers.CharField(source="order.number", read_only=True)
    has_label = serializers.SerializerMethodField()
    pickup_name = serializers.CharField(source="pickup.name", read_only=True, default=None)

    def get_has_label(self, obj):
        return bool(obj.label_file)

    class Meta:
        model = Shipment
        fields = (
            "pickup", "pickup_name", "has_label", "service_code", "id", "order_number", "carrier", "carrier_name", "service_name", "tracking_number",
            "label_reference", "status", "override_reason", "created_at", "events", "items",
            "pod_recipient", "pod_note", "pod_photo_url", "pod_photo", "delivered_at",
        )
        read_only_fields = ("status", "created_at", "pod_recipient", "pod_note", "pod_photo_url", "pod_photo", "delivered_at")


class CustomerShipmentSerializer(serializers.ModelSerializer):
    """What a customer sees: no internal notes, label references or override reasons."""

    events = TrackingEventSerializer(many=True, read_only=True)
    carrier_name = serializers.CharField(source="carrier.name", read_only=True, default=None)

    items = ShipmentItemSerializer(many=True, read_only=True)

    class Meta:
        model = Shipment
        fields = ("id", "carrier_name", "service_name", "tracking_number", "status", "events", "items", "delivered_at")


class StatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=ShipmentStatus.choices)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    location = serializers.CharField(max_length=150, required=False, allow_blank=True)
    external_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    occurred_at = serializers.DateTimeField(required=False)


class ProofOfDeliverySerializer(serializers.Serializer):
    recipient_name = serializers.CharField(max_length=150)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    photo_url = serializers.URLField(required=False, allow_blank=True)
    photo = serializers.ImageField(required=False, help_text="Photo of the parcel at the door or the signed slip (JPEG/PNG/WebP, up to 8 MB)")

    def validate_photo(self, value):
        if value.size > 8 * 1024 * 1024:
            raise serializers.ValidationError("The photo is larger than 8 MB. Take it again at a lower quality.")
        if (getattr(value.image, "format", "") or "").upper() not in {"JPEG", "PNG", "WEBP"}:
            raise serializers.ValidationError("Use a JPEG, PNG or WebP photo.")
        return value


class DeclineSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class ShippingRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShippingRate
        fields = ("id", "zone", "service_code", "service_name", "base_price", "price_per_kg", "min_weight_grams",
                  "max_weight_grams", "eta_days_min", "eta_days_max", "allows_dangerous_goods", "is_active")

    def validate(self, attrs):
        lo = attrs.get("min_weight_grams", getattr(self.instance, "min_weight_grams", 0))
        hi = attrs.get("max_weight_grams", getattr(self.instance, "max_weight_grams", None))
        if hi is not None and hi < lo:
            raise serializers.ValidationError({"max_weight_grams": "Must be at least the minimum weight."})
        a = attrs.get("eta_days_min", getattr(self.instance, "eta_days_min", None))
        b = attrs.get("eta_days_max", getattr(self.instance, "eta_days_max", None))
        if a is not None and b is not None and b < a:
            raise serializers.ValidationError({"eta_days_max": "Must be at least the minimum days."})
        for k in ("base_price", "price_per_kg"):
            if k in attrs and attrs[k] < 0:
                raise serializers.ValidationError({k: "Cannot be negative."})
        return attrs


class ShippingZoneSerializer(serializers.ModelSerializer):
    rates = ShippingRateSerializer(many=True, read_only=True)

    class Meta:
        model = ShippingZone
        fields = ("id", "name", "countries", "is_active", "rates")

    def validate_countries(self, value):
        cleaned = []
        for c in value if isinstance(value, list) else []:
            c = str(c).strip().upper()
            if c != "*" and not (len(c) == 2 and c.isalpha()):
                raise serializers.ValidationError(f"'{c}' is not a 2-letter country code.")
            cleaned.append(c)
        if not cleaned:
            raise serializers.ValidationError("Add at least one country code, or * for the rest of the world.")
        return sorted(set(cleaned))


class BlockedDestinationSerializer(serializers.ModelSerializer):
    class Meta:
        model = BlockedDestination
        fields = ("id", "country", "reason")

    def validate_country(self, value):
        value = value.strip().upper()
        if len(value) != 2 or not value.isalpha():
            raise serializers.ValidationError("Use a 2-letter country code, for example KP.")
        return value


class PickupLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupLocation
        fields = ("id", "name", "contact_name", "phone", "email", "line1", "city", "region", "postal_code", "country", "is_default", "is_active")

    def validate_country(self, value):
        value = (value or "").strip().upper()
        if len(value) != 2 or not value.isalpha():
            raise serializers.ValidationError("Use a two-letter country code, for example GH.")
        return value
