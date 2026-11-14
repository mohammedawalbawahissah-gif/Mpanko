"""The launch-day rehearsal command: it must pass on a healthy system, say which step broke, and leave nothing behind."""
import pytest
from django.core.management import call_command

from apps.catalog.models import Product
from apps.orders.models import Order
from apps.accounts.models import User

pytestmark = pytest.mark.django_db


def run(capsys, *args):
    try:
        call_command("rehearse", "--skip-preflight", *args)
        code = 0
    except SystemExit as e:
        code = e.code
    return code, capsys.readouterr().out


@pytest.fixture(autouse=True)
def hosts(settings):
    settings.ALLOWED_HOSTS = ["localhost"]
    settings.SECURE_SSL_REDIRECT = False


def test_guest_journey_passes_and_leaves_nothing_behind(capsys, settings):
    settings.GUEST_CHECKOUT_ENABLED = True
    code, out = run(capsys)
    assert code == 0, out
    assert "Every step passed" in out and "Nothing was saved." in out
    assert "refund issued" in out
    assert Order.objects.count() == 0 and Product.objects.count() == 0 and User.objects.count() == 0


def test_account_journey_when_guest_checkout_is_off(capsys, settings):
    settings.GUEST_CHECKOUT_ENABLED = False
    code, out = run(capsys)
    assert code == 0, out
    assert "temporary account" in out


def test_an_international_order_works(capsys, settings):
    settings.GUEST_CHECKOUT_ENABLED = True
    code, out = run(capsys, "--country", "US")
    assert code == 0, out


def test_keep_leaves_the_order_to_inspect(capsys, settings):
    settings.GUEST_CHECKOUT_ENABLED = True
    code, out = run(capsys, "--keep")
    assert code == 0, out
    order = Order.objects.get()
    assert order.status == "refunded"


def test_a_country_outside_the_launch_list_is_reported(capsys, settings):
    settings.GUEST_CHECKOUT_ENABLED = True
    settings.LAUNCH_COUNTRIES = ["GH"]
    code, out = run(capsys, "--country", "US")
    assert code == 1
    assert "FAIL  shipping quote" in out and "don't deliver" in out


def test_settings_are_put_back(capsys, settings):
    settings.GUEST_CHECKOUT_ENABLED = True
    before = list(settings.PAYMENT_PROVIDERS_ENABLED)
    run(capsys)
    assert list(settings.PAYMENT_PROVIDERS_ENABLED) == before
