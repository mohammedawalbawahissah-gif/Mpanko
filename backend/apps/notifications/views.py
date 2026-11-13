from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager, OrderStaff

from . import services
from .models import EmailTemplate, NotificationLog


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
        raise ValidationError({"body": f"This text cannot be used: {exc}"})
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
