from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views, views_prefs

router = DefaultRouter()
router.register("inbox", views.InboxViewSet, basename="inbox")
router.register("campaigns", views_prefs.CampaignViewSet, basename="campaign")

urlpatterns = [
    path("", include(router.urls)),
    path("web-push/key/", views.web_push_key, name="web-push-key"),
    path("web-push/", views.web_push, name="web-push"),
    path("templates/", views.template_list, name="notification-templates"),
    path("templates/<slug:key>/", views.template_detail, name="notification-template"),
    path("templates/<slug:key>/test/", views.template_test, name="notification-template-test"),
    path("devices/", views.device, name="push-device"),
    path("logs/", views.log_list, name="notification-logs"),
    path("preferences/", views_prefs.my_preferences, name="notification-preferences"),
    path("unsubscribe/", views_prefs.unsubscribe, name="notification-unsubscribe"),
    path("stock-alerts/", views_prefs.stock_alerts, name="stock-alerts"),
    path("audience/", views_prefs.audience_summary, name="notification-audience"),
]
