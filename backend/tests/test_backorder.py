"""FR-CAT-04: staff can let shoppers order out-of-stock items, with a wait time."""
import pytest

from .conftest import client_for, make_product, place_order

pytestmark = pytest.mark.django_db


def _variant_json(api, product):
    r = api.get(f"/api/v1/products/{product.slug}/")
    assert r.status_code == 200
    return r.json()["variants"][0]


def test_off_by_default_and_sold_out_is_not_orderable(api):
    product, variant = make_product(stock=0)
    v = _variant_json(api, product)
    assert v["in_stock"] is False
    assert v["on_backorder"] is False
    assert v["backorder_days"] is None


def test_switch_on_makes_it_orderable_with_wait_time(api, admin):
    product, variant = make_product(stock=0)
    c = client_for(admin)
    r = c.patch(f"/api/v1/inventory/{variant.id}/backorder/", {"allow_backorder": True, "backorder_days": 14}, format="json")
    assert r.status_code == 200, r.content
    v = _variant_json(api, product)
    assert v["in_stock"] is True
    assert v["on_backorder"] is True
    assert v["backorder_days"] == 14


def test_in_stock_item_is_not_shown_as_backorder(api, admin):
    product, variant = make_product(stock=5)
    client_for(admin).patch(f"/api/v1/inventory/{variant.id}/backorder/", {"allow_backorder": True, "backorder_days": 7}, format="json")
    v = _variant_json(api, product)
    assert v["in_stock"] is True
    assert v["on_backorder"] is False
    assert v["backorder_days"] is None


def test_turning_off_clears_the_wait_time(api, admin):
    product, variant = make_product(stock=0)
    c = client_for(admin)
    c.patch(f"/api/v1/inventory/{variant.id}/backorder/", {"allow_backorder": True, "backorder_days": 10}, format="json")
    c.patch(f"/api/v1/inventory/{variant.id}/backorder/", {"allow_backorder": False}, format="json")
    variant.inventory.refresh_from_db()
    assert variant.inventory.backorder_days is None
    assert _variant_json(api, product)["in_stock"] is False


@pytest.mark.parametrize("body", [{"allow_backorder": "yes"}, {"allow_backorder": True, "backorder_days": 0}, {"allow_backorder": True, "backorder_days": "soon"}, {"allow_backorder": True, "backorder_days": 400}])
def test_bad_input_is_rejected(admin, body):
    _, variant = make_product(stock=0)
    r = client_for(admin).patch(f"/api/v1/inventory/{variant.id}/backorder/", body, format="json")
    assert r.status_code == 400


def test_customers_cannot_change_it(customer):
    _, variant = make_product(stock=0)
    r = client_for(customer).patch(f"/api/v1/inventory/{variant.id}/backorder/", {"allow_backorder": True}, format="json")
    assert r.status_code == 403


def test_staff_list_shows_the_switch(admin):
    _, variant = make_product(stock=0)
    c = client_for(admin)
    c.patch(f"/api/v1/inventory/{variant.id}/backorder/", {"allow_backorder": True}, format="json")
    rows = c.get("/api/v1/inventory/").json()["results"]
    assert rows[0]["allow_backorder"] is True
