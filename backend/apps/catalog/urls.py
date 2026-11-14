from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, InventoryViewSet, ProductTypeViewSet, ProductViewSet

router = DefaultRouter()
router.register("product-types", ProductTypeViewSet, basename="product-type")
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("inventory", InventoryViewSet, basename="inventory")

urlpatterns = router.urls
