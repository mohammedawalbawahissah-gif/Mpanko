from rest_framework import serializers

from apps.shipping.serializers import CustomerShipmentSerializer

from .models import Cart, CartItem, Order, OrderItem, OrderStatusEvent


class CartItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    product_slug = serializers.CharField(source="variant.product.slug", read_only=True)
    sku = serializers.CharField(source="variant.sku", read_only=True)
    unit_price = serializers.DecimalField(source="variant.price", max_digits=12, decimal_places=2, read_only=True)
    currency = serializers.CharField(source="variant.product.currency", read_only=True)

    class Meta:
        model = CartItem
        fields = ("id", "variant", "sku", "product_slug", "product_name", "unit_price", "currency", "quantity")

    def validate_variant(self, variant):
        if not variant.is_active or variant.product.status != "published":
            raise serializers.ValidationError("This product is not available.")
        return variant

    def validate_quantity(self, value):
        if value < 1 or value > 99:
            raise serializers.ValidationError("Quantity must be between 1 and 99.")
        return value


class CartSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)

    class Meta:
        model = Cart
        fields = ("items",)


class CheckoutSerializer(serializers.Serializer):
    address_id = serializers.IntegerField()
    shipping_service = serializers.CharField(max_length=60)
    currency = serializers.CharField(max_length=3, required=False)
    # Deliberately no price/total fields: anything a client sends about money is ignored.


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ("product_name", "variant_name", "sku", "unit_price", "quantity", "line_total")


class OrderEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusEvent
        fields = ("from_status", "to_status", "note", "created_at")


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    events = OrderEventSerializer(many=True, read_only=True)
    shipments = CustomerShipmentSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = (
            "number", "status", "currency", "subtotal", "shipping_total", "tax_total", "duties_total", "grand_total",
            "fx_rate_note", "shipping_address", "shipping_service", "contact_email", "expires_at", "paid_at",
            "created_at", "items", "events", "shipments",
        )


class OrderListSerializer(serializers.ModelSerializer):
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ("number", "status", "currency", "grand_total", "item_count", "created_at")

    def get_item_count(self, obj):
        return sum(i.quantity for i in obj.items.all())


class TransitionSerializer(serializers.Serializer):
    to = serializers.CharField()
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
