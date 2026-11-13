from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ReturnViewSet, SupportCaseViewSet, return_eligibility

router = DefaultRouter()
router.register("returns", ReturnViewSet, basename="return")
router.register("support/cases", SupportCaseViewSet, basename="support-case")

urlpatterns = [path("returns/eligibility/", return_eligibility, name="return-eligibility")] + router.urls
