"""TOTP second factor (RFC 6238) for privileged staff accounts."""
import hmac
import time
from datetime import timedelta

import pyotp
from django.core import signing
from django.db import transaction
from django.utils import timezone

from .models import TOTPDevice

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
        user=user, defaults={"secret": secret, "confirmed": False, "last_used_step": 0, "failed_attempts": 0, "locked_until": None}
    )
    return device, pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Mpanko")


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
    totp = pyotp.TOTP(device.secret)
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
