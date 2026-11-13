"""Server-side money handling. Clients never supply totals (FR-CHK-02)."""
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings

CENT = Decimal("0.01")


class PricingError(Exception):
    pass


def q(amount, currency=None):
    """Round to the currency's real unit: whole numbers for yen, won, CFA francs and so on; two places otherwise."""
    from apps.currency.catalog import digits

    unit = Decimal("1") if currency and digits(currency) == 0 else CENT
    return Decimal(amount).quantize(unit, rounding=ROUND_HALF_UP)


def _resolve(currency):
    """(rate, description) — units of `currency` per 1 BASE_CURRENCY, from the rate table or configured fallback."""
    from apps.currency.services import lookup

    currency = currency.upper()
    if currency == settings.BASE_CURRENCY.upper():
        return Decimal("1"), ""
    found = lookup(currency)
    if found:
        return found
    raw = settings.MANUAL_FX_RATES.get(currency)
    if raw is None:
        raise PricingError(f"No exchange rate available for {currency}.")
    return Decimal(str(raw)), "configured rate"


def rate(currency):
    return _resolve(currency)[0]


def convert(amount, from_currency, to_currency):
    if from_currency.upper() == to_currency.upper():
        return q(amount, to_currency)
    in_base = Decimal(amount) / rate(from_currency)
    return q(in_base * rate(to_currency), to_currency)


def plain(value):
    """Decimal as a plain string without exponent form (Decimal('10').normalize() would print as '1E+1')."""
    return format(Decimal(value).normalize(), "f")


def fx_note(currency):
    """Human-readable record of the rate used, stored on the order (FR-CUR-02)."""
    value, description = _resolve(currency)
    if currency.upper() == settings.BASE_CURRENCY.upper():
        return ""
    return f"1 {settings.BASE_CURRENCY} = {plain(value)} {currency.upper()} ({description})"


def tax_for(subtotal, country, currency=None, shipping=0):
    """Tax on the discounted goods (and shipping where the country's rule says so); see apps.tax (FR-TAX-01)."""
    from apps.tax.services import tax_for as _tax_for

    return _tax_for(subtotal, shipping, country, currency)
