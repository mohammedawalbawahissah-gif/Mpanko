import time

import pyotp
import pytest

from apps.accounts import crypto, mfa
from apps.accounts.models import MFABackupCode, TOTPDevice

from .conftest import client_for
from .test_auth_security import login

pytestmark = pytest.mark.django_db


def enrol_with_codes(staff):
    c = client_for(staff)
    secret = c.post("/api/v1/auth/mfa/setup/").data["secret"]
    r = c.post("/api/v1/auth/mfa/confirm/", {"code": pyotp.TOTP(secret).now()}, format="json")
    assert r.status_code == 200
    return secret, r.data["backup_codes"]


def test_secret_is_encrypted_at_rest(admin):
    secret, _ = enrol_with_codes(admin)
    stored = TOTPDevice.objects.get(user=admin).secret
    assert stored != secret and secret not in stored and crypto.is_encrypted(stored)
    assert TOTPDevice.objects.get(user=admin).plain_secret == secret


def test_old_plain_secrets_still_work_and_a_wrong_key_is_reported():
    assert crypto.decrypt("JBSWY3DPEHPK3PXP") == "JBSWY3DPEHPK3PXP"  # saved before encryption existed
    token = crypto.encrypt("abc")
    assert crypto.decrypt(token) == "abc"
    with pytest.raises(ValueError):
        crypto.decrypt(crypto.PREFIX + "not-a-real-token")


def test_enrolling_returns_ten_backup_codes_once_and_stores_only_hashes(admin):
    _, codes = enrol_with_codes(admin)
    assert len(codes) == 10 and len(set(codes)) == 10
    assert all(len(c) == 9 and c[4] == "-" for c in codes)
    rows = MFABackupCode.objects.filter(user=admin)
    assert rows.count() == 10
    assert not any(c.replace("-", "") in r.code_hash for c in codes for r in rows)


def test_a_backup_code_signs_in_once(api, admin):
    _, codes = enrol_with_codes(admin)
    ticket = login(api, admin).data["mfa_token"]
    ok = api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket, "code": codes[0]}, format="json")
    assert ok.status_code == 200 and ok.data["backup_codes_left"] == 9 and "access" in ok.data
    ticket2 = login(api, admin).data["mfa_token"]
    again = api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket2, "code": codes[0]}, format="json")
    assert again.status_code == 401  # each code works once
    upper = api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket2, "code": codes[1].upper().replace("-", " ")}, format="json")
    assert upper.status_code == 200  # case, dash and spaces do not matter


def test_wrong_backup_codes_lock_the_device_like_authenticator_codes(api, admin):
    enrol_with_codes(admin)
    ticket = login(api, admin).data["mfa_token"]
    for _ in range(TOTPDevice.MAX_FAILURES):
        assert api.post("/api/v1/auth/login/mfa/", {"mfa_token": ticket, "code": "zzzz-zzzz"}, format="json").status_code == 401
    assert TOTPDevice.objects.get(user=admin).locked_until is not None


def test_regenerating_needs_a_current_authenticator_code_and_replaces_the_old_set(admin):
    secret, old = enrol_with_codes(admin)
    c = client_for(admin)
    assert c.post("/api/v1/auth/mfa/backup-codes/", {"code": "000000"}, format="json").status_code == 400
    assert c.post("/api/v1/auth/mfa/backup-codes/", {"code": old[0]}, format="json").status_code == 400  # not with a backup code
    r = c.post("/api/v1/auth/mfa/backup-codes/", {"code": pyotp.TOTP(secret).at(time.time() + 30)}, format="json")
    assert r.status_code == 200 and len(r.data["backup_codes"]) == 10
    assert not mfa.verify_backup_code(admin, old[0])  # the old set is gone
    assert c.get("/api/v1/auth/mfa/backup-codes/").data == {"enabled": True, "backup_codes_left": 10}


def test_backup_codes_need_staff_with_two_step_on(customer):
    c = client_for(customer)
    assert c.get("/api/v1/auth/mfa/backup-codes/").data["enabled"] is False
    assert c.post("/api/v1/auth/mfa/backup-codes/", {"code": "123456"}, format="json").status_code == 400


def test_turning_mfa_off_removes_backup_codes(admin):
    secret, _ = enrol_with_codes(admin)
    c = client_for(admin)
    assert c.post("/api/v1/auth/mfa/disable/", {"code": pyotp.TOTP(secret).at(time.time() + 30)}, format="json").status_code == 200
    assert not MFABackupCode.objects.filter(user=admin).exists()
