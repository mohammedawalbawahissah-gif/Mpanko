from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from apps.orders import pricing
from apps.orders.models import OrderStatus

from .models import Coupon


class CouponError(Exception):
    pass


def _live(qs):
    return qs.exclude(order__status__in=[OrderStatus.CANCELLED, OrderStatus.EXPIRED])


def find(code, lock=False):
    qs = Coupon.objects.select_for_update() if lock else Coupon.objects
    coupon = qs.filter(code=(code or "").strip().upper()).first()
    if not coupon or not coupon.is_active:
        raise CouponError("That code is not valid.")
    return coupon


def discount_for(coupon, user, subtotal, shipping_total, currency):
    """
    Validate the code for this customer and return the discount in `currency`.
    Raises CouponError with a message the customer can act on.
    """
    now = timezone.now()
    if coupon.starts_at and now < coupon.starts_at:
        raise CouponError("That code is not active yet.")
    if coupon.ends_at and now > coupon.ends_at:
        raise CouponError("That code has expired.")
    if coupon.max_uses is not None and _live(coupon.redemptions).count() >= coupon.max_uses:
        raise CouponError("That code has been fully used.")
    if coupon.per_user_limit is not None and _live(coupon.redemptions.filter(user=user)).count() >= coupon.per_user_limit:
        raise CouponError("You have already used that code.")
    base = settings.BASE_CURRENCY
    in_base = pricing.convert(subtotal, currency, base)
    if in_base < coupon.min_subtotal:
        raise CouponError(f"That code needs at least {coupon.min_subtotal} {base} of items.")
    subtotal = Decimal(subtotal)
    if coupon.kind == Coupon.Kind.PERCENT:
        amount = subtotal * coupon.value / Decimal("100")
        if coupon.max_discount is not None:
            amount = min(amount, pricing.convert(coupon.max_discount, base, currency))
    elif coupon.kind == Coupon.Kind.FIXED:
        amount = min(pricing.convert(coupon.value, base, currency), subtotal)
    else:
        amount = Decimal(shipping_total)
    return pricing.q(amount, currency)
