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
