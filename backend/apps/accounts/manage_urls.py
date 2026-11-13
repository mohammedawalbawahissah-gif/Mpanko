from rest_framework.routers import DefaultRouter

from .manage_views import AuditLogViewSet, CustomerViewSet, StaffViewSet

router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
router.register("staff", StaffViewSet, basename="staff")
router.register("audit", AuditLogViewSet, basename="audit")

urlpatterns = router.urls
