from django.conf import settings
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Address, AuditLog
from apps.accounts.permissions import FulfillmentStaff
from apps.catalog.models import ProductVariant

from .models import Cart, CartItem, Order, OrderStatus
from .serializers import (
    CartItemSerializer, CartSerializer, CheckoutSerializer, OrderListSerializer, OrderSerializer, TransitionSerializer,
)
from .services import CheckoutError, InvalidTransition, checkout, transition


def _cart_for(user):
    cart, _ = Cart.objects.get_or_create(user=user)
    return cart


class CartView(APIView):
    @extend_schema(responses=CartSerializer)
    def get(self, request):
        return Response(CartSerializer(_cart_for(request.user)).data)

    @extend_schema(responses={204: None})
    def delete(self, request):
        _cart_for(request.user).items.all().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CartItemViewSet(mixins.CreateModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = CartItemSerializer
    http_method_names = ["post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return CartItem.objects.filter(cart__user=self.request.user).select_related("variant__product")

    def create(self, request, *args, **kwargs):
        """Adding a variant that is already in the cart increases its quantity."""
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        cart = _cart_for(request.user)
        item, created = CartItem.objects.get_or_create(
            cart=cart, variant=s.validated_data["variant"], defaults={"quantity": s.validated_data["quantity"]}
        )
        if not created:
            item.quantity = min(item.quantity + s.validated_data["quantity"], 99)
            item.save(update_fields=["quantity"])
        return Response(CartSerializer(cart).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        item = self.get_object()
        s = self.get_serializer(item, data={"quantity": request.data.get("quantity"), "variant": item.variant_id}, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(CartSerializer(item.cart).data)

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        cart = item.cart
        item.delete()
        return Response(CartSerializer(cart).data)


class CheckoutView(APIView):
    """POST /checkout/ with an Idempotency-Key header. Repeating the same key returns the same order."""

    @extend_schema(request=CheckoutSerializer, responses=OrderSerializer)
    def post(self, request):
        s = CheckoutSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if settings.REQUIRE_VERIFIED_EMAIL and not request.user.email_verified:
            raise PermissionDenied("Please verify your email address before placing an order.")
        key = request.headers.get("Idempotency-Key", "").strip()
        if not key:
            raise ValidationError({"Idempotency-Key": "This header is required."})
        address = get_object_or_404(Address, pk=s.validated_data["address_id"], user=request.user)
        try:
            order, created = checkout(
                request.user, address, s.validated_data["shipping_service"], s.validated_data.get("currency"), key
            )
        except CheckoutError as exc:
            raise ValidationError({exc.field: exc.message})
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class OrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Customers see only their own orders (FR-CUS-03). Staff see all, within their permissions."""

    lookup_field = "number"
    filterset_fields = ["status", "currency"]
    search_fields = ["number", "contact_email"]
    ordering_fields = ["created_at", "grand_total"]

    def get_serializer_class(self):
        return OrderListSerializer if self.action == "list" else OrderSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        qs = Order.objects.prefetch_related("items", "events", "shipments__events", "shipments__carrier")
        user = self.request.user
        return qs if user.is_staff_role else qs.filter(user=user)

    @action(detail=True, methods=["post"])
    def cancel(self, request, number=None):
        order = self.get_object()
        if not request.user.is_staff_role and order.status != OrderStatus.PENDING_PAYMENT:
            raise ValidationError({"detail": "Paid orders can only be cancelled by staff. Please contact support."})
        try:
            order = transition(order, OrderStatus.CANCELLED, actor=request.user, note=request.data.get("note", "Cancelled"))
        except InvalidTransition as exc:
            raise ValidationError({"detail": str(exc)})
        if request.user.is_staff_role:
            AuditLog.record(request.user, "order.cancel", order)
        return Response(OrderSerializer(order).data)

    @action(detail=True, methods=["post"])
    def transition(self, request, number=None):
        """Staff-driven status changes (e.g. mark processing / shipped / delivered)."""
        if not FulfillmentStaff().has_permission(request, self):
            raise PermissionDenied()
        order = self.get_object()
        s = TransitionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if s.validated_data["to"] in {OrderStatus.PAID, OrderStatus.REFUNDED}:
            raise ValidationError({"to": "Payment states are set only by verified payment events."})
        try:
            order = transition(order, s.validated_data["to"], actor=request.user, note=s.validated_data.get("note", ""))
        except (InvalidTransition, ValueError) as exc:
            raise ValidationError({"to": str(exc)})
        AuditLog.record(request.user, "order.transition", order, to=order.status)
        return Response(OrderSerializer(order).data)
