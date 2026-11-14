"""Guest checkout (FR-AUTH-05, FR-CHK-05): buy without an account, then reach the order through a signed link."""
from django.conf import settings
from django.core import signing
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import Address
from apps.accounts.serializers import AddressSerializer

from .models import Order
from .serializers import OrderSerializer
from .services import CheckoutError, checkout

SALT = "mpanko.guest-order"


def make_token(order):
    return signing.dumps({"n": order.number}, salt=SALT)


def read_token(token, number):
    """True only if `token` is a live link for exactly this order."""
    try:
        data = signing.loads(token or "", salt=SALT, max_age=settings.GUEST_ORDER_LINK_DAYS * 86400)
    except signing.BadSignature:
        return False
    return data.get("n") == number


def guest_order_or_404(number, token):
    """The order for a valid link; a wrong link, a stale link and an unknown order all look the same."""
    order = Order.objects.prefetch_related("items", "events", "shipments__events", "shipments__carrier").filter(number=number, user__isnull=True).first()
    if not order or not read_token(token, number):
        raise NotFound("This order link is not valid. Ask for a new one.")
    return order


def order_link(order):
    return f"{settings.FRONTEND_URL.rstrip('/')}/orders/guest/{order.number}?token={make_token(order)}"


def claim_guest_orders(user):
    """Attach guest orders placed with this address to the account, once the address is proven to be theirs."""
    if not user.email_verified:
        return 0
    return Order.objects.filter(user__isnull=True, contact_email__iexact=user.email).update(user=user)


class Throttled:
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "guest_checkout"


class GuestOnly:
    """Guest endpoints do not exist until the store turns guest checkout on."""

    def initial(self, request, *args, **kwargs):
        if not settings.GUEST_CHECKOUT_ENABLED:
            raise NotFound()
        super().initial(request, *args, **kwargs)


class GuestLineSerializer(serializers.Serializer):
    variant = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=99)


class GuestCheckoutSerializer(serializers.Serializer):
    email = serializers.EmailField()
    items = GuestLineSerializer(many=True, allow_empty=False, max_length=50)
    address = AddressSerializer()
    shipping_service = serializers.CharField(max_length=60)
    currency = serializers.CharField(max_length=3, required=False)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    delivery_notes = serializers.CharField(max_length=300, required=False, allow_blank=True)
    coupon_code = serializers.CharField(max_length=40, required=False, allow_blank=True)
    accept_terms = serializers.BooleanField(required=False, default=False)
    duties_acknowledged = serializers.BooleanField(required=False, default=False)


class GuestCheckoutView(GuestOnly, Throttled, APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=GuestCheckoutSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = GuestCheckoutSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        key = request.headers.get("Idempotency-Key", "").strip()
        if not key:
            raise ValidationError({"Idempotency-Key": "This header is required."})
        address = Address(**{k: v for k, v in d["address"].items() if k != "is_default"})
        try:
            order, created = checkout(
                None, address, d["shipping_service"], d.get("currency"), key,
                declarations={k: d.get(k) for k in ("phone", "delivery_notes", "accept_terms", "duties_acknowledged", "coupon_code")},
                guest={"email": d["email"], "items": [(i["variant"], i["quantity"]) for i in d["items"]]},
            )
        except CheckoutError as exc:
            raise ValidationError({exc.field: exc.message})
        if created:
            from .tasks import send_guest_order_link

            send_guest_order_link.delay(order.pk)
        body = OrderSerializer(order).data
        body["guest_token"] = make_token(order)
        return Response(body, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class GuestOrderView(GuestOnly, Throttled, APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OrderSerializer)
    def get(self, request, number):
        return Response(OrderSerializer(guest_order_or_404(number, request.query_params.get("token", ""))).data)


class GuestLookupSerializer(serializers.Serializer):
    number = serializers.CharField(max_length=20)
    email = serializers.EmailField()


class GuestLookupView(GuestOnly, Throttled, APIView):
    """'Find my order': emails a fresh link when the order number and email match. The reply never says whether they did."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=GuestLookupSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = GuestLookupSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = Order.objects.filter(number=s.validated_data["number"].strip().upper(), user__isnull=True, contact_email__iexact=s.validated_data["email"]).first()
        if order:
            from .tasks import send_guest_order_link

            send_guest_order_link.delay(order.pk, dedupe=False)
        return Response({"detail": "If those details match an order, we have emailed a link to it."})


class PublicConfigView(APIView):
    """What the apps need to know before anyone signs in."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({
            "guest_checkout": settings.GUEST_CHECKOUT_ENABLED,
            "whatsapp_number": settings.WHATSAPP_SUPPORT_NUMBER,
            "launch_countries": settings.LAUNCH_COUNTRIES,
        })


def guest_payment_order(number, token):
    order = get_object_or_404(Order, number=number, user__isnull=True)
    if not read_token(token, number):
        raise NotFound("This order link is not valid. Ask for a new one.")
    return order
