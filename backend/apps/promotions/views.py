from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager
from apps.currency.catalog import supported
from apps.orders import pricing
from apps.orders.models import Cart

from . import services
from .models import Coupon
from .serializers import CouponSerializer


class CouponViewSet(viewsets.ModelViewSet):
    """Owner / store admin manage codes. Codes with redemptions are deactivated rather than deleted."""

    queryset = Coupon.objects.all()
    serializer_class = CouponSerializer
    permission_classes = [CatalogManager]
    search_fields = ["code", "description"]
    pagination_class = None

    def perform_create(self, serializer):
        c = serializer.save()
        AuditLog.record(self.request.user, "coupon.create", c, code=c.code)

    def perform_update(self, serializer):
        c = serializer.save()
        AuditLog.record(self.request.user, "coupon.update", c, code=c.code)

    def perform_destroy(self, instance):
        if instance.redemptions.exists():
            raise ValidationError({"detail": "This code has been used. Switch it off instead of deleting it."})
        AuditLog.record(self.request.user, "coupon.delete", instance, code=instance.code)
        instance.delete()


class CheckSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=40)
    currency = serializers.CharField(max_length=3, required=False)


@extend_schema(request=CheckSerializer, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
def check(request):
    """Preview a code against the signed-in customer's bag. Checkout recalculates everything again."""
    s = CheckSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    from django.conf import settings

    currency = (s.validated_data.get("currency") or settings.BASE_CURRENCY).upper()
    if currency not in supported():
        raise ValidationError({"currency": "Unsupported currency."})
    cart = Cart.objects.filter(user=request.user).first()
    items = list(cart.items.select_related("variant__product")) if cart else []
    if not items:
        raise ValidationError({"code": "Your bag is empty."})
    subtotal = sum((pricing.q(pricing.convert(i.variant.price, i.variant.product.currency, currency) * i.quantity, currency) for i in items), 0)
    try:
        coupon = services.find(s.validated_data["code"])
        amount = services.discount_for(coupon, request.user, subtotal, 0, currency)
    except services.CouponError as exc:
        raise ValidationError({"code": str(exc)})
    return Response({
        "code": coupon.code, "kind": coupon.kind, "description": coupon.description, "currency": currency,
        "discount": str(amount) if coupon.kind != "free_shipping" else "0", "free_shipping": coupon.kind == "free_shipping",
    })
