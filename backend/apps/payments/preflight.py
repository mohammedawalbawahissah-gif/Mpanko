"""
Go-live readiness checks. `python manage.py preflight` runs every check against the real accounts configured in the
environment and prints, for each one, whether it passed and what to do if it did not. It sends no money and no
customer messages; the network checks only read (account balance, sign-in, a bucket lookup).

Result levels: PASS (works), WARN (works but is risky or optional), FAIL (must be fixed before going live),
SKIP (not configured, and not needed).
"""
from dataclasses import dataclass

import requests
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

PASS, WARN, FAIL, SKIP = "PASS", "WARN", "FAIL", "SKIP"


@dataclass
class Result:
    group: str
    name: str
    level: str
    detail: str = ""
    fix: str = ""


def _get(url, **kw):
    return requests.get(url, timeout=15, **kw)


# ------------------------------------------------------------------ core


def check_core(offline):
    out = []
    g = "Server"
    out.append(Result(g, "DEBUG is off", FAIL if settings.DEBUG else PASS, "DEBUG is on." if settings.DEBUG else "", "Set DEBUG=false on the api service."))
    weak = settings.SECRET_KEY.startswith("dev-only") or len(settings.SECRET_KEY) < 32
    out.append(Result(g, "SECRET_KEY is strong", FAIL if weak else PASS, "Too short or the development default." if weak else "", "Set SECRET_KEY to a random value of 50 or more characters."))
    https = settings.FRONTEND_URL.startswith("https://")
    out.append(Result(g, "FRONTEND_URL uses https", PASS if https else FAIL, settings.FRONTEND_URL, "Set FRONTEND_URL to your shop's https address."))
    local = [h for h in settings.ALLOWED_HOSTS if h in {"localhost", "127.0.0.1", "*"}]
    out.append(Result(g, "ALLOWED_HOSTS is tight", WARN if local else PASS, ", ".join(local), "Remove localhost and * from ALLOWED_HOSTS."))
    cors_local = [o for o in settings.CORS_ALLOWED_ORIGINS if "localhost" in o or o.startswith("http://")]
    out.append(Result(g, "CORS lists only your sites", WARN if cors_local else PASS, ", ".join(cors_local), "Set CORS_ALLOWED_ORIGINS to your shop and admin https addresses only."))
    out.append(Result(g, "Staff two-step key is set", PASS if settings.MFA_ENCRYPTION_KEY else WARN, "" if settings.MFA_ENCRYPTION_KEY else "Derived from SECRET_KEY.", "Set MFA_ENCRYPTION_KEY to a long random value."))
    out.append(Result(g, "Error reporting (Sentry)", PASS if settings.SENTRY_DSN else WARN, "" if settings.SENTRY_DSN else "Not configured.", "Set SENTRY_DSN so you hear about crashes."))
    try:
        connection.ensure_connection()
        plan = MigrationExecutor(connection).migration_plan(MigrationExecutor(connection).loader.graph.leaf_nodes())
        out.append(Result(g, "Database is up to date", FAIL if plan else PASS, f"{len(plan)} migration(s) not applied." if plan else "", "Run: python manage.py migrate"))
    except Exception as exc:  # noqa: BLE001
        out.append(Result(g, "Database is reachable", FAIL, str(exc)[:160], "Check DATABASE_URL."))
    if connection.vendor == "sqlite":
        out.append(Result(g, "Production database", FAIL if not settings.DEBUG else WARN, "SQLite in use.", "Attach a Postgres database and set DATABASE_URL."))
    if settings.REDIS_URL:
        if offline:
            out.append(Result(g, "Redis is reachable", SKIP, "Offline run."))
        else:
            try:
                from django.core.cache import cache

                cache.set("preflight", "1", 10)
                ok = cache.get("preflight") == "1"
                out.append(Result(g, "Redis is reachable", PASS if ok else FAIL, "", "Check REDIS_URL."))
            except Exception as exc:  # noqa: BLE001
                out.append(Result(g, "Redis is reachable", FAIL, str(exc)[:160], "Check REDIS_URL."))
    else:
        out.append(Result(g, "Background jobs (Redis)", WARN, "No REDIS_URL: jobs run inside web requests and throttling is per process.", "Add Redis and set REDIS_URL, then run a worker and a beat service."))
    return out


# ------------------------------------------------------------------ payments


def _provider_check(name, offline):
    g = "Payments"
    enabled = name in settings.PAYMENT_PROVIDERS_ENABLED
    if not enabled:
        return [Result(g, {"paypal": "PayPal"}.get(name, name.capitalize()), SKIP, "Not in PAYMENT_PROVIDERS_ENABLED.")]
    out = []
    if name == "paystack":
        key, hook = settings.PAYSTACK_SECRET_KEY, True  # Paystack signs webhooks with the secret key
        need = "PAYSTACK_SECRET_KEY"
        probe = lambda: _get("https://api.paystack.co/balance", headers={"Authorization": f"Bearer {key}"})  # noqa: E731
        live = key.startswith("sk_live_")
    elif name == "stripe":
        key, hook = settings.STRIPE_SECRET_KEY, bool(settings.STRIPE_WEBHOOK_SECRET)
        need = "STRIPE_SECRET_KEY"
        probe = lambda: _get("https://api.stripe.com/v1/balance", headers={"Authorization": f"Bearer {key}"})  # noqa: E731
        live = key.startswith(("sk_live_", "rk_live_"))
    elif name == "flutterwave":
        key, hook = settings.FLUTTERWAVE_SECRET_KEY, bool(settings.FLUTTERWAVE_WEBHOOK_HASH)
        need = "FLUTTERWAVE_SECRET_KEY"
        probe = lambda: _get("https://api.flutterwave.com/v3/balances", headers={"Authorization": f"Bearer {key}"})  # noqa: E731
        live = bool(key) and "_TEST" not in key
    elif name == "paypal":
        key = settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET
        hook = bool(settings.PAYPAL_WEBHOOK_ID)
        need = "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET"
        live = settings.PAYPAL_ENV == "live"

        def probe():
            from .providers_extra import PayPalProvider

            PayPalProvider()._token()
            return type("R", (), {"ok": True, "status_code": 200})()
    elif name in ("zelle", "cashapp", "cash"):
        label = {"zelle": "Zelle", "cashapp": "Cash App", "cash": "Cash"}[name]
        if name == "zelle":
            ok, fix, what = bool(settings.ZELLE_RECIPIENT), "Set ZELLE_RECIPIENT to the email or phone number registered with Zelle.", "Zelle recipient"
        elif name == "cashapp":
            ok, fix, what = bool(settings.CASHAPP_CASHTAG), "Set CASHAPP_CASHTAG to the shop's $cashtag.", "Cash App $cashtag"
        else:
            ok, fix, what = bool(settings.CASH_INSTRUCTIONS), "Set CASH_INSTRUCTIONS to tell shoppers where and how to pay.", "Cash instructions"
        return [Result(g, f"{label}: {what}", PASS if ok else FAIL, "" if ok else "Not set, so shoppers would not know how to pay.", fix),
                Result(g, f"{label}: finance confirms each payment", WARN, "No gateway confirms these. Finance must press Payment received in the admin.")]
    elif name == "hubtel":
        key = settings.HUBTEL_CLIENT_ID and settings.HUBTEL_CLIENT_SECRET and settings.HUBTEL_MERCHANT_ACCOUNT
        if not key:
            return [Result(g, "Hubtel credentials", FAIL, "", "Set HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET and HUBTEL_MERCHANT_ACCOUNT.")]
        out = [Result(g, "Hubtel callback address", PASS if settings.API_PUBLIC_URL else FAIL, "" if settings.API_PUBLIC_URL else "API_PUBLIC_URL is not set.", "Set API_PUBLIC_URL to this API's public address so Hubtel can reach /api/v1/payments/webhooks/hubtel/.")]
        out.append(Result(g, "Hubtel not yet tested here", WARN, "This adapter was written from Hubtel's documentation and has not run against a Hubtel account. Place a test payment before launch."))
        return out
    elif name == "mock":
        return [Result(g, "Mock gateway is off", FAIL if not settings.DEBUG else WARN, "The test gateway accepts any payment.", "Remove mock from PAYMENT_PROVIDERS_ENABLED.")]
    else:
        return [Result(g, name, WARN, "Unknown provider name.")]
    label = {"paypal": "PayPal"}.get(name, name.capitalize())
    if not key:
        return [Result(g, f"{label} credentials", FAIL, "", f"Set {need}.")]
    out.append(Result(g, f"{label} uses live keys", PASS if live else FAIL, "" if live else "These look like test keys.", "Switch to the live keys from the gateway's dashboard."))
    out.append(Result(g, f"{label} webhook secret", PASS if hook else FAIL, "" if hook else "Not set.", "Create the webhook in the gateway dashboard pointing at /api/v1/payments/webhooks/" + name + "/ and set its secret in the environment."))
    if offline:
        out.append(Result(g, f"{label} accepts the keys", SKIP, "Offline run."))
    else:
        try:
            r = probe()
            out.append(Result(g, f"{label} accepts the keys", PASS if r.ok else FAIL, "" if r.ok else f"HTTP {r.status_code}", "The gateway rejected the credentials. Re-copy them from its dashboard."))
        except Exception as exc:  # noqa: BLE001
            out.append(Result(g, f"{label} accepts the keys", FAIL, str(exc)[:160], "Check the credentials and the server's internet access."))
    return out


def check_payments(offline):
    out = []
    names = list(settings.PAYMENT_PROVIDERS_ENABLED)
    real = [n for n in names if n != "mock"]
    if not real:
        out.append(Result("Payments", "At least one real gateway", FAIL, "None enabled.", "Set PAYMENT_PROVIDERS_ENABLED=paystack (or stripe, paypal, flutterwave)."))
    for n in ("paystack", "stripe", "paypal", "flutterwave", "hubtel", "zelle", "cashapp", "cash"):
        out.extend(_provider_check(n, offline))
    if "mock" in names:
        out.extend(_provider_check("mock", offline))
    from .providers import chargeable_currencies

    try:
        cur = sorted(chargeable_currencies())
        out.append(Result("Payments", "Currencies the shop can charge", PASS if cur else FAIL, ", ".join(cur) or "None.", "Enable a gateway that supports your currencies and make sure exchange rates exist."))
    except Exception as exc:  # noqa: BLE001
        out.append(Result("Payments", "Currencies the shop can charge", FAIL, str(exc)[:160]))
    return out


# ------------------------------------------------------------------ messages, storage, rates, carriers


def check_messaging(offline):
    g = "Messages"
    out = []
    if settings.RESEND_API_KEY:
        out.append(Result(g, "Email (Resend) key set", PASS))
        out.append(Result(g, "Sender address", WARN if "example" in settings.DEFAULT_FROM_EMAIL else PASS, settings.DEFAULT_FROM_EMAIL, "Set DEFAULT_FROM_EMAIL to an address on a domain verified in Resend."))
        if offline:
            out.append(Result(g, "Resend accepts the key", SKIP, "Offline run."))
        else:
            try:
                r = _get("https://api.resend.com/domains", headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"})
                ok = r.ok
                out.append(Result(g, "Resend accepts the key", PASS if ok else FAIL, "" if ok else f"HTTP {r.status_code}", "Re-copy the key. A key limited to sending only may show a 401 here; use `python manage.py check_email you@example.com` instead."))
            except Exception as exc:  # noqa: BLE001
                out.append(Result(g, "Resend accepts the key", FAIL, str(exc)[:160]))
    else:
        out.append(Result(g, "Email", FAIL, "No RESEND_API_KEY: emails go to the server log.", "Set RESEND_API_KEY and verify your domain in Resend."))
    wants_twilio = settings.SMS_BACKEND == "twilio" or settings.WHATSAPP_BACKEND == "twilio"
    if not wants_twilio:
        out.append(Result(g, "SMS and WhatsApp", SKIP, "Both write to the log (SMS_BACKEND, WHATSAPP_BACKEND)."))
    else:
        sid, token = settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN
        if not (sid and token):
            out.append(Result(g, "Twilio credentials", FAIL, "", "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN."))
        elif offline:
            out.append(Result(g, "Twilio accepts the keys", SKIP, "Offline run."))
        else:
            try:
                r = _get(f"https://api.twilio.com/2010-04-01/Accounts/{sid}.json", auth=(sid, token))
                out.append(Result(g, "Twilio accepts the keys", PASS if r.ok else FAIL, "" if r.ok else f"HTTP {r.status_code}", "Re-copy the account SID and auth token."))
            except Exception as exc:  # noqa: BLE001
                out.append(Result(g, "Twilio accepts the keys", FAIL, str(exc)[:160]))
        if settings.SMS_BACKEND == "twilio":
            ok = bool(settings.TWILIO_FROM or settings.TWILIO_MESSAGING_SERVICE_SID)
            out.append(Result(g, "SMS sender", PASS if ok else FAIL, "", "Set TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID."))
        if settings.WHATSAPP_BACKEND == "twilio":
            out.append(Result(g, "WhatsApp sender", PASS if settings.TWILIO_WHATSAPP_FROM else FAIL, "", "Set TWILIO_WHATSAPP_FROM, for example whatsapp:+14155238886."))
            out.append(Result(g, "WhatsApp templates", PASS if settings.WHATSAPP_TEMPLATE_SIDS else WARN, "" if settings.WHATSAPP_TEMPLATE_SIDS else "Free text only works inside a 24-hour window.", "Approve one template per event in Twilio and list them in WHATSAPP_TEMPLATE_SIDS."))
    return out


def check_storage_and_rates(offline):
    g = "Storage and rates"
    out = []
    if settings.R2_BUCKET:
        if offline:
            out.append(Result(g, "Image storage (R2)", SKIP, "Offline run."))
        else:
            try:
                from django.core.files.storage import default_storage

                default_storage.exists("preflight-check")
                out.append(Result(g, "Image storage (R2) reachable", PASS))
            except Exception as exc:  # noqa: BLE001
                out.append(Result(g, "Image storage (R2) reachable", FAIL, str(exc)[:160], "Check the R2_* variables and that the token can read the bucket."))
    else:
        out.append(Result(g, "Image storage", FAIL if not settings.DEBUG else WARN, "Uploads go to the server's disk and vanish on redeploy.", "Set the R2_* variables."))
    from apps.currency import services as fx
    from apps.orders import pricing

    base = settings.BASE_CURRENCY.upper()
    probe = "GHS" if base != "GHS" else "USD"
    try:
        pricing.rate(probe)
        out.append(Result(g, f"Exchange rate {base} to {probe}", PASS))
    except Exception as exc:  # noqa: BLE001
        out.append(Result(g, f"Exchange rate {base} to {probe}", FAIL, str(exc)[:120], "Set MANUAL_FX_RATES or let the live feed refresh."))
    if not offline:
        try:
            r = _get(settings.FX_PROVIDER_URL.format(base=base))
            ok = r.ok and r.json().get("result") == "success"
            out.append(Result(g, "Live exchange-rate feed", PASS if ok else WARN, "" if ok else f"HTTP {r.status_code}", "Check FX_PROVIDER_URL, or rely on MANUAL_FX_RATES."))
        except Exception as exc:  # noqa: BLE001
            out.append(Result(g, "Live exchange-rate feed", WARN, str(exc)[:120], "Check FX_PROVIDER_URL, or rely on MANUAL_FX_RATES."))
    _ = fx
    return out


def check_carriers(offline):
    g = "Carriers"
    groups = {
        "DHL tracking": [settings.DHL_API_KEY],
        "DHL Express rates and labels": [settings.DHL_EXPRESS_USER, settings.DHL_EXPRESS_PASSWORD, settings.DHL_EXPRESS_ACCOUNT],
        "FedEx": [settings.FEDEX_CLIENT_ID, settings.FEDEX_CLIENT_SECRET, settings.FEDEX_ACCOUNT],
        "UPS": [settings.UPS_CLIENT_ID, settings.UPS_CLIENT_SECRET],
    }
    out, any_live = [], False
    for name, vals in groups.items():
        if all(vals):
            any_live = True
            out.append(Result(g, name, PASS, "Credentials present. Confirm with a test quote or label in the carrier's sandbox."))
        elif any(vals):
            out.append(Result(g, name, FAIL, "Some credentials set, some missing.", "Set every variable for this carrier."))
        else:
            out.append(Result(g, name, SKIP, "Not configured."))
    if not any_live:
        out.append(Result(g, "Live shipping rates", WARN, "No carrier is connected; rates come from the shipping table.", "Connect at least one carrier, or confirm the table rates are what you want to charge."))
    return out


def run_all(offline=False):
    results = []
    for fn in (check_core, check_payments, check_messaging, check_storage_and_rates, check_carriers):
        results.extend(fn(offline))
    return results
