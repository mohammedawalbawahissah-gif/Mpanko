"""Phone numbers: normalising to E.164 and the SMS one-time-code flow (phone sign-in, number verification)."""
import hashlib
import hmac
import secrets
from datetime import timedelta

import phonenumbers
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import PhoneOTP, Role, User

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
RESEND_AFTER = timedelta(seconds=45)
MAX_PER_HOUR = 5


class PhoneError(Exception):
    pass


def default_region():
    return getattr(settings, "STORE_COUNTRY", "GH").upper()


def normalize(raw, region=None):
    """E.164 string for a valid number, or None. Local numbers (0240000000) read as the store's country unless a region is given."""
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.startswith("00"):
        raw = "+" + raw[2:]  # international dialling prefix
    try:
        number = phonenumbers.parse(raw, None if raw.startswith("+") else (region or default_region()))
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(number):
        return None
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)


def _hash(phone, code):
    return hmac.new(settings.SECRET_KEY.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def issue_code(phone, purpose, user=None):
    """
    Create and SMS a six-digit code. Raises PhoneError if the number was asked too often. Does nothing silently
    for sign-in requests that match no account (so the response never reveals who has an account).
    """
    now = timezone.now()
    recent = PhoneOTP.objects.filter(phone=phone, purpose=purpose, created_at__gt=now - timedelta(hours=1))
    if recent.count() >= MAX_PER_HOUR:
        raise PhoneError("Too many codes requested for this number. Try again in an hour.")
    last = recent.first()
    if last and now - last.created_at < RESEND_AFTER:
        raise PhoneError("A code was just sent. Wait a moment before asking for another.")
    code = f"{secrets.randbelow(10**6):06d}"
    PhoneOTP.objects.create(phone=phone, purpose=purpose, user=user, code_hash=_hash(phone, code), expires_at=now + CODE_TTL)
    from apps.notifications.sms import send_sms

    send_sms(phone, f"Your Mpanko code is {code}. It expires in 10 minutes. Do not share it.", kind="otp")


def check_code(phone, purpose, code, user=None):
    """True once for a correct, unexpired code. Wrong guesses count against the code; five and it is dead."""
    otp = PhoneOTP.objects.filter(phone=phone, purpose=purpose, consumed_at__isnull=True, expires_at__gt=timezone.now()).first()
    if user is not None and otp and otp.user_id != user.pk:
        return False
    if not otp or otp.attempts >= MAX_ATTEMPTS:
        return False
    otp.attempts += 1
    if not hmac.compare_digest(otp.code_hash, _hash(phone, (code or "").strip())):
        otp.save(update_fields=["attempts"])
        return False
    otp.consumed_at = timezone.now()
    otp.save(update_fields=["attempts", "consumed_at"])
    return True


def request_login_code(raw_phone):
    phone = normalize(raw_phone)
    if not phone:
        raise PhoneError("Enter a valid phone number, including the country code if it is not a Ghana number.")
    user = User.objects.filter(phone=phone, phone_verified=True, is_active=True, role=Role.CUSTOMER).first()
    if user:
        issue_code(phone, PhoneOTP.Purpose.LOGIN, user)


def login_with_code(raw_phone, code):
    phone = normalize(raw_phone)
    user = User.objects.filter(phone=phone, phone_verified=True, is_active=True, role=Role.CUSTOMER).first() if phone else None
    if not user or not check_code(phone, PhoneOTP.Purpose.LOGIN, code, user):
        return None
    return user


def request_verify_code(user, raw_phone):
    phone = normalize(raw_phone)
    if not phone:
        raise PhoneError("Enter a valid phone number, including the country code if it is not a Ghana number.")
    if User.objects.filter(phone=phone, phone_verified=True).exclude(pk=user.pk).exists():
        raise PhoneError("This number is already linked to another account.")
    issue_code(phone, PhoneOTP.Purpose.VERIFY, user)
    return phone


def confirm_verify_code(user, raw_phone, code):
    phone = normalize(raw_phone)
    if not phone or not check_code(phone, PhoneOTP.Purpose.VERIFY, code, user):
        raise PhoneError("That code is wrong or has expired.")
    try:
        with transaction.atomic():
            user.phone, user.phone_verified = phone, True
            user.save(update_fields=["phone", "phone_verified"])
    except IntegrityError:
        raise PhoneError("This number is already linked to another account.")
    return user
