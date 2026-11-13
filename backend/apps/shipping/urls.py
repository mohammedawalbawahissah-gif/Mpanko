from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ShipmentViewSet, carrier_list, carrier_webhook, quote

router = DefaultRouter()
router.register("shipments", ShipmentViewSet, basename="shipment")

urlpatterns = [
    path("carriers/", carrier_list, name="carrier-list"),
    path("shipping/quote/", quote, name="shipping-quote"),
    path("shipping/webhooks/<slug:carrier_code>/", carrier_webhook, name="carrier-webhook"),
] + router.urls
