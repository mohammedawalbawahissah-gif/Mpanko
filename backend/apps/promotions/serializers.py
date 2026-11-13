from rest_framework import serializers

from .models import Coupon


class CouponSerializer(serializers.ModelSerializer):
    uses = serializers.SerializerMethodField()

    def get_uses(self, obj):
        return obj.redemptions.exclude(order__status__in=["cancelled", "expired"]).count()

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        value = attrs.get("value", getattr(self.instance, "value", 0))
        if kind == Coupon.Kind.PERCENT and not (0 < value <= 100):
            raise serializers.ValidationError({"value": "A percent code needs a value between 1 and 100."})
        if kind == Coupon.Kind.FIXED and value <= 0:
            raise serializers.ValidationError({"value": "A fixed code needs an amount above zero."})
        starts, ends = attrs.get("starts_at", getattr(self.instance, "starts_at", None)), attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "The end must be after the start."})
        return attrs

    def validate_code(self, value):
        value = value.strip().upper()
        if not value.replace("-", "").replace("_", "").isalnum():
            raise serializers.ValidationError("Use letters, numbers, hyphens or underscores only.")
        clash = Coupon.objects.filter(code=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("That code already exists.")
        return value

    class Meta:
        model = Coupon
        fields = ("id", "code", "description", "kind", "value", "min_subtotal", "max_discount", "starts_at", "ends_at", "max_uses",
                  "per_user_limit", "is_active", "uses", "created_at")
        read_only_fields = ("created_at",)
