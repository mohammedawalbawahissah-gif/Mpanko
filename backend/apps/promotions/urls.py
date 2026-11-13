from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CouponViewSet, check

router = DefaultRouter()
router.register("coupons", CouponViewSet, basename="coupon")

urlpatterns = [path("coupons/check/", check, name="coupon-check")] + router.urls
