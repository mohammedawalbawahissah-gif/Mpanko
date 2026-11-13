# Staging environment

A second, private copy of Mpanko where you (and later the client) test releases before customers see them. It costs a few dollars a month on Railway and prevents most launch-day surprises.

## Set up (about 30 minutes)

1. In the Railway project, open the environment menu and choose **New environment > Duplicate environment**, name it `staging`. This copies every service (api, worker, beat, web, admin, PostgreSQL, Redis) with its own empty database.
2. In staging, change these variables (never reuse production values):
   - `SECRET_KEY`: a new random value.
   - `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL`, `PAYMENT_RETURN_URL`: the staging domains Railway generates.
   - `VITE_API_URL` on web and admin: the staging api domain. `SITE_URL` on web: the staging web domain.
   - Payments: Paystack **test** keys only. Carriers: sandbox credentials only (DHL, FedEx and UPS all offer them). Resend: use the same account but set `DEFAULT_FROM_EMAIL` to a clearly marked sender such as `Mpanko Staging <staging@yourdomain>`.
   - R2: a separate bucket (`mpanko-staging`) so test uploads never mix with real products.
   - `STORE_TAX_ID` can stay empty.
3. Point the branch: in each staging service, Settings > Source, set the branch to `staging`. Production services stay on `main`.
4. Seed it once with sample products: in the api service shell run `python manage.py seed_demo` (works only while `DEBUG=true`, so for staging use `DEBUG=true` only if you accept the demo logins being active; otherwise create the catalog in the admin).
5. Create your own staff accounts with `python manage.py createsuperuser`.

## How releases flow

1. Work on a branch, open a pull request. CI (`.github/workflows/ci.yml`) runs backend tests, web, admin and mobile builds, and the browser tests. Do not merge a red build.
2. Merge to `staging` first. Railway deploys it automatically. Click through the journeys that changed, using Paystack test cards and sandbox carrier labels.
3. When staging looks right, merge `staging` into `main`. Railway deploys production.

## Mobile builds against staging

Build a preview app with its own API address: set `EXPO_PUBLIC_API_URL` to the staging api and run `eas build --profile preview`. Testers install it from the link EAS gives them.

## What staging cannot prove

Real money movement, real courier pickups and real mobile-money prompts only happen on live accounts. Plan a final small live test (one low-value real order, refunded afterwards) before announcing.
