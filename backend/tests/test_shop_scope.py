import pyotp
import pytest
from rest_framework.test import APIClient

from apps.accounts import mfa

from .conftest import client_for

pytestmark = pytest.mark.django_db
PW = "Str0ng-pass-123"


def enrol(staff):
    c = client_for(staff)
    secret = c.post("/api/v1/auth/mfa/setup/").data["secret"]
    c.post("/api/v1/auth/mfa/confirm/", {"code": pyotp.TOTP(secret).now()}, format="json")
    return secret


def bearer(tokens):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + tokens["access"])
    return c


def test_admin_login_still_needs_the_code(admin):
    enrol(admin)
    r = APIClient().post("/api/v1/auth/login/", {"email": admin.email, "password": PW}, format="json")
    assert r.data.get("mfa_required") and "access" not in r.data


def test_staff_can_shop_without_a_code(admin):
    enrol(admin)
    r = APIClient().post("/api/v1/auth/login/", {"email": admin.email, "password": PW, "scope": "shop"}, format="json")
    assert r.status_code == 200 and r.data["access"]


def test_shop_token_has_no_back_office_power(admin):
    enrol(admin)
    r = APIClient().post("/api/v1/auth/login/", {"email": admin.email, "password": PW, "scope": "shop"}, format="json")
    c = bearer(r.data)
    assert c.get("/api/v1/auth/me/").status_code == 200
    assert c.get("/api/v1/reports/dashboard/").status_code == 403
    assert c.post("/api/v1/auth/mfa/setup/").status_code == 403


def test_shop_token_stays_shop_after_refresh(admin):
    r = APIClient().post("/api/v1/auth/login/", {"email": admin.email, "password": PW, "scope": "shop"}, format="json")
    new = APIClient().post("/api/v1/auth/refresh/", {"refresh": r.data["refresh"]}, format="json")
    assert new.status_code == 200
    assert bearer(new.data).get("/api/v1/reports/dashboard/").status_code == 403


def test_normal_token_keeps_back_office_power(admin):
    r = APIClient().post("/api/v1/auth/login/", {"email": admin.email, "password": PW}, format="json")
    assert bearer(r.data).get("/api/v1/reports/dashboard/").status_code == 200


def test_wrong_password_still_fails_with_shop_scope(admin):
    r = APIClient().post("/api/v1/auth/login/", {"email": admin.email, "password": "nope", "scope": "shop"}, format="json")
    assert r.status_code == 401
