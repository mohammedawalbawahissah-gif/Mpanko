from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DutyRuleViewSet, TaxRuleViewSet, estimate

router = DefaultRouter()
router.register("tax/rules", TaxRuleViewSet, basename="tax-rule")
router.register("tax/duties", DutyRuleViewSet, basename="duty-rule")

urlpatterns = [path("tax/estimate/", estimate, name="tax-estimate")] + router.urls
