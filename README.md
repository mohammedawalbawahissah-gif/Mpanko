# Mpanko — Rooted in Africa. Made for the World.

| Folder | What it is | Dev port |
|---|---|---|
| `backend/` | Django REST API (one API for every front end) | 8000 |
| `web/` | Customer storefront (React, Vite, TypeScript) | 5173 |
| `admin/` | Staff dashboard and carrier portal (React, Vite, TypeScript) | 5174 |
| `mobile/` | Customer app for Android and iOS (React Native, Expo) | Expo |

## Run everything locally (Windows CMD, four windows)

**1. API**
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
Demo logins (DEBUG only), password `Mpanko-demo-123`: `admin@mpanko.test`, `customer@mpanko.test`.

**2. Storefront**
```
cd mpanko\web
copy .env.example .env
npm install
npm run dev
```
Open http://localhost:5173. Payments use the built-in test gateway locally.

**3. Admin dashboard**
```
cd mpanko\admin
copy .env.example .env
npm install
npm run dev
```
Open http://localhost:5174. Staff sign in with a password and a 6-digit code from an authenticator app. If
`REQUIRE_STAFF_MFA` is on, the first sign-in shows a QR code to set the app up.

**4. Mobile app**
```
cd mpanko\mobile
npm install
set EXPO_PUBLIC_API_URL=http://<your-computer-IP>:8000/api/v1
npx expo start
```
Scan the QR code with the Expo Go app on your phone (phone and computer on the same Wi-Fi). Android emulator can use
`http://10.0.2.2:8000/api/v1`. Add your computer's IP to `ALLOWED_HOSTS` in the API `.env`.

## Build for production

- `web/` and `admin/`: `npm run build` produces a static `dist/` folder. On Railway, add each as a service using
  the Nixpacks builder with build command `npm install && npm run build` and start command `npx serve -s dist -l $PORT`.
  Set `VITE_API_URL` to your API URL (`https://<api-domain>/api/v1`) before building.
- Add each front-end's address to the API's `CORS_ALLOWED_ORIGINS`, and set `FRONTEND_URL` and `PAYMENT_RETURN_URL`
  (`https://<storefront>/checkout/complete`).
- `mobile/`: use EAS Build (`npx eas build`) for store builds. You need Apple and Google developer accounts.
- API deployment steps are in `backend/README.md`.

## Tests

- API: `cd backend && python -m pytest -p no:warnings -q tests` (set `DEBUG=true` first).
- Web and admin: `npx vitest run` in each folder. Mobile: `npx vitest run` (platform-free logic) and `npx tsc --noEmit`.
- Browser tests: see `e2e/`.

## Languages, phone sign-in and error reports

- The web and mobile apps ship English, French and Spanish for the main screens (`web/src/locales.ts`, `mobile/src/core/locales.ts`; keep the two files identical). Anything not translated falls back to English. Have a native speaker review the French and Spanish before launch.
- Customers can verify a mobile number in their profile and then sign in with a texted code. In development `SMS_BACKEND=log` prints the code in the API console.
- Crashes in the web, admin and mobile apps are posted to `/api/v1/client-errors/`; set `SENTRY_DSN` on the API for server-side tracking. See `docs/GO-LIVE.md` sections 5b to 5e.

## Known limits

- After paying on the web page opened from the mobile app, the in-app browser lands on the storefront's confirmation
  page, which asks you to sign in again. Payment is still confirmed by the provider's webhook; close the browser and
  the order screen shows the updated status.
- Display prices on the storefront and mobile checkout are estimates from the stored exchange rate. The server
  recalculates the real total at checkout.
- Product photos: the API stores image records, but there is no upload screen yet, so the apps show woven placeholder
  art for products without photos.
