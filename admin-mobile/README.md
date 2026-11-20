# Mpanko Admin (phone app)

A small Expo app for staff: store alerts, orders, and confirming manual payments (Zelle, Cash App, cash).
It talks to the same API as the admin website, so roles and permissions are the same.

## Run it

```
cd admin-mobile
npm install
npx expo start
```

Scan the code with Expo Go for a quick look. Phone alerts do **not** work in Expo Go; they need a real build (below).

## Build it so phone alerts work

1. Create a free Expo account at expo.dev and sign in: `npx eas-cli login`
2. In this folder: `npx eas-cli init` (this creates the project id and adds it to `app.json`)
3. Android test build: `npx eas-cli build --profile preview --platform android` (gives you a link to install the app)
4. For iPhones you also need an Apple developer account (paid). `npx eas-cli build --profile preview --platform ios`
5. Android push also needs Firebase set up once: follow https://docs.expo.dev/push-notifications/fcm-credentials/ and upload the key with `npx eas-cli credentials`.

The API address is set in `eas.json` (`EXPO_PUBLIC_API_URL`).

## How alerts reach the phone

Signing in registers this phone. In the app, **Me** > **Phone alerts** switches phone alerts on or off for you.
The server sends them (see `docs/NOTIFICATIONS.md`) and tapping one opens the order or screen it is about.
