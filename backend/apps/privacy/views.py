import json

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager

from . import defaults
from .models import ConsentRecord, LegalPage
from .services import DeletionBlocked, delete_account, export_user_data, record_consent


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
def export_me(request):
    """Download everything we hold about the signed-in customer as a JSON file."""
    payload = json.dumps(export_user_data(request.user), indent=2)
    resp = HttpResponse(payload, content_type="application/json")
    resp["Content-Disposition"] = 'attachment; filename="mpanko-my-data.json"'
    return resp


class DeleteSerializer(serializers.Serializer):
    password = serializers.CharField()


@extend_schema(request=DeleteSerializer, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
def delete_me(request):
    s = DeleteSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    if not request.user.check_password(s.validated_data["password"]):
        raise ValidationError({"password": "Incorrect password."})
    try:
        delete_account(request.user)
    except DeletionBlocked as exc:
        raise ValidationError({"detail": str(exc)})
    return Response({"detail": "Your account has been deleted."})


class ConsentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsentRecord
        fields = ("kind", "granted", "version", "created_at")
        read_only_fields = ("version", "created_at")

    def validate_kind(self, value):
        if value not in {ConsentRecord.Kind.MARKETING, ConsentRecord.Kind.COOKIES}:
            raise serializers.ValidationError("Terms and privacy are accepted when you register or order.")
        return value


@extend_schema(request=ConsentSerializer, responses=ConsentSerializer(many=True))
@api_view(["GET", "POST"])
def consents(request):
    if request.method == "POST":
        s = ConsentSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        record_consent(request.user, s.validated_data["kind"], s.validated_data["granted"])
        if s.validated_data["kind"] == ConsentRecord.Kind.MARKETING:
            request.user.marketing_opt_in = s.validated_data["granted"]
            request.user.save(update_fields=["marketing_opt_in"])
    return Response(ConsentSerializer(request.user.consents.all()[:50], many=True).data)


def _page_dict(slug):
    row = LegalPage.objects.filter(slug=slug).first()
    if row and row.is_published:
        return {"slug": slug, "title": row.title, "body": row.body, "version": row.version, "updated_at": row.updated_at, "is_draft": False}
    title, body = defaults.pages()[slug]
    return {"slug": slug, "title": row.title if row else title, "body": body, "version": row.version if row else 1,
            "updated_at": row.updated_at if row else None, "is_draft": True}


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def page_list(request):
    return Response([{"slug": s, "title": _page_dict(s)["title"], "is_draft": _page_dict(s)["is_draft"]} for s in defaults.pages()])


class PageWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=150)
    body = serializers.CharField(max_length=60000)
    is_published = serializers.BooleanField()


@extend_schema(request=PageWriteSerializer, responses=OpenApiTypes.OBJECT)
@api_view(["GET", "PUT"])
@permission_classes([permissions.AllowAny])
def page_detail(request, slug):
    if slug not in defaults.pages():
        return Response({"detail": "Not found."}, status=404)
    if request.method == "GET":
        return Response(_page_dict(slug))
    if not (request.user and request.user.is_authenticated and CatalogManager().has_permission(request, None)):
        return Response({"detail": "Only a store administrator can edit pages."}, status=403)
    s = PageWriteSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    row, created = LegalPage.objects.get_or_create(slug=slug, defaults={"title": d["title"], "body": d["body"], "is_published": d["is_published"], "updated_by": request.user})
    if not created:
        changed = (row.body != d["body"]) or (row.title != d["title"])
        row.title, row.body, row.is_published, row.updated_by = d["title"], d["body"], d["is_published"], request.user
        if changed:
            row.version += 1
        row.save()
    AuditLog.record(request.user, "page.update", row, slug=slug, published=row.is_published, version=row.version)
    return Response(_page_dict(slug))
