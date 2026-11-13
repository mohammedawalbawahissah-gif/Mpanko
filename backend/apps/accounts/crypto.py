"""Encryption for small secrets kept in the database (the staff authenticator keys).

The key comes from MFA_ENCRYPTION_KEY, or is derived from SECRET_KEY when that is not set. Changing the key makes
stored secrets unreadable, so set MFA_ENCRYPTION_KEY once in production and keep it with the other secrets.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

PREFIX = "enc1:"


def _fernet() -> Fernet:
    material = (getattr(settings, "MFA_ENCRYPTION_KEY", "") or settings.SECRET_KEY).encode()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"mpanko.mfa.secret|" + material).digest()))


def encrypt(value: str) -> str:
    return PREFIX + _fernet().encrypt(value.encode()).decode()


def is_encrypted(value: str) -> bool:
    return value.startswith(PREFIX)


def decrypt(value: str) -> str:
    """Plain text for an encrypted value. Values saved before encryption existed are returned as they are."""
    if not is_encrypted(value):
        return value
    try:
        return _fernet().decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise ValueError("The stored secret cannot be read with the current encryption key.") from exc
