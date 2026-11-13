from decimal import Decimal, InvalidOperation

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog, Role
from apps.accounts.permissions import FinanceStaff, has_role

from . import services
from .models import DutyRule, TaxRule
from .serializers import DutyRuleSerializer, TaxRuleSerializer


class _Permission(permissions.BasePermission):
    """Finance and store admins read and change tax and duty rules."""

    def has_permission(self, request, view):
        return FinanceStaff().has_permission(request, view)


class _RuleViewSet(viewsets.ModelViewSet):
    permission_classes = [_Permission]
    pagination_class = None
    audit_name = ""

    def perform_create(self, serializer):
        AuditLog.record(self.request.user, f"{self.audit_name}.create", serializer.save())

    def perform_update(self, serializer):
        AuditLog.record(self.request.user, f"{self.audit_name}.update", serializer.save())

    def perform_destroy(self, instance):
        AuditLog.record(self.request.user, f"{self.audit_name}.delete", instance)
        instance.delete()


class TaxRuleViewSet(_RuleViewSet):
    queryset = TaxRule.objects.all()
    serializer_class = TaxRuleSerializer
    audit_name = "tax_rule"


class DutyRuleViewSet(_RuleViewSet):
    queryset = DutyRule.objects.all()
    serializer_class = DutyRuleSerializer
    audit_name = "duty_rule"


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def estimate(request):
    """Tax and likely import duties for a basket: ?country=US&currency=USD&goods=120.00&shipping=30.00"""
    country = (request.query_params.get("country") or "").upper()
    currency = (request.query_params.get("currency") or "").upper()
    if len(country) != 2 or len(currency) != 3:
        raise ValidationError({"detail": "Provide country (2 letters) and currency (3 letters)."})
    try:
        goods = Decimal(request.query_params.get("goods", "0"))
        shipping = Decimal(request.query_params.get("shipping", "0"))
    except InvalidOperation:
        raise ValidationError({"detail": "goods and shipping must be numbers."})
    if goods < 0 or shipping < 0:
        raise ValidationError({"detail": "goods and shipping cannot be negative."})
    duties = services.estimate_duties(goods, country, currency)
    return Response({
        "tax": str(services.tax_for(goods, shipping, country, currency)),
        "duties": None if duties is None else {**duties, "duty": str(duties["duty"]), "vat": str(duties["vat"]), "total": str(duties["total"])},
    })
