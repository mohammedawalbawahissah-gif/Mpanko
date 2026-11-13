import pytest

from apps.accounts.models import Role, User
from apps.catalog.models import ProductStatus

from .conftest import client_for, make_product

pytestmark = pytest.mark.django_db


def test_register_login_and_me(api):
    r = api.post("/api/v1/auth/register/", {"email": "New@Example.com", "password": "Str0ng-pass-123", "full_name": "New Buyer", "accept_terms": True}, format="json")
    assert r.status_code == 201
    login = api.post("/api/v1/auth/login/", {"email": "new@example.com", "password": "Str0ng-pass-123"}, format="json")
    assert login.status_code == 200 and login.data["user"]["role"] == "customer"
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    assert api.get("/api/v1/auth/me/").data["email"] == "new@example.com"


def test_registration_cannot_grant_staff_role(api):
    r = api.post("/api/v1/auth/register/", {"email": "evil@example.com", "password": "Str0ng-pass-123", "role": "super_admin", "accept_terms": True}, format="json")
    assert r.status_code == 201
    assert User.objects.get(email="evil@example.com").role == Role.CUSTOMER


def test_weak_and_duplicate_registration_rejected(api, customer):
    assert api.post("/api/v1/auth/register/", {"email": "x@example.com", "password": "12345678"}, format="json").status_code == 400
    assert api.post("/api/v1/auth/register/", {"email": customer.email, "password": "Str0ng-pass-123"}, format="json").status_code == 400


def test_refresh_token_rotation_and_logout_blacklists(api, customer):
    login = api.post("/api/v1/auth/login/", {"email": customer.email, "password": "Str0ng-pass-123"}, format="json")
    old = login.data["refresh"]
    new = api.post("/api/v1/auth/refresh/", {"refresh": old}, format="json")
    assert new.status_code == 200 and new.data["refresh"] != old
    assert api.post("/api/v1/auth/refresh/", {"refresh": old}, format="json").status_code == 401  # rotated token is dead


def test_customer_sees_only_published_products(api, customer):
    make_product("Visible", status=ProductStatus.PUBLISHED)
    make_product("Hidden draft", status=ProductStatus.DRAFT)
    names = [p["name"] for p in api.get("/api/v1/products/").data["results"]]
    assert names == ["Visible"]


def test_only_catalog_managers_can_write_products(api, customer, admin):
    payload = {"name": "Shea Butter", "base_price": "12.00", "currency": "USD", "status": "published", "variants": [{"sku": "SHEA-1", "name": "250g"}]}
    assert client_for(customer).post("/api/v1/products/", payload, format="json").status_code == 403
    assert api.post("/api/v1/products/", payload, format="json").status_code == 401
    r = client_for(admin).post("/api/v1/products/", payload, format="json")
    assert r.status_code == 201 and r.data["slug"] == "shea-butter"
    assert api.get("/api/v1/products/shea-butter/").status_code == 200


def test_search_and_filter(api):
    make_product("Kente Scarf", price="50.00")
    make_product("Shea Butter", price="12.00")
    assert [p["name"] for p in api.get("/api/v1/products/?search=shea").data["results"]] == ["Shea Butter"]
    assert [p["name"] for p in api.get("/api/v1/products/?max_price=20").data["results"]] == ["Shea Butter"]


def test_stock_adjustment_is_audited_and_never_negative(admin):
    _, variant = make_product(stock=5)
    c = client_for(admin)
    assert c.post(f"/api/v1/inventory/{variant.id}/adjust/", {"delta": 10, "reason": "restock"}, format="json").data["quantity"] == 15
    assert c.post(f"/api/v1/inventory/{variant.id}/adjust/", {"delta": -100, "reason": "adjustment"}, format="json").status_code == 400
    moves = c.get(f"/api/v1/inventory/{variant.id}/movements/").data
    assert len(moves) == 1 and moves[0]["actor_email"] == admin.email


def test_customers_cannot_see_exact_stock(api, admin):
    product, _ = make_product(stock=7)
    public = api.get(f"/api/v1/products/{product.slug}/").data["variants"][0]
    assert public["in_stock"] is True and public["quantity"] is None
    assert client_for(admin).get(f"/api/v1/products/{product.slug}/").data["variants"][0]["quantity"] == 7


def test_delete_archives_instead_of_removing(admin):
    product, _ = make_product()
    assert client_for(admin).delete(f"/api/v1/products/{product.slug}/").status_code == 204
    product.refresh_from_db()
    assert product.status == ProductStatus.ARCHIVED


def test_addresses_are_private(customer, other_customer, address):
    assert client_for(other_customer).get("/api/v1/auth/addresses/").data["results"] == []
    assert client_for(other_customer).get(f"/api/v1/auth/addresses/{address.id}/").status_code == 404
    bad = client_for(customer).post("/api/v1/auth/addresses/", {"recipient_name": "A", "phone": "1", "line1": "x", "city": "y", "country": "GHA"}, format="json")
    assert bad.status_code == 400
