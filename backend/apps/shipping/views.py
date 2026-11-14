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
from .models import BlockedDestination, Carrier, PickupLocation, Shipment, ShipmentItem, ShipmentStatus, ShippingRate, ShippingZone
from .serializers import (
    BlockedDestinationSerializer, PickupLocationSerializer, ShippingRateSerializer, ShippingZoneSerializer,
)
from .serializers import DeclineSerializer, ProofOfDeliverySerializer, ShipmentSerializer, StatusUpdateSerializer
from .providers import TrackingError
from .services import record_event, remaining_quantities, sync_shipment


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def quote(request):
    """Eligible shipping services for a destination, honouring product restrictions (FR-SHP-02, FR-SHP-09)."""
    country = (request.query_params.get("country") or "").upper()
    if len(country) != 2:
        raise ValidationError({"country": "Provide a 2-letter ISO country code."})
    # products=slug or slug:quantity, comma separated. Quantity matters because rates can depend on total weight.
    wanted = {}
    for part in (x for x in request.query_params.get("products", "").split(",") if x):
        slug, _, qty = part.partition(":")
        wanted[slug] = wanted.get(slug, 0) + (int(qty) if qty.isdigit() and int(qty) > 0 else 1)
    slugs = list(wanted)
    products = list(Product.objects.filter(slug__in=slugs))
    from .parcel import from_lines

    parcel = from_lines([(p, wanted[p.slug]) for p in products])
    weight = parcel.chargeable_grams
    blocked = [p.name for p in products if not p.can_ship_to(country)]
    if blocked:
        return Response({"country": country, "services": [], "restricted_products": blocked})
    reason = providers.blocked_reason(country)
    if reason:
        return Response({"country": country, "services": [], "restricted_products": [], "blocked_reason": reason})
    destination = {"city": request.query_params.get("city", ""), "postal_code": request.query_params.get("postal_code", "")}
    return Response({"country": country, "services": [r.as_dict() for r in providers.get_rates(country, weight, destination=destination, dims=parcel.dims_cm, dangerous=parcel.dangerous)], "restricted_products": [], "dangerous_goods": parcel.dangerous})


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
        parts = self._parse_items(order, request.data.get("items"))
        serializer = self.get_serializer(data={k: v for k, v in request.data.items() if k not in {"order_number", "items"}})
        serializer.is_valid(raise_exception=True)
        shipment = serializer.save(order=order, created_by=request.user, service_name=service_name)
        ShipmentItem.objects.bulk_create([ShipmentItem(shipment=shipment, order_item_id=pk, quantity=q) for pk, q in parts.items()])
        AuditLog.record(request.user, "shipment.create", shipment, override=bool(request.data.get("override_reason")))
        if shipment.carrier_id and shipment.status == ShipmentStatus.PENDING:
            shipment.status = ShipmentStatus.ASSIGNED
            shipment.save(update_fields=["status"])
        if order.status == OrderStatus.PAID:
            from apps.orders.services import transition

            transition(order, OrderStatus.PROCESSING, actor=request.user, note="Shipment created")
        return Response(self.get_serializer(shipment).data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _parse_items(order, raw):
        """{order_item_id: quantity} for this parcel. No `items` = everything not yet shipped (FR-ORD-06)."""
        left = remaining_quantities(order)
        if not any(left.values()):
            raise ValidationError({"items": "Every item on this order is already in a shipment."})
        if not raw:
            return {pk: q for pk, q in left.items() if q > 0}
        if not isinstance(raw, list):
            raise ValidationError({"items": "Send a list of {order_item, quantity}."})
        parts = {}
        for row in raw:
            try:
                pk, qty = int(row["order_item"]), int(row["quantity"])
            except (KeyError, TypeError, ValueError):
                raise ValidationError({"items": "Each entry needs order_item and quantity."})
            if pk not in left:
                raise ValidationError({"items": f"Item {pk} is not on this order."})
            if qty < 1 or pk in parts:
                raise ValidationError({"items": "Quantities must be 1 or more, one entry per item."})
            if qty > left[pk]:
                raise ValidationError({"items": f"Only {left[pk]} unit(s) of item {pk} are left to ship."})
            parts[pk] = qty
        return parts

    def _carrier_or_staff(self, request):
        if not (request.user.is_staff_role or has_role(request.user, Role.CARRIER)):
            raise PermissionDenied()

    @action(detail=True, methods=["post"], url_path="accept")
    def accept(self, request, pk=None):
        """The assigned carrier accepts the job (FR-SHP-08). Timestamped and attributed in the event history."""
        shipment = self.get_object()
        self._carrier_or_staff(request)
        if shipment.status != ShipmentStatus.ASSIGNED:
            raise ValidationError({"detail": f"Only assigned work can be accepted; this shipment is '{shipment.status}'."})
        shipment, _ = record_event(shipment, ShipmentStatus.ACCEPTED, actor=request.user, description="Accepted by carrier")
        return Response({"status": shipment.status})

    @action(detail=True, methods=["post"], url_path="decline")
    def decline(self, request, pk=None):
        shipment = self.get_object()
        self._carrier_or_staff(request)
        if shipment.status not in {ShipmentStatus.ASSIGNED, ShipmentStatus.ACCEPTED}:
            raise ValidationError({"detail": f"Work in '{shipment.status}' cannot be declined."})
        s = DeclineSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        shipment, _ = record_event(shipment, ShipmentStatus.DECLINED, actor=request.user, description=f"Declined: {s.validated_data['reason']}")
        return Response({"status": shipment.status})

    @action(detail=True, methods=["post"], url_path="proof")
    def proof(self, request, pk=None):
        """Proof of delivery: who received it, an optional note, and a photo (uploaded file or link). Marks the shipment delivered."""
        shipment = self.get_object()
        self._carrier_or_staff(request)
        if shipment.status in {ShipmentStatus.DELIVERED, ShipmentStatus.DECLINED, ShipmentStatus.RETURNED, ShipmentStatus.PENDING}:
            raise ValidationError({"detail": f"A '{shipment.status}' shipment cannot be marked delivered."})
        s = ProofOfDeliverySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        Shipment.objects.filter(pk=shipment.pk).update(
            pod_recipient=d["recipient_name"], pod_note=d.get("note", ""), pod_photo_url=d.get("photo_url", ""),
        )
        if d.get("photo"):
            shipment.refresh_from_db()
            shipment.pod_photo.save(f"{shipment.order.number}-{shipment.pk}.{d['photo'].image.format.lower().replace('jpeg', 'jpg')}", d["photo"], save=False)
            shipment.pod_photo_url = request.build_absolute_uri(shipment.pod_photo.url)
            shipment.save(update_fields=["pod_photo", "pod_photo_url", "updated_at"])
        shipment, _ = record_event(shipment, ShipmentStatus.DELIVERED, actor=request.user, description=f"Delivered. Received by {d['recipient_name']}")
        AuditLog.record(request.user, "shipment.proof_of_delivery", shipment, recipient=d["recipient_name"])
        shipment.refresh_from_db()
        return Response(self.get_serializer(shipment).data)

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


    @action(detail=True, methods=["get", "post"], url_path="label", permission_classes=[FulfillmentStaff])
    def label(self, request, pk=None):
        """POST books the parcel with the carrier's API and stores the label; GET downloads the stored label."""
        from django.core.files.base import ContentFile
        from django.http import HttpResponse

        from .carriers import LIVE_CARRIERS, CarrierError

        shipment = self.get_object()
        if request.method == "GET":
            if not shipment.label_file:
                raise ValidationError({"detail": "This shipment has no label yet."})
            kinds = {"pdf": "application/pdf", "png": "image/png", "gif": "image/gif", "zpl": "text/plain"}
            with shipment.label_file.open("rb") as fh:
                return HttpResponse(fh.read(), content_type=kinds.get(shipment.label_format, "application/octet-stream"))

        carrier = shipment.carrier
        live = LIVE_CARRIERS.get(carrier.provider) if carrier else None
        if not live:
            raise ValidationError({"detail": "Choose a DHL, FedEx or UPS carrier on this shipment first. Other carriers use hand-entered tracking."})
        if not live.configured():
            raise ValidationError({"detail": f"{live.label} credentials are not set up on the server yet."})
        if shipment.label_file:
            raise ValidationError({"detail": "This shipment already has a label."})
        if request.data.get("pickup"):
            place = PickupLocation.objects.filter(pk=request.data["pickup"], is_active=True).first() if str(request.data["pickup"]).isdigit() else None
            if not place:
                raise ValidationError({"pickup": "Choose one of the active pickup locations."})
            shipment.pickup = place
            shipment.save(update_fields=["pickup"])
        order = shipment.order
        code = request.data.get("service_code") or (order.shipping_service or {}).get("service_code", "")
        prefix, _, bare = code.partition(":")
        if not bare or prefix != live.code:
            raise ValidationError({"service_code": f"Pick a {live.label} service (for example '{live.code}:XX'). The customer chose '{code or 'none'}'."})
        items = list(shipment.items.select_related("order_item__variant__product"))
        from .parcel import from_lines

        parcel = from_lines([(i.order_item.variant.product, i.quantity) for i in items if i.order_item.variant_id])
        if parcel.dangerous:
            raise ValidationError({"detail": "This shipment holds dangerous goods, which need a carrier-specific declaration. Book it in the carrier's own portal and enter the tracking number here."})
        try:
            booking = live.book(shipment, order.shipping_address, parcel.chargeable_grams, bare, parcel.dims_cm)
        except CarrierError as exc:
            raise ValidationError({"detail": str(exc)})
        shipment.label_file.save(f"{order.number}-{booking.tracking_number}.{booking.label_format}", ContentFile(booking.label_bytes), save=False)
        shipment.tracking_number = booking.tracking_number
        shipment.label_reference = booking.reference or booking.tracking_number
        shipment.label_format = booking.label_format
        shipment.service_code = code
        shipment.save()
        AuditLog.record(request.user, "shipment.label", shipment, carrier=live.code, tracking=booking.tracking_number)
        return Response(self.get_serializer(shipment).data, status=status.HTTP_201_CREATED)

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


class _RulesPermission(permissions.BasePermission):
    """Fulfilment staff may look; only store admins (and the super admin) may change shipping rules."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return FulfillmentStaff().has_permission(request, view)
        return has_role(request.user, Role.STORE_ADMIN, Role.SUPER_ADMIN)


class _RulesViewSet(viewsets.ModelViewSet):
    permission_classes = [_RulesPermission]
    pagination_class = None
    audit_name = ""

    def perform_create(self, serializer):
        obj = serializer.save()
        AuditLog.record(self.request.user, f"{self.audit_name}.create", obj)

    def perform_update(self, serializer):
        obj = serializer.save()
        AuditLog.record(self.request.user, f"{self.audit_name}.update", obj)

    def perform_destroy(self, instance):
        AuditLog.record(self.request.user, f"{self.audit_name}.delete", instance)
        instance.delete()


class ShippingZoneViewSet(_RulesViewSet):
    queryset = ShippingZone.objects.prefetch_related("rates")
    serializer_class = ShippingZoneSerializer
    audit_name = "shipping_zone"


class ShippingRateViewSet(_RulesViewSet):
    queryset = ShippingRate.objects.select_related("zone")
    serializer_class = ShippingRateSerializer
    audit_name = "shipping_rate"


class BlockedDestinationViewSet(_RulesViewSet):
    queryset = BlockedDestination.objects.all()
    serializer_class = BlockedDestinationSerializer
    audit_name = "blocked_destination"


class PickupLocationViewSet(_RulesViewSet):
    queryset = PickupLocation.objects.all()
    serializer_class = PickupLocationSerializer
    audit_name = "pickup_location"
