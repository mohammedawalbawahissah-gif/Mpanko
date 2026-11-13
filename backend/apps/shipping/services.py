from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Shipment, ShipmentStatus, TrackingEvent

# Delivered/returned are terminal; late or duplicate events can never move a shipment backwards.
TERMINAL = {ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED}


@transaction.atomic
def record_event(shipment, status, actor=None, description="", location="", external_id="", occurred_at=None):
    """
    Idempotent, order-safe tracking update (FR-SHP-06). Duplicate carrier events (same external_id) are ignored.
    Out-of-order events are stored in the history but only advance the headline status if they are newer.
    """
    occurred_at = occurred_at or timezone.now()
    shipment = Shipment.objects.select_for_update().get(pk=shipment.pk)
    if external_id and shipment.events.filter(external_id=external_id).exists():
        return shipment, False
    try:
        with transaction.atomic():
            TrackingEvent.objects.create(
                shipment=shipment, status=status, description=description, location=location,
                occurred_at=occurred_at, external_id=external_id, actor=actor,
            )
    except IntegrityError:
        return shipment, False

    latest = shipment.events.order_by("-occurred_at", "-id").first()
    if shipment.status not in TERMINAL and latest and latest.status != shipment.status:
        shipment.status = latest.status
        shipment.save(update_fields=["status", "updated_at"])
        _sync_order(shipment)
    return shipment, True


def _sync_order(shipment):
    """Reflect carrier progress on the order (shipped / delivered)."""
    from apps.orders.services import InvalidTransition, transition
    from apps.orders.models import OrderStatus

    target = {
        ShipmentStatus.IN_TRANSIT: OrderStatus.SHIPPED,
        ShipmentStatus.OUT_FOR_DELIVERY: OrderStatus.SHIPPED,
        ShipmentStatus.DELIVERED: OrderStatus.DELIVERED,
    }.get(shipment.status)
    if not target:
        return
    order = shipment.order
    if order.status == OrderStatus.PAID:
        try:
            transition(order, OrderStatus.PROCESSING, actor=None, note="Auto: shipment created")
        except InvalidTransition:
            return
        order.refresh_from_db()
    if order.status == target:
        return
    try:
        transition(order, target, actor=None, note=f"Auto: shipment {shipment.status}")
    except InvalidTransition:
        pass


def sync_shipment(shipment):
    """Pull tracking from the carrier's API (if it has one) and record any new events. Returns events added."""
    from .providers import TRACKING

    provider = TRACKING.get(shipment.carrier.provider) if shipment.carrier_id else None
    if not provider or not shipment.tracking_number:
        return 0
    added = 0
    for ev in sorted(provider.fetch_tracking(shipment), key=lambda e: e["occurred_at"]):
        _, created = record_event(shipment, **ev)
        added += int(created)
    return added
