from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import BlockedDestinationViewSet, PickupLocationViewSet, ShipmentViewSet, ShippingRateViewSet, ShippingZoneViewSet, carrier_list, carrier_webhook, quote

router = DefaultRouter()
router.register("shipping/zones", ShippingZoneViewSet, basename="shipping-zone")
router.register("shipping/rates", ShippingRateViewSet, basename="shipping-rate")
router.register("shipping/blocked", BlockedDestinationViewSet, basename="shipping-blocked")
router.register("shipping/pickups", PickupLocationViewSet, basename="shipping-pickup")
router.register("shipments", ShipmentViewSet, basename="shipment")

urlpatterns = [
    path("carriers/", carrier_list, name="carrier-list"),
    path("shipping/quote/", quote, name="shipping-quote"),
    path("shipping/webhooks/<slug:carrier_code>/", carrier_webhook, name="carrier-webhook"),
] + router.urls
