from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.catalog.models import StockMovement, adjust_stock
from apps.orders.models import Order, OrderStatus
from apps.orders import pricing

from .models import ReturnItem, ReturnRequest

S = ReturnRequest.Status


class ReturnError(Exception):
    pass


def delivered_at(order):
    """When the parcel reached the customer: the latest delivered shipment, else the order's last update."""
    times = [s.delivered_at for s in order.shipments.all() if s.delivered_at]
    return max(times) if times else order.updated_at


def returnable_quantities(order):
    """{order_item_id: units still open to return}, ignoring rejected and cancelled requests."""
    used = dict(
        ReturnItem.objects.filter(request__order=order).exclude(request__status__in=[S.REJECTED, S.CANCELLED])
        .values_list("order_item_id").annotate(n=Sum("quantity"))
    )
    return {i.id: max(i.quantity - used.get(i.id, 0), 0) for i in order.items.all()}


def eligibility(order):
    """Return (ok, message). Only delivered orders, inside the return window."""
    if order.status != OrderStatus.DELIVERED:
        return False, "Only delivered orders can be returned."
    deadline = delivered_at(order) + timedelta(days=settings.RETURN_WINDOW_DAYS)
    if timezone.now() > deadline:
        return False, f"The {settings.RETURN_WINDOW_DAYS}-day return window for this order has ended."
    if not any(returnable_quantities(order).values()):
        return False, "Every item in this order already has a return request."
    return True, ""


@transaction.atomic
def create_return(user, order, items, reason, note=""):
    order = Order.objects.select_for_update().get(pk=order.pk)
    ok, message = eligibility(order)
    if not ok:
        raise ReturnError(message)
    if reason == ReturnRequest.Reason.CHANGED_MIND and not settings.RETURN_ALLOW_CHANGED_MIND:
        raise ReturnError("Returns for change of mind are not accepted. Choose another reason or contact support.")
    left = returnable_quantities(order)
    wanted = {}
    for row in items:
        wanted[row["order_item"]] = wanted.get(row["order_item"], 0) + row["quantity"]
    if not wanted:
        raise ReturnError("Choose at least one item to return.")
    for item_id, qty in wanted.items():
        if item_id not in left:
            raise ReturnError("One of those items is not part of this order.")
        if qty < 1 or qty > left[item_id]:
            raise ReturnError(f"You can return at most {left[item_id]} of that item.")
    req = ReturnRequest.objects.create(order=order, user=user, reason=reason, note=note)
    ReturnItem.objects.bulk_create([ReturnItem(request=req, order_item_id=i, quantity=q) for i, q in wanted.items()])
    return req


def items_value(req):
    total = sum((i.order_item.unit_price * i.quantity for i in req.items.select_related("order_item")), Decimal("0"))
    return pricing.q(total, req.order.currency)


def _require(req, *allowed):
    if req.status not in allowed:
        raise ReturnError(f"This return is '{req.get_status_display()}' and cannot move that way.")


@transaction.atomic
def approve(req, actor, refund_amount=None, staff_note=""):
    _require(req, S.REQUESTED)
    amount = pricing.q(Decimal(refund_amount), req.order.currency) if refund_amount not in (None, "") else items_value(req)
    if amount <= 0:
        raise ReturnError("The refund amount must be more than zero.")
    req.status, req.refund_amount, req.staff_note = S.APPROVED, amount, staff_note
    req.decided_by, req.decided_at = actor, timezone.now()
    req.save()
    return req


@transaction.atomic
def reject(req, actor, staff_note):
    _require(req, S.REQUESTED)
    if not staff_note.strip():
        raise ReturnError("Give the customer a reason for rejecting the return.")
    req.status, req.staff_note, req.decided_by, req.decided_at = S.REJECTED, staff_note, actor, timezone.now()
    req.save()
    return req


@transaction.atomic
def receive(req, actor, restock=True):
    _require(req, S.APPROVED)
    if restock:
        for it in req.items.select_related("order_item"):
            if it.order_item.variant_id:
                adjust_stock(it.order_item.variant_id, it.quantity, StockMovement.Reason.RETURN, actor=actor, order_ref=req.number, enforce=False)
    req.status, req.received_at = S.RECEIVED, timezone.now()
    req.save()
    return req


@transaction.atomic
def refund(req, actor):
    from apps.payments.services import issue_refund

    _require(req, S.RECEIVED)
    issue_refund(req.order, req.refund_amount, f"Return {req.number}", actor)
    req.status, req.refunded_at = S.REFUNDED, timezone.now()
    req.save()
    return req


@transaction.atomic
def cancel(req):
    _require(req, S.REQUESTED, S.APPROVED)
    req.status = S.CANCELLED
    req.save()
    return req
