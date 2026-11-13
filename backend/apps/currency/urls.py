from django.urls import path

from .views import RatesView

urlpatterns = [path("rates/", RatesView.as_view(), name="currency-rates")]
