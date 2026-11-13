# App links: opening shop addresses in the mobile app

With app links on, a shopper who taps `https://YOUR-SHOP/shop/kente-scarf` in a message or email lands in the Mpanko app, on that product, if the app is installed. If it is not installed, the link opens the website as usual.

The app already knows how to show these paths (`/shop/...`, `/orders/...`, `/support/...`). What is missing is proof, on your website, that the app belongs to you. Phones read that proof from two small files. The web build writes them for you when you supply two values.

## What you need

| Value | Where it comes from |
|---|---|
| `APPLE_TEAM_ID` | Your Apple Developer account, under Membership details. Ten letters and digits. |
| `ANDROID_SHA256_FINGERPRINT` | The signing key of your Android app. With EAS: run `eas credentials`, choose Android, and read the SHA-256 fingerprint. If Google Play signs the app for you, copy it from Play Console, Setup, App signing. Several fingerprints can be separated by commas. |

## Steps

1. Set both values as environment variables on the service that builds the web app (Railway: the web service's Variables).
2. Redeploy the web service. The build prints `App links: wrote assetlinks.json` and `wrote apple-app-site-association`. If it prints that no files were written, a value is missing.
3. Check in a browser that these open and show JSON, not the shop home page:
   - `https://YOUR-SHOP/.well-known/assetlinks.json`
   - `https://YOUR-SHOP/.well-known/apple-app-site-association`
4. Build the mobile app with `EXPO_PUBLIC_WEB_URL=https://YOUR-SHOP` set. `app.config.js` then adds the shop address to the iPhone associated domains and the Android intent filters.
5. Install the new build on a real phone and tap a shop link from Notes or a message. The app should open on the product.

## Things to know

- Both files must be reachable without a redirect and over https. The included web server (`npm start`) serves them correctly.
- Apple caches the file when the app is installed. After changing it, reinstall the app to test.
- Android checks the link on first install. After changing the fingerprint, reinstall.
- Links opened by typing the address in the phone's browser stay in the browser by design; only taps from other apps open the app.
- These steps need a real phone and the store build. They cannot be tested from a laptop, so the tracker keeps this item as "needs a device check" until you have tried step 5.
