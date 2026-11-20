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


def test_store_admin_can_confirm_a_staff_phone_without_sms(admin):
    from apps.notifications.preferences import channel_available
    from apps.accounts.models import Role

    staff = make_user("ship@example.com", Role.FULFILLMENT)
    c = client_for(admin)
    r = c.post(f"/api/v1/staff/{staff.id}/phone/", {"phone": "0240000000"}, format="json")
    assert r.status_code == 200, r.content
    staff.refresh_from_db()
    assert staff.phone == "+233240000000" and staff.phone_verified
    assert channel_available(staff, "whatsapp")
    assert c.post(f"/api/v1/staff/{staff.id}/phone/", {"phone": "abc"}, format="json").status_code == 400
    assert c.post(f"/api/v1/staff/{staff.id}/phone/", {"phone": ""}, format="json").status_code == 200
    staff.refresh_from_db()
    assert staff.phone == "" and not staff.phone_verified


def test_staff_phone_cannot_steal_a_confirmed_number_or_edit_an_admin(admin):
    from apps.accounts.models import Role

    owner = make_user("owner@example.com", Role.SUPER_ADMIN)
    taken = make_user("buyer2@example.com")
    taken.phone, taken.phone_verified = "+233240000001", True
    taken.save()
    staff = make_user("fin@example.com", Role.FINANCE)
    c = client_for(admin)
    assert c.post(f"/api/v1/staff/{staff.id}/phone/", {"phone": "+233240000001"}, format="json").status_code == 400
    assert c.post(f"/api/v1/staff/{owner.id}/phone/", {"phone": "+233240000002"}, format="json").status_code == 403
    assert client_for(owner).post(f"/api/v1/staff/{admin.id}/phone/", {"phone": "+233240000003"}, format="json").status_code == 200
    mine = client_for(admin).post(f"/api/v1/staff/{admin.id}/phone/", {"phone": "+233240000004"}, format="json")
    assert mine.status_code == 200
