# Handover checklist

Tick each line when it is done and write the date. This is the last page to finish before announcing the shop.

## Accounts and access

- [ ] The client owns the GitHub repository, Railway project, Cloudflare account (R2 and domain), Paystack account, Resend account and Apple and Google developer accounts. None sit on a developer's personal account only.
- [ ] Two people have owner access to each service.
- [ ] All secrets (`SECRET_KEY`, API keys, database URLs) are in the client's password manager. None are in the repository.
- [ ] Developer access that is no longer needed has been removed.
- [ ] Every staff member has their own admin account with the right role. The demo accounts from `seed_demo` are removed.

## Running the shop

- [ ] `docs/GO-LIVE.md` has been followed to the end, including the final checks.
- [ ] Database backups are on, one practice restore is done and dated (`docs/BACKUPS.md`).
- [ ] Uptime monitor and error alerts reach a real person's phone.
- [ ] A load test was run on staging and the numbers are recorded in `docs/PERFORMANCE.md`.
- [ ] A real test order was paid with a live card, refunded, and the emails arrived.
- [ ] A parcel was booked with each carrier the shop will use, and tracking updates reached the customer.

## Decisions the client has signed off

- [ ] The open client decisions are settled and written down (carriers, tax and duty rules, return window, refund rules, languages, guest checkout on or off).
- [ ] The privacy policy, terms of sale, returns policy and cookie policy were reviewed by someone qualified.
- [ ] French and Spanish text was reviewed by native speakers, or those languages are hidden until it is.

## People

- [ ] Staff were walked through `docs/ADMIN-GUIDE.md` and processed practice orders.
- [ ] Someone is named as the first contact for problems, with a phone number, and a developer is named for fixes.
- [ ] The client knows what each monthly bill is (Railway, Cloudflare, Resend, Twilio, Sentry, carriers, app store fees).

## Testing on real devices

- [ ] The shop was used on a real iPhone and a real Android phone on a mobile network.
- [ ] The mobile app was installed from TestFlight and an internal Android track, signed in, bought something, and received a push notification.
- [ ] Someone used the shop with a keyboard only and with a screen reader (automated checks are not enough).

Signed off by (name, date): ______________________
