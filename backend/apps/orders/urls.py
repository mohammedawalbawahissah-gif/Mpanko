from django.urls import path
from rest_framework.routers import DefaultRouter

from .guest import GuestCheckoutView, GuestLookupView, GuestOrderView, PublicConfigView
from .views import CartItemViewSet, CartView, CheckoutView, OrderViewSet

router = DefaultRouter()
router.register("cart/items", CartItemViewSet, basename="cart-item")
router.register("orders", OrderViewSet, basename="order")

urlpatterns = [
    path("cart/", CartView.as_view(), name="cart"),
    path("checkout/", CheckoutView.as_view(), name="checkout"),
    path("checkout/guest/", GuestCheckoutView.as_view(), name="checkout-guest"),
    path("orders/guest/lookup/", GuestLookupView.as_view(), name="guest-order-lookup"),
    path("orders/guest/<str:number>/", GuestOrderView.as_view(), name="guest-order"),
    path("config/", PublicConfigView.as_view(), name="public-config"),
] + router.urls
