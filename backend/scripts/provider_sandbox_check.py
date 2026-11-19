"""
Live sandbox check for MTN MoMo and Hubtel. Run it yourself, on your own machine, with your own credentials.

It never prints secrets and never touches the database. Credentials are read from the environment only:

  MTN MoMo : MTN_MOMO_API_USER, MTN_MOMO_API_KEY, MTN_MOMO_SUBSCRIPTION_KEY
             (optional) MTN_MOMO_ENVIRONMENT=sandbox, MTN_MOMO_BASE_URL, MTN_MOMO_CURRENCY (EUR in the sandbox)
  Hubtel   : HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET, HUBTEL_MERCHANT_ACCOUNT
             Hubtel only answers status checks from IP addresses you have whitelisted with them.

Usage (from the backend folder, virtualenv active):
  python scripts/provider_sandbox_check.py mtn
  python scripts/provider_sandbox_check.py hubtel
"""
import os
import sys
import time
import uuid
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.environ.setdefault("DEBUG", "True")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import django

django.setup()

from apps.payments.providers import ProviderError, get_provider


def attempt(phone=""):
    ref = "sbx-" + uuid.uuid4().hex[:16]
    order = SimpleNamespace(contact_phone=phone, number="SANDBOX-1")
    return SimpleNamespace(order=order, reference=ref, amount=Decimal("1.00"), currency="GHS")


def line(ok, text):
    print(("PASS  " if ok else "FAIL  ") + text)
    return ok


def check_mtn():
    from django.conf import settings

    settings.PAYMENT_PROVIDERS_ENABLED = list(settings.PAYMENT_PROVIDERS_ENABLED) + ["mtn_momo"]
    p = get_provider("mtn_momo")
    ok = True
    try:
        p._token()
        ok &= line(True, "credentials accepted, access token issued")
    except ProviderError as exc:
        return line(False, f"credentials: {exc}")
    # MTN's sandbox success number. Amounts ending in specific values trigger failure cases; see MTN's sandbox docs.
    a = attempt("46733123450")
    try:
        out = p.initiate(a, "test@example.com", "")
        ok &= line(True, f"request-to-pay accepted (reference {out['provider_reference']})")
    except ProviderError as exc:
        return line(False, f"request-to-pay: {exc}")
    final = "pending"
    for _ in range(10):
        time.sleep(3)
        v = p.verify(a)
        final = v.status
        print(f"      status check: {v.status} amount={v.amount} currency={v.currency}")
        if final != "pending":
            break
    ok &= line(final in {"succeeded", "failed"}, f"status check reached a final state ({final})")
    forged = SimpleNamespace(**{**a.__dict__, "reference": "sbx-does-not-exist"})
    ok &= line(p.verify(forged).status == "pending", "an unknown reference is never reported as paid")
    return ok


def check_hubtel():
    from django.conf import settings

    settings.PAYMENT_PROVIDERS_ENABLED = list(settings.PAYMENT_PROVIDERS_ENABLED) + ["hubtel"]
    p = get_provider("hubtel")
    ok = True
    a = attempt()
    if not settings.API_PUBLIC_URL:
        print("      note: API_PUBLIC_URL is empty; Hubtel may reject the callback URL.")
    try:
        out = p.initiate(a, "test@example.com", "https://example.com/checkout/complete")
        ok &= line(bool(out["authorization_url"]), f"checkout created: {out['authorization_url']}")
    except ProviderError as exc:
        return line(False, f"initiate: {exc}")
    try:
        v = p.verify(a)
        ok &= line(v.status == "pending", f"status check works and an unpaid checkout reads as pending ({v.status})")
    except ProviderError as exc:
        ok &= line(False, f"status check: {exc}")
    print("      Open the checkout link, pay with a Hubtel test wallet, then run this again with HUBTEL_CHECK_REFERENCE=" + a.reference)
    ref = os.environ.get("HUBTEL_CHECK_REFERENCE")
    if ref:
        v = p.verify(SimpleNamespace(**{**a.__dict__, "reference": ref}))
        ok &= line(True, f"status of {ref}: {v.status} amount={v.amount} currency={v.currency}")
    return ok


if __name__ == "__main__":
    which = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
    if which not in {"mtn", "hubtel"}:
        sys.exit(__doc__)
    sys.exit(0 if (check_mtn() if which == "mtn" else check_hubtel()) else 1)
