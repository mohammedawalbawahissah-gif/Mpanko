import logging
from datetime import timedelta
from decimal import Decimal

import requests
from django.conf import settings
from django.utils import timezone

from .models import ExchangeRate

logger = logging.getLogger(__name__)


def lookup(currency):
    """
    Best available rate for 1 BASE_CURRENCY -> `currency`, as (Decimal, description) or None.
    Order: owner-set manual rate, then a live rate fresher than FX_MAX_AGE_HOURS.
    """
    base = settings.BASE_CURRENCY.upper()
    currency = currency.upper()
    manual = ExchangeRate.objects.filter(base=base, quote=currency, source=ExchangeRate.Source.MANUAL).first()
    if manual:
        return manual.rate, f"manual rate set {manual.fetched_at:%Y-%m-%d}"
    cutoff = timezone.now() - timedelta(hours=settings.FX_MAX_AGE_HOURS)
    live = ExchangeRate.objects.filter(base=base, quote=currency, source=ExchangeRate.Source.LIVE, fetched_at__gte=cutoff).first()
    if live:
        return live.rate, f"live rate {live.fetched_at:%Y-%m-%d %H:%M} UTC"
    return None


def refresh_live_rates():
    """
    Pull current rates for SUPPORTED_CURRENCIES. On any failure the previous rates simply age out
    (then pricing falls back to MANUAL_FX_RATES); a bad response never overwrites good data.
    Returns the number of rates stored.
    """
    base = settings.BASE_CURRENCY.upper()
    url = settings.FX_PROVIDER_URL.format(base=base)
    try:
        resp = requests.get(url, timeout=15)
        data = resp.json()
        if not resp.ok or data.get("result") != "success":
            raise ValueError(f"unexpected response: {str(data)[:120]}")
        rates = data["rates"]
    except (requests.RequestException, ValueError, KeyError) as exc:
        logger.error("FX refresh failed: %s", exc)
        return 0
    now = timezone.now()
    stored = 0
    for quote in {c.upper() for c in settings.SUPPORTED_CURRENCIES} - {base}:
        raw = rates.get(quote)
        try:
            value = Decimal(str(raw))
        except Exception:
            continue
        if value <= 0:
            continue
        ExchangeRate.objects.create(base=base, quote=quote, rate=value, source=ExchangeRate.Source.LIVE, fetched_at=now)
        stored += 1
    return stored
