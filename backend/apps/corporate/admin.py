from django.contrib import admin

from .models import Business, ContactMessage, SiteProfile

admin.site.register(SiteProfile)
admin.site.register(Business)
admin.site.register(ContactMessage)
