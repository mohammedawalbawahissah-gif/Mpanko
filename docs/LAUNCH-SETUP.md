# Launch setup: payments, carriers, messages, mobile, content

The code for everything here is already in the repo. What remains is creating accounts and setting variables on Railway.
Do one section at a time. After each, run in the **api** service shell:

    python manage.py preflight
    python manage.py rehearse --country US

`preflight` reads each account and prints PASS / WARN / FAIL. `rehearse` places a test order with the mock gateway.

## 1. Extra payment providers

Set `PAYMENT_PROVIDERS_ENABLED` on the api service to a comma list, for example `paystack,stripe,zelle,cashapp`.
Only add a name after its variables are set. Webhook URL pattern: `https://mpanko-api.wolbiroyal.com/api/v1/payments/webhooks/<name>/`

| Provider | Variables | Notes |
|---|---|---|
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Start with `sk_test_`. Dashboard > Developers > Webhooks > add the `stripe` webhook URL, copy the signing secret. |
| Zelle | `ZELLE_RECIPIENT`, `ZELLE_NAME` | Manual: customer pays outside the site, you confirm in admin. |
| Cash App | `CASHAPP_CASHTAG` | Manual, same as Zelle. |
| Hubtel | `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `HUBTEL_MERCHANT_ACCOUNT` | Needs a registered Ghana business. `API_PUBLIC_URL` must be https (already set). |
| MTN MoMo | `MTN_MOMO_*` | Needs MTN business onboarding. Sandbox first. |

Test card for Stripe test mode: 4242 4242 4242 4242, any future date, any CVC.
Switch every key from test to live only on launch day.

## 2. Carriers (DHL Express first)

1. Create a DHL Express MyDHL API account and get the API key, user, password and account number.
2. On the api service set `DHL_API_KEY`, `DHL_EXPRESS_USER`, `DHL_EXPRESS_PASSWORD`, `DHL_EXPRESS_ACCOUNT`.
3. Keep `CARRIER_SANDBOX=true` until you have tested a quote and a label. Set it to `false` only with production credentials.
4. In admin > Shipping > Carriers add a carrier whose provider code is `dhl`, then check quotes for a US, UK, CA and DE address.
5. FedEx (`FEDEX_CLIENT_ID/SECRET/ACCOUNT`) and UPS (`UPS_CLIENT_ID/SECRET/ACCOUNT`) work the same way with provider codes `fedex` and `ups`.

These adapters were written from the carriers' API documents and tested against mock responses, so expect to adjust after the first real sandbox call.

## 3. SMS and WhatsApp

1. Create a Twilio account. Set `SMS_BACKEND=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`.
2. WhatsApp: set `WHATSAPP_BACKEND=twilio` and `TWILIO_WHATSAPP_FROM=whatsapp:+<number>`. Start with the Twilio WhatsApp sandbox.
3. For live WhatsApp, each message type needs a template approved by Meta. Put the template SIDs in `WHATSAPP_TEMPLATE_SIDS` as JSON, keyed by event: `order_confirmation`, `shipment_dispatched`, `order_delivered`, `payment_failed`, `return_approved`, `return_refunded`.
4. Verify with `python manage.py check_notifications`.

Customers receive these only if they verified their phone and opted in.

## 4. Mobile app on a real phone

Build settings already point at `https://mpanko-api.wolbiroyal.com/api/v1` (`mobile/eas.json`).

Quick test with Expo Go (Windows CMD, from the repo):

    cd mobile
    set EXPO_PUBLIC_API_URL=https://mpanko-api.wolbiroyal.com/api/v1
    npx expo start

Scan the QR code with Expo Go. Installable test build for Android:

    npx eas-cli login
    npx eas-cli build --platform android --profile preview

Check on the phone: fonts load (Bricolage Grotesque headings), shop list and category chips, QT Eatery menu screen, add to bag, guest checkout with a test payment, order tracking, language switch (EN/FR/ES/HA), push permission prompt.
For web-address app links see `docs/APP-LINKS.md` (`APPLE_TEAM_ID`, `ANDROID_SHA256_FINGERPRINT` on the web service).

## 5. Content, legal pages and translations

- Legal pages: drafts live in `backend/apps/privacy/defaults.py` and describe the decided policies (14-day window, customer pays change-of-mind return shipping, refunds within 7 days, perishable and made-to-order items non-returnable, duties not included). Edit them in admin > Policy pages, then publish. A lawyer must review before launch.
- Set `STORE_LEGAL_NAME` on the api service to the legal seller name (currently defaults to "Wolbi Royal Enterprise") and `STORE_ADDRESS`.
- Translations: send `docs/TRANSLATION-REVIEW.csv` to native speakers. They fill the "Reviewer notes" column or correct the French, Spanish and Hausa columns. Return the file and the corrections go into `mobile/src/core/locales.ts` and `web/src/locales.ts`.
