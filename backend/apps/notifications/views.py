from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager, OrderStaff

from . import services
from django.utils import timezone

from .models import EmailTemplate, InboxMessage, NotificationLog, WebPushSubscription


class TemplateWrite(serializers.Serializer):
    subject = serializers.CharField(max_length=200)
    body = serializers.CharField()
    is_active = serializers.BooleanField(required=False, default=True)


def _describe(key):
    label, _, _, variables = services.DEFAULTS[key]
    subject, body, active, customised = services.effective_template(key)
    return {
        "key": key, "label": label, "subject": subject, "body": body, "is_active": active,
        "customised": customised, "variables": sorted(variables),
        "default_subject": services.DEFAULTS[key][1], "default_body": services.DEFAULTS[key][2],
    }


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([CatalogManager])
def template_list(request):
    return Response([_describe(k) for k in services.DEFAULTS])


@extend_schema(request=TemplateWrite, responses=OpenApiTypes.OBJECT)
@api_view(["GET", "PUT", "DELETE"])
@permission_classes([CatalogManager])
def template_detail(request, key):
    if key not in services.DEFAULTS:
        raise NotFound()
    if request.method == "GET":
        return Response(_describe(key))
    if request.method == "DELETE":  # back to the built-in wording
        EmailTemplate.objects.filter(key=key).delete()
        AuditLog.record(request.user, "email_template.reset", None, key=key)
        return Response(_describe(key))
    s = TemplateWrite(data=request.data)
    s.is_valid(raise_exception=True)
    try:
        services.validate_template(key, s.validated_data["subject"], s.validated_data["body"])
    except ValueError as exc:
        raise ValidationError({"body": f"This text cannot be used: {exc}"}) from exc
    row, _ = EmailTemplate.objects.update_or_create(key=key, defaults={**s.validated_data, "updated_by": request.user})
    AuditLog.record(request.user, "email_template.update", row, key=key)
    return Response(_describe(key))


@extend_schema(request=None, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([CatalogManager])
def template_test(request, key):
    """Send the current wording of this email, with example values, to the signed-in staff member."""
    if key not in services.DEFAULTS:
        raise NotFound()
    sent = services.send_notification(key, request.user.email, services.sample_context(key), dedupe=False)
    return Response({"sent": sent, "to": request.user.email})


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([OrderStaff])
def log_list(request):
    """Delivery log, newest first. ?status=failed shows only failures; ?key= filters by email type."""
    qs = NotificationLog.objects.all()
    if request.query_params.get("status"):
        qs = qs.filter(status=request.query_params["status"])
    if request.query_params.get("key"):
        qs = qs.filter(key=request.query_params["key"])
    rows = qs[:200]
    return Response([
        {"id": r.pk, "key": r.key, "channel": r.channel, "recipient": r.recipient, "subject": r.subject, "status": r.status,
         "error": r.error, "ref": r.ref, "created_at": r.created_at}
        for r in rows
    ])


class DeviceSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=200)
    platform = serializers.CharField(max_length=10, required=False, allow_blank=True, default="")


@extend_schema(request=DeviceSerializer, responses=OpenApiTypes.OBJECT)
@api_view(["POST", "DELETE"])
def device(request):
    """The mobile app registers (POST) or removes (DELETE, on sign-out) this phone's push token."""
    from .models import DeviceToken

    s = DeviceSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    token = s.validated_data["token"]
    if not token.startswith(("ExponentPushToken[", "ExpoPushToken[")):
        raise ValidationError({"token": "That doesn't look like a push token."})
    if request.method == "DELETE":
        DeviceToken.objects.filter(user=request.user, token=token).delete()
        return Response({"registered": False})
    DeviceToken.objects.update_or_create(token=token, defaults={"user": request.user, "platform": s.validated_data["platform"]})
    return Response({"registered": True})


# ---- the customer's notification list ------------------------------------------------------------------------


class InboxSerializer(serializers.ModelSerializer):
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = InboxMessage
        fields = ("id", "key", "title", "body", "path", "is_read", "created_at")

    def get_is_read(self, obj):
        return obj.read_at is not None


class InboxViewSet(mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """A customer's own notifications, newest first. ?unread=1 shows only the unread ones."""

    serializer_class = InboxSerializer
    filterset_fields: list = []

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return InboxMessage.objects.none()
        qs = InboxMessage.objects.filter(user=self.request.user)
        if self.request.query_params.get("unread") in ("1", "true"):
            qs = qs.filter(read_at__isnull=True)
        return qs

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"], url_path="unread-count", pagination_class=None)
    def unread_count(self, request):
        return Response({"count": InboxMessage.objects.filter(user=request.user, read_at__isnull=True).count()})

    @extend_schema(request=None, responses=InboxSerializer)
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        msg = self.get_object()
        if msg.read_at is None:
            msg.read_at = timezone.now()
            msg.save(update_fields=["read_at"])
        return Response(InboxSerializer(msg).data)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        n = InboxMessage.objects.filter(user=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"marked": n})


# ---- browser push --------------------------------------------------------------------------------------------


# Browsers hand out push endpoints on their vendor's push service. Anything else would make the server send requests to a
# host the customer chose, so only https URLs on these hosts (or their subdomains) are accepted.
WEB_PUSH_HOSTS = ("fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com", "push.microsoft.com")


def is_push_endpoint(url):
    from urllib.parse import urlparse

    try:
        parts = urlparse(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        return False
    if parts.scheme != "https" or parts.username or parts.password or parts.port not in (None, 443):
        return False
    return any(host == h or host.endswith("." + h) for h in WEB_PUSH_HOSTS)


class WebPushSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=500)

    def validate_endpoint(self, value):
        if not is_push_endpoint(value):
            raise serializers.ValidationError("That is not a browser push address.")
        return value

    p256dh = serializers.CharField(max_length=200, required=False)
    auth = serializers.CharField(max_length=100, required=False)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([])
def web_push_key(request):
    """The public key a browser needs to subscribe. Empty while browser push isn't set up."""
    from django.conf import settings

    return Response({"public_key": settings.VAPID_PUBLIC_KEY if settings.VAPID_PRIVATE_KEY else ""})


@extend_schema(request=WebPushSerializer, responses=OpenApiTypes.OBJECT)
@api_view(["POST", "DELETE"])
def web_push(request):
    """The shop in a browser subscribes (POST) or unsubscribes (DELETE) that browser."""
    s = WebPushSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    if request.method == "DELETE":
        WebPushSubscription.objects.filter(user=request.user, endpoint=d["endpoint"]).delete()
        return Response({"subscribed": False})
    if not d.get("p256dh") or not d.get("auth"):
        raise ValidationError({"detail": "The browser's keys are missing."})
    WebPushSubscription.objects.update_or_create(endpoint=d["endpoint"], defaults={"user": request.user, "p256dh": d["p256dh"], "auth": d["auth"]})
    if not request.user.notify_push:  # allowing notifications in a browser is asking for push
        request.user.notify_push = True
        request.user.save(update_fields=["notify_push"])
    return Response({"subscribed": True})
