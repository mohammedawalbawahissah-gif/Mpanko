from django.urls import path

from .views import (
    InitiateView, MethodsView, ReconciliationDetailView, ReconciliationResolveView, ReconciliationRunView, RefundView,
    VerifyView, WebhookView,
)

urlpatterns = [
    path("methods/", MethodsView.as_view(), name="payment-methods"),
    path("initiate/", InitiateView.as_view(), name="payment-initiate"),
    path("verify/<str:reference>/", VerifyView.as_view(), name="payment-verify"),
    path("webhooks/<str:provider>/", WebhookView.as_view(), name="payment-webhook"),
    path("refunds/", RefundView.as_view(), name="payment-refund"),
    path("reconciliation/", ReconciliationRunView.as_view(), name="reconciliation-runs"),
    path("reconciliation/<int:run_id>/", ReconciliationDetailView.as_view(), name="reconciliation-detail"),
    path("reconciliation/records/<int:record_id>/resolve/", ReconciliationResolveView.as_view(), name="reconciliation-resolve"),
]
