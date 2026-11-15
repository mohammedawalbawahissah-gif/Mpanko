from django.urls import path
from rest_framework.routers import DefaultRouter

from .menu import MenuPricesView, MenuView
from .views import CategoryViewSet, InventoryViewSet, ProductTypeViewSet, ProductViewSet

router = DefaultRouter()
router.register("product-types", ProductTypeViewSet, basename="product-type")
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("inventory", InventoryViewSet, basename="inventory")

urlpatterns = [
    path("menu/<slug:slug>/", MenuView.as_view(), name="menu"),
    path("menu/<slug:slug>/prices/", MenuPricesView.as_view(), name="menu-prices"),
] + router.urls
