"""Product types, made-to-order, pickup locations, launch countries and WhatsApp config."""
import pytest

from apps.catalog.models import Inventory, ProductType, StockMovement, adjust_stock
from apps.shipping.models import PickupLocation
from apps.shipping.providers import blocked_reason

pytestmark = pytest.mark.django_db


def test_product_types_are_seeded():
    assert ProductType.objects.filter(slug="food").exists() or ProductType.objects.count() >= 5


def test_product_type_restriction_blocks_country(product):
    p, _ = product
    t = ProductType.objects.create(name="Liquids test", restricted_countries=["DE"])
    p.product_type = t
    p.save()
    assert p.can_ship_to("DE") is False and p.can_ship_to("US") is True


def test_made_to_order_never_touches_stock(product):
    p, variant = product
    p.made_to_order, p.lead_time_days = True, 10
    p.save()
    inv = Inventory.objects.get(variant=variant)
    before = inv.quantity
    n = StockMovement.objects.count()
    adjust_stock(variant.id, -1, StockMovement.Reason.ORDER)
    inv.refresh_from_db()
    assert inv.quantity == before and StockMovement.objects.count() == n


def test_normal_product_still_reserves_stock(product):
    _, variant = product
    inv = Inventory.objects.get(variant=variant)
    before = inv.quantity
    adjust_stock(variant.id, -1, StockMovement.Reason.ORDER)
    inv.refresh_from_db()
    assert inv.quantity == before - 1


def test_launch_countries_block_others(settings):
    settings.LAUNCH_COUNTRIES = ["US", "GH"]
    assert blocked_reason("GH") is None or "deliver" not in (blocked_reason("GH") or "")
    assert "don't deliver" in blocked_reason("FR")
    settings.LAUNCH_COUNTRIES = []
    assert "don't deliver to this country yet" not in (blocked_reason("FR") or "")


def test_single_default_pickup_location():
    a = PickupLocation.objects.create(name="A", line1="1", city="Tamale", is_default=True)
    b = PickupLocation.objects.create(name="B", line1="2", city="Accra", is_default=True)
    a.refresh_from_db()
    assert b.is_default and not a.is_default


def test_origin_uses_default_pickup():
    from apps.shipping.carriers import origin

    PickupLocation.objects.create(name="Tamale", line1="1 Main", city="Tamale", is_default=True)
    assert origin()["city"] == "Tamale"


def test_config_exposes_whatsapp_and_launch_countries(api, settings):
    settings.WHATSAPP_SUPPORT_NUMBER, settings.LAUNCH_COUNTRIES = "233241234567", ["US"]
    d = api.get("/api/v1/config/").data
    assert d["whatsapp_number"] == "233241234567" and d["launch_countries"] == ["US"]


def test_address_rules_offer_region_lists(api):
    gh = api.get("/api/v1/auth/address-rules/?country=GH").data
    assert "Northern" in gh["regions"] and len(gh["regions"]) == 16
    us = api.get("/api/v1/auth/address-rules/?country=US").data["regions"]
    assert "Texas" in us and "District of Columbia" in us
    assert "Northern Ireland" in api.get("/api/v1/auth/address-rules/?country=GB").data["regions"]
    assert api.get("/api/v1/auth/address-rules/?country=FJ").data["regions"] == []  # no clean list: shopper types it
