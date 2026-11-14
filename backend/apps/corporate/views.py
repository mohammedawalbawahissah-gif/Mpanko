from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import AuditLog, Role, User
from apps.accounts.permissions import CatalogManager, roles_permission

from .models import Business, ContactMessage, SiteProfile
from .serializers import (
    ContactInputSerializer, ContactMessageSerializer, ManageBusinessSerializer, PublicBusinessDetailSerializer,
    PublicBusinessSerializer, SiteProfileSerializer,
)

MessageStaff = roles_permission(Role.STORE_ADMIN, Role.SUPPORT)


def _published():
    return Business.objects.filter(is_published=True).order_by("-is_featured", "sort_order", "name")


class SiteView(APIView):
    """Everything the corporate home, about and businesses pages need, in one call. No sign-in."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({
            "profile": SiteProfileSerializer(SiteProfile.get()).data,
            "businesses": PublicBusinessSerializer(_published(), many=True, context={"request": request}).data,
        })


class PublicBusinessView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=PublicBusinessDetailSerializer)
    def get(self, request, slug):
        b = _published().filter(slug=slug).first()
        if b is None:
            raise NotFound()  # a draft is the same as a business that does not exist
        return Response(PublicBusinessDetailSerializer(b, context={"request": request}).data)


class ContactThrottle(AnonRateThrottle):
    scope = "corporate_contact"


class ContactView(APIView):
    """The corporate site's contact form. Stored for staff and emailed to them."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ContactThrottle]

    @extend_schema(request=ContactInputSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        s = ContactInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        if data.get("website"):
            return Response({"ok": True}, status=status.HTTP_201_CREATED)  # a bot: pretend it worked, store nothing
        business = _published().filter(slug=data["business"]).first() if data.get("business") else None
        with transaction.atomic():
            m = ContactMessage.objects.create(
                name=data["name"], email=data["email"], phone=data.get("phone", ""), business=business, message=data["message"],
            )
            transaction.on_commit(lambda: alert_staff(m.pk))
        return Response({"ok": True}, status=status.HTTP_201_CREATED)


def alert_staff(message_id):
    """Email the people who answer enquiries. Never raises: a mail problem must not lose the enquiry."""
    from apps.notifications.services import send_notification

    m = ContactMessage.objects.select_related("business").get(pk=message_id)
    ctx = {
        "name": m.name, "email": m.email, "phone": m.phone or "not given",
        "about": m.business.name if m.business else "the company in general", "message": m.message,
    }
    people = set(User.objects.filter(role__in=[Role.STORE_ADMIN, Role.SUPPORT], is_active=True).values_list("email", flat=True))
    people |= set(getattr(settings, "STAFF_ALERT_EMAILS", []))
    profile_email = SiteProfile.get().contact_email
    if profile_email:
        people.add(profile_email)
    for email in sorted(people):
        send_notification("corporate_enquiry", email, ctx, ref=f"enquiry-{m.pk}")


# ---------------------------------------------------------------- staff


class ProfileManageView(APIView):
    permission_classes = [CatalogManager]

    @extend_schema(responses=SiteProfileSerializer)
    def get(self, request):
        return Response(SiteProfileSerializer(SiteProfile.get()).data)

    @extend_schema(request=SiteProfileSerializer, responses=SiteProfileSerializer)
    def put(self, request):
        profile = SiteProfile.get()
        s = SiteProfileSerializer(profile, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        AuditLog.record(request.user, "corporate.profile.update", profile)
        return Response(s.data)


class BusinessManageViewSet(viewsets.ModelViewSet):
    """Add, edit, publish and remove the businesses listed on the corporate website."""

    queryset = Business.objects.all()
    serializer_class = ManageBusinessSerializer
    permission_classes = [CatalogManager]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    pagination_class = None
    search_fields = ["name", "sector"]

    def perform_create(self, serializer):
        b = serializer.save()
        AuditLog.record(self.request.user, "corporate.business.create", b, name=b.name)

    def perform_update(self, serializer):
        b = serializer.save()
        AuditLog.record(self.request.user, "corporate.business.update", b, name=b.name, published=b.is_published)

    def perform_destroy(self, instance):
        AuditLog.record(self.request.user, "corporate.business.delete", instance, name=instance.name)
        if instance.logo:
            instance.logo.delete(save=False)
        instance.delete()


class MessageManageViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """The enquiry inbox: read, mark handled, add a note. Messages are never edited, only answered."""

    queryset = ContactMessage.objects.select_related("business", "handled_by")
    serializer_class = ContactMessageSerializer
    permission_classes = [MessageStaff]
    search_fields = ["name", "email", "message"]
    filterset_fields = ["status"]
    http_method_names = ["get", "patch", "head", "options"]

    def perform_update(self, serializer):
        before = serializer.instance.status
        m = serializer.save()
        if m.status == ContactMessage.Status.HANDLED and before != m.status:
            m.handled_by, m.handled_at = self.request.user, timezone.now()
        elif m.status == ContactMessage.Status.NEW:
            m.handled_by, m.handled_at = None, None
        m.save(update_fields=["handled_by", "handled_at"])
        AuditLog.record(self.request.user, "corporate.message.update", m, status=m.status)
