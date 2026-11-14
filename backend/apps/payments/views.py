import logging

from django.conf import settings
from datetime import timedelta

from django.db import IntegrityError
from django.utils import timezone
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AuditLog
from apps.accounts.permissions import FinanceStaff
from apps.orders.models import Order, OrderStatus

from .models import AttemptStatus, Dispute, PaymentAttempt, ReconciliationRecord, ReconciliationRun, Refund, WebhookEvent
from .providers import InvalidSignature, ProviderError, enabled_providers, get_provider
from .services import apply_result, issue_refund, reconcile

logger = logging.getLogger(__name__)


class InitiateSerializer(serializers.Serializer):
    order_number = serializers.CharField()
    provider = serializers.CharField()


class MethodsView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        currency = request.query_params.get("currency", "").upper()
        return Response([
            {"provider": name, "currencies": sorted(p.currencies), "manual": p.manual}
            for name, p in enabled_providers().items()
            if not currency or p.supports_currency(currency)
        ])


def _start_payment(request, order, provider_name):
    """Start (or idempotently resume) a payment for `order`. The caller has already proven the order is theirs."""
    if order.status != OrderStatus.PENDING_PAYMENT:
        raise ValidationError({"order_number": f"Order is '{order.status}' and cannot be paid."})
    try:
        provider = get_provider(provider_name)
    except ProviderError as exc:
        raise ValidationError({"provider": str(exc)})
    if not provider.supports_currency(order.currency):
        raise ValidationError({"provider": f"{provider.name} cannot charge in {order.currency}."})

    key = request.headers.get("Idempotency-Key", "").strip()
    if key:
        existing = PaymentAttempt.objects.filter(order=order, idempotency_key=key).first()
        if existing:
            return Response(_attempt_payload(existing), status=status.HTTP_200_OK)
    # Amount comes from the order record on our server, never from the request.
    attempt = PaymentAttempt(order=order, provider=provider.name, amount=order.grand_total, currency=order.currency, idempotency_key=key)
    try:
        result = provider.initiate(attempt, order.contact_email, settings.PAYMENT_RETURN_URL)
    except ProviderError as exc:
        raise ValidationError({"detail": str(exc)})
    attempt.authorization_url = result["authorization_url"]
    attempt.provider_reference = result.get("provider_reference", "")
    attempt.raw_response = result.get("raw", {})
    try:
        attempt.save()
        if provider.manual:
            # A person confirms this payment, which takes longer than a gateway: hold the stock for longer than usual.
            hold = timezone.now() + timedelta(hours=settings.MANUAL_PAYMENT_HOLD_HOURS)
            if order.expires_at is None or order.expires_at < hold:
                Order.objects.filter(pk=order.pk).update(expires_at=hold)
    except IntegrityError:  # two simultaneous requests with the same key
        return Response(_attempt_payload(PaymentAttempt.objects.get(order=order, idempotency_key=key)))
    return Response(_attempt_payload(attempt), status=status.HTTP_201_CREATED)


class InitiateView(APIView):
    """Start (or idempotently resume) a payment for one of the caller's own pending orders."""

    @extend_schema(request=InitiateSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = InitiateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = get_object_or_404(Order, number=s.validated_data["order_number"], user=request.user)
        return _start_payment(request, order, s.validated_data["provider"])


class GuestInitiateSerializer(InitiateSerializer):
    token = serializers.CharField()


class GuestInitiateView(APIView):
    """Pay for a guest order with the signed link from checkout or the confirmation email."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=GuestInitiateSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        from apps.orders.guest import guest_payment_order

        if not settings.GUEST_CHECKOUT_ENABLED:
            raise NotFound()
        s = GuestInitiateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = guest_payment_order(s.validated_data["order_number"], s.validated_data["token"])
        return _start_payment(request, order, s.validated_data["provider"])


def _attempt_payload(attempt):
    return {
        "reference": attempt.reference, "provider": attempt.provider, "status": attempt.status,
        "amount": str(attempt.amount), "currency": attempt.currency, "authorization_url": attempt.authorization_url,
        "manual": bool(attempt.raw_response.get("manual")), "instructions": attempt.raw_response.get("instructions", ""),
    }


def _verify_attempt(attempt, reference):
    if attempt.status == AttemptStatus.PENDING:
        try:
            v = get_provider(attempt.provider).verify(attempt)
        except ProviderError as exc:
            raise ValidationError({"detail": str(exc)})
        attempt = apply_result(reference, v.status, v.amount, v.currency, v.provider_reference) or attempt
    attempt.order.refresh_from_db()
    manual = bool(attempt.raw_response.get("manual"))
    return Response({
        "reference": reference, "payment_status": attempt.status, "order_number": attempt.order.number, "order_status": attempt.order.status,
        "manual": manual, "instructions": attempt.raw_response.get("instructions", "") if manual else "",
    })


class VerifyView(APIView):
    """Customer returns from the provider's page; we ask the provider directly rather than trusting the browser."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, reference):
        attempt = get_object_or_404(PaymentAttempt, reference=reference, order__user=request.user)
        return _verify_attempt(attempt, reference)


class GuestVerifyView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, reference):
        from apps.orders.guest import read_token

        if not settings.GUEST_CHECKOUT_ENABLED:
            raise NotFound()
        attempt = get_object_or_404(PaymentAttempt, reference=reference, order__user__isnull=True)
        if not read_token(request.query_params.get("token", ""), attempt.order.number):
            raise NotFound("This order link is not valid. Ask for a new one.")
        return _verify_attempt(attempt, reference)


class WebhookView(APIView):
    """Provider callbacks. No login: authenticity is proven by the provider's signature over the raw body."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = []

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, provider):
        try:
            gateway = get_provider(provider)
        except ProviderError:
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            event = gateway.parse_webhook(request.body, {k.lower(): v for k, v in request.headers.items()})
        except InvalidSignature:
            logger.warning("Rejected %s webhook with invalid signature", provider)
            return Response({"detail": "Invalid signature."}, status=status.HTTP_401_UNAUTHORIZED)
        except (ValueError, KeyError):
            return Response({"detail": "Malformed payload."}, status=status.HTTP_400_BAD_REQUEST)

        record, created = WebhookEvent.objects.get_or_create(
            provider=provider, event_id=event.event_id, defaults={"event_type": event.event_type, "payload": event.payload}
        )
        if not created and record.processed:
            return Response({"detail": "Already processed."})  # duplicate delivery: acknowledge, do nothing
        if event.dispute:
            from .disputes import record_dispute

            record_dispute(provider, event.dispute, event.reference)
        else:
            apply_result(event.reference, event.status, event.amount, event.currency, event.provider_reference, raw={"event": event.event_type})
        record.processed = True
        record.save(update_fields=["processed"])
        return Response({"detail": "ok"})


class ManualPaymentsView(APIView):
    """Cash and Zelle payments still waiting for finance to confirm that the money arrived."""

    permission_classes = [FinanceStaff]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        names = [n for n, p in enabled_providers().items() if p.manual]
        qs = PaymentAttempt.objects.filter(provider__in=names, status=AttemptStatus.PENDING, order__status=OrderStatus.PENDING_PAYMENT).select_related("order").order_by("created_at")
        return Response([
            {"reference": a.reference, "order_number": a.order.number, "provider": a.provider, "amount": str(a.amount), "currency": a.currency,
             "contact_email": a.order.contact_email, "created_at": a.created_at, "expires_at": a.order.expires_at}
            for a in qs[:200]
        ])


class ConfirmManualSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)


class ConfirmManualView(APIView):
    """Finance confirms that a Cash or Zelle payment arrived. The amount received must match the order exactly."""

    permission_classes = [FinanceStaff]

    @extend_schema(request=ConfirmManualSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, reference):
        s = ConfirmManualSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        attempt = get_object_or_404(PaymentAttempt, reference=reference)
        try:
            manual = get_provider(attempt.provider).manual
        except ProviderError:
            manual = False
        if not manual:
            raise ValidationError({"detail": "Only Cash and Zelle payments are confirmed by hand."})
        if attempt.status != AttemptStatus.PENDING:
            raise ValidationError({"detail": f"This payment is already '{attempt.status}'."})
        if s.validated_data["amount"] != attempt.amount:
            raise ValidationError({"amount": f"The order is for {attempt.currency} {attempt.amount}. Confirm only when exactly that has arrived."})
        attempt = apply_result(reference, "succeeded", attempt.amount, attempt.currency, raw={"confirmed_by": request.user.email}, source="staff")
        AuditLog.record(request.user, "payment.confirm_manual", attempt, provider=attempt.provider, amount=str(attempt.amount))
        attempt.order.refresh_from_db()
        return Response({"reference": reference, "payment_status": attempt.status, "order_status": attempt.order.status})


class RefundSerializer(serializers.Serializer):
    order_number = serializers.CharField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True)


class RefundView(APIView):
    permission_classes = [FinanceStaff]

    @extend_schema(request=RefundSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = RefundSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = get_object_or_404(Order, number=s.validated_data["order_number"])
        try:
            refund = issue_refund(order, s.validated_data.get("amount"), s.validated_data.get("reason", ""), request.user)
        except ProviderError as exc:
            raise ValidationError({"detail": str(exc)})
        AuditLog.record(request.user, "payment.refund", order, amount=str(refund.amount), currency=refund.currency)
        return Response({"refund_id": refund.pk, "amount": str(refund.amount), "currency": refund.currency, "status": refund.status}, status=status.HTTP_201_CREATED)


class ReconcileSerializer(serializers.Serializer):
    provider = serializers.CharField()
    start = serializers.DateTimeField()
    end = serializers.DateTimeField()


class ReconciliationRecordSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = ReconciliationRecord
        fields = ("id", "kind", "kind_label", "reference", "order_number", "internal_amount", "provider_amount", "currency",
                  "internal_status", "provider_status", "resolved", "resolution_note")


class ReconciliationRunView(APIView):
    """POST starts a run (finance only); GET lists recent runs."""

    permission_classes = [FinanceStaff]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        runs = ReconciliationRun.objects.all()[:50]
        return Response([
            {"id": r.pk, "provider": r.provider, "period_start": r.period_start, "period_end": r.period_end,
             "matched": r.matched, "exceptions": r.exceptions, "unresolved": r.records.filter(resolved=False).count(),
             "created_at": r.created_at}
            for r in runs
        ])

    @extend_schema(request=ReconcileSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = ReconcileSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if s.validated_data["end"] <= s.validated_data["start"]:
            raise ValidationError({"end": "End must be after start."})
        try:
            run = reconcile(s.validated_data["provider"], s.validated_data["start"], s.validated_data["end"], request.user)
        except ProviderError as exc:
            raise ValidationError({"detail": str(exc)})
        AuditLog.record(request.user, "payment.reconcile", run, exceptions=run.exceptions)
        return Response({"id": run.pk, "matched": run.matched, "exceptions": run.exceptions}, status=status.HTTP_201_CREATED)


class ReconciliationDetailView(APIView):
    permission_classes = [FinanceStaff]

    @extend_schema(responses=ReconciliationRecordSerializer(many=True))
    def get(self, request, run_id):
        run = get_object_or_404(ReconciliationRun, pk=run_id)
        return Response({
            "id": run.pk, "provider": run.provider, "matched": run.matched, "exceptions": run.exceptions,
            "records": ReconciliationRecordSerializer(run.records.all(), many=True).data,
        })


class ResolveSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=255)


class ReconciliationResolveView(APIView):
    permission_classes = [FinanceStaff]

    @extend_schema(request=ResolveSerializer, responses=ReconciliationRecordSerializer)
    def post(self, request, record_id):
        record = get_object_or_404(ReconciliationRecord, pk=record_id)
        s = ResolveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        record.resolved, record.resolution_note, record.resolved_by = True, s.validated_data["note"], request.user
        record.save()
        AuditLog.record(request.user, "payment.reconcile.resolve", record, note=record.resolution_note)
        return Response(ReconciliationRecordSerializer(record).data)


class DisputeSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.number", read_only=True)
    payment_reference = serializers.CharField(source="attempt.reference", read_only=True)

    class Meta:
        model = Dispute
        fields = ("id", "order_number", "payment_reference", "provider", "provider_dispute_id", "status", "category", "amount", "currency",
                  "respond_by", "provider_status", "resolution", "notes", "opened_at", "resolved_at")
        read_only_fields = ("id", "provider", "provider_dispute_id", "category", "amount", "currency", "respond_by", "provider_status",
                            "resolution", "opened_at", "resolved_at")

    def validate_status(self, value):
        # Staff can only say "we sent the evidence". Won/lost/accepted come from the provider.
        if self.instance and value not in {Dispute.Status.EVIDENCE_SENT, self.instance.status}:
            raise serializers.ValidationError("Only the payment provider can mark a dispute won, lost or accepted.")
        return value


class DisputeViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Chargebacks. Finance can read them, add notes and mark evidence as sent (?status=open for the to-do list)."""

    permission_classes = [FinanceStaff]
    serializer_class = DisputeSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        qs = Dispute.objects.select_related("order", "attempt")
        return qs.filter(status=self.request.query_params["status"]) if self.request.query_params.get("status") else qs

    def perform_update(self, serializer):
        obj = serializer.save()
        AuditLog.record(self.request.user, "dispute.update", obj, status=obj.status)
