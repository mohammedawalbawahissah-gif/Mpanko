from django.contrib import admin

from .models import Business, ContactMessage, SiteProfile, SupportContact

admin.site.register(SiteProfile)
admin.site.register(Business)
admin.site.register(ContactMessage)
admin.site.register(SupportContact)
