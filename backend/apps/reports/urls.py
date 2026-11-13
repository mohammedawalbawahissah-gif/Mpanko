from django.urls import path

from . import views

urlpatterns = [
    path("dashboard/", views.DashboardView.as_view(), name="report-dashboard"),
    path("sales/", views.SalesReport.as_view(), name="report-sales"),
    path("orders/", views.OrdersReport.as_view(), name="report-orders"),
    path("payments/", views.PaymentsReport.as_view(), name="report-payments"),
    path("refunds/", views.RefundsReport.as_view(), name="report-refunds"),
    path("stock/", views.StockReport.as_view(), name="report-stock"),
    path("shipping/", views.ShippingReport.as_view(), name="report-shipping"),
]
