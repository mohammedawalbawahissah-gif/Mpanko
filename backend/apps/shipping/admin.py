from django.contrib import admin

from .models import Carrier, Shipment, TrackingEvent


class EventInline(admin.TabularInline):
    model = TrackingEvent
    extra = 0


@admin.register(Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "carrier", "tracking_number", "status")
    list_filter = ("status", "carrier")
    inlines = [EventInline]


admin.site.register(Carrier)
