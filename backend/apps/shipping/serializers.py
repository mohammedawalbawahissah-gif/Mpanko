from django.utils import timezone
from rest_framework import serializers

from .models import Shipment, ShipmentStatus, TrackingEvent


class TrackingEventSerializer(serializers.ModelSerializer):
    occurred_at = serializers.DateTimeField(required=False)

    class Meta:
        model = TrackingEvent
        fields = ("id", "status", "description", "location", "occurred_at", "external_id")

    def validate_occurred_at(self, value):
        return value or timezone.now()


class ShipmentSerializer(serializers.ModelSerializer):
    events = TrackingEventSerializer(many=True, read_only=True)
    carrier_name = serializers.CharField(source="carrier.name", read_only=True, default=None)
    order_number = serializers.CharField(source="order.number", read_only=True)

    class Meta:
        model = Shipment
        fields = (
            "id", "order_number", "carrier", "carrier_name", "service_name", "tracking_number",
            "label_reference", "status", "override_reason", "created_at", "events",
        )
        read_only_fields = ("status", "created_at")


class CustomerShipmentSerializer(serializers.ModelSerializer):
    """What a customer sees: no internal notes, label references or override reasons."""

    events = TrackingEventSerializer(many=True, read_only=True)
    carrier_name = serializers.CharField(source="carrier.name", read_only=True, default=None)

    class Meta:
        model = Shipment
        fields = ("id", "carrier_name", "service_name", "tracking_number", "status", "events")


class StatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=ShipmentStatus.choices)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    location = serializers.CharField(max_length=150, required=False, allow_blank=True)
    external_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    occurred_at = serializers.DateTimeField(required=False)
