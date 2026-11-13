"""TOTP second factor (RFC 6238) for privileged staff accounts."""
import hashlib
import hmac
import secrets
import time
from datetime import timedelta

import pyotp
from django.core import signing
from django.db import transaction
from django.utils import timezone

from .models import MFABackupCode, TOTPDevice

SALT = "mpanko.mfa"
TOKEN_MAX_AGE = 600  # seconds a login/enrolment ticket stays valid


def issue_ticket(user, purpose):
    """Short-lived signed ticket handed out after a correct password but before the second factor."""
    return signing.dumps({"uid": user.pk, "purpose": purpose}, salt=SALT)


def read_ticket(token, purposes):
    from .models import User

    try:
        data = signing.loads(token, salt=SALT, max_age=TOKEN_MAX_AGE)
    except signing.BadSignature:
        return None
    if data.get("purpose") not in purposes:
        return None
    return User.objects.filter(pk=data["uid"], is_active=True).first()


def start_enrolment(user):
    secret = pyotp.random_base32()
    device, _ = TOTPDevice.objects.update_or_create(
        user=user, defaults={"confirmed": False, "last_used_step": 0, "failed_attempts": 0, "locked_until": None}
    )
    device.set_secret(secret)
    device.save(update_fields=["secret"])
    return device, secret, pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Mpanko")


@transaction.atomic
def verify_code(user, code):
    """True if `code` is valid now. Each 30-second step can be used once; 5 misses locks the device for 5 minutes."""
    device = TOTPDevice.objects.select_for_update().filter(user=user).first()
    if not device:
        return False
    now = timezone.now()
    if device.locked_until and device.locked_until > now:
        return False
    code = (code or "").strip().replace(" ", "")
    totp = pyotp.TOTP(device.plain_secret)
    current = int(time.time() // 30)
    for step in (current - 1, current, current + 1):
        if step > device.last_used_step and hmac.compare_digest(totp.at(step * 30), code):
            device.last_used_step = step
            device.failed_attempts = 0
            device.locked_until = None
            device.save()
            return True
    device.failed_attempts += 1
    if device.failed_attempts >= TOTPDevice.MAX_FAILURES:
        device.locked_until = now + timedelta(minutes=TOTPDevice.LOCK_MINUTES)
        device.failed_attempts = 0
    device.save()
    return False


def has_confirmed_device(user):
    return TOTPDevice.objects.filter(user=user, confirmed=True).exists()


# --- backup codes ---------------------------------------------------------------------------------------------

BACKUP_CODE_COUNT = 10
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no look-alike characters (i, l, o, 0, 1)


def _hash_backup(code: str) -> str:
    from django.conf import settings

    clean = code.strip().lower().replace("-", "").replace(" ", "")
    return hmac.new(settings.SECRET_KEY.encode(), b"mpanko.mfa.backup|" + clean.encode(), hashlib.sha256).hexdigest()


def looks_like_backup_code(code: str) -> bool:
    clean = (code or "").strip().replace("-", "").replace(" ", "")
    return len(clean) == 8 and not clean.isdigit()


@transaction.atomic
def generate_backup_codes(user):
    """Replace the user's backup codes with a fresh set. The plain codes are returned once and never stored."""
    MFABackupCode.objects.filter(user=user).delete()
    codes = ["".join(secrets.choice(_ALPHABET) for _ in range(8)) for _ in range(BACKUP_CODE_COUNT)]
    MFABackupCode.objects.bulk_create([MFABackupCode(user=user, code_hash=_hash_backup(c)) for c in codes])
    return [f"{c[:4]}-{c[4:]}" for c in codes]


def backup_codes_left(user) -> int:
    return MFABackupCode.objects.filter(user=user, used_at=None).count()


@transaction.atomic
def verify_backup_code(user, code):
    """True once per backup code. Wrong guesses count towards the same lockout as authenticator codes."""
    device = TOTPDevice.objects.select_for_update().filter(user=user).first()
    if not device:
        return False
    now = timezone.now()
    if device.locked_until and device.locked_until > now:
        return False
    row = MFABackupCode.objects.select_for_update().filter(user=user, code_hash=_hash_backup(code or ""), used_at=None).first()
    if row:
        row.used_at = now
        row.save(update_fields=["used_at"])
        device.failed_attempts = 0
        device.locked_until = None
        device.save(update_fields=["failed_attempts", "locked_until"])
        return True
    device.failed_attempts += 1
    if device.failed_attempts >= TOTPDevice.MAX_FAILURES:
        device.locked_until = now + timedelta(minutes=TOTPDevice.LOCK_MINUTES)
        device.failed_attempts = 0
    device.save(update_fields=["failed_attempts", "locked_until"])
    return False


def verify_second_factor(user, code):
    """Accepts an authenticator code or a backup code. Returns "totp", "backup" or None."""
    if looks_like_backup_code(code):
        return "backup" if verify_backup_code(user, code) else None
    return "totp" if verify_code(user, code) else None
