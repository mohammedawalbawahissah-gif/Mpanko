"""The shop's contact details: any number of phones, WhatsApp numbers and email addresses, managed by staff.
The single-value settings (SUPPORT_PHONE_NUMBER and so on) still work: each is used for a kind that has no contacts of its own."""
import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

from .models import SupportContact


def clean_value(kind, raw):
    """Tidy a contact's value for its kind, or raise ValidationError with a plain message."""
    raw = (raw or "").strip()
    if kind == SupportContact.EMAIL:
        try:
            validate_email(raw)
        except ValidationError:
            raise ValidationError("Enter a valid email address.")
        return raw.lower()
    digits = re.sub(r"\D", "", raw)
    if not 7 <= len(digits) <= 15:
        raise ValidationError("Enter the number with its country code, for example +233240000000.")
    if kind == SupportContact.WHATSAPP:
        return digits
    return ("+" if raw.startswith("+") else "") + digits


def public_contacts():
    """Active contacts in order, as [{kind, label, value}]; a kind with none falls back to the single setting, if any."""
    rows = [{"kind": c.kind, "label": c.label, "value": c.value} for c in SupportContact.objects.filter(is_active=True)]
    fallbacks = {
        SupportContact.EMAIL: settings.SUPPORT_EMAIL_ADDRESS,
        SupportContact.PHONE: settings.SUPPORT_PHONE_NUMBER,
        SupportContact.WHATSAPP: settings.WHATSAPP_SUPPORT_NUMBER,
    }
    have = {r["kind"] for r in rows}
    for kind in (SupportContact.EMAIL, SupportContact.PHONE, SupportContact.WHATSAPP):
        if kind not in have and fallbacks[kind]:
            rows.append({"kind": kind, "label": "", "value": fallbacks[kind]})
    return rows


def first_of(rows, kind):
    return next((r["value"] for r in rows if r["kind"] == kind), "")


def contact_config():
    """The fields the public config and the corporate site return. The three single fields stay for older apps."""
    rows = public_contacts()
    return {
        "contacts": rows,
        "whatsapp_number": first_of(rows, SupportContact.WHATSAPP),
        "support_phone": first_of(rows, SupportContact.PHONE),
        "support_email": first_of(rows, SupportContact.EMAIL),
    }
