"""Back-office views: customers list, staff accounts, audit log browser (S1-01, FR-ADM-02, FR-ADM-04)."""
from django.db.models import Count, Max
from rest_framework import mixins, serializers, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import STAFF_ROLES, Address, AuditLog, Role, User
from .permissions import roles_permission
from .tasks import send_staff_invite

CustomerStaff = roles_permission(Role.STORE_ADMIN, Role.SUPPORT)
AdminStaff = roles_permission(Role.STORE_ADMIN)


class AddressBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        fields = ("label", "recipient_name", "line1", "line2", "city", "region", "postal_code", "country", "phone", "is_default")


class CustomerSerializer(serializers.ModelSerializer):
    order_count = serializers.IntegerField(read_only=True)
    last_order_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "phone", "email_verified", "is_active", "marketing_opt_in", "preferred_currency",
                  "date_joined", "order_count", "last_order_at")
        read_only_fields = ("id", "email", "full_name", "phone", "email_verified", "marketing_opt_in", "preferred_currency", "date_joined")


class CustomerDetailSerializer(CustomerSerializer):
    addresses = AddressBriefSerializer(many=True, read_only=True)
    orders = serializers.SerializerMethodField()
    returns = serializers.SerializerMethodField()
    support_cases = serializers.SerializerMethodField()

    def get_orders(self, obj):
        return [{"number": o.number, "status": o.status, "currency": o.currency, "grand_total": str(o.grand_total), "created_at": o.created_at}
                for o in obj.orders.all()[:25]]

    def get_returns(self, obj):
        return [{"number": r.number, "status": r.status, "order_number": r.order.number} for r in obj.returns.select_related("order")[:10]]

    def get_support_cases(self, obj):
        return [{"number": c.number, "subject": c.subject, "status": c.status} for c in obj.support_cases.all()[:10]]

    class Meta(CustomerSerializer.Meta):
        fields = CustomerSerializer.Meta.fields + ("addresses", "orders", "returns", "support_cases")


class CustomerViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Customers can be looked up by support and store admins. Only store admins can switch an account off."""

    permission_classes = [CustomerStaff]
    search_fields = ["email", "full_name", "phone"]
    ordering_fields = ["date_joined", "order_count", "last_order_at"]
    ordering = ["-date_joined"]
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return (
            User.objects.filter(role=Role.CUSTOMER)
            .annotate(order_count=Count("orders", distinct=True), last_order_at=Max("orders__created_at"))
            .prefetch_related("addresses")
        )

    def get_serializer_class(self):
        return CustomerDetailSerializer if self.action == "retrieve" else CustomerSerializer

    def perform_update(self, serializer):
        if not AdminStaff().has_permission(self.request, self):
            raise PermissionDenied("Only a store administrator can switch an account on or off.")
        user = serializer.save()
        AuditLog.record(self.request.user, "customer.activate" if user.is_active else "customer.deactivate", user, email=user.email)


class StaffSerializer(serializers.ModelSerializer):
    mfa_enabled = serializers.SerializerMethodField()

    def get_mfa_enabled(self, obj):
        device = getattr(obj, "totp_device", None)
        return bool(device and device.confirmed)

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "role", "is_active", "mfa_enabled", "date_joined")
        read_only_fields = ("id", "date_joined")

    def validate_role(self, role):
        if role not in {r.value for r in STAFF_ROLES} | {Role.CARRIER}:
            raise serializers.ValidationError("Choose a staff or carrier role.")
        actor = self.context["request"].user
        if role in {Role.SUPER_ADMIN, Role.STORE_ADMIN} and actor.role != Role.SUPER_ADMIN:
            raise serializers.ValidationError("Only the super administrator can give administrator roles.")
        return role


class StaffViewSet(viewsets.ModelViewSet):
    """Invite staff and carrier users, change their role, switch them off. Nobody can change their own role or access."""

    permission_classes = [AdminStaff]
    serializer_class = StaffSerializer
    search_fields = ["email", "full_name"]
    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        return User.objects.exclude(role=Role.CUSTOMER).order_by("role", "email")

    def _check_target(self, target):
        actor = self.request.user
        if target.pk == actor.pk:
            raise ValidationError({"detail": "You can't change your own role or access."})
        if target.role in {Role.SUPER_ADMIN, Role.STORE_ADMIN} and actor.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the super administrator can change an administrator.")

    def perform_create(self, serializer):
        if User.objects.filter(email__iexact=serializer.validated_data["email"]).exists():
            raise ValidationError({"email": "An account with this email already exists."})
        user = serializer.save(email_verified=True)
        user.set_unusable_password()
        user.is_staff = False
        user.save()
        AuditLog.record(self.request.user, "staff.invite", user, email=user.email, role=user.role)
        send_staff_invite.delay(user.pk)

    def perform_update(self, serializer):
        self._check_target(serializer.instance)
        before = serializer.instance.role, serializer.instance.is_active
        user = serializer.save()
        AuditLog.record(self.request.user, "staff.update", user, email=user.email, role_from=before[0], role_to=user.role, active=user.is_active)
        if user.role != before[0] or not user.is_active:
            # End their current sessions.
            from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
            from rest_framework_simplejwt.tokens import RefreshToken

            for t in OutstandingToken.objects.filter(user=user):
                try:
                    RefreshToken(t.token).blacklist()
                except Exception:  # noqa: BLE001 — already blacklisted or expired
                    pass


class AuditSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source="actor.email", read_only=True, default="system")

    class Meta:
        model = AuditLog
        fields = ("id", "created_at", "actor_email", "action", "object_type", "object_id", "detail")


class AuditLogViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [AdminStaff]
    serializer_class = AuditSerializer
    search_fields = ["action", "actor__email", "object_type", "object_id"]
    filterset_fields = ["action", "object_type"]

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor")
        p = self.request.query_params
        if p.get("from"):
            qs = qs.filter(created_at__date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(created_at__date__lte=p["to"])
        return qs
