from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager

from . import campaigns, preferences
from .models import Campaign, StockAlert
from .tasks import send_campaign


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["GET", "PUT"])
def my_preferences(request):
    """The signed-in person's switches. PUT {"categories": {"orders": {"sms": true}}, "marketing_opt_in": true, "staff": {"push": true}}."""
    user = request.user
    if request.method == "PUT":
        data = request.data if isinstance(request.data, dict) else {}
        if isinstance(data.get("marketing_opt_in"), bool) and data["marketing_opt_in"] != user.marketing_opt_in:
            user.marketing_opt_in = data["marketing_opt_in"]
            user.save(update_fields=["marketing_opt_in"])
        preferences.set_preferences(user, data.get("categories"))
        if user.is_staff_role:
            preferences.set_staff_preferences(user, data.get("staff"))
    out = preferences.matrix(user)
    if user.is_staff_role:
        out["staff"] = preferences.staff_matrix(user)
    return Response(out)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET", "POST"])
@permission_classes([permissions.AllowAny])
def unsubscribe(request):
    """The link in every announcement email. Opens, switches offers off, and says so. Also answers the one-click POST mail apps send."""
    user = preferences.user_from_unsubscribe_token(request.query_params.get("token", ""))
    if not user:
        return HttpResponse("<h1>This link is not valid</h1><p>It may have expired. Sign in to your account to change your messages.</p>", status=400)
    if user.marketing_opt_in:
        user.marketing_opt_in = False
        user.save(update_fields=["marketing_opt_in"])
    return HttpResponse("<h1>You are unsubscribed</h1><p>You will not get news or offers from Mpanko any more. Order and payment messages continue.</p>")


class StockAlertSerializer(serializers.ModelSerializer):
    product = serializers.CharField(source="variant.product.name", read_only=True)
    variant_id = serializers.IntegerField(source="variant.pk", read_only=True)

    class Meta:
        model = StockAlert
        fields = ["id", "variant_id", "product", "created_at", "notified_at"]


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["GET", "POST", "DELETE"])
def stock_alerts(request):
    """Ask to be told when an out-of-stock item returns. POST {"variant": id}; DELETE ?variant=id."""
    from apps.catalog.models import ProductVariant

    if request.method == "GET":
        qs = StockAlert.objects.filter(user=request.user, notified_at__isnull=True).select_related("variant__product")
        return Response(StockAlertSerializer(qs, many=True).data)
    raw = request.data.get("variant") if request.method == "POST" else request.query_params.get("variant")
    if not str(raw or "").isdigit():
        raise ValidationError({"variant": "Choose an item."})
    if request.method == "DELETE":
        StockAlert.objects.filter(user=request.user, variant_id=int(raw)).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    variant = get_object_or_404(ProductVariant, pk=int(raw), is_active=True)
    alert, _ = StockAlert.objects.update_or_create(user=request.user, variant=variant, defaults={"notified_at": None})
    return Response(StockAlertSerializer(alert).data, status=status.HTTP_201_CREATED)


class CampaignSerializer(serializers.ModelSerializer):
    class Meta:
        model = Campaign
        fields = ["id", "title", "subject", "body", "link", "send_email", "send_push", "countries", "status", "sent_at", "emailed", "pushed", "skipped", "created_at"]
        read_only_fields = ["status", "sent_at", "emailed", "pushed", "skipped", "created_at"]

    def validate_countries(self, value):
        codes = [str(c).strip().upper() for c in (value or []) if str(c).strip()]
        if any(len(c) != 2 for c in codes):
            raise serializers.ValidationError("Use two-letter country codes, for example US or GH.")
        return codes

    def validate(self, attrs):
        if attrs.get("send_email", True) is False and attrs.get("send_push", True) is False:
            raise serializers.ValidationError("Choose email, the app, or both.")
        return attrs


class CampaignViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Announcements to customers who agreed to receive them. Staff write one, send themselves a test, then send it once."""

    queryset = Campaign.objects.all()
    serializer_class = CampaignSerializer
    permission_classes = [CatalogManager]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def _draft(self, campaign):
        if campaign.status != Campaign.Status.DRAFT:
            raise ValidationError({"detail": "This announcement has already been sent, so it cannot be changed."})

    def perform_update(self, serializer):
        self._draft(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._draft(instance)
        instance.delete()

    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None):
        """How many people this would reach right now, and by which channel."""
        c = self.get_object()
        users = list(campaigns.audience(c.countries))
        return Response({
            "people": len(users),
            "email": sum(1 for u in users if c.send_email and preferences.allowed(u, "offers", "email")),
            "push": sum(1 for u in users if c.send_push and preferences.allowed(u, "offers", "push")),
        })

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """Send this announcement to the person asking, so they can see it first."""
        c = self.get_object()
        from .services import send_notification

        ctx = {"subject": f"[Test] {c.subject}", "message": c.body, "link": c.link, "unsubscribe_url": "(unsubscribe link appears here)"}
        sent = send_notification("announcement", request.user.email, ctx, dedupe=False, fanout=False)
        return Response({"sent": bool(sent)})

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        c = self.get_object()
        self._draft(c)
        if not preferences_has_audience(c):
            raise ValidationError({"detail": "Nobody who agreed to offers matches this announcement yet."})
        AuditLog.record(request.user, "campaign.send", c)
        send_campaign.delay(c.pk)
        c.refresh_from_db()
        return Response(CampaignSerializer(c).data)


def preferences_has_audience(campaign):
    return next(iter(campaigns.audience(campaign.countries)), None) is not None


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([CatalogManager])
def audience_summary(request):
    """Who the customers are: how many, where, and how many agreed to offers on each channel."""
    return Response(campaigns.summary())
