from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog, Role
from apps.accounts.permissions import FinanceStaff, IsStaffRole, roles_permission
from apps.orders.models import Order
from apps.payments.providers import ProviderError

from . import services
from .models import ReturnRequest, SupportCase, SupportMessage
from .serializers import (
    ApproveSerializer, CaseCreateSerializer, CaseSerializer, MessageCreateSerializer, MessageSerializer, ReceiveSerializer,
    RejectSerializer, ReturnCreateSerializer, ReturnSerializer,
)
from .tasks import send_case_reply, send_return_email

ReturnStaff = roles_permission(Role.STORE_ADMIN, Role.SUPPORT, Role.FULFILLMENT)
SupportStaff = roles_permission(Role.STORE_ADMIN, Role.SUPPORT)


def _guard(request, perm):
    if not perm().has_permission(request, None):
        raise PermissionDenied()


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
def return_eligibility(request):
    """GET /returns/eligibility/?order=MP-XXXX: can this order be returned, and how many of each item?"""
    order = get_object_or_404(Order.objects.prefetch_related("items", "shipments"), number=request.query_params.get("order", ""), user=request.user)
    ok, message = services.eligibility(order)
    left = services.returnable_quantities(order)
    from django.conf import settings

    return Response({
        "eligible": ok, "message": message, "window_days": settings.RETURN_WINDOW_DAYS,
        "reasons": [{"value": v, "label": l} for v, l in ReturnRequest.Reason.choices
                    if v != "changed_mind" or settings.RETURN_ALLOW_CHANGED_MIND],
        "items": [{"order_item": i.id, "product_name": i.product_name, "variant_name": i.variant_name, "max": left.get(i.id, 0)} for i in order.items.all()],
    })


class ReturnViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    lookup_field = "number"
    serializer_class = ReturnSerializer
    filterset_fields = ["status"]
    search_fields = ["number", "order__number", "order__contact_email"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ReturnRequest.objects.none()
        qs = ReturnRequest.objects.select_related("order").prefetch_related("items__order_item")
        return qs if self.request.user.is_staff_role else qs.filter(user=self.request.user)

    @extend_schema(request=ReturnCreateSerializer, responses=ReturnSerializer)
    def create(self, request, *args, **kwargs):
        s = ReturnCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        order = get_object_or_404(Order.objects.prefetch_related("items", "shipments"), number=d["order_number"], user=request.user)
        try:
            req = services.create_return(request.user, order, d["items"], d["reason"], d["note"])
        except services.ReturnError as exc:
            raise ValidationError({"detail": str(exc)})
        transaction.on_commit(lambda: send_return_email.delay("return_requested", req.pk))
        return Response(ReturnSerializer(req).data, status=status.HTTP_201_CREATED)

    def _run(self, request, fn, key=None, perm=None, audit=None, **kwargs):
        if perm:
            _guard(request, perm)
        req = self.get_object()
        try:
            req = fn(req, **kwargs)
        except (services.ReturnError, ProviderError) as exc:
            raise ValidationError({"detail": str(exc)})
        if key:
            transaction.on_commit(lambda: send_return_email.delay(key, req.pk))
        if audit:
            AuditLog.record(request.user, audit, req, order=req.order.number)
        return Response(ReturnSerializer(req).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, number=None):
        req = self.get_object()
        if req.user_id != request.user.id:
            raise PermissionDenied()
        return self._run(request, services.cancel)

    @action(detail=True, methods=["post"])
    def approve(self, request, number=None):
        s = ApproveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return self._run(request, services.approve, "return_approved", ReturnStaff, "return.approve", actor=request.user, **s.validated_data)

    @action(detail=True, methods=["post"])
    def reject(self, request, number=None):
        s = RejectSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return self._run(request, services.reject, "return_rejected", ReturnStaff, "return.reject", actor=request.user, **s.validated_data)

    @action(detail=True, methods=["post"])
    def receive(self, request, number=None):
        s = ReceiveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return self._run(request, services.receive, None, ReturnStaff, "return.receive", actor=request.user, **s.validated_data)

    @action(detail=True, methods=["post"])
    def refund(self, request, number=None):
        return self._run(request, services.refund, "return_refunded", FinanceStaff, "return.refund", actor=request.user)


class SupportCaseViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    lookup_field = "number"
    serializer_class = CaseSerializer
    filterset_fields = ["status"]
    search_fields = ["number", "subject", "user__email", "order__number"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SupportCase.objects.none()
        qs = SupportCase.objects.select_related("user", "order").prefetch_related("messages__author")
        return qs if self.request.user.is_staff_role else qs.filter(user=self.request.user)

    @extend_schema(request=CaseCreateSerializer, responses=CaseSerializer)
    def create(self, request, *args, **kwargs):
        s = CaseCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        order = None
        if d["order_number"]:
            order = get_object_or_404(Order, number=d["order_number"], user=request.user)
        case = SupportCase.objects.create(user=request.user, order=order, subject=d["subject"])
        SupportMessage.objects.create(case=case, author=request.user, body=d["message"])
        return Response(CaseSerializer(case).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=MessageCreateSerializer, responses=CaseSerializer)
    @action(detail=True, methods=["post"])
    def messages(self, request, number=None):
        case = self.get_object()
        s = MessageCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        staff = request.user.is_staff_role
        if staff:
            _guard(request, SupportStaff)
        elif case.status == SupportCase.Status.CLOSED:
            raise ValidationError({"detail": "This request is closed. Start a new one if you still need help."})
        msg = SupportMessage.objects.create(case=case, author=request.user, from_staff=staff, body=s.validated_data["body"])
        case.status = SupportCase.Status.ANSWERED if staff else SupportCase.Status.OPEN
        case.save(update_fields=["status", "updated_at"])
        if staff:
            transaction.on_commit(lambda: send_case_reply.delay(msg.pk))
        return Response(CaseSerializer(self.get_queryset().get(pk=case.pk)).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def close(self, request, number=None):
        case = self.get_object()
        if request.user.is_staff_role:
            _guard(request, SupportStaff)
        case.status = SupportCase.Status.CLOSED
        case.save(update_fields=["status", "updated_at"])
        return Response(CaseSerializer(self.get_queryset().get(pk=case.pk)).data)
