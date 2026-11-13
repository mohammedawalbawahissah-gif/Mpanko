from django.contrib import admin

from .models import EmailTemplate, NotificationLog

admin.site.register(EmailTemplate)


@admin.register(NotificationLog)
class NotificationLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "key", "recipient", "status", "ref")
    list_filter = ("status", "key")
