from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, InventoryViewSet, ProductViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("inventory", InventoryViewSet, basename="inventory")

urlpatterns = router.urls
