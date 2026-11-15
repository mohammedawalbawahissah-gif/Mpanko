from django.contrib import admin

from .models import Business, ContactMessage, GalleryImage, SitePage, SiteProfile, SupportContact

admin.site.register(SiteProfile)
admin.site.register(Business)
admin.site.register(SitePage)
admin.site.register(GalleryImage)
admin.site.register(ContactMessage)
admin.site.register(SupportContact)
