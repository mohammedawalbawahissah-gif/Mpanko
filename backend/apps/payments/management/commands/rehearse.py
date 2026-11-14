"""
Dress rehearsal for launch day: one command that places an order, pays it, ships it and refunds it, and says
which step failed if any does.

    python manage.py rehearse                 # Ghana order, everything undone at the end
    python manage.py rehearse --country US    # an international order (needs a ZIP, set automatically)
    python manage.py rehearse --keep          # leave the test order in the database to look at in the admin

It uses the real database, settings, shipping rates, launch-country limit and guest-checkout switch, but the
payment step uses the built-in test gateway (no money moves) and e-mail goes to memory, so nobody is contacted.
Unless you pass --keep, the whole run is rolled back, so reports and stock are not touched.
"""
import json
import time
from contextlib import contextmanager
from decimal import Decimal

from django.conf import settings
from django.core import mail
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework.test import APIClient

ADDRESSES = {
    "GH": {"recipient_name": "Rehearsal Buyer", "phone": "+233200000000", "line1": "1 Test Street", "city": "Tamale", "region": "Northern", "postal_code": "", "country": "GH"},
    "US": {"recipient_name": "Rehearsal Buyer", "phone": "+12025550100", "line1": "1 Test Street", "city": "Austin", "region": "Texas", "postal_code": "78701", "country": "US"},
    "GB": {"recipient_name": "Rehearsal Buyer", "phone": "+442071838750", "line1": "1 Test Street", "city": "London", "region": "England", "postal_code": "SW1A 1AA", "country": "GB"},
    "CA": {"recipient_name": "Rehearsal Buyer", "phone": "+14165550100", "line1": "1 Test Street", "city": "Toronto", "region": "Ontario", "postal_code": "M5V 2T6", "country": "CA"},
    "DE": {"recipient_name": "Rehearsal Buyer", "phone": "+493012345678", "line1": "1 Teststrasse", "city": "Berlin", "region": "Berlin", "postal_code": "10115", "country": "DE"},
}


class Rollback(Exception):
    """Raised on purpose at the end so everything the rehearsal wrote is undone."""


class Step:
    def __init__(self, command):
        self.command = command
        self.failed = []
        self.started = time.monotonic()

    def ok(self, name, detail=""):
        self.command.stdout.write(self.command.style.SUCCESS(f"  PASS  {name}") + (f" - {detail}" if detail else ""))

    def fail(self, name, detail="", fix=""):
        self.failed.append(name)
        self.command.stdout.write(self.command.style.ERROR(f"  FAIL  {name}") + (f" - {detail}" if detail else ""))
        if fix:
            self.command.stdout.write(f"        Fix: {fix}")

    def check(self, name, condition, detail="", fix=""):
        if condition:
            self.ok(name, detail)
        else:
            self.fail(name, detail, fix)
        return bool(condition)

    def note(self, name, detail):
        self.command.stdout.write(self.command.style.WARNING(f"  note  {name}") + f" - {detail}")


@contextmanager
def rehearsal_settings():
    """The test gateway on, e-mail kept in memory and background jobs run inline, restored afterwards."""
    from config.celery import app

    saved = {
        "providers": list(settings.PAYMENT_PROVIDERS_ENABLED), "email": settings.EMAIL_BACKEND,
        "eager": app.conf.task_always_eager, "propagate": app.conf.task_eager_propagates,
    }
    settings.PAYMENT_PROVIDERS_ENABLED = list(dict.fromkeys([*saved["providers"], "mock"]))
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    app.conf.task_always_eager = True
    app.conf.task_eager_propagates = False
    try:
        yield
    finally:
        settings.PAYMENT_PROVIDERS_ENABLED = saved["providers"]
        settings.EMAIL_BACKEND = saved["email"]
        app.conf.task_always_eager = saved["eager"]
        app.conf.task_eager_propagates = saved["propagate"]


def make_client():
    """A test client that looks like a real visitor: an allowed host name and HTTPS, so redirects and host checks do not get in the way."""
    host = next((h for h in settings.ALLOWED_HOSTS if h and not h.startswith((".", "*"))), "localhost")
    return APIClient(SERVER_NAME=host, **{"wsgi.url_scheme": "https"})


def _errors(response):
    data = getattr(response, "data", None)
    return json.dumps(data, default=str)[:300] if data is not None else f"HTTP {response.status_code}"


class Command(BaseCommand):
    help = "Place, pay, ship and refund a test order to prove the whole journey works. Exit code 1 if any step fails."

    def add_arguments(self, parser):
        parser.add_argument("--country", default="GH", choices=sorted(ADDRESSES), help="Destination country for the test order (default GH).")
        parser.add_argument("--keep", action="store_true", help="Keep the test order, user and product instead of undoing them.")
        parser.add_argument("--skip-preflight", action="store_true", help="Do not run the offline settings check first.")

    def handle(self, *args, country="GH", keep=False, skip_preflight=False, **opts):
        if settings.DEBUG is False and not settings.ALLOWED_HOSTS:
            raise CommandError("ALLOWED_HOSTS is empty; set it before rehearsing.")
        step = Step(self)
        self.stdout.write(f"Rehearsal: {country} order, test payment gateway{', kept afterwards' if keep else ', undone afterwards'}.")
        try:
            with rehearsal_settings(), transaction.atomic():
                self.run_journey(step, country, skip_preflight)
                if not keep:
                    raise Rollback()
        except Rollback:
            pass
        elapsed = time.monotonic() - step.started
        self.stdout.write("")
        if step.failed:
            self.stdout.write(self.style.ERROR(f"{len(step.failed)} step(s) failed in {elapsed:.1f}s: {', '.join(step.failed)}"))
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS(f"Every step passed in {elapsed:.1f}s." + ("" if keep else " Nothing was saved.")))

    # ------------------------------------------------------------------------------------------------------

    def run_journey(self, step, country, skip_preflight):
        from apps.accounts.models import Address, Role, User
        from apps.catalog.models import Category, Inventory, Product, ProductStatus, ProductVariant
        from apps.orders.models import Order, OrderStatus
        from apps.payments.preflight import FAIL, run_all
        from apps.payments.providers import MockProvider

        public = make_client()
        stamp = str(int(time.time()))

        self.stdout.write("\n1. Is the site up?")
        for path in ("/health/", "/ready/"):
            r = public.get(path)
            step.check(f"GET {path}", r.status_code == 200, f"HTTP {r.status_code}", "Check DATABASE_URL and REDIS_URL." if path == "/ready/" else "")
        cfg = public.get("/api/v1/config/")
        step.check("GET /api/v1/config/", cfg.status_code == 200, _errors(cfg) if cfg.status_code != 200 else "")
        guest_on = bool(cfg.data.get("guest_checkout")) if cfg.status_code == 200 else False
        if cfg.status_code == 200:
            step.note("Guest checkout", "on" if guest_on else "off (the rehearsal uses a temporary account instead)")
            step.note("Launch countries", ", ".join(cfg.data.get("launch_countries") or []) or "all (no limit set)")
            step.note("WhatsApp number", cfg.data.get("whatsapp_number") or "not set")

        if not skip_preflight:
            self.stdout.write("\n2. Are the settings ready? (offline check)")
            blockers = [r for r in run_all(offline=True) if r.level == FAIL]
            step.check("preflight", not blockers, f"{len(blockers)} blocker(s): " + "; ".join(r.name for r in blockers[:5]), "Run `python manage.py preflight` for the full list and fixes.")

        self.stdout.write("\n3. Place an order")
        category, _ = Category.objects.get_or_create(name="Rehearsal")
        product = Product.objects.create(name=f"Rehearsal item {stamp}", category=category, base_price="10.00", currency=settings.BASE_CURRENCY, status=ProductStatus.PUBLISHED, origin_country="GH", weight_grams=300)
        variant = ProductVariant.objects.create(product=product, sku=f"REH-{stamp}", name="Default")
        Inventory.objects.create(variant=variant, quantity=5)
        address = dict(ADDRESSES[country])

        q = public.get(f"/api/v1/shipping/quote/?country={country}&products={product.slug}:2&city={address['city']}&postal_code={address['postal_code']}")
        services = q.data.get("services", []) if q.status_code == 200 else []
        if not services:
            why = (q.data.get("blocked_reason") or f"no services returned for {country}") if q.status_code == 200 else _errors(q)
            step.fail("shipping quote", why, "Add a shipping rate for this country, or add it to LAUNCH_COUNTRIES.")
            return
        service = min(services, key=lambda s: Decimal(str(s.get("price", s.get("amount", "0")))))
        service_code = service.get("service_code") or service.get("code")
        step.ok("shipping quote", f"{len(services)} service(s); using {service.get('service_name') or service_code}")

        currency = settings.BASE_CURRENCY
        key = f"rehearsal-{stamp}"
        if guest_on:
            email = f"rehearsal+{stamp}@example.invalid"
            r = public.post("/api/v1/checkout/guest/", {
                "email": email, "items": [{"variant": variant.id, "quantity": 2}], "address": address, "shipping_service": service_code,
                "currency": currency, "accept_terms": True, "duties_acknowledged": True,
            }, format="json", HTTP_IDEMPOTENCY_KEY=key)
            buyer = public
            token = r.data.get("guest_token", "") if r.status_code == 201 else ""
            sent = any("without an account" in m.body for m in mail.outbox)
            if r.status_code == 201:
                step.check("order link e-mailed", sent, "", "Check the e-mail settings with `python manage.py check_email`.")
        else:
            user = User.objects.create_user(email=f"rehearsal+{stamp}@example.invalid", password="Rehearsal-pass-123", role=Role.CUSTOMER)
            addr = Address.objects.create(user=user, **{k: v for k, v in address.items()})
            buyer = make_client()
            buyer.force_authenticate(user)
            buyer.post("/api/v1/cart/items/", {"variant": variant.id, "quantity": 2}, format="json")
            r = buyer.post("/api/v1/checkout/", {"address_id": addr.id, "shipping_service": service_code, "currency": currency, "accept_terms": True, "duties_acknowledged": True}, format="json", HTTP_IDEMPOTENCY_KEY=key)
            token = ""
        if not step.check("checkout", r.status_code == 201, f"order {r.data.get('number')}, total {r.data.get('grand_total')} {r.data.get('currency')}" if r.status_code == 201 else _errors(r), "Read the message above; it names the field that failed."):
            return
        number = r.data["number"]
        step.check("stock was reserved", Inventory.objects.get(variant=variant).quantity == 3, "5 in stock, 2 ordered, 3 left")
        if guest_on:
            dup = public.post("/api/v1/checkout/guest/", {
                "email": email, "items": [{"variant": variant.id, "quantity": 2}], "address": address, "shipping_service": service_code,
                "currency": currency, "accept_terms": True, "duties_acknowledged": True,
            }, format="json", HTTP_IDEMPOTENCY_KEY=key)
        else:
            dup = buyer.post("/api/v1/checkout/", {"address_id": addr.id, "shipping_service": service_code, "currency": currency, "accept_terms": True, "duties_acknowledged": True}, format="json", HTTP_IDEMPOTENCY_KEY=key)
        step.check("repeating the request does not make a second order", dup.status_code == 200 and dup.data.get("number") == number, f"HTTP {dup.status_code}")

        self.stdout.write("\n4. Pay for it (test gateway)")
        if guest_on:
            pay = public.post("/api/v1/payments/guest/initiate/", {"order_number": number, "provider": "mock", "token": token}, format="json")
        else:
            pay = buyer.post("/api/v1/payments/initiate/", {"order_number": number, "provider": "mock"}, format="json")
        if not step.check("start payment", pay.status_code in (200, 201), f"reference {pay.data.get('reference')}" if pay.status_code in (200, 201) else _errors(pay)):
            return
        reference = pay.data["reference"]
        body = {"event_id": f"rehearsal-{stamp}", "reference": reference, "status": "succeeded"}
        raw = json.dumps(body).encode()
        hook = public.post("/api/v1/payments/webhooks/mock/", data=raw, content_type="application/json", HTTP_X_MOCK_SIGNATURE=MockProvider.sign(raw))
        step.check("payment confirmation (signed webhook)", hook.status_code == 200, f"HTTP {hook.status_code}")
        hook2 = public.post("/api/v1/payments/webhooks/mock/", data=raw, content_type="application/json", HTTP_X_MOCK_SIGNATURE=MockProvider.sign(raw))
        step.check("a repeated webhook is ignored", hook2.status_code == 200, f"HTTP {hook2.status_code}")
        forged = public.post("/api/v1/payments/webhooks/mock/", data=raw, content_type="application/json", HTTP_X_MOCK_SIGNATURE="forged")
        step.check("a forged webhook is refused", forged.status_code in (400, 401, 403), f"HTTP {forged.status_code}")
        order = Order.objects.get(number=number)
        if not step.check("order is now paid", order.status == OrderStatus.PAID, f"status is {order.status}"):
            return
        if guest_on:
            seen = public.get(f"/api/v1/orders/guest/{number}/?token={token}")
            step.check("the customer can open the order from the link", seen.status_code == 200 and seen.data.get("status") == "paid", f"HTTP {seen.status_code}")

        self.stdout.write("\n5. Ship it")
        staff = User.objects.create_user(email=f"rehearsal-staff+{stamp}@example.invalid", password="Rehearsal-pass-123", role=Role.SUPER_ADMIN)
        staff.is_staff = staff.is_superuser = True
        staff.save()
        admin = make_client()
        admin.force_authenticate(staff)
        ship = admin.post("/api/v1/shipments/", {"order_number": number, "tracking_number": f"REH{stamp}"}, format="json")
        if not step.check("create shipment", ship.status_code == 201, f"status {ship.data.get('status')}" if ship.status_code == 201 else _errors(ship)):
            return
        order.refresh_from_db()
        step.check("order moved to processing", order.status == OrderStatus.PROCESSING, f"status is {order.status}")
        event = admin.post(f"/api/v1/shipments/{ship.data['id']}/events/", {"status": "delivered", "description": "Rehearsal delivery"}, format="json")
        step.check("tracking update recorded", event.status_code in (200, 201), "" if event.status_code in (200, 201) else _errors(event))

        self.stdout.write("\n6. Refund it")
        refund = admin.post("/api/v1/payments/refunds/", {"order_number": number, "reason": "Rehearsal"}, format="json")
        step.check("refund issued", refund.status_code == 201, f"{refund.data.get('amount')} {refund.data.get('currency')}" if refund.status_code == 201 else _errors(refund))
        order.refresh_from_db()
        step.check("order is refunded", order.status == OrderStatus.REFUNDED, f"status is {order.status}")
        history = order.events.count()
        step.check("order history recorded each change", history >= 3, f"{history} entries")
