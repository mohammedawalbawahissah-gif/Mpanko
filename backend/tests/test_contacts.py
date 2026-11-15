"""The shop's contact list: several phones, WhatsApp numbers and emails, managed by staff and shown on every app."""
import pytest
from django.test import override_settings

from apps.accounts.models import AuditLog, Role
from apps.corporate.models import SupportContact
from tests.conftest import client_for, make_user

pytestmark = pytest.mark.django_db
URL = "/api/v1/corporate/manage/contacts/"


def manager():
    return client_for(make_user("shopadmin@example.com", role=Role.STORE_ADMIN))


def test_config_lists_every_active_contact_in_order(api):
    SupportContact.objects.create(kind="phone", label="Support", value="+233200000002", sort_order=2)
    SupportContact.objects.create(kind="phone", label="Sales", value="+233200000001", sort_order=1)
    SupportContact.objects.create(kind="whatsapp", value="233200000003")
    SupportContact.objects.create(kind="email", value="help@example.com")
    SupportContact.objects.create(kind="email", label="Hidden", value="old@example.com", is_active=False)
    data = api.get("/api/v1/config/").json()
    assert [(c["kind"], c["label"]) for c in data["contacts"]] == [("phone", "Sales"), ("phone", "Support"), ("whatsapp", ""), ("email", "")]
    assert {c["value"] for c in data["contacts"]} == {"+233200000001", "+233200000002", "233200000003", "help@example.com"}
    # the three single fields stay, for apps that have not updated: the first of each kind
    assert data["support_phone"] == "+233200000001"
    assert data["support_email"] == "help@example.com"
    assert data["whatsapp_number"] == "233200000003"


@override_settings(SUPPORT_PHONE_NUMBER="+233240000000", WHATSAPP_SUPPORT_NUMBER="", SUPPORT_EMAIL_ADDRESS="")
def test_the_single_settings_fill_in_for_a_kind_with_no_contacts(api):
    SupportContact.objects.create(kind="email", value="help@example.com")
    data = api.get("/api/v1/config/").json()
    assert {(c["kind"], c["value"]) for c in data["contacts"]} == {("email", "help@example.com"), ("phone", "+233240000000")}


@override_settings(SUPPORT_PHONE_NUMBER="+233240000000")
def test_a_contact_in_the_list_replaces_the_single_setting(api):
    SupportContact.objects.create(kind="phone", label="Sales", value="+233200000001")
    phones = [c for c in api.get("/api/v1/config/").json()["contacts"] if c["kind"] == "phone"]
    assert [p["value"] for p in phones] == ["+233200000001"]


def test_the_corporate_site_returns_the_same_list(api):
    SupportContact.objects.create(kind="whatsapp", label="Orders", value="233200000009")
    assert api.get("/api/v1/corporate/site/").json()["contacts"][0]["label"] == "Orders"


def test_staff_add_edit_and_remove_contacts_and_it_is_logged():
    c = manager()
    r = c.post(URL, {"kind": "phone", "label": "Sales", "value": "+233 20 000 0001"}, format="json")
    assert r.status_code == 201, r.content
    assert r.json()["value"] == "+233200000001"
    pk = r.json()["id"]
    assert c.patch(f"{URL}{pk}/", {"label": "Sales team"}, format="json").status_code == 200
    assert c.delete(f"{URL}{pk}/").status_code == 204
    assert AuditLog.objects.filter(action__startswith="corporate.contact.").count() == 3


@pytest.mark.parametrize("kind,value", [("phone", "abc"), ("phone", "12"), ("whatsapp", "not a number"), ("email", "nope"), ("email", "a@")])
def test_a_bad_value_is_refused_with_a_clear_message(kind, value):
    r = manager().post(URL, {"kind": kind, "value": value}, format="json")
    assert r.status_code == 400 and "value" in r.json()


def test_whatsapp_numbers_are_stored_as_digits_only():
    r = manager().post(URL, {"kind": "whatsapp", "value": "+233 (24) 000-0000"}, format="json")
    assert r.json()["value"] == "233240000000"


def test_a_second_contact_of_a_kind_needs_a_name():
    c = manager()
    assert c.post(URL, {"kind": "email", "value": "a@example.com"}, format="json").status_code == 201
    r = c.post(URL, {"kind": "email", "value": "b@example.com"}, format="json")
    assert r.status_code == 400 and "label" in r.json()
    assert c.post(URL, {"kind": "email", "label": "Sales", "value": "b@example.com"}, format="json").status_code == 201
    dup = c.post(URL, {"kind": "email", "label": "sales", "value": "c@example.com"}, format="json")
    assert dup.status_code == 400


def test_customers_and_visitors_cannot_manage_contacts(api, customer):
    assert api.get(URL).status_code in (401, 403)
    assert client_for(customer).post(URL, {"kind": "email", "value": "a@example.com"}, format="json").status_code == 403
