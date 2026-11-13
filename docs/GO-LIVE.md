# Mpanko go-live runbook

Work top to bottom. Each step says what you need and how to check it worked. Do everything with **sandbox/test** keys first, then swap to live keys at the end.

## 1. Railway services (one project)

| Service | Source | Config file | Notes |
|---|---|---|---|
| PostgreSQL | Railway plugin | – | gives `DATABASE_URL` |
| Redis | Railway plugin | – | gives `REDIS_URL` |
| api | `backend/` | `railway.json` | runs migrations, then gunicorn. Health check `/health/` |
| worker | `backend/` | `railway.worker.json` | sends emails, releases unpaid stock, polls carriers |
| beat | `backend/` | `railway.beat.json` | the scheduler. **Exactly one copy** or jobs run twice |
| web | `web/` | – | static build (`npm run build`, serve `dist/`) |
| admin | `admin/` | – | static build |

In Railway, open each service > Settings > Config-as-code and enter the file path (for example `/backend/railway.worker.json`). Give worker and beat the same variables as api (use Railway "shared variables" or reference variables).

Check: `https://<api-domain>/ready/` returns `{"status":"ready"}` with database and redis both `ok`. A `503` means one of them is unreachable.

## 2. Core variables (api, worker, beat)

`SECRET_KEY` (long random), `ALLOWED_HOSTS` (your Railway api domain), `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` (the web and admin Railway domains, with https://), `DATABASE_URL`, `REDIS_URL`, `FRONTEND_URL`, `PAYMENT_RETURN_URL` (`https://<web-domain>/checkout/complete`). Leave `DEBUG` unset.

Web and admin builds need `VITE_API_URL=https://<api-domain>/api/v1`. The web build also needs `SITE_URL=https://<web-domain>`: after building it fetches the catalog and writes a page per product (with search-engine tags) plus `sitemap.xml` and `robots.txt`. Rebuild the web service after adding products so search engines see them (a Railway scheduled redeploy nightly is enough). If the API is unreachable during the build, the app still works but those pages are skipped.

See `docs/STAGING.md` to set up a test copy first.

Then create the owner account: `railway run python manage.py createsuperuser` (or the service shell).

## 3. Email (Resend)

1. Create a Resend account, add your sending domain and add the DNS records it shows. Wait for "Verified".
2. Create an API key. Set `RESEND_API_KEY` and `DEFAULT_FROM_EMAIL=Mpanko <orders@yourdomain.com>`.
3. Check: `python manage.py check_email you@example.com` and look in your inbox (and spam).

Until a domain is verified, Resend only delivers to your own address.

## 4. Image and label storage (Cloudflare R2)

1. R2 > Create bucket (for example `mpanko-media`).
2. Make product images public: bucket Settings > Public access (r2.dev URL for now, or a custom domain later).
3. R2 > Manage API tokens > create a token with Object Read & Write on that bucket.
4. Set `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`.
5. Check: in the admin, upload a product photo, then redeploy the api. The photo must still show.

Shipping labels are saved in the same bucket under `labels/`. They are only served to staff through the API, but the file URLs are public if someone guesses them, so keep the bucket's listing off.

## 5. Payments (Paystack)

1. Sandbox first: set `PAYMENT_PROVIDERS_ENABLED=paystack` and `PAYSTACK_SECRET_KEY=sk_test_...`.
2. In the Paystack dashboard > Settings > API Keys & Webhooks, set the webhook URL to `https://<api-domain>/api/v1/payments/webhooks/paystack/`.
3. Place a test order on the web store using Paystack's test cards. Check the order turns **Paid**, the confirmation email arrives, and a failed card shows a clear message.
4. Go live: Paystack needs your business verified (Ghana: registration documents and settlement account). Swap to `sk_live_...` and set the webhook again under live mode.
5. Charging currencies: Paystack accounts support GHS by default; USD, NGN, ZAR and KES need to be enabled on the account. Shoppers can *view* any currency, but are charged in one you have enabled.

## 5b. Chargebacks (card disputes)

Paystack sends `charge.dispute.create`, `charge.dispute.remind` and `charge.dispute.resolve` to the same webhook as payments, so no extra URL is needed. Each one creates or updates a case under **Chargebacks** in the admin (finance, store admin, super admin) and emails the staff addresses. A dispute that is lost, or accepted, reverses the payment and the order becomes **Refunded**. Upload your evidence in the Paystack dashboard before the deadline shown on the case, then tick **Evidence sent** in the admin. Confirm the field names against a sandbox dispute before going live.

## 5c. Tax, import duties and parcel rules

- **Tax rules** (admin > Tax and duties): one row per country, or `*` for everywhere else, with the rate as a percentage and whether it applies to shipping. These are your own rules; check them with the client's accountant. They are not tax advice.
- **Duty rules**: per destination country, the duty-free limit (in the store currency), duty rate, import VAT rate and a note shown to the shopper. Without a rule for a country the shopper sees no duty estimate.
- `DUTIES_MODE=estimate` (default) tells the shopper what they may pay on delivery. `prepaid` adds the duty to the order total, so you must then settle it with the carrier.
- **Parcel size**: give each product packed length, width and height (mm) so rates use the larger of actual and volumetric weight (`VOLUMETRIC_DIVISOR`, default 5000).
- **Dangerous goods** (batteries, aerosols, perfume): tick the product's dangerous goods box and give its class (and UN number if you have one). Only shipping rates ticked **Cleared for dangerous goods**, or carriers listed in `DANGEROUS_GOODS_CARRIERS`, are offered. Labels for these are booked in the carrier's own portal, not by the API.

## 5d. Text messages (Twilio)

1. Create a Twilio account and buy a number, or register an alphanumeric sender id. Several countries (Ghana included) require sender id registration, which can take days, so start early.
2. Set `SMS_BACKEND=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and either `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` on the api and worker services.
3. In a signed-in account, verify a phone number (web: Account > Profile, or the mobile Profile screen), then sign out and sign in by code. Turn on text updates and place a test order.
4. Codes are never written to the notification log. Customers can sign in by code only after verifying the number.

## 5e. Error tracking

Set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`) on the api, worker and beat services to send server errors to Sentry; personal data, cookies and request bodies are scrubbed before sending. The web, admin and mobile apps also post crashes to `POST /api/v1/client-errors/` (rate limited), which appear in the api logs under `mpanko.client`. Set `VITE_APP_VERSION` at build time to tag them.

## 5f. Guest checkout (optional)

Guest checkout is off. To allow buying without an account, set `GUEST_CHECKOUT_ENABLED=true` on the api service (and `GUEST_ORDER_LINK_DAYS` if 30 days is not right). Guests enter an email, get a signed order link by email, and can use "Find my order" (`/orders/find`) if they lose it. Their email is not verified, so `REQUIRE_VERIFIED_EMAIL` does not apply to them; a guest order moves into an account only once that account's email is verified. Per-user coupons need a sign-in. Guest checkout is available on the website only; the mobile app still asks shoppers to sign in.

## 6. Carriers (DHL Express, FedEx, UPS)

Leave `CARRIER_SANDBOX=true` until each carrier is proven.

For each carrier: get credentials, set the variables, then in the admin > Carriers add one carrier row with provider `dhl`, `fedex` or `ups`.

| Carrier | Get credentials | Variables |
|---|---|---|
| DHL Express | MyDHL API account via your DHL Express account manager | `DHL_EXPRESS_USER`, `DHL_EXPRESS_PASSWORD`, `DHL_EXPRESS_ACCOUNT` |
| DHL tracking | developer.dhl.com > Shipment Tracking > API key | `DHL_API_KEY` |
| FedEx | developer.fedex.com > create project | `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`, `FEDEX_ACCOUNT` |
| UPS | developer.ups.com > create app | `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT` |

Also set the ship-from address (`SHIP_FROM_*`) and the default box size (`PARCEL_DEFAULT_CM`).

Check, per carrier: the checkout shipping step lists its services for a US address with a postal code; compare two prices with the carrier's own calculator; on a paid test order, create a shipment, choose the carrier, **Create label**, download it, and check the tracking number in the carrier's sandbox.

The adapters follow each carrier's published API but have not been run against real accounts. Expect small field fixes on the first sandbox run. If a carrier fails, checkout keeps working with your own zone rates.

## 7. Domains

Railway-provided domains work for launch. When you buy a domain later: add it in each Railway service > Settings > Domains, add the DNS records Railway shows, then update `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL`, `PAYMENT_RETURN_URL`, `VITE_API_URL`, the Paystack webhook URL and the Resend sending domain.

## 7b. Push notifications and deep links
- Push uses Expo. In the mobile project run `eas init` once; it writes the EAS project id into `app.json` (`extra.eas.projectId`). Without it, phones cannot get a push token.
- iOS push needs an Apple developer account and Android push needs a Firebase (FCM) key, both added through `eas credentials`. Optional: set `EXPO_ACCESS_TOKEN` on the api to raise Expo's limits.
- Links such as `mpanko://orders/MP-1001` already open the right screen. Links that open the app from the website address (universal links on iOS, app links on Android) need the shop domain and signing details first: add `apple-app-site-association` and `assetlinks.json` to the web `public/` folder once the app has its real bundle signing.

## 8. Mobile apps

1. Google Play Console (one-time US$25) and Apple Developer Program (US$99 a year). These must be in the business's name.
2. In `mobile/eas.json` replace `YOUR-API.up.railway.app` with your api domain.
3. `npm i -g eas-cli`, `eas login`, `eas build --platform android --profile preview` for a test APK you can install on a phone.
4. `eas build --profile production` then `eas submit` for each store. Stores need a privacy policy URL, screenshots and a support email.

## 8b. Legal and privacy
- Set `STORE_LEGAL_NAME`, `STORE_ADDRESS`, `STORE_TAX_ID` on the api service (printed on invoices).
- Have the client's lawyer review the four policy pages, edit them in the admin under Policy pages, and tick Published. Until then shoppers see a "still being finalised" notice.
- Confirm retention periods (`RETENTION_*`) with the client's accountant.

## 9. Final checks before announcing

- [ ] `/ready/` is green; worker and beat logs show tasks running
- [ ] Test purchase end to end with live Paystack, then refund it
- [ ] A test SMS code arrives on a real phone (Twilio sender id approved)
- [ ] Tax and duty rules entered for your main destination countries
- [ ] A sandbox dispute shows up under Chargebacks
- [ ] Order, shipping and delivery emails arrive and links open the right pages
- [ ] A product photo survives a redeploy
- [ ] Low-stock alert email arrives (set a threshold on a test item)
- [ ] Backups: Railway Postgres > Backups enabled
- [ ] Super admin has MFA switched on
