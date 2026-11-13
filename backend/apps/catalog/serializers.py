from rest_framework import serializers

from .models import Category, Inventory, Product, ProductImage, ProductVariant, StockMovement


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "slug", "parent", "is_active")
        read_only_fields = ("slug",)


MAX_IMAGE_BYTES = 5 * 1024 * 1024


class ProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ("id", "image", "alt_text", "position")
        read_only_fields = ("position",)

    def validate_image(self, value):
        if value.size > MAX_IMAGE_BYTES:
            raise serializers.ValidationError("Images must be 5 MB or smaller.")
        return value


class VariantSerializer(serializers.ModelSerializer):
    price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    in_stock = serializers.SerializerMethodField()
    quantity = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = ("id", "sku", "name", "attributes", "price_override", "price", "is_active", "in_stock", "quantity")

    def _inv(self, obj):
        return getattr(obj, "inventory", None)

    def get_in_stock(self, obj):
        inv = self._inv(obj)
        return bool(inv and (inv.quantity > 0 or inv.allow_backorder))

    def get_quantity(self, obj):
        # Exact stock levels are only exposed to staff.
        request = self.context.get("request")
        inv = self._inv(obj)
        if inv and request and request.user.is_authenticated and request.user.is_staff_role:
            return inv.quantity
        return None


class StaffVariantSerializer(VariantSerializer):
    """Adds the alert level, which customers do not see."""

    low_stock_threshold = serializers.SerializerMethodField()

    class Meta(VariantSerializer.Meta):
        fields = VariantSerializer.Meta.fields + ("low_stock_threshold",)

    def get_low_stock_threshold(self, obj):
        inv = self._inv(obj)
        return inv.low_stock_threshold if inv else None


class ProductSerializer(serializers.ModelSerializer):
    variants = VariantSerializer(many=True, required=False)
    images = ProductImageSerializer(many=True, read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)

    class Meta:
        model = Product
        fields = (
            "id", "name", "slug", "description", "category", "category_name", "origin_country", "maker",
            "base_price", "currency", "status", "weight_grams", "length_mm", "width_mm", "height_mm",
            "is_dangerous_goods", "dg_class", "un_number", "hs_code", "restricted_countries",
            "variants", "images", "created_at", "updated_at",
        )
        read_only_fields = ("slug", "created_at", "updated_at")

    def validate(self, attrs):
        dims = [attrs.get(k, getattr(self.instance, k, 0)) for k in ("length_mm", "width_mm", "height_mm")]
        if any(dims) and not all(dims):
            raise serializers.ValidationError({"length_mm": "Give length, width and height together, or leave all three at 0."})
        dg = attrs.get("is_dangerous_goods", getattr(self.instance, "is_dangerous_goods", False))
        if dg and not (attrs.get("dg_class", getattr(self.instance, "dg_class", "")) or "").strip():
            raise serializers.ValidationError({"dg_class": "Say which UN hazard class applies to a dangerous-goods product."})
        return attrs

    def create(self, validated_data):
        variants = validated_data.pop("variants", [])
        product = Product.objects.create(**validated_data)
        for v in variants:
            variant = ProductVariant.objects.create(product=product, **v)
            Inventory.objects.create(variant=variant)
        return product

    def update(self, instance, validated_data):
        validated_data.pop("variants", None)  # variants are managed through their own endpoints
        return super().update(instance, validated_data)


class StockAdjustSerializer(serializers.Serializer):
    delta = serializers.IntegerField()
    reason = serializers.ChoiceField(choices=[StockMovement.Reason.RESTOCK, StockMovement.Reason.ADJUSTMENT, StockMovement.Reason.RETURN])
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate_delta(self, value):
        if value == 0:
            raise serializers.ValidationError("Delta cannot be zero.")
        return value


class StockMovementSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor.email", read_only=True, default=None)

    class Meta:
        model = StockMovement
        fields = ("id", "delta", "reason", "note", "actor_email", "order_ref", "created_at")
