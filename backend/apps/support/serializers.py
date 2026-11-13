from rest_framework import serializers

from .models import ReturnItem, ReturnRequest, SupportCase, SupportMessage


class ReturnItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="order_item.product_name", read_only=True)
    variant_name = serializers.CharField(source="order_item.variant_name", read_only=True)
    sku = serializers.CharField(source="order_item.sku", read_only=True)
    unit_price = serializers.DecimalField(source="order_item.unit_price", max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = ReturnItem
        fields = ("order_item", "product_name", "variant_name", "sku", "unit_price", "quantity")


class ReturnSerializer(serializers.ModelSerializer):
    items = ReturnItemSerializer(many=True, read_only=True)
    order_number = serializers.CharField(source="order.number", read_only=True)
    currency = serializers.CharField(source="order.currency", read_only=True)
    customer_email = serializers.CharField(source="order.contact_email", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    reason_label = serializers.CharField(source="get_reason_display", read_only=True)

    class Meta:
        model = ReturnRequest
        fields = (
            "number", "order_number", "customer_email", "status", "status_label", "reason", "reason_label", "note", "staff_note",
            "refund_amount", "currency", "items", "created_at", "decided_at", "received_at", "refunded_at",
        )
        read_only_fields = fields


class ReturnCreateSerializer(serializers.Serializer):
    class Line(serializers.Serializer):
        order_item = serializers.IntegerField()
        quantity = serializers.IntegerField(min_value=1)

    order_number = serializers.CharField()
    reason = serializers.ChoiceField(choices=ReturnRequest.Reason.choices)
    note = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    items = Line(many=True)


class ApproveSerializer(serializers.Serializer):
    refund_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    staff_note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class RejectSerializer(serializers.Serializer):
    staff_note = serializers.CharField(max_length=500)


class ReceiveSerializer(serializers.Serializer):
    restock = serializers.BooleanField(required=False, default=True)


class MessageSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    def get_author_name(self, obj):
        return "Mpanko support" if obj.from_staff else (obj.author.full_name if obj.author_id and obj.author.full_name else "You")

    class Meta:
        model = SupportMessage
        fields = ("id", "from_staff", "author_name", "body", "created_at")


class CaseSerializer(serializers.ModelSerializer):
    messages = MessageSerializer(many=True, read_only=True)
    order_number = serializers.CharField(source="order.number", read_only=True, default=None)
    customer_email = serializers.CharField(source="user.email", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = SupportCase
        fields = ("number", "subject", "status", "status_label", "order_number", "customer_email", "messages", "created_at", "updated_at")
        read_only_fields = fields


class CaseCreateSerializer(serializers.Serializer):
    subject = serializers.CharField(max_length=150)
    message = serializers.CharField(max_length=4000)
    order_number = serializers.CharField(required=False, allow_blank=True, default="")


class MessageCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=4000)
