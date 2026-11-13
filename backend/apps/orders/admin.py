from django.contrib import admin

from .models import Order, OrderItem, OrderStatusEvent


class ItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    can_delete = False
    readonly_fields = [f.name for f in OrderItem._meta.fields]


class EventInline(admin.TabularInline):
    model = OrderStatusEvent
    extra = 0
    can_delete = False
    readonly_fields = [f.name for f in OrderStatusEvent._meta.fields]


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("number", "user", "status", "currency", "grand_total", "created_at")
    list_filter = ("status", "currency")
    search_fields = ("number", "contact_email")
    inlines = [ItemInline, EventInline]
    # Status/totals are changed only through the state machine and verified payments, never by hand-editing.
    readonly_fields = [f.name for f in Order._meta.fields]
