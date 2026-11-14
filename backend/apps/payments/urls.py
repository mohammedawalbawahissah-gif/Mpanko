from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ConfirmManualView, DisputeViewSet, GuestInitiateView, GuestVerifyView, InitiateView, ManualPaymentsView, MethodsView, ReconciliationDetailView, ReconciliationResolveView, ReconciliationRunView, RefundView,
    VerifyView, WebhookView,
)

router = DefaultRouter()
router.register("disputes", DisputeViewSet, basename="dispute")

urlpatterns = [
    path("methods/", MethodsView.as_view(), name="payment-methods"),
    path("initiate/", InitiateView.as_view(), name="payment-initiate"),
    path("guest/initiate/", GuestInitiateView.as_view(), name="payment-guest-initiate"),
    path("guest/verify/<str:reference>/", GuestVerifyView.as_view(), name="payment-guest-verify"),
    path("verify/<str:reference>/", VerifyView.as_view(), name="payment-verify"),
    path("webhooks/<str:provider>/", WebhookView.as_view(), name="payment-webhook"),
    path("manual/", ManualPaymentsView.as_view(), name="payment-manual-list"),
    path("manual/<str:reference>/confirm/", ConfirmManualView.as_view(), name="payment-manual-confirm"),
    path("refunds/", RefundView.as_view(), name="payment-refund"),
    path("reconciliation/", ReconciliationRunView.as_view(), name="reconciliation-runs"),
    path("reconciliation/<int:run_id>/", ReconciliationDetailView.as_view(), name="reconciliation-detail"),
    path("reconciliation/records/<int:record_id>/resolve/", ReconciliationResolveView.as_view(), name="reconciliation-resolve"),
]
urlpatterns += router.urls
