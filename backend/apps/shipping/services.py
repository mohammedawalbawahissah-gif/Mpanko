from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Shipment, ShipmentStatus, TrackingEvent

IN_MOTION = {ShipmentStatus.IN_TRANSIT, ShipmentStatus.OUT_FOR_DELIVERY}
INACTIVE = {ShipmentStatus.DECLINED, ShipmentStatus.RETURNED}

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
        previous = shipment.status
        shipment.status = latest.status
        update = ["status", "updated_at"]
        if shipment.status == ShipmentStatus.DELIVERED and not shipment.delivered_at:
            shipment.delivered_at = latest.occurred_at
            update.append("delivered_at")
        shipment.save(update_fields=update)
        _sync_order(shipment)
        if shipment.status in IN_MOTION and previous not in IN_MOTION:
            _queue_email(shipment, "shipment_dispatched")
    return shipment, True


def _queue_email(shipment, key):
    from apps.orders.tasks import send_shipment_email

    transaction.on_commit(lambda: send_shipment_email.delay(shipment.pk, key))


def remaining_quantities(order, exclude_shipment=None):
    """{order_item_id: units not yet in an active shipment}. A shipment with no item rows (made before split
    shipments existed) is treated as carrying the whole order."""
    remaining = {i.pk: i.quantity for i in order.items.all()}
    for sh in order.shipments.exclude(status__in=[s.value for s in INACTIVE]).prefetch_related("items"):
        if exclude_shipment and sh.pk == exclude_shipment.pk:
            continue
        rows = list(sh.items.all())
        if not rows:
            return {k: 0 for k in remaining}
        for r in rows:
            remaining[r.order_item_id] = remaining.get(r.order_item_id, 0) - r.quantity
    return {k: max(v, 0) for k, v in remaining.items()}


def order_fully_delivered(order):
    """True when every unit has left in a shipment and every active shipment is delivered."""
    active = list(order.shipments.exclude(status__in=[s.value for s in INACTIVE]))
    if not active or any(sh.status != ShipmentStatus.DELIVERED for sh in active):
        return False
    return sum(remaining_quantities(order).values()) == 0


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
    if target == OrderStatus.DELIVERED and not order_fully_delivered(order):
        target = OrderStatus.SHIPPED  # other parcels of this order are still on their way
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
        return
    if target == OrderStatus.DELIVERED:
        _queue_email(shipment, "order_delivered")


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
