"""
Provider-neutral shipping layer (FR-SHP-01).

Order and checkout code only ever talks to `get_rates()`. To add a carrier (DHL, FedEx, UPS, a Ghanaian
courier ...) write a ShippingProvider subclass and register it in PROVIDERS. Nothing in orders/ changes.
"""
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings


@dataclass
class Rate:
    provider: str
    service_code: str
    service_name: str
    price: Decimal  # always in settings.BASE_CURRENCY
    eta_days_min: int | None = None
    eta_days_max: int | None = None
    dangerous_goods: bool = False  # cleared to carry dangerous goods

    def as_dict(self):
        return {
            "provider": self.provider,
            "service_code": self.service_code,
            "service_name": self.service_name,
            "price": str(self.price),
            "currency": settings.BASE_CURRENCY,
            "eta_days_min": self.eta_days_min,
            "eta_days_max": self.eta_days_max,
            "dangerous_goods": self.dangerous_goods,
        }


class ShippingProvider:
    name = "base"

    def get_rates(self, destination_country, weight_grams, origin_country=None):
        raise NotImplementedError

    # Optional capabilities — enabled per carrier only when the account/API supports them (FR-SHP-03).
    def create_shipment(self, shipment):
        raise NotImplementedError

    def fetch_tracking(self, shipment):
        raise NotImplementedError


class ManualProvider(ShippingProvider):
    """
    Owner-managed fulfilment: flat-rate services configured in settings. Staff enter the carrier and tracking
    number by hand. This is also the fallback for carriers without API access (per the payment schedule, Phase 4).
    """

    name = "manual"

    def get_rates(self, destination_country, weight_grams, origin_country=None):
        flat = Decimal(str(settings.SHIPPING_FLAT_RATE))
        dest = (destination_country or "").upper()
        if dest == "GH":
            return [Rate("manual", "local-standard", "Standard delivery (Ghana)", (flat / 3).quantize(Decimal("0.01")), 2, 5)]
        return [
            Rate("manual", "intl-standard", "International standard", flat, 7, 14),
            Rate("manual", "intl-express", "International express", (flat * 2).quantize(Decimal("0.01")), 3, 6),
        ]


class TableProvider(ShippingProvider):
    """
    Rates from the zone tables staff maintain. A destination only gets the services of the zone it belongs to
    (its own country first, then the "*" rest-of-world zone), within each service's weight limits.
    """

    name = "table"

    @staticmethod
    def has_rates():
        from .models import ShippingRate

        return ShippingRate.objects.filter(is_active=True, zone__is_active=True).exists()

    def get_rates(self, destination_country, weight_grams, origin_country=None):
        import math

        from .models import ShippingZone

        dest = (destination_country or "").upper()
        zones = list(ShippingZone.objects.filter(is_active=True).prefetch_related("rates"))
        zone = next((z for z in zones if dest in {c.upper() for c in z.countries}), None) or next(
            (z for z in zones if "*" in z.countries), None
        )
        if not zone:
            return []
        kg = Decimal(math.ceil((weight_grams or 0) / 1000))
        out = []
        for r in zone.rates.all():
            if not r.is_active or (weight_grams or 0) < r.min_weight_grams:
                continue
            if r.max_weight_grams is not None and (weight_grams or 0) > r.max_weight_grams:
                continue
            price = (r.base_price + r.price_per_kg * kg).quantize(Decimal("0.01"))
            out.append(Rate("table", r.service_code, r.service_name, price, r.eta_days_min, r.eta_days_max, r.allows_dangerous_goods))
        return sorted(out, key=lambda x: x.price)


def blocked_reason(country):
    from .models import BlockedDestination

    row = BlockedDestination.objects.filter(country=(country or "").upper()).first()
    return None if row is None else (row.reason or "We can't ship to this country.")


PROVIDERS = {"manual": ManualProvider()}
TABLE = TableProvider()


# --- Carrier tracking adapters -----------------------------------------------------------------------------
# Rates and label creation need a contracted carrier account, so they stay on the manual provider until the
# client supplies credentials. Tracking only needs an API key, so it is live-capable now.

class TrackingError(Exception):
    pass


class DHLTracking:
    """
    DHL Shipment Tracking (Unified) API. Needs DHL_API_KEY from developer.dhl.com.
    Mapping below follows DHL's documented statusCode values; verify against your key's responses before launch.
    """

    name = "dhl"
    STATUS_MAP = {
        "pre-transit": "assigned",
        "transit": "in_transit",
        "delivered": "delivered",
        "failure": "exception",
    }

    def fetch_tracking(self, shipment):
        """Return a list of {status, description, location, external_id, occurred_at} for the shipment."""
        import hashlib

        import requests
        from django.utils.dateparse import parse_datetime

        if not settings.DHL_API_KEY:
            raise TrackingError("DHL_API_KEY is not configured.")
        try:
            resp = requests.get(
                settings.DHL_TRACKING_URL, params={"trackingNumber": shipment.tracking_number},
                headers={"DHL-API-Key": settings.DHL_API_KEY, "Accept": "application/json"}, timeout=20,
            )
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            raise TrackingError(f"DHL unreachable: {exc}")
        if resp.status_code == 404 or not data.get("shipments"):
            return []
        if not resp.ok:
            raise TrackingError(data.get("detail") or data.get("title") or f"DHL error {resp.status_code}")
        info = data["shipments"][0]
        raw_events = list(info.get("events") or [])
        if not raw_events and info.get("status"):
            raw_events = [info["status"]]
        out = []
        for ev in raw_events:
            code = (ev.get("statusCode") or info.get("status", {}).get("statusCode") or "").lower()
            status = self.STATUS_MAP.get(code)
            when = parse_datetime(ev.get("timestamp", "") or "")
            if not status or not when:
                continue
            place = (ev.get("location") or {}).get("address", {}).get("addressLocality", "")
            desc = ev.get("description") or ev.get("status") or ""
            ident = hashlib.sha1(f"{shipment.tracking_number}|{ev.get('timestamp')}|{desc}".encode()).hexdigest()[:40]
            out.append({"status": status, "description": desc[:255], "location": place[:150], "external_id": ident, "occurred_at": when})
        return out


TRACKING = {"dhl": DHLTracking()}


class _LiveTracking:
    """Adapts a LiveCarrier's tracking() to the fetch_tracking() interface used by sync_shipment."""

    def __init__(self, code):
        self.name = code

    def fetch_tracking(self, shipment):
        from .carriers import LIVE_CARRIERS, CarrierError

        carrier = LIVE_CARRIERS[self.name]
        if not carrier.configured():
            raise TrackingError(f"{carrier.label} credentials are not configured.")
        try:
            return carrier.tracking(shipment)
        except CarrierError as exc:
            raise TrackingError(str(exc))


TRACKING.update({"fedex": _LiveTracking("fedex"), "ups": _LiveTracking("ups")})


def live_rates(destination, weight_grams, dims=None):
    """
    Quotes from every connected carrier (DHL Express, FedEx, UPS), converted to the store's base currency. Results are
    cached briefly so the price a customer saw is the price checkout charges. A failing carrier is skipped, never fatal.
    """
    import logging

    from django.core.cache import cache

    from apps.orders import pricing

    from .carriers import CarrierError, active_carriers

    carriers = active_carriers()
    if not carriers or not (destination or {}).get("country"):
        return []
    out = []
    for c in carriers:
        key = "liverates:{}:{}:{}:{}:{}".format(
            c.code, destination["country"].upper(), (destination.get("postal_code") or "").upper(), (destination.get("city") or "").lower(), weight_grams or 0
        ) + (":" + "x".join(str(d) for d in dims) if dims else "")
        quotes = cache.get(key)
        if quotes is None:
            try:
                quotes = c.rates(destination, weight_grams or 0, dims)
            except CarrierError as exc:
                logging.getLogger(__name__).warning("Carrier %s quote failed: %s", c.code, exc)
                continue
            except Exception:  # never let an adapter bug take checkout down
                logging.getLogger(__name__).exception("Carrier %s quote crashed", c.code)
                continue
            cache.set(key, quotes, settings.CARRIER_QUOTE_CACHE_SECONDS)
        for qt in quotes:
            try:
                price = pricing.convert(qt.price, qt.currency, settings.BASE_CURRENCY)
            except Exception:
                continue
            out.append(Rate(c.code, f"{c.code}:{qt.service_code}", qt.service_name, price, qt.eta_min, qt.eta_max, c.code in settings.DANGEROUS_GOODS_CARRIERS))
    return out


def get_rates(destination_country, weight_grams=0, origin_country=None, destination=None, dims=None, dangerous=False):
    """
    Blocked countries get nothing. Staff rate tables (or the flat-rate fallback before any exist) are always offered;
    live carrier quotes are added when a carrier is connected and an address is known. Parcels holding dangerous
    goods only see services cleared to carry them. `dims` is the packed box in cm, (length, width, height).
    """
    if blocked_reason(destination_country):
        return []
    if TABLE.has_rates():
        rates = TABLE.get_rates(destination_country, weight_grams, origin_country)
    else:
        rates = []
        for provider in PROVIDERS.values():
            rates.extend(provider.get_rates(destination_country, weight_grams, origin_country))
    dest = dict(destination or {})
    dest["country"] = (destination_country or "").upper()
    rates.extend(live_rates(dest, weight_grams, dims))
    if dangerous:
        rates = [r for r in rates if r.dangerous_goods]
    return sorted(rates, key=lambda r: r.price)


def find_rate(destination_country, service_code, weight_grams=0, destination=None, dims=None, dangerous=False):
    for rate in get_rates(destination_country, weight_grams, destination=destination, dims=dims, dangerous=dangerous):
        if rate.service_code == service_code:
            return rate
    return None
