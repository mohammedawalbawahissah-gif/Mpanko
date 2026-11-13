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

    def as_dict(self):
        return {
            "provider": self.provider,
            "service_code": self.service_code,
            "service_name": self.service_name,
            "price": str(self.price),
            "currency": settings.BASE_CURRENCY,
            "eta_days_min": self.eta_days_min,
            "eta_days_max": self.eta_days_max,
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


PROVIDERS = {"manual": ManualProvider()}


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


def get_rates(destination_country, weight_grams=0, origin_country=None):
    rates = []
    for provider in PROVIDERS.values():
        rates.extend(provider.get_rates(destination_country, weight_grams, origin_country))
    return rates


def find_rate(destination_country, service_code, weight_grams=0):
    for rate in get_rates(destination_country, weight_grams):
        if rate.service_code == service_code:
            return rate
    return None
