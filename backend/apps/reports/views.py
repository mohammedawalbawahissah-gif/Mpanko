"""
Staff reports (FR-ADM-01, FR-ADM-03, FR-ADM-05). Every report takes ?from=YYYY-MM-DD&to=YYYY-MM-DD and, where it
makes sense, ?currency= and ?status=. Add ?export=csv to download the same rows as a CSV file.
"""
import csv
from datetime import date, datetime, time, timedelta

from django.db.models import Count, F, Sum
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import FinanceStaff, IsStaffRole, OrderStaff, roles_permission
from apps.catalog.models import Inventory
from apps.orders.models import Order, OrderStatus
from apps.payments.models import AttemptStatus, PaymentAttempt, ReconciliationRecord, Refund
from apps.shipping.models import Shipment, ShipmentStatus

StockStaff = roles_permission(Role.STORE_ADMIN, Role.FULFILLMENT)
FulfillStaff = roles_permission(Role.STORE_ADMIN, Role.FULFILLMENT)
PAID_STATES = [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.REFUNDED]


def _date(value, name):
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError({name: "Use YYYY-MM-DD."})


def window(request):
    """(start, end) aware datetimes from ?from / ?to; defaults to the last 30 days. `end` is inclusive of the day."""
    today = timezone.now().date()
    d_from = _date(request.query_params["from"], "from") if "from" in request.query_params else today - timedelta(days=30)
    d_to = _date(request.query_params["to"], "to") if "to" in request.query_params else today
    if d_to < d_from:
        raise ValidationError({"to": "`to` must not be before `from`."})
    tz = timezone.get_current_timezone()
    return timezone.make_aware(datetime.combine(d_from, time.min), tz), timezone.make_aware(datetime.combine(d_to, time.max), tz)


def respond(request, filename, columns, rows):
    """JSON by default; CSV when ?export=csv. `rows` is a list of dicts keyed by `columns`."""
    if request.query_params.get("export") == "csv":
        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
        writer = csv.writer(resp)
        writer.writerow(columns)
        for row in rows:
            # Prefix values that spreadsheets would treat as formulas, so exported data cannot run code when opened.
            writer.writerow([("'" + str(row[c])) if isinstance(row[c], str) and row[c][:1] in "=+-@" else row[c] for c in columns])
        return resp
    return Response({"columns": columns, "rows": rows, "count": len(rows)})


class ReportView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return self.report(request)


class SalesReport(ReportView):
    """Daily sales by currency, counted from the day the payment was verified."""

    permission_classes = [FinanceStaff]

    def report(self, request):
        start, end = window(request)
        qs = Order.objects.filter(status__in=PAID_STATES, paid_at__range=(start, end))
        if request.query_params.get("currency"):
            qs = qs.filter(currency=request.query_params["currency"].upper())
        data = (
            qs.annotate(day=TruncDate("paid_at")).values("day", "currency")
            .annotate(orders=Count("id"), items=Sum("subtotal"), shipping=Sum("shipping_total"), tax=Sum("tax_total"), total=Sum("grand_total"))
            .order_by("day", "currency")
        )
        cols = ["day", "currency", "orders", "items", "shipping", "tax", "total"]
        return respond(request, "sales", cols, [{**r, "day": r["day"].isoformat()} for r in data])


class OrdersReport(ReportView):
    permission_classes = [OrderStaff]

    def report(self, request):
        start, end = window(request)
        qs = Order.objects.filter(created_at__range=(start, end)).select_related("user")
        for key in ("status", "currency"):
            if request.query_params.get(key):
                qs = qs.filter(**{key: request.query_params[key].upper() if key == "currency" else request.query_params[key]})
        cols = ["number", "created_at", "status", "customer", "country", "currency", "subtotal", "shipping", "tax", "total"]
        rows = [
            {"number": o.number, "created_at": o.created_at.isoformat(), "status": o.status, "customer": o.contact_email,
             "country": o.shipping_address.get("country", ""), "currency": o.currency, "subtotal": o.subtotal,
             "shipping": o.shipping_total, "tax": o.tax_total, "total": o.grand_total}
            for o in qs.order_by("-created_at")[:5000]
        ]
        return respond(request, "orders", cols, rows)


class PaymentsReport(ReportView):
    permission_classes = [FinanceStaff]

    def report(self, request):
        start, end = window(request)
        qs = PaymentAttempt.objects.filter(created_at__range=(start, end)).select_related("order")
        for key in ("status", "provider"):
            if request.query_params.get(key):
                qs = qs.filter(**{key: request.query_params[key]})
        if request.query_params.get("currency"):
            qs = qs.filter(currency=request.query_params["currency"].upper())
        cols = ["reference", "order", "provider", "status", "currency", "amount", "created_at"]
        rows = [{"reference": a.reference, "order": a.order.number, "provider": a.provider, "status": a.status,
                 "currency": a.currency, "amount": a.amount, "created_at": a.created_at.isoformat()} for a in qs.order_by("-created_at")[:5000]]
        return respond(request, "payments", cols, rows)


class RefundsReport(ReportView):
    permission_classes = [FinanceStaff]

    def report(self, request):
        start, end = window(request)
        qs = Refund.objects.filter(created_at__range=(start, end)).select_related("order", "requested_by")
        cols = ["order", "currency", "amount", "reason", "status", "requested_by", "created_at"]
        rows = [{"order": r.order.number, "currency": r.currency, "amount": r.amount, "reason": r.reason, "status": r.status,
                 "requested_by": r.requested_by.email if r.requested_by else "", "created_at": r.created_at.isoformat()} for r in qs]
        return respond(request, "refunds", cols, rows)


class StockReport(ReportView):
    permission_classes = [StockStaff]

    def report(self, request):
        qs = Inventory.objects.select_related("variant__product")
        if request.query_params.get("low") in {"1", "true"}:
            qs = qs.filter(quantity__lte=F("low_stock_threshold"))
        cols = ["sku", "product", "variant", "quantity", "low_stock_threshold", "low"]
        rows = [{"sku": i.variant.sku, "product": i.variant.product.name, "variant": i.variant.name, "quantity": i.quantity,
                 "low_stock_threshold": i.low_stock_threshold, "low": i.is_low} for i in qs.order_by("quantity")]
        return respond(request, "stock", cols, rows)


class ShippingReport(ReportView):
    permission_classes = [FulfillStaff]

    def report(self, request):
        start, end = window(request)
        qs = Shipment.objects.filter(created_at__range=(start, end)).select_related("order", "carrier")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        cols = ["order", "carrier", "service", "tracking_number", "status", "created_at"]
        rows = [{"order": s.order.number, "carrier": s.carrier.name if s.carrier else "", "service": s.service_name,
                 "tracking_number": s.tracking_number, "status": s.status, "created_at": s.created_at.isoformat()} for s in qs]
        return respond(request, "shipping", cols, rows)


class DashboardView(APIView):
    """Role-specific headline numbers and exceptions (FR-ADM-01). Each role only receives what it may see."""

    permission_classes = [IsStaffRole]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        role = request.user.role
        full = role in {Role.SUPER_ADMIN, Role.STORE_ADMIN}
        today = timezone.now().date()
        start = timezone.make_aware(datetime.combine(today - timedelta(days=6), time.min))
        out = {"role": role}
        by_status = dict(Order.objects.values_list("status").annotate(n=Count("id")))
        out["orders_by_status"] = by_status
        if full or role == Role.FULFILLMENT:
            out["to_ship"] = by_status.get(OrderStatus.PAID, 0) + by_status.get(OrderStatus.PROCESSING, 0)
            out["shipping_exceptions"] = Shipment.objects.filter(status=ShipmentStatus.EXCEPTION).count()
            out["low_stock"] = Inventory.objects.filter(quantity__lte=F("low_stock_threshold")).count()
        if full or role == Role.FINANCE:
            sales = (
                Order.objects.filter(status__in=PAID_STATES, paid_at__gte=start)
                .annotate(day=TruncDate("paid_at")).values("day", "currency").annotate(total=Sum("grand_total"), orders=Count("id")).order_by("day")
            )
            out["sales_last_7_days"] = [{"day": r["day"].isoformat(), "currency": r["currency"], "total": str(r["total"]), "orders": r["orders"]} for r in sales]
            out["payment_exceptions"] = PaymentAttempt.objects.filter(status=AttemptStatus.MISMATCH).count()
            out["unresolved_reconciliation"] = ReconciliationRecord.objects.filter(resolved=False).count()
        return Response(out)
