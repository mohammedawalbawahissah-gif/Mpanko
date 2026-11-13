from django.urls import path

from . import views

urlpatterns = [
    path("templates/", views.template_list, name="notification-templates"),
    path("templates/<slug:key>/", views.template_detail, name="notification-template"),
    path("templates/<slug:key>/test/", views.template_test, name="notification-template-test"),
    path("devices/", views.device, name="push-device"),
    path("logs/", views.log_list, name="notification-logs"),
]
