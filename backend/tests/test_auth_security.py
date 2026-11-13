import re
import time

import pyotp
import pytest
from django.core import mail

from apps.accounts.models import Role, TOTPDevice

from .conftest import client_for, make_user, place_order

pytestmark = pytest.mark.django_db


def link_params(body):
    m = re.search(r"uid=([^&\s]+)&token=([^\s]+)", body)
    return m.group(1), m.group(2)


# ---- Email verification -----------------------------------------------------------------------------------------

def test_registration_sends_verification_and_link_verifies_once(api, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        r = api.post("/api/v1/auth/register/", {"email": "ama@example.com", "password": "Str0ng-pass-123", "accept_terms": True}, format="json")
    assert r.status_code == 201 and len(mail.outbox) == 1
    uid, token = link_params(mail.outbox[0].body)
    assert api.post("/api/v1/auth/verify-email/confirm/", {"uid": uid, "token": "bad"}, format="json").status_code == 400
    assert api.post("/api/v1/auth/verify-email/confirm/", {"uid": uid, "token": token}, format="json").status_code == 200
    login = api.post("/api/v1/auth/login/", {"email": "ama@example.com", "password": "Str0ng-pass-123", "accept_terms": True}, format="json")
    assert login.data["user"]["email_verified"] is True
    assert api.post("/api/v1/auth/verify-email/confirm/", {"uid": uid, "token": token}, format="json").status_code == 400  # one-time


def test_unverified_customer_blocked_from_checkout_when_required(customer, address, product, settings):
    settings.REQUIRE_VERIFIED_EMAIL = True
    _, variant = product
    _, r = place_order(customer, variant, address)
    assert r.status_code == 403
    customer.email_verified = True
    customer.save()
    _, r = place_order(customer, variant, address, key="k2")
    assert r.status_code == 201


# ---- Password reset ---------------------------------------------------------------------------------------------

def test_password_reset_flow_and_session_revocation(api, customer, django_capture_on_commit_callbacks):
    login = api.post("/api/v1/auth/login/", {"email": customer.email, "password": "Str0ng-pass-123"}, format="json")
    old_refresh = login.data["refresh"]
    unknown = api.post("/api/v1/auth/password-reset/", {"email": "nobody@example.com"}, format="json")
    known = api.post("/api/v1/auth/password-reset/", {"email": customer.email}, format="json")
    assert unknown.data == known.data  # no account enumeration
    assert len(mail.outbox) == 1
    uid, token = link_params(mail.outbox[0].body)
    weak = api.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "12345678"}, format="json")
    assert weak.status_code == 400
    ok = api.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "Brand-new-pass-9"}, format="json")
    assert ok.status_code == 200
    assert api.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "Another-pass-77"}, format="json").status_code == 400
    assert api.post("/api/v1/auth/refresh/", {"refresh": old_refresh}, format="json").status_code == 401  # old sessions revoked
    assert api.post("/api/v1/auth/login/", {"email": customer.email, "password": "Brand-new-pass-9"}, format="json").status_code == 200


def test_change_password_requires_current_password(customer):
    c = client_for(customer)
    assert c.post("/api/v1/auth/change-password/", {"current_password": "wrong", "new_password": "Brand-new-pass-9"}, format="json").status_code == 400
    assert c.post("/api/v1/auth/change-password/", {"current_password": "Str0ng-pass-123", "new_password": "Brand-new-pass-9"}, format="json").status_code == 200


# ---- MFA --------------------------------------------------------------------------------------------------------

def enrol(staff):
    c = client_for(staff)
    secret = c.post("/api/v1/auth/mfa/setup/").data["secret"]
    code = pyotp.TOTP(secret).now()
    assert c.post("/api/v1/auth/mfa/confirm/", {"code": code}, format="json").status_code == 200
    return secret


def login(api, user):
    return api.post("/api/v1/auth/login/", {"email": user.email, "password": "Str0ng-pass-123"}, format="json")


def test_staff_without_device_logs_in_normally_by_default(api, admin):
    assert "access" in login(api, admin).data


def test_enrolled_staff_must_pass_second_factor(api, admin):
    secret = enrol(admin)
    step1 = login(api, admin)
    assert step1.status_code == 200 and step1.data["mfa_required"] is True and "access" not in step1.data
    ticket = step1.data["mfa_token"]
    assert api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket, "code": "000000"}, format="json").status_code == 401
    code = pyotp.TOTP(secret).at(time.time() + 30)  # next step (the current one was used to enrol)
    ok = api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket, "code": code}, format="json")
    assert ok.status_code == 200 and ok.data["user"]["role"] == "store_admin"
    replay = api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket, "code": code}, format="json")
    assert replay.status_code == 401  # a code works once


def test_mfa_locks_after_repeated_failures(api, admin):
    secret = enrol(admin)
    ticket = login(api, admin).data["mfa_token"]
    for _ in range(5):
        assert api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket, "code": "111111"}, format="json").status_code == 401
    assert TOTPDevice.objects.get(user=admin).locked_until is not None
    good = pyotp.TOTP(secret).at(time.time() + 30)
    assert api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket, "code": good}, format="json").status_code == 401  # locked out


def test_tampered_or_wrong_purpose_ticket_rejected(api, admin):
    enrol(admin)
    ticket = login(api, admin).data["mfa_token"]
    assert api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket + "x", "code": "123456"}, format="json").status_code == 401
    # a login ticket cannot be used to start enrolment
    assert api.post("/api/v1/auth/mfa/setup/", {"mfa_token": ticket}, format="json").status_code in {401, 403}


def test_customers_cannot_enrol_in_staff_mfa(customer):
    assert client_for(customer).post("/api/v1/auth/mfa/setup/").status_code == 400


def test_required_mfa_forces_enrolment_before_any_token(api, admin, customer, settings):
    settings.REQUIRE_STAFF_MFA = True
    first = login(api, admin)
    assert first.data["mfa_enrollment_required"] is True and "access" not in first.data
    ticket = first.data["mfa_token"]
    secret = api.post("/api/v1/auth/mfa/setup/", {"mfa_token": ticket}, format="json").data["secret"]
    done = api.post("/api/v1/auth/mfa/confirm/", {"mfa_token": ticket, "code": pyotp.TOTP(secret).now()}, format="json")
    assert done.status_code == 200 and "access" in done.data
    assert "access" in login(api, customer).data  # customers are never asked
    assert client_for(admin).post("/api/v1/auth/mfa/disable/", {"code": "123456"}, format="json").status_code == 400  # cannot switch off when required
