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


def _cart_lines(cart, country):
    lines = []
    for item in cart.items.select_related("variant__product", "variant__inventory").order_by("variant_id"):
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
def checkout(user, address, shipping_service_code, currency, idempotency_key=""):
    """
    Create exactly one order per idempotency key. Prices, shipping, tax and totals are all recomputed here
    from the database; nothing the client sends about money is trusted.
    Returns (order, created).
    """
    currency = (currency or settings.BASE_CURRENCY).upper()
    if currency not in {c.upper() for c in settings.SUPPORTED_CURRENCIES}:
        raise CheckoutError(f"Currency {currency} is not supported.", "currency")

    if idempotency_key:
        existing = Order.objects.filter(user=user, idempotency_key=idempotency_key).first()
        if existing:
            return existing, False

    cart = Cart.objects.select_for_update().filter(user=user).first()
    if not cart:
        raise CheckoutError("Your cart is empty.", "cart")
    country = address.country.upper()
    lines = _cart_lines(cart, country)

    weight = sum(p.weight_grams * i.quantity for i, _v, p in lines)
    rate = shipping_providers.find_rate(country, shipping_service_code, weight)
    if not rate:
        raise CheckoutError("That shipping service is not available for this destination.", "shipping_service")

    try:
        subtotal = Decimal("0")
        priced = []
        for item, variant, product in lines:
            unit = pricing.convert(variant.price, product.currency, currency)
            line_total = pricing.q(unit * item.quantity)
            subtotal += line_total
            priced.append((item, variant, product, unit, line_total))
        shipping_total = pricing.convert(rate.price, settings.BASE_CURRENCY, currency)
        tax_total = pricing.tax_for(subtotal, country)
        note = pricing.fx_note(currency)
    except pricing.PricingError as exc:
        raise CheckoutError(str(exc), "currency")
    grand_total = subtotal + shipping_total + tax_total

    order = Order.objects.create(
        user=user, currency=currency, subtotal=subtotal, shipping_total=shipping_total, tax_total=tax_total,
        grand_total=grand_total, fx_rate_note=note, shipping_address=address.snapshot(),
        shipping_service=rate.as_dict(), contact_email=user.email, idempotency_key=idempotency_key,
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
    OrderStatusEvent.objects.create(order=order, from_status="", to_status=order.status, actor=user, note="Order placed")
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
