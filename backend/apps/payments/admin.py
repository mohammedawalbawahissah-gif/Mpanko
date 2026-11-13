from django.contrib import admin

from .models import PaymentAttempt, Refund, WebhookEvent


@admin.register(PaymentAttempt)
class PaymentAttemptAdmin(admin.ModelAdmin):
    list_display = ("reference", "order", "provider", "amount", "currency", "status", "created_at")
    list_filter = ("provider", "status")
    search_fields = ("reference", "order__number")
    readonly_fields = [f.name for f in PaymentAttempt._meta.fields]


admin.site.register(WebhookEvent)
admin.site.register(Refund)
