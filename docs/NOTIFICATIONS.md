# Notifications: how they work and how to switch each one on

Customers hear about their orders in up to five places. Each is independent, and one failing never stops an order.

| Channel | Where the customer sees it | Needs |
|---|---|---|
| In the app or shop | The bell (unread count) and the Notifications page | Nothing to set up. It works as soon as the api runs. |
| Email | Their inbox | Resend (or SMTP) |
| Text message (SMS) | Their phone | Twilio, and the customer's verified number and opt-in |
| WhatsApp | Their phone | Twilio WhatsApp, and the customer's verified number and opt-in |
| Phone push | The app's notifications | An Expo project, Apple and Firebase credentials, a real build of the app |
| Browser push | The browser's notifications | A key pair (`VAPID_*`), and the shop on https |

Events that notify: order confirmed, shipped, delivered, payment failed, return approved, return rejected, refund sent, and a reply from support. Each event adds one line to the customer's bell. Push (phone and browser) is sent only to customers who allowed it. In the app it is the "Notifications" switch in Profile; on the shop it is "Notifications in this browser" on the account page.

Every send is recorded in the admin under Emails > Log (channel, recipient, result, error).

## Test each channel before launch

Run these from the `backend` folder, on the live api (Railway shell) once the settings below are in:

```
python manage.py check_email you@example.com
python manage.py check_notifications --phone +233240000000
python manage.py check_notifications --user buyer@example.com
```

`check_email` sends one email. `--phone` sends a real SMS and a real WhatsApp message to that number. `--user` sends a phone push and a browser push to that customer's registered devices (they must have signed in and allowed notifications first). Each line says whether the provider accepted it, with the provider's own error if not.

## 1. Email (Resend)
See section 3 of GO-LIVE.md. Verify your sending domain, set `RESEND_API_KEY` and `DEFAULT_FROM_EMAIL`, then run `check_email`.

## 2. Text messages (Twilio)
1. Create a Twilio account and buy or register a sender. In Ghana and many countries a plain number may not reach phones; register an alphanumeric sender id (for example `Mpanko`) with Twilio.
2. Set `SMS_BACKEND=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM` (the number or sender id) or `TWILIO_MESSAGING_SERVICE_SID`.
3. Run `check_notifications --phone +233...` and confirm the text arrives.

## 3. WhatsApp (Twilio)
1. While testing, use the Twilio WhatsApp sandbox: on your phone, send the join code Twilio shows to the sandbox number. Set `WHATSAPP_BACKEND=twilio` and `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`.
2. For real customers you need a WhatsApp sender approved by Meta through Twilio, plus an approved message template for each event. Put the template ids in `WHATSAPP_TEMPLATE_SIDS` as JSON (event key to template id). Without templates, WhatsApp only accepts free text inside 24 hours of the customer's last message to you.
3. Run `check_notifications --phone +233...` and confirm the message arrives.

## 4. Phone push (Expo)
Expo Go cannot receive push on Android, so push is tested with a development build of the app.
1. In the `mobile` folder: `npm install -g eas-cli`, `eas login`, then `eas init` (writes the project id into `app.json`).
2. iPhone: `eas credentials` and let Expo create the push key with your Apple developer account. Android: create a Firebase project, add the Android app (package name from `app.json`), and upload the FCM server key or service account through `eas credentials`.
3. Build: `eas build --profile development --platform ios` (or `android`), then install the build on your phone.
4. Start the app server for the dev build: set `EXPO_PUBLIC_API_URL` to your api, then `npx expo start --dev-client`.
5. In the app: sign in, open Profile, switch on Notifications, and allow when the phone asks.
6. Run `check_notifications --user your@email` and confirm the phone buzzes.
Optional: set `EXPO_ACCESS_TOKEN` on the api to raise Expo's push limits.

## 5. Browser push
1. Make the key pair once: `python manage.py generate_vapid_keys`. Copy the two lines into the api's variables as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT` to `mailto:` plus your support address (it defaults to `SUPPORT_EMAIL_ADDRESS`). Do not change the keys later, or every browser has to subscribe again.
2. The shop must be on https (localhost also works for testing). Restart the api.
3. In the shop: sign in, open Account, tick "Notifications in this browser", and allow when the browser asks.
4. Run `check_notifications --user your@email` and confirm the notification appears.
Safari on iPhone only supports browser push once the shop is added to the Home Screen.

## Checks
`python manage.py preflight` warns when browser push keys, the support email or the support phone are missing.
