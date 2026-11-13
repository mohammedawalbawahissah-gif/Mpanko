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
3. Add two more services from the same repo: a worker (config file `railway.worker.json`) and a scheduler
   (`railway.beat.json`, exactly one copy). They send emails, release stock held by unpaid orders and poll carriers.
   `/ready/` checks the database and Redis. The full launch checklist is in `docs/GO-LIVE.md`.
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

Guest checkout, SMS and push notifications, backup codes for MFA, and encryption of MFA secrets at rest.

## Not verified against live services

The Paystack, DHL (Express and tracking), FedEx, UPS, Resend, Cloudflare R2 and exchange-rate adapters follow the providers' documented APIs and are covered by
tests that mock the network. They have not been run against the real services, so test each in the provider's sandbox
before taking real money.

## Settings added in batch 1 and 2
- `SUPPORTED_CURRENCIES=ALL` (default) offers every world currency we hold a rate for. Rates load from the live feed on first use and every 6 hours. List codes (`USD,GHS,EUR`) to restrict. Customers can view prices in any of them but are charged in a currency a payment provider supports (today USD, GHS, NGN, ZAR, KES via Paystack).
- `STAFF_ALERT_EMAILS=a@x.com,b@x.com` extra recipients for low-stock alerts.
- `STORE_COUNTRY=GH` shipments elsewhere are international and need the duties acknowledgement at checkout.
- Shipping zones, rates and blocked countries are managed in the admin under Shipping rules. With none set up, the flat-rate fallback applies.

## Settings added in batch 3
- Email: set `RESEND_API_KEY` (and a `DEFAULT_FROM_EMAIL` on your verified domain). Test with `python manage.py check_email you@example.com`.
- Images and labels: set `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`. Without them files go to local disk and are lost on redeploy.
- Carriers: `CARRIER_SANDBOX`, `SHIP_FROM_*`, `PARCEL_DEFAULT_CM`, and the `DHL_EXPRESS_*`, `FEDEX_*`, `UPS_*` credentials. A carrier is live when its credentials are set and a Carrier row with provider `dhl`, `fedex` or `ups` is active. Live quotes appear next to your own zone rates (service codes look like `dhl:P`) and are cached for 10 minutes so the price shown is the price charged. A failing carrier is skipped.
- Add another carrier: subclass `LiveCarrier` in `apps/shipping/carriers.py` and add it to `LIVE_CARRIERS`.
- New endpoints: `POST /shipments/{id}/label/` (book and store a label), `GET /shipments/{id}/label/` (download), `/ready/`.
- Run `python manage.py migrate` after updating.
- Web tests: `cd web && npm test`.

## Settings added in batch 4
- Returns: `RETURN_WINDOW_DAYS=14` (days after delivery) and `RETURN_ALLOW_CHANGED_MIND=true`. Confirm both with the client (OD-11). Customers request from a delivered order; staff approve or reject, mark received (optionally restocking), and finance refunds. Partial refunds leave the order Delivered; a full refund moves it to Refunded.
- Support requests: customers open and reply on the web; support and store admins reply from the admin (customers get an email).
- Promotions: codes are managed in the admin under Promotions. Types are percent off, amount off (store currency, converted at checkout) and free shipping. Limits: total uses, uses per customer, smallest order, dates. Used codes are switched off rather than deleted.
- Customers, Staff and Activity log screens in the admin. Staff are invited by email and set a password on the storefront's reset page. Only the super administrator can create or change administrators; nobody can change their own role.
- New endpoints: `/returns/`, `/returns/eligibility/`, `/support/cases/`, `/coupons/`, `/coupons/check/`, `/customers/`, `/staff/`, `/audit/`.
- Run `python manage.py migrate` after updating.

## Privacy and compliance

- Registration needs `accept_terms`; terms, privacy and marketing consent are stored with the policy version (`ConsentRecord`). Marketing changes in the profile are recorded too.
- `GET /api/v1/me/export/` downloads the customer's data as JSON. `POST /api/v1/me/delete/` (password required) anonymises the account; it is refused while an order is paid-but-undelivered or a return is open. Orders are kept with personal details blanked.
- `python manage.py apply_retention` (also scheduled daily): deletes unverified accounts with no orders after `RETENTION_UNVERIFIED_DAYS`, email logs after `RETENTION_LOG_DAYS`, closed support cases after `RETENTION_CLOSED_SUPPORT_DAYS`, and anonymises orders older than `RETENTION_ORDER_YEARS`. Confirm the periods with the client's accountant.
- Policy pages (`/privacy`, `/terms`, `/returns-policy`, `/cookies`) show a draft written from how the software behaves until an admin edits and publishes them under Policy pages. The draft is not legal advice; the client's lawyer must review it before launch.
- `GET /api/v1/orders/<number>/invoice/` returns a PDF (reportlab) for paid orders. Set `STORE_LEGAL_NAME`, `STORE_ADDRESS` and `STORE_TAX_ID`.
