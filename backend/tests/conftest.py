import json

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Address, Role, User
from apps.catalog.models import Category, Inventory, Product, ProductStatus, ProductVariant


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.DEBUG = True
    settings.PAYMENT_PROVIDERS_ENABLED = ["mock"]
    settings.BASE_CURRENCY = "USD"
    settings.SUPPORTED_CURRENCIES = ["USD", "GHS"]
    settings.MANUAL_FX_RATES = {"GHS": "10"}
    settings.SHIPPING_FLAT_RATE = "30.00"
    settings.TAX_RATE = "0"
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": ()}


@pytest.fixture(autouse=True)
def _clear_cache():
    """Login throttling lives in the cache; start every test with a clean slate."""
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api():
    return APIClient()


def make_user(email, role=Role.CUSTOMER, password="Str0ng-pass-123"):
    return User.objects.create_user(email=email, password=password, role=role)


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def customer():
    return make_user("buyer@example.com")


@pytest.fixture
def other_customer():
    return make_user("other@example.com")


@pytest.fixture
def admin():
    return make_user("admin@example.com", Role.STORE_ADMIN)


@pytest.fixture
def finance():
    return make_user("finance@example.com", Role.FINANCE)


@pytest.fixture
def fulfillment():
    return make_user("ship@example.com", Role.FULFILLMENT)


@pytest.fixture
def address(customer):
    return Address.objects.create(
        user=customer, recipient_name="Ama Mensah", phone="+233200000000", line1="12 Market Rd",
        city="Tamale", region="Northern", country="GH", is_default=True,
    )


@pytest.fixture
def us_address(customer):
    return Address.objects.create(
        user=customer, recipient_name="Ama Mensah", phone="+12025550100", line1="1 Main St",
        city="Austin", region="TX", postal_code="73301", country="US",
    )


def make_product(name="Kente Scarf", price="50.00", stock=10, status=ProductStatus.PUBLISHED, restricted=None):
    category, _ = Category.objects.get_or_create(name="Textiles")
    product = Product.objects.create(
        name=name, category=category, base_price=price, currency="USD", status=status,
        origin_country="GH", restricted_countries=restricted or [], weight_grams=300,
    )
    variant = ProductVariant.objects.create(product=product, sku=f"SKU-{product.pk}", name="Default")
    Inventory.objects.create(variant=variant, quantity=stock)
    return product, variant


@pytest.fixture
def product():
    return make_product()


def signed_mock_webhook(client, reference, status="succeeded", amount=None, currency=None, event_id="evt-1"):
    from apps.payments.providers import MockProvider

    body = {"event_id": event_id, "reference": reference, "status": status}
    if amount is not None:
        body["amount"] = str(amount)
    if currency:
        body["currency"] = currency
    raw = json.dumps(body).encode()
    return client.post(
        "/api/v1/payments/webhooks/mock/", data=raw, content_type="application/json",
        HTTP_X_MOCK_SIGNATURE=MockProvider.sign(raw),
    )


def place_order(user, variant, address, qty=1, currency="USD", service=None, key="key-1"):
    service = service or ("local-standard" if address.country == "GH" else "intl-standard")
    c = client_for(user)
    c.post("/api/v1/cart/items/", {"variant": variant.id, "quantity": qty}, format="json")
    return c, c.post(
        "/api/v1/checkout/", {"address_id": address.id, "shipping_service": service, "currency": currency},
        format="json", HTTP_IDEMPOTENCY_KEY=key,
    )
