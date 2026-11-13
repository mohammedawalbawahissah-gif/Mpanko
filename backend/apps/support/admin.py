from django.contrib import admin

from .models import ReturnItem, ReturnRequest, SupportCase, SupportMessage


class ReturnItemInline(admin.TabularInline):
    model = ReturnItem
    extra = 0


@admin.register(ReturnRequest)
class ReturnRequestAdmin(admin.ModelAdmin):
    list_display = ("number", "order", "status", "reason", "created_at")
    list_filter = ("status", "reason")
    inlines = [ReturnItemInline]


class MessageInline(admin.TabularInline):
    model = SupportMessage
    extra = 0


@admin.register(SupportCase)
class SupportCaseAdmin(admin.ModelAdmin):
    list_display = ("number", "subject", "status", "updated_at")
    list_filter = ("status",)
    inlines = [MessageInline]
