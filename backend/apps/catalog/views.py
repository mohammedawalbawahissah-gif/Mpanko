from django.db.models import F
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.models import AuditLog
from apps.accounts.permissions import CatalogManager, ReadOnlyOrCatalogManager

from .models import (
    Category, Inventory, OutOfStock, Product, ProductImage, ProductStatus, ProductVariant, adjust_stock,
)
MAX_IMAGES = 10

from .serializers import (
    CategorySerializer, ProductImageSerializer, ProductSerializer, StockAdjustSerializer,
    StockMovementSerializer, StaffVariantSerializer, VariantSerializer,
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

    @action(detail=True, methods=["post"], permission_classes=[CatalogManager], url_path="images",
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def add_image(self, request, slug=None):
        product = self.get_object()
        if product.images.count() >= MAX_IMAGES:
            raise ValidationError({"image": f"A product can have at most {MAX_IMAGES} images."})
        serializer = ProductImageSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(product=product, position=product.images.count())
        AuditLog.record(request.user, "product.image_add", product)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch", "delete"], permission_classes=[CatalogManager], url_path=r"images/(?P<image_id>\d+)")
    def image_detail(self, request, slug=None, image_id=None):
        product = self.get_object()
        image = product.images.filter(pk=image_id).first()
        if not image:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.method == "DELETE":
            image.image.delete(save=False)
            image.delete()
            AuditLog.record(request.user, "product.image_delete", product)
            return Response(status=status.HTTP_204_NO_CONTENT)
        for field in ("alt_text", "position"):
            if field in request.data:
                setattr(image, field, request.data[field])
        image.save()
        return Response(ProductImageSerializer(image, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[CatalogManager], url_path="variants")
    def add_variant(self, request, slug=None):
        product = self.get_object()
        serializer = VariantSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        variant = serializer.save(product=product)
        Inventory.objects.get_or_create(variant=variant)
        return Response(VariantSerializer(variant, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch", "delete"], permission_classes=[CatalogManager], url_path=r"variants/(?P<variant_id>\d+)")
    def variant_detail(self, request, slug=None, variant_id=None):
        """Edit a variant (name, options, price override, on/off). DELETE turns it off rather than erasing it, so past orders keep their link."""
        product = self.get_object()
        variant = product.variants.filter(pk=variant_id).first()
        if not variant:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.method == "DELETE":
            if product.variants.filter(is_active=True).exclude(pk=variant.pk).count() == 0 and product.status == ProductStatus.PUBLISHED:
                raise ValidationError({"detail": "A published product needs at least one active variant. Unpublish it first."})
            variant.is_active = False
            variant.save(update_fields=["is_active"])
            AuditLog.record(request.user, "variant.deactivate", variant)
            return Response(VariantSerializer(variant, context={"request": request}).data)
        serializer = VariantSerializer(variant, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        AuditLog.record(request.user, "variant.update", variant, fields=sorted(request.data.keys()))
        return Response(serializer.data)


class InventoryViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Staff-only stock management: low-stock list, adjustments and movement history."""

    permission_classes = [CatalogManager]
    serializer_class = StaffVariantSerializer

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

    @action(detail=True, methods=["patch"], url_path="threshold")
    def threshold(self, request, pk=None):
        """Set the stock level at which staff are alerted for this variant."""
        inv = Inventory.objects.filter(variant_id=pk).first()
        if not inv:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            level = int(request.data.get("low_stock_threshold"))
        except (TypeError, ValueError):
            raise ValidationError({"low_stock_threshold": "Enter a whole number, 0 or more."})
        if level < 0:
            raise ValidationError({"low_stock_threshold": "Enter a whole number, 0 or more."})
        inv.low_stock_threshold = level
        inv.save(update_fields=["low_stock_threshold"])
        AuditLog.record(request.user, "stock.threshold", inv.variant, level=level)
        return Response({"sku": inv.variant.sku, "low_stock_threshold": level, "is_low": inv.is_low})

    @action(detail=True, methods=["get"], url_path="movements")
    def movements(self, request, pk=None):
        qs = ProductVariant.objects.get(pk=pk).movements.select_related("actor")[:200]
        return Response(StockMovementSerializer(qs, many=True).data)
