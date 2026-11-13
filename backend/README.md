# Mpanko API — Rooted in Africa. Made for the World.

Django REST Framework backend for the Mpanko online store (Phase 2 of the build plan). One API serves the
customer web app, the Android/iOS apps, the admin dashboard and the carrier portal.

## Run locally (Windows CMD)

```
cd mpanko\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

- API docs (Swagger): http://127.0.0.1:8000/api/v1/docs/
- Django admin: http://127.0.0.1:8000/admin/
- Demo logins (DEBUG only): `admin@mpanko.test` and `customer@mpanko.test`, password `Mpanko-demo-123`
- Run tests: `python -m pytest`

With no `DATABASE_URL` it uses SQLite; with no `REDIS_URL` background tasks run inline. Payments use the
`mock` gateway locally.

## Deploy on Railway

1. New project, add a **PostgreSQL** service and a **Redis** service.
2. Add this folder as a service (it builds from `Dockerfile`). Set variables: `SECRET_KEY`, `ALLOWED_HOSTS`,
   `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `PAYMENT_PROVIDERS_ENABLED=paystack`,
   `PAYSTACK_SECRET_KEY`, `PAYMENT_RETURN_URL`, and reference `DATABASE_URL` / `REDIS_URL` from the two services.
   Leave `DEBUG` unset.
3. Add a second service from the same repo with start command `celery -A config worker -B -l info`
   (sends emails and releases stock held by unpaid orders).
4. In the Paystack dashboard set the webhook URL to `https://<your-api-domain>/api/v1/payments/webhooks/paystack/`.
5. Create the first super administrator: `python manage.py createsuperuser`.

## How the key rules are enforced

| Rule (SRS) | Where |
|---|---|
| Server recalculates all prices and totals (FR-CHK-02) | `apps/orders/services.py::checkout` — the request has no money fields |
| One order per retry (FR-CHK-06) | `Idempotency-Key` header, unique per user |
| No overselling (FR-CAT-04) | row-locked stock reservation in `catalog.models.adjust_stock` |
| Payments verified server-side (FR-PAY-04) | HMAC-signed webhook and/or provider status API; amount and currency must match |
| Duplicate callbacks are harmless (FR-PAY-06) | `WebhookEvent` unique per provider event; `apply_result` is idempotent |
| Order state machine (FR-ORD-02) | `apps/orders/services.py::ALLOWED`; payment states cannot be set by hand |
| Carrier users see only their shipments (FR-SHP-07) | queryset scoping in `ShipmentViewSet` |
| Audit trail (FR-ADM-04) | `AuditLog` for product, stock, order, shipment and refund actions |

## Adding a provider

Payment: subclass `PaymentProvider` in `apps/payments/providers.py` and add it to `_REGISTRY`
(Stripe, PayPal, Flutterwave go here). Shipping: subclass `ShippingProvider` in `apps/shipping/providers.py`
and add it to `PROVIDERS` (DHL, FedEx, UPS). Checkout and order code do not change.

## Staff security, reports and reconciliation

- **Staff MFA:** set `REQUIRE_STAFF_MFA=true` to force every staff role to enrol an authenticator app at first sign-in.
  Staff who have enrolled are always asked for a code. Customers are never asked. Set `REQUIRE_VERIFIED_EMAIL=true`
  to block checkout until the customer confirms their email.
- **Email:** verification and password-reset emails link to `FRONTEND_URL` (`/verify-email`, `/reset-password`).
  Set the `EMAIL_*` variables to a real SMTP provider in production; locally they print to the console.
- **Exchange rates:** `refresh-fx-rates` runs every 6 hours (needs the Celery worker with `-B`). Priority is a manual
  rate set in Django admin, then a live rate under 48 hours old, then `MANUAL_FX_RATES`.
- **Reports:** `/api/v1/reports/{sales,orders,payments,refunds,stock,shipping}/?from=YYYY-MM-DD&to=YYYY-MM-DD`;
  add `&export=csv` to download.
- **Reconciliation:** finance staff run it from the admin dashboard. It lists payments we marked paid that the provider
  doesn't show, provider payments we don't know about, and amount mismatches, and each exception can be marked resolved.
- **Carrier partners:** in Django admin create a Carrier, create a user with role `carrier`, and add that user to the
  carrier's Users. They then see only that carrier's shipments in the admin dashboard.

## Not built yet

Guest checkout, SMS and push notifications, backup codes for MFA, label printing and live carrier rate quotes
(shipping rates are flat rates until you have contracted carrier accounts), and encryption of MFA secrets at rest.

## Not verified against live services

The Paystack, DHL tracking and exchange-rate provider adapters follow the providers' documented APIs and are covered by
tests that mock the network. They have not been run against the real services, so test each in the provider's sandbox
before taking real money.
