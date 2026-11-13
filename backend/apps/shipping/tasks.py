import logging

from celery import shared_task

from .models import Shipment, ShipmentStatus
from .providers import TrackingError
from .services import TERMINAL, sync_shipment

logger = logging.getLogger(__name__)


@shared_task
def poll_active_shipments():
    """Poll every in-flight shipment whose carrier has a tracking API. One bad shipment never stops the rest."""
    qs = (
        Shipment.objects.select_related("carrier")
        .exclude(status__in=[s.value for s in TERMINAL] + [ShipmentStatus.DECLINED.value])
        .exclude(tracking_number="")
        .exclude(carrier__isnull=True)
        .exclude(carrier__provider__in=["", "manual"])
    )
    total = 0
    for shipment in qs:
        try:
            total += sync_shipment(shipment)
        except TrackingError as exc:
            logger.warning("Tracking sync failed for shipment %s: %s", shipment.pk, exc)
    return total
