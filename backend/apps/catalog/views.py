from django.db.models import F
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager, ReadOnlyOrCatalogManager

from .models import (
    Category, Inventory, OutOfStock, Product, ProductImage, ProductStatus, ProductVariant, adjust_stock,
)
from .serializers import (
    CategorySerializer, ProductImageSerializer, ProductSerializer, StockAdjustSerializer,
    StockMovementSerializer, VariantSerializer,
)


class ProductFilter(filters.FilterSet):
    category = filters.CharFilter(field_name="category__slug")
    min_price = filters.NumberFilter(field_name="base_price", lookup_expr="gte")
    max_price = filters.NumberFilter(field_name="base_price", lookup_expr="lte")
    origin = filters.CharFilter(field_name="origin_country", lookup_expr="iexact")

    class Meta:
        model = Product
        fields = ["category", "min_price", "max_price", "origin", "status"]


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [ReadOnlyOrCatalogManager]
    pagination_class = None

    def get_queryset(self):
        qs = Category.objects.all()
        if not (self.request.user.is_authenticated and self.request.user.is_staff_role):
            qs = qs.filter(is_active=True)
        return qs


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [ReadOnlyOrCatalogManager]
    lookup_field = "slug"
    filterset_class = ProductFilter
    search_fields = ["name", "description", "maker", "category__name"]
    ordering_fields = ["base_price", "created_at", "name"]

    def get_queryset(self):
        qs = Product.objects.select_related("category").prefetch_related("images", "variants__inventory")
        user = self.request.user
        if user.is_authenticated and user.is_staff_role:
            return qs
        return qs.filter(status=ProductStatus.PUBLISHED)  # customers only ever see published products

    def perform_create(self, serializer):
        product = serializer.save()
        AuditLog.record(self.request.user, "product.create", product)

    def perform_update(self, serializer):
        product = serializer.save()
        AuditLog.record(self.request.user, "product.update", product, status=product.status)

    def perform_destroy(self, instance):
        # Soft-archive instead of deleting so historical orders stay intact.
        instance.status = ProductStatus.ARCHIVED
        instance.save(update_fields=["status"])
        AuditLog.record(self.request.user, "product.archive", instance)

    @action(detail=True, methods=["post"], permission_classes=[CatalogManager], url_path="images")
    def add_image(self, request, slug=None):
        product = self.get_object()
        serializer = ProductImageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(product=product)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], permission_classes=[CatalogManager], url_path="variants")
    def add_variant(self, request, slug=None):
        product = self.get_object()
        serializer = VariantSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        variant = serializer.save(product=product)
        Inventory.objects.get_or_create(variant=variant)
        return Response(VariantSerializer(variant, context={"request": request}).data, status=status.HTTP_201_CREATED)


class InventoryViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Staff-only stock management: low-stock list, adjustments and movement history."""

    permission_classes = [CatalogManager]
    serializer_class = VariantSerializer

    def get_queryset(self):
        qs = ProductVariant.objects.select_related("product", "inventory")
        if self.request.query_params.get("low") in {"1", "true"}:
            qs = qs.filter(inventory__quantity__lte=F("inventory__low_stock_threshold"))
        return qs

    @action(detail=True, methods=["post"], url_path="adjust")
    def adjust(self, request, pk=None):
        variant = ProductVariant.objects.filter(pk=pk).first()
        if not variant:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        Inventory.objects.get_or_create(variant=variant)
        s = StockAdjustSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            inv = adjust_stock(
                variant.id, s.validated_data["delta"], s.validated_data["reason"],
                actor=request.user, note=s.validated_data.get("note", ""),
            )
        except OutOfStock:
            raise ValidationError({"delta": "Adjustment would make stock negative."})
        AuditLog.record(request.user, "stock.adjust", variant, delta=s.validated_data["delta"], new_quantity=inv.quantity)
        return Response({"sku": variant.sku, "quantity": inv.quantity})

    @action(detail=True, methods=["get"], url_path="movements")
    def movements(self, request, pk=None):
        qs = ProductVariant.objects.get(pk=pk).movements.select_related("actor")[:200]
        return Response(StockMovementSerializer(qs, many=True).data)
