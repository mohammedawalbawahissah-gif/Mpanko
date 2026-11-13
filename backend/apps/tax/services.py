"""Tax charged at checkout and the import-duty estimate shown to buyers. All rules are staff-editable data."""
from decimal import Decimal

from django.conf import settings

from .models import DutyRule, TaxRule


def tax_rule(country):
    country = (country or "").upper()
    return (TaxRule.objects.filter(country=country, is_active=True).first()
            or TaxRule.objects.filter(country="*", is_active=True).first())


def tax_for(goods, shipping, country, currency=None):
    """Tax in `currency` on discounted goods (and shipping where the rule says so). Falls back to settings.TAX_RATE."""
    from apps.orders.pricing import q

    rule = tax_rule(country)
    if rule is None:
        return q(Decimal(goods) * Decimal(str(settings.TAX_RATE)), currency)
    base = Decimal(goods) + (Decimal(shipping) if rule.applies_to_shipping else 0)
    return q(base * rule.rate, currency)


def estimate_duties(goods, country, currency):
    """
    Estimated import duty and VAT on `goods` (in `currency`) for a destination, or None if the destination is the
    home country or has no rule. The de-minimis amount is held in the store currency and converted for comparison.
    """
    from apps.orders import pricing

    country = (country or "").upper()
    if country == settings.STORE_COUNTRY.upper():
        return None
    rule = DutyRule.objects.filter(country=country, is_active=True).first()
    if rule is None:
        return None
    goods = Decimal(goods)
    try:
        threshold = pricing.convert(rule.de_minimis, settings.BASE_CURRENCY, currency)
    except pricing.PricingError:
        threshold = Decimal("0")
    if goods <= threshold:
        duty = vat = pricing.q(0, currency)
        under = True
    else:
        under = False
        duty = pricing.q(goods * rule.duty_rate, currency)
        vat = pricing.q((goods + duty) * rule.import_vat_rate, currency)
    return {
        "country": country, "currency": currency, "duty": duty, "vat": vat, "total": duty + vat,
        "below_threshold": under, "note": rule.note, "mode": settings.DUTIES_MODE,
    }
