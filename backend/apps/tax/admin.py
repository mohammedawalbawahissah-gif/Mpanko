from django.contrib import admin

from .models import DutyRule, TaxRule

admin.site.register(TaxRule)
admin.site.register(DutyRule)
