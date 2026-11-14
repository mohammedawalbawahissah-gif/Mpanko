from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import BusinessManageViewSet, ContactView, MessageManageViewSet, ProfileManageView, PublicBusinessView, SiteView

router = DefaultRouter()
router.register("corporate/manage/businesses", BusinessManageViewSet, basename="corporate-business")
router.register("corporate/manage/messages", MessageManageViewSet, basename="corporate-message")

urlpatterns = [
    path("corporate/site/", SiteView.as_view(), name="corporate-site"),
    path("corporate/businesses/<slug:slug>/", PublicBusinessView.as_view(), name="corporate-business-public"),
    path("corporate/contact/", ContactView.as_view(), name="corporate-contact"),
    path("corporate/manage/profile/", ProfileManageView.as_view(), name="corporate-profile"),
] + router.urls
