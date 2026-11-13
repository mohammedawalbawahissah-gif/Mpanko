from decimal import Decimal

import pytest
from django.utils import timezone

from apps.currency import catalog
from apps.currency.models import ExchangeRate
from apps.currency.services import refresh_if_stale, refresh_live_rates
from apps.orders import pricing

from .conftest import client_for, make_product, place_order
from .test_fx_carriers import FakeResponse

pytestmark = pytest.mark.django_db


def test_catalog_covers_the_world():
    assert len(catalog.CURRENCIES) >= 150
    for code in ["USD", "EUR", "GBP", "JPY", "GHS", "NGN", "ZAR", "INR", "CNY", "BRL", "KWD", "CHF", "AUD", "CAD", "XOF"]:
        assert catalog.known(code)
    assert catalog.name("JPY") == "Japanese yen"
    assert catalog.digits("JPY") == 0 and catalog.digits("USD") == 2 and catalog.digits("KWD") == 2  # 3-digit currencies are stored to 2
    assert not catalog.known("XXX")


def test_all_means_every_currency(settings):
    settings.SUPPORTED_CURRENCIES = ["ALL"]
    assert set(catalog.supported()) == set(catalog.CURRENCIES)
    settings.SUPPORTED_CURRENCIES = ["usd", "eur"]
    assert catalog.supported() == ["USD", "EUR"]


def test_zero_decimal_currencies_round_to_whole_units(settings):
    settings.MANUAL_FX_RATES = {"GHS": "10", "JPY": "150.5"}
    assert pricing.convert("10.00", "USD", "JPY") == Decimal("1505")
    assert pricing.convert("10.01", "USD", "JPY") == Decimal("1507")  # 1506.5 rounds up
    assert pricing.convert("10.00", "USD", "GHS") == Decimal("100.00")


def test_live_refresh_stores_every_supported_currency(settings, monkeypatch):
    settings.SUPPORTED_CURRENCIES = ["ALL"]
    feed = {"result": "success", "rates": {"USD": 1, "EUR": 0.9, "JPY": 150.2, "NGN": 1500, "NOPE": 3}}
    monkeypatch.setattr("apps.currency.services.requests.get", lambda *a, **k: FakeResponse(feed))
    assert refresh_live_rates() == 3  # EUR, JPY, NGN; USD is the base and NOPE is not a currency we list
    assert ExchangeRate.objects.filter(quote="JPY").exists()


def test_rates_endpoint_lists_all_currencies_with_names_and_chargeable(api, settings):
    settings.SUPPORTED_CURRENCIES = ["ALL"]
    ExchangeRate.objects.create(base="USD", quote="JPY", rate="150", source="live", fetched_at=timezone.now())
    ExchangeRate.objects.create(base="USD", quote="EUR", rate="0.9", source="live", fetched_at=timezone.now())
    r = api.get("/api/v1/currency/rates/")
    assert r.status_code == 200
    assert {"USD", "GHS", "JPY", "EUR"} <= set(r.data["currencies"])
    assert r.data["names"]["JPY"] == "Japanese yen"
    assert "JPY" not in r.data["chargeable"] and {"USD", "GHS", "EUR"} <= set(r.data["chargeable"])
    assert "AUD" not in r.data["currencies"]  # no rate held, so it can't be priced


def test_lazy_refresh_runs_once_when_rates_are_stale(settings, monkeypatch):
    settings.FX_AUTO_REFRESH = True
    calls = []
    monkeypatch.setattr("apps.currency.services.refresh_live_rates", lambda: calls.append(1) or 0)
    refresh_if_stale()
    refresh_if_stale()
    assert calls == [1]


def test_checkout_in_unchargeable_currency_is_refused_with_choices(customer, address, product, settings):
    settings.SUPPORTED_CURRENCIES = ["ALL"]
    ExchangeRate.objects.create(base="USD", quote="JPY", rate="150", source="live", fetched_at=timezone.now())
    _, variant = product
    c, r = place_order(customer, variant, address, currency="JPY")
    assert r.status_code == 400 and "Choose one of" in str(r.data)


def test_profile_accepts_any_world_currency(customer, settings):
    settings.SUPPORTED_CURRENCIES = ["ALL"]
    r = client_for(customer).patch("/api/v1/auth/me/", {"preferred_currency": "jpy"}, format="json")
    assert r.status_code == 200 and r.data["preferred_currency"] == "JPY"
