from django.contrib import admin

from .models import Category, Inventory, Product, ProductImage, ProductVariant, StockMovement


class VariantInline(admin.TabularInline):
    model = ProductVariant
    extra = 0


class ImageInline(admin.TabularInline):
    model = ProductImage
    extra = 0


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "base_price", "currency", "status", "origin_country")
    list_filter = ("status", "category", "origin_country")
    search_fields = ("name", "maker")
    inlines = [VariantInline, ImageInline]


admin.site.register(Category)
admin.site.register(Inventory)


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("created_at", "variant", "delta", "reason", "actor")
    readonly_fields = [f.name for f in StockMovement._meta.fields]

    def has_add_permission(self, request):
        return False
