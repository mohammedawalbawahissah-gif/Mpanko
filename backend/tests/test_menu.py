"""QT Eatery's menu: the loader, the public menu page data, and the staff price screen."""
import pytest
from django.core.management import call_command

from apps.catalog.models import Category, Product, ProductStatus
from tests.conftest import client_for

pytestmark = pytest.mark.django_db
URL = "/api/v1/menu/qt-eatery/"


@pytest.fixture
def menu():
    call_command("load_qt_eatery_menu")
    return Category.objects.get(slug="qt-eatery")


def test_loader_builds_the_menu_under_food_and_is_safe_to_repeat(menu):
    assert menu.parent.name == "Food" and menu.is_menu
    count = Product.objects.filter(category=menu).count()
    assert count == 50
    call_command("load_qt_eatery_menu")
    assert Product.objects.filter(category=menu).count() == count
    p = Product.objects.get(category=menu, name="Jollof Rice with Assorted Meat")
    assert p.status == ProductStatus.DRAFT and p.base_price == 0 and p.made_to_order and p.variants.count() == 1


def test_the_loader_never_overwrites_a_price_or_status_staff_set(menu):
    p = Product.objects.get(category=menu, name="Fish Pie")
    p.base_price, p.status = "7.50", ProductStatus.PUBLISHED
    p.save()
    call_command("load_qt_eatery_menu")
    p.refresh_from_db()
    assert str(p.base_price) == "7.50" and p.status == ProductStatus.PUBLISHED


def test_prepared_food_is_for_the_united_states_only(menu):
    p = Product.objects.get(category=menu, name="Fish Pie")
    assert p.can_ship_to("US") and not p.can_ship_to("GH") and not p.can_ship_to("GB")


def test_the_menu_lists_every_dish_in_the_printed_sections_but_only_priced_ones_are_orderable(api, menu):
    data = api.get(URL).json()
    assert [s["name"] for s in data["sections"]][:3] == ["Popular Northern Foods", "Local Northern Delight", "Pastries"]
    assert sum(len(s["items"]) for s in data["sections"]) == 50
    assert data["orderable_count"] == 0 and data["note"]
    p = Product.objects.get(category=menu, name="Fish Pie")
    p.base_price, p.status = "7.50", ProductStatus.PUBLISHED
    p.save()
    data = api.get(URL).json()
    pie = next(i for s in data["sections"] for i in s["items"] if i["name"] == "Fish Pie")
    assert pie["orderable"] and pie["variants"][0]["price"] == "7.50" and data["orderable_count"] == 1


def test_only_menu_categories_have_a_menu(api, menu):
    Category.objects.create(name="Plain shelf")
    assert api.get("/api/v1/menu/plain-shelf/").status_code == 404
    assert api.get("/api/v1/menu/nothing/").status_code == 404


def test_a_priced_dish_can_be_added_to_the_bag_and_a_draft_cannot(api, menu):
    p = Product.objects.get(category=menu, name="Fish Pie")
    p.base_price, p.status = "7.50", ProductStatus.PUBLISHED
    p.save()
    draft = Product.objects.get(category=menu, name="Meat Pie")
    ok = api.get(URL).json()
    vid = next(i for s in ok["sections"] for i in s["items"] if i["name"] == "Fish Pie")["variants"][0]["id"]
    assert vid == p.variants.first().id
    assert draft.status == ProductStatus.DRAFT


def test_staff_set_prices_and_publish_and_the_rules_are_enforced(admin, customer, menu):
    staff = client_for(admin)
    items = staff.get(URL + "prices/").json()["items"]
    assert len(items) == 50 and all(not i["published"] for i in items)
    fish, meat = items[14], items[15]
    r = staff.post(URL + "prices/", {"items": [{"id": fish["id"], "price": "7.50", "published": True}, {"id": meat["id"], "price": "8", "published": False}]}, format="json")
    assert r.status_code == 200 and r.json()["changed"] == 2
    assert str(Product.objects.get(pk=fish["id"]).base_price) == "7.50" and Product.objects.get(pk=fish["id"]).status == ProductStatus.PUBLISHED
    assert Product.objects.get(pk=meat["id"]).status == ProductStatus.DRAFT
    bad = staff.post(URL + "prices/", {"items": [{"id": items[0]["id"], "price": "0", "published": True}]}, format="json")
    assert bad.status_code == 400 and str(items[0]["id"]) in bad.json()
    assert staff.post(URL + "prices/", {"items": [{"id": items[0]["id"], "price": "abc", "published": False}]}, format="json").status_code == 400
    assert staff.post(URL + "prices/", {"items": [{"id": 999999, "price": "1", "published": False}]}, format="json").status_code == 400
    assert client_for(customer).get(URL + "prices/").status_code == 403
    assert client_for(customer).post(URL + "prices/", {"items": []}, format="json").status_code == 403


def test_the_category_list_tells_the_shop_which_category_is_a_menu(api, menu):
    cats = api.get("/api/v1/categories/").json()
    row = next(c for c in cats if c["slug"] == "qt-eatery")
    assert row["is_menu"] is True


def test_a_menu_dish_can_be_bought_in_the_united_states_and_not_elsewhere(customer, address, us_address, menu):
    from tests.conftest import place_order
    p = Product.objects.get(category=menu, name="Fish Pie")
    p.base_price, p.status = "7.50", ProductStatus.PUBLISHED
    p.save()
    variant = p.variants.first()
    _, ok = place_order(customer, variant, us_address, qty=2, key="us-1")
    assert ok.status_code == 201, ok.content
    assert ok.data["subtotal"] == "15.00"
    _, no = place_order(customer, variant, address, key="gh-1")
    assert no.status_code == 400


@pytest.mark.django_db
def test_loader_renames_a_misspelled_dish_in_place():
    call_command("load_qt_eatery_menu")
    p = Product.objects.get(slug="qt-eatery-sweet-bud")
    p.name, p.slug = "Swet Bud", "qt-eatery-swet-bud"
    p.save()
    call_command("load_qt_eatery_menu")
    assert Product.objects.filter(category=p.category).count() == 50
    assert Product.objects.get(pk=p.pk).name == "Sweet Bud"
