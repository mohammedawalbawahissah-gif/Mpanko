from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import STAFF_ROLES, Role


def has_role(user, *roles):
    return bool(user and user.is_authenticated and user.role in roles)


class IsStaffRole(BasePermission):
    """Any back-office staff role."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in STAFF_ROLES)


def roles_permission(*roles):
    """Build a permission class allowing only the given roles (super admin always allowed)."""
    allowed = set(roles) | {Role.SUPER_ADMIN}

    class _Permission(BasePermission):
        def has_permission(self, request, view):
            return has_role(request.user, *allowed)

    _Permission.__name__ = "Roles_" + "_".join(sorted(str(r) for r in allowed))
    return _Permission


CatalogManager = roles_permission(Role.STORE_ADMIN)
OrderStaff = roles_permission(Role.STORE_ADMIN, Role.FULFILLMENT, Role.FINANCE, Role.SUPPORT)
FulfillmentStaff = roles_permission(Role.STORE_ADMIN, Role.FULFILLMENT)
FinanceStaff = roles_permission(Role.STORE_ADMIN, Role.FINANCE)


class ReadOnlyOrCatalogManager(BasePermission):
    """Public read; writes only for catalog managers."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return has_role(request.user, Role.STORE_ADMIN, Role.SUPER_ADMIN)
