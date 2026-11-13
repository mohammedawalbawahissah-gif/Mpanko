from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.catalog.models import OutOfStock, ProductStatus, StockMovement, adjust_stock
from apps.shipping import providers as shipping_providers

from . import pricing
from .models import Cart, Order, OrderItem, OrderStatus, OrderStatusEvent


class InvalidTransition(Exception):
    pass


class CheckoutError(Exception):
    def __init__(self, message, field="detail"):
        super().__init__(message)
        self.field = field
        self.message = message


# The order state machine (FR-ORD-02). Anything not listed here is rejected.
ALLOWED = {
    OrderStatus.PENDING_PAYMENT: {OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.EXPIRED},
    OrderStatus.PAID: {OrderStatus.PROCESSING, OrderStatus.CANCELLED, OrderStatus.REFUNDED},
    OrderStatus.PROCESSING: {OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED},
    OrderStatus.SHIPPED: {OrderStatus.DELIVERED, OrderStatus.REFUNDED},
    OrderStatus.DELIVERED: {OrderStatus.REFUNDED},
    OrderStatus.CANCELLED: {OrderStatus.REFUNDED},  # cancelled after payment, then refunded
    OrderStatus.EXPIRED: set(),
    OrderStatus.REFUNDED: set(),
}
STOCK_RELEASING = {OrderStatus.CANCELLED, OrderStatus.EXPIRED}


@transaction.atomic
def transition(order, to_status, actor=None, note=""):
    order = Order.objects.select_for_update().get(pk=order.pk)
    to_status = OrderStatus(to_status)
    if to_status not in ALLOWED[OrderStatus(order.status)]:
        raise InvalidTransition(f"Cannot move order {order.number} from '{order.status}' to '{to_status}'.")
    previous = order.status
    order.status = to_status
    fields = ["status", "updated_at"]
    if to_status == OrderStatus.PAID:
        order.paid_at = timezone.now()
        fields.append("paid_at")
    order.save(update_fields=fields)
    OrderStatusEvent.objects.create(order=order, from_status=previous, to_status=to_status, actor=actor, note=note)
    if to_status in STOCK_RELEASING:
        _release_stock(order, actor)
        from apps.payments.services import close_pending_attempts

        close_pending_attempts(order, "expired" if to_status == OrderStatus.EXPIRED else "cancelled", note)
    return order


def _release_stock(order, actor):
    for item in order.items.select_related("variant").order_by("variant_id"):
        if item.variant_id:
            adjust_stock(
                item.variant_id, item.quantity, StockMovement.Reason.ORDER_RELEASE,
                actor=actor, order_ref=order.number, enforce=False,
            )


def mark_paid(order, note="Payment verified"):
    """Called by the payments app after server-side verification — the only way an order becomes paid."""
    order = transition(order, OrderStatus.PAID, actor=None, note=note)
    from .tasks import send_order_confirmation

    transaction.on_commit(lambda: send_order_confirmation.delay(order.pk))
    return order


class _GuestItem:
    """A bag line for someone checking out without an account; mirrors the fields checkout reads from a CartItem."""

    def __init__(self, variant, quantity):
        self.variant, self.quantity = variant, quantity


def _guest_items(items):
    from apps.catalog.models import ProductVariant

    merged = {}
    for variant_id, qty in items:
        merged[int(variant_id)] = merged.get(int(variant_id), 0) + int(qty)
    variants = {v.pk: v for v in ProductVariant.objects.select_related("product", "inventory").filter(pk__in=merged)}
    if len(variants) != len(merged):
        raise CheckoutError("Something in your bag is no longer available.", "cart")
    return [_GuestItem(variants[pk], min(merged[pk], 99)) for pk in sorted(merged)]


def _cart_lines(cart, country, items=None):
    lines = []
    source = items if items is not None else cart.items.select_related("variant__product", "variant__inventory").order_by("variant_id")
    for item in source:
        variant, product = item.variant, item.variant.product
        if product.status != ProductStatus.PUBLISHED or not variant.is_active:
            raise CheckoutError(f"'{product.name}' is no longer available.", "cart")
        if not product.can_ship_to(country):
            raise CheckoutError(f"'{product.name}' cannot be shipped to {country}.", "address")
        lines.append((item, variant, product))
    if not lines:
        raise CheckoutError("Your cart is empty.", "cart")
    return lines


@transaction.atomic
def checkout(user, address, shipping_service_code, currency, idempotency_key="", declarations=None, guest=None):
    """
    Create exactly one order per idempotency key. Prices, shipping, tax and totals are all recomputed here
    from the database; nothing the client sends about money is trusted.
    Returns (order, created). `guest` ({"email", "items": [(variant_id, quantity)]}) places an order without an account.
    """
    d = declarations or {}
    if not d.get("accept_terms"):
        raise CheckoutError("Please accept the terms of sale to continue.", "accept_terms")
    phone = (d.get("phone") or address.phone or "").strip()
    if not phone:
        raise CheckoutError("A phone number is needed so the carrier can reach you.", "phone")
    international = address.country.upper() != getattr(settings, "STORE_COUNTRY", "GH").upper()
    if international and not d.get("duties_acknowledged"):
        raise CheckoutError("Please confirm you are responsible for any import duties and taxes in your country.", "duties_acknowledged")
    currency = (currency or settings.BASE_CURRENCY).upper()
    from apps.currency import catalog
    from apps.payments.providers import chargeable_currencies

    if currency not in catalog.supported():
        raise CheckoutError(f"Currency {currency} is not supported.", "currency")
    if currency not in chargeable_currencies():
        raise CheckoutError(
            f"We can't take payment in {currency} yet. Choose one of: {', '.join(sorted(chargeable_currencies()))}.", "currency"
        )

    contact_email = guest["email"] if guest else user.email
    if idempotency_key:
        existing = Order.objects.filter(user=user, idempotency_key=idempotency_key)
        if guest:
            existing = existing.filter(contact_email__iexact=contact_email)
        existing = existing.first()
        if existing:
            return existing, False

    country = address.country.upper()
    if guest:
        cart = None
        lines = _cart_lines(None, country, items=_guest_items(guest["items"]))
    else:
        cart = Cart.objects.select_for_update().filter(user=user).first()
        if not cart:
            raise CheckoutError("Your cart is empty.", "cart")
        lines = _cart_lines(cart, country)

    from apps.shipping.parcel import from_lines

    parcel = from_lines([(p, i.quantity) for i, _v, p in lines])
    rate = shipping_providers.find_rate(
        country, shipping_service_code, parcel.chargeable_grams, destination=address.snapshot(), dims=parcel.dims_cm, dangerous=parcel.dangerous,
    )
    if not rate:
        if parcel.dangerous:
            raise CheckoutError(
                "Your cart includes dangerous goods (such as batteries or aerosols). Choose a service cleared to carry them, or remove those items.",
                "shipping_service",
            )
        raise CheckoutError("That shipping service is not available for this destination.", "shipping_service")

    try:
        subtotal = Decimal("0")
        priced = []
        for item, variant, product in lines:
            unit = pricing.convert(variant.price, product.currency, currency)
            line_total = pricing.q(unit * item.quantity, currency)
            subtotal += line_total
            priced.append((item, variant, product, unit, line_total))
        shipping_total = pricing.convert(rate.price, settings.BASE_CURRENCY, currency)
        note = pricing.fx_note(currency)
    except pricing.PricingError as exc:
        raise CheckoutError(str(exc), "currency")
    coupon, discount = None, Decimal("0")
    if (d.get("coupon_code") or "").strip():
        from apps.promotions import services as promo

        try:
            coupon = promo.find(d["coupon_code"], lock=True)
            discount = promo.discount_for(coupon, user, subtotal, shipping_total, currency)
        except (promo.CouponError, pricing.PricingError) as exc:
            raise CheckoutError(str(exc), "coupon_code")
    item_discount = discount if coupon and coupon.kind != "free_shipping" else Decimal("0")
    tax_total = pricing.tax_for(subtotal - item_discount, country, currency, shipping=shipping_total)
    grand_total = subtotal - discount + shipping_total + tax_total
    from apps.tax.services import estimate_duties

    duties = estimate_duties(subtotal - item_discount, country, currency)
    duties_total = duties["total"] if duties else Decimal("0")
    if duties and settings.DUTIES_MODE == "prepaid":
        grand_total += duties_total  # DDP: collected now and remitted on the buyer's behalf

    order = Order.objects.create(
        user=user, currency=currency, subtotal=subtotal, shipping_total=shipping_total, tax_total=tax_total,
        discount_total=discount, coupon_code=coupon.code if coupon else "", duties_total=duties_total,
        grand_total=grand_total, fx_rate_note=note, shipping_address=address.snapshot(),
        shipping_service=rate.as_dict(), contact_email=contact_email, idempotency_key=idempotency_key,
        contact_phone=phone[:32], delivery_notes=(d.get("delivery_notes") or "")[:300],
        terms_accepted_at=timezone.now(), duties_acknowledged=bool(d.get("duties_acknowledged")),
        expires_at=timezone.now() + timedelta(minutes=settings.STOCK_RESERVATION_MINUTES),
    )
    # Reserve stock; sorted by variant id above so concurrent checkouts lock rows in the same order.
    for item, variant, product, unit, line_total in priced:
        try:
            adjust_stock(variant.id, -item.quantity, StockMovement.Reason.ORDER, actor=user, order_ref=order.number)
        except OutOfStock as exc:
            raise CheckoutError(f"Not enough stock for {product.name} ({exc.sku}).", "cart")
        OrderItem.objects.create(
            order=order, variant=variant, product_name=product.name, variant_name=variant.name, sku=variant.sku,
            unit_price=unit, quantity=item.quantity, line_total=line_total,
        )
    if coupon:
        from apps.promotions.models import CouponRedemption

        CouponRedemption.objects.create(coupon=coupon, order=order, user=user, amount=discount)
    OrderStatusEvent.objects.create(order=order, from_status="", to_status=order.status, actor=user, note="Order placed")
    if cart is not None:
        cart.items.all().delete()
    return order, True


def expire_unpaid_orders():
    """Release stock held by unpaid orders past their reservation window. Returns the number expired."""
    now = timezone.now()
    due = Order.objects.filter(status=OrderStatus.PENDING_PAYMENT, expires_at__lt=now).values_list("pk", flat=True)
    count = 0
    for pk in list(due):
        try:
            transition(Order(pk=pk), OrderStatus.EXPIRED, note="Reservation window elapsed")
            count += 1
        except (InvalidTransition, Order.DoesNotExist):
            continue
    return count
