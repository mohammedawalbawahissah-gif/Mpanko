import pytest

from tests.conftest import client_for, make_user

pytestmark = pytest.mark.django_db


def _emails(resp):
    return {c["email"] for c in resp.json()["results"]}


def test_search_in_limits_the_field(admin):
    a = make_user("ama@example.com")
    a.full_name = "Kojo"
    a.save()
    k = make_user("kojo@example.com")
    k.full_name = "Ama"
    k.save()
    c = client_for(admin)
    assert _emails(c.get("/api/v1/customers/?search=kojo")) == {"ama@example.com", "kojo@example.com"}
    assert _emails(c.get("/api/v1/customers/?search=kojo&search_in=full_name")) == {"ama@example.com"}
    assert _emails(c.get("/api/v1/customers/?search=kojo&search_in=email")) == {"kojo@example.com"}


def test_unknown_field_searches_everything(admin):
    a = make_user("ama@example.com")
    a.full_name = "Kojo"
    a.save()
    r = client_for(admin).get("/api/v1/customers/?search=kojo&search_in=password")
    assert _emails(r) == {"ama@example.com"}


def test_customers_and_activity_log_can_be_sorted(admin):
    from apps.accounts.models import AuditLog

    a = make_user("a@example.com")
    b = make_user("b@example.com")
    c = client_for(admin)
    new_first = [x["email"] for x in c.get("/api/v1/customers/?ordering=-date_joined").json()["results"]]
    old_first = [x["email"] for x in c.get("/api/v1/customers/?ordering=date_joined").json()["results"]]
    assert new_first == list(reversed(old_first)) and {"a@example.com", "b@example.com"} <= set(new_first)
    AuditLog.objects.create(actor=admin, action="zeta.run", object_type="thing", object_id="1")
    AuditLog.objects.create(actor=admin, action="alpha.run", object_type="thing", object_id="2")
    az = [x["action"] for x in c.get("/api/v1/audit/?ordering=action").json()["results"]]
    assert az == sorted(az) and az[0] == "alpha.run"
    za = [x["action"] for x in c.get("/api/v1/audit/?ordering=-action").json()["results"]]
    assert za == sorted(za, reverse=True)
    assert a and b
