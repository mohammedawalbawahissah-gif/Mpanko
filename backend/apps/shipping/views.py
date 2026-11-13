import hashlib
import hmac
import json

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog, Role
from apps.accounts.permissions import FulfillmentStaff, has_role
from apps.catalog.models import Product

from . import providers
from .models import Carrier, Shipment, ShipmentStatus
from .serializers import ShipmentSerializer, StatusUpdateSerializer
from .providers import TrackingError
from .services import record_event, sync_shipment


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def quote(request):
    """Eligible shipping services for a destination, honouring product restrictions (FR-SHP-02, FR-SHP-09)."""
    country = (request.query_params.get("country") or "").upper()
    if len(country) != 2:
        raise ValidationError({"country": "Provide a 2-letter ISO country code."})
    slugs = [s for s in request.query_params.get("products", "").split(",") if s]
    blocked = [p.name for p in Product.objects.filter(slug__in=slugs) if not p.can_ship_to(country)]
    if blocked:
        return Response({"country": country, "services": [], "restricted_products": blocked})
    return Response({"country": country, "services": [r.as_dict() for r in providers.get_rates(country)], "restricted_products": []})


class ShipmentViewSet(viewsets.ModelViewSet):
    """
    Staff (fulfilment/store admin) manage all shipments. Carrier-partner users only ever see and update the
    shipments assigned to their own carrier (FR-SHP-07).
    """

    serializer_class = ShipmentSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in {"create", "partial_update"}:
            return [FulfillmentStaff()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Shipment.objects.none()
        user = self.request.user
        qs = Shipment.objects.select_related("order", "carrier").prefetch_related("events")
        if has_role(user, Role.CARRIER):
            return qs.filter(carrier__users=user)
        if user.is_staff_role:
            return qs
        return qs.none()

    def create(self, request, *args, **kwargs):
        from apps.orders.models import Order, OrderStatus

        order = Order.objects.filter(number=request.data.get("order_number")).first()
        if not order:
            raise ValidationError({"order_number": "Unknown order."})
        if order.status not in {OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED}:
            raise ValidationError({"order_number": f"Order is '{order.status}'; only paid orders can be shipped."})
        chosen = (order.shipping_service or {}).get("service_name", "")
        service_name = request.data.get("service_name", chosen)
        if chosen and service_name and service_name != chosen and not request.data.get("override_reason"):
            raise ValidationError({"override_reason": "A reason is required when overriding the customer's chosen service."})
        serializer = self.get_serializer(data={k: v for k, v in request.data.items() if k != "order_number"})
        serializer.is_valid(raise_exception=True)
        shipment = serializer.save(order=order, created_by=request.user, service_name=service_name)
        AuditLog.record(request.user, "shipment.create", shipment, override=bool(request.data.get("override_reason")))
        if shipment.carrier_id and shipment.status == ShipmentStatus.PENDING:
            shipment.status = ShipmentStatus.ASSIGNED
            shipment.save(update_fields=["status"])
        if order.status == OrderStatus.PAID:
            from apps.orders.services import transition

            transition(order, OrderStatus.PROCESSING, actor=request.user, note="Shipment created")
        return Response(self.get_serializer(shipment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="events")
    def add_event(self, request, pk=None):
        """Status update from staff or the assigned carrier user, including accept / decline."""
        shipment = self.get_object()  # queryset scoping already blocks other carriers' shipments
        if not (request.user.is_staff_role or has_role(request.user, Role.CARRIER)):
            raise PermissionDenied()
        s = StatusUpdateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        shipment, created = record_event(shipment, actor=request.user, **s.validated_data)
        return Response({"created": created, "status": shipment.status}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


    @action(detail=True, methods=["post"], url_path="refresh", permission_classes=[FulfillmentStaff])
    def refresh(self, request, pk=None):
        """Pull the latest tracking from the carrier's API now."""
        shipment = self.get_object()
        if not shipment.carrier or shipment.carrier.provider in {"", "manual"}:
            raise ValidationError({"detail": "This carrier has no tracking API connected. Add events manually."})
        try:
            added = sync_shipment(shipment)
        except TrackingError as exc:
            raise ValidationError({"detail": str(exc)})
        shipment.refresh_from_db()
        return Response({"new_events": added, "status": shipment.status})


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([])
def carrier_webhook(request, carrier_code):
    """
    Inbound tracking events from a carrier. Authenticity = HMAC-SHA256 of the raw body, sent in
    X-Mpanko-Signature, keyed with that carrier's webhook_secret. Retries and duplicates are harmless.
    Body: {"tracking_number", "status", "event_id"?, "description"?, "location"?, "occurred_at"?}
    """
    carrier = Carrier.objects.filter(code=carrier_code, is_active=True).exclude(webhook_secret="").first()
    if not carrier:
        return Response(status=status.HTTP_404_NOT_FOUND)
    expected = hmac.new(carrier.webhook_secret.encode(), request.body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("X-Mpanko-Signature", ""), expected):
        return Response({"detail": "Invalid signature."}, status=status.HTTP_401_UNAUTHORIZED)
    try:
        payload = json.loads(request.body)
    except ValueError:
        return Response({"detail": "Malformed payload."}, status=status.HTTP_400_BAD_REQUEST)
    shipment = Shipment.objects.filter(carrier=carrier, tracking_number=payload.get("tracking_number", "")).first()
    if not shipment:
        return Response({"detail": "Unknown tracking number."}, status=status.HTTP_404_NOT_FOUND)
    s = StatusUpdateSerializer(data={k: payload[k] for k in ("status", "description", "location", "occurred_at") if k in payload})
    if "event_id" in payload:
        s.initial_data["external_id"] = str(payload["event_id"])
    s.is_valid(raise_exception=True)
    _, created = record_event(shipment, **s.validated_data)
    return Response({"created": created})


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([FulfillmentStaff])
def carrier_list(request):
    """Active carriers, for the shipment form. Never exposes webhook secrets."""
    return Response([{"id": c.pk, "name": c.name, "code": c.code, "provider": c.provider} for c in Carrier.objects.filter(is_active=True).order_by("name")])
