from django.contrib import admin
from django.utils import timezone

from .models import ExchangeRate


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ("base", "quote", "rate", "source", "fetched_at")
    list_filter = ("source", "quote")

    def save_model(self, request, obj, form, change):
        if not obj.fetched_at:
            obj.fetched_at = timezone.now()
        super().save_model(request, obj, form, change)
